import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, readFile, mkdir, open, rename, unlink, readdir } from 'node:fs/promises';
import { snapshotSchema, type WorkspaceSnapshot, trackedPath } from './contracts.js';

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function fail(code: string): never { throw Error('workspace_' + code); }
export const STATE = 'data/workspace/state.json';
const MUTEX = '.cache/workspace-transaction.lock';
const REPAIR = '.cache/workspace-repair.lock';

/** Do not follow a reparse point in either shared metadata or captured inputs. */
export async function localPath(root: string, relative: string): Promise<string> {
  const base = await realpath(root), target = path.resolve(base, relative), rel = path.relative(base, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) fail('path_escape');
  let current = base;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('reparse_point'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return target;
}
export async function readLocal(root: string, relative: string, limit = 2 * 1024 * 1024): Promise<Buffer> {
  const file = await localPath(root, relative), info = await lstat(file);
  if (!info.isFile() || info.size > limit) fail('file_limit');
  const bytes = await readFile(file);
  if (bytes.length > limit) fail('file_limit');
  return bytes;
}
export async function atomicJson(root: string, relative: string, value: unknown, exclusive = false): Promise<void> {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) fail('file_limit');
  const file = await localPath(root, relative);
  await mkdir(path.dirname(file), { recursive: true }); await localPath(root, relative);
  const temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(serialized); await handle.sync(); }
  finally { await handle.close(); }
  try {
    if (exclusive) {
      // Immutable handoff IDs are random and never overwritten, even on retries.
      const output = await open(file, 'wx');
      try { await output.writeFile(await readFile(temporary)); await output.sync(); } finally { await output.close(); }
    } else { await localPath(root, relative); await rename(temporary, file); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function transaction<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const repair = await localPath(root, REPAIR);
  try { await lstat(repair); fail('transaction_repair_in_progress'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const file = await localPath(root, MUTEX); await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try { handle = await open(file, 'wx'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('transaction_busy_inspect_before_repair'); throw error; }
  const bytes = JSON.stringify({ pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() });
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    if ((await readFile(file, 'utf8')) !== bytes) fail('transaction_owner_changed');
    await unlink(file);
  }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
export async function inspectTransaction(root: string) {
  try {
    const bytes = await readLocal(root, MUTEX, 4096), row = JSON.parse(bytes.toString());
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0 || row.pid > 2147483647) fail('transaction_identity_invalid');
    return { pid: row.pid, alive: alive(row.pid), sha256: hash(bytes) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Explicit local repair only; never clears the long-lived task owner. */
export async function repairTransaction(root: string, expectedHash: string): Promise<void> {
  const file = await localPath(root, REPAIR); await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'wx');
  try {
    const observed = await inspectTransaction(root);
    if (!observed || observed.alive || observed.sha256 !== expectedHash) fail('transaction_repair_precondition');
    await unlink(await localPath(root, MUTEX));
  } finally { await handle.close(); await unlink(file); }
}

const rules = ['AGENTS.md', 'CLAUDE.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md', '.agents/skills/reference-elementor/SKILL.md', 'docs/shared-workspace.md'];
export function verifySnapshot(snapshot: WorkspaceSnapshot): void {
  const names = snapshot.files.map(row => row.path);
  if (new Set(names).size !== names.length || JSON.stringify(names) !== JSON.stringify([...names].sort()) ||
      hash(JSON.stringify(snapshot.files)) !== snapshot.fingerprint ||
      hash(JSON.stringify(snapshot.files.filter(row => rules.includes(row.path)))) !== snapshot.rulesFingerprint) fail('snapshot_identity_changed');
}
/** Same inputs on both front ends; excludes mutable runtime/credentials/temporary fixtures. */
export async function captureWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const paths = new Set<string>();
  async function collect(directory: string) {
    const dir = await localPath(root, directory); let rows;
    try { rows = await readdir(dir, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const row of rows) {
      if (row.name.startsWith('.')) continue;
      const name = directory + '/' + row.name;
      if (row.isSymbolicLink()) fail('reparse_point');
      if (row.isDirectory()) await collect(name);
      else if (/\.(?:ts|js|mjs|php|json|css|md)$/.test(row.name) && !/credential|\.env/i.test(row.name)) paths.add(name);
      if (paths.size > 5000) fail('snapshot_file_limit');
    }
  }
  for (const directory of ['src', 'tests', 'tools', 'docs']) await collect(directory);
  for (const name of [...rules, 'README.md', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'config/native44-component-set.json', 'data/native44/index.json']) {
    try { await lstat(await localPath(root, name)); paths.add(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const required of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', 'package.json']) if (!paths.has(required)) fail('startup_document_missing');
  const files = await Promise.all([...paths].sort().map(async name => ({ path: trackedPath.parse(name), sha256: hash(await readLocal(root, name, 16 * 1024 * 1024)) })));
  return snapshotSchema.parse({ fingerprint: hash(JSON.stringify(files)), rulesFingerprint: hash(JSON.stringify(files.filter(row => rules.includes(row.path)))), files });
}
export function changedFiles(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  const a = new Map(before.files.map(row => [row.path, row.sha256])), b = new Map(after.files.map(row => [row.path, row.sha256]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(name => a.get(name) !== b.get(name)).sort();
}

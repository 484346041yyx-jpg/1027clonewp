import path from 'node:path';
import { readFile, realpath, mkdir, writeFile, open, rename, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { writeJson } from './files.js';
import { canonicalV2, hashV2, safeErrorV2 } from '../replica-v2/journal.js';
function inside(root: string, file: string): void { const relative = path.relative(root, file); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Replica v2 path must stay within its explicit task/project root'); }

export async function archiveRawInputV2(options: { runDir: string; kind: 'program' | 'component-plan' | 'source-facts' | 'assets-manifest'; sha256: string; bytes: Buffer; normalize: (value: unknown) => unknown }): Promise<{ path: string; sha256: string; repaired: boolean; historyRef?: { path: string; sha256: string } }> {
  if (!/^[a-f\d]{64}$/.test(options.sha256) || hashV2(options.bytes) !== options.sha256) throw Error('Original raw input bytes do not match their immutable hash');
  const directory = path.join(options.runDir, 'inputs'); await mkdir(directory, { recursive: true }); inside(options.runDir, await realpath(directory));
  const filename = path.join(directory, `${options.kind}-${options.sha256}.json`), normalized = canonicalV2(options.normalize(JSON.parse(options.bytes.toString('utf8'))));
  let previous: Buffer | undefined; try { previous = await readFile(filename); inside(directory, await realpath(filename)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous && hashV2(previous) === options.sha256) return { path: filename, sha256: options.sha256, repaired: false };
  if (previous && canonicalV2(options.normalize(JSON.parse(previous.toString('utf8')))) !== normalized) throw Error('Existing raw-input cache differs from the actual schema-validated input');
  const operationId = randomUUID(), temporary = path.join(directory, `.${options.kind}-${operationId}.raw.tmp`), displaced = path.join(directory, `.${options.kind}-${operationId}.before.tmp`);
  const handle = await open(temporary, 'wx'); try { await handle.writeFile(options.bytes); await handle.sync(); } finally { await handle.close(); }
  let historyRef: { path: string; sha256: string } | undefined, receiptPath: string | undefined, moved = false;
  const history: Record<string, unknown> = { version: 2, kind: 'raw-input-cache-repair', operationId, inputKind: options.kind, inputPath: filename, expectedRawHash: options.sha256, status: 'intent', createdAt: new Date().toISOString() };
  try {
    if (previous) {
      const beforeHash = hashV2(previous), archive = path.join(directory, 'raw-cache-history'); await mkdir(archive, { recursive: true }); inside(directory, await realpath(archive));
      const beforePath = path.join(archive, `${beforeHash}.json`);
      try { await writeFile(beforePath, previous, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (hashV2(await readFile(beforePath)) !== beforeHash) throw Error('Archived previous raw input bytes changed');
      historyRef = { path: beforePath, sha256: beforeHash }; history.before = historyRef; receiptPath = path.join(archive, `${options.kind}-${options.sha256}-${operationId}.json`); await writeJson(receiptPath, history);
      // Moving then exclusively linking avoids replacing a third party's newer path between a read and rename.
      await rename(filename, displaced); moved = true;
      if (hashV2(await readFile(displaced)) !== beforeHash) throw Error('Raw-input cache changed concurrently before replacement');
    }
    try { await link(temporary, filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Raw-input cache path changed concurrently; current bytes were preserved'); throw error; }
    if (hashV2(await readFile(filename)) !== options.sha256) throw Error('Installed original raw input bytes changed during readback');
    if (receiptPath) { history.status = 'confirmed'; history.confirmedAt = new Date().toISOString(); await writeJson(receiptPath, history); }
    if (moved) { await unlink(displaced); moved = false; }
    return { path: filename, sha256: options.sha256, repaired: !!previous, ...(historyRef ? { historyRef } : {}) };
  } catch (error) {
    if (moved) { try { await link(displaced, filename); await unlink(displaced); moved = false; } catch { /* Preserve both the displaced bytes and any independently created current path. */ } }
    if (receiptPath) { history.status = 'conflict'; history.error = safeErrorV2(error); if (moved) history.displacedPath = displaced; await writeJson(receiptPath, history); }
    throw error;
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

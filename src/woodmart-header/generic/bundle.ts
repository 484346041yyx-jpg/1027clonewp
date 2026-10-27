import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalHeaderJson, headerJsonHash, type HeaderOwner } from '../contract.js';
import { validateHeaderModulePlan, type HeaderModulePlan } from './contract.js';

const PROJECT_ROOT = 'D:/cloneWP';
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_FREE_BYTES = 512 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const identitySchema = z.object({
  moduleKey: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  owner: z.object({ ownerId: key, runId: key }).strict(),
  targetOrigin: z.string().url(),
  headerId: z.string().regex(/^header_[1-9]\d{0,17}$/),
}).strict();
const pendingSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  action: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  payload: z.unknown().refine(value => value !== undefined), beforeHash: hash, planHash: hash,
  createdAt: z.string().refine(value => Number.isFinite(Date.parse(value)), 'Invalid intent date'),
  publishedRevision:z.object({pageId:z.number().int().positive(),bodyHash:hash,snapshotHash:hash}).strict().optional(),
}).strict();
const stateSchema = z.object({
  version: z.literal(1), identity: identitySchema,
  confirmed: z.object({ hash, snapshot: z.unknown().refine(value => value !== undefined) }).strict().nullable(),
  pending: pendingSchema.nullable(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

export interface HeaderPendingIntent {
  operationId: string; action: string; payload: unknown; beforeHash: string; planHash: string; createdAt: string;
  publishedRevision?:import('./wordpress.js').HeaderPublishedRevision;
}
export interface HeaderBundleState {
  version: 1;
  identity: { moduleKey: string; owner: HeaderOwner; targetOrigin: string; headerId: string };
  confirmed: null | { hash: string; snapshot: unknown };
  pending: null | HeaderPendingIntent;
  revision: number;
}
export interface HeaderBundle {
  directory: string; plan: HeaderModulePlan; mediaIds: Record<string, number>; state: HeaderBundleState;
}
const stateBaselines = new WeakMap<HeaderBundle, string>();

function fail(code: string): never { throw new Error(`woodmart_header_bundle_${code}`); }
function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function contained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) fail('path_escape');
}
function safeJSON(input: unknown): string {
  const json = canonicalHeaderJson(input);
  const scan = (value: unknown): void => {
    if (typeof value === 'string' && (/https?:\/\/[^/\s]+@/i.test(value) || /[?&](?:token|nonce|password|secret|authorization)=/i.test(value))) fail('credential_data_forbidden');
    if (!value || typeof value !== 'object') return;
    for (const [name, child] of Object.entries(value)) {
      if (/(?:^|[_-])(?:password|cookie|authorization|secret|token|nonce)(?:$|[_-])/i.test(name)) fail('credential_data_forbidden');
      scan(child);
    }
  };
  scan(input); return json;
}
async function projectRoot(): Promise<string> {
  const root = path.resolve(PROJECT_ROOT), info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(root, await realpath(root))) fail('project_root_reparse');
  return root;
}
/** Every existing path segment must resolve to itself; no junction/symlink hops. */
async function checkedDirectory(input: string, createParents = false, allowMissingFinal = false): Promise<string> {
  const root = await projectRoot(), target = path.resolve(input); contained(root, target);
  const parts = path.relative(root, target).split(path.sep); let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part); const final = index === parts.length - 1;
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (final && allowMissingFinal) return target;
      if (!createParents || final) throw error;
      try { await mkdir(current); } catch (created) { if ((created as NodeJS.ErrnoException).code !== 'EEXIST') throw created; }
      info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(current, await realpath(current))) fail('reparse_or_non_directory');
  }
  return target;
}
async function ensureSpace(directory: string): Promise<void> {
  const space = await statfs(directory);
  if (space.bavail * space.bsize < MIN_FREE_BYTES) fail('insufficient_evidence_space');
}
async function checkedFile(directory: string, name: string): Promise<string> {
  if (path.basename(name) !== name || name.includes(':')) fail('file_path_invalid');
  const file = path.join(directory, name), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES || !samePath(file, await realpath(file))) fail('file_invalid');
  return file;
}
async function textFile(directory: string, name: string): Promise<string> {
  const file = await checkedFile(directory, name), handle = await open(file, 'r');
  try {
    const info = await handle.stat(); if (!info.isFile() || info.size > MAX_BYTES) fail('file_invalid');
    const bytes = await handle.readFile(); if (bytes.length > MAX_BYTES) fail('file_limit');
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}
async function jsonFile(directory: string, name: string): Promise<unknown> {
  const value: unknown = JSON.parse(await textFile(directory, name)); safeJSON(value); return value;
}
async function writeNew(file: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) fail('file_limit');
  const handle = await open(file, 'wx');
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}
async function atomicJSON(directory: string, name: string, value: unknown): Promise<void> {
  await checkedDirectory(directory); await ensureSpace(directory);
  const destination = await checkedFile(directory, name), temp = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  await writeNew(temp, safeJSON(value));
  await rename(temp, destination);
}
function mediaMap(input: unknown): Record<string, number> {
  safeJSON(input);
  return z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/), z.number().int().positive()).parse(input);
}
function validatedState(input: unknown): HeaderBundleState {
  safeJSON(input); return stateSchema.parse(input);
}
function assertIdentity(state: HeaderBundleState, plan: HeaderModulePlan, identity: unknown): void {
  const sealed = identitySchema.parse(identity);
  if (headerJsonHash(state.identity) !== headerJsonHash(sealed)
    || sealed.moduleKey !== plan.moduleKey || sealed.targetOrigin !== plan.targetOrigin
    || headerJsonHash(sealed.owner) !== headerJsonHash(plan.owner)) fail('identity_changed');
}

/** Create a completely new local bundle; no site access or legacy task adoption. */
export async function createHeaderBundle(directory: string, input: unknown, mediaIds: Record<string, number> = {}): Promise<HeaderBundle> {
  const plan = validateHeaderModulePlan(input), media = mediaMap(mediaIds); safeJSON(plan);
  const target = await checkedDirectory(directory, true, true), parent = path.dirname(target);
  try { await lstat(target); fail('already_exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await ensureSpace(parent);
  const staging = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`); await mkdir(staging);
  await checkedDirectory(staging);
  const headerId = `header_${BigInt(`0x${randomBytes(7).toString('hex')}`) + 1n}`;
  const identity: HeaderBundleState['identity'] = { moduleKey: plan.moduleKey, owner: { ...plan.owner }, targetOrigin: plan.targetOrigin, headerId };
  const initial: HeaderBundleState = { version: 1, identity, confirmed: null, pending: null, revision: 0 };
  const files: Record<string, string> = {
    'header.json': safeJSON({ version: 1, kind: 'clonewp-header-layout', moduleKey: plan.moduleKey, targetOrigin: plan.targetOrigin, owner: plan.owner, name: plan.name, layout: plan.layout, ...(plan.menuContent ? { menuContent: plan.menuContent } : {}), ...(plan.menuItemMedia ? { menuItemMedia: plan.menuItemMedia } : {}) }),
    'menus.json': safeJSON(plan.menus.map(({ dropdowns: _dropdowns, ...menu }) => menu)),
    'dropdowns.json': safeJSON(Object.fromEntries(plan.menus.filter(menu => menu.dropdowns).map(menu => [menu.key, menu.dropdowns]))),
    'header.css': plan.style.css, 'fonts.json': safeJSON(plan.style.fonts),
    'media.json': safeJSON(media), 'identity.json': safeJSON(identity), 'state.json': safeJSON(initial),
  };
  for (const [name, bytes] of Object.entries(files)) await writeNew(path.join(staging, name), bytes);
  // A pre-existing destination is never merged or reused, even if empty.
  try { await lstat(target); fail('already_exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await rename(staging, target);
  return loadHeaderBundle(target);
}

/** Read independently editable files, then reassemble and validate one plan. */
export async function loadHeaderBundle(directory: string): Promise<HeaderBundle> {
  const actual = await checkedDirectory(directory);
  const header = z.object({ version: z.literal(1), kind: z.literal('clonewp-header-layout'), moduleKey: z.string(), targetOrigin: z.string(), owner: z.unknown(), name: z.string(), layout: z.unknown(), menuContent: z.unknown().optional(), menuItemMedia: z.unknown().optional() }).strict().parse(await jsonFile(actual, 'header.json'));
  const menus = await jsonFile(actual, 'menus.json'), fonts = await jsonFile(actual, 'fonts.json'), css = await textFile(actual, 'header.css');
  let dropdowns: unknown = {};
  try { dropdowns = await jsonFile(actual, 'dropdowns.json'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!Array.isArray(menus) || !dropdowns || typeof dropdowns !== 'object' || Array.isArray(dropdowns) || Object.keys(dropdowns).some(key => !menus.some(menu => menu?.key === key))) fail('dropdowns_invalid');
  const configuredMenus = menus.map(menu => {
    if (!menu || typeof menu !== 'object') return menu;
    const values = (dropdowns as Record<string, unknown>)[menu.key];
    if (values === undefined) return menu;
    if (Object.hasOwn(menu, 'dropdowns')) fail('dropdowns_duplicate');
    return { ...menu, dropdowns: values };
  });
  const plan = validateHeaderModulePlan({ ...header, kind: 'clonewp-header-module', menus: configuredMenus, style: { css, fonts } });
  safeJSON(plan);
  const state = validatedState(await jsonFile(actual, 'state.json'));
  assertIdentity(state, plan, await jsonFile(actual, 'identity.json'));
  const bundle: HeaderBundle = { directory: actual, plan, mediaIds: mediaMap(await jsonFile(actual, 'media.json')), state };
  stateBaselines.set(bundle, headerJsonHash(state)); return bundle;
}

/** A busy lock is an explicit conflict. This function never steals stale locks. */
export async function withHeaderBundleLock<T>(directory: string, fn: (bundle: HeaderBundle) => Promise<T> | T): Promise<T> {
  const actual = await checkedDirectory(directory); await ensureSpace(actual);
  const file = path.join(actual, '.lock'), token = randomUUID(), content = safeJSON({ lockId: token, pid: process.pid, createdAt: new Date().toISOString() });
  try { await writeNew(file, content); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('locked'); throw error; }
  try { return await fn(await loadHeaderBundle(actual)); }
  finally {
    await checkedDirectory(actual);
    if ((await textFile(actual, '.lock')) !== content) fail('lock_changed');
    await unlink(file);
  }
}

/** Atomic state CAS; service mutations additionally hold withHeaderBundleLock. */
export async function saveHeaderBundleState(bundle: HeaderBundle, input: HeaderBundleState): Promise<void> {
  const state = validatedState(input), actual = await checkedDirectory(bundle.directory);
  assertIdentity(state, bundle.plan, await jsonFile(actual, 'identity.json'));
  const current = validatedState(await jsonFile(actual, 'state.json'));
  if (!stateBaselines.has(bundle) || stateBaselines.get(bundle) !== headerJsonHash(current)) fail('state_changed');
  if (state.revision < current.revision) fail('revision_regressed');
  await atomicJSON(actual, 'state.json', state);
  const confirmed = validatedState(await jsonFile(actual, 'state.json'));
  if (headerJsonHash(confirmed) !== headerJsonHash(state)) fail('state_readback_mismatch');
  bundle.state = confirmed; stateBaselines.set(bundle, headerJsonHash(confirmed));
}

/** Durable append-only intent. Unknown outcomes remain present for reconciliation. */
export async function persistHeaderIntent(bundle: HeaderBundle, input: HeaderPendingIntent): Promise<{ path: string; sha256: string }> {
  safeJSON(input); const pending = pendingSchema.parse(input), actual = await checkedDirectory(bundle.directory); await ensureSpace(actual);
  assertIdentity(bundle.state, bundle.plan, await jsonFile(actual, 'identity.json'));
  const bytes = safeJSON(pending), filename = path.join(actual, `intent-${pending.operationId}.json`);
  await writeNew(filename, bytes);
  return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') };
}

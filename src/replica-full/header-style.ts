import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, statfs } from 'node:fs/promises';
import { canonicalV2 } from '../replica-v2/journal.js';
import { validateHeaderModulePlan, modulePlanHash, type HeaderModulePlan } from '../woodmart-header/generic/contract.js';
import { compileBundleStyles } from '../woodmart-header/generic/service.js';
import type { HeaderBundle } from '../woodmart-header/generic/bundle.js';
import type { FullReplicaRemoteSnapshot } from './driver.js';
import type { FullReplicaManifest, FullReplicaFileRef, FullReplicaOperation, FullReplicaHeaderStyleRevision } from './types.js';
import { fullReplicaHash } from './contract.js';

const ROOT = 'D:/cloneWP';
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => digest(canonicalV2(value));
function fail(code: string): never { throw Error(`replica_full_header_style_${code}`); }
export type HeaderStyleRevision = FullReplicaHeaderStyleRevision;
export interface HeaderStyleIntent {
  version: 1; kind: 'clonewp-full-header-style-intent'; operationId: string; manifestHash: string;
  identity: HeaderBundle['state']['identity']; originalPlanHash: string; previous: FullReplicaFileRef | null;
  beforePlanHash: string; afterPlanHash: string; effectiveHeaderPlan: HeaderModulePlan;
  cssInput: FullReplicaFileRef; sourceInput: FullReplicaFileRef; beforeSnapshot: FullReplicaFileRef;
  before: HeaderStyleRevision;
}
interface HeaderStyleConfirmation {
  version: 1; kind: 'clonewp-full-header-style-confirmed'; intent: FullReplicaFileRef; afterSnapshot: FullReplicaFileRef;
  result: HeaderStyleRevision;
}
interface ActivePointer { version: 1; kind: 'clonewp-full-header-style-current'; manifestHash: string; confirmation: FullReplicaFileRef }
export interface PreparedHeaderStyle { plan: HeaderModulePlan; css: string; sourceInput: FullReplicaFileRef }
async function checked(input: string, allowMissing = false): Promise<string> {
  const root = await realpath(ROOT), target = path.resolve(input), relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('path_escape');
  let current = root; const parts = relative.split(path.sep);
  for (const [index, part] of parts.entries()) { current = path.join(current, part); let info; try { info = await lstat(current); } catch (error) { if (allowMissing && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return target; throw error; } if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) fail('reparse'); } return target;
}
async function bound(ref: FullReplicaFileRef, directory?: string): Promise<Buffer> {
  if (!ref || typeof ref.path !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) fail('reference');
  const filename = await checked(ref.path); if (directory) { const relative = path.relative(directory, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('proof_outside_run'); }
  const info = await lstat(filename); if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('file_limit'); const bytes = await readFile(filename); if (digest(bytes) !== ref.sha256) fail('proof_changed'); return bytes;
}
async function json<T>(ref: FullReplicaFileRef, directory?: string): Promise<T> { return JSON.parse((await bound(ref, directory)).toString('utf8')) as T; }
async function writeOnce(filename: string, bytes: string): Promise<FullReplicaFileRef> {
  await checked(filename, true); const free = await statfs(path.dirname(filename)); if (free.bavail * free.bsize < 512 * 1024 * 1024) fail('evidence_space');
  try { const handle = await open(filename, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await readFile(await checked(filename), 'utf8')) !== bytes) throw error; }
  return { path: filename, sha256: digest(bytes) };
}
async function writeJSON(filename: string, value: unknown): Promise<FullReplicaFileRef> { return writeOnce(filename, JSON.stringify(value)); }
async function directory(runDirectory: string): Promise<string> { const target = path.join(await checked(runDirectory), 'header-amendments'); try { await mkdir(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } return checked(target); }
async function active(runDirectory: string): Promise<{ pointer: ActivePointer | null; bytes: string | null }> {
  const filename = path.join(runDirectory, 'header-style-current.json');
  try { const bytes = await readFile(await checked(filename), 'utf8'); return { pointer: JSON.parse(bytes) as ActivePointer, bytes }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pointer: null, bytes: null }; throw error; }
}
function onlyCSS(manifest: FullReplicaManifest, planInput: HeaderModulePlan): HeaderModulePlan {
  const plan = validateHeaderModulePlan(planInput), original = manifest.header!.plan;
  if (modulePlanHash({ ...plan, style: { ...plan.style, css: original.style.css } }) !== modulePlanHash(original)) fail('outside_css_changed'); return plan;
}
function unchangedResponsibilities(before: HeaderStyleRevision, after: HeaderStyleRevision): void {
  const { styleHash: _a, ...headerA } = before.header, { styleHash: _b, ...headerB } = after.header;
  const { styleHash: _c, ...boundA } = before.bound, { styleHash: _d, ...boundB } = after.bound;
  if (hash(headerA) !== hash(headerB) || hash(boundA) !== hash(boundB) || after.header.styleHash !== after.bound.styleHash) fail('responsibility_changed');
}
export function assertHeaderStyleRemoteBoundary(before: FullReplicaRemoteSnapshot, after: FullReplicaRemoteSnapshot, css: string): void {
  const a = before.header.snapshot.module, b = after.header.snapshot.module;
  if (!a || !b || !a.style || !b.style || before.header.snapshot.globalHash !== after.header.snapshot.globalHash || hash(before.page) !== hash(after.page) || hash(a.identity) !== hash(b.identity) || a.name !== b.name || hash(a.header) !== hash(b.header) || hash(a.menus) !== hash(b.menus) || hash(a.pages) !== hash(b.pages) || a.style.id !== b.style.id || b.style.css !== css) fail('remote_boundary_changed');
}
function revisionFromSnapshot(snapshot: FullReplicaRemoteSnapshot, result: HeaderStyleRevision): void {
  const module = snapshot.header.snapshot.module, page = snapshot.page;
  if (!module?.style || !page || page.status !== 'draft' || page.pageId !== result.bound.pageId || page.runId !== result.bound.runId || page.headerId !== result.bound.headerId || page.bodyHash !== result.bound.bodyHash || hash(module.header) !== result.header.headerHash || hash(module.menus) !== result.header.menuHash || hash(module.style) !== result.header.styleHash || result.header.styleBlock.id !== module.style.id || result.header.headerId !== module.identity.headerId || result.bound.styleHash !== result.header.styleHash) fail('confirmation_snapshot');
}
async function verifyConfirmation(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle, reference: FullReplicaFileRef, seen = new Set<string>()): Promise<{ plan: HeaderModulePlan; reference: FullReplicaFileRef }> {
  const proofDirectory = path.join(runDirectory, 'header-amendments');
  if (seen.size >= 1000 || seen.has(reference.sha256)) fail('proof_chain'); seen.add(reference.sha256);
  const confirmed = await json<HeaderStyleConfirmation>(reference, proofDirectory);
  if (confirmed.version !== 1 || confirmed.kind !== 'clonewp-full-header-style-confirmed') fail('confirmation_shape');
  const intent = await json<HeaderStyleIntent>(confirmed.intent, proofDirectory), originalHash = modulePlanHash(manifest.header!.plan), plan = onlyCSS(manifest, intent.effectiveHeaderPlan);
  if (intent.version !== 1 || intent.kind !== 'clonewp-full-header-style-intent' || intent.manifestHash !== fullReplicaHash(manifest) || hash(intent.identity) !== hash(local.state.identity) || intent.originalPlanHash !== originalHash || intent.afterPlanHash !== modulePlanHash(plan)) fail('intent_identity');
  const prior = intent.previous ? await verifyConfirmation(manifest, runDirectory, local, intent.previous, seen) : { plan: manifest.header!.plan };
  if (intent.beforePlanHash !== modulePlanHash(prior.plan) || (await bound(intent.cssInput, proofDirectory)).toString('utf8') !== plan.style.css) fail('plan_chain');
  const before = await json<FullReplicaRemoteSnapshot>(intent.beforeSnapshot, proofDirectory), after = await json<FullReplicaRemoteSnapshot>(confirmed.afterSnapshot, proofDirectory);
  unchangedResponsibilities(intent.before, confirmed.result); revisionFromSnapshot(before, intent.before); revisionFromSnapshot(after, confirmed.result); assertHeaderStyleRemoteBoundary(before, after, compileBundleStyles({ ...local, plan }));
  return { plan, reference };
}
/** Only this hash-bound chain can authorize a changed local header.css. */
export async function assertEffectiveHeaderPlan(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle): Promise<void> {
  const current = await active(runDirectory); let expected = manifest.header!.plan;
  if (current.pointer) { if (current.pointer.version !== 1 || current.pointer.kind !== 'clonewp-full-header-style-current' || current.pointer.manifestHash !== fullReplicaHash(manifest)) fail('active_identity'); expected = (await verifyConfirmation(manifest, runDirectory, local, current.pointer.confirmation)).plan; }
  if (modulePlanHash(local.plan) !== modulePlanHash(expected)) fail('unproven_plan_change');
}
export async function prepareHeaderStyle(manifest: FullReplicaManifest, local: HeaderBundle, sourceInput: FullReplicaFileRef): Promise<PreparedHeaderStyle> {
  const css = (await bound(sourceInput)).toString('utf8'), plan = onlyCSS(manifest, { ...local.plan, style: { ...local.plan.style, css } }); compileBundleStyles({ ...local, plan }); return { plan, css, sourceInput };
}
export async function beginHeaderStyle(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle, prepared: PreparedHeaderStyle, before: FullReplicaRemoteSnapshot, revision: HeaderStyleRevision, operation: FullReplicaOperation): Promise<{ intent: HeaderStyleIntent; ref: FullReplicaFileRef }> {
  await assertEffectiveHeaderPlan(manifest, runDirectory, local); const base = await directory(runDirectory), current = await active(runDirectory);
  const cssInput = await writeOnce(path.join(base, `${operation.operationId}-input.css`), prepared.css), beforeSnapshot = await writeJSON(path.join(base, `${operation.operationId}-before.json`), before);
  const intent: HeaderStyleIntent = { version: 1, kind: 'clonewp-full-header-style-intent', operationId: operation.operationId, manifestHash: fullReplicaHash(manifest), identity: local.state.identity, originalPlanHash: modulePlanHash(manifest.header!.plan), previous: current.pointer?.confirmation ?? null, beforePlanHash: modulePlanHash(local.plan), afterPlanHash: modulePlanHash(prepared.plan), effectiveHeaderPlan: prepared.plan, cssInput, sourceInput: prepared.sourceInput, beforeSnapshot, before: revision };
  return { intent, ref: await writeJSON(path.join(base, `${operation.operationId}-intent.json`), intent) };
}
export async function replaceHeaderCSS(local: HeaderBundle, expected: string, next: string): Promise<void> {
  const filename = await checked(path.join(local.directory, 'header.css')); if ((await readFile(filename, 'utf8')) !== expected) fail('local_css_changed');
  const temporary = `${filename}.${createHash('sha256').update(next).digest('hex')}.tmp`; await writeOnce(temporary, next); await rename(temporary, filename);
}
export async function confirmHeaderStyle(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle, intent: HeaderStyleIntent, reference: FullReplicaFileRef, after: FullReplicaRemoteSnapshot, result: HeaderStyleRevision): Promise<void> {
  const base = await directory(runDirectory), current = await active(runDirectory);
  if (hash(current.pointer?.confirmation ?? null) !== hash(intent.previous)) fail('active_changed');
  const before = await json<FullReplicaRemoteSnapshot>(intent.beforeSnapshot, base); unchangedResponsibilities(intent.before, result); assertHeaderStyleRemoteBoundary(before, after, compileBundleStyles({ ...local, plan: intent.effectiveHeaderPlan })); revisionFromSnapshot(after, result);
  const afterSnapshot = await writeJSON(path.join(base, `${intent.operationId}-after.json`), after), confirmation: HeaderStyleConfirmation = { version: 1, kind: 'clonewp-full-header-style-confirmed', intent: reference, afterSnapshot, result }, confirmed = await writeJSON(path.join(base, `${intent.operationId}-confirmed.json`), confirmation);
  await verifyConfirmation(manifest, runDirectory, local, confirmed);
  const pointer: ActivePointer = { version: 1, kind: 'clonewp-full-header-style-current', manifestHash: fullReplicaHash(manifest), confirmation: confirmed }, filename = path.join(runDirectory, 'header-style-current.json');
  if (current.bytes === null) await writeJSON(filename, pointer);
  else { if ((await readFile(await checked(filename), 'utf8')) !== current.bytes) fail('active_changed'); const temporary = `${filename}.${intent.operationId}.tmp`; await writeJSON(temporary, pointer); await rename(temporary, filename); }
}
export async function readPendingHeaderStyle(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle, operation: FullReplicaOperation): Promise<{ intent: HeaderStyleIntent; ref: FullReplicaFileRef }> {
  const base = path.join(runDirectory, 'header-amendments'), filename = await checked(path.join(base, `${operation.operationId}-intent.json`)), bytes = await readFile(filename), ref = { path: filename, sha256: digest(bytes) }, intent = await json<HeaderStyleIntent>(ref, base);
  if (intent.operationId !== operation.operationId || intent.manifestHash !== fullReplicaHash(manifest) || hash(intent.identity) !== hash(local.state.identity) || modulePlanHash(onlyCSS(manifest, intent.effectiveHeaderPlan)) !== intent.afterPlanHash || modulePlanHash(local.plan) !== intent.afterPlanHash || (await bound(intent.cssInput, base)).toString('utf8') !== local.plan.style.css || intent.before.bound.runId !== manifest.runId || intent.before.header.headerId !== local.state.identity.headerId || intent.before.bound.headerId !== local.state.identity.headerId) fail('pending_identity');
  const current = await active(runDirectory); if (hash(current.pointer?.confirmation ?? null) !== hash(intent.previous)) fail('pending_active_changed');
  if (intent.previous) { const prior = await verifyConfirmation(manifest, runDirectory, local, intent.previous); if (modulePlanHash(prior.plan) !== intent.beforePlanHash) fail('pending_base_changed'); }
  else if (intent.beforePlanHash !== modulePlanHash(manifest.header!.plan)) fail('pending_base_changed');
  return { intent, ref };
}

export async function confirmedHeaderStyleResult(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle, operationId: string): Promise<HeaderStyleRevision | null> {
  const current = await active(runDirectory); if (!current.pointer) return null;
  const confirmed = await json<HeaderStyleConfirmation>(current.pointer.confirmation, path.join(runDirectory, 'header-amendments')), intent = await json<HeaderStyleIntent>(confirmed.intent, path.join(runDirectory, 'header-amendments'));
  if (intent.operationId !== operationId) return null; await assertEffectiveHeaderPlan(manifest, runDirectory, local); return confirmed.result;
}

export async function restoreHeaderStyleBefore(manifest: FullReplicaManifest, runDirectory: string, local: HeaderBundle, intent: HeaderStyleIntent, current: FullReplicaRemoteSnapshot): Promise<void> {
  const before = await json<FullReplicaRemoteSnapshot>(intent.beforeSnapshot, path.join(runDirectory, 'header-amendments'));
  if (current.hash !== before.hash || local.state.pending || modulePlanHash(local.plan) !== intent.afterPlanHash) fail('before_not_confirmed');
  const pointer = await active(runDirectory); if (hash(pointer.pointer?.confirmation ?? null) !== hash(intent.previous)) fail('before_active_changed');
  const prior = intent.previous ? (await verifyConfirmation(manifest, runDirectory, local, intent.previous)).plan : manifest.header!.plan;
  if (modulePlanHash(prior) !== intent.beforePlanHash) fail('before_plan_changed');
  await writeJSON(path.join(runDirectory, 'header-amendments', `${intent.operationId}-before-confirmed.json`), { version: 1, kind: 'clonewp-full-header-style-before', manifestHash: intent.manifestHash, operationId: intent.operationId, beforeHash: current.hash, beforePlanHash: intent.beforePlanHash });
  await replaceHeaderCSS(local, intent.effectiveHeaderPlan.style.css, prior.style.css);
}

import path from 'node:path';
import { readFile, statfs, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { writeJson } from '../core/files.js';
import { redactor } from '../core/config.js';
import type { DraftSnapshot, ElementorElement } from '../wordpress/types.js';
import type { WordPressClient } from '../wordpress/client.js';
import type { GeneratedHtmlProof } from './types.js';
import { assertSourceFactsExtensionV2 } from './source.js';

export const canonicalV2 = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonicalV2(item))) : Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonicalV2(item))])) : value) ?? 'null';
export const hashV2 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const documentHashV2 = (elements: ElementorElement[], settings: Record<string, unknown>): string => hashV2(canonicalV2({ elements, settings }));
export const isHashV2 = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
export const safeErrorV2 = (error: unknown): string => redactor()(error);
export interface DocumentRefV2 { version: 2; kind: 'document-ref'; documentHash: string; path: string; sha256: string }
function assertStoredSnapshotV2(value: unknown): asserts value is DraftSnapshot {
  const snapshot = value as DraftSnapshot;
  if (!snapshot || snapshot.status !== 'draft' || !Number.isInteger(snapshot.pageId) || snapshot.pageId < 1 || typeof snapshot.runId !== 'string' || !/^[A-Za-z\d_-]{4,100}$/.test(snapshot.runId) || !Array.isArray(snapshot.elements) || !snapshot.settings || typeof snapshot.settings !== 'object' || !isHashV2(snapshot.hash) || documentHashV2(snapshot.elements, snapshot.settings) !== snapshot.hash) throw Error('Stored document snapshot identity or whole-document hash changed');
}
function assertRunPathV2(runDir: string, filename: string): void { const relative = path.relative(path.resolve(runDir), path.resolve(filename)); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Document evidence escaped its owned run'); }
/** One raw document per content hash; operation files contain only protected references. */
export async function writeSnapshotRefV2(runDir: string, indexPath: string, snapshot: DraftSnapshot): Promise<DocumentRefV2> {
  assertStoredSnapshotV2(snapshot); assertRunPathV2(runDir, indexPath);
  const filename = path.join(runDir, 'documents', `${snapshot.hash}.json`);
  try { const existing = JSON.parse(await readFile(filename, 'utf8')); assertStoredSnapshotV2(existing); if (canonicalV2(existing) !== canonicalV2(snapshot)) throw Error('Document store hash collision or owned identity changed'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeJson(filename, snapshot); }
  const ref: DocumentRefV2 = { version: 2, kind: 'document-ref', documentHash: snapshot.hash, path: filename, sha256: hashV2(await readFile(filename)) }; await writeJson(indexPath, ref); return ref;
}
/** Historical raw snapshots remain readable without rewriting their original files. */
export async function readSnapshotRefV2(runDir: string, indexPath: string): Promise<DraftSnapshot> {
  const actualIndex = await realpath(indexPath); assertRunPathV2(runDir, actualIndex); const value = JSON.parse(await readFile(actualIndex, 'utf8'));
  if (value?.kind !== 'document-ref') { assertStoredSnapshotV2(value); return value; }
  const ref = value as DocumentRefV2; if (ref.version !== 2 || !isHashV2(ref.documentHash) || !isHashV2(ref.sha256) || path.resolve(ref.path) !== path.resolve(runDir, 'documents', `${ref.documentHash}.json`)) throw Error('Stored document reference changed');
  const filename = await realpath(ref.path); assertRunPathV2(runDir, filename); const bytes = await readFile(filename); if (hashV2(bytes) !== ref.sha256) throw Error('Stored raw document bytes changed'); const snapshot = JSON.parse(bytes.toString('utf8')); assertStoredSnapshotV2(snapshot); if (snapshot.hash !== ref.documentHash) throw Error('Stored whole-document hash differs from its reference'); return snapshot;
}
export type StageNameV2 = 'desktop' | 'responsive' | 'final';
export type StageStatusV2 = 'pending' | 'running' | 'passed' | 'failed' | 'interrupted' | 'stale';
export interface FirstFoldReuseRefV2 { path: string; sha256: string; inputHash: string; sourceDocumentHash: string }
export interface StageAttemptV2 { id: string; status: StageStatusV2 | 'awaiting-review'; dependencyHash?: string; startedAt?: string; finishedAt?: string; durationMs?: number; checkpoint?: string; documentHash?: string; evidence?: string[]; evidenceRefs?: Array<{ path: string; sha256: string }>; firstFoldReuse?: FirstFoldReuseRefV2; error?: string; historicalSummary?: true }
export interface StageRecordV2 { status: StageStatusV2; dependencyHash?: string; startedAt?: string; finishedAt?: string; durationMs?: number; accumulatedDurationMs?: number; timingIncomplete?: boolean; attempts?: StageAttemptV2[]; documentHash?: string; evidence?: string[]; evidenceRefs?: Array<{ path: string; sha256: string }>; firstFoldReuse?: FirstFoldReuseRefV2; error?: string }
export function beginStageAttemptV2(previous: StageRecordV2, dependencyHash: string, startedAt = new Date().toISOString()): { record: StageRecordV2; attemptId: string } {
  const attempts = structuredClone(previous.attempts ?? []);
  if (!attempts.length && previous.startedAt) attempts.push({ id: randomUUID(), status: previous.status === 'running' ? 'interrupted' : previous.status, dependencyHash: previous.dependencyHash, startedAt: previous.startedAt, finishedAt: previous.finishedAt, durationMs: previous.durationMs, documentHash: previous.documentHash, evidence: previous.evidence, error: previous.error, historicalSummary: true });
  for (const attempt of attempts) if (attempt.status === 'running' && !attempt.finishedAt) { attempt.status = 'interrupted'; attempt.error ??= 'Previous process ended without a measured finish; elapsed duration is unavailable.'; }
  const attemptId = randomUUID(); attempts.push({ id: attemptId, status: 'running', dependencyHash, startedAt });
  return { attemptId, record: { ...previous, status: 'running', dependencyHash, startedAt, finishedAt: undefined, documentHash: undefined, evidence: undefined, evidenceRefs: undefined, firstFoldReuse: undefined, error: undefined, attempts, accumulatedDurationMs: attempts.reduce((total, attempt) => total + (attempt.durationMs ?? 0), 0), timingIncomplete: attempts.some(attempt => attempt.status !== 'running' && attempt.durationMs === undefined) } };
}
export function finishStageAttemptV2(record: StageRecordV2, attemptId: string, outcome: StageAttemptV2['status'], durationMs: number, checkpoint?: string, finishedAt = new Date().toISOString()): void {
  const attempt = record.attempts?.find(attempt => attempt.id === attemptId); if (!attempt || attempt.finishedAt) throw Error('Stage attempt is missing or already finalized');
  if (!Number.isFinite(durationMs) || durationMs < 0) throw Error('Stage attempt duration must be measured and finite');
  Object.assign(attempt, { status: outcome, durationMs: Math.round(durationMs), finishedAt, checkpoint, documentHash: record.documentHash, evidence: record.evidence ? [...record.evidence] : undefined, evidenceRefs: record.evidenceRefs ? structuredClone(record.evidenceRefs) : undefined, firstFoldReuse: record.firstFoldReuse ? structuredClone(record.firstFoldReuse) : undefined, error: record.error });
  record.accumulatedDurationMs = record.attempts!.reduce((total, value) => total + (value.durationMs ?? 0), 0); record.durationMs = record.accumulatedDurationMs; record.finishedAt = finishedAt; record.timingIncomplete = record.attempts!.some(attempt => attempt.durationMs === undefined);
}
export interface MutationIntentV2 { version: 2; id: string; kind: 'document-save' | 'editor-test' | 'restore'; checkpoint: string; pageId: number; runId: string; beforeHash: string; expectedAfterHash: string; affectedBlockKeys: string[]; status: 'intent' | 'confirmed' | 'write-unknown' | 'retryable' | 'conflict' | 'restore-pending'; createdAt: string; observedHash?: string; error?: string }
export interface RuntimeJournalV2 {
  version: 2; workflow: 'block-replication'; taskId: string; runId: string; runDir: string; targetUrl: string; sourceUrl: string;
  sourceFactsHash: string; componentPlanHash: string; assetsManifestHash: string; programHash: string; desktopDependencyHash?: string; environmentHash?: string;
  pageId?: number; editUrl?: string; previewUrl?: string; documentHash?: string; ownedBlockKeys: string[]; ownedRootIds: string[];
  status: 'running' | 'awaiting-review' | 'stage-passed' | 'completed' | 'failed' | 'interrupted' | 'write-unknown' | 'restore-pending';
  stage: StageNameV2; checkpoint?: string; stages: Record<StageNameV2, StageRecordV2>; mutations: MutationIntentV2[];
  capabilityProbe?: { kind?: 'product' | 'mixed'; status: StageStatusV2; dependencyHash: string; baselineHash: string; probeHash?: string; evidence?: string; error?: string };
  createdAt: string; updatedAt: string; completed: boolean; error?: string; metrics: Record<string, number>;
}
export async function ensureDiskSpaceV2(root: string, minimum = 512 * 1024 * 1024, inspect = statfs): Promise<number> {
  const volume = await inspect(root); const available = Number(volume.bavail) * Number(volume.bsize);
  if (!Number.isFinite(available) || available < minimum) throw Error(`Replica v2 requires at least ${minimum} free bytes before target operations`);
  return available;
}
export async function readJournalV2(runDir: string): Promise<RuntimeJournalV2> { return JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8')); }
export async function saveJournalV2(journal: RuntimeJournalV2): Promise<void> { journal.updatedAt = new Date().toISOString(); await writeJson(path.join(journal.runDir, 'journal.json'), journal); }
export function newMutationIntentV2(options: Omit<MutationIntentV2, 'version' | 'id' | 'status' | 'createdAt'>): MutationIntentV2 {
  if (!isHashV2(options.beforeHash) || !isHashV2(options.expectedAfterHash) || !Number.isSafeInteger(options.pageId) || options.pageId < 1) throw Error('Mutation intent requires exact document hashes and owned page identity');
  return { ...options, version: 2, id: randomUUID(), status: options.kind === 'editor-test' ? 'restore-pending' : 'intent', createdAt: new Date().toISOString() };
}
export function reconcileMutationV2(intent: MutationIntentV2, actual: DraftSnapshot): 'confirmed' | 'retryable' | 'conflict' {
  if (actual.pageId !== intent.pageId || actual.runId !== intent.runId || actual.status !== 'draft' || documentHashV2(actual.elements, actual.settings) !== actual.hash) throw Error('Mutation reconciliation requires a valid owned actual snapshot');
  intent.observedHash = actual.hash;
  intent.status = actual.hash === intent.expectedAfterHash ? 'confirmed' : actual.hash === intent.beforeHash ? 'retryable' : 'conflict';
  return intent.status;
}
/** Read-only calls have two retries; writes must be reconciled from actual state. */
export async function retryReadV2<T>(operation: () => Promise<T>, retryable: (error: unknown) => boolean = error => /network|timeout|timed out|invalid.*(?:json|response)|ECONN|EAI_AGAIN/i.test(String(error))): Promise<T> {
  for (let attempt = 0; ; attempt++) { try { return await operation(); } catch (error) { if (attempt >= 2 || !retryable(error)) throw error; } }
}
export interface ImmutableInputExtensionProofV2 { readonly previousSourceFactsHash: string; readonly sourceFactsHash: string; readonly previousAssetsManifestHash: string; readonly assetsManifestHash: string }
const verifiedInputExtensionsV2 = new WeakSet<object>();
/** A revision may append independently verified captures/assets, never replace accepted source facts or an existing asset record. */
export function proveImmutableInputExtensionV2(options: ImmutableInputExtensionProofV2 & { previousSourceFactsBytes: Buffer; sourceFactsBytes: Buffer; previousAssetsManifestBytes: Buffer; assetsManifestBytes: Buffer }): ImmutableInputExtensionProofV2 {
  for (const [bytes, expected] of [[options.previousSourceFactsBytes, options.previousSourceFactsHash], [options.sourceFactsBytes, options.sourceFactsHash], [options.previousAssetsManifestBytes, options.previousAssetsManifestHash], [options.assetsManifestBytes, options.assetsManifestHash]] as const) if (!isHashV2(expected) || hashV2(bytes) !== expected) throw Error('Resume immutable input evidence bytes changed');
  assertSourceFactsExtensionV2(JSON.parse(options.previousSourceFactsBytes.toString('utf8')), JSON.parse(options.sourceFactsBytes.toString('utf8')));
  const manifests = [options.previousAssetsManifestBytes, options.assetsManifestBytes].map(bytes => JSON.parse(bytes.toString('utf8')) as { assets: Array<{ key: string; sha256: string }> });
  for (const manifest of manifests) if (!Array.isArray(manifest.assets) || new Set(manifest.assets.map(asset => asset.key)).size !== manifest.assets.length || manifest.assets.some(asset => !asset.key || !isHashV2(asset.sha256))) throw Error('Resume asset manifest identity is invalid');
  for (const asset of manifests[0].assets) if (canonicalV2(asset) !== canonicalV2(manifests[1].assets.find(current => current.key === asset.key))) throw Error(`Resume changed an existing source asset record: ${asset.key}`);
  const proof = Object.freeze({ previousSourceFactsHash: options.previousSourceFactsHash, sourceFactsHash: options.sourceFactsHash, previousAssetsManifestHash: options.previousAssetsManifestHash, assetsManifestHash: options.assetsManifestHash }); verifiedInputExtensionsV2.add(proof); return proof;
}
export function assertResumeIdentityV2(journal: RuntimeJournalV2, identity: { taskId: string; sourceUrl: string; targetUrl: string; sourceFactsHash: string; assetsManifestHash: string; environmentHash?: string; desktopDependencyHash?: string; stage?: StageNameV2 }, actual?: DraftSnapshot, extension?: ImmutableInputExtensionProofV2): void {
  const sameDesktop = !!identity.desktopDependencyHash && identity.desktopDependencyHash === journal.desktopDependencyHash;
  const immutableExtension = extension && verifiedInputExtensionsV2.has(extension) && extension.previousSourceFactsHash === journal.sourceFactsHash && extension.previousAssetsManifestHash === journal.assetsManifestHash && extension.sourceFactsHash === identity.sourceFactsHash && extension.assetsManifestHash === identity.assetsManifestHash;
  if (journal.version !== 2 || journal.workflow !== 'block-replication' || journal.taskId !== identity.taskId || journal.sourceUrl !== identity.sourceUrl || journal.targetUrl !== identity.targetUrl || (journal.sourceFactsHash !== identity.sourceFactsHash || journal.assetsManifestHash !== identity.assetsManifestHash) && !(immutableExtension && (identity.stage === 'desktop' || sameDesktop)) || identity.environmentHash && journal.environmentHash !== identity.environmentHash) throw Error('Replica v2 resume identity, source evidence, asset bytes or native environment changed');
  if (actual && (actual.runId !== journal.runId || actual.pageId !== journal.pageId || actual.status !== 'draft' || documentHashV2(actual.elements, actual.settings) !== actual.hash)) throw Error('Resume does not identify the owned draft');
  if (actual && journal.documentHash && actual.hash !== journal.documentHash && !journal.mutations.some(intent => ['intent', 'write-unknown', 'restore-pending'].includes(intent.status))) throw Error('Owned draft changed since the last checkpoint; concurrent edits are preserved');
}
/** Replace only explicitly owned roots. Actual unrelated roots and their order survive. */
export function mergeOwnedBlocksV2(actual: ElementorElement[], desired: ElementorElement[], ownedIds: string[], changedIds: string[] = desired.map(node => node.id)): ElementorElement[] {
  if (new Set(ownedIds).size !== ownedIds.length || new Set(desired.map(node => node.id)).size !== desired.length || desired.some(node => !ownedIds.includes(node.id)) || changedIds.some(id => !ownedIds.includes(id))) throw Error('Block replacement contains a foreign or duplicate root');
  const desiredMap = new Map(desired.map(node => [node.id, node])), changed = new Set(changedIds), seen = new Set<string>();
  const merged = actual.flatMap(node => { if (!ownedIds.includes(node.id)) return [structuredClone(node)]; seen.add(node.id); if (!changed.has(node.id)) return [structuredClone(node)]; const replacement = desiredMap.get(node.id); return replacement ? [structuredClone(replacement)] : []; });
  for (const node of desired) if (!seen.has(node.id)) merged.push(structuredClone(node));
  return merged;
}
export function assertCompletableV2(journal: RuntimeJournalV2): void {
  if (Object.values(journal.stages).some(stage => stage.status !== 'passed') || journal.mutations.some(intent => ['intent', 'write-unknown', 'restore-pending', 'conflict'].includes(intent.status))) throw Error('Replica v2 has required unfinished evidence or an unresolved write/restore');
}
export function assertStageOrderV2(journal: RuntimeJournalV2, stage: StageNameV2): void {
  if (stage !== 'desktop' && journal.stages.desktop.status !== 'passed' || stage === 'final' && journal.stages.responsive.status !== 'passed') throw Error('Desktop and responsive stages must pass in order before later work starts');
}
/** Exact, durable restoration with read-back reconciliation if the response disappears. */
export async function restoreSnapshotV2(client: Pick<WordPressClient, 'restoreDraft' | 'snapshotDraft'>, baseline: DraftSnapshot, current: DraftSnapshot, journal: RuntimeJournalV2, checkpoint: string, blockKeys: string[], htmlProofs?: GeneratedHtmlProof[]): Promise<DraftSnapshot> {
  if (baseline.pageId !== current.pageId || baseline.runId !== current.runId || current.runId !== journal.runId || current.pageId !== journal.pageId || documentHashV2(baseline.elements, baseline.settings) !== baseline.hash || documentHashV2(current.elements, current.settings) !== current.hash) throw Error('Restoration requires current-run exact baseline and current snapshots');
  if (current.hash === baseline.hash) return current;
  await ensureDiskSpaceV2(path.resolve(journal.runDir, '..', '..'));
  const intent = newMutationIntentV2({ kind: 'restore', checkpoint, pageId: current.pageId, runId: current.runId, beforeHash: current.hash, expectedAfterHash: baseline.hash, affectedBlockKeys: blockKeys });
  await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${intent.id}-before.json`), current); await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${intent.id}-expected.json`), baseline); journal.mutations.push(intent); journal.status = 'restore-pending'; await saveJournalV2(journal);
  try {
    await client.restoreDraft(current.pageId, baseline, { expectedCurrent: current, htmlProofs }); const actual = await retryReadV2(() => client.snapshotDraft(current.pageId));
    if (reconcileMutationV2(intent, actual) !== 'confirmed') throw Error('Restoration read-back does not equal the exact saved baseline'); journal.documentHash = actual.hash; await saveJournalV2(journal); return actual;
  } catch (error) {
    intent.status = 'restore-pending'; intent.error = safeErrorV2(error); await saveJournalV2(journal);
    try { const actual = await retryReadV2(() => client.snapshotDraft(current.pageId)); const result = reconcileMutationV2(intent, actual); if (result === 'confirmed') { journal.documentHash = actual.hash; await saveJournalV2(journal); return actual; } if (result === 'retryable') intent.status = 'restore-pending'; await saveJournalV2(journal); } catch { intent.status = 'restore-pending'; await saveJournalV2(journal); }
    throw error;
  }
}

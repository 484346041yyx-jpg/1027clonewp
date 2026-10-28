import { runResources } from '../workspace/operation-resources.js';
import path from 'node:path';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { acquireLock, writeJson } from '../core/files.js';
import { VerifiedEvidenceReader } from '../core/verified-evidence.js';
import { redactor } from '../core/config.js';
import { canonicalV2, documentHashV2, ensureDiskSpaceV2, hashV2 } from '../replica-v2/journal.js';
import { readNative44CurrentState, validateNative44CurrentCSSRevisionPointer, type Native44CurrentRef } from './current-state.js';
import { readNative44HistoricalReleaseEvidence } from './release-lock.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareManifest } from './compare.js';
import { applyNative44CurrentCSSCorrections, assertNative44CurrentCSSDelta, native44CurrentCSSCorrectionSchema, type Native44CurrentCSSCorrection } from './current-css-patch.js';
import { assertNative44RevisionSnapshot, native44SnapshotNodes } from './revision-snapshot.js';
import { emitNative44DeliverySummary } from './delivery-summary.js';
import { requireEditorCompletion } from '../editor-completion/store.js';
import type { Native44CSSModule } from './css-handoff.js';
import type { DraftSnapshot } from '../wordpress/types.js';
import type { OwnedReviewStatus } from '../wordpress/client.js';

const id = z.string().regex(/^[a-zA-Z\d][a-zA-Z\d_.-]{0,159}$/).refine(value => !value.includes('..'));
const digest = z.string().regex(/^[a-f\d]{64}$/);
const ref = z.object({ path: z.string().min(1).max(4096), sha256: digest }).strict();
export const Native44CurrentCSSRevisionRequestSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-current-css-revision-request'), taskId: id, runId: id, operationId: id,
  pageId: z.number().int().positive(), userInstruction: z.string().trim().min(1).max(3000), expectedBeforeHash: digest,
  pointer: ref, journal: ref, before: ref, css: ref, manifest: ref, releaseLock: ref,
  corrections: z.array(native44CurrentCSSCorrectionSchema).min(1).max(100),
}).strict();
export type Native44CurrentCSSRevisionRequest = z.infer<typeof Native44CurrentCSSRevisionRequestSchema>;
type Operation = { version: 1; kind: 'native44-current-css-operation'; status: 'prepared' | 'unknown' | 'retryable' | 'confirmed' | 'conflict'; attempts: number; updatedAt: string; observedHash?: string };
type Files = Record<'request' | 'before' | 'expected' | 'css' | 'manifest' | 'intent', Native44CurrentRef>;
type Bundle = { version: 1; kind: 'native44-current-css-bundle'; request: Native44CurrentCSSRevisionRequest; files: Files };
export interface Native44CurrentCSSRemote {
  probeOwnedReviewStatus(pageId: number, runId: string): Promise<OwnedReviewStatus>;
  readOwnedReviewCheckpoint(pageId: number, runId: string, widgetTypes: string[]): Promise<{ snapshot: DraftSnapshot; proof: unknown }>;
  saveOwnedCSSRevision(before: DraftSnapshot, expected: DraftSnapshot, modules: Native44CSSModule[], corrections: Native44CurrentCSSCorrection[]): Promise<DraftSnapshot>;
  close?(): Promise<void>;
}
export interface Native44CurrentCSSRevisionDependencies { remote(manifest: Native44CompareManifest): Promise<Native44CurrentCSSRemote> }
const fail = (code: string): never => { throw Error(`native44_current_css_${code}`); };
const now = () => new Date().toISOString();
function noSecrets(value: unknown) { const text = JSON.stringify(value); if (redactor()(text) !== text) fail('secret_in_artifact'); }
async function immutable(filename: string, value: unknown, raw = false): Promise<Native44CurrentRef> {
  noSecrets(value); const bytes = Buffer.from(raw ? value as string : JSON.stringify(value, null, 2) + '\n');
  try { await writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await readFile(filename)).equals(bytes)) fail('immutable_artifact_conflict'); }
  return { path: filename, sha256: hashV2(bytes) };
}
async function paths(root: string, runId: string, operationId: string) {
  id.parse(runId); id.parse(operationId); const runDir = path.join(root, 'runs', runId);
  if (await realpath(runDir) !== runDir) fail('run_alias');
  return { runDir, pointerFile: path.join(runDir, 'current-user-amendment.json'), folder: path.join(runDir, 'amendments', operationId) };
}
const matches = (root: string, actual: Native44CurrentRef | undefined, expected: Native44CurrentRef) => actual && path.resolve(root, actual.path) === path.resolve(root, expected.path) && actual.sha256 === expected.sha256;
async function validate(root: string, request: Native44CurrentCSSRevisionRequest, reader: VerifiedEvidenceReader, committed = false) {
  const location = await paths(root, request.runId, request.operationId);
  if (path.resolve(root, request.pointer.path) !== location.pointerFile || path.resolve(root, request.journal.path) !== path.join(location.runDir, 'journal.json')) fail('reference_owner_conflict');
  const journal = await reader.json(request.journal, noSecrets), pointer = await reader.json(request.pointer, noSecrets), before = await reader.json(request.before, noSecrets) as DraftSnapshot;
  assertNative44RevisionSnapshot(before);
  if (pointer.version !== 1 || pointer.kind !== 'completed-explicit-user-draft-amendment' || pointer.pageId !== request.pageId || pointer.runId !== request.runId || pointer.taskId !== request.taskId || journal.pageId !== request.pageId || journal.runId !== request.runId || journal.taskId !== request.taskId || before.pageId !== request.pageId || before.runId !== request.runId || before.hash !== request.expectedBeforeHash || !matches(root, pointer.currentSnapshot, request.before) || !matches(root, pointer.currentCSS, request.css) || !matches(root, journal.releaseLock, request.releaseLock)) fail('legacy_baseline_conflict');
  const css = (await reader.read(request.css)).toString('utf8'); if (css !== before.settings.custom_css) fail('baseline_css_conflict');
  const manifest = await reader.json(request.manifest, noSecrets) as Native44CompareManifest;
  validateNative44CompareManifest(manifest, journal.selectionRulesHash);
  if (manifest.pageId !== request.pageId || manifest.runId !== request.runId || manifest.taskId !== request.taskId || canonicalV2(manifest.releaseLock) !== canonicalV2(request.releaseLock) || Object.entries(fingerprintNative44Snapshot(before)).some(([key, value]) => manifest[key as keyof Native44CompareManifest] !== value)) fail('manifest_baseline_conflict');
  const lock = await readNative44HistoricalReleaseEvidence(root, request.releaseLock, { taskId: request.taskId, programHash: journal.programHash });
  for (const item of [request.releaseLock, lock.program!, ...Object.values(lock.inputs!)]) await reader.read(item);
  // The v1 reader verifies the complete amendment chain. Enrol its evidence in
  // this command's fresh barrier without silently migrating its frozen plan.
  if (!committed) { const current = await readNative44CurrentState(root, location.runDir, { taskId: request.taskId, runId: request.runId, pageId: request.pageId }); if (!current || current.runId !== request.runId || current.documentHash !== before.hash) throw Error('native44_current_css_current_state_conflict'); if (!matches(root, current.currentManifest, request.manifest) && !matches(root, pointer.currentManifest, request.manifest) && (pointer.currentManifest || path.resolve(root, request.manifest.path) !== path.join(location.runDir, 'compare-manifest.json'))) fail('manifest_owner_conflict'); for (const item of current.evidence) await reader.read(item, 64 * 1024 * 1024); }
  for (const correction of request.corrections) for (const item of correction.evidence) await reader.read(item, 64 * 1024 * 1024);
  const modules = manifest.modules.map(({ key, className }) => ({ key, className }));
  const stylesheet = applyNative44CurrentCSSCorrections(before, modules, request.corrections), settings = { ...before.settings, custom_css: stylesheet }, expected = { ...structuredClone(before), settings, hash: documentHashV2(before.elements, settings) };
  assertNative44CurrentCSSDelta(before, expected, modules, request.corrections);
  return { ...location, pointer, journal, before, expected, modules, stylesheet, manifest: { ...manifest, ...fingerprintNative44Snapshot(expected), cssRules: [] } as Native44CompareManifest };
}

export async function prepareNative44CurrentCSSRevision(rootInput: string, input: unknown) {
  const root = await realpath(rootInput), request = Native44CurrentCSSRevisionRequestSchema.parse(input); noSecrets(request); const reader = new VerifiedEvidenceReader(root), unlock = await acquireLock(root, await runResources(root, request.runId));
  try {
    await ensureDiskSpaceV2(root); const data = await validate(root, request, reader); await reader.revalidateAll();
    await mkdir(path.dirname(data.folder), { recursive: true }); await mkdir(data.folder);
    await requireEditorCompletion(data.runDir, request.taskId, request.runId, data.expected.hash);
    const files = {} as Files;
    for (const [key, filename, value, raw] of [['request', 'request.json', request, false], ['before', 'before.json', data.before, false], ['expected', 'expected.json', data.expected, false], ['css', 'page-custom.css', data.stylesheet, true], ['manifest', 'compare-manifest.json', data.manifest, false]] as const) files[key] = await immutable(path.join(data.folder, filename), value, raw);
    files.intent = await immutable(path.join(data.folder, 'intent.json'), { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: request.pageId, runId: request.runId, beforeHash: data.before.hash, expectedHash: data.expected.hash, payloadSha256: data.expected.hash, requestSha256: files.request.sha256, cssSha256: files.css.sha256 });
    await immutable(path.join(data.folder, 'bundle.json'), { version: 1, kind: 'native44-current-css-bundle', request, files } satisfies Bundle);
    await writeJson(path.join(data.folder, 'operation-state.json'), { version: 1, kind: 'native44-current-css-operation', status: 'prepared', attempts: 0, updatedAt: now() } satisfies Operation);
    return { status: 'prepared', runId: request.runId, operationId: request.operationId, expectedHash: data.expected.hash, bundle: path.join(data.folder, 'bundle.json'), remoteWrites: 0, evidenceWork: reader.metrics };
  } finally { await unlock(); }
}

export async function applyNative44CurrentCSSRevision(rootInput: string, runId: string, operationId: string, deps: Native44CurrentCSSRevisionDependencies, mode: 'apply' | 'reconcile' = 'apply') {
  const root = await realpath(rootInput), reader = new VerifiedEvidenceReader(root), unlock = await acquireLock(root, await runResources(root, runId)); let remote: Native44CurrentCSSRemote | undefined;
  try {
    await ensureDiskSpaceV2(root); const location = await paths(root, runId, operationId), bundleBytes = await readFile(path.join(location.folder, 'bundle.json')), bundle = JSON.parse(bundleBytes.toString('utf8')) as Bundle;
    if (bundle.version !== 1 || bundle.kind !== 'native44-current-css-bundle') fail('bundle_invalid');
    const request = Native44CurrentCSSRevisionRequestSchema.parse(bundle.request); if (request.runId !== runId || request.operationId !== operationId) fail('bundle_identity_conflict');
    noSecrets(bundle);
    const expectedFiles: Array<[keyof Files, string]> = [['request', 'request.json'], ['before', 'before.json'], ['expected', 'expected.json'], ['css', 'page-custom.css'], ['manifest', 'compare-manifest.json'], ['intent', 'intent.json']];
    for (const [key, name] of expectedFiles) if (path.resolve(root, bundle.files[key]?.path ?? '') !== path.join(location.folder, name)) fail('bundle_owner_conflict');
    const pointerBytes = await readFile(location.pointerFile), currentPointer = JSON.parse(pointerBytes.toString('utf8'));
    const already = currentPointer.amendments?.some((step: any) => matches(root, step.intent, bundle.files.intent));
    if (already) {
      const storedRequest = await reader.json(bundle.files.request, noSecrets), expected = await reader.json(bundle.files.expected, noSecrets) as DraftSnapshot, intent = await reader.json(bundle.files.intent, noSecrets);
      assertNative44RevisionSnapshot(expected); const step = currentPointer.amendments.find((item: any) => matches(root, item.intent, bundle.files.intent));
      if (canonicalV2(storedRequest) !== canonicalV2(request) || expected.pageId !== request.pageId || expected.runId !== runId || intent.requestSha256 !== bundle.files.request.sha256 || intent.expectedHash !== expected.hash || step.afterHash !== expected.hash || currentPointer.taskId !== request.taskId || currentPointer.pageId !== request.pageId) fail('recorded_bundle_conflict');
      const current = await readNative44CurrentState(root, location.runDir); if (!current || current.runId !== runId) fail('current_state_conflict'); return { status: 'confirmed', remoteWrites: 0, current };
    }
    if (hashV2(pointerBytes) !== request.pointer.sha256) fail('parent_changed');
    const data = await validate(root, request, reader);
    const storedRequest = await reader.json(bundle.files.request, noSecrets), storedBefore = await reader.json(bundle.files.before, noSecrets), storedExpected = await reader.json(bundle.files.expected, noSecrets), storedManifest = await reader.json(bundle.files.manifest, noSecrets), intent = await reader.json(bundle.files.intent, noSecrets);
    if (canonicalV2(storedRequest) !== canonicalV2(request) || canonicalV2(storedBefore) !== canonicalV2(data.before) || canonicalV2(storedExpected) !== canonicalV2(data.expected) || canonicalV2(storedManifest) !== canonicalV2(data.manifest) || (await reader.read(bundle.files.css)).toString('utf8') !== data.stylesheet || canonicalV2(intent) !== canonicalV2({ version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: request.pageId, runId, beforeHash: data.before.hash, expectedHash: data.expected.hash, payloadSha256: data.expected.hash, requestSha256: bundle.files.request.sha256, cssSha256: bundle.files.css.sha256 })) fail('bundle_output_conflict');
    await reader.read({ path: path.join(location.folder, 'bundle.json'), sha256: hashV2(bundleBytes) });
    let operation = JSON.parse(await readFile(path.join(location.folder, 'operation-state.json'), 'utf8')) as Operation;
    if (operation.version !== 1 || operation.kind !== 'native44-current-css-operation' || !['prepared', 'unknown', 'retryable', 'confirmed', 'conflict'].includes(operation.status) || !Number.isInteger(operation.attempts) || operation.attempts < 0) fail('operation_invalid');
    if (operation.status === 'conflict') fail('operation_conflict');
    await reader.revalidateAll(); remote = await deps.remote(data.manifest);
    const status = await remote.probeOwnedReviewStatus(request.pageId, runId);
    if (status.pageId !== request.pageId || status.runId !== runId || !status.exists || status.postType !== 'page' || status.status !== 'draft' || !status.ownerMatches || !status.canEdit || !status.uniqueRunPage || !status.documentExists || !status.builtWithElementor) fail('remote_draft_ineligible');
    const types = [...new Set([...native44SnapshotNodes(data.before.elements).values()].map(({ node }) => node.elType === 'container' ? 'container' : node.widgetType!))], adapter = remote;
    const read = async () => { const { snapshot } = await adapter.readOwnedReviewCheckpoint(request.pageId, runId, types); assertNative44RevisionSnapshot(snapshot); if (snapshot.pageId !== request.pageId || snapshot.runId !== runId) fail('remote_identity_conflict'); return snapshot; };
    let observed = await read(), writes = 0;
    const state = async (status: Operation['status']) => { operation = { ...operation, status, updatedAt: now(), observedHash: observed.hash }; await writeJson(path.join(location.folder, 'operation-state.json'), operation); };
    if (observed.hash === data.before.hash && mode === 'apply' && ['prepared', 'retryable'].includes(operation.status)) {
      await reader.revalidateAll(); if (hashV2(await readFile(location.pointerFile)) !== request.pointer.sha256) fail('parent_changed');
      operation.attempts++; await state('unknown'); writes++;
      try { observed = await remote.saveOwnedCSSRevision(observed, data.expected, data.modules, request.corrections); assertNative44RevisionSnapshot(observed); }
      catch { try { observed = await read(); } catch { return { status: 'unknown', remoteWrites: writes, action: 'reconcile' }; } }
    }
    if (observed.hash === data.before.hash) { await state('retryable'); return { status: 'retryable', remoteWrites: writes, action: 'explicit-apply' }; }
    if (observed.pageId !== request.pageId || observed.runId !== runId || canonicalV2(observed) !== canonicalV2(data.expected)) { await state('conflict'); return { status: 'conflict', remoteWrites: writes, observedHash: observed.hash }; }
    if (hashV2(await readFile(location.pointerFile)) !== request.pointer.sha256) fail('parent_changed_after_save');
    const after = await immutable(path.join(location.folder, 'after.json'), observed), receiptPath = path.join(location.folder, 'receipt.json');
    let receiptValue; try { receiptValue = JSON.parse(await readFile(receiptPath, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    receiptValue ??= { version: 1, status: 'confirmed', pageId: request.pageId, runId, beforeHash: data.before.hash, afterHash: observed.hash, cssApplied: true, confirmedAt: now() };
    if (receiptValue.version !== 1 || receiptValue.status !== 'confirmed' || receiptValue.pageId !== request.pageId || receiptValue.runId !== runId || receiptValue.beforeHash !== data.before.hash || receiptValue.afterHash !== observed.hash || receiptValue.cssApplied !== true || !Number.isFinite(Date.parse(receiptValue.confirmedAt))) fail('receipt_conflict');
    const receipt = await immutable(receiptPath, receiptValue), pointer = { ...data.pointer, status: 'applied-pending-review', documentHash: observed.hash, cssApplied: true, requestedScope: request.userInstruction, recordedAt: now(), currentSnapshot: after, currentCSS: bundle.files.css, currentManifest: bundle.files.manifest, amendments: [...data.pointer.amendments, { intent: bundle.files.intent, receipt, beforeHash: data.before.hash, afterHash: observed.hash }] };
    for (const key of ['verification', 'visualReview', 'styleReview', 'reviewStatus', 'reviewedAt', 'completedAt', 'currentCaptureReview', 'remainingGaps']) delete pointer[key];
    await validateNative44CurrentCSSRevisionPointer(root, location.runDir, pointer);
    if (hashV2(await readFile(location.pointerFile)) !== request.pointer.sha256) fail('parent_changed_before_index');
    await writeJson(location.pointerFile, pointer);
    if (hashV2(await readFile(location.pointerFile)) !== hashV2(JSON.stringify(pointer, null, 2) + '\n')) fail('index_readback_conflict');
    const current = await readNative44CurrentState(root, location.runDir);
    if (!current || current.taskId !== request.taskId || current.runId !== runId || current.pageId !== request.pageId || current.documentHash !== observed.hash) fail('index_readback_conflict');
    await state('confirmed'); await requireEditorCompletion(location.runDir, request.taskId, runId, observed.hash); const delivery = await emitNative44DeliverySummary(root, runId, { lockHeld: true, expectedState: { taskId: request.taskId, runId, pageId: request.pageId, documentHash: observed.hash } });
    return { status: 'confirmed', remoteWrites: writes, current, delivery, evidenceWork: reader.metrics };
  } finally { try { await remote?.close?.(); } finally { await unlock(); } }
}

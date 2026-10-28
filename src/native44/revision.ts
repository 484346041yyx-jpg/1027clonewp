import { runResources } from '../workspace/operation-resources.js';
import path from 'node:path';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { acquireLock, writeJson } from '../core/files.js';
import { activeVerifiedEvidenceReader, withVerifiedEvidenceReader, VerifiedEvidenceReader } from '../core/verified-evidence.js';
import { emitNative44DeliverySummary } from './delivery-summary.js';
import { requireEditorCompletion } from '../editor-completion/store.js';
import { redactor } from '../core/config.js';
import { canonicalV2, ensureDiskSpaceV2, hashV2 } from '../replica-v2/journal.js';
import { compileNative44CSSModel, validateNative44CSSModel, type Native44CSSModel } from './css-model.js';
import { verifyNative44ImageBoxCaptionReveals } from './image-box-caption-proof.js';
import { assertNative44RevisionSnapshot, native44RevisionPatchSchema, native44SnapshotNodes, prepareNative44RevisionSnapshot } from './revision-snapshot.js';
import { buildNative44CurrentRevisionPointer, readNative44CurrentState, recordNative44CurrentRevisionReview, validateNative44CurrentRevisionPointer, type Native44CurrentRef, type Native44CurrentRevisionPointer } from './current-state.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareManifest } from './compare.js';
import { readNative44HistoricalReleaseEvidence } from './release-lock.js';
import { Native44AcceptanceObservationSchema, Native44AcceptancePolicySchema, Native44RequirementContractSchema, adviseNative44Convergence, assertNative44CapabilityProof, evaluateNative44Acceptance, validateNative44Requirements, verifyNative44SourceScopes } from './requirements.js';
import type { DraftSnapshot } from '../wordpress/types.js';
import type { OwnedReviewStatus } from '../wordpress/client.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { Native44SourceUnit } from './selection-types.js';
import { NATIVE44_PRODUCT_WIDGETS } from './catalog-check.js';

const identifier = z.string().regex(/^[a-zA-Z\d][a-zA-Z\d_.-]{0,99}$/).refine(value => !value.includes('..'));
const digest = z.string().regex(/^[a-f\d]{64}$/);
const refSchema = z.object({ path: z.string().min(1).max(4096), sha256: digest }).strict();
export const Native44RevisionRequestSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-revision-request'), taskId: identifier, runId: identifier,
  operationId: identifier, pageId: z.number().int().positive(), userInstruction: z.string().trim().min(1).max(3000),
  expectedBeforeHash: digest, before: refSchema, cssModel: refSchema, requirements: refSchema,
  acceptancePolicy: refSchema, sourceUnits: refSchema, manifest: refSchema,
  patches: z.array(native44RevisionPatchSchema).max(2500),
}).strict();
export type Native44RevisionRequest = z.infer<typeof Native44RevisionRequestSchema>;
type OperationState = { version: 1; kind: 'native44-revision-operation'; status: 'prepared' | 'unknown' | 'retryable' | 'confirmed' | 'conflict'; attempts: number; observedHash?: string; updatedAt: string };
interface Bundle {
  version: 1; kind: 'native44-revision-bundle'; request: Native44RevisionRequest;
  parentPointerHash: string | null; journalHash: string;
  files: Record<'request' | 'before' | 'expected' | 'cssModel' | 'requirements' | 'acceptancePolicy' | 'sourceUnits' | 'baselineManifest' | 'manifest' | 'css' | 'intent', Native44CurrentRef>;
}
export interface Native44RevisionRemote {
  probeOwnedReviewStatus(pageId: number, runId: string): Promise<OwnedReviewStatus>;
  readOwnedReviewCheckpoint(pageId: number, runId: string, types: string[]): Promise<{ snapshot: DraftSnapshot; proof: unknown }>;
  saveOwnedRevision(before: DraftSnapshot, expected: DraftSnapshot, model: Native44CSSModel): Promise<DraftSnapshot>;
  close?(): Promise<void>;
}
export interface Native44RevisionDependencies {
  /** Created only after the entire local bundle and historical inputs validate. */
  remote: (manifest: Native44CompareManifest) => Promise<Native44RevisionRemote>;
}
function fail(code: string): never { throw Error(`native44_revision_${code}`); }
const now = () => new Date().toISOString();
function inside(root: string, filename: string): void { const relative = path.relative(root, filename); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('path_escape'); }
function noSecrets(value: unknown): void { const text = JSON.stringify(value); if (redactor()(text) !== text) fail('secret_in_artifact'); }
async function checkedRoot(input: string) { return realpath(path.resolve(input)); }
async function readBound(root: string, ref: Native44CurrentRef, max = 32 * 1024 * 1024): Promise<Buffer> {
  const reader = activeVerifiedEvidenceReader(root); if (reader) return reader.read(ref, max);
  refSchema.parse(ref); if (/[?\r\n]|^[a-z]+:\/\//i.test(ref.path)) fail('reference_invalid');
  const filename = path.resolve(root, ref.path); inside(root, filename);
  const actual = await realpath(filename); if (actual !== filename) fail('reference_alias'); inside(root, actual);
  const info = await stat(actual); if (!info.isFile() || info.size > max) fail('artifact_too_large');
  const bytes = await readFile(actual); if (bytes.length > max || hashV2(bytes) !== ref.sha256) fail('artifact_hash_mismatch'); return bytes;
}
async function readJSON(root: string, ref: Native44CurrentRef) { const reader = activeVerifiedEvidenceReader(root); if (reader) return reader.json(ref, noSecrets); const bytes = await readBound(root, ref); let result: any; try { result = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { return fail('json_invalid'); } noSecrets(result); return result; }
async function historicalInputs(root: string, reference: Native44CurrentRef, expected: { taskId: string; programHash: string }) {
  const lock = await readNative44HistoricalReleaseEvidence(root, reference, expected);
  // The historical reader has its own verifier. Enrol its authoritative frozen
  // dependencies too, so the command's pre-write fresh barrier covers them.
  for (const item of [reference, lock.program!, ...Object.values(lock.inputs!)]) await readBound(root, { path: item.path, sha256: item.sha256 });
  return lock;
}
async function optionalBytes(filename: string) { try { return await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }
async function fileRef(filename: string): Promise<Native44CurrentRef> { return { path: filename, sha256: hashV2(await readFile(filename)) }; }
async function immutable(filename: string, value: unknown, raw = false): Promise<Native44CurrentRef> {
  noSecrets(value); const bytes = raw ? Buffer.from(value as string) : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  try { await writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await readFile(filename)).equals(bytes)) fail('immutable_artifact_conflict'); }
  return { path: filename, sha256: hashV2(bytes) };
}
async function location(root: string, runId: string, operationId?: string) {
  identifier.parse(runId); if (operationId !== undefined) identifier.parse(operationId);
  const runDir = path.join(root, 'runs', runId); if (await realpath(runDir) !== runDir) fail('run_alias');
  return { runDir, pointerFile: path.join(runDir, 'current-user-amendment.json'), folder: operationId ? path.join(runDir, 'amendments', operationId) : '' };
}
function counts(snapshot: DraftSnapshot) {
  const result = { containers: 0, widgets: 0, html: 0, productWidgets: 0 };
  for (const { node } of native44SnapshotNodes(snapshot.elements).values()) { if (node.elType === 'container') result.containers++; else result.widgets++; if (node.widgetType === 'html') result.html++; if ((NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(node.widgetType ?? '')) result.productWidgets++; }
  return result;
}
async function baseline(root: string, request: Native44RevisionRequest) {
  const paths = await location(root, request.runId, request.operationId), pointerBytes = await optionalBytes(paths.pointerFile);
  const journalRef = await fileRef(path.join(paths.runDir, 'journal.json')), journal = await readJSON(root, journalRef);
  if (journal.taskId !== request.taskId || journal.runId !== request.runId || journal.pageId !== request.pageId || journal.executionStrategy !== 'native44-css-handoff' || !['draft-saved', 'awaiting-comparison', 'delivered'].includes(journal.status) || !journal.mutations?.length || journal.mutations.some((item: any) => item.status !== 'confirmed') || !journal.mutations.some((item: any) => item.pageId === request.pageId && item.runId === request.runId && item.expectedAfterHash === journal.documentHash && item.observedHash === journal.documentHash)) fail('journal_identity_or_mutation_conflict');
  const current = await readNative44CurrentState(root, paths.runDir, { taskId: request.taskId, runId: request.runId, pageId: request.pageId });
  if (current && current.runId !== request.runId) fail('successor_requires_exact_run');
  const before = await readJSON(root, request.before) as DraftSnapshot; assertNative44RevisionSnapshot(before);
  if (before.pageId !== request.pageId || before.runId !== request.runId || before.hash !== request.expectedBeforeHash || before.hash !== (current?.documentHash ?? journal.documentHash)) fail('baseline_changed');
  const lock = await historicalInputs(root, journal.releaseLock, { taskId: request.taskId, programHash: journal.programHash });
  return { ...paths, journal, journalRef, before, lock, previous: pointerBytes ? JSON.parse(pointerBytes.toString('utf8')) : undefined, parentPointerHash: pointerBytes ? hashV2(pointerBytes) : null };
}
async function validateInputs(root: string, request: Native44RevisionRequest, journal: any, before: DraftSnapshot, lock: Awaited<ReturnType<typeof readNative44HistoricalReleaseEvidence>>) {
  const model = await readJSON(root, request.cssModel); validateNative44CSSModel(model);
  if (model.taskId !== request.taskId || model.runId !== request.runId || model.pageId !== request.pageId) fail('css_model_identity_conflict');
  const provisional = prepareNative44RevisionSnapshot(before, request.patches, '');
  await verifyNative44ImageBoxCaptionReveals({ root, model, elements: provisional.elements, program: lock.program!, sourceFacts: lock.inputs!.sourceFacts, componentPlan: lock.inputs!.componentPlan, read: reference => readBound(root, reference, 64 * 1024 * 1024) });
  const compiled = compileNative44CSSModel(model, { elements: provisional.elements }), expected = prepareNative44RevisionSnapshot(before, request.patches, compiled.css);
  // Every control change names its native owner in the same model. CSS cannot
  // secretly replace a registered control, and a correction cannot be unowned.
  for (const patch of request.patches) if (patch.kind === 'set-controls') for (const [controlId, value] of Object.entries(patch.controls)) if (!compiled.nativeBindings.some(binding => binding.native!.elementId === patch.elementId && binding.native!.controlId === controlId && canonicalV2(binding.native!.expectedValue) === canonicalV2(value))) fail('native_control_responsibility_missing');
  const manifest = await readJSON(root, request.manifest) as Native44CompareManifest;
  validateNative44CompareManifest(manifest, journal.selectionRulesHash);
  if (manifest.taskId !== request.taskId || manifest.runId !== request.runId || manifest.pageId !== request.pageId || canonicalV2(manifest.releaseLock) !== canonicalV2(journal.releaseLock) || Object.entries(fingerprintNative44Snapshot(before)).some(([key, value]) => manifest[key as keyof Native44CompareManifest] !== value)) fail('manifest_baseline_conflict');
  const contract = Native44RequirementContractSchema.parse(await readJSON(root, request.requirements)), policy = Native44AcceptancePolicySchema.parse(await readJSON(root, request.acceptancePolicy)), units = await readJSON(root, request.sourceUnits) as Native44SourceUnit[];
  if (contract.taskId !== request.taskId || !lock.inputs || path.resolve(root, contract.sourceFacts.path) !== path.resolve(root, lock.inputs.sourceFacts.path) || contract.sourceFacts.sha256 !== lock.inputs.sourceFacts.sha256) fail('requirements_source_conflict');
  const source = await readJSON(root, lock.inputs.sourceFacts) as SourceFactsV2, program = await readJSON(root, lock.program!);
  if (program.goalProfile !== undefined && program.goalProfile !== contract.goalProfile) fail('goal_profile_conflict');
  const sourceScopes = await verifyNative44SourceScopes(contract, source, reference => readBound(root, reference, 64 * 1024 * 1024));
  const coverage = validateNative44Requirements(contract, { source, sourceUnits: units, components: program.blocks, sourceFactsHash: lock.inputs.sourceFacts.sha256, sourceScopes }).coverage;
  for (const requirement of contract.requirements) {
    for (const check of requirement.checks) for (const ref of check.sourceEvidence) await readBound(root, ref, 64 * 1024 * 1024);
    if (requirement.fulfillment.route !== 'gap') { const proof = assertNative44CapabilityProof(requirement, await readJSON(root, requirement.fulfillment.proof), program.blocks); for (const ref of proof.evidence) await readBound(root, ref, 64 * 1024 * 1024); }
  }
  for (const deviation of policy.acceptedDeviations) for (const ref of deviation.evidence) await readBound(root, ref, 64 * 1024 * 1024);
  const acceptance = evaluateNative44Acceptance(contract, policy, undefined, { documentHash: expected.hash, cssHash: compiled.canonicalSha256, sourceScopes }); if (acceptance.status === 'stale') fail('policy_stale');
  return { model, compiled, expected, contract, policy, units, coverage, manifest: { ...manifest, ...fingerprintNative44Snapshot(expected), cssRules: [] } };
}
/** Preparation is local and reviewable. No target configuration or credential is loaded. */
async function prepareRevision(rootInput: string, input: unknown) {
  const request = Native44RevisionRequestSchema.parse(input), root = await checkedRoot(rootInput); noSecrets(request);
  const unlock = await acquireLock(root, await runResources(root, request.runId));
  try {
    await ensureDiskSpaceV2(root); const current = await baseline(root, request), inputs = await validateInputs(root, request, current.journal, current.before, current.lock);
    if (await optionalBytes(path.join(current.folder, 'bundle.json'))) fail('operation_already_prepared');
    await activeVerifiedEvidenceReader(root)?.revalidateAll();
    await mkdir(path.dirname(current.folder), { recursive: true }); await mkdir(current.folder); // incomplete or reused operations never overwrite
    const files = {} as Bundle['files'];
    for (const [key, name, value, raw] of [
      ['request', 'request.json', request, false], ['before', 'before.json', current.before, false], ['expected', 'expected.json', inputs.expected, false],
      ['cssModel', 'css-model.json', inputs.model, false], ['requirements', 'requirements.json', inputs.contract, false], ['acceptancePolicy', 'acceptance-policy.json', inputs.policy, false],
      ['sourceUnits', 'source-units.json', inputs.units, false], ['baselineManifest', 'baseline-manifest.json', await readJSON(root, request.manifest), false], ['manifest', 'compare-manifest.json', inputs.manifest, false], ['css', 'page-custom.css', inputs.compiled.css, true],
    ] as const) files[key] = await immutable(path.join(current.folder, name), value, raw);
    files.intent = await immutable(path.join(current.folder, 'intent.json'), { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: request.pageId, runId: request.runId, beforeHash: current.before.hash, expectedHash: inputs.expected.hash, payloadSha256: inputs.expected.hash, requestSha256: files.request.sha256, cssSha256: files.css.sha256, ...(inputs.contract.goalProfile ? { goalProfile: inputs.contract.goalProfile, requirementsRef: files.requirements } : {}) });
    await requireEditorCompletion(current.runDir, request.taskId, request.runId, inputs.expected.hash);
    const bundle: Bundle = { version: 1, kind: 'native44-revision-bundle', request, parentPointerHash: current.parentPointerHash, journalHash: current.journalRef.sha256, files };
    await immutable(path.join(current.folder, 'bundle.json'), bundle); await writeJson(path.join(current.folder, 'operation-state.json'), { version: 1, kind: 'native44-revision-operation', status: 'prepared', attempts: 0, updatedAt: now() } satisfies OperationState);
    return { status: 'prepared' as const, operationId: request.operationId, runId: request.runId, beforeHash: current.before.hash, expectedHash: inputs.expected.hash, coverage: inputs.coverage, bundle: path.join(current.folder, 'bundle.json'), remoteWrites: 0 };
  } finally { await unlock(); }
}
async function loadBundle(root: string, runId: string, operationId: string) {
  const paths = await location(root, runId, operationId), bundle = await readJSON(root, await fileRef(path.join(paths.folder, 'bundle.json'))) as Bundle;
  if (bundle.version !== 1 || bundle.kind !== 'native44-revision-bundle') fail('bundle_invalid'); const request = Native44RevisionRequestSchema.parse(bundle.request);
  if (request.runId !== runId || request.operationId !== operationId) fail('bundle_identity_conflict');
  const names = { request: 'request.json', before: 'before.json', expected: 'expected.json', cssModel: 'css-model.json', requirements: 'requirements.json', acceptancePolicy: 'acceptance-policy.json', sourceUnits: 'source-units.json', baselineManifest: 'baseline-manifest.json', manifest: 'compare-manifest.json', css: 'page-custom.css', intent: 'intent.json' };
  if (canonicalV2(Object.keys(bundle.files).sort()) !== canonicalV2(Object.keys(names).sort())) fail('bundle_files_invalid');
  for (const [key, filename] of Object.entries(names)) { const ref = bundle.files[key as keyof typeof names]; if (path.resolve(root, ref.path) !== path.join(paths.folder, filename)) fail('bundle_owner_conflict'); await readBound(root, ref); }
  if (canonicalV2(await readJSON(root, bundle.files.request)) !== canonicalV2(request)) fail('bundle_request_conflict');
  const journal = await readJSON(root, { path: path.join(paths.runDir, 'journal.json'), sha256: bundle.journalHash });
  if (journal.taskId !== request.taskId || journal.runId !== request.runId || journal.pageId !== request.pageId || journal.executionStrategy !== 'native44-css-handoff' || !journal.mutations?.length || journal.mutations.some((item: any) => item.status !== 'confirmed') || !journal.mutations.some((item: any) => item.pageId === request.pageId && item.runId === request.runId && item.expectedAfterHash === journal.documentHash && item.observedHash === journal.documentHash)) fail('journal_identity_or_mutation_conflict');
  const lock = await historicalInputs(root, journal.releaseLock, { taskId: request.taskId, programHash: journal.programHash });
  const before = await readJSON(root, bundle.files.before) as DraftSnapshot;
  // Re-run validation from the frozen bundle, never from mutable caller files.
  const frozenRequest = { ...request, before: bundle.files.before, cssModel: bundle.files.cssModel, requirements: bundle.files.requirements, acceptancePolicy: bundle.files.acceptancePolicy, sourceUnits: bundle.files.sourceUnits, manifest: bundle.files.baselineManifest };
  const validated = await validateInputs(root, frozenRequest, journal, before, lock);
  const expected = await readJSON(root, bundle.files.expected) as DraftSnapshot;
  const intent = await readJSON(root, bundle.files.intent);
  if (intent.goalProfile !== validated.contract.goalProfile || (validated.contract.goalProfile ? canonicalV2(intent.requirementsRef) !== canonicalV2(bundle.files.requirements) : intent.requirementsRef !== undefined)) fail('intent_goal_profile_conflict');
  if (before.pageId !== request.pageId || before.runId !== request.runId || expected.pageId !== request.pageId || expected.runId !== request.runId || canonicalV2(expected) !== canonicalV2(validated.expected) || canonicalV2(await readJSON(root, bundle.files.manifest)) !== canonicalV2(validated.manifest) || (await readBound(root, bundle.files.css)).toString('utf8') !== validated.compiled.css || before.hash !== request.expectedBeforeHash || intent.version !== 1 || intent.kind !== 'explicit-user-owned-draft-amendment' || intent.pageId !== request.pageId || intent.runId !== request.runId || intent.payloadSha256 !== expected.hash || intent.beforeHash !== before.hash || intent.expectedHash !== expected.hash || intent.requestSha256 !== bundle.files.request.sha256 || intent.cssSha256 !== bundle.files.css.sha256) fail('bundle_derived_output_conflict');
  // Mutable operation state uses a fresh read plus its own CAS, never the
  // immutable dependency cache (it changes legitimately after a save intent).
  const operationStateRef = await fileRef(path.join(paths.folder, 'operation-state.json'));
  const state = await new VerifiedEvidenceReader(root).json(operationStateRef, noSecrets) as OperationState;
  if (state.version !== 1 || state.kind !== 'native44-revision-operation' || !['prepared', 'unknown', 'retryable', 'confirmed', 'conflict'].includes(state.status) || !Number.isInteger(state.attempts) || state.attempts < 0) fail('operation_state_invalid');
  return { ...paths, bundle, request, journal, before, state, operationStateHash: operationStateRef.sha256, ...validated };
}
function eligible(status: OwnedReviewStatus, pageId: number, runId: string): boolean { return status.pageId === pageId && status.runId === runId && status.exists && status.postType === 'page' && status.status === 'draft' && status.ownerMatches && status.canEdit && status.uniqueRunPage && status.documentExists && status.builtWithElementor; }
async function assertParent(root: string, data: Awaited<ReturnType<typeof loadBundle>>) {
  const bytes = await optionalBytes(data.pointerFile), pointer = bytes ? JSON.parse(bytes.toString('utf8')) : undefined;
  if (pointer?.amendments?.some((step: any) => path.resolve(root, step.intent.path) === path.resolve(root, data.bundle.files.intent.path))) { await readNative44CurrentState(root, data.runDir); return { pointer, alreadyRecorded: true }; }
  if ((bytes ? hashV2(bytes) : null) !== data.bundle.parentPointerHash) fail('parent_revision_changed'); return { pointer, alreadyRecorded: false };
}
async function finalize(root: string, data: Awaited<ReturnType<typeof loadBundle>>, after: DraftSnapshot) {
  const parent = await assertParent(root, data); if (parent.alreadyRecorded) return readNative44CurrentState(root, data.runDir);
  const snapshot = await immutable(path.join(data.folder, 'after.json'), after);
  const receiptFile = path.join(data.folder, 'receipt.json'), storedReceipt = await optionalBytes(receiptFile);
  const receiptValue = storedReceipt ? JSON.parse(storedReceipt.toString('utf8')) : { version: 1, status: 'confirmed', pageId: after.pageId, runId: after.runId, beforeHash: data.before.hash, afterHash: after.hash, cssApplied: true, confirmedAt: now() };
  if (receiptValue.version !== 1 || receiptValue.status !== 'confirmed' || receiptValue.pageId !== after.pageId || receiptValue.runId !== after.runId || receiptValue.beforeHash !== data.before.hash || receiptValue.afterHash !== after.hash || receiptValue.cssApplied !== true || !Number.isFinite(Date.parse(receiptValue.confirmedAt))) fail('receipt_identity_conflict');
  const receipt = await immutable(receiptFile, receiptValue);
  const candidate = buildNative44CurrentRevisionPointer({ previous: parent.pointer, identity: { taskId: data.request.taskId, runId: after.runId, pageId: after.pageId, beforeHash: data.before.hash }, step: { intent: data.bundle.files.intent, receipt, beforeHash: data.before.hash, afterHash: after.hash }, currentSnapshot: snapshot, currentCSS: data.bundle.files.css, documentHash: after.hash, counts: counts(after), requestedScope: data.request.userInstruction, recordedAt: now(), cssModelRef: data.bundle.files.cssModel, manifestRef: data.bundle.files.manifest, sourceUnitsRef: data.bundle.files.sourceUnits, requirementsRef: data.bundle.files.requirements, acceptancePolicyRef: data.bundle.files.acceptancePolicy });
  const result = await validateNative44CurrentRevisionPointer(root, data.runDir, candidate); await writeJson(data.pointerFile, candidate); return result;
}
/** One remote save per explicit apply. Lost replies are reconciled by exact
 * readback; a before-state result authorizes an explicit later retry only. */
async function applyRevision(rootInput: string, runId: string, operationId: string, deps: Native44RevisionDependencies, mode: 'apply' | 'reconcile' = 'apply') {
  const root = await checkedRoot(rootInput), unlock = await acquireLock(root, await runResources(root, runId));
  let remote: Native44RevisionRemote | undefined;
  try {
    await ensureDiskSpaceV2(root); const data = await loadBundle(root, runId, operationId), parent = await assertParent(root, data);
    if (parent.alreadyRecorded) { const current = await readNative44CurrentState(root, data.runDir); const delivery = await emitNative44DeliverySummary(root, runId, { lockHeld: true }); return { status: 'confirmed', remoteWrites: 0, current, delivery }; }
    if (data.state.status === 'conflict') fail('operation_conflict_requires_new_revision');
    await activeVerifiedEvidenceReader(root)?.revalidateAll();
    await assertParent(root, data);
    remote = await deps.remote(data.manifest);
    if (!eligible(await remote.probeOwnedReviewStatus(data.request.pageId, runId), data.request.pageId, runId)) fail('remote_draft_ineligible');
    const types = [...new Set([...native44SnapshotNodes(data.expected.elements).values()].map(({ node }) => node.elType === 'container' ? 'container' : node.widgetType!))];
    const adapter = remote;
    const read = async () => { const { snapshot } = await adapter.readOwnedReviewCheckpoint(data.request.pageId, runId, types); assertNative44RevisionSnapshot(snapshot); if (snapshot.pageId !== data.request.pageId || snapshot.runId !== runId) fail('remote_identity_conflict'); return snapshot; };
    let current = await read(), writes = 0;
    const saveState = async (status: OperationState['status']) => {
      const filename = path.join(data.folder, 'operation-state.json');
      if (await realpath(filename) !== filename || hashV2(await readFile(filename)) !== data.operationStateHash) fail('operation_state_changed');
      data.state = { ...data.state, status, observedHash: current.hash, updatedAt: now() }; await writeJson(filename, data.state);
      data.operationStateHash = hashV2(await readFile(filename));
    };
    if (current.hash !== data.before.hash && current.hash !== data.expected.hash) { await saveState('conflict'); return { status: 'conflict', remoteWrites: writes, observedHash: current.hash }; }
    if (current.hash === data.before.hash && mode === 'apply' && ['prepared', 'retryable'].includes(data.state.status)) {
      await activeVerifiedEvidenceReader(root)?.revalidateAll(); await assertParent(root, data);
      data.state.attempts++; await saveState('unknown'); // durable intent precedes the save
      writes++;
      try { current = await remote.saveOwnedRevision(current, data.expected, data.model); assertNative44RevisionSnapshot(current); if (current.pageId !== data.request.pageId || current.runId !== runId) fail('remote_identity_conflict'); }
      catch { try { current = await read(); } catch { return { status: 'unknown', remoteWrites: writes, action: 'reconcile' }; } }
    }
    if (current.hash === data.expected.hash) { const result = await finalize(root, data, current); await saveState('confirmed'); await requireEditorCompletion(data.runDir, data.request.taskId, runId, current.hash); const delivery = await emitNative44DeliverySummary(root, runId, { lockHeld: true, expectedState: result }); return { status: 'confirmed', remoteWrites: writes, current: result, delivery }; }
    if (current.hash === data.before.hash) { await saveState('retryable'); return { status: 'retryable', remoteWrites: writes, action: 'explicit-apply' }; }
    await saveState('conflict'); return { status: 'conflict', remoteWrites: writes, observedHash: current.hash };
  } finally { try { await remote?.close?.(); } finally { await unlock(); } }
}

/** Read-only reports are imported by reference after their pixels, hashes and
 * current document identity validate; importing a review never changes a page. */
async function recordRevisionReview(rootInput: string, runId: string, input: { verification: Native44CurrentRef; visualReview: Native44CurrentRef; acceptanceObservation: Native44CurrentRef }) {
  const root = await checkedRoot(rootInput), unlock = await acquireLock(root, await runResources(root, runId));
  try {
    await ensureDiskSpaceV2(root); const paths = await location(root, runId), old = await optionalBytes(paths.pointerFile); if (!old) fail('current_revision_missing');
    const pointer = JSON.parse(old.toString('utf8')) as Native44CurrentRevisionPointer; if (pointer.version !== 2) fail('review_requires_explicit_v2_revision');
    // Reject invalid/oversized imported reports before traversing historical
    // evidence or opening a browser. Final candidate validation is unchanged.
    for (const reference of [input.verification, input.visualReview, input.acceptanceObservation]) await readBound(root, reference, 16 * 1024 * 1024);
    await readJSON(root, input.verification); await readJSON(root, input.visualReview); const observation = Native44AcceptanceObservationSchema.parse(await readJSON(root, input.acceptanceObservation));
    if (observation.documentHash !== pointer.documentHash) fail('review_stale_document');
    await readNative44CurrentState(root, paths.runDir);
    // Reader expects a stable basename; each review is its own immutable folder.
    const reviewFolder = path.join(paths.runDir, 'amendments', `review-${input.acceptanceObservation.sha256.slice(0, 24)}`); await mkdir(reviewFolder, { recursive: true });
    const acceptanceObservationRef = await immutable(path.join(reviewFolder, 'acceptance-observation.json'), observation);
    const candidate = recordNative44CurrentRevisionReview(pointer, { verification: input.verification, visualReview: input.visualReview, acceptanceObservationRef, recordedAt: now() });
    const result = await validateNative44CurrentRevisionPointer(root, paths.runDir, candidate);
    if (!(await readFile(paths.pointerFile)).equals(old)) fail('parent_revision_changed'); await writeJson(paths.pointerFile, candidate);
    // This index is advisory only. It cannot override the evidence-derived
    // delivery decision or turn repeated blocking defects into a pass.
    let convergence: { recommendation: string; reason: string; rounds: number };
    try {
      const record = { documentHash: result.documentHash, observationHash: input.acceptanceObservation.sha256, observedAt: result.reviewedAt ?? candidate.recordedAt, blockingIssueIds: result.axes!.requirements.issues.map(issue => `${issue.requirementId}:${issue.checkId ?? ''}:${issue.code}`).sort(), weightedError: result.axes!.requirements.issues.length * 1000 + observation.checks.reduce((total, check) => total + (check.outcome === 'fail' ? check.issue?.delta ?? 1 : check.outcome === 'unverified' ? 100 : 0), 0) };
      const recordFile = path.join(reviewFolder, 'convergence-record.json');
      if (!await optionalBytes(recordFile)) await immutable(recordFile, record);
      const folders = (await readdir(path.join(paths.runDir, 'amendments'), { withFileTypes: true })).filter(entry => entry.isDirectory() && /^review-[a-f\d]{24}$/.test(entry.name));
      if (folders.length > 200) throw Error('convergence_history_limit');
      const history = [];
      for (const entry of folders) { const filename = path.join(paths.runDir, 'amendments', entry.name, 'convergence-record.json'); if (await optionalBytes(filename)) history.push(z.object({ documentHash: digest, observationHash: digest, observedAt: z.iso.datetime(), blockingIssueIds: z.array(z.string()).max(10000), weightedError: z.number().finite().nonnegative() }).strict().parse(await readJSON(root, await fileRef(filename)))); }
      history.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      convergence = result.deliveryComplete ? { recommendation: 'stop', reason: 'Current acceptance is satisfied; accepted minor deviations require no further correction.', rounds: history.length } : adviseNative44Convergence(history.slice(-3));
    } catch { convergence = { recommendation: 'inspect-history', reason: 'Advisory history could not be validated; the current evidence-derived delivery decision is unchanged.', rounds: 0 }; }
    const delivery = await emitNative44DeliverySummary(root, runId, { expectedState: result, lockHeld: true });
    return { ...result, convergence, delivery };
  } finally { await unlock(); }
}

export async function prepareNative44Revision(root: string, input: unknown) {
  return withVerifiedEvidenceReader(await checkedRoot(root), async reader => ({ ...await prepareRevision(root, input), evidenceWork: { ...reader.metrics } }));
}
export async function applyNative44Revision(root: string, runId: string, operationId: string, deps: Native44RevisionDependencies, mode: 'apply' | 'reconcile' = 'apply') {
  return withVerifiedEvidenceReader(await checkedRoot(root), async reader => ({ ...await applyRevision(root, runId, operationId, deps, mode), evidenceWork: { ...reader.metrics } }));
}
export async function recordNative44RevisionReview(root: string, runId: string, input: { verification: Native44CurrentRef; visualReview: Native44CurrentRef; acceptanceObservation: Native44CurrentRef }) {
  return withVerifiedEvidenceReader(await checkedRoot(root), async reader => ({ ...await recordRevisionReview(root, runId, input), evidenceWork: { ...reader.metrics } }));
}

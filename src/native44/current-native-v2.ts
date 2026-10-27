import path from 'node:path';
import { requireEditorCompletion } from '../editor-completion/store.js';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { acquireLock, writeJson } from '../core/files.js';
import { VerifiedEvidenceReader } from '../core/verified-evidence.js';
import { redactor } from '../core/config.js';
import { canonicalV2, documentHashV2, ensureDiskSpaceV2, hashV2 } from '../replica-v2/journal.js';
import { compileNative44, usedNative44WidgetTypes } from './compiler.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from './knowledge.js';
import { validateNative44Program } from './validate.js';
import { Native44CurrentNativeReplacementSchema, assertNative44CurrentNativeProgram } from './current-native-patch.js';
import { Native44CurrentNativeSourceBindingSchema, Native44CurrentNativeModelRecordSchema, deriveNative44CurrentNativeModel, finalizeNative44CurrentNativeModelRecord, bindNative44CurrentNativeModelCompilation, rebindNative44CurrentNativeManifest, type Native44CurrentNativeModelRecord } from './current-native-model.js';
import { compileNative44CSSModel, validateNative44CSSModel } from './css-model.js';
import { verifyNative44ImageBoxCaptionReveals } from './image-box-caption-proof.js';
import { prepareNative44PendingFormCapabilities } from './pending-form.js';
import { readNative44HistoricalReleaseEvidence } from './release-lock.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareManifest } from './compare.js';
import { assertNative44RevisionSnapshot, native44SnapshotNodes } from './revision-snapshot.js';
import { buildNative44CurrentRevisionPointer, readNative44CurrentState, validateNative44CurrentRevisionPointer, type Native44CurrentRef } from './current-state.js';
import { discoverNative44Contracts } from './target-context.js';
import { NATIVE44_PRODUCT_WIDGETS } from './catalog-check.js';
import { qualifyNative44CurrentNativeReviewEvidence, native44CurrentNativeExternalReviewPath, native44CurrentNativeReviewEvidenceAllows, native44CurrentNativeReviewDependencies, type Native44CurrentNativeReviewEvidence } from './current-native-review-evidence.js';
import type { Native44CurrentNativeRevisionDependencies } from './current-native-revision.js';
import type { DraftSnapshot } from '../wordpress/types.js';

const id = z.string().regex(/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/).refine(value => !value.includes('..'));
const hash = z.string().regex(/^[a-f\d]{64}$/), ref = z.object({ path: z.string().min(1).max(4096), sha256: hash }).strict();
export const Native44CurrentNativeV2RequestSchema = z.object({
  version: z.literal(2), kind: z.literal('native44-current-native-revision-request'), taskId: id, runId: id, operationId: id,
  pageId: z.number().int().positive(), userInstruction: z.string().trim().min(1).max(3000), expectedBeforeHash: hash,
  pointer: ref, journal: ref, before: ref, css: ref, manifest: ref, releaseLock: ref,
  program: ref, schemas: ref, assets: ref.optional(), baselineModel: ref, proposedModel: ref,
  requirements: ref, acceptancePolicy: ref, sourceUnits: ref,
  replacements: z.array(Native44CurrentNativeReplacementSchema).min(1).max(20),
  sourceBindings: z.array(Native44CurrentNativeSourceBindingSchema).min(1).max(20),
  cssChanges: z.array(z.unknown()).min(1).max(10000),
}).strict();
export type Native44CurrentNativeV2Request = z.infer<typeof Native44CurrentNativeV2RequestSchema>;
type Read = (reference: Native44CurrentRef, max?: number, reviewEvidence?: Native44CurrentNativeReviewEvidence) => Promise<Buffer>;
const fail = (code: string): never => { throw Error(`native44_current_native_v2_${code}`); };
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
const sameRef = (root: string, a: Native44CurrentRef | undefined, b: Native44CurrentRef) => a?.sha256 === b.sha256 && path.resolve(root, a?.path ?? '') === path.resolve(root, b.path);
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
function noSecrets(value: unknown) { const text = JSON.stringify(value); if (redactor()(text) !== text) fail('secret_in_artifact'); }
function fileReference(filename: string, value: unknown): Native44CurrentRef { return { path: filename, sha256: hashV2(bytes(value)) }; }
async function json(read: Read, reference: Native44CurrentRef) { const value = JSON.parse((await read(reference, 64 * 1024 * 1024)).toString('utf8').replace(/^\uFEFF/, '')); noSecrets(value); return value; }
async function location(root: string, runId: string, operationId: string) { id.parse(runId); id.parse(operationId); const runDir = path.join(root, 'runs', runId); if (await realpath(runDir) !== runDir) fail('run_alias'); return { runDir, pointerFile: path.join(runDir, 'current-user-amendment.json'), folder: path.join(runDir, 'amendments', operationId) }; }
async function immutable(filename: string, value: unknown, raw = false): Promise<Native44CurrentRef> {
  noSecrets(value); const buffer = raw ? Buffer.isBuffer(value) ? value : Buffer.from(value as string) : bytes(value);
  try { await writeFile(filename, buffer, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await readFile(filename)).equals(buffer)) fail('immutable_artifact_conflict'); }
  return { path: filename, sha256: hashV2(buffer) };
}
function assertParent(root: string, request: Native44CurrentNativeV2Request, pointer: any, before: DraftSnapshot) {
  if (pointer?.version !== 2 || pointer.kind !== 'native44-current-revision' || pointer.taskId !== request.taskId || pointer.runId !== request.runId || pointer.pageId !== request.pageId || pointer.documentHash !== before.hash || request.expectedBeforeHash !== before.hash || !sameRef(root, pointer.currentSnapshot, request.before) || !sameRef(root, pointer.currentCSS, request.css) || !sameRef(root, pointer.manifestRef, request.manifest) || !sameRef(root, pointer.cssModelRef, request.baselineModel) || !sameRef(root, pointer.requirementsRef, request.requirements) || !sameRef(root, pointer.acceptancePolicyRef, request.acceptancePolicy) || !sameRef(root, pointer.sourceUnitsRef, request.sourceUnits)) fail('parent_contract_conflict');
}

/** Shared by prepare/apply and the historical current reader. It reopens all
 * bound original inputs and normally recompiles the fragment. A stored record
 * is correspondence evidence, never compiler authority or acceptance. */
export async function deriveNative44CurrentNativeV2(input: { root: string; request: Native44CurrentNativeV2Request; pointer: any; before: DraftSnapshot; journal: any; read: Read; priorRecords?: Native44CurrentNativeModelRecord[] }) {
  const { root, request, pointer, before, journal } = input;
  Native44CurrentNativeV2RequestSchema.parse(request); assertNative44RevisionSnapshot(before); assertParent(root, request, pointer, before);
  const reviewEvidence = await qualifyNative44CurrentNativeReviewEvidence({ root, taskId: request.taskId, runId: request.runId, pageId: request.pageId, sourceBindings: request.sourceBindings });
  for (const reference of native44CurrentNativeReviewDependencies(reviewEvidence)) await input.read(reference, 64 * 1024 * 1024, reviewEvidence);
  const read: Read = (reference, max) => {
    if (native44CurrentNativeExternalReviewPath(root, request.runId, reference.path) && !native44CurrentNativeReviewEvidenceAllows(reviewEvidence, root, reference, request, true)) fail('undeclared_external_review_reference');
    return input.read(reference, max, reviewEvidence);
  };
  if (journal.taskId !== request.taskId || journal.runId !== request.runId || journal.pageId !== request.pageId || !sameRef(root, journal.releaseLock, request.releaseLock)) fail('journal_identity_conflict');
  const lock = await readNative44HistoricalReleaseEvidence(root, request.releaseLock, { taskId: request.taskId, programHash: journal.programHash });
  for (const item of [request.releaseLock, lock.program!, ...Object.values(lock.inputs!)]) await read({ path: item.path, sha256: item.sha256 });
  const frozenProgram = validateNative44Program(await json(read, lock.program!)), source = await json(read, lock.inputs!.sourceFacts), sourcePlan = await json(read, lock.inputs!.componentPlan);
  const program = validateNative44Program(await json(read, request.program)); assertNative44CurrentNativeProgram(program);
  if (program.editorNaming !== frozenProgram.editorNaming || program.reviewWorkflow !== frozenProgram.reviewWorkflow || program.articleListPolicy !== frozenProgram.articleListPolicy) fail('fragment_task_defaults_identity_conflict');
  const manifest = await json(read, request.manifest) as Native44CompareManifest;
  validateNative44CompareManifest(manifest, journal.selectionRulesHash);
  if (manifest.taskId !== request.taskId || manifest.runId !== request.runId || manifest.pageId !== request.pageId || !sameRef(root, manifest.releaseLock, request.releaseLock) || Object.entries(fingerprintNative44Snapshot(before)).some(([key, value]) => manifest[key as keyof Native44CompareManifest] !== value) || program.taskId !== request.taskId || program.sourceUrl !== manifest.sourceUrl || program.replicationProfile !== manifest.replicationProfile || ['componentCatalog', 'sourceFacts', 'componentPlan', 'assetsManifest'].some(key => !sameRef(root, program[key as 'sourceFacts'], lock.inputs![key as keyof typeof lock.inputs])) || path.resolve(root, program.knowledge.path) !== path.join(root, 'data', 'native44', 'index.json')) fail('fragment_or_manifest_identity_conflict');
  const schemaEvidence = await json(read, request.schemas), schemas = schemaEvidence.legacySchemas ?? schemaEvidence, assets = request.assets ? await json(read, request.assets) : [];
  if (!Array.isArray(assets)) fail('assets_invalid');
  const types = usedNative44WidgetTypes(program), loaded = await loadNative44Knowledge(types, path.join(root, 'data', 'native44'));
  if (loaded.index.fingerprint !== program.knowledge.fingerprint) fail('knowledge_conflict');
  for (const item of [program.knowledge, ...[loaded.index.sharedControls, ...types.map(type => loaded.index.components[type])].map(item => ({ path: path.join(root, 'data', 'native44', item.path), sha256: item.sha256 }))]) await read({ path: item.path, sha256: item.sha256 });
  // The exact pending declaration factory is invoked independently at every
  // compilation boundary. Serialized pending receipts grant no permission.
  const pendingForms = await prepareNative44PendingFormCapabilities({ root, program });
  const options = { schemas, knowledge: toNative44CompilerKnowledge(loaded, schemas), assets, targetOrigin: new URL(manifest.targetUrl).origin, pendingForms };
  const compiled = compileNative44(program, options);
  for (const receipt of compiled.pendingFormBindings ?? []) for (const item of [receipt.sourceFacts, receipt.appearance, receipt.registered.capabilities, ...receipt.packets]) await read({ path: item.path, sha256: item.sha256 }, 64 * 1024 * 1024);
  const baselineModel = await json(read, request.baselineModel), proposedModel = await json(read, request.proposedModel), contract = await json(read, request.requirements), policy = await json(read, request.acceptancePolicy), sourceUnits = await json(read, request.sourceUnits);
  validateNative44CSSModel(baselineModel); validateNative44CSSModel(proposedModel);
  if ((await read(request.css)).toString('utf8') !== before.settings.custom_css) fail('baseline_css_conflict');
  await verifyNative44ImageBoxCaptionReveals({ root, model: baselineModel, elements: before.elements, program: lock.program!, sourceFacts: lock.inputs!.sourceFacts, componentPlan: lock.inputs!.componentPlan, read });
  if (compileNative44CSSModel(baselineModel, { elements: before.elements }).css !== before.settings.custom_css) fail('baseline_model_snapshot_conflict');
  for (const binding of request.sourceBindings) for (const item of [...binding.evidence, ...binding.descendantBindings?.flatMap(row => row.evidence) ?? []]) await read(item, 64 * 1024 * 1024);
  const derived = deriveNative44CurrentNativeModel({ root, before, baselineModel, proposedModel, compiled, fragment: program, replacements: request.replacements, changes: request.cssChanges, sourceBindings: request.sourceBindings, frozenProgram, source, sourcePlan, sourceUnits, contract, policy, schemas,
    references: { frozenProgram: { path: lock.program!.path, sha256: lock.program!.sha256 }, sourceFacts: { path: lock.inputs!.sourceFacts.path, sha256: lock.inputs!.sourceFacts.sha256 }, componentPlan: { path: lock.inputs!.componentPlan.path, sha256: lock.inputs!.componentPlan.sha256 }, requirements: request.requirements, acceptancePolicy: request.acceptancePolicy, sourceUnits: request.sourceUnits, baselineSnapshot: request.before, baselineManifest: request.manifest, baselineModel: request.baselineModel, fragmentProgram: request.program, registeredSchemas: request.schemas, proposedModel: request.proposedModel }, priorRecords: input.priorRecords });
  await verifyNative44ImageBoxCaptionReveals({ root, model: derived.model, elements: derived.elements, program: lock.program!, sourceFacts: lock.inputs!.sourceFacts, componentPlan: lock.inputs!.componentPlan, read });
  const css = compileNative44CSSModel(derived.model, { elements: derived.elements }), settings = { ...before.settings, custom_css: css.css }, expected = { ...before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) };
  const record = finalizeNative44CurrentNativeModelRecord(derived, expected), folder = path.join(root, 'runs', request.runId, 'amendments', request.operationId), recordRef = fileReference(path.join(folder, 'model-record.json'), record);
  const priorRefs = pointer.nativeReplacementRecords ?? [];
  if (!Array.isArray(priorRefs) || priorRefs.length !== (input.priorRecords ?? []).length || priorRefs.some((item: unknown) => !ref.safeParse(item).success)) fail('prior_record_inventory_conflict');
  const widgetTypes = [...new Set([...native44SnapshotNodes(expected.elements).values()].map(({ node }) => node.elType === 'container' ? 'container' : node.widgetType!))];
  const nextManifest = { ...rebindNative44CurrentNativeManifest(manifest, record), ...fingerprintNative44Snapshot(expected), widgetTypes, cssRules: [], nativeReplacementRecords: [...priorRefs, recordRef] };
  validateNative44CompareManifest(nextManifest, journal.selectionRulesHash);
  const proof = { version: 2, kind: 'native44-current-native-proof', program, schemas, knowledge: loaded, assets, compiled, replacements: request.replacements, modelRecord: recordRef, record, manifest: nextManifest };
  return { expected, program, schemas, types, loaded, assets, compiled, model: derived.model, record, recordRef, manifest: nextManifest, stylesheet: css.css, contract, policy, sourceUnits, proof };
}

type Files = Record<'request' | 'parentPointer' | 'before' | 'expected' | 'cssModel' | 'requirements' | 'acceptancePolicy' | 'sourceUnits' | 'css' | 'manifest' | 'nativeProof' | 'modelRecord' | 'intent', Native44CurrentRef>;
type Bundle = { version: 2; kind: 'native44-current-native-bundle'; request: Native44CurrentNativeV2Request; files: Files };
type Operation = { version: 1; kind: 'native44-current-native-operation'; status: 'prepared' | 'unknown' | 'retryable' | 'confirmed' | 'conflict'; attempts: number; updatedAt: string; observedHash?: string };
async function validate(root: string, request: Native44CurrentNativeV2Request, reader: VerifiedEvidenceReader) {
  const paths = await location(root, request.runId, request.operationId);
  if (path.resolve(root, request.pointer.path) !== paths.pointerFile || path.resolve(root, request.journal.path) !== path.join(paths.runDir, 'journal.json')) fail('request_owner_conflict');
  const pointerBytes = await reader.read(request.pointer), pointer = JSON.parse(pointerBytes.toString('utf8')), journal = await reader.json(request.journal, noSecrets), before = await reader.json(request.before, noSecrets) as DraftSnapshot;
  const current = await readNative44CurrentState(root, paths.runDir, { taskId: request.taskId, runId: request.runId, pageId: request.pageId });
  if (!current || current.runId !== request.runId || current.documentHash !== before.hash) fail('current_state_conflict');
  for (const item of current!.evidence) await reader.read({ path: item.path, sha256: item.sha256 }, 64 * 1024 * 1024);
  const priorRecords: Native44CurrentNativeModelRecord[] = [];
  for (const item of pointer.nativeReplacementRecords ?? []) priorRecords.push(Native44CurrentNativeModelRecordSchema.parse(await reader.json(item, noSecrets)));
  const data = await deriveNative44CurrentNativeV2({ root, request, pointer, before, journal, read: (item, max) => reader.read(item, max), priorRecords });
  return { ...paths, ...data, pointer, pointerBytes, journal, before };
}

export async function prepareNative44CurrentNativeV2(rootInput: string, input: unknown) {
  const root = await realpath(rootInput), request = Native44CurrentNativeV2RequestSchema.parse(input), reader = new VerifiedEvidenceReader(root), unlock = await acquireLock(root); noSecrets(request);
  try {
    await ensureDiskSpaceV2(root); const data = await validate(root, request, reader); await reader.revalidateAll();
    await mkdir(path.dirname(data.folder), { recursive: true }); await mkdir(data.folder);
    await requireEditorCompletion(data.runDir, request.taskId, request.runId, data.expected.hash);
    const files = {} as Files;
    for (const [key, name, value, raw] of [
      ['request', 'request.json', request, false], ['parentPointer', 'parent-pointer.json', data.pointerBytes, true], ['before', 'before.json', data.before, false], ['expected', 'expected.json', data.expected, false],
      ['cssModel', 'css-model.json', data.model, false], ['requirements', 'requirements.json', data.contract, false], ['acceptancePolicy', 'acceptance-policy.json', data.policy, false], ['sourceUnits', 'source-units.json', data.sourceUnits, false],
      ['css', 'page-custom.css', data.stylesheet, true], ['manifest', 'compare-manifest.json', data.manifest, false], ['modelRecord', 'model-record.json', data.record, false], ['nativeProof', 'native-proof.json', data.proof, false],
    ] as const) files[key] = await immutable(path.join(data.folder, name), value, raw);
    if (!sameRef(root, files.modelRecord, data.recordRef) || files.parentPointer.sha256 !== request.pointer.sha256) fail('derived_evidence_conflict');
    files.intent = await immutable(path.join(data.folder, 'intent.json'), { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: request.pageId, runId: request.runId, beforeHash: data.before.hash, expectedHash: data.expected.hash, payloadSha256: data.expected.hash, requestSha256: files.request.sha256, cssSha256: files.css.sha256, nativeProofSha256: files.nativeProof.sha256, modelRecord: files.modelRecord, ...(data.contract.goalProfile ? { goalProfile: data.contract.goalProfile, requirementsRef: files.requirements } : {}) });
    await immutable(path.join(data.folder, 'bundle.json'), { version: 2, kind: 'native44-current-native-bundle', request, files } satisfies Bundle);
    await writeJson(path.join(data.folder, 'operation-state.json'), { version: 1, kind: 'native44-current-native-operation', status: 'prepared', attempts: 0, updatedAt: now() } satisfies Operation);
    return { status: 'prepared', runId: request.runId, operationId: request.operationId, expectedHash: data.expected.hash, bundle: path.join(data.folder, 'bundle.json'), modelRecord: files.modelRecord, remoteWrites: 0, evidenceWork: reader.metrics };
  } finally { await unlock(); }
}

export async function applyNative44CurrentNativeV2(rootInput: string, runId: string, operationId: string, deps: Native44CurrentNativeRevisionDependencies, mode: 'apply' | 'reconcile' = 'apply') {
  const root = await realpath(rootInput), reader = new VerifiedEvidenceReader(root), unlock = await acquireLock(root); let remote: Awaited<ReturnType<typeof deps.remote>> | undefined;
  try {
    await ensureDiskSpaceV2(root); const paths = await location(root, runId, operationId), bundleBytes = await readFile(path.join(paths.folder, 'bundle.json')), bundle = JSON.parse(bundleBytes.toString('utf8')) as Bundle;
    if (bundle.version !== 2 || bundle.kind !== 'native44-current-native-bundle') fail('bundle_invalid');
    const request = Native44CurrentNativeV2RequestSchema.parse(bundle.request); if (request.runId !== runId || request.operationId !== operationId) fail('bundle_identity_conflict'); noSecrets(bundle);
    const names: Record<keyof Files, string> = { request: 'request.json', parentPointer: 'parent-pointer.json', before: 'before.json', expected: 'expected.json', cssModel: 'css-model.json', requirements: 'requirements.json', acceptancePolicy: 'acceptance-policy.json', sourceUnits: 'source-units.json', css: 'page-custom.css', manifest: 'compare-manifest.json', nativeProof: 'native-proof.json', modelRecord: 'model-record.json', intent: 'intent.json' };
    if (Object.keys(bundle.files).sort().join(',') !== Object.keys(names).sort().join(',')) fail('bundle_files_invalid');
    for (const [key, name] of Object.entries(names)) { const item = bundle.files[key as keyof Files]; ref.parse(item); if (path.resolve(root, item.path) !== path.join(paths.folder, name)) fail('bundle_owner_conflict'); await reader.read(item, 64 * 1024 * 1024); }
    if (!same(await reader.json(bundle.files.request, noSecrets), request)) fail('bundle_request_conflict');
    const pointerBytes = await readFile(paths.pointerFile), pointer = JSON.parse(pointerBytes.toString('utf8'));
    if (pointer.amendments?.some((step: any) => sameRef(root, step.intent, bundle.files.intent))) {
      const current = await readNative44CurrentState(root, paths.runDir, { taskId: request.taskId, runId, pageId: request.pageId }); if (!current) fail('recorded_current_state_missing'); return { status: 'confirmed', remoteWrites: 0, current };
    }
    if (hashV2(pointerBytes) !== request.pointer.sha256) fail('parent_changed');
    const data = await validate(root, request, reader), intent = await reader.json(bundle.files.intent, noSecrets);
    const intended = { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: request.pageId, runId, beforeHash: data.before.hash, expectedHash: data.expected.hash, payloadSha256: data.expected.hash, requestSha256: bundle.files.request.sha256, cssSha256: bundle.files.css.sha256, nativeProofSha256: bundle.files.nativeProof.sha256, modelRecord: bundle.files.modelRecord, ...(data.contract.goalProfile ? { goalProfile: data.contract.goalProfile, requirementsRef: bundle.files.requirements } : {}) };
    for (const [key, value] of [['request', request], ['before', data.before], ['expected', data.expected], ['cssModel', data.model], ['requirements', data.contract], ['acceptancePolicy', data.policy], ['sourceUnits', data.sourceUnits], ['manifest', data.manifest], ['nativeProof', data.proof], ['modelRecord', data.record]] as const) if (!same(await reader.json(bundle.files[key], noSecrets), value)) fail('bundle_derived_output_conflict');
    if (!same(intent, intended) || !(await reader.read(bundle.files.parentPointer)).equals(pointerBytes) || (await reader.read(bundle.files.css)).toString('utf8') !== data.stylesheet) fail('bundle_derived_output_conflict');
    await reader.read({ path: path.join(paths.folder, 'bundle.json'), sha256: hashV2(bundleBytes) });
    let operation = JSON.parse(await readFile(path.join(paths.folder, 'operation-state.json'), 'utf8')) as Operation;
    if (operation.version !== 1 || operation.kind !== 'native44-current-native-operation' || !['prepared', 'unknown', 'retryable', 'confirmed', 'conflict'].includes(operation.status) || !Number.isSafeInteger(operation.attempts) || operation.attempts < 0 || operation.status === 'conflict') fail('operation_invalid');
    await reader.revalidateAll(); remote = await deps.remote(data.manifest);
    const status = await remote.probeOwnedReviewStatus(request.pageId, runId);
    if (status.pageId !== request.pageId || status.runId !== runId || !status.exists || status.postType !== 'page' || status.status !== 'draft' || !status.ownerMatches || !status.canEdit || !status.uniqueRunPage || !status.documentExists || !status.builtWithElementor) fail('remote_draft_ineligible');
    const types = [...new Set([...native44SnapshotNodes(data.expected.elements).values()].map(({ node }) => node.elType === 'container' ? 'container' : node.widgetType!))];
    const read = async () => { const { snapshot } = await remote!.readOwnedReviewCheckpoint(request.pageId, runId, types); assertNative44RevisionSnapshot(snapshot); if (snapshot.pageId !== request.pageId || snapshot.runId !== runId) fail('remote_identity_conflict'); return snapshot; };
    let observed = await read(), writes = 0;
    const state = async (status: Operation['status']) => { operation = { ...operation, status, observedHash: observed.hash, updatedAt: now() }; await writeJson(path.join(paths.folder, 'operation-state.json'), operation); };
    if (observed.hash === data.before.hash && mode === 'apply' && ['prepared', 'retryable'].includes(operation.status)) {
      const capabilities = await discoverNative44Contracts(remote, data.types), pendingForms = await prepareNative44PendingFormCapabilities({ root, program: data.program }), options = { schemas: capabilities.legacySchemas, knowledge: toNative44CompilerKnowledge(data.loaded, capabilities.legacySchemas), assets: data.assets, targetOrigin: new URL(data.manifest.targetUrl).origin, pendingForms }, compiled = compileNative44(data.program, options);
      if (!same(compiled, data.compiled)) fail('live_fragment_compilation_changed');
      bindNative44CurrentNativeModelCompilation(data.model, compiled);
      await immutable(path.join(paths.folder, `live-capabilities-${hashV2(canonicalV2(capabilities))}.json`), capabilities);
      await reader.revalidateAll(); if (hashV2(await readFile(paths.pointerFile)) !== request.pointer.sha256) fail('parent_changed');
      operation.attempts++; await state('unknown'); writes++;
      try { observed = await remote.saveOwnedNativeRevision(observed, data.expected, compiled, request.replacements, data.model.modules, [], data.model); assertNative44RevisionSnapshot(observed); }
      catch { try { observed = await read(); } catch { return { status: 'unknown', remoteWrites: writes, action: 'reconcile' }; } }
    }
    if (observed.hash === data.before.hash) { await state('retryable'); return { status: 'retryable', remoteWrites: writes, action: 'explicit-apply' }; }
    if (!same(observed, data.expected)) { await state('conflict'); return { status: 'conflict', remoteWrites: writes, observedHash: observed.hash }; }
    if (hashV2(await readFile(paths.pointerFile)) !== request.pointer.sha256) fail('parent_changed_after_save');
    const after = await immutable(path.join(paths.folder, 'after.json'), observed), receiptPath = path.join(paths.folder, 'receipt.json');
    let receiptValue: any; try { receiptValue = JSON.parse(await readFile(receiptPath, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    receiptValue ??= { version: 1, status: 'confirmed', pageId: request.pageId, runId, beforeHash: data.before.hash, afterHash: observed.hash, cssApplied: true, confirmedAt: now() };
    if (receiptValue.version !== 1 || receiptValue.status !== 'confirmed' || receiptValue.pageId !== request.pageId || receiptValue.runId !== runId || receiptValue.beforeHash !== data.before.hash || receiptValue.afterHash !== observed.hash || receiptValue.cssApplied !== true || !Number.isFinite(Date.parse(receiptValue.confirmedAt))) fail('receipt_conflict');
    const receipt = await immutable(receiptPath, receiptValue);
    const counts = { containers: 0, widgets: 0, html: 0, productWidgets: 0 }; for (const { node } of native44SnapshotNodes(observed.elements).values()) { if (node.elType === 'container') counts.containers++; else counts.widgets++; if (node.widgetType === 'html') counts.html++; if ((NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(node.widgetType ?? '')) counts.productWidgets++; }
    const candidate = buildNative44CurrentRevisionPointer({ previous: data.pointer, step: { intent: bundle.files.intent, receipt, beforeHash: data.before.hash, afterHash: observed.hash }, documentHash: observed.hash, currentSnapshot: after, currentCSS: bundle.files.css, counts, requestedScope: request.userInstruction, recordedAt: now(), cssModelRef: bundle.files.cssModel, manifestRef: bundle.files.manifest, sourceUnitsRef: bundle.files.sourceUnits, requirementsRef: bundle.files.requirements, acceptancePolicyRef: bundle.files.acceptancePolicy, acceptanceObservationRef: null, verification: null, visualReview: null, nativeReplacementRecords: [...data.pointer.nativeReplacementRecords ?? [], bundle.files.modelRecord] });
    await validateNative44CurrentRevisionPointer(root, paths.runDir, candidate);
    if (hashV2(await readFile(paths.pointerFile)) !== request.pointer.sha256) fail('parent_changed_before_index');
    await writeJson(paths.pointerFile, candidate); const current = await readNative44CurrentState(root, paths.runDir, { taskId: request.taskId, runId, pageId: request.pageId }); if (!current || current.documentHash !== observed.hash) fail('index_readback_conflict');
    await state('confirmed'); return { status: 'confirmed', remoteWrites: writes, current, modelRecord: bundle.files.modelRecord, evidenceWork: reader.metrics };
  } finally { try { await remote?.close?.(); } finally { await unlock(); } }
}

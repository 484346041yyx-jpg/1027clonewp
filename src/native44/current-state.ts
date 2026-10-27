import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { readFile, realpath, stat } from 'node:fs/promises';
import { activeVerifiedEvidenceReader, withVerifiedEvidenceReader } from '../core/verified-evidence.js';
import { canonicalV2, documentHashV2, hashV2, isHashV2 } from '../replica-v2/journal.js';
import { canonicalNative44CSS, native44CSSHash } from './css-handoff.js';
import type { DraftSnapshot, ElementorElement } from '../wordpress/types.js';
import { compileNative44CSSModel, validateNative44CSSModel } from './css-model.js';
import { verifyNative44ImageBoxCaptionReveals } from './image-box-caption-proof.js';
import { NATIVE44_PRODUCT_WIDGETS } from './catalog-check.js';
import { native44PostEvidencePassed, type Native44PostCheck } from './post-check.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareManifest } from './compare.js';
import { readNative44HistoricalReleaseEvidence } from './release-lock.js';
import { applyNative44ActualCheckResults, assertNative44CapabilityProof, evaluateNative44Acceptance, validateNative44Requirements, verifyNative44SourceScopes, Native44SourceScopeEvidenceSchema, Native44RequirementContractSchema, Native44AcceptancePolicySchema, Native44AcceptanceObservationSchema, type Native44ActualCheckResult } from './requirements.js';
import { Native44CurrentCaptureReviewRequestSchema, Native44CurrentCaptureReviewSchema, type Native44CurrentCaptureReviewState } from './current-review-contract.js';
import { assertNative44NoninteractiveSourceLayout } from './current-review-source.js';
import { compileNative44, usedNative44WidgetTypes } from './compiler.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from './knowledge.js';
import { validateNative44Program } from './validate.js';
import { assembleNative44CurrentNativeSnapshot, assertNative44CurrentNativeProgram } from './current-native-patch.js';
import { native44DisclosureEvidencePassed, type Native44DisclosureCheck } from './disclosure-check.js';
import { native44TabsEvidencePassed, type Native44TabsCheck } from './tabs-check.js';
import { Native44CurrentNativeV2RequestSchema, deriveNative44CurrentNativeV2 } from './current-native-v2.js';
import { Native44CurrentNativeModelRecordSchema, projectNative44CurrentNativeModelRecords, type Native44CurrentNativeModelRecord } from './current-native-model.js';
import { native44CurrentNativeReviewEvidenceAllows, type Native44CurrentNativeReviewEvidence } from './current-native-review-evidence.js';

export interface Native44CurrentRef { path: string; sha256: string }
export interface Native44CurrentCounts { containers: number; widgets: number; html: number; productWidgets: number }
export interface Native44AmendmentStep { intent: Native44CurrentRef; receipt: Native44CurrentRef; beforeHash: string; afterHash: string }
export interface Native44CurrentRevisionPointer {
  version: 2; kind: 'native44-current-revision'; taskId: string; runId: string; pageId: number; unpublished: true;
  documentHash: string; cssApplied: true; requestedScope: string; recordedAt: string; counts: Native44CurrentCounts;
  amendments: Native44AmendmentStep[]; currentSnapshot: Native44CurrentRef; currentCSS: Native44CurrentRef;
  cssModelRef: Native44CurrentRef; manifestRef: Native44CurrentRef; sourceUnitsRef: Native44CurrentRef; requirementsRef: Native44CurrentRef; acceptancePolicyRef: Native44CurrentRef;
  acceptanceObservationRef?: Native44CurrentRef; verification?: Native44CurrentRef; visualReview?: Native44CurrentRef;
  nativeReplacementRecords?: Native44CurrentRef[];
}
export interface Native44CurrentAxes {
  write: { status: 'confirmed'; documentHash: string };
  remote: { status: 'not-freshly-observed'; basis: 'local-snapshot-only' };
  css: { status: 'applied'; canonicalHash: string; model: Native44CurrentRef };
  review: { status: 'not-run' | 'reviewed' | 'stale'; observedAt?: string; documentHash?: string; automated: 'passed' | 'has-failures' | 'not-run' };
  requirements: ReturnType<typeof evaluateNative44Acceptance>;
  delivery: { status: 'pending' | 'delivered' | 'delivered-with-deviations' | 'delivered-with-open-items'; complete: boolean; requirementsComplete: boolean };
}

export interface CurrentStateEvidence { path: string; sha256: string; bytes: number; reason: string }
export interface Native44CurrentState {
  version: 1; kind: 'verified-native44-current-state'; taskId: string; runId: string; pageId: number;
  status: 'delivered' | 'delivered-with-deviations' | 'delivered-with-open-items' | 'pending-css-review' | 'amendment-pending' | 'reviewed-with-gaps' | 'pending-requirements' | 'stale-review'; deliveryComplete: boolean;
  goalProfile?: 'component-reference-v1'; requirementsComplete?: boolean; draftReady?: boolean;
  visualVerification: 'applied-verified' | 'pending-comparison' | 'reviewed-with-gaps' | 'stale'; unpublished: true;
  documentHash: string; originalDocumentHash: string; requestedScope: string;
  currentSnapshot: { path: string; sha256: string }; currentCSS: { path: string; sha256: string };
  counts: { containers: number; widgets: number; html: number; productWidgets: number };
  verification?: { path: string; sha256: string }; visualReview?: { path: string; sha256: string };
  currentManifest?: Native44CurrentRef; cssModel?: Native44CurrentRef; axes?: Native44CurrentAxes; reviewedAt?: string;
  /** Explicit current correspondences; frozen original component proofs remain historical. */
  nativeReplacementRecords?: Array<{ reference: Native44CurrentRef; record: Native44CurrentNativeModelRecord }>;
  currentNativeMappings?: Native44CurrentNativeModelRecord['owners'];
  /** Explicit current frontend review of a v1 task; its frozen plan is preserved. */
  currentCaptureReview?: Native44CurrentCaptureReviewState;
  resolvedFrom?: { runId: string; pageId: number };
  successorRoutes?: Array<{ parentRunId: string; parentPageId: number; successorRunId: string; successorPageId: number }>;
  authority: 'verified-local-evidence'; observedAt: string; evidence: CurrentStateEvidence[];
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z\d][a-zA-Z\d_.-]{0,159}$/.test(value) && !value.includes('..');
const sameCurrentReference = (root: string, left: Native44CurrentRef, right: Native44CurrentRef) => left.sha256 === right.sha256 && path.resolve(root, left.path) === path.resolve(root, right.path);
const verifiedStates = new WeakMap<Native44CurrentState, { root: string; runDir: string; pointerHash: string; stateHash: string }>();
function fail(code: string, filename?: string): never { throw Error(`native44_current_${code}${filename ? `: ${filename}` : ''}`); }
function currentPostChecks(capture: any, checks: Native44PostCheck[], widgetCount: number): Array<{ check: Native44PostCheck; passed: boolean }> {
  const rows = capture.postQueries ?? [];
  if (!Array.isArray(rows) || checks.length < widgetCount || rows.length !== checks.length || new Set(rows.map((row: any) => row.componentKey)).size !== rows.length || rows.some((row: any) => !checks.some(check => check.componentKey === row.componentKey))) fail('verification_post_coverage_invalid');
  return checks.map(check => { const row = rows.find((row: any) => row.componentKey === check.componentKey); return { check, passed: row?.viewport === capture.viewport && native44PostEvidencePassed(check, row) }; });
}
function within(root: string, filename: string): void { const relative = path.relative(root, filename); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('path_escape'); }
async function decodedReviewMetadata(root: string, pixels: { sha256: string; bytes: Buffer }): Promise<Pick<Metadata, 'format' | 'width' | 'height' | 'pages'>> {
  const decode = async () => {
    try {
      const decoded = sharp(pixels.bytes, { failOn: 'error', limitInputPixels: 50_000_000 }), metadata = await decoded.metadata();
      await decoded.resize(1, 1).raw().toBuffer();
      return { format: metadata.format, width: metadata.width, height: metadata.height, pages: metadata.pages };
    } catch { fail('visual_image_invalid'); }
  };
  const reader = activeVerifiedEvidenceReader(root);
  return reader ? reader.derive(`native44-review-raster-v1:sharp-${sharp.versions.sharp}`, pixels.sha256, decode) : decode();
}

/** Pure adapter for the normal comparison engine. Original report bytes remain
 * evidence; the reader still decodes pixels, checks queries and binds reviews.
 * A normalized envelope deliberately asserts no acceptance or delivery status. */
export function normalizeNative44CurrentReviewReport(report: any, manifest: Native44CompareManifest): any {
  if (report?.kind !== undefined) return report;
  if (!object(report) || report.version !== 1 || report.executionStrategy !== 'native44-css-handoff' || report.taskId !== manifest.taskId || report.runId !== manifest.runId || report.pageId !== manifest.pageId || report.baselineDocumentHash !== manifest.documentHash || report.manifestHash !== hashV2(canonicalV2(manifest)) || !isHashV2(report.documentHash) || !isHashV2(report.finalReadHash) || report.css?.canonicalSha256 !== native44CSSHash(canonicalNative44CSS(manifest.pageCss)) || !Number.isFinite(Date.parse(report.finishedAt)) || !Array.isArray(report.captures) || report.metrics?.documentWrites !== 0 || report.metrics?.editorSessions !== 0) fail('standard_verification_conflict');
  return { version: 1, kind: 'native44-current-review', taskId: report.taskId, runId: report.runId, pageId: report.pageId, ...(report.currentManifest ? { currentManifest: report.currentManifest } : {}), documentHash: report.documentHash, documentUnchanged: report.finalReadHash === report.documentHash, css: { applied: report.css.applied === true, expectedHash: report.css.canonicalSha256, actualHash: report.css.canonicalSha256 }, observedAt: report.finishedAt, metrics: { documentWrites: 0, editorSessions: 0, viewports: report.captures.length }, captures: report.captures.map((capture: any) => {
    const viewport = manifest.viewports?.find(view => view.name === capture?.viewport);
    if (!viewport || capture.width !== viewport.width || capture.height !== viewport.height || !isHashV2(capture.source?.sha256) || !isHashV2(capture.target?.sha256) || !Array.isArray(capture.target.interactionChecks) || !Array.isArray(capture.target.productChecks)) fail('standard_verification_viewport_invalid');
    return { viewport: capture.viewport, devicePixelRatio: capture.devicePixelRatio, sourceScreenshot: { path: capture.source.screenshot, sha256: capture.source.sha256 }, targetScreenshot: { path: capture.target.screenshot, sha256: capture.target.sha256 }, interactions: capture.target.interactionChecks, queries: capture.target.productChecks, ...(capture.target.postChecks !== undefined ? { postQueries: capture.target.postChecks } : {}), ...(capture.target.disclosureChecks !== undefined ? { disclosures: capture.target.disclosureChecks } : {}), ...(capture.target.tabsChecks !== undefined ? { tabs: capture.target.tabsChecks } : {}) };
  }) };
}

/** The pointer is only an index. Completion is derived from its bound chain,
 * complete document, stylesheet, read-only report and actual reviewed pixels.
 * This reader never loads configuration, credentials or browser sessions. */
async function readNative44CurrentStateLocal(rootInput: string, runInput: string, identity?: { taskId?: string; runId?: string; pageId?: number; documentHash?: string }, candidate?: Native44CurrentRevisionPointer | Record<string, any>, virtualEvidence?: ReadonlyMap<string, Buffer>): Promise<Native44CurrentState | undefined> {
  const root = await realpath(rootInput), runDir = await realpath(path.resolve(root, runInput));
  if (!activeVerifiedEvidenceReader(root)) return withVerifiedEvidenceReader(root, () => readNative44CurrentStateLocal(root, runDir, identity, candidate, virtualEvidence));
  const candidateHash = candidate ? hashV2(canonicalV2(candidate)) : undefined;
  const state = await deriveNative44CurrentStateLocal(root, runDir, identity, candidate, virtualEvidence);
  if (state && !virtualEvidence) {
    if (candidate) {
      const reader = activeVerifiedEvidenceReader(root)!;
      for (const reference of new Map(state.evidence.map(item => [`${item.path}\0${item.sha256}`, item])).values()) await reader.verify(reference, 64 * 1024 * 1024);
      // Candidate validation precedes a local CAS write. Cached old evidence
      // must not turn an intervening external edit into an accepted pointer.
      await reader.revalidateAll();
    }
    const filename = path.join(runDir, 'current-user-amendment.json');
    const bytes = candidate ? undefined : await readFile(filename);
    if (bytes && hashV2(bytes) !== state.evidence.find(item => item.path === filename)?.sha256) fail('pointer_changed_during_read');
    if (candidate && hashV2(canonicalV2(candidate)) !== candidateHash) fail('pointer_changed_during_read');
    verifiedStates.set(state, { root, runDir, pointerHash: candidateHash ?? hashV2(canonicalV2(JSON.parse(bytes!.toString('utf8')))), stateHash: hashV2(canonicalV2(state)) });
  }
  return state;
}

/** Only an unmodified state produced by this validator can avoid recomputation.
 * Every unique dependency and the persisted pointer are freshly checked under
 * the caller's lock. Serialized, cloned or virtual-only states confer no trust. */
export async function reuseNative44CurrentStateForDelivery(root: string, runId: string, value: unknown): Promise<Native44CurrentState | undefined> {
  if (!object(value)) return undefined;
  const state = value as Native44CurrentState, brand = verifiedStates.get(state);
  if (!brand || brand.root !== root || brand.runDir !== path.join(root, 'runs', runId)) return undefined;
  if (hashV2(canonicalV2(state)) !== brand.stateHash) fail('verified_state_mutated');
  return withVerifiedEvidenceReader(root, async reader => {
    for (const reference of state.evidence) await reader.verify(reference, 64 * 1024 * 1024);
    await reader.revalidateAll();
    const filename = path.join(brand.runDir, 'current-user-amendment.json');
    if (await realpath(filename) !== filename) fail('reference_realpath_changed');
    const info = await stat(filename); if (!info.isFile() || info.size > 16 * 1024 * 1024) fail('file_too_large');
    const bytes = await readFile(filename);
    if (bytes.length > 16 * 1024 * 1024 || hashV2(canonicalV2(JSON.parse(bytes.toString('utf8')))) !== brand.pointerHash) fail('pointer_changed_during_read');
    const result = structuredClone(state), sha256 = hashV2(bytes);
    result.evidence = result.evidence.filter(item => item.path !== filename);
    result.evidence.push({ path: filename, sha256, bytes: bytes.length, reason: 'Fresh persisted pointer matches the fully verified candidate.' });
    return result;
  });
}

async function deriveNative44CurrentStateLocal(rootInput: string, runInput: string, identity?: { taskId?: string; runId?: string; pageId?: number; documentHash?: string }, candidate?: Native44CurrentRevisionPointer | Record<string, any>, virtualEvidence?: ReadonlyMap<string, Buffer>): Promise<Native44CurrentState | undefined> {
  const root = await realpath(rootInput), runDir = await realpath(path.resolve(root, runInput));
  within(path.join(root, 'runs'), runDir);
  if (path.dirname(runDir) !== path.join(root, 'runs') || !id(path.basename(runDir))) fail('run_path_invalid');
  const evidence: CurrentStateEvidence[] = [];
  const reader = activeVerifiedEvidenceReader(root)!;
  const read = async (filename: string, family: 'owned' | 'review' | 'source' | 'knowledge' | 'catalog', expected?: string, max = 16 * 1024 * 1024, verifyOnly = false) => {
    if (typeof filename !== 'string' || /[?\r\n]|^[a-z]+:\/\//i.test(filename)) fail('reference_invalid');
    const resolved = path.resolve(root, filename); within(root, resolved);
    const familyRoot = family === 'owned' ? runDir : family === 'knowledge' ? path.join(root, 'data', 'native44') : family === 'catalog' ? path.join(root, 'config') : path.join(root, family === 'review' ? 'runs' : 'references');
    if (family === 'catalog' && resolved !== path.join(root, 'config', 'native44-component-set.json')) fail('frozen_catalog_path_invalid');
    within(familyRoot, resolved);
    const virtual = family === 'owned' ? virtualEvidence?.get(resolved) : undefined;
    if (virtual) {
      if (virtual.length > max) fail('file_too_large', path.relative(root, resolved));
      const sha256 = hashV2(virtual); if (expected !== undefined && (!isHashV2(expected) || sha256 !== expected)) fail('hash_mismatch', path.relative(root, resolved));
      evidence.push({ path: resolved, sha256, bytes: virtual.length, reason: 'Prepared current review evidence; bytes, hash and exact virtual owner verified before persistence.' });
      return { path: resolved, sha256, bytes: virtual };
    }
    if (expected !== undefined) {
      if (!isHashV2(expected)) fail('hash_mismatch', path.relative(root, resolved));
      try {
        const reference = { path: resolved, sha256: expected };
        const checked = verifyOnly ? await reader.verify(reference, max) : undefined;
        const bytes = checked ? Buffer.alloc(0) : await reader.read(reference, max);
        evidence.push({ path: resolved, sha256: expected, bytes: checked?.bytes ?? bytes.length, reason: 'Current revision evidence; local hash and ownership verified.' });
        return { path: resolved, sha256: expected, bytes };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('file_missing', path.relative(root, resolved));
        const message = (error as Error).message;
        if (message.includes('hash_mismatch')) fail('hash_mismatch', path.relative(root, resolved));
        if (message.includes('artifact_too_large')) fail('file_too_large', path.relative(root, resolved));
        if (message.includes('reference_alias')) fail('reference_realpath_changed', path.relative(root, resolved));
        throw error;
      }
    }
    let actual: string;
    try { actual = await realpath(resolved); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('file_missing', path.relative(root, resolved)); throw error; }
    within(root, actual); within(familyRoot, actual);
    // Junctions and aliases cannot change the evidence owner or basename.
    if (actual !== resolved) fail('reference_realpath_changed', path.relative(root, resolved));
    const info = await stat(actual); if (!info.isFile() || info.size > max) fail('file_too_large', path.relative(root, actual));
    const bytes = await readFile(actual); if (bytes.length > max) fail('file_too_large', path.relative(root, actual));
    const sha256 = hashV2(bytes); if (expected !== undefined && (!isHashV2(expected) || sha256 !== expected)) fail('hash_mismatch', path.relative(root, actual));
    evidence.push({ path: actual, sha256, bytes: bytes.length, reason: 'Current revision evidence; local hash and ownership verified.' });
    return { path: actual, sha256, bytes };
  };
  const json = async (filename: string, family: 'owned' | 'review', expected?: string): Promise<any> => {
    const virtual = family === 'owned' && virtualEvidence?.has(path.resolve(root, filename));
    const file = await read(filename, family, expected, 16 * 1024 * 1024, !!expected && !virtual);
    try { return expected && !virtual ? await reader.json({ path: file.path, sha256: expected }) : JSON.parse(file.bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { fail('json_invalid', path.relative(root, file.path)); }
  };
  const pointerPath = path.join(runDir, 'current-user-amendment.json');
  if (!candidate) try { await stat(pointerPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const pointer = candidate ?? await json(pointerPath, 'owned'), versionTwo = pointer?.version === 2 && pointer?.kind === 'native44-current-revision';
  if (!object(pointer) || !(versionTwo || pointer.version === 1 && pointer.kind === 'completed-explicit-user-draft-amendment' && ['completed', 'applied-pending-review', 'amendment-pending', 'reviewed-current-capture'].includes(pointer.status)) || !id(pointer.taskId) || pointer.runId !== path.basename(runDir) || !Number.isSafeInteger(pointer.pageId) || pointer.pageId < 1 || pointer.unpublished !== true || !isHashV2(pointer.documentHash) || typeof pointer.requestedScope !== 'string' || !pointer.requestedScope.trim() || pointer.requestedScope.length > 3000) fail('pointer_identity_invalid');
  const journal = await json(path.join(runDir, 'journal.json'), 'owned');
  if (journal.executionStrategy !== 'native44-css-handoff' || journal.taskId !== pointer.taskId || journal.runId !== pointer.runId || journal.pageId !== pointer.pageId || !isHashV2(journal.documentHash) || identity?.taskId !== undefined && identity.taskId !== pointer.taskId || identity?.runId !== undefined && identity.runId !== pointer.runId || identity?.pageId !== undefined && identity.pageId !== pointer.pageId || identity?.documentHash !== undefined && identity.documentHash !== journal.documentHash) fail('journal_identity_conflict');
  if (!['draft-saved', 'awaiting-comparison', 'delivered'].includes(journal.status) || !Array.isArray(journal.mutations) || !journal.mutations.length || journal.mutations.some((item: any) => item.status !== 'confirmed') || !journal.mutations.some((item: any) => item.pageId === pointer.pageId && item.runId === pointer.runId && item.expectedAfterHash === journal.documentHash && item.observedHash === journal.documentHash)) fail('journal_unresolved');
  const ref = (value: unknown, family: 'owned' | 'review', suffix: string): { path: string; sha256: string } => {
    if (!object(value) || typeof value.path !== 'string' || !isHashV2(value.sha256) || Object.keys(value).sort().join(',') !== 'path,sha256') fail('reference_invalid');
    const filename = path.resolve(root, value.path); within(family === 'owned' ? runDir : path.join(root, 'runs'), filename);
    if (!filename.endsWith(suffix) || family === 'owned' && !path.relative(runDir, filename).startsWith(`amendments${path.sep}`)) fail('reference_family_invalid');
    return { path: filename, sha256: value.sha256 };
  };
  const snapshot = async (filename: string, expectedHash: string, expectedBytes?: string): Promise<DraftSnapshot> => {
    const value = await json(filename, 'owned', expectedBytes);
    if (!object(value) || value.pageId !== pointer.pageId || value.runId !== pointer.runId || value.status !== 'draft' || !Array.isArray(value.elements) || !object(value.settings) || value.hash !== expectedHash || documentHashV2(value.elements, value.settings) !== expectedHash) fail('snapshot_identity_or_hash_mismatch', path.relative(root, filename));
    return value as DraftSnapshot;
  };
  let lastHash = journal.documentHash; let lastAfter: string | undefined, lastConfirmedAt: string | undefined, lastLegacyObservedAt: string | undefined, lastRequest: Record<string, any> | undefined, lastIntent: Record<string, any> | undefined;
  if (!Array.isArray(pointer.amendments) || !pointer.amendments.length || pointer.amendments.length > 100) fail('chain_invalid');
  const verifiedNativeRecords: Array<{ reference: Native44CurrentRef; record: Native44CurrentNativeModelRecord }> = [];
  for (const [stepIndex, step] of pointer.amendments.entries()) {
    if (!object(step) || step.beforeHash !== lastHash || !isHashV2(step.afterHash)) fail('chain_discontinuity');
    const intentRef = ref(step.intent, 'owned', `${path.sep}intent.json`), receiptRef = ref(step.receipt, 'owned', `${path.sep}receipt.json`);
    if (path.dirname(intentRef.path) !== path.dirname(receiptRef.path)) fail('chain_owner_conflict');
    const intent = await json(intentRef.path, 'owned', intentRef.sha256), receipt = await json(receiptRef.path, 'owned', receiptRef.sha256), folder = path.dirname(intentRef.path);
    lastIntent = intent;
    lastConfirmedAt = receipt?.confirmedAt;
    lastLegacyObservedAt = receipt?.confirmedAt ?? receipt?.observedAt;
    if (!object(intent) || intent.version !== 1 || intent.kind !== 'explicit-user-owned-draft-amendment' || intent.pageId !== pointer.pageId || intent.runId !== pointer.runId || intent.beforeHash !== lastHash || !isHashV2(intent.expectedHash) || intent.payloadSha256 !== intent.expectedHash || !isHashV2(intent.requestSha256) || !isHashV2(intent.cssSha256) || !object(receipt) || receipt.version !== 1 || receipt.status !== 'confirmed' || receipt.pageId !== pointer.pageId || receipt.runId !== pointer.runId || receipt.beforeHash !== lastHash || receipt.afterHash !== step.afterHash || receipt.cssApplied !== true) fail('chain_intent_receipt_conflict');
    if (receipt.normalization === undefined && intent.expectedHash !== step.afterHash) fail('chain_intent_receipt_conflict');
    const request = await json(path.join(folder, 'request.json'), 'owned', intent.requestSha256);
    if (!object(request) || request.pageId !== pointer.pageId || request.runId !== undefined && request.runId !== pointer.runId) fail('chain_request_identity_conflict');
    lastRequest = request;
    const before = await snapshot(path.join(folder, 'before.json'), lastHash);
    const expected = await snapshot(path.join(folder, 'expected.json'), intent.expectedHash);
    const after = await snapshot(path.join(folder, 'after.json'), step.afterHash);
    if (request.kind === 'native44-current-native-revision-request' && request.version === 2) {
      const parsed = Native44CurrentNativeV2RequestSchema.parse(request);
      if (!versionTwo || !isHashV2(intent.nativeProofSha256) || parsed.expectedBeforeHash !== before.hash || parsed.taskId !== pointer.taskId || receipt.normalization !== undefined || path.resolve(root, parsed.pointer.path) !== pointerPath || path.resolve(root, parsed.journal.path) !== path.join(runDir, 'journal.json')) fail('native_revision_v2_identity_conflict');
      const parent = await json(path.join(folder, 'parent-pointer.json'), 'owned', parsed.pointer.sha256);
      if (parent.version !== 2 || parent.kind !== 'native44-current-revision' || parent.documentHash !== before.hash || canonicalV2(parent.amendments) !== canonicalV2(pointer.amendments.slice(0, stepIndex)) || canonicalV2(parent.nativeReplacementRecords ?? []) !== canonicalV2(verifiedNativeRecords.map(item => item.reference))) fail('native_revision_parent_chain_conflict');
      await read(parsed.journal.path, 'owned', parsed.journal.sha256);
      if (canonicalV2(await json(parsed.before.path, 'owned', parsed.before.sha256)) !== canonicalV2(before)) fail('native_revision_before_reference_conflict');
      const readV2 = async (reference: Native44CurrentRef, max = 64 * 1024 * 1024, reviewEvidence?: Native44CurrentNativeReviewEvidence) => {
        const filename = path.resolve(root, reference.path), owned = path.relative(runDir, filename), knowledge = path.relative(path.join(root, 'data', 'native44'), filename);
        const family = owned && !owned.startsWith('..') && !path.isAbsolute(owned) ? 'owned' : knowledge && !knowledge.startsWith('..') && !path.isAbsolute(knowledge) ? 'knowledge' : filename === path.join(root, 'config', 'native44-component-set.json') ? 'catalog' : native44CurrentNativeReviewEvidenceAllows(reviewEvidence, root, reference, parsed) ? 'review' : 'source';
        return (await read(filename, family, reference.sha256, max)).bytes;
      };
      const derived = await deriveNative44CurrentNativeV2({ root, request: parsed, pointer: parent, before, journal, read: readV2, priorRecords: verifiedNativeRecords.map(item => item.record) });
      const recordRef = ref(intent.modelRecord, 'owned', `${path.sep}model-record.json`);
      if (path.dirname(recordRef.path) !== folder || !sameCurrentReference(root, recordRef, derived.recordRef)) fail('native_revision_record_owner_conflict');
      const record = Native44CurrentNativeModelRecordSchema.parse(await json(recordRef.path, 'owned', recordRef.sha256));
      const proof = await json(path.join(folder, 'native-proof.json'), 'owned', intent.nativeProofSha256), amendmentManifest = await json(path.join(folder, 'compare-manifest.json'), 'owned');
      if (canonicalV2(record) !== canonicalV2(derived.record) || canonicalV2(proof) !== canonicalV2(derived.proof) || canonicalV2(expected) !== canonicalV2(derived.expected) || canonicalV2(after) !== canonicalV2(expected) || canonicalV2(amendmentManifest) !== canonicalV2(derived.manifest)) fail('native_revision_v2_derived_conflict');
      verifiedNativeRecords.push({ reference: recordRef, record });
    } else if (request.kind === 'native44-current-native-revision-request') {
      if (!isHashV2(intent.nativeProofSha256) || request.expectedBeforeHash !== before.hash || request.taskId !== pointer.taskId || receipt.normalization !== undefined) fail('native_revision_proof_missing');
      const proof = await json(path.join(folder, 'native-proof.json'), 'owned', intent.nativeProofSha256);
      if (!object(proof) || proof.version !== 1 || proof.kind !== 'native44-current-native-proof' || !object(request.program) || !object(request.schemas)) fail('native_revision_proof_invalid');
      const program = validateNative44Program(await json(request.program.path, 'owned', request.program.sha256));
      const schemas = await json(request.schemas.path, 'owned', request.schemas.sha256);
      const baselineManifest = await json(request.manifest.path, 'owned', request.manifest.sha256);
      const assets = request.assets ? await json(request.assets.path, 'owned', request.assets.sha256) : [];
      if (canonicalV2(proof.program) !== canonicalV2(program) || canonicalV2(proof.schemas) !== canonicalV2(schemas.legacySchemas ?? schemas) || canonicalV2(proof.assets) !== canonicalV2(assets) || canonicalV2(proof.replacements) !== canonicalV2(request.replacements) || canonicalV2(proof.corrections) !== canonicalV2(request.corrections) || canonicalV2(proof.modules) !== canonicalV2(baselineManifest.modules.map(({ key, className }: any) => ({ key, className })))) fail('native_revision_proof_conflict');
      const frozen = await readNative44HistoricalReleaseEvidence(root, journal.releaseLock, { taskId: pointer.taskId, programHash: journal.programHash });
      const frozenProgram = JSON.parse((await read(frozen.program!.path, 'source', frozen.program!.sha256, 64 * 1024 * 1024)).bytes.toString('utf8'));
      if (program.editorNaming !== frozenProgram.editorNaming || program.reviewWorkflow !== frozenProgram.reviewWorkflow || program.articleListPolicy !== frozenProgram.articleListPolicy) fail('native_revision_frozen_policy_conflict');
      if (program.taskId !== pointer.taskId || program.sourceUrl !== baselineManifest.sourceUrl || program.replicationProfile !== baselineManifest.replicationProfile || !sameCurrentReference(root, program.componentCatalog, frozen.inputs!.componentCatalog) || !sameCurrentReference(root, program.sourceFacts, frozen.inputs!.sourceFacts) || !sameCurrentReference(root, program.componentPlan, frozen.inputs!.componentPlan) || !sameCurrentReference(root, program.assetsManifest, frozen.inputs!.assetsManifest) || path.resolve(root, program.knowledge.path) !== path.join(root, 'data', 'native44', 'index.json')) fail('native_revision_program_identity_conflict');
      validateNative44CompareManifest(baselineManifest, journal.selectionRulesHash);
      if (baselineManifest.taskId !== pointer.taskId || baselineManifest.runId !== pointer.runId || baselineManifest.pageId !== pointer.pageId || canonicalV2(baselineManifest.releaseLock) !== canonicalV2(journal.releaseLock) || Object.entries(fingerprintNative44Snapshot(before)).some(([key, value]) => baselineManifest[key] !== value)) fail('native_revision_baseline_manifest_conflict');
      await read(program.knowledge.path, 'knowledge', program.knowledge.sha256);
      const actualKnowledge = await loadNative44Knowledge(usedNative44WidgetTypes(program), path.join(root, 'data', 'native44'));
      for (const item of [actualKnowledge.index.sharedControls, ...usedNative44WidgetTypes(program).map(type => actualKnowledge.index.components[type])]) await read(path.join(root, 'data', 'native44', item.path), 'knowledge', item.sha256);
      if (actualKnowledge.index.fingerprint !== program.knowledge.fingerprint || canonicalV2(actualKnowledge) !== canonicalV2(proof.knowledge)) fail('native_revision_knowledge_conflict');
      assertNative44CurrentNativeProgram(program);
      const compiled = compileNative44(program, { schemas: proof.schemas, knowledge: toNative44CompilerKnowledge(actualKnowledge, proof.schemas), assets: proof.assets, targetOrigin: new URL(baselineManifest.targetUrl).origin });
      if (canonicalV2(compiled) !== canonicalV2(proof.compiled) || canonicalV2(assembleNative44CurrentNativeSnapshot(before, compiled, request.replacements, proof.modules, proof.corrections)) !== canonicalV2(expected) || canonicalV2(expected) !== canonicalV2(after)) fail('native_revision_delta_conflict');
      const amendmentManifest = await json(path.join(folder, 'compare-manifest.json'), 'owned');
      const widgetTypes = [...new Set([...function* visit(nodes: ElementorElement[]): Generator<string> { for (const node of nodes) { yield node.elType === 'container' ? 'container' : node.widgetType!; yield* visit(node.elements ?? []); } }(expected.elements)])], disclosureChecks = [...baselineManifest.disclosureChecks ?? [], ...request.disclosureChecks ?? []], tabsChecks = [...baselineManifest.tabsChecks ?? [], ...request.tabsChecks ?? []];
      const expectedManifest = { ...baselineManifest, ...fingerprintNative44Snapshot(expected), widgetTypes, cssRules: [], ...(disclosureChecks.length ? { disclosureChecks } : {}), ...(tabsChecks.length ? { tabsChecks } : {}) };
      validateNative44CompareManifest(expectedManifest, journal.selectionRulesHash);
      if (canonicalV2(proof.manifest) !== canonicalV2(amendmentManifest) || canonicalV2(expectedManifest) !== canonicalV2(amendmentManifest)) fail('native_revision_manifest_conflict');
    }
    if (receipt.normalization !== undefined) {
      const normalization = receipt.normalization;
      if (!object(normalization) || Object.keys(normalization).sort().join(',') !== 'fields,inputHash,kind,outputHash' || normalization.kind !== 'native-page-metadata-retained' || normalization.inputHash !== intent.expectedHash || normalization.outputHash !== step.afterHash || canonicalV2(normalization.fields) !== canonicalV2(['post_title', 'post_status']) || Object.hasOwn(expected.settings, 'post_title') || Object.hasOwn(expected.settings, 'post_status') || before.settings.post_status !== 'draft' || typeof before.title !== 'string' || !before.title.trim() || before.title !== before.settings.post_title || expected.title !== before.title) fail('chain_metadata_normalization_invalid');
      const settings = { ...expected.settings, post_title: before.settings.post_title, post_status: 'draft' };
      const normalized = { ...expected, settings, hash: documentHashV2(expected.elements, settings) };
      if (normalized.hash !== step.afterHash || canonicalV2(after) !== canonicalV2(normalized)) fail('chain_metadata_normalization_mismatch');
      const normalizedStored = await snapshot(path.join(folder, 'normalized-expected.json'), step.afterHash);
      if (canonicalV2(normalizedStored) !== canonicalV2(normalized)) fail('chain_metadata_normalization_mismatch');
    }
    const css = await read(path.join(folder, 'page-custom.css'), 'owned', intent.cssSha256);
    if (after.settings.custom_css !== css.bytes.toString('utf8')) fail('chain_css_snapshot_mismatch');
    lastHash = step.afterHash; lastAfter = path.join(folder, 'after.json');
  }
  if (lastHash !== pointer.documentHash) fail('chain_current_hash_conflict');
  const currentSnapshot = ref(pointer.currentSnapshot, 'owned', `${path.sep}after.json`), currentCSS = ref(pointer.currentCSS, 'owned', `${path.sep}page-custom.css`);
  if (currentSnapshot.path !== lastAfter || path.dirname(currentCSS.path) !== path.dirname(currentSnapshot.path)) fail('current_owner_conflict');
  const actual = await snapshot(currentSnapshot.path, pointer.documentHash, currentSnapshot.sha256), css = await read(currentCSS.path, 'owned', currentCSS.sha256);
  if (actual.settings.custom_css !== css.bytes.toString('utf8') || pointer.cssApplied !== true) fail('css_snapshot_mismatch');
  let postWidgetCount = 0; const counts = { containers: 0, widgets: 0, html: 0, productWidgets: 0 };
  const visit = (nodes: ElementorElement[]) => { for (const node of nodes) { if (!object(node)) fail('snapshot_element_invalid'); if (node.elType === 'container') counts.containers++; if (node.elType === 'widget') counts.widgets++; if (node.widgetType === 'html') counts.html++; if (node.widgetType === 'wd_blog') postWidgetCount++; if (versionTwo ? (NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(node.widgetType ?? '') : node.widgetType === 'wd_products') counts.productWidgets++; if (Array.isArray(node.elements)) visit(node.elements); } }; visit(actual.elements);
  if (!object(pointer.counts) || Object.keys(counts).some(key => pointer.counts[key] !== counts[key as keyof typeof counts])) fail('counts_mismatch');
  const state: Native44CurrentState = { version: 1, kind: 'verified-native44-current-state', taskId: pointer.taskId, runId: pointer.runId, pageId: pointer.pageId, status: pointer.status === 'amendment-pending' ? 'amendment-pending' : 'pending-css-review', deliveryComplete: false, visualVerification: 'pending-comparison', unpublished: true, documentHash: pointer.documentHash, originalDocumentHash: journal.documentHash, requestedScope: pointer.requestedScope, currentSnapshot, currentCSS, counts, authority: 'verified-local-evidence', observedAt: pointer.completedAt ?? '', evidence };
  if (pointer.nativeReplacementRecords !== undefined || verifiedNativeRecords.length) {
    if (!versionTwo || !Array.isArray(pointer.nativeReplacementRecords) || canonicalV2(pointer.nativeReplacementRecords) !== canonicalV2(verifiedNativeRecords.map(item => item.reference))) fail('native_replacement_record_inventory_conflict');
    state.nativeReplacementRecords = verifiedNativeRecords;
    state.currentNativeMappings = projectNative44CurrentNativeModelRecords(verifiedNativeRecords.map(item => item.record), actual);
  }
  if (!versionTwo && pointer.currentManifest !== undefined) {
    const currentManifest = ref(pointer.currentManifest, 'owned', `${path.sep}compare-manifest.json`);
    if (!pointer.amendments.some((step: Native44AmendmentStep) => path.dirname(path.resolve(root, step.intent.path)) === path.dirname(currentManifest.path)) || path.dirname(currentManifest.path) !== path.dirname(currentSnapshot.path)) fail('capture_manifest_owner_conflict');
    const manifest = await json(currentManifest.path, 'owned', currentManifest.sha256) as Native44CompareManifest;
    if (!journal.releaseLock) fail('capture_manifest_release_missing');
    await readNative44HistoricalReleaseEvidence(root, journal.releaseLock, { taskId: pointer.taskId, programHash: journal.programHash });
    validateNative44CompareManifest(manifest, journal.selectionRulesHash);
    if (manifest.taskId !== pointer.taskId || manifest.runId !== pointer.runId || manifest.pageId !== pointer.pageId || canonicalV2(manifest.releaseLock) !== canonicalV2(journal.releaseLock) || Object.entries(fingerprintNative44Snapshot(actual)).some(([key, value]) => manifest[key as keyof Native44CompareManifest] !== value)) fail('capture_manifest_fingerprint_conflict');
    state.currentManifest = currentManifest;
  }
  if (versionTwo) {
    if (!Number.isFinite(Date.parse(pointer.recordedAt)) || 'status' in pointer || 'completedAt' in pointer || 'deliveryComplete' in pointer) fail('revision_asserted_status_invalid');
    if (!lastConfirmedAt || !Number.isFinite(Date.parse(lastConfirmedAt))) fail('revision_confirmation_time_invalid');
    const ownedRef = (value: unknown, basename: string) => ref(value, 'owned', `${path.sep}${basename}`);
    const cssModel = ownedRef(pointer.cssModelRef, 'css-model.json'), currentManifest = ownedRef(pointer.manifestRef, 'compare-manifest.json');
    if ([cssModel, currentManifest].some(item => path.dirname(item.path) !== path.dirname(currentSnapshot.path))) fail('revision_bundle_owner_conflict');
    const model = await json(cssModel.path, 'owned', cssModel.sha256); validateNative44CSSModel(model);
    if (model.taskId !== pointer.taskId || model.runId !== pointer.runId || model.pageId !== pointer.pageId) fail('css_model_identity_conflict');
    const lock = await readNative44HistoricalReleaseEvidence(root, journal.releaseLock, { taskId: pointer.taskId, programHash: journal.programHash });
    await verifyNative44ImageBoxCaptionReveals({ root, model, elements: actual.elements, program: lock.program!, sourceFacts: lock.inputs!.sourceFacts, componentPlan: lock.inputs!.componentPlan, read: async reference => {
      const filename = path.resolve(root, reference.path), relative = path.relative(path.join(root, 'runs'), filename);
      return (await read(filename, relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? 'review' : 'source', reference.sha256, 64 * 1024 * 1024)).bytes;
    } });
    const compiled = compileNative44CSSModel(model, { elements: actual.elements });
    if (compiled.css !== css.bytes.toString('utf8')) fail('css_model_snapshot_conflict');
    const manifest = await json(currentManifest.path, 'owned', currentManifest.sha256), fingerprint = fingerprintNative44Snapshot(actual);
    if (canonicalV2(manifest.nativeReplacementRecords ?? []) !== canonicalV2(verifiedNativeRecords.map(item => item.reference))) fail('native_replacement_manifest_inventory_conflict');
    if (manifest.taskId !== pointer.taskId || manifest.runId !== pointer.runId || manifest.pageId !== pointer.pageId || canonicalV2(manifest.releaseLock) !== canonicalV2(journal.releaseLock) || Object.entries(fingerprint).some(([key, value]) => manifest[key] !== value)) fail('revision_manifest_conflict');
    validateNative44CompareManifest(manifest, journal.selectionRulesHash);
    let frozenKnowledgeFiles: Map<string, string> | undefined;
    const isFrozenKnowledgeFile = async (filename: string, sha256: string) => {
      if (!frozenKnowledgeFiles) {
        const indexFile = await read(lock.inputs!.knowledge.path, 'knowledge', lock.inputs!.knowledge.sha256);
        const index = JSON.parse(indexFile.bytes.toString('utf8'));
        if (!object(index) || !object(index.components) || index.fingerprint !== lock.inputs!.knowledge.fingerprint) fail('requirements_knowledge_index_invalid');
        frozenKnowledgeFiles = new Map();
        for (const entry of Object.values(index.components)) {
          if (!object(entry) || typeof entry.path !== 'string' || !isHashV2(entry.sha256)) fail('requirements_knowledge_index_invalid');
          const componentFile = path.resolve(path.dirname(indexFile.path), entry.path);
          within(path.dirname(indexFile.path), componentFile);
          frozenKnowledgeFiles.set(componentFile, entry.sha256);
        }
      }
      return frozenKnowledgeFiles.get(filename) === sha256;
    };
    const readRequirementEvidence = async (reference: Native44CurrentRef, verifyOnly = false) => {
      if (!object(reference) || Object.keys(reference).sort().join(',') !== 'path,sha256' || typeof reference.path !== 'string' || !isHashV2(reference.sha256)) fail('requirement_evidence_invalid');
      const filename = path.resolve(root, reference.path), relative = path.relative(path.join(root, 'runs'), filename);
      if (!/\.(?:json|png|jpg|jpeg|webp|css)$/.test(filename)) fail('requirement_evidence_family_invalid');
      const knowledgeRelative = path.relative(path.join(root, 'data', 'native44'), filename);
      // Original capability proofs may cite an exact component in the frozen
      // knowledge index. This grants no access to other data or a new index.
      if (knowledgeRelative && !knowledgeRelative.startsWith('..') && !path.isAbsolute(knowledgeRelative) && await isFrozenKnowledgeFile(filename, reference.sha256)) return read(filename, 'knowledge', reference.sha256, 64 * 1024 * 1024, verifyOnly);
      const family = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? 'review' : 'source';
      if (family === 'source') within(path.join(root, 'references', pointer.taskId), filename);
      return read(filename, family, reference.sha256, 64 * 1024 * 1024, verifyOnly);
    };
    const requirementsRef = ownedRef(pointer.requirementsRef, 'requirements.json'), policyRef = ownedRef(pointer.acceptancePolicyRef, 'acceptance-policy.json');
    let contract: ReturnType<typeof Native44RequirementContractSchema.parse>, policy: ReturnType<typeof Native44AcceptancePolicySchema.parse>, observation: ReturnType<typeof Native44AcceptanceObservationSchema.parse> | undefined;
    try { contract = Native44RequirementContractSchema.parse(await json(requirementsRef.path, 'owned', requirementsRef.sha256)); policy = Native44AcceptancePolicySchema.parse(await json(policyRef.path, 'owned', policyRef.sha256)); }
    catch (error) { if (error instanceof Error && error.message.startsWith('native44_current_')) throw error; fail('requirements_artifact_invalid'); }
    if (contract.taskId !== pointer.taskId || path.resolve(root, contract.sourceFacts.path) !== path.resolve(root, lock.inputs!.sourceFacts.path) || contract.sourceFacts.sha256 !== lock.inputs!.sourceFacts.sha256) fail('requirements_source_conflict');
    const sourceUnitsRef = ownedRef(pointer.sourceUnitsRef, 'source-units.json'), sourceUnits = await json(sourceUnitsRef.path, 'owned', sourceUnitsRef.sha256);
    const sourceBytes = (await read(lock.inputs!.sourceFacts.path, 'source', lock.inputs!.sourceFacts.sha256, 64 * 1024 * 1024)).bytes, planBytes = (await read(lock.inputs!.componentPlan.path, 'source', lock.inputs!.componentPlan.sha256, 64 * 1024 * 1024)).bytes;
    if (hashV2(sourceBytes) !== lock.inputs!.sourceFacts.sha256 || hashV2(planBytes) !== lock.inputs!.componentPlan.sha256) fail('requirements_source_changed_during_read');
    const source = JSON.parse(sourceBytes.toString('utf8')), sourcePlan = JSON.parse(planBytes.toString('utf8'));
    if (sourcePlan.sourceUnits !== undefined && canonicalV2(sourcePlan.sourceUnits) !== canonicalV2(sourceUnits)) fail('source_units_frozen_conflict');
    const programBytes = (await read(lock.program!.path, 'source', lock.program!.sha256, 64 * 1024 * 1024)).bytes; if (hashV2(programBytes) !== lock.program!.sha256) fail('requirements_program_changed_during_read'); const program = JSON.parse(programBytes.toString('utf8'));
    if (program.goalProfile !== undefined && program.goalProfile !== contract.goalProfile) fail('goal_profile_conflict');
    if (contract.goalProfile !== undefined && (!['native44-revision-request', 'native44-current-native-revision-request'].includes(lastRequest?.kind) || lastRequest?.kind === 'native44-current-native-revision-request' && lastRequest.version !== 2 || lastRequest?.taskId !== pointer.taskId || lastRequest?.runId !== pointer.runId || lastIntent?.goalProfile !== contract.goalProfile || path.resolve(root, lastIntent.requirementsRef?.path ?? '') !== requirementsRef.path || lastIntent.requirementsRef?.sha256 !== requirementsRef.sha256)) fail('goal_profile_explicit_request_missing');
    // Scope packets can predate this task's imported baselines. Admit only the
    // exact state-packet references of the contract's hash-bound scope proofs,
    // and only to the verifier which still checks raw ownership/selector/state.
    const scopeStatePackets = new Map<string, string>(), scopeProofs = new Map<string, ReturnType<typeof Native44SourceScopeEvidenceSchema.parse>>();
    for (const entry of contract.sourceScopes ?? []) {
      if (entry.classification !== 'outside-desktop') continue;
      const proofKey = canonicalV2(entry.evidence);
      if (!scopeProofs.has(proofKey)) scopeProofs.set(proofKey, Native44SourceScopeEvidenceSchema.parse(JSON.parse((await readRequirementEvidence(entry.evidence)).bytes.toString('utf8'))));
      const proof = scopeProofs.get(proofKey)!;
      if (proof.classification !== entry.classification || !sameCurrentReference(root, proof.sourceFacts, contract.sourceFacts)) fail('requirements_source_scope_identity_conflict');
      for (const baseline of proof.baselines) for (const state of baseline.states) scopeStatePackets.set(path.resolve(root, state.packet.path), state.packet.sha256);
    }
    const sourceScopes = await verifyNative44SourceScopes(contract, source, async reference => {
      const filename = path.resolve(root, reference.path);
      if (scopeStatePackets.get(filename) === reference.sha256) {
        if (!filename.endsWith('.json')) fail('requirement_evidence_family_invalid');
        return (await read(filename, 'source', reference.sha256, 64 * 1024 * 1024)).bytes;
      }
      return (await readRequirementEvidence(reference)).bytes;
    });
    try { validateNative44Requirements(contract, { source, sourceUnits, components: program.blocks, sourceFactsHash: lock.inputs!.sourceFacts.sha256, sourceScopes }); } catch { fail('requirements_coverage_invalid'); }
    for (const requirement of contract.requirements) {
      for (const check of requirement.checks) for (const reference of check.sourceEvidence) await readRequirementEvidence(reference, true);
      if (requirement.fulfillment.route !== 'gap') {
        const proofFile = await readRequirementEvidence(requirement.fulfillment.proof);
        let proof: ReturnType<typeof assertNative44CapabilityProof>; try { proof = assertNative44CapabilityProof(requirement, JSON.parse(proofFile.bytes.toString('utf8')), program.blocks); } catch { fail('requirements_capability_proof_invalid'); }
        for (const reference of proof.evidence) await readRequirementEvidence(reference, true);
      }
      if (requirement.fulfillment.route === 'explicit-adaptation') for (const reference of requirement.fulfillment.sourceEvidence) await readRequirementEvidence(reference, true);
    }
    for (const deviation of policy.acceptedDeviations) for (const reference of deviation.evidence) await readRequirementEvidence(reference, true);
    if (pointer.acceptanceObservationRef !== undefined) { const observationRef = ownedRef(pointer.acceptanceObservationRef, 'acceptance-observation.json'); try { observation = Native44AcceptanceObservationSchema.parse(await json(observationRef.path, 'owned', observationRef.sha256)); } catch (error) { if (error instanceof Error && error.message.startsWith('native44_current_')) throw error; fail('acceptance_observation_invalid'); } }
    let acceptance = evaluateNative44Acceptance(contract, policy, observation, { documentHash: pointer.documentHash, cssHash: compiled.canonicalSha256, sourceScopes });
    const actualChecks: Native44ActualCheckResult[] = [];
    const review: Native44CurrentAxes['review'] = { status: 'not-run', automated: 'not-run' };
    let verification: Native44CurrentRef | undefined, visualReview: Native44CurrentRef | undefined;
    if (pointer.verification !== undefined || pointer.visualReview !== undefined) {
      verification = ref(pointer.verification, 'review', `${path.sep}report.json`); visualReview = ref(pointer.visualReview, 'review', `${path.sep}visual-reviews.json`);
      if (path.dirname(verification.path) !== path.dirname(visualReview.path) || path.dirname(path.dirname(verification.path)) !== path.join(root, 'runs')) fail('review_owner_conflict');
      const rawReport = await json(verification.path, 'review', verification.sha256), reviews = await json(visualReview.path, 'review', visualReview.sha256);
      let reviewManifest = manifest;
      if (rawReport?.currentManifest !== undefined) {
        const reference = ownedRef(rawReport.currentManifest, 'compare-manifest.json');
        if (!pointer.amendments.some((step: Native44AmendmentStep) => path.dirname(path.resolve(root, step.intent.path)) === path.dirname(reference.path))) fail('review_manifest_owner_conflict');
        reviewManifest = await json(reference.path, 'owned', reference.sha256);
        const saved = await snapshot(path.join(path.dirname(reference.path), 'after.json'), reviewManifest.documentHash);
        if (reviewManifest.taskId !== pointer.taskId || reviewManifest.runId !== pointer.runId || reviewManifest.pageId !== pointer.pageId || canonicalV2(reviewManifest.releaseLock) !== canonicalV2(journal.releaseLock) || Object.entries(fingerprintNative44Snapshot(saved)).some(([key, value]) => reviewManifest[key] !== value)) fail('review_manifest_conflict');
        validateNative44CompareManifest(reviewManifest, journal.selectionRulesHash);
      }
      const report = normalizeNative44CurrentReviewReport(rawReport, reviewManifest);
      if (!object(report) || report.version !== 1 || !['explicit-user-component-and-css-review', 'native44-current-review'].includes(report.kind) || report.pageId !== pointer.pageId || report.runId !== pointer.runId || !isHashV2(report.documentHash) || !object(report.css) || !isHashV2(report.css.expectedHash) || !isHashV2(report.css.actualHash) || report.metrics?.documentWrites !== 0 || report.metrics?.editorSessions !== 0 || report.metrics?.viewports !== 2 || !Number.isFinite(Date.parse(report.observedAt)) || !Array.isArray(report.captures) || report.captures.length !== 2 || !Array.isArray(reviews) || reviews.length !== 2) fail('verification_conflict');
      const viewports = new Set<string>(); let passed = true;
      let timely = Date.parse(report.observedAt) >= Date.parse(lastConfirmedAt);
      for (const capture of report.captures) {
        if (!object(capture) || !['desktop-wide', 'desktop-narrow'].includes(capture.viewport) || viewports.has(capture.viewport) || !Array.isArray(capture.interactions) || !Array.isArray(capture.queries)) fail('verification_viewport_invalid'); viewports.add(capture.viewport);
        for (const [kind, checks] of [['interaction', capture.interactions], ['product-query', capture.queries]] as const) for (const check of checks) { if (!object(check) || check.viewport !== capture.viewport || !['passed', 'failed', 'blocked', 'unverified', 'skipped'].includes(check.status) || !Array.isArray(check.problems) || check.status === 'passed' && check.problems.length) fail('verification_checks_invalid'); if (check.status !== 'passed') passed = false; actualChecks.push({ kind, viewport: check.viewport, status: check.status, problems: check.problems, ...(typeof check.requirementId === 'string' ? { requirementId: check.requirementId } : {}), ...(typeof check.componentKey === 'string' ? { componentKey: check.componentKey } : {}), ...(typeof check.widgetType === 'string' ? { widgetType: check.widgetType } : {}), ...(typeof check.selector === 'string' ? { selector: check.selector } : {}), ...(typeof check.collectionPath === 'string' ? { collectionPath: check.collectionPath } : {}), evidence: [verification] }); }
        const item = reviews.find((item: any) => item.viewport === capture.viewport);
        if (!object(item) || item.documentHash !== report.documentHash || !['reviewed', 'passed', 'failed'].includes(item.verdict) || !Number.isFinite(Date.parse(item.observedAt))) fail('visual_review_conflict');
        timely &&= Date.parse(item.observedAt) >= Date.parse(lastConfirmedAt);
        const viewport = manifest.viewports?.find((view: any) => view.name === capture.viewport), sourceViewport = source.snapshots.find((snapshot: any) => snapshot.viewport.width === viewport?.width && snapshot.viewport.height === viewport?.height)?.viewport;
        if (!viewport) fail('visual_image_dimensions_invalid');
        for (const [kind, field] of [['sourceScreenshot', 'sourceScreenshotHash'], ['targetScreenshot', 'targetScreenshotHash']] as const) {
          const screenshot = ref(capture[kind], 'review', path.extname(capture[kind]?.path ?? '')); if (!/\.(?:png|jpg|jpeg|webp)$/.test(screenshot.path) || path.dirname(screenshot.path) !== path.dirname(verification.path) || item[field] !== screenshot.sha256) fail('visual_screenshot_conflict');
          const pixels = await read(screenshot.path, 'review', screenshot.sha256, 64 * 1024 * 1024);
          const metadata = await decodedReviewMetadata(root, pixels);
          const dpr = capture.devicePixelRatio ?? sourceViewport?.devicePixelRatio ?? 1, widths = [viewport.width, sourceViewport?.clientWidth].filter(Number.isFinite).map((width: number) => width * dpr);
          if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1 || !Number.isFinite(dpr) || dpr <= 0 || dpr > 4 || !widths.some(width => Math.abs(width - (metadata.width ?? 0)) <= 1) || (metadata.height ?? 0) < viewport.height * dpr) fail('visual_image_dimensions_invalid');
        }
        const expectedQueries = reviewManifest.productChecks ?? [], key = (value: any) => canonicalV2([value.componentKey, value.widgetType, value.collectionPath ?? '', value.selector, value.expectedProductIds]);
        if (capture.queries.length !== expectedQueries.length || new Set(capture.queries.map(key)).size !== capture.queries.length || capture.queries.some((query: any) => !expectedQueries.some((expected: any) => key(expected) === key(query))) || report.documentHash === pointer.documentHash && new Set(expectedQueries.map((check: any) => check.componentKey)).size < counts.productWidgets) fail('verification_product_coverage_invalid');
        for (const item of currentPostChecks(capture, reviewManifest.postChecks ?? [], report.documentHash === pointer.documentHash ? postWidgetCount : 0)) {
          if (!item.passed) passed = false;
          actualChecks.push({ kind: 'post-query', componentKey: item.check.componentKey, selector: item.check.selector, widgetType: 'wd_blog', viewport: capture.viewport, status: item.passed ? 'passed' : 'failed', problems: item.passed ? [] : ['Actual native blog records, links, images or layout do not match its target published-post query.'], evidence: [verification] });
        }
        for (const expected of reviewManifest.interactionChecks ?? []) if ((!expected.viewports || expected.viewports.includes(capture.viewport)) && !capture.interactions.some((check: any) => check.componentKey === expected.componentKey && check.widgetType === expected.widgetType && check.selector === expected.selector)) { passed = false; actualChecks.push({ kind: 'interaction', ...expected, viewport: capture.viewport, status: 'missing', problems: ['Required native owner has no actual interaction observation at this viewport.'], evidence: [verification] }); }
        for (const expected of reviewManifest.disclosureChecks?.filter((check: Native44DisclosureCheck) => !check.viewports || check.viewports.includes(capture.viewport)) ?? []) {
          const rows = Array.isArray(capture.disclosures) ? capture.disclosures.filter((row: any) => object(row) && row.componentKey === expected.componentKey && row.viewport === capture.viewport) : [];
          const valid = rows.length === 1 && Array.isArray(rows[0].problems) && Array.isArray(rows[0].actions) && native44DisclosureEvidencePassed(rows[0], expected);
          if (!valid) passed = false;
          actualChecks.push({ kind: 'interaction', ...expected, viewport: capture.viewport, status: valid ? 'passed' : rows.length ? 'failed' : 'missing', problems: valid ? [] : ['Required native disclosure lacks complete click, keyboard, ARIA, visibility and restoration proof.'], evidence: [verification] });
        }
        for (const expected of reviewManifest.tabsChecks?.filter((check: Native44TabsCheck) => !check.viewports || check.viewports.includes(capture.viewport)) ?? []) {
          const rows = Array.isArray(capture.tabs) ? capture.tabs.filter((row: any) => object(row) && row.componentKey === expected.componentKey && row.viewport === capture.viewport) : [];
          const valid = rows.length === 1 && Array.isArray(rows[0].problems) && Array.isArray(rows[0].actions) && native44TabsEvidencePassed(rows[0], expected);
          if (!valid) passed = false;
          actualChecks.push({ kind: 'interaction', ...expected, viewport: capture.viewport, status: valid ? 'passed' : rows.length ? 'failed' : 'missing', problems: valid ? [] : ['Required native tabs lack complete selection, keyboard, ARIA, panel visibility and restoration proof.'], evidence: [verification] });
        }
      }
      const current = timely && report.documentHash === pointer.documentHash && report.documentUnchanged === true && report.css.applied === true && report.css.expectedHash === compiled.canonicalSha256 && report.css.actualHash === compiled.canonicalSha256;
      Object.assign(review, { status: current ? 'reviewed' : 'stale', automated: passed ? 'passed' : 'has-failures', observedAt: report.observedAt, documentHash: report.documentHash });
    }
    if (observation) {
      if (!verification || !visualReview || canonicalV2({ path: path.resolve(root, observation.review.verification.path), sha256: observation.review.verification.sha256 }) !== canonicalV2(verification) || canonicalV2({ path: path.resolve(root, observation.review.visualReview.path), sha256: observation.review.visualReview.sha256 }) !== canonicalV2(visualReview)) fail('acceptance_review_conflict');
      for (const check of observation.checks) for (const reference of check.evidence) await readRequirementEvidence(reference, true);
    }
    if (review.status === 'reviewed') acceptance = applyNative44ActualCheckResults(contract, policy, acceptance, actualChecks);
    const complete = review.status === 'reviewed' && acceptance.draftReady && acceptance.qualityFloor.status === 'passed' && acceptance.delivery !== 'pending', delivery = { status: complete ? acceptance.delivery : 'pending', complete, requirementsComplete: acceptance.requirementsComplete } as Native44CurrentAxes['delivery'];
    const axes: Native44CurrentAxes = { write: { status: 'confirmed', documentHash: pointer.documentHash }, remote: { status: 'not-freshly-observed', basis: 'local-snapshot-only' }, css: { status: 'applied', canonicalHash: compiled.canonicalSha256, model: cssModel }, review, requirements: acceptance, delivery };
    return { ...state, status: complete ? delivery.status as 'delivered' | 'delivered-with-deviations' | 'delivered-with-open-items' : review.status === 'stale' || acceptance.status === 'stale' ? 'stale-review' : review.status === 'reviewed' ? acceptance.status === 'blocked' ? 'reviewed-with-gaps' : 'pending-requirements' : 'pending-css-review', ...(contract.goalProfile ? { goalProfile: contract.goalProfile } : {}), draftReady: acceptance.draftReady, requirementsComplete: acceptance.requirementsComplete, deliveryComplete: complete, visualVerification: review.status === 'stale' ? 'stale' : review.status === 'reviewed' ? complete && acceptance.requirementsComplete ? 'applied-verified' : 'reviewed-with-gaps' : 'pending-comparison', currentManifest, cssModel, axes, observedAt: pointer.recordedAt, ...(review.observedAt ? { reviewedAt: review.observedAt } : {}), ...(verification ? { verification, visualReview } : {}) };
  }
  if (pointer.status === 'reviewed-current-capture') {
    const recordRef = ref(pointer.currentCaptureReview, 'owned', `${path.sep}current-capture-review.json`);
    const record = Native44CurrentCaptureReviewSchema.parse(await json(recordRef.path, 'owned', recordRef.sha256));
    if (record.taskId !== pointer.taskId || record.runId !== pointer.runId || record.pageId !== pointer.pageId || record.documentHash !== pointer.documentHash || canonicalV2(record.currentSnapshot) !== canonicalV2(currentSnapshot) || canonicalV2(record.currentCSS) !== canonicalV2(currentCSS)) fail('capture_review_identity_conflict');
    const parent = await json(path.join(path.dirname(recordRef.path), 'parent-pointer.json'), 'owned', record.parentPointerHash), requestRef = ref(record.request, 'owned', `${path.sep}request.json`), request = Native44CurrentCaptureReviewRequestSchema.parse(await json(requestRef.path, 'owned', requestRef.sha256));
    const withoutReview = (value: Record<string, any>) => Object.fromEntries(Object.entries(value).filter(([key]) => !['status', 'verification', 'visualReview', 'currentCaptureReview', 'reviewedAt', 'reviewStatus'].includes(key)));
    if (path.dirname(requestRef.path) !== path.dirname(recordRef.path) || parent.version !== 1 || parent.kind !== pointer.kind || canonicalV2(withoutReview(parent)) !== canonicalV2(withoutReview(pointer)) || request.expectedPointerHash !== record.parentPointerHash || request.taskId !== record.taskId || request.runId !== record.runId || request.pageId !== record.pageId || request.documentHash !== record.documentHash || request.userInstruction !== record.userInstruction || canonicalV2(request.notes) !== canonicalV2(record.notes) || canonicalV2(request.gapReviews) !== canonicalV2(record.gapReviews) || canonicalV2({ path: path.resolve(root, request.report.path), sha256: request.report.sha256 }) !== canonicalV2(record.report) || canonicalV2({ path: path.resolve(root, request.visualReview.path), sha256: request.visualReview.sha256 }) !== canonicalV2(record.visualReview)) fail('capture_review_request_conflict');
    const verification = ref(record.report, 'review', `${path.sep}report.json`), visualReview = ref(record.visualReview, 'review', `${path.sep}visual-reviews.json`), currentManifest = ref(record.manifest, 'review', `${path.sep}compare-manifest.json`);
    if (path.dirname(verification.path) !== path.dirname(visualReview.path) || path.dirname(verification.path) !== path.dirname(currentManifest.path) || path.dirname(path.dirname(verification.path)) !== path.join(root, 'runs') || canonicalV2(pointer.verification) !== canonicalV2(verification) || canonicalV2(pointer.visualReview) !== canonicalV2(visualReview)) fail('capture_review_owner_conflict');
    const raw = await json(verification.path, 'review', verification.sha256), reviews = await json(visualReview.path, 'review', visualReview.sha256), manifest = await json(currentManifest.path, 'review', currentManifest.sha256) as Native44CompareManifest;
    if (!journal.releaseLock) fail('capture_review_release_missing');
    const lock = await readNative44HistoricalReleaseEvidence(root, journal.releaseLock, { taskId: pointer.taskId, programHash: journal.programHash });
    validateNative44CompareManifest(manifest, journal.selectionRulesHash);
    if (manifest.taskId !== pointer.taskId || manifest.runId !== pointer.runId || manifest.pageId !== pointer.pageId || canonicalV2(manifest.releaseLock) !== canonicalV2(journal.releaseLock) || Object.entries(fingerprintNative44Snapshot(actual)).some(([key, value]) => manifest[key as keyof Native44CompareManifest] !== value) || raw?.kind !== undefined || canonicalV2(raw?.currentManifest) !== canonicalV2(currentManifest)) fail('capture_review_manifest_conflict');
    const baselineManifestRef = state.currentManifest ?? await (async () => { const file = await read(path.join(runDir, 'compare-manifest.json'), 'owned'); return { path: file.path, sha256: file.sha256 }; })();
    const baselineManifest = await json(baselineManifestRef.path, 'owned', baselineManifestRef.sha256);
    if (canonicalV2(baselineManifest) !== canonicalV2(manifest)) fail('capture_review_baseline_manifest_conflict');
    const report = normalizeNative44CurrentReviewReport(raw, manifest), cssHash = native44CSSHash(canonicalNative44CSS(css.bytes.toString('utf8')));
    if (report.documentHash !== pointer.documentHash || report.documentUnchanged !== true || report.css.applied !== true || report.css.expectedHash !== cssHash || report.css.actualHash !== cssHash || report.captures.length !== 2 || !Array.isArray(reviews) || reviews.length !== 2 || !Number.isFinite(Date.parse(raw.startedAt)) || Date.parse(raw.startedAt) > Date.parse(report.observedAt) || Date.parse(record.recordedAt) < Date.parse(report.observedAt) || lastLegacyObservedAt && Date.parse(raw.startedAt) < Date.parse(lastLegacyObservedAt)) fail('capture_review_stale');
    const sourceRef = lock.inputs!.sourceFacts, sourceFile = await read(path.resolve(root, sourceRef.path), 'source', sourceRef.sha256, 64 * 1024 * 1024), source = JSON.parse(sourceFile.bytes.toString('utf8'));
    const issues: string[] = [], viewports = new Set<string>(), noteEvidence = [...Object.values(record.notes).flatMap(entries => entries.flatMap(entry => entry.evidence)), ...record.gapReviews.flatMap(gap => gap.evidence)]; let automatedPassed = true;
    for (const reference of noteEvidence) {
      const filename = path.resolve(root, reference.path), relativeTask = path.relative(path.join(root, 'references', pointer.taskId), filename), relativeRun = path.relative(runDir, filename), relativeReview = path.relative(path.dirname(verification.path), filename);
      if (![relativeTask, relativeRun, relativeReview].some(relative => relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) fail('capture_review_note_owner_conflict');
      await read(filename, filename.startsWith(path.join(root, 'references') + path.sep) ? 'source' : 'review', reference.sha256, 64 * 1024 * 1024);
    }
    for (const capture of report.captures) {
      if (!['desktop-wide', 'desktop-narrow'].includes(capture.viewport) || viewports.has(capture.viewport)) fail('capture_review_viewport_invalid'); viewports.add(capture.viewport);
      const view = manifest.viewports?.find(view => view.name === capture.viewport), sourceCapture = raw.captures.find((item: any) => item.viewport === capture.viewport), frozen = source.snapshots.find((item: any) => item.id === sourceCapture?.source?.snapshotId), review = reviews.find((item: any) => item.viewport === capture.viewport);
      if (!view || !frozen || frozen.viewport.width !== view.width || frozen.viewport.height !== view.height || frozen.screenshot.sha256 !== capture.sourceScreenshot.sha256 || !object(review) || review.documentHash !== pointer.documentHash || !['passed', 'failed'].includes(review.verdict) || typeof review.notes !== 'string' || review.notes.trim().length < 20 || !Number.isFinite(Date.parse(review.observedAt)) || Date.parse(review.observedAt) < Date.parse(report.observedAt) || Date.parse(review.observedAt) > Date.parse(record.recordedAt)) fail('capture_review_visual_invalid');
      if (review.verdict !== 'passed') issues.push(`${capture.viewport}: actual visual review failed.`);
      for (const [kind, field] of [['sourceScreenshot', 'sourceScreenshotHash'], ['targetScreenshot', 'targetScreenshotHash']] as const) {
        const screenshot = ref(capture[kind], 'review', path.extname(capture[kind]?.path ?? ''));
        if (!/\.(?:png|jpg|jpeg|webp)$/.test(screenshot.path) || path.dirname(screenshot.path) !== path.dirname(verification.path) || screenshot.sha256 !== review[field]) fail('capture_review_screenshot_conflict');
        const pixels = await read(screenshot.path, 'review', screenshot.sha256, 64 * 1024 * 1024);
        const metadata = await decodedReviewMetadata(root, pixels);
        const dpr = kind === 'sourceScreenshot' ? frozen.viewport.devicePixelRatio ?? 1 : sourceCapture.target.devicePixelRatio ?? capture.devicePixelRatio ?? 1;
        const widths = [view.width, kind === 'sourceScreenshot' ? frozen.viewport.clientWidth : sourceCapture.target.clientWidth].filter(Number.isFinite).map((width: number) => width * dpr);
        if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1 || !Number.isFinite(dpr) || dpr <= 0 || dpr > 4 || !widths.some(width => Math.abs(width - (metadata.width ?? 0)) <= 1) || (metadata.height ?? 0) < view.height * dpr) fail('visual_image_dimensions_invalid');
      }
      const expectedQueries = manifest.productChecks ?? [], key = (value: any) => canonicalV2([value.componentKey, value.widgetType, value.collectionPath ?? '', value.selector, value.expectedProductIds]);
      if (capture.queries.length !== expectedQueries.length || new Set(capture.queries.map(key)).size !== capture.queries.length || capture.queries.some((query: any) => !expectedQueries.some(expected => key(query) === key(expected))) || new Set(expectedQueries.map(check => check.componentKey)).size < counts.productWidgets) fail('verification_product_coverage_invalid');
      for (const item of currentPostChecks(capture, manifest.postChecks ?? [], postWidgetCount)) if (!item.passed) { automatedPassed = false; issues.push(`${capture.viewport}/post-query/${item.check.componentKey}: actual native post query or visible layout proof failed.`); }
      for (const [kind, checks] of [['interaction', capture.interactions], ['product-query', capture.queries]] as const) for (const check of checks) {
        if (!object(check) || check.viewport !== capture.viewport || !['passed', 'failed', 'blocked', 'unverified', 'skipped'].includes(check.status) || !Array.isArray(check.problems) || check.status === 'passed' && check.problems.length) fail('verification_checks_invalid');
        if (check.status !== 'passed') { automatedPassed = false; issues.push(`${capture.viewport}/${kind}/${check.componentKey ?? check.selector}: ${check.status}; ${check.problems.join('; ')}`); }
      }
      for (const expected of manifest.interactionChecks ?? []) if ((!expected.viewports || expected.viewports.includes(capture.viewport)) && !capture.interactions.some((check: any) => check.componentKey === expected.componentKey && check.widgetType === expected.widgetType && check.selector === expected.selector)) { automatedPassed = false; issues.push(`${capture.viewport}/${expected.componentKey}: required native interaction was not observed.`); }
      for (const expected of manifest.disclosureChecks?.filter(check => !check.viewports || check.viewports.includes(capture.viewport)) ?? []) {
        const rows = Array.isArray(capture.disclosures) ? capture.disclosures.filter((row: any) => object(row) && row.componentKey === expected.componentKey && row.viewport === capture.viewport) : [];
        if (rows.length !== 1 || !Array.isArray(rows[0].problems) || !Array.isArray(rows[0].actions) || !native44DisclosureEvidencePassed(rows[0], expected)) { automatedPassed = false; issues.push(`${capture.viewport}/${expected.componentKey}: required native disclosure click, keyboard, ARIA, visibility or restoration proof is missing or failed.`); }
      }
      for (const expected of manifest.tabsChecks?.filter(check => !check.viewports || check.viewports.includes(capture.viewport)) ?? []) {
        const rows = Array.isArray(capture.tabs) ? capture.tabs.filter((row: any) => object(row) && row.componentKey === expected.componentKey && row.viewport === capture.viewport) : [];
        if (rows.length !== 1 || !Array.isArray(rows[0].problems) || !Array.isArray(rows[0].actions) || !native44TabsEvidencePassed(rows[0], expected)) { automatedPassed = false; issues.push(`${capture.viewport}/${expected.componentKey}: required native tabs selection, keyboard, ARIA, panel visibility or restoration proof is missing or failed.`); }
      }
    }
    if (!Array.isArray(raw.gaps) || raw.gaps.some((gap: any) => !object(gap) || typeof gap.detail !== 'string' || typeof gap.blocking !== 'boolean')) fail('capture_review_gaps_invalid');
    const reviewedGapHashes = new Set<string>(), notes = structuredClone(record.notes);
    for (const decision of record.gapReviews) {
      const gap = raw.gaps.find((gap: any) => hashV2(canonicalV2(gap)) === decision.gapHash), module = manifest.modules.find(module => module.key === decision.moduleKey), capture = raw.captures.find((capture: any) => capture.viewport === decision.viewport), sourceModule = capture?.source?.modules?.find((item: any) => item.key === decision.moduleKey), targetModule = capture?.target?.modules?.find((item: any) => item.key === decision.moduleKey);
      const owners: ElementorElement[] = [], find = (nodes: ElementorElement[]) => { for (const node of nodes) { if ([node.settings?.css_classes, node.settings?._css_classes].filter(value => typeof value === 'string').join(' ').split(/\s+/).includes(module?.className ?? '')) owners.push(node); find(node.elements ?? []); } }; find(actual.elements);
      const ownerIds = new Set<string>(), collect = (nodes: ElementorElement[]) => { for (const node of nodes) { ownerIds.add(node.id); collect(node.elements ?? []); } }; if (owners.length === 1) collect(owners);
      const ownsInteraction = (manifest.interactionChecks ?? []).some(check => check.componentKey.startsWith(decision.moduleKey) || [...check.selector.matchAll(/\[data-id=["']([^"']+)["']\]/g)].some(match => ownerIds.has(match[1])));
      if (reviewedGapHashes.has(decision.gapHash) || !gap || gap.category !== decision.category || gap.moduleKey !== decision.moduleKey || gap.viewport !== decision.viewport || gap.blocking !== true || gap.detail !== 'Source and target carousel logical positions differ' || !module || owners.length !== 1 || owners[0].elType !== 'container' || targetModule?.carouselRuntimeCount !== 0 || sourceModule?.state?.carouselIndex === undefined || targetModule?.state?.carouselIndex !== undefined || !sourceModule?.visible || !targetModule?.visible || !Array.isArray(sourceModule.media) || !sourceModule.media.length || sourceModule.media.length !== targetModule?.media?.length || ownsInteraction) fail('capture_review_gap_not_minor_implementation');
      const sourceSnapshotId = capture.source.snapshotId, sourceSnapshot = source.snapshots.find((snapshot: any) => snapshot.id === sourceSnapshotId), sourceOwners = module.sourceVariants?.find(variant => variant.viewport === decision.viewport)?.nodeIds ?? Object.entries(sourceSnapshot?.nodes ?? {}).filter(([, node]: [string, any]) => node.selector === module.sourceSelector).map(([id]) => id);
      await assertNative44NoninteractiveSourceLayout(source, sourceSnapshotId, sourceOwners, async reference => (await read(path.resolve(root, reference.path), 'source', reference.sha256, 64 * 1024 * 1024)).bytes);
      reviewedGapHashes.add(decision.gapHash);
      notes.minorIssues.push({ domain: 'decoration', region: `${decision.moduleKey} / ${decision.viewport}`, issue: gap.detail, impact: decision.reason, nextAction: 'Retain the editable static native layout. Revisit only if a visible carousel control or actual layout/interaction requirement changes.', evidence: [...decision.evidence, verification] });
    }
    // The capture engine emits this exact placeholder before Codex inspects
    // the pixels. Both complete hash/time-bound reviews were validated above;
    // consuming that placeholder must not waive any other evidence defect.
    const consumedVisualReviewPlaceholder = (gap: any) => gap.category === 'evidence' && gap.blocking === true && gap.detail === 'The required desktop screenshots have no complete hash-bound Codex visual review' && Object.keys(gap).sort().join(',') === 'blocking,category,detail';
    for (const gap of raw.gaps) if (gap.blocking && !reviewedGapHashes.has(hashV2(canonicalV2(gap))) && !consumedVisualReviewPlaceholder(gap)) { automatedPassed = false; issues.push(`${gap.viewport ?? 'page'}/${gap.category ?? 'capture'}: ${gap.detail}`); }
    for (const gap of raw.gaps) if (!gap.blocking) notes.unverified.push({ domain: 'requirements-coverage', region: `${gap.moduleKey ?? 'page'} / ${gap.viewport ?? 'desktop'}`, issue: gap.detail, impact: 'The standard capture retained this named nonblocking limitation; the importer does not silently remove it.', nextAction: 'Keep this limitation visible and investigate it only when the affected requirement is in scope.', evidence: [verification] });
    for (const note of record.notes.unfinished) if (note.domain !== 'supporting-integration') issues.push(`${note.region}: ${note.issue}`);
    for (const note of record.notes.unverified) if (note.domain === 'quality-floor') issues.push(`${note.region}: ${note.issue}`);
    const ready = issues.length === 0;
    const currentCaptureReview: Native44CurrentCaptureReviewState = { reviewGoal: record.reviewGoal, frozenContractPreserved: true, requirementsComplete: false, review: 'reviewed', automated: automatedPassed ? 'passed' : 'has-failures', qualityFloor: { status: ready ? 'satisfied' : 'blocked', issues: [...new Set(issues)] }, draftReady: ready, deliveryReady: ready, canonicalCSSHash: cssHash, record: recordRef, notes };
    return { ...state, status: ready ? 'delivered-with-open-items' : 'reviewed-with-gaps', deliveryComplete: false, requirementsComplete: false, draftReady: ready, visualVerification: ready ? 'applied-verified' : 'reviewed-with-gaps', verification, visualReview, currentManifest: baselineManifestRef, reviewedAt: report.observedAt, observedAt: record.recordedAt, currentCaptureReview };
  }
  if (pointer.currentCaptureReview !== undefined) fail('capture_review_status_conflict');
  if (pointer.status !== 'completed') return state;
  const verification = ref(pointer.verification, 'review', `${path.sep}report.json`), visualReview = ref(pointer.visualReview, 'review', `${path.sep}visual-reviews.json`);
  if (path.dirname(verification.path) !== path.dirname(visualReview.path) || path.dirname(path.dirname(verification.path)) !== path.join(root, 'runs')) fail('review_owner_conflict');
  const report = await json(verification.path, 'review', verification.sha256), reviews = await json(visualReview.path, 'review', visualReview.sha256);
  const canonicalCSSHash = native44CSSHash(canonicalNative44CSS(css.bytes.toString('utf8')));
  if (!object(report) || report.version !== 1 || report.kind !== 'explicit-user-component-and-css-review' || report.pageId !== pointer.pageId || report.runId !== pointer.runId || report.documentHash !== pointer.documentHash || report.documentUnchanged !== true || report.css?.applied !== true || report.css.expectedHash !== canonicalCSSHash || report.css.actualHash !== canonicalCSSHash || report.nativeProductSlots !== counts.productWidgets || report.metrics?.documentWrites !== 0 || report.metrics?.editorSessions !== 0 || report.metrics?.viewports !== 2 || !Array.isArray(report.captures) || report.captures.length !== 2 || !Array.isArray(reviews) || reviews.length !== 2) fail('verification_conflict');
  const views = new Set<string>();
  for (const capture of report.captures) {
    if (!object(capture) || !['desktop-wide', 'desktop-narrow'].includes(capture.viewport) || views.has(capture.viewport)) fail('verification_viewport_invalid'); views.add(capture.viewport);
    if (!Array.isArray(capture.interactions) || !capture.interactions.length || capture.interactions.some((check: any) => check.viewport !== capture.viewport || check.status !== 'passed' || !Array.isArray(check.problems) || check.problems.length) || !Array.isArray(capture.queries) || capture.queries.length !== counts.productWidgets || capture.queries.some((check: any) => check.viewport !== capture.viewport || check.status !== 'passed' || !Array.isArray(check.problems) || check.problems.length)) fail('verification_checks_failed');
    if (postWidgetCount) fail('legacy_verification_has_no_native_blog_query_proof');
    const review = reviews.find((item: any) => item.viewport === capture.viewport);
    if (!object(review) || review.documentHash !== pointer.documentHash || review.verdict !== 'reviewed' || !Number.isFinite(Date.parse(review.observedAt)) || !Number.isFinite(Date.parse(report.observedAt))) fail('visual_review_conflict');
    for (const [kind, hashField] of [['sourceScreenshot', 'sourceScreenshotHash'], ['targetScreenshot', 'targetScreenshotHash']] as const) {
      const screenshot = ref(capture[kind], 'review', path.extname(capture[kind]?.path ?? ''));
      if (!/\.(?:png|jpg|jpeg|webp)$/.test(screenshot.path) || path.dirname(screenshot.path) !== path.dirname(verification.path) || review[hashField] !== screenshot.sha256) fail('visual_screenshot_conflict');
      await read(screenshot.path, 'review', screenshot.sha256, 64 * 1024 * 1024);
    }
  }
  if (!Number.isFinite(Date.parse(pointer.completedAt))) fail('completion_time_invalid');
  return { ...state, status: 'delivered', deliveryComplete: true, visualVerification: 'applied-verified', verification, visualReview };
}

export interface BuildNative44CurrentRevisionPointerInput {
  previous?: Record<string, any>;
  identity?: { taskId: string; runId: string; pageId: number; beforeHash: string };
  step: Native44AmendmentStep; documentHash: string; currentSnapshot: Native44CurrentRef; currentCSS: Native44CurrentRef;
  counts: Native44CurrentCounts; requestedScope: string; recordedAt: string;
  cssModelRef: Native44CurrentRef; manifestRef: Native44CurrentRef; sourceUnitsRef: Native44CurrentRef; requirementsRef: Native44CurrentRef; acceptancePolicyRef: Native44CurrentRef;
  acceptanceObservationRef?: Native44CurrentRef | null; verification?: Native44CurrentRef | null; visualReview?: Native44CurrentRef | null;
  nativeReplacementRecords?: Native44CurrentRef[];
}
/** Pure construction only. Call validateNative44CurrentRevisionPointer against
 * immutable on-disk evidence before atomically publishing the returned index. */
export function buildNative44CurrentRevisionPointer(input: BuildNative44CurrentRevisionPointerInput): Native44CurrentRevisionPointer {
  const previous = input.previous, identity = previous ? { taskId: previous.taskId, runId: previous.runId, pageId: previous.pageId, beforeHash: previous.documentHash } : input.identity;
  if (!identity || !id(identity.taskId) || !id(identity.runId) || !Number.isSafeInteger(identity.pageId) || identity.pageId < 1 || !isHashV2(identity.beforeHash) || previous && (!(previous.version === 1 && previous.kind === 'completed-explicit-user-draft-amendment' || previous.version === 2 && previous.kind === 'native44-current-revision') || !Array.isArray(previous.amendments) || !previous.amendments.length) || input.step.beforeHash !== identity.beforeHash || input.step.afterHash !== input.documentHash || !isHashV2(input.documentHash) || typeof input.requestedScope !== 'string' || !input.requestedScope.trim() || input.requestedScope.length > 3000 || !Number.isFinite(Date.parse(input.recordedAt)) || ['containers', 'widgets', 'html', 'productWidgets'].some(key => !Number.isSafeInteger(input.counts?.[key as keyof Native44CurrentCounts]) || input.counts[key as keyof Native44CurrentCounts] < 0)) fail('revision_builder_identity_invalid');
  const verifyRef = (reference: Native44CurrentRef): Native44CurrentRef => { if (!object(reference) || Object.keys(reference).sort().join(',') !== 'path,sha256' || typeof reference.path !== 'string' || !reference.path.trim() || /[?\r\n]|^[a-z]+:\/\//i.test(reference.path) || !isHashV2(reference.sha256)) fail('revision_builder_reference_invalid'); return { ...reference }; };
  const pointer: Native44CurrentRevisionPointer = { version: 2, kind: 'native44-current-revision', taskId: identity.taskId, runId: identity.runId, pageId: identity.pageId, unpublished: true, documentHash: input.documentHash, cssApplied: true, requestedScope: input.requestedScope, recordedAt: input.recordedAt, counts: { ...input.counts }, amendments: [...structuredClone(previous?.amendments ?? []), { ...input.step, intent: verifyRef(input.step.intent), receipt: verifyRef(input.step.receipt) }], currentSnapshot: verifyRef(input.currentSnapshot), currentCSS: verifyRef(input.currentCSS), cssModelRef: verifyRef(input.cssModelRef), manifestRef: verifyRef(input.manifestRef), sourceUnitsRef: verifyRef(input.sourceUnitsRef), requirementsRef: verifyRef(input.requirementsRef), acceptancePolicyRef: verifyRef(input.acceptancePolicyRef) };
  for (const key of ['acceptanceObservationRef', 'verification', 'visualReview'] as const) { const value = input[key] === undefined ? previous?.[key] : input[key]; if (value !== undefined && value !== null) pointer[key] = verifyRef(value); }
  const nativeRecords = input.nativeReplacementRecords ?? previous?.nativeReplacementRecords;
  if (nativeRecords !== undefined) { if (!Array.isArray(nativeRecords) || !nativeRecords.length || new Set(nativeRecords.map((item: Native44CurrentRef) => item.path)).size !== nativeRecords.length) fail('revision_builder_native_record_inventory_invalid'); pointer.nativeReplacementRecords = nativeRecords.map(verifyRef); }
  if (Boolean(pointer.verification) !== Boolean(pointer.visualReview)) fail('revision_builder_review_pair_invalid');
  return pointer;
}
export function recordNative44CurrentRevisionReview(pointer: Native44CurrentRevisionPointer, input: { verification: Native44CurrentRef; visualReview: Native44CurrentRef; acceptanceObservationRef: Native44CurrentRef; recordedAt: string }): Native44CurrentRevisionPointer {
  if (pointer.version !== 2 || pointer.kind !== 'native44-current-revision' || !Number.isFinite(Date.parse(input.recordedAt))) fail('revision_review_identity_invalid');
  for (const reference of [input.verification, input.visualReview, input.acceptanceObservationRef]) if (!object(reference) || Object.keys(reference).sort().join(',') !== 'path,sha256' || typeof reference.path !== 'string' || !isHashV2(reference.sha256)) fail('revision_builder_reference_invalid');
  return { ...structuredClone(pointer), verification: { ...input.verification }, visualReview: { ...input.visualReview }, acceptanceObservationRef: { ...input.acceptanceObservationRef }, recordedAt: input.recordedAt };
}
export async function validateNative44CurrentRevisionPointer(root: string, runDir: string, pointer: Native44CurrentRevisionPointer): Promise<Native44CurrentState> {
  if (pointer.version !== 2 || pointer.kind !== 'native44-current-revision') fail('revision_candidate_version_invalid');
  const state = await readNative44CurrentStateLocal(root, runDir, undefined, pointer); if (!state) fail('revision_candidate_missing'); return state;
}

export async function validateNative44CurrentCaptureReviewPointer(root: string, runDir: string, pointer: Record<string, any>, options: { virtualEvidence?: ReadonlyMap<string, Buffer> } = {}): Promise<Native44CurrentState> {
  if (pointer.version !== 1 || pointer.kind !== 'completed-explicit-user-draft-amendment' || pointer.status !== 'reviewed-current-capture') fail('capture_review_candidate_invalid');
  if (options.virtualEvidence) {
    const absoluteRoot = await realpath(root), absoluteRun = await realpath(path.resolve(absoluteRoot, runDir)), recordPath = path.resolve(absoluteRoot, pointer.currentCaptureReview?.path ?? '');
    const recordBytes = options.virtualEvidence.get(recordPath); if (!recordBytes || options.virtualEvidence.size !== 3) fail('capture_review_virtual_invalid');
    const record = Native44CurrentCaptureReviewSchema.parse(JSON.parse(recordBytes.toString('utf8'))), requestPath = path.resolve(absoluteRoot, record.request.path), requestBytes = options.virtualEvidence.get(requestPath);
    if (!requestBytes) fail('capture_review_virtual_invalid');
    const request = Native44CurrentCaptureReviewRequestSchema.parse(JSON.parse(requestBytes.toString('utf8'))), folder = path.join(absoluteRun, 'amendments', `current-review-${hashV2(canonicalV2(request)).slice(0, 24)}`), expected = new Set(['request.json', 'parent-pointer.json', 'current-capture-review.json'].map(name => path.join(folder, name)));
    if (recordPath !== path.join(folder, 'current-capture-review.json') || requestPath !== path.join(folder, 'request.json')) fail('capture_review_virtual_owner_conflict');
    // A nonexistent virtual file must not conceal an existing junction in its
    // parent chain. Validate the closest existing ancestor before dry-run reads.
    let ancestor = folder;
    for (;;) { try { if (await realpath(ancestor) !== ancestor) fail('capture_review_virtual_owner_conflict'); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor || !parent.startsWith(absoluteRun + path.sep) && parent !== absoluteRun) fail('capture_review_virtual_owner_conflict'); ancestor = parent; } }
    for (const [filename, bytes] of options.virtualEvidence) {
      if (!expected.has(filename) || !Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024) fail('capture_review_virtual_invalid');
      try { if (await realpath(filename) !== filename || !(await readFile(filename)).equals(bytes)) fail('capture_review_virtual_conflict'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    root = absoluteRoot; runDir = absoluteRun;
  }
  const state = await readNative44CurrentStateLocal(root, runDir, undefined, pointer, options.virtualEvidence); if (!state?.currentCaptureReview) fail('capture_review_candidate_missing'); return state;
}

export async function validateNative44CurrentCSSRevisionPointer(root: string, runDir: string, pointer: Record<string, any>): Promise<Native44CurrentState> {
  if (pointer.version !== 1 || pointer.kind !== 'completed-explicit-user-draft-amendment' || pointer.status !== 'applied-pending-review' || pointer.currentManifest === undefined || pointer.currentCaptureReview !== undefined) fail('css_revision_candidate_invalid');
  const state = await readNative44CurrentStateLocal(root, runDir, undefined, pointer); if (!state?.currentManifest) fail('css_revision_candidate_missing'); return state;
}

/** A successor is an explicit user-authorized new draft, never a reassignment
 * of a published page or a migration of an old frozen program/journal. Every
 * hop binds the exact parent state, child journal and derivation request. */
export async function readNative44CurrentState(rootInput: string, runInput: string, identity?: { taskId?: string; runId?: string; pageId?: number; documentHash?: string }): Promise<Native44CurrentState | undefined> {
  const root = await realpath(rootInput), visited = new Set<string>();
  const resolve = async (run: string, expected?: typeof identity): Promise<Native44CurrentState | undefined> => {
    const runDir = await realpath(path.resolve(root, run)); within(path.join(root, 'runs'), runDir);
    if (path.dirname(runDir) !== path.join(root, 'runs') || !id(path.basename(runDir))) fail('run_path_invalid');
    const runId = path.basename(runDir); if (visited.has(runId) || visited.size >= 8) fail('successor_cycle_or_depth'); visited.add(runId);
    const local = await readNative44CurrentStateLocal(root, runDir, expected), pointerPath = path.join(runDir, 'current-successor.json');
    let bytes: Buffer;
    try { const actual = await realpath(pointerPath); if (actual !== pointerPath) fail('successor_reference_realpath_changed'); const info = await stat(actual); if (!info.isFile() || info.size > 32 * 1024) fail('successor_pointer_invalid'); bytes = await readFile(actual); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return local; throw error; }
    if (!local) fail('successor_parent_state_missing');
    let pointer: any; try { pointer = JSON.parse(bytes.toString('utf8')); } catch { fail('successor_pointer_invalid'); }
    if (!object(pointer) || pointer.version !== 1 || pointer.kind !== 'native44-current-draft-successor' || Object.keys(pointer).sort().join(',') !== 'authorization,kind,parentPageId,parentRunId,parentState,successorJournal,successorPageId,successorRunId,taskId,version' || pointer.taskId !== local.taskId || pointer.parentRunId !== runId || pointer.parentPageId !== local.pageId || !id(pointer.successorRunId) || !Number.isSafeInteger(pointer.successorPageId) || pointer.successorPageId < 1 || pointer.successorPageId === local.pageId) fail('successor_identity_invalid');
    if (visited.has(pointer.successorRunId)) fail('successor_cycle_or_depth');
    const childDir = path.join(root, 'runs', pointer.successorRunId), refs: CurrentStateEvidence[] = [{ path: pointerPath, sha256: hashV2(bytes), bytes: bytes.length, reason: 'Explicit user-authorized successor route; parent remains historical.' }];
    const boundJSON = async (reference: unknown, filename: string): Promise<any> => {
      if (!object(reference) || Object.keys(reference).sort().join(',') !== 'path,sha256' || typeof reference.path !== 'string' || !isHashV2(reference.sha256) || path.resolve(root, reference.path) !== filename || /[?\r\n]|^[a-z]+:\/\//i.test(reference.path)) fail('successor_reference_invalid');
      within(path.join(root, 'runs'), filename);
      let actual: string; try { actual = await realpath(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('file_missing', path.relative(root, filename)); throw error; }
      if (actual !== filename) fail('successor_reference_realpath_changed');
      const info = await stat(actual); if (!info.isFile() || info.size > 2 * 1024 * 1024) fail('successor_reference_too_large');
      const value = await readFile(actual); if (hashV2(value) !== reference.sha256) fail('hash_mismatch', path.relative(root, actual));
      refs.push({ path: actual, sha256: reference.sha256, bytes: value.length, reason: 'Bound successor ownership, user request and immutable parent state.' });
      try { return JSON.parse(value.toString('utf8')); } catch { fail('json_invalid', path.relative(root, filename)); }
    };
    const parent = await boundJSON(pointer.parentState, path.join(runDir, 'current-user-amendment.json'));
    if (parent.taskId !== local.taskId || parent.runId !== runId || parent.pageId !== local.pageId || parent.documentHash !== local.documentHash) fail('successor_parent_state_conflict');
    const journal = await boundJSON(pointer.successorJournal, path.join(childDir, 'journal.json')), request = await boundJSON(pointer.authorization, path.join(childDir, 'derivation-request.json'));
    if (journal.taskId !== local.taskId || journal.runId !== pointer.successorRunId || journal.pageId !== pointer.successorPageId || path.resolve(root, journal.runDir) !== childDir || journal.executionStrategy !== 'native44-css-handoff' || !object(journal.derivation) || journal.derivation.parentRunId !== runId || journal.derivation.sourcePageId !== local.pageId || typeof journal.derivation.reason !== 'string' || !journal.derivation.reason.trim() || journal.derivation.reason.length > 3000 || typeof journal.derivation.userInstruction !== 'string' || !journal.derivation.userInstruction.trim() || journal.derivation.userInstruction.length > 4096) fail('successor_journal_derivation_conflict');
    if (!object(request) || request.version !== 1 || request.kind !== 'explicit-user-derived-draft-request' || Object.keys(request).sort().join(',') !== 'kind,parentRunId,runId,sourcePageId,taskId,userInstruction,version' || request.taskId !== local.taskId || request.runId !== journal.runId || request.parentRunId !== runId || request.sourcePageId !== local.pageId || request.userInstruction !== journal.derivation.userInstruction) fail('successor_authorization_conflict');
    const child = await resolve(childDir, { taskId: local.taskId, runId: pointer.successorRunId, pageId: pointer.successorPageId });
    if (!child) fail('successor_current_state_missing');
    return { ...child, resolvedFrom: { runId, pageId: local.pageId }, successorRoutes: [{ parentRunId: runId, parentPageId: local.pageId, successorRunId: pointer.successorRunId, successorPageId: pointer.successorPageId }, ...(child.successorRoutes ?? [])], evidence: [...local.evidence, ...refs, ...child.evidence] };
  };
  return resolve(runInput, identity);
}

/** Every legacy writer must stop before authentication when an amendment index
 * exists. Invalid indexes fail closed rather than reviving the old generator. */
export async function assertNative44OriginalRunWritable(root: string, runDir: string): Promise<void> {
  let marked = false;
  for (const name of ['current-user-amendment.json', 'current-successor.json']) { try { await stat(path.join(path.resolve(root, runDir), name)); marked = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  if (!marked) return;
  const current = await readNative44CurrentState(root, runDir);
  if (current) fail('original_generation_frozen', 'Use context:load --intent resume --run ' + current.runId + '; preserve the verified amendment and use a current-revision-bound read-only review.');
}

import path from 'node:path';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { acquireLock, writeJson } from '../core/files.js';
import { redactor } from '../core/config.js';
import { VerifiedEvidenceReader } from '../core/verified-evidence.js';
import { resolveFinalDeliveryPolicy } from '../core/delivery-policy.js';
import { canonicalV2, documentHashV2, ensureDiskSpaceV2, hashV2 } from '../replica-v2/journal.js';
import { readNative44CurrentState, type Native44CurrentRef, type Native44CurrentState } from './current-state.js';
import type { DraftSnapshot, PublishedSnapshot, OwnedPublicationIntentProof } from '../wordpress/types.js';
import type { OwnedReviewStatus } from '../wordpress/client.js';
import { assertOwnedPublishedSnapshot } from '../wordpress/publication-contract.js';

const identifier = z.string().regex(/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/).refine(value => !value.includes('..'));
const digest = z.string().regex(/^[a-f\d]{64}$/), text = z.string().trim().min(1).max(4096);
const reference = z.object({ path: z.string().min(1).max(4096), sha256: digest }).strict();
export const Native44PublicationRequestSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-page-publication-request'),
  taskId: identifier, runId: identifier, pageId: z.number().int().positive(), operationId: identifier,
  documentHash: digest, expectedPointerHash: digest, review: reference,
  authorization: z.discriminatedUnion('basis', [
    z.object({ basis: z.literal('explicit-user-instruction'), instruction: text }).strict(),
    z.object({ basis: z.literal('frozen-delivery-policy'), policy: reference }).strict(),
  ]),
  acceptedOmissions: z.array(z.object({ issueHash: digest, reason: text }).strict()).max(100).default([]),
}).strict();
export type Native44PublicationRequest = z.infer<typeof Native44PublicationRequestSchema>;
function fail(code: string): never { throw Error(`native44_publication_${code}`); }
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
const equal = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
const sameRef = (root: string, a: Native44CurrentRef | undefined, b: Native44CurrentRef | undefined) => !!a && !!b && path.resolve(root, a.path) === path.resolve(root, b.path) && a.sha256 === b.sha256;
const pointerHash = (state: Native44CurrentState) => state.evidence.find(item => path.basename(item.path) === 'current-user-amendment.json' && path.basename(path.dirname(item.path)) === state.runId)?.sha256;
export const native44PublicationIssueHash = (issue: string) => hashV2(issue);

/** Publication is an independent delivery decision. Actual failed checks can
 * never be waived. Only an explicitly named, unimplemented interaction may be
 * removed from this delivery scope; its original failure remains in the review. */
export function assertNative44PublicationGate(state: Native44CurrentState, request: Native44PublicationRequest): void {
  const capture = state.currentCaptureReview;
  if (new Set(request.acceptedOmissions.map(item => item.issueHash)).size !== request.acceptedOmissions.length) fail('duplicate_omission');
  if (capture) {
    if (capture.review !== 'reviewed' || capture.automated !== 'passed') fail('actual_checks_not_passed');
    const scopeIssues = capture.notes.unfinished.filter(note => note.domain === 'interaction').map(note => `${note.region}: ${note.issue}`);
    for (const issue of capture.qualityFloor.issues) if (!scopeIssues.includes(issue) || !request.acceptedOmissions.some(item => item.issueHash === native44PublicationIssueHash(issue))) fail('quality_floor_not_satisfied');
    for (const item of request.acceptedOmissions) if (!capture.qualityFloor.issues.some(issue => native44PublicationIssueHash(issue) === item.issueHash) || request.authorization.basis !== 'explicit-user-instruction') fail('omission_not_explicit_or_current');
    return;
  }
  if (request.acceptedOmissions.length) fail('omission_requires_named_current_review');
  if (state.axes) {
    if (state.axes.review.status !== 'reviewed' || state.axes.review.automated !== 'passed' || state.axes.requirements.qualityFloor.status !== 'passed' || !state.axes.requirements.draftReady) fail('quality_floor_not_satisfied');
  } else if (!state.deliveryComplete || state.visualVerification !== 'applied-verified') fail('current_review_missing');
}

/** Complete equality, except the two documented WordPress status fields. */
export function assertNative44PublicationContent(before: DraftSnapshot, after: PublishedSnapshot): 'retained' | 'published' {
  return assertOwnedPublishedSnapshot(before, after);
}

interface PublicationReceipt {
  version: 1; kind: 'native44-page-publication-receipt'; status: 'confirmed'; taskId: string; runId: string; pageId: number;
  operationId: string; beforeHash: string; afterHash: string; parentPointerHash: string; confirmedAt: string;
  publicUrl: string; settingsStatus: 'retained' | 'published'; request: Native44CurrentRef; intent: Native44CurrentRef;
  before: Native44CurrentRef; after: Native44CurrentRef; review: Native44CurrentRef; historicalReviewPreserved: true;
}
export interface Native44PublicationState {
  version: 1; kind: 'verified-native44-publication'; status: 'published' | 'published-with-open-items';
  taskId: string; runId: string; pageId: number; operationId: string; draftDocumentHash: string; documentHash: string;
  publicUrl: string; publishedAt: string; unpublished: false; readOnly: true; historicalReviewPreserved: true;
  requirementsComplete: boolean; acceptedOmissions: Native44PublicationRequest['acceptedOmissions'];
  receipt: Native44CurrentRef; snapshot: Native44CurrentRef; evidence: Native44CurrentRef[];
}
function safePublicUrl(value: unknown, origin: string): string {
  if (typeof value !== 'string') fail('public_url_invalid');
  const url = new URL(value as string); if (url.origin !== new URL(origin).origin || url.protocol !== 'https:' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => !['page_id', 'p'].includes(key)) || [...url.searchParams.values()].some(item => !/^\d+$/.test(item))) fail('public_url_invalid');
  return url.href;
}
async function local(rootInput: string, runId: string) {
  identifier.parse(runId); const root = await realpath(rootInput), runDir = path.join(root, 'runs', runId);
  if (await realpath(runDir) !== runDir) fail('run_alias');
  const state = await readNative44CurrentState(root, runDir); if (!state || state.runId !== runId || state.resolvedFrom) fail('exact_current_run_required');
  const reader = new VerifiedEvidenceReader(root);
  for (const ref of state.evidence) await reader.read(ref, 64 * 1024 * 1024);
  const journalPath = path.join(runDir, 'journal.json'), journalBytes = await readFile(journalPath), journalRef = { path: journalPath, sha256: hashV2(journalBytes) }, journal = await reader.json(journalRef);
  const before = await reader.json(state.currentSnapshot) as DraftSnapshot;
  if (before.hash !== state.documentHash || before.status !== 'draft') fail('current_snapshot_conflict');
  return { root, runDir, state, before, reader, journal, journalRef };
}
async function validateRequest(data: Awaited<ReturnType<typeof local>>, request: Native44PublicationRequest) {
  const { root, state, reader, journal, journalRef } = data;
  if (request.taskId !== state.taskId || request.runId !== state.runId || request.pageId !== state.pageId || request.documentHash !== state.documentHash || request.expectedPointerHash !== pointerHash(state) || !sameRef(root, request.review, state.currentCaptureReview?.record ?? state.verification)) fail('current_identity_conflict');
  if (redactor()(JSON.stringify(request)) !== JSON.stringify(request)) fail('secret_in_request');
  assertNative44PublicationGate(state, request);
  if (state.currentCaptureReview) {
    if (!state.visualReview) fail('actual_visual_review_missing');
    const reviews = await reader.json(state.visualReview);
    if (!Array.isArray(reviews) || reviews.length !== 2 || reviews.some(item => item.verdict !== 'passed' || item.documentHash !== state.documentHash)) fail('actual_visual_checks_not_passed');
  }
  if (request.authorization.basis === 'frozen-delivery-policy') {
    if (!sameRef(root, request.authorization.policy, journalRef) || resolveFinalDeliveryPolicy(journal).desiredPageStatus !== 'publish') fail('frozen_policy_not_publish');
  }
  await reader.revalidateAll();
}
async function immutable(filename: string, value: unknown): Promise<Native44CurrentRef> {
  const content = bytes(value);
  try { await writeFile(filename, content, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (await realpath(filename) !== filename || !(await readFile(filename)).equals(content)) fail('immutable_conflict'); }
  return { path: filename, sha256: hashV2(content) };
}
const operationPath = (runDir: string, operationId: string) => path.join(runDir, 'publications', identifier.parse(operationId));
async function optional(filename: string) { try { const info = await stat(filename); if (!info.isFile() || info.size > 32 * 1024 * 1024 || await realpath(filename) !== filename) fail('artifact_invalid'); return await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }

/** Validate a separate immutable publication chain, without rewriting a single
 * draft snapshot, frozen program, review hash or historical journal. */
export async function readNative44Publication(rootInput: string, state: Native44CurrentState): Promise<Native44PublicationState | undefined> {
  const root = await realpath(rootInput), runDir = path.join(root, 'runs', state.runId), filename = path.join(runDir, 'current-publication.json'), content = await optional(filename); if (!content) return;
  const pointer = JSON.parse(content.toString('utf8'));
  if (pointer.version !== 1 || pointer.kind !== 'native44-current-publication' || pointer.taskId !== state.taskId || pointer.runId !== state.runId || pointer.pageId !== state.pageId || pointer.draftDocumentHash !== state.documentHash || pointer.parentPointerHash !== pointerHash(state) || Object.keys(pointer).sort().join(',') !== 'draftDocumentHash,kind,pageId,parentPointerHash,receipt,runId,taskId,version') fail('pointer_conflict');
  const reader = new VerifiedEvidenceReader(root), receiptRef = reference.parse(pointer.receipt), receipt = await reader.json(receiptRef) as PublicationReceipt;
  identifier.parse(receipt.operationId); const folder = operationPath(runDir, receipt.operationId);
  if (path.resolve(root, receiptRef.path) !== path.join(folder, 'receipt.json') || receipt.version !== 1 || receipt.kind !== 'native44-page-publication-receipt' || receipt.status !== 'confirmed' || receipt.taskId !== state.taskId || receipt.runId !== state.runId || receipt.pageId !== state.pageId || receipt.beforeHash !== state.documentHash || receipt.parentPointerHash !== pointerHash(state) || receipt.historicalReviewPreserved !== true || !Number.isFinite(Date.parse(receipt.confirmedAt))) fail('receipt_identity_conflict');
  for (const [key, name] of [['request', 'request.json'], ['intent', 'intent.json'], ['before', 'before.json'], ['after', 'after.json']] as const) if (path.resolve(root, reference.parse(receipt[key]).path) !== path.join(folder, name)) fail('receipt_owner_conflict');
  const request = Native44PublicationRequestSchema.parse(await reader.json(receipt.request)), before = await reader.json(receipt.before) as DraftSnapshot, after = await reader.json(receipt.after) as PublishedSnapshot, intent = await reader.json(receipt.intent);
  if (!sameRef(root, receipt.review, request.review) || !sameRef(root, request.review, state.currentCaptureReview?.record ?? state.verification) || request.expectedPointerHash !== pointerHash(state) || request.documentHash !== state.documentHash || request.taskId !== state.taskId || request.runId !== state.runId || request.pageId !== state.pageId || request.operationId !== receipt.operationId || !equal(before, JSON.parse(await readFile(state.currentSnapshot.path, 'utf8'))) || receipt.afterHash !== after.hash || assertNative44PublicationContent(before, after) !== receipt.settingsStatus || !equal(intent, { version: 1, kind: 'owned-page-publication-intent', operationId: receipt.operationId, taskId: request.taskId, runId: request.runId, pageId: request.pageId, beforeHash: before.hash, requestSha256: receipt.request.sha256, parentPointerHash: pointerHash(state) })) fail('receipt_content_conflict');
  assertNative44PublicationGate(state, request);
  if (state.currentCaptureReview) {
    if (!state.visualReview) fail('actual_visual_review_missing');
    const reviews = await reader.json(state.visualReview);
    if (!Array.isArray(reviews) || reviews.length !== 2 || reviews.some(item => item.verdict !== 'passed' || item.documentHash !== state.documentHash)) fail('actual_visual_checks_not_passed');
  }
  const journal = JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8')), publicUrl = safePublicUrl(receipt.publicUrl, journal.targetUrl);
  if (request.authorization.basis === 'frozen-delivery-policy' && (!sameRef(root, request.authorization.policy, { path: path.join(runDir, 'journal.json'), sha256: hashV2(await readFile(path.join(runDir, 'journal.json'))) }) || resolveFinalDeliveryPolicy(journal).desiredPageStatus !== 'publish')) fail('frozen_policy_changed');
  await reader.revalidateAll();
  const open = !state.deliveryComplete || state.requirementsComplete === false || request.acceptedOmissions.length > 0 || Boolean(state.currentCaptureReview && ['unfinished', 'minorIssues', 'unverified'].some(key => state.currentCaptureReview!.notes[key as 'unfinished'].length));
  return { version: 1, kind: 'verified-native44-publication', status: open ? 'published-with-open-items' : 'published', taskId: state.taskId, runId: state.runId, pageId: state.pageId, operationId: receipt.operationId, draftDocumentHash: before.hash, documentHash: after.hash, publicUrl, publishedAt: receipt.confirmedAt, unpublished: false, readOnly: true, historicalReviewPreserved: true, requirementsComplete: state.requirementsComplete ?? state.deliveryComplete, acceptedOmissions: request.acceptedOmissions, receipt: receiptRef, snapshot: receipt.after, evidence: [{ path: filename, sha256: hashV2(content) }, receiptRef, receipt.request, receipt.intent, receipt.before, receipt.after, receipt.review] };
}

export async function prepareNative44Publication(rootInput: string, input: unknown) {
  const request = Native44PublicationRequestSchema.parse(input), root = await realpath(rootInput), unlock = await acquireLock(root);
  try {
    await ensureDiskSpaceV2(root); const data = await local(root, request.runId); await validateRequest(data, request);
    if (await optional(path.join(data.runDir, 'current-publication.json'))) fail('already_published_use_verify');
    const folder = operationPath(data.runDir, request.operationId); await mkdir(folder, { recursive: true }); if (await realpath(folder) !== folder) fail('operation_alias');
    const requestRef = await immutable(path.join(folder, 'request.json'), request), beforeRef = await immutable(path.join(folder, 'before.json'), data.before);
    const intent = await immutable(path.join(folder, 'intent.json'), { version: 1, kind: 'owned-page-publication-intent', operationId: request.operationId, taskId: request.taskId, runId: request.runId, pageId: request.pageId, beforeHash: data.before.hash, requestSha256: requestRef.sha256, parentPointerHash: request.expectedPointerHash });
    await immutable(path.join(folder, 'bundle.json'), { version: 1, kind: 'native44-publication-bundle', request: requestRef, before: beforeRef, intent });
    const operationFile = path.join(folder, 'operation-state.json'); if (!await optional(operationFile)) await writeJson(operationFile, { version: 1, kind: 'native44-publication-operation', status: 'prepared', attempts: 0 });
    return { status: 'prepared', runId: request.runId, pageId: request.pageId, operationId: request.operationId, remoteWrites: 0 };
  } finally { await unlock(); }
}

export interface Native44PublicationRemote {
  probeOwnedReviewStatus(pageId: number, runId: string): Promise<OwnedReviewStatus>;
  readOwnedReviewCheckpoint(pageId: number, runId: string, types: string[]): Promise<{ snapshot: DraftSnapshot }>;
  readOwnedPublishedCheckpoint(pageId: number, runId: string, types: string[]): Promise<{ snapshot: PublishedSnapshot; publicUrl: string }>;
  publishOwnedDraft(before: DraftSnapshot, intent: OwnedPublicationIntentProof): Promise<{ snapshot: PublishedSnapshot; publicUrl: string; settingsStatus: 'retained' | 'published' }>;
  close?(): Promise<void>;
}
export interface Native44PublicationDependencies { remote(targetUrl: string): Promise<Native44PublicationRemote> }
const eligible = (status: OwnedReviewStatus) => status.exists && status.postType === 'page' && status.ownerMatches && status.canEdit && status.uniqueRunPage && status.documentExists && status.builtWithElementor;
const widgetTypes = (snapshot: DraftSnapshot) => { const types = new Set<string>(); const visit = (nodes: DraftSnapshot['elements']) => nodes.forEach(node => { types.add(node.elType === 'container' ? 'container' : node.widgetType!); visit(node.elements); }); visit(snapshot.elements); return [...types]; };

export async function applyNative44Publication(rootInput: string, runId: string, operationId: string, deps: Native44PublicationDependencies, mode: 'apply' | 'reconcile' = 'apply') {
  const root = await realpath(rootInput), unlock = await acquireLock(root); let remote: Native44PublicationRemote | undefined;
  try {
    const freeBytes = await ensureDiskSpaceV2(root), data = await local(root, runId), folder = operationPath(data.runDir, operationId);
    if (await realpath(folder) !== folder) fail('operation_alias');
    const bundleBytes = await readFile(path.join(folder, 'bundle.json')), bundle = JSON.parse(bundleBytes.toString('utf8'));
    if (bundle.version !== 1 || bundle.kind !== 'native44-publication-bundle') fail('bundle_invalid');
    for (const [key, name] of [['request', 'request.json'], ['before', 'before.json'], ['intent', 'intent.json']] as const) if (path.resolve(root, reference.parse(bundle[key]).path) !== path.join(folder, name)) fail('bundle_owner_conflict');
    const request = Native44PublicationRequestSchema.parse(await data.reader.json(bundle.request)), before = await data.reader.json(bundle.before) as DraftSnapshot, intent = await data.reader.json(bundle.intent);
    if (request.runId !== runId || request.operationId !== operationId || !equal(before, data.before) || !equal(intent, { version: 1, kind: 'owned-page-publication-intent', operationId, taskId: request.taskId, runId, pageId: request.pageId, beforeHash: before.hash, requestSha256: bundle.request.sha256, parentPointerHash: request.expectedPointerHash })) fail('bundle_conflict');
    await data.reader.read({ path: path.join(folder, 'bundle.json'), sha256: hashV2(bundleBytes) }); await validateRequest(data, request);
    let operation = JSON.parse(await readFile(path.join(folder, 'operation-state.json'), 'utf8'));
    if (operation.version !== 1 || operation.kind !== 'native44-publication-operation' || !['prepared', 'unknown', 'retryable', 'confirmed', 'conflict'].includes(operation.status) || !Number.isSafeInteger(operation.attempts) || operation.attempts < 0 || operation.status === 'conflict') fail('operation_invalid');
    const existing = await readNative44Publication(root, data.state); if (existing && existing.operationId !== operationId) fail('other_publication_exists');
    remote = await deps.remote(data.journal.targetUrl); const types = widgetTypes(before); let writes = 0;
    const saveOperation = async (status: string) => { operation = { ...operation, status, updatedAt: now() }; await writeJson(path.join(folder, 'operation-state.json'), operation); };
    const observe = async () => { const status = await remote!.probeOwnedReviewStatus(request.pageId, runId); if (!eligible(status) || status.pageId !== request.pageId || status.runId !== runId || !['draft', 'publish'].includes(status.status!)) fail('remote_ineligible'); return status.status === 'publish' ? { status: 'publish' as const, ...await remote!.readOwnedPublishedCheckpoint(request.pageId, runId, types) } : { status: 'draft' as const, ...await remote!.readOwnedReviewCheckpoint(request.pageId, runId, types) }; };
    let observed = await observe();
    if (observed.status === 'publish' && operation.attempts === 0) fail('published_without_this_intent');
    if (observed.status === 'draft') {
      if (!equal(observed.snapshot, before)) { await saveOperation('conflict'); return { status: 'conflict', remoteWrites: 0 }; }
      if (existing || operation.status === 'confirmed' || await optional(path.join(folder, 'receipt.json'))) fail('published_page_reverted');
      if (mode === 'reconcile' || operation.status === 'unknown') { await saveOperation('retryable'); return { status: 'retryable', remoteWrites: 0, nextAction: 'Explicit apply is safe only after this read-only reconciliation.' }; }
      await data.reader.revalidateAll(); if (hashV2(await readFile(path.join(data.runDir, 'current-user-amendment.json'))) !== request.expectedPointerHash) fail('pointer_changed');
      operation.attempts++; await saveOperation('unknown'); writes++;
      try { const result = await remote.publishOwnedDraft(observed.snapshot, { version: 1, kind: 'owned-page-publication-intent', operationId, intentSha256: bundle.intent.sha256, beforeHash: before.hash, durableIntentConfirmed: true, freeBytes }); observed = { ...result, status: 'publish' }; }
      catch { try { observed = await observe(); } catch { return { status: 'unknown', remoteWrites: writes, nextAction: 'reconcile' }; } }
    }
    if (observed.status === 'draft') { await saveOperation('retryable'); return { status: 'retryable', remoteWrites: writes, nextAction: 'Explicit apply required after read-only reconciliation.' }; }
    let settingsStatus: 'retained' | 'published';
    try { settingsStatus = assertNative44PublicationContent(before, observed.snapshot); } catch { await saveOperation('conflict'); return { status: 'conflict', remoteWrites: writes, observedHash: observed.snapshot.hash }; }
    const publicUrl = safePublicUrl(observed.publicUrl, data.journal.targetUrl);
    await data.reader.revalidateAll();
    if (existing) { if (existing.documentHash !== observed.snapshot.hash || existing.publicUrl !== publicUrl) fail('published_checkpoint_changed'); return { status: 'confirmed', remoteWrites: 0, publication: existing }; }
    const after = await immutable(path.join(folder, 'after.json'), observed.snapshot), receiptPath = path.join(folder, 'receipt.json'), prior = await optional(receiptPath), confirmedAt = prior ? JSON.parse(prior.toString('utf8')).confirmedAt : now();
    const receipt = await immutable(receiptPath, { version: 1, kind: 'native44-page-publication-receipt', status: 'confirmed', taskId: request.taskId, runId, pageId: request.pageId, operationId, beforeHash: before.hash, afterHash: observed.snapshot.hash, parentPointerHash: request.expectedPointerHash, confirmedAt, publicUrl, settingsStatus, request: bundle.request, intent: bundle.intent, before: bundle.before, after, review: request.review, historicalReviewPreserved: true } satisfies PublicationReceipt);
    if (hashV2(await readFile(path.join(data.runDir, 'current-user-amendment.json'))) !== request.expectedPointerHash || await optional(path.join(data.runDir, 'current-publication.json'))) fail('pointer_changed_after_publish');
    await writeJson(path.join(data.runDir, 'current-publication.json'), { version: 1, kind: 'native44-current-publication', taskId: request.taskId, runId, pageId: request.pageId, draftDocumentHash: before.hash, parentPointerHash: request.expectedPointerHash, receipt });
    const publication = await readNative44Publication(root, data.state); if (!publication || publication.documentHash !== observed.snapshot.hash) fail('readback_conflict');
    await saveOperation('confirmed'); return { status: 'confirmed', remoteWrites: writes, publication };
  } finally { try { await remote?.close?.(); } finally { await unlock(); } }
}

export async function finalizeNative44Publication(root: string, runId: string, deps: Native44PublicationDependencies) {
  const data = await local(root, runId), existing = await readNative44Publication(root, data.state);
  if (existing) return applyNative44Publication(root, runId, existing.operationId, deps, 'reconcile');
  const policy = resolveFinalDeliveryPolicy(data.journal); if (policy.desiredPageStatus !== 'publish') return { status: 'draft-preserved', remoteWrites: 0, reason: 'The frozen task delivery policy retains draft; a later project default does not migrate it.' };
  const request: Native44PublicationRequest = { version: 1, kind: 'native44-page-publication-request', taskId: data.state.taskId, runId, pageId: data.state.pageId, operationId: `finalize-${data.state.documentHash.slice(0, 24)}`, documentHash: data.state.documentHash, expectedPointerHash: pointerHash(data.state)!, review: data.state.currentCaptureReview?.record ?? data.state.verification!, authorization: { basis: 'frozen-delivery-policy', policy: data.journalRef }, acceptedOmissions: [] };
  Native44PublicationRequestSchema.parse(request); assertNative44PublicationGate(data.state, request);
  await prepareNative44Publication(root, request); return applyNative44Publication(root, runId, request.operationId, deps);
}

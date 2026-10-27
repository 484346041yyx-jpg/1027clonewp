import { randomUUID } from 'node:crypto';
import { fullReplicaHash, fullReplicaFingerprint, validateFullReplicaManifest, validateFullReplicaReview } from './contract.js';
import { prepareFullReplica } from './prepare.js';
import type { FullReplicaBoundCheckpoint, FullReplicaDependencies, FullReplicaHeaderCheckpoint, FullReplicaManifest, FullReplicaPageCheckpoint, FullReplicaBodyCheckpoint, FullReplicaPublishedCheckpoint, FullReplicaRunOptions, FullReplicaRunResult, FullReplicaRunState, FullReplicaRemotePhase, FullReplicaOperation, FullReplicaFileRef, FullReplicaHeaderStyleRevision } from './types.js';

function fail(code: string): never { throw Error(`replica_full_${code}`); }
function safeFailure(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  if (typeof value.code === 'string' && /^(?:invalid|unknown|unowned|owned|concurrent|document|readback|asset|media|php|network|cross_origin|redirect|existing|capability|widget|native44|replica_full|woodmart_header)[a-z0-9_-]{0,99}$/.test(value.code)) return value.code;
  if (typeof value.message === 'string' && /^(?:replica_full|woodmart_header|native44)_[a-z0-9_-]{1,140}$/.test(value.message)) return value.message;
  return 'replica_full_operation_unconfirmed';
}
function clearFailure(state: FullReplicaRunState): FullReplicaRunState { delete state.lastError; return state; }
function hash(value: unknown): void { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('checkpoint_hash_invalid'); }
function id(value: unknown): void { if (!Number.isSafeInteger(value) || Number(value) < 1) fail('checkpoint_id_invalid'); }
function url(value: unknown, manifest: FullReplicaManifest): void {
  if (typeof value !== 'string') fail('checkpoint_url_invalid');
  const parsed = new URL(value);
  if (parsed.origin !== manifest.targetOrigin || parsed.username || parsed.password || /(?:token|nonce|password|authorization|secret|signature|session)=/i.test(parsed.search)) fail('checkpoint_url_invalid');
}
function validateHeader(value: FullReplicaHeaderCheckpoint, manifest: FullReplicaManifest): void {
  if (!value || !/^header_[A-Za-z0-9_-]{1,89}$/.test(value.headerId) || !value.name?.trim()) fail('header_checkpoint_invalid');
  [value.headerHash, value.menuHash, value.styleHash].forEach(hash); url(value.editUrl, manifest);
  if (!Array.isArray(value.menus) || value.menus.length !== manifest.header!.plan.menus.length || new Set(value.menus.map(item => item.key)).size !== value.menus.length) fail('header_menu_checkpoint_invalid');
  for (const menu of value.menus) { id(menu.id); url(menu.editUrl, manifest); if (!menu.name?.trim() || !manifest.header!.plan.menus.some(item => item.key === menu.key)) fail('header_menu_checkpoint_invalid'); }
  id(value.styleBlock?.id); url(value.styleBlock?.editUrl, manifest); if (!value.styleBlock?.name?.trim()) fail('header_style_checkpoint_invalid');
}
function validatePage(value: FullReplicaPageCheckpoint, manifest: FullReplicaManifest): void {
  if (!value || value.runId !== manifest.runId || value.status !== 'draft' || value.template !== 'elementor_header_footer' || value.headerId !== null) fail('page_checkpoint_invalid');
  id(value.pageId); hash(value.bodyHash); url(value.editUrl, manifest); url(value.previewUrl, manifest);
}
function validateBody(value: FullReplicaBodyCheckpoint, page: FullReplicaPageCheckpoint, manifest: FullReplicaManifest): void {
  validatePage(value, manifest);
  if (value.pageId !== page.pageId || value.embeddedHeaderCount !== 0 || !Array.isArray(value.sourceUnitIds) || value.sourceUnitIds.length !== manifest.sourcePartition.bodyUnits.length || new Set(value.sourceUnitIds).size !== value.sourceUnitIds.length || manifest.sourcePartition.bodyUnits.some(unit => !value.sourceUnitIds.includes(unit))) fail('body_checkpoint_scope_invalid');
  [value.cssHash, value.documentHash].forEach(hash);
}
function validateBound(value: FullReplicaBoundCheckpoint, ownedHeader: FullReplicaHeaderCheckpoint | undefined, body: FullReplicaBodyCheckpoint, manifest: FullReplicaManifest): void {
  const header = manifest.headerProvider === 'reused-woodmart-header' ? manifest.reusedHeader! : ownedHeader;
  if (!header) fail('binding_header_required');
  if (!value || value.pageId !== body.pageId || value.runId !== manifest.runId || value.headerId !== header.headerId || value.bodyHash !== body.bodyHash || value.cssHash !== body.cssHash || value.documentHash !== body.documentHash || value.headerHash !== header.headerHash || value.menuHash !== header.menuHash || value.styleHash !== header.styleHash) fail('binding_checkpoint_changed');
  url(value.editUrl, manifest); url(value.previewUrl, manifest);
}
function validatePublished(value: FullReplicaPublishedCheckpoint, bound: FullReplicaBoundCheckpoint, manifest: FullReplicaManifest): void {
  if (!value || value.status !== 'publish' || fullReplicaFingerprint(value) !== fullReplicaFingerprint(bound)) fail('publication_readback_changed');
  url(value.publicUrl, manifest); url(value.editUrl, manifest);
}

function validateResume(state: FullReplicaRunState, manifest: FullReplicaManifest): void {
  if (!state || state.version !== 1 || state.kind !== 'clonewp-full-replica-run' || state.taskId !== manifest.taskId || state.runId !== manifest.runId || state.manifestHash !== fullReplicaHash(manifest) || !Number.isSafeInteger(state.revision) || state.revision < 0) fail('resume_identity_conflict');
  const c = state.checkpoints;
  if (!c || manifest.headerProvider === 'reused-woodmart-header' && c.header || c.header && !c.page || c.body && (!c.page || manifest.headerProvider !== 'reused-woodmart-header' && !c.header) || c.bound && !c.body || c.published && !c.bound) fail('resume_phase_conflict');
  if (c.header) validateHeader(c.header, manifest);
  if (c.page) validatePage(c.page, manifest);
  if (c.body) validateBody(c.body, c.page!, manifest);
  if (c.bound) validateBound(c.bound, c.header!, c.body!, manifest);
  if (manifest.reviewSkipPolicy && state.review) fail('review_skip_conflicting_review');
  if (state.review) { if (!c.bound) fail('resume_review_without_binding'); validateFullReplicaReview(state.review, manifest, c.bound); }
  if (c.published) { if (!manifest.reviewSkipPolicy && (!state.review || state.review.decision !== 'approved')) fail('resume_publication_without_review'); validatePublished(c.published, c.bound!, manifest); }
}

/** Local preparation is parallel; every remote phase is awaited and durably logged. */
export async function runFullReplica(input: unknown, dependencies: FullReplicaDependencies, options: FullReplicaRunOptions = {}): Promise<FullReplicaRunResult> {
  const manifest = validateFullReplicaManifest(input);
  if (manifest.headerProvider === 'component') throw Error('replica_full_retired_entry');
  if (options.state) validateResume(options.state, manifest);
  if (options.state?.pending) fail('reconciliation_required');
  if (options.state?.checkpoints.published) return structuredClone(options.state);
  let state: FullReplicaRunState = options.state ? structuredClone(options.state) : {
    version: 1, kind: 'clonewp-full-replica-run', taskId: manifest.taskId, runId: manifest.runId, manifestHash: fullReplicaHash(manifest),
    status: 'preparing', revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pending: null, checkpoints: {}, review: null,
  };
  const persist = async (next: FullReplicaRunState): Promise<void> => {
    next.updatedAt = new Date().toISOString();
    await dependencies.writeState(structuredClone(next)); state = next;
  };
  await persist({ ...state, status: 'preparing' });
  await options.onProgress?.(manifest.headerProvider === 'reused-woodmart-header' ? 'local-body-preparation-readonly-reused-header' : 'parallel-local-header-and-body-preparation');
  let prepared;
  try { prepared = await prepareFullReplica(manifest, dependencies); }
  catch (error) { await persist({ ...state, lastError: { phase: 'preparation', code: safeFailure(error) } }); throw error; }
  await persist(state.lastError?.phase === 'preparation' ? clearFailure({ ...state, status: 'building' }) : { ...state, status: 'building' });
  const remote = async <T>(phase: FullReplicaRemotePhase, action: (operation: FullReplicaOperation) => Promise<T>, accept: (value: T) => void, key: keyof FullReplicaRunState['checkpoints']): Promise<boolean> => {
    const operation: FullReplicaOperation = { operationId: randomUUID(), taskId: manifest.taskId, runId: manifest.runId, phase, expectedCheckpointHash: fullReplicaHash(state.checkpoints), createdAt: new Date().toISOString() };
    await persist({ ...state, pending: operation });
    await options.onProgress?.(`serial-remote-${phase}`);
    try {
      const result = await action(operation); accept(result);
      await persist(clearFailure({ ...state, pending: null, revision: state.revision + 1, checkpoints: { ...state.checkpoints, [key]: result } }));
      return true;
    } catch (error) {
      await persist({ ...state, status: 'write-unknown', lastError: { phase, operationId: operation.operationId, code: safeFailure(error) } }); return false;
    }
  };
  if (!state.checkpoints.page && !await remote('page', operation => dependencies.createPage(prepared, operation), value => validatePage(value, manifest), 'page')) return state;
  if (manifest.headerProvider !== 'reused-woodmart-header' && !state.checkpoints.header && !await remote('header', operation => dependencies.provisionHeader(prepared.header!, state.checkpoints.page!, operation), value => validateHeader(value, manifest), 'header')) return state;
  if (!state.checkpoints.body && !await remote('body', operation => dependencies.saveBody(prepared.body, state.checkpoints.page!, operation), value => validateBody(value, state.checkpoints.page!, manifest), 'body')) return state;
  if (!state.checkpoints.bound && !await remote('binding', operation => {
    if (manifest.headerProvider === 'reused-woodmart-header') { if (!dependencies.bindReusedHeader) fail('reused_header_adapter_required'); return dependencies.bindReusedHeader(state.checkpoints.body!, operation); }
    return dependencies.bindHeader(state.checkpoints.header!, state.checkpoints.body!, operation);
  }, value => validateBound(value, state.checkpoints.header, state.checkpoints.body!, manifest), 'bound')) return state;
  const bound = state.checkpoints.bound!;
  if (manifest.reviewSkipPolicy) {
    if (state.review || options.reviewInput !== undefined) fail('review_skip_conflicting_review');
    if (!options.publish) { await persist({ ...state, status: 'awaiting-review' }); return state; }
    if (!dependencies.publishWithoutReview) fail('review_skip_adapter_required');
    if (!await remote('publish', operation => dependencies.publishWithoutReview!(bound, operation), value => validatePublished(value, bound, manifest), 'published')) return state;
    await persist({ ...state, status: 'published' }); return state;
  }
  let review = state.review;
  let verifiedInThisCommand = false;
  if (!review || options.reviewInput !== undefined) {
    await persist(state.lastError?.phase === 'review' ? { ...state, status: 'awaiting-review' } : clearFailure({ ...state, status: 'awaiting-review' }));
    try { review = await dependencies.reviewWholePage(prepared, bound, options.reviewInput); if (!review) return state; review = validateFullReplicaReview(review, manifest, bound); await dependencies.verifyReview(review, bound); verifiedInThisCommand = true; }
    catch (error) { await persist({ ...state, lastError: { phase: 'review', code: safeFailure(error) } }); throw error; }
    await persist(clearFailure({ ...state, review, status: review.decision === 'approved' ? 'reviewed' : 'review-changes-required' }));
  }
  if (review.decision !== 'approved') { if (state.status !== 'review-changes-required') await persist({ ...state, status: 'review-changes-required' }); return state; }
  if (!options.publish) { if (state.status !== 'reviewed') await persist({ ...state, status: 'reviewed' }); return state; }
  validateFullReplicaReview(review, manifest, bound);
  try { if (!verifiedInThisCommand) await dependencies.verifyReview(review, bound); } // Never reuse a prior command's verification; mutation still requires server CAS.
  catch (error) { await persist({ ...state, lastError: { phase: 'review', code: safeFailure(error) } }); throw error; }
  if (!await remote('publish', operation => dependencies.publishPage(bound, review!, operation), value => validatePublished(value, bound, manifest), 'published')) return state;
  await persist({ ...state, status: 'published' });
  return state;
}

/** Resolve a lost response through readbacks only; a later resume is always explicit. */
export async function reconcileFullReplica(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  if (!current.pending) fail('reconciliation_not_pending');
  if (!dependencies.reconcileOperation) fail('reconciliation_adapter_missing');
  const operation = current.pending, checkpoints = current.checkpoints;
  if (operation.taskId !== manifest.taskId || operation.runId !== manifest.runId || operation.expectedCheckpointHash !== fullReplicaHash(checkpoints)) fail('reconciliation_intent_conflict');
  const expected: FullReplicaRemotePhase = !checkpoints.page ? 'page' : manifest.headerProvider !== 'reused-woodmart-header' && !checkpoints.header ? 'header' : !checkpoints.body ? 'body' : !checkpoints.bound ? 'binding' : 'publish';
  if (operation.phase !== expected && !(['style-revision', 'header-style-revision', 'motion-revision', 'layout-revision', 'navigation-return-revision'].includes(operation.phase) && checkpoints.bound && !checkpoints.published)) fail('reconciliation_phase_conflict');
  let result;
  try { const prepared = await prepareFullReplica(manifest, dependencies); result = await dependencies.reconcileOperation(prepared, operation, structuredClone(checkpoints)); }
  catch (error) { await dependencies.writeState({ ...structuredClone(current), updatedAt: new Date().toISOString(), lastError: { phase: operation.phase, operationId: operation.operationId, code: safeFailure(error) } }); throw error; }
  if (!result || !['before', 'after', 'conflict'].includes(result.status)) fail('reconciliation_response_invalid');
  if (result.status === 'conflict') return structuredClone(current);
  const state = structuredClone(current);
  if (result.status === 'after') {
    const value = result.checkpoint;
    if (operation.phase === 'page') { validatePage(value as FullReplicaPageCheckpoint, manifest); state.checkpoints.page = value as FullReplicaPageCheckpoint; }
    else if (operation.phase === 'header') { validateHeader(value as FullReplicaHeaderCheckpoint, manifest); state.checkpoints.header = value as FullReplicaHeaderCheckpoint; }
    else if (operation.phase === 'body') { validateBody(value as FullReplicaBodyCheckpoint, checkpoints.page!, manifest); state.checkpoints.body = value as FullReplicaBodyCheckpoint; }
    else if (operation.phase === 'binding') { validateBound(value as FullReplicaBoundCheckpoint, checkpoints.header!, checkpoints.body!, manifest); state.checkpoints.bound = value as FullReplicaBoundCheckpoint; }
    else if (operation.phase === 'style-revision') { acceptStyleRevision(state, value as FullReplicaBoundCheckpoint, manifest); }
    else if (operation.phase === 'motion-revision') { if ((value as FullReplicaBoundCheckpoint).cssHash !== state.checkpoints.bound!.cssHash) fail('native_motion_css_changed'); acceptStyleRevision(state, value as FullReplicaBoundCheckpoint, manifest); }
    else if (operation.phase === 'layout-revision') { if ((value as FullReplicaBoundCheckpoint).cssHash !== state.checkpoints.bound!.cssHash) fail('layout_css_changed'); acceptStyleRevision(state, value as FullReplicaBoundCheckpoint, manifest); }
    else if (operation.phase === 'navigation-return-revision') { if ((value as FullReplicaBoundCheckpoint).cssHash !== state.checkpoints.bound!.cssHash) fail('navigation_return_css_changed'); acceptStyleRevision(state, value as FullReplicaBoundCheckpoint, manifest); }
    else if (operation.phase === 'header-style-revision') { acceptHeaderStyleRevision(state, value as FullReplicaHeaderStyleRevision, manifest); }
    else { if (!manifest.reviewSkipPolicy && (!state.review || state.review.decision !== 'approved')) fail('reconciliation_review_missing'); validatePublished(value as FullReplicaPublishedCheckpoint, checkpoints.bound!, manifest); state.checkpoints.published = value as FullReplicaPublishedCheckpoint; }
    state.revision++;
  }
  state.pending = null; clearFailure(state); state.status = state.checkpoints.published ? 'published' : state.review?.decision === 'approved' ? 'reviewed' : state.checkpoints.bound ? 'awaiting-review' : 'building'; state.updatedAt = new Date().toISOString();
  validateResume(state, manifest); await dependencies.writeState(structuredClone(state)); return state;
}

function acceptStyleRevision(state: FullReplicaRunState, value: FullReplicaBoundCheckpoint, manifest: FullReplicaManifest): void {
  const before = state.checkpoints.bound!, body = state.checkpoints.body!;
  for (const key of ['pageId', 'runId', 'headerId', 'headerHash', 'menuHash', 'styleHash', 'editUrl', 'previewUrl'] as const) if (value[key] !== before[key]) fail('style_revision_boundary_changed');
  [value.bodyHash, value.cssHash, value.documentHash].forEach(hash);
  const nextBody = { ...body, bodyHash: value.bodyHash, cssHash: value.cssHash, documentHash: value.documentHash };
  validateBody(nextBody, state.checkpoints.page!, manifest); validateBound(value, state.checkpoints.header!, nextBody, manifest);
  state.checkpoints = { ...state.checkpoints, body: nextBody, bound: value }; state.review = null;
}
/** Explicitly adopt a changed WordPress body hash only when the protected draft is otherwise identical. */
export async function rebaseFullReplicaCurrentDraft(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState, expectedFingerprint: string, currentBodyHash: string, currentDocumentHash: string): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  const operation = current.pending, bound = current.checkpoints.bound;
  if (!operation || operation.phase !== 'layout-revision' || !bound || current.checkpoints.published || current.status !== 'write-unknown') fail('rebase_pending_layout_required');
  if (operation.expectedCheckpointHash !== fullReplicaHash(current.checkpoints) || operation.taskId !== manifest.taskId || operation.runId !== manifest.runId) fail('rebase_intent_conflict');
  if (fullReplicaFingerprint(bound) !== expectedFingerprint || !/^[a-f0-9]{64}$/.test(currentBodyHash) || !/^[a-f0-9]{64}$/.test(currentDocumentHash) || currentBodyHash === bound.bodyHash && currentDocumentHash === bound.documentHash) fail('rebase_expected_state_invalid');
  if (!dependencies.rebaseCurrentDraft) fail('rebase_adapter_missing');
  const adopted = await dependencies.rebaseCurrentDraft(bound, operation, currentBodyHash, currentDocumentHash);
  for (const key of ['pageId', 'runId', 'headerId', 'headerHash', 'menuHash', 'styleHash', 'cssHash', 'editUrl', 'previewUrl'] as const) if (adopted[key] !== bound[key]) fail('rebase_boundary_changed');
  if (adopted.bodyHash !== currentBodyHash || adopted.documentHash !== currentDocumentHash) fail('rebase_document_changed');
  const state = structuredClone(current); acceptStyleRevision(state, adopted, manifest);
  state.pending = null; state.status = 'awaiting-review'; state.revision++; state.updatedAt = new Date().toISOString(); clearFailure(state);
  validateResume(state, manifest); await dependencies.writeState(structuredClone(state)); return state;
}
/** An additive CSS-only revision of the exact current draft; frozen source inputs stay intact. */
export async function reviseFullReplicaStyle(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState, css: FullReplicaFileRef, expectedFingerprint: string): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  if (current.pending) fail('reconciliation_required');
  if (!current.checkpoints.bound || !current.checkpoints.body || current.checkpoints.published) fail('style_revision_owned_draft_required');
  if (fullReplicaFingerprint(current.checkpoints.bound) !== expectedFingerprint) fail('style_revision_stale');
  if (!dependencies.reviseStyle) fail('style_revision_adapter_missing');
  let prepared;
  try { prepared = await prepareFullReplica(manifest, dependencies); }
  catch (error) { await dependencies.writeState({ ...structuredClone(current), updatedAt: new Date().toISOString(), lastError: { phase: 'preparation', code: safeFailure(error) } }); throw error; }
  const operation: FullReplicaOperation = { operationId: randomUUID(), taskId: manifest.taskId, runId: manifest.runId, phase: 'style-revision', expectedCheckpointHash: fullReplicaHash(current.checkpoints), createdAt: new Date().toISOString() };
  const state = structuredClone(current); state.pending = operation; state.review = null; state.status = 'building'; state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state));
  try {
    const result = await dependencies.reviseStyle(prepared, state.checkpoints.bound!, css, operation);
    if (manifest.editorCompletionPolicy?.runtime && fullReplicaHash(result) === fullReplicaHash(current.checkpoints.bound)) {
      // The driver proved exact compiled CSS equality against a fresh protected
      // readback. No content/version change means the existing review remains valid.
      state.review = structuredClone(current.review); state.status = current.status;
    } else { acceptStyleRevision(state, result, manifest); state.revision++; state.status = 'awaiting-review'; }
    state.pending = null; clearFailure(state);
  }
  catch (error) { state.status = 'write-unknown'; state.lastError = { phase: operation.phase, operationId: operation.operationId, code: safeFailure(error) }; }
  state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state)); return state;
}

function acceptHeaderStyleRevision(state: FullReplicaRunState, value: FullReplicaHeaderStyleRevision, manifest: FullReplicaManifest): void {
  const beforeHeader = state.checkpoints.header!, beforeBound = state.checkpoints.bound!;
  if (!value?.header || !value.bound) fail('header_style_revision_response');
  const { styleHash: _a, ...headerA } = beforeHeader, { styleHash: _b, ...headerB } = value.header;
  const { styleHash: _c, ...boundA } = beforeBound, { styleHash: _d, ...boundB } = value.bound;
  if (fullReplicaHash(headerA) !== fullReplicaHash(headerB) || fullReplicaHash(boundA) !== fullReplicaHash(boundB)) fail('header_style_revision_boundary_changed');
  validateHeader(value.header, manifest); validateBound(value.bound, value.header, state.checkpoints.body!, manifest);
  state.checkpoints = { ...state.checkpoints, header: value.header, bound: value.bound }; state.review = null;
}
/** A proved amendment changes the independent native style block, never the frozen source plan. */
export async function reviseFullReplicaHeaderStyle(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState, css: FullReplicaFileRef, expectedFingerprint: string): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  if (manifest.headerProvider === 'reused-woodmart-header') fail('reused_header_readonly');
  if (current.pending) fail('reconciliation_required');
  if (!current.checkpoints.bound || !current.checkpoints.body || current.checkpoints.published) fail('header_style_revision_owned_draft_required');
  if (fullReplicaFingerprint(current.checkpoints.bound) !== expectedFingerprint) fail('header_style_revision_stale');
  if (!dependencies.reviseHeaderStyle) fail('header_style_revision_adapter_missing');
  let prepared;
  try { prepared = await prepareFullReplica(manifest, dependencies); }
  catch (error) { await dependencies.writeState({ ...structuredClone(current), updatedAt: new Date().toISOString(), lastError: { phase: 'preparation', code: safeFailure(error) } }); throw error; }
  const operation: FullReplicaOperation = { operationId: randomUUID(), taskId: manifest.taskId, runId: manifest.runId, phase: 'header-style-revision', expectedCheckpointHash: fullReplicaHash(current.checkpoints), createdAt: new Date().toISOString() };
  const state = structuredClone(current); state.pending = operation; state.review = null; state.status = 'building'; state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state));
  try { const result = await dependencies.reviseHeaderStyle(prepared, state.checkpoints.bound!, css, operation); acceptHeaderStyleRevision(state, result, manifest); state.pending = null; state.revision++; state.status = 'awaiting-review'; clearFailure(state); }
  catch (error) { state.status = 'write-unknown'; state.lastError = { phase: operation.phase, operationId: operation.operationId, code: safeFailure(error) }; }
  state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state)); return state;
}

/** Fixed native carousel speed adjustment; original program and CSS remain frozen. */
export async function reviseFullReplicaNativeMotion(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState, expectedFingerprint: string): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  if (current.pending) fail('reconciliation_required');
  if (!current.checkpoints.bound || !current.checkpoints.body || current.checkpoints.published) fail('native_motion_owned_draft_required');
  if (fullReplicaFingerprint(current.checkpoints.bound) !== expectedFingerprint) fail('native_motion_stale');
  if (!dependencies.reviseNativeMotion) fail('native_motion_adapter_missing');
  let prepared;
  try { prepared = await prepareFullReplica(manifest, dependencies); }
  catch (error) { await dependencies.writeState({ ...structuredClone(current), updatedAt: new Date().toISOString(), lastError: { phase: 'preparation', code: safeFailure(error) } }); throw error; }
  const operation: FullReplicaOperation = { operationId: randomUUID(), taskId: manifest.taskId, runId: manifest.runId, phase: 'motion-revision', expectedCheckpointHash: fullReplicaHash(current.checkpoints), createdAt: new Date().toISOString() }, state = structuredClone(current);
  state.pending = operation; state.review = null; state.status = 'building'; state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state));
  try { const result = await dependencies.reviseNativeMotion(prepared, state.checkpoints.bound!, operation); if (result.cssHash !== state.checkpoints.bound!.cssHash) fail('native_motion_css_changed'); acceptStyleRevision(state, result, manifest); state.pending = null; state.revision++; state.status = 'awaiting-review'; clearFailure(state); }
  catch (error) { state.status = 'write-unknown'; state.lastError = { phase: operation.phase, operationId: operation.operationId, code: safeFailure(error) }; }
  state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state)); return state;
}

/** Explicit, owned-draft Container-tree revision; all existing widgets and settings remain intact. */
export async function reviseFullReplicaLayout(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState, plan: FullReplicaFileRef, expectedFingerprint: string): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  if (current.pending) fail('reconciliation_required');
  if (!current.checkpoints.bound || !current.checkpoints.body || current.checkpoints.published) fail('layout_owned_draft_required');
  if (fullReplicaFingerprint(current.checkpoints.bound) !== expectedFingerprint) fail('layout_stale');
  if (!dependencies.reviseLayout) fail('layout_adapter_missing');
  let prepared;
  try { prepared = await prepareFullReplica(manifest, dependencies); }
  catch (error) { await dependencies.writeState({ ...structuredClone(current), updatedAt: new Date().toISOString(), lastError: { phase: 'preparation', code: safeFailure(error) } }); throw error; }
  const operation: FullReplicaOperation = { operationId: randomUUID(), taskId: manifest.taskId, runId: manifest.runId, phase: 'layout-revision', expectedCheckpointHash: fullReplicaHash(current.checkpoints), createdAt: new Date().toISOString() }, state = structuredClone(current);
  state.pending = operation; state.review = null; state.status = 'building'; state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state));
  try { const result = await dependencies.reviseLayout(prepared, state.checkpoints.bound!, plan, operation); if (result.cssHash !== state.checkpoints.bound!.cssHash) fail('layout_css_changed'); acceptStyleRevision(state, result, manifest); state.pending = null; state.revision++; state.status = 'awaiting-review'; clearFailure(state); }
  catch (error) { state.status = 'write-unknown'; state.lastError = { phase: operation.phase, operationId: operation.operationId, code: safeFailure(error) }; }
  state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state)); return state;
}

/** Explicit compatibility revision for an existing owned typed GET form; never migrates completed bodies automatically. */
export async function reviseFullReplicaNavigationReturn(input: unknown, dependencies: FullReplicaDependencies, current: FullReplicaRunState, expectedFingerprint: string): Promise<FullReplicaRunState> {
  const manifest = validateFullReplicaManifest(input); validateResume(current, manifest);
  if (current.pending) fail('reconciliation_required');
  if (!manifest.body.navigationForms?.length || !current.checkpoints.bound || !current.checkpoints.body || current.checkpoints.published) fail('navigation_return_owned_draft_required');
  if (fullReplicaFingerprint(current.checkpoints.bound) !== expectedFingerprint) fail('navigation_return_stale');
  if (!dependencies.reviseNavigationReturn) fail('navigation_return_adapter_missing');
  let prepared;
  try { prepared = await prepareFullReplica(manifest, dependencies); }
  catch (error) { await dependencies.writeState({ ...structuredClone(current), updatedAt: new Date().toISOString(), lastError: { phase: 'preparation', code: safeFailure(error) } }); throw error; }
  const operation: FullReplicaOperation = { operationId: randomUUID(), taskId: manifest.taskId, runId: manifest.runId, phase: 'navigation-return-revision', expectedCheckpointHash: fullReplicaHash(current.checkpoints), createdAt: new Date().toISOString() }, state = structuredClone(current);
  state.pending = operation; state.review = null; state.status = 'building'; state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state));
  try { const result = await dependencies.reviseNavigationReturn(prepared, state.checkpoints.bound!, operation); if (result.cssHash !== state.checkpoints.bound!.cssHash) fail('navigation_return_css_changed'); acceptStyleRevision(state, result, manifest); state.pending = null; state.revision++; state.status = 'awaiting-review'; clearFailure(state); }
  catch (error) { state.status = 'write-unknown'; state.lastError = { phase: operation.phase, operationId: operation.operationId, code: safeFailure(error) }; }
  state.updatedAt = new Date().toISOString(); await dependencies.writeState(structuredClone(state)); return state;
}

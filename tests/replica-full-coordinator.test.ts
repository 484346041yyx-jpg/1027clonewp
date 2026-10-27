import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFullReplicaBodyScope, fullReplicaFingerprint, fullReplicaHash, validateFullReplicaManifest, validateFullReplicaReview } from '../src/replica-full/contract.js';
import { rebaseFullReplicaCurrentDraft, reconcileFullReplica, reviseFullReplicaHeaderStyle, reviseFullReplicaNativeMotion, reviseFullReplicaStyle, runFullReplica } from '../src/replica-full/coordinator.js';
import { prepareFullReplica } from '../src/replica-full/prepare.js';
import { fullReplicaDelivery } from '../src/replica-full/delivery.js';
import type { FullReplicaDependencies, FullReplicaManifest, FullReplicaPreparedBody, FullReplicaPreparedHeader, FullReplicaHeaderCheckpoint, FullReplicaPageCheckpoint, FullReplicaBodyCheckpoint, FullReplicaBoundCheckpoint, FullReplicaReview, FullReplicaRunState } from '../src/replica-full/types.js';

const h = (value: string) => value.repeat(64);
function manifestInput() {
  return { version: 1, kind: 'clonewp-full-replica', taskId: 'alder-task', runId: 'alder-run', title: 'Alder store', slug: 'alder-store', sourceUrl: 'https://source.example/', targetOrigin: 'https://target.example',
    sourceEvidence: { path: 'source.json', sha256: h('e') }, sourcePartition: { allUnits: ['wide/header', 'narrow/header', 'wide/hero', 'narrow/hero'], headerUnits: ['wide/header', 'narrow/header'], bodyUnits: ['wide/hero', 'narrow/hero'] },
    header: { bundleDirectory: 'D:/cloneWP/.cache/alder-module', assets: { path: 'header-assets.json', sha256: h('f') }, plan: { version: 1, kind: 'clonewp-header-module', moduleKey: 'alder', owner: { ownerId: 'clonewp', runId: 'alder-run' }, targetOrigin: 'https://target.example', name: 'Alder header', menus: [{ key: 'main', name: 'Alder navigation', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'navigation', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: ':header {color:#345}', fonts: [] } } },
    body: { program: { path: 'body-program.json', sha256: h('a') }, css: { path: 'body.css', sha256: h('b') }, sourceUnits: { path: 'source-units.json', sha256: h('c') } },
  };
}
function fixture() {
  const manifest = validateFullReplicaManifest(manifestInput()), calls: string[] = [], saved: FullReplicaRunState[] = [];
  const preparedHeader: FullReplicaPreparedHeader = { planHash: fullReplicaHash(manifest.header!.plan), moduleKey: 'alder', bundleDirectory: manifest.header!.bundleDirectory, payload: { testOnly: true } };
  const preparedBody: FullReplicaPreparedBody = { programHash: h('a'), cssInputHash: h('b'), sourceUnitsHash: h('c'), sourceEvidenceHash: h('e'), sourceUnitIds: [...manifest.sourcePartition.bodyUnits], componentSourceUnitIds: [...manifest.sourcePartition.bodyUnits], embeddedHeaderCount: 0, payload: { testOnly: true } };
  const header: FullReplicaHeaderCheckpoint = { headerId: 'header_test', name: 'Alder header', editUrl: 'https://target.example/wp-admin/admin.php?page=xts_header_builder#/builder/header_test', headerHash: h('1'), menuHash: h('2'), styleHash: h('3'), menus: [{ key: 'main', id: 900, name: 'Alder navigation', editUrl: 'https://target.example/wp-admin/nav-menus.php?menu=900' }], styleBlock: { id: 901, name: 'Alder styles', editUrl: 'https://target.example/wp-admin/post.php?post=901&action=edit' } };
  const page: FullReplicaPageCheckpoint = { pageId: 902, runId: 'alder-run', status: 'draft', template: 'elementor_header_footer', editUrl: 'https://target.example/wp-admin/post.php?post=902&action=elementor', previewUrl: 'https://target.example/?page_id=902&preview=true', bodyHash: h('4'), headerId: null };
  const body: FullReplicaBodyCheckpoint = { ...page, bodyHash: h('5'), cssHash: h('6'), documentHash: h('7'), sourceUnitIds: [...manifest.sourcePartition.bodyUnits], embeddedHeaderCount: 0 };
  const bound: FullReplicaBoundCheckpoint = { pageId: 902, runId: 'alder-run', headerId: header.headerId, editUrl: page.editUrl, previewUrl: page.previewUrl, bodyHash: body.bodyHash, cssHash: body.cssHash, documentHash: body.documentHash, headerHash: header.headerHash, menuHash: header.menuHash, styleHash: header.styleHash };
  const review: FullReplicaReview = { version: 1, kind: 'clonewp-full-replica-review', taskId: manifest.taskId, runId: manifest.runId, pageId: 902, fingerprint: fullReplicaFingerprint(bound), decision: 'approved', observedAt: new Date().toISOString(), reviewerEvidence: { path: 'review.json', sha256: h('8') }, viewports: [{ width: 1920, height: 1080, screenshot: { path: 'wide.png', sha256: h('9') }, visual: 'passed', interactions: 'passed', headerCount: 1, bodyHeaderCount: 0 }, { width: 1440, height: 1000, screenshot: { path: 'narrow.png', sha256: h('a') }, visual: 'passed', interactions: 'passed', headerCount: 1, bodyHeaderCount: 0 }] };
  let active = 0, maxActive = 0, headerStarted = false, bodyStarted = false;
  const remote = async <T>(name: string, result: T) => { calls.push(name); active++; maxActive = Math.max(active, maxActive); await Promise.resolve(); active--; return structuredClone(result); };
  const dependencies: FullReplicaDependencies = {
    async prepareHeader() { headerStarted = true; calls.push('prepare-header'); await Promise.resolve(); assert.equal(bodyStarted, true); return preparedHeader; },
    async prepareBody() { bodyStarted = true; calls.push('prepare-body'); await Promise.resolve(); assert.equal(headerStarted, true); return preparedBody; },
    assertPreparedBody(value) { assert.equal(value, preparedBody); calls.push('assert-body-provenance'); },
    async writeState(state) { saved.push(structuredClone(state)); },
    async provisionHeader(_prepared, ownedPage, operation) { assert.equal(ownedPage.pageId, page.pageId); assert.equal(saved.at(-1)?.pending?.operationId, operation.operationId); return remote('header', header); },
    async createPage(_prepared, operation) { assert.equal(saved.at(-1)?.pending?.operationId, operation.operationId); return remote('page', page); },
    async saveBody(_prepared, _page, operation) { assert.equal(saved.at(-1)?.pending?.operationId, operation.operationId); return remote('body', body); },
    async bindHeader(_header, _body, operation) { assert.equal(saved.at(-1)?.pending?.operationId, operation.operationId); return remote('binding', bound); },
    async reviewWholePage(_prepared, _bound, input) { calls.push('review'); return input ? structuredClone(review) : null; },
    async verifyReview() { calls.push('verify-current-review'); },
    async publishPage(_bound, _review, operation) { assert.equal(saved.at(-1)?.pending?.operationId, operation.operationId); const { previewUrl: _preview, ...rest } = bound; return remote('publish', { ...rest, status: 'publish' as const, publicUrl: 'https://target.example/alder-store/' }); },
  };
  return { manifest, calls, saved, preparedBody, header, page, body, bound, review, dependencies, maxActive: () => maxActive };
}

test('full manifest defaults WHB and rejects overlapping or unowned header scope', () => {
  const result = validateFullReplicaManifest(manifestInput()); assert.equal(result.headerProvider, 'woodmart-header-builder'); assert.equal(result.deliveryPolicy, 'publish-after-review');
  const overlap = manifestInput(); overlap.sourcePartition.bodyUnits.push('wide/header'); assert.throws(() => validateFullReplicaManifest(overlap), /header_body_overlap/);
  const otherOwner = manifestInput(); otherOwner.header.plan.owner.runId = 'another-run'; assert.throws(() => validateFullReplicaManifest(otherOwner), /header_identity_conflict/);
  assert.throws(() => validateFullReplicaManifest({ ...manifestInput(), headerProvider: 'auto' }));
});

test('local preparation starts both responsibilities together and verifies actual body coverage before remote work', async () => {
  const f = fixture(); const prepared = await prepareFullReplica(f.manifest, f.dependencies);
  assert.equal(prepared.body, f.preparedBody); assert.deepEqual(f.calls, ['prepare-header', 'prepare-body', 'assert-body-provenance']);
  const bad = { ...f.preparedBody, embeddedHeaderCount: 1 }; assert.throws(() => assertFullReplicaBodyScope(bad, f.manifest), /embedded_header_rejected/);
  assert.throws(() => assertFullReplicaBodyScope({ ...f.preparedBody, componentSourceUnitIds: ['wide/header', 'narrow/hero'] }, f.manifest), /body_component_scope/);
  f.preparedBody.sourceUnitsHash = h('d'); await assert.rejects(prepareFullReplica(f.manifest, f.dependencies), /body_input_identity/);
  assert.equal(f.calls.includes('header'), false);
});

test('remote writes are sequential, pending intent is durable first, and no review means no publication', async () => {
  const f = fixture(), result = await runFullReplica(f.manifest, f.dependencies);
  assert.ok('kind' in result); if (!('kind' in result)) return;
  assert.equal(result.status, 'awaiting-review'); assert.equal(result.pending, null); assert.equal(result.checkpoints.bound?.headerId, 'header_test');
  assert.equal(f.maxActive(), 1); assert.deepEqual(f.calls.filter(item => ['header', 'page', 'body', 'binding', 'publish'].includes(item)), ['page', 'header', 'body', 'binding']);
  assert.equal(fullReplicaDelivery(result, f.manifest).complete, false);
});

test('current whole-page review gates publication and delivery lists actual resource IDs and editor links', async () => {
  const f = fixture(), built = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in built); if (!('kind' in built)) return;
  const reviewed = await runFullReplica(f.manifest, f.dependencies, { state: built, reviewInput: { actualEvidence: true } }); assert.ok('kind' in reviewed); if (!('kind' in reviewed)) return;
  assert.equal(reviewed.status, 'reviewed'); assert.equal(f.calls.includes('publish'), false);
  const published = await runFullReplica(f.manifest, f.dependencies, { state: reviewed, publish: true }); assert.ok('kind' in published); if (!('kind' in published)) return;
  assert.equal(published.status, 'published'); assert.equal(f.calls.filter(item => item === 'header').length, 1); assert.equal(f.calls.filter(item => item === 'body').length, 1);
  const delivery = fullReplicaDelivery(published, f.manifest); assert.equal(delivery.complete, true); assert.equal(delivery.resources.length, 4);
  assert.match(delivery.markdown, /header_test/); assert.match(delivery.markdown, /900/); assert.match(delivery.markdown, /901/); assert.match(delivery.markdown, /post=902/);
  assert.equal(f.calls.at(-1), 'publish');
});

test('stale review, incomplete desktop checks and duplicate rendered header cannot approve publication', async () => {
  const f = fixture();
  assert.throws(() => validateFullReplicaReview({ ...f.review, fingerprint: h('0') }, f.manifest, f.bound), /review_stale_or_wrong_page/);
  const duplicate = structuredClone(f.review); duplicate.viewports[0].headerCount = 2; assert.throws(() => validateFullReplicaReview(duplicate, f.manifest, f.bound), /review_quality_floor/);
  const incomplete = structuredClone(f.review); incomplete.viewports[1].width = 1280; assert.throws(() => validateFullReplicaReview(incomplete, f.manifest, f.bound), /review_viewports_incomplete/);
  f.dependencies.verifyReview = async () => { throw Error('Actual current remote document differs'); };
  await assert.rejects(runFullReplica(f.manifest, f.dependencies, { reviewInput: {}, publish: true }), /Actual current/);
  assert.equal(f.calls.includes('publish'), false);
});

test('new policy keeps published delivery pending until editor alignment and normal reopen are verified', async () => {
  const f = fixture(); f.manifest.editorCompletionPolicy = { version: 1, mode: 'align-and-reopen' };
  const result = await runFullReplica(f.manifest, f.dependencies, { reviewInput: {}, publish: true }); assert.ok('kind' in result); if (!('kind' in result)) return;
  assert.equal(result.status, 'published');
  assert.equal(fullReplicaDelivery(result, f.manifest).complete, false);
  assert.equal(fullReplicaDelivery(result, f.manifest, { required: true, complete: false, status: 'aligned' }).complete, false);
  assert.equal(fullReplicaDelivery(result, f.manifest, { required: true, complete: true, status: 'complete' }).complete, true);
});

test('review and publish in one command verify once; a new publish command still verifies again', async () => {
  const combined = fixture();
  const result = await runFullReplica(combined.manifest, combined.dependencies, { reviewInput: {}, publish: true });
  assert.equal('status' in result && result.status, 'published');
  assert.equal(combined.calls.filter(call => call === 'verify-current-review').length, 1);
  const separate = fixture(), reviewed = await runFullReplica(separate.manifest, separate.dependencies, { reviewInput: {} });
  assert.ok('kind' in reviewed); if (!('kind' in reviewed)) return;
  await runFullReplica(separate.manifest, separate.dependencies, { state: reviewed, publish: true });
  assert.equal(separate.calls.filter(call => call === 'verify-current-review').length, 2);
});

test('an unknown body write preserves the pending operation and never binds, publishes or blindly resumes', async () => {
  const f = fixture(); f.dependencies.saveBody = async () => { throw Error('Response lost'); };
  const result = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in result); if (!('kind' in result)) return;
  assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'body'); assert.equal(result.checkpoints.body, undefined);
  assert.equal(f.calls.includes('binding'), false); assert.equal(f.calls.includes('publish'), false);
  const last = f.saved.at(-1); assert.equal(last?.pending?.operationId, result.pending?.operationId);
  const priorCalls = f.calls.length; await assert.rejects(runFullReplica(f.manifest, f.dependencies, { state: result }), /reconciliation_required/); assert.equal(f.calls.length, priorCalls);
});

test('retired component manifests fail before preparation or remote action',async()=>{const f=fixture();await assert.rejects(runFullReplica({...f.manifest,headerProvider:'component'},f.dependencies),/retired/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.saved,[]);});

test('read-only reconciliation confirms a lost body response without retrying any remote mutation', async () => {
  const f = fixture(); f.dependencies.saveBody = async () => { throw Error('Response lost'); };
  const result = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in result); if (!('kind' in result)) return;
  let reads = 0; f.dependencies.reconcileOperation = async (_prepared, operation, checkpoints) => { reads++; assert.equal(operation.phase, 'body'); assert.equal(checkpoints.page?.pageId, f.page.pageId); return { status: 'after', checkpoint: f.body }; };
  const mutationsBefore = f.calls.filter(item => ['header', 'page', 'body', 'binding', 'publish'].includes(item)).length;
  const reconciled = await reconcileFullReplica(f.manifest, f.dependencies, result);
  assert.equal(reads, 1); assert.equal(reconciled.pending, null); assert.equal(reconciled.checkpoints.body?.bodyHash, f.body.bodyHash); assert.equal(reconciled.checkpoints.bound, undefined);
  assert.equal(reconciled.lastError, undefined); assert.ok(result.lastError);
  assert.equal(f.calls.filter(item => ['header', 'page', 'body', 'binding', 'publish'].includes(item)).length, mutationsBefore);
  await assert.rejects(reconcileFullReplica(f.manifest, f.dependencies, reconciled), /reconciliation_not_pending/);
});

test('explicit current-draft rebase changes only the body fingerprint after a prewrite layout failure', async () => {
  const fixtureData = fixture(), built = await runFullReplica(fixtureData.manifest, fixtureData.dependencies);
  assert.ok('kind' in built); if (!('kind' in built)) return;
  const pending = structuredClone(built);
  pending.pending = { operationId: 'pending-layout', taskId: pending.taskId, runId: pending.runId, phase: 'layout-revision', expectedCheckpointHash: fullReplicaHash(pending.checkpoints), createdAt: new Date().toISOString() };
  pending.status = 'write-unknown'; pending.lastError = { phase: 'layout-revision', operationId: 'pending-layout', code: 'replica_full_body_driver_bound_fingerprint_changed' };
  const oldFingerprint = fullReplicaFingerprint(pending.checkpoints.bound!);
  let reads = 0;
  fixtureData.dependencies.rebaseCurrentDraft = async (bound, operation, currentBodyHash, currentDocumentHash) => { reads++; assert.equal(operation.operationId, 'pending-layout'); assert.equal(currentBodyHash, h('b')); assert.equal(currentDocumentHash, h('c')); return { ...bound, bodyHash: currentBodyHash, documentHash: currentDocumentHash }; };
  await assert.rejects(rebaseFullReplicaCurrentDraft(fixtureData.manifest, fixtureData.dependencies, pending, h('0'), h('b'), h('c')), /rebase_expected_state_invalid/);
  assert.equal(reads, 0);
  const rebased = await rebaseFullReplicaCurrentDraft(fixtureData.manifest, fixtureData.dependencies, pending, oldFingerprint, h('b'), h('c'));
  assert.equal(reads, 1); assert.equal(rebased.pending, null); assert.equal(rebased.status, 'awaiting-review'); assert.equal(rebased.revision, built.revision + 1);
  assert.equal(rebased.checkpoints.body?.bodyHash, h('b')); assert.equal(rebased.checkpoints.bound?.bodyHash, h('b')); assert.equal(rebased.checkpoints.bound?.documentHash, h('c'));
  assert.deepEqual(rebased.checkpoints.page, built.checkpoints.page); assert.deepEqual(rebased.checkpoints.header, built.checkpoints.header);
  assert.equal(rebased.lastError, undefined); assert.deepEqual(pending.checkpoints, built.checkpoints);
});

test('reconciliation preserves a conflict and a confirmed before state merely clears intent', async () => {
  const f = fixture(); f.dependencies.createPage = async () => { throw Error('Unknown create'); };
  const result = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in result); if (!('kind' in result)) return;
  assert.equal(result.pending?.phase, 'page'); assert.equal(result.checkpoints.header, undefined);
  f.dependencies.reconcileOperation = async () => ({ status: 'conflict' });
  const conflict = await reconcileFullReplica(f.manifest, f.dependencies, result); assert.deepEqual(conflict, result);
  f.dependencies.reconcileOperation = async () => ({ status: 'before' });
  const before = await reconcileFullReplica(f.manifest, f.dependencies, result); assert.equal(before.pending, null); assert.deepEqual(before.checkpoints, {}); assert.equal(before.status, 'building'); assert.equal(f.calls.includes('header'), false); assert.equal(before.lastError, undefined);
});

test('CSS-only revision preserves independent header/body source inputs, invalidates review and requires the exact bound fingerprint', async () => {
  const f = fixture(), built = await runFullReplica(f.manifest, f.dependencies, { reviewInput: {} }); assert.ok('kind' in built); if (!('kind' in built)) return;
  assert.equal(built.status, 'reviewed'); const previousManifest = structuredClone(f.manifest), callsBefore = f.calls.filter(call => ['header', 'page', 'body', 'binding'].includes(call)).length;
  f.dependencies.reviseStyle = async (_prepared, bound, css, operation) => { assert.equal(operation.phase, 'style-revision'); assert.equal(f.saved.at(-1)?.pending?.operationId, operation.operationId); assert.equal(f.saved.at(-1)?.review, null); assert.equal(css.path, 'revision.css'); return { ...bound, bodyHash: h('b'), cssHash: h('c'), documentHash: h('d') }; };
  const ref = { path: 'revision.css', sha256: h('e') };
  await assert.rejects(reviseFullReplicaStyle(f.manifest, f.dependencies, built, ref, h('0')), /style_revision_stale/);
  const revised = await reviseFullReplicaStyle(f.manifest, f.dependencies, built, ref, fullReplicaFingerprint(built.checkpoints.bound!));
  assert.equal(revised.status, 'awaiting-review'); assert.equal(revised.review, null); assert.equal(revised.checkpoints.bound?.headerHash, built.checkpoints.bound?.headerHash); assert.equal(revised.checkpoints.body?.cssHash, h('c')); assert.deepEqual(f.manifest, previousManifest); assert.equal(f.calls.filter(call => ['header', 'page', 'body', 'binding'].includes(call)).length, callsBefore);
});

test('new runtime retains the exact review and revision when the protected driver proves CSS is unchanged', async () => {
  const f = fixture(); f.manifest.editorCompletionPolicy = { version: 1, mode: 'align-and-reopen', runtime: 'shared-owned-editor-v1' };
  const built = await runFullReplica(f.manifest, f.dependencies, { reviewInput: {} }); assert.ok('kind' in built); if (!('kind' in built)) return;
  let checks = 0;
  f.dependencies.reviseStyle = async (_prepared, bound) => { checks++; return structuredClone(bound); };
  const next = await reviseFullReplicaStyle(f.manifest, f.dependencies, built, { path: 'same.css', sha256: h('e') }, fullReplicaFingerprint(built.checkpoints.bound!));
  assert.equal(checks, 1); assert.equal(next.revision, built.revision); assert.deepEqual(next.review, built.review); assert.deepEqual(next.checkpoints, built.checkpoints); assert.equal(next.status, built.status); assert.equal(next.pending, null);
});

test('header CSS revision updates only the independent style hash and invalidates the whole-page review', async () => {
  const f = fixture(), built = await runFullReplica(f.manifest, f.dependencies, { reviewInput: {} }); assert.ok('kind' in built); if (!('kind' in built)) return;
  const original = structuredClone(f.manifest), ref = { path: 'header-revision.css', sha256: h('d') };
  f.dependencies.reviseHeaderStyle = async (_prepared, bound, css, operation) => {
    assert.equal(operation.phase, 'header-style-revision'); assert.equal(css.path, ref.path); assert.equal(f.saved.at(-1)?.pending?.operationId, operation.operationId); assert.equal(f.saved.at(-1)?.review, null);
    return { header: { ...f.header, styleHash: h('e') }, bound: { ...bound, styleHash: h('e') } };
  };
  await assert.rejects(reviseFullReplicaHeaderStyle(f.manifest, f.dependencies, built, ref, h('0')), /header_style_revision_stale/);
  const next = await reviseFullReplicaHeaderStyle(f.manifest, f.dependencies, built, ref, fullReplicaFingerprint(built.checkpoints.bound!));
  assert.equal(next.status, 'awaiting-review'); assert.equal(next.review, null); assert.equal(next.pending, null); assert.equal(next.checkpoints.header?.styleHash, h('e')); assert.equal(next.checkpoints.bound?.styleHash, h('e'));
  assert.deepEqual(next.checkpoints.body, built.checkpoints.body); assert.deepEqual(f.manifest, original); assert.equal(f.calls.filter(call => call === 'body').length, 1);
});

test('header CSS revision rejects changes to menu or body responsibilities and preserves the pending operation', async () => {
  const f = fixture(), built = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in built); if (!('kind' in built)) return;
  f.dependencies.reviseHeaderStyle = async (_prepared, bound) => ({ header: { ...f.header, menuHash: h('f') }, bound: { ...bound, menuHash: h('f') } });
  const next = await reviseFullReplicaHeaderStyle(f.manifest, f.dependencies, built, { path: 'revision.css', sha256: h('a') }, fullReplicaFingerprint(built.checkpoints.bound!));
  assert.equal(next.status, 'write-unknown'); assert.equal(next.pending?.phase, 'header-style-revision'); assert.deepEqual(next.checkpoints, built.checkpoints); assert.equal(next.lastError?.code, 'replica_full_header_style_revision_boundary_changed');
});

test('remote failures persist only a bounded safe code and never the remote error message', async () => {
  for (const [error, code] of [[Object.assign(Error('https://target.example/?token=private-secret'), { code: 'php_execution_failed' }), 'php_execution_failed'], [Error('Authorization: private-secret at https://target.example/?token=private-secret'), 'replica_full_operation_unconfirmed']] as const) {
    const f = fixture(); f.dependencies.createPage = async () => { throw error; };
    const result = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in result); if (!('kind' in result)) return;
    assert.deepEqual(result.lastError, { phase: 'page', operationId: result.pending?.operationId, code }); assert.doesNotMatch(JSON.stringify(f.saved), /private-secret|Authorization/); assert.equal(f.calls.includes('header'), false);
    assert.equal(fullReplicaDelivery(result, f.manifest).lastError?.code, code);
  }
});

test('local preparation and review failures also retain safe diagnostic codes without remote messages', async () => {
  const f = fixture(); f.dependencies.prepareHeader = async () => { throw Error('replica_full_test_local_failure'); };
  await assert.rejects(runFullReplica(f.manifest, f.dependencies), /test_local_failure/); assert.deepEqual(f.saved.at(-1)?.lastError, { phase: 'preparation', code: 'replica_full_test_local_failure' });
  const r = fixture(); r.dependencies.verifyReview = async () => { throw Error('replica_full_test_review_failure'); };
  await assert.rejects(runFullReplica(r.manifest, r.dependencies, { reviewInput: {} }), /test_review_failure/); assert.deepEqual(r.saved.at(-1)?.lastError, { phase: 'review', code: 'replica_full_test_review_failure' }); assert.equal(r.calls.includes('publish'), false);
});

test('failed read-only reconciliation records a safe code and keeps the original pending write', async () => {
  const f = fixture(); f.dependencies.createPage = async () => { throw Error('Lost response'); };
  const pending = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in pending); if (!('kind' in pending)) return;
  f.dependencies.reconcileOperation = async () => { throw Error('replica_full_test_readback_failed'); };
  await assert.rejects(reconcileFullReplica(f.manifest, f.dependencies, pending), /test_readback_failed/); const saved = f.saved.at(-1)!;
  assert.deepEqual(saved.pending, pending.pending); assert.deepEqual(saved.checkpoints, pending.checkpoints); assert.equal(saved.lastError?.code, 'replica_full_test_readback_failed'); assert.equal(f.calls.includes('header'), false);
});

test('confirmed binding or a confirmed bound checkpoint clears stale errors while the historical failed state remains intact', async () => {
  const f = fixture(); f.dependencies.bindHeader = async () => { throw Error('replica_full_test_binding_failed'); };
  const failed = await runFullReplica(f.manifest, f.dependencies); assert.ok('kind' in failed); if (!('kind' in failed)) return;
  f.dependencies.reconcileOperation = async () => ({ status: 'before' }); const before = await reconcileFullReplica(f.manifest, f.dependencies, failed);
  f.dependencies.bindHeader = async () => structuredClone(f.bound); const built = await runFullReplica(f.manifest, f.dependencies, { state: before }); assert.ok('kind' in built); if (!('kind' in built)) return;
  assert.equal(built.status, 'awaiting-review'); assert.equal(built.lastError, undefined); assert.equal(fullReplicaDelivery(built, f.manifest).lastError, null); assert.equal(failed.lastError?.code, 'replica_full_test_binding_failed');
  const stale = { ...structuredClone(built), lastError: failed.lastError }; const refreshed = await runFullReplica(f.manifest, f.dependencies, { state: stale }); assert.ok('kind' in refreshed); if ('kind' in refreshed) assert.equal(refreshed.lastError, undefined);
});

test('native motion requires current draft fingerprint, preserves original inputs/CSS and invalidates review', async () => {
  const f = fixture(), built = await runFullReplica(f.manifest, f.dependencies, { reviewInput: {} }); assert.ok('kind' in built); if (!('kind' in built)) return;
  const original = structuredClone(f.manifest); let calls = 0; f.dependencies.reviseNativeMotion = async (_prepared, bound, operation) => { calls++; assert.equal(operation.phase, 'motion-revision'); assert.equal(f.saved.at(-1)?.pending?.operationId, operation.operationId); assert.equal(f.saved.at(-1)?.review, null); return { ...bound, bodyHash: h('d'), documentHash: h('e') }; };
  await assert.rejects(reviseFullReplicaNativeMotion(f.manifest, f.dependencies, built, h('0')), /native_motion_stale/); assert.equal(calls, 0);
  const next = await reviseFullReplicaNativeMotion(f.manifest, f.dependencies, built, fullReplicaFingerprint(built.checkpoints.bound!)); assert.equal(calls, 1); assert.equal(next.status, 'awaiting-review'); assert.equal(next.review, null); assert.equal(next.pending, null); assert.equal(next.checkpoints.body?.cssHash, built.checkpoints.body?.cssHash); assert.equal(next.checkpoints.bound?.headerHash, built.checkpoints.bound?.headerHash); assert.deepEqual(f.manifest, original);
  f.dependencies.reviseNativeMotion = async (_prepared, bound) => ({ ...bound, cssHash: h('f') }); const failed = await reviseFullReplicaNativeMotion(f.manifest, f.dependencies, next, fullReplicaFingerprint(next.checkpoints.bound!)); assert.equal(failed.status, 'write-unknown'); assert.equal(failed.lastError?.code, 'replica_full_native_motion_css_changed');
  f.dependencies.reconcileOperation = async () => ({ status: 'before' }); const resolved = await reconcileFullReplica(f.manifest, f.dependencies, failed); assert.equal(resolved.pending, null); assert.deepEqual(resolved.checkpoints, next.checkpoints);
});

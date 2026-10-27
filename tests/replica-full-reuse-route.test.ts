import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { buildPreparationJobs, validatePreparationPlan, preparationSharedHash } from '../src/replica-preparation/contract.js';
import { BODY_FIDELITY_KINDS } from '../src/replica-preparation/types.js';
import { validateFullReplicaManifest, fullReplicaHash } from '../src/replica-full/contract.js';
import { prepareFullReplica } from '../src/replica-full/prepare.js';
import { runFullReplica, reviseFullReplicaHeaderStyle } from '../src/replica-full/coordinator.js';
import { fullReplicaDelivery } from '../src/replica-full/delivery.js';
import { WordPressReusedBodyDriver, inspectReusedHeaderResources, reusedBodyDriverCode } from '../src/replica-full/reused-driver.js';
import type { FullReplicaDependencies, FullReplicaReusedHeader, FullReplicaManifest, FullReplicaRunState } from '../src/replica-full/types.js';

const sha = 'a'.repeat(64), ref = { path: 'source.json', sha256: sha };
const resources: FullReplicaReusedHeader = { headerId: 'header_123', name: 'Existing HUAQI Header', editUrl: 'https://target.example/wp-admin/admin.php?page=xts_header_builder#/builder/header_123', sharedHash: sha, headerHash: sha, menuHash: sha, styleHash: sha, menus: [{ key: 'main', id: 5, name: 'Existing Menu', editUrl: 'https://target.example/wp-admin/nav-menus.php?menu=5' }], blocks: [{ id: 6, name: 'Existing Header Styles', editUrl: 'https://target.example/wp-admin/post.php?post=6&action=edit' }], mobileMaxWidth: 768, hasSubmenus: true };
const viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
const responsive = { version: 2 as const, tablet: 'desktop' as const, mobileMaxWidth: 768, viewports, source: ref, decisions: { version: 1 as const, layouts: [], carousels: [], header: { implementation: 'native' as const, flow: 'reserve-space' as const, views: viewports.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'static' as const, offset: 0 })) } }, sections: [{ key: 'body', mode: 'shared' as const, reason: 'The same native section is used on desktop and phone.', evidence: [{ snapshotId: 'wide', nodeId: 'body' }, { snapshotId: 'phone', nodeId: 'body' }], settings: [], childOrders: [], css: '' }] };
function manifest(): FullReplicaManifest {
  return validateFullReplicaManifest({ version: 4, kind: 'clonewp-full-replica', taskId: 'new-body-task', runId: 'new-body-run', title: 'New body', slug: 'new-body', sourceUrl: 'https://source.example/', targetOrigin: 'https://target.example', headerProvider: 'reused-woodmart-header', reusedHeader: resources, responsive, sourceEvidence: ref, sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] }, body: { program: ref, css: ref, sourceUnits: ref } });
}

test('new body scope requires a frozen shared footer and excludes it from source body units', () => {
  const input = manifest(), partition = { ...input.sourcePartition, allUnits: ['header', 'body', 'footer'], footerUnits: ['footer'] };
  assert.throws(() => validateFullReplicaManifest({ ...input, pageScope: 'body-only', sourcePartition: partition }), /footer_scope_contract/);
  const body = validateFullReplicaManifest({ ...input, pageScope: 'body-only', reusedHeader: { ...resources, footerHash: sha }, sourcePartition: partition });
  assert.equal(body.pageScope, 'body-only'); assert.deepEqual(body.sourcePartition.bodyUnits, ['body']);
  assert.throws(() => validateFullReplicaManifest({ ...body, sourcePartition: { ...partition, bodyUnits: ['body', 'footer'] } }), /partition/);
  const { pageScope: _scope, ...withoutScope } = body;
  assert.throws(() => validateFullReplicaManifest(withoutScope), /footer_requires_body_only/);
  assert.equal(manifest().pageScope, undefined);
});

test('body-only driver preserves shared footer flags and rejects a changed footer before any write', async () => {
  const input = validateFullReplicaManifest({ ...manifest(), pageScope: 'body-only', reusedHeader: { ...resources, footerHash: sha } });
  const page = { pageId: 77, runId: input.runId, status: 'draft' as const, title: input.title, slug: input.slug, template: 'elementor_header_footer', headerId: null, elements: [], settings: {}, bodyHash: sha, documentHash: sha, publicUrl: 'https://target.example/new-body/', metaHash: sha, flags: { _woodmart_title_off: '1', _woodmart_prefooter_off: '', _woodmart_footer_off: '', _woodmart_copyrights_off: '', _woodmart_main_layout: 'full-width' } };
  let current = { hash: sha, resources: input.reusedHeader!, page, receipts: {} }, writes = 0;
  const transport = { origin: input.targetOrigin, async readPHP() { return { ok: true, value: current } as any; }, async executePHP() { writes++; throw Error('Unexpected write'); } };
  const driver = new WordPressReusedBodyDriver(transport, input);
  assert.equal((await driver.inspect()).page?.flags._woodmart_footer_off, '');
  current = { ...current, page: { ...page, flags: { ...page.flags, _woodmart_footer_off: '1' } } };
  await assert.rejects(driver.inspect(), /page_shell/);
  current = { ...current, page, resources: { ...current.resources, footerHash: 'b'.repeat(64) } };
  await assert.rejects(driver.mutate('bind', current, 'bind-once', { pageId: 77 }, { operationId: 'bind-once', runId: input.runId, resource: `full-replica-reuse/${input.runId}`, expectedSnapshotSha256: sha, persistedIntentSha256: sha }), /resources_changed/);
  assert.equal(writes, 0);
});

test('reused provider freezes only readonly resources and rejects mixed, stale-device or cross-origin identities', () => {
  const input = manifest(); assert.equal(input.header, undefined);
  assert.throws(() => validateFullReplicaManifest({ ...input, headerProvider: 'woodmart-header-builder' }), /reused_header_provider_required/);
  assert.throws(() => validateFullReplicaManifest({ ...input, version: 3 }), /reused_header_contract/);
  assert.throws(() => validateFullReplicaManifest({ ...input, header: { plan: {}, bundleDirectory: 'header', assets: ref } }), /reused_header_contract/);
  assert.throws(() => validateFullReplicaManifest({ ...input, reusedHeader: { ...resources, mobileMaxWidth: 767 } }), /reused_header_contract/);
  assert.throws(() => validateFullReplicaManifest({ ...input, reusedHeader: { ...resources, editUrl: 'https://other.example/admin' } }), /reused_header_resource_origin/);
});
test('explicit readonly header decisions are allowed only by matching v8 preparation and v4 reused-header contracts', async () => {
  const readonly = { mode: 'reuse-readonly' as const, requestRef: 'user-body-only', reason: 'The user explicitly reuses this existing shared header unchanged.', headerId: resources.headerId, sharedHash: resources.sharedHash, evidence: [ref] };
  const input = manifest(); input.responsive!.decisions!.header = readonly;
  assert.equal((validateFullReplicaManifest(input).responsive!.decisions!.header as typeof readonly).mode, 'reuse-readonly');
  const { reusedHeader: _reusedHeader, ...owned } = input;
  assert.throws(() => validateFullReplicaManifest({ ...owned, headerProvider: 'woodmart-header-builder', header: { plan: {}, bundleDirectory: 'header', assets: ref } }), /readonly_header_scope/);
  assert.throws(() => validateFullReplicaManifest({ ...input, version: 3 }), /reused_header_contract/);
  assert.throws(() => validateFullReplicaManifest({ ...input, reusedHeader: { ...resources, sharedHash: 'b'.repeat(64) } }), /readonly_header_scope/);
  const fixtureData = await preparationIOFixture(); try {
    const plan = fixtureData.plan, headerBase = plan.headerBase, headerAssets = plan.headerAssets; plan.version = 8; delete plan.headerBase; delete plan.headerAssets; plan.reusedHeader = resources; plan.bodyBase.visualAuditVersion = 3;
    const { sections: _sections, ...policy } = responsive; plan.responsive = { ...policy, decisions: { ...policy.decisions, header: readonly } };
    for (const section of plan.sections) {
      section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: 'required', sourceFactIds: section.sourceFactIds, expected: 'Retain the complete source presentation and state.', evidence: [ref] }));
      section.visualTargets = [{ kind: 'geometry', sourceFactId: section.sourceFactIds[0], rect: { x: 0, y: 0, width: 100, height: 100 }, evidence: ref }, { kind: 'paint', sourceFactId: section.sourceFactIds[0], property: 'color', value: '#123', evidence: ref }];
    }
    assert.equal(validatePreparationPlan(plan).version, 8);
    const { reusedHeader: _resources, ...ownedPlan } = plan;
    assert.throws(() => validatePreparationPlan({ ...ownedPlan, headerBase, headerAssets }), /readonly_header_scope/);
    assert.throws(() => validatePreparationPlan({ ...plan, version: 7 }), /header_provider_contract/);
  } finally { await fixtureData.cleanup(); }
});

test('preparation v8 creates real body-only jobs and keeps source header partition excluded', async () => {
  const f = await preparationIOFixture(); try {
    const plan = f.plan; plan.version = 8; delete plan.headerBase; delete plan.headerAssets; plan.reusedHeader = resources; plan.bodyBase.visualAuditVersion = 3;
    const { sections: _sections, ...sourcePolicy } = responsive; plan.responsive = sourcePolicy;
    for (const section of plan.sections) {
      section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: 'required', sourceFactIds: section.sourceFactIds, expected: 'Retain the complete source presentation and state.', evidence: [ref] }));
      section.visualTargets = [{ kind: 'geometry', sourceFactId: section.sourceFactIds[0], rect: { x: 0, y: 0, width: 100, height: 100 }, evidence: ref }, { kind: 'paint', sourceFactId: section.sourceFactIds[0], property: 'color', value: '#123', evidence: ref }];
    }
    const validated = validatePreparationPlan(plan), jobs = buildPreparationJobs(validated);
    assert.deepEqual(jobs.map(row => row.jobId), ['body-1', 'body-2']);
    assert.ok(jobs.every(job => job.responsibility === 'body' && job.sourceUnitIds.every(id => !plan.sourcePartition.headerUnits.includes(id))));
    assert.doesNotThrow(() => preparationSharedHash(validated));
    const scoped = validatePreparationPlan({ ...plan, pageScope: 'body-only', reusedHeader: { ...resources, footerHash: sha }, sourcePartition: { ...plan.sourcePartition, allUnits: [...plan.sourcePartition.allUnits, 'shared-footer'], footerUnits: ['shared-footer'] } });
    assert.ok(buildPreparationJobs(scoped).every(job => !job.sourceUnitIds.includes('shared-footer')));
    assert.notEqual(preparationSharedHash(scoped), preparationSharedHash(validated));
    assert.throws(() => validatePreparationPlan({ ...scoped, reusedHeader: resources }), /footer_scope_contract/);
    assert.throws(() => validatePreparationPlan({ ...plan, version: 7 }), /header_provider_contract/);
  } finally { await f.cleanup(); }
});

test('formal full coordinator does not create a header job or owned header checkpoint when reusing', async () => {
  const input = manifest(), events: string[] = [], persisted: FullReplicaRunState[] = [];
  const preparedBody = { programHash: sha, cssInputHash: sha, sourceUnitsHash: sha, sourceEvidenceHash: sha, sourceUnitIds: ['body'], componentSourceUnitIds: ['body'], embeddedHeaderCount: 0, payload: {} };
  const page = { pageId: 77, runId: input.runId, status: 'draft' as const, template: 'elementor_header_footer' as const, editUrl: 'https://target.example/wp-admin/post.php?post=77&action=elementor', previewUrl: 'https://target.example/?page_id=77&preview=true', bodyHash: sha, headerId: null };
  const body = { ...page, cssHash: sha, documentHash: sha, sourceUnitIds: ['body'], embeddedHeaderCount: 0 as const };
  const bound = { pageId: page.pageId, runId: input.runId, headerId: resources.headerId, editUrl: page.editUrl, previewUrl: page.previewUrl, bodyHash: sha, cssHash: sha, documentHash: sha, headerHash: sha, menuHash: sha, styleHash: sha };
  const deps: FullReplicaDependencies = {
    async prepareHeader() { assert.fail('No header preparation for reuse'); }, async provisionHeader() { assert.fail('No header write'); }, async bindHeader() { assert.fail('No owned header bind'); },
    async prepareBody() { events.push('prepare-body'); return preparedBody; }, assertPreparedBody(value) { assert.equal(value, preparedBody); }, async writeState(state) { persisted.push(state); },
    async createPage() { events.push('create-page'); return page; }, async saveBody() { events.push('save-body'); return body; }, async bindReusedHeader(_body, operation) { assert.equal(persisted.at(-1)?.pending?.operationId, operation.operationId); events.push('bind-existing'); return bound; },
    async reviewWholePage() { events.push('whole-page-review'); return null; }, async verifyReview() { assert.fail('No review provided'); }, async publishPage() { assert.fail('Unreviewed page must not publish'); },
  };
  const prepared = await prepareFullReplica(input, deps); assert.equal(prepared.header, undefined); events.length = 0;
  const state = await runFullReplica(input, deps); assert.ok('checkpoints' in state); if (!('checkpoints' in state)) return;
  assert.deepEqual(events, ['prepare-body', 'create-page', 'save-body', 'bind-existing', 'whole-page-review']); assert.equal(state.checkpoints.header, undefined); assert.equal(state.status, 'awaiting-review');
  const delivery = fullReplicaDelivery(state, input); assert.equal(delivery.resources.filter(row => row.kind.startsWith('reused')).length, 3);
  await assert.rejects(reviseFullReplicaHeaderStyle(input, deps, state, ref, fullReplicaHash(bound)), /reused_header_readonly/);
});

test('resource inspector is readonly and reuse driver refuses changed shared resources before mutation', async () => {
  let writes = 0;
  const transport = { origin: 'https://target.example', async readPHP() { return { ok: true, value: resources } as any; }, async executePHP() { writes++; throw Error('must not write'); } };
  assert.deepEqual(await inspectReusedHeaderResources(transport, { headerId: resources.headerId, mobileMaxWidth: 768 }), resources);
  const driver = new WordPressReusedBodyDriver(transport, manifest());
  await assert.rejects(driver.mutate('bind', { hash: sha, resources: { ...resources, sharedHash: 'b'.repeat(64) }, page: null, receipts: {} }, 'bind-once', { pageId: 77 }, { operationId: 'bind-once', runId: 'new-body-run', resource: 'full-replica-reuse/new-body-run', expectedSnapshotSha256: sha, persistedIntentSha256: sha }), /resources_changed/);
  assert.equal(writes, 0);
});

test('fixed reuse helper protects old resources and permits only new task-owned page actions', async () => {
  const code = await reusedBodyDriverCode({ targetOrigin: 'https://target.example', headerId: 'header_123', mobileMaxWidth: 768 }, { action: 'resources' });
  assert.match(code, /reused_header_contract/); assert.match(code, /reuse_snapshot_changed/); assert.match(code, /reuse_shared_changed/); assert.match(code, /wp_check_post_lock/);
  assert.doesNotMatch(code, /update_option\('whb_|wp_update_nav_menu|wp_delete_post|wp_delete_nav_menu/);
  assert.match(code, /get_post_meta\(\$item->ID\)/); assert.match(code, /get_post_meta\(\$block->ID\)/);
  const source = await readFile('D:/cloneWP/src/replica-full/reused-body.ts', 'utf8');
  for (const name of ['prepareActualBody', 'resolveActualBodyStyles', 'compileActualBody', 'importFullReplicaBodyAssets', 'verifyFullReplicaReviewEvidence']) assert.ok(source.includes(name));
});

test('reuse driver rejects stale page shell or mismatched native receipt without retry', async () => {
  const current = { pageId: 77, runId: 'new-body-run', status: 'draft' as const, title: 'New body', slug: 'new-body', template: 'elementor_header_footer', headerId: null, elements: [], settings: {}, bodyHash: sha, documentHash: sha, publicUrl: 'https://target.example/new-body/', metaHash: sha, flags: { _woodmart_title_off: '1', _woodmart_prefooter_off: '1', _woodmart_footer_off: '1', _woodmart_copyrights_off: '1', _woodmart_main_layout: 'full-width' } };
  let snapshot = { hash: sha, resources, page: current, receipts: {} }, writes = 0;
  const transport = { origin: 'https://target.example', async readPHP() { return { ok: true, value: snapshot } as any; }, async executePHP() { writes++; return { ok: true, value: { snapshot, result: { pageId: 77 } } } as any; } };
  const driver = new WordPressReusedBodyDriver(transport, manifest()); assert.equal((await driver.inspect()).page?.pageId, 77);
  snapshot = { ...snapshot, page: { ...current, flags: { ...current.flags, _woodmart_footer_off: '0' } } };
  await assert.rejects(driver.inspect(), /page_shell/);
  snapshot = { ...snapshot, page: current };
  await assert.rejects(driver.mutate('bind', snapshot, 'bind-once', { pageId: 77 }, { operationId: 'bind-once', runId: 'new-body-run', resource: 'full-replica-reuse/new-body-run', expectedSnapshotSha256: sha, persistedIntentSha256: sha }), /reuse_receipt/);
  assert.equal(writes, 1);
});

test('resource contracts reject credentials and one-time access URLs before preparation can persist them', () => {
  const input = manifest();
  assert.throws(() => validateFullReplicaManifest({ ...input, reusedHeader: { ...resources, editUrl: 'https://target.example/wp-admin/?nonce=secret' } }));
  assert.throws(() => validateFullReplicaManifest({ ...input, reusedHeader: { ...resources, menus: [{ ...resources.menus[0], editUrl: 'https://user:password@target.example/wp-admin/' }] } }));
});

test('reuse helper requires publication capability before starting any publish write', async () => {
  const code = await reusedBodyDriverCode({ targetOrigin: 'https://target.example', headerId: 'header_123', mobileMaxWidth: 768 }, { action: 'inspect' });
  const guard = "$action==='publish'&&!current_user_can('publish_pages')";
  assert.ok(code.includes(guard));
  assert.ok(code.indexOf(guard) < code.indexOf("$receipts[$operation]=['action'=>$action"));
  assert.ok(code.indexOf(guard) < code.indexOf("wp_update_post(['ID'=>$id,'post_status'=>'publish']"));
});

test('reuse resource walk includes only the supported search extra content lookup in shared block proofs', async () => {
  const code = await reusedBodyDriverCode({ targetOrigin: 'https://target.example', headerId: 'header_123', mobileMaxWidth: 768 }, { action: 'resources' });
  assert.ok(code.includes("$key==='search_extra_content'&&strtolower((string)($node['type']??''))==='search'"));
  assert.ok(code.includes("&&$value)$addBlock($value)"));
  assert.ok(code.includes("'proof'=>[$block,$meta]"));
  assert.ok(code.includes("$styleHash=$digest($blocks);$sharedHash=$digest([$raw,$menus,$blocks"));
  assert.equal(code.includes("$key==='search_extra_content_enabled'"), false);
});

test('reuse driver cannot cross any unresolved historic write using a different operation id', async () => {
  let writes = 0;
  const transport = { origin: 'https://target.example', async readPHP() { assert.fail('No read required for known unresolved snapshot'); }, async executePHP() { writes++; assert.fail('No write may cross an unresolved receipt'); } };
  const driver = new WordPressReusedBodyDriver(transport, manifest());
  for (const state of ['started', 'unknown', undefined]) {
    const before = { hash: sha, resources, page: null, receipts: { 'previous-operation': { action: 'create-page', payloadHash: sha, state } } } as any;
    await assert.rejects(driver.mutate('create-page', before, 'different-operation', { title: 'New body', slug: 'new-body' }, { operationId: 'different-operation', runId: 'new-body-run', resource: 'full-replica-reuse/new-body-run', expectedSnapshotSha256: sha, persistedIntentSha256: sha }), /reconcile_required/);
  }
  assert.equal(writes, 0);
  const code = await reusedBodyDriverCode({ targetOrigin: 'https://target.example', headerId: 'header_123', mobileMaxWidth: 768 }, { action: 'inspect' });
  assert.ok(code.includes("foreach((array)$before['receipts'] as $receipt)if(!is_array($receipt)||($receipt['state']??null)!=='complete')throw new RuntimeException('reuse_reconcile_required')"));
  assert.ok(code.indexOf("throw new RuntimeException('reuse_reconcile_required')") < code.indexOf("$receipts[$operation]=['action'=>$action"));
});

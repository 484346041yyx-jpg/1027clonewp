import test from 'node:test';
import assert from 'node:assert/strict';
import { WordPressFullReplicaDriver, type FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';
import { headerJsonHash } from '../src/woodmart-header/contract.js';
import type { HeaderModuleIdentity } from '../src/woodmart-header/generic/wordpress.js';

const identity: HeaderModuleIdentity = { moduleKey: 'alder-full-driver', owner: { ownerId: 'clonewp', runId: 'alder-driver-run' }, targetOrigin: 'https://target.example', headerId: 'header_12345' }, hash = 'a'.repeat(64);
function remoteSnapshot(): FullReplicaRemoteSnapshot { return { hash, page: null, receipts: {}, header: { hash, contract: { targetOrigin: identity.targetOrigin } as any, resources: { targetOrigin: identity.targetOrigin, menus: {}, media: {}, styleBlockId: 0 }, snapshot: { module: null, globalHash: hash, defaultHeaderId: 'default_header', presetReferences: [], otherReferences: [] } } }; }
test('full driver injects only fixed local helpers and base64 data, with independent persisted mutation intent', async () => {
  const calls: Array<{ code: string; mutation: boolean }> = [], snapshot = remoteSnapshot();
  const transport = { origin: identity.targetOrigin, async readPHP<T>(operation: { code: string }) { calls.push({ code: operation.code, mutation: false }); return { ok: true, value: snapshot } as T; }, async executePHP<T>(operation: { code: string }) {
    calls.push({ code: operation.code, mutation: true }); const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], input = JSON.parse(Buffer.from(encoded, 'base64').toString());
    assert.equal(input.action, 'create-page'); assert.equal(input.payload.title, "Alder '); not PHP"); snapshot.receipts[input.operationId] = { action: 'create-page', payloadHash: headerJsonHash(input.payload), state: 'complete', result: { pageId: 99 } };
    return { ok: true, value: { snapshot, result: { pageId: 99 } } } as T;
  } };
  const driver = new WordPressFullReplicaDriver(transport); await driver.inspect(identity);
  const result = await driver.mutate(identity, { action: 'create-page', operationId: 'operation-1', expectedHash: hash, payload: { title: "Alder '); not PHP", slug: 'alder' } }, { operationId: 'operation-1', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: 'b'.repeat(64) });
  assert.equal(result.result.pageId, 99); assert.equal(calls.length, 2); assert.match(calls[0].code, /\$headerRead=static function\(\$input\)/); assert.match(calls[0].code, /full_owned_draft/); assert.doesNotMatch(calls[1].code, /Alder '\); not PHP/);
});
test('full driver rejects a cross-site target or mismatched intent before transport calls, and never retries an unconfirmed receipt', async () => {
  let calls = 0; const snapshot = remoteSnapshot(), transport = { origin: identity.targetOrigin, async readPHP<T>() { calls++; return { ok: true, value: snapshot } as T; }, async executePHP<T>() { calls++; return { ok: true, value: { snapshot, result: { pageId: 99 } } } as T; } }, driver = new WordPressFullReplicaDriver(transport);
  await assert.rejects(driver.inspect({ ...identity, targetOrigin: 'https://other.example' }), /target_mismatch/); assert.equal(calls, 0);
  const request = { action: 'create-page' as const, operationId: 'operation-1', expectedHash: hash, payload: { title: 'Alder', slug: 'alder' } }, intent = { operationId: 'other', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash };
  await assert.rejects(driver.mutate(identity, request, intent), /intent_invalid/); assert.equal(calls, 0);
  await assert.rejects(driver.mutate(identity, request, { ...intent, operationId: request.operationId }), /receipt_unconfirmed/); assert.equal(calls, 1);
});
test('full driver refuses an owned page that lost Full Width or per-page footer isolation', async () => {
  const value = remoteSnapshot(); value.page = { pageId: 99, runId: identity.owner.runId, status: 'draft', template: 'elementor_canvas', title: 'Alder', slug: 'alder', headerId: null, elements: [], settings: {}, bodyHash: hash, built: true, publicUrl: 'https://target.example/alder/', flags: {} };
  const driver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP<T>() { return { ok: true, value } as T; }, async executePHP<T>(): Promise<T> { throw Error('No mutation allowed'); } });
  await assert.rejects(driver.inspect(identity), /page_boundary/);
});

test('fixed shell accepts only the exact page ID and requires a matching confirmed native receipt and readback', async () => {
  let calls = 0; const value = remoteSnapshot(); value.page = { pageId: 99, runId: identity.owner.runId, status: 'draft', template: 'elementor_header_footer', title: 'Alder', slug: 'alder', headerId: identity.headerId, elements: [], settings: {}, bodyHash: hash, built: true, publicUrl: 'https://target.example/alder/', flags: { _woodmart_prefooter_off: '1', _woodmart_footer_off: '1', _woodmart_copyrights_off: '1' } };
  value.header.snapshot.module = { pages: { 99: {} }, identity } as any;
  const driver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP<T>(): Promise<T> { throw Error('No read expected'); }, async executePHP<T>(operation: { code: string }) {
    calls++; const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], input = JSON.parse(Buffer.from(encoded, 'base64').toString()), result = { pageId: 99, titleDisabled: true, sidebarDisabled: true }; assert.deepEqual(input.payload, { pageId: 99 }); assert.equal(input.action, 'shell');
    value.receipts[input.operationId] = { action: 'shell', payloadHash: headerJsonHash(input.payload), state: 'complete', result }; return { ok: true, value: { snapshot: value, result } } as T;
  } });
  const request = { action: 'shell' as const, operationId: 'shell-1', expectedHash: hash, payload: { pageId: 99 } }, intent = { operationId: 'shell-1', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash };
  for (const payload of [{ pageId: 0 }, { pageId: '99' }, { pageId: 99, titleDisabled: false }, { pageId: 99, arbitrary: 'value' }]) await assert.rejects(driver.mutate(identity, { ...request, payload }, intent), /shell_payload_invalid/);
  assert.equal(calls, 0); assert.equal((await driver.mutate(identity, request, intent)).result.titleDisabled, true); assert.equal(calls, 1);
});

test('fixed motion accepts no caller speed and verifies unique safe widget IDs in the exact receipt', async () => {
  let calls = 0, ids: unknown = ['carousel1', 'carousel2']; const value = remoteSnapshot(); value.page = { pageId: 99, runId: identity.owner.runId, status: 'draft', template: 'elementor_header_footer', title: 'Alder', slug: 'alder', headerId: identity.headerId, elements: [], settings: {}, bodyHash: hash, built: true, publicUrl: 'https://target.example/alder/', flags: { _woodmart_prefooter_off: '1', _woodmart_footer_off: '1', _woodmart_copyrights_off: '1' } }; value.header.snapshot.module = { pages: { 99: {} }, identity } as any;
  const driver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP<T>(): Promise<T> { throw Error('No read expected'); }, async executePHP<T>(operation: { code: string }) { calls++; const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], input = JSON.parse(Buffer.from(encoded, 'base64').toString()), result = { pageId: 99, widgetIds: ids }; value.receipts[input.operationId] = { action: 'motion', payloadHash: headerJsonHash(input.payload), state: 'complete', result }; return { ok: true, value: { snapshot: value, result } } as T; } });
  const request = { action: 'motion' as const, operationId: 'motion-1', expectedHash: hash, payload: { pageId: 99 } }, intent = { operationId: 'motion-1', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash };
  await assert.rejects(driver.mutate(identity, { ...request, payload: { pageId: 99, speed: 300 } }, intent), /motion_payload_invalid/); assert.equal(calls, 0); assert.deepEqual((await driver.mutate(identity, request, intent)).result.widgetIds, ids);
  for (const invalid of [[], ['duplicate', 'duplicate'], ['https://bad.example'], [99]]) { ids = invalid; await assert.rejects(driver.mutate(identity, request, intent), /motion_readback_invalid/); }
});
test('layout driver accepts only a typed container plan under the exact owned-page intent', async () => {
  let calls = 0;
  const value = remoteSnapshot();
  value.page = { pageId: 99, runId: identity.owner.runId, status: 'draft', template: 'elementor_header_footer', title: 'Alder', slug: 'alder', headerId: identity.headerId, elements: [], settings: {}, bodyHash: hash, built: true, publicUrl: 'https://target.example/alder/', flags: { _woodmart_prefooter_off: '1', _woodmart_footer_off: '1', _woodmart_copyrights_off: '1' } };
  value.header.snapshot.module = { pages: { 99: {} }, identity } as any;
  const driver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP<T>(): Promise<T> { throw Error('No read expected'); }, async executePHP<T>(operation: { code: string }) {
    calls++;
    assert.match(operation.code, /\$containerTreePatch=static function/);
    const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], input = JSON.parse(Buffer.from(encoded, 'base64').toString()), result = { pageId: 99 };
    value.receipts[input.operationId] = { action: 'layout', payloadHash: headerJsonHash(input.payload), state: 'complete', result };
    return { ok: true, value: { snapshot: value, result } } as T;
  } });
  const plan = { version: 1, kind: 'clonewp-container-tree-plan', operations: [{ kind: 'set-controls', elementId: 'section1', controls: { flex_direction: 'row' } }] };
  const request = { action: 'layout' as const, operationId: 'layout-1', expectedHash: hash, payload: { pageId: 99, plan } }, intent = { operationId: 'layout-1', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash };
  await assert.rejects(driver.mutate(identity, { ...request, payload: { ...request.payload, html: '<p>bad</p>' } }, intent), /layout_payload_invalid/);
  await assert.rejects(driver.mutate(identity, { ...request, payload: { pageId: 99, plan: { ...plan, operations: [{ ...plan.operations[0], controls: { custom_css: 'body{}' } }] } } }, intent), /layout_payload_invalid/);
  assert.equal(calls, 0);
  assert.deepEqual((await driver.mutate(identity, request, intent)).result, { pageId: 99 });
  assert.equal(calls, 1);
});
for (const action of ['navigation-forms', 'navigation-return'] as const) test(`${action} driver accepts typed source navigation only and requires the exact generated widget receipt`, async () => {
  const form = { key: 'filter', slotComponentKey: 'products_search', sourceUnitIds: ['desktop/products'], sourceFactIds: ['desktop:interaction:form'], sourceEvidence: { path: 'form-source.json', sha256: hash }, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }] }], submitLabel: '検索' };
  const value = remoteSnapshot(); value.page = { pageId: 99, runId: identity.owner.runId, status: 'draft', template: 'elementor_header_footer', title: 'HOSHIICHI', slug: 'hoshiichi', headerId: null, elements: [], settings: {}, bodyHash: hash, built: true, publicUrl: 'https://target.example/hoshiichi/', flags: { _woodmart_prefooter_off: '1', _woodmart_footer_off: '1', _woodmart_copyrights_off: '1' } }; value.header.snapshot.module = { pages: { 99: {} }, identity } as any;
  let calls = 0, widgetIds: string[] = [];
  const driver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP<T>(): Promise<T> { throw Error('No read expected'); }, async executePHP<T>(operation: { code: string }) {
    calls++; assert.match(operation.code, /\$navigationFormPatch=static function/); assert.match(operation.code, /\$navigationReturnPatch=static function/); const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], input = JSON.parse(Buffer.from(encoded, 'base64').toString()), result = { pageId: 99, widgetIds }; assert.equal(input.action, action); value.receipts[input.operationId] = { action, payloadHash: headerJsonHash(input.payload), state: 'complete', result }; return { ok: true, value: { snapshot: value, result } } as T;
  } });
  const request = { action, operationId: 'nav-1', expectedHash: hash, payload: { pageId: 99, sourceUrl: 'https://hoshiichi.com/', taskId: 'hoshiichi', forms: [form] } }, intent = { operationId: 'nav-1', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash };
  await assert.rejects(driver.mutate(identity, { ...request, payload: { ...request.payload, html: '<form></form>' } }, intent), /navigation_form_payload_invalid/); assert.equal(calls, 0);
  await assert.rejects(driver.mutate(identity, request, intent), /navigation_form_readback_invalid/); assert.equal(calls, 1);
  const { navigationFormWidgetId } = await import('../src/replica-full/navigation-form/index.js'); widgetIds = [navigationFormWidgetId('hoshiichi', form as any)]; assert.deepEqual((await driver.mutate(identity, request, intent)).result.widgetIds, widgetIds);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { native44Id } from '../src/native44/adapters.js';
import { headerJsonHash } from '../src/woodmart-header/contract.js';
import { compileNavigationFormPatch, type NavigationFormSpec } from '../src/replica-full/navigation-form/index.js';
import { NavigationFormReceiptFinalizer, validateNavigationReceiptRecovery } from '../src/replica-full/navigation-receipt.js';
import type { FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';

const hash = 'a'.repeat(64), taskId = 'receipt-test', sourceUrl = 'https://hoshiichi.com/';
function fixture() {
  const identity = { moduleKey: 'receipt-test', headerId: 'header_12345', targetOrigin: 'https://target.example', owner: { ownerId: 'clonewp', runId: 'receipt-run' } };
  const form: NavigationFormSpec = { key: 'filter', slotComponentKey: 'products_search', sourceUnitIds: ['desktop/products'], sourceFactIds: ['desktop:interaction:form'], sourceEvidence: { path: 'source.json', sha256: hash }, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }, { label: 'スキンケア', value: 'app_skincare' }] }], submitLabel: '検索' };
  const before: FullReplicaRemoteSnapshot = { hash, receipts: {}, header: { hash, contract: { targetOrigin: identity.targetOrigin } as any, resources: { targetOrigin: identity.targetOrigin } as any, snapshot: { globalHash: hash, defaultHeaderId: 'default', presetReferences: [], otherReferences: [], module: { identity, name: 'Owned', header: { id: identity.headerId, name: identity.moduleKey, structure: { id: identity.moduleKey, type: identity.moduleKey, content: [] }, settings: {} }, menus: {}, style: { id: 1, css: 'owned' }, receipts: {}, pages: { '9': { pageId: 9, postType: 'page', status: 'draft', template: 'elementor_header_footer', runId: identity.owner.runId, headerId: null, bodyHash: hash, snapshotHash: hash } } } } }, page: { pageId: 9, runId: identity.owner.runId, status: 'draft', template: 'elementor_header_footer', title: 'Owned', slug: 'owned', headerId: null, bodyHash: hash, built: true, publicUrl: 'https://target.example/owned/', flags: {}, settings: { custom_css: 'owned', padding: { top: '1', bottom: '2' } }, elements: [{ id: native44Id(taskId, 'products_search'), elType: 'container', settings: { css_classes: 'owned' }, elements: [{ id: 'heading1', elType: 'widget', widgetType: 'heading', settings: { title: 'Preserved' }, elements: [] }] }] } };
  const patch = compileNavigationFormPatch(before.page!.elements, [form], sourceUrl, taskId), current = structuredClone(before), originalOperationId = 'original-nav', originalPayloadHash = headerJsonHash({ pageId: 9, sourceUrl, taskId, forms: [form] });
  current.hash = 'b'.repeat(64); current.page!.elements = patch.elements; current.page!.bodyHash = 'b'.repeat(64); current.header.snapshot.module!.pages['9'].bodyHash = 'b'.repeat(64); current.header.snapshot.module!.pages['9'].snapshotHash = 'b'.repeat(64); current.receipts[originalOperationId] = { action: 'navigation-forms', payloadHash: originalPayloadHash, state: 'started' };
  const input = { before, current, forms: [form], sourceUrl, taskId, originalOperationId, originalPayloadHash }, intent = { operationId: 'recovery-nav', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: current.hash, persistedIntentSha256: hash };
  return { identity, input, intent, patch };
}
test('receipt recovery accepts associative key reordering and only the independently recomputed exact typed append', () => {
  const f = fixture(), html = f.input.current.page!.elements[0].elements[1];
  f.input.current.page!.elements[0].elements[1] = { id: html.id, elType: html.elType, settings: html.settings, elements: html.elements, widgetType: html.widgetType };
  f.input.current.page!.settings.padding = { bottom: '2', top: '1' };
  assert.deepEqual(validateNavigationReceiptRecovery(f.input).patch.widgetIds, f.patch.widgetIds);
  const mutations = [
    (x: typeof f) => { x.input.current.page!.settings.padding = { top: '2', bottom: '1' }; },
    (x: typeof f) => { x.input.current.page!.settings.custom_css = 'changed'; },
    (x: typeof f) => { x.input.current.page!.elements[0].elements.reverse(); },
    (x: typeof f) => { x.input.current.page!.elements[0].elements[1].settings.html += '<input>'; },
    (x: typeof f) => { x.input.current.header.snapshot.globalHash = 'c'.repeat(64); },
    (x: typeof f) => { x.input.current.receipts.other = { action: 'style', state: 'complete', payloadHash: hash }; },
    (x: typeof f) => { x.input.originalPayloadHash = hash; },
    (x: typeof f) => { x.input.current.receipts[x.input.originalOperationId].state = 'complete'; },
  ];
  for (const mutate of mutations) { const changed = fixture(); mutate(changed); assert.throws(() => validateNavigationReceiptRecovery(changed.input)); }
});
test('finalizer binds a new persisted recovery intent to current CAS and only completes the original navigation receipt', async () => {
  const f = fixture(); let calls = 0;
  const finalizer = new NavigationFormReceiptFinalizer({ origin: f.identity.targetOrigin, async executePHP<T>(operation: { code: string }) {
    calls++; const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); assert.equal(data.action, 'confirm-navigation-forms'); assert.equal(data.expectedHash, f.input.current.hash); assert.equal(data.payload.originalOperationId, f.input.originalOperationId);
    const snapshot = structuredClone(f.input.current), result = { pageId: 9, widgetIds: f.patch.widgetIds }; snapshot.hash = 'c'.repeat(64); snapshot.receipts[f.input.originalOperationId] = { action: 'navigation-forms', state: 'complete', payloadHash: f.input.originalPayloadHash, result }; return { ok: true, value: { snapshot, result, originalOperationId: f.input.originalOperationId } } as T;
  } });
  await assert.rejects(finalizer.finalize(f.identity, f.input, { ...f.intent, expectedSnapshotSha256: hash }), /intent/); assert.equal(calls, 0);
  assert.equal((await finalizer.finalize(f.identity, f.input, f.intent)).snapshot.receipts[f.input.originalOperationId].state, 'complete'); assert.equal(calls, 1);
});
test('fixed server recovery branch has no document save and semantic document comparison does not replace CAS hashing', async () => {
  const source = await readFile(new URL('../src/replica-full/wordpress-full.php', import.meta.url), 'utf8'), start = source.indexOf("if($action==='confirm-navigation-forms'){"), end = source.indexOf("$prior=$record['fullReceipts'][$operation]", start), branch = source.slice(start, end);
  assert.ok(start > 0 && end > start); assert.match(branch, /\$before\['hash'\]!==\(\$input\['expectedHash'\]/); assert.match(branch, /\$navigationFormPatch\(/); assert.match(branch, /full_navigation_receipt_not_started/); assert.match(branch, /full_navigation_receipt_elements/); assert.match(branch, /full_navigation_receipt_page/); assert.match(branch, /full_navigation_receipt_header/); assert.match(branch, /full_navigation_receipt_boundary/); assert.doesNotMatch(branch, /->save\(|wp_update_post|wp_insert_post|update_post_meta/);
  assert.match(source, /\$digest=static fn\(\$value\)=>hash\('sha256',serialize\(\$value\)\)/); assert.match(source, /\$list=array_is_list\(\$value\);if\(!\$list\)ksort\(\$value,SORT_STRING\)/); assert.match(source, /\$documentDigest\(\$check\['page'\]\['elements'\]\)/);
  const native = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8'); assert.match(native, /'pages'=>\(object\)\$pages/);
  for (const copy of ['a', 'b']) {
    const cast = `$${copy}['module']['pages']=(array)($${copy}['module']['pages']??[])`;
    assert.ok(branch.includes(cast), 'both decoded array and native stdClass page maps become local array copies');
    assert.ok(branch.indexOf(cast) < branch.indexOf(`isset($${copy}['module']['pages'][$pageKey])`));
  }
  assert.doesNotMatch(branch, /\$before\['header'\]\['snapshot'\]\['module'\]\['pages'\]\s*=/);
});

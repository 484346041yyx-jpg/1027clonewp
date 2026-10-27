import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { native44Id } from '../src/native44/adapters.js';
import { compileNavigationFormPatch, type NavigationFormSpec } from '../src/replica-full/navigation-form/index.js';
import { assertNavigationReturnBoundary, compileNavigationReturnPatch, NAVIGATION_RETURN_RUNTIME, NAVIGATION_RETURN_V1_RUNTIME, navigationReturnPhpHelpers } from '../src/replica-full/navigation-return.js';
import type { FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';

const source = 'https://hoshiichi.com/', taskId = 'return-test';
const form: NavigationFormSpec = { key: 'filter', slotComponentKey: 'products_search', sourceUnitIds: ['desktop/products'], sourceFactIds: ['desktop:interaction:form'], sourceEvidence: { path: 'source.json', sha256: 'a'.repeat(64) }, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }] }], submitLabel: '検索' };
const baseline = () => compileNavigationFormPatch([{ id: native44Id(taskId, form.slotComponentKey), elType: 'container', settings: { css_classes: 'unchanged' }, elements: [{ id: 'heading1', elType: 'widget', widgetType: 'heading', settings: { title: 'Preserved' }, elements: [] }] }], [form], source, taskId).elements;
function runtime(type = 'navigate', readyState = 'loading', timingAvailable = true) {
  const handlers: Array<(event: { persisted?: boolean }) => void> = [], attributes = new Map<string, string>(); let reloads = 0;
  const window = { ...(timingAvailable ? { performance: { getEntriesByType(kind: string) { assert.equal(kind, 'navigation'); return [{ type }]; } } } : {}), location: { reload() { reloads++; } }, addEventListener(event: string, handler: typeof handlers[number]) { assert.equal(event, 'pageshow'); handlers.push(handler); } };
  const document = { readyState, currentScript: { setAttribute(name: string, value: string) { attributes.set(name, value); } } }, script = NAVIGATION_RETURN_RUNTIME.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''), context = vm.createContext({ window, document });
  const execute = () => vm.runInContext(script, context); execute();
  return { handlers, attributes, execute, reloads: () => reloads };
}
test('v2 runtime exposes execution and actual event markers, installs one listener and reloads a persisted restoration only once', () => {
  const r = runtime(); r.execute(); assert.equal(r.handlers.length, 1); assert.equal(r.reloads(), 0);
  assert.equal(r.attributes.get('data-executed'), 'true'); assert.equal(r.attributes.get('data-navigation-type'), 'navigate'); assert.equal(r.attributes.get('data-pageshow-persisted'), 'unobserved');
  r.handlers[0]({ persisted: false }); assert.equal(r.attributes.get('data-pageshow-persisted'), 'false'); assert.equal(r.reloads(), 0);
  r.handlers[0]({ persisted: true }); assert.equal(r.attributes.get('data-pageshow-persisted'), 'true'); assert.equal(r.attributes.get('data-reload-requested'), 'true'); assert.equal(r.reloads(), 1);
  r.handlers[0]({ persisted: true }); assert.equal(r.reloads(), 1);
});
test('v2 handles normal back_forward pageshow and a late complete installation without an initial navigate or reload loop', () => {
  const normalBack = runtime('back_forward'); assert.equal(normalBack.reloads(), 0); normalBack.handlers[0]({ persisted: false }); assert.equal(normalBack.reloads(), 1); assert.equal(normalBack.attributes.get('data-navigation-type'), 'back_forward'); assert.equal(normalBack.attributes.get('data-pageshow-persisted'), 'false');
  const lateBack = runtime('back_forward', 'complete'); assert.equal(lateBack.reloads(), 1); lateBack.execute(); lateBack.handlers[0]({ persisted: false }); assert.equal(lateBack.reloads(), 1); assert.equal(lateBack.handlers.length, 1);
  for (const type of ['navigate', 'reload', 'unknown']) { const r = runtime(type, 'complete'); r.handlers[0]({ persisted: false }); assert.equal(r.reloads(), 0); }
  const unavailable = runtime('unknown', 'complete', false); unavailable.handlers[0]({ persisted: false }); assert.equal(unavailable.reloads(), 0); unavailable.handlers[0]({ persisted: true }); assert.equal(unavailable.reloads(), 1);
});
test('return patch appends only the fixed runtime to the exact form and preserves every other node and setting', () => {
  const before = baseline(), frozen = structuredClone(before), patch = compileNavigationReturnPatch(before, [form], source, taskId), widget = patch.elements[0].elements[1];
  assert.deepEqual(before, frozen); assert.deepEqual(patch.elements[0].elements[0], before[0].elements[0]); assert.deepEqual(patch.elements[0].settings, before[0].settings); assert.equal(widget.settings.html, String(before[0].elements[1].settings.html) + NAVIGATION_RETURN_RUNTIME); assert.equal(patch.changedWidgetIds.length, 1);
  const repeated = compileNavigationReturnPatch(patch.elements, [form], source, taskId); assert.deepEqual(repeated.elements, patch.elements); assert.deepEqual(repeated.changedWidgetIds, []);
  const legacy = baseline(); legacy[0].elements[1].settings.html += NAVIGATION_RETURN_V1_RUNTIME;
  const migration = compileNavigationReturnPatch(legacy, [form], source, taskId); assert.deepEqual(migration, patch); assert.equal(migration.elements[0].elements[1].settings.html, String(before[0].elements[1].settings.html) + NAVIGATION_RETURN_RUNTIME);
  for (const suffix of ['<script>arbitrary()</script>', NAVIGATION_RETURN_RUNTIME + NAVIGATION_RETURN_RUNTIME, NAVIGATION_RETURN_V1_RUNTIME + NAVIGATION_RETURN_RUNTIME, NAVIGATION_RETURN_V1_RUNTIME.replace('location.reload()', 'location.replace("/")')]) { const changed = baseline(); changed[0].elements[1].settings.html += suffix; assert.throws(() => compileNavigationReturnPatch(changed, [form], source, taskId), /form_changed/); }
  const moved = baseline(); moved[0].id = 'foreign-container'; assert.throws(() => compileNavigationReturnPatch(moved, [form], source, taskId), /form_owner/);
});
test('return boundary permits owned bound drafts and rejects CSS, metadata, unrelated tree and protected changes', () => {
  const identity = { headerId: 'header_12345', owner: { runId: 'owned' } }, before = { page: { pageId: 9, runId: 'owned', status: 'draft', headerId: identity.headerId, elements: baseline(), bodyHash: 'before', settings: { custom_css: 'preserved' } }, header: { contract: {}, resources: {}, snapshot: { globalHash: 'global', module: { identity, pages: { '9': { bodyHash: 'before', snapshotHash: 'before' } } } } } } as unknown as FullReplicaRemoteSnapshot, patch = compileNavigationReturnPatch(before.page!.elements, [form], source, taskId), after = structuredClone(before);
  after.page!.elements = patch.elements; after.page!.bodyHash = 'after'; after.header.snapshot.module!.pages['9'].bodyHash = 'after'; after.header.snapshot.module!.pages['9'].snapshotHash = 'after'; assertNavigationReturnBoundary(before, after, patch, [form], source, taskId);
  for (const change of [(x: typeof after) => { x.page!.settings.custom_css = 'changed'; }, (x: typeof after) => { x.page!.status = 'publish'; }, (x: typeof after) => { x.page!.elements[0].elements[0].settings.title = 'changed'; }, (x: typeof after) => { x.header.snapshot.globalHash = 'changed'; }, (x: typeof after) => { x.page!.headerId = 'foreign'; }]) { const changed = structuredClone(after); change(changed); assert.throws(() => assertNavigationReturnBoundary(before, changed, patch, [form], source, taskId)); }
  assert.doesNotMatch(navigationReturnPhpHelpers, /wp_insert|wp_update|update_option|->save\(/);
});

test('server pure compiler embeds the exact v2 and exact legacy suffix bytes and only accepts those typed form variants', () => {
  const current = navigationReturnPhpHelpers.match(/\$runtime=base64_decode\('([^']+)'\)/)!, legacy = navigationReturnPhpHelpers.match(/\$legacyRuntime=base64_decode\('([^']+)'\)/)!;
  assert.equal(Buffer.from(current[1], 'base64').toString('utf8'), NAVIGATION_RETURN_RUNTIME); assert.equal(Buffer.from(legacy[1], 'base64').toString('utf8'), NAVIGATION_RETURN_V1_RUNTIME);
  assert.match(navigationReturnPhpHelpers, /===\$form\['html'\]\.\$legacyRuntime/); assert.match(navigationReturnPhpHelpers, /!==\$form\['html'\]\.\$runtime/);
  assert.match(NAVIGATION_RETURN_RUNTIME, /data-clonewp-navigation-return="v2"/); assert.doesNotMatch(NAVIGATION_RETURN_RUNTIME, /submit|fetch\(|setInterval|eval\(|new Function/);
});

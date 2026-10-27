import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNative44Program } from '../src/native44/validate.js';
import { assertNative44DesktopResourceSupport, Native44ResourceAdapterUnverifiedError, validateNative44ResourceBindings } from '../src/native44/adapters.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Component, type Native44Program, type Native44ResourceBinding } from '../src/native44/types.js';

const ref = { path: 'D:/cloneWP/.cache/resource-fixture.json', sha256: 'a'.repeat(64) };
const conditional: Record<string, Native44ResourceBinding['kind']> = { wd_products_brands: 'brands', wd_product_categories: 'categories', wd_blog: 'posts', wd_contact_form_7: 'form', wd_sidebar: 'sidebar', form: 'form', wd_wc_breadcrumb: 'page-context', wd_page_heading: 'page-context', wd_element_breadcrumbs: 'page-context', breadcrumbs: 'page-context', wd_wishlist: 'wishlist', wd_compare: 'compare' };
function program(node: Native44Component): Native44Program { return { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: 'resource-fixture', title: 'Resource support fixture', sourceUrl: 'https://source.example/', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: ref.sha256 }, targetEnvironment: { ...NATIVE44_TARGET_ENVIRONMENT }, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'root', children: [node] }] }; }
function forged(kind: Native44ResourceBinding['kind'], settingPath?: string): Native44ResourceBinding { return { kind, ids: ['invented-record'], targetOrigin: 'https://target.example', evidence: ['not-a-real-evidence-file'], ...(settingPath ? { settingPath } : {}) }; }

test('desktop conditional widgets remain in the 44 but fail unverified before any target resource declaration can be trusted', () => {
  assert.equal(NATIVE44_ALL_TYPES.length, 44);
  for (const [widgetType, kind] of Object.entries(conditional)) {
    assert.ok((NATIVE44_ALL_TYPES as readonly string[]).includes(widgetType));
    for (const resources of [undefined, [forged(kind)], [forged(kind, 'selected_ids')]]) {
      const input = program({ kind: 'native', key: 'conditional', widgetType, widgetSettings: { selected_ids: ['invented-record'] }, resources });
      assert.throws(() => validateNative44Program(input), error => error instanceof Native44ResourceAdapterUnverifiedError && error.status === 'unverified' && error.capability === 'unsupported' && error.widgetType === widgetType && error.dependencies.includes(kind));
    }
  }
});
test('forged resource evidence on an ordinary widget cannot create an alternative data-query capability', () => {
  const input = program({ kind: 'native', key: 'heading', widgetType: 'heading', widgetSettings: { title: 'Normal headline' }, resources: [forged('page-context')] });
  assert.throws(() => validateNative44Program(input), /resource_adapter_unverified.*heading.*page-context/);
  assert.throws(() => assertNative44DesktopResourceSupport('heading', [forged('brands')]), /unsupported tool capability/);
});
test('ordinary desktop content and the existing catalog-backed product adapters remain available', () => {
  for (const node of [
    { kind: 'native', key: 'heading', widgetType: 'heading', widgetSettings: { title: 'Normal headline' } },
    { kind: 'native', key: 'list', widgetType: 'wd_list', widgetSettings: { list_items: [] } },
    { kind: 'native-products', key: 'products', widgetType: 'wd_products', widgetSettings: {}, query: { ids: [1], evidence: ['actual-catalog.json'] } },
  ] satisfies Native44Component[]) assert.doesNotThrow(() => validateNative44Program(program(node)));
});
test('historical no-profile resource validation keeps its prior semantics and is not silently upgraded', () => {
  const input = program({ kind: 'native', key: 'context', widgetType: 'wd_page_heading', widgetSettings: {}, resources: [forged('page-context')] });
  delete input.replicationProfile; delete input.selectionRulesHash; input.viewports = native44ProfileViewports();
  assert.doesNotThrow(() => validateNative44Program(input));
  assert.doesNotThrow(() => validateNative44ResourceBindings('wd_page_heading', {}, [forged('page-context')], 'https://target.example'));
});

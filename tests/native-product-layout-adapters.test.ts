import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTargetCategoriesEvidence, normalizeTargetCategoriesQuery, type TargetCategoriesEvidence, type TargetCategoriesQueryInput } from '../src/wordpress/categories-contract.js';
import { targetCategoriesReadPHP, parseTargetCategoriesObservation } from '../src/wordpress/categories.js';
import { readCurrentCategoriesProvider, adaptNative44Categories, prepareProgramCategories, type TargetCategoriesProvider } from '../src/native44/native-categories.js';
import { assertNative44DesktopResourceSupport } from '../src/native44/adapters.js';
import { compileNative44, assertNative44Compilation } from '../src/native44/compiler.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Categories, type Native44Program } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import { analyzeComponentModel } from '../src/native44/component-model.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertProductExtensionReference, assertProgramNativeWidget, productExtensionWidgetTypes, NATIVE_PRODUCT_EXTENSION_HASH, NATIVE_RELATED_PRODUCT_EXTENSION_HASH } from '../src/native44/product-extension.js';
import { CORE_SINGLE_PRODUCT_TYPES, NATIVE44_ALL_TYPES } from '../src/native44/catalog.js';

const origin = 'https://target.example';
const query: TargetCategoriesQueryInput = { rootIds: [9], hideEmpty: false, includeChildren: true, orderby: 'menu_order', order: 'ASC' };
function evidence(): TargetCategoriesEvidence { return { version: 1, targetOrigin: origin, readAt: new Date().toISOString(), evidence: ['current-category-read.json'], taxonomy: 'product_cat', query: structuredClone(query), terms: [{ id: 9, parent: 0, name: 'Perfume', slug: 'perfume', permalink: origin + '/product-category/perfume/', count: 0, order: 0 }, { id: 10, parent: 9, name: 'Mini', slug: 'mini', permalink: origin + '/product-category/mini/', count: 0, order: 1 }] }; }
const schema: LegacySchema = { type: 'wd_product_categories', class: 'XTS\\Elementor\\Product_Categories', controls: { _css_classes: { type: 'text' }, type: { type: 'select', options: { navigation: 'Navigation', grid: 'Grid' } }, data_source: { type: 'select', options: { custom_query: 'Custom', wc_query: 'WC' } }, ids: { type: 'wd_autocomplete' }, hide_empty: { type: 'switcher' }, orderby: { type: 'select', options: { menu_order: 'Menu order' } }, order: { type: 'select', options: { ASC: 'Ascending' } }, nav_disable_active_style: { type: 'switcher' } } };
function node(): Native44Categories { return { kind: 'native-categories', key: 'category-navigation', widgetType: 'wd_product_categories', widgetSettings: {}, query: { ...structuredClone(query), evidence: ['source-navigation-adaptation.json'] } }; }
const digest = 'b'.repeat(64), ref = { path: 'D:/cloneWP/tests/fixtures/category-compiler.json', sha256: digest };
function program(): Native44Program { return { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, editorNaming: 'native-translated-v1', taskId: 'categories-compiler', title: 'Category navigation', sourceUrl: 'https://source.example/', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: digest }, targetEnvironment: { ...NATIVE44_TARGET_ENVIRONMENT }, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'sidebar', children: [node()] }] }; }
async function provider() { return readCurrentCategoriesProvider({ readTargetCategories: async () => evidence() }, query, origin); }

test('category tree query and evidence reject duplicate roots, cycles, missing parents and cross-origin links', () => {
  assert.deepEqual(normalizeTargetCategoriesQuery(query), query);
  assert.throws(() => normalizeTargetCategoriesQuery({ ...query, rootIds: [9, 9] }), /query_invalid/);
  assertTargetCategoriesEvidence(evidence(), origin, query);
  for (const modify of [(v: TargetCategoriesEvidence) => { v.terms[1].parent = 99; }, (v: TargetCategoriesEvidence) => { v.terms[0].parent = 10; }, (v: TargetCategoriesEvidence) => { v.terms[1].permalink = 'https://other.example/category/'; }, (v: TargetCategoriesEvidence) => { v.terms[1].id = 9; }]) { const bad = evidence(); modify(bad); assert.throws(() => assertTargetCategoriesEvidence(bad, origin, query), /evidence_invalid/); }
});
test('fixed category reader is bounded and contains no term or ordering mutation', () => {
  const php = targetCategoriesReadPHP(query);
  assert.match(php, /'taxonomy'=>'product_cat'/); assert.match(php, /'number'=>1001/);
  assert.doesNotMatch(php, /wp_insert|wp_update|update_term_meta|update_option|set_transient|wp_delete/);
  const parsed = parseTargetCategoriesObservation(evidence().terms, query, origin); assert.deepEqual(parsed.terms, evidence().terms);
});
test('only a current-process provider qualifies, serialized handles cannot stand in for reads', async () => {
  const p = await provider();
  const adapted = adaptNative44Categories(node(), schema, [p], 'abc1234', origin);
  assert.equal(adapted.settings.type, 'navigation'); assert.equal(adapted.settings.hide_empty, ''); assert.deepEqual(adapted.settings.ids, [9, 10]); assert.equal(adapted.settings.nav_disable_active_style, '');
  assert.equal(adapted.receipt.renderedVerified, false); assert.deepEqual(adapted.receipt.observedTermIds, [9, 10]);
  assert.throws(() => adaptNative44Categories(node(), schema, [structuredClone(p)], 'abc1234', origin), /provider_identity/);
  for (const key of ['ids', 'type', 'subcategories', 'hide_empty', 'orderby']) { const bad = node(); bad.widgetSettings[key] = 'injected'; assert.throws(() => adaptNative44Categories(bad, schema, [p], 'abc1234', origin), /owned_query_field/); }
  assert.throws(() => adaptNative44Categories(node(), schema, [], 'abc1234', origin), /current_process_read_required/);
});
test('category compilation seals its receipt and keeps ordinary native resource forgery blocked', async () => {
  const schemas = { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, wd_product_categories: schema };
  const compiled = compileNative44(program(), { schemas, assets: [], categories: [await provider()], targetOrigin: origin, knowledge: { fingerprint: digest, controlsByWidget: Object.fromEntries(Object.entries(schemas).map(([key, v]) => [key, new Set(Object.keys(v.controls))])) } });
  assert.equal(compiled.composition.elements[0].elements[0].widgetType, 'wd_product_categories');
  assertNative44Compilation(compiled, compiled.composition);
  compiled.categoryQueryReceipts![0].observedTermIds.push(999); assert.throws(() => assertNative44Compilation(compiled, compiled.composition), /exact current-process/);
  assert.throws(() => assertNative44DesktopResourceSupport('wd_product_categories', [{ kind: 'categories', ids: [9], targetOrigin: origin, evidence: ['fake.json'] }]), /resource_adapter_unverified/);
});
test('program preparation deduplicates category reads and binds actual persisted read references', async () => {
  let reads = 0, saves = 0;
  const p = program(); (p.blocks[0] as { children: Native44Categories[] }).children.push({ ...node(), key: 'second-nav' });
  const providers = await prepareProgramCategories({ readTargetCategories: async () => { reads++; return { ...evidence(), evidence: [] }; } }, p, origin, async () => { saves++; return 'fresh-read.json'; });
  assert.equal(reads, 1); assert.equal(saves, 1); assert.equal(providers.length, 1);
  assert.deepEqual(adaptNative44Categories(node(), schema, providers, 'abc1234', origin).receipt.evidence, ['fresh-read.json', 'source-navigation-adaptation.json']);
  assert.throws(() => adaptNative44Categories(node(), schema, [{} as TargetCategoriesProvider], 'abc1234', origin), /current_process_read_required/);
});
test('category disclosure is qualified only for the native mobile accordion or side panel mode', () => {
  const p = program(), category = (p.blocks[0] as { children: Native44Categories[] }).children[0];
  category.sourceFactIds = ['mobile-category-trigger'];
  category.model = { interactions: [{ kind: 'disclosure', evidenceFactIds: ['mobile-category-trigger'] }] };
  category.widgetSettings.mobile_accordion = 'on';
  assert.equal(analyzeComponentModel(p).gaps.some(g => g.code === 'disclosure-controller-pending'), false);
  category.widgetSettings.mobile_accordion = '';
  assert.equal(analyzeComponentModel(p).gaps.some(g => g.code === 'disclosure-controller-pending'), true);
});
test('generated category reader executes selected complete subtrees and keeps empty child evidence', t => {
  const root = fileURLToPath(new URL('../', import.meta.url)), portable = path.join(root, '.cache/php-8.3/php.exe'), php = existsSync(portable) ? portable : 'php';
  const probe = spawnSync(php, ['-v'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) { t.skip('PHP unavailable; target execution still required.'); return; }
  const harness = `function taxonomy_exists($v){return $v==='product_cat';}function is_wp_error($v){return false;}
function get_terms($args){if($args['taxonomy']!=='product_cat'||$args['number']!==1001||$args['hide_empty']!==false||$args['orderby']!=='menu_order')throw new RuntimeException('wrong_bounded_query');return [(object)['term_id'=>9,'parent'=>0,'name'=>'Perfume','slug'=>'perfume','count'=>0],(object)['term_id'=>10,'parent'=>9,'name'=>'Mini','slug'=>'mini','count'=>0],(object)['term_id'=>20,'parent'=>0,'name'=>'Unselected','slug'=>'unselected','count'=>2]];}
function get_term_link($t){return 'https://target.example/product-category/'.$t->slug.'/';}function update_term_meta(){throw new RuntimeException('unexpected_write');}
$input=json_decode(stream_get_contents(STDIN),true);try{echo json_encode(eval($input['code']));}catch(Throwable $e){fwrite(STDERR,$e->getMessage());exit(1);}`;
  const result = spawnSync(php, ['-r', harness], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000, input: JSON.stringify({ code: targetCategoriesReadPHP(query) }) });
  assert.equal(result.status, 0, result.stderr);
  const parsed = parseTargetCategoriesObservation(JSON.parse(result.stdout), query, origin);
  assert.deepEqual(parsed.terms.map(v => [v.id, v.parent, v.count]), [[9, 0, 0], [10, 9, 0]]);
});
test('related identity is additive and cannot enter the original twelve extension by a known name', () => {
  const original = { path: 'data/native-product/extension-v1.json', sha256: NATIVE_PRODUCT_EXTENSION_HASH };
  assert.equal(NATIVE44_ALL_TYPES.length, 44); assert.equal(CORE_SINGLE_PRODUCT_TYPES.length, 12);
  assert.equal(productExtensionWidgetTypes(original).length, 56);
  assert.throws(() => assertProgramNativeWidget('woocommerce-product-related', original), /component_not_allowed/);
  assert.throws(() => assertProgramNativeWidget('woocommerce-product-related'), /component_not_allowed/);
  assert.throws(() => assertProductExtensionReference({ path: 'untrusted-new-index.json', sha256: '0'.repeat(64) }), /extension_not_qualified/);
  if (NATIVE_RELATED_PRODUCT_EXTENSION_HASH === undefined) assert.throws(() => assertProductExtensionReference({ path: 'pending-qualification.json', sha256: '1'.repeat(64) }), /extension_not_qualified/);
});

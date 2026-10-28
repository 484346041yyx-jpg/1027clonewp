import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeRelatedProductsQuery, parseRelatedProductsSnapshot, targetRelatedProductsReadPHP, type RelatedProductsSnapshot } from '../src/wordpress/related-products.js';
import { assertNativeRelatedProductsQueryControls, readRelatedProductsProvider, relatedProductsObservation, adaptNativeRelatedProductComponent } from '../src/native44/native-related-products.js';
import { readRelatedProductExtension, RELATED_SINGLE_PRODUCT_TYPES, NATIVE_RELATED_PRODUCT_TYPE, NATIVE_RELATED_PRODUCT_CLASS, assertNativeRelatedProductQualification } from '../src/native44/related-product-extension.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE_PRODUCT_EXTENSION_HASH } from '../src/native44/product-extension.js';
import { relatedProductKnowledgeFromRegistration, relatedQualificationElements, relatedQualificationInspectPHP, relatedQualificationSavePHP, relatedQualificationCacheReconciliationPHP, RELATED_QUALIFICATION_RUN_ID, RELATED_QUALIFICATION_V2_RUN_ID, RELATED_CACHE_INVALIDATION_SOURCE_SHA256, RELATED_V2_RECONCILE_OPERATION, RELATED_V2_RECONCILE_INTENT_SHA256 } from '../src/native44/related-product-qualification.js';
import { evaluateNative44Condition } from '../src/native44/settings.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const origin = 'https://target.example';
const selection = { recordType: 'product' as const, contextKey: 'currentProduct', productId: 101 };
const query = { source: 'related' as const, contextKey: 'currentProduct', limit: 6, excludeIds: [99] };
const snapshot = (): RelatedProductsSnapshot => ({ version: 1, provider: 'target-woocommerce-related-v1', targetOrigin: origin, readAt: new Date().toISOString(), currentProductId: 101, query, categoryIds: [7], tagIds: [8], upsellIds: [], queryEngine: 'woocommerce-product-data-store-related-v1', candidateCount: 1, products: [{ id: 102, name: 'Actual related product', permalink: origin + '/product/102/' }] });

test('bounded related query preserves context and rejects arbitrary query/filter inputs', () => {
  assert.deepEqual(normalizeRelatedProductsQuery({ ...query, excludeIds: [10, 9] }).excludeIds, [9, 10]);
  for (const limit of [0, 25, 1.1, NaN]) assert.throws(() => normalizeRelatedProductsQuery({ ...query, limit }));
  assert.throws(() => normalizeRelatedProductsQuery({ ...query, excludeIds: [9, 9] }));
  assert.throws(() => normalizeRelatedProductsQuery({ ...query, tax_query: [] } as any));
});
test('related evidence rejects identity, scope, duplicate and result-limit mismatches', () => {
  assert.doesNotThrow(() => parseRelatedProductsSnapshot(snapshot(), origin, 101, query));
  for (const change of [
    (s: RelatedProductsSnapshot) => { s.currentProductId = 999; },
    (s: RelatedProductsSnapshot) => { s.targetOrigin = 'https://source.example'; },
    (s: RelatedProductsSnapshot) => { s.products[0].permalink = 'https://source.example/product/102/'; },
    (s: RelatedProductsSnapshot) => { s.products[0].id = 101; },
    (s: RelatedProductsSnapshot) => { s.products[0].id = 99; },
    (s: RelatedProductsSnapshot) => { s.upsellIds = [102]; },
    (s: RelatedProductsSnapshot) => { s.products.push(s.products[0]); },
    (s: RelatedProductsSnapshot) => { s.candidateCount = 0; },
    (s: RelatedProductsSnapshot) => { s.query.contextKey = 'other'; },
  ]) { const value = snapshot(); value.query = structuredClone(query); change(value); assert.throws(() => parseRelatedProductsSnapshot(value, origin, 101, query)); }
  const empty = snapshot(); empty.products = []; empty.candidateCount = 0; assert.doesNotThrow(() => parseRelatedProductsSnapshot(empty, origin, 101, query));
});
test('related provider requires a fresh handle and never exposes mutable observed data', async () => {
  const value = snapshot(), provider = await readRelatedProductsProvider({ readTargetRelatedProducts: async () => value }, selection, query, origin);
  value.products[0].name = 'Mutated reader data';
  const observed = relatedProductsObservation(provider, selection, query, origin); observed.products[0].name = 'Mutated output';
  assert.equal(relatedProductsObservation(provider, selection, query, origin).products[0].name, 'Actual related product');
  assert.throws(() => relatedProductsObservation(structuredClone(provider), selection, query, origin), /identity_mismatch/);
  assert.throws(() => relatedProductsObservation(provider, { ...selection, productId: 103 }, query, origin), /identity_mismatch/);
  const stale = snapshot(); stale.readAt = new Date(Date.now() - 16 * 60000).toISOString();
  const staleProvider = await readRelatedProductsProvider({ readTargetRelatedProducts: async () => stale }, selection, query, origin);
  assert.throws(() => relatedProductsObservation(staleProvider, selection, query, origin), /stale/);
});
test('related PHP uses native cache-free taxonomy query and only published public products', () => {
  const php = targetRelatedProductsReadPHP(101, query);
  assert.match(php, /WC_Data_Store::load\('product'\)/);
  assert.match(php, /get_related_products\(\$cats,\$tags,\$exclude,\$limit\+10,\$id\)/);
  assert.match(php, /get_post_field\('post_password'/);
  assert.match(php, /woocommerce_related_products/);
  assert.doesNotMatch(php, /wc_get_related_products\(|set_transient\(|update_option\(|wp_insert|wp_update|update_post_meta|add_to_cart\(/);
  assert.throws(() => targetRelatedProductsReadPHP(0, query));
});
test('current frozen wd_products does not accidentally qualify OR/AND query_type as related', async () => {
  const raw = JSON.parse(await readFile(new URL('../data/native44/components/wd_products.json', import.meta.url), 'utf8'));
  const postTypes = new Set<string>(raw.controls.find((c: any) => c.id === 'post_type').valueDomain.options.map((o: any) => o.value));
  const schema: LegacySchema = { type: 'wd_products', class: 'ActualRegisteredProducts', controls: { post_type: { type: 'select', options: Object.fromEntries([...postTypes].map(v => [v, v])) }, query_type: { type: 'select', options: { OR: 'OR', AND: 'AND' } } } };
  assert.equal(postTypes.has('related'), false);
  assert.throws(() => assertNativeRelatedProductsQueryControls(schema, postTypes), /runtime_adapter_unqualified/);
  schema.controls.post_type.options!.related = 'Related';
  assert.throws(() => assertNativeRelatedProductsQueryControls(schema, postTypes), /runtime_adapter_unqualified/);
});

test('generated PHP executes native data-store reads and filters self, excluded and unpublished records', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const portable = path.join(root, '.cache/php-8.3/php.exe'), php = existsSync(portable) ? portable : 'php';
  const probe = spawnSync(php, ['-v'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) { t.skip('PHP unavailable; real target qualification remains required.'); return; }
  const harness = `
function apply_filters($tag,$value,...$rest){return $value;}
function wc_get_product_term_ids($id,$taxonomy){return $taxonomy==='product_cat'?[7]:[8];}
function get_post_field($field,$id){return $id===104?'protected':'';}
function wp_get_attachment_image_url($id,$size){return 'https://target.example/image.jpg';}
function set_transient(){throw new RuntimeException('unexpected_write');}
class SyntheticRelatedProduct {private $id;function __construct($id){$this->id=$id;}function get_id(){return $this->id;}function get_status(){return $this->id===103?'draft':'publish';}function is_visible(){return $this->id!==106;}function get_name(){return 'Product '.$this->id;}function get_permalink(){return 'https://target.example/product/'.$this->id.'/';}function get_image_id(){return 0;}function get_upsell_ids(){return [107];}}
function wc_get_product($id){return new SyntheticRelatedProduct($id);}
class WC_Data_Store {static function load($kind){if($kind!=='product')throw new RuntimeException('wrong_store');return new self;}function get_related_products($cats,$tags,$exclude,$limit,$id){if($cats!==[7]||$tags!==[8]||$id!==101||$limit!==16||!in_array(99,$exclude,true)||!in_array(107,$exclude,true))throw new RuntimeException('wrong_native_query');return [101,99,102,103,104,105,106,107];}}
$input=json_decode(stream_get_contents(STDIN),true);try{$result=eval($input['code']);echo json_encode($result);}catch(Throwable $e){fwrite(STDERR,$e->getMessage());exit(1);}`;
  const result = spawnSync(php, ['-r', harness], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000, input: JSON.stringify({ code: targetRelatedProductsReadPHP(101, query) }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const actual = JSON.parse(result.stdout);
  assert.deepEqual(actual.products.map((p: { id: number }) => p.id), [102, 105]);
  assert.equal(actual.candidateCount, 8);
  assert.doesNotThrow(() => parseRelatedProductsSnapshot({ version: 1, provider: 'target-woocommerce-related-v1', targetOrigin: origin, readAt: new Date().toISOString(), query, ...actual }, origin, 101, query));
});

test('separate related extension requires pinned identity and real base chain; native binding never copies observed product IDs', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url)), directory = await mkdtemp(path.join(root, 'tests', '.tmp-related-extension-'));
  t.after(async () => { const relative = path.relative(path.join(root, 'tests'), path.resolve(directory)); if (!relative.startsWith('.tmp-related-extension-') || relative.includes(path.sep)) throw Error('test_cleanup_path_invalid'); await rm(directory, { recursive: true, force: true }); });
  const put = async (name: string, value: unknown) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); const filename = path.join(directory, name); await writeFile(filename, bytes); return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const source = "class Product_Related extends Products_Base { function get_name(){return 'woocommerce-product-related';} function render(){wc_get_related_products($product->get_id(),4);wc_get_template('single-product/related.php',[]);} }";
  const sourceRef = await put('source.php', source);
  const controls = { posts_per_page: { type: 'number' }, columns: { type: 'number' }, orderby: { type: 'select', options: { date: 'Date' } }, order: { type: 'select', options: { desc: 'Descending' } }, _css_classes: { type: 'text' } };
  const registration = await put('registration.json', { widgets: [{ name: NATIVE_RELATED_PRODUCT_TYPE, class: NATIVE_RELATED_PRODUCT_CLASS }], sources: { [NATIVE_RELATED_PRODUCT_TYPE]: { file: '/wp-content/plugins/elementor-pro/modules/woocommerce/widgets/product-related.php', source, controls } } });
  const component = await put('component.json', { componentType: NATIVE_RELATED_PRODUCT_TYPE, controls: Object.entries(controls).map(([id, c]) => ({ id, type: c.type, valueDomain: { type: c.type }, jsonPath: 'settings.' + id })) });
  const readback = await put('readback.json', { syntheticReadback: true }), render = await put('render.json', { syntheticRuntime: true }), screenshot = await put('screenshot.bin', Buffer.from('synthetic-pixel-fixture'));
  const qualificationData = { version: 1, kind: 'related-product-component-qualification', status: 'qualified', targetOrigin: origin, existingPagesModified: false, widgetType: NATIVE_RELATED_PRODUCT_TYPE, widgetClass: NATIVE_RELATED_PRODUCT_CLASS, registered: true, saved: true, readbackMatched: true, runtimeDocumentType: 'woodmart_layout', runtimeLayoutType: 'single_product', registration, source: sourceRef, readback, renders: [{ productId: 101, rendered: true, observedProductIds: [102], evidence: render, screenshots: [screenshot] }, { productId: 103, rendered: true, observedProductIds: [104], evidence: render, screenshots: [screenshot] }] };
  const qualification = await put('qualification.json', qualificationData);
  const index = { version: 2, kind: 'native-component-extension', id: 'core-single-product-related-v1', baseCatalogHash: NATIVE44_CATALOG_HASH, parent: { path: 'data/native-product/extension-v1.json', sha256: NATIVE_PRODUCT_EXTENSION_HASH }, types: [...RELATED_SINGLE_PRODUCT_TYPES], components: { [NATIVE_RELATED_PRODUCT_TYPE]: component }, qualification };
  const extension = await put('extension.json', index);
  await assert.rejects(readRelatedProductExtension(extension, root, 'f'.repeat(64)), /not_qualified/);
  const loaded = await readRelatedProductExtension(extension, root, extension.sha256);
  assert.equal(Object.keys(loaded.components).length, 13);
  assert.throws(() => assertNativeRelatedProductQualification(structuredClone(loaded.qualification), origin), /qualification_handle/);
  const dynamicQuery = { ...query, excludeIds: [] }, observed = snapshot(); observed.query = dynamicQuery;
  const provider = await readRelatedProductsProvider({ readTargetRelatedProducts: async () => observed }, selection, dynamicQuery, origin);
  const node = { key: 'related', widgetType: NATIVE_RELATED_PRODUCT_TYPE, widgetSettings: { posts_per_page: 6, columns: 3, orderby: 'date', order: 'desc' }, sourceFactIds: ['related-source'], model: { data: { source: 'current-record', recordType: 'product', contextKey: 'currentProduct', field: 'related-products', evidenceFactIds: ['related-source'] } } };
  const schema: LegacySchema = { type: NATIVE_RELATED_PRODUCT_TYPE, class: NATIVE_RELATED_PRODUCT_CLASS, controls };
  const options = { provider, selection, query: dynamicQuery, targetOrigin: origin, schema, qualification: loaded.qualification };
  const binding = adaptNativeRelatedProductComponent(node, options);
  assert.deepEqual(binding.observedRelatedProductIds, [102]); assert.deepEqual(binding.settings, node.widgetSettings); assert.equal(binding.runtimeContextRequired, true); assert.equal(binding.renderedVerified, false);
  assert.equal(Object.hasOwn(binding.settings, 'include'), false); assert.equal(Object.hasOwn(binding.settings, 'product_id'), false);
  assert.throws(() => adaptNativeRelatedProductComponent({ ...node, widgetSettings: { ...node.widgetSettings, include: [102] } }, options), /query_override/);
  assert.throws(() => adaptNativeRelatedProductComponent({ ...node, widgetSettings: { ...node.widgetSettings, posts_per_page: 5 } }, options), /limit_mismatch/);
  const failedQualification = await put('failed-qualification.json', { ...qualificationData, saved: false });
  const unqualified = await put('failed-extension.json', { ...index, qualification: failedQualification });
  await assert.rejects(readRelatedProductExtension(unqualified, root, unqualified.sha256));
  const wrongParent = await put('wrong-parent-extension.json', { ...index, parent: { ...index.parent, sha256: 'f'.repeat(64) } });
  await assert.rejects(readRelatedProductExtension(wrongParent, root, wrongParent.sha256), /parent_identity/);
  await writeFile(screenshot.path, 'changed-after-qualification');
  await assert.rejects(readRelatedProductExtension(extension, root, extension.sha256), /bytes_changed/);
});

test('actual-stack knowledge conversion preserves conditional/responsive semantics and never marks registration as rendering', () => {
  const rawControls = { posts_per_page: { type: 'number', default: 4 }, columns: { type: 'number', default: 4 }, columns_mobile: { type: 'number', default: '2' }, orderby: { type: 'select', options: { date: 'Date' }, default: 'date' }, order: { type: 'select', options: { asc: 'ASC', desc: 'DESC' }, default: 'desc' }, show_heading: { type: 'switcher', default: 'yes' }, heading_color: { type: 'color', condition: { 'show_heading!': '' }, conditions: { relation: 'or', terms: [{ name: 'columns', operator: '>', value: 2 }, { name: 'order', operator: '==', value: 'desc' }] }, selectors: { '{{WRAPPER}} h2': 'color: {{VALUE}};' } }, _margin: { type: 'dimensions', is_responsive: true }, _mask_image: { type: 'media', default: { id: 9, url: 'https://old-laboratory.example/mask.svg' } } };
  const knowledge = relatedProductKnowledgeFromRegistration({ widgets: [{ name: NATIVE_RELATED_PRODUCT_TYPE, class: NATIVE_RELATED_PRODUCT_CLASS }], sources: { [NATIVE_RELATED_PRODUCT_TYPE]: { file: '/wp-content/plugins/elementor-pro/modules/woocommerce/widgets/product-related.php', source: 'Actual source bytes', controls: rawControls } } });
  assert.equal(knowledge.componentType, NATIVE_RELATED_PRODUCT_TYPE); assert.equal(knowledge.evidence.usageVerified, 'source-only'); assert.equal(knowledge.evidence.targetRegistered, false); assert.ok(knowledge.evidence.runtimeRetestRequired.length);
  assert.equal(knowledge.controls.find(c => c.id === '_margin')?.responsive, true);
  assert.equal(Object.hasOwn(knowledge.controls.find(c => c.id === '_mask_image')!, 'defaultValue'), false);
  const color = knowledge.controls.find(c => c.id === 'heading_color')!;
  assert.equal(evaluateNative44Condition(color.condition, { show_heading: 'yes', columns: 1, order: 'desc' }), true);
  assert.equal(evaluateNative44Condition(color.condition, { show_heading: '', columns: 3, order: 'desc' }), false);
  assert.equal(evaluateNative44Condition(color.condition, { show_heading: 'yes', columns: 1, order: 'asc' }), false);
});

test('qualification helper has fixed scope and generated inspect/save PHP passes real PHP syntax checking', t => {
  const identity = { targetOrigin: 'https://jiangubottle.com' as const, pageId: 1001, runId: RELATED_QUALIFICATION_RUN_ID, productId: 101, sourceSha256: 'a'.repeat(64), templateSha256: 'b'.repeat(64) } as const;
  const inspect = relatedQualificationInspectPHP(identity), save = relatedQualificationSavePHP(identity, 'c'.repeat(64), 'synthetic-operation', 'd'.repeat(64));
  const tree = relatedQualificationElements(); assert.equal(tree[0].elements.length, 2); assert.equal(tree[0].elements[1].widgetType, NATIVE_RELATED_PRODUCT_TYPE);
  assert.match(save, /related_qualification_expected_empty_state_changed/); assert.match(save, /related_qualification_reconcile_before_retry/); assert.match(save, /\$doc->save\(/); assert.match(save, /create_element_instance/);
  assert.doesNotMatch(save, /update_option\(|wp_insert_post\(|wp_delete_post\(/);
  assert.throws(() => relatedQualificationInspectPHP({ ...identity, runId: 'another-task' as any }));
  assert.throws(() => relatedQualificationSavePHP(identity, 'missing', 'synthetic-operation', 'd'.repeat(64)));
  const root = fileURLToPath(new URL('../', import.meta.url)), portable = path.join(root, '.cache/php-8.3/php.exe'), php = existsSync(portable) ? portable : 'php';
  const probe = spawnSync(php, ['-v'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) { t.skip('PHP unavailable; qualification execution remains required.'); return; }
  for (const code of [inspect, save]) { const result = spawnSync(php, ['-l'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000, input: '<?php\n' + code }); assert.equal(result.status, 0, result.stderr + result.stdout); }
});

test('V2 qualification isolates the new exact run, pins native cache invalidation and keeps V1 protection unchanged', t => {
  const identity = {targetOrigin:'https://jiangubottle.com' as const,pageId:1002,runId:RELATED_QUALIFICATION_V2_RUN_ID,productId:101,sourceSha256:'a'.repeat(64),templateSha256:'b'.repeat(64)} as const;
  const inspect=relatedQualificationInspectPHP(identity),save=relatedQualificationSavePHP(identity,'c'.repeat(64),'qualification-v2','d'.repeat(64));
  const legacy=relatedQualificationInspectPHP({...identity,runId:RELATED_QUALIFICATION_RUN_ID});
  assert.match(legacy,/wp_get_nav_menu_items\(910\)/);assert.doesNotMatch(legacy,/\$protectionParts|excludedDerivedMetaKeys/);
  assert.match(inspect,/SELECT option_name,option_value,autoload/);assert.match(inspect,/SELECT meta_id,post_id,meta_key,meta_value/);
  assert.match(inspect,/meta_key NOT IN \('wd_page_css_files','wd_page_css_files_mobile'\)/);
  assert.doesNotMatch(inspect,/meta_key NOT LIKE|DELETE FROM|delete_option\(|update_option\(/);
  assert.ok(inspect.includes(RELATED_CACHE_INVALIDATION_SOURCE_SHA256));assert.match(inspect,/related_cache_invalidation_source_changed/);
  assert.match(save,/'protectedParts'=>\$before\['protectedParts'\]/);assert.match(save,/'cacheInvalidationProof'=>\$before\['cacheInvalidationProof'\]/);
  assert.match(save,/\$protected\(\)!==\$before\['protectedHash'\]/);
  assert.throws(()=>relatedQualificationInspectPHP({...identity,runId:RELATED_QUALIFICATION_V2_RUN_ID+'-other' as any}));
  const root=fileURLToPath(new URL('../',import.meta.url)),portable=path.join(root,'.cache/php-8.3/php.exe'),php=existsSync(portable)?portable:'php';
  const probe=spawnSync(php,['-v'],{cwd:root,encoding:'utf8',windowsHide:true});if(probe.error||probe.status!==0){t.skip('PHP unavailable');return;}
  for(const code of [inspect,save]){const result=spawnSync(php,['-l'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:5000,input:'<?php\n'+code});assert.equal(result.status,0,result.stdout+result.stderr);}
});

test('known native conditions-cache incident reconciliation is read-only, exact-owner and strict-source', t=>{
  const identity={targetOrigin:'https://jiangubottle.com' as const,pageId:21869,runId:RELATED_QUALIFICATION_V2_RUN_ID,productId:21594,sourceSha256:'a'.repeat(64),templateSha256:'b'.repeat(64)} as const;
  const expected={operationId:RELATED_V2_RECONCILE_OPERATION,intentSha256:RELATED_V2_RECONCILE_INTENT_SHA256,beforeHash:'0f4b0461c4ab0c6abecdee1de295c51d40a8c6b5da5454559ecdc180717831e7',protectedParts:Object.fromEntries(Array.from({length:16},(_,i)=>['part'+i,'c'.repeat(64)]))};
  const code=relatedQualificationCacheReconciliationPHP(identity,expected);
  assert.doesNotMatch(code,/update_option\(|update_post_meta\(|delete_option\(|->save\(|->regenerate\(/);
  assert.match(code,/\$normalizeBindingMaps\(\$cache\)!==\$normalizeBindingMaps\(\$rebuilt\)/);assert.match(code,/originalCacheValueChanged/);assert.match(code,/\$changes!==\['option:wd_layouts_conditions'\]/);
  assert.match(code,/\$receipt\['state'\]!=='started'/);assert.match(code,/rawLayoutBindingsSha256/);assert.match(code,/serverReceiptUnchanged/);
  assert.throws(()=>relatedQualificationCacheReconciliationPHP({...identity,pageId:21866},expected));
  assert.throws(()=>relatedQualificationCacheReconciliationPHP(identity,{...expected,intentSha256:'e'.repeat(64)}));
  const root=fileURLToPath(new URL('../',import.meta.url)),portable=path.join(root,'.cache/php-8.3/php.exe'),php=existsSync(portable)?portable:'php';
  const probe=spawnSync(php,['-v'],{cwd:root,encoding:'utf8',windowsHide:true});if(probe.error||probe.status!==0){t.skip('PHP unavailable');return;}
  const result=spawnSync(php,['-l'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:5000,input:'<?php\n'+code});assert.equal(result.status,0,result.stdout+result.stderr);
});

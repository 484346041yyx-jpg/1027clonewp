import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { currentProductFixture } from './fixtures/current-product.js';
import { parseTargetProductSnapshot, targetProductId, type TargetProductSnapshot } from '../src/wordpress/product-contract.js';
import { targetProductReadPHP } from '../src/wordpress/product.js';
import { readCurrentProductProvider, currentProductObservation, CORE_PRODUCT_ADAPTERS, adaptCoreProductComponent, prepareCoreProductBindings, prepareProgramCurrentProduct, assertCoreProductPageRuntime, type CurrentProductSelection } from '../src/native44/current-product.js';
import { analyzeComponentModel } from '../src/native44/component-model.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { validateNative44Program } from '../src/native44/validate.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH, verifyNative44Catalog } from '../src/native44/catalog.js';
import { NATIVE44_PAGE_CONTEXT_RULES } from '../src/native44/page-context.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program, type Native44Native } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const origin = 'https://target.example';
const selection: CurrentProductSelection = { recordType: 'product', contextKey: 'currentProduct', productId: 81001 };
const readProvider = (snapshot = currentProductFixture()) => readCurrentProductProvider({ readTargetProduct: async id => { assert.equal(id, selection.productId); return snapshot; } }, selection, origin);
const node = (widgetType: keyof typeof CORE_PRODUCT_ADAPTERS, key = 'record'): Native44Native => ({ kind: 'native', key, widgetType, sourceFactIds: ['sourceFact'], widgetSettings: {}, model: { data: { source: 'current-record', recordType: 'product', contextKey: selection.contextKey, field: CORE_PRODUCT_ADAPTERS[widgetType].field, evidenceFactIds: ['sourceFact'] } } });
const schema = (type: string): LegacySchema => ({ type, class: 'SyntheticNativeWidget', controls: { _css_classes: { type: 'text' }, enable_reviews: { type: 'select', default: 'yes', options: { yes: 'Yes', no: 'No' } }, accordion_on_mobile: { type: 'select', options: { yes: 'Yes', no: 'No' } }, label_position_mobile: { type: 'select', options: { side: 'Side', above: 'Above' } }, carousel_on_mobile: { type: 'select', options: { yes: 'Yes', no: 'No', inherit: 'Inherit' } }, width_mobile: { type: 'slider', size_units: ['%'], range: { '%': { min: 0, max: 100 } } } } });
const ref = { path: 'synthetic.json', sha256: 'a'.repeat(64) };
const page = (blocks: Native44Program['blocks']): Native44Program => ({ version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', componentModelPolicy: 'unified-components-v1', currentRecord: selection, taskId: 'synthetic-product', title: 'Synthetic', sourceUrl: 'https://source.example/', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: ref.sha256 }, targetEnvironment: { ...NATIVE44_TARGET_ENVIRONMENT }, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks });

test('public target product contract preserves simple sale, missing media, zero reviews and native stock shortage', () => {
  const snapshot = currentProductFixture(); snapshot.product.media = []; snapshot.product.price.current = ''; snapshot.product.price.sale = ''; snapshot.product.price.onSale = false;
  Object.assign(snapshot.product.stock, { status: 'outofstock', quantity: null, managed: false, purchasable: false, inStock: false });
  const observed = parseTargetProductSnapshot(snapshot, origin, selection.productId);
  assert.equal(observed.product.price.current, ''); assert.deepEqual(observed.product.media, []); assert.equal(observed.product.reviews.reviewCount, 0); assert.equal(observed.product.stock.quantity, null);
});

test('variable product uses normalized attribute keys, wildcard values and variation ownership without defaults from examples', () => {
  const snapshot = currentProductFixture(origin, true); snapshot.product.variations[0].attributes['bottle-size'] = '';
  assert.equal(parseTargetProductSnapshot(snapshot, origin, selection.productId).product.attributes[0].name, 'Bottle Size');
  const taxonomy = currentProductFixture(origin, true); taxonomy.product.attributes[0].key = 'pa_size'; taxonomy.product.attributes[0].name = 'pa_size'; taxonomy.product.defaultAttributes = { pa_size: 'small' }; taxonomy.product.variations[0].attributes = { pa_size: 'small' };
  assert.doesNotThrow(() => parseTargetProductSnapshot(taxonomy, origin, selection.productId));
});

test('target product parser rejects source identities, malformed records, unbounded reads and mixed parents', () => {
  const mutations: Array<(snapshot: TargetProductSnapshot) => void> = [
    s => { s.targetOrigin = 'https://source.example'; }, s => { s.product.permalink = 'https://source.example/product/source'; }, s => { s.product.status = 'draft' as any; },
    s => { s.product.type = 'external' as any; }, s => { s.product.price.current = 'NaN'; }, s => { s.product.media[0].url = 'javascript:alert(1)'; },
    s => { s.product.media.push(s.product.media[0]); }, s => { s.product.reviews.average = 6; }, s => { s.product.variations[0].parentId = 999; },
    s => { s.product.variations[0].attributes = { unrelated: 'value' }; }, s => { s.product.defaultAttributes = { unrelated: 'value' }; }, s => { s.product.variationChildrenCount = 201; },
  ];
  for (const mutate of mutations) { const snapshot = currentProductFixture(origin, true); mutate(snapshot); assert.throws(() => parseTargetProductSnapshot(snapshot, origin, selection.productId)); }
  for (const id of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, NaN, '1;delete' as any]) { assert.throws(() => targetProductId(id)); assert.throws(() => targetProductReadPHP(id)); }
});

test('read provider PHP uses genuine bounded WooCommerce getters without rendering or business mutations', () => {
  const php = targetProductReadPHP(selection.productId);
  for (const method of ['wc_get_product', 'get_status', 'is_visible', 'get_children', 'get_parent_id', 'variation_is_visible', 'get_stock_quantity', 'get_default_attributes', 'get_gallery_image_ids', 'get_review_count', 'sanitize_title']) assert.ok(php.includes(method));
  assert.match(php, /count\(\$children\)>200/); assert.match(php, /get_post_field\('post_password'/);
  assert.doesNotMatch(php, /wp_insert|wp_update|update_post_meta|update_option|add_to_cart\(|comments_template|woocommerce_output_all_notices|setup_postdata|do_shortcode|global \$product/);
  assert.match(php, /'attributes'=>\(object\)\$v->get_attributes/); assert.match(php, /'defaultAttributes'=>\(object\)/);
});

test('current-process product handle checks target, explicit selection, age and serialization and returns isolated snapshots', async () => {
  const snapshot = currentProductFixture(), provider = await readProvider(snapshot);
  snapshot.product.name = 'Changed after read';
  const observed = currentProductObservation(provider, selection, origin); observed.product.name = 'Changed receipt';
  assert.equal(currentProductObservation(provider, selection, origin).product.name, 'Synthetic target product');
  assert.throws(() => currentProductObservation(structuredClone(provider), selection, origin), /identity_mismatch/);
  assert.throws(() => currentProductObservation(provider, { ...selection, productId: 9 }, origin), /identity_mismatch/);
  assert.throws(() => currentProductObservation(provider, { ...selection, contextKey: 'other' }, origin), /identity_mismatch/);
  assert.throws(() => currentProductObservation(provider, selection, 'https://source.example'), /identity_mismatch/);
  const stale = currentProductFixture(); stale.readAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const staleProvider = await readProvider(stale); assert.throws(() => currentProductObservation(staleProvider, selection, origin), /stale/);
});

test('all twelve adapters produce actual native settings without copying observed product content into fields', async () => {
  const provider = await readProvider();
  for (const type of Object.keys(CORE_PRODUCT_ADAPTERS) as Array<keyof typeof CORE_PRODUCT_ADAPTERS>) {
    const component = node(type); component.widgetSettings = { _css_classes: 'actual-source-class' };
    const registered = schema(type), adapted = adaptCoreProductComponent(component, { provider, selection, targetOrigin: origin, schema: registered, localControls: new Set(Object.keys(registered.controls)) });
    assert.deepEqual(adapted.settings, component.widgetSettings); assert.notEqual(adapted.settings, component.widgetSettings); assert.equal(adapted.productId, selection.productId); assert.equal(adapted.nativeDataOwner, 'current-woocommerce-product'); assert.equal(adapted.renderedVerified, false);
    assert.equal(adapted.field, CORE_PRODUCT_ADAPTERS[type].field); assert.equal('product_id' in adapted.settings, false); assert.doesNotMatch(JSON.stringify(adapted.settings), /23\.50|Target description|SYNTHETIC/);
    assert.throws(() => assertCoreProductPageRuntime([adapted]), /runtime_not_supported/);
  }
});

test('native mobile settings pass unchanged through the same registered controls with no second data or purchase owner', async () => {
  const provider = await readProvider(currentProductFixture(origin, true));
  for (const [type, settings] of [['wd_single_product_gallery', { carousel_on_mobile: 'yes', width_mobile: { unit: '%', size: 100, sizes: [] } }], ['wd_single_product_add_to_cart', { label_position_mobile: 'above' }], ['wd_single_product_tabs', { accordion_on_mobile: 'yes', enable_reviews: 'no' }]] as const) {
    const component = node(type); component.widgetSettings = structuredClone(settings); const registered = schema(type);
    const result = adaptCoreProductComponent(component, { provider, selection, targetOrigin: origin, schema: registered, localControls: new Set(Object.keys(registered.controls)) });
    assert.deepEqual(result.settings, settings); assert.equal(result.contextKey, selection.contextKey);
    const model = analyzeComponentModel({ blocks: [component] }, [{ key: component.key, mode: 'duplicate', settings: [] }]);
    assert.ok(model.gaps.some(gap => gap.code === 'dynamic-phone-duplicate'));
  }
});

test('adapters reject fake product overrides, raw dynamic tags, unrelated source evidence and unregistered settings', async () => {
  const provider = await readProvider(); const type = 'wd_single_product_price'; const registered = schema(type);
  const adapt = (component: Native44Native, override = registered, localControls = new Set(Object.keys(registered.controls))) => adaptCoreProductComponent(component, { provider, selection, targetOrigin: origin, schema: override, localControls });
  for (const settings of [{ product_id: 42 }, { product_id: false }, { __dynamic__: {} }, { price: 'SOURCE PRICE' }, { width_mobile_mobile: 10 }]) { const component = node(type); component.widgetSettings = settings; assert.throws(() => adapt(component)); }
  const component = node(type); component.model!.data = { source: 'current-record', recordType: 'product', contextKey: selection.contextKey, field: 'price', evidenceFactIds: ['otherFact'] }; assert.throws(() => adapt(component), /binding_mismatch/);
  assert.throws(() => adapt(node(type), { ...registered, type: 'heading' }), /registered_contract/);
  const missingLocal = node(type); missingLocal.widgetSettings._css_classes = 'class'; assert.throws(() => adapt(missingLocal, registered, new Set()), /control_unverified/);
  const invalidValue = node(type); invalidValue.widgetSettings.accordion_on_mobile = 'guess'; assert.throws(() => adapt(invalidValue), /select|option/i);
  const unsupportedAction = node(type); unsupportedAction.model!.interactions = [{ kind: 'wishlist', contextKey: selection.contextKey, evidenceFactIds: ['sourceFact'] }]; assert.throws(() => adapt(unsupportedAction), /interaction_mismatch/);
});

test('same-tree binding detects duplicate review forms in tabs and independent reviews and duplicate purchase owners', async () => {
  const provider = await readProvider(); const types = Object.keys(CORE_PRODUCT_ADAPTERS); const schemas = Object.fromEntries(types.map(type => [type, schema(type)])); const controlsByWidget = Object.fromEntries(types.map(type => [type, new Set(Object.keys(schemas[type].controls))])); const options = { provider, targetOrigin: origin, schemas, controlsByWidget };
  const tabs = node('wd_single_product_tabs', 'tabs'), reviews = node('wd_single_product_reviews', 'reviews');
  assert.throws(() => prepareCoreProductBindings(page([tabs, reviews]), options), /duplicate_business_owner: reviews/);
  tabs.widgetSettings.enable_reviews = 'no'; assert.equal(prepareCoreProductBindings(page([tabs, reviews]), options).length, 2);
  assert.throws(() => prepareCoreProductBindings(page([node('wd_single_product_add_to_cart', 'purchase1'), node('wd_single_product_add_to_cart', 'purchase2')]), options), /duplicate_business_owner: purchase/);
  const mixed = node('wd_single_product_title'); (mixed.model!.data as any).contextKey = 'otherRecord'; assert.throws(() => prepareCoreProductBindings(page([mixed]), options), /binding_mismatch/);
});

test('source baseline records real native renderers and the ordinary-page preview early return without claiming target qualification', async () => {
  const baseline = JSON.parse(await readFile('D:/cloneWP/data/adapters/core-product-source.json', 'utf8'));
  assert.equal(baseline.kind, 'source-baseline-not-target-qualification'); assert.equal(baseline.items.length, 13);
  const source = (name: string): string => baseline.items.find((item: any) => item.name === name).source;
  for (const item of baseline.items) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  assert.match(source('price'), /single-product\/price\.php/); assert.match(source('add-to-cart'), /woocommerce_template_single_add_to_cart/);
  assert.match(source('gallery'), /single-product\/product-image\.php/); assert.match(source('reviews'), /comments_template/);
  assert.match(source('notices'), /woocommerce_output_all_notices/); assert.match(source('content'), /the_content/);
  assert.match(source('main'), /'woodmart_layout' !== \$post->post_type[\s\S]*?return;/);
});

test('unified target-read step reads once for the same record tree and leaves ordinary programs without new requests', async () => {
  let reads = 0; const reader = { readTargetProduct: async () => { reads++; return currentProductFixture(); } };
  const types = ['wd_single_product_title', 'wd_single_product_price'] as const;
  const schemas = Object.fromEntries(types.map(type => [type, schema(type)])), controlsByWidget = Object.fromEntries(types.map(type => [type, new Set(Object.keys(schemas[type].controls))]));
  const program = page(types.map(type => node(type, type))), options = { targetOrigin: origin, schemas, controlsByWidget };
  const record = await prepareProgramCurrentProduct(reader, program, options);
  assert.equal(reads, 1); assert.equal(record!.bindings.length, 2); assert.ok(record!.bindings.every(binding => binding.productId === selection.productId));
  assert.deepEqual(record!.observation.product, currentProductObservation(record!.provider, selection, origin).product);
  delete program.currentRecord; assert.equal(await prepareProgramCurrentProduct(reader, program, options), undefined); assert.equal(reads, 1);
  assert.equal(await prepareProgramCurrentProduct({}, program, options), undefined);
  await assert.rejects(() => prepareProgramCurrentProduct({}, page([node('wd_single_product_title')]), options), /reader_missing/);
  const mismatch = page([node('wd_single_product_title')]); mismatch.currentRecord = { ...selection, contextKey: 'other' };
  assert.ok(analyzeComponentModel(mismatch).gaps.some(gap => gap.code === 'record-selection-mismatch'));
  const tabs = node('wd_single_product_tabs', 'tabs'), reviews = node('wd_single_product_reviews', 'reviews');
  assert.ok(analyzeComponentModel(page([tabs, reviews])).gaps.some(gap => gap.code === 'duplicate-business-owner'));
});

test('simple purchase adapter retains native conditional output while variable purchase declares its real selection dependency', async () => {
  const component = node('wd_single_product_add_to_cart'), registered = schema(component.widgetType), localControls = new Set(Object.keys(registered.controls));
  const simple = currentProductFixture(); simple.product.stock.inStock = false; simple.product.stock.purchasable = false; simple.product.stock.status = 'outofstock';
  const one = adaptCoreProductComponent(component, { provider: await readProvider(simple), selection, targetOrigin: origin, schema: registered, localControls });
  assert.deepEqual(one.settings, {}); assert.deepEqual(one.actions, ['purchase']); assert.equal(one.dependencies.includes('native-variation-scripts'), false);
  const many = adaptCoreProductComponent(component, { provider: await readProvider(currentProductFixture(origin, true)), selection, targetOrigin: origin, schema: registered, localControls });
  assert.deepEqual(many.actions, ['selection', 'purchase']); assert.equal(many.dependencies.includes('native-variation-scripts'), true);
});

test('learning report distinguishes implemented adapters from missing runtime and keeps original 44 and ordinary output unchanged', async () => {
  const dynamic = node('wd_single_product_price'); const model = analyzeComponentModel(page([dynamic]));
  assert.equal(model.components[0].implementation?.adapter, 'implemented-disabled'); assert.ok(model.gaps.some(gap => gap.code === 'record-runtime-pending')); assert.ok(model.gaps.some(gap => gap.code === 'component-not-enabled'));
  assert.throws(() => validateNative44Program(page([dynamic])), /native44_component_not_allowed/);
  assert.equal(NATIVE44_ALL_TYPES.length, 44); assert.equal(NATIVE44_PAGE_CONTEXT_RULES.supportsSingleProductTemplate, false); await verifyNative44Catalog();
  const regular = page([{ kind: 'native', key: 'staticTitle', widgetType: 'heading', widgetSettings: { title: 'Existing static title' } }]); delete regular.currentRecord; delete regular.componentModelPolicy;
  const options = { assets: [], schemas: { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, heading: { type: 'heading', class: 'Heading', controls: { title: { type: 'text' } } } }, knowledge: { fingerprint: ref.sha256, controlsByWidget: { container: new Set(['css_classes']), heading: new Set(['title']) } } };
  const before = compileNative44(regular, options); regular.componentModelPolicy = 'unified-components-v1'; regular.blocks[0].model = { data: { source: 'static' } }; const after = compileNative44(regular, options);
  assert.deepEqual(after, before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyzeComponentModel, assertComponentModelExecutable, assertComponentModelSource, COMPONENT_MODEL_POLICY } from '../src/native44/component-model.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import { createComponentLearning, componentLearningApplication } from '../src/replica-preparation/component-learning.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { validateNative44Program } from '../src/native44/validate.js';
import { NATIVE44_CATALOG_HASH, verifyNative44Catalog } from '../src/native44/catalog.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Component, type Native44Native, type Native44Program } from '../src/native44/types.js';
import { responsiveSourceSchema, responsiveBodyPlanSchema } from '../src/replica-responsive/contract.js';
import { prepareResponsiveBody } from '../src/replica-responsive/body.js';

const fact = 'currentSourceFact', ref = { path: 'synthetic-only.json', sha256: 'a'.repeat(64) };
const title = (): Native44Native => ({ kind: 'native', key: 'section_title', widgetType: 'heading', sourceFactIds: [fact], widgetSettings: { title: 'Synthetic static title' } });
const page = (blocks: Native44Component[]): Native44Program => ({ version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', componentModelPolicy: COMPONENT_MODEL_POLICY, taskId: 'synthetic-model-test', title: 'Synthetic', sourceUrl: 'https://source.example/', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: ref.sha256 }, targetEnvironment: { ...NATIVE44_TARGET_ENVIRONMENT }, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks });

test('one model retains actual composition, setting owners and native phone fields without assigning archive defaults', () => {
  const node: Native44Component = { kind: 'composite', key: 'section', sourceFactIds: [fact], settings: { flex_direction: 'row' }, children: [title()] };
  const model = analyzeComponentModel(page([node]), [{ key: 'section', mode: 'shared', settings: [{ componentKey: 'section', values: { flex_direction_mobile: 'column' } }] }]);
  assert.equal(model.executable, true);
  assert.deepEqual(model.components[0].settings.fields, ['flex_direction']);
  assert.deepEqual(model.components[0].phone?.fields, ['flex_direction_mobile']);
  assert.equal(model.components[1].parentKey, 'section');
  assert.equal(model.components[1].data.source, 'static');
  assert.equal(model.renderedVerified, false);
  assert.equal('flex_direction_mobile' in node.settings!, false);
});

test('static metadata compiles through the existing native compiler and does not leak into Elementor settings', () => {
  const node = title(); node.model = { data: { source: 'static' } };
  const compiled = compileNative44(page([node]), { schemas: { heading: { type: 'heading', class: 'Heading', controls: { title: { type: 'text' } } }, container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } } }, assets: [], knowledge: { fingerprint: ref.sha256, controlsByWidget: { heading: new Set(['title']), container: new Set(['css_classes']) } } });
  const element = compiled.composition.elements[0].elements[0];
  assert.equal(element.settings.title, 'Synthetic static title');
  assert.equal('model' in element.settings, false);
  assert.equal(element.widgetType, 'heading');
});

test('current-record intent cannot disguise a static price or bypass the enabled set', async () => {
  const node = title(); node.model = { data: { source: 'current-record', recordType: 'product', contextKey: 'currentProduct', field: 'price', evidenceFactIds: [fact] } };
  const model = analyzeComponentModel(page([node]));
  assert.ok(model.gaps.some(gap => gap.code === 'static-substitute-for-record'));
  assert.ok(model.gaps.some(gap => gap.code === 'record-provider-pending'));
  assert.throws(() => validateNative44Program(page([node])), /unified_component_model_gaps/);
  assert.throws(() => validateNative44Program(page([{ ...node, widgetType: 'wd_single_product_price' }])), /native44_component_not_allowed/);
  await verifyNative44Catalog();
});

test('record owners and data evidence cannot cross contexts or unrelated source facts', () => {
  const record = (key: string, contextKey: string): Native44Component => ({ kind: 'native', key, widgetType: 'wd_single_product_title', sourceFactIds: [fact], widgetSettings: {}, model: { data: { source: 'current-record', recordType: 'product', contextKey, field: 'title', evidenceFactIds: ['otherFact'] } } });
  const model = analyzeComponentModel(page([record('one', 'first'), record('two', 'second')]));
  assert.ok(model.gaps.some(gap => gap.code === 'mixed-current-record-contexts'));
  assert.equal(model.gaps.filter(gap => gap.code === 'binding-source-owner').length, 2);
});

test('proved source product fields cannot be downgraded to static content by omitting model declarations', () => {
  const source: SourceFactsV2 = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', observation: ref, gaps: [], snapshots: [{ id: 'desktop', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1920, scrollbarWidth: 0, devicePixelRatio: 1 }, screenshot: { ...ref, width: 1920, height: 1080 }, evidence: [ref], nodes: { price: { parentId: null, regionId: 'main', tag: 'DIV', selector: '.price', childIds: ['amount'], attributes: { 'data-widget_type': 'wd_single_product_price.default' } }, amount: { parentId: 'price', regionId: 'main', tag: 'SPAN', selector: '.amount', childIds: [] } } }], facts: { [fact]: { id: fact, snapshotId: 'desktop', regionId: 'main', nodeId: 'amount', kind: 'text', evidence: ref, value: { text: 'Synthetic price' } } } };
  assert.throws(() => assertComponentModelSource(page([title()]), source), /source_binding_required/);
  source.snapshots[0].nodes.price.attributes!['data-widget_type'] = 'wd_single_product_tabs.default';
  assert.doesNotThrow(() => assertComponentModelSource(page([title()]), source));
  source.snapshots[0].nodes.price.attributes!['data-widget_type'] = 'wd_single_product_price.default';
  source.snapshots[0].nodes.amount.attributes = { 'data-widget_type': 'heading.default' };
  assert.doesNotThrow(() => assertComponentModelSource(page([title()]), source));
  delete source.snapshots[0].nodes.amount.attributes;
  const historical = page([title()]); delete historical.componentModelPolicy;
  assert.doesNotThrow(() => assertComponentModelSource(historical, source));
});

test('native review widgets infer their shared business owner even without authored interaction metadata', () => {
  const reviews = (key: string): Native44Component => ({ kind: 'native', key, widgetType: 'wd_single_product_reviews', sourceFactIds: [fact], widgetSettings: {} });
  assert.ok(analyzeComponentModel(page([reviews('one'), reviews('two')])).gaps.some(gap => gap.code === 'duplicate-business-owner'));
});

test('collection intent preserves existing typed query adapters and rejects unsupported query semantics', () => {
  const node: Native44Component = { kind: 'native-products', key: 'products', widgetType: 'wd_products', widgetSettings: {}, sourceFactIds: [fact], query: { ids: [123], evidence: ['synthetic-only'] } };
  assert.equal(analyzeComponentModel(page([node])).executable, true);
  node.model = { data: { source: 'collection', query: 'related', contextKey: 'currentProduct', evidenceFactIds: [fact] } };
  assert.ok(analyzeComponentModel(page([node])).gaps.some(gap => gap.code === 'collection-provider-pending'));
  assert.throws(() => assertComponentModelExecutable(page([node])), /collection-provider-pending/);
});

test('shared content blocks and raw dynamic tags require providers rather than static copies', () => {
  const node = title(); node.model = { data: { source: 'shared-resource', resourceType: 'content-block', resourceKey: 'shipping', evidenceFactIds: [fact] } };
  assert.ok(analyzeComponentModel(page([node])).gaps.some(gap => gap.code === 'resource-provider-pending'));
  node.widgetSettings.__dynamic__ = { title: 'synthetic-tag' };
  assert.ok(analyzeComponentModel(page([node])).gaps.some(gap => gap.code === 'dynamic-tag-provider-pending'));
});

test('native disclosure keeps one real controller and rejects missing or unadapted container relationships', () => {
  const node: Native44Component = { kind: 'native', key: 'toggle', widgetType: 'nested-accordion', sourceFactIds: [fact], widgetSettings: {}, model: { interactions: [{ kind: 'disclosure', evidenceFactIds: [fact] }] } };
  assert.equal(analyzeComponentModel(page([node])).executable, true);
  node.model!.interactions![0].controllerKey = 'absent';
  assert.ok(analyzeComponentModel(page([node])).gaps.some(gap => gap.code === 'interaction-owner-missing'));
  const button: Native44Component = { kind: 'native', key: 'more', widgetType: 'wd_button', widgetSettings: { button_collapsible_content: 'yes' } };
  assert.ok(analyzeComponentModel(page([button])).gaps.some(gap => gap.code === 'disclosure-owner-missing'));
});

test('phone duplication cannot create another record/action owner and phone patches remain section scoped', () => {
  const node = title(); node.model = { interactions: [{ kind: 'purchase', contextKey: 'currentProduct', evidenceFactIds: [fact] }] };
  const program = page([{ kind: 'composite', key: 'section', children: [node] }]);
  const model = analyzeComponentModel(program, [{ key: 'section', mode: 'duplicate', settings: [{ componentKey: 'unrelated', values: { width_mobile: 100 } }] }]);
  assert.ok(model.gaps.some(gap => gap.code === 'dynamic-phone-duplicate'));
  assert.ok(model.gaps.some(gap => gap.code === 'phone-component-scope'));
  const copy = structuredClone(node); copy.key = 'another';
  assert.ok(analyzeComponentModel(page([node, copy])).gaps.some(gap => gap.code === 'duplicate-business-owner'));
});

test('historical programs keep their old contract and cannot silently acquire model intent', () => {
  const program = page([title()]); delete program.componentModelPolicy;
  assert.equal(validateNative44Program(program).componentModelPolicy, undefined);
  program.blocks[0].model = { data: { source: 'static' } };
  assert.throws(() => validateNative44Program(program), /unified_component_model_policy_required/);
});

test('a permitted static phone branch remaps its native controller with its actual component keys', () => {
  const node: Native44Component = { kind: 'native', key: 'section_toggle', widgetType: 'accordion', sourceFactIds: [fact], widgetSettings: {}, model: { interactions: [{ kind: 'disclosure', controllerKey: 'section_toggle', evidenceFactIds: [fact] }] } };
  const program = page([{ kind: 'composite', key: 'section', children: [node] }]);
  const result = prepareResponsiveBody(program, { version: 1, tablet: 'desktop', mobileMaxWidth: 768, source: ref, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }], sections: [{ key: 'section', mode: 'duplicate', reason: 'Synthetic source has a distinct static phone arrangement.', evidence: [{ snapshotId: 'one', nodeId: 'source' }, { snapshotId: 'two', nodeId: 'source' }], settings: [], childOrders: [], css: '' }] }, '');
  const phone = result.program.blocks[1];
  assert.equal(phone.kind === 'composite' && phone.children[0].model?.interactions?.[0].controllerKey, 'section_toggle_phone');
  assert.equal(node.model!.interactions![0].controllerKey, 'section_toggle');
});

test('learning snapshot deduplicates fields and patterns, strips instance values and does not grant schema/permission', async () => {
  const path = 'D:/cloneWP/references/four-product-page-learning-20261026/observations.json', bytes = await readFile(path);
  const source = { path, sha256: createHash('sha256').update(bytes).digest('hex') }, learning = createComponentLearning(bytes, source);
  assert.equal(learning.sourceCount, 4);
  assert.equal(learning.policy.defaults, false);
  assert.equal(learning.policy.installedSchema, false);
  assert.equal(new Set(learning.components.map(row => row.widgetType)).size, learning.components.length);
  assert.equal(new Set(learning.patterns.map(row => row.key)).size, learning.patterns.length);
  assert.ok(learning.components.some(row => row.widgetType === 'wd_single_product_price' && !row.enabledIdentity));
  const serialized = JSON.stringify(learning);
  assert.ok(!serialized.includes('70374') && !serialized.includes('31.99') && !serialized.includes('https://'));
  assert.throws(() => createComponentLearning(bytes, { ...source, sha256: '0'.repeat(64) }), /source_hash/);
  const a = componentLearningApplication(learning, { version: 1, kind: 'clonewp-preparation-result', taskId: 't', runId: 'r', jobId: 'body-1', contractHash: ref.sha256, sharedHash: ref.sha256, sections: [{ key: 'section', blocks: [title()], css: '' }] });
  assert.equal(a.model.executable, true);
  assert.equal(a.applications.some(row => row.key === 'record-content-disclosure'), false);
});

test('incomplete phone input returns validation issues instead of an internal exception', () => {
  for (const viewports of [[], [{ width: 390, height: 844 }]]) {
    const input = { version: 1, tablet: 'desktop', mobileMaxWidth: 768, source: ref, viewports };
    assert.equal(responsiveSourceSchema.safeParse(input).success, false);
    assert.equal(responsiveBodyPlanSchema.safeParse({ ...input, sections: [] }).success, false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNative44Compatibility, type Native44CompatibilityCapabilities } from '../src/native44/compatibility.js';
import type { Native44Knowledge, Native44Control, Native44ComponentKnowledge } from '../src/native44/knowledge.js';
import { native44Usage } from '../src/native44/recipes.js';

function local(type = 'heading', controls: Native44Control[] = [{ id: 'title', type: 'textarea', valueDomain: { type: 'textarea', options: [] }, condition: null }]): Native44Knowledge {
  const component = { componentType: type, title: type, controls, usage: native44Usage(type), nested: native44Usage(type).nested, evidence: { runtimeRetestRequired: ['Verify current save/readback and frontend behavior'] } } as Native44ComponentKnowledge;
  return { index: { fingerprint: 'a'.repeat(64), components: { [type]: { path: `${type}.json`, sha256: 'b'.repeat(64), controlCount: controls.length } }, source: { packageHashes: { elementor: 'c'.repeat(64) } }, requiredEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' } }, sharedControls: {}, components: { [type]: component } } as unknown as Native44Knowledge;
}
function observed(type = 'heading', controls: Record<string, any> = { title: { type: 'textarea' } }): Native44CompatibilityCapabilities {
  return { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: { [type]: { type, class: 'ObservedWidget', controls } }, versions: { woodmart: '8.3.4', woodmartCore: '1.1.5', elementor: '3.33.2', elementorPro: '3.32.1' }, limitations: [] };
}

test('version difference alone does not make common content fields incompatible or runtime verified', () => {
  const result = analyzeNative44Compatibility(local('heading', [{ id: 'title', type: 'textarea' }, { id: 'link', type: 'url' }]), observed('heading', { title: { type: 'textarea' }, link: { type: 'url' } })), heading = result.components.find(item => item.componentType === 'heading')!;
  assert.equal(heading.status, 'compatible-common'); assert.deepEqual(heading.usableCommonFields, ['title', 'link']); assert.equal(heading.runtimeVerified, false); assert.equal(result.runtimeVerified, false); assert.equal(result.writePolicyChanged, false); assert.equal(result.summary.unverified, 43);
  assert.match(result.capabilitiesHash, /^[a-f0-9]{64}$/); assert.equal(result.knowledgeFingerprint, 'a'.repeat(64));
});

test('partial registry absence stays unverified; complete observation can prove a missing widget', () => {
  const knowledge = local(), partial = { ...observed(), legacySchemas: {} };
  assert.equal(analyzeNative44Compatibility(knowledge, partial).components.find(item => item.componentType === 'heading')!.status, 'unverified');
  assert.equal(analyzeNative44Compatibility(knowledge, { ...partial, registrationComplete: true }).components.find(item => item.componentType === 'heading')!.status, 'missing');
});

test('control type, unit ranges, steps and enum intersection are compared without coercion', () => {
  const source = local('heading', [
    { id: 'title', type: 'textarea' },
    { id: 'width', type: 'slider', valueDomain: { size_units: ['px'], range: { px: { min: 0, max: 1600, step: 10 } } } },
    { id: 'layout', type: 'select', valueDomain: { options: [{ value: 'meta_value_num' }, { value: 'meta_value' }, { value: 'same' }] } },
  ]);
  const result = analyzeNative44Compatibility(source, observed('heading', { title: { type: 'text' }, width: { type: 'slider', size_units: ['px'], range: { px: { min: 0, max: 1200, step: 5 } } }, layout: { type: 'select', options: { same: 'Same', meta_value: 'A', meta_value_num: 'B' } } })).components.find(item => item.componentType === 'heading')!;
  assert.equal(result.status, 'changed-needs-adapter'); assert.equal(result.controls.find(item => item.field === 'layout')!.status, 'compatible-common'); assert.match(result.controls.find(item => item.field === 'width')!.differences.join(' '), /range/); assert.match(result.controls.find(item => item.field === 'title')!.differences.join(' '), /must not be coerced/);
});

test('condition semantics and repeater field scope are compared independently', () => {
  const controls: Native44Control[] = [{ id: 'slides', type: 'repeater', repeater: { fields: [{ id: 'title', scope: 'slides[]', type: 'text', condition: { type: 'predicate', field: 'show', operator: 'equals', value: 'yes', scope: 'slides[]' } }] } }];
  const source = local('slides', controls), actual = observed('slides', { slides: { type: 'repeater', fields: [{ name: 'title', type: 'text', condition: { show: 'yes' } }] } });
  const result = analyzeNative44Compatibility(source, actual).components.find(item => item.componentType === 'slides')!;
  assert.equal(result.controls.find(item => item.field === 'slides[].title')!.status, 'compatible-common');
  source.components.slides.controls[0].repeater!.fields[0].condition!.scope = 'component';
  const changed = analyzeNative44Compatibility(source, actual).components.find(item => item.componentType === 'slides')!;
  assert.match(changed.controls.find(item => item.field === 'slides[].title')!.differences.join(' '), /scope differs/);
});

test('fixed child containers are not silently treated as repeater children', () => {
  const source = local('wd_toggle', [{ id: 'state', type: 'select', valueDomain: { options: [{ value: 'on' }, { value: 'off' }] } }]);
  const actual = observed('wd_toggle', { state: { type: 'select', options: { on: 'On', off: 'Off' } } });
  actual.legacySchemas.wd_toggle.nativeChildContract = { policy: 'repeater', childType: 'container', baseClass: 'Nested', sourceSha256: 'd'.repeat(64), repeaterKey: 'items', titleSettingKey: 'title' };
  const result = analyzeNative44Compatibility(source, actual).components.find(item => item.componentType === 'wd_toggle')!;
  assert.equal(result.status, 'changed-needs-adapter'); assert.match(result.differences.join(' '), /Nested child/);
});

test('query contracts are high risk while ordinary titles and shared advanced settings remain separate; resource IDs are not recipe defaults', () => {
  const source = local('wd_products', [{ id: 'include', type: 'select2', defaultPolicy: 'task-resource-required', valueDomain: { options: [{ value: '987654321' }] } }, { id: '_flex_order_custom', type: 'number' }]);
  const result = analyzeNative44Compatibility(source, observed('wd_products', { include: { type: 'select2', options: { '987654321': 'Old product' } }, _flex_order_custom: { type: 'number' } }));
  const widget = result.components.find(item => item.componentType === 'wd_products')!;
  assert.equal(widget.controls[0].risk, 'product-high-risk'); assert.equal(widget.controls[1].risk, 'shared-style'); assert.equal(widget.controls[0].commonOptions, undefined); assert.doesNotMatch(JSON.stringify(result), /987654321|Old product/);
});

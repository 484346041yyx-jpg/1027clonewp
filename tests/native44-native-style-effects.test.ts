import test from 'node:test';
import assert from 'node:assert/strict';
import { equalNativeStyleValue, expandNativeStyleDeclaration, inferNativeStyleValue, nativeStyleControlEffects, nativeStyleRegisteredControl, renderNativeStyleTemplate, satisfyNativeStyleConditions } from '../src/native44/native-style-effects.js';
import type { Native44Control } from '../src/native44/knowledge.js';
import type { ControlInfo, LegacySchema } from '../src/wordpress/types.js';

const schema = (controls: LegacySchema['controls']): LegacySchema => ({ type: 'button', class: 'Widget_Button', controls });
const effect = (control: ControlInfo, value: unknown, extra: Record<string, unknown> = {}) => nativeStyleControlEffects(schema({ paint: control }), 'paint', { ...extra, paint: value });

test('registered selectors remain authoritative even when empty or null while omitted metadata uses frozen declarations', () => {
  const frozen: Native44Control = { id: 'color', effectTargets: { selectors: { '{{WRAPPER}}': 'color: {{VALUE}}' }, selectorsDictionary: { primary: 'gold' }, prefixClass: 'theme-' } };
  const inherited = nativeStyleRegisteredControl(frozen, { type: 'select' });
  assert.deepEqual(inherited.selectors, { '{{WRAPPER}}': 'color: {{VALUE}}' });
  assert.deepEqual(nativeStyleRegisteredControl(frozen, { type: 'select', selectors: null, selectors_dictionary: {}, prefix_class: '' }), { type: 'select', selectors: null, selectors_dictionary: {}, prefix_class: '' });
});

test('one native setting preserves all selector and declaration effects rather than reporting only the first color', () => {
  const output = effect({ type: 'color', selectors: { '{{WRAPPER}} .button': 'fill: {{VALUE}}; color: {{VALUE}};', '{{WRAPPER}} .icon': 'border-color: {{VALUE}};' } }, '#ffe100');
  assert.deepEqual(output.map(item => [item.selector, item.property, item.value]), [['{{WRAPPER}} .button', 'fill', '#ffe100'], ['{{WRAPPER}} .button', 'color', '#ffe100'], ['{{WRAPPER}} .icon', 'border-color', '#ffe100']]);
  assert.deepEqual(effect({ type: 'text', selectors: { '{{WRAPPER}}': 'color: {{VALUE}}' } }, 'red; background-image: url(https://unsafe.example/a)'), []);
  assert.deepEqual(effect({ type: 'text', selectors: { '{{WRAPPER}}': 'color: {{VALUE}}' } }, 'red !important'), []);
});

test('dictionary modes produce their real multi-property effects and unknown placeholders remain unresolved', () => {
  const control: ControlInfo = { type: 'select', selectors_dictionary: { row: '--flex-direction: row; --child-width: initial', column: '--flex-direction: column; --child-width: 100%' }, selectors: { '{{WRAPPER}}': '{{VALUE}};' } };
  assert.deepEqual(effect(control, 'column').map(item => [item.property, item.value]), [['--flex-direction', 'column'], ['--child-width', '100%']]);
  assert.equal(renderNativeStyleTemplate('{{SIZE}}{{UNIT}}', { size: 3, unit: 'em' }, { type: 'slider', unit_selectors_dictionary: { em: 'rem' } }), '3rem');
  assert.equal(renderNativeStyleTemplate('{{UNKNOWN}}px', { size: 3 }), undefined);
});

test('empty inherited values emit no declaration and explicit numeric zero remains a real native value', () => {
  assert.equal(renderNativeStyleTemplate('{{VALUE}}', ''), undefined);
  assert.equal(renderNativeStyleTemplate('{{SIZE}}{{UNIT}}', { size: '', unit: 'px' }, { type: 'slider' }), undefined);
  assert.equal(renderNativeStyleTemplate('{{SIZE}}{{UNIT}}', { size: 0, unit: 'px' }, { type: 'slider' }), '0px');
  assert.equal(renderNativeStyleTemplate('{{VALUE}}', 0, { type: 'number' }), '0');
  assert.equal(renderNativeStyleTemplate('{{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}}', { top: '0', right: '', bottom: '0', left: '0', unit: 'px' }, { type: 'dimensions' }), undefined);
});

test('legacy native conditions honor declared defaults, inversions, grouped alternatives and numeric thresholds', () => {
  const controls: LegacySchema['controls'] = {
    mode: { type: 'select', default: 'custom' },
    paint: { type: 'color', condition: { mode: ['custom', 'solid'], 'disabled!': 'yes' }, conditions: { relation: 'or', terms: [{ name: 'size', operator: '>=', value: 10 }, { name: 'enabled', value: 'yes' }] }, selectors: { '{{WRAPPER}}': 'color: {{VALUE}}' } },
  };
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold', size: 10 }).length, 1);
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold', size: 9 }).length, 0);
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold', enabled: 'yes', disabled: 'yes' }).length, 0);
});

test('compound native conditions read current nested values and the nested parts of declared defaults', () => {
  const controls: LegacySchema['controls'] = {
    image: { type: 'media', default: { url: 'https://source.example/owned-image.jpg' } },
    paint: { type: 'color', condition: { 'image[url]!': '' }, selectors: { '{{WRAPPER}}': 'color: {{VALUE}}' } },
  };
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold', image: { url: 'https://source.example/current.jpg' } }).length, 1);
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold' }).length, 1);
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold', image: { url: '' } }).length, 0);
  controls.image.default = { url: '' };
  assert.equal(nativeStyleControlEffects(schema(controls), 'paint', { paint: 'gold' }).length, 0);
});

test('group condition settings are filled only when uniquely determined and never overwrite an explicit non-default mode', () => {
  const definitions: Native44Control[] = [{ id: 'typography', defaultValue: '', valueDomain: { options: [{ value: 'custom' }] } }, { id: 'background', defaultValue: 'classic', valueDomain: { options: [{ value: 'classic' }, { value: 'gradient' }] } }];
  const text: Native44Control = { id: 'font_size', condition: { type: 'predicate', field: 'typography', operator: 'not-equals', value: '', scope: 'component' } };
  const input = { font_size: { size: 20, unit: 'px' } };
  assert.deepEqual(satisfyNativeStyleConditions(text, definitions, input), { ...input, typography: 'custom' });
  assert.deepEqual(input, { font_size: { size: 20, unit: 'px' } });
  assert.equal(satisfyNativeStyleConditions({ id: 'paint', condition: { type: 'predicate', field: 'background', operator: 'equals', value: 'classic' } }, definitions, { background: 'gradient' }), undefined);
  assert.equal(satisfyNativeStyleConditions({ id: 'paint', condition: { type: 'predicate', field: 'background', operator: 'in', value: ['classic', 'gradient'] } }, [{ ...definitions[1], defaultValue: undefined }], {}), undefined);
});

test('resource-scoped or ambiguous condition drivers are not silently guessed', () => {
  const action: Native44Control = { id: 'image', defaultPolicy: 'task-resource-required' };
  assert.equal(satisfyNativeStyleConditions({ id: 'mode', condition: { type: 'predicate', field: 'image', operator: 'equals', value: 'historical-image' } }, [action], {}), undefined);
  assert.equal(satisfyNativeStyleConditions({ id: 'mode', condition: { type: 'predicate', field: 'mode', operator: 'equals', value: 'yes', scope: 'repeater:items' } }, [{ id: 'mode', valueDomain: { options: [{ value: 'yes' }] } }], {}), undefined);
  assert.equal(satisfyNativeStyleConditions({ id: 'paint', condition: { type: 'group', operator: 'or', terms: [{ type: 'predicate', field: 'a', operator: 'equals', value: 'yes' }, { type: 'predicate', field: 'b', operator: 'equals', value: 'yes' }] } }, [{ id: 'a' }, { id: 'b' }], {}), undefined);
});

test('font families normalize quotes and case without declaring different fallback sequences equal', () => {
  assert.equal(equalNativeStyleValue('font-family', '"Open Sans", Arial, sans-serif', "'open sans',Arial,sans-serif"), true);
  assert.equal(equalNativeStyleValue('font-family', '"Open Sans", serif', '"Open Sans", sans-serif'), false);
  assert.ok(inferNativeStyleValue({ type: 'font' }, '"{{VALUE}}", sans-serif', '"Open Sans", sans-serif', 'font-family', {}).includes('Open Sans'));
  assert.equal(equalNativeStyleValue('padding-top', '0px', '0'), true);
  assert.equal(equalNativeStyleValue('color', '#ffd700', 'rgb(255, 215, 0)'), true);
});

test('dimension inference uses all four observed edges with one unit and rejects mixed units', () => {
  const values = { 'padding-top': '0px', 'padding-right': '20px', 'padding-bottom': '4px', 'padding-left': '12px' };
  assert.deepEqual(inferNativeStyleValue({ type: 'dimensions' }, '{{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}}', '0px', 'padding-top', values), [{ isLinked: false, top: '0', right: '20', bottom: '4', left: '12', unit: 'px' }]);
  assert.deepEqual(inferNativeStyleValue({ type: 'dimensions' }, '{{TOP}}{{UNIT}}', '0px', 'padding-top', { ...values, 'padding-right': '2em' }), []);
  assert.deepEqual(inferNativeStyleValue({ type: 'slider' }, '{{SIZE}}{{UNIT}}', '0px', 'font-size', {}), [{ size: 0, unit: 'px' }]);
  assert.deepEqual(expandNativeStyleDeclaration({ selector: '.owner', property: 'padding', value: '2px 4px 6px' }).map(item => item.value), ['2px', '4px', '6px', '4px']);
  assert.deepEqual(expandNativeStyleDeclaration({ selector: '.owner', property: 'border-color', value: 'rgb(1,2,3) transparent' }).map(item => item.property), ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']);
});

test('shadow inference preserves inset position color dimensions and rejects unsupported multiple shadows', () => {
  const values = inferNativeStyleValue({ type: 'box_shadow' }, '', 'inset 0px 2px 6px 1px rgba(0, 0, 0, 0.2)', 'box-shadow', {});
  assert.deepEqual(values, [{ horizontal: 0, vertical: 2, blur: 6, spread: 1, position: 'inset', color: 'rgba(0,0,0,0.2)' }]);
  assert.deepEqual(inferNativeStyleValue({ type: 'text_shadow' }, '', '0px 1px 3px #fff', 'text-shadow', {}), [{ horizontal: 0, vertical: 1, blur: 3, color: '#fff' }]);
  assert.deepEqual(inferNativeStyleValue({ type: 'box_shadow' }, '', '0 1px 2px #000, 0 2px 4px #fff', 'box-shadow', {}), []);
  assert.equal(renderNativeStyleTemplate('{{HORIZONTAL}}px {{VERTICAL}}px {{BLUR}}px {{SPREAD}}px {{COLOR}} {{POSITION}}', values[0], { type: 'box_shadow' }), '0px 2px 6px 1px rgba(0,0,0,0.2) inset');
});

test('actual grouped shadow templates resolve a different control VALUE and a referenced slider SIZE or UNIT', () => {
  const shadow = { horizontal: 0, vertical: 2, blur: 6, spread: 1, color: '#000' };
  const template = '{{HORIZONTAL}}px {{VERTICAL}}px {{BLUR}}px {{SPREAD}}px {{COLOR}} {{shadow_position.VALUE}}';
  assert.equal(renderNativeStyleTemplate(template, shadow, { type: 'box_shadow' }, { shadow_position: 'inset' }), '0px 2px 6px 1px #000 inset');
  assert.equal(renderNativeStyleTemplate(template, shadow, { type: 'box_shadow' }, { shadow_position: ' ' }), '0px 2px 6px 1px #000  ');
  assert.equal(renderNativeStyleTemplate('calc({{other.SIZE}}{{other.UNIT}} + {{SIZE}}{{UNIT}})', { size: 1, unit: 'px' }, { type: 'slider' }, { other: { size: 2, unit: 'rem' } }), 'calc(2rem + 1px)');
});

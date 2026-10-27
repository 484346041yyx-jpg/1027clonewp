import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNative44Styles, type Native44StyleSetting } from '../src/native44/style-resolution.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { expandedNative44Controls, solveNative44Settings } from '../src/native44/settings.js';
import type { Native44Control } from '../src/native44/knowledge.js';
import type { Native44CompileOptions, Native44Native, Native44Program } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const desktopScope = { minWidth: 769, maxWidth: 10000 }, phoneScope = { minWidth: 1, maxWidth: 768 };
const paint = (id: string, selectors: Record<string, string>, extras: Partial<Native44Control> = {}): Native44Control => ({ id, type: 'color', panel: { tab: 'style' }, effectTargets: { selectors }, ...extras });

function fixture(definitions: Native44Control[] = []) {
  const controls: Native44Control[] = [{ id: 'text', type: 'text', panel: { tab: 'content' } }, ...definitions];
  const schema: LegacySchema = { type: 'button', class: 'SyntheticRegisteredButton', controls: {} };
  const registeredFields = (fields: Native44Control[]): Array<Record<string, unknown>> => fields.map(control => {
    const targets = control.effectTargets as { selectors?: unknown; selectorsDictionary?: unknown; prefixClass?: unknown } | undefined;
    return { name: control.id, type: control.type, ...(control.defaultValue !== undefined ? { default: control.defaultValue } : {}), ...(targets?.selectors ? { selectors: targets.selectors } : {}), ...(targets?.selectorsDictionary ? { selectors_dictionary: targets.selectorsDictionary } : {}), ...(targets?.prefixClass ? { prefix_class: targets.prefixClass } : {}), ...(control.repeater ? { fields: registeredFields(control.repeater.fields) } : {}) };
  });
  for (const [controlId, control] of expandedNative44Controls(controls)) {
    const targets = control.effectTargets as { selectors?: unknown; selectorsDictionary?: unknown; prefixClass?: unknown } | undefined;
    const base = controls.find(candidate => candidate.responsive && controlId === candidate.id + '_mobile' || candidate.responsive && controlId === candidate.id + '_tablet');
    schema.controls[controlId] = { type: control.type!, ...(control.defaultValue !== undefined ? { default: control.defaultValue } : {}), ...(control.valueDomain?.options ? { options: Object.fromEntries(control.valueDomain.options.map(option => [String(option.value), option.label ?? String(option.value)])) } : {}), ...(control.responsive ? { responsive: { max: 'desktop' } } : base ? { responsive: { max: controlId.endsWith('_mobile') ? 'mobile' : 'tablet' } } : {}), ...(targets?.selectors ? { selectors: targets.selectors } : {}), ...(targets?.selectorsDictionary ? { selectors_dictionary: targets.selectorsDictionary } : {}), ...(targets?.prefixClass ? { prefix_class: targets.prefixClass } : {}), ...(control.repeater ? { fields: registeredFields(control.repeater.fields) } : {}) };
  }
  const source = { snapshots: [{ id: 'desktop', viewport: { width: 1440, height: 1000 } }, { id: 'phone', viewport: { width: 390, height: 844 } }], facts: {
    normal: { id: 'normal', snapshotId: 'desktop', nodeId: 'button', kind: 'text', value: { style: { color: '#ffffff', fill: '#ffffff', 'background-color': '#cc9900', 'font-family': 'Arial', 'font-size': '18px', 'padding-top': '12px', 'padding-right': '20px', 'padding-bottom': '12px', 'padding-left': '20px', 'flex-direction': 'row' } } },
    icon: { id: 'icon', snapshotId: 'desktop', nodeId: 'icon', kind: 'media', value: { style: { fill: '#ffffff' } } },
    hover: { id: 'hover', snapshotId: 'desktop', nodeId: 'button', kind: 'text', value: { style: { color: '#000000', 'background-color': '#ffdd00' } } },
    phone: { id: 'phone', snapshotId: 'phone', nodeId: 'button', kind: 'text', value: { style: { color: '#222222', width: '100%', 'font-size': '16px', 'padding-top': '0px', 'flex-direction': 'column' } } },
  } } as unknown as SourceFactsV2;
  const node: Native44Native = { kind: 'native', widgetType: 'button', key: 'action', sourceFactIds: ['normal', 'icon', 'hover', 'phone'], widgetSettings: { text: 'Contact' } };
  const program = { styleResolutionVersion: 2, blocks: [node] } as unknown as Native44Program;
  const knowledge: Native44CompileOptions['knowledge'] = {
    fingerprint: 'a'.repeat(64), controlsByWidget: { button: new Set(Object.keys(schema.controls)) }, styleControlsByWidget: { button: controls },
    validateSettings: (_type, settings) => {
      const solved = solveNative44Settings({ componentType: 'button', controls }, settings);
      if (!solved.ok) throw Error('synthetic_native_setting_rejected: ' + solved.errors.join(';'));
      return solved.settings;
    },
  };
  return { program, node, source, schemas: { button: schema }, knowledge, css: '', mobileMaxWidth: 768 };
}

function intent(input: ReturnType<typeof fixture>, controlId: string, value: unknown, options: Partial<Native44StyleSetting> = {}) {
  input.node.nativeStyleSettings = [...input.node.nativeStyleSettings ?? [], { controlId, value, ...desktopScope, sourceFactIds: ['normal'], reason: 'The frozen source observation supports this owned component appearance.', ...options }];
}

function settings(result: ReturnType<typeof resolveNative44Styles>) { return (result.program.blocks[0] as Native44Native).widgetSettings; }
function nativeReceipt(result: ReturnType<typeof resolveNative44Styles>, controlId: string) { return result.receipts.find(receipt => receipt.action === 'native-setting' && receipt.controlId === controlId); }
function bind(input: ReturnType<typeof fixture>, sourceFactId: string, selector: string, properties: string[], phone = false) {
  input.node.styleBindings = [...input.node.styleBindings ?? [], { sourceFactId, selector, properties, ...(phone ? phoneScope : desktopScope) }];
}

test('v2 executes explicitly planned native class settings without replacing content or pretending to render-verify', () => {
  const input = fixture([{ id: 'shape', type: 'select', panel: { tab: 'style' }, valueDomain: { options: [{ value: 'round' }, { value: 'square' }] }, effectTargets: { prefixClass: 'button-shape-' } }]);
  intent(input, 'shape', 'round');
  const before = structuredClone(input.program), result = resolveNative44Styles(input);
  assert.equal(settings(result).shape, 'round'); assert.equal(settings(result).text, 'Contact');
  assert.ok(nativeReceipt(result, 'shape')); assert.equal(result.renderedVerified, false); assert.equal(result.css, '');
  assert.deepEqual(input.program, before);
});

test('v2 prefers one registered setting for all matching text and icon effects instead of supplemental CSS', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};', '{{WRAPPER}} .button svg': 'fill: {{VALUE}};' })]);
  bind(input, 'normal', ' .button', ['color']); bind(input, 'icon', ' .button svg', ['fill']);
  const result = resolveNative44Styles(input);
  assert.ok(nativeReceipt(result, 'ink')); assert.ok(settings(result).ink);
  assert.equal(result.css, ''); assert.equal(result.receipts.filter(receipt => receipt.action === 'scoped-css').length, 0);
});

test('v2 does not assign a bundled setting whose sibling effect contradicts an observed subpart', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};', '{{WRAPPER}} .button svg': 'fill: {{VALUE}};' })]);
  input.source.facts.icon.value.style = { fill: '#000000' };
  bind(input, 'normal', ' .button', ['color']); bind(input, 'icon', ' .button svg', ['fill']);
  const result = resolveNative44Styles(input);
  assert.equal(nativeReceipt(result, 'ink'), undefined);
  assert.ok(result.receipts.some(receipt => receipt.action !== 'native-setting'));
});

test('v2 resolves selector dictionaries using their real selectable value, not a copied CSS value', () => {
  const input = fixture([paint('layout', { '{{WRAPPER}} .button': 'flex-direction: {{VALUE}};' }, { type: 'choose', valueDomain: { options: [{ value: 'horizontal' }, { value: 'vertical' }] }, effectTargets: { selectors: { '{{WRAPPER}} .button': 'flex-direction: {{VALUE}};' }, selectorsDictionary: { horizontal: 'row', vertical: 'column' } } })]);
  bind(input, 'normal', ' .button', ['flex-direction']);
  const result = resolveNative44Styles(input);
  assert.equal(settings(result).layout, 'horizontal'); assert.ok(nativeReceipt(result, 'layout')); assert.equal(result.css, '');
});

test('v2 enables a uniquely required visual mode before applying its dependent setting', () => {
  const input = fixture([
    { id: 'color_mode', type: 'select', defaultValue: 'global', panel: { tab: 'style' }, valueDomain: { options: [{ value: 'global' }, { value: 'custom' }, { value: 'locked' }] } },
    paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' }, { condition: { type: 'predicate', operator: 'equals', field: 'color_mode', value: 'custom', scope: 'component' } }),
  ]);
  bind(input, 'normal', ' .button', ['color']);
  const result = resolveNative44Styles(input);
  assert.equal(settings(result).color_mode, 'custom'); assert.ok(nativeReceipt(result, 'ink'));
  assert.equal(result.css, '');
});

test('v2 preserves an explicit incompatible mode rather than silently overwriting the authored setting', () => {
  const input = fixture([
    { id: 'color_mode', type: 'select', defaultValue: 'global', panel: { tab: 'style' }, valueDomain: { options: [{ value: 'global' }, { value: 'custom' }, { value: 'locked' }] } },
    paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' }, { condition: { type: 'predicate', operator: 'equals', field: 'color_mode', value: 'custom', scope: 'component' } }),
  ]);
  input.node.widgetSettings.color_mode = 'locked'; bind(input, 'normal', ' .button', ['color']);
  const result = resolveNative44Styles(input);
  assert.equal(settings(result).color_mode, 'locked'); assert.equal(nativeReceipt(result, 'ink'), undefined);
});

test('v2 uses the native typography group and family field rather than painting a font override', () => {
  const input = fixture([
    { id: 'typography_typography', type: 'select', defaultValue: '', panel: { tab: 'style' }, valueDomain: { options: [{ value: '' }, { value: 'custom' }] } },
    paint('typography_font_family', { '{{WRAPPER}} .button': 'font-family: {{VALUE}};' }, { type: 'font', condition: { type: 'predicate', operator: 'equals', field: 'typography_typography', value: 'custom', scope: 'component' } }),
  ]);
  bind(input, 'normal', ' .button', ['font-family']);
  const result = resolveNative44Styles(input);
  assert.equal(settings(result).typography_typography, 'custom'); assert.equal(settings(result).typography_font_family, 'Arial');
  assert.ok(nativeReceipt(result, 'typography_font_family')); assert.equal(result.css, '');
});

test('v2 applies all four native inset dimensions as one validated object without four repair declarations', () => {
  const input = fixture([paint('inset', { '{{WRAPPER}} .button': 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' }, { type: 'dimensions' })]);
  bind(input, 'normal', ' .button', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
  const result = resolveNative44Styles(input), value = settings(result).inset as Record<string, unknown>;
  assert.equal(value.unit, 'px'); assert.deepEqual([value.top, value.right, value.bottom, value.left].map(Number), [12, 20, 12, 20]);
  assert.ok(nativeReceipt(result, 'inset')); assert.equal(result.css, '');
});

test('v2 isolates actual desktop and phone native control IDs and values', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' }, { responsive: true, devices: ['desktop', 'tablet', 'mobile'] })]);
  bind(input, 'normal', ' .button', ['color']); bind(input, 'phone', ' .button', ['color'], true);
  const result = resolveNative44Styles(input);
  assert.ok(nativeReceipt(result, 'ink')); assert.ok(nativeReceipt(result, 'ink_mobile'));
  assert.notEqual(settings(result).ink, settings(result).ink_mobile); assert.equal(settings(result).ink_mobile, '#222222'); assert.equal(result.css, '');
});

test('v2 cannot use a desktop-only field as a phone override or invent a missing registered suffix', () => {
  for (const removeRegistration of [false, true]) {
    const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' }, { responsive: removeRegistration, devices: ['desktop', 'mobile'] })]);
    if (removeRegistration) { delete input.schemas.button.controls.ink_mobile; (input.knowledge.controlsByWidget.button as Set<string>).delete('ink_mobile'); }
    bind(input, 'phone', ' .button', ['color'], true);
    const result = resolveNative44Styles(input);
    assert.equal(nativeReceipt(result, 'ink'), undefined); assert.equal(nativeReceipt(result, 'ink_mobile'), undefined);
    assert.equal(settings(result).ink, undefined); assert.equal(settings(result).ink_mobile, undefined);
  }
});

test('v2 explicit repeater style changes follow a stable item ID instead of an array index', () => {
  const color: Native44Control = paint('item_ink', { '{{WRAPPER}} {{CURRENT_ITEM}} .label': 'color: {{VALUE}};' });
  const input = fixture([{ id: 'items', type: 'repeater', panel: { tab: 'content' }, repeater: { itemIdentityField: '_id', fields: [color, { id: 'title', type: 'text', panel: { tab: 'content' } }] } }]);
  input.node.widgetSettings.items = [{ _id: 'second', title: 'Second', item_ink: '#000000' }, { _id: 'first', title: 'First', item_ink: '#111111' }];
  intent(input, 'item_ink', '#ffffff', { repeaterPath: [{ controlId: 'items', itemId: 'first' }] });
  const result = resolveNative44Styles(input), items = settings(result).items as Record<string, unknown>[];
  assert.equal(items[0].item_ink, '#000000'); assert.equal(items[1].item_ink, '#ffffff');
  assert.ok(nativeReceipt(result, 'item_ink')); assert.equal(result.css, '');
});

test('v2 rejects ambiguous or missing repeater item identities rather than changing a neighboring row', () => {
  for (const duplicate of [false, true]) {
    const input = fixture([{ id: 'items', type: 'repeater', repeater: { itemIdentityField: '_id', fields: [paint('item_ink', { '{{WRAPPER}} {{CURRENT_ITEM}}': 'color: {{VALUE}};' })] } }]);
    input.node.widgetSettings.items = duplicate ? [{ _id: 'chosen', item_ink: '#000000' }, { _id: 'chosen', item_ink: '#111111' }] : [{ _id: 'other', item_ink: '#000000' }];
    intent(input, 'item_ink', '#ffffff', { repeaterPath: [{ controlId: 'items', itemId: 'chosen' }] });
    const before = structuredClone(input.program);
    let result: ReturnType<typeof resolveNative44Styles> | undefined;
    try { result = resolveNative44Styles(input); } catch (error) { assert.match(String(error), /repeater|identity|native|style/i); }
    if (result) { assert.equal(nativeReceipt(result, 'item_ink'), undefined); assert.deepEqual(settings(result).items, input.node.widgetSettings.items); }
    assert.deepEqual(input.program, before);
  }
});

test('v2 does not mislabel custom CSS, content resources or business actions as native appearance settings', () => {
  for (const control of [
    { id: 'custom_css', type: 'code', panel: { tab: 'advanced' } },
    { id: 'submit_actions', type: 'select2', panel: { tab: 'content' } },
    { id: 'email_to', type: 'text', panel: { tab: 'content' } },
    { id: 'image', type: 'media', panel: { tab: 'content' } },
  ] satisfies Native44Control[]) {
    const input = fixture([control]); intent(input, control.id, control.id === 'image' ? { id: 12, url: 'https://target.example/image.jpg' } : 'unsafe-setting');
    let result: ReturnType<typeof resolveNative44Styles> | undefined;
    try { result = resolveNative44Styles(input); } catch (error) { assert.match(String(error), /native|style|setting|resource/i); }
    if (result) { assert.equal(nativeReceipt(result, control.id), undefined); assert.equal(settings(result)[control.id], undefined); assert.ok(result.receipts.some(receipt => receipt.action === 'unresolved')); }
  }
});

test('v2 removes only owned same-scope CSS declarations superseded by native settings', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' })]); bind(input, 'normal', ' .button', ['color']);
  const owner = native44ModuleClass('action');
  input.css = `@media(min-width:769px) and (max-width:10000px){:page .${owner} .button{color:blue;width:12px}:page .${owner} .other{color:blue}}`;
  const result = resolveNative44Styles(input);
  assert.ok(nativeReceipt(result, 'ink')); assert.match(result.css, /width:12px/); assert.match(result.css, /\.other\{color:blue\}/);
  assert.equal(result.css.includes('.button{color:blue'), false);
});

test('v2 preserves unsafe or unowned CSS overlap as an explicit unresolved case instead of erasing it', () => {
  const input = fixture([paint('background', { '{{WRAPPER}} .button': 'background-color: {{VALUE}};' })]); bind(input, 'normal', ' .button', ['background-color']);
  input.css = `:page .${native44ModuleClass('action')} .button{background:red!important;border:2px solid black}`;
  const result = resolveNative44Styles(input);
  assert.match(result.css, /background:red!important/); assert.match(result.css, /border:2px solid black/);
  assert.ok(result.receipts.some(receipt => receipt.action === 'unresolved'));
});

test('v2 CSS variable names alone do not authorize guessed native color consumers', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}}': '--button-color: {{VALUE}};' })]); bind(input, 'normal', ' .button', ['color']);
  const result = resolveNative44Styles(input);
  assert.equal(nativeReceipt(result, 'ink'), undefined); assert.equal(settings(result).ink, undefined);
  assert.ok(result.receipts.some(receipt => receipt.action === 'scoped-css' || receipt.action === 'unresolved'));
});

test('v2 refuses CSS declaration injection in a scalar native style value', () => {
  for (const value of ['#fff;display:none', 'red!important', 'url(https://unowned.example/tracker.png)']) {
    const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' })]); intent(input, 'ink', value);
    const result = resolveNative44Styles(input);
    assert.equal(settings(result).ink, undefined, value); assert.equal(nativeReceipt(result, 'ink'), undefined, value);
    assert.ok(result.receipts.some(receipt => receipt.action === 'unresolved'), value);
  }
});

test('v2 explicitly clears an existing phone size while preserving desktop size and the distinction from zero', () => {
  const input = fixture([paint('size', { '{{WRAPPER}} .button': 'font-size: {{SIZE}}{{UNIT}};' }, { type: 'slider', responsive: true })]);
  input.node.widgetSettings.size = { size: 18, unit: 'px' }; input.node.widgetSettings.size_mobile = { size: 8, unit: 'px' };
  intent(input, 'size_mobile', { size: '', unit: 'px' }, { ...phoneScope, sourceFactIds: ['phone'] });
  const result = resolveNative44Styles(input);
  assert.deepEqual(settings(result).size, { size: 18, unit: 'px' }); assert.deepEqual(settings(result).size_mobile, { size: '', unit: 'px' });
  assert.ok(nativeReceipt(result, 'size_mobile')); assert.equal(result.css, '');
  const zero = fixture([paint('size', { '{{WRAPPER}} .button': 'font-size: {{SIZE}}{{UNIT}};' }, { type: 'slider', responsive: true })]);
  intent(zero, 'size_mobile', { size: 0, unit: 'px' }, { ...phoneScope, sourceFactIds: ['phone'] });
  assert.deepEqual(settings(resolveNative44Styles(zero)).size_mobile, { size: 0, unit: 'px' });
});

test('v2 rejects a native setting intent with an unowned source fact or a mismatched source viewport', () => {
  for (const options of [{ sourceFactIds: ['missing'] }, { sourceFactIds: ['phone'] }]) {
    const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' })]); intent(input, 'ink', '#ffffff', options);
    const result = resolveNative44Styles(input);
    assert.equal(settings(result).ink, undefined); assert.equal(nativeReceipt(result, 'ink'), undefined);
    assert.ok(result.receipts.some(receipt => receipt.action === 'unresolved' && /source|viewport/.test(receipt.reason)));
  }
});

test('v2 rejects conflicting frozen source demands instead of picking the last color', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};' })]);
  bind(input, 'normal', ' .button', ['color']); bind(input, 'hover', ' .button', ['color']);
  assert.throws(() => resolveNative44Styles(input), /conflicting_source/);
});

test('v1 stays frozen: bundled native setting inference is not silently enabled for an old program', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}} .button': 'color: {{VALUE}};fill: {{VALUE}};' })]);
  input.program.styleResolutionVersion = 1; bind(input, 'normal', ' .button', ['color', 'fill']);
  const result = resolveNative44Styles(input);
  assert.equal(settings(result).ink, undefined); assert.equal(nativeReceipt(result, 'ink'), undefined);
  assert.equal(result.receipts.filter(receipt => receipt.action === 'scoped-css').length, 1);
  assert.equal(result.receipts.filter(receipt => receipt.property === 'fill' && receipt.action === 'unresolved').length, 1);
});

test('v2 reads unrelated registered selector templates once per model instead of once per desired property', () => {
  const input = fixture([paint('unrelated', { '{{WRAPPER}} .never': 'color: {{VALUE}};' })]);
  let enumerations = 0;
  input.schemas.button.controls.unrelated.selectors = new Proxy({ '{{WRAPPER}} .never': 'color: {{VALUE}};' }, { ownKeys: target => { enumerations++; return Reflect.ownKeys(target); } });
  for (let index = 0; index < 60; index++) bind(input, 'normal', ' .button', ['color']);
  const first = resolveNative44Styles(input);
  assert.equal(enumerations, 1);
  assert.equal(first.receipts.filter(receipt => receipt.action === 'scoped-css').length, 60);
  input.schemas.button.controls.unrelated.selectors = { '{{WRAPPER}} .button': 'color: {{VALUE}};' };
  const second = resolveNative44Styles(input);
  assert.equal(settings(second).unrelated, '#ffffff');
  assert.ok(nativeReceipt(second, 'unrelated'));
});

test('v2 indexes unrelated variable consumers once and keeps cached projections within one invocation', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}}': '--ink: {{VALUE}};' })]);
  let variableReads = 0;
  const consumers = Array.from({ length: 250 }, (_, index) => ({ get variable() { variableReads++; return `--unrelated-${index}`; }, selector: '{{WRAPPER}} .other', property: 'color', value: 'var(--unused)', direct: true, atRules: [], packageId: 'synthetic', packageSha256: 'a'.repeat(64), entry: 'synthetic.css', sourceSha256: 'b'.repeat(64) }));
  const matching = { variable: '--ink', selector: '{{WRAPPER}} .button', property: 'color', value: 'var(--ink)', direct: true, atRules: [], packageId: 'synthetic', packageSha256: 'a'.repeat(64), entry: 'synthetic.css', sourceSha256: 'b'.repeat(64) };
  input.knowledge.styleVariableConsumers = [...consumers, matching];
  for (let index = 0; index < 20; index++) bind(input, 'normal', ' .button', ['color']);
  const first = resolveNative44Styles(input);
  assert.equal(settings(first).ink, '#ffffff');
  assert.equal(variableReads, consumers.length * 2);
  matching.selector = '{{WRAPPER}} .other';
  const second = resolveNative44Styles(input);
  assert.equal(settings(second).ink, undefined);
  assert.ok(second.receipts.some(receipt => receipt.action === 'scoped-css'));
  assert.equal(variableReads, consumers.length * 4);
});

test('v2 variable projection cache preserves consumer media coverage and desktop versus phone settings', () => {
  const input = fixture([paint('ink', { '{{WRAPPER}}': '--ink: {{VALUE}};' }, { responsive: true })]);
  input.knowledge.styleVariableConsumers = [{ variable: '--ink', selector: '{{WRAPPER}} .button', property: 'color', value: 'var(--ink)', direct: true, atRules: ['@media(min-width:769px)'], packageId: 'synthetic', packageSha256: 'a'.repeat(64), entry: 'synthetic.css', sourceSha256: 'b'.repeat(64) }];
  bind(input, 'normal', ' .button', ['color']);
  bind(input, 'phone', ' .button', ['color'], true);
  const result = resolveNative44Styles(input);
  assert.equal(settings(result).ink, '#ffffff');
  assert.equal(settings(result).ink_mobile, undefined);
  assert.ok(nativeReceipt(result, 'ink'));
  assert.ok(result.receipts.some(receipt => receipt.sourceFactId === 'phone' && receipt.action === 'scoped-css'));
});

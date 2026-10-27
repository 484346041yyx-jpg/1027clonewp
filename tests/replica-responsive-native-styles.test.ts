import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertMobileNativeStyleCSS, assertRegisteredMobileSetting, mirrorRegisteredDesktopSettings } from '../src/replica-responsive/style-settings.js';
import { nativeStyleControlEffects } from '../src/native44/style-resolution.js';
import { compileResponsiveBody, prepareResponsiveBody } from '../src/replica-responsive/body.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { assertNative44Compilation } from '../src/native44/compiler.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import type { Native44Program } from '../src/native44/types.js';
import type { ResponsivePlan } from '../src/replica-responsive/contract.js';

function responsiveSchema(): LegacySchema {
  return { type: 'button', class: 'SyntheticButton', controls: {
    inset: { type: 'slider', responsive: { max: 'desktop' }, selectors: { '{{WRAPPER}} .label': 'padding-top: {{SIZE}}{{UNIT}};' } },
    inset_tablet: { type: 'slider', responsive: { max: 'tablet' } },
    inset_mobile: { type: 'slider', responsive: { max: 'mobile' } },
    layout: { type: 'choose', responsive: true, selectors_dictionary: { wide: 'row', narrow: 'column' }, selectors: { '{{WRAPPER}}': 'flex-direction: {{VALUE}}; --layout: {{VALUE}};' } },
    layout_tablet: { type: 'choose', responsive: { max: 'tablet' } },
    layout_mobile: { type: 'choose', responsive: { max: 'mobile' } },
    background_play_on_mobile: { type: 'switcher', default: 'yes' },
  } };
}

test('desktop tablet mirroring uses real device registrations and preserves phone zero and clearing values', () => {
  const schema = responsiveSchema(), registered = new Set(Object.keys(schema.controls));
  const settings = { inset: { size: 24, unit: 'px' }, inset_mobile: { size: 0, unit: 'px' }, layout: 'wide', layout_mobile: '', background_play_on_mobile: 'yes' };
  const phoneBefore = structuredClone({ inset_mobile: settings.inset_mobile, layout_mobile: settings.layout_mobile });
  mirrorRegisteredDesktopSettings(settings, schema, registered);
  assert.deepEqual((settings as Record<string, unknown>).inset_tablet, settings.inset);
  assert.equal((settings as Record<string, unknown>).layout_tablet, 'wide');
  assert.deepEqual({ inset_mobile: settings.inset_mobile, layout_mobile: settings.layout_mobile }, phoneBefore);
  assert.equal(Object.keys(settings).some(name => /_mobile_tablet|_tablet_tablet/.test(name)), false);
  schema.controls.inset_tablet.type = 'text';
  const differentType = { inset: { size: 12, unit: 'px' } }; mirrorRegisteredDesktopSettings(differentType, schema, registered);
  assert.equal(Object.hasOwn(differentType, 'inset_tablet'), false);
  schema.controls.layout.devices = ['desktop', 'mobile'];
  const noTablet = { layout: 'wide' }; mirrorRegisteredDesktopSettings(noTablet, schema, registered);
  assert.equal(Object.hasOwn(noTablet, 'layout_tablet'), false);
});

test('phone fields require their exact registered device, control type and researched identity', () => {
  const schema = responsiveSchema(), registered = new Set(Object.keys(schema.controls));
  assert.doesNotThrow(() => assertRegisteredMobileSetting('button', 'inset_mobile', schema, registered));
  for (const changed of [
    () => { schema.controls.inset_mobile.type = 'text'; },
    () => { schema.controls.inset.devices = ['desktop', 'tablet']; },
    () => { schema.controls.inset_mobile.responsive = { max: 'tablet' }; },
    () => { registered.delete('inset_mobile'); },
  ]) {
    changed(); assert.throws(() => assertRegisteredMobileSetting('button', 'inset_mobile', schema, registered), /responsive_registration/);
    schema.controls.inset_mobile = { type: 'slider', responsive: { max: 'mobile' } }; delete schema.controls.inset.devices; registered.add('inset_mobile');
  }
  assert.throws(() => assertRegisteredMobileSetting('button', 'background_play_on_mobile', schema, registered), /responsive_registration/);
});

test('phone native style conflict detection respects all enclosing width ranges, alternatives and the passed breakpoint', () => {
  const effect = [{ selector: '{{WRAPPER}} .label', property: 'color', value: 'red' }], target = ':page .owner .label';
  for (const input of [
    `@media(min-width:701px){${target}{color:blue}}`,
    `@media(max-width:700px){@media(min-width:701px){${target}{color:blue}}}`,
    `@media(min-width:701px),(min-width:1100px){${target}{color:blue}}`,
    `@media(width > 700px){${target}{color:blue}}`,
    `@media(700px < width){${target}{color:blue}}`,
    `@media(700px < width <= 900px){${target}{color:blue}}`,
    `@media not (max-width:700px){${target}{color:blue}}`,
    `@media not screen and (max-width:700px){${target}{color:blue}}`,
    `@media((width > 700px) or (width < 0px)){${target}{color:blue}}`,
    `@media print{${target}{color:blue}}`,
  ]) assert.doesNotThrow(() => assertMobileNativeStyleCSS(input, 'owner', effect, 700), input);
  for (const input of [
    `@media(min-width:700px){${target}{color:blue}}`,
    `@media(min-width:900px),(max-width:500px){${target}{color:blue}}`,
    `@media(max-width:800px){@supports(display:grid){@media(min-width:650px){${target}{color:blue}}}}`,
    `@media(390px <= width <= 700px){${target}{color:blue}}`,
    `@media not (min-width:700px){${target}{color:blue}}`,
    `@media((width > 1000px) or (width < 400px)){${target}{color:blue}}`,
  ]) assert.throws(() => assertMobileNativeStyleCSS(input, 'owner', effect, 700), /css_overrides_native_mobile_value/, input);
});

test('phone CSS checks isolate subparts, selected and hover states rather than rejecting a repeated property name', () => {
  const effects = [
    { selector: '{{WRAPPER}} .label', property: 'color', value: 'red' },
    { selector: '{{WRAPPER}} .label[aria-selected="true"]', property: 'color', value: 'gold' },
  ];
  assert.doesNotThrow(() => assertMobileNativeStyleCSS(':page .owner .other{color:blue}:page .owner .label:hover{color:blue}:page .owner[aria-selected="true"] .label{color:blue}', 'owner', effects, 768));
  assert.throws(() => assertMobileNativeStyleCSS(':page .owner .label[aria-selected="true"]{color:blue}', 'owner', effects, 768), /css_overrides_native_mobile_value/);
  assert.doesNotThrow(() => assertMobileNativeStyleCSS(':page .owner.owner .label{color:red}', 'owner', effects, 768));
  assert.doesNotThrow(() => assertMobileNativeStyleCSS(':page .owner .label{color:rgb(255,255,255)}', 'owner', [{ selector: '{{WRAPPER}} .label', property: 'color', value: '#fff' }], 768));
});

test('phone CSS checks evaluate every explicit native effect, dimensions, gaps and CSS variable declarations', () => {
  const effects = [
    { selector: '{{WRAPPER}}', property: '--layout', value: 'column' },
    { selector: '{{WRAPPER}} .label', property: 'padding-top', value: '0px' },
    { selector: '{{WRAPPER}} .label', property: 'row-gap', value: '12px' },
    { selector: '{{WRAPPER}} .label', property: 'column-gap', value: '16px' },
  ];
  assert.doesNotThrow(() => assertMobileNativeStyleCSS(':page .owner{--layout:column}:page .owner .label{padding:0;gap:12px 16px}', 'owner', effects, 768));
  for (const input of [':page .owner{--layout:row}', ':page .owner .label{padding:8px 0}', ':page .owner .label{gap:12px}']) assert.throws(() => assertMobileNativeStyleCSS(input, 'owner', effects, 768), /css_overrides_native_mobile_value/);
  assert.doesNotThrow(() => assertMobileNativeStyleCSS(':page .owner .unrelated{--layout:row}', 'owner', effects, 768));
});

test('native responsive API handles dictionary effects, zero and an explicit empty slider without inventing a declaration', () => {
  const schema = responsiveSchema();
  schema.controls.inset_mobile = { ...schema.controls.inset, responsive: { max: 'mobile' } };
  schema.controls.layout_mobile = { ...schema.controls.layout, responsive: { max: 'mobile' } };
  const settings = { inset_mobile: { size: 0, unit: 'px' }, layout_mobile: 'narrow' };
  const effects = nativeStyleControlEffects(schema, 'layout_mobile', settings);
  assert.ok(effects.some(effect => effect.property === 'flex-direction' && effect.value === 'column'));
  assert.ok(effects.some(effect => effect.property === '--layout' && effect.value === 'column'));
  assert.ok(nativeStyleControlEffects(schema, 'inset_mobile', settings).some(effect => effect.property === 'padding-top' && /^0(?:px)?$/.test(effect.value)));
  assert.deepEqual(nativeStyleControlEffects(schema, 'inset_mobile', { ...settings, inset_mobile: { size: '', unit: 'px' } }), []);
});

test('responsive v2 preserves native compilation proof and phone zero while mirroring only desktop settings to tablet', async () => {
  const fixture = await preparationIOFixture();
  try {
    const loaded = await loadNative44Knowledge(['container', 'heading']);
    const program = { ...fixture.plan.bodyBase, styleResolutionVersion: 2, blocks: fixture.results.flatMap(result => result.sections?.flatMap(section => section.blocks) ?? []) } as Native44Program;
    program.blocks[0].settings = { padding: { top: '20', right: '20', bottom: '20', left: '20', unit: 'px', isLinked: true }, padding_mobile: { top: '0', right: '0', bottom: '0', left: '0', unit: 'px', isLinked: true } };
    const schemas: Record<string, LegacySchema> = {};
    for (const type of ['container', 'heading']) {
      const controls: LegacySchema['controls'] = {};
      for (const control of loaded.components[type].controls) {
        controls[control.id] = { type: control.type!, ...(control.defaultValue !== undefined ? { default: control.defaultValue } : {}), ...(control.responsive ? { responsive: { max: 'desktop' } } : {}) };
        if (control.responsive) for (const device of ['tablet', 'mobile']) controls[control.id + '_' + device] = { type: control.type!, responsive: { max: device } };
      }
      schemas[type] = { type, class: 'SyntheticRegistered', controls };
    }
    schemas.container.controls.padding.selectors = { '{{WRAPPER}}': 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' };
    const original = structuredClone(program), options = { schemas, knowledge: toNative44CompilerKnowledge(loaded), assets: [] };
    const compiled = compileResponsiveBody(program, options);
    assertNative44Compilation(compiled, compiled.composition);
    assert.deepEqual(compiled.composition.elements[0].settings.padding_tablet, program.blocks[0].settings.padding);
    assert.deepEqual(compiled.composition.elements[0].settings.padding_mobile, program.blocks[0].settings.padding_mobile);
    assert.deepEqual(program, original);
    const selector = ':page .' + native44ModuleClass(program.blocks[0].key);
    assert.throws(() => compileResponsiveBody(program, options, `${selector}{padding:10px}`, 700), /css_overrides_native_mobile_value/);
    assert.doesNotThrow(() => compileResponsiveBody(program, options, `@media(min-width:701px){${selector}{padding:10px}}`, 700));
    assert.doesNotThrow(() => compileResponsiveBody(program, options, `${selector}{padding:0}`, 700));
    schemas.container.controls.padding_mobile.selectors = null;
    assert.doesNotThrow(() => compileResponsiveBody(program, options, `${selector}{padding:10px}`, 700));
  } finally { await fixture.cleanup(); }
});

test('phone native authoring intents stay with their exact owner and width scope, including duplicated static sections', async () => {
  const fixture = await preparationIOFixture();
  try {
    const program = { ...fixture.plan.bodyBase, styleResolutionVersion: 2, blocks: fixture.results.flatMap(result => result.sections?.flatMap(section => section.blocks) ?? []) } as Native44Program;
    const sections: ResponsivePlan['sections'] = program.blocks.map(block => ({ key: block.key, mode: 'shared', reason: 'Synthetic phone source preserves this principal region.', evidence: [{ snapshotId: 'phone-390', nodeId: block.key }, { snapshotId: 'phone-430', nodeId: block.key }], settings: [], childOrders: [], css: '' }));
    const owner = program.blocks[0], sourceFactId = owner.sourceFactIds![0];
    sections[0].mode = 'duplicate';
    sections[0].nativeStyleSettings = [{ componentKey: owner.key, setting: { controlId: 'padding_mobile', value: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true }, minWidth: 1, maxWidth: 700, sourceFactIds: [sourceFactId], reason: 'The source phone principal container has no internal inset.' } }];
    const plan: ResponsivePlan = { version: 1, tablet: 'desktop', mobileMaxWidth: 700, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }], source: { path: 'synthetic-phone.json', sha256: 'a'.repeat(64) }, sections };
    const result = prepareResponsiveBody(program, plan, '');
    assert.equal(result.program.blocks[0].nativeStyleSettings, undefined);
    assert.deepEqual(result.program.blocks[1].nativeStyleSettings, [sections[0].nativeStyleSettings[0].setting]);
    assert.equal(result.program.blocks[1].key, owner.key + '_phone');
    assert.equal(owner.nativeStyleSettings, undefined);
    const outOfScope = structuredClone(plan); outOfScope.sections[0].nativeStyleSettings![0].setting.maxWidth = 701;
    assert.throws(() => prepareResponsiveBody(program, outOfScope, ''), /native_style_setting_scope/);
    const wrongOwner = structuredClone(plan); wrongOwner.sections[0].nativeStyleSettings![0].componentKey = program.blocks[1].key;
    assert.throws(() => prepareResponsiveBody(program, wrongOwner, ''), /native_style_setting_scope/);
    const legacy = structuredClone(program); legacy.styleResolutionVersion = 1;
    assert.throws(() => prepareResponsiveBody(legacy, plan, ''), /native_style_setting_scope/);
    const hidden = structuredClone(plan); hidden.sections[0].mode = 'desktop-only';
    assert.throws(() => prepareResponsiveBody(program, hidden, ''), /hidden_section_has_mobile_settings/);
  } finally { await fixture.cleanup(); }
});

test('registered native effects render phone and desktop layout independently at four widths without added repair CSS', async () => {
  const schema = responsiveSchema();
  schema.controls.inset_mobile = { ...schema.controls.inset, responsive: { max: 'mobile' } };
  schema.controls.layout_mobile = { ...schema.controls.layout, responsive: { max: 'mobile' } };
  const values: Record<string, unknown> = { inset: { size: 24, unit: 'px' }, inset_mobile: { size: 0, unit: 'px' }, layout: 'wide', layout_mobile: 'narrow' };
  mirrorRegisteredDesktopSettings(values, schema, new Set(Object.keys(schema.controls)));
  const emit = (controlId: string) => nativeStyleControlEffects(schema, controlId, values).map(effect => `${effect.selector.replaceAll('{{WRAPPER}}', '.owner')}{${effect.property}:${effect.value}}`).join('');
  const nativeCSS = emit('inset') + emit('layout') + '@media(max-width:700px){' + emit('inset_mobile') + emit('layout_mobile') + '}';
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [1920, 1440, 390, 430]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent('<!doctype html><style>.owner{display:flex}' + nativeCSS + '</style><section class="owner"><span class="label">One</span><span class="label">Two</span></section>');
      const actual = await page.evaluate(() => ({ direction: getComputedStyle(document.querySelector('.owner')!).flexDirection, padding: getComputedStyle(document.querySelector('.label')!).paddingTop, variable: getComputedStyle(document.querySelector('.owner')!).getPropertyValue('--layout').trim() }));
      assert.deepEqual(actual, { direction: width > 700 ? 'row' : 'column', padding: width > 700 ? '24px' : '0px', variable: width > 700 ? 'row' : 'column' });
    }
  } finally { await browser.close(); }
});

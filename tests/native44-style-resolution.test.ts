import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { collectStyleRequirements, resolveNative44Styles, nativeStyleEffects } from '../src/native44/style-resolution.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import type { Native44Program, Native44CompileOptions } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { LegacySchema } from '../src/wordpress/types.js';

function fixture() {
  const source = { snapshots: [{ id: 'desktop', viewport: { width: 1440, height: 1000 } }, { id: 'phone', viewport: { width: 390, height: 844 } }], facts: {
    normal: { id: 'normal', snapshotId: 'desktop', nodeId: 'button', kind: 'text', value: { style: { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(204, 153, 0)', width: '160px', 'font-size': '18px' } } },
    hover: { id: 'hover', snapshotId: 'desktop', nodeId: 'button', kind: 'text', value: { style: { color: 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 221, 0)' } } },
    phone: { id: 'phone', snapshotId: 'phone', nodeId: 'button', kind: 'text', value: { style: { color: 'rgb(30, 30, 30)', width: '100%', 'font-size': '16px' } } },
  } } as unknown as SourceFactsV2;
  const program = { styleResolutionVersion: 1, blocks: [{ kind: 'native', widgetType: 'button', key: 'button', sourceFactIds: ['normal', 'hover', 'phone'], widgetSettings: { text: 'Contact' }, styleBindings: [{ sourceFactId: 'normal', selector: ' .button', minWidth: 769, maxWidth: 10000, properties: ['color', 'width', 'background-color'] }, { sourceFactId: 'hover', selector: ' .button:hover', minWidth: 769, maxWidth: 10000, properties: ['color'] }, { sourceFactId: 'phone', selector: ' .button', minWidth: 1, maxWidth: 768, properties: ['color', 'width'] }] }] } as unknown as Native44Program;
  const schemas: Record<string, LegacySchema> = { button: { type: 'button', class: 'Button', controls: {
    color: { type: 'color', default: 'green', selectors: { '{{WRAPPER}} .button': 'color: {{VALUE}};' } },
    hover_color: { type: 'color', selectors: { '{{WRAPPER}} .button:hover': 'color: {{VALUE}};' } },
    color_mobile: { type: 'color', responsive: true, selectors: { '{{WRAPPER}} .button': 'color: {{VALUE}};' } },
  } } };
  const knowledge: Native44CompileOptions['knowledge'] = { fingerprint: 'a'.repeat(64), controlsByWidget: { button: new Set(['color', 'hover_color', 'color_mobile']) }, validateSettings: (_type, settings) => structuredClone(settings) };
  return { source, program, schemas, knowledge, css: '', mobileMaxWidth: 768 };
}

test('style preparation records exact subpart and live defaults; resolver executes desktop/mobile native changes and scoped fallback', () => {
  const input = fixture(), before = JSON.stringify(input);
  const effects = nativeStyleEffects(input.schemas.button);
  assert.equal(effects[0].defaultValue, 'green');
  const result = resolveNative44Styles(input);
  const button = result.program.blocks[0];
  assert.equal(button.kind, 'native');
  if (button.kind !== 'native') return;
  assert.equal(button.widgetSettings.color, 'rgb(255, 255, 255)');
  assert.equal(button.widgetSettings.hover_color, 'rgb(0, 0, 0)');
  assert.equal(button.widgetSettings.color_mobile, 'rgb(30, 30, 30)');
  assert.equal(result.receipts.filter(row => row.action === 'scoped-css').length, 3);
  assert.equal(result.renderedVerified, false);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.css.includes('!important'), false);
});

test('different descendants and persistent/hover states are separate effects, not property-only conflicts', () => {
  const input = fixture();
  input.program.blocks[0].styleBindings = [{ sourceFactId: 'normal', selector: ' .label', minWidth: 769, maxWidth: 10000, properties: ['color'] }, { sourceFactId: 'hover', selector: ' .button[aria-selected="true"]:hover', minWidth: 769, maxWidth: 10000, properties: ['color'] }];
  const result = resolveNative44Styles(input);
  assert.ok(result.receipts.every(row => row.action === 'scoped-css'));
  assert.equal((result.program.blocks[0] as any).widgetSettings.color, undefined);
});

test('ambiguous, inactive, bundled and unregistered controls never receive guessed native values', () => {
  for (const mode of ['ambiguous', 'inactive', 'bundled', 'unregistered']) {
    const input = fixture();
    input.program.blocks[0].styleBindings = [input.program.blocks[0].styleBindings![0]];
    if (mode === 'ambiguous') input.schemas.button.controls.other_color = { ...input.schemas.button.controls.color };
    if (mode === 'inactive') input.knowledge.validateSettings = (_type, values) => Object.fromEntries(Object.entries(values).filter(([name]) => name !== 'color'));
    if (mode === 'bundled') input.schemas.button.controls.color.selectors = { '{{WRAPPER}} .button': 'color: {{VALUE}}; border-color: {{VALUE}};' };
    if (mode === 'unregistered') input.knowledge.controlsByWidget.button = new Set();
    const result = resolveNative44Styles(input);
    assert.equal(result.receipts.find(row => row.property === 'color')?.action, 'scoped-css', mode);
    assert.equal((result.program.blocks[0] as any).widgetSettings.color, undefined, mode);
  }
});

test('source overlap conflicts fail explicitly; absent source, missing bindings and unsafe selectors are not fabricated', () => {
  const input = fixture();
  input.program.blocks[0].styleBindings!.push({ sourceFactId: 'hover', selector: ' .button', minWidth: 769, maxWidth: 10000, properties: ['color'] });
  assert.throws(() => resolveNative44Styles(input), /conflicting_source/);
  const absent = fixture(); delete absent.program.blocks[0].styleBindings;
  assert.equal(resolveNative44Styles(absent).receipts[0].action, 'unresolved');
  const missing = fixture(); missing.program.blocks[0].styleBindings![0].sourceFactId = 'not-observed';
  assert.throws(() => resolveNative44Styles(missing), /source_binding/);
  for (const selector of [' + body', ' .button, body', ':has(body)', ' #other']) {
    const unsafe = fixture(); unsafe.program.blocks[0].styleBindings![0].selector = selector;
    assert.throws(() => resolveNative44Styles(unsafe), /selector/);
  }
});

test('unsupported properties remain explicit and legacy programs are not migrated', () => {
  const input = fixture();
  input.program.blocks[0].styleBindings![0].properties.push('animation-name');
  assert.ok(resolveNative44Styles(input).receipts.some(row => row.property === 'animation-name' && row.action === 'unresolved'));
  delete input.program.styleResolutionVersion;
  const result = resolveNative44Styles(input);
  assert.deepEqual(result.program, input.program);
  assert.equal(result.css, input.css);
  assert.deepEqual(result.receipts, []);
});

test('owned exact rules are replaced; shorthand ambiguity preserves input instead of deleting unrelated declarations', () => {
  const input = fixture(), root = native44ModuleClass('button');
  input.css = `@media(min-width:769px) and (max-width:10000px){:page .${root} .button{color:red;border:0}:page .${root} .label{color:blue}}`;
  const result = resolveNative44Styles(input);
  assert.equal(result.css.includes('color:red'), false);
  assert.ok(result.css.includes('.label{color:blue}'));
  const shorthand = fixture();
  shorthand.program.blocks[0].styleBindings = [{ sourceFactId: 'normal', selector: ' .button', minWidth: 769, maxWidth: 10000, properties: ['background-color'] }];
  shorthand.css = `:page .${root} .button{background:red;color:white}`;
  const pending = resolveNative44Styles(shorthand);
  assert.ok(pending.receipts.some(row => row.action === 'unresolved'));
  assert.ok(pending.css.includes('background:red'));
});

test('pixel sliders use registered native value shape; width-specific mobile differences stay scoped', () => {
  const input = fixture();
  input.schemas.button.controls.size = { type: 'slider', selectors: { '{{WRAPPER}} .button': 'font-size: {{SIZE}}{{UNIT}};' } };
  (input.knowledge.controlsByWidget.button as Set<string>).add('size');
  input.program.blocks[0].styleBindings = [{ sourceFactId: 'normal', selector: ' .button', minWidth: 769, maxWidth: 10000, properties: ['font-size'] }, { sourceFactId: 'phone', selector: ' .button', minWidth: 1, maxWidth: 410, properties: ['font-size'] }];
  const result = resolveNative44Styles(input);
  assert.deepEqual((result.program.blocks[0] as any).widgetSettings.size, { size: 18, unit: 'px' });
  assert.equal(result.receipts[1].action, 'scoped-css');
});

test('parent insets are source facts, not accumulated child offsets', () => {
  const input = fixture();
  input.source.facts.normal.value = { padding: [20, 12, 20, 12], margin: [0, 0, 30, 0] };
  input.source.facts.normal.kind = 'layout';
  input.program.blocks[0].styleBindings = [{ sourceFactId: 'normal', selector: '', minWidth: 769, maxWidth: 10000, properties: ['padding-top', 'margin-bottom'] }];
  const collected = collectStyleRequirements(input.program, input.source);
  assert.deepEqual(collected.requirements[0].values, { 'padding-top': '20px', 'margin-bottom': '30px' });
});

test('a complete four-edge inset is applied to one native dimensions control instead of four CSS patches', () => {
  const input = fixture();
  input.source.facts.normal.kind = 'layout';
  input.source.facts.normal.value = { padding: [20, 12, 20, 12] };
  input.program.blocks[0].styleBindings = [{ sourceFactId: 'normal', selector: ' .button', minWidth: 769, maxWidth: 10000, properties: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] }];
  input.schemas.button.controls.inset = { type: 'dimensions', selectors: { '{{WRAPPER}} .button': 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' } };
  (input.knowledge.controlsByWidget.button as Set<string>).add('inset');
  const result = resolveNative44Styles(input);
  assert.ok(result.receipts.every(row => row.action === 'native-setting' && row.controlId === 'inset'));
  assert.deepEqual((result.program.blocks[0] as any).widgetSettings.inset, { unit: 'px', isLinked: false, top: '20', right: '12', bottom: '20', left: '12' });
  assert.equal(result.css, '');
});

test('actual local rendering replaces defaults across four widths and observes selected, hover, focus and rule provenance without private values', async () => {
  const input = fixture(), root = native44ModuleClass('button');
  input.schemas.button.controls = {};
  input.program.blocks[0].styleBindings!.push({ sourceFactId: 'hover', selector: ' .button[aria-selected="true"]', minWidth: 1, maxWidth: 10000, properties: ['background-color'] });
  const resolved = resolveNative44Styles(input), observer = await readFile('D:/cloneWP/src/native44/style-observation.browser.js', 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><style>.page .elementor-element.elementor-element-fixture .button{background:green;color:red;width:280px;font:16px Arial} .label{color:blue} ${resolved.css.replaceAll(':page', '.page')}</style><main class="page"><div class="elementor-element elementor-element-fixture ${root}"><button class="button" aria-selected="false">Contact</button><span class="label">Label</span><input value="PRIVATE"></div></main>`);
    for (const width of [1920, 1440, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 800);
      const before = await page.locator('.button').evaluate(element => ({ color: getComputedStyle(element).color, width: getComputedStyle(element).width }));
      assert.equal(before.color, width < 769 ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)');
      assert.equal(width < 769 ? Number.parseFloat(before.width) > 280 : before.width === '160px', true);
      assert.equal(await page.locator('.label').evaluate(element => getComputedStyle(element).color), 'rgb(0, 0, 255)');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.button').hover();
    assert.equal(await page.locator('.button').evaluate(element => getComputedStyle(element).color), 'rgb(0, 0, 0)');
    await page.locator('.button').evaluate(element => element.setAttribute('aria-selected', 'true'));
    await page.locator('.button').focus();
    await page.locator('.button').hover();
    const observation = await page.evaluate(`${observer};observeNative44Styles([{selector:'.button',properties:['color','background-color','width']}])`) as any;
    assert.equal(observation.targets[0].computed['background-color'], 'rgb(255, 221, 0)');
    assert.equal(observation.targets[0].states.hover, true);
    assert.equal(observation.targets[0].states.focus, true);
    assert.equal(observation.targets[0].states.selected, 'true');
    assert.ok(observation.targets[0].matchingRules.length > 0);
    assert.equal(observation.targets[0].winningDeclarationVerified, false);
    assert.equal(JSON.stringify(observation).includes('PRIVATE'), false);
    assert.equal(observation.remoteWrites, 0);
  } finally { await browser.close(); }
});

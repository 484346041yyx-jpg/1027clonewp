import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadNative44Knowledge, toNative44CompilerKnowledge, type Native44Control } from '../src/native44/knowledge.js';
import { expandedNative44Controls, solveNative44Settings } from '../src/native44/settings.js';
import { resolveNative44Styles, type Native44StyleSetting } from '../src/native44/style-resolution.js';
import { nativeStyleRegisteredControl } from '../src/native44/native-style-effects.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { walkNative44 } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import type { Native44Component, Native44CompileOptions, Native44Program } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';

const widths = [1920, 1440, 390, 430];
const copy = 'Native component settings preserve the complete sentence and the same word wrapping across every measured width.';
const full = { minWidth: 1, maxWidth: 10000 }, phone = { minWidth: 1, maxWidth: 768 };

function nativePlan(controlId: string, value: unknown, owner: string, mobile = false): Native44StyleSetting {
  return { controlId, value, ...(mobile ? phone : full), sourceFactIds: [`${mobile ? 'phone-390' : 'desktop-1440'}:${owner}`], reason: 'Synthetic local rendering fixture: use the researched native setting for the observed visual state.' };
}

async function renderFixture() {
  const loaded = await loadNative44Knowledge(['container', 'button', 'nested-tabs']);
  const schemas: Record<string, LegacySchema> = {};
  for (const [type, component] of Object.entries(loaded.components)) {
    const controls: LegacySchema['controls'] = {};
    for (const [controlId, control] of expandedNative44Controls(component.controls)) {
      const parent = component.controls.find(candidate => candidate.responsive && ['mobile', 'tablet'].some(device => controlId === candidate.id + '_' + device));
      const domain = control.valueDomain ?? {};
      controls[controlId] = nativeStyleRegisteredControl(control, {
        type: control.type!, ...(control.defaultValue !== undefined ? { default: control.defaultValue } : {}),
        ...(domain.options?.length ? { options: Object.fromEntries(domain.options.map(option => [String(option.value), option.label ?? String(option.value)])) } : {}),
        ...Object.fromEntries(['size_units', 'range', 'min', 'max', 'step', 'multiple'].filter(name => domain[name] !== undefined).map(name => [name, domain[name]])),
        ...(control.responsive ? { responsive: { max: 'desktop' } } : parent ? { responsive: { max: controlId.endsWith('_mobile') ? 'mobile' : 'tablet' } } : {}),
      });
    }
    schemas[type] = { type, class: 'SyntheticRegistrationFromResearchedNativeControl', controls };
  }
  const snapshots = widths.map(width => ({ id: width > 768 ? 'desktop-' + width : 'phone-' + width, viewport: { width, height: 1000 } }));
  const source = { snapshots, facts: Object.fromEntries(snapshots.flatMap(snapshot => ['layout', 'button', 'tabs'].map(owner => {
    const id = snapshot.id + ':' + owner;
    return [id, { id, snapshotId: snapshot.id, nodeId: owner, kind: 'text', value: { text: copy, style: { color: '#ffffff' } } }];
  }))) } as unknown as SourceFactsV2;
  const sourceIds = (owner: string) => snapshots.map(snapshot => snapshot.id + ':' + owner);
  const button: Native44Component = { kind: 'native', key: 'fixture_button', widgetType: 'button', sourceFactIds: sourceIds('button'), widgetSettings: { text: copy }, nativeStyleSettings: [
    nativePlan('typography_typography', 'custom', 'button'), nativePlan('typography_font_family', 'Arial', 'button'),
    nativePlan('typography_font_size', { size: 18, unit: 'px' }, 'button'), nativePlan('typography_font_size_mobile', { size: 16, unit: 'px' }, 'button', true),
    nativePlan('text_padding', { top: '16', right: '24', bottom: '16', left: '24', unit: 'px', isLinked: false }, 'button'),
    nativePlan('text_padding_mobile', { top: '8', right: '12', bottom: '8', left: '12', unit: 'px', isLinked: false }, 'button', true),
    nativePlan('button_text_color', '#ffffff', 'button'), nativePlan('hover_color', '#000000', 'button'), nativePlan('align', 'justify', 'button'),
  ] };
  const tabs: Native44Component = { kind: 'native', key: 'fixture_tabs', widgetType: 'nested-tabs', sourceFactIds: sourceIds('tabs'), widgetSettings: {}, nativeStyleSettings: [
    nativePlan('title_text_color', '#333333', 'tabs'), nativePlan('title_text_color_active', '#cc9900', 'tabs'), nativePlan('title_text_color_hover', '#006699', 'tabs'),
  ] };
  const root: Native44Component = { kind: 'composite', key: 'fixture_layout', sourceFactIds: sourceIds('layout'), settings: {}, children: [button, tabs], nativeStyleSettings: [
    nativePlan('container_type', 'flex', 'layout'), nativePlan('content_width', 'full', 'layout'),
    nativePlan('width', { size: 700, unit: 'px' }, 'layout'), nativePlan('width_mobile', { size: 100, unit: '%' }, 'layout', true),
    nativePlan('flex_direction', 'row', 'layout'), nativePlan('flex_direction_mobile', 'column', 'layout', true),
  ] };
  const program = { styleResolutionVersion: 2, blocks: [root] } as unknown as Native44Program;
  const knowledge = toNative44CompilerKnowledge(loaded, schemas);
  for (const node of walkNative44(program.blocks)) {
    const type = node.kind === 'composite' ? 'container' : 'widgetType' in node ? node.widgetType : 'html';
    const nativeValues = Object.fromEntries((node.nativeStyleSettings ?? []).map(setting => [setting.controlId, setting.value]));
    assert.doesNotThrow(() => knowledge.validateSettings(type, { ...(node.kind === 'composite' ? node.settings : 'widgetSettings' in node ? node.widgetSettings : {}), ...nativeValues }), type);
  }
  const result = resolveNative44Styles({ program, source, schemas, knowledge, css: '', mobileMaxWidth: 768 });
  return { result, schemas, program };
}

function generatedNativeCSS(result: Awaited<ReturnType<typeof renderFixture>>['result']): string {
  return result.receipts.filter(receipt => receipt.action === 'native-setting').flatMap(receipt => (receipt.generatedEffects ?? []).map(effect => `@media(min-width:${receipt.minWidth}px) and (max-width:${receipt.maxWidth}px){.target ${effect.selector}{${effect.property}:${effect.value}}}`)).join('');
}

test('v2 researched native settings render layout, wrapping, padding and real normal hover focus selected states at four local widths', async () => {
  const fixture = await renderFixture(), { result } = fixture;
  assert.equal(result.css, '');
  assert.equal(result.renderedVerified, false);
  const intents = fixture.program.blocks[0].nativeStyleSettings!.length + (fixture.program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children.reduce((count, child) => count + child.nativeStyleSettings!.length, 0);
  assert.equal(result.receipts.filter(receipt => receipt.action === 'native-setting').length, intents, JSON.stringify(result.receipts.filter(receipt => receipt.property.startsWith('setting:'))));
  const layout = native44ModuleClass('fixture_layout'), button = native44ModuleClass('fixture_button'), tabs = native44ModuleClass('fixture_tabs');
  const componentDOM = `<section class="fixture-layout ${layout}"><div class="fixture-button elementor-align-justify ${button}"><button class="elementor-button"><span class="elementor-button-text">${copy}</span></button></div><div class="fixture-tabs ${tabs}"><div class="e-n-tabs" data-touch-mode="false"><div class="e-n-tabs-heading"><button class="e-n-tab-title" aria-selected="false">Overview</button><button class="e-n-tab-title" aria-selected="true">Details</button></div></div></div></section>`;
  const baseCSS = `body{margin:0}.fixture-layout{display:var(--display,flex);flex-direction:var(--flex-direction,row);width:var(--width,700px);gap:20px;align-items:flex-start}.fixture-layout>div{flex:1;min-width:0}.fixture-button button{box-sizing:border-box;display:inline-block;line-height:1.4;white-space:normal;border:0;background:#777}.elementor-align-justify .elementor-button{width:100%}.e-n-tab-title{color:var(--n-tabs-title-color);font:16px Arial}.e-n-tab-title[aria-selected=true]{color:var(--n-tabs-title-color-active)}.e-n-tabs[data-touch-mode=false] .e-n-tab-title[aria-selected=false]:hover{color:var(--n-tabs-title-color-hover,var(--n-tabs-title-color))}`;
  const referenceCSS = `.reference .fixture-layout{width:700px;flex-direction:row}.reference .elementor-button{font:18px/1.4 Arial,sans-serif;padding:16px 24px;color:#fff;fill:#fff}.reference .elementor-button:hover,.reference .elementor-button:focus{color:#000}.reference .fixture-tabs{--n-tabs-title-color:#333;--n-tabs-title-color-active:#c90;--n-tabs-title-color-hover:#069}@media(max-width:768px){.reference .fixture-layout{width:100%;flex-direction:column}.reference .elementor-button{font-size:16px;padding:8px 12px}.fixture-layout>div{width:100%}}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(`<!doctype html><title>Local v2 native style fixture, not remote widget acceptance</title><script>globalThis.__name=target=>target;</script><style>${baseCSS}${referenceCSS}${generatedNativeCSS(result)}</style><main class="reference">${componentDOM}</main><main class="target">${componentDOM}</main>`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.querySelectorAll('.e-n-tab-title').forEach(tab => tab.addEventListener('click', () => { tab.parentElement!.querySelectorAll('.e-n-tab-title').forEach(sibling => sibling.setAttribute('aria-selected', String(sibling === tab))); }));
      });
      await page.mouse.move(width - 1, 999);
      const comparison = await page.evaluate(() => {
        const measure = (scope: string) => {
          const root = document.querySelector(scope)!, layout = root.querySelector('.fixture-layout')!, button = root.querySelector('.elementor-button')!, label = root.querySelector('.elementor-button-text')!;
          const text = label.firstChild!, lines = new Map<number, string>();
          for (let index = 0; index < text.textContent!.length; index++) {
            const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 1);
            const rect = range.getBoundingClientRect(), top = Math.round(rect.top - label.getBoundingClientRect().top);
            lines.set(top, (lines.get(top) ?? '') + text.textContent![index]);
          }
          const style = getComputedStyle(button);
          return { width: layout.getBoundingClientRect().width, direction: getComputedStyle(layout).flexDirection, fontSize: style.fontSize, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], color: style.color, lines: [...lines.values()].map(line => line.trim()) };
        };
        return { reference: measure('.reference'), target: measure('.target') };
      });
      assert.deepEqual(comparison.target, comparison.reference, `viewport ${width}: ${JSON.stringify(comparison)}`);
      assert.ok(comparison.target.lines.length > 1);
      await page.locator('.target .elementor-button').hover();
      assert.equal(await page.locator('.target .elementor-button').evaluate(element => getComputedStyle(element).color), 'rgb(0, 0, 0)');
      await page.mouse.move(width - 1, 999); await page.locator('.target .elementor-button').focus();
      assert.equal(await page.locator('.target .elementor-button').evaluate(element => getComputedStyle(element).color), 'rgb(0, 0, 0)');
      await page.locator('.target .elementor-button').evaluate(element => (element as HTMLElement).blur());
      assert.equal(await page.locator('.target .e-n-tab-title').first().evaluate(element => getComputedStyle(element).color), 'rgb(51, 51, 51)');
      await page.locator('.target .e-n-tab-title').first().hover();
      assert.equal(await page.locator('.target .e-n-tab-title').first().evaluate(element => getComputedStyle(element).color), 'rgb(0, 102, 153)');
      await page.locator('.target .e-n-tab-title').first().click();
      assert.equal(await page.locator('.target .e-n-tab-title').first().getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.target .e-n-tab-title').first().evaluate(element => getComputedStyle(element).color), 'rgb(204, 153, 0)');
    }
  } finally { await browser.close(); }
});

function variableFixture(direct: boolean, consumerSelector = '.elementor-widget-button .label') {
  const control: Native44Control = { id: 'ink', type: 'color', panel: { tab: 'style' }, effectTargets: { selectors: { '{{WRAPPER}}': '--fixture-ink: {{VALUE}};' } } };
  const schema: LegacySchema = { type: 'button', class: 'SyntheticVariableConsumer', controls: { ink: { type: 'color', selectors: { '{{WRAPPER}}': '--fixture-ink: {{VALUE}};' } } } };
  const source = { snapshots: [{ id: 'desktop', viewport: { width: 1440, height: 1000 } }], facts: { normal: { id: 'normal', snapshotId: 'desktop', nodeId: 'label', kind: 'text', value: { style: { color: '#ffffff' } } } } } as unknown as SourceFactsV2;
  const program = { styleResolutionVersion: 2, blocks: [{ kind: 'native', widgetType: 'button', key: 'variable', sourceFactIds: ['normal'], widgetSettings: {}, styleBindings: [{ sourceFactId: 'normal', selector: ' .label', properties: ['color'], minWidth: 769, maxWidth: 10000 }] }] } as unknown as Native44Program;
  const knowledge: Native44CompileOptions['knowledge'] = { fingerprint: 'a'.repeat(64), controlsByWidget: { button: new Set(['ink']) }, styleControlsByWidget: { button: [control] }, styleVariableConsumers: [{ variable: '--fixture-ink', selector: consumerSelector, property: 'color', value: direct ? 'var(--fixture-ink)' : 'color-mix(in srgb,var(--fixture-ink),black)', direct, atRules: [], packageId: 'local-fixture', packageSha256: 'b'.repeat(64), entry: 'local-fixture/frontend.css', sourceSha256: 'c'.repeat(64) }], validateSettings: (_type, values) => {
    const solved = solveNative44Settings({ componentType: 'button', controls: [control] }, values); if (!solved.ok) throw Error('fixture_setting_invalid'); return solved.settings;
  } };
  knowledge.styleWrapperClassesByWidget = { button: [{ className: 'elementor-widget-button', method: 'get_html_wrapper_class', symbol: 'SyntheticVariableConsumer', expression: 'literal-return', packageId: 'local-fixture', packageSha256: 'b'.repeat(64), entry: 'local-fixture/button.php', sourceSha256: 'd'.repeat(64), inheritance: [] }] };
  return { program, source, schemas: { button: schema }, knowledge, css: '', mobileMaxWidth: 768 };
}

test('v2 direct variable consumer mapping requires the exact evidenced widget subpart', () => {
  const input = variableFixture(true), result = resolveNative44Styles(input);
  assert.ok(result.receipts.some(receipt => receipt.action === 'native-setting' && receipt.controlId === 'ink'));
  assert.equal(result.css, '');
  const wrongSubpart = resolveNative44Styles(variableFixture(true, '.elementor-widget-button .other'));
  assert.equal(wrongSubpart.receipts.some(receipt => receipt.action === 'native-setting'), false);
  const unprovenWrapper = variableFixture(true); delete unprovenWrapper.knowledge.styleWrapperClassesByWidget;
  assert.equal(resolveNative44Styles(unprovenWrapper).receipts.some(receipt => receipt.action === 'native-setting'), false);
});

test('v2 never reverses a calculated variable consumer into a guessed native input', () => {
  const input = variableFixture(false);
  const control = input.knowledge.styleControlsByWidget!.button[0];
  control.type = 'slider'; control.effectTargets = { selectors: { '{{WRAPPER}}': '--fixture-ink: {{SIZE}}{{UNIT}};' } };
  input.schemas.button.controls.ink = { type: 'slider', selectors: { '{{WRAPPER}}': '--fixture-ink: {{SIZE}}{{UNIT}};' } };
  input.source.facts.normal.value.style = { width: '160px' };
  input.program.blocks[0].styleBindings![0].properties = ['width'];
  input.knowledge.styleVariableConsumers![0].property = 'width'; input.knowledge.styleVariableConsumers![0].value = 'calc(var(--fixture-ink) + 2px)';
  const result = resolveNative44Styles(input);
  assert.equal(result.receipts.some(receipt => receipt.action === 'native-setting'), false);
  assert.equal((result.program.blocks[0] as Extract<Native44Component, { kind: 'native' }>).widgetSettings.ink, undefined);
});

test('v2 retains an explicit native variable plan as unverified without stacking a compensating CSS patch', () => {
  const input = variableFixture(false);
  input.program.blocks[0].nativeStyleSettings = [{ controlId: 'ink', value: '#ffffff', minWidth: 769, maxWidth: 10000, sourceFactIds: ['normal'], reason: 'Explicit source-bound variable setting; no direct consumer rendering proof yet.' }];
  const result = resolveNative44Styles(input);
  assert.equal((result.program.blocks[0] as Extract<Native44Component, { kind: 'native' }>).widgetSettings.ink, '#ffffff');
  assert.equal(result.css, '');
  assert.ok(result.receipts.some(receipt => receipt.action === 'unresolved' && receipt.property === 'color'));
  assert.equal(result.renderedVerified, false);
});

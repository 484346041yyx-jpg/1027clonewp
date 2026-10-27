import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { validateHeaderModulePlan, type HeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import { compileHeaderHoverCSS } from '../src/woodmart-header/generic/hover-effects.js';
import { compileHeaderModuleStyles } from '../src/woodmart-header/generic/styles.js';

function plan(): HeaderModulePlan {
  return {
    kind: 'clonewp-header-module', version: 1, moduleKey: 'studio', targetOrigin: 'https://target.example',
    owner: { ownerId: 'clonewp', runId: 'studio-run' }, name: 'Studio header',
    menus: [{ key: 'main', name: 'Main navigation', items: [
      { key: 'home', parentKey: null, title: 'Home', url: '/' },
      { key: 'products', parentKey: null, title: 'Products', url: '/products/' },
      { key: 'child', parentKey: 'products', title: 'Child', url: '/products/child/' },
    ] }],
    layout: { rows: [{ slot: 'general-header', params: {}, columns: {
      left: [], center: [{ key: 'navigation', type: 'mainmenu', menuKey: 'main', params: {}, hoverEffects: [{
        target: 'label-after', normal: { width: '100%', height: '1px', left: '0', bottom: '-4px', background: 'currentColor', opacity: '0', transform: 'translateY(-4px)', transition: 'opacity 160ms ease, transform 160ms ease' },
        hover: { opacity: '1', transform: 'translateY(0)' }, current: { opacity: '1', transform: 'translateY(0)' }, currentItemKey: 'home',
      }] }], right: [],
    } }], settings: {} }, style: { css: '', fonts: [] },
  };
}

test('menu states compile into an isolated native header stylesheet', () => {
  const input = validateHeaderModulePlan(plan());
  assert.ok(Object.isFrozen(input.layout.rows[0].columns.center[0].hoverEffects));
  const css = compileHeaderHoverCSS(input, key => key);
  const compiled = compileHeaderModuleStyles({ css, fonts: [] }, { moduleKey: 'studio', headerId: 'header_123' }).css;
  assert.match(compiled, /\.whb-header_123 \.whb-navigation \.wd-nav-main>li>a>\.nav-link-text::after\{content:""/);
  assert.match(compiled, /li:hover>a>\.nav-link-text::after,\.whb-header_123 \.whb-navigation \.wd-nav-main>li:focus-within/);
  assert.match(compiled, /current-menu-item/);
  assert.match(compiled, /href="https:\/\/target\.example\/"/);
  const legacy = plan(); delete legacy.layout.rows[0].columns.center[0].hoverEffects;
  assert.equal(compileHeaderHoverCSS(validateHeaderModulePlan(legacy), key => key), '');
});

test('hover configurations reject unsupported placement, duplicate targets and unsafe values', () => {
  const mutate = [
    (input: HeaderModulePlan) => { input.layout.rows[0].columns.center[0].type = 'search'; },
    (input: HeaderModulePlan) => { input.layout.rows[0].columns.center[0].hoverEffects!.push(structuredClone(input.layout.rows[0].columns.center[0].hoverEffects![0])); },
    (input: HeaderModulePlan) => { input.layout.rows[0].columns.center[0].hoverEffects![0].normal.content = '"Injected"'; },
    (input: HeaderModulePlan) => { input.layout.rows[0].columns.center[0].hoverEffects![0].normal.opacity = '0; color:red'; },
    (input: HeaderModulePlan) => { input.layout.rows[0].columns.center[0].hoverEffects![0].currentItemKey = 'child'; },
    (input: HeaderModulePlan) => { input.layout.rows[0].columns.center[0].hoverEffects![0].hover = { ...input.layout.rows[0].columns.center[0].hoverEffects![0].normal }; },
  ];
  for (const change of mutate) { const input = plan(); change(input); assert.throws(() => validateHeaderModulePlan(input)); }
});

test('Chromium: menu underline appears on hover and focus, then restores without changing another header', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><header class="whb-header_123"><div class="whb-navigation"><ul class="wd-nav-main"><li><a href="https://target.example/"><span class="nav-link-text">Home</span></a></li><li><a href="https://target.example/products/"><span class="nav-link-text">Products</span></a></li></ul></div></header><header class="whb-header_456"><div class="whb-navigation"><ul class="wd-nav-main"><li><a><span class="nav-link-text">Other</span></a></li></ul></div></header>');
    const input = validateHeaderModulePlan(plan());
    const css = compileHeaderModuleStyles({ css: compileHeaderHoverCSS(input, key => key), fonts: [] }, { moduleKey: 'studio', headerId: 'header_123' }).css;
    await page.addStyleTag({ content: css + '.whb-header_123 .nav-link-text::after{transition:none!important}' });
    const opacity = async (selector: string) => page.locator(selector).evaluate(element => getComputedStyle(element, '::after').opacity);
    const product = '.whb-header_123 li:nth-child(2) .nav-link-text';
    assert.equal(await opacity(product), '0');
    await page.locator('.whb-header_123 li:nth-child(2) a').hover();
    assert.equal(await opacity(product), '1');
    await page.mouse.move(0, 0);
    assert.equal(await opacity(product), '0');
    await page.locator('.whb-header_123 li:nth-child(2) a').focus();
    assert.equal(await opacity(product), '1');
    assert.equal(await opacity('.whb-header_123 li:first-child .nav-link-text'), '1');
    assert.equal(await opacity('.whb-header_456 .nav-link-text'), '1');
  } finally { await browser.close(); }
});

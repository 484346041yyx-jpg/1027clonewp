import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { consolidateNative44CSS } from '../src/native44/consolidate-css.js';

test('CSS cleanup preserves competing selectors, shorthand order, importance and media boundaries in a real browser', async () => {
  const original = `@media(min-width:1025px){.a{padding:4px!important;color:red!important;width:10px!important}}
    @media(min-width:1025px){.a.b{padding-left:8px!important;color:green!important}.a{padding-left:12px!important;width:20px!important;color:blue}.a{height:30px!important}}
    @media(min-width:1440px){.a{width:40px!important}}`;
  const result = consolidateNative44CSS(original);
  assert.ok(result.after.rules <= result.before.rules);
  assert.equal(consolidateNative44CSS(result.css).css, result.css);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [1100, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const inspect = async (sheet: string) => {
        await page.setContent(`<style>${sheet}</style><div class="a b">example</div>`);
        return page.locator('div').evaluate(node => { const s = getComputedStyle(node); return [s.padding, s.width, s.height, s.color]; });
      };
      assert.deepEqual(await inspect(result.css), await inspect(original));
    }
  } finally { await browser.close(); }
});

test('CSS cleanup retains unsupported fallbacks and font assets, removes superseded exact properties, and is idempotent', () => {
  const result = consolidateNative44CSS('@font-face{font-family:x;src:url("https://example.test/font.woff2")} @media(min-width:1025px){.a{color:red!important;display:block}.a{color:blue!important;display:future-layout;width:10px}.a{height:20px}}');
  assert.match(result.css, /font\.woff2/);
  assert.match(result.css, /color:red/);
  assert.match(result.css, /display:block/);
  assert.match(result.css, /display:future-layout/);
  assert.equal(consolidateNative44CSS(result.css).css, result.css);
  assert.throws(() => consolidateNative44CSS('.a{.b{color:red}}'), /nested CSS/);
});

test('cleanup preserves physical/logical aliases, gap shorthands and grammar-valid unsupported fallbacks', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const sheet of ['.a{width:10px}.b{inline-size:20px}.a{height:30px}', '.a{gap:10px}.b{column-gap:20px}.a{height:30px}', '.a{display:flex;display:run-in}', '.a{color:red;color:device-cmyk(0 0 0 0)}']) {
      const inspect = async (value: string) => {
        await page.setContent(`<style>${value}</style><div class="a b">example</div>`);
        return page.locator('div').evaluate(node => { const s = getComputedStyle(node); return [s.width, s.height, s.gap, s.display, s.color]; });
      };
      assert.deepEqual(await inspect(consolidateNative44CSS(sheet).css), await inspect(sheet));
    }
  } finally { await browser.close(); }
});

test('module grouping requires unique independent owners from the actual saved tree', () => {
  const modules = [{ key: 'hero', className: 'cwp-hero' }, { key: 'footer', className: 'cwp-footer' }];
  const elements = modules.map(module => ({ settings: { css_classes: module.className }, elements: [] }));
  const result = consolidateNative44CSS('.elementor-42 .cwp-hero{color:red}.elementor-42 .cwp-footer{color:black}.elementor-42 .cwp-hero{width:10px}', { modules, elements });
  assert.equal(result.after.rules, 2);
  assert.match(result.css, /\/\* hero \*\//);
  assert.throws(() => consolidateNative44CSS(result.css, { modules, elements: [elements[0], elements[0], elements[1]] }), /duplicated/);
  assert.throws(() => consolidateNative44CSS(result.css, { modules, elements: [{ ...elements[0], elements: [elements[1]] }] }), /overlap/);
});

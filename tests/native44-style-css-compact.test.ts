import test from 'node:test';
import assert from 'node:assert/strict';
import * as css from 'css-tree';
import { chromium } from 'playwright';
import { compactAdjacentNativeStyleCSS } from '../src/native44/style-css-compact.js';

function declarations(input: string): unknown[] {
  const ast = css.parse(input, { parseCustomProperty: true });
  const result: unknown[] = [];
  const visit = (node: css.CssNode, scope: string[]) => {
    if (node.type === 'StyleSheet' || node.type === 'Block') node.children.forEach(child => visit(child, scope));
    else if (node.type === 'Atrule' && node.block) visit(node.block, [...scope, `@${node.name} ${node.prelude ? css.generate(node.prelude) : ''}`]);
    else if (node.type === 'Rule') visit(node.block, [...scope, css.generate(node.prelude)]);
    else if (node.type === 'Declaration') result.push({ scope, property: node.property, value: css.generate(node.value), important: node.important });
  };
  visit(ast, []);
  return result;
}

test('adjacent media and identical selectors compact without dropping duplicate or important declarations', () => {
  const input = '@media(max-width:768px){.box{color:red;color:blue!important}}@media(max-width:768px){.box{color:green;padding:2px}.other{color:black}}';
  const result = compactAdjacentNativeStyleCSS(input);
  assert.equal(result, '@media (max-width:768px){.box{color:red;color:blue!important;color:green;padding:2px}.other{color:black}}');
  assert.deepEqual(declarations(result), declarations(input));
});

test('compaction never moves declarations past interleaved selectors, conditional rules, or different width ranges', () => {
  const input = '.box{color:red}.other{color:black}.box{color:blue}@media(max-width:410px){.box{font-size:20px}}@supports(display:grid){.box{display:grid}}@media(max-width:410px){.box{line-height:24px}}@media(min-width:411px) and (max-width:768px){.box{font-size:24px;line-height:28.8px}}';
  const result = compactAdjacentNativeStyleCSS(input);
  assert.deepEqual(declarations(result), declarations(input));
  assert.match(result, /^\.box\{color:red\}\.other\{color:black\}\.box\{color:blue\}/);
  const ast = css.parse(result);
  assert.equal(ast.type === 'StyleSheet' && ast.children.toArray().filter(node => node.type === 'Atrule' && node.name === 'media').length, 3);
});

test('font faces and non-media at-rules remain separate and nested media preserve the complete declaration sequence', () => {
  const input = '@font-face{font-family:First;src:local(Arial)}@font-face{font-family:First;font-weight:700;src:local(Arial)}@media(min-width:1px){@media(max-width:410px){.box{color:red}}}@media(min-width:1px){@media(max-width:410px){.box{color:blue!important}}}@keyframes pulse{from{opacity:0}to{opacity:1}}';
  const result = compactAdjacentNativeStyleCSS(input);
  assert.deepEqual(declarations(result), declarations(input));
  const ast = css.parse(result);
  assert.equal(ast.type === 'StyleSheet' && ast.children.toArray().filter(node => node.type === 'Atrule' && node.name === 'font-face').length, 2);
  assert.match(result, /@keyframes pulse\{from\{opacity:0\}to\{opacity:1\}\}/);
});

test('large adjacent source-bound property output becomes smaller without removing any source declaration', () => {
  const input = Array.from({ length: 2000 }, (_, index) => `@media(min-width:411px) and (max-width:768px){.owned.owned.owned .heading{letter-spacing:${index % 4}px}}`).join('');
  const result = compactAdjacentNativeStyleCSS(input);
  assert.ok(Buffer.byteLength(result) < Buffer.byteLength(input) / 3);
  assert.equal(declarations(result).length, 2000);
  assert.deepEqual(declarations(result), declarations(input));
  assert.equal(compactAdjacentNativeStyleCSS(result), result);
});

test('browser computed layout and hover focus states remain identical at two desktop and two phone widths', async () => {
  const source = '.box{display:flex;gap:12px;padding:10px}.box{border:2px solid black;--ink:purple;color:var(--ink)}.box:hover{color:orange!important}.box:hover{color:green}.other{width:40px;height:20px}.box{background:white}.box:focus{outline:3px solid blue}.box::before{content:"Icon";font-size:12px}@media(min-width:1px) and (max-width:410px){.box{font-size:20px}}@media(min-width:1px) and (max-width:410px){.box{line-height:24px}}@media(min-width:411px) and (max-width:768px){.box{font-size:24px}}@media(min-width:411px) and (max-width:768px){.box{line-height:28.8px}}@media(min-width:769px){.box{font-size:36px}}@media(min-width:769px){.box{line-height:43.2px}}@media(min-width:769px){.other{margin-left:4px}.box{padding-right:20px}}';
  const compact = compactAdjacentNativeStyleCSS(source);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [1920, 1440, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent('<!doctype html><script>globalThis.__name=target=>target;</script><style id="owned"></style><button class="box">Complete text wrapping <span class="other">Inside</span></button>');
      const sample = async (stylesheet: string) => {
        await page.evaluate(stylesheet => { document.querySelector('#owned')!.textContent = stylesheet; }, stylesheet);
        return page.evaluate(() => [...document.querySelectorAll('.box,.other')].map(element => {
          const style = getComputedStyle(element), before = getComputedStyle(element, '::before'), rect = element.getBoundingClientRect();
          return { color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding, gap: style.gap, background: style.backgroundColor, border: style.border, outline: style.outline, before: { content: before.content, fontSize: before.fontSize }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        }));
      };
      await page.mouse.move(width - 1, 899);
      assert.deepEqual(await sample(compact), await sample(source), `normal ${width}`);
      await page.locator('.box').hover();
      assert.deepEqual(await sample(compact), await sample(source), `hover ${width}`);
      await page.locator('.box').focus();
      assert.deepEqual(await sample(compact), await sample(source), `focus ${width}`);
    }
  } finally { await browser.close(); }
});

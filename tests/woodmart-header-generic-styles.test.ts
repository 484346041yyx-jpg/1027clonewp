import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { compileHeaderModuleStyles, type HeaderModuleFont } from '../src/woodmart-header/generic/styles.js';

const identity = { moduleKey: 'header-test', headerId: 'header_123' };
const compile = (css: string, fonts: HeaderModuleFont[] = []) => compileHeaderModuleStyles({ css, fonts }, identity);

test('each selector is scoped to the native header and conditional/declaration order is retained', () => {
  const result = compile(':header{color:red;color:blue}:header.open > nav,:header a:hover{margin:1px!important}@media (min-width:700px){@supports (display:grid){:header nav{display:grid}}}');
  assert.equal(result.css, '.whb-header_123{color:red;color:blue}.whb-header_123.open>nav,.whb-header_123 a:hover{margin:1px!important}@media (min-width:700px){@supports (display:grid){.whb-header_123 nav{display:grid}}}');
  assert.match(result.styleHash, /^[a-f0-9]{64}$/);
  assert.equal(compile(':header {color:red;}').styleHash, compile(':header{color:red}').styleHash);
  assert.equal(compile(':header>nav a+a{color:red}').css, '.whb-header_123>nav a+a{color:red}');
});

test('comma, sibling, functional and nested selector escapes fail before output', () => {
  for (const css of [
    ':header a,body{color:red}', ':header + main{color:red}', ':header.open~.other{color:red}',
    ':header:is(.active) + nav{color:red}', ':header:has(+ main){color:red}',
    ':header :is(a,html){color:red}', ':header:root{color:red}', ':header:global(body){color:red}',
    ':header{& + main{color:red}}', ':header{@media (min-width:1px){color:red}}',
    ':header{color:red}main{color:blue}', ':header :header{color:red}',
  ]) assert.throws(() => compile(css), /Header module CSS/, css);
});

test('only class-only root descendant states can select the owned header', () => {
  assert.equal(compile(':header:has(.wd-fs-menu-btn.wd-opened) .row{height:57px}').css, '.whb-header_123:has(.wd-fs-menu-btn.wd-opened) .row{height:57px}');
  for (const selector of [':header:has(body)', ':header:has(.x,.y)', ':header:has(.x>.y)', ':header:has(+.other)', ':header:has(:is(.x))', ':header .row:has(.x)', ':header:has(.x)+main']) assert.throws(() => compile(selector+'{height:57px}'), /Header module CSS/);
});

test('HTML breakout, legacy script CSS, global definitions and fake navigation labels fail', () => {
  for (const css of [
    ':header{color:red}</style><script>alert(1)</script>', ':header{content:"Account"}',
    ':header{c\\6f ntent:"fake"}', ':header{behavior:url(https://example.com/a.htc)}',
    ':header{width:expression(alert(1))}', ':header{width:e\\78 pression(alert(1))}',
    '@font-face{font-family:x;src:url(https://example.com/x.woff2)}', '@keyframes x{to{opacity:0}}',
    '@import "https://example.com/a.css";', '@layer other{:header{color:red}}',
    ':header{color:\u0000red}', ':header{color: red;broken}', ':header{--header-font-main:x}',
    ':header{font-family:var(--header-font-missing)}',
  ]) assert.throws(() => compile(css), /Header module CSS/, css);
});

test('empty decorative pseudo-elements are allowed without permitting CSS text labels', () => {
  assert.equal(compile(':header .nav-link-text::after{content:"";opacity:0}').css, '.whb-header_123 .nav-link-text::after{content:"";opacity:0}');
  for (const css of [
    ':header a{content:""}',
    ':header a::after,:header a{content:""}',
    ':header a::after{content:"Sale"}',
    ':header a::after{content:attr(title)}',
  ]) assert.throws(() => compile(css), /property content is forbidden/, css);
});

test('CSS asset URLs and font URLs require HTTPS without embedded credentials', () => {
  assert.match(compile(':header{background:url("https://cdn.example.com/header.png")}').css, /cdn\.example\.com/);
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,abc', 'http://example.com/x', 'https://user:pass@example.com/x', '//example.com/x', '/x', 'https://example.com/<x']) {
    assert.throws(() => compile(`:header{background:url("${url}")}`), /Header module CSS/, url);
    assert.throws(() => compile(`:header{background:image-set("${url}" 1x)}`), /Header module CSS/, url);
    assert.throws(() => compile(':header{color:red}', [{ key: 'main', url, weight: 700, style: 'normal' }]), /Header module CSS/, url);
  }
  assert.throws(() => compile(':header{--asset:"relative.png";background:image-set(var(--asset))}'), /explicit HTTPS/);
  assert.match(compile(':header{background:image-set("https://cdn.example.com/header.png" 1x)}').css, /image-set/);
});

test('fonts use collision-free module/header families and scoped font variables', () => {
  const font: HeaderModuleFont = { key: 'main', url: 'https://cdn.example.com/font.woff2', weight: 700, style: 'normal' };
  const a = compile(':header a{font-family:var(--header-font-main)}', [font]);
  const b = compileHeaderModuleStyles({ css: ':header a{font-family:var(--header-font-main)}', fonts: [font] }, { ...identity, headerId: 'header_456' });
  const c = compileHeaderModuleStyles({ css: '', fonts: [font] }, { ...identity, moduleKey: 'different' });
  assert.notEqual(a.fontFamilies.main, b.fontFamilies.main);
  assert.notEqual(a.fontFamilies.main, c.fontFamilies.main);
  assert.ok(a.css.includes(`.whb-header_123{--header-font-main:"${a.fontFamilies.main}"}`));
  assert.ok(!compile(':header{color:red}').css.includes('@font-face'));
  assert.throws(() => compile('', [font, font]), /unique/);
  assert.throws(() => compile('', [{ ...font, key: '__proto__' }]), /font keys/);
  assert.throws(() => compile('', [{ ...font, weight: 0 }]), /weight/);
  assert.throws(() => compileHeaderModuleStyles({ css: '', fonts: [] }, { ...identity, headerId: 'header_1,body' }), /header ID/);
});

test('malformed conditions, excessive stylesheet size and unsupported definitions fail', () => {
  for (const css of ['@media invalid({:header{color:red}}', '@supports selector(body){:header{color:red}}', ':header{color:red}<!---->', ':header{color:rgb(}']) assert.throws(() => compile(css), /Header module CSS/);
  assert.throws(() => compile(' '.repeat(256 * 1024 + 1)), /input limit/);
  assert.throws(() => compile(':header{color:red}'.repeat(2_001)), /rule limit/);
  assert.throws(() => compile('@media (min-width:1px){'.repeat(9) + ':header{color:red}' + '}'.repeat(9)), /nested too deeply/);
});

test('Chromium fixture: one header module cannot change another header, body or page content', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><style>body{margin:0;color:rgb(1,2,3)}header{height:40px}a{color:inherit}</style><header class="whb-header_123"><nav><a>Owned menu</a><a>Owned next</a></nav></header><header class="whb-header_456"><a>Other menu</a></header><main>Independent page</main>');
    const css = compile(':header{background:rgb(20,30,40);height:90px}:header>nav a+a{color:rgb(90,80,70)}@media (min-width:600px){:header nav{padding:10px}}').css;
    await page.addStyleTag({ content: css });
    assert.deepEqual(await page.evaluate(() => ({
      ownedHeight: document.querySelector('.whb-header_123')!.getBoundingClientRect().height,
      otherHeight: document.querySelector('.whb-header_456')!.getBoundingClientRect().height,
      otherBackground: getComputedStyle(document.querySelector('.whb-header_456')!).backgroundColor,
      mainColor: getComputedStyle(document.querySelector('main')!).color,
      bodyMargin: getComputedStyle(document.body).margin,
      ownedNext: getComputedStyle(document.querySelector('.whb-header_123 a+a')!).color,
    })), { ownedHeight: 90, otherHeight: 40, otherBackground: 'rgba(0, 0, 0, 0)', mainColor: 'rgb(1, 2, 3)', bodyMargin: '0px', ownedNext: 'rgb(90, 80, 70)' });
  } finally { await browser.close(); }
});

test('Chromium fixture: replacing independent module CSS updates only that header across pages', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const owner = await browser.newPage(), unrelated = await browser.newPage();
    const baseline = '<!doctype html><style>header{height:40px}main{padding:13px}</style><header class="whb-header_123"><nav>Menu</nav></header><main>Body content</main>';
    await owner.setContent(baseline);
    await unrelated.setContent(baseline.replace('header_123', 'header_456'));
    const first = compile(':header{height:80px;background:rgb(10,20,30)}').css;
    const edited = compile(':header{height:96px;background:rgb(40,50,60)}').css;
    const style = await owner.addStyleTag({ content: first });
    await unrelated.addStyleTag({ content: edited });
    assert.equal(await owner.locator('header').evaluate(el => el.getBoundingClientRect().height), 80);
    await style.evaluate((el, css) => { el.textContent = css; }, edited);
    assert.equal(await owner.locator('header').evaluate(el => el.getBoundingClientRect().height), 96);
    assert.equal(await unrelated.locator('header').evaluate(el => el.getBoundingClientRect().height), 40);
    assert.equal(await owner.locator('main').evaluate(el => getComputedStyle(el).padding), '13px');
    assert.equal(await unrelated.locator('main').textContent(), 'Body content');
  } finally { await browser.close(); }
});

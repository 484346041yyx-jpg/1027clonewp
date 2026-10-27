import test from 'node:test';
import assert from 'node:assert/strict';
import { modulePlanHash, orderHeaderMenuItems, validateHeaderModulePlan, type HeaderModulePlan } from '../src/woodmart-header/generic/contract.js';

function plan(): HeaderModulePlan {
  return { kind: 'clonewp-header-module', version: 1, moduleKey: 'studio-moss', targetOrigin: 'https://target.example', owner: { ownerId: 'clonewp', runId: 'brand-one' }, name: 'Studio Moss header', menus: [{ key: 'main', name: 'Studio main', items: [
    { key: 'home', parentKey: null, title: 'Home', url: '/' },
    { key: 'shop', parentKey: null, title: 'Shop', url: '/shop/' },
    { key: 'care', parentKey: 'shop', title: 'Care', url: '/product-category/care/' },
  ] }], layout: { rows: [{ slot: 'general-header', params: { height: 96 }, columns: { left: [{ key: 'brand', type: 'logo', params: { image: { $media: 'brand-logo' } } }], center: [{ key: 'navigation', type: 'mainmenu', menuKey: 'main', params: {} }], right: [{ key: 'account', type: 'account', params: {} }, { key: 'cart', type: 'cart', params: {} }] } }], settings: {} }, style: { css: ':header { color: #304b30 }', fonts: [] } };
}
test('module plan is independently immutable and contains no page or target business defaults', () => {
  const input = plan(), result = validateHeaderModulePlan(input);
  assert.deepEqual(result, input); assert.notEqual(result, input);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.layout.rows[0].columns.left));
  assert.throws(() => { result.name = 'changed'; }, TypeError);
  assert.throws(() => { result.menus[0].items.push({ key: 'x', parentKey: null, title: 'X', url: '/' }); }, TypeError);
  input.name = 'Other brand'; assert.equal(result.name, 'Studio Moss header');
  assert.equal(Object.hasOwn(result, 'pageId'), false); assert.equal(Object.hasOwn(result, 'headerId'), false);
  assert.equal(JSON.stringify(result).includes('15769'), false); assert.equal(JSON.stringify(result).includes('Furry'), false);
});
test('a second brand can choose a different row, multiple menus and no logo or theme color defaults', () => {
  const second = plan(); second.moduleKey = 'orbit'; second.name = 'Orbit';
  second.menus.push({ key: 'utility', name: 'Utilities', items: [{ key: 'help', parentKey: null, title: 'Help', url: 'https://support.example/help' }] });
  second.layout.rows = [{ slot: 'header-bottom', params: {}, columns: { left: [{ key: 'search', type: 'search', params: {} }], center: [{ key: 'utility-nav', type: 'mainmenu', menuKey: 'utility', params: {} }], right: [{ key: 'gap', type: 'space', params: { width: 12 } }] } }];
  second.style.css = ''; assert.deepEqual(validateHeaderModulePlan(second), second);
});
test('plan rejects conflicting identity, unsupported types, duplicate rows/elements and raw native menu IDs', () => {
  for (const mutate of [
    (p: any) => { p.version = 2; }, (p: any) => { p.moduleKey = 'Brand One'; },
    (p: any) => { p.targetOrigin = 'http://target.example'; }, (p: any) => { p.targetOrigin = 'https://u:secret@target.example'; },
    (p: any) => { p.pageId = 10; }, (p: any) => { p.owner.extra = 'authority'; },
    (p: any) => { p.layout.rows.push(structuredClone(p.layout.rows[0])); },
    (p: any) => { p.layout.rows[0].columns.right[0].key = 'brand'; },
    (p: any) => { p.layout.rows[0].columns.left[0].type = 'html'; },
    (p: any) => { p.layout.rows[0].columns.center[0].params.menu_id = 47; },
    (p: any) => { p.layout.rows[0].columns.center[0].menuKey = 'missing'; },
    (p: any) => { p.layout.rows[0].columns.right[0].menuKey = 'main'; },
    (p: any) => { p.menus.push({ ...structuredClone(p.menus[0]), key: 'second', name: p.menus[0].name.toUpperCase() }); },
  ]) { const bad = plan(); mutate(bad); assert.throws(() => validateHeaderModulePlan(bad)); }
});
test('module limits and font URL/type contracts are bounded before target access', () => {
  const nodes = plan(); nodes.layout.rows[0].columns.left = Array.from({ length: 101 }, (_, i) => ({ key: `item-${i}`, type: 'space', params: {} }));
  assert.throws(() => validateHeaderModulePlan(nodes), /column_invalid/);
  const large = plan(); large.style.css = 'x'.repeat(256 * 1024 + 1); assert.throws(() => validateHeaderModulePlan(large), /style_invalid/);
  for (const url of ['http://fonts.example/f.woff2', 'https://u:secret@fonts.example/f.woff2', 'https://fonts.example/f.woff2#x', 'https:\\fonts.example/f.woff2']) {
    const bad = plan(); bad.style.fonts = [{ key: 'body', url, weight: 700, style: 'normal' }]; assert.throws(() => validateHeaderModulePlan(bad), /font_url_invalid/);
  }
  const fonts = plan(); fonts.style.fonts = [{ key: 'body', url: 'https://fonts.example/f.woff2', weight: 700, style: 'italic' }]; assert.doesNotThrow(() => validateHeaderModulePlan(fonts));
});
test('parent-first menu creation retains sibling ordering and does not edit original items', () => {
  const menu = [{ key: 'child-b', parentKey: 'shop', title: 'B', url: '/b' }, { key: 'home', parentKey: null, title: 'Home', url: '/' }, { key: 'shop', parentKey: null, title: 'Shop', url: '/shop' }, { key: 'child-a', parentKey: 'shop', title: 'A', url: '/a' }];
  const before = structuredClone(menu);
  assert.deepEqual(orderHeaderMenuItems(menu, 'https://target.example').map(item => item.key), ['home', 'shop', 'child-b', 'child-a']);
  assert.deepEqual(menu, before);
  assert.throws(() => orderHeaderMenuItems([{ ...menu[0], parentKey: 'missing' }], 'https://target.example'), /menu_parent_missing/);
});
test('hash reflects the independent module revision and rejects executable/lossy JSON before accessing it', () => {
  const first = plan(), same = { ...first, style: { fonts: [], css: first.style.css } };
  assert.equal(modulePlanHash(first), modulePlanHash(same));
  const second = plan(); second.layout.rows[0].params.height = 108; assert.notEqual(modulePlanHash(first), modulePlanHash(second));
  let reads = 0; const getter = Object.defineProperty({}, 'kind', { enumerable: true, get() { reads++; return 'clonewp-header-module'; } });
  assert.throws(() => validateHeaderModulePlan(getter), /json_invalid/); assert.equal(reads, 0);
});

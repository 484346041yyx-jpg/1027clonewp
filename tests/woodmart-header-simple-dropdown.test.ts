import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import { compileSimpleDropdownCSS } from '../src/woodmart-header/generic/simple-dropdown.js';

const menu = { key: 'main', name: 'Main', items: [
  { key: 'home', parentKey: null, title: 'Home', url: '/' },
  { key: 'products', parentKey: null, title: 'Products', url: '/products' },
  { key: 'bottles', parentKey: 'products', title: 'Bottles', url: '/bottles' },
], dropdowns: [{ itemKey: 'products', width: 260, offset: -5, itemHeight: 39, paddingX: 18, paddingBottom: 18, backgroundColor: '#ffffff', textColor: '#333333', hoverColor: '#d2a000', shadow: true }] };

function plan(menus: unknown) { return { kind: 'clonewp-header-module', version: 1, moduleKey: 'simple-dropdown-test', targetOrigin: 'https://example.com', owner: { ownerId: 'clonewp', runId: 'dropdown-test' }, name: 'Test header', menus, layout: { rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: '', fonts: [] } }; }

test('only a parent with children accepts a simple dropdown presentation', () => {
  const valid = validateHeaderModulePlan(plan([menu]));
  assert.equal(valid.menus[0].dropdowns?.[0].itemKey, 'products');
  assert.throws(() => validateHeaderModulePlan(plan([{ ...menu, dropdowns: [{ ...menu.dropdowns[0], itemKey: 'home' }] }])), /dropdowns_invalid/);
  assert.throws(() => validateHeaderModulePlan(plan([{ ...menu, dropdowns: [menu.dropdowns[0], menu.dropdowns[0]] }])), /dropdowns_invalid/);
});

test('dropdown CSS targets only the configured owned menu item', () => {
  const css = compileSimpleDropdownCSS([menu], { main: { home: 11, products: 12, bottles: 13 } });
  assert.match(css, /menu-item-12\.menu-item-has-children>\.wd-dropdown-menu\{width:260px/);
  assert.match(css, /margin-top:-5px/);
  assert.doesNotMatch(css, /menu-item-11|menu-item-13/);
  assert.throws(() => compileSimpleDropdownCSS([menu], { main: { home: 11 } }), /dropdown_item_unresolved/);
});

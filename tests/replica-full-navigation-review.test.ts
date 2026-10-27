import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { compileNavigationFormHtml, type NavigationFormSpec } from '../src/replica-full/navigation-form/index.js';
import { assertNavigationFormDOM, assertNavigationFormInteraction, navigationFormSelector } from '../src/replica-full/navigation-form-review.js';

const sourceUrl = 'https://hoshiichi.com/', taskId = 'nav-review';
const form: NavigationFormSpec = { key: 'filter', slotComponentKey: 'products_filter', sourceUnitIds: ['desktop/products', 'narrow/products'], sourceFactIds: ['desktop:interaction:form', 'narrow:interaction:form'], sourceEvidence: { path: 'source.json', sha256: 'a'.repeat(64) }, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }, { label: 'スキンケア', value: 'app_skincare' }] }, { name: 'p_vol_range', label: '容量:', options: [{ label: 'すべて', value: '' }, { label: '50~100ml', value: '50-100' }] }], submitLabel: '検索' };
const node = () => (parseFragment(compileNavigationFormHtml(form, sourceUrl, taskId)) as any).childNodes[0];
test('actual active form DOM must match all typed compiler attributes, labels, controls and values', () => {
  assertNavigationFormDOM([node()], [form], sourceUrl, taskId);
  for (const change of [(n: any) => n.attrs.push({ name: 'onsubmit', value: 'return false' }), (n: any) => n.attrs.find((a: any) => a.name === 'method').value = 'post', (n: any) => n.childNodes.find((child: any) => child.tagName === 'select').attrs.find((a: any) => a.name === 'name').value = 'different']) {
    const actual = node(); change(actual); assert.throws(() => assertNavigationFormDOM([actual], [form], sourceUrl, taskId), /form_dom_changed/);
  }
  assert.throws(() => assertNavigationFormDOM([], [form], sourceUrl, taskId), /form_count/);
  assert.throws(() => assertNavigationFormDOM([node(), node()], [form], sourceUrl, taskId), /form_count/);
});
test('form review requires selected allowed values and an actual exact GET destination', () => {
  const action = { kind: 'form', selector: navigationFormSelector(form, taskId), expectedOutcome: 'navigated' }, states = [{ state: { url: 'https://target.example/?page_id=9&preview=true', 'select:application': 'app_skincare', 'select:p_vol_range': '50-100' } }, { state: { url: 'https://hoshiichi.com/all_product?application=app_skincare&p_vol_range=50-100', method: 'GET', submitted: true } }];
  assertNavigationFormInteraction(form, action, states, sourceUrl, 'https://target.example', taskId);
  const canonical = structuredClone(states); canonical[1].state.url = 'https://hoshiichi.com/all_product/?application=app_skincare&p_vol_range=50-100';
  assertNavigationFormInteraction(form, action, canonical, sourceUrl, 'https://target.example', taskId);
  for (const path of ['/other/', '/all_product/sub/', '/all_product//']) {
    const changed = structuredClone(states); changed[1].state.url = 'https://hoshiichi.com' + path + '?application=app_skincare&p_vol_range=50-100';
    assert.throws(() => assertNavigationFormInteraction(form, action, changed, sourceUrl, 'https://target.example', taskId), /interaction_navigation/);
  }
  for (const url of ['https://hoshiichi.com/all_product?application=app_haircare&p_vol_range=50-100', 'https://hoshiichi.com/all_product?application=app_skincare&p_vol_range=50-100&nonce=secret', 'https://hoshiichi.com/all_product?application=app_skincare&application=app_skincare', 'https://attacker.com/all_product?application=app_skincare&p_vol_range=50-100']) {
    const changed = structuredClone(states); changed[1].state.url = url; assert.throws(() => assertNavigationFormInteraction(form, action, changed, sourceUrl, 'https://target.example', taskId), /interaction_/);
  }
  const unsent = structuredClone(states); unsent[1].state.submitted = false; assert.throws(() => assertNavigationFormInteraction(form, action, unsent, sourceUrl, 'https://target.example', taskId), /interaction_state/);
});

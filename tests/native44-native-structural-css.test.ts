import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNative44PageCSS, type Native44CSSNativeStructure, type Native44CSSRule } from '../src/native44/css-handoff.js';
import { createNative44CSSModel, compileNative44CSSModel, type Native44CSSModelRule } from '../src/native44/css-model.js';
import type { ElementorElement } from '../src/wordpress/types.js';

const sourceEvidence = 'references/current/source-facts.json';
const identity = { taskId: 'structural-fixture', runId: 'structural-run', pageId: 77, replicationProfile: 'desktop-browser-v1' as const, modules: [{ key: 'range', className: 'cwp-range' }, { key: 'header', className: 'cwp-header' }] };
const binding: Native44CSSNativeStructure = { kind: 'accordion-item', elementId: 'accordion1', widgetType: 'nested-accordion', itemId: 'range-first', sourceEvidence };
const accordionRule = (overrides: Partial<Native44CSSModelRule> = {}): Native44CSSModelRule => ({ id: 'first-header-color', moduleKey: 'range', slot: 'first-header', selector: '.e-n-accordion-item#range-first > .e-n-accordion-item-title', property: 'background-color', value: '#ffc600', responsibility: 'css', reason: 'The observed first disclosure has its distinct source header color.', evidence: [sourceEvidence], nativeStructure: structuredClone(binding), ...overrides });
const dropdownBinding = (state: 'closed' | 'hover' | 'focus-within'): Native44CSSNativeStructure => ({ kind: 'navigation-dropdown', parentElementId: 'parent1', submenuElementId: 'submenu1', parentClass: 'shop-parent', submenuClass: 'shop-submenu', state, sourceEvidence });
const dropdownRules = (): Native44CSSModelRule[] => (['closed', 'hover', 'focus-within'] as const).map(state => ({ id: `dropdown-${state}`, moduleKey: 'header', slot: 'shop-dropdown', selector: `.shop-parent${state === 'closed' ? '' : `:${state}`} > .shop-submenu`, property: 'display', value: state === 'closed' ? 'none' : 'block', responsibility: 'css', reason: 'The source navigation submenu reveals on hover and keyboard focus.', evidence: [sourceEvidence], nativeStructure: dropdownBinding(state) }));
const list = (id: string, url = 'https://source.example/shop/'): ElementorElement => ({ id, elType: 'widget', widgetType: 'wd_list', settings: { list_items: [{ _id: 'row1', list_content: 'Shop', link: { url } }] }, elements: [] });
const container = (id: string, classes: string, elements: ElementorElement[]): ElementorElement => ({ id, elType: 'container', settings: { css_classes: classes }, elements });
function elements(): ElementorElement[] { return [container('range1', 'cwp-range', [{ id: 'accordion1', elType: 'widget', widgetType: 'nested-accordion', settings: { items: [{ _id: 'firstrow', element_css_id: 'range-first' }, { _id: 'secondrow', element_css_id: 'range-second' }] }, elements: [] }]), container('header1', 'cwp-header', [container('parent1', 'shop-parent', [list('trigger1'), container('submenu1', 'shop-submenu', [list('links1')])])])]; }
const find = (roots: ElementorElement[], id: string): ElementorElement => roots.flatMap(root => [root, ...root.elements.flatMap(child => flatten(child))]).find(element => element.id === id)!;
const flatten = (element: ElementorElement): ElementorElement[] => [element, ...element.elements.flatMap(flatten)];
function handoff(rule: Native44CSSModelRule): Native44CSSRule { return { moduleKey: rule.moduleKey, selector: rule.selector, declarations: { [rule.property]: rule.value! }, media: rule.media, reason: rule.reason, evidence: rule.evidence, nativeStructure: rule.nativeStructure }; }
const prepare = (rules: Native44CSSModelRule[]) => prepareNative44PageCSS({ ...identity, canvasCss: '', rules: rules.map(handoff) });

test('static nested-accordion item IDs preserve distinct colors and bind exact actual native items', () => {
  const model = createNative44CSSModel({ ...identity, rules: [accordionRule()] }), tree = elements();
  const compiled = compileNative44CSSModel(model, { elements: tree });
  assert.match(compiled.css, /#range-first/);
  assert.match(compiled.css, /background-color:\s*#ffc600/);
  assert.equal(compiled.css, compileNative44CSSModel(model).css);
  for (const mutate of [
    (nodes: ElementorElement[]) => { find(nodes, 'accordion1').id = 'stale1'; },
    (nodes: ElementorElement[]) => { find(nodes, 'accordion1').widgetType = 'accordion'; },
    (nodes: ElementorElement[]) => { (find(nodes, 'accordion1').settings.items as any[])[0].element_css_id = 'different'; },
    (nodes: ElementorElement[]) => { (find(nodes, 'accordion1').settings.items as any[])[1].element_css_id = 'range-first'; },
    (nodes: ElementorElement[]) => { nodes[1].elements.push(nodes[0].elements.pop()!); },
    (nodes: ElementorElement[]) => { nodes[1].settings._element_id = 'range-first'; },
  ]) { const nodes = elements(); mutate(nodes); assert.throws(() => compileNative44CSSModel(model, { elements: nodes }), /native_accordion_item_mismatch/); }
});

test('native item metadata cannot smuggle unmatched IDs, CSS escapes, indexed/global selectors or content hiding', () => {
  for (const rule of [
    accordionRule({ nativeStructure: undefined }), accordionRule({ selector: '#range-second' }), accordionRule({ selector: '.item' }),
    accordionRule({ selector: '#range-first #range-first' }), accordionRule({ selector: '#range\\-first' }), accordionRule({ selector: '#range-first:nth-child(1)' }),
    accordionRule({ selector: '#range-first[open]' }), accordionRule({ selector: '#range-first :global(.outside)' }), accordionRule({ selector: '.item:not(#range-first)' }), accordionRule({ selector: '#range-first + .other' }),
    accordionRule({ property: 'display', value: 'none' }), accordionRule({ property: 'opacity', value: '0' }), accordionRule({ property: 'position', value: 'absolute' }),
    accordionRule({ evidence: ['unrelated-evidence'] }), accordionRule({ nativeStructure: { ...binding, widgetType: 'button' } as any }), accordionRule({ nativeStructure: { ...binding, allowHide: true } as any }),
  ]) assert.throws(() => prepare([rule]));
  assert.throws(() => prepareNative44PageCSS({ pageId: 77, modules: identity.modules, canvasCss: '', rules: [handoff(accordionRule())] }), /explicit desktop/);
});

test('page-owned native navigation has a complete hover and focus disclosure with source-bound absolute positioning', () => {
  const rules = [...dropdownRules(), { ...dropdownRules()[0], id: 'submenu-position', property: 'position', value: 'absolute' }];
  const model = createNative44CSSModel({ ...identity, rules }), compiled = compileNative44CSSModel(model, { elements: elements() });
  assert.match(compiled.css, /display:\s*none/); assert.match(compiled.css, /:hover/); assert.match(compiled.css, /:focus-within/); assert.match(compiled.css, /position:\s*absolute/);
  assert.equal(model.rules.every(rule => !rule.observedDecoration), true);
  assert.equal(compiled.css, compileNative44CSSModel(model).css);
});

test('navigation cannot hide content with missing states, different media, forged bindings or other hiding declarations', () => {
  for (const mutate of [
    (rules: Native44CSSModelRule[]) => { rules.pop(); },
    (rules: Native44CSSModelRule[]) => { rules[1].media = '(min-width: 1500px)'; },
    (rules: Native44CSSModelRule[]) => { rules[1].selector = '.shop-parent:hover .shop-submenu'; },
    (rules: Native44CSSModelRule[]) => { (rules[2].nativeStructure as any).submenuElementId = 'stale2'; },
    (rules: Native44CSSModelRule[]) => { rules[2].evidence = ['unrelated']; },
    (rules: Native44CSSModelRule[]) => { rules[1].value = 'none'; },
    (rules: Native44CSSModelRule[]) => { rules[0].value = 'var(--state)'; },
    (rules: Native44CSSModelRule[]) => { rules[0].selector = '.shop-submenu'; },
    (rules: Native44CSSModelRule[]) => { (rules[0].nativeStructure as any).allowHide = true; },
    (rules: Native44CSSModelRule[]) => { rules.push({ ...rules[0], id: 'invisible', property: 'visibility', value: 'hidden' }); },
    (rules: Native44CSSModelRule[]) => { rules.push({ ...rules[0], id: 'overlay', property: 'position', value: 'fixed' }); },
    (rules: Native44CSSModelRule[]) => { rules.push({ ...rules[1], id: 'absolute-hover', property: 'position', value: 'absolute' }); },
  ]) { const rules = dropdownRules(); mutate(rules); assert.throws(() => createNative44CSSModel({ ...identity, rules })); }
  assert.throws(() => prepare([accordionRule({ nativeStructure: undefined, selector: '.shop-submenu', property: 'display', value: 'none' })]), /cannot hide/);
});

test('compiled navigation requires exact actual page-owned containers and nonempty public native link lists', () => {
  const model = createNative44CSSModel({ ...identity, rules: dropdownRules() });
  for (const mutate of [
    (nodes: ElementorElement[]) => { find(nodes, 'submenu1').id = 'stale-submenu'; },
    (nodes: ElementorElement[]) => { find(nodes, 'submenu1').elType = 'widget'; },
    (nodes: ElementorElement[]) => { find(nodes, 'parent1').settings.css_classes = 'wrong-parent'; },
    (nodes: ElementorElement[]) => { nodes[0].settings.css_classes += ' shop-parent'; },
    (nodes: ElementorElement[]) => { find(nodes, 'parent1').elements.pop(); nodes[0].elements.push(container('submenu1', 'shop-submenu', [list('links1')])); },
    (nodes: ElementorElement[]) => { find(nodes, 'links1').settings.list_items = []; },
    (nodes: ElementorElement[]) => { find(nodes, 'links1').widgetType = 'text-editor'; },
    (nodes: ElementorElement[]) => { find(nodes, 'submenu1').elements.push({ id: 'other-content', elType: 'widget', widgetType: 'image', settings: {}, elements: [] }); },
    (nodes: ElementorElement[]) => { find(nodes, 'parent1').elements.shift(); },
    ...['', '/relative', 'javascript:alert(1)', 'https://user:pass@source.example/', 'https://127.0.0.1/', 'https://[fc00::1]/', 'https://source.example/?buyer_flags=private', 'https://source.example/?next=https%3A%2F%2Fsource.example%2F%3Ftoken%3Dprivate'].map(url => (nodes: ElementorElement[]) => { (find(nodes, 'links1').settings.list_items as any[])[0].link.url = url; }),
  ]) { const nodes = elements(); mutate(nodes); assert.throws(() => compileNative44CSSModel(model, { elements: nodes }), /native_navigation_(?:container|links)_mismatch/); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertHeaderIsolation, assertHeaderWritePrecondition, canonicalHeaderJson, headerJsonHash,
  prepareHeaderWriteIntent, reconcileHeaderWrite, validateHeaderMenuItems, validateHeaderPlan,
  type HeaderIsolationAudit, type WoodmartHeaderPlan,
} from '../src/woodmart-header/contract.js';

const plan = (): WoodmartHeaderPlan => ({
  version: 1, targetOrigin: 'https://primevapeoutlet.com', explicitHeaderId: 'header_193941',
  expectedDefaultHeaderId: 'header_333219', menuName: 'test', owner: { ownerId: 'header-test', runId: 'header-2026-10-18' },
  preservedComponentPageIds: [15769], preservedMenuIds: [48],
  tree: { key: 'header', type: 'root', children: [{ key: 'main', type: 'row', children: [
    { key: 'left', type: 'column', children: [{ key: 'logo', type: 'logo', children: [] }] },
    { key: 'middle', type: 'column', children: [{ key: 'navigation', type: 'main-menu', children: [] }] },
    { key: 'right', type: 'column', children: [{ key: 'account', type: 'account', children: [] }, { key: 'cart', type: 'cart', children: [] }] },
  ] }] },
});
const audit = (): HeaderIsolationAudit => ({
  targetOrigin: 'https://primevapeoutlet.com', headerId: 'header_193941', defaultHeaderId: 'header_333219',
  coverage: { explicitReferences: 'complete', presets: 'complete', cssJs: 'complete' },
  explicitReferences: [], presetReferences: [], cssJsReferences: [],
});
const menu = () => [
  { key: 'home', parentKey: null, title: 'Home', url: '/' },
  { key: 'shop', parentKey: null, title: 'Shop', url: '/shop/' },
  { key: 'dog', parentKey: 'shop', title: 'Dog', url: '/product-category/dog/' },
];

test('independent header plan preserves original page and menu identities without mutation', () => {
  const original = plan(), result = validateHeaderPlan(original);
  assert.deepEqual(result, original);
  result.tree.children.length = 0;
  result.preservedComponentPageIds.push(999);
  assert.equal(original.tree.children.length, 1);
  assert.deepEqual(original.preservedComponentPageIds, [15769]);
});

test('header plan rejects origins with credentials, paths, HTTP, or unknown fields', () => {
  for (const targetOrigin of ['http://primevapeoutlet.com', 'https://admin:password@primevapeoutlet.com', 'https://primevapeoutlet.com/wp-admin/', 'https://primevapeoutlet.com?x=1']) {
    assert.throws(() => validateHeaderPlan({ ...plan(), targetOrigin }), /origin_invalid/);
  }
  assert.throws(() => validateHeaderPlan({ ...plan(), overwriteElementor: true }), /shape_invalid/);
  assert.throws(() => validateHeaderPlan({ ...plan(), explicitHeaderId: 'test' }), /plan_invalid/);
  assert.throws(() => validateHeaderPlan({ ...plan(), preservedMenuIds: [48, 48] }), /preserved_ids_invalid/);
});

test('semantic layout rejects unapproved elements, duplicate keys and invalid hierarchy', () => {
  const unknown = plan(); (unknown.tree.children[0].children[0].children[0] as { type: string }).type = 'html';
  assert.throws(() => validateHeaderPlan(unknown), /tree_invalid/);
  const duplicate = plan(); duplicate.tree.children[0].children[1].key = 'left';
  assert.throws(() => validateHeaderPlan(duplicate), /tree_invalid/);
  const hierarchy = plan(); hierarchy.tree.children[0].children[0].type = 'cart';
  assert.throws(() => validateHeaderPlan(hierarchy), /tree_hierarchy_invalid/);
});

test('menu validates real hierarchy while retaining safe relative or HTTPS destinations', () => {
  const items = [...menu(), { key: 'external', parentKey: null, title: 'Guidelines', url: 'https://furryskitchen.com/pages/feeding-guidelines' }];
  assert.deepEqual(validateHeaderMenuItems(items, plan().targetOrigin), items);
  assert.throws(() => validateHeaderMenuItems([...menu(), menu()[0]], plan().targetOrigin), /menu_item_invalid/);
  assert.throws(() => validateHeaderMenuItems([{ ...menu()[0], parentKey: 'missing' }], plan().targetOrigin), /menu_parent_missing/);
  assert.throws(() => validateHeaderMenuItems([{ ...menu()[0], parentKey: 'home' }], plan().targetOrigin), /menu_parent_cycle/);
  assert.throws(() => validateHeaderMenuItems([{ ...menu()[0], parentKey: 'shop' }, { ...menu()[1], parentKey: 'home' }], plan().targetOrigin), /menu_parent_cycle/);
});

test('menu rejects script schemes, protocol-relative links, credentials and browser-normalized escapes', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,test', 'http://example.com', '//example.com', 'https://admin:secret@example.com', 'https:\\example.com', '/shop/%0afoo', '/shop/\nfoo']) {
    assert.throws(() => validateHeaderMenuItems([{ ...menu()[0], url }], plan().targetOrigin), /menu_(?:url|item)_invalid/, url);
  }
});

test('a default header cannot be edited until isolation is complete and expected pointer is refreshed', () => {
  const defaultPlan = { ...plan(), expectedDefaultHeaderId: 'header_193941' };
  assert.throws(() => assertHeaderIsolation(defaultPlan, { ...audit(), defaultHeaderId: 'header_193941' }), /default_header_must_be_isolated/);
  assert.throws(() => assertHeaderIsolation(defaultPlan, audit()), /isolation_identity_changed/);
  assert.doesNotThrow(() => assertHeaderIsolation(plan(), audit()));
});

test('empty reference lists do not replace complete audits for explicit references, presets or CSS/JS', () => {
  for (const field of ['explicitReferences', 'presets', 'cssJs'] as const) {
    const incomplete = audit(); incomplete.coverage[field] = 'unknown';
    assert.throws(() => assertHeaderIsolation(plan(), incomplete), /reference_audit_incomplete/);
  }
  for (const affected of [
    { ...audit(), explicitReferences: [{ kind: 'page' as const, id: '15769' }] },
    { ...audit(), presetReferences: ['preset-1'] },
    { ...audit(), cssJsReferences: ['theme-custom-css:header_193941'] },
  ]) assert.throws(() => assertHeaderIsolation(plan(), affected), /header_has_other_references/);
});

test('only the matching owned new test page may reference the experimental header', () => {
  const page = { pageId: 16000, ...plan().owner };
  const owned = { ...audit(), explicitReferences: [{ kind: 'page' as const, id: '16000' }] };
  assert.doesNotThrow(() => assertHeaderIsolation(plan(), owned, page));
  assert.throws(() => assertHeaderIsolation(plan(), owned, { ...page, ownerId: 'someone-else' }), /test_page_owner_invalid/);
  assert.throws(() => assertHeaderIsolation(plan(), audit(), { ...page, pageId: 15769 }), /test_page_owner_invalid/);
  assert.throws(() => assertHeaderIsolation(plan(), { ...owned, explicitReferences: [{ kind: 'product', id: '16000' }] }, page), /header_has_other_references/);
});

test('canonical hash ignores object insertion order but detects nested changes and array order', () => {
  const first = { header: { title: 'test', tree: [1, 2] }, menu: 90 };
  const reordered = { menu: 90, header: { tree: [1, 2], title: 'test' } };
  assert.equal(headerJsonHash(first), headerJsonHash(reordered));
  assert.notEqual(headerJsonHash(first), headerJsonHash({ ...first, menu: 91 }));
  assert.notEqual(headerJsonHash(first), headerJsonHash({ ...first, header: { title: 'test', tree: [2, 1] } }));
  assert.equal(canonicalHeaderJson({ z: true, a: 'x' }), '{"a":"x","z":true}');
});

test('canonical snapshots reject silent JSON loss, cycles, accessors and executable objects', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  let getterReads = 0;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterReads++; return 1; } });
  const sparse = Array(2);
  for (const value of [undefined, NaN, Infinity, BigInt(1), new Date(), { value: undefined }, cycle, getter, sparse, JSON.parse('{"__proto__":1}')]) {
    assert.throws(() => canonicalHeaderJson(value), /json_invalid/);
  }
  assert.equal(getterReads, 0);
});

test('CAS detects concurrent edits and an already applied result cannot be submitted again', () => {
  const before = { id: 'header_193941', tree: ['logo'] }, after = { ...before, tree: ['logo', 'main-menu'] };
  const intent = prepareHeaderWriteIntent({ kind: 'woodmart-header', id: before.id }, plan().owner, before, after);
  assert.doesNotThrow(() => assertHeaderWritePrecondition(intent, { tree: ['logo'], id: before.id }));
  assert.throws(() => assertHeaderWritePrecondition(intent, { ...before, title: 'concurrent' }), /write_precondition_changed/);
  assert.throws(() => assertHeaderWritePrecondition(intent, after), /write_precondition_changed/);
  assert.throws(() => prepareHeaderWriteIntent(intent.resource, intent.owner, before, before), /write_intent_invalid/);
});

test('unknown write outcomes are reconciled as before, after or conflict without blind retries', () => {
  const before = { defaultHeader: 'header_193941' }, after = { defaultHeader: 'header_500000' };
  const intent = prepareHeaderWriteIntent({ kind: 'default-header-pointer', id: 'active' }, plan().owner, before, after);
  const unchanged = reconcileHeaderWrite(intent, before), applied = reconcileHeaderWrite(intent, after), conflict = reconcileHeaderWrite(intent, { defaultHeader: 'header_600000' });
  assert.deepEqual([unchanged.state, unchanged.nextAction, unchanged.retryAllowed], ['before', 'recheck-preconditions', false]);
  assert.deepEqual([applied.state, applied.nextAction, applied.retryAllowed], ['after', 'accept-readback-no-retry', false]);
  assert.deepEqual([conflict.state, conflict.nextAction, conflict.retryAllowed], ['conflict', 'stop-no-retry', false]);
});

test('large storefront menus retain 200 ordered links and reject overflow or identity conflicts', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ key: `large-${i}`, parentKey: i ? 'large-0' : null, title: `Category ${i}`, url: `/category-${i}/` }));
  assert.deepEqual(validateHeaderMenuItems(items, 'https://target.example'), items);
  assert.throws(() => validateHeaderMenuItems([...items, { key: 'large-200', parentKey: null, title: 'Overflow', url: '/' }], 'https://target.example'), /menu_invalid/);
  assert.throws(() => validateHeaderMenuItems([...items.slice(0, 199), items[0]], 'https://target.example'), /menu_item_invalid/);
});

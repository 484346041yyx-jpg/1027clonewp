import test from 'node:test';
import assert from 'node:assert/strict';
import { applyContainerTreePlan } from '../src/replica-full/container-tree.js';
import type { ElementorElement } from '../src/wordpress/types.js';

const leaf = (id: string): ElementorElement => ({ id, elType: 'widget', widgetType: 'heading', settings: { title: id }, elements: [] });
const container = (id: string, children: ElementorElement[]): ElementorElement => ({ id, elType: 'container', isInner: false, settings: {}, elements: children });

test('groups contiguous sections and assigns layout without changing widgets', () => {
  const original = [container('ship001', [leaf('offer01')]), container('team001', [leaf('league01')]), container('footer01', [leaf('visit01')])];
  const result = applyContainerTreePlan(original, { version: 1, kind: 'clonewp-container-tree-plan', operations: [
    { kind: 'group-siblings', parentId: null, memberIds: ['ship001', 'team001'], groupId: 'group001', controls: { content_width: 'boxed', flex_direction: 'column' } },
    { kind: 'set-controls', elementId: 'team001', controls: { flex_direction: 'row', flex_justify_content: 'center' } },
  ] });
  assert.deepEqual(result.map(node => node.id), ['group001', 'footer01']);
  assert.deepEqual(result[0].elements.map(node => node.id), ['ship001', 'team001']);
  assert.equal(result[0].elements[1].settings.flex_direction, 'row');
  assert.equal(result[0].elements[1].elements[0].settings.title, 'league01');
  assert.deepEqual(original[1].settings, {});
  assert.deepEqual(result[1], original[2]);
});

test('groups adjacent widgets without changing their editable settings', () => {
  const original = [container('seo0001', [leaf('title01'), leaf('copy001'), leaf('copy002')])];
  const result = applyContainerTreePlan(original, { version: 1, kind: 'clonewp-container-tree-plan', operations: [
    { kind: 'group-siblings', parentId: 'seo0001', memberIds: ['title01', 'copy001', 'copy002'], groupId: 'scroll01', controls: { flex_direction: 'column', overflow: 'auto' } },
  ] });
  assert.deepEqual(result[0].elements.map(node => node.id), ['scroll01']);
  assert.deepEqual(result[0].elements[0].elements, original[0].elements);
  assert.equal(result[0].elements[0].settings.overflow, 'auto');
});

test('rejects missing, nonadjacent, or duplicate grouping', () => {
  const original = [container('ship001', []), container('team001', []), container('other001', []), leaf('offer01')];
  const plan = (memberIds: string[]) => ({ version: 1, kind: 'clonewp-container-tree-plan', operations: [
    { kind: 'group-siblings', parentId: null, memberIds, groupId: 'group001', controls: { flex_direction: 'column' } },
  ] });
  assert.throws(() => applyContainerTreePlan(original, plan(['ship001', 'other001'])), /group_members_invalid/);
  assert.throws(() => applyContainerTreePlan(original, plan(['ship001', 'ship001'])), /group_identity_invalid/);
  assert.deepEqual(applyContainerTreePlan(original, plan(['other001', 'offer01']))[2].elements.map(node => node.id), ['other001', 'offer01']);
  assert.throws(() => applyContainerTreePlan(original, { version: 1, kind: 'clonewp-container-tree-plan', operations: [
    { kind: 'set-controls', elementId: 'offer01', controls: { flex_direction: 'row' } },
  ] }), /container_owner_invalid/);
});

test('rejects content, scripts, and arbitrary styling controls', () => {
  const original = [container('ship001', [])];
  for (const controls of [{ custom_css: 'body{}' }, { flex_direction: 'row;display:none' }, { width: { unit: 'px', size: 100, url: 'https://example.com' } }, { overflow: 'scroll' }]) {
    assert.throws(() => applyContainerTreePlan(original, { version: 1, kind: 'clonewp-container-tree-plan', operations: [
      { kind: 'set-controls', elementId: 'ship001', controls },
    ] }));
  }
});

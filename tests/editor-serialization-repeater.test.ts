import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import { assertAuthorizedEditorChanges, ConcurrentDraftChangeError } from '../src/core/draft-guards.js';
import type { ControlInfo, DraftSnapshot, ElementorElement, LegacySchema } from '../src/wordpress/types.js';
import type { AuthorizedEditorEdit } from '../src/verification/editability.js';

const emptyLink = { url: '', is_external: '', nofollow: '', custom_attributes: '' };
const sourceLink = { ...emptyLink, url: 'https://www.petsupermarket.com/dog/' };
const schemas: Record<string, LegacySchema> = {
  container: { type: 'container', class: 'ContainerFixture', controls: {} },
  'mega-menu': { type: 'mega-menu', class: 'MegaMenuFixture', controls: {
    menu_items: { type: 'nested-elements-repeater', default: [], fields: {
      _id: { name: '_id', type: 'hidden', default: '' },
      item_title: { name: 'item_title', type: 'text', default: 'Item Title' },
      item_link: { name: 'item_link', type: 'url', default: emptyLink },
      item_dropdown_content: { name: 'item_dropdown_content', type: 'switcher', default: 'no' },
      kept_default: { name: 'kept_default', type: 'switcher', default: 'no', save_default: true },
    } },
  } },
  heading: { type: 'heading', class: 'HeadingFixture', controls: {
    title: { type: 'textarea', default: '' }, title_color: { type: 'color', default: '' },
  } },
  image: { type: 'image', class: 'ImageFixture', controls: { image: { type: 'media', default: { id: '', url: '' } } } },
};

function menu(rows: unknown[]): ElementorElement {
  return { id: 'menu001', elType: 'widget', widgetType: 'mega-menu', settings: { menu_items: rows }, elements: [] };
}

test('native MegaMenu serialization drops only its registered empty link defaults and preserves source rows and nondefault data', () => {
  const input = [menu([
    { _id: 'row_a', item_title: 'Shop', item_link: { custom_attributes: '', nofollow: '', is_external: '', url: '' }, item_dropdown_content: 'yes', kept_default: 'no', human_metadata: { item_link: emptyLink } },
    { _id: 'row_b', item_title: 'Deals', item_link: sourceLink, item_dropdown_content: 'no', kept_default: 'no' },
    { _id: 'row_c', item_link: emptyLink, item_dropdown_content: 'no' },
    { _id: 'row_d', item_title: 'Other', item_link: { ...emptyLink, is_external: 'yes' } },
  ])];
  const original = structuredClone(input);
  const compiled = compileEditorElements(input, schemas);
  assert.deepEqual(compiled[0].settings.menu_items, [
    { _id: 'row_a', item_title: 'Shop', item_dropdown_content: 'yes', kept_default: 'no', human_metadata: { item_link: emptyLink } },
    { _id: 'row_b', item_title: 'Deals', item_link: sourceLink, kept_default: 'no' },
    { _id: 'row_c', item_title: 'Item Title' },
    { _id: 'row_d', item_title: 'Other', item_link: { ...emptyLink, is_external: 'yes' } },
  ]);
  assert.deepEqual(input, original, 'normalization must not mutate the source or its nested row objects');
  assert.deepEqual(compileEditorElements(compiled, schemas), compiled, 'editor save normalization must be idempotent');
});

test('registered nested repeaters use named array or object fields without traversing arbitrary human objects', () => {
  const nestedFields: Record<string, ControlInfo> = {
    _id: { name: '_id', type: 'hidden', default: '' },
    label: { name: 'label', type: 'textarea', default: 'Source label' },
    link: { name: 'link', type: 'url', default: emptyLink },
    optional: { name: 'optional', type: 'text', default: '' },
    kept_flag: { name: 'kept_flag', type: 'switcher', default: '', save_default: true },
  };
  const repeaterSchema: Record<string, LegacySchema> = { repeater: { type: 'repeater', class: 'RepeaterFixture', controls: {
    rows: { type: 'repeater', default: [], fields: [
      { name: '_id', type: 'hidden', default: '' },
      { name: 'title', type: 'text', default: 'Source group' },
      { name: 'children', type: 'nested-elements-repeater', default: [], fields: nestedFields },
    ] },
  } } };
  const input: ElementorElement[] = [{ id: 'repeat1', elType: 'widget', widgetType: 'repeater', settings: { rows: [
    { _id: 'group_b', title: 'Source group', children: [
      { _id: 'child_2', label: 'Source label', link: emptyLink, optional: '', kept_flag: '', human: { link: emptyLink } },
      { _id: 'child_1', link: sourceLink },
    ] },
    { _id: 'group_a', title: 'Actual group', children: [] },
  ] }, elements: [] }];
  const original = structuredClone(input);
  const compiled = compileEditorElements(input, repeaterSchema);
  assert.deepEqual(compiled[0].settings.rows, [
    { _id: 'group_b', title: 'Source group', children: [
      { _id: 'child_2', label: 'Source label', kept_flag: '', human: { link: emptyLink } },
      { _id: 'child_1', label: 'Source label', link: sourceLink },
    ] },
    { _id: 'group_a', title: 'Actual group', children: [] },
  ]);
  assert.deepEqual(input, original);
  assert.deepEqual(compileEditorElements(compiled, repeaterSchema), compiled);
});

function snapshots(): { before: DraftSnapshot; current: DraftSnapshot; edits: AuthorizedEditorEdit[] } {
  const before: DraftSnapshot = {
    pageId: 11, runId: 'owned-fidelity-run', title: 'Source block draft', status: 'draft', hash: 'before-only', settings: { hide_title: 'yes' }, elements: [
      { id: 'root001', elType: 'container', isInner: false, settings: { _css_classes: 'source-header' }, elements: [
        menu([{ _id: 'row_a', item_title: 'Shop', item_link: emptyLink, item_dropdown_content: 'yes', human_metadata: { memo: 'Keep existing data' } }, { _id: 'row_b', item_title: 'Dog', item_link: sourceLink }]),
        { id: 'heading1', elType: 'widget', widgetType: 'heading', settings: { title: 'Original source title', title_color: '#111111' }, elements: [] },
        { id: 'image001', elType: 'widget', widgetType: 'image', settings: { image: { id: 41, url: 'https://target.example/source.png' } }, elements: [] },
        { id: 'other001', elType: 'widget', widgetType: 'heading', settings: { title: 'Unrelated source title' }, elements: [] },
      ] },
    ],
  };
  // This is the independently observed native-editor save shape: only the empty
  // registered URL default disappears while the three recorded UI fields change.
  const current = structuredClone(before);
  current.hash = 'saved-ui-only';
  const rows = current.elements[0].elements[0].settings.menu_items as Array<Record<string, unknown>>;
  delete rows[0].item_link;
  current.elements[0].elements[1].settings.title = 'Owned title check';
  current.elements[0].elements[1].settings.title_color = 'rgb(18, 171, 125)';
  current.elements[0].elements[2].settings.image = { id: 42, url: 'https://target.example/qa.png', alt: 'Owned media metadata' };
  return { before, current, edits: [
    { targetId: 'heading1', setting: 'title', value: 'Owned title check' },
    { targetId: 'heading1', setting: 'title_color', value: '#12ab7d' },
    { targetId: 'image001', setting: 'image', value: { id: 42, url: 'https://target.example/qa.png' } },
  ] };
}

test('restoration guard accepts exact three approved UI changes with native removal of a declared empty repeater link', () => {
  const { before, current, edits } = snapshots();
  assert.doesNotThrow(() => assertAuthorizedEditorChanges(before, current, edits, schemas));
  assert.throws(() => assertAuthorizedEditorChanges(before, current, edits), ConcurrentDraftChangeError, 'omission requires the actual registered repeater schema');
  const foreignSchema = structuredClone(schemas);
  (foreignSchema['mega-menu'].controls.menu_items.fields as Record<string, ControlInfo>).item_link.default = { ...emptyLink, url: '/human-default' };
  assert.throws(() => assertAuthorizedEditorChanges(before, current, edits, foreignSchema), ConcurrentDraftChangeError, 'a different declared default cannot justify empty-link removal');
});

test('repeater normalization never authorizes link, unknown row, identity, order, class, page or unrelated widget edits', () => {
  const { before, current, edits } = snapshots();
  const row = (snapshot: DraftSnapshot, index: number) => (snapshot.elements[0].elements[0].settings.menu_items as Array<Record<string, unknown>>)[index];
  const changes: Array<{ name: string; mutate: (snapshot: DraftSnapshot) => void }> = [
    { name: 'nonempty source link changed', mutate: snapshot => { row(snapshot, 1).item_link = { ...sourceLink, url: 'https://target.example/human-destination' }; } },
    { name: 'nonempty source link removed', mutate: snapshot => { delete row(snapshot, 1).item_link; } },
    { name: 'human unknown row field', mutate: snapshot => { row(snapshot, 0).human_note = 'Preserve me'; } },
    { name: 'existing unknown row field removed', mutate: snapshot => { delete row(snapshot, 0).human_metadata; } },
    { name: 'row identity changed', mutate: snapshot => { row(snapshot, 0)._id = 'human_id'; } },
    { name: 'source row order changed', mutate: snapshot => { (snapshot.elements[0].elements[0].settings.menu_items as unknown[]).reverse(); } },
    { name: 'source row title rewritten', mutate: snapshot => { row(snapshot, 0).item_title = 'Human navigation title'; } },
    { name: 'element class changed', mutate: snapshot => { snapshot.elements[0].settings._css_classes = 'human-header'; } },
    { name: 'page setting changed', mutate: snapshot => { snapshot.settings.hide_title = ''; } },
    { name: 'page title changed', mutate: snapshot => { snapshot.title = 'Human page title'; } },
    { name: 'page identity changed', mutate: snapshot => { snapshot.pageId = 12; } },
    { name: 'unrelated widget changed', mutate: snapshot => { snapshot.elements[0].elements[3].settings.title = 'Human unrelated title'; } },
  ];
  for (const change of changes) {
    const changed = structuredClone(current); change.mutate(changed);
    assert.throws(() => assertAuthorizedEditorChanges(before, changed, edits, schemas), ConcurrentDraftChangeError, change.name);
  }
  assert.throws(() => assertAuthorizedEditorChanges(before, current, [...edits, { targetId: 'menu001', setting: 'menu_items', value: current.elements[0].elements[0].settings.menu_items }], schemas), ConcurrentDraftChangeError, 'the UI edit allowlist must not widen to arbitrary repeater edits');
});

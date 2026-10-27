import test from 'node:test';
import assert from 'node:assert/strict';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import { assertNative44RevisionDelta, prepareNative44RevisionSnapshot } from '../src/native44/revision-snapshot.js';
import type { DraftSnapshot, LegacySchema } from '../src/wordpress/types.js';

function fixture(): DraftSnapshot {
  const elements = [{ id: 'root123', elType: 'container', settings: { css_classes: 'cwp-products' }, elements: [
    { id: 'head123', elType: 'widget', widgetType: 'heading', settings: { title: 'Products', header_size: 'h2' }, elements: [] },
    { id: 'prod123', elType: 'widget', widgetType: 'wd_products', settings: { include: [501], items_per_page: 1 }, elements: [] },
  ] }], settings = { custom_css: '', post_title: 'Current draft', post_status: 'draft' };
  return { pageId: 77, runId: 'run-one', title: 'Current draft', status: 'draft', elements, settings, hash: documentHashV2(elements, settings) };
}
const patch = { kind: 'set-controls', elementId: 'head123', controls: { header_size: 'h1' }, reason: 'Match observed hierarchy', evidence: ['source:heading'] };
test('revision applies explicit native settings and sibling order without mutating baseline or product facts', () => {
  const before = fixture(), next = prepareNative44RevisionSnapshot(before, [patch, { kind: 'reorder-children', parentId: 'root123', childIds: ['prod123', 'head123'], reason: 'Source reading order', evidence: ['source:order'] }], '.elementor-77 .cwp-products{color:red}');
  assert.equal(before.elements[0].elements![0].settings.header_size, 'h2');
  assert.equal(next.elements[0].elements![0].id, 'prod123'); assert.deepEqual(next.elements[0].elements![0].settings.include, [501]);
  assert.equal(next.elements[0].elements![1].settings.header_size, 'h1'); assert.equal(next.settings.post_status, 'draft');
  assertNative44RevisionDelta(before, next, { heading: { type: 'heading', class: 'Heading', controls: { header_size: { type: 'select', options: { h1: 'H1', h2: 'H2' } } } } });
});
test('revision rejects duplicate changes, active nested content, unknown owners and topology changes', () => {
  const before = fixture();
  assert.throws(() => prepareNative44RevisionSnapshot(before, [patch, patch], ''), /patch_control_invalid/);
  assert.throws(() => prepareNative44RevisionSnapshot(before, [{ ...patch, controls: { link: { url: 'javascript:alert(1)' } } }], ''), /active_content/);
  assert.throws(() => prepareNative44RevisionSnapshot(before, [{ ...patch, elementId: 'none123' }], ''), /owner_invalid/);
  assert.throws(() => prepareNative44RevisionSnapshot(before, [{ kind: 'reorder-children', parentId: 'root123', childIds: ['prod123'], reason: 'Remove', evidence: ['source:order'] }], ''), /reorder_members_changed/);
  const next = structuredClone(before); next.elements[0].elements![0].widgetType = 'text-editor'; next.hash = documentHashV2(next.elements, next.settings);
  assert.throws(() => assertNative44RevisionDelta(before, next), /structural_change_requires_compilation/);
});
test('revision metadata and registered-control checks cannot be bypassed using a valid JSON hash', () => {
  const before = fixture(), next = prepareNative44RevisionSnapshot(before, [patch], '');
  next.settings.post_status = 'publish'; next.hash = documentHashV2(next.elements, next.settings);
  assert.throws(() => assertNative44RevisionDelta(before, next), /page_metadata_changed/);
  const unregistered = prepareNative44RevisionSnapshot(before, [{ ...patch, controls: { invented_control: 'yes' } }], '');
  assert.throws(() => assertNative44RevisionDelta(before, unregistered, {}), /unregistered_control/);
  const schemas = { heading: { type: 'heading', class: 'Heading', controls: { header_size: { type: 'select', options: { h2: 'H2' } } } } } satisfies Record<string, LegacySchema>;
  assert.throws(() => assertNative44RevisionDelta(before, prepareNative44RevisionSnapshot(before, [patch], ''), schemas), /invalid_control_option/);
});
test('accepted HTML can be preserved but cannot be modified through a correction patch', () => {
  const before = fixture(); before.elements[0].elements!.push({ id: 'html123', elType: 'widget', widgetType: 'html', settings: { html: '<p>Accepted static text</p>' }, elements: [] }); before.hash = documentHashV2(before.elements, before.settings);
  const after = prepareNative44RevisionSnapshot(before, [patch], ''); assertNative44RevisionDelta(before, after);
  assert.throws(() => prepareNative44RevisionSnapshot(before, [{ ...patch, elementId: 'html123', controls: { html: '<p>Replacement</p>' } }], ''), /patch_owner_invalid/);
  after.elements[0].elements![2].settings.html = '<p>Changed persisted input</p>'; after.hash = documentHashV2(after.elements, after.settings);
  assert.throws(() => assertNative44RevisionDelta(before, after), /html_change_requires_compilation/);
});

test('revision reuses full registered value validation and cannot add code, active attributes, media or business bindings', () => {
  const before = fixture(), schemas = { heading: { type: 'heading', class: 'Heading', controls: { link: { type: 'url' }, _attributes: { type: 'text' }, snippet: { type: 'code' }, image: { type: 'media' }, size: { type: 'slider', size_units: ['px'] } } } } satisfies Record<string, LegacySchema>;
  for (const [controls, error] of [
    [{ link: { url: 'data:text/html;base64,PHNjcmlwdD4=' } }, /Unsupported URL protocol/],
    [{ _attributes: 'onclick|alert(1)' }, /Active or unsupported HTML attribute/],
    [{ snippet: 'body{display:none}' }, /code_control_requires_compilation/],
    [{ image: { id: 123, url: 'https://unverified.test/image.png' } }, /does not match an imported/],
    [{ size: { unit: 'px', size: 'invalid' } }, /Invalid dimension/],
  ] as const) assert.throws(() => assertNative44RevisionDelta(before, prepareNative44RevisionSnapshot(before, [{ ...patch, controls }], ''), schemas), error);
  for (const controls of [{ constructor: 'x' }, { custom_css: 'body{display:none}' }, { include: [222] }]) assert.throws(() => prepareNative44RevisionSnapshot(before, [{ ...patch, controls }], ''), /patch_control_invalid|business_binding_change_requires_compilation/);
  assert.throws(() => prepareNative44RevisionSnapshot(before, [{ ...patch, controls: { title: '<a href="data:text/html;base64,PHNjcmlwdD4=">Open</a>' } }], ''), /active_content/);
});

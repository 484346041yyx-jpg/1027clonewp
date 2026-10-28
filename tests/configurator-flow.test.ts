import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSchema, type Catalog } from '../src/configurator/contract.js';
import { assertConfiguratorRegistered, compileConfiguratorPatch, widgetSettings } from '../src/configurator/compile.js';
import { assertConfiguratorExactDelta, prepareConfiguratorPatch, reconcileConfiguratorPatch } from '../src/configurator/flow.js';
import type { ElementorElement } from '../src/wordpress/types.js';

const media = { id: 101, url: 'https://target.example/wp-content/uploads/p.png' };
const part = (id: string) => ({ id, label: id, image: media, preview: media,
  position: { x: 0, y: 0, width: 100, height: 100 }, attributes: {}, fit: ['visual-only'] });
function catalog(): Catalog { return catalogSchema.parse({ version: 1, title: 'Bottle designer',
  bottles: [part('bottle-a')], pumps: [part('pump-a')], caps: [part('cap-a')],
  decorations: [{ id: 'frosted', label: 'Frosted', category: 'Finish', finish: 'Frosted', image: media, overlays: [] }],
  fonts: [{ id: 'arial', label: 'Arial', family: 'Arial' }],
  logoArea: { x: 20, y: 20, width: 60, height: 60 },
  form: { widgetId: 'bbbbbbb', summaryField: 'configuration', uploadField: 'logo' } }); }
function base(): ElementorElement[] { return [
  { id: 'aaaaaaa', elType: 'container', settings: { padding: 8 }, elements: [
    { id: 'ddddddd', elType: 'widget', widgetType: 'heading', settings: { title: 'Designer' }, elements: [] },
  ] },
  { id: 'bbbbbbb', elType: 'widget', widgetType: 'form', elements: [],
    settings: { submit_actions: ['save-to-database', 'email'], email_to: 'owner@target.example',
      form_fields: [{ _id: 'eeeeeee', custom_id: 'name', field_type: 'text', field_label: 'Name' },
        { _id: 'fffffff', custom_id: 'email', field_type: 'email', field_label: 'Email' }] } },
]; }
const registration = { version: 1 as const, widgetType: 'clonewp_bottle_configurator' as const,
  targetOrigin: 'https://target.example', packageSha256: 'a'.repeat(64), registered: true,
  controlsVerified: true, packageFilesVerified: true };

test('first save accepts registered package without claiming current page qualification', () => {
  assert.doesNotThrow(() => assertConfiguratorRegistered(registration, registration.targetOrigin, registration.packageSha256));
  assert.throws(() => assertConfiguratorRegistered({ ...registration, controlsVerified: false }, registration.targetOrigin, registration.packageSha256), /not_registered/);
  assert.throws(() => assertConfiguratorRegistered(registration, 'https://wrong.example', registration.packageSha256), /not_registered/);
});

test('typed patch adds one native widget and only two native form fields', () => {
  const original = base(), c = catalog(), patch = compileConfiguratorPatch(original, c, 'aaaaaaa', 'ccccccc');
  assert.deepEqual(original, base());
  assert.equal(patch.elements[0].elements.length, 2);
  assert.deepEqual(patch.elements[0].elements[0], original[0].elements[0]);
  assert.equal(patch.elements[0].elements[1].widgetType, 'clonewp_bottle_configurator');
  const fields = patch.elements[1].settings.form_fields as Record<string, unknown>[];
  assert.deepEqual(fields.slice(0, 2), (original[1].settings.form_fields as unknown[]));
  assert.deepEqual(fields.slice(2).map(f => [f.custom_id, f.field_type]), [['configuration', 'hidden'], ['logo', 'upload']]);
  assert.ok(fields.every(f => /^[a-f0-9]{7}$/.test(String(f._id))));
  assert.deepEqual(patch.elements[1].settings.email_to, 'owner@target.example');
  assert.doesNotThrow(() => assertConfiguratorExactDelta(original, patch.elements, c, 'aaaaaaa', 'ccccccc'));
  const tampered = structuredClone(patch.elements); tampered[1].settings.email_to = 'attacker@example';
  assert.throws(() => assertConfiguratorExactDelta(original, tampered, c, 'aaaaaaa', 'ccccccc'), /out_of_scope/);
});

test('patch refuses noncomposite scope, occupied fields, or altered native submission policy', () => {
  const c = catalog(), elements = base();
  assert.throws(() => compileConfiguratorPatch(elements, c, 'aaaaaaa', 'invalid-widget-id'), /native_identity/);
  elements[0].elements = [];
  assert.throws(() => compileConfiguratorPatch(elements, c, 'aaaaaaa', 'ccccccc'), /owned_composite_required/);
  elements[0].elements = base()[0].elements;
  elements[1].settings.form_fields = [...(elements[1].settings.form_fields as unknown[]), { custom_id: 'logo', field_type: 'text' }];
  assert.throws(() => compileConfiguratorPatch(elements, c, 'aaaaaaa', 'ccccccc'), /native_form_fields/);
  elements[1].settings.form_fields = base()[1].settings.form_fields; elements[1].settings.submit_actions = ['email'];
  assert.throws(() => compileConfiguratorPatch(elements, c, 'aaaaaaa', 'ccccccc'), /native_form_actions/);
});

test('existing configurator anywhere in the saved tree cannot be duplicated', () => {
  const elements = base();
  elements[0].elements.push({ id: '9999999', elType: 'widget', widgetType: 'clonewp_bottle_configurator', settings: {}, elements: [] });
  assert.throws(() => compileConfiguratorPatch(elements, catalog(), 'aaaaaaa', 'ccccccc'), /already_present/);
});

test('repeater row IDs are native and independent of replaceable labels or media', () => {
  const c = catalog(), first = widgetSettings(c);
  c.bottles[0].label = 'Replaceable bottle'; c.bottles[0].image = { id: 202, url: 'https://target.example/new.png' };
  const next = widgetSettings(c);
  assert.equal(first.options[0]._id, next.options[0]._id);
  for (const rows of [first.options, first.decorations, first.overlays, first.fonts])
    assert.ok(rows.every((row: { _id: string }) => /^[a-f0-9]{7}$/.test(row._id)));
});

test('intent reconciles exact base, applied patch and rejects unrelated edits', () => {
  const original = base(), c = catalog();
  const { patch, intent } = prepareConfiguratorPatch({ taskId: 'task-1', pageId: 123,
    targetOrigin: registration.targetOrigin, packageSha256: registration.packageSha256,
    registration, baseElements: original, catalog: c, slotId: 'aaaaaaa', widgetId: 'ccccccc' });
  assert.equal(reconcileConfiguratorPatch(intent, original), 'not-applied');
  assert.equal(reconcileConfiguratorPatch(intent, patch.elements), 'applied');
  const reordered = structuredClone(patch.elements);
  const widget = reordered[0].elements.find(element => element.widgetType === 'clonewp_bottle_configurator')!;
  reordered[0].elements[reordered[0].elements.indexOf(widget)] = {
    id: widget.id, elType: widget.elType, settings: widget.settings, elements: widget.elements, widgetType: widget.widgetType,
  };
  assert.equal(reconcileConfiguratorPatch(intent, reordered, patch.elements), 'applied');
  const changed = structuredClone(original); changed[0].settings.padding = 20;
  assert.throws(() => reconcileConfiguratorPatch(intent, changed), /conflict/);
});

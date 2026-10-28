import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { native44Id } from '../src/native44/adapters.js';
import { projectConfiguratorReviewElements } from '../src/replica-full/body.js';
import type { FullReplicaManifest } from '../src/replica-full/types.js';

const taskId = 'configurator-review-test';
const spec = { version: 1, kind: 'clonewp-bottle-configurator', widgetType: 'clonewp_bottle_configurator',
  slotComponentKey: 'slot', formComponentKey: 'form', widgetKey: 'widget' };
const manifest = { taskId, body: { configurator: spec } } as FullReplicaManifest;
const slotId = native44Id(taskId, 'slot'), formId = native44Id(taskId, 'form'), widgetId = native44Id(taskId, 'widget');
const rowId = (name: string) => createHash('sha256').update(`native-form-field\u0000${formId}:${name}`).digest('hex').slice(0, 7);
function tree(): any[] { return [
  { id: slotId, elType: 'container', settings: { padding: 20 }, elements: [
    { id: 'aaaaaaa', elType: 'widget', widgetType: 'heading', settings: { title: 'Keep' }, elements: [] },
    { id: widgetId, elType: 'widget', widgetType: 'clonewp_bottle_configurator', settings: {
      form_widget: formId, summary_field: 'configuration', upload_field: 'logo', options: [] }, elements: [] },
  ] },
  { id: formId, elType: 'widget', widgetType: 'form', settings: { submit_actions: ['save-to-database', 'email'], form_fields: [
    { _id: 'bbbbbbb', custom_id: 'email', field_type: 'email' },
    { _id: rowId('configuration'), custom_id: 'configuration', field_type: 'hidden', field_label: 'Bottle configuration', required: '', width: '100' },
    { _id: rowId('logo'), custom_id: 'logo', field_type: 'upload', field_label: 'Logo', required: '', width: '100',
      file_types: 'png,jpg,jpeg,webp', file_sizes: 5, allow_multiple_upload: '', attachment_type: 'link' },
  ] }, elements: [] },
]; }

test('review projection removes only the exact scoped widget and two Form fields', () => {
  const current = tree(), original = structuredClone(current);
  const result = projectConfiguratorReviewElements(current, manifest);
  assert.deepEqual(current, original);
  assert.equal(result.elements[0].elements.length, 1);
  assert.deepEqual(result.elements[0].elements[0], original[0].elements[0]);
  assert.deepEqual(result.elements[1].settings.form_fields, [original[1].settings.form_fields[0]]);
  assert.deepEqual(result.form, { formWidgetId: formId, summaryField: 'configuration', uploadField: 'logo' });
});

test('review projection rejects changed fields, misplaced widgets and duplicate extensions', () => {
  const cases = [
    (rows: any[]) => { rows[1].settings.form_fields[1].field_label = 'Changed'; },
    (rows: any[]) => { rows[0].elements.reverse(); },
    (rows: any[]) => { rows[0].elements.push(structuredClone(rows[0].elements[1])); },
    (rows: any[]) => { rows[0].elements[1].settings.form_widget = '1234567'; },
  ];
  for (const mutate of cases) { const rows = tree(); mutate(rows); assert.throws(() => projectConfiguratorReviewElements(rows, manifest), /configurator_review/); }
});

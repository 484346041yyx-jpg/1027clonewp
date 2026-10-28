import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegisteredSettings, type ControlSchema } from '../src/planning/plan.js';

const schema = () => ({ controls: {
  form_fields: { type: 'form-fields-repeater', fields: {
    field_type: { type: 'select', options: { email: 'Email', text: 'Text' } },
    custom_id: { type: 'text' }, field_label: { type: 'text' },
  } },
  submit_actions: { type: 'select2' },
  email_reply_to: { type: 'select', default: '', options: { '': '' }, render_type: 'none', condition: { submit_actions: 'email' } },
  email_reply_to_2: { type: 'select', default: '', options: { '': '' }, render_type: 'none', condition: { submit_actions: 'email' } },
  other_select: { type: 'select', options: { fixed: 'Fixed' } },
} as Record<string, ControlSchema> });
const settings = () => ({ form_fields: [
  { field_type: 'email', custom_id: 'contact_email', field_label: 'Contact email' },
  { field_type: 'email', custom_id: 'alternate_email', field_label: 'Alternate email' },
  { field_type: 'text', custom_id: 'name', field_label: 'Name' },
], submit_actions: ['save-to-database', 'email'], email_reply_to: 'contact_email' });

test('Reply-To uses either labeled email ID from this form without changing schema or settings', () => {
  const live = schema(), originalSchema = structuredClone(live), candidate = settings(), originalSettings = structuredClone(candidate);
  validateRegisteredSettings('form', candidate, live);
  validateRegisteredSettings('form', { ...candidate, email_reply_to: 'alternate_email' }, live);
  assert.deepEqual(live, originalSchema); assert.deepEqual(candidate, originalSettings);
  assert.deepEqual(live.controls.email_reply_to.options, { '': '' });
});
test('blank Reply-To retains its original registered default behavior', () => {
  validateRegisteredSettings('form', { email_reply_to: '' }, schema());
});
for (const variant of ['unknown', 'nonemail', 'unlabeled', 'whitespace-label', 'duplicate', 'nonemail-duplicate', 'wrong-form', 'malformed-id', 'missing-id', 'malformed-row'] as const) test(`Reply-To rejects ${variant} same-form context`, () => {
  const candidate: any = settings();
  if (variant === 'unknown') candidate.email_reply_to = 'missing';
  if (variant === 'nonemail') candidate.email_reply_to = 'name';
  if (variant === 'unlabeled') candidate.form_fields[0].field_label = '';
  if (variant === 'whitespace-label') candidate.form_fields[0].field_label = '   ';
  if (variant === 'duplicate') candidate.form_fields[1].custom_id = 'contact_email';
  if (variant === 'nonemail-duplicate') candidate.form_fields[2].custom_id = 'contact_email';
  if (variant === 'wrong-form') candidate.form_fields = [{ field_type: 'email', custom_id: 'another_form_email', field_label: 'Another' }];
  if (variant === 'malformed-id') candidate.form_fields[0].custom_id = candidate.email_reply_to = 'email with spaces';
  if (variant === 'missing-id') delete candidate.form_fields[2].custom_id;
  if (variant === 'malformed-row') candidate.form_fields[2] = null;
  assert.throws(() => validateRegisteredSettings('form', candidate, schema()), /form\.email_reply_to/);
});
for (const variant of ['control-type', 'default', 'options', 'render-type', 'activation-condition', 'repeater-type', 'field-type', 'email-option', 'custom-id-control', 'label-control'] as const) test(`Reply-To rejects registered schema drift: ${variant}`, () => {
  const live: any = schema();
  if (variant === 'control-type') live.controls.email_reply_to.type = 'text';
  if (variant === 'default') live.controls.email_reply_to.default = 'unknown';
  if (variant === 'options') live.controls.email_reply_to.options = { '': '', contact_email: 'Stale context' };
  if (variant === 'render-type') live.controls.email_reply_to.render_type = 'template';
  if (variant === 'activation-condition') live.controls.email_reply_to.condition = { submit_actions: 'other' };
  if (variant === 'repeater-type') live.controls.form_fields.type = 'repeater';
  if (variant === 'field-type') live.controls.form_fields.fields.field_type.type = 'text';
  if (variant === 'email-option') live.controls.form_fields.fields.field_type.options = { text: 'Text' };
  if (variant === 'custom-id-control') live.controls.form_fields.fields.custom_id.type = 'number';
  if (variant === 'label-control') live.controls.form_fields.fields.field_label.type = 'number';
  assert.throws(() => validateRegisteredSettings('form', settings(), live));
});
test('non-form, secondary Reply-To, unrelated selects and inactive email action remain strict', () => {
  assert.throws(() => validateRegisteredSettings('other-widget', settings(), schema()), /Invalid setting option/);
  assert.throws(() => validateRegisteredSettings('form', { ...settings(), email_reply_to: '', email_reply_to_2: 'contact_email' }, schema()), /email_reply_to_2/);
  assert.throws(() => validateRegisteredSettings('form', { ...settings(), other_select: 'contact_email' }, schema()), /other_select/);
  assert.throws(() => validateRegisteredSettings('form', { ...settings(), submit_actions: ['save-to-database'] }, schema()), /Inactive setting/);
});
test('array-shaped native field declarations use the same bounded context', () => {
  const live = schema(), fields = live.controls.form_fields.fields as Record<string, ControlSchema>;
  live.controls.form_fields.fields = Object.entries(fields).map(([name, control]) => ({ ...control, name }));
  validateRegisteredSettings('form', settings(), live);
});

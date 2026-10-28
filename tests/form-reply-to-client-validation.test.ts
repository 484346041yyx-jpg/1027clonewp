import test from 'node:test';
import assert from 'node:assert/strict';
import { WordPressClient } from '../src/wordpress/client.js';

function fixture() {
  const client = new WordPressClient({ targetUrl: 'https://fixture.example/', username: 'fixture', applicationPassword: 'fixture', fetch: async () => { throw Error('No network expected'); } });
  const schema = { controls: {
    form_fields: { type: 'form-fields-repeater', fields: {
      field_type: { type: 'select', options: { email: 'Email', text: 'Text' } },
      custom_id: { type: 'text' }, field_label: { type: 'text' },
    } },
    submit_actions: { type: 'select', options: { email: 'Email' } },
    email_reply_to: { type: 'select', default: '', options: { '': '' }, render_type: 'none', condition: { submit_actions: 'email' } },
  } };
  const internal = client as unknown as { capabilities: unknown; validateLegacy: (elements: unknown[]) => void };
  internal.capabilities = { legacySchemas: { form: schema } };
  const node = (replyTo: string) => [{ id: 'abcd1234', elType: 'widget', widgetType: 'form', settings: {
    form_fields: [{ field_type: 'email', custom_id: 'contact_email', field_label: 'Email' }],
    email_reply_to: replyTo,
  }, elements: [] }];
  return { internal, node };
}

test('final WordPress draft validator accepts Reply-To derived from the same form email field', () => {
  const { internal, node } = fixture();
  assert.doesNotThrow(() => internal.validateLegacy(node('contact_email')));
  assert.doesNotThrow(() => internal.validateLegacy(node('')));
});

test('final WordPress draft validator rejects an unknown Reply-To', () => {
  const { internal, node } = fixture();
  assert.throws(() => internal.validateLegacy(node('unknown')), /unsupported value/);
});

test('final WordPress draft validator leaves unrelated selects strict', () => {
  const { internal, node } = fixture();
  const elements = node('contact_email');
  (elements[0].settings as Record<string, unknown>).submit_actions = 'other';
  assert.throws(() => internal.validateLegacy(elements), /unsupported value/);
});

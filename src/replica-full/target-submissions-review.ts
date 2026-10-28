import path from 'node:path';
import { createHash } from 'node:crypto';
import { native44Id } from '../native44/adapters.js';
import { assertNative44PendingFormCapability, bindPendingFormAttributeAuthorization, native44PendingFormBinding, prepareNative44PendingFormCapabilities } from '../native44/pending-form.js';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { LegacySchema } from '../wordpress/types.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge, type Native44Control } from '../native44/knowledge.js';
import { INQUIRY_ACTIONS, INQUIRY_EMAIL_CONTROLS } from '../native44/inquiry-form.js';

type Reference = { path: string; sha256: string };
type ReadEvidence = (reference: Reference, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
export interface TargetSubmissionFormReviewAuthorization { readonly kind: 'target-submissions-form-review'; }
type ExpectedForm = { elementId: string; settings: Record<string, any>; configurator?: ConfiguratorFormExtension };
export interface ConfiguratorFormExtension { formWidgetId: string; summaryField: string; uploadField: string }
const authorizations = new WeakMap<object, { pageId: number; forms: ExpectedForm[] }>();
function fail(reason: string): never { throw Error(`replica_full_target_submission_review_${reason}`); }
const attributes = (node: any): Record<string, string> => Object.fromEntries((node.attrs ?? []).map((attribute: any) => [attribute.name, attribute.value]));
const descendants = (node: any): any[] => (node.childNodes ?? []).flatMap((child: any) => [child, ...descendants(child)]);
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
const text = (node: any): string => node.nodeName === '#text' ? node.value : ['script', 'style'].includes(node.tagName) ? '' : (node.childNodes ?? []).map(text).join('');
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => [name, JSON.parse(canonical(item))])) : value);

function assertCurrentSettings(original: Record<string, any>, actual: Record<string, any>, controls: Native44Control[], inquiry = false): void {
  if (!same(actual.submit_actions, inquiry ? [...INQUIRY_ACTIONS] : ['save-to-database']) || actual.button_text !== original.button_text || !Array.isArray(actual.form_fields) || actual.form_fields.length !== original.form_fields.length) fail('current_form_policy');
  for (const [index, expected] of original.form_fields.entries()) {
    const before = structuredClone(expected), after = structuredClone(actual.form_fields[index]);
    if (!after || typeof after._id !== 'string' || !/^[a-f0-9]{7}$/.test(after._id) || before._id !== undefined && before._id !== after._id) fail('current_field_identity');
    delete before._id; delete after._id;
    // Elementor omits repeater values equal to its registered defaults on save.
    // Accept only these exact default omissions; explicit conflicting values still fail.
    for (const [name, defaultValue] of Object.entries({ width: '100', field_type: 'text', required: '', placeholder: '' })) {
      if (before[name] === defaultValue && after[name] === undefined) delete before[name];
    }
    if (canonical(before) !== canonical(after)) fail('current_field_definition');
  }
  const paint = new Set(controls.filter(control => ['direct-css', 'direct-class', 'css-variable', 'wrapper-class'].includes(control.effectClass ?? '')).map(control => control.id));
  // Elementor materializes these registered widget defaults when reopening and
  // saving a form. They do not change the submitted fields or delivery policy.
  const materializedDefaults: Record<string, string | number> = {
    form_name: 'New Form', step_next_label: 'Next', step_previous_label: 'Previous',
    success_message: 'Your submission was successful.',
    error_message: 'Your submission failed because of an error.',
    server_message: 'Your submission failed because of a server error.',
    invalid_message: 'Your submission failed because the form is invalid.',
    required_field_message: 'This field is required.', scroll_y: -80,
    email_subject: 'New message from "cloneWP 固定测试站"',
    email_to_2: '484346041yyx@gmail.com',
    email_subject_2: 'New message from "cloneWP 固定测试站"',
    email_content_2: '[all-fields]', email_from_2: 'email@jiangubottle.com',
    email_from_name_2: 'cloneWP 固定测试站',
    email_reply_to_2: '484346041yyx@gmail.com',
  };
  for (const name of new Set([...Object.keys(original), ...Object.keys(actual)])) {
    if (inquiry && original[name] === undefined && actual[name] === materializedDefaults[name] && Object.hasOwn(materializedDefaults, name)) continue;
    if (/^(?:email|webhook|redirect|mailchimp|mailerlite|activecampaign|convertkit|drip|getresponse|slack|discord|popup|custom_css)(?:_|$)/i.test(name) && actual[name] !== undefined && !(inquiry && (INQUIRY_EMAIL_CONTROLS as readonly string[]).includes(name))) fail('current_business_setting');
    if (inquiry && (INQUIRY_EMAIL_CONTROLS as readonly string[]).includes(name) && canonical(original[name]) !== canonical(actual[name])) fail(`current_inquiry_setting_${name}`);
    if (name === 'form_fields' || ['css_classes', '_css_classes', '_title'].includes(name) || paint.has(name)) continue;
    if (original[name] === undefined && actual[name] === materializedDefaults[name] && Object.hasOwn(materializedDefaults, name)) continue;
    if (name === '_attributes' && original[name] === '' && actual[name] === undefined) continue;
    if (canonical(original[name]) !== canonical(actual[name])) fail('current_nonstyle_setting');
  }
}

export async function prepareTargetSubmissionFormReview(input: { root: string; program: Native44Program; css?:string; pageId: number; currentElements?: unknown[]; read: ReadEvidence; configurator?: ConfiguratorFormExtension }): Promise<TargetSubmissionFormReviewAuthorization> {
  const nodes = walkNative44(input.program.blocks).filter(node => node.kind === 'native' && node.widgetType === 'form' && [3,4].includes(node.pendingForm?.version ?? 0));
  const forms: ExpectedForm[] = [];
  if (nodes.length) {
    if (!Number.isSafeInteger(input.pageId) || input.pageId < 1 || !Array.isArray(input.currentElements)) fail('current_elements_required');
    const flatten = (elements: any[]): any[] => elements.flatMap(element => [element, ...flatten(Array.isArray(element?.elements) ? element.elements : [])]);
    const current = flatten(input.currentElements);
    const capabilities = await prepareNative44PendingFormCapabilities({ root: input.root, program: input.program,css:input.css });
    const loaded = await loadNative44Knowledge(['form'], path.dirname(path.resolve(input.root, input.program.knowledge.path)));
    const knowledgeFile = await input.read(input.program.knowledge), knowledge = JSON.parse(knowledgeFile.bytes.toString('utf8'));
    for (const reference of [knowledge.components?.form, knowledge.sharedControls]) {
      if (!reference) fail('knowledge_reference');
      await input.read(reference, path.dirname(knowledgeFile.filename));
    }
    for (const node of nodes) {
      if (node.kind !== 'native' || !node.pendingForm || ![3,4].includes(node.pendingForm.version)) fail('declaration');
      const elementId = native44Id(input.program.taskId, node.key), matches = current.filter(element => element?.id === elementId);
      if (matches.length !== 1 || matches[0].elType !== 'widget' || matches[0].widgetType !== 'form' || matches[0].elements?.length || !matches[0].settings || typeof matches[0].settings !== 'object') fail('current_form_identity');
      const registration = JSON.parse((await input.read(node.pendingForm.registered.capabilities)).bytes.toString('utf8'));
      const schema = registration.legacySchemas?.form as LegacySchema;
      const capability = capabilities.find(capability => capability.componentKey === node.key);
      assertNative44PendingFormCapability(input.program, node, { form: schema }, capability);
      const settings = matches[0].settings;
      if (input.configurator?.formWidgetId === elementId) {
        if (!Array.isArray(settings.form_fields) || settings.form_fields.length < 3 ||
            input.configurator.summaryField !== 'configuration' || input.configurator.uploadField !== 'logo') fail('configurator_fields');
        const rowId = (name: string) => createHash('sha256').update(`native-form-field\u0000${elementId}:${name}`).digest('hex').slice(0, 7);
        const summary = { _id: rowId('configuration'), custom_id: 'configuration', field_type: 'hidden', field_label: 'Bottle configuration', required: '', width: '100' };
        const upload = { _id: rowId('logo'), custom_id: 'logo', field_type: 'upload', field_label: 'Logo', required: '', width: '100', file_types: 'png,jpg,jpeg,webp', file_sizes: 5, allow_multiple_upload: '', attachment_type: 'link' };
        if (canonical(settings.form_fields.at(-2)) !== canonical(summary) || canonical(settings.form_fields.at(-1)) !== canonical(upload)) fail('configurator_fields');
      }
      const projectedSettings = input.configurator?.formWidgetId === elementId
        ? { ...settings, form_fields: settings.form_fields.slice(0, -2) } : settings;
      const inquiry = node.pendingForm.version === 4;
      assertCurrentSettings(node.widgetSettings, projectedSettings, loaded.components.form!.controls,inquiry);
      toNative44CompilerKnowledge(loaded, { form: schema }).validateSettings('form', projectedSettings);
      // The readback has already been checked against the declared fields.
      // Reconstitute omitted repeater defaults for the native capability check.
      if (!Array.isArray(node.widgetSettings.form_fields)) fail('declared_form_fields');
      const declaredFields = node.widgetSettings.form_fields as Record<string, unknown>[];
      const semanticSettings = {
        ...structuredClone(node.widgetSettings),
        form_fields: (projectedSettings.form_fields as Record<string, any>[]).map((field, index) => ({
          ...structuredClone(declaredFields[index]), _id: field._id,
        })),
      };
      const permission = bindPendingFormAttributeAuthorization(capability!, elementId, semanticSettings, schema);
      const receipt = native44PendingFormBinding(capability!, permission, semanticSettings);
      if (receipt.kind !== (inquiry ? 'native44-inquiry-configured' : 'native44-target-submissions-only-configured') || receipt.decision?.taskId !== input.program.taskId || !same(settings.submit_actions, inquiry ? [...INQUIRY_ACTIONS] : ['save-to-database'])) fail('current_form_policy');
      for (const reference of [receipt.sourceFacts, receipt.appearance, receipt.registered.capabilities, ...receipt.packets]) await input.read(reference);
      forms.push({ elementId, settings: structuredClone(settings), ...(input.configurator?.formWidgetId === elementId ? { configurator: input.configurator } : {}) });
    }
  }
  const authorization = Object.freeze({ kind: 'target-submissions-form-review' as const });
  authorizations.set(authorization, { pageId: input.pageId, forms });
  return authorization;
}

function assertTargetFormDOM(form: any, expected: ExpectedForm, pageId: number): void {
  const formAttributes = attributes(form);
  if (form.tagName !== 'form' || !String(formAttributes.class ?? '').split(/\s+/).includes('elementor-form') || String(formAttributes.method).toLowerCase() !== 'post' || formAttributes.action) fail('form_dom');
  let ancestor = form.parentNode, widget: any, root: any;
  while (ancestor) {
    const value = attributes(ancestor);
    if (Object.hasOwn(value, 'inert')) fail('form_inert');
    if (!widget && value['data-widget_type']) widget = ancestor;
    if (value['data-elementor-id']) { root = ancestor; break; }
    ancestor = ancestor.parentNode;
  }
  const widgetAttributes = widget && attributes(widget), rootAttributes = root && attributes(root);
  if (!widgetAttributes || widgetAttributes['data-id'] !== expected.elementId || widgetAttributes['data-widget_type'] !== 'form.default' || !String(widgetAttributes.class ?? '').split(/\s+/).includes(`elementor-element-${expected.elementId}`) || rootAttributes?.['data-elementor-id'] !== String(pageId)) fail('dom_owner');
  const children = descendants(form), controls = children.filter(node => ['input', 'select', 'textarea', 'button'].includes(node.tagName));
  if ([form, ...children].some(node => Object.keys(attributes(node)).some(name => /^on/i.test(name) || ['formaction', 'formmethod', 'formtarget'].includes(name)))) fail('dom_submission_override');
  const hidden = controls.filter(node => node.tagName === 'input' && attributes(node).type === 'hidden');
  for (const [name, value] of [['post_id', String(pageId)], ['form_id', expected.elementId]]) {
    const matches = hidden.filter(node => attributes(node).name === name);
    if (matches.length !== 1 || attributes(matches[0]).value !== value) fail('dom_submission_identity');
  }
  const fields = expected.settings.form_fields as Record<string, any>[];
  const summary = expected.configurator ? fields.filter(field => field.field_type === 'hidden' && field.custom_id === expected.configurator?.summaryField) : [];
  if (expected.configurator && summary.length !== 1) fail('dom_extra_hidden_control');
  const metadata = new Set(['post_id', 'form_id', 'referer_title', 'queried_id']);
  if (hidden.some(node => !metadata.has(attributes(node).name) &&
      !summary.some(field => attributes(node).name === `form_fields[${field.custom_id}]` && attributes(node).id === `form-field-${field.custom_id}`))) fail('dom_extra_hidden_control');
  for (const field of summary) if (hidden.filter(node => attributes(node).name === `form_fields[${field.custom_id}]`).length !== 1) fail('dom_extra_hidden_control');
  const publicControls = controls.filter(node => !(node.tagName === 'input' && attributes(node).type === 'hidden'));
  const visibleFields = fields.filter(field => field.field_type !== 'hidden');
  if (publicControls.length !== visibleFields.length + 1) fail('dom_field_count');
  for (const [index, field] of visibleFields.entries()) {
    const actual = publicControls[index], value = attributes(actual), type = field.field_type;
    if (actual.tagName !== (['select', 'textarea'].includes(type) ? type : 'input') || actual.tagName === 'input' && value.type !== (type === 'upload' ? 'file' : type) || value.name !== `form_fields[${field.custom_id}]` || value.id !== `form-field-${field.custom_id}` || (value.placeholder ?? '') !== (field.placeholder ?? '') || Object.hasOwn(value, 'required') !== (field.required === 'true') || ['disabled', 'readonly', 'form'].some(name => Object.hasOwn(value, name))) fail('dom_field_definition');
    if (actual.tagName === 'select') {
      const options = descendants(actual).filter(node => node.tagName === 'option').map(node => [text(node).trim(), attributes(node).value ?? text(node).trim()]);
      const expectedOptions = String(field.field_options).split('\n').map(option => { const parts = option.split('|'); return [parts[0].trim(), parts[1] ?? parts[0]]; });
      if (!same(options, expectedOptions) || Object.hasOwn(value, 'multiple') !== ['true', 'yes'].includes(field.allow_multiple)) fail('dom_select_options');
    }
    const labels = children.filter(node => node.tagName === 'label' && attributes(node).for === value.id);
    if (expected.settings.show_labels === 'true' && field.field_label ? labels.length !== 1 || normalized(text(labels[0])) !== normalized(field.field_label) : labels.some(node => normalized(text(node)))) fail('dom_field_label');
  }
  const submit = publicControls.at(-1), submitAttributes = attributes(submit);
  if (!['input', 'button'].includes(submit.tagName) || submitAttributes.type !== 'submit' || Object.hasOwn(submitAttributes, 'disabled') || normalized(submit.tagName === 'input' ? submitAttributes.value ?? '' : text(submit)) !== normalized(expected.settings.button_text)) fail('dom_submit');
}

export function withoutAuthorizedTargetSubmissionForms(actualForms: any[], authorization: TargetSubmissionFormReviewAuthorization): any[] {
  const proof = authorizations.get(authorization);
  if (!proof) fail('authorization');
  const matched = new Set<any>();
  for (const expected of proof.forms) {
    const candidates = actualForms.filter(form => {
      let current = form.parentNode;
      while (current) { const value = attributes(current); if (value['data-widget_type']) return value['data-id'] === expected.elementId; current = current.parentNode; }
      return false;
    });
    if (candidates.length !== 1 || matched.has(candidates[0])) fail('dom_form_count');
    assertTargetFormDOM(candidates[0], expected, proof.pageId);
    matched.add(candidates[0]);
  }
  return actualForms.filter(form => !matched.has(form));
}

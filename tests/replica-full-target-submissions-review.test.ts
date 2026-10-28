import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { parseFragment } from 'parse5';
import { native44Id, native44ModuleClass } from '../src/native44/adapters.js';
import { loadNative44Knowledge, native44KnowledgeIdentity } from '../src/native44/knowledge.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { native44RegisteredSchemaHash } from '../src/native44/selection.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { prepareTargetSubmissionFormReview, withoutAuthorizedTargetSubmissionForms } from '../src/replica-full/target-submissions-review.js';
import type { Native44Program } from '../src/native44/types.js';
import sharp from 'sharp';
import { verifyFullReplicaReviewEvidence } from '../src/replica-full/body.js';
import { fullReplicaFingerprint } from '../src/replica-full/contract.js';

const ROOT = 'D:/cloneWP';
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const directory = await mkdtemp(path.join(ROOT, 'tests/.tmp-submission-review-'));
  const put = async (name: string, input: unknown) => { const filename = path.join(directory, name), bytes = JSON.stringify(input); await writeFile(filename, bytes); return { path: filename, sha256: hash(bytes) }; };
  const taskId = 'submission-review-fixture', pageId = 777, key = 'quote-form', elementId = native44Id(taskId, key);
  const knowledge = await loadNative44Knowledge(['form']), identity = await native44KnowledgeIdentity(ROOT);
  const schema: any = { type: 'form', class: 'ElementorPro\\Modules\\Forms\\Widgets\\Form', controls: { form_fields: { type: 'form-fields-repeater', fields: { _id: { type: 'hidden' }, field_type: { type: 'select', options: { email: 'Email', select: 'Select' } }, field_label: { type: 'text' }, placeholder: { type: 'text' }, required: { type: 'switcher', return_value: 'true', options: { true: 'Yes' } }, width: { type: 'select', options: { 100: '100%' } }, custom_id: { type: 'text' }, field_options: { type: 'textarea' } } }, button_text: { type: 'text' }, submit_actions: { type: 'select2', multiple: true, options: { 'save-to-database': 'Collect Submissions', email: 'Email' } }, field_background_color: { type: 'color', selectors: { '{{WRAPPER}} .elementor-field': 'background-color: {{VALUE}};' } }, _attributes: { type: 'textarea' }, _css_classes: { type: 'text' } } };
  const registered = await put('registered.json', { legacySchemas: { form: schema }, versions: { elementor: 'synthetic', elementorPro: 'synthetic' } });
  const sourceControls: any[] = [], snapshots: any[] = [], facts: any = {}, appearanceRows: any[] = [];
  for (const [index, viewport] of native44ProfileViewports('desktop-browser-v1').entries()) {
    const snapshotId = `snapshot-${index}`, formId = `form-${index}`, emailId = `email-${index}`, selectId = `select-${index}`, submitId = `submit-${index}`;
    const owner = JSON.stringify({ nodeId: formId, submitControlNodeId: submitId });
    const interaction = (nodeId: string, type: string) => ({ id: `interaction-${nodeId}`, nodeId, regionId: 'quote', kind: 'control', status: 'unobserved', selector: `#${nodeId}`, details: { type, form: owner } });
    const nodes: any = {
      [formId]: { id: formId, tag: 'form', selector: `#${formId}`, parentId: null, visible: true, layoutId: 'form-layout', attributes: {} },
      [emailId]: { id: emailId, tag: 'input', selector: `#${emailId}`, parentId: formId, visible: true, styleId: 'field', layoutId: 'field-layout', attributes: { type: 'email', placeholder: 'Email', required: '' } },
      [selectId]: { id: selectId, tag: 'select', selector: `#${selectId}`, parentId: formId, visible: true, styleId: 'field', layoutId: 'field-layout', attributes: {} },
      [submitId]: { id: submitId, tag: 'input', selector: `#${submitId}`, parentId: formId, visible: true, styleId: 'field', layoutId: 'field-layout', attributes: { type: 'submit', value: 'Send' } },
      option1: { id: 'option1', tag: 'option', parentId: selectId, text: '', attributes: { value: '' } },
      option2: { id: 'option2', tag: 'option', parentId: selectId, text: '+1', attributes: { value: '+1' } },
      option3: { id: 'option3', tag: 'option', parentId: selectId, text: '+1', attributes: { value: '+1' } },
    };
    const interactions = { email: interaction(emailId, 'email'), select: interaction(selectId, 'select'), submit: interaction(submitId, 'submit') };
    const packet = { version: 2, kind: 'observation-packet', snapshot: { id: snapshotId, viewport }, nodes, styles: { field: { display: 'block', visibility: 'visible' } }, layouts: { 'form-layout': { rect: { x: 0, y: 0, width: 200, height: 200 } }, 'field-layout': { rect: { x: 0, y: 0, width: 200, height: 30 } } }, interactions };
    const evidence = await put(`packet-${index}.json`, packet);
    for (const [name, value] of Object.entries(interactions)) facts[`${snapshotId}:${name}`] = { kind: 'interaction', snapshotId, nodeId: value.nodeId, regionId: 'quote', value, evidence };
    snapshots.push({ id: snapshotId, viewport, nodes }); sourceControls.push({ snapshotId, fieldFactIds: [`${snapshotId}:email`, `${snapshotId}:select`], submitFactId: `${snapshotId}:submit` }); appearanceRows.push({ packet: evidence, nodes: Object.values(nodes) });
  }
  const sourceFacts = await put('source.json', { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', snapshots, facts });
  const node: any = { kind: 'native', key, widgetType: 'form', sourceFactIds: Object.keys(facts), widgetSettings: { form_fields: [{ field_type: 'email', field_label: '', placeholder: 'Email', required: 'true', width: '100', custom_id: 'email' }, { field_type: 'select', field_label: '', placeholder: '', required: '', width: '100', custom_id: 'code', field_options: '|\n+1|+1\n+1|+1' }], button_text: 'Send', submit_actions: ['save-to-database'] }, pendingForm: { version: 3, kind: 'native44-target-submissions-only-v1', decision: { policy: 'target-submissions-only', taskId, authorization: 'user-explicit' }, sourceControls, appearance: await put('appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: appearanceRows }), registered: { capabilities: registered, schemaHash: native44RegisteredSchemaHash(schema) }, knowledge: { fingerprint: knowledge.index.fingerprint, formComponentHash: knowledge.index.components.form.sha256, sharedControlsHash: knowledge.index.sharedControls.sha256 } } };
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', requirementProfile: 'source-requirements-v1', goalProfile: 'component-reference-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId, title: 'Synthetic form review', sourceUrl: 'https://source.example/', ...identity, sourceFacts, componentPlan: sourceFacts, assetsManifest: sourceFacts, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'quote', children: [node] }] };
  const currentElements: any[] = [{ id: elementId, elType: 'widget', widgetType: 'form', settings: { ...structuredClone(node.widgetSettings), _css_classes: native44ModuleClass(key), form_fields: node.widgetSettings.form_fields.map((field: any, index: number) => ({ ...field, _id: `aaaaaa${index}` })) }, elements: [] }];
  const read = async (reference: { path: string; sha256: string }, base = ROOT) => { const filename = path.resolve(base, reference.path), bytes = await readFile(filename); assert.equal(hash(bytes), reference.sha256); return { filename, bytes }; };
  const html = `<div data-elementor-id="${pageId}" class="elementor-${pageId}"><div data-id="${elementId}" data-widget_type="form.default" class="elementor-element-${elementId}"><form class="elementor-form" method="post"><input type="hidden" name="post_id" value="${pageId}"><input type="hidden" name="form_id" value="${elementId}"><input id="form-field-email" name="form_fields[email]" type="email" placeholder="Email" required><select id="form-field-code" name="form_fields[code]"><option value=""></option><option value="+1">+1</option><option value="+1">+1</option></select><button type="submit"><span>Send</span></button></form></div></div>`;
  const parseForms = (value = html) => { const walk = (item: any): any[] => [item, ...(item.childNodes ?? []).flatMap(walk)]; return walk(parseFragment(value)).filter(item => item.tagName === 'form'); };
  const prepare = () => prepareTargetSubmissionFormReview({ root: ROOT, program, pageId, currentElements, read });
  return { directory, put, node, program, pageId, elementId, currentElements, html, parseForms, prepare, cleanup: async () => { assert.equal(path.dirname(directory), path.join(ROOT, 'tests')); assert.ok(path.basename(directory).startsWith('.tmp-submission-review-')); await rm(directory, { recursive: true }); } };
}

test('only factory-authorized database-only forms with exact current models and DOM are removed from the unknown-active-form set', async () => {
  const fixtureData = await fixture();
  try {
    const authorization = await fixtureData.prepare();
    assert.deepEqual(withoutAuthorizedTargetSubmissionForms(fixtureData.parseForms(), authorization), []);
    const forms = fixtureData.parseForms(fixtureData.html + '<form id="unknown"><input></form>');
    assert.deepEqual(withoutAuthorizedTargetSubmissionForms(forms, authorization), [forms[1]]);
    assert.throws(() => withoutAuthorizedTargetSubmissionForms(forms, structuredClone(authorization)), /authorization/);
  } finally { await fixtureData.cleanup(); }
});

test('exact configurator Form extension keeps native submission policy and DOM checks', async () => {
  const f = await fixture();
  try {
    const rowId = (name: string) => hash(`native-form-field\u0000${f.elementId}:${name}`).slice(0, 7);
    const fields = f.currentElements[0].settings.form_fields;
    fields.push({ _id: rowId('configuration'), custom_id: 'configuration', field_type: 'hidden', field_label: 'Bottle configuration', required: '', width: '100' });
    fields.push({ _id: rowId('logo'), custom_id: 'logo', field_type: 'upload', field_label: 'Logo', required: '', width: '100', file_types: 'png,jpg,jpeg,webp', file_sizes: 5, allow_multiple_upload: '', attachment_type: 'link' });
    const configurator = { formWidgetId: f.elementId, summaryField: 'configuration', uploadField: 'logo' };
    const authorization = await prepareTargetSubmissionFormReview({ root: ROOT, program: f.program, pageId: f.pageId,
      currentElements: f.currentElements, read: async (ref, base = ROOT) => { const filename = path.resolve(base, ref.path), bytes = await readFile(filename); return { filename, bytes }; }, configurator });
    const html = f.html.replace('<button type="submit">', '<input id="form-field-configuration" name="form_fields[configuration]" type="hidden"><input id="form-field-logo" name="form_fields[logo]" type="file"><button type="submit">');
    assert.deepEqual(withoutAuthorizedTargetSubmissionForms(f.parseForms(html), authorization), []);
    const bad = f.parseForms(html.replace('name="form_fields[configuration]"', 'name="form_fields[forged]"'));
    assert.throws(() => withoutAuthorizedTargetSubmissionForms(bad, authorization), /dom_extra_hidden_control/);
    fields[2].file_sizes = 99;
    await assert.rejects(() => prepareTargetSubmissionFormReview({ root: ROOT, program: f.program, pageId: f.pageId,
      currentElements: f.currentElements, read: async (ref, base = ROOT) => { const filename = path.resolve(base, ref.path), bytes = await readFile(filename); return { filename, bytes }; }, configurator }), /configurator_fields/);
  } finally { await f.cleanup(); }
});

test('registered non-business paint may be resolved without changing the source-authorized form semantics', async () => {
  const fixtureData = await fixture();
  try {
    fixtureData.currentElements[0].settings.field_background_color = 'rgb(255,255,255)';
    delete fixtureData.currentElements[0].settings.form_fields[1].placeholder;
    const authorization = await fixtureData.prepare();
    assert.deepEqual(withoutAuthorizedTargetSubmissionForms(fixtureData.parseForms(), authorization), []);
  } finally { await fixtureData.cleanup(); }
});

for (const scenario of ['missing-current', 'duplicate-current', 'wrong-widget', 'current-email-action', 'current-field-change', 'current-webhook-setting', 'current-inline-attribute', 'forged-declaration'] as const) test(`target submissions review rejects ${scenario} before DOM exemption`, async () => {
  const fixtureData = await fixture();
  try {
    if (scenario === 'missing-current') fixtureData.currentElements.length = 0;
    if (scenario === 'duplicate-current') fixtureData.currentElements.push(structuredClone(fixtureData.currentElements[0]));
    if (scenario === 'wrong-widget') fixtureData.currentElements[0].widgetType = 'html';
    if (scenario === 'current-email-action') fixtureData.currentElements[0].settings.submit_actions.push('email');
    if (scenario === 'current-field-change') fixtureData.currentElements[0].settings.form_fields[0].placeholder = 'Changed';
    if (scenario === 'current-webhook-setting') fixtureData.currentElements[0].settings.webhook_url = 'https://foreign.example/';
    if (scenario === 'current-inline-attribute') fixtureData.currentElements[0].settings._attributes = 'onsubmit|send()';
    if (scenario === 'forged-declaration') fixtureData.node.pendingForm.registered.schemaHash = '0'.repeat(64);
    await assert.rejects(fixtureData.prepare);
  } finally { await fixtureData.cleanup(); }
});

for (const scenario of ['wrong-post', 'wrong-form', 'wrong-owner', 'wrong-root', 'external-action', 'inline-handler', 'extra-control', 'disabled-field', 'wrong-required', 'wrong-field-name', 'missing-option', 'changed-submit', 'duplicate-form', 'missing-form'] as const) test(`target submissions review rejects DOM ${scenario}`, async () => {
  const fixtureData = await fixture();
  try {
    const authorization = await fixtureData.prepare();
    let html = fixtureData.html;
    if (scenario === 'wrong-post') html = html.replace(`name="post_id" value="${fixtureData.pageId}"`, 'name="post_id" value="9"');
    if (scenario === 'wrong-form') html = html.replace(`name="form_id" value="${fixtureData.elementId}"`, 'name="form_id" value="abcdef1"');
    if (scenario === 'wrong-owner') html = html.replace('data-widget_type="form.default"', 'data-widget_type="html.default"');
    if (scenario === 'wrong-root') html = html.replace(`data-elementor-id="${fixtureData.pageId}"`, 'data-elementor-id="1"');
    if (scenario === 'external-action') html = html.replace('method="post"', 'method="post" action="https://foreign.example/"');
    if (scenario === 'inline-handler') html = html.replace('method="post"', 'method="post" onsubmit="send()"');
    if (scenario === 'extra-control') html = html.replace('</form>', '<input name="extra"></form>');
    if (scenario === 'disabled-field') html = html.replace('placeholder="Email"', 'placeholder="Email" disabled');
    if (scenario === 'wrong-required') html = html.replace(' required>', '>');
    if (scenario === 'wrong-field-name') html = html.replace('form_fields[email]', 'form_fields[foreign]');
    if (scenario === 'missing-option') html = html.replace('<option value="+1">+1</option>', '');
    if (scenario === 'changed-submit') html = html.replace('<span>Send</span>', '<span>Other</span>');
    const forms = scenario === 'missing-form' ? [] : fixtureData.parseForms(html);
    if (scenario === 'duplicate-form') forms.push(forms[0]);
    assert.throws(() => withoutAuthorizedTargetSubmissionForms(forms, authorization));
  } finally { await fixtureData.cleanup(); }
});

test('legacy inert form declarations never acquire an active-form exemption', async () => {
  const fixtureData = await fixture();
  try {
    fixtureData.node.pendingForm.version = 2;
    const authorization = await fixtureData.prepare();
    const forms = fixtureData.parseForms();
    assert.deepEqual(withoutAuthorizedTargetSubmissionForms(forms, authorization), forms);
  } finally { await fixtureData.cleanup(); }
});

test('full review admits the exact authorized native form but still refuses an additional active form', async () => {
  const fixtureData = await fixture();
  try {
    const observedAt = new Date().toISOString(), digest = 'a'.repeat(64);
    const programReference = await fixtureData.put('review-program.json', fixtureData.program);
    const bound: any = { pageId: fixtureData.pageId, runId: 'submission-review-run', headerId: 'header_fixture', editUrl: 'https://target.example/edit', previewUrl: 'https://target.example/?page_id=777', bodyHash: digest, cssHash: digest, documentHash: digest, headerHash: digest, menuHash: digest, styleHash: digest };
    const fingerprint = fullReplicaFingerprint(bound), rows: any[] = [], views: any[] = [];
    const manifest: any = { version: 1, taskId: fixtureData.program.taskId, runId: bound.runId, sourceUrl: fixtureData.program.sourceUrl, targetOrigin: 'https://target.example', body: { program: programReference } };
    for (const [width, height] of [[1920, 1080], [1440, 1000]]) {
      const filename = path.join(fixtureData.directory, `review-${width}.png`), bytes = await sharp({ create: { width, height, channels: 3, background: '#abc' } }).png().toBuffer(); await writeFile(filename, bytes);
      const screenshot = { path: filename, sha256: hash(bytes) };
      const dom = await fixtureData.put(`dom-${width}.json`, { version: 1, kind: 'clonewp-full-replica-browser-dom', pageId: fixtureData.pageId, url: bound.previewUrl, observedAt, viewport: { width, height }, html: `<header class="whb-header whb-header_fixture"></header>${fixtureData.html}` });
      const state = { version: 1, kind: 'clonewp-full-replica-interaction-state', pageId: fixtureData.pageId, fingerprint, width, height, selector: '.synthetic-form-interaction', observedAt };
      const before = await fixtureData.put(`before-${width}.json`, { ...state, state: { changed: false } }), after = await fixtureData.put(`after-${width}.json`, { ...state, state: { changed: true } });
      const interactions = await fixtureData.put(`interactions-${width}.json`, { version: 1, kind: 'clonewp-full-replica-interactions', pageId: fixtureData.pageId, fingerprint, width, height, reviewSummary: 'Synthetic boundary fixture does not represent an actual target submission.', actions: [{ key: 'fixture', kind: 'form', selector: state.selector, summary: 'Synthetic fixture checks interaction evidence wiring.', expectedOutcome: 'changed', before, after }] });
      rows.push({ width, height, screenshot, dom, interactions }); views.push({ width, height, screenshot, visual: 'passed', interactions: 'passed', headerCount: 1, bodyHeaderCount: 0 });
    }
    const evidence = { version: 1, kind: 'clonewp-full-replica-review-evidence', taskId: manifest.taskId, runId: manifest.runId, pageId: fixtureData.pageId, fingerprint, viewports: rows };
    const review: any = { version: 1, kind: 'clonewp-full-replica-review', taskId: manifest.taskId, runId: manifest.runId, pageId: fixtureData.pageId, fingerprint, decision: 'approved', observedAt, viewports: views, reviewerEvidence: await fixtureData.put('review.json', evidence) };
    await verifyFullReplicaReviewEvidence(review, bound, manifest, fixtureData.currentElements);
    const changed = JSON.parse((await readFile(rows[0].dom.path)).toString('utf8'));
    changed.html = changed.html.replace('</form></div></div>', '</form></div><form><input></form></div>');
    rows[0].dom = await fixtureData.put('changed-dom.json', changed); review.reviewerEvidence = await fixtureData.put('review.json', evidence);
    await assert.rejects(verifyFullReplicaReviewEvidence(review, bound, manifest, fixtureData.currentElements), /active_pending_form/);
  } finally { await fixtureData.cleanup(); }
});

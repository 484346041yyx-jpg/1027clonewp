import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadNative44Knowledge, native44KnowledgeIdentity, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { native44RegisteredSchemaHash } from '../src/native44/selection.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { assertNative44PendingFormCandidate, assertNative44PendingFormCapability, assertPendingFormAttributeAuthorization, bindPendingFormAttributeAuthorization, native44PendingFormBinding, NATIVE44_PENDING_FORM_ATTRIBUTES, pendingFormAuthorizationForElement, prepareNative44PendingFormCapabilities, type PendingFormNode } from '../src/native44/pending-form.js';
import type { Native44Program } from '../src/native44/types.js';
import type { LegacySchema, CapabilityReport } from '../src/wordpress/types.js';
import { createPendingFormRegistryReader, probePendingFormCapabilities } from './fixtures/source-probes/probe-pending-form-capabilities.js';
import { compileNative44, assertNative44Compilation, assertNative44PendingFormCompilation } from '../src/native44/compiler.js';
import { resolvePendingFormStyles, derivePendingFormsForResponsive } from '../src/native44/pending-form.js';
import { validatePlan, validateRegisteredSettings } from '../src/planning/plan.js';
import sharp from 'sharp';
import { configureInquiryBlocks, defaultInquiryPolicy, INQUIRY_EMAIL_CONTROLS, type InquiryConfiguration } from '../src/native44/inquiry-form.js';

const ROOT = path.resolve('D:/cloneWP');
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const loaded = await loadNative44Knowledge(['form']);
const knowledgeIdentity = await native44KnowledgeIdentity(ROOT);
/** A synthetic registered fixture, deliberately not current-target evidence. */
function registeredFixture(): LegacySchema {
  const fields = { field_type: { type: 'select', options: { email: 'Email' } }, field_label: { type: 'text' }, placeholder: { type: 'text' }, required: { type: 'switcher', default: '', options: { true: 'Yes' } }, width: { type: 'select', options: { '100': '100%' } }, custom_id: { type: 'text' }, _id: { type: 'hidden' } };
  return { type: 'form', class: 'ElementorPro\\Modules\\Forms\\Widgets\\Form', controls: { form_fields: { type: 'form-fields-repeater', fields }, button_text: { type: 'text' }, selected_button_icon: { type: 'icons' }, show_labels: { type: 'switcher' }, submit_actions: { type: 'select2', multiple: true, default: ['email'] }, _attributes: { type: 'textarea' }, _css_classes: { type: 'text' } } };
}
async function fixture(schemaOverride?: LegacySchema) {
  const dir = await mkdtemp(path.join(ROOT, 'tests', '.tmp-pending-form-'));
  const put = async (name: string, value: unknown) => { const file = path.join(dir, name), bytes = JSON.stringify(value); await writeFile(file, bytes); return { path: file, sha256: sha(bytes) }; };
  const schema = structuredClone(schemaOverride ?? registeredFixture()), registered = await put('registered.json', { mode: 'legacy-verified', legacySchemas: { form: schema }, versions: { elementor: 'test-version', elementorPro: 'test-version' }, sourceProof: { schemaErrors: {} } });
  const snapshots: any[] = [], facts: Record<string, any> = {}, sourceControls: any[] = [], appearanceRows: any[] = [];
  const packets: any[] = [];
  for (const [index, viewport] of native44ProfileViewports('desktop-browser-v1').entries()) {
    const id = `snapshot-${index}`, emailId = `email-${index}`, submitId = `submit-${index}`, formId = `form-${index}`;
    const form = JSON.stringify({ nodeId: formId, selector: `#${formId}`, submitControlNodeId: submitId, action: 'https://source.example/subscribe', method: 'post' });
    const interaction = (type: string, nodeId: string) => ({ id: `interaction-${nodeId}`, nodeId, regionId: 'region', kind: 'control', status: 'unobserved', selector: `#${nodeId}`, details: { type, form } });
    const nodes = {
      [formId]: { id: formId, tag: 'form', parentId: null, selector: `#${formId}`, visible: true, attributes: {}, childIds: [emailId, submitId] },
      [emailId]: { id: emailId, tag: 'input', parentId: formId, selector: `#${emailId}`, visible: true, attributes: { type: 'email', placeholder: 'Enter email' }, styleId: 'email-style', layoutId: 'email-layout' },
      [submitId]: { id: submitId, tag: 'input', parentId: formId, selector: `#${submitId}`, visible: true, attributes: { type: 'submit' }, styleId: 'submit-style', layoutId: 'submit-layout' },
    };
    const packet = { version: 2, kind: 'observation-packet', snapshot: { id, viewport }, nodes, styles: { 'email-style': { display: 'block', visibility: 'visible' }, 'submit-style': { display: 'block', visibility: 'visible' } }, layouts: { 'email-layout': { rect: { x: 0, y: 1, width: 200, height: 40 } }, 'submit-layout': { rect: { x: 200, y: 1, width: 80, height: 40 } } }, interactions: { email: interaction('email', emailId), submit: interaction('submit', submitId) } };
    const packetRef = await put(`packet-${index}.json`, packet); packets.push({ packet, packetRef });
    for (const [kind, nodeId] of [['email', emailId], ['submit', submitId]]) { const value = packet.interactions[kind as 'email' | 'submit']; facts[`${id}:${kind}`] = { kind: 'interaction', snapshotId: id, regionId: 'region', nodeId, evidence: packetRef, value }; }
    snapshots.push({ id, viewport, nodes }); sourceControls.push({ snapshotId: id, emailFactId: `${id}:email`, submitFactId: `${id}:submit` }); appearanceRows.push({ packet: packetRef, nodes: [nodes[emailId], nodes[submitId]] });
  }
  const source = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', snapshots, facts }, sourceFacts = await put('source.json', source);
  const appearance = await put('appearance.json', { version: 1, kind: 'native44-visible-source-form-appearance-extraction', rows: appearanceRows, visualPassed: false });
  const node: PendingFormNode = { kind: 'native', key: 'pending-email', widgetType: 'form', sourceFactIds: Object.keys(facts), widgetSettings: { form_fields: [{ field_type: 'email', field_label: '', placeholder: 'Enter email', required: '', width: '100', custom_id: 'email' }], button_text: 'Subscribe', submit_actions: [], _attributes: NATIVE44_PENDING_FORM_ATTRIBUTES }, pendingForm: { version: 1, kind: 'native44-pending-form-v1', sourceControls, appearance, registered: { capabilities: registered, schemaHash: native44RegisteredSchemaHash(schema) }, knowledge: { fingerprint: loaded.index.fingerprint, formComponentHash: loaded.index.components.form.sha256, sharedControlsHash: loaded.index.sharedControls.sha256 } } };
  const program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, requirementProfile: 'source-requirements-v1', goalProfile: 'component-reference-v1', taskId: 'pending-form-fixture', title: 'Pending layout', sourceUrl: source.sourceUrl, ...knowledgeIdentity, sourceFacts, componentPlan: sourceFacts, assetsManifest: sourceFacts, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'module', children: [node] }] } as unknown as Native44Program;
  const cleanup = async () => { assert.equal(path.dirname(dir), path.join(ROOT, 'tests')); assert.ok(path.basename(dir).startsWith('.tmp-pending-form-')); await rm(dir, { recursive: true }); };
  return { dir, put, cleanup, schema, node, program, source, packets, appearanceRows };
}
async function withFixture(fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) { const f = await fixture(); try { await fn(f); } finally { await f.cleanup(); } }
async function useV2Source(f: Awaited<ReturnType<typeof fixture>>) {
  const declarations: any[] = [];
  const rawFields = f.schema.controls.form_fields.fields as any;
  Object.assign(rawFields.field_type.options,{ text:'Text',tel:'Telephone',select:'Select',textarea:'Textarea' });
  rawFields.field_options = { type:'textarea' };
  const registration = await f.put('v2-registration.json',{ legacySchemas:{ form:f.schema },versions:{ elementor:'synthetic',elementorPro:'synthetic' } });
  const fields = (f.node.widgetSettings.form_fields as any[]);
  for (const type of ['text','tel','select','textarea']) fields.push({field_type:type,field_label:'',placeholder:type === 'select' ? '' : type,required:'',width:'100',custom_id:type,...(type === 'select' ? {field_options:'USA|us\nCanada|ca'} : {})});
  for (const [index,item] of f.packets.entries()) {
    const packet = item.packet as any, snapshotId = `snapshot-${index}`, formId = `form-${index}`;
    packet.nodes[formId].layoutId = 'form-layout'; packet.layouts['form-layout'] = {rect:{x:0,y:0,width:200,height:300}};
    packet.nodes[`submit-${index}`].attributes.value = 'Subscribe';
    const factIds = [`${snapshotId}:email`];
    for (const type of ['text','tel','select','textarea']) {
      const nodeId = `${type}-${index}`, factId = `${snapshotId}:${type}`;
      const raw = {id:nodeId,tag:['text','tel'].includes(type)?'input':type,parentId:formId,selector:`#${nodeId}`,visible:true,attributes:{...(['text','tel'].includes(type)?{type}:{}),...(type === 'select'?{}:{placeholder:type})},styleId:'email-style',layoutId:'email-layout'};
      packet.nodes[nodeId] = raw;
      const interaction = {...packet.interactions.email,id:`interaction-${nodeId}`,nodeId,selector:raw.selector,details:{...packet.interactions.email.details,type}};
      packet.interactions[type] = interaction;
      f.source.facts[factId] = {kind:'interaction',snapshotId,regionId:'region',nodeId,value:interaction};
      factIds.push(factId);
      if (type === 'select') for (const [label,value] of [['USA','us'],['Canada','ca']]) packet.nodes[`option-${value}-${index}`] = {id:`option-${value}-${index}`,tag:'option',parentId:nodeId,text:label,attributes:{value}};
    }
    const reference = await f.put(`v2-packet-${index}.json`,packet);
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.snapshotId === snapshotId) fact.evidence = reference;
    f.appearanceRows[index] = {packet:reference,nodes:Object.values(packet.nodes)} as any;
    declarations.push({snapshotId,fieldFactIds:factIds,submitFactId:`${snapshotId}:submit`});
  }
  f.node.sourceFactIds = Object.keys(f.source.facts);
  f.program.sourceFacts = await f.put('v2-source.json',f.source);
  f.node.pendingForm = {...f.node.pendingForm!,version:2,kind:'native44-pending-form-v2',sourceControls:declarations,registered:{capabilities:registration,schemaHash:native44RegisteredSchemaHash(f.schema)},appearance:await f.put('v2-appearance.json',{kind:'native44-visible-source-form-appearance-extraction',rows:f.appearanceRows})};
}
test('v2 source binds all common fields and exact options to disabled native form', () => withFixture(async f => {
  await useV2Source(f);
  const [capability] = await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program});
  const settings: Record<string, unknown> = {...structuredClone(f.node.widgetSettings),form_fields:(f.node.widgetSettings.form_fields as any[]).map((field,index)=>({...field,_id:`aaaaaa${index}`}))};
  const authorization = bindPendingFormAttributeAuthorization(capability,'abcdef1',settings,f.schema);
  assert.equal(native44PendingFormBinding(capability,authorization,settings).businessStatus,'pending');
  assert.deepEqual(settings.submit_actions,[]);
  const schemas = {form:f.schema,container:{type:'container',class:'Elementor\\Includes\\Elements\\Container',controls:{css_classes:{type:'text'},_attributes:{type:'textarea'}}}};
  const all = await loadNative44Knowledge(['form','container']);
  const compiled = compileNative44(f.program,{schemas,knowledge:toNative44CompilerKnowledge(all,schemas),assets:[],pendingForms:[capability]});
  assert.equal(compiled.pendingFormBindings?.length,1);
}));
for (const kind of ['extra-field','options','width','required','type'] as const) test(`v2 rejects source mismatch ${kind}`,()=>withFixture(async f=>{
  await useV2Source(f);
  const fields = f.node.widgetSettings.form_fields as any[];
  if(kind==='extra-field') fields.pop();
  if(kind==='options') fields[3].field_options='USA|forged';
  if(kind==='width') fields[0].width='50';
  if(kind==='required') fields[0].required='true';
  if(kind==='type') fields[1].field_type='email';
  await assert.rejects(prepareNative44PendingFormCapabilities({root:ROOT,program:f.program}));
}));
async function addV2Details(f: Awaited<ReturnType<typeof fixture>>, corruptOptions=false) {
  const declaration=f.node.pendingForm as any,fields=f.node.widgetSettings.form_fields as any[];
  for(const [index,row]of declaration.sourceControls.entries()){
    const packet=JSON.parse(await readFile(path.join(f.dir,`v2-packet-${index}.json`),'utf8'));
    const controls=fields.map((field,position)=>{const raw=packet.nodes[position===0?`email-${index}`:`${field.field_type}-${index}`];return{tag:raw.tag.toUpperCase(),type:raw.attributes.type??null,name:field.custom_id,placeholder:field.placeholder||null,required:false,label:'',rect:packet.layouts[raw.layoutId].rect,...(field.field_type==='select'?{options:[{text:'USA',value:corruptOptions?'forged':'us'},{text:'Canada',value:'ca'}]}:{})};});
    controls.push({tag:'INPUT',type:'submit',name:null,placeholder:null,required:false,label:'',rect:packet.layouts['submit-layout'].rect}as any);
    const html=fields.map(field=>field.field_type==='select'?`<select name="${field.custom_id}"><option value="us">USA</option><option value="ca">Canada</option></select>`:field.field_type==='textarea'?`<textarea name="${field.custom_id}" placeholder="${field.placeholder}"></textarea>`:`<input type="${field.field_type}" name="${field.custom_id}" placeholder="${field.placeholder}">`).join('')+'<input type="submit">';
    row.details=await f.put(`v2-details-${index}.json`,{sourceUrl:f.source.sourceUrl,viewport:f.source.snapshots[index].viewport,formHTML:`<form>${html}</form>`,controls});
  }
}
test('v2 supplements bind exact HTML option values and source footprints',()=>withFixture(async f=>{
  await useV2Source(f);await addV2Details(f);
  assert.equal((await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program})).length,1);
}));
test('source control fact style and layout enrichment must exactly match its immutable original packet', () => withFixture(async fixtureData => {
  await useV2Source(fixtureData);
  for (const fact of Object.values(fixtureData.source.facts) as any[]) {
    const packet = fixtureData.packets.find(item => item.packet.snapshot.id === fact.snapshotId)!.packet as any, raw = packet.nodes[fact.nodeId];
    fact.value = { ...fact.value, style: structuredClone(packet.styles[raw.styleId]), layout: structuredClone(packet.layouts[raw.layoutId]) };
  }
  fixtureData.program.sourceFacts = await fixtureData.put('enriched-source.json', fixtureData.source);
  assert.equal((await prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program })).length, 1);
  (Object.values(fixtureData.source.facts)[0] as any).value.style.display = 'forged';
  fixtureData.program.sourceFacts = await fixtureData.put('enriched-source.json', fixtureData.source);
  await assert.rejects(prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program }), /packet_interaction_binding/);
}));
test('v2 rejects supplemental options inconsistent with actual captured HTML',()=>withFixture(async f=>{
  await useV2Source(f);await addV2Details(f,true);
  await assert.rejects(prepareNative44PendingFormCapabilities({root:ROOT,program:f.program}),/details_options/);
}));
const emitted = (node: PendingFormNode): Record<string, unknown> => ({ ...structuredClone(node.widgetSettings), form_fields: [{ ...(node.widgetSettings.form_fields as any[])[0], _id: 'abcdef0' }], _css_classes: 'cwp-owned-form' });

async function useAriaSource(f: Awaited<ReturnType<typeof fixture>>, role = 'button', extra = false) {
  f.node.pendingForm!.sourceSubmitModel = 'aria-button';
  for (const [index, item] of f.packets.entries()) {
    const raw = item.packet.nodes[`submit-${index}`]; raw.tag = 'div'; raw.attributes = { role } as any;
    item.packet.interactions.submit.details.type = 'div';
    if (extra) (item.packet.nodes as any).extra = { id: 'extra', tag: 'div', parentId: `form-${index}`, visible: true, attributes: { role: 'button' } };
    const ref = await f.put(`aria-packet-${index}.json`, item.packet);
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.snapshotId === `snapshot-${index}`) fact.evidence = ref;
    f.appearanceRows[index].packet = ref;
  }
  f.program.sourceFacts = await f.put('aria-source.json', f.source);
  f.node.pendingForm!.appearance = await f.put('aria-appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: f.appearanceRows });
}

test('explicit ARIA source button preserves native inert target and binds the source model', () => withFixture(async f => {
  await useAriaSource(f);
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const settings = emitted(f.node), permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', settings, f.schema);
  assert.equal(native44PendingFormBinding(capability, permit, settings).sourceSubmitModel, 'aria-button');
  delete f.node.pendingForm!.sourceSubmitModel;
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, capability));
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

for (const [name, role, extra] of [['wrong ARIA role', 'link', false], ['extra ARIA control', 'button', true]] as const) test(`ARIA source rejects ${name}`, () => withFixture(async f => {
  await useAriaSource(f, role, extra);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

test('verified local source + KG + synthetic registration creates only a pending candidate', () => withFixture(async f => {
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, capability);
  const settings = emitted(f.node), permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', settings, f.schema);
  assert.deepEqual(toNative44CompilerKnowledge(loaded, { form: f.schema }).validateSettings('form', settings), settings);
  assertPendingFormAttributeAuthorization(permit, 'form', settings, 'abcdef1', f.schema);
  assert.equal(pendingFormAuthorizationForElement([permit], 'abcdef1'), permit);
  const receipt = native44PendingFormBinding(capability, permit, settings);
  assert.equal(receipt.businessStatus, 'pending'); assert.equal(receipt.runtimeVerification, 'required'); assert.equal(receipt.submitLabelVerification, 'source-visual-review-required');
  assert.equal(receipt.packets.length, 2); assert.equal(receipt.registered.schemaHash, native44RegisteredSchemaHash(f.schema));
}));

test('responsive visibility derives opaque pending permission without allowing Form or source mutations', () => withFixture(async f => {
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const fields = { hide_mobile: { type: 'switcher', return_value: 'hidden-mobile' } }, target = structuredClone(f.program);
  target.knowledge.fingerprint = sha(JSON.stringify({ base: f.program.knowledge.fingerprint, module: 'responsive-native-v1', fields }));
  const node = (target.blocks[0] as any).children[0], schemas = { form: f.schema };
  const [derived] = derivePendingFormsForResponsive(f.program, target, schemas, [capability], fields);
  assertNative44PendingFormCapability(target, node, schemas, derived);
  assertNative44PendingFormCapability(f.program, f.node, schemas, capability);
  assert.throws(() => assertNative44PendingFormCapability(target, node, schemas, capability));
  node.widgetSettings.submit_actions = ['email']; assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [capability], fields)); node.widgetSettings.submit_actions = [];
  target.sourceFacts.sha256 = '0'.repeat(64); assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [capability], fields));
  assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [structuredClone(capability)], fields));
  assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [capability], { arbitrary: { type: 'switcher', return_value: 'yes' } }));
}));

test('native non-resource font arrow is an explicit candidate; resources or arbitrary icon objects reject', () => withFixture(async f => {
  f.node.widgetSettings.button_text = ''; f.node.widgetSettings.selected_button_icon = { value: 'fas fa-angle-right', library: 'fa-solid' };
  assertNative44PendingFormCandidate(f.node); assert.equal((await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program })).length, 1);
  assert.deepEqual(toNative44CompilerKnowledge(loaded, { form: f.schema }).validateSettings('form', emitted(f.node)), emitted(f.node));
  f.node.widgetSettings.selected_button_icon = { value: { id: 12, url: 'https://target.example/icon.svg' }, library: 'svg' };
  assert.throws(() => assertNative44PendingFormCandidate(f.node), /native_arrow_icon/);
}));

for (const [name, mutate] of Object.entries<(node: PendingFormNode) => void>({
  'ordinary form without marker': node => { delete node.pendingForm; },
  'CF7 cannot acquire permission': node => { node.widgetType = 'wd_contact_form_7'; },
  'actions email': node => { node.widgetSettings.submit_actions = ['email']; },
  'absent actions defaults unsafe': node => { delete node.widgetSettings.submit_actions; },
  'aria disabled alone': node => { node.widgetSettings._attributes = 'aria-disabled|true'; },
  'generic extra attribute': node => { node.widgetSettings._attributes += '\ndata-inert|true'; },
  'recipient': node => { node.widgetSettings.email_to = 'recipient@example.test'; },
  'webhook': node => { node.widgetSettings.webhooks = 'https://target.example/api'; },
  'dynamic tags': node => { node.widgetSettings.__dynamic__ = { button_text: 'dynamic' }; },
  'HTML field': node => { (node.widgetSettings.form_fields as any[])[0].field_html = '<input>'; },
  'field value': node => { (node.widgetSettings.form_fields as any[])[0].field_value = 'x@example.test'; },
  'second email': node => { (node.widgetSettings.form_fields as any[]).push({ ...(node.widgetSettings.form_fields as any[])[0] }); },
  'resource IDs': node => { node.resources = [{ kind: 'form', ids: [12] }]; },
  'wrong source owner': node => { node.sourceFactIds = []; },
})) test(`strict pending syntax rejects ${name}`, () => withFixture(async f => { mutate(f.node); assert.throws(() => assertNative44PendingFormCandidate(f.node)); }));

test('serialized/forged capabilities and attributes never authorize inert; exact element/settings/schema binding is enforced', () => withFixture(async f => {
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }), settings = emitted(f.node);
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, structuredClone(capability)), /process_capability/);
  const permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', settings, f.schema);
  for (const check of [() => assertPendingFormAttributeAuthorization(structuredClone(permit), 'form', settings), () => assertPendingFormAttributeAuthorization(permit, 'container', settings), () => assertPendingFormAttributeAuthorization(permit, 'form', { ...settings, submit_actions: ['email'] }), () => assertPendingFormAttributeAuthorization(permit, 'form', settings, 'abcdef2'), () => pendingFormAuthorizationForElement([permit, permit], 'abcdef1')]) assert.throws(check);
  const changed = structuredClone(f.schema); changed.controls.submit_actions.default = ['webhook'];
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: changed }, capability), /process_capability/);
  f.node.widgetSettings.button_text = 'Changed'; assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, capability));
}));

for (const scenario of ['source-file-hash', 'KG-component-hash', 'registered-hash', 'wrong-viewport', 'cross-form', 'hidden-email', 'zero-submit', 'extra-visible-control', 'placeholder', 'packet-interaction', 'appearance-packet', 'wrong-profile']) test(`local evidence rejects ${scenario}`, () => withFixture(async f => {
  if (scenario === 'source-file-hash') await writeFile(f.program.sourceFacts.path, '{}');
  if (scenario === 'KG-component-hash') f.node.pendingForm!.knowledge.formComponentHash = '0'.repeat(64);
  if (scenario === 'registered-hash') f.node.pendingForm!.registered.schemaHash = '0'.repeat(64);
  if (scenario === 'wrong-viewport') f.source.snapshots[1].viewport = { width: 1024, height: 768 };
  if (scenario === 'cross-form') f.source.facts['snapshot-0:submit'].value.details.form = JSON.stringify({ nodeId: 'other' });
  if (scenario === 'placeholder') (f.node.widgetSettings.form_fields as any[])[0].placeholder = 'Wrong';
  if (scenario === 'wrong-profile') delete f.program.goalProfile;
  if (['hidden-email', 'zero-submit', 'extra-visible-control', 'packet-interaction', 'appearance-packet'].includes(scenario)) {
    const p = f.packets[0].packet;
    if (scenario === 'hidden-email') p.nodes['email-0'].visible = false;
    if (scenario === 'zero-submit') p.layouts['submit-layout'].rect.height = 0;
    if (scenario === 'extra-visible-control') p.nodes.extra = { id: 'extra', tag: 'textarea', parentId: 'form-0', visible: true };
    if (scenario === 'packet-interaction') p.interactions.email.details.type = 'password';
    const ref = await f.put('packet-changed.json', p); f.source.facts['snapshot-0:email'].evidence = ref; f.source.facts['snapshot-0:submit'].evidence = ref;
    if (scenario !== 'appearance-packet') { f.appearanceRows[0].packet = ref; f.node.pendingForm!.appearance = await f.put('appearance-new.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: f.appearanceRows }); }
  }
  if (scenario !== 'source-file-hash') f.program.sourceFacts = await f.put('source-updated.json', f.source);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

test('capability observation calls only container/form discovery and strips unrelated result surfaces', async () => {
  const calls: string[][] = [], schema = registeredFixture();
  const result = await probePendingFormCapabilities({ async discoverCapabilities(types) { calls.push(types); return { mode: 'legacy-verified', abilities: [{ name: 'unsafe-unrelated', token: 'do-not-export' }], schemas: { irrelevant: true }, legacySchemas: { form: schema, unrelated: schema }, versions: { elementor: 'test', elementorPro: 'test' }, sourceProof: { schemaErrors: {}, unrelated: 'do-not-export' }, limitations: [] } as CapabilityReport; } });
  assert.deepEqual(calls, [['container', 'form']]); assert.deepEqual(Object.keys(result.capabilities.legacySchemas), ['form']); assert.equal(result.frontendInert, 'unverified'); assert.equal(result.businessStatus, 'pending');
  assert.equal(JSON.stringify(result).includes('do-not-export'), false);
});
test('missing registered form remains an honest missing observation, not a renderer pass', async () => {
  const result = await probePendingFormCapabilities({ async discoverCapabilities() { return { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: {}, versions: {}, limitations: [] }; } });
  assert.equal(result.registeredFormObserved, false); assert.equal(result.frontendInert, 'unverified');
});
test('real registry client construction retains the exact fixed 44 set without authentication', () => {
  let requests = 0;
  assert.doesNotThrow(() => createPendingFormRegistryReader({ targetUrl: 'https://target.example/', username: 'synthetic-test-user', applicationPassword: 'synthetic-test-password', fetch: async () => { requests++; throw Error('No network allowed in constructor test'); } }));
  assert.equal(requests, 0);
});
test('actual target used-control projection intersects frozen KG including nested conditions for text and arrow candidates', async () => {
  const actual = JSON.parse(await readFile(new URL('./fixtures/native44-pending-form-registered.json', import.meta.url), 'utf8'));
  assert.equal(actual.kind, 'native44-pending-form-registered-used-control-projection');
  assert.equal(actual.source.sha256, '33b2c95be9eccee890e54a93baf2f9e0a222f09e530deaf59c33461566343190');
  assert.equal(actual.sourceFullSchemaHash, '60d94fcc56088415ef76d402a54945e70c551b4ad84ce203cc2d536df8ca3bf0');
  const f = await fixture(actual.schema);
  try {
    assert.deepEqual(f.schema.controls.submit_actions.default, ['email', 'save-to-database']);
    for (const arrow of [false, true]) {
      if (arrow) { f.node.widgetSettings.button_text = ''; f.node.widgetSettings.selected_button_icon = { value: 'fas fa-angle-right', library: 'fa-solid' }; }
      const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
      const settings = emitted(f.node), solved = toNative44CompilerKnowledge(loaded, { form: f.schema }).validateSettings('form', settings);
      assert.deepEqual(solved, settings); assert.deepEqual(solved.submit_actions, []);
      const permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', solved, f.schema);
      assert.equal(native44PendingFormBinding(capability, permit, solved).runtimeVerification, 'required');
    }
    const changed = structuredClone(f.schema), fields = Object.values(changed.controls.form_fields.fields as object) as any[];
    const placeholder = fields.find(field => field.name === 'placeholder');
    placeholder.conditions.terms = [{ name: 'field_type', operator: '===', value: 'tel' }];
    assert.throws(() => toNative44CompilerKnowledge(loaded, { form: changed }).validateSettings('form', emitted(f.node)), /condition|inactive/i);
  } finally { await f.cleanup(); }
});
test('source-facts may add only the exact node selector omitted by the raw interaction collector', () => withFixture(async f => {
  for (const item of f.packets) {
    for (const interaction of Object.values(item.packet.interactions) as any[]) delete interaction.selector;
    // The fixture's fact values shared original objects: preserve the actual
    // assembler result explicitly while raw records retain no selector.
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.evidence.path === item.packetRef.path) fact.value = { ...structuredClone(item.packet.interactions[fact.value.details.type]), selector: item.packet.nodes[fact.nodeId].selector };
    const updated = await f.put(path.basename(item.packetRef.path) + '-no-selector.json', item.packet);
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.evidence.path === item.packetRef.path) fact.evidence = updated;
    f.appearanceRows.find(row => row.packet.path === item.packetRef.path).packet = updated;
  }
  f.program.sourceFacts = await f.put('source-selectors.json', f.source);
  f.node.pendingForm!.appearance = await f.put('appearance-selectors.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: f.appearanceRows });
  assert.equal((await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program })).length, 1);
  (Object.values(f.source.facts) as any[])[0].value.selector = '#invented'; f.program.sourceFacts = await f.put('source-wrong-selector.json', f.source);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }), /packet_controls/);
}));
test('normal44 compilation requires opaque candidate permission and seals final native attrs/actions/receipt/editor metadata', () => withFixture(async f => {
  const all = await loadNative44Knowledge(['form', 'container']);
  const schemas = { form: f.schema, container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { css_classes: { type: 'text' }, _attributes: { type: 'textarea' } } } };
  const options = { schemas, assets: [], knowledge: toNative44CompilerKnowledge(all, schemas) };
  (f.node as any).editorTitle = 'Pending editable email form';
  assert.throws(() => compileNative44(f.program, options), /capabilities/);
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  assert.throws(() => compileNative44(f.program, { ...options, pendingForms: structuredClone(pendingForms) }), /process_capability/);
  const compiled = compileNative44(f.program, { ...options, pendingForms });
  const form = compiled.composition.elements[0].elements[0];
  assert.equal(form.widgetType, 'form'); assert.equal(form.settings._attributes, NATIVE44_PENDING_FORM_ATTRIBUTES); assert.deepEqual(form.settings.submit_actions, []);
  assert.equal(form.settings._title, undefined);
  delete (f.node as any).editorTitle;f.program.editorNaming='native-translated-v1';
  const nativePendingForms=await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program});
  const nativeNames=compileNative44(f.program,{...options,pendingForms:nativePendingForms}),nativeForm=nativeNames.composition.elements[0].elements[0];
  const renderSettings=structuredClone(form.settings);delete renderSettings._title;
  assert.deepEqual(nativeForm.settings,renderSettings);assert.equal(nativeNames.editorLabels,undefined);assert.equal(nativeForm.id,form.id);
  assertNative44PendingFormCompilation(nativeNames,schemas);
  assert.equal(compiled.pendingFormBindings?.[0].elementId, form.id); assert.equal(compiled.pendingFormBindings?.[0].runtimeVerification, 'required');
  assertNative44Compilation(compiled, compiled.composition); assertNative44PendingFormCompilation(compiled, schemas);
  assert.throws(() => validateRegisteredSettings('form', form.settings, schemas.form), /inert|Undiscovered/);
  assert.throws(() => validateRegisteredSettings('container', { _attributes: NATIVE44_PENDING_FORM_ATTRIBUTES }, schemas.container), /inert/);
  assert.throws(() => validatePlan(compiled.plan, { mode: 'legacy-verified', widgetSchemas: schemas }), /inert/);
  assert.throws(() => validatePlan(compiled.plan, { mode: 'legacy-verified', widgetSchemas: schemas, pendingFormAuthorizations: [{ kind: 'native44-pending-form-attributes', elementId: form.id }] }), /inert/);
  const changed = structuredClone(schemas); changed.form.controls.submit_actions.default = ['webhook'];
  assert.throws(() => assertNative44PendingFormCompilation(compiled, changed), /attribute_authorization/);
  compiled.pendingFormBindings![0].runtimeVerification = 'passed' as any;
  assert.throws(() => assertNative44Compilation(compiled, compiled.composition), /exact current-process/);
}));
test('same disabled-looking form without explicit marker stays unverified and inert cannot unlock general attributes', () => withFixture(async f => {
  const all = await loadNative44Knowledge(['form', 'container']);
  const schemas = { form: f.schema, container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { css_classes: { type: 'text' }, _attributes: { type: 'textarea' } } } };
  delete f.node.pendingForm;
  assert.throws(() => compileNative44(f.program, { schemas, assets: [], knowledge: toNative44CompilerKnowledge(all, schemas) }), /resource_adapter_unverified/);
}));

async function useTargetSubmissions(f: Awaited<ReturnType<typeof fixture>>) {
  await useV2Source(f);
  f.schema.controls.submit_actions.options = { email: 'Email', 'save-to-database': 'Collect Submissions', webhook: 'Webhook', redirect: 'Redirect' };
  f.schema.controls.submissions_metadata = { type: 'select2', multiple: true, options: { remote_ip: 'User IP', user_agent: 'User Agent' }, condition: { submit_actions: 'save-to-database' } };
  const declaration = f.node.pendingForm!;
  f.node.pendingForm = { ...declaration, version: 3, kind: 'native44-target-submissions-only-v1', sourceSubmitModel: undefined, decision: { policy: 'target-submissions-only', taskId: f.program.taskId, authorization: 'user-explicit' }, registered: { capabilities: await f.put('target-submissions-registration.json', { mode: 'legacy-verified', legacySchemas: { form: f.schema }, versions: { elementor: 'synthetic', elementorPro: 'synthetic' }, sourceProof: { schemaErrors: {} } }), schemaHash: native44RegisteredSchemaHash(f.schema) } } as any;
  delete f.node.pendingForm!.sourceSubmitModel;
  delete f.node.widgetSettings._attributes;
  f.node.widgetSettings.submit_actions = ['save-to-database'];
  f.node.widgetSettings.submissions_metadata = [];
}

async function useHiddenFormLiveState(fixtureData: Awaited<ReturnType<typeof fixture>>, withProxy = false) {
  await useTargetSubmissions(fixtureData);
  const declaration = fixtureData.node.pendingForm as any, states: any[] = [];
  for (const [index, row] of declaration.sourceControls.entries()) {
    const packet = fixtureData.packets[index].packet as any, owner = `form-${index}`, ids = [...row.fieldFactIds, row.submitFactId].map(factId => fixtureData.source.facts[factId].nodeId), controls: any[] = [], html: string[] = [];
    packet.nodes[owner].attributes = { id: owner }; packet.nodes[owner].visible = false;
    packet.nodes[owner].styleId = 'form-style'; packet.styles['form-style'] = { display: 'none', visibility: 'hidden', opacity: '0' }; packet.layouts['form-layout'].rect = { x: 0, y: 0, width: 0, height: 0 };
    const append = (raw: any, options?: Array<{ text: string; value: string }>) => {
      raw.visible = false; raw.styleId = `${raw.id}-style`; raw.layoutId = `${raw.id}-layout`;
      packet.styles[raw.styleId] = { display: 'none', visibility: 'hidden', opacity: '0' }; packet.layouts[raw.layoutId] = { rect: { x: 0, y: 0, width: 0, height: 0 } };
      const attributes = { ...raw.attributes }, content = options?.map(option => `<option value="${option.value}">${option.text}</option>`).join('') ?? (raw.tag === 'button' ? 'Choose' : '');
      const attributeText = Object.entries(attributes).map(([key, value]) => `${key}="${String(value)}"`).join(' ');
      html.push(raw.tag === 'input' ? `<input ${attributeText}>` : `<${raw.tag} ${attributeText}>${content}</${raw.tag}>`);
      const entry = { selector: raw.selector, tag: raw.tag, type: attributes.type ?? null, name: attributes.name ?? null, placeholder: attributes.placeholder ?? null, required: Object.hasOwn(attributes, 'required'), label: '', text: options?.map(option => option.text).join('') ?? content, attributes, ...(options ? { options } : {}), rect: { x: 40, y: 100 + controls.length * 50, width: 200, height: 40 }, styles: { display: 'block', visibility: 'visible', opacity: '1' }, visible: true };
      controls.push(entry); return entry;
    };
    for (const nodeId of ids) {
      const raw = packet.nodes[nodeId]; raw.attributes.id = nodeId;
      const entry = append(raw, raw.tag === 'select' ? [{ text: 'USA', value: 'us' }, { text: 'Canada', value: 'ca' }] : undefined);
      if (withProxy && raw.tag === 'select') {
        const proxyId = `proxy-${index}`, interactionId = `interaction-${proxyId}`, factId = `${row.snapshotId}:proxy`;
        const proxy = { id: proxyId, tag: 'button', parentId: owner, selector: `#${proxyId}`, attributes: { id: proxyId, type: 'button', role: 'combobox' } }; packet.nodes[proxyId] = proxy;
        const value = { id: interactionId, nodeId: proxyId, regionId: 'region', kind: 'control', status: 'unobserved', selector: proxy.selector, details: { type: 'button', form: fixtureData.source.facts[row.submitFactId].value.details.form } };
        packet.interactions[proxyId] = value; fixtureData.source.facts[factId] = { kind: 'interaction', snapshotId: row.snapshotId, regionId: 'region', nodeId: proxyId, value };
        row.presentations = [{ fieldFactId: row.fieldFactIds.find((fieldFactId: string) => fixtureData.source.facts[fieldFactId].nodeId === nodeId), presentationFactId: factId }];
        Object.assign(entry, { visible: false, rect: { x: 0, y: 0, width: 0, height: 0 }, styles: { display: 'none', visibility: 'hidden', opacity: '0' }, presentationSelector: proxy.selector }); append(proxy);
      }
    }
    packet.nodes[owner].childIds = controls.map(control => Object.values(packet.nodes).find((raw: any) => raw.selector === control.selector)).map((raw: any) => raw.id);
    const formHTML = `<form id="${owner}">${html.join('')}</form>`, packetRef = await fixtureData.put(`hidden-packet-${index}.json`, packet);
    for (const fact of Object.values(fixtureData.source.facts) as any[]) if (fact.snapshotId === row.snapshotId) fact.evidence = packetRef;
    fixtureData.appearanceRows[index] = { packet: packetRef, nodes: Object.values(packet.nodes) } as any;
    row.details = await fixtureData.put(`hidden-details-${index}.json`, { sourceUrl: fixtureData.source.sourceUrl, viewport: packet.snapshot.viewport, formHTML, controls: controls.map(control => ({ ...control, rect: { x: 0, y: 0, width: 0, height: 0 } })) });
    const viewport = packet.snapshot.viewport, pixels = await sharp({ create: { width: viewport.width, height: viewport.height, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg width="200" height="450"><rect width="200" height="450" fill="white" stroke="black" stroke-width="4"/><path d="M0 50h200M0 150h200M0 250h200" stroke="black" stroke-width="2"/></svg>'), left: 40, top: 80 }]).png().toBuffer(), screenshotPath = path.join(fixtureData.dir, `live-${index}.png`);
    await writeFile(screenshotPath, pixels);
    const state = { version: 1, kind: 'native44-source-form-live-state', sourceUrl: fixtureData.source.sourceUrl, snapshotId: row.snapshotId, observedAt: new Date().toISOString(), browser: { name: 'chrome', browserId: 'synthetic-browser', tabId: 'synthetic-tab' }, viewport: { width: viewport.width, height: viewport.height, clientWidth: viewport.width, devicePixelRatio: 1 }, formSelector: `#${owner}`, formHTML, formRect: { x: 40, y: 80, width: 200, height: 450 }, formStyles: { display: 'block', visibility: 'visible', opacity: '1' }, formVisible: true, controls, screenshot: { path: screenshotPath, sha256: sha(pixels), width: viewport.width, height: viewport.height } };
    states.push(state); row.stateObservation = await fixtureData.put(`live-state-${index}.json`, state);
  }
  fixtureData.node.sourceFactIds = Object.keys(fixtureData.source.facts); fixtureData.program.sourceFacts = await fixtureData.put('hidden-source.json', fixtureData.source);
  declaration.appearance = await fixtureData.put('hidden-appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: fixtureData.appearanceRows });
  return { states, refresh: async () => { for (const [index, state] of states.entries()) declaration.sourceControls[index].stateObservation = await fixtureData.put(`live-state-${index}.json`, state); } };
}

for (const proxy of [false, true]) test(`target-only source state proves an opened hidden form without changing baseline facts; proxy=${proxy}`, () => withFixture(async fixtureData => {
  await useHiddenFormLiveState(fixtureData, proxy);
  const before = await readFile(fixtureData.program.sourceFacts.path, 'utf8'), [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program });
  assert.ok(capability); assert.equal(await readFile(fixtureData.program.sourceFacts.path, 'utf8'), before);
  assert.ok(Object.values(fixtureData.packets[0].packet.nodes).filter((node: any) => ['input', 'select', 'textarea', 'button'].includes(node.tag)).every((node: any) => node.visible === false));
}));

test('opened source-state proof cannot reuse one original source form claim twice', () => withFixture(async fixtureData => {
  await useHiddenFormLiveState(fixtureData, true);
  (fixtureData.program.blocks[0] as any).children.push({ ...structuredClone(fixtureData.node), key: 'duplicate-form' });
  await assert.rejects(prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program }), /duplicate_source_form/);
}));

test('opened source-state proof binds original packet DOM order and actual painted screenshot pixels', () => withFixture(async fixtureData => {
  const live = await useHiddenFormLiveState(fixtureData), declaration = fixtureData.node.pendingForm as any, packet = fixtureData.packets[0].packet as any;
  packet.nodes['form-0'].childIds.reverse();
  const changed = await fixtureData.put('hidden-packet-0.json', packet);
  for (const fact of Object.values(fixtureData.source.facts) as any[]) if (fact.snapshotId === 'snapshot-0') fact.evidence = changed;
  fixtureData.appearanceRows[0].packet = changed; fixtureData.program.sourceFacts = await fixtureData.put('hidden-source.json', fixtureData.source);
  declaration.appearance = await fixtureData.put('hidden-appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: fixtureData.appearanceRows });
  await assert.rejects(prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program }), /source_control_order/);
  packet.nodes['form-0'].childIds.reverse(); const restored = await fixtureData.put('hidden-packet-0.json', packet);
  for (const fact of Object.values(fixtureData.source.facts) as any[]) if (fact.snapshotId === 'snapshot-0') fact.evidence = restored;
  fixtureData.appearanceRows[0].packet = restored; fixtureData.program.sourceFacts = await fixtureData.put('hidden-source.json', fixtureData.source); declaration.appearance = await fixtureData.put('hidden-appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: fixtureData.appearanceRows });
  const state = live.states[0], pixels = await sharp({ create: { width: state.viewport.width, height: state.viewport.height, channels: 3, background: '#fff' } }).png().toBuffer();
  await writeFile(state.screenshot.path, pixels); state.screenshot.sha256 = sha(pixels); await live.refresh();
  await assert.rejects(prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program }), /screenshot_unpainted/);
}));

for (const scenario of ['missing-state', 'wrong-url', 'wrong-form', 'wrong-viewport', 'invisible', 'proxy', 'field-content', 'extra-visible', 'order', 'screenshot-hash', 'screenshot-size', 'label', 'v2-business-setting'] as const) test(`target-only hidden source state rejects ${scenario}`, () => withFixture(async fixtureData => {
  const live = await useHiddenFormLiveState(fixtureData, true), state = live.states[0];
  if (scenario === 'missing-state') delete (fixtureData.node.pendingForm as any).sourceControls[0].stateObservation;
  if (scenario === 'wrong-url') state.sourceUrl = 'https://other.example/';
  if (scenario === 'wrong-form') state.formSelector = '#other-form';
  if (scenario === 'wrong-viewport') state.viewport.width = 1440;
  if (scenario === 'invisible') state.controls[0].visible = false;
  if (scenario === 'proxy') state.controls.find((control: any) => control.attributes.role === 'combobox').visible = false;
  if (scenario === 'field-content') state.formHTML = state.formHTML.replace('Enter email', 'Changed email');
  if (scenario === 'extra-visible') { const extra = { ...structuredClone(state.controls[0]), selector: '#extra', attributes: { ...state.controls[0].attributes, id: 'extra' } }; state.controls.push(extra); state.formHTML = state.formHTML.replace('</form>', '<input id="extra" type="email" placeholder="Enter email"></form>'); }
  if (scenario === 'order') state.controls.reverse();
  if (scenario === 'screenshot-hash') state.screenshot.sha256 = '0'.repeat(64);
  if (scenario === 'screenshot-size') state.screenshot.width = 20;
  if (scenario === 'label') state.controls[0].label = 'Fabricated';
  if (scenario !== 'missing-state') await live.refresh();
  if (scenario === 'v2-business-setting') { const declaration = fixtureData.node.pendingForm as any; declaration.version = 2; declaration.kind = 'native44-pending-form-v2'; delete declaration.decision; fixtureData.node.widgetSettings.submit_actions = []; fixtureData.node.widgetSettings._attributes = NATIVE44_PENDING_FORM_ATTRIBUTES; fixtureData.node.widgetSettings.submissions_metadata = []; }
  await assert.rejects(prepareNative44PendingFormCapabilities({ root: ROOT, program: fixtureData.program }));
}));

test('explicit target-only submissions compiles a real input form with the sole registered database action', () => withFixture(async f => {
  await useTargetSubmissions(f);
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const all = await loadNative44Knowledge(['form', 'container']);
  const schemas = { form: f.schema, container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { css_classes: { type: 'text' }, _attributes: { type: 'textarea' } } } };
  const compiled = compileNative44(f.program, { schemas, assets: [], knowledge: toNative44CompilerKnowledge(all, schemas), pendingForms });
  const form = compiled.composition.elements[0].elements[0];
  assert.deepEqual(form.settings.submit_actions, ['save-to-database']);
  assert.deepEqual(form.settings.submissions_metadata, []);
  assert.equal(form.settings._attributes, undefined);
  assert.equal(form.widgetType, 'form');
  assert.equal((form.settings.form_fields as any[]).length, 5);
  const receipt = compiled.pendingFormBindings![0];
  assert.equal(receipt.kind, 'native44-target-submissions-only-configured');
  assert.equal(receipt.businessStatus, 'configured');
  assert.equal(receipt.runtimeVerification, 'actual-submission-required');
  assert.deepEqual(receipt.decision, { policy: 'target-submissions-only', taskId: f.program.taskId, authorization: 'user-explicit' });
  assertNative44PendingFormCompilation(compiled, schemas);
  form.settings.submit_actions = ['email'];
  assert.throws(() => assertNative44Compilation(compiled, compiled.composition), /exact current-process/);
}));

for (const [name, mutate] of Object.entries<(f: Awaited<ReturnType<typeof fixture>>) => void>({
  'missing action': f => { delete f.node.widgetSettings.submit_actions; },
  'default actions': f => { f.node.widgetSettings.submit_actions = []; },
  'email action': f => { f.node.widgetSettings.submit_actions = ['email']; },
  'mixed email action': f => { f.node.widgetSettings.submit_actions = ['save-to-database', 'email']; },
  'webhook action': f => { f.node.widgetSettings.submit_actions = ['webhook']; },
  'redirect action': f => { f.node.widgetSettings.submit_actions = ['redirect']; },
  'duplicate database action': f => { f.node.widgetSettings.submit_actions = ['save-to-database', 'save-to-database']; },
  'email recipient setting': f => { f.node.widgetSettings.email_to = 'unsafe@example.test'; },
  'webhook endpoint setting': f => { f.node.widgetSettings.webhook_url = 'https://unsafe.example.test/'; },
  'redirect setting': f => { f.node.widgetSettings.redirect_to = 'https://unsafe.example.test/'; },
  'custom CSS': f => { f.node.widgetSettings.custom_css = 'selector{display:none}'; },
  'inert wrapper': f => { f.node.widgetSettings._attributes = NATIVE44_PENDING_FORM_ATTRIBUTES; },
  'disabled wrapper': f => { f.node.widgetSettings._attributes = 'aria-disabled|true'; },
  'readonly field': f => { (f.node.widgetSettings.form_fields as any[])[0].readonly = 'true'; },
  'foreign task decision': f => { (f.node.pendingForm as any).decision.taskId = 'other-task'; },
  'absent explicit decision': f => { delete (f.node.pendingForm as any).decision; },
})) test(`target-only submissions rejects ${name}`, () => withFixture(async f => {
  await useTargetSubmissions(f); mutate(f);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

for (const scenario of ['missing-option', 'not-multiple', 'missing-multiple', 'schema-error', 'wrong-schema-hash', 'source-field-mismatch'] as const) test(`target-only submissions rejects unverified registration/source ${scenario}`, () => withFixture(async f => {
  await useTargetSubmissions(f);
  const declaration = f.node.pendingForm!;
  if (scenario === 'missing-option') delete f.schema.controls.submit_actions.options!['save-to-database'];
  if (scenario === 'not-multiple') f.schema.controls.submit_actions.multiple = false;
  if (scenario === 'missing-multiple') delete f.schema.controls.submit_actions.multiple;
  if (scenario === 'source-field-mismatch') (f.node.widgetSettings.form_fields as any[])[0].placeholder = 'Changed source';
  declaration.registered.capabilities = await f.put('broken-target-registration.json', { legacySchemas: { form: f.schema }, versions: { elementor: 'synthetic', elementorPro: 'synthetic' }, sourceProof: { schemaErrors: scenario === 'schema-error' ? { form: { code: 'failed' } } : {} } });
  declaration.registered.schemaHash = scenario === 'wrong-schema-hash' ? '0'.repeat(64) : native44RegisteredSchemaHash(f.schema);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

test('target-only submissions uses registered component style and common desktop/mobile advanced settings', () => withFixture(async f => {
  await useTargetSubmissions(f);
  const dimensions = { unit: 'px', top: '12', right: '16', bottom: '12', left: '16', isLinked: false };
  Object.assign(f.schema.controls, {
    form_name: { type: 'text' }, show_labels: { type: 'switcher', return_value: 'true' },
    field_background_color: { type: 'color' }, button_background_color: { type: 'color' }, button_background_hover_color: { type: 'color' },
    button_align: { type: 'choose', options: { start: 'Start', center: 'Center', end: 'End', stretch: 'Stretch' } },
    button_width: { type: 'select', options: { '20': '20%', '100': '100%' } },
    _margin: { type: 'dimensions' }, _margin_mobile: { type: 'dimensions' }, _padding: { type: 'dimensions' }, _padding_mobile: { type: 'dimensions' },
  });
  Object.assign(f.node.widgetSettings, { form_name: 'Task owned quote', show_labels: 'true', field_background_color: '#ffffff', button_background_color: '#efb800', button_background_hover_color: '#c79800', button_align: 'center', button_width: '20', _margin: dimensions, _margin_mobile: { ...dimensions, top: '0' }, _padding: dimensions, _padding_mobile: { ...dimensions, right: '8', left: '8' } });
  f.node.pendingForm!.registered = { capabilities: await f.put('styled-target-registration.json', { legacySchemas: { form: f.schema }, versions: { elementor: 'synthetic', elementorPro: 'synthetic' } }), schemaHash: native44RegisteredSchemaHash(f.schema) };
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const all = await loadNative44Knowledge(['form', 'container']);
  const schemas = { form: f.schema, container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { css_classes: { type: 'text' }, _attributes: { type: 'textarea' } } } };
  const compiled = compileNative44(f.program, { schemas, assets: [], knowledge: toNative44CompilerKnowledge(all, schemas), pendingForms });
  const actual = compiled.composition.elements[0].elements[0].settings;
  for (const field of ['form_name', 'show_labels', 'field_background_color', 'button_background_color', 'button_background_hover_color', 'button_align', 'button_width', '_margin', '_margin_mobile', '_padding', '_padding_mobile']) assert.deepEqual(actual[field], f.node.widgetSettings[field]);
  assertNative44PendingFormCompilation(compiled, schemas);
  const changed = structuredClone(schemas); delete changed.form.controls._padding_mobile;
  assert.throws(() => compileNative44(f.program, { schemas: changed, assets: [], knowledge: toNative44CompilerKnowledge(all, changed), pendingForms }), /process_capability/);
}));

test('target-only submissions requires process authorization and preserves explicit mode across responsive derivation', () => withFixture(async f => {
  await useTargetSubmissions(f);
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, structuredClone(pendingForms[0])), /process_capability/);
  const fields = { hide_mobile: { type: 'switcher', return_value: 'hidden-mobile' } }, target = structuredClone(f.program);
  target.knowledge.fingerprint = sha(JSON.stringify({ base: f.program.knowledge.fingerprint, module: 'responsive-native-v1', fields }));
  const [derived] = derivePendingFormsForResponsive(f.program, target, { form: f.schema }, pendingForms, fields);
  const node = (target.blocks[0] as any).children[0];
  assertNative44PendingFormCapability(target, node, { form: f.schema }, derived);
  delete node.pendingForm.decision;
  assert.throws(() => assertNative44PendingFormCapability(target, node, { form: f.schema }, derived), /process_capability/);
}));

for (const componentKey of ['contact_form', 'inquiry_top_form', 'inquiry_bottom_form']) test(`v2 responsive ${componentKey} derives only the two exact registered desktop-to-tablet mirrors`, () => withFixture(async f => {
  await useTargetSubmissions(f);
  f.program.styleResolutionVersion = 2;
  f.node.key = componentKey;
  Object.assign(f.schema.controls, {
    button_align: { type: 'choose', responsive: true, devices: ['desktop', 'tablet', 'mobile'] },
    button_align_tablet: { type: 'choose', responsive: { max: 'tablet' } },
    button_width: { type: 'select', responsive: true },
    button_width_tablet: { type: 'select', responsive: { max: 'tablet' } },
  });
  Object.assign(f.node.widgetSettings, { button_align: 'center', button_width: '33' });
  f.node.pendingForm!.registered = { capabilities: await f.put('responsive-target-registration.json', { legacySchemas: { form: f.schema }, versions: { elementor: 'synthetic', elementorPro: 'synthetic' } }), schemaHash: native44RegisteredSchemaHash(f.schema) };
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const fields = {}, target = structuredClone(f.program), schemas = { form: f.schema };
  target.knowledge.fingerprint = sha(JSON.stringify({ base: f.program.knowledge.fingerprint, module: 'responsive-native-v2', fields }));
  const node = (target.blocks[0] as any).children[0];
  Object.assign(node.widgetSettings, { button_align_tablet: 'center', button_width_tablet: '33' });
  const [derived] = derivePendingFormsForResponsive(f.program, target, schemas, pendingForms, fields);
  assertNative44PendingFormCapability(target, node, schemas, derived);
  const mutate = (change: (value: typeof target) => void) => { const value = structuredClone(target); change(value); assert.throws(() => derivePendingFormsForResponsive(f.program, value, schemas, pendingForms, fields)); };
  mutate(value => { (value.blocks[0] as any).children[0].widgetSettings.button_align_tablet = 'left'; });
  mutate(value => { (value.blocks[0] as any).children[0].widgetSettings.button_align_mobile = 'center'; });
  mutate(value => { (value.blocks[0] as any).children[0].widgetSettings.submit_actions = ['email']; });
  mutate(value => { value.sourceFacts.sha256 = '0'.repeat(64); });
  mutate(value => { value.styleResolutionVersion = 1; });
  mutate(value => { value.knowledge.fingerprint = sha(JSON.stringify({ base: f.program.knowledge.fingerprint, module: 'responsive-native-v1', fields })); });
  f.node.widgetSettings.button_align_tablet = 'left';
  const existingCapability = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, existingCapability, fields), /responsive_overlay_changed_form/);
  node.widgetSettings.button_align_tablet = 'left';
  assert.doesNotThrow(() => derivePendingFormsForResponsive(f.program, target, schemas, existingCapability, fields));
}));

async function usePendingHiddenFormLiveState(f: Awaited<ReturnType<typeof fixture>>, proxy = false) {
  const live = await useHiddenFormLiveState(f, proxy), declaration = f.node.pendingForm as any;
  declaration.version = 2; declaration.kind = 'native44-pending-form-v2'; delete declaration.decision;
  f.node.widgetSettings.submit_actions = []; f.node.widgetSettings._attributes = NATIVE44_PENDING_FORM_ATTRIBUTES; delete f.node.widgetSettings.submissions_metadata;
  return live;
}
for (const proxy of [false, true]) test(`pending v2 opened source state retains inert fields and empty actions; proxy=${proxy}`, () => withFixture(async f => {
  await usePendingHiddenFormLiveState(f, proxy);
  const original = await readFile(f.program.sourceFacts.path, 'utf8');
  const [capability] = await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program}); assert.ok(capability);
  assert.equal(await readFile(f.program.sourceFacts.path,'utf8'),original);
  assert.equal(f.node.widgetSettings._attributes,NATIVE44_PENDING_FORM_ATTRIBUTES);assert.deepEqual(f.node.widgetSettings.submit_actions,[]);
  assert.ok(Object.values(f.packets[0].packet.nodes).filter((node:any)=>['input','select','textarea','button'].includes(node.tag)).every((node:any)=>node.visible===false));
}));
for (const scenario of ['missing-state','wrong-url','invisible','changed-content','screenshot-hash','email-action','removed-inert'] as const) test(`pending v2 opened state rejects ${scenario}`,()=>withFixture(async f=>{
  const live=await usePendingHiddenFormLiveState(f,true),state=live.states[0];
  if(scenario==='missing-state')delete (f.node.pendingForm as any).sourceControls[0].stateObservation;
  if(scenario==='wrong-url')state.sourceUrl='https://other.example/';
  if(scenario==='invisible')state.controls[0].visible=false;
  if(scenario==='changed-content')state.formHTML=state.formHTML.replace('Enter email','Different email');
  if(scenario==='screenshot-hash')state.screenshot.sha256='0'.repeat(64);
  if(scenario==='email-action')f.node.widgetSettings.submit_actions=['email'];
  if(scenario==='removed-inert')delete f.node.widgetSettings._attributes;
  if(scenario!=='missing-state')await live.refresh();
  await assert.rejects(prepareNative44PendingFormCapabilities({root:ROOT,program:f.program}));
}));

async function styledPendingFixture(version: 1 | 2) {
  const f = await fixture();
  if (version === 2) await useV2Source(f);
  f.program.styleResolutionVersion = 2;
  (f.node.widgetSettings.form_fields as any[]).forEach((field,index)=>{field._id=(index+1).toString(16).padStart(7,'0');});
  for (const name of ['font_size','line_height']) {
    const id = `button_typography_${name}`;
    f.schema.controls[id] = {type:'slider', responsive:true, selectors:{'{{WRAPPER}} .elementor-button':`${name === 'font_size' ? 'font-size' : 'line-height'}: {{SIZE}}{{UNIT}}`}, condition:{'button_typography_typography!':''},size_units:['px'], range:{px:{min:1,max:200}}};
    f.schema.controls[id+'_mobile'] = {...f.schema.controls[id],responsive:{max:'mobile'}};
  }
  f.schema.controls.button_typography_typography = {type:'popover_toggle',default:'',render_type:'ui'};
  f.node.pendingForm!.registered = {capabilities:await f.put('style-registration.json',{legacySchemas:{form:f.schema},versions:{elementor:'synthetic',elementorPro:'synthetic'}}),schemaHash:native44RegisteredSchemaHash(f.schema)};
  const factId = f.node.sourceFactIds![1];
  (f.node as any).styleBindings=[{sourceFactId:factId,selector:' .elementor-button',minWidth:1,maxWidth:10000,properties:['font-size','line-height']}];
  const source=structuredClone(f.source);
  source.facts[factId].id=factId;
  source.facts[factId].value.style={display:'block',visibility:'visible','font-size':'16px','line-height':'22.4px'};
  f.source.facts[factId].id=factId;
  f.source.facts[factId].value.style=structuredClone(source.facts[factId].value.style);
  const raw=f.packets[0].packet.nodes['submit-0'] as any;
  (f.packets[0].packet.styles as any)[raw.styleId]=structuredClone(source.facts[factId].value.style);
  const packetRef=await f.put('styled-source-packet.json',f.packets[0].packet);
  for(const fact of Object.values(f.source.facts) as any[])if(fact.snapshotId==='snapshot-0')fact.evidence=packetRef;
  f.appearanceRows[0].packet=packetRef;
  f.node.pendingForm!.appearance=await f.put('styled-appearance.json',{kind:'native44-visible-source-form-appearance-extraction',rows:f.appearanceRows});
  f.program.sourceFacts=await f.put('styled-source-facts.json',f.source);
  Object.assign(source,structuredClone(f.source));
  const all=await loadNative44Knowledge(['form','container']);
  const schemas={form:f.schema,container:{type:'container',class:'Elementor\\Includes\\Elements\\Container',controls:{css_classes:{type:'text'},_attributes:{type:'textarea'}}}};
  const knowledge=toNative44CompilerKnowledge(all,schemas);
  const permits=await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program});
  return {...f,schemas,knowledge,permits,input:{program:f.program,source:source as any,schemas,knowledge,css:'',mobileMaxWidth:767}};
}
for (const version of [1,2] as const) test(`pending v${version} fixed resolver derives exact three registered style increments and compiles repeatedly`,async()=>{
  const f=await styledPendingFixture(version);
  try {
    const first=await resolvePendingFormStyles(f.input,f.permits), second=await resolvePendingFormStyles(f.input,f.permits);
    assert.deepEqual(second.program,first.program);
    const node=(first.program.blocks[0] as any).children[0];
    assert.deepEqual(node.widgetSettings.button_typography_font_size,{size:16,unit:'px'});
    assert.deepEqual(node.widgetSettings.button_typography_line_height,{size:22.4,unit:'px'});
    assert.equal(node.widgetSettings.button_typography_typography,'custom');
    assert.equal(node.widgetSettings._attributes,NATIVE44_PENDING_FORM_ATTRIBUTES);
    assert.deepEqual(node.widgetSettings.submit_actions,[]);
    assert.throws(()=>assertNative44PendingFormCandidate(node));
    await assert.rejects(prepareNative44PendingFormCapabilities({root:ROOT,program:first.program}));
    for(let i=0;i<2;i++) {
      const compiled=compileNative44(second.program,{schemas:f.schemas,assets:[],knowledge:f.knowledge,pendingForms:first.pendingForms});
      assertNative44PendingFormCompilation(compiled,f.schemas);
      assert.deepEqual(compiled.composition.elements[0].elements[0].settings.button_typography_line_height,{size:22.4,unit:'px'});
    }
    assert.throws(()=>compileNative44(first.program,{schemas:f.schemas,assets:[],knowledge:f.knowledge,pendingForms:structuredClone(first.pendingForms)}),/process_capability/);
    const fields={},target=structuredClone(first.program);
    target.knowledge.fingerprint=sha(JSON.stringify({base:first.program.knowledge.fingerprint,module:'responsive-native-v2',fields}));
    const responsive=derivePendingFormsForResponsive(first.program,target,f.schemas,first.pendingForms,fields);
    assertNative44PendingFormCapability(target,(target.blocks[0] as any).children[0],f.schemas,responsive[0]);
    for(const mutate of [
      (p:any)=>p.blocks[0].children[0].widgetSettings.submit_actions.push('email'),
      (p:any)=>p.blocks[0].children[0].widgetSettings._attributes='aria-disabled|true',
      (p:any)=>p.blocks[0].children[0].widgetSettings.form_fields[0].placeholder='Changed',
      (p:any)=>p.blocks[0].children[0].widgetSettings.email_to='recipient@example.test',
      (p:any)=>p.sourceFacts.sha256='0'.repeat(64),
      (p:any)=>p.blocks[0].children[0].pendingForm.sourceControls[0].snapshotId='foreign',
    ]) {
      const program=structuredClone(f.program);mutate(program);
      await assert.rejects(resolvePendingFormStyles({...f.input,program},f.permits),/process_capability/);
    }
    const substituted=await resolvePendingFormStyles({...f.input,knowledge:{...f.knowledge,validateSettings:(_type,settings)=>({...settings,submit_actions:['email']})}},f.permits);
    assert.deepEqual((substituted.program.blocks[0] as any).children[0].widgetSettings.submit_actions,[]);
    const forgedKnowledge={...f.knowledge,styleControlsByWidget:{...f.knowledge.styleControlsByWidget,form:[]}};
    await assert.rejects(resolvePendingFormStyles({...f.input,knowledge:forgedKnowledge},f.permits),/source_or_knowledge_changed/);
    const forgedSource=structuredClone(f.input.source);forgedSource.facts[f.node.sourceFactIds![1]].value.style['font-size']='32px';
    await assert.rejects(resolvePendingFormStyles({...f.input,source:forgedSource},f.permits),/source_or_knowledge_changed/);
    node.widgetSettings.button_typography_font_size.size=17;
    assert.throws(()=>compileNative44(first.program,{schemas:f.schemas,assets:[],knowledge:f.knowledge,pendingForms:first.pendingForms}),/process_capability/);
  } finally {await f.cleanup();}
});

const inquiryConfig:InquiryConfiguration={version:1,kind:'clonewp-inquiry-configuration',targetOrigin:'https://target.example',recipients:['sales@target.example'],fromEmail:'web@target.example',fromName:'Website',subject:'New inquiry',successMessage:'Thank you.',errorMessage:'Please try again.'};
async function useInquiry(f:Awaited<ReturnType<typeof fixture>>){
 await useTargetSubmissions(f);
 f.schema.controls.submit_actions.options={...(f.schema.controls.submit_actions.options as object),email:'Email'};
 for(const id of INQUIRY_EMAIL_CONTROLS){const control=loaded.components.form.controls.find(c=>c.id===id);assert.ok(control,'Research must contain '+id);assert.ok(control.type);f.schema.controls[id]={type:control.type,...(control.valueDomain?.options?.length?{options:Object.fromEntries(control.valueDomain.options.map(o=>[String(o.value),String(o.value)]))}:{}),...(control.defaultValue!==undefined?{default:control.defaultValue}:{}),...(control.type==='select2'?{multiple:true}:{})};}
 // Model the native Reply-To select and its labeled same-form email option.
 // This synthetic fixture stays explicit; it is not evidence from a live site.
 f.schema.controls.email_reply_to={type:'select',default:'',options:{'':''},render_type:'none',condition:{submit_actions:'email'}};
 (f.node.widgetSettings.form_fields as any[])[0].field_label='Email';
 for(const [index,item] of f.packets.entries()){
  const packet=item.packet as any,snapshotId=packet.snapshot.id,inputId='inquiry-email-'+index,labelId='inquiry-label-'+index;
  packet.nodes['email-'+index].attributes.id=inputId;
  packet.nodes[labelId]={id:labelId,tag:'label',parentId:'form-'+index,attributes:{for:inputId},text:'Email'};
  packet.nodes['form-'+index].childIds.push(labelId);
  const ref=await f.put('inquiry-packet-'+index+'.json',packet);
  for(const fact of Object.values(f.source.facts) as any[])if(fact.snapshotId===snapshotId)fact.evidence=ref;
  f.appearanceRows[index]={packet:ref,nodes:Object.values(packet.nodes)} as any;
 }
 f.program.sourceFacts=await f.put('inquiry-source.json',f.source);
 f.node.pendingForm!.appearance=await f.put('inquiry-appearance.json',{kind:'native44-visible-source-form-appearance-extraction',rows:f.appearanceRows});
 const registration=await f.put('inquiry-registration.json',{mode:'legacy-verified',legacySchemas:{form:f.schema},versions:{elementor:'synthetic',elementorPro:'synthetic'},sourceProof:{schemaErrors:{}}});
 f.node.pendingForm!.registered={capabilities:registration,schemaHash:native44RegisteredSchemaHash(f.schema)};
 const configuration=await f.put('inquiry-configuration.json',inquiryConfig);f.program.inquiryPolicy={...defaultInquiryPolicy(),configuration};
 f.program.blocks=configureInquiryBlocks(f.program.blocks,f.program.inquiryPolicy,inquiryConfig,f.program.taskId);f.node=f.program.blocks[0].kind==='composite'?f.program.blocks[0].children[0] as PendingFormNode:f.node;
}
test('new inquiry forms pass the actual source, research, registered, compiler and saved-DOM pipeline',()=>withFixture(async f=>{
 await useInquiry(f);const permits=await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program});const policyRemoved=structuredClone(f.program);delete policyRemoved.inquiryPolicy;assert.throws(()=>assertNative44PendingFormCapability(policyRemoved,f.node,{form:f.schema},permits[0]),/process_capability/);const all=await loadNative44Knowledge(['form','container']);const schemas={form:f.schema,container:{type:'container',class:'Elementor\\Includes\\Elements\\Container',controls:{css_classes:{type:'text'},_attributes:{type:'textarea'}}}};const compiled=compileNative44(f.program,{schemas,assets:[],knowledge:toNative44CompilerKnowledge(all,schemas),pendingForms:permits});const form=compiled.composition.elements[0].elements[0];assert.deepEqual(form.settings.submit_actions,['save-to-database','email']);assert.equal(form.settings.email_to,'sales@target.example');assert.equal(compiled.pendingFormBindings![0].kind,'native44-inquiry-configured');assertNative44PendingFormCompilation(compiled,schemas);
 const review=await import('../src/replica-full/target-submissions-review.js');const auth=await review.prepareTargetSubmissionFormReview({root:ROOT,program:f.program,pageId:123,currentElements:compiled.composition.elements,read:async(ref,base=ROOT)=>({filename:path.resolve(base,ref.path),bytes:await readFile(path.resolve(base,ref.path))})});assert.ok(auth);
 form.settings.email_to='foreign@example.com';await assert.rejects(()=>review.prepareTargetSubmissionFormReview({root:ROOT,program:f.program,pageId:123,currentElements:compiled.composition.elements,read:async(ref,base=ROOT)=>({filename:path.resolve(base,ref.path),bytes:await readFile(path.resolve(base,ref.path))})}));
}));
for(const scenario of ['foreign-recipient','unknown-action','config-file-changed','missing-policy','foreign-task','unregistered-email'])test('inquiry authorization rejects '+scenario,()=>withFixture(async f=>{
 await useInquiry(f);if(scenario==='foreign-recipient')f.node.widgetSettings.email_to='foreign@example.com';if(scenario==='unknown-action')f.node.widgetSettings.submit_actions=['save-to-database','email','webhook'];if(scenario==='config-file-changed')await writeFile(f.program.inquiryPolicy!.configuration!.path,'{}');if(scenario==='missing-policy')delete f.program.inquiryPolicy;if(scenario==='foreign-task')(f.node.pendingForm as any).decision.taskId='foreign';if(scenario==='unregistered-email'){delete f.schema.controls.submit_actions.options!.email;f.node.pendingForm!.registered={capabilities:await f.put('no-email.json',{legacySchemas:{form:f.schema},versions:{elementor:'synthetic',elementorPro:'synthetic'},sourceProof:{schemaErrors:{}}}),schemaHash:native44RegisteredSchemaHash(f.schema)};}await assert.rejects(()=>prepareNative44PendingFormCapabilities({root:ROOT,program:f.program}));
}));

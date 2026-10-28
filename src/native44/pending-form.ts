import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseFragment } from 'parse5';
import { readNative44StyleInputProof, type Native44StyleInputProof } from './style-input-proof.js';
import { resolveNative44Styles } from './style-resolution.js';
import type { Native44Control } from './knowledge.js';
import { toNative44CompilerKnowledge, loadNative44Knowledge } from './knowledge.js';
import { native44RegisteredSchemaHash } from './selection.js';
import type { Native44Program } from './types.js';
import { walkNative44 } from './types.js';
import type { LegacySchema } from '../wordpress/types.js';
import { verifySourceFormLiveState } from './source-form-state.js';
import { INQUIRY_ACTIONS, INQUIRY_EMAIL_CONTROLS, assertInquiryProgram, assertInquirySettings, inquiryConfigurationSchema } from './inquiry-form.js';
import { prepareFormWidthLayout, formWidthCSSHash } from './form-width-layout.js';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const refSchema = z.object({ path: z.string().min(1), sha256: hashSchema }).strict();
const pendingFormV1Schema = z.object({
  version: z.literal(1), kind: z.literal('native44-pending-form-v1'),
  /** Explicit source-only semantics; the target remains an inert native Form. */
  sourceSubmitModel: z.literal('aria-button').optional(),
  sourceControls: z.array(z.object({ snapshotId: z.string().min(1), emailFactId: z.string().min(1), submitFactId: z.string().min(1) }).strict()).length(2),
  /** A derivative source appearance extraction; it cannot establish a pass. */
  appearance: refSchema,
  registered: z.object({ capabilities: refSchema, schemaHash: hashSchema }).strict(),
  knowledge: z.object({ fingerprint: hashSchema, formComponentHash: hashSchema, sharedControlsHash: hashSchema }).strict(),
}).strict();
const pendingFormV2Schema = pendingFormV1Schema.extend({
  version: z.literal(2), kind: z.literal('native44-pending-form-v2'),
  widthLayout: refSchema.optional(),
  sourceControls: z.array(z.object({ snapshotId: z.string().min(1), fieldFactIds: z.array(z.string().min(1)).min(1).max(30), submitFactId: z.string().min(1), details: refSchema.optional(), stateObservation: refSchema.optional(), presentations: z.array(z.object({fieldFactId:z.string().min(1),presentationFactId:z.string().min(1)}).strict()).optional() }).strict()).length(2),
}).strict();
const targetSubmissionsFormSchema = pendingFormV2Schema.omit({ sourceSubmitModel: true }).extend({
  version: z.literal(3), kind: z.literal('native44-target-submissions-only-v1'),
  sourceControls: z.array(pendingFormV2Schema.shape.sourceControls.element.extend({ stateObservation: refSchema.optional() }).strict()).length(2),
  sourceSubmitModel: z.never().optional(),
  decision: z.object({ policy: z.literal('target-submissions-only'), taskId: z.string().min(1), authorization: z.literal('user-explicit') }).strict(),
}).strict();
const inquiryFormSchema = targetSubmissionsFormSchema.omit({decision:true}).extend({
  version: z.literal(4), kind: z.literal('native44-inquiry-form-v1'),
  configuration: refSchema, replyToFieldId: z.string().regex(/^(?:[A-Za-z][A-Za-z0-9_]{0,49})?$/),
  decision: z.object({policy:z.literal('submit-save-email'),taskId:z.string().min(1),authorization:z.literal('project-default')}).strict(),
}).strict();
export const native44PendingFormSchema = z.discriminatedUnion('version', [pendingFormV1Schema, pendingFormV2Schema, targetSubmissionsFormSchema, inquiryFormSchema]);
export type Native44PendingFormDeclaration = z.infer<typeof native44PendingFormSchema>;
export const NATIVE44_PENDING_FORM_ATTRIBUTES = 'inert|true\naria-disabled|true';
type Ref = { path: string; sha256: string };
export interface PendingFormNode {
  kind: 'native'; key: string; widgetType: string; widgetSettings: Record<string, unknown>;
  sourceFactIds?: string[]; children?: unknown[]; resources?: unknown[];
  pendingForm?: Native44PendingFormDeclaration;
}
export interface Native44PendingFormBinding {
  version: 1; kind: 'native44-pending-form-candidate' | 'native44-target-submissions-only-configured' | 'native44-inquiry-configured'; componentKey: string; elementId: string;
  sourceSubmitModel?: 'aria-button';
  sourceFacts: Ref; sourceControls: Native44PendingFormDeclaration['sourceControls']; packets: Ref[]; appearance: Ref;
  knowledge: Native44PendingFormDeclaration['knowledge']; registered: Native44PendingFormDeclaration['registered'];
  registeredVersions: Record<string, string>; settingsHash: string;
  businessStatus: 'pending' | 'configured'; runtimeVerification: 'required' | 'actual-submission-required' | 'user-managed-submission'; submitLabelVerification: 'source-visual-review-required';
  decision?: z.infer<typeof targetSubmissionsFormSchema>['decision'] | z.infer<typeof inquiryFormSchema>['decision'];
}
/** Opaque: only the verified local factory can create an authorization. */
export interface PendingFormCapability { readonly kind: 'native44-pending-form-capability'; readonly componentKey: string; }
export interface PendingFormAttributeAuthorization { readonly kind: 'native44-pending-form-attributes'; readonly elementId: string; }
interface CapabilityData { widthLayoutAncestorKeys?:string[]; widthLayoutCSSHash?:string; validateForm: (widgetType: string, settings: Record<string, unknown>) => Record<string, unknown>; sourceHash: string; strictNode?: PendingFormNode; styleControls?: Native44Control[]; identity: string; node: PendingFormNode; schemaHash: string; receipt: Omit<Native44PendingFormBinding, 'elementId' | 'settingsHash'>; }
const capabilities = new WeakMap<object, CapabilityData>();
const attributes = new WeakMap<object, { elementId: string; settingsHash: string; schemaHash: string; capability: PendingFormCapability }>();
const fail = (reason: string): never => { throw Error(`native44_pending_form_${reason}`); };
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value))) return fail('non_json_value');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('non_json_array');
    return `[${value.map(canonical).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function identity(program: Native44Program, node: PendingFormNode): string {
  return hash({ taskId: program.taskId, sourceUrl: program.sourceUrl, sourceFacts: program.sourceFacts, knowledge: program.knowledge, replicationProfile: program.replicationProfile, requirementProfile: program.requirementProfile, goalProfile: program.goalProfile, ...(program.inquiryPolicy ? {inquiryPolicy:program.inquiryPolicy} : {}), node });
}
/** Derive selector ancestry from the actual program tree, never a proof claim. */
function formAncestorKeys(program:Native44Program,key:string):string[]{
  const paths:string[][]=[];
  const visit=(items:any[],parents:string[])=>{for(const item of items){if(item.key===key)paths.push(parents);visit(item.children??item.slides??[],[...parents,item.key]);}};
  visit(program.blocks,[]);if(paths.length!==1)return fail('width_layout_ancestor_identity');return paths[0];
}
/** Explicit candidate syntax alone does not authorize compilation or inert. */
export function assertNative44PendingFormCandidate(node: PendingFormNode): Native44PendingFormDeclaration {
  const declaration = native44PendingFormSchema.parse(node.pendingForm);
  if (declaration.version !== 1) return assertPendingFormV2Candidate(node, declaration);
  if (node.kind !== 'native' || node.widgetType !== 'form' || node.children?.length || node.resources?.length) fail('only_resource_free_leaf_form');
  const s = node.widgetSettings;
  const allowed = new Set(['form_fields', 'button_text', 'selected_button_icon', 'submit_actions', '_attributes', 'css_classes', '_css_classes']);
  if (Object.keys(s).some(key => !allowed.has(key))) fail('unsupported_setting');
  if (s._attributes !== NATIVE44_PENDING_FORM_ATTRIBUTES || !Array.isArray(s.submit_actions) || s.submit_actions.length !== 0) fail('exact_disabled_wrapper_and_empty_actions_required');
  if (typeof s.button_text !== 'string' || s.button_text.length > 80 || /[<>\u0000-\u001f]/.test(s.button_text)) fail('invalid_submit_text');
  if (s.button_text === '') {
    if (!same(s.selected_button_icon, { value: 'fas fa-angle-right', library: 'fa-solid' })) fail('native_arrow_icon_required');
  } else if (!(s.button_text as string).trim() || s.selected_button_icon !== undefined) fail('invalid_submit_presentation');
  if (!Array.isArray(s.form_fields) || s.form_fields.length !== 1) fail('single_email_required');
  const field = (s.form_fields as unknown[])[0] as Record<string, unknown>;
  if (!field || typeof field !== 'object' || Array.isArray(field) || Object.keys(field).some(key => !['_id', 'field_type', 'field_label', 'placeholder', 'required', 'width', 'custom_id'].includes(key))) fail('unsupported_email_field');
  if (field.field_type !== 'email' || typeof field.placeholder !== 'string' || !field.placeholder || /[<>\u0000-\u001f]/.test(field.placeholder) || field.field_label !== '' || field.required !== '' || field.width !== '100' || field.custom_id !== 'email' || field._id !== undefined && (typeof field._id !== 'string' || !/^[a-f0-9]{7}$/.test(field._id))) fail('invalid_email_field');
  for (const key of ['css_classes', '_css_classes']) if (s[key] !== undefined && (typeof s[key] !== 'string' || !/^[a-zA-Z0-9_\s-]*$/.test(s[key] as string))) fail('invalid_classes');
  const facts = declaration.sourceControls.flatMap(row => [row.emailFactId, row.submitFactId]);
  if (new Set(declaration.sourceControls.map(row => row.snapshotId)).size !== 2 || new Set(facts).size !== 4 || node.sourceFactIds?.length !== 4 || new Set(node.sourceFactIds).size !== 4 || facts.some(id => !node.sourceFactIds!.includes(id))) fail('source_control_ownership');
  canonical(node); return declaration;
}
function assertPendingFormV2Candidate(node: PendingFormNode, declaration: z.infer<typeof pendingFormV2Schema> | z.infer<typeof targetSubmissionsFormSchema> | z.infer<typeof inquiryFormSchema>) {
  if (node.kind !== 'native' || node.widgetType !== 'form' || node.children?.length || node.resources?.length) fail('only_resource_free_leaf_form');
  const settings = node.widgetSettings;
  const enabled = declaration.version >= 3;
  if (enabled) {
    if (!same(settings.submit_actions, declaration.version === 4 ? [...INQUIRY_ACTIONS] : ['save-to-database'])) fail('target_submissions_exact_action_required');
    if (Object.keys(settings).some(key => /^(?:email|webhook|redirect|mailchimp|mailerlite|activecampaign|convertkit|drip|getresponse|slack|discord|popup|custom_css)(?:_|$)/i.test(key) && !(declaration.version === 4 && (INQUIRY_EMAIL_CONTROLS as readonly string[]).includes(key)))) fail('target_submissions_business_setting_forbidden');
    if (settings._attributes !== undefined && (typeof settings._attributes !== 'string' || settings._attributes.split(/[\r\n,]+/).some(line => /^(?:inert|disabled|aria-disabled)\s*\|/i.test(line.trim())))) fail('target_submissions_interactive_fields_required');
  } else if (Object.keys(settings).some(key => !['form_fields','button_text','submit_actions','_attributes','css_classes','_css_classes'].includes(key)) || settings._attributes !== NATIVE44_PENDING_FORM_ATTRIBUTES || !same(settings.submit_actions, [])) fail('exact_disabled_wrapper_and_empty_actions_required');
  if (typeof settings.button_text !== 'string' || !settings.button_text.trim() || settings.button_text.length > 80 || /[<>\u0000-\u001f]/.test(settings.button_text)) fail('invalid_submit_text');
  if (!Array.isArray(settings.form_fields) || !settings.form_fields.length || settings.form_fields.length > 30) fail('v2_fields_required');
  const names = new Set<string>();
  for (const field of settings.form_fields as Record<string, any>[]) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return fail('v2_invalid_field');
    if (!enabled && Object.keys(field).some(key => !['_id','field_type','field_label','placeholder','required','width','custom_id','field_options'].includes(key)) || !['text','email','tel','number','select','textarea'].includes(field.field_type) || !['','true'].includes(field.required) || typeof field.width !== 'string' || !/^\d{1,3}$/.test(field.width) || Number(field.width) < 1 || Number(field.width) > 100 || typeof field.custom_id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(field.custom_id) || names.has(field.custom_id)) fail('v2_invalid_field');
    if (enabled && Object.keys(field).some(key => /(?:^|_)(?:disabled|readonly|attributes|html|script)(?:_|$)/i.test(key))) fail('target_submissions_interactive_fields_required');
    names.add(field.custom_id);
    for (const key of ['field_label','placeholder']) if (typeof field[key] !== 'string' || /[<>\u0000-\u001f]/.test(field[key])) fail('v2_invalid_field_text');
    if (field._id !== undefined && (typeof field._id !== 'string' || !/^[a-f0-9]{7}$/.test(field._id))) fail('v2_field_identity');
    if (field.field_type === 'select' ? typeof field.field_options !== 'string' || !field.field_options || /[<>\u0000\r]/.test(field.field_options) : field.field_options !== undefined) fail('v2_field_options');
  }
  for (const key of ['css_classes','_css_classes']) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || !/^[a-zA-Z0-9_\s-]*$/.test(settings[key] as string))) fail('invalid_classes');
  const facts = declaration.sourceControls.flatMap(row => [...row.fieldFactIds,row.submitFactId,...(row.presentations??[]).map(item=>item.presentationFactId)]);
  if (new Set(declaration.sourceControls.map(row => row.snapshotId)).size !== 2 || declaration.sourceControls.some(row => row.fieldFactIds.length !== (settings.form_fields as unknown[]).length) || new Set(facts).size !== facts.length || !same([...facts].sort(), [...(node.sourceFactIds ?? [])].sort())) fail('source_control_ownership');
  canonical(node); return declaration;
}
async function boundJSON(root: string, reference: Ref): Promise<any> {
  refSchema.parse(reference);
  const base = await realpath(root), file = await realpath(path.resolve(root, reference.path)), relative = path.relative(base, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('evidence_path_escape');
  const bytes = await readFile(file); if (bytesHash(bytes) !== reference.sha256) fail('evidence_hash_mismatch');
  return JSON.parse(bytes.toString('utf8'));
}
function registeredContract(schema: LegacySchema): void {
  if (schema?.type !== 'form' || schema.class !== 'ElementorPro\\Modules\\Forms\\Widgets\\Form') fail('registered_form_class');
  for (const [key, type] of Object.entries({ form_fields: 'form-fields-repeater', button_text: 'text', submit_actions: 'select2', _attributes: 'textarea' })) if (schema.controls?.[key]?.type !== type) fail(`registered_control_${key}`);
  const raw = schema.controls.form_fields.fields;
  if (!raw || typeof raw !== 'object') fail('registered_email_fields');
  const fields = Object.fromEntries(Object.entries(raw as object).map(([key, value]: [string, any]) => [value?.name ?? key, value]));
  for (const [key, type] of Object.entries({ field_type: 'select', field_label: 'text', placeholder: 'text', required: 'switcher', width: 'select', custom_id: 'text' })) if (fields[key]?.type !== type) fail(`registered_email_${key}`);
  if (!Object.hasOwn(fields.field_type.options ?? {}, 'email') || !Object.hasOwn(fields.width.options ?? {}, '100')) fail('registered_email_options');
}
function underneath(nodes: Record<string, any>, nodeId: string, owner: string): boolean {
  const seen = new Set<string>(); let current: string | undefined = nodeId;
  while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = nodes[current]?.parentId; }
  return false;
}
/** Recover form semantics omitted by the observation attribute projection, only
 * from an unambiguous control in the separately hash-bound source HTML. */
export function sourceFormControlSemantics(raw: {tag:string;attributes?:Record<string,string>}, formHTML?:string): {required:boolean;submitLabel?:string} {
  const attributes=raw.attributes??{};
  let actual=attributes, htmlText='';
  if(formHTML){
    const root=parseFragment(formHTML) as any,matches:any[]=[];
    const collect=(node:any)=>{const a=Object.fromEntries((node.attrs??[]).map((row:any)=>[row.name,row.value]));if(node.tagName===raw.tag&&['type','name','placeholder','id'].every(key=>(a[key]??null)===(attributes[key]??null)))matches.push({node,attributes:a});for(const child of node.childNodes??[])collect(child);};collect(root);
    if(matches.length===1){actual=matches[0].attributes;const text=(node:any):string=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(text).join('');htmlText=text(matches[0].node).trim();}
  }
  // notnull is an explicit source validation marker; a placeholder star alone
  // never establishes requiredness.
  const required=Object.hasOwn(actual,'required')||Object.hasOwn(actual,'notnull');
  return {required,...(raw.tag==='input'&&attributes.type==='submit'&&Object.hasOwn(actual,'value')?{submitLabel:actual.value}:raw.tag==='button'&&htmlText?{submitLabel:htmlText}:{})};
}
export function sourceFormFieldLabelMatches(field:Record<string,any>,sourceLabel:string,context:{version:number;replyToFieldId?:string;showLabels:unknown}):boolean{
  if(field.field_label===sourceLabel)return true;
  return context.version===4&&context.replyToFieldId===field.custom_id&&field.field_type==='email'&&context.showLabels===''&&sourceLabel===''&&/e[-_\s]?mail/i.test(field.placeholder)&&field.field_label===field.placeholder.replace(/\s*\*\s*$/,'').trim();
}
async function verifyV2Source(root: string, source: any, node: PendingFormNode, declaration: z.infer<typeof pendingFormV2Schema> | z.infer<typeof targetSubmissionsFormSchema> | z.infer<typeof inquiryFormSchema>, schema: LegacySchema, appearance: any, claimed: Set<string>, css?:string,ancestorKeys?:string[]): Promise<Ref[]> {
  const fields = node.widgetSettings.form_fields as Record<string, any>[];
  const registered = Object.fromEntries(Object.entries(schema.controls.form_fields.fields as object).map(([key,value]: [string,any]) => [value?.name ?? key,value]));
  for (const field of fields) {
    if (!Object.hasOwn(registered.field_type.options ?? {},field.field_type) || !Object.hasOwn(registered.width.options ?? {},field.width) || field.field_type === 'select' && registered.field_options?.type !== 'textarea') fail('v2_registered_field');
    if (field.required === 'true' && registered.required.return_value !== 'true' && !Object.hasOwn(registered.required.options ?? {},'true')) fail('v2_registered_required');
  }
  const widthLayout=declaration.widthLayout?await prepareFormWidthLayout({root,reference:declaration.widthLayout,componentKey:node.key,ancestorKeys,css,fields:fields as Array<{custom_id:string}>,sourceControls:declaration.sourceControls}):undefined;
  const packets: Ref[] = [...widthLayout?.references??[]], dimensions: string[] = [];
  for (const row of declaration.sourceControls) {
    const snapshot = source.snapshots.find((item: any) => item.id === row.snapshotId);
    if (!snapshot) fail('source_snapshot');
    dimensions.push(`${snapshot.viewport.width}x${snapshot.viewport.height}`);
    const facts = [...row.fieldFactIds,row.submitFactId].map(id => source.facts[id]);
    if (facts.some(fact => !fact || fact.kind !== 'interaction' || fact.snapshotId !== row.snapshotId || fact.nodeId !== fact.value?.nodeId || fact.value.kind !== 'control' || !same(fact.evidence,facts[0].evidence) || fact.regionId !== facts[0].regionId)) fail('v2_source_facts');
    const packet = await boundJSON(root,facts[0].evidence);
    const details = row.details ? await boundJSON(root,row.details) : undefined;
    let detailedControls: any[] | undefined;
    let detailOffsetY = 0;
    if (details) {
      if (details.sourceUrl !== source.sourceUrl || details.viewport?.width!==snapshot.viewport.width || details.viewport?.height!==snapshot.viewport.height || typeof details.formHTML !== 'string' || !Array.isArray(details.controls)) fail('v2_source_details_identity');
      const html = parseFragment(details.formHTML) as any, htmlControls: any[] = [];
      const collect = (item:any) => {if (['input','select','textarea','button'].includes(item.tagName)) htmlControls.push(item);for(const child of item.childNodes??[])collect(child);};collect(html);
      if (htmlControls.length !== details.controls.length) fail('v2_source_details_inventory');
      detailedControls = details.controls;
      const firstRaw=packet.nodes[facts[0].nodeId],firstMatches=details.controls.filter((control:any)=>control.tag.toLowerCase()===firstRaw.tag&&(control.type??null)===(firstRaw.attributes?.type??null)&&(control.placeholder??null)===(firstRaw.attributes?.placeholder??null));
      if(firstMatches.length!==1)fail('v2_source_details_binding');
      detailOffsetY=firstMatches[0].rect.y-packet.layouts[firstRaw.layoutId].rect.y;
      for(const [index,control] of (detailedControls as any[]).entries()) {
        const native = htmlControls[index],attrs=Object.fromEntries(native.attrs.map((attribute:any)=>[attribute.name,attribute.value]));
        if(native.tagName!==control.tag.toLowerCase()||(attrs.type??null)!==control.type||(attrs.name??null)!==control.name||(attrs.placeholder??null)!==control.placeholder)fail('v2_source_details_html');
        if(control.options){const text=(item:any):string=>item.nodeName==='#text'?item.value:(item.childNodes??[]).map(text).join('');const options:any[]=[];const walk=(item:any)=>{if(item.tagName==='option'){const attributes=Object.fromEntries(item.attrs.map((attribute:any)=>[attribute.name,attribute.value]));options.push({text:text(item).trim(),value:attributes.value??text(item).trim()});}for(const child of item.childNodes??[])walk(child);};walk(native);if(!same(options,control.options))fail('v2_source_details_options');}
      }
    }
    const owners = facts.map(fact => {
      if (fact.value.details?.form) return JSON.parse(fact.value.details.form);
      const seen = new Set<string>(); let current = packet.nodes?.[fact.nodeId];
      while (current && !seen.has(current.id)) { if (current.tag === 'form') return {nodeId:current.id,submitControlNodeId:facts.at(-1).nodeId}; seen.add(current.id); current = packet.nodes[current.parentId]; }
      return {};
    });
    if (owners.some(owner => !same(owner,owners[0])) || typeof owners[0].nodeId !== 'string' || owners[0].submitControlNodeId !== facts.at(-1).nodeId) fail('source_form_owner');
    const owner = owners[0].nodeId, claim = `${row.snapshotId}:${owner}`;
    if (claimed.has(claim)) fail('duplicate_source_form'); claimed.add(claim);
    if (packet.version !== 2 || packet.kind !== 'observation-packet' || packet.snapshot.id !== row.snapshotId || !same(packet.snapshot.viewport,snapshot.viewport) || packet.nodes?.[owner]?.tag !== 'form') fail('packet_snapshot');
    if (appearance.rows.filter((item: any) => same(item.packet,facts[0].evidence) && facts.every(fact => item.nodes?.some((raw: any) => raw.id === fact.nodeId))).length !== 1) fail('source_appearance_binding');
    const stateObservation = row.stateObservation;
    const liveState = stateObservation ? await verifySourceFormLiveState(root, stateObservation, { sourceUrl: source.sourceUrl, snapshotId: row.snapshotId, viewport: snapshot.viewport, packet, formNodeId: owner, factNodeIds: facts.map(fact => fact.nodeId), presentations: (row.presentations ?? []).map(binding => ({ fieldNodeId: source.facts[binding.fieldFactId]?.nodeId, presentationNodeId: source.facts[binding.presentationFactId]?.nodeId })), details }) : undefined;
    for (const [index,fact] of facts.entries()) {
      const raw = packet.nodes[fact.nodeId];
      const presentation = row.presentations?.find(item=>item.fieldFactId===row.fieldFactIds[index]);
      const presentationFact = presentation && source.facts[presentation.presentationFactId];
      const painted = presentationFact ? packet.nodes[presentationFact.nodeId] : raw;
      if(presentation && (!details || raw?.tag!=='select'||presentationFact?.snapshotId!==row.snapshotId||presentationFact.kind!=='interaction'||!same(presentationFact.evidence,fact.evidence)||painted?.tag!=='button'||painted.attributes?.role!=='combobox'||painted.parentId!==raw.parentId))fail('v2_source_select_presentation');
      const liveControl = liveState?.footprints.get(raw?.id), rect = liveControl?.rect ?? packet.layouts?.[painted?.layoutId]?.rect, style = liveControl?.styles ?? packet.styles?.[painted?.styleId];
      if (!raw || (liveControl?.visible ?? painted.visible) !== true || !underneath(packet.nodes,raw.id,owner) || raw.selector !== fact.value.selector || !rect || rect.width <= 0 || rect.height <= 0 || !style || style.display === 'none' || ['hidden','collapse'].includes(style.visibility)) fail('source_visible_footprint');
      const interactions = Object.values(packet.interactions ?? {}).filter((value: any) => value.id === fact.value.id) as any[];
      let projected = interactions[0] && !Object.hasOwn(interactions[0],'selector') ? {...interactions[0],selector:raw.selector} : interactions[0];
      for (const [field, value] of [['style', packet.styles?.[raw.styleId]], ['layout', packet.layouts?.[raw.layoutId]]] as const) if (Object.hasOwn(fact.value, field)) { if (!value || !same(fact.value[field], value)) fail('packet_interaction_binding'); projected = { ...projected, [field]: value }; }
      if (interactions.length !== 1 || !same(projected,fact.value)) fail('packet_interaction_binding');
      if (index === fields.length) {
        if (!['input','button'].includes(raw.tag) || raw.attributes?.type !== 'submit') fail('packet_controls');
        const label = sourceFormControlSemantics(raw,details?.formHTML).submitLabel ?? (raw.tag === 'input' ? raw.attributes.value : raw.text ?? Object.values(packet.texts ?? {}).filter((item: any) => item.nodeId === raw.id).map((item: any) => item.text).join(''));
        if (typeof label !== 'string' || label.trim() !== node.widgetSettings.button_text) fail('v2_submit_label');
        continue;
      }
      const field = fields[index], type = raw.tag === 'input' ? raw.attributes?.type ?? 'text' : raw.tag;
      const stateRawControl = liveState?.state.controls.find(control => control.selector === raw.selector);
      const detailed = detailedControls?.filter(control=>control.tag.toLowerCase()===raw.tag&&(control.type??null)===(raw.attributes?.type??null)&&control.placeholder===(raw.attributes?.placeholder??null)&&((Math.abs(control.rect.x-packet.layouts[raw.layoutId].rect.x)<1&&Math.abs(control.rect.y-packet.layouts[raw.layoutId].rect.y-detailOffsetY)<1&&Math.abs(control.rect.width-packet.layouts[raw.layoutId].rect.width)<1&&Math.abs(control.rect.height-packet.layouts[raw.layoutId].rect.height)<1)||(stateRawControl&&control.selector===raw.selector&&['x','y','width','height'].every(key=>Math.abs(control.rect[key]-stateRawControl.rect[key as keyof typeof stateRawControl.rect])<1))));
      if(detailedControls&&detailed?.length!==1)fail('v2_source_details_binding');
      const detailedControl=detailed?.[0];
      const inquiryEmail = declaration.version === 4 && type === 'text' && field.field_type === 'email' && declaration.replyToFieldId === field.custom_id && /e[-_\s]?mail|邮箱|邮件|correo|courriel/i.test(field.custom_id+' '+field.field_label+' '+field.placeholder);
      const required = sourceFormControlSemantics(raw,details?.formHTML).required || detailedControl?.required === true;
      if (type !== field.field_type && !inquiryEmail || !['input','textarea','select'].includes(raw.tag) || field.placeholder !== (raw.attributes?.placeholder ?? '') || (field.required === 'true') !== required) fail('v2_source_field_content');
      const formRect = liveState?.state.formRect ?? packet.layouts?.[packet.nodes[owner].layoutId]?.rect;
      const verifiedWidth=widthLayout?.verify(field.custom_id,row.fieldFactIds[index],snapshot.viewport.width,rect.width)??false;
      if (!formRect || formRect.width <= 0 || Math.abs(rect.width / formRect.width * 100 - Number(field.width)) > 12 && !verifiedWidth) fail('v2_source_field_width');
      const labels = Object.values(packet.nodes).filter((candidate: any) => candidate.tag === 'label' && candidate.attributes?.for === raw.attributes?.id && underneath(packet.nodes,candidate.id,owner)) as any[];
      const sourceLabel=(detailedControl?.label ?? labels[0]?.text ?? '').trim();
      // Native Reply-To options require a label. Keep this metadata invisible
      // and derive it exactly from the observed Email placeholder.
      if (!sourceFormFieldLabelMatches(field,sourceLabel,{version:declaration.version,replyToFieldId:declaration.version===4?declaration.replyToFieldId:undefined,showLabels:node.widgetSettings.show_labels}) || labels.length > 1) fail('v2_source_field_label');
      if (type === 'select') {
        const options = Object.values(packet.nodes).filter((candidate: any) => candidate.tag === 'option' && underneath(packet.nodes,candidate.id,raw.id)) as any[];
        if (detailedControl?.options) {if(field.field_options!==detailedControl.options.map((option:any)=>`${option.text}|${option.value}`).join('\n'))fail('v2_source_select_options');continue;}
        if (options.some(option => typeof option.attributes?.value !== 'string')) fail('v2_source_select_values_missing');
        const expected = options.map(option => `${(option.text ?? Object.values(packet.texts ?? {}).filter((item: any) => item.nodeId === option.id).map((item: any) => item.text).join('')).trim()}|${option.attributes.value}`).join('\n');
        if (!options.length || field.field_options !== expected) fail('v2_source_select_options');
      }
    }
    if (!liveState) {
      const visible = Object.values(packet.nodes).filter((raw: any) => ['input','button','select','textarea'].includes(raw.tag) && raw.visible === true && underneath(packet.nodes,raw.id,owner)) as any[];
      const expectedVisible = facts.filter(fact=>packet.nodes[fact.nodeId].visible===true).map(fact=>fact.nodeId).concat((row.presentations??[]).map(item=>source.facts[item.presentationFactId].nodeId));
      if (visible.length !== expectedVisible.length || visible.some(raw => !expectedVisible.includes(raw.id))) fail('source_extra_visible_controls');
    }
    packets.push(facts[0].evidence);
    if(row.details)packets.push(row.details);
    if (stateObservation && liveState) packets.push(stateObservation, liveState.screenshot);
  }
  if (!same(dimensions.sort(),['1440x1000','1920x1080'])) fail('source_desktops');
  widthLayout?.complete();
  return packets;
}
/** All reads are local and hash-bound. A persisted declaration is never a
 * current-process compile permit, nor evidence that the frontend is inert. */
export async function prepareNative44PendingFormCapabilities(options: { root: string; program: Native44Program; css?:string }): Promise<PendingFormCapability[]> {
  const { root, program } = options;
  const nodes: PendingFormNode[] = [];
  const walk = (items: any[]) => { for (const item of items) { if (item.pendingForm !== undefined) nodes.push(item); walk(item.children ?? item.slides ?? []); } }; walk(program.blocks);
  if (!nodes.length) return [];
  if (program.replicationProfile !== 'desktop-browser-v1' || program.requirementProfile !== 'source-requirements-v1' || program.goalProfile !== 'component-reference-v1') fail('explicit_desktop_contract_required');
  const source = await boundJSON(root, program.sourceFacts), index = await boundJSON(root, { path: program.knowledge.path, sha256: program.knowledge.sha256 });
  if (source.version !== 2 || source.kind !== 'source-facts' || source.sourceUrl !== program.sourceUrl || !Array.isArray(source.snapshots) || !source.facts) fail('source_identity');
  const knowledge = await loadNative44Knowledge(['form'], path.dirname(path.resolve(root, program.knowledge.path)));
  if (knowledge.index.fingerprint !== program.knowledge.fingerprint || index.fingerprint !== knowledge.index.fingerprint) fail('knowledge_identity');
  const out: PendingFormCapability[] = [];
  const claimed = new Set<string>();
  for (const node of nodes) {
    const declaration = assertNative44PendingFormCandidate(node);
    if ((declaration.version === 3 || declaration.version === 4) && declaration.decision.taskId !== program.taskId) fail('target_submissions_task_decision');
    if (declaration.version === 4) {
      if (!program.inquiryPolicy) fail('inquiry_policy_required');
      assertInquiryProgram(program);
      const configuration = inquiryConfigurationSchema.parse(await boundJSON(root,declaration.configuration));
      assertInquirySettings(node.widgetSettings,configuration,declaration.replyToFieldId,program.sourceUrl);
    }
    if (declaration.knowledge.fingerprint !== knowledge.index.fingerprint || declaration.knowledge.formComponentHash !== knowledge.index.components.form.sha256 || declaration.knowledge.sharedControlsHash !== knowledge.index.sharedControls.sha256) fail('knowledge_binding');
    for (const key of ['form_fields', 'button_text', 'submit_actions', '_attributes']) {
      const control = knowledge.components.form.controls.find(control => control.id === key), evidence = control?.sourceEvidence as any;
      if (!control || evidence?.packageId !== 'elementor-pro' || evidence.entry !== (key === '_attributes' ? 'elementor-pro/modules/custom-attributes/module.php' : 'elementor-pro/modules/forms/widgets/form.php') || !/^[a-f0-9]{64}$/.test(evidence.declarationHash ?? '')) fail('source_declaration_binding');
    }
    const actual = await boundJSON(root, declaration.registered.capabilities), schema = actual.legacySchemas?.form as LegacySchema;
    registeredContract(schema);
    if (declaration.version >= 3 && (schema.controls.submit_actions.multiple !== true || !Object.hasOwn(schema.controls.submit_actions.options ?? {}, 'save-to-database'))) fail('target_submissions_action_unregistered');
    if (declaration.version === 4 && (!Object.hasOwn(schema.controls.submit_actions.options ?? {},'email') || INQUIRY_EMAIL_CONTROLS.some(key => !schema.controls[key] || !knowledge.components.form.controls.some(control => control.id === key)))) fail('inquiry_registered_controls_required');
    if (node.widgetSettings.selected_button_icon !== undefined && (schema.controls.selected_button_icon?.type !== 'icons' || !knowledge.components.form.controls.some(control => control.id === 'selected_button_icon' && control.type === 'icons'))) fail('registered_button_icon');
    if (native44RegisteredSchemaHash(schema) !== declaration.registered.schemaHash || !actual.versions?.elementor || !actual.versions?.elementorPro || actual.sourceProof?.schemaErrors?.form) fail('registered_binding');
    const appearance = await boundJSON(root, declaration.appearance);
    if (appearance.kind !== 'native44-visible-source-form-appearance-extraction' || !Array.isArray(appearance.rows)) fail('source_appearance');
    const packets: Ref[] = [], dimensions: string[] = [];
    if (declaration.version !== 1) packets.push(...await verifyV2Source(root,source,node,declaration,schema,appearance,claimed,options.css,declaration.widthLayout?formAncestorKeys(program,node.key):undefined));
    else {
    for (const row of declaration.sourceControls) {
      const snapshot = source.snapshots.find((snapshot: any) => snapshot.id === row.snapshotId);
      if (!snapshot) fail('source_snapshot');
      dimensions.push(`${snapshot.viewport.width}x${snapshot.viewport.height}`);
      const email = source.facts[row.emailFactId], submit = source.facts[row.submitFactId];
      const ariaSubmit = declaration.sourceSubmitModel === 'aria-button';
      if ([email, submit].some(fact => !fact || fact.kind !== 'interaction' || fact.snapshotId !== row.snapshotId || fact.value?.nodeId !== fact.nodeId || fact.value?.kind !== 'control') || email.value.details?.type !== 'email' || submit.value.details?.type !== (ariaSubmit ? 'div' : 'submit') || email.regionId !== submit.regionId || !same(email.evidence, submit.evidence)) fail('source_facts');
      const form = JSON.parse(email.value.details.form), submitForm = JSON.parse(submit.value.details.form);
      if (!same(form, submitForm) || form.submitControlNodeId !== submit.nodeId || typeof form.nodeId !== 'string') fail('source_form_owner');
      const ownership = `${row.snapshotId}:${form.nodeId}`; if (claimed.has(ownership)) fail('duplicate_source_form'); claimed.add(ownership);
      const packet = await boundJSON(root, email.evidence);
      if (packet.version !== 2 || packet.kind !== 'observation-packet' || packet.snapshot?.id !== row.snapshotId || packet.snapshot.viewport?.width !== snapshot.viewport.width || packet.snapshot.viewport?.height !== snapshot.viewport.height) fail('packet_snapshot');
      const rawEmail = packet.nodes?.[email.nodeId], rawSubmit = packet.nodes?.[submit.nodeId], rawForm = packet.nodes?.[form.nodeId];
      const appearanceRows = appearance.rows.filter((item: any) => same(item.packet, email.evidence) && item.nodes?.some((raw: any) => raw.id === email.nodeId) && item.nodes?.some((raw: any) => raw.id === submit.nodeId));
      if (appearanceRows.length !== 1) fail('source_appearance_binding');
      const validSubmit = ariaSubmit ? rawSubmit?.tag === 'div' && rawSubmit.attributes?.role === 'button' : ['input', 'button'].includes(rawSubmit?.tag) && rawSubmit.attributes?.type === 'submit';
      if (rawForm?.tag !== 'form' || rawEmail?.tag !== 'input' || !validSubmit || rawEmail.attributes?.type !== 'email' || rawEmail.selector !== email.value.selector || rawSubmit.selector !== submit.value.selector || !underneath(packet.nodes, email.nodeId, form.nodeId) || !underneath(packet.nodes, submit.nodeId, form.nodeId)) fail('packet_controls');
      for (const raw of [rawEmail, rawSubmit]) {
        const rect = packet.layouts?.[raw.layoutId]?.rect, style = packet.styles?.[raw.styleId];
        if (raw.visible !== true || !rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0 || !style || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) fail('source_visible_footprint');
        const matches = Object.values(packet.interactions ?? {}).filter((item: any) => item.id === (raw === rawEmail ? email.value.id : submit.value.id)) as Record<string, unknown>[];
        // Source-facts assembly adds the exact raw node selector. Original
        // packet interaction records need not duplicate that node field.
        const interaction = matches[0], projected = interaction && !Object.hasOwn(interaction, 'selector') ? { ...interaction, selector: raw.selector } : interaction;
        if (matches.length !== 1 || !same(projected, raw === rawEmail ? email.value : submit.value)) fail('packet_interaction_binding');
      }
      const visible = Object.values(packet.nodes).filter((raw: any) => (['input', 'button', 'select', 'textarea'].includes(raw.tag) || ariaSubmit && raw.attributes?.role === 'button') && raw.visible === true && underneath(packet.nodes, raw.id, form.nodeId));
      if (visible.length !== 2 || !visible.includes(rawEmail) || !visible.includes(rawSubmit)) fail('source_extra_visible_controls');
      if ((node.widgetSettings.form_fields as any[])[0].placeholder !== rawEmail.attributes.placeholder || Object.hasOwn(rawEmail.attributes, 'required')) fail('source_email_content');
      packets.push(email.evidence);
    }
    if (!same(dimensions.sort(), ['1440x1000', '1920x1080'])) fail('source_desktops');
    }
    const receipt: CapabilityData['receipt'] = { version: 1, kind: declaration.version === 4 ? 'native44-inquiry-configured' : declaration.version === 3 ? 'native44-target-submissions-only-configured' : 'native44-pending-form-candidate', ...('sourceSubmitModel' in declaration && declaration.sourceSubmitModel ? { sourceSubmitModel: declaration.sourceSubmitModel } : {}), componentKey: node.key, sourceFacts: structuredClone(program.sourceFacts), sourceControls: structuredClone(declaration.sourceControls), packets: structuredClone(packets), appearance: structuredClone(declaration.appearance), knowledge: structuredClone(declaration.knowledge), registered: structuredClone(declaration.registered), registeredVersions: structuredClone(actual.versions), businessStatus: declaration.version >= 3 ? 'configured' : 'pending', runtimeVerification: declaration.version === 4 && program.inquiryPolicy?.testing === 'user-managed' ? 'user-managed-submission' : declaration.version >= 3 ? 'actual-submission-required' : 'required', submitLabelVerification: 'source-visual-review-required', ...((declaration.version === 3 || declaration.version === 4) ? { decision: structuredClone(declaration.decision) } : {}) };
    const capability: PendingFormCapability = Object.freeze({ kind: 'native44-pending-form-capability', componentKey: node.key });
    capabilities.set(capability, { ...(declaration.version!==1&&declaration.widthLayout?{widthLayoutAncestorKeys:formAncestorKeys(program,node.key),widthLayoutCSSHash:formWidthCSSHash(options.css!)}:{}),identity: identity(program, node), node: structuredClone(node), schemaHash: declaration.registered.schemaHash, validateForm: toNative44CompilerKnowledge(knowledge, {form:schema}).validateSettings, sourceHash: hash(source), styleControls: structuredClone(knowledge.components.form.controls), receipt }); out.push(capability);
  }
  return out;
}
export function assertNative44PendingFormCapability(program: Native44Program, node: PendingFormNode, schemas: Record<string, LegacySchema>, capability: PendingFormCapability | undefined): void {
  const data = capability && capabilities.get(capability);
  if (!data || data.identity !== identity(program, node) || native44RegisteredSchemaHash(schemas.form) !== data.schemaHash) fail('exact_process_capability_required');
  if(data!.widthLayoutAncestorKeys&&!same(data!.widthLayoutAncestorKeys,formAncestorKeys(program,node.key)))fail('width_layout_ancestor_changed');
  assertNative44PendingFormCandidate(data!.strictNode ?? node); registeredContract(schemas.form);
}
/** Runs the fixed style resolver itself: serialized receipts or arbitrary styled
 * nodes cannot mint a permit. Only source-researched, registered style deltas
 * produced by this execution are admitted; business/source identity stays exact. */
export async function resolvePendingFormStyles(input: Parameters<typeof resolveNative44Styles>[0], permits: readonly PendingFormCapability[], proof?: Native44StyleInputProof) {
  if (proof) {
    const verified = await readNative44StyleInputProof(proof);
    if (!same(input.program, verified.program) || !same(input.source, verified.source) || !same(input.schemas, verified.schemas) || input.css !== verified.css || input.mobileMaxWidth !== verified.mobileMaxWidth) fail('style_input_changed');
    const originalNodes = walkNative44(verified.baseProgram.blocks), targetNodes = walkNative44(verified.program.blocks);
    permits = permits.map(permit => {
      const source = originalNodes.find(row => row.key === permit.componentKey) as PendingFormNode;
      const target = targetNodes.find(row => row.key === permit.componentKey) as PendingFormNode;
      if (!source || !target) return fail('attested_responsive_owner');
      assertNative44PendingFormCapability(verified.baseProgram, source, input.schemas, permit);
      const restored = structuredClone(target) as PendingFormNode & {styleBindings?: unknown; nativeStyleSettings?: unknown};
      const original = source as PendingFormNode & {styleBindings?: unknown; nativeStyleSettings?: unknown};
      for (const key of ['sourceFactIds','styleBindings','nativeStyleSettings'] as const) {
        if (original[key] === undefined) delete restored[key]; else (restored as any)[key] = structuredClone(original[key]);
      }
      const data=capabilities.get(permit)!;
      if (identity(verified.baseProgram, restored) !== data.identity) return fail('attested_responsive_changed_form');
      const derived: PendingFormCapability=Object.freeze({kind:'native44-pending-form-capability',componentKey:target.key});
      capabilities.set(derived,{...data,identity:identity(verified.program,target),node:structuredClone(target),strictNode:structuredClone(data.strictNode ?? source)});
      return derived;
    });
    input = verified;
  }
  const before = walkNative44(input.program.blocks);
  for (const permit of permits) {
    const node = before.find(n => n.key === permit.componentKey) as PendingFormNode;
    if (!node) fail('style_owner');
    assertNative44PendingFormCapability(input.program, node, input.schemas, permit);
    const data=capabilities.get(permit)!;
    if(data.widthLayoutCSSHash&&data.widthLayoutCSSHash!==formWidthCSSHash(input.css))fail('width_layout_css_changed');
    if (!proof && (hash(input.source) !== data.sourceHash || !same(input.knowledge.styleControlsByWidget?.form, data.styleControls))) fail('style_source_or_knowledge_changed');
  }
  if (!proof && permits.length) {
    const validateForm = capabilities.get(permits[0])!.validateForm, originalKnowledge = input.knowledge;
    // Independent callers cannot substitute a permissive form validator or
    // unbound variable/selector capability metadata for the researched model.
    input = {...input,knowledge:{...originalKnowledge,styleVariableConsumers:[],styleWrapperClassesByWidget:{},validateSettings:(type,settings)=>type==='form'?validateForm(type,settings):(originalKnowledge.validateSettings?.(type,settings) ?? settings)}};
  }
  const resolved = resolveNative44Styles(input);
  const after = walkNative44(resolved.program.blocks);
  const pendingForms = permits.map(permit => {
    const data = capabilities.get(permit)!, source = before.find(n => n.key === permit.componentKey) as PendingFormNode;
    const node = after.find(n => n.key === permit.componentKey) as PendingFormNode;
    if (!node) return fail('style_owner');
    const restored = structuredClone(node); restored.widgetSettings = structuredClone(source.widgetSettings);
    if (identity(resolved.program, restored) !== data.identity) fail('style_changed_source_identity');
    for (const [key, value] of Object.entries(source.widgetSettings)) {
      const expected = structuredClone(value);
      // The existing registered emitter omits an empty select placeholder.
      if (key === 'form_fields' && source.pendingForm?.version !== 1 && Array.isArray(expected) && Array.isArray(node.widgetSettings[key])) for (const [index, field] of expected.entries()) {
        const actual = (node.widgetSettings[key] as any[])[index];
        if (field.field_type === 'select' && field.placeholder === '' && actual?.placeholder === undefined) delete field.placeholder;
      }
      if (!Object.hasOwn(node.widgetSettings, key) || !same(node.widgetSettings[key], expected)) fail('style_changed_original_setting_'+key);
    }
    const receipts = resolved.receipts.filter(row => row.componentKey === node.key && row.action === 'native-setting');
    for (const key of Object.keys(node.widgetSettings)) {
      if (Object.hasOwn(source.widgetSettings, key)) continue;
      const registered = input.schemas.form.controls[key];
      const base = key.replace(/_(?:mobile|tablet)$/, '');
      const researched = data.styleControls?.find(control => control.id === key) ?? data.styleControls?.find(control => control.id === base && control.responsive);
      const direct = receipts.some(row => row.controlId === key && same(row.value, node.widgetSettings[key]));
      const prerequisite = receipts.some(row => row.prerequisiteSettings?.includes(key));
      if (!registered || !researched || registered.type !== researched.type || researched.panel?.tab !== 'style' ||
          !(direct && ['direct-css','save-normalized'].includes(researched.effectClass ?? '') || prerequisite && researched.effectClass === 'save-normalized')) fail('unverified_style_increment');
    }
    const derived: PendingFormCapability = Object.freeze({kind:'native44-pending-form-capability',componentKey:node.key});
    capabilities.set(derived, {...data, identity:identity(resolved.program,node), node:structuredClone(node), strictNode:structuredClone(data.strictNode ?? source)});
    return derived;
  });
  return {...resolved, pendingForms};
}
/** Compiler-only validation projection. Opaque permits are checked against the
 * full styled node before removing deltas solely for strict syntax validation. */
export function pendingFormValidationProjection(program: Native44Program, schemas: Record<string, LegacySchema>, permits: readonly PendingFormCapability[]): Native44Program {
  const projected = structuredClone(program);
  for (const node of walkNative44(projected.blocks)) {
    if (node.kind !== 'native' || !node.pendingForm) continue;
    const permit = permits.find(row => row.componentKey === node.key);
    if (!permit) continue;
    assertNative44PendingFormCapability(program, node, schemas, permit);
    const data = capabilities.get(permit!)!;
    if (data.strictNode) { node.widgetSettings = structuredClone(data.strictNode.widgetSettings); node.sourceFactIds=structuredClone(data.strictNode.sourceFactIds); }
  }
  return projected;
}
/** Derive a new opaque permission for the existing three-field responsive
 * visibility overlay. Source facts, schema, native Form settings and the base
 * knowledge file/hash remain exact; serialization never grants permission. */
export function derivePendingFormsForResponsive(base: Native44Program, target: Native44Program, schemas: Record<string, LegacySchema>, input: readonly PendingFormCapability[], fields: Record<string, unknown>): PendingFormCapability[] {
  for (const [name, value] of Object.entries(fields)) { const control = value as Record<string, unknown>; if (!['hide_desktop','hide_tablet','hide_mobile'].includes(name) || control?.type !== 'switcher' || control.return_value !== 'hidden-'+name.slice(5)) fail('responsive_overlay_fields'); }
  const expected = createHash('sha256').update(JSON.stringify({ base: base.knowledge.fingerprint, module: base.styleResolutionVersion === 2 ? 'responsive-native-v2' : 'responsive-native-v1', fields })).digest('hex');
  if (target.styleResolutionVersion !== base.styleResolutionVersion || target.knowledge.fingerprint !== expected || !same({ ...target.knowledge, fingerprint: base.knowledge.fingerprint }, base.knowledge)) fail('responsive_overlay_identity');
  const before = walkNative44(base.blocks), after = walkNative44(target.blocks);
  return input.map(capability => {
    const source = before.find(n => n.key === capability.componentKey) as PendingFormNode, node = after.find(n => n.key === capability.componentKey) as PendingFormNode;
    if (!source || !node) fail('responsive_overlay_owner');
    assertNative44PendingFormCapability(base, source, schemas, capability); const data = capabilities.get(capability)!;
    const originalNode = structuredClone(node);
    if (base.styleResolutionVersion === 2) for (const name of Object.keys(originalNode.widgetSettings)) {
      if (Object.hasOwn(source.widgetSettings, name) || !name.endsWith('_tablet')) continue;
      const desktopName = name.slice(0, -7), desktop = schemas.form.controls[desktopName], tablet = schemas.form.controls[name];
      const tabletRange = tablet?.responsive;
      if (!Object.hasOwn(source.widgetSettings, desktopName) || !desktop?.responsive || !tablet || desktop.type !== tablet.type || Array.isArray(desktop.devices) && desktop.devices.length && !desktop.devices.includes('tablet') || Array.isArray(tablet.devices) && tablet.devices.length && !tablet.devices.includes('tablet') || tabletRange && typeof tabletRange === 'object' && !Array.isArray(tabletRange) && 'max' in tabletRange && tabletRange.max !== undefined && tabletRange.max !== 'tablet' || !same(originalNode.widgetSettings[name], source.widgetSettings[desktopName])) fail('responsive_overlay_changed_form');
      delete originalNode.widgetSettings[name];
    }
    if (identity({ ...target, knowledge: { ...target.knowledge, fingerprint: base.knowledge.fingerprint } }, originalNode) !== data.identity) fail('responsive_overlay_changed_form');
    const derived: PendingFormCapability = Object.freeze({ kind: 'native44-pending-form-capability', componentKey: capability.componentKey });
    capabilities.set(derived, { ...data, identity: identity(target, node), node: structuredClone(node) }); return derived;
  });
}
/** The only changes permitted after source candidate validation are compiler
 * repeater identity, stable native classes and the owned editor label. */
function emittedSettings(data: CapabilityData, settings: Record<string, unknown>): void {
  const original = structuredClone(data.node.widgetSettings), actual = structuredClone(settings);
  for (const key of ['css_classes', '_css_classes', '_title']) delete actual[key];
  for (const key of ['css_classes', '_css_classes']) delete original[key];
  for (const [index, expectedField] of (original.form_fields as any[]).entries()) {
  const actualField = (actual.form_fields as any[])?.[index];
  if (!actualField || typeof actualField._id !== 'string' || !/^[a-f0-9]{7}$/.test(actualField._id)) fail('compiled_email_identity');
  if (expectedField._id !== undefined && expectedField._id !== actualField._id) fail('changed_email_identity');
  delete expectedField._id; delete actualField._id;
  if (data.node.pendingForm?.version !== 1 && expectedField.field_type === 'select' && expectedField.placeholder === '' && actualField.placeholder === undefined) delete expectedField.placeholder;
  }
  if (!same(original, actual)) fail('compiled_settings_changed');
  for (const key of ['css_classes', '_css_classes']) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || !/^[a-zA-Z0-9_\s-]*$/.test(settings[key] as string))) fail('compiled_classes');
  if (settings._title !== undefined && (typeof settings._title !== 'string' || /[<>\u0000-\u001f]/.test(settings._title))) fail('compiled_title');
}
export function bindPendingFormAttributeAuthorization(capability: PendingFormCapability, elementId: string, settings: Record<string, unknown>, schema: LegacySchema): PendingFormAttributeAuthorization {
  const data = capabilities.get(capability); if (!data || !/^[a-f0-9]{7}$/.test(elementId) || native44RegisteredSchemaHash(schema) !== data.schemaHash) return fail('attribute_capability');
  emittedSettings(data, settings);
  const authorization: PendingFormAttributeAuthorization = Object.freeze({ kind: 'native44-pending-form-attributes', elementId });
  attributes.set(authorization, { elementId, settingsHash: hash(settings), schemaHash: data.schemaHash, capability }); return authorization;
}
export function assertPendingFormAttributeAuthorization(authorization: PendingFormAttributeAuthorization, type: string, settings: Record<string, unknown>, elementId?: string, schema?: LegacySchema): void {
  const data = attributes.get(authorization);
  if (!data || type !== 'form' || data.settingsHash !== hash(settings) || ![3,4].includes(capabilities.get(data.capability)?.node.pendingForm?.version ?? 0) && settings._attributes !== NATIVE44_PENDING_FORM_ATTRIBUTES || elementId !== undefined && elementId !== data.elementId || schema && native44RegisteredSchemaHash(schema) !== data.schemaHash) fail('attribute_authorization');
}
export function pendingFormAuthorizationForElement(authorizations: readonly PendingFormAttributeAuthorization[] | undefined, elementId: string): PendingFormAttributeAuthorization | undefined {
  const matches = authorizations?.filter(item => attributes.get(item)?.elementId === elementId) ?? [];
  if (matches.length > 1) fail('duplicate_attribute_authorization'); return matches[0];
}
export function native44PendingFormBinding(capability: PendingFormCapability, authorization: PendingFormAttributeAuthorization, settings: Record<string, unknown>): Native44PendingFormBinding {
  const data = capabilities.get(capability), permit = attributes.get(authorization);
  if (!data || permit?.capability !== capability) return fail('binding_capability');
  assertPendingFormAttributeAuthorization(authorization, 'form', settings, permit.elementId);
  return { ...structuredClone(data.receipt), elementId: permit.elementId, settingsHash: hash(settings) };
}

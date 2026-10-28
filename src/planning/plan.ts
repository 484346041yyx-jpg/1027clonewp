import { z } from 'zod';
import { assertGeneratedHtmlProof, findGeneratedHtmlProof } from '../replica-v2/html.js';
import type { GeneratedHtmlProof } from '../replica-v2/types.js';
import { assertPendingFormAttributeAuthorization, pendingFormAuthorizationForElement, NATIVE44_PENDING_FORM_ATTRIBUTES, type PendingFormAttributeAuthorization } from '../native44/pending-form.js';
import type { LegacySchema } from '../wordpress/types.js';

export const modelOutputSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'mode', 'compositionJson', 'mappings', 'unsupported', 'rationale'],
  properties: {
    title: { type: 'string' }, mode: { type: 'string', enum: ['legacy-verified', 'native-v4'] },
    compositionJson: { type: 'string' },
    mappings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceId', 'targetId'], properties: { sourceId: { type: 'string' }, targetId: { type: 'string' } } } },
    unsupported: { type: 'array', items: { type: 'string' } }, rationale: { type: 'string' },
  },
};
export const planSchema = z.object({ title: z.string().min(1), mode: z.enum(['legacy-verified', 'native-v4']), compositionJson: z.string(), mappings: z.array(z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) })), unsupported: z.array(z.string()), rationale: z.string() });
export type ModelPlan = z.infer<typeof planSchema>;
export interface ElementorElement { id: string; elType: 'container' | 'widget'; widgetType?: string; settings: Record<string, unknown>; elements: ElementorElement[]; isInner?: boolean; [key: string]: unknown; }
export interface LegacyComposition { elements: ElementorElement[]; pageSettings?: Record<string, unknown>; }
export interface AtomicComposition { xml_structure: string; element_config: Record<string, Record<string, unknown>>; style?: Record<string, unknown>; classes?: Record<string, string[]>; }
export interface ControlSchema { type?: string; options?: Record<string, unknown>; condition?: unknown; default?: unknown; fields?: unknown; size_units?: unknown; range?: unknown; min?: unknown; max?: unknown; [key: string]: unknown; }
export type WidgetSchemas = Record<string, { controls?: Record<string, ControlSchema>; nativeChildren?: { childType: 'container'; repeaterKey: string; titleSettingKey: string; baseClass: string; sourceSha256: string }; nativeChildContract?: import('../wordpress/types.js').NativeChildContract }>;
export interface AllowedMedia { attachmentId: number; url: string; sourceUrl: string; }
export interface RegisteredControlValidationOptions {
  allowedMedia?: AllowedMedia[];
  /** Pre-import validation accepts only these exact symbolic references in media controls. */
  symbolicAssets?: ReadonlySet<string>;
  /** Revision-only: validate changed controls against the complete current
   * settings/condition context, while preserving server-attested old fields. */
  onlyControls?: ReadonlySet<string>;
  /** Sealed, exact form settings/owner capability; never a generic attribute allowance. */
  pendingFormAuthorization?: PendingFormAttributeAuthorization;
}

function declaredConditionIsFalse(control: ControlSchema, settings: Record<string, unknown>, controls: Record<string, ControlSchema>) {
  if (!control.condition || typeof control.condition !== 'object' || Array.isArray(control.condition)) return false;
  for (const [expression, expected] of Object.entries(control.condition)) {
    const negate = expression.endsWith('!'), name = negate ? expression.slice(0, -1) : expression;
    // Complex dependency expressions are enforced by the target's real controls and rendering.
    if (!Object.hasOwn(settings, name) && !Object.hasOwn(controls, name)) continue;
    const actual = Object.hasOwn(settings, name) ? settings[name] : controls[name].default;
    if (actual === undefined) continue;
    const matches = Array.isArray(expected) ? expected.includes(actual) : Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    if (negate ? matches : !matches) return true;
  }
  return false;
}
function validateControl(name: string, value: unknown, control: ControlSchema, options: RegisteredControlValidationOptions = {}) {
  const type = control.type;
  const attributeList = (attributeValue: unknown) => {
    if (typeof attributeValue !== 'string') throw new Error(`Invalid custom attributes ${name}`);
    for (const line of attributeValue.split(/[\r\n,]+/).filter(line => line.trim())) {
      const attribute = line.split('|')[0].trim().toLowerCase();
      if (attribute === 'inert' && name === 'form._attributes' && attributeValue === NATIVE44_PENDING_FORM_ATTRIBUTES && options.pendingFormAuthorization) continue;
      if (!/^(?:aria-[a-z0-9_-]+|data-[a-z0-9_-]+|dir|lang|id|title|role|tabindex)$/.test(attribute)) throw new Error(`Active or unsupported HTML attribute ${attribute}`);
    }
  };
  if (/(?:^|\.)(?:_attributes|custom_attributes)$/.test(name)) attributeList(value);
  if (type === 'url') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid URL control ${name}`);
    const link = value as Record<string, unknown>;
    if (typeof link.url !== 'string' || (link.url && !/^(?:https?:\/\/|mailto:|tel:|sms:|#|\/)/i.test(link.url))) throw new Error(`Unsupported URL protocol ${name}`);
    if (link.custom_attributes) attributeList(link.custom_attributes);
  }
  if (['select', 'choose'].includes(type ?? '') && control.options && value !== '') {
    if (typeof value !== 'string' || !Object.hasOwn(control.options, value)) throw new Error(`Invalid setting option ${name}`);
  }
  if (['text', 'textarea', 'wysiwyg', 'font', 'color', 'hidden', 'code', 'switcher'].includes(type ?? '') && typeof value !== 'string') throw new Error(`Invalid string setting ${name}`);
  if (type === 'switcher' && control.options && (typeof value !== 'string' || value !== '' && !Object.hasOwn(control.options, value))) throw new Error(`Invalid native switcher ${name}`);
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Invalid numeric setting ${name}`);
  if (type === 'slider' || type === 'dimensions') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid dimensional setting ${name}`);
    const dimension = value as Record<string, unknown>;
    if (typeof dimension.unit !== 'string') throw new Error(`Missing dimensional unit ${name}`);
    if (Array.isArray(control.size_units) && !control.size_units.includes(dimension.unit)) throw new Error(`Invalid dimensional unit ${name}.${dimension.unit}`);
    const keys = type === 'slider' ? ['size'] : ['top', 'right', 'bottom', 'left'];
    for (const key of keys) {
      const number = dimension[key];
      if (number === '' || number === undefined) continue;
      const finiteNumber = (typeof number === 'number' && Number.isFinite(number)) || (typeof number === 'string' && /^-?\d+(\.\d+)?$/.test(number));
      const customExpression = dimension.unit === 'custom' && Array.isArray(control.size_units) && control.size_units.includes('custom') && typeof number === 'string' && !/(?:NaN|Infinity)/i.test(number) && /^(?:(?:calc|min|max|clamp|var)\([a-zA-Z0-9_%.,+*/()\s-]+\)|auto|initial|inherit|min-content|max-content|fit-content)$/.test(number);
      if (!finiteNumber && !customExpression) throw new Error(`Invalid dimension ${name}.${key}`);
      // Elementor slider ranges describe its UI drag scale; numeric keyboard input is not clamped to them.
      // Do not invent a hard schema constraint from a UI hint. Real target save/readback and CSS measurements remain required.
    }
  }
  if (type === 'gaps') {
    const gaps = value as Record<string, unknown>;
    const allowedUnit = gaps && typeof gaps.unit === 'string' && (Array.isArray(control.size_units) ? control.size_units.includes(gaps.unit) : ['px', '%', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax'].includes(gaps.unit));
    if (!gaps || typeof gaps !== 'object' || Array.isArray(gaps) || !allowedUnit || ['column', 'row'].some(side => typeof gaps[side] !== 'string' && typeof gaps[side] !== 'number' || !/^-?\d*(?:\.\d+)?$/.test(String(gaps[side])))) throw new Error(`Invalid native gaps ${name}`);
  }
  if (type === 'media') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid media control ${name}`);
    const media = value as Record<string, unknown>;
    if (Object.hasOwn(media, '$asset')) {
      if (Object.keys(media).length !== 1 || typeof media.$asset !== 'string' || !options.symbolicAssets?.has(media.$asset)) throw new Error(`Unknown or malformed symbolic media ${name}`);
      return;
    }
    if (media.url || media.id) {
      if (options.symbolicAssets) throw new Error(`Pre-import media ${name} cannot claim an imported attachment; use a proven symbolic asset reference`);
      if (options.allowedMedia && !options.allowedMedia.some(asset => media.id === asset.attachmentId && media.url === asset.url)) throw new Error(`Media ${name} does not match an imported attachment ID and URL`);
    }
  }
  if (type === 'gallery') {
    if (!Array.isArray(value)) throw new Error(`Invalid gallery ${name}`);
    for (const media of value) validateControl(name, media, { type: 'media' }, options);
  }
  if (type === 'repeater' || type === 'nested-elements-repeater') {
    if (!Array.isArray(value) || value.length > 100) throw new Error(`Invalid repeater ${name}`);
    const fields = Array.isArray(control.fields) ? Object.fromEntries((control.fields as Array<ControlSchema & { name: string }>).map(field => [field.name, field])) : control.fields as Record<string, ControlSchema> | undefined;
    if (fields) for (const row of value) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid repeater row ${name}`);
      for (const [key, child] of Object.entries(row)) {
        if (key === '_id') continue;
        if (!fields[key]) throw new Error(`Undiscovered repeater field ${name}.${key}`);
        validateControl(`${name}.${key}`, child, fields[key], options);
      }
    }
  }
}

/** Elementor Pro 3.35.1 editor.js updateReplyToOptions derives this select
 * from the current Form's labeled email fields; the PHP registry intentionally
 * exposes only its blank option (modules/forms/actions/email.php). This is a
 * per-validation projection, never a mutation of the registered schema. */
function contextualFormReplyToControl(type: string, name: string, value: unknown, control: ControlSchema, settings: Record<string, unknown>, controls: Record<string, ControlSchema>): ControlSchema {
  if (type !== 'form' || name !== 'email_reply_to' || value === '') return control;
  const invalid = (): never => { throw new Error('Invalid dynamic select context form.email_reply_to'); };
  const condition = control.condition;
  if (control.type !== 'select' || control.default !== '' || control.render_type !== 'none' || !control.options || Array.isArray(control.options) || Object.keys(control.options).length !== 1 || !Object.hasOwn(control.options, '') || control.options[''] !== '' || !condition || typeof condition !== 'object' || Array.isArray(condition) || Object.keys(condition).length !== 1 || (condition as Record<string, unknown>).submit_actions !== 'email') return invalid();
  const repeater = controls.form_fields;
  if (repeater?.type !== 'form-fields-repeater' || !repeater.fields || typeof repeater.fields !== 'object') return invalid();
  const declarations = Array.isArray(repeater.fields)
    ? Object.fromEntries((repeater.fields as Array<ControlSchema & { name: string }>).map(field => [field.name, field]))
    : repeater.fields as Record<string, ControlSchema>;
  if (declarations.field_type?.type !== 'select' || !declarations.field_type.options || !Object.hasOwn(declarations.field_type.options, 'email') || declarations.custom_id?.type !== 'text' || declarations.field_label?.type !== 'text' || !Array.isArray(settings.form_fields) || settings.form_fields.length > 100) return invalid();
  const options: Record<string, unknown> = { '': '' }, ids = new Set<string>();
  for (const row of settings.form_fields) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return invalid();
    const field = row as Record<string, unknown>, id = field.custom_id;
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(id) || ids.has(id)) return invalid();
    ids.add(id);
    if (field.field_type === 'email' && typeof field.field_label === 'string' && field.field_label.trim()) options[id] = `${field.field_label} Field`;
  }
  return { ...control, options };
}

/** Identical registered-control validation before import and after media resolution. */
export function validateRegisteredSettings(type: string, settings: Record<string, unknown>, schema: WidgetSchemas[string], options: RegisteredControlValidationOptions = {}): void {
  if (!schema?.controls) throw new Error(`Undiscovered widget controls: ${type}`);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`Invalid registered settings object: ${type}`);
  if (options.pendingFormAuthorization) assertPendingFormAttributeAuthorization(options.pendingFormAuthorization, type, settings, undefined, schema as LegacySchema);
  for (const [name, value] of Object.entries(settings)) {
    if (options.onlyControls && !options.onlyControls.has(name)) continue;
    const control = Object.hasOwn(schema.controls, name) ? schema.controls[name] : undefined;
    if (!control) throw new Error(`Undiscovered setting ${type}.${name}`);
    if (declaredConditionIsFalse(control, settings, schema.controls)) throw new Error(`Inactive setting ${type}.${name}; use its declared activation conditions`);
    validateControl(`${type}.${name}`, value, contextualFormReplyToControl(type, name, value, control, settings, schema.controls), options);
  }
}

/** Native nesting requires the real registered container/repeater relationship. */
export function validateRegisteredChildren(type: string, settings: Record<string, unknown>, childTypes: string[], schema: WidgetSchemas[string]): void {
  if (type === 'container' || !childTypes.length) return;
  if (schema.nativeChildContract) {
    const relation = schema.nativeChildContract;
    if (relation.baseClass !== 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base' || !/^[a-f0-9]{64}$/.test(relation.sourceSha256) || relation.childType !== 'container' || childTypes.some(child => child !== 'container')) throw new Error('Unproven native44 child relationship');
    if (relation.policy === 'fixed') { if (childTypes.length !== relation.count) throw new Error('Fixed native widget child count differs from installed source'); }
    else if (!Array.isArray(settings[relation.repeaterKey]) || (settings[relation.repeaterKey] as unknown[]).length !== childTypes.length) throw new Error('Native nested repeater rows must correspond to direct container children');
    return;
  }
  const nested = schema?.nativeChildren;
  if (!nested || nested.baseClass !== 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base' || !/^[a-f0-9]{64}$/.test(nested.sourceSha256) || nested.childType !== 'container') throw new Error('Classic widgets cannot own container children');
  const rows = settings[nested.repeaterKey];
  if (!Array.isArray(rows) || rows.length !== childTypes.length || childTypes.some(child => child !== 'container')) throw new Error('Native nested repeater rows must correspond to direct container children');
}

function inspect(value: unknown, key = '', depth = 0, approvedCustomCSS?: Set<string>, htmlProofs?: readonly GeneratedHtmlProof[]) {
  if (depth > 45) throw new Error('Composition nesting exceeds the limit');
  if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe object key');
  if (typeof value === 'string') {
    if (key === 'html' && htmlProofs?.some(proof => proof.html === value)) {
      const proof = htmlProofs.find(proof => proof.html === value)!;
      assertGeneratedHtmlProof(proof, proof.elementId, value); return;
    }
    if (/<\s*(script|style|link|meta|base|iframe|object|embed|form|input|textarea|select|button|img|svg|video|audio|source|canvas)\b|\son\w+\s*=|(?:javascript|vbscript):/i.test(value)) throw new Error(`Executable content or embedded media is forbidden in ${key}; use native controls`);
    if (key === 'custom_css' && value.trim() && !approvedCustomCSS?.has(value)) throw new Error('External/custom CSS cannot replace native editable style controls');
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) inspect(v, k, depth + 1, approvedCustomCSS, htmlProofs);
  }
}
export function validatePlan(input: unknown, options: { mode: string; maxElements?: number; widgetSchemas?: WidgetSchemas; sourceIds?: Set<string>; sourceAliases?: Record<string, string>; allowedMedia?: AllowedMedia[]; approvedCustomCSS?: Set<string>; htmlProofs?: readonly GeneratedHtmlProof[]; pendingFormAuthorizations?: readonly PendingFormAttributeAuthorization[] }): { plan: ModelPlan; composition: LegacyComposition | AtomicComposition; elementMap: Record<string, string> } {
  const plan = planSchema.parse(input);
  if (plan.mode !== options.mode) throw new Error(`Plan changed target mode from ${options.mode} to ${plan.mode}`);
  const composition = JSON.parse(plan.compositionJson) as LegacyComposition | AtomicComposition;
  if (!composition || typeof composition !== 'object' || Array.isArray(composition)) throw new Error('Composition must be an object');
  const allowedKeys = plan.mode === 'legacy-verified' ? ['elements', 'pageSettings'] : ['xml_structure', 'element_config', 'style', 'classes'];
  for (const key of Object.keys(composition)) if (!allowedKeys.includes(key)) throw new Error(`Unsupported composition field: ${key}`);
  inspect(composition, '', 0, options.approvedCustomCSS, options.htmlProofs);
  const ids = new Set<string>();
  if (plan.mode === 'legacy-verified') {
    if (!Array.isArray((composition as LegacyComposition).elements) || !(composition as LegacyComposition).elements.length) throw new Error('Missing native Elementor tree');
    let count = 0;
    const walk = (element: ElementorElement, depth: number) => {
      if (++count > (options.maxElements ?? 700) || depth > 30) throw new Error('Element tree exceeds configured limits');
      if (!/^[a-f0-9]{7}$/.test(element.id) || ids.has(element.id)) throw new Error('Native element IDs must be unique seven-character hex IDs');
      ids.add(element.id);
      if (!['container', 'widget'].includes(element.elType)) throw new Error('Unsupported Elementor element type');
      if (!element.settings || Array.isArray(element.settings) || typeof element.settings !== 'object') throw new Error('Element settings must be an object');
      if (Object.hasOwn(element.settings, '_title')) throw new Error('Navigator aliases (_title) are not allowed; retain native component names');
      if (!Array.isArray(element.elements)) throw new Error('Every element must declare its children');
      const type = element.elType === 'container' ? 'container' : element.widgetType;
      if (!type || ['shortcode', 'code-highlight'].includes(type)) throw new Error('Page must use independently editable native elements');
      if (type === 'html') {
        if (!options.htmlProofs?.length) throw new Error('Page must use independently editable native elements; static HTML requires an exact v2 compiler proof');
        findGeneratedHtmlProof(options.htmlProofs, element.id, element.settings.html);
        if (element.elements.length) throw new Error('A static HTML widget cannot own native children');
      }
      const schemas = options.widgetSchemas;
      if (schemas && !schemas[type]) throw new Error(`Undiscovered widget type: ${type}`);
      const controls = schemas?.[type]?.controls;
      if (controls && Object.keys(controls).length) {
        const pendingFormAuthorization = pendingFormAuthorizationForElement(options.pendingFormAuthorizations, element.id);
        if (pendingFormAuthorization) assertPendingFormAttributeAuthorization(pendingFormAuthorization, type, element.settings, element.id, schemas![type] as LegacySchema);
        validateRegisteredSettings(type, element.settings, schemas![type], { allowedMedia: options.allowedMedia, ...(pendingFormAuthorization ? { pendingFormAuthorization } : {}) });
      }
      if (element.elType === 'widget' && element.elements.length) {
        validateRegisteredChildren(type, element.settings, element.elements.map(child => child.elType === 'container' ? 'container' : child.widgetType ?? ''), schemas?.[type] ?? {});
      }
      for (const child of element.elements) walk(child, depth + 1);
    };
    for (const element of (composition as LegacyComposition).elements) walk(element, 0);
    const settings = (composition as LegacyComposition).pageSettings ?? {};
    for (const key of Object.keys(settings)) if (!['hide_title', 'background_background', 'background_color'].includes(key)) throw new Error(`Unsupported page setting ${key}`);
  } else {
    const atomic = composition as AtomicComposition;
    if (typeof atomic.xml_structure !== 'string' || !atomic.element_config || (atomic.style !== undefined && (typeof atomic.style !== 'object' || atomic.style === null))) throw new Error('Missing native Atomic composition');
    for (const match of atomic.xml_structure.matchAll(/\b(?:configuration-id|id)=["']([^"']+)["']/g)) { if (ids.has(match[1])) throw new Error('Duplicate Atomic element ID'); ids.add(match[1]); }
    if (!ids.size || ids.size > (options.maxElements ?? 700)) throw new Error('Invalid Atomic element count');
  }
  const elementMap: Record<string, string> = Object.create(null);
  const normalizedMappings: ModelPlan['mappings'] = [];
  for (const mapping of plan.mappings) {
    const sourceId = options.sourceAliases && Object.hasOwn(options.sourceAliases, mapping.sourceId) ? options.sourceAliases[mapping.sourceId] : mapping.sourceId;
    if (!ids.has(mapping.targetId)) throw new Error(`Mapping targets an absent element: ${mapping.targetId}`);
    if (options.sourceIds && !options.sourceIds.has(sourceId)) throw new Error(`Mapping invents source evidence: ${mapping.sourceId}`);
    if (elementMap[sourceId]) {
      if (elementMap[sourceId] === mapping.targetId && sourceId !== mapping.sourceId) continue;
      throw new Error(`Source element mapped more than once: ${sourceId}`);
    }
    elementMap[sourceId] = mapping.targetId;
    normalizedMappings.push({ sourceId, targetId: mapping.targetId });
  }
  return { plan: { ...plan, mappings: normalizedMappings }, composition, elementMap };
}

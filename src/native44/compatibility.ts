import { createHash } from 'node:crypto';
import { NATIVE44_ALL_TYPES } from './catalog.js';
import type { Native44Condition, Native44Control, Native44Knowledge } from './knowledge.js';
import type { CapabilityReport, ControlInfo, LegacySchema } from '../wordpress/types.js';

export type Native44CompatibilityStatus = 'compatible-common' | 'changed-needs-adapter' | 'missing' | 'unverified';
export type Native44CompatibilityRisk = 'ordinary-content' | 'carousel-high-risk' | 'product-high-risk' | 'shared-style';
export interface Native44ControlCompatibility {
  field: string; status: Native44CompatibilityStatus; risk: Native44CompatibilityRisk;
  sourceType?: string; targetType?: string; differences: string[];
  commonOptionCount?: number; commonOptions?: unknown[];
  sourceContractHash: string; targetContractHash?: string;
}
export interface Native44CompatibilityCapabilities extends CapabilityReport {
  /** Absence in a partial read is not proof that a component is unregistered. */
  registrationComplete?: boolean;
  requestedTypes?: string[];
  missingTypes?: string[];
}
const canonical = (value: unknown): string => JSON.stringify(order(value));
function order(value: unknown): unknown { return Array.isArray(value) ? value.map(order) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, order(item)])) : value; }
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const obj = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const product = new Set(['wd_products', 'woocommerce-products', 'wd_products_tabs']);
const carousel = new Set(['wd_nested_carousel', 'nested-carousel', 'slides', 'wd_banner_carousel', 'wd_infobox_carousel', 'wd_testimonials']);
const resourceField = /(?:^|_)(?:ids|include|exclude|form_id|sidebar_name|menu|posts_ids)(?:$|_)/;

function normalizeCondition(input: Native44Condition | null | undefined): unknown {
  if (!input) return null;
  if (input.type === 'predicate') return { field: input.field, operator: input.operator, value: input.value, scope: input.scope ?? 'component' };
  if (input.type !== 'group' || !['and', 'or', undefined].includes(input.operator)) throw Error('Unsupported local condition');
  const terms = (input.terms ?? []).map(normalizeCondition).filter(Boolean);
  if (!terms.length) return null;
  if (terms.length === 1) return terms[0];
  return { operator: input.operator ?? 'and', terms: terms.sort((a, b) => canonical(a).localeCompare(canonical(b))) };
}
function rawConditions(raw: ControlInfo, scope: string): unknown {
  const predicate = (field: string, operator: string, value: unknown): Native44Condition => ({ type: 'predicate', field, operator, value, scope });
  const simple: Native44Condition[] = Object.entries(raw.condition ?? {}).map(([key, value]) => {
    const negated = key.endsWith('!'), field = negated ? key.slice(0, -1) : key;
    return predicate(field, Array.isArray(value) ? negated ? 'not-in' : 'in' : negated ? 'not-equals' : 'equals', value);
  });
  const operators: Record<string, string> = { '===': 'equals', '==': 'equals', '!==': 'not-equals', '!=': 'not-equals', in: 'in', '!in': 'not-in', contains: 'contains', '!contains': 'not-contains', '>': 'greater-than', '>=': 'greater-than-or-equal', '<': 'less-than', '<=': 'less-than-or-equal' };
  const rich = (value: unknown): Native44Condition => {
    if (!obj(value)) throw Error('Unknown live condition shape');
    if (Array.isArray(value.terms)) return { type: 'group', operator: value.relation === 'or' ? 'or' : value.relation === undefined || value.relation === 'and' ? 'and' : 'unknown', terms: value.terms.map(rich) };
    if (typeof value.name !== 'string' || typeof value.operator !== 'string' || !operators[value.operator]) throw Error('Unsupported live condition predicate');
    return predicate(value.name, operators[value.operator], value.value);
  };
  if (raw.conditions) simple.push(rich(raw.conditions));
  return normalizeCondition({ type: 'group', operator: 'and', terms: simple });
}

function risk(type: string, field: string, primary: Set<string>): Native44CompatibilityRisk {
  if (field.startsWith('_') && !primary.has(field)) return 'shared-style';
  if (product.has(type) && (primary.has(field) || /query|include|exclude|post_type|items_per_page|orderby|offset|order|tax|tabs_items|product|filter/.test(field))) return 'product-high-risk';
  if (carousel.has(type) && (primary.has(field) || /slides|carousel|pagination|arrow|autoplay|loop|speed|swiper|content_repeater|items_repeater|navigation/.test(field))) return 'carousel-high-risk';
  return primary.has(field) ? 'ordinary-content' : 'shared-style';
}
function sourceContract(control: Native44Control): unknown {
  return { type: control.type, domain: control.valueDomain, condition: control.condition, responsive: control.responsive, devices: control.devices, repeater: control.repeater ? { identity: control.repeater.itemIdentityField, fields: control.repeater.fields.map(sourceContract) } : null };
}
function targetContract(control: ControlInfo) {
  return { type: control.type, options: control.options, min: control.min, max: control.max, step: control.step, size_units: control.size_units, range: control.range, condition: control.condition, conditions: control.conditions, responsive: control.responsive, fields: control.fields };
}
function compareControl(type: string, source: Native44Control, target: ControlInfo | undefined, primary: Set<string>, field = source.id): Native44ControlCompatibility[] {
  const row: Native44ControlCompatibility = { field, risk: risk(type, source.id, primary), status: target ? 'compatible-common' : 'changed-needs-adapter', sourceType: source.type, targetType: target?.type, differences: [], sourceContractHash: hash(sourceContract(source)), ...(target ? { targetContractHash: hash(targetContract(target)) } : {}) };
  if (!target) { row.differences.push('Local control is absent from the observed target schema'); return [row]; }
  const change = (message: string) => { row.differences.push(message); row.status = 'changed-needs-adapter'; };
  const unknown = (message: string) => { row.differences.push(message); if (row.status === 'compatible-common') row.status = 'unverified'; };
  if (!source.type || !target.type) unknown('Control type evidence is incomplete');
  else if (source.type !== target.type) change('Control type differs; values must not be coerced');
  const domain = source.valueDomain ?? {};
  const sourceOptions = domain.options?.map(item => item.value) ?? [], targetOptions = obj(target.options) ? Object.keys(target.options) : [];
  if (sourceOptions.length || targetOptions.length) {
    const common = sourceOptions.filter(value => targetOptions.some(option => same(option, value)));
    row.commonOptionCount = common.length;
    // Resource options are site state, never transportable recipe defaults.
    if (!resourceField.test(source.id) && source.defaultPolicy !== 'task-resource-required') row.commonOptions = common;
    if (!sourceOptions.length || !targetOptions.length) unknown('Option domain is incomplete or resource-dependent');
    else if (!same([...sourceOptions].sort((a, b) => canonical(a).localeCompare(canonical(b))), [...targetOptions].sort((a, b) => canonical(a).localeCompare(canonical(b))))) change('Option domains differ; only the explicit common values are candidates');
  }
  for (const key of ['min', 'max', 'step', 'size_units', 'range'] as const) {
    const left = domain[key], right = target[key];
    if (left !== undefined || right !== undefined) if (!same(left, right)) change(`${key} differs; numeric units/ranges/steps require the target contract`);
  }
  try { if (!same(normalizeCondition(source.condition), rawConditions(target, source.scope ?? 'component'))) change('Condition or condition scope differs'); }
  catch { unknown('Condition semantics cannot be compared safely'); }
  if (source.responsive && source.devices?.length) {
    const malformed = Object.keys(target).filter(key => /_(?:tablet|mobile)_(?:tablet|mobile)$/.test(key));
    if (malformed.length) change('Malformed repeated responsive device suffix');
  }
  const result = [row];
  if (source.repeater) {
    let fields: Record<string, ControlInfo> = {};
    if (Array.isArray(target.fields)) fields = Object.fromEntries(target.fields.filter(obj).filter(item => typeof item.name === 'string').map(item => [item.name, item as unknown as ControlInfo]));
    else if (obj(target.fields)) fields = target.fields as Record<string, ControlInfo>;
    else unknown('Repeater field contract is unavailable');
    for (const child of source.repeater.fields) result.push(...compareControl(type, child, fields[child.id], new Set(source.repeater.fields.map(item => item.id)), `${field}[].${child.id}`));
  }
  return result;
}
function nestedContract(schema: LegacySchema): unknown {
  const nested = schema.nativeChildContract ?? (schema.nativeChildren ? { ...schema.nativeChildren, policy: 'repeater' as const } : undefined);
  if (!nested) return null;
  return nested.policy === 'repeater' ? { policy: nested.policy, childType: nested.childType, repeaterKey: nested.repeaterKey, titleSettingKey: nested.titleSettingKey } : { policy: nested.policy, childType: nested.childType, count: nested.count, childSettings: nested.childSettings ?? {} };
}

/** This is a read-only structural compatibility audit. Matching versions are
 * neither necessary nor sufficient for matching widget contracts; matching
 * widget contracts never establish runtime/save/interaction verification. */
export function analyzeNative44Compatibility(knowledge: Native44Knowledge, capabilities: Native44CompatibilityCapabilities) {
  const components = NATIVE44_ALL_TYPES.map(type => {
    const local = knowledge.components[type], live = capabilities.legacySchemas[type];
    const sourceHash = knowledge.index.components[type]?.sha256;
    const result = { componentType: type, status: 'unverified' as Native44CompatibilityStatus, registered: Boolean(live), sourceHash: sourceHash ?? null, targetSchemaHash: live ? hash(live) : null, runtimeVerified: false as const, controls: [] as Native44ControlCompatibility[], differences: [] as string[], runtimeChecks: local?.evidence.runtimeRetestRequired ?? [], usableCommonFields: [] as string[], targetOnlyFields: [] as string[] };
    if (!local) { result.differences.push('Local component knowledge was not loaded'); return result; }
    if (!live) { result.status = capabilities.registrationComplete || capabilities.missingTypes?.includes(type) ? 'missing' : 'unverified'; result.differences.push(result.status === 'missing' ? 'Component is absent from the complete target registry observation' : 'Component has not been observed in this partial target read'); return result; }
    const primary = new Set(local.usage.primaryContentFields);
    result.targetOnlyFields = Object.keys(live.controls).filter(field => !local.controls.some(control => control.id === field));
    result.controls = local.controls.flatMap(control => compareControl(type, control, live.controls[control.id], primary));
    for (const field of primary) if (!local.controls.some(control => control.id === field)) result.differences.push(`Recipe primary field ${field} has no local control contract`);
    if (!same(local.nested ?? local.usage.nested ?? null, nestedContract(live))) result.differences.push('Nested child/container model differs or lacks proof');
    result.usableCommonFields = result.controls.filter(control => control.status === 'compatible-common').map(control => control.field);
    result.status = result.differences.length || result.controls.some(control => control.status === 'changed-needs-adapter') ? 'changed-needs-adapter' : result.controls.some(control => control.status === 'unverified') || !result.controls.length ? 'unverified' : 'compatible-common';
    return result;
  });
  const summary = Object.fromEntries((['compatible-common', 'changed-needs-adapter', 'missing', 'unverified'] as const).map(status => [status, components.filter(component => component.status === status).length]));
  const risks = Object.fromEntries((['ordinary-content', 'carousel-high-risk', 'product-high-risk', 'shared-style'] as const).map(category => [category, { common: components.flatMap(component => component.controls).filter(control => control.risk === category && control.status === 'compatible-common').length, changed: components.flatMap(component => component.controls).filter(control => control.risk === category && control.status === 'changed-needs-adapter').length, unverified: components.flatMap(component => component.controls).filter(control => control.risk === category && control.status === 'unverified').length }]));
  return { version: 1, kind: 'native44-readonly-compatibility', knowledgeFingerprint: knowledge.index.fingerprint, capabilitiesHash: hash(capabilities), sourcePackageHashes: knowledge.index.source.packageHashes, actualVersions: { ...capabilities.versions }, requiredVersions: { ...knowledge.index.requiredEnvironment }, registrationComplete: capabilities.registrationComplete === true, summary, risks, components, runtimeVerified: false, writePolicyChanged: false, limitations: ['Schema compatibility only; no draft, media, form, product or service was written', 'A common field still needs a task-specific recipe and qualified save/runtime evidence', 'Version differences are reported as context; they do not alone classify components as incompatible', 'This report does not relax the separately configured exact-version write policy'] };
}

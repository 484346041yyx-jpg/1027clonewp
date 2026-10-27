import { createHash } from 'node:crypto';
import type { Native44ComponentKnowledge, Native44Condition, Native44Control } from './knowledge.js';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const suffix = /_(?:widescreen|laptop|tablet_extra|tablet|mobile_extra|mobile)$/;
export function responsiveSettingKey(controlId: string, device: string): string {
  if (device === 'desktop') return controlId;
  if (!/^(?:widescreen|laptop|tablet_extra|tablet|mobile_extra|mobile)$/.test(device)) throw new Error(`native44_unknown_device: ${device}`);
  if (suffix.test(controlId)) throw new Error(`native44_responsive_suffix_already_present: ${controlId}`);
  return `${controlId}_${device}`;
}
export function expandedNative44Controls(controls: Native44Control[]): Map<string, Native44Control> {
  const map = new Map(controls.map(control => [control.id, control]));
  for (const control of controls) {
    if (!control.responsive || suffix.test(control.id)) continue;
    for (const device of control.devices?.length ? control.devices.filter(device => device !== 'desktop') : ['tablet', 'mobile']) {
      const key = responsiveSettingKey(control.id, device);
      if (!map.has(key)) map.set(key, { ...control, id: key, responsive: false, defaultValue: control.responsiveDefaults?.[device], jsonPath: `settings.${key}` });
    }
  }
  return map;
}
function fieldValue(settings: Record<string, unknown>, field: string): unknown {
  const tokens = field.match(/^[^.[\]]+|(?<=\[)[^\]]+|(?<=\.)[^.[\]]+/g) || [];
  let value: unknown = settings;
  for (const token of tokens) {
    if (token === 'value' && !object(value)) continue;
    if (!object(value)) return undefined;
    value = value[token];
  }
  return value;
}
const includes = (haystack: unknown, needle: unknown): boolean => Array.isArray(haystack) ? haystack.some(value => same(value, needle)) : typeof haystack === 'string' && haystack.includes(String(needle ?? ''));
export function evaluateNative44Condition(ast: Native44Condition | null | undefined, component: Record<string, unknown>, local = component, localScope = 'component'): boolean {
  if (!ast) return true;
  if (ast.type === 'group') {
    const values = (ast.terms || []).map(term => evaluateNative44Condition(term, component, local, localScope));
    return ast.operator === 'or' ? values.some(Boolean) : ast.operator === 'and' || !ast.operator ? values.every(Boolean) : false;
  }
  if (ast.type !== 'predicate') return false;
  const scope = ast.scope || localScope;
  if (scope !== 'component' && scope !== localScope) return false;
  const actual = fieldValue(scope === 'component' ? component : local, ast.field || ''); const expected = ast.value;
  const equal = Array.isArray(actual) && !Array.isArray(expected) ? includes(actual, expected) : same(actual, expected);
  switch (ast.operator) {
    case 'equals': return equal;
    case 'not-equals': return !equal;
    case 'in': return Array.isArray(expected) ? expected.some(value => same(actual, value)) : includes(expected, actual);
    case 'not-in': return !(Array.isArray(expected) ? expected.some(value => same(actual, value)) : includes(expected, actual));
    case 'contains': return includes(actual, expected);
    case 'not-contains': return !includes(actual, expected);
    case 'greater-than': return Number(actual) > Number(expected);
    case 'greater-than-or-equal': return Number(actual) >= Number(expected);
    case 'less-than': return Number(actual) < Number(expected);
    case 'less-than-or-equal': return Number(actual) <= Number(expected);
    case 'empty': return actual === undefined || actual === null || actual === '' || Array.isArray(actual) && !actual.length;
    case 'not-empty': return !(actual === undefined || actual === null || actual === '' || Array.isArray(actual) && !actual.length);
    default: return false;
  }
}
function predicates(ast: Native44Condition | null | undefined): Native44Condition[] {
  return !ast ? [] : ast.type === 'predicate' ? [ast] : (ast.terms || []).flatMap(predicates);
}
function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string' || value === '' || typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(value); return Number.isFinite(number) ? number : undefined;
}
function validateValue(control: Native44Control, value: unknown, at: string, errors: string[]): void {
  if (value === null || value === undefined) { errors.push(`${at} cannot be null or undefined`); return; }
  const domain = control.valueDomain || {}; const type = String(domain.type || control.type || '');
  const options = domain.options || [];
  const allowedEmpty = value === '' && (control.defaultValue === '' || type === 'switcher');
  if (options.length && !allowedEmpty && !same(value, control.defaultValue)) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some(item => !options.some(option => same(option.value, item)))) errors.push(`${at} is not a declared value (no type coercion)`);
  }
  const checkNumber = (raw: unknown, unit: string | undefined, location: string) => {
    if (raw === '') return; // An explicit empty Elementor size preserves inheritance.
    const number = numeric(raw); if (number === undefined) { errors.push(`${location} must be a finite number`); return; }
    const limits = unit ? domain.range?.[unit] || {} : {};
    const min = limits.min ?? domain.min; const max = limits.max ?? domain.max; const step = limits.step ?? domain.step;
    if (min !== undefined && number < min) errors.push(`${location} is below ${min}${unit || ''}`);
    if (max !== undefined && number > max) errors.push(`${location} is above ${max}${unit || ''}`);
    if (step !== undefined && step > 0 && Math.abs((number - (min ?? 0)) / step - Math.round((number - (min ?? 0)) / step)) > 1e-7) errors.push(`${location} does not match step ${step}`);
  };
  if (type === 'number') checkNumber(value, undefined, at);
  if (['slider', 'dimensions'].includes(type)) {
    if (!object(value)) { errors.push(`${at} must preserve the ${type} object shape`); return; }
    const unit = value.unit;
    if (typeof unit !== 'string' || domain.size_units?.length && !domain.size_units.includes(unit)) errors.push(`${at}.unit is not declared`);
    const keys = type === 'slider' ? ['unit', 'size', 'sizes'] : ['unit', 'top', 'right', 'bottom', 'left', 'isLinked'];
    for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${at}.${key} is not a ${type} field`);
    if (type === 'slider') {
      if (!('size' in value)) errors.push(`${at}.size is missing`); else checkNumber(value.size, typeof unit === 'string' ? unit : undefined, `${at}.size`);
      if (value.sizes !== undefined && !Array.isArray(value.sizes)) errors.push(`${at}.sizes must be an array`);
      if (Array.isArray(value.sizes)) value.sizes.forEach((size, index) => checkNumber(size, typeof unit === 'string' ? unit : undefined, `${at}.sizes[${index}]`));
    } else {
      for (const edge of ['top', 'right', 'bottom', 'left']) if (edge in value) checkNumber(value[edge], typeof unit === 'string' ? unit : undefined, `${at}.${edge}`);
      if (value.isLinked !== undefined && typeof value.isLinked !== 'boolean') errors.push(`${at}.isLinked must be boolean`);
    }
  }
  if (type === 'url') {
    if (!object(value) || typeof value.url !== 'string') errors.push(`${at} must be a URL object`);
    else for (const key of Object.keys(value)) if (!['url', 'is_external', 'nofollow', 'custom_attributes'].includes(key)) errors.push(`${at}.${key} is not a URL field`);
  }
  if (type === 'media') {
    if (!object(value) || value.id !== undefined && typeof value.id !== 'number' && typeof value.id !== 'string' || object(value) && value.url !== undefined && typeof value.url !== 'string') errors.push(`${at} must be a media object`);
  }
}

/** Elementor populates Reply-To from this form's email fields in the editor. */
function formReplyToControl(componentType:string, control:Native44Control, settings:Record<string,unknown>, value:unknown):Native44Control {
  if(componentType!=='form'||control.id!=='email_reply_to'||control.type!=='select'||typeof value!=='string'||!value||!Array.isArray(settings.form_fields)||!settings.form_fields.some(field=>object(field)&&field.field_type==='email'&&field.custom_id===value))return control;
  return {...control,valueDomain:{...control.valueDomain,options:[...(control.valueDomain?.options??[]),{value}]}};
}
export interface Native44SettingsResult { ok: boolean; settings: Record<string, unknown>; errors: string[]; trace: { action: string; controlId: string; requiredBy?: string }[]; visibleControlIds: string[]; hiddenControlIds: string[] }
/** Validates a local researched contract; actual registered controls remain a separate optional gate. */
export function solveNative44Settings(component: Pick<Native44ComponentKnowledge, 'componentType' | 'controls'>, inputSettings: Record<string, unknown>, registeredControls?: Readonly<Record<string, unknown>>): Native44SettingsResult {
  const errors: string[] = []; const trace: Native44SettingsResult['trace'] = []; const settings = structuredClone(inputSettings);
  const top = expandedNative44Controls(component.controls);
  if (!object(inputSettings)) throw new Error(`native44_settings_object_required: ${component.componentType}`);
  const visit = (controls: Map<string, Native44Control>, local: Record<string, unknown>, prefix: string, scope: string) => {
    for (const key of Object.keys(local)) {
      if (!controls.has(key)) errors.push(`${prefix}${key} is not declared by ${component.componentType}`);
      if (!prefix && registeredControls && !Object.hasOwn(registeredControls, key)) errors.push(`${key} is not registered in the target environment`);
    }
    let changed = true; let rounds = 0;
    while (changed && rounds++ <= controls.size + top.size) {
      changed = false;
      for (const control of controls.values()) if (local[control.id] !== undefined) for (const predicate of predicates(control.condition)) {
        const ownerScope = predicate.scope || scope; const owner = ownerScope === 'component' ? settings : ownerScope === scope ? local : undefined;
        const ownerControls = ownerScope === 'component' ? top : controls; const driverId = (predicate.field || '').split(/[.\[]/)[0]!;
        if (!owner) { errors.push(`${prefix}${control.id} has an unknown condition scope ${ownerScope}`); continue; }
        if (owner[driverId] !== undefined) continue;
        const driver = ownerControls.get(driverId);
        if (!driver || driver.defaultValue === undefined || driver.defaultPolicy === 'task-resource-required' || driver.defaultPolicy === 'task-content-required') { errors.push(`${prefix}${control.id} requires an explicit value for ${driverId}`); continue; }
        owner[driverId] = structuredClone(driver.defaultValue); trace.push({ action: 'apply-declared-driver-default', controlId: driverId, requiredBy: `${prefix}${control.id}` }); changed = true;
      }
    }
    for (const control of controls.values()) {
      const value = local[control.id]; if (value === undefined) continue;
      if (!evaluateNative44Condition(control.condition, settings, local, scope)) { delete local[control.id]; trace.push({ action: 'remove-inactive-setting', controlId: `${prefix}${control.id}` }); continue; }
      if (!control.repeater) { validateValue(formReplyToControl(component.componentType,control,settings,value), value, `${prefix}${control.id}`, errors); continue; }
      if (!Array.isArray(value)) { errors.push(`${prefix}${control.id} must be an ordered repeater array`); continue; }
      const identity = control.repeater.itemIdentityField || '_id'; const ids = new Set<string>();
      const fields = new Map(control.repeater.fields.map(field => [field.id, field]));
      value.forEach((raw, index) => {
        const at = `${prefix}${control.id}[${index}]`;
        if (!object(raw)) { errors.push(`${at} must be an object`); return; }
        if (!fields.has(identity)) fields.set(identity, { id: identity, type: 'text' });
        if (raw[identity] === undefined || raw[identity] === '') raw[identity] = createHash('sha256').update(JSON.stringify({ component: component.componentType, path: `${prefix}${control.id}`, index, item: raw })).digest('hex').slice(0, 7);
        if (typeof raw[identity] !== 'string' || ids.has(String(raw[identity]))) errors.push(`${at}.${identity} must be a unique string`);
        ids.add(String(raw[identity]));
        visit(fields, raw, `${at}.`, `repeater:${control.id}`);
      });
    }
  };
  visit(top, settings, '', 'component');
  if (registeredControls) for (const key of Object.keys(settings)) if (!Object.hasOwn(registeredControls, key)) errors.push(`${key} is not registered in the target environment (including condition drivers)`);
  const controls = [...top.values()];
  return { ok: errors.length === 0, settings, errors: [...new Set(errors)], trace, visibleControlIds: controls.filter(control => evaluateNative44Condition(control.condition, settings)).map(control => control.id), hiddenControlIds: controls.filter(control => !evaluateNative44Condition(control.condition, settings)).map(control => control.id) };
}
export function assertNative44Settings(component: Pick<Native44ComponentKnowledge, 'componentType' | 'controls'>, settings: Record<string, unknown>, registeredControls?: Readonly<Record<string, unknown>>): Native44SettingsResult {
  const result = solveNative44Settings(component, settings, registeredControls);
  if (!result.ok) throw new Error(`native44_settings_invalid: ${component.componentType}\n${result.errors.join('\n')}`);
  return result;
}

interface RegisteredFrame { values: Record<string, unknown>; controls: Record<string, unknown> }
function registeredFields(raw: unknown, at: string): Record<string, unknown> {
  if (object(raw)) return raw;
  if (Array.isArray(raw)) {
    const fields: Record<string, unknown> = {};
    for (const field of raw) {
      if (!object(field)) throw Error(`${at}: incomplete registered repeater field`);
      const name = field.name ?? field.id;
      if (typeof name !== 'string' || !name || Object.hasOwn(fields, name)) throw Error(`${at}: missing or duplicate registered repeater field identity`);
      fields[name] = field;
    }
    return fields;
  }
  throw Error(`${at}: registered repeater field contract is unverified`);
}
function liveValueControl(id: string, raw: Record<string, unknown>): Native44Control {
  const options = object(raw.options) ? Object.keys(raw.options).map(value => ({ value })) : Array.isArray(raw.options) ? raw.options.map(value => ({ value })) : [];
  const domain: NonNullable<Native44Control['valueDomain']> = { type: String(raw.type), options };
  for (const key of ['min', 'max', 'step']) if (raw[key] !== undefined && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || key === 'step' && raw[key] <= 0)) throw Error(`${id}: registered ${key} contract is unverified`);
  if (raw.size_units !== undefined && raw.size_units !== '' && (!Array.isArray(raw.size_units) || raw.size_units.some(unit => typeof unit !== 'string'))) throw Error(`${id}: registered unit contract is unverified`);
  if (raw.range !== undefined && !(Array.isArray(raw.range) && !raw.range.length)) {
    if (!object(raw.range)) throw Error(`${id}: registered range contract is unverified`);
    for (const [unit, limits] of Object.entries(raw.range)) {
      if (!object(limits)) throw Error(`${id}: registered ${unit} range contract is unverified`);
      for (const key of ['min', 'max', 'step']) if (limits[key] !== undefined && (typeof limits[key] !== 'number' || !Number.isFinite(limits[key]) || key === 'step' && limits[key] <= 0)) throw Error(`${id}: registered ${unit}.${key} contract is unverified`);
    }
  }
  for (const key of ['min', 'max', 'step', 'range', 'size_units', 'multiple']) if (raw[key] !== undefined) domain[key] = structuredClone(raw[key]);
  return { id, type: String(raw.type), valueDomain: domain, ...(Object.hasOwn(raw, 'default') ? { defaultValue: raw.default } : {}) };
}
const registeredOperators: Record<string, string> = {
  '=': 'equals', '==': 'equals', '===': 'equals', equals: 'equals',
  '!=': 'not-equals', '!==': 'not-equals', 'not-equals': 'not-equals',
  in: 'in', '!in': 'not-in', 'not-in': 'not-in', contains: 'contains', '!contains': 'not-contains', 'not-contains': 'not-contains',
  '>': 'greater-than', '>=': 'greater-than-or-equal', '<': 'less-than', '<=': 'less-than-or-equal',
  'greater-than': 'greater-than', 'greater-than-or-equal': 'greater-than-or-equal', 'less-than': 'less-than', 'less-than-or-equal': 'less-than-or-equal', empty: 'empty', 'not-empty': 'not-empty',
};
function registeredCondition(raw: Record<string, unknown>, scope: string, at: string): Native44Condition | null {
  const groups: Native44Condition[] = [];
  const field = (name: unknown): string => {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.\[\]-]*$/.test(name)) throw Error(`${at}: incomplete registered condition field`);
    return name;
  };
  if (raw.condition !== undefined && raw.condition !== null) {
    if (Array.isArray(raw.condition) && raw.condition.length === 0) { /* PHP empty map */ }
    else {
      if (!object(raw.condition)) throw Error(`${at}: flat registered condition is unverified`);
      const terms = Object.entries(raw.condition).map(([expression, value]): Native44Condition => {
        const negate = expression.endsWith('!');
        return { type: 'predicate', field: field(negate ? expression.slice(0, -1) : expression), operator: Array.isArray(value) ? negate ? 'not-in' : 'in' : negate ? 'not-equals' : 'equals', value, scope };
      });
      if (terms.length) groups.push({ type: 'group', operator: 'and', terms });
    }
  }
  if (raw.conditions !== undefined && raw.conditions !== null && !(Array.isArray(raw.conditions) && !raw.conditions.length)) {
    const parse = (node: unknown): Native44Condition => {
      if (!object(node)) throw Error(`${at}: rich registered condition is unverified`);
      if (Object.hasOwn(node, 'terms')) {
        if (!Array.isArray(node.terms) || !node.terms.length || node.relation !== undefined && !['and', 'or'].includes(String(node.relation).toLowerCase())) throw Error(`${at}: incomplete registered condition group`);
        return { type: 'group', operator: node.relation === undefined ? 'and' : String(node.relation).toLowerCase(), terms: node.terms.map(parse) };
      }
      const operator = registeredOperators[String(node.operator ?? '===')];
      if (!operator || !Object.hasOwn(node, 'value') && !['empty', 'not-empty'].includes(operator)) throw Error(`${at}: unsupported or incomplete registered condition operator`);
      if (node.scope !== undefined && typeof node.scope !== 'string') throw Error(`${at}: incomplete registered condition scope`);
      return { type: 'predicate', field: field(node.name ?? node.field), operator, value: node.value, scope: typeof node.scope === 'string' ? node.scope : scope };
    };
    groups.push(parse(raw.conditions));
  }
  return groups.length ? { type: 'group', operator: 'and', terms: groups } : null;
}
function assertRegisteredCondition(ast: Native44Condition | null, frames: Map<string, RegisteredFrame>, at: string): void {
  if (!ast) return;
  // Resolve every predicate first, including branches of OR, so unknown contracts cannot pass by short circuit.
  const resolved = new Map<Native44Condition, unknown>();
  for (const predicate of predicates(ast)) {
    const frame = frames.get(predicate.scope || 'component');
    if (!frame) throw Error(`${at}: registered condition scope is unverified: ${predicate.scope}`);
    const name = (predicate.field || '').split(/[.\[]/)[0]!;
    const driver = frame.controls[name];
    if (!object(driver)) throw Error(`${at}: registered condition driver is unverified: ${name}`);
    let owner: Record<string, unknown>;
    if (Object.hasOwn(frame.values, name)) owner = frame.values;
    else if (Object.hasOwn(driver, 'default')) owner = { [name]: driver.default };
    else throw Error(`${at}: registered condition driver has no explicit value or declared default: ${name}`);
    let value = fieldValue(owner, predicate.field || '');
    // Task media are verified before upload. Their URL is not known yet, but
    // an exact $asset reference proves the URL will be nonempty. Resolve only
    // URL emptiness predicates; literal URLs and other compound tests stay unknown.
    const media = owner[name];
    const emptyTest = predicate.value === '' || Array.isArray(predicate.value) && predicate.value.length === 1 && predicate.value[0] === '';
    if (value === undefined && driver.type === 'media' && object(media) && typeof media.$asset === 'string' && media.$asset.length > 0 && Object.keys(media).length === 1 && predicate.field === `${name}[url]` && emptyTest && ['equals','not-equals','in','not-in'].includes(predicate.operator || '')) value = '__verified_task_media_presence__';
    if (value === undefined) throw Error(`${at}: registered compound condition value is unverified: ${predicate.field}`);
    resolved.set(predicate, value);
  }
  const evaluate = (node: Native44Condition): boolean => {
    if (node.type === 'group') { const values = (node.terms || []).map(evaluate); return node.operator === 'or' ? values.some(Boolean) : values.every(Boolean); }
    return evaluateNative44Condition({ ...node, field: 'value', scope: 'component' }, { value: resolved.get(node) });
  };
  if (!evaluate(ast)) throw Error(`${at}: inactive setting under the actual registered condition contract`);
}
/** Actual target contracts are evaluated independently from the imported research model. */
export function assertNative44RegisteredSettings(component: Pick<Native44ComponentKnowledge, 'componentType' | 'controls'>, settings: Record<string, unknown>, registeredControls: Readonly<Record<string, unknown>>): void {
  const local = expandedNative44Controls(component.controls);
  const visit = (values: Record<string, unknown>, declarations: Readonly<Record<string, unknown>>, researched: Map<string, Native44Control>, scope: string, at: string, ancestors: Map<string, RegisteredFrame>) => {
    const frames = new Map(ancestors); frames.set(scope, { values, controls: declarations });
    for (const [id, value] of Object.entries(values)) {
      if (id === '_id' && scope.startsWith('repeater:')) continue;
      const raw = declarations[id], known = researched.get(id); const path = `${at}.${id}`;
      if (!object(raw) || typeof raw.type !== 'string' || !raw.type || !known) throw Error(`${path}: local/live field contract is unverified`);
      if (known.type !== raw.type) throw Error(`${path}: local/live control type mismatch (${known.type} / ${raw.type})`);
      assertRegisteredCondition(registeredCondition(raw, scope, path), frames, path);
      const errors: string[] = [];
      validateValue(formReplyToControl(component.componentType,liveValueControl(id, raw),settings,value), value, path, errors);
      if (raw.type === 'number' && typeof value !== 'number') errors.push(`${path}: actual number field cannot coerce a string`);
      if (['text', 'textarea', 'wysiwyg', 'font', 'color', 'hidden', 'code', 'switcher', 'popover_toggle', 'select', 'choose'].includes(raw.type) && typeof value !== 'string') errors.push(`${path}: actual ${raw.type} field must be a string`);
      if (errors.length) throw Error(`native44_registered_setting_invalid: ${errors.join('; ')}`);
      if (known.repeater || ['repeater', 'nested-elements-repeater', 'form-fields-repeater', 'fields_map'].includes(raw.type)) {
        if (!known.repeater || !Array.isArray(value)) throw Error(`${path}: local/live repeater model mismatch`);
        const fields = registeredFields(raw.fields, path); const knownFields = new Map(known.repeater.fields.map(field => [field.id, field]));
        for (const [index, item] of value.entries()) {
          if (!object(item)) throw Error(`${path}[${index}]: actual repeater requires an object`);
          visit(item, fields, knownFields, `repeater:${id}`, `${path}[${index}]`, frames);
        }
      }
    }
  };
  visit(settings, registeredControls, local, 'component', component.componentType, new Map());
}

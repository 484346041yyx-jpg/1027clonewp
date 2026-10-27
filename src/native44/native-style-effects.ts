import * as css from 'css-tree';
import type { ControlInfo, LegacySchema } from '../wordpress/types.js';
import type { Native44Control } from './knowledge.js';
import { evaluateNative44Condition } from './settings.js';

export interface NativeStyleDeclaration { selector: string; property: string; value: string }
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function safeNativeStyleSettingValue(value: unknown): boolean {
  if (typeof value === 'string') return !/[;{}<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|!\s*important|(?:url|expression)\s*\(/i.test(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(safeNativeStyleSettingValue);
  if (value && typeof value === 'object') return Object.values(value).every(safeNativeStyleSettingValue);
  return typeof value === 'boolean';
}
export function nativeStyleRegisteredControl(control: Native44Control, live: ControlInfo): ControlInfo {
  const targets = record(control.effectTargets);
  return { ...live, selectors: Object.hasOwn(live, 'selectors') ? live.selectors : targets.selectors, selectors_dictionary: Object.hasOwn(live, 'selectors_dictionary') ? live.selectors_dictionary : targets.selectorsDictionary, prefix_class: Object.hasOwn(live, 'prefix_class') ? live.prefix_class : targets.prefixClass };
}
function readValue(settings: Record<string, unknown>, token: string): unknown {
  const [name, ...parts] = token.replace(/\[([^\]]+)\]/g, '.$1').split('.');
  let value: unknown = settings[name];
  for (const part of parts) {
    if (part.toUpperCase() === 'VALUE' && (typeof value === 'string' || typeof value === 'number')) continue;
    value = record(value)[part.toLowerCase()] ?? record(value)[part];
  }
  return value;
}
function active(control: ControlInfo, settings: Record<string, unknown>, schema: LegacySchema): boolean {
  const effective = { ...Object.fromEntries(Object.entries(schema.controls).filter(([, field]) => field.default !== undefined).map(([name, field]) => [name, field.default])), ...settings };
  for (const [rawName, expected] of Object.entries(record(control.condition))) {
    const inverted = rawName.endsWith('!'), name = inverted ? rawName.slice(0, -1) : rawName;
    const value = readValue(effective, name);
    const matches = Array.isArray(expected) ? expected.some(item => equal(item, value)) : equal(expected, value);
    if (inverted ? matches : !matches) return false;
  }
  if (control.conditions) {
    const evaluate = (condition: unknown): boolean => {
      const node = record(condition);
      if (Array.isArray(node.terms)) return String(node.relation ?? 'and').toLowerCase() === 'or' ? node.terms.some(evaluate) : node.terms.every(evaluate);
      if (typeof node.name !== 'string') return false;
      const actual = readValue(effective, node.name);
      switch (node.operator ?? '===') {
        case '===': case '==': return equal(actual, node.value);
        case '!==': case '!=': return !equal(actual, node.value);
        case 'in': return Array.isArray(node.value) && node.value.some(item => equal(actual, item));
        case '!in': return Array.isArray(node.value) && !node.value.some(item => equal(actual, item));
        case '>': return Number(actual) > Number(node.value);
        case '<': return Number(actual) < Number(node.value);
        case '>=': return Number(actual) >= Number(node.value);
        case '<=': return Number(actual) <= Number(node.value);
        default: return false;
      }
    };
    if (!evaluate(control.conditions)) return false;
  }
  return true;
}
export function renderNativeStyleTemplate(template: string, value: unknown, control: ControlInfo = { type: 'text' }, settings: Record<string, unknown> = {}): string | undefined {
  const dictionary = record(control.selectors_dictionary), structured = record(value);
  const hasEmptySize = ['slider', 'dimensions'].includes(control.type) && ('size' in structured ? structured.size === '' : false);
  if (value === undefined || value === null || value === '' || hasEmptySize || !safeNativeStyleSettingValue(value)) return undefined;
  let unresolved = false;
  const result = template.replace(/{{\s*([\w.\[\]-]+)\s*}}/g, (_match, token: string) => {
    let resolved: unknown;
    if (token === 'VALUE') resolved = Object.hasOwn(dictionary, String(value)) ? dictionary[String(value)] : value;
    else if (token === 'UNIT' && control.unit_selectors_dictionary) resolved = record(control.unit_selectors_dictionary)[String(structured.unit)];
    else if (/^[A-Z_]+$/.test(token)) resolved = structured[token.toLowerCase()];
    else resolved = readValue(settings, token);
    if (token !== 'VALUE' || !Object.hasOwn(dictionary, String(value))) if (!safeNativeStyleSettingValue(resolved)) unresolved = true;
    if (resolved === undefined || resolved === null || typeof resolved === 'object' || resolved === '') { unresolved = true; return ''; }
    return String(resolved);
  });
  return unresolved ? undefined : result;
}
export function nativeStyleControlEffects(schema: LegacySchema, controlId: string, settings: Record<string, unknown>): NativeStyleDeclaration[] {
  const control = schema.controls[controlId];
  if (!control || !Object.hasOwn(settings, controlId) || !active(control, settings, schema)) return [];
  const effects: NativeStyleDeclaration[] = [];
  for (const [selector, raw] of Object.entries(record(control.selectors))) {
    if (typeof raw !== 'string') continue;
    const expanded = renderNativeStyleTemplate(raw, settings[controlId], control, { ...Object.fromEntries(Object.entries(schema.controls).filter(([, field]) => field.default !== undefined).map(([name, field]) => [name, field.default])), ...settings });
    if (expanded === undefined || /{{|}}|[<>\u0000]/.test(expanded)) continue;
    try {
      const ast = css.parse(expanded, { context: 'declarationList', parseCustomProperty: true });
      if (ast.type !== 'DeclarationList') continue;
      const declarations: NativeStyleDeclaration[] = [];
      let unsafe = false;
      css.walk(ast, child => { if (child.type === 'Atrule' || child.type === 'Rule' || child.type === 'Raw' || child.type === 'Url' || child.type === 'Function' && /^(expression|url)$/i.test(child.name)) unsafe = true; });
      if (unsafe) continue;
      ast.children.forEach(declaration => {
        if (declaration.type !== 'Declaration' || declaration.important) { unsafe = true; return; }
        declarations.push({ selector, property: declaration.property, value: css.generate(declaration.value) });
      });
      if (!unsafe) effects.push(...declarations);
    } catch {}
  }
  return effects;
}
function color(value: string): string {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return 'rgba(0,0,0,0)';
  const hex = text.match(/^#([\da-f]{3,8})$/);
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const digits = hex[1].length < 5 ? [...hex[1]].map(character => character + character).join('') : hex[1];
    return `rgba(${parseInt(digits.slice(0, 2), 16)},${parseInt(digits.slice(2, 4), 16)},${parseInt(digits.slice(4, 6), 16)},${digits.length === 8 ? Number((parseInt(digits.slice(6), 16) / 255).toFixed(3)) : 1})`;
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  return rgb ? `rgba(${Number(rgb[1])},${Number(rgb[2])},${Number(rgb[3])},${Number(rgb[4] ?? 1)})` : text;
}
export function equalNativeStyleValue(property: string, left: string, right: string): boolean {
  if (/(?:color|fill|stroke)$/.test(property)) return color(left) === color(right);
  const normalize = (value: string) => {
    try {
      const generated = css.generate(css.parse(value, { context: 'value' })).replace(/\b0(?:px|em|rem)\b/g, '0');
      return property === 'font-family' ? generated.replace(/["']/g, '').toLowerCase() : generated;
    } catch { return value.trim(); }
  };
  return normalize(left) === normalize(right);
}
export function expandNativeStyleDeclaration(effect: NativeStyleDeclaration): NativeStyleDeclaration[] {
  const edge = effect.property.match(/^(margin|padding|border-width|border-color|border-style)$/);
  if (!edge) return [effect];
  let pieces: string[];
  try {
    const ast = css.parse(effect.value, { context: 'value' });
    if (ast.type !== 'Value') return [effect];
    pieces = ast.children.toArray().filter(node => node.type !== 'WhiteSpace').map(node => css.generate(node));
  } catch { return [effect]; }
  if (!pieces.length || pieces.length > 4 || pieces.some(piece => piece === ',')) return [effect];
  const [top, right = top, bottom = top, left = right] = pieces;
  return ['top', 'right', 'bottom', 'left'].map((side, index) => ({ ...effect, property: effect.property.startsWith('border-') ? `border-${side}-${effect.property.slice(7)}` : `${effect.property}-${side}`, value: [top, right, bottom, left][index] }));
}
export function inferNativeStyleValue(control: ControlInfo, template: string, desired: string, property: string, values: Record<string, string>): unknown[] {
  const candidates: unknown[] = [];
  const options = record(control.options);
  candidates.push(...Object.keys(options), ...Object.keys(record(control.selectors_dictionary)));
  if (control.default !== undefined) candidates.push(control.default);
  if (['color', 'text', 'number', 'select', 'choose', 'font'].includes(control.type)) {
    const escaped = template.split(/{{VALUE}}/);
    if (escaped.length === 2 && !/{{/.test(escaped.join(''))) {
      const expression = new RegExp('^' + escaped[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\S]+)' + escaped[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', property === 'font-family' ? 'i' : '');
      const match = desired.match(expression);
      if (match) candidates.push(control.type === 'number' ? Number(match[1]) : match[1]);
      if (control.type === 'font') candidates.push(desired.split(',')[0].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  if (control.type === 'slider' && template === '{{SIZE}}{{UNIT}}') {
    const match = desired.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|vh|vw|deg|s|ms)$/);
    if (match) candidates.push({ size: Number(match[1]), unit: match[2] });
  }
  if (control.type === 'dimensions') {
    const prefix = property.startsWith('border-') ? property.endsWith('-width') ? 'border' : '' : property.split('-')[0];
    const result: Record<string, unknown> = { isLinked: false };
    let unit = '';
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = values[prefix === 'border' ? `border-${side}-width` : `${prefix}-${side}`];
      const match = value?.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|vh|vw)$/);
      if (!match || unit && unit !== match[2]) { unit = ''; break; }
      unit = match[2]; result[side] = match[1];
    }
    if (unit) candidates.push({ ...result, unit });
  }
  if (['box_shadow', 'text_shadow', 'box-shadow', 'text-shadow'].includes(control.type)) {
    try {
      const ast = css.parse(desired, { context: 'value' });
      if (ast.type === 'Value') {
        const parts = ast.children.toArray(), dimensions = parts.filter(node => node.type === 'Dimension' && node.unit === 'px' || node.type === 'Number' && node.value === '0');
        const ink = parts.find(node => node.type === 'Function' && /^(rgb|rgba|hsl|hsla)$/i.test(node.name) || node.type === 'Hash');
        if (ink && dimensions.length >= 2 && dimensions.length <= 4 && !parts.some(node => node.type === 'Operator' && node.value === ',')) candidates.push({ horizontal: Number((dimensions[0] as css.Dimension).value), vertical: Number((dimensions[1] as css.Dimension).value), blur: dimensions[2] ? Number((dimensions[2] as css.Dimension).value) : 0, ...(control.type.includes('box') ? { spread: dimensions[3] ? Number((dimensions[3] as css.Dimension).value) : 0, position: parts.some(node => node.type === 'Identifier' && node.name === 'inset') ? 'inset' : '' } : {}), color: css.generate(ink) });
      }
    } catch {}
  }
  return [...new Map(candidates.filter(value => value !== undefined && !(typeof value === 'number' && !Number.isFinite(value))).map(value => [JSON.stringify(value), value])).values()];
}
export function satisfyNativeStyleConditions(control: Native44Control, definitions: Native44Control[], settings: Record<string, unknown>): Record<string, unknown> | undefined {
  const result = structuredClone(settings), byId = new Map(definitions.map(item => [item.id, item]));
  const defaults = Object.fromEntries(definitions.filter(item => item.defaultValue !== undefined && !['task-resource-required', 'task-content-required'].includes(item.defaultPolicy ?? '')).map(item => [item.id, item.defaultValue]));
  const populate = (condition: Native44Control['condition'], depth = 0): boolean => {
    if (!condition || evaluateNative44Condition(condition, { ...defaults, ...result })) return true;
    if (depth > 12) return false;
    if (condition.type === 'group') {
      if (condition.operator === 'or') {
        const options = (condition.terms ?? []).map(term => { const before = structuredClone(result), ok = populate(term, depth + 1), after = structuredClone(result); for (const key of Object.keys(result)) delete result[key]; Object.assign(result, before); return ok ? after : undefined; }).filter((value): value is Record<string, unknown> => Boolean(value));
        if (new Set(options.map(value => JSON.stringify(value))).size !== 1) return false;
        Object.assign(result, options[0]); return true;
      }
      return (condition.terms ?? []).every(term => populate(term, depth + 1));
    }
    if (condition.scope && condition.scope !== 'component' || !condition.field || /[.\[]/.test(condition.field)) return false;
    const driver = byId.get(condition.field);
    if (!driver || ['task-content-required', 'task-resource-required'].includes(driver.defaultPolicy ?? '') || result[driver.id] !== undefined && !equal(result[driver.id], driver.defaultValue)) return false;
    let options: unknown[] = condition.operator === 'equals' ? [condition.value] : condition.operator === 'in' && Array.isArray(condition.value) ? condition.value : (driver.valueDomain?.options ?? []).map(option => option.value);
    options = options.filter(value => value !== '' && value !== undefined && evaluateNative44Condition(condition, { ...result, [driver.id]: value }));
    if (options.length !== 1 || !populate(driver.condition, depth + 1)) return false;
    result[driver.id] = structuredClone(options[0]); return true;
  };
  return populate(control.condition) ? result : undefined;
}

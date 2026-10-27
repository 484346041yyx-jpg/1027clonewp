import * as css from 'css-tree';
import type { LegacySchema } from '../wordpress/types.js';
import { nativeStyleTargetSelector } from '../native44/style-resolution.js';
import { equalNativeStyleValue, expandNativeStyleDeclaration } from '../native44/native-style-effects.js';
import { responsiveFail as fail } from './contract.js';

type WidthRange = { minimum: number; maximum: number; includeMinimum: boolean; includeMaximum: boolean };
export type ResponsiveNativeStyleEffect = { selector: string; property: string; value: string };
const deviceSuffix = /_(?:widescreen|laptop|tablet_extra|tablet|mobile_extra|mobile)$/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function mirrorRegisteredDesktopSettings(values: Record<string, unknown>, schema: LegacySchema | undefined, registered: ReadonlySet<string> | undefined) {
  if (!schema || !registered) return;
  for (const [name, value] of Object.entries(values)) {
    const base = schema.controls[name], tablet = schema.controls[name + '_tablet'];
    if (deviceSuffix.test(name) || !base?.responsive || !tablet || base.type !== tablet.type || !registered.has(name + '_tablet')) continue;
    if (Array.isArray(base.devices) && base.devices.length && !base.devices.includes('tablet')) continue;
    if (record(tablet.responsive) && tablet.responsive.max !== undefined && tablet.responsive.max !== 'tablet') continue;
    values[name + '_tablet'] = structuredClone(value);
  }
}

export function assertRegisteredMobileSetting(type: string, name: string, schema: LegacySchema | undefined, registered: ReadonlySet<string> | undefined) {
  const base = schema?.controls[name.slice(0, -7)], actual = schema?.controls[name];
  if (!name.endsWith('_mobile') || !base || !actual || !base.responsive || base.type !== actual.type || !registered?.has(name)) fail(`responsive_registration_${type}_${name}`);
  if (Array.isArray(base.devices) && base.devices.length && !base.devices.includes('mobile') || record(actual.responsive) && actual.responsive.max !== undefined && actual.responsive.max !== 'mobile') fail(`responsive_registration_${type}_${name}`);
}

function intersection(left: WidthRange, right: WidthRange): WidthRange | undefined {
  const minimum = Math.max(left.minimum, right.minimum), maximum = Math.min(left.maximum, right.maximum);
  const includeMinimum = (minimum !== left.minimum || left.includeMinimum) && (minimum !== right.minimum || right.includeMinimum);
  const includeMaximum = (maximum !== left.maximum || left.includeMaximum) && (maximum !== right.maximum || right.includeMaximum);
  return minimum < maximum || minimum === maximum && includeMinimum && includeMaximum ? { minimum, maximum, includeMinimum, includeMaximum } : undefined;
}

function combineRanges(left: WidthRange[], right: WidthRange[]) {
  if (left.length * right.length > 256) fail('css_mobile_media_budget');
  return left.flatMap(first => right.flatMap(second => { const match = intersection(first, second); return match ? [match] : []; }));
}

type PossibleCondition = { yes: WidthRange[]; no: WidthRange[] };
const fullRange = (): WidthRange => ({ minimum: 0, maximum: Infinity, includeMinimum: true, includeMaximum: true });
const unknownCondition = (): PossibleCondition => ({ yes: [fullRange()], no: [fullRange()] });
const exactCondition = (value: boolean): PossibleCondition => value ? { yes: [fullRange()], no: [] } : { yes: [], no: [fullRange()] };
const invertCondition = (condition: PossibleCondition): PossibleCondition => ({ yes: condition.no, no: condition.yes });
function joinConditions(left: PossibleCondition, right: PossibleCondition, operator: 'and' | 'or'): PossibleCondition {
  return operator === 'and' ? { yes: combineRanges(left.yes, right.yes), no: [...left.no, ...right.no] } : { yes: [...left.yes, ...right.yes], no: combineRanges(left.no, right.no) };
}
function widthCondition(minimum: number, maximum: number, includeMinimum = true, includeMaximum = true): PossibleCondition {
  const positive = intersection(fullRange(), { minimum, maximum, includeMinimum, includeMaximum });
  if (!positive) return exactCondition(false);
  const negative = [
    intersection(fullRange(), { minimum: 0, maximum: positive.minimum, includeMinimum: true, includeMaximum: !positive.includeMinimum }),
    intersection(fullRange(), { minimum: positive.maximum, maximum: Infinity, includeMinimum: !positive.includeMaximum, includeMaximum: true }),
  ].filter((range): range is WidthRange => Boolean(range));
  return { yes: [positive], no: negative };
}
function pixelWidth(node: css.CssNode | null): number | undefined {
  if (node?.type === 'Dimension' && node.unit.toLowerCase() === 'px' || node?.type === 'Number' && Number(node.value) === 0) return Number(node.value);
  return undefined;
}
function widthComparison(left: css.CssNode, operator: string, right: css.CssNode): PossibleCondition {
  const widthOnLeft = left.type === 'Identifier' && left.name.toLowerCase() === 'width', widthOnRight = right.type === 'Identifier' && right.name.toLowerCase() === 'width';
  const amount = pixelWidth(widthOnLeft ? right : left);
  if ((!widthOnLeft && !widthOnRight) || amount === undefined) return unknownCondition();
  const comparison = widthOnLeft ? operator : ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' } as Record<string, string>)[operator];
  if (comparison === '=') return widthCondition(amount, amount);
  if (comparison === '<' || comparison === '<=') return widthCondition(0, amount, true, comparison === '<=');
  if (comparison === '>' || comparison === '>=') return widthCondition(amount, Infinity, comparison === '>=');
  return unknownCondition();
}
function conditionRanges(node: css.CssNode): PossibleCondition {
  if (node.type === 'Feature') {
    const value = pixelWidth(node.value);
    if (value === undefined) return unknownCondition();
    if (node.name === 'min-width') return widthCondition(value, Infinity);
    if (node.name === 'max-width') return widthCondition(0, value);
    return node.name === 'width' ? widthCondition(value, value) : unknownCondition();
  }
  if (node.type === 'FeatureRange') {
    const first = widthComparison(node.left, node.leftComparison, node.middle);
    return node.right && node.rightComparison ? joinConditions(first, widthComparison(node.middle, node.rightComparison, node.right), 'and') : first;
  }
  if (node.type === 'Condition') {
    let result: PossibleCondition | undefined, operator: 'and' | 'or' = 'and', inverted = false;
    for (const child of node.children.toArray()) {
      if (child.type === 'Identifier') {
        if (child.name === 'not') inverted = !inverted;
        else if (child.name === 'and' || child.name === 'or') operator = child.name;
        continue;
      }
      const current = conditionRanges(child), next = inverted ? invertCondition(current) : current; inverted = false;
      result = result ? joinConditions(result, next, operator) : next;
    }
    return result ?? unknownCondition();
  }
  return unknownCondition();
}
function mediaRanges(value: string): WidthRange[] {
  const parsed = css.parse(value, { context: 'mediaQueryList' });
  if (parsed.type !== 'MediaQueryList') return [fullRange()];
  return parsed.children.toArray().flatMap(query => {
    if (query.type !== 'MediaQuery') return [fullRange()];
    const mediaType = query.mediaType?.toLowerCase();
    let condition = !mediaType || ['screen', 'all'].includes(mediaType) ? exactCondition(true) : ['print', 'speech'].includes(mediaType) ? exactCondition(false) : unknownCondition();
    if (query.condition) condition = joinConditions(condition, conditionRanges(query.condition), 'and');
    return (query.modifier === 'not' ? invertCondition(condition) : condition).yes;
  });
}

function expandedDeclaration(property: string, value: string): Array<{ property: string; value?: string }> {
  const expanded = expandNativeStyleDeclaration({ selector: '', property, value });
  if (expanded.length > 1 || expanded[0].property !== property) return expanded;
  if (property === 'gap') {
    const parsed = css.parse(value, { context: 'value' }), tokens = parsed.type === 'Value' ? parsed.children.toArray().filter(node => node.type !== 'WhiteSpace').map(node => css.generate(node)) : [];
    if (tokens.length === 1 || tokens.length === 2) return [{ property: 'row-gap', value: tokens[0] }, { property: 'column-gap', value: tokens[1] ?? tokens[0] }];
  }
  return [{ property, value }];
}

function mobileNativeCSSIndex(input: string, mobileMaxWidth: number, normalize: (selector: string) => string) {
  const index = new Map<string, Array<{ property: string; value: string }>>();
  const ranges: WidthRange[][] = [[{ minimum: 0, maximum: mobileMaxWidth, includeMinimum: true, includeMaximum: true }]];
  css.walk(css.parse(input), {
    enter(node: css.CssNode) {
      if (node.type === 'Atrule' && node.name.toLowerCase() === 'media') ranges.push(combineRanges(ranges[ranges.length - 1], node.prelude ? mediaRanges(css.generate(node.prelude)) : [{ minimum: 0, maximum: Infinity, includeMinimum: true, includeMaximum: true }]));
      if (node.type !== 'Rule' || !ranges[ranges.length - 1].length || node.prelude.type !== 'SelectorList') return;
      const declarations = node.block.children.toArray().filter((declaration): declaration is css.Declaration => declaration.type === 'Declaration').map(declaration => ({ property: declaration.property, value: css.generate(declaration.value) }));
      for (const selector of node.prelude.children.toArray()) {
        const normalized = normalize(css.generate(selector));
        const previous = index.get(normalized);
        if (previous) previous.push(...declarations); else index.set(normalized, [...declarations]);
      }
    },
    leave(node: css.CssNode) { if (node.type === 'Atrule' && node.name.toLowerCase() === 'media') ranges.pop(); },
  });
  return index;
}

export function createMobileNativeStyleCSSValidator(input: string, mobileMaxWidth: number) {
  let index: ReturnType<typeof mobileNativeCSSIndex> | undefined;
  const selectors = new Map<string, string>(), declarations = new Map<string, ReturnType<typeof expandedDeclaration>>();
  const normalize = (selector: string) => { let result = selectors.get(selector); if (result === undefined) { result = nativeStyleTargetSelector(selector); if (selector.length <= 8192) { if (selectors.size >= 4096) selectors.clear(); selectors.set(selector, result); } } return result; };
  const expand = (property: string, value: string) => { const key = JSON.stringify([property, value]); let result = declarations.get(key); if (!result) { result = expandedDeclaration(property, value); if (key.length <= 8192) { if (declarations.size >= 4096) declarations.clear(); declarations.set(key, result); } } return result; };
  return (ownerClass: string, effects: readonly ResponsiveNativeStyleEffect[]) => {
    if (!effects.length || !input.trim()) return;
    const expected = new Map<string, Map<string, string>>();
    for (const effect of effects) {
      if (!effect.value.trim()) continue;
      const parsed = css.parse(effect.selector.replaceAll('{{WRAPPER}}', '.' + ownerClass), { context: 'selectorList' });
      if (parsed.type !== 'SelectorList') fail('css_native_selector');
      for (const branch of parsed.children.toArray()) {
        const selector = normalize(':page ' + css.generate(branch));
        const values = expected.get(selector) ?? new Map<string, string>();
        for (const declaration of expand(effect.property, effect.value)) if (declaration.value !== undefined) values.set(declaration.property, declaration.value);
        expected.set(selector, values);
      }
    }
    index ??= mobileNativeCSSIndex(input, mobileMaxWidth, normalize);
    for (const [selector, values] of expected) for (const declaration of index.get(selector) ?? []) for (const expanded of expand(declaration.property, declaration.value)) {
      const native = values.get(expanded.property);
      if (native !== undefined && (expanded.value === undefined || !equalNativeStyleValue(expanded.property, native, expanded.value))) fail('css_overrides_native_mobile_value');
    }
  };
}

export function assertMobileNativeStyleCSS(input: string, ownerClass: string, effects: readonly ResponsiveNativeStyleEffect[], mobileMaxWidth: number) {
  createMobileNativeStyleCSSValidator(input, mobileMaxWidth)(ownerClass, effects);
}

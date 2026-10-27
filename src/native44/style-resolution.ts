import * as css from 'css-tree';
import { z } from 'zod';
import type { LegacySchema } from '../wordpress/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import { native44ModuleClass } from './adapters.js';
import { assertKnownNativeWidget as assertAllowedWidget } from './catalog.js';
import { walkNative44, type Native44Program, type Native44Component, type Native44CompileOptions } from './types.js';
import type { Native44Knowledge } from './knowledge.js';
import { resolveNative44StylesV2 } from './style-resolution-v2.js';
import { buildNative44StyleCapabilities, type Native44StyleCapabilities } from './style-capabilities.js';
export { nativeStyleControlEffects } from './native-style-effects.js';

export const styleBindingSchema = z.object({
  sourceFactId: z.string().min(1).max(240), selector: z.string().max(500),
  minWidth: z.number().int().min(1).max(10000), maxWidth: z.number().int().min(1).max(10000),
  properties: z.array(z.string().regex(/^[a-z][a-z-]*$/)).min(1).max(100),
}).strict();
export type Native44StyleBinding = z.infer<typeof styleBindingSchema>;
export const nativeStyleSettingSchema = z.object({
  controlId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(160), value: z.unknown(),
  minWidth: z.number().int().min(1).max(10000), maxWidth: z.number().int().min(1).max(10000),
  sourceFactIds: z.array(z.string().min(1).max(240)).min(1).max(100), reason: z.string().trim().min(1).max(2000),
  repeaterPath: z.array(z.object({ controlId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(160), itemId: z.string().min(1).max(100) }).strict()).min(1).max(8).optional(),
}).strict().refine(value => value.value !== undefined && value.minWidth <= value.maxWidth);
export type Native44StyleSetting = z.infer<typeof nativeStyleSettingSchema>;
export interface StyleRequirement extends Native44StyleBinding { componentKey: string; values: Record<string, string>; snapshotId: string }
export interface StyleResolutionReceipt {
  componentKey: string; sourceFactId: string; selector: string; property: string; minWidth: number; maxWidth: number;
  action: 'native-setting' | 'scoped-css' | 'unresolved'; controlId?: string; value?: unknown; reason: string;
  settingPath?: string; generatedEffects?: Array<{ selector: string; property: string; value: string }>; prerequisiteSettings?: string[];
}
const safeProperties = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'text-align', 'white-space', 'word-break', 'overflow-wrap', 'object-fit', 'object-position', 'aspect-ratio', 'border-radius', 'box-shadow', 'text-shadow', 'box-sizing', 'width', 'min-width', 'max-width', 'min-height', 'height', 'max-height', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self', 'order', 'row-gap', 'column-gap', ...['top', 'right', 'bottom', 'left'].flatMap(side => [`margin-${side}`, `padding-${side}`, `border-${side}-width`, `border-${side}-color`, `border-${side}-style`])]);
const normal = (selector: string) => css.generate(css.parse(selector, { context: 'selector' }));
export function nativeStyleTargetSelector(selector: string): string {
  const ast = css.parse(selector, { context: 'selector' });
  if (ast.type !== 'Selector') return css.generate(ast);
  const seen = new Set<string>();
  ast.children.forEach((node, item, list) => {
    if (node.type === 'Combinator') seen.clear();
    if (node.type !== 'ClassSelector') return;
    if (seen.has(node.name)) list.remove(item); else seen.add(node.name);
  });
  return css.generate(ast);
}
function suffix(selector: string): string {
  if (!selector) return '';
  if (/[,{};<>\u0000]/.test(selector) || !/^(?:\s|[.:\[])/.test(selector)) throw Error('native44_style_selector_invalid');
  const ast = css.parse(`.owner${selector}`, { context: 'selector' });
  css.walk(ast, node => {
    if (node.type === 'Raw' || node.type === 'IdSelector' || node.type === 'NestingSelector' || node.type === 'Combinator' && ['+', '~'].includes(node.name) || node.type === 'PseudoClassSelector' && ['has', 'global', 'root'].includes(node.name)) throw Error('native44_style_selector_escape');
  });
  return selector;
}
const valuesOf = (node: Native44Component) => node.kind === 'composite' ? node.settings ??= {} : 'widgetSettings' in node ? node.widgetSettings : node.settings ??= {};
const typeOf = (node: Native44Component) => node.kind === 'composite' ? 'container' : 'widgetType' in node ? node.widgetType : 'html';
export function collectStyleRequirements(program: Native44Program, source: SourceFactsV2) {
  const requirements: StyleRequirement[] = [], unresolved: StyleResolutionReceipt[] = [];
  for (const node of walkNative44(program.blocks)) {
    if (!node.styleBindings?.length) {
      unresolved.push({ componentKey: node.key, sourceFactId: '', selector: '', property: '*', minWidth: 1, maxWidth: 10000, action: 'unresolved', reason: 'source-to-rendered-subpart-binding-missing' });
      continue;
    }
    for (const input of node.styleBindings) {
      const binding = styleBindingSchema.parse(input); suffix(binding.selector);
      const fact = source.facts[binding.sourceFactId], snapshot = source.snapshots.find(item => item.id === fact?.snapshotId);
      if (!fact || !snapshot || !node.sourceFactIds?.includes(fact.id) || binding.minWidth > binding.maxWidth || snapshot.viewport.width < binding.minWidth || snapshot.viewport.width > binding.maxWidth || new Set(binding.properties).size !== binding.properties.length) throw Error('native44_style_source_binding_invalid');
      const style = fact.value.style as Record<string, unknown> | undefined;
      const layout = (fact.kind === 'layout' ? fact.value : fact.value.layout) as Record<string, unknown> | undefined;
      const values: Record<string, string> = {};
      for (const property of binding.properties) {
        let observed = style?.[property];
        const edge = property.match(/^(padding|margin)-(top|right|bottom|left)$/);
        if (observed === undefined && edge && Array.isArray(layout?.[edge[1]])) {
          const amount = (layout[edge[1]] as unknown[])[['top', 'right', 'bottom', 'left'].indexOf(edge[2])];
          if (typeof amount === 'number' && Number.isFinite(amount)) observed = `${amount}px`;
        }
        const additional = program.styleResolutionVersion === 2 && ['fill', 'stroke', 'stroke-width', 'background-image', 'border-style', 'border-width', 'border-color', 'gap'].includes(property);
        if (!safeProperties.has(property) && !additional || typeof observed !== 'string') {
          unresolved.push({ componentKey: node.key, ...binding, property, action: 'unresolved', reason: 'source-property-or-safe-adapter-unavailable' });
          continue;
        }
        const value = observed;
        const ast = css.parse(value, { context: 'value' });
        let unsafe = /[{};<>\u0000]|!important/i.test(value);
        css.walk(ast, child => { if (child.type === 'Raw' || child.type === 'Url' || child.type === 'Function' && /^(url|image-set|expression|var)$/i.test(child.name)) unsafe = true; });
        if (unsafe) throw Error('native44_style_value_unsafe');
        values[property] = value;
      }
      requirements.push({ ...binding, componentKey: node.key, snapshotId: snapshot.id, values });
    }
  }
  return { requirements, unresolved };
}
function selectors(control: LegacySchema['controls'][string]): Record<string, string> {
  return control.selectors && typeof control.selectors === 'object' && !Array.isArray(control.selectors) ? Object.fromEntries(Object.entries(control.selectors).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
}
export function nativeStyleEffects(schema: LegacySchema) {
  return Object.entries(schema.controls).flatMap(([controlId, control]) => Object.entries(selectors(control)).flatMap(([selector, declarations]) => declarations.split(';').flatMap(declaration => {
    const match = declaration.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/);
    return match ? [{ controlId, selector, property: match[1], template: match[2], defaultValue: control.default, responsive: Boolean(control.responsive), condition: control.condition ?? control.conditions ?? null }] : [];
  })));
}
export function planNative44Styles(program: Native44Program, source: SourceFactsV2, knowledge: Native44Knowledge, options: { capabilities?: Native44StyleCapabilities } = {}) {
  const collected = collectStyleRequirements(program, source);
  if (program.styleResolutionVersion === 2) {
    const catalog = options.capabilities ?? buildNative44StyleCapabilities(knowledge);
    const usedTypes = [...new Set(walkNative44(program.blocks).map(typeOf))];
    return { version: 2, kind: 'native44-style-production-plan', knowledgeFingerprint: knowledge.index.fingerprint, targetRegistrationVerified: false, renderedVerified: false, requirements: collected.requirements, unresolved: collected.unresolved,
      components: walkNative44(program.blocks).map(node => ({ componentKey: node.key, widgetType: typeOf(node) })),
      effectCatalog: Object.fromEntries(usedTypes.map(type => [type, catalog.components[type]])),
      controls: Object.fromEntries([...new Set(usedTypes.flatMap(type => catalog.components[type]?.controlRefs ?? []))].map(ref => [ref, catalog.controls[ref]])),
      variableConsumers: catalog.variableConsumers,
      wrapperClassesByType: Object.fromEntries(usedTypes.map(type => [type, catalog.wrapperClassesByType[type] ?? []])),
      nativeSettingPlans: walkNative44(program.blocks).flatMap(node => (node.nativeStyleSettings ?? []).map(setting => ({ componentKey: node.key, ...setting }))),
    };
  }
  return {
    version: 1, kind: 'native44-style-production-plan', knowledgeFingerprint: knowledge.index.fingerprint,
    targetRegistrationVerified: false, renderedVerified: false,
    requirements: collected.requirements, unresolved: collected.unresolved,
    components: walkNative44(program.blocks).map(node => {
      const type = typeOf(node); assertAllowedWidget(type);
      return { componentKey: node.key, widgetType: type, effects: (knowledge.components[type]?.controls ?? []).flatMap(control => {
        const targets = control.effectTargets as { selectors?: unknown; prefixClass?: unknown } | null;
        return targets?.selectors || targets?.prefixClass ? [Object.fromEntries(Object.entries({ controlId: control.id, defaultValue: control.defaultValue, responsiveDefaults: control.responsiveDefaults, condition: control.condition, targets, sourceEvidence: control.sourceEvidence }).filter(([, value]) => value !== undefined))] : [];
      }) };
    }),
  };
}
function candidateValue(control: LegacySchema['controls'][string], template: string, value: string): unknown {
  if (control.selectors_dictionary) return undefined;
  if (template === '{{VALUE}}' && ['color', 'text', 'select', 'number', 'font'].includes(control.type)) return control.type === 'number' ? Number.isFinite(Number(value)) ? Number(value) : undefined : value;
  if (template === '{{SIZE}}{{UNIT}}' && control.type === 'slider') {
    const match = value.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|vh|vw)$/);
    if (match) return { size: Number(match[1]), unit: match[2] };
  }
  return undefined;
}
function dimensionsValue(control: LegacySchema['controls'][string], template: string, property: string, values: Record<string, string>): unknown {
  const edge = property.match(/^(padding|margin)-(top|right|bottom|left)$/);
  if (control.type !== 'dimensions' || !edge || template !== '{{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}}') return undefined;
  const result: Record<string, unknown> = { unit: 'px', isLinked: false };
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const match = values[`${edge[1]}-${side}`]?.match(/^(-?(?:\d+\.?\d*|\.\d+))px$/);
    if (!match) return undefined;
    result[side] = match[1];
  }
  return result;
}
export function nativeStyleValue(template: string, value: unknown): string | undefined {
  if (template === '{{VALUE}}' && ['string', 'number'].includes(typeof value)) return String(value);
  if (template === '{{SIZE}}{{UNIT}}' && value && typeof value === 'object' && 'size' in value && 'unit' in value) return `${value.size}${value.unit}`;
  return undefined;
}
export function resolveNative44Styles(input: { program: Native44Program; source: SourceFactsV2; schemas: Record<string, LegacySchema>; knowledge: Native44CompileOptions['knowledge']; css: string; mobileMaxWidth?: number }) {
  if (input.program.styleResolutionVersion === 2) return resolveNative44StylesV2(input);
  const program = structuredClone(input.program);
  if (program.styleResolutionVersion !== 1) return { program, css: input.css, receipts: [] as StyleResolutionReceipt[], renderedVerified: false as const };
  const collected = collectStyleRequirements(program, input.source), receipts = [...collected.unresolved];
  const nodes = new Map(walkNative44(program.blocks).map(node => [node.key, node]));
  const desired = new Map<string, { requirement: StyleRequirement; property: string; value: string }>();
  const effectGroups = new Map<string, Array<{ requirement: StyleRequirement; value: string }>>();
  for (const requirement of collected.requirements) for (const [property, value] of Object.entries(requirement.values)) {
    if (desired.size >= 50000) throw Error('native44_style_effect_budget');
    const key = JSON.stringify([requirement.componentKey, normal(`.owner${requirement.selector}`), requirement.minWidth, requirement.maxWidth, property]);
    const groupKey = JSON.stringify([requirement.componentKey, normal(`.owner${requirement.selector}`), property]), group = effectGroups.get(groupKey) ?? [];
    for (const previous of group) if (Math.max(previous.requirement.minWidth, requirement.minWidth) <= Math.min(previous.requirement.maxWidth, requirement.maxWidth) && previous.value !== value) throw Error('native44_style_conflicting_source_requirements');
    group.push({ requirement, value }); effectGroups.set(groupKey, group);
    desired.set(key, { requirement, property, value });
  }
  const ast = css.parse(input.css), additions: string[] = [];
  for (const { requirement, property, value } of desired.values()) {
    const node = nodes.get(requirement.componentKey)!, type = typeOf(node); assertAllowedWidget(type);
    const schema = input.schemas[type], settings = valuesOf(node), moduleSelector = `.${native44ModuleClass(node.key)}${requirement.selector}`;
    const target = nativeStyleTargetSelector(moduleSelector), media = `(min-width:${requirement.minWidth}px) and (max-width:${requirement.maxWidth}px)`;
    const mobile = requirement.minWidth === 1 && requirement.maxWidth === input.mobileMaxWidth;
    const desktop = requirement.minWidth === (input.mobileMaxWidth ?? 0) + 1 && requirement.maxWidth === 10000;
    const candidates = schema && (desktop || mobile) ? nativeStyleEffects(schema).filter(effect => {
      if (effect.property !== property && !(property.startsWith(effect.property + '-') && dimensionsValue(schema.controls[effect.controlId], effect.template, property, requirement.values)) || !effect.selector.includes('{{WRAPPER}}') || effect.selector.includes(',')) return false;
      try { return nativeStyleTargetSelector(effect.selector.replaceAll('{{WRAPPER}}', `.${native44ModuleClass(node.key)}`)) === target && (mobile ? effect.controlId.endsWith('_mobile') : !/_(mobile|tablet)$/.test(effect.controlId)); } catch { return false; }
    }) : [];
    let assigned: { id: string; value: unknown } | undefined;
    if (candidates.length === 1) {
      const effect = candidates[0], control = schema.controls[effect.controlId], next = dimensionsValue(control, effect.template, property, requirement.values) ?? candidateValue(control, effect.template, value);
      const siblingEffects = nativeStyleEffects(schema).filter(item => item.controlId === effect.controlId);
      if (next !== undefined && siblingEffects.length === 1 && input.knowledge.controlsByWidget[type]?.has(effect.controlId)) {
        const trial = { ...settings, [effect.controlId]: next };
        try {
          const solved = input.knowledge.validateSettings?.(type, trial);
          const resolvedValue = solved?.[effect.controlId], edge = property.match(/^(padding|margin)-(top|right|bottom|left)$/);
          const actualValue = control.type === 'dimensions' && edge && resolvedValue && typeof resolvedValue === 'object' ? `${(resolvedValue as Record<string, unknown>)[edge[2]]}${(resolvedValue as Record<string, unknown>).unit}` : nativeStyleValue(effect.template, resolvedValue);
          if (solved && Object.hasOwn(solved, effect.controlId) && actualValue === value) {
            assigned = { id: effect.controlId, value: next };
          }
        } catch {}
      }
    }
    let unsafeOverlap = false, nativeOverlap = false;
    const removals: Array<() => void> = [];
    css.walk(ast, { visit: 'Rule', enter(rule) {
      if (rule.prelude.type !== 'SelectorList') return;
      const texts = rule.prelude.children.toArray().map(selector => css.generate(selector));
      const exact = texts.length === 1 && nativeStyleTargetSelector(texts[0]) === nativeStyleTargetSelector(`:page ${moduleSelector}`);
      const overlap = texts.some(text => text.includes(`.${native44ModuleClass(node.key)}`));
      if (!overlap) return;
      const ancestors = this.atrule;
      if (ancestors?.name === 'media' && ancestors.prelude) {
        const condition = css.generate(ancestors.prelude);
        const low = condition.match(/min-width:\s*(\d+)px/), high = condition.match(/max-width:\s*(\d+)px/);
        if (!condition.includes(',') && (low && Number(low[1]) > requirement.maxWidth || high && Number(high[1]) < requirement.minWidth)) return;
      }
      const sameScope = requirement.minWidth === 1 && requirement.maxWidth === 10000 ? !ancestors : ancestors?.name === 'media' && ancestors.prelude && css.generate(ancestors.prelude) === css.generate(css.parse(media, { context: 'mediaQueryList' }));
      rule.block.children.forEach((declaration, item, list) => {
        if (declaration.type !== 'Declaration') return;
        const shorthand = ['margin', 'padding', 'border', 'background', 'font', 'flex', 'gap'].some(name => declaration.property === name && (property.startsWith(name + '-') || name === 'gap' && /-gap$/.test(property)));
        if (declaration.property !== property && !shorthand) return;
        if (exact && sameScope && !shorthand) removals.push(() => list.remove(item));
        else if (exact && declaration.important || exact && shorthand) unsafeOverlap = true;
        else if (exact) nativeOverlap = true;
      });
    } });
    if (unsafeOverlap) {
      receipts.push({ ...requirement, property, action: 'unresolved', reason: 'existing-important-or-shorthand-needs-explicit-ownership' });
      continue;
    }
    if (nativeOverlap) assigned = undefined;
    for (const remove of removals) remove();
    if (assigned) {
      const solved = input.knowledge.validateSettings!(type, { ...settings, [assigned.id]: assigned.value });
      Object.assign(settings, solved);
      receipts.push({ ...requirement, property, action: 'native-setting', controlId: assigned.id, value: assigned.value, reason: 'unique-registered-subpart-effect-and-active-validated-value' });
    }
    else {
      const owner = `.${native44ModuleClass(node.key)}`;
      additions.push(`@media ${media}{:page ${owner}${owner}${owner}${requirement.selector}{${property}:${value}}}`);
      receipts.push({ ...requirement, property, action: 'scoped-css', value, reason: 'no-unambiguous-single-effect-native-control-use-exact-page-subpart' });
    }
  }
  return { program, css: css.generate(ast) + additions.join(''), receipts, renderedVerified: false as const };
}

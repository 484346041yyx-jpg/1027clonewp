import * as css from 'css-tree';
import type { ControlInfo, LegacySchema } from '../wordpress/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import { native44ModuleClass } from './adapters.js';
import { assertKnownNativeWidget as assertAllowedWidget } from './catalog.js';
import type { Native44Control } from './knowledge.js';
import { expandedNative44Controls, evaluateNative44Condition } from './settings.js';
import { classifyNative44StyleControl, native44StyleConditionFields, native44StyleTemplateFields, type Native44StyleVariableConsumer } from './style-capabilities.js';
import { equalNativeStyleValue, expandNativeStyleDeclaration, inferNativeStyleValue, nativeStyleControlEffects, nativeStyleRegisteredControl, safeNativeStyleSettingValue, satisfyNativeStyleConditions, type NativeStyleDeclaration } from './native-style-effects.js';
import { collectStyleRequirements, nativeStyleSettingSchema, nativeStyleTargetSelector, type Native44StyleSetting, type StyleRequirement, type StyleResolutionReceipt } from './style-resolution.js';
import { native44Children, walkNative44, type Native44Component, type Native44CompileOptions, type Native44Program } from './types.js';
import { compactAdjacentNativeStyleCSS } from './style-css-compact.js';

type Input = { program: Native44Program; source: SourceFactsV2; schemas: Record<string, LegacySchema>; knowledge: Native44CompileOptions['knowledge']; css: string; mobileMaxWidth?: number };
type Range = { minWidth: number; maxWidth: number };
type Desired = { requirement: StyleRequirement; property: string; value: string; target: string };
type Template = { selector: string; property: string; value: string };
type Model = { schema: LegacySchema; definitions: Native44Control[]; controls: Map<string, Native44Control>; eligible: Set<string>; templates: Map<string, Template[]> };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const settingsOf = (node: Native44Component) => node.kind === 'composite' ? node.settings ??= {} : 'widgetSettings' in node ? node.widgetSettings : node.settings ??= {};
const typeOf = (node: Native44Component) => node.kind === 'composite' ? 'container' : 'widgetType' in node ? node.widgetType : 'html';
const overlaps = (left: Range, right: Range) => Math.max(left.minWidth, right.minWidth) <= Math.min(left.maxWidth, right.maxWidth);
const deviceSuffix = /_(?:widescreen|laptop|tablet_extra|tablet|mobile_extra|mobile)$/;
const forbidden = /^(?:_?css_classes|_?element_id|_?custom_attributes|custom_css|html|hide_(?:desktop|tablet|mobile))$/;
const owner = (key: string) => `.${native44ModuleClass(key)}`;
function target(selector: string, key: string, itemId?: string): string | undefined {
  if (!selector.includes('{{WRAPPER}}') || /{{CURRENT_ITEM}}/.test(selector) && !itemId) return undefined;
  try {
    return nativeStyleTargetSelector(selector.replaceAll('{{WRAPPER}}', owner(key)).replaceAll('{{CURRENT_ITEM}}', `.elementor-repeater-item-${itemId}`));
  } catch { return undefined; }
}
function selectorTargets(effect: NativeStyleDeclaration, key: string, itemId?: string): NativeStyleDeclaration[] {
  try {
    const expanded = effect.selector.replaceAll('{{WRAPPER}}', owner(key)).replaceAll('{{CURRENT_ITEM}}', `.elementor-repeater-item-${itemId}`);
    if (!effect.selector.includes('{{WRAPPER}}') || expanded.includes('{{')) return [];
    const ast = css.parse(expanded, { context: 'selectorList' });
    if (ast.type !== 'SelectorList') return [];
    return ast.children.toArray().map(selector => ({ ...effect, selector: nativeStyleTargetSelector(css.generate(selector)) }));
  } catch { return []; }
}
function modelFor(input: Input, type: string): Model | undefined {
  const live = input.schemas[type], definitions = input.knowledge.styleControlsByWidget?.[type];
  if (!live || !definitions) return undefined;
  const controls = expandedNative44Controls(definitions), eligible = new Set<string>();
  const schema = { ...live, controls: { ...live.controls } };
  for (const [name, control] of controls) {
    if (!input.knowledge.controlsByWidget[type]?.has(name) || !live.controls[name]) continue;
    const drivesControls = definitions.filter(candidate => native44StyleConditionFields(candidate.condition).some(field => field.scope === 'component' && field.field === name)).map(candidate => candidate.id);
    const templateDrivesControls = definitions.filter(candidate => native44StyleTemplateFields(candidate).some(field => field.scope === 'component' && field.field === name)).map(candidate => candidate.id);
    if (classifyNative44StyleControl(control, { drivesControls, templateDrivesControls }).nativeStyleEligible && !forbidden.test(name)) eligible.add(name);
    schema.controls[name] = nativeStyleRegisteredControl(control, live.controls[name]);
  }
  return { schema, definitions, controls, eligible, templates: controlTemplates(schema, eligible) };
}
function controlTemplates(schema: LegacySchema, eligible: Set<string>): Map<string, Template[]> {
  return new Map([...eligible].map(name => [name, Object.entries(record(schema.controls[name].selectors)).flatMap(([selector, raw]) => typeof raw !== 'string' ? [] : raw.split(';').flatMap(declaration => {
    const match = declaration.match(/^\s*((?:--[\w-]+)|(?:[a-z][\w-]*))\s*:\s*([\s\S]+?)\s*$/);
    return match ? [{ selector, property: match[1], value: match[2] }] : [];
  }))]));
}
function deviceAllows(controlId: string, model: Model, range: Range, mobileMaxWidth: number, phoneOnly: boolean): boolean {
  const original = model.definitions.find(control => control.id === controlId);
  const live = model.schema.controls[controlId];
  if (!live) return false;
  if (range.minWidth === 1 && range.maxWidth === 10000) return !deviceSuffix.test(controlId) || Boolean(original && !original.responsive);
  if (range.minWidth === mobileMaxWidth + 1 && range.maxWidth === 10000) return !deviceSuffix.test(controlId) || Boolean(original && !original.responsive);
  if (range.minWidth !== 1 || range.maxWidth !== mobileMaxWidth) return false;
  if (phoneOnly && original && !deviceSuffix.test(controlId)) return true;
  if (!controlId.endsWith('_mobile')) return Boolean(phoneOnly && original && !original.responsive);
  if (original && !original.responsive) return phoneOnly;
  const base = model.definitions.find(control => control.id === controlId.slice(0, -7));
  return Boolean(base?.responsive && (!base.devices?.length || base.devices.includes('mobile')) && base.type === live.type && (!record(live.responsive).max || record(live.responsive).max === 'mobile'));
}
function phoneBranches(program: Native44Program): Set<string> {
  const result = new Set<string>();
  const visit = (node: Native44Component, inherited: boolean) => {
    const values = settingsOf(node), phone = inherited || values.hide_desktop === 'hidden-desktop' && values.hide_tablet === 'hidden-tablet';
    if (phone) result.add(node.key);
    native44Children(node).forEach(child => visit(child, phone));
  };
  program.blocks.forEach(node => visit(node, false)); return result;
}
function plainEffects(model: Model, name: string, values: Record<string, unknown>, key: string, itemId?: string): NativeStyleDeclaration[] {
  return nativeStyleControlEffects(model.schema, name, values).flatMap(effect => selectorTargets(effect, key, itemId)).flatMap(expandNativeStyleDeclaration);
}
function mediaRange(text: string): Range | undefined {
  if (/[,]|\b(?:not|or|print|landscape|portrait)\b|[<>]/i.test(text)) return undefined;
  const stripped = text.replace(/\(\s*(?:min|max)-width\s*:\s*[\d.]+px\s*\)/gi, '').replace(/\b(?:and|screen|all)\b/gi, '').replace(/\s/g, '');
  if (stripped) return undefined;
  const lows = [...text.matchAll(/min-width\s*:\s*([\d.]+)px/gi)].map(match => Number(match[1]));
  const highs = [...text.matchAll(/max-width\s*:\s*([\d.]+)px/gi)].map(match => Number(match[1]));
  return { minWidth: Math.max(1, ...lows), maxWidth: Math.min(10000, ...highs) };
}
function cssOwnership(ast: css.CssNode, key: string, effects: NativeStyleDeclaration[], range: Range): { safe: boolean; remove: () => void } {
  const changes: Array<() => void> = [], stack: Array<Range | undefined> = [{ minWidth: 1, maxWidth: 10000 }]; let safe = true;
  const moduleOwner = owner(key);
  const expected = new Map(effects.map(effect => [JSON.stringify([effect.selector, effect.property]), effect.value]));
  css.walk(ast, {
    enter(node: css.CssNode) {
      if (node.type === 'Atrule') {
        const parent = stack[stack.length - 1], current = node.name === 'media' && node.prelude ? mediaRange(css.generate(node.prelude)) : undefined;
        stack.push(parent && current ? { minWidth: Math.max(parent.minWidth, current.minWidth), maxWidth: Math.min(parent.maxWidth, current.maxWidth) } : undefined);
      }
      if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
      const scope = stack[stack.length - 1]; if (scope && !overlaps(scope, range)) return;
      const selectors = node.prelude.children.toArray().map(selector => css.generate(selector));
      for (const selector of selectors) {
        if (!selector.includes(moduleOwner)) continue;
        let normalized: string;
        try { normalized = nativeStyleTargetSelector(selector.replace(/^:page\s+/, '')); } catch { safe = false; continue; }
        node.block.children.forEach((declaration, item, list) => {
          if (declaration.type !== 'Declaration') return;
          const expanded = expandNativeStyleDeclaration({ selector: normalized, property: declaration.property, value: css.generate(declaration.value) });
          const related = expanded.some(effect => expected.has(JSON.stringify([effect.selector, effect.property]))) || effects.some(effect => effect.selector === normalized && ['background', 'border', 'font', 'flex', 'gap', 'all'].some(name => declaration.property === name && (name === 'all' || effect.property.startsWith(name + '-') || name === 'gap' && /-gap$/.test(effect.property))));
          if (!related) return;
          const exact = selector.startsWith(':page ') && selectors.length === 1 && scope && scope.minWidth === range.minWidth && scope.maxWidth === range.maxWidth && expanded.every(effect => expected.has(JSON.stringify([effect.selector, effect.property])));
          if (exact) changes.push(() => list.remove(item));
          else if (declaration.important || expanded.some(effect => !equalNativeStyleValue(effect.property, expected.get(JSON.stringify([effect.selector, effect.property])) ?? '', effect.value))) safe = false;
        });
      }
    },
    leave(node: css.CssNode) { if (node.type === 'Atrule') stack.pop(); },
  });
  return { safe, remove: () => { for (const change of new Set(changes)) change(); } };
}
function variableEffects(input: Input, consumers: Map<string, Native44StyleVariableConsumer[]>, effect: NativeStyleDeclaration, type: string, key: string, range: Range): NativeStyleDeclaration[] {
  if (!effect.property.startsWith('--')) return [effect];
  return (consumers.get(effect.property) ?? []).flatMap(consumer => {
    if (consumer.variable !== effect.property || !consumer.direct || /(?:editor|rtl)/i.test(consumer.entry)) return [];
    const ranges = consumer.atRules.map(text => text.startsWith('@media') ? mediaRange(text.replace(/^@media\s*/, '')) : undefined);
    if (ranges.some(item => !item || item.minWidth > range.minWidth || item.maxWidth < range.maxWidth)) return [];
    const declaration = { selector: consumer.selector, property: consumer.property, value: effect.value };
    let template = declaration.selector;
    if (!template.includes('{{WRAPPER}}')) {
      const proven = input.knowledge.styleWrapperClassesByWidget?.[type] ?? [];
      const found = proven.find(proof => /^[A-Za-z_][\w-]*$/.test(proof.className) && template.startsWith(`.${proof.className}`) && !/[\w-]/.test(template[proof.className.length + 1] ?? ' '));
      if (!found) return [];
      template = '{{WRAPPER}}' + template.slice(found.className.length + 1);
    }
    const rendered = target(template, key);
    if (!rendered || !rendered.startsWith(effect.selector) || effect.selector !== owner(key) && rendered !== effect.selector) return [];
    return expandNativeStyleDeclaration({ ...declaration, selector: rendered });
  });
}
function validate(input: Input, type: string, trial: Record<string, unknown>, assignments: Record<string, unknown>): Record<string, unknown> | undefined {
  try {
    const solved = input.knowledge.validateSettings?.(type, trial);
    return solved && Object.entries(assignments).every(([name, value]) => Object.hasOwn(solved, name) && same(solved[name], value)) ? solved : undefined;
  } catch { return undefined; }
}
function sourceOwned(input: Input, node: Native44Component, plan: Native44StyleSetting): boolean {
  return plan.sourceFactIds.every(id => {
    const fact = input.source.facts[id], snapshot = input.source.snapshots.find(item => item.id === fact?.snapshotId);
    return fact && node.sourceFactIds?.includes(id) && snapshot && snapshot.viewport.width >= plan.minWidth && snapshot.viewport.width <= plan.maxWidth;
  });
}
function itemContext(model: Model, values: Record<string, unknown>, plan: Native44StyleSetting): { model: Model; values: Record<string, unknown>; itemId?: string } | undefined {
  let current = model, local = values, itemId: string | undefined;
  for (const step of plan.repeaterPath ?? []) {
    const definition = current.controls.get(step.controlId), live = current.schema.controls[step.controlId];
    const rows = local[step.controlId], fields = live?.fields;
    if (!definition?.repeater || !Array.isArray(rows)) return undefined;
    const identity = definition.repeater.itemIdentityField ?? '_id';
    const matches = rows.filter(row => record(row)[identity] === step.itemId);
    if (matches.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(step.itemId)) return undefined;
    const registered = Array.isArray(fields) ? Object.fromEntries(fields.map(field => [record(field).name, field])) : record(fields);
    const definitions = definition.repeater.fields, controls = expandedNative44Controls(definitions), schema = { ...current.schema, controls: registered as Record<string, ControlInfo> };
    const eligible = new Set<string>();
    for (const [name, control] of controls) if (registered[name]) {
      schema.controls[name] = nativeStyleRegisteredControl(control, registered[name]);
      const drivesControls = definitions.filter(candidate => native44StyleConditionFields(candidate.condition).some(field => field.field === name)).map(candidate => candidate.id);
      const templateDrivesControls = definitions.filter(candidate => native44StyleTemplateFields(candidate).some(field => field.field === name)).map(candidate => candidate.id);
      if (classifyNative44StyleControl(control, { drivesControls, templateDrivesControls }).nativeStyleEligible && !forbidden.test(name)) eligible.add(name);
    }
    current = { schema, definitions, controls, eligible, templates: controlTemplates(schema, eligible) }; local = matches[0]; itemId = step.itemId;
  }
  return { model: current, values: local, itemId };
}
export function resolveNative44StylesV2(input: Input) {
  const program = structuredClone(input.program), collected = collectStyleRequirements(program, input.source), receipts = [...collected.unresolved];
  const ast = css.parse(input.css), additions: string[] = [], mobileMaxWidth = input.mobileMaxWidth ?? 768;
  const nodes = new Map(walkNative44(program.blocks).map(node => [node.key, node])), phoneOnly = phoneBranches(program);
  const models = new Map<string, Model | undefined>(), desired: Desired[] = [], explicit = new Map<string, Set<string>>(), rejectedPlans = new Set<string>();
  const groups = new Map<string, Desired[]>();
  const consumers = new Map<string, Native44StyleVariableConsumer[]>(), variableCache = new Map<string, NativeStyleDeclaration[]>();
  for (const consumer of input.knowledge.styleVariableConsumers ?? []) { const list = consumers.get(consumer.variable) ?? []; list.push(consumer); consumers.set(consumer.variable, list); }
  const variable = (effect: NativeStyleDeclaration, type: string, key: string, range: Range) => {
    if (!effect.property.startsWith('--')) return [effect];
    const identity = JSON.stringify([type, key, range.minWidth, range.maxWidth, effect.selector, effect.property, effect.value]);
    if (!variableCache.has(identity)) variableCache.set(identity, variableEffects(input, consumers, effect, type, key, range));
    return variableCache.get(identity)!;
  };
  const allowedCache = new Map<Model, Map<string, string[]>>(), targetCache = new Map<Model, Map<string, Array<Template & { targets: NativeStyleDeclaration[] }>>>();
  const allowed = (model: Model, range: Range, phone: boolean) => {
    if (!allowedCache.has(model)) allowedCache.set(model, new Map());
    const cache = allowedCache.get(model)!, identity = JSON.stringify([range.minWidth, range.maxWidth, phone]);
    if (!cache.has(identity)) cache.set(identity, [...model.eligible].filter(name => deviceAllows(name, model, range, mobileMaxWidth, phone)));
    return cache.get(identity)!;
  };
  const templates = (model: Model, name: string, key: string) => {
    if (!targetCache.has(model)) targetCache.set(model, new Map());
    const cache = targetCache.get(model)!, identity = JSON.stringify([name, key]);
    if (!cache.has(identity)) cache.set(identity, (model.templates.get(name) ?? []).map(template => ({ ...template, targets: selectorTargets({ ...template, value: '0' }, key) })));
    return cache.get(identity)!;
  };
  for (const requirement of collected.requirements) for (const [property, value] of Object.entries(requirement.values)) {
    const rendered = nativeStyleTargetSelector(`${owner(requirement.componentKey)}${requirement.selector}`);
    if (desired.length >= 50000) throw Error('native44_style_effect_budget');
    const groupKey = JSON.stringify([requirement.componentKey, rendered, property]), group = groups.get(groupKey) ?? [];
    if (group.some(previous => overlaps(previous.requirement, requirement) && !equalNativeStyleValue(property, previous.value, value))) throw Error('native44_style_conflicting_source_requirements');
    const item = { requirement, property, value, target: rendered }; desired.push(item); group.push(item); groups.set(groupKey, group);
  }
  const getModel = (type: string) => { if (!models.has(type)) models.set(type, modelFor(input, type)); return models.get(type); };
  for (const node of nodes.values()) {
    const type = typeOf(node); assertAllowedWidget(type);
    const model = getModel(type), plans = node.nativeStyleSettings ?? []; if (!plans.length) continue;
    const next = structuredClone(settingsOf(node)), records: StyleResolutionReceipt[] = [], cleanups: Array<{ effects: NativeStyleDeclaration[]; range: Range }> = [], changed = new Set<string>();
    try {
      if (!model) throw Error('researched-and-live-control-model-missing');
      for (const raw of plans) {
        const plan = nativeStyleSettingSchema.parse(raw);
        if (!sourceOwned(input, node, plan)) throw Error('native-setting-source-ownership-or-viewport');
        if (!safeNativeStyleSettingValue(plan.value)) throw Error('native-setting-value-has-unsafe-css-or-resource-syntax');
        const context = itemContext(model, next, plan), name = plan.controlId;
        if (!context || !context.model.eligible.has(name) || !deviceAllows(name, context.model, plan, mobileMaxWidth, phoneOnly.has(node.key))) throw Error('native-setting-not-eligible-or-device-not-registered');
        const path = [...(plan.repeaterPath ?? []).map(step => `${step.controlId}[${step.itemId}]`), name].join('.');
        if (changed.has(path) && !same(context.values[name], plan.value)) throw Error('native-setting-plan-conflict');
        context.values[name] = structuredClone(plan.value); changed.add(path);
      }
      for (const plan of plans) {
        const context = itemContext(model, next, plan)!, definition = context.model.controls.get(plan.controlId)!;
        const defaults = Object.fromEntries(context.model.definitions.filter(control => control.defaultValue !== undefined && !['task-resource-required', 'task-content-required'].includes(control.defaultPolicy ?? '')).map(control => [control.id, control.defaultValue]));
        if (!evaluateNative44Condition(definition.condition, { ...defaults, ...next }, { ...defaults, ...context.values }, definition.scope ?? 'component')) throw Error('native-setting-condition-inactive');
        const effects = plainEffects(context.model, plan.controlId, context.values, node.key, context.itemId);
        const targets = record(definition.effectTargets), cleared = plan.value === '' || record(plan.value).size === '';
        if (Object.keys(record(targets.selectors)).length && !effects.length && !cleared) throw Error('native-setting-selector-effect-not-renderable');
        const cleanup = cssOwnership(ast, node.key, effects, plan); if (!cleanup.safe) throw Error('owned-css-conflicts-with-native-setting');
        cleanups.push({ effects, range: plan });
        records.push({ componentKey: node.key, sourceFactId: plan.sourceFactIds[0], selector: '', property: `setting:${plan.controlId}`, minWidth: plan.minWidth, maxWidth: plan.maxWidth, action: 'native-setting', controlId: plan.controlId, value: plan.value, settingPath: [...(plan.repeaterPath ?? []).map(step => `${step.controlId}[${step.itemId}]`), plan.controlId].join('.'), generatedEffects: effects, reason: effects.length ? 'source-bound-registered-native-plan-render-review-required' : 'source-bound-native-class-or-frontend-or-inheritance-plan-render-review-required' });
      }
      const solved = validate(input, type, next, Object.fromEntries(Object.entries(next).filter(([name]) => plans.some(plan => (plan.repeaterPath?.[0]?.controlId ?? plan.controlId) === name))));
      if (!solved) throw Error('native-setting-normalization-or-registration-rejected');
      Object.assign(settingsOf(node), solved); cleanups.forEach(cleanup => cssOwnership(ast, node.key, cleanup.effects, cleanup.range).remove()); receipts.push(...records); explicit.set(node.key, new Set(plans.filter(plan => !plan.repeaterPath?.length).map(plan => plan.controlId)));
    } catch (error) {
      rejectedPlans.add(node.key);
      receipts.push(...plans.map(plan => ({ componentKey: node.key, sourceFactId: plan.sourceFactIds[0] ?? '', selector: '', property: `setting:${plan.controlId}`, minWidth: plan.minWidth, maxWidth: plan.maxWidth, action: 'unresolved' as const, controlId: plan.controlId, reason: error instanceof Error ? error.message : 'native-setting-plan-rejected' })));
    }
  }
  for (const item of desired) {
    const { requirement, property, value } = item, node = nodes.get(requirement.componentKey)!, type = typeOf(node), model = getModel(type), values = settingsOf(node);
    if (rejectedPlans.has(node.key)) { receipts.push({ ...requirement, property, action: 'unresolved', reason: 'native-setting-plan-rejected-correct-plan-before-css-fallback' }); continue; }
    const candidates: Array<{ name: string; values: Record<string, unknown>; effects: NativeStyleDeclaration[]; prerequisites: string[]; cleanup: () => void }> = [];
    let pendingNative = false, nativeReason = 'no-registered-native-control-for-exact-subpart-state-and-device';
    if (model) for (const name of allowed(model, requirement, phoneOnly.has(node.key))) {
      const definition = model.controls.get(name)!, live = model.schema.controls[name];
      if (explicit.get(node.key)?.has(name)) {
        const rawEffects = plainEffects(model, name, values, node.key), effects = rawEffects.flatMap(effect => variable(effect, type, node.key, requirement));
        if (effects.some(effect => effect.selector === item.target && effect.property === property) || rawEffects.some(effect => effect.property.startsWith('--') && variable(effect, type, node.key, requirement).length === 0)) pendingNative = true;
      }
      for (const template of templates(model, name, node.key)) {
          const related = template.targets.flatMap(effect => variable(effect, type, node.key, requirement)).some(effect => effect.selector === item.target && (effect.property === property || property.startsWith(effect.property + '-')));
          if (!related) continue;
          for (const next of inferNativeStyleValue(live, template.value, value, property, requirement.values)) {
            if (explicit.get(node.key)?.has(name) && !same(next, values[name])) { pendingNative = true; continue; }
            const prerequisites = satisfyNativeStyleConditions(definition, model.definitions, { ...values, [name]: next }); if (!prerequisites) { nativeReason = 'native-control-condition-has-no-safe-unique-driver'; continue; }
            const assignments = Object.fromEntries(Object.entries(prerequisites).filter(([field, setting]) => !same(values[field], setting)));
            if (Object.keys(assignments).some(field => !model.eligible.has(field) || field !== name && deviceSuffix.test(field))) continue;
            const solved = validate(input, type, prerequisites, { ...assignments, [name]: next }); if (!solved) { nativeReason = 'native-value-rejected-by-registered-domain-or-condition'; continue; }
            const changedNames = [...new Set([name, ...Object.keys(assignments)])];
            const inspectNames = changedNames.length > 1 ? [...model.eligible] : changedNames;
            const defaults = Object.fromEntries([...model.controls.values()].filter(control => control.defaultValue !== undefined && !['task-resource-required', 'task-content-required'].includes(control.defaultPolicy ?? '')).map(control => [control.id, control.defaultValue]));
            const effectiveBefore = { ...defaults, ...values }, effectiveAfter = { ...defaults, ...solved };
            const rawAfter = inspectNames.flatMap(field => plainEffects(model, field, effectiveAfter, node.key));
            const effects = rawAfter.flatMap(effect => variable(effect, type, node.key, requirement));
            const relevant = effects.find(effect => effect.selector === item.target && effect.property === property && equalNativeStyleValue(property, effect.value, value));
            if (!relevant) continue;
            const rawBefore = inspectNames.flatMap(field => plainEffects(model, field, effectiveBefore, node.key));
            if (rawAfter.some(effect => effect.property.startsWith('--') && variable(effect, type, node.key, requirement).length === 0 && !rawBefore.some(previous => same(effect, previous)))) { nativeReason = 'native-dependency-changes-unmapped-variable-consumer'; continue; }
            const originalEffects = rawBefore.flatMap(effect => variable(effect, type, node.key, requirement));
            const altered = effects.filter(effect => !originalEffects.some(previous => previous.selector === effect.selector && previous.property === effect.property && equalNativeStyleValue(effect.property, previous.value, effect.value)));
            if (altered.some(effect => !(groups.get(JSON.stringify([node.key, effect.selector, effect.property])) ?? []).some(other => same({ minWidth: other.requirement.minWidth, maxWidth: other.requirement.maxWidth }, { minWidth: requirement.minWidth, maxWidth: requirement.maxWidth }) && equalNativeStyleValue(effect.property, other.value, effect.value)))) { nativeReason = 'native-bundle-has-unobserved-or-conflicting-side-effect'; continue; }
            const cleanup = cssOwnership(ast, node.key, effects, requirement); if (!cleanup.safe) { nativeReason = 'owned-css-needs-explicit-conflict-resolution'; continue; }
            candidates.push({ name, values: solved, effects, prerequisites: Object.keys(assignments).filter(field => field !== name), cleanup: cleanup.remove });
          }
      }
    }
    const unique = [...new Map(candidates.map(candidate => [JSON.stringify([candidate.name, candidate.values]), candidate])).values()];
    if (unique.length === 1) {
      const candidate = unique[0]; Object.assign(values, candidate.values); candidate.cleanup();
      receipts.push({ ...requirement, property, action: 'native-setting', controlId: candidate.name, value: candidate.values[candidate.name], generatedEffects: candidate.effects, prerequisiteSettings: candidate.prerequisites, reason: 'registered-native-forward-effects-match-complete-observed-bundle-render-review-required' }); continue;
    }
    if (pendingNative) { receipts.push({ ...requirement, property, action: 'unresolved', reason: 'explicit-native-plan-retained-do-not-stack-css-before-render-review' }); continue; }
    if (unique.length > 1) nativeReason = 'multiple-native-settings-match-source-requires-explicit-native-plan';
    const cleanup = cssOwnership(ast, node.key, [{ selector: item.target, property, value }], requirement);
    if (!cleanup.safe) { receipts.push({ ...requirement, property, action: 'unresolved', reason: 'owned-css-overlap-or-shorthand-needs-explicit-resolution' }); continue; }
    cleanup.remove();
    additions.push(`@media(min-width:${requirement.minWidth}px) and (max-width:${requirement.maxWidth}px){:page ${owner(node.key)}${owner(node.key)}${owner(node.key)}${requirement.selector}{${property}:${value}}}`);
    receipts.push({ ...requirement, property, action: 'scoped-css', value, reason: nativeReason });
  }
  return { program, css: compactAdjacentNativeStyleCSS(css.generate(ast) + additions.join('')), receipts, renderedVerified: false as const };
}

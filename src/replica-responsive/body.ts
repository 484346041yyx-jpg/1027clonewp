import { createHash } from 'node:crypto';
import * as css from 'css-tree';
import { native44Children, walkNative44, type Native44Program, type Native44Component, type Native44CompileOptions } from '../native44/types.js';
import { native44ModuleClass } from '../native44/adapters.js';
import { compileNative44, preflightNative44 } from '../native44/compiler.js';
import { validateNative44Program } from '../native44/validate.js';
import { responsiveBodyPlanSchema, responsiveFail as fail, type ResponsivePlan } from './contract.js';

import { assertDecisionProgram } from './decisions.js';
import { derivePendingFormsForResponsive } from '../native44/pending-form.js';
import { compileMobileTouchCSS } from './touch.js';
import { nativeStyleEffects, nativeStyleValue, nativeStyleTargetSelector, nativeStyleControlEffects } from '../native44/style-resolution.js';
import { nativeStyleRegisteredControl } from '../native44/native-style-effects.js';
import { createMobileNativeStyleCSSValidator, assertRegisteredMobileSetting, mirrorRegisteredDesktopSettings } from './style-settings.js';
import { assertComponentModelExecutable } from '../native44/component-model.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const visibility = ['hide_desktop', 'hide_tablet', 'hide_mobile'] as const;
// This is an ordinary registered video switch, not an Elementor device suffix.
const nativeMobileName = (type: string, name: string) => type === 'container' && name === 'background_play_on_mobile';
const fieldValues = (node: Native44Component): Record<string, unknown> => node.kind === 'composite' ? node.settings ??= {} : 'widgetSettings' in node ? node.widgetSettings : {};
export const mobileComponentKey = (key: string) => `${key}_phone`;
/** Both presentations share actual content. A duplicate changes native layout,
 * responsive media and order only; it cannot quietly fork copy or queries. */
export function prepareResponsiveBody(base: Native44Program, input: ResponsivePlan, desktopCSS: string): { program: Native44Program; css: string; plan: ResponsivePlan } {
  const plan = responsiveBodyPlanSchema.parse(input), program = structuredClone(base);
  assertComponentModelExecutable(base, plan.sections);
  if (new Set(plan.sections.map(s => s.key)).size !== program.blocks.length || program.blocks.some(b => !plan.sections.some(s => s.key === b.key))) fail('section_coverage');
  for (const node of walkNative44(program.blocks)) for (const [name, value] of Object.entries(fieldValues(node))) {
    if (visibility.includes(name as typeof visibility[number])) fail('unowned_visibility');
    if (name.endsWith('_tablet') && !same(value, fieldValues(node)[name.slice(0, -7)])) fail('tablet_override');
    if (name.endsWith('_mobile') && !nativeMobileName(node.kind === 'composite' ? 'container' : 'widgetType' in node ? node.widgetType : '', name)) fail('mobile_value_outside_plan');
  }
  const blocks: Native44Component[] = [], additions: string[] = [], touchRules: string[] = [];
  for (const section of plan.sections) {
    const original = program.blocks.find(b => b.key === section.key)!;
    if (original.kind !== 'composite') fail('section_container_required');
    const nodes = walkNative44([original]), keys = new Set(nodes.map(n => n.key));
    if (section.visibility?.length) {
      if (section.mode !== 'shared' || new Set(section.visibility.map(v => v.componentKey)).size !== section.visibility.length) fail('visibility_owner');
      const claimed = new Set<string>();
      for (const declaration of section.visibility) {
        const owner = nodes.find(n => n.key === declaration.componentKey);
        if (!owner || owner.kind !== 'composite' || owner === original || !same([...declaration.hideOn].sort(), ['mobile']) && !same([...declaration.hideOn].sort(), ['desktop','tablet'])) fail('visibility_static_branch_required');
        for (const child of walkNative44([owner])) {
          if (claimed.has(child.key) || child.kind !== 'composite' && (child.kind !== 'native' || !['heading','text-editor','wd_text_block','wd_list','wd_image_or_svg','image-box','button','wd_button','nested-accordion'].includes(child.widgetType))) fail('visibility_static_branch_required');
          claimed.add(child.key);
        }
        for (const device of declaration.hideOn) fieldValues(owner)['hide_'+device] = 'hidden-'+device;
      }
    }
    if (section.mode === 'desktop-only' && (section.settings.length || section.childOrders.length || section.css.trim() || section.touch?.length || section.nativeStyleSettings?.length)) fail('hidden_section_has_mobile_settings');
    if (section.settings.some(s => !keys.has(s.componentKey)) || new Set(section.settings.map(s => s.componentKey)).size !== section.settings.length) fail('setting_owner');
    if (section.contentBindings?.some(binding => !keys.has(binding.componentKey)) || new Set(section.contentBindings?.map(binding => `${binding.snapshotId}:${binding.nodeId}`) ?? []).size !== (section.contentBindings?.length ?? 0)) fail('production_content_binding_scope');
    if (section.childOrders.length && section.mode !== 'duplicate') fail('shared_order_requires_native_control');
    if (section.mode === 'duplicate' && nodes.some(n => n.kind !== 'composite' && (n.kind !== 'native' || n.widgetType === 'form' || n.children?.length))) fail('dynamic_duplicate_unsupported');
    const mobile = section.mode === 'duplicate' ? structuredClone(original) : original;
    const targets = new Map(walkNative44([mobile]).map(n => [n.key, n]));
    for (const item of section.styleBindings ?? []) {
      const target = targets.get(item.componentKey);
      if (!target || item.binding.minWidth < 1 || item.binding.maxWidth > plan.mobileMaxWidth) fail('style_binding_scope');
      target.styleBindings = [...(target.styleBindings ?? []), structuredClone(item.binding)];
    }
    for (const item of section.nativeStyleSettings ?? []) {
      const target = targets.get(item.componentKey);
      if (program.styleResolutionVersion !== 2 || !target || item.setting.minWidth < 1 || item.setting.maxWidth > plan.mobileMaxWidth) fail('native_style_setting_scope');
      target.nativeStyleSettings = [...(target.nativeStyleSettings ?? []), structuredClone(item.setting)];
    }
    for (const patch of section.settings) {
      const settings = fieldValues(targets.get(patch.componentKey)!);
      for (const [name, value] of Object.entries(patch.values)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*_mobile$/.test(name) || name === 'hide_mobile' || ['html', 'custom_css'].includes(name.slice(0, -7))) fail('native_mobile_field_required');
        settings[name] = structuredClone(value);
      }
    }
    const ordered = new Set<string>();
    for (const order of section.childOrders) {
      const owner = targets.get(order.componentKey);
      if (ordered.has(order.componentKey) || owner?.kind !== 'composite' || order.children.length !== owner.children.length || new Set(order.children).size !== order.children.length || order.children.some(k => !owner.children.some(n => n.key === k))) fail('child_order');
      ordered.add(order.componentKey); owner.children = order.children.map(k => owner.children.find(n => n.key === k)!);
    }
    const remap = new Map<string, string>();
    if (section.mode === 'desktop-only') fieldValues(original).hide_mobile = 'hidden-mobile';
    if (section.mode === 'phone-only') Object.assign(fieldValues(original), { hide_desktop: 'hidden-desktop', hide_tablet: 'hidden-tablet' });
    if (section.mode === 'duplicate') {
      const controllerKeys = new Map<string, string>();
      for (const node of walkNative44([mobile])) {
        const next = mobileComponentKey(node.key); if (next.length > 80 || walkNative44(program.blocks).some(n => n.key === next)) fail('duplicate_key_collision');
        controllerKeys.set(node.key, next);
        remap.set(native44ModuleClass(node.key), native44ModuleClass(next)); node.key = next;
      }
      for (const node of walkNative44([mobile])) for (const action of node.model?.interactions ?? []) if (action.controllerKey && controllerKeys.has(action.controllerKey)) action.controllerKey = controllerKeys.get(action.controllerKey)!;
      fieldValues(original).hide_mobile = 'hidden-mobile';
      Object.assign(fieldValues(mobile), { hide_desktop: 'hidden-desktop', hide_tablet: 'hidden-tablet' });
      additions.push(copySectionCSS(desktopCSS, remap));
    }
    const mobileCSS = checkMobileCSS(section.css, native44ModuleClass(section.key));
    additions.push(mobileCSS.replace(/cwp-n44-[a-f0-9]+/g, name => remap.get(name) ?? name));
    if (section.touch?.length) {
      const owner = remap.get(native44ModuleClass(section.key)) ?? native44ModuleClass(section.key);
      touchRules.push(compileMobileTouchCSS(owner, plan.mobileMaxWidth, section.touch));
    }
    blocks.push(original); if (section.mode === 'duplicate') blocks.push(mobile);
  }
  program.blocks = blocks;
  if (plan.decisions) assertDecisionProgram(program, plan.decisions, plan.mobileMaxWidth, desktopCSS + additions.join("\n"));
  return { program: validateNative44Program(program), css: desktopCSS + `\n@media(max-width:${plan.mobileMaxWidth}px){${additions.join('\n')}}${touchRules.length ? '\n' + touchRules.join('\n') : ''}`, plan };
}
function checkMobileCSS(input: string, root: string): string {
  if (/[<\0]/.test(input)) fail('css_input');
  const ast = css.parse(input, { parseCustomProperty: true, onParseError() { fail('css_syntax'); } });
  css.walk(ast, node => {
    if (['Raw', 'NestingSelector', 'Url'].includes(node.type)) fail('css_native_photo_required');
    if (node.type === 'Atrule') fail('css_mobile_scope_is_automatic');
    if (node.type === 'Rule') {
      if (node.prelude.type !== 'SelectorList') fail('css_selector');
      node.prelude.children.forEach(selector => {
        const list = selector.type === 'Selector' ? selector.children.toArray() : [];
        if (list[0]?.type !== 'PseudoClassSelector' || list[0].name !== 'page' || list[0].children || list[1]?.type !== 'Combinator' || list[1].name !== ' ' || list[2]?.type !== 'ClassSelector' || list[2].name !== root) fail('css_section_scope');
        if (list.slice(3).some(n => n.type === 'Combinator' && ['+', '~'].includes(n.name))) fail('css_sibling_escape');
      });
    }
    if (node.type === 'Declaration' && (node.important || /^(content|behavior|-moz-binding|--)/i.test(node.property) || /^(display|visibility)$/.test(node.property) && /none|hidden/.test(css.generate(node.value)))) fail('css_native_control_conflict');
    if (node.type === 'Function' && /^(url|image|image-set|-webkit-image-set|expression)$/i.test(node.name)) fail('css_native_photo_required');
  }); return css.generate(ast);
}
function copySectionCSS(input: string, names: Map<string, string>): string {
  const ast = css.parse(input);
  css.walk(ast, { visit: 'Rule', enter(node, item, list) {
    if (node.prelude.type !== 'SelectorList') fail('css_selector');
    node.prelude.children.forEach((selector, selectorItem, selectors) => {
      let matched = false; css.walk(selector, child => { if (child.type === 'ClassSelector' && names.has(child.name)) { matched = true; child.name = names.get(child.name)!; } });
      if (!matched) selectors.remove(selectorItem);
    });
    if (node.prelude.children.isEmpty && list) list.remove(item);
  } });
  css.walk(ast, { visit: 'Atrule', enter(node, item, list) { if (node.name.toLowerCase() === 'font-face' && list) list.remove(item); } });
  return css.generate(ast);
}
/** The old compiler is unchanged. This versioned overlay certifies only the
 * three native visibility fields and still validates the live registration. */
export function compileResponsiveBody(programInput: Native44Program, options: Native44CompileOptions, cssInput = '', mobileMaxWidth = 768) {
  const program = structuredClone(programInput), knowledge = options.knowledge;
  const validateMobileCSS = createMobileNativeStyleCSSValidator(cssInput, mobileMaxWidth);
  const fieldSchema = options.schemas.container?.controls;
  const added: Record<string, unknown> = {};
  for (const name of visibility) {
    if (!walkNative44(program.blocks).some(n => Object.hasOwn(fieldValues(n), name))) continue;
    const control = fieldSchema?.[name], expected = `hidden-${name.slice(5)}`;
    if (!control || control.type !== 'switcher' || control.return_value !== expected) fail(`visibility_registration_${name}`);
    added[name] = control;
  }
  for (const node of walkNative44(program.blocks)) {
    const type = node.kind === 'composite' ? 'container' : 'widgetType' in node ? node.widgetType : 'html';
    // Some widgets declare tablet defaults even when the panel is left empty.
    // Copy explicit desktop values into native tablet fields, rather than
    // introducing a separately designed tablet presentation.
    const values = fieldValues(node);
    if (program.styleResolutionVersion === 2) mirrorRegisteredDesktopSettings(values, options.schemas[type], knowledge.controlsByWidget[type]);
    else for (const [name, value] of Object.entries(values)) if (!/_(mobile|tablet)$/.test(name) && options.schemas[type]?.controls[name]?.responsive && options.schemas[type]?.controls[name + '_tablet'] && knowledge.controlsByWidget[type]?.has(name + '_tablet')) values[name + '_tablet'] = structuredClone(value);
    for (const name of Object.keys(fieldValues(node)).filter(k => k.endsWith('_mobile') && k !== 'hide_mobile')) {
      if (nativeMobileName(type, name)) { if (!options.schemas[type]?.controls[name] || options.schemas[type].controls[name].responsive || !knowledge.controlsByWidget[type]?.has(name)) fail(`native_named_registration_${type}_${name}`); continue; }
      const ordinaryMobileControl = program.styleResolutionVersion === 2 && knowledge.styleControlsByWidget?.[type]?.some(control => control.id === name && !control.responsive);
      if (ordinaryMobileControl && options.schemas[type]?.controls[name] && !options.schemas[type].controls[name].responsive && !options.schemas[type].controls[name.slice(0, -7)]?.responsive && knowledge.controlsByWidget[type]?.has(name)) continue;
      if (program.styleResolutionVersion === 2) {
        assertRegisteredMobileSetting(type, name, options.schemas[type], knowledge.controlsByWidget[type]);
        const schema = options.schemas[type], actual = schema.controls[name], base = schema.controls[name.slice(0, -7)];
        const definition = knowledge.styleControlsByWidget?.[type]?.find(control => control.id === name) ?? knowledge.styleControlsByWidget?.[type]?.find(control => control.id === name.slice(0, -7) && control.responsive);
        const registered = { ...base, ...actual, selectors: Object.hasOwn(actual, 'selectors') ? actual.selectors : base.selectors };
        const effects = nativeStyleControlEffects({ ...schema, controls: { ...schema.controls, [name]: definition ? nativeStyleRegisteredControl(definition, registered) : registered } }, name, values);
        validateMobileCSS(native44ModuleClass(node.key), effects);
        continue;
      }
      const base = options.schemas[type]?.controls[name.slice(0, -7)], actual = options.schemas[type]?.controls[name];
      if (!base || !actual || !base.responsive || base.type !== actual.type || !knowledge.controlsByWidget[type]?.has(name)) fail(`responsive_registration_${type}_${name}`);
      const effects = nativeStyleEffects({ ...options.schemas[type], controls: { [name]: { ...actual, selectors: actual.selectors ?? base.selectors } } });
      if (effects.length) css.walk(css.parse(cssInput), function(rule) {
        if (rule.type !== 'Rule') return;
        if (this.atrule?.name === 'media' && this.atrule.prelude) {
          const media = css.generate(this.atrule.prelude), minimum = media.match(/min-width:\s*(\d+)px/);
          if (!media.includes(',') && minimum && Number(minimum[1]) > mobileMaxWidth) return;
        }
        if (rule.prelude.type !== 'SelectorList') return;
        const selectors = rule.prelude.children.toArray().map(selector => nativeStyleTargetSelector(css.generate(selector)));
        rule.block.children.forEach(declaration => {
          if (declaration.type !== 'Declaration') return;
          for (const effect of effects) {
            let target: string;
            try { target = nativeStyleTargetSelector(':page ' + effect.selector.replaceAll('{{WRAPPER}}', '.' + native44ModuleClass(node.key))); } catch { continue; }
            if (declaration.property === effect.property && selectors.includes(target) && css.generate(declaration.value) !== nativeStyleValue(effect.template, values[name])) fail('css_overrides_native_mobile_value');
          }
        });
      });
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ base: knowledge.fingerprint, module: program.styleResolutionVersion === 2 ? 'responsive-native-v2' : 'responsive-native-v1', fields: added })).digest('hex');
  program.knowledge.fingerprint = fingerprint;
  const overlay = { ...knowledge, fingerprint, controlsByWidget: { ...knowledge.controlsByWidget, container: new Set([...knowledge.controlsByWidget.container, ...Object.keys(added)]) }, validateSettings(type: string, settings: Record<string, unknown>) {
    const native = { ...settings }, hidden: Record<string, unknown> = {};
    for (const name of visibility) if (Object.hasOwn(native, name)) {
      if (type !== 'container' || !Object.hasOwn(added, name) || native[name] !== `hidden-${name.slice(5)}`) fail('visibility_value');
      hidden[name] = native[name]; delete native[name];
    }
    return { ...(knowledge.validateSettings?.(type, native) ?? native), ...hidden };
  } };
  const pendingForms = options.pendingForms?.length ? derivePendingFormsForResponsive(programInput, program, options.schemas, options.pendingForms, added) : options.pendingForms;
  const input = { ...options, ...(pendingForms ? { pendingForms } : {}), knowledge: overlay }; preflightNative44(program, input); return compileNative44(program, input);
}

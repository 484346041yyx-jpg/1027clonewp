import * as csstree from 'css-tree';
import type { HeaderModuleElement, HeaderModuleMenu, HeaderModulePlan } from './contract.js';

export type HeaderHoverTarget = 'link' | 'label' | 'label-before' | 'label-after';

export interface HeaderMenuHoverEffect {
  target: HeaderHoverTarget;
  normal: Record<string, string>;
  hover: Record<string, string>;
  current?: Record<string, string>;
  currentItemKey?: string;
}

const targets = new Set<HeaderHoverTarget>(['link', 'label', 'label-before', 'label-after']);
const property = /^(?:[a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)$/;

function fail(code: string): never { throw Error(`woodmart_header_hover_${code}`); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function declarations(value: unknown): void {
  if (!record(value) || !Object.keys(value).length || Object.keys(value).length > 24) fail('declarations_invalid');
  for (const [name, text] of Object.entries(value)) {
    if (!property.test(name) || name === 'content' || typeof text !== 'string' || !text.trim() || text.length > 1024 || /[;{}<>\u0000-\u001f\u007f]/.test(text)) fail('declarations_invalid');
  }
}

export function validateHeaderHoverEffects(element: HeaderModuleElement, menu: HeaderModuleMenu | undefined): void {
  if (element.hoverEffects === undefined) return;
  if (element.type !== 'mainmenu' || element.params.style === 'icon' || element.params.full_screen === true || !menu || !Array.isArray(element.hoverEffects) || !element.hoverEffects.length || element.hoverEffects.length > 8) fail('element_invalid');
  const seen = new Set<string>();
  for (const effect of element.hoverEffects) {
    if (!record(effect) || Object.keys(effect).some(name => !['target', 'normal', 'hover', 'current', 'currentItemKey'].includes(name)) || !targets.has(effect.target as HeaderHoverTarget) || seen.has(effect.target as string)) fail('effect_invalid');
    seen.add(effect.target as string);
    declarations(effect.normal); declarations(effect.hover);
    if (JSON.stringify(effect.normal) === JSON.stringify(effect.hover)) fail('unchanged_hover');
    if (effect.current !== undefined) declarations(effect.current);
    if (effect.currentItemKey !== undefined && (typeof effect.currentItemKey !== 'string' || effect.current === undefined || !menu.items.some(item => item.key === effect.currentItemKey && item.parentKey === null))) fail('current_item_invalid');
  }
}

function declarationCSS(value: Record<string, string>): string { return Object.entries(value).map(([name, text]) => `${name}:${text}`).join(';'); }
function targetSuffix(target: HeaderHoverTarget): string {
  if (target === 'link') return '>a';
  if (target === 'label') return '>a>.nav-link-text';
  return `>a>.nav-link-text::${target === 'label-before' ? 'before' : 'after'}`;
}

export function compileHeaderHoverCSS(plan: HeaderModulePlan, elementId: (key: string) => string): string {
  const rules: string[] = [];
  for (const row of plan.layout.rows) for (const column of Object.values(row.columns)) for (const element of column) {
    if (!element.hoverEffects?.length) continue;
    const menu = plan.menus.find(item => item.key === element.menuKey);
    validateHeaderHoverEffects(element, menu);
    const base = `:header .whb-${elementId(element.key)} .wd-nav-main>li`;
    for (const effect of element.hoverEffects) {
      const suffix = targetSuffix(effect.target);
      const pseudo = effect.target === 'label-before' || effect.target === 'label-after';
      if (pseudo) rules.push(`${base}>a>.nav-link-text{display:inline-block;position:relative}`);
      rules.push(`${base}${suffix}{${pseudo ? 'content:"";pointer-events:none;position:absolute;' : ''}${declarationCSS(effect.normal)}}`);
      rules.push(`${base}:hover${suffix},${base}:focus-within${suffix}{${declarationCSS(effect.hover)}}`);
      if (effect.current) {
        const selectors = [`${base}.current-menu-item${suffix}`, `${base}.current-menu-ancestor${suffix}`];
        if (effect.currentItemKey) {
          const item = menu!.items.find(candidate => candidate.key === effect.currentItemKey)!;
          const href = new URL(item.url, `${plan.targetOrigin}/`).href;
          selectors.push(`${base}${suffix.replace('>a', `>a[href=${csstree.string.encode(href)}]`)}`);
        }
        rules.push(`${selectors.join(',')}{${declarationCSS(effect.current)}}`);
      }
    }
  }
  return rules.join('');
}

import { headerJsonHash, canonicalHeaderJson, headerTargetOrigin, validateHeaderMenuItems, type HeaderJson, type HeaderMenuItem, type HeaderOwner } from '../contract.js';
import { validateResponsiveHeaderPlan, type ResponsiveHeader } from '../../replica-responsive/header.js';
import { validateHeaderMenuContent, type HeaderMenuContent } from './menu-content.js';
import { validateSimpleDropdowns, type SimpleDropdownPresentation } from './simple-dropdown.js';
import { validateHeaderHoverEffects, type HeaderMenuHoverEffect } from './hover-effects.js';
import { menuBindingPolicySchema, type MenuBindingPolicy } from './menu-binding.js';

/** An opt-in header module is independent of an Elementor body or page binding. */
export type HeaderRowSlot = 'top-bar' | 'general-header' | 'header-bottom';
export type HeaderColumnPosition = 'left' | 'center' | 'right';
export type HeaderModuleElementType = 'logo' | 'mainmenu' | 'menu' | 'account' | 'cart' | 'search' | 'space';
export interface HeaderModuleElement {
  key: string;
  type: HeaderModuleElementType;
  params: Record<string, HeaderJson>;
  menuKey?: string;
  hoverEffects?: HeaderMenuHoverEffect[];
}
export interface HeaderModuleRow {
  slot: HeaderRowSlot;
  params: Record<string, HeaderJson>;
  columns: Record<HeaderColumnPosition, HeaderModuleElement[]>;
}
export interface HeaderModuleFont { key: string; url: string; weight: number; style: 'normal' | 'italic' }
export interface HeaderModuleStyle { css: string; fonts: HeaderModuleFont[] }
export interface HeaderModuleMenu { key: string; name: string; items: HeaderMenuItem[]; dropdowns?: SimpleDropdownPresentation[] }
export interface HeaderModulePlan {
  kind: 'clonewp-header-module';
  version: 1;
  menuBindingPolicy?: MenuBindingPolicy;
  moduleKey: string;
  targetOrigin: string;
  owner: HeaderOwner;
  name: string;
  menus: HeaderModuleMenu[];
  /** Opt-in native Elementor documents bound to leaf menu items. Historical plans stay unchanged. */
  menuContent?: HeaderMenuContent[];
  menuItemMedia?: Array<{ menuKey: string; itemKey: string; mediaKey: string }>;
  layout: { rows: HeaderModuleRow[]; settings: Record<string, HeaderJson>; mobile?: ResponsiveHeader };
  style: HeaderModuleStyle;
}
export const HEADER_ROW_SLOTS: readonly HeaderRowSlot[] = Object.freeze(['top-bar', 'general-header', 'header-bottom']);
export const HEADER_COLUMN_POSITIONS: readonly HeaderColumnPosition[] = Object.freeze(['left', 'center', 'right']);
const types = new Set<HeaderModuleElementType>(['logo', 'mainmenu', 'menu', 'account', 'cart', 'search', 'space']);
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
function fail(code: string): never { throw new Error(`woodmart_header_module_${code}`); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('shape_invalid');
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function key(value: unknown): value is string { return typeof value === 'string' && keyPattern.test(value); }
function params(value: unknown): asserts value is Record<string, HeaderJson> {
  if (!object(value) || Object.keys(value).length > 100 || Object.keys(value).some(name => !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(name))) fail('params_invalid');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function https(value: unknown): string {
  if (!text(value, 2048) || /\\/.test(value)) fail('font_url_invalid');
  let url: URL; try { url = new URL(value); } catch { return fail('font_url_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('font_url_invalid');
  return value;
}

/** Validate and return a recursively frozen JSON clone; no task or brand defaults. */
export function validateHeaderModulePlan(input: unknown): HeaderModulePlan {
  // The shared canonicalizer rejects accessors, prototypes, cycles and lossy JSON
  // before this validator inspects any caller-controlled properties.
  const value: unknown = JSON.parse(canonicalHeaderJson(input));
  if (!object(value)) fail('plan_invalid');
  if (object(value.layout) && Object.hasOwn(value.layout, 'mobile')) return validateResponsiveHeaderPlan(value as unknown as HeaderModulePlan, validateHeaderModulePlan);
  exact(value, ['kind', 'version', 'moduleKey', 'targetOrigin', 'owner', 'name', 'menus', 'layout', 'style'], ['menuContent', 'menuItemMedia', 'menuBindingPolicy']);
  if (value.menuBindingPolicy !== undefined) value.menuBindingPolicy = menuBindingPolicySchema.parse(value.menuBindingPolicy);
  if (value.kind !== 'clonewp-header-module' || value.version !== 1 || typeof value.moduleKey !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.moduleKey) || !text(value.name, 200)) fail('plan_invalid');
  const origin = headerTargetOrigin(value.targetOrigin);
  if (!object(value.owner)) fail('owner_invalid');
  exact(value.owner, ['ownerId', 'runId']);
  if (!key(value.owner.ownerId) || !key(value.owner.runId)) fail('owner_invalid');
  if (!Array.isArray(value.menus) || value.menus.length < 1 || value.menus.length > 10) fail('menus_invalid');
  const menuKeys = new Set<string>(), menuNames = new Set<string>();
  for (const menu of value.menus) {
    if (!object(menu)) fail('menu_invalid');
    exact(menu, ['key', 'name', 'items'], ['dropdowns']);
    if (!key(menu.key) || menuKeys.has(menu.key) || !text(menu.name, 100) || menuNames.has(menu.name.normalize('NFKC').toLowerCase())) fail('menu_invalid');
    menuKeys.add(menu.key);
    menuNames.add(menu.name.normalize('NFKC').toLowerCase());
    menu.items = validateHeaderMenuItems(menu.items, origin);
    validateSimpleDropdowns(menu as unknown as HeaderModuleMenu);
  }
  if (Object.hasOwn(value, 'menuContent')) value.menuContent = validateHeaderMenuContent(value.menuContent, value.menus as unknown as HeaderModuleMenu[], value.owner.runId as string);
  if (Object.hasOwn(value, 'menuItemMedia')) {
    if (!value.menuContent || !Array.isArray(value.menuItemMedia) || !value.menuItemMedia.length || value.menuItemMedia.length > 100) fail('menu_media_invalid');
    const bindings = new Set<string>();
    for (const binding of value.menuItemMedia) {
      if (!object(binding)) fail('menu_media_invalid'); exact(binding, ['menuKey', 'itemKey', 'mediaKey']);
      const menu = (value.menus as unknown as HeaderModuleMenu[]).find(menu => menu.key === binding.menuKey), identity = `${binding.menuKey}/${binding.itemKey}`;
      if (!key(binding.mediaKey) || !menu?.items.some(item => item.key === binding.itemKey) || bindings.has(identity)) fail('menu_media_invalid'); bindings.add(identity);
    }
  }
  if (!object(value.layout)) fail('layout_invalid');
  exact(value.layout, ['rows', 'settings']); params(value.layout.settings);
  if (!Array.isArray(value.layout.rows) || value.layout.rows.length < 1 || value.layout.rows.length > 3) fail('rows_invalid');
  const slots = new Set<string>(), elementKeys = new Set<string>();
  for (const row of value.layout.rows) {
    if (!object(row)) fail('row_invalid');
    exact(row, ['slot', 'params', 'columns']);
    if (!HEADER_ROW_SLOTS.includes(row.slot as HeaderRowSlot) || slots.has(row.slot as string)) fail('row_invalid');
    slots.add(row.slot as string); params(row.params);
    if (!object(row.columns)) fail('columns_invalid');
    exact(row.columns, [...HEADER_COLUMN_POSITIONS]);
    for (const position of HEADER_COLUMN_POSITIONS) {
      const column = row.columns[position];
      if (!Array.isArray(column) || column.length > 100) fail('column_invalid');
      for (const element of column) {
        if (!object(element)) fail('element_invalid');
        exact(element, ['key', 'type', 'params'], ['menuKey', 'hoverEffects']);
        if (!key(element.key) || elementKeys.has(element.key) || elementKeys.size >= 100 || !types.has(element.type as HeaderModuleElementType)) fail('element_invalid');
        elementKeys.add(element.key); params(element.params);
        if (Object.hasOwn(element.params, 'menu_id')) fail('raw_menu_binding_forbidden');
        if (element.type === 'mainmenu' || element.type === 'menu') {
          if (!key(element.menuKey) || !menuKeys.has(element.menuKey)) fail('menu_binding_missing');
        } else if (Object.hasOwn(element, 'menuKey')) fail('unexpected_menu_binding');
        validateHeaderHoverEffects(element as unknown as HeaderModuleElement, (value.menus as unknown as HeaderModuleMenu[]).find(menu => menu.key === element.menuKey));
      }
    }
  }
  if (!object(value.style)) fail('style_invalid');
  exact(value.style, ['css', 'fonts']);
  if (typeof value.style.css !== 'string' || Buffer.byteLength(value.style.css, 'utf8') > 256 * 1024 || /\u0000/.test(value.style.css) || !Array.isArray(value.style.fonts) || value.style.fonts.length > 12) fail('style_invalid');
  const fontKeys = new Set<string>();
  for (const font of value.style.fonts) {
    if (!object(font)) fail('font_invalid'); exact(font, ['key', 'url', 'weight', 'style']);
    if (typeof font.key !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(font.key) || fontKeys.has(font.key) || !Number.isInteger(font.weight) || (font.weight as number) < 1 || (font.weight as number) > 1000 || !['normal', 'italic'].includes(font.style as string)) fail('font_invalid');
    fontKeys.add(font.key); https(font.url);
  }
  value.targetOrigin = origin;
  return freeze(value as unknown as HeaderModulePlan);
}

export function modulePlanHash(input: unknown): string { return headerJsonHash(validateHeaderModulePlan(input)); }

/** Parent-first creation order retaining declared sibling order and stable keys. */
export function orderHeaderMenuItems(input: unknown, targetOrigin: string): HeaderMenuItem[] {
  const items = validateHeaderMenuItems(input, targetOrigin);
  const children = new Map<string | null, HeaderMenuItem[]>();
  for (const item of items) { const group = children.get(item.parentKey) ?? []; group.push(item); children.set(item.parentKey, group); }
  const result: HeaderMenuItem[] = [];
  const visit = (parent: string | null): void => { for (const item of children.get(parent) ?? []) { result.push({ ...item }); visit(item.key); } };
  visit(null);
  return result;
}

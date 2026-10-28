import { createHash } from 'node:crypto';
import { canonicalHeaderJson, headerTargetOrigin, type HeaderJson } from '../contract.js';
import type { WhbLayoutNode, WhbParameter, WhbRawHeader } from '../layout.js';
import { HEADER_COLUMN_POSITIONS, HEADER_ROW_SLOTS, validateHeaderModulePlan, type HeaderColumnPosition, type HeaderModuleElementType, type HeaderRowSlot } from './contract.js';
import { assertNativeHeaderMenuBindings } from './menu-binding.js';

/** Every type, value domain, default and skeleton ID is captured from the target. */
export interface NativeHeaderFieldSchema {
  type: string;
  valueType: 'string' | 'number' | 'boolean' | 'json' | 'image';
  default?: HeaderJson;
  options?: HeaderJson[];
  min?: number;
  max?: number;
  resource?: 'image' | 'menu' | 'html-block';
}
export type NativeHeaderParameterSchema = Record<string, NativeHeaderFieldSchema>;
export interface NativeHeaderElementContract { type: string; schema: NativeHeaderParameterSchema }
export interface NativeHeaderContract {
  kind: 'clonewp-whb-native-contract';
  version: 1;
  menuBindingVersion?: 1;
  targetOrigin: string;
  fingerprint: string;
  structure: WhbLayoutNode;
  settings: Record<string, WhbParameter>;
  rowColumns: Record<HeaderRowSlot, Record<HeaderColumnPosition, string>>;
  rowSchema: NativeHeaderParameterSchema;
  settingsSchema: NativeHeaderParameterSchema;
  elements: Partial<Record<HeaderModuleElementType, NativeHeaderElementContract>>;
  styleElement: { type: string; field: string; schema: NativeHeaderParameterSchema };
}
export interface ResolvedHeaderMenu { id: number; slug: string }
export interface ResolvedHeaderMedia { id: number; url: string; width: number; height: number }
/** These identities must be established by the actual target resource adapter. */
export interface ResolvedHeaderResources {
  targetOrigin: string;
  menus: Record<string, ResolvedHeaderMenu>;
  media: Record<string, ResolvedHeaderMedia>;
  styleBlockId: number;
}
function fail(code: string): never { throw new Error(`woodmart_header_compile_${code}`); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function clone<T>(value: T): T { return JSON.parse(canonicalHeaderJson(value)) as T; }
function own(value: unknown, key: string): unknown { return object(value) && Object.hasOwn(value, key) ? value[key] : undefined; }
function tree(root: WhbLayoutNode): Map<string, WhbLayoutNode> {
  const nodes = new Map<string, WhbLayoutNode>();
  const visit = (node: WhbLayoutNode, depth: number): void => {
    if (!object(node) || typeof node.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(node.id) || typeof node.type !== 'string' || !node.type || depth > 8 || nodes.size >= 500 || nodes.has(node.id)) fail('skeleton_invalid');
    nodes.set(node.id, node);
    if (node.content !== undefined) { if (!Array.isArray(node.content)) fail('skeleton_invalid'); node.content.forEach(child => visit(child, depth + 1)); }
  };
  visit(root, 0); return nodes;
}
function checkSchema(schema: NativeHeaderParameterSchema): void {
  if (!object(schema) || Object.keys(schema).length > 150) fail('schema_invalid');
  for (const [name, field] of Object.entries(schema)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(name) || !object(field) || typeof field.type !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(field.type) || !['string', 'number', 'boolean', 'json', 'image'].includes(field.valueType)) fail('schema_invalid');
    if (Object.keys(field).some(key => !['type', 'valueType', 'default', 'options', 'min', 'max', 'resource'].includes(key))) fail('schema_invalid');
    if (field.resource !== undefined && !['image', 'menu', 'html-block'].includes(field.resource)) fail('schema_invalid');
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.length > 1000)) fail('schema_invalid');
    if (field.min !== undefined && !Number.isFinite(field.min) || field.max !== undefined && !Number.isFinite(field.max) || field.min !== undefined && field.max !== undefined && field.min > field.max) fail('schema_invalid');
  }
}
function valueMatches(value: HeaderJson, field: NativeHeaderFieldSchema): boolean {
  if (field.valueType === 'string' && typeof value !== 'string' || field.valueType === 'number' && typeof value !== 'number' || field.valueType === 'boolean' && typeof value !== 'boolean' || field.valueType === 'image' && !object(value)) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) return false;
  if (field.options && !field.options.some(option => canonicalHeaderJson(option) === canonicalHeaderJson(value))) return false;
  return true;
}

/** Stable module-scoped IDs leave native element labels and body nodes alone. */
export function headerModuleElementId(moduleKey: string, elementKey: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(moduleKey) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(elementKey)) fail('element_identity_invalid');
  return `cw-${createHash('sha256').update(moduleKey).digest('hex').slice(0, 12)}-${elementKey}`;
}

/**
 * Compile a new header from a captured native skeleton. This function has no
 * WordPress side effects, cannot change site defaults and never emits a body.
 * Only actual desktop column IDs are replaced; captured mobile nodes remain.
 */
export function compileHeaderModule(planInput: unknown, headerId: string, contractInput: NativeHeaderContract, resourcesInput: ResolvedHeaderResources): WhbRawHeader {
  const plan = validateHeaderModulePlan(planInput);
  if (!/^header_[A-Za-z0-9_-]{1,89}$/.test(headerId)) fail('header_identity_invalid');
  const contract = clone(contractInput), resources = clone(resourcesInput);
  if (contract.kind !== 'clonewp-whb-native-contract' || contract.version !== 1 || !/^[a-f0-9]{64}$/.test(contract.fingerprint) || headerTargetOrigin(contract.targetOrigin) !== plan.targetOrigin || headerTargetOrigin(resources.targetOrigin) !== plan.targetOrigin) fail('contract_identity_invalid');
  if (!positive(resources.styleBlockId) || !object(resources.menus) || !object(resources.media)) fail('resources_invalid');
  const menuKeys = new Set(plan.menus.map(menu => menu.key));
  if (Object.keys(resources.menus).some(key => !menuKeys.has(key))) fail('menu_resources_unexpected');
  const menuIds = new Set<number>(), menuSlugs = new Set<string>();
  for (const menu of plan.menus) {
    const binding = own(resources.menus, menu.key);
    if (!object(binding) || !positive(binding.id) || typeof binding.slug !== 'string' || binding.slug.length > 200 || !/^(?:[a-z0-9]|%[a-f0-9]{2})(?:[a-z0-9_-]|%[a-f0-9]{2})*$/.test(binding.slug)) fail('menu_resource_invalid');
    if (menuIds.has(binding.id) || menuSlugs.has(binding.slug)) fail('menu_resource_collision');
    menuIds.add(binding.id); menuSlugs.add(binding.slug);
  }
  const resourceMedia = (input: HeaderJson): HeaderJson => {
    if (!object(input) || Object.keys(input).length !== 1 || typeof input.$media !== 'string') fail('media_reference_required');
    const image = own(resources.media, input.$media);
    if (!object(image) || !positive(image.id) || !positive(image.width) || !positive(image.height) || (image.width as number) > 20000 || (image.height as number) > 20000 || typeof image.url !== 'string') fail('media_resource_invalid');
    let url: URL; try { url = new URL(image.url); } catch { return fail('media_resource_invalid'); }
    if (url.protocol !== 'https:' || url.origin !== plan.targetOrigin || url.username || url.password || url.hash || /[\u0000-\u001f\u007f\\]/.test(image.url)) fail('media_resource_invalid');
    return { id: image.id, url: image.url, width: image.width, height: image.height } as HeaderJson;
  };
  const compileParams = (schema: NativeHeaderParameterSchema, values: Record<string, HeaderJson>, bindings: Record<string, HeaderJson> = {}): Record<string, WhbParameter> => {
    checkSchema(schema);
    if (Object.keys(values).some(name => !Object.hasOwn(schema, name)) || Object.keys(bindings).some(name => !Object.hasOwn(schema, name))) fail('unknown_parameter');
    const result: Record<string, WhbParameter> = {};
    for (const [name, field] of Object.entries(schema)) {
      const explicit = Object.hasOwn(values, name), bound = Object.hasOwn(bindings, name);
      if (explicit && bound) fail('resource_binding_override');
      let value: HeaderJson;
      if (bound) value = bindings[name];
      else if (explicit) value = values[name];
      else if (Object.hasOwn(field, 'default') && field.resource === undefined && field.valueType !== 'image') value = field.default!;
      else continue;
      if ((field.resource === 'menu' || field.resource === 'html-block') && !bound) fail('resource_binding_required');
      if (field.resource === 'image' || field.valueType === 'image') { if (bound) fail('media_reference_required'); value = resourceMedia(value); }
      if (!valueMatches(value, field)) {
        // Empty defaults are native WHB unset sentinels for optional controls;
        // explicit input still has to satisfy the captured field domain.
        if (!explicit && !bound && value === '') continue;
        fail(`parameter_domain_${name}`);
      }
      result[name] = { id: name, type: field.type, value: clone(value) };
    }
    return result;
  };
  const structure = clone(contract.structure), nodes = tree(structure);
  if (structure.type !== 'root') fail('skeleton_invalid');
  checkSchema(contract.rowSchema); checkSchema(contract.settingsSchema);
  if (!object(contract.rowColumns) || !object(contract.elements) || !object(contract.settings)) fail('contract_invalid');
  // Replace every mapped desktop content list. Unselected rows cannot silently
  // copy an existing site's menu/logo into this new independent module.
  const desktopColumns = new Set<string>();
  for (const slot of HEADER_ROW_SLOTS) {
    const row = nodes.get(slot), mapping = contract.rowColumns[slot];
    if (!row || row.type !== 'row' || !structure.content?.includes(row) || !object(mapping)) fail('row_skeleton_invalid');
    for (const position of HEADER_COLUMN_POSITIONS) {
      const id = mapping[position], column = nodes.get(id);
      if (typeof id !== 'string' || desktopColumns.has(id) || !column || column.type !== 'column' || !row.content?.includes(column)) fail('column_skeleton_invalid');
      desktopColumns.add(id); column.content = [];
    }
    const hide = contract.rowSchema.hide_desktop;
    if (!hide || hide.type !== 'switcher' || hide.valueType !== 'boolean') fail('row_visibility_contract_missing');
    row.params = { ...row.params, ...compileParams(contract.rowSchema, { hide_desktop: !plan.layout.rows.some(selected => selected.slot === slot) }) };
  }
  for (const node of nodes.values()) if (node.type === 'column' && !desktopColumns.has(node.id) && node.content?.length) fail('nonempty_unowned_column');
  for (const rowPlan of plan.layout.rows) {
    const row = nodes.get(rowPlan.slot)!;
    row.params = { ...row.params, ...compileParams(contract.rowSchema, { hide_desktop: false, ...rowPlan.params }) };
    for (const position of HEADER_COLUMN_POSITIONS) {
      const column = nodes.get(contract.rowColumns[rowPlan.slot][position])!;
      column.content = rowPlan.columns[position].map(element => {
        const actual = own(contract.elements, element.type) as NativeHeaderElementContract | undefined;
        if (!actual || typeof actual.type !== 'string' || !actual.type) fail(`element_contract_missing_${element.type}`);
        const bindings: Record<string, HeaderJson> = {};
        if (element.type === 'mainmenu' || element.type === 'menu') {
          const fields = Object.entries(actual.schema).filter(([, schema]) => schema.resource === 'menu');
          if (fields.length !== 1) fail('menu_field_contract_invalid');
          if (plan.menuBindingPolicy && (fields[0][0] !== 'menu_id' || fields[0][1].type !== 'select' || fields[0][1].valueType !== 'string')) fail('native_menu_select_required');
          bindings[fields[0][0]] = resources.menus[element.menuKey!].slug;
        }
        const compiled = compileParams(actual.schema, element.params, bindings);
        if (element.type === 'logo' && !Object.entries(actual.schema).some(([name, schema]) => (schema.resource === 'image' || schema.valueType === 'image') && Object.hasOwn(compiled, name))) fail('logo_media_missing');
        return { id: headerModuleElementId(plan.moduleKey, element.key), type: actual.type, params: compiled };
      });
    }
  }
  const style = contract.styleElement;
  if (!object(style) || typeof style.type !== 'string' || !style.type || typeof style.field !== 'string' || !object(style.schema) || style.schema[style.field]?.resource !== 'html-block') fail('style_element_contract_invalid');
  const styleField = style.schema[style.field];
  if (!['string', 'number'].includes(styleField.valueType)) fail('style_element_contract_invalid');
  const styleParams = compileParams(style.schema, {}, { [style.field]: styleField.valueType === 'string' ? String(resources.styleBlockId) : resources.styleBlockId });
  const styleColumn = nodes.get(contract.rowColumns[plan.layout.rows[0].slot].right)!;
  styleColumn.content!.push({ id: headerModuleElementId(plan.moduleKey, 'module-styles'), type: style.type, params: styleParams });
  const settings = { ...clone(contract.settings), ...compileParams(contract.settingsSchema, plan.layout.settings) };
  const result: WhbRawHeader = { id: headerId, name: plan.name, structure, settings };
  tree(result.structure);
  assertNativeHeaderMenuBindings(plan, result, contract, resources, key => headerModuleElementId(plan.moduleKey, key));
  return result;
}

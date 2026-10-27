/** Independent WHB recipe. These parameter names and types were read from the
 * target WoodMart 8.3.4 element classes; this does not change the Elementor path. */
export interface WhbParameter {
  id: string;
  type: string;
  value: unknown;
  [key: string]: unknown;
}
export interface WhbLayoutNode {
  id: string;
  type: string;
  content?: WhbLayoutNode[];
  params?: Record<string, WhbParameter>;
  [key: string]: unknown;
}
export interface WhbRawHeader {
  id: string;
  name: string;
  structure: WhbLayoutNode;
  settings: Record<string, WhbParameter>;
  [key: string]: unknown;
}
export interface FurryHeaderResources {
  /** The caller verifies this target menu ID and slug refer to the same menu. */
  menuId: number;
  /** The target registered WHB select stores the menu slug, not the numeric ID. */
  menuSlug: string;
  /** Actual target attachment metadata. Render width is set separately below. */
  logo: { id: number; url: string; width: number; height: number };
}

export const FURRY_HEADER_ELEMENT_IDS = Object.freeze({
  logo: 'clonewp-furry-logo', menu: 'clonewp-furry-menu',
  account: 'clonewp-furry-account', cart: 'clonewp-furry-cart',
});
export const FURRY_HEADER_DESKTOP = Object.freeze({ logoWidth: 260, rowHeight: 109, background: '#e8e9eb' });

function fail(code: string): never { throw new Error(`woodmart_header_layout_${code}`); }
function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function parameter(id: string, type: string, value: unknown): WhbParameter { return { id, type, value }; }
function put(params: Record<string, WhbParameter>, id: string, type: string, value: unknown): void {
  const existing = params[id];
  if (existing !== undefined && (!object(existing) || existing.id !== id || existing.type !== type)) fail(`parameter_contract_${id}`);
  params[id] = { ...existing, id, type, value };
}
function requireParams(node: WhbLayoutNode): Record<string, WhbParameter> {
  if (node.params !== undefined && !object(node.params)) fail('params_invalid');
  return node.params ??= {};
}
function treeNodes(root: unknown): Map<string, WhbLayoutNode> {
  const nodes = new Map<string, WhbLayoutNode>();
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): void => {
    if (!object(value) || seen.has(value) || depth > 8 || nodes.size >= 500 || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || typeof value.type !== 'string' || nodes.has(value.id)) fail('tree_invalid');
    seen.add(value);
    const node = value as unknown as WhbLayoutNode;
    nodes.set(node.id, node);
    if (value.content !== undefined) {
      if (!Array.isArray(value.content)) fail('children_invalid');
      value.content.forEach(child => walk(child, depth + 1));
    }
  };
  walk(root, 0);
  return nodes;
}
function requireChild(parent: WhbLayoutNode, id: string, type: string): WhbLayoutNode {
  const matches = parent.content?.filter(node => node.id === id && node.type === type) ?? [];
  if (matches.length !== 1) fail(`skeleton_${id}`);
  return matches[0];
}
function validateResources(resources: FurryHeaderResources): void {
  if (!resources || !Number.isSafeInteger(resources.menuId) || resources.menuId < 1 || !object(resources.logo) || !Number.isSafeInteger(resources.logo.id) || resources.logo.id < 1 || !Number.isSafeInteger(resources.logo.width) || resources.logo.width < 1 || resources.logo.width > 20000 || !Number.isSafeInteger(resources.logo.height) || resources.logo.height < 1 || resources.logo.height > 20000 || typeof resources.logo.url !== 'string') fail('resources_invalid');
  if (typeof resources.menuSlug !== 'string' || resources.menuSlug.length > 200 || !/^(?:[a-z0-9]|%[a-f0-9]{2})(?:[a-z0-9_-]|%[a-f0-9]{2})*$/.test(resources.menuSlug)) fail('menu_slug_invalid');
  let image: URL;
  try { image = new URL(resources.logo.url); } catch { return fail('logo_url_invalid'); }
  if (image.protocol !== 'https:' || image.username || image.password || image.hash) fail('logo_url_invalid');
}

/**
 * Build a new raw tree for the explicitly selected test header. The source menu
 * hierarchy belongs to the menu adapter; its verified target slug is bound.
 * The desktop break between navigation and tools is handled by page-scoped CSS.
 * Existing mobile columns are preserved as input, without creating a variant.
 */
export function buildFurryHeader(baseRaw: unknown, resources: FurryHeaderResources): WhbRawHeader {
  validateResources(resources);
  if (!object(baseRaw) || typeof baseRaw.id !== 'string' || !/^(?:header_[1-9]\d*|default_header)$/.test(baseRaw.id) || typeof baseRaw.name !== 'string' || !baseRaw.name.trim() || !object(baseRaw.settings)) fail('base_invalid');
  const originalNodes = treeNodes(baseRaw.structure);
  const originalRoot = originalNodes.get('root');
  if (!originalRoot || originalRoot.type !== 'root') fail('skeleton_root');
  const raw = structuredClone(baseRaw) as unknown as WhbRawHeader;
  const root = raw.structure;
  const top = requireChild(root, 'top-bar', 'row');
  const main = requireChild(root, 'general-header', 'row');
  const bottom = requireChild(root, 'header-bottom', 'row');
  const left = requireChild(main, 'column8', 'column');
  const middle = requireChild(main, 'column9', 'column');
  const right = requireChild(main, 'column10', 'column');
  const replacedIds = new Set<string>();
  for (const column of [left, middle, right]) for (const node of treeNodes({ id: `temporary-${column.id}`, type: 'column', content: column.content ?? [] }).values()) replacedIds.add(node.id);
  for (const id of Object.values(FURRY_HEADER_ELEMENT_IDS)) if (originalNodes.has(id) && !replacedIds.has(id)) fail('element_id_collision');

  for (const row of [top, bottom]) {
    const params = requireParams(row);
    put(params, 'hide_desktop', 'switcher', true);
    put(params, 'hide_mobile', 'switcher', true);
    put(params, 'sticky', 'switcher', false);
  }
  const mainParams = requireParams(main);
  put(mainParams, 'row_columns', 'selector', '3');
  put(mainParams, 'flex_layout', 'selector', 'flex-middle');
  put(mainParams, 'height', 'slider', FURRY_HEADER_DESKTOP.rowHeight);
  put(mainParams, 'hide_desktop', 'switcher', false);
  put(mainParams, 'sticky', 'switcher', true);
  put(mainParams, 'sticky_height', 'slider', FURRY_HEADER_DESKTOP.rowHeight);
  put(mainParams, 'color_scheme', 'selector', 'dark');
  put(mainParams, 'background', 'bg', { 'background-color': { r: 232, g: 233, b: 235, a: 1 } });
  put(mainParams, 'border', 'border', { width: '0', sides: ['bottom'] });
  put(mainParams, 'shadow', 'switcher', false);

  put(raw.settings, 'overlap', 'switcher', false);
  put(raw.settings, 'boxed', 'switcher', false);
  put(raw.settings, 'full_width', 'switcher', true);
  put(raw.settings, 'hide_on_scroll', 'switcher', false);
  put(raw.settings, 'sticky_clone', 'switcher', false);
  put(raw.settings, 'sticky_effect', 'selector', 'stick');
  put(raw.settings, 'sticky_height', 'slider', FURRY_HEADER_DESKTOP.rowHeight);

  left.content = [{ id: FURRY_HEADER_ELEMENT_IDS.logo, type: 'logo', params: {
    image: parameter('image', 'image', { ...resources.logo }),
    width: parameter('width', 'slider', FURRY_HEADER_DESKTOP.logoWidth),
    sticky_image: parameter('sticky_image', 'image', ''),
    sticky_width: parameter('sticky_width', 'slider', FURRY_HEADER_DESKTOP.logoWidth),
    width_height: parameter('width_height', 'switcher', true),
  } }];
  middle.content = [{ id: FURRY_HEADER_ELEMENT_IDS.menu, type: 'mainmenu', params: {
    menu_id: parameter('menu_id', 'select', resources.menuSlug),
    full_screen: parameter('full_screen', 'switcher', false),
    menu_style: parameter('menu_style', 'selector', 'default'),
    menu_align: parameter('menu_align', 'selector', 'right'),
    items_gap: parameter('items_gap', 'selector', 's'),
    inline: parameter('inline', 'switcher', false),
    bg_overlay: parameter('bg_overlay', 'switcher', false),
  } }];
  right.content = [
    { id: FURRY_HEADER_ELEMENT_IDS.account, type: 'account', params: {
      display: parameter('display', 'selector', 'text'),
      with_username: parameter('with_username', 'switcher', false),
      login_dropdown: parameter('login_dropdown', 'switcher', false),
    } },
    { id: FURRY_HEADER_ELEMENT_IDS.cart, type: 'cart', params: {
      design: parameter('design', 'selector', 'text'),
      position: parameter('position', 'selector', 'side'),
    } },
  ];
  treeNodes(raw.structure);
  return raw;
}

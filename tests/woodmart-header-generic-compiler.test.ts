import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHeaderModule, headerModuleElementId, type NativeHeaderContract, type ResolvedHeaderResources } from '../src/woodmart-header/generic/compiler.js';
import type { HeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import type { WhbLayoutNode } from '../src/woodmart-header/layout.js';

const parameter = (id: string, type: string, value: unknown) => ({ id, type, value });
function native(): NativeHeaderContract {
  const row = (id: string, n: number): WhbLayoutNode => ({ id, type: 'row', params: { height: parameter('height', 'slider', 70) }, content: ['a', 'b', 'c'].map(c => ({ id: `${id}-${c}`, type: 'column', content: [{ id: `old-${n}-${c}`, type: 'logo' }] })) });
  return { kind: 'clonewp-whb-native-contract', version: 1, targetOrigin: 'https://target.example', fingerprint: 'a'.repeat(64), structure: { id: 'root', type: 'root', content: [row('top-bar', 1), row('general-header', 2), row('header-bottom', 3)] }, settings: { untouched: parameter('untouched', 'switcher', false) }, rowColumns: { 'top-bar': { left: 'top-bar-a', center: 'top-bar-b', right: 'top-bar-c' }, 'general-header': { left: 'general-header-a', center: 'general-header-b', right: 'general-header-c' }, 'header-bottom': { left: 'header-bottom-a', center: 'header-bottom-b', right: 'header-bottom-c' } }, rowSchema: { height: { type: 'slider', valueType: 'number', min: 40, max: 200 }, sticky: { type: 'switcher', valueType: 'boolean', default: false }, hide_desktop: { type: 'switcher', valueType: 'boolean', default: false } }, settingsSchema: { full_width: { type: 'switcher', valueType: 'boolean', default: false } }, elements: {
    logo: { type: 'logo', schema: { image: { type: 'image', valueType: 'image', resource: 'image' }, width: { type: 'slider', valueType: 'number', min: 1, max: 500 } } },
    mainmenu: { type: 'mainmenu', schema: { menu_id: { type: 'select', valueType: 'string', resource: 'menu' }, menu_align: { type: 'selector', valueType: 'string', options: ['left', 'right', 'center'], default: 'left' } } },
    account: { type: 'account', schema: { display: { type: 'selector', valueType: 'string', options: ['text', 'icon'] } } },
    cart: { type: 'cart', schema: { position: { type: 'selector', valueType: 'string', options: ['side', 'without'] } } },
    search: { type: 'search', schema: { size: { type: 'selector', valueType: 'string', options: ['small', 'large'] } } },
    space: { type: 'space', schema: { width: { type: 'slider', valueType: 'number', min: 0, max: 200 } } },
  }, styleElement: { type: 'HTMLBlock', field: 'block_id', schema: { block_id: { type: 'select', valueType: 'string', resource: 'html-block' } } } };
}
function plan(): HeaderModulePlan { return { kind: 'clonewp-header-module', version: 1, moduleKey: 'studio-moss', targetOrigin: 'https://target.example', name: 'Studio Moss', owner: { ownerId: 'clonewp', runId: 'brand-one' }, menus: [{ key: 'main', name: 'Moss menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { rows: [{ slot: 'general-header', params: { height: 96, sticky: true }, columns: { left: [{ key: 'brand', type: 'logo', params: { image: { $media: 'brand-logo' }, width: 220 } }], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: { menu_align: 'center' } }], right: [{ key: 'account', type: 'account', params: { display: 'text' } }, { key: 'cart', type: 'cart', params: { position: 'side' } }] } }], settings: { full_width: true } }, style: { css: ':header { color: #304b30 }', fonts: [] } }; }
function resources(): ResolvedHeaderResources { return { targetOrigin: 'https://target.example', menus: { main: { id: 41, slug: 'moss-menu' } }, media: { 'brand-logo': { id: 81, url: 'https://target.example/wp-content/uploads/moss.png', width: 600, height: 140 } }, styleBlockId: 501 }; }
function node(root: WhbLayoutNode, id: string): WhbLayoutNode | undefined { if (root.id === id) return root; return root.content?.map(child => node(child, id)).find(Boolean); }

test('native compiler binds target menu slug/media and stylesheet block independently of Elementor body', () => {
  const input = plan(), contract = native(), resolved = resources(), before = structuredClone({ input, contract, resolved });
  const raw = compileHeaderModule(input, 'header_900001', contract, resolved);
  assert.equal(raw.id, 'header_900001'); assert.equal(raw.name, 'Studio Moss');
  assert.deepEqual(node(raw.structure, headerModuleElementId(input.moduleKey, 'brand'))?.params?.image, parameter('image', 'image', resolved.media['brand-logo']));
  assert.deepEqual(node(raw.structure, headerModuleElementId(input.moduleKey, 'nav'))?.params?.menu_id, parameter('menu_id', 'select', 'moss-menu'));
  assert.deepEqual(node(raw.structure, headerModuleElementId(input.moduleKey, 'module-styles'))?.params?.block_id, parameter('block_id', 'select', '501'));
  assert.equal(node(raw.structure, headerModuleElementId(input.moduleKey, 'module-styles'))?.type, 'HTMLBlock');
  assert.equal(node(raw.structure, 'general-header')?.params?.height.value, 96); assert.equal(raw.settings.full_width.value, true);
  assert.equal(node(raw.structure, 'general-header')?.params?.hide_desktop.value, false);
  assert.equal(node(raw.structure, 'top-bar')?.params?.hide_desktop.value, true);
  assert.equal(node(raw.structure, 'header-bottom')?.params?.hide_desktop.value, true);
  assert.deepEqual(raw.settings.untouched, contract.settings.untouched);
  assert.deepEqual({ input, contract, resolved }, before); assert.equal(Object.hasOwn(raw, 'elements'), false);
  assert.equal(JSON.stringify(raw).includes('Furry'), false); assert.equal(JSON.stringify(raw).includes('15769'), false);
});
test('different brands/layouts use only explicitly selected native elements and captured desktop columns', () => {
  const p = plan(), c = native(); p.moduleKey = 'orbit'; p.name = 'Orbit';
  p.layout.rows = [{ slot: 'top-bar', params: { height: 48 }, columns: { left: [{ key: 'find', type: 'search', params: { size: 'large' } }], center: [], right: [{ key: 'gap', type: 'space', params: { width: 12 } }] } }]; p.layout.settings = {};
  c.structure.content![1].content!.push({ id: 'captured-mobile', type: 'column', content: [], params: { native_flag: parameter('native_flag', 'switcher', true) } });
  const raw = compileHeaderModule(p, 'header_orbit', c, resources());
  assert.equal(node(raw.structure, headerModuleElementId('orbit', 'find'))?.type, 'search');
  assert.equal(node(raw.structure, 'general-header-a')?.content?.length, 0);
  assert.deepEqual(node(raw.structure, 'captured-mobile'), node(c.structure, 'captured-mobile'));
  assert.equal(node(raw.structure, 'top-bar')?.params?.height.value, 48);
  assert.equal(raw.settings.full_width.value, false); // observed target default, not a brand default
});
test('schema drift, unknown params, unsupported elements and invalid skeletons fail before producing output', () => {
  for (const mutate of [
    (p: HeaderModulePlan, c: NativeHeaderContract) => { p.layout.rows[0].params.height = 300; },
    (p: HeaderModulePlan) => { p.layout.rows[0].params.unobserved = true; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { c.elements.mainmenu!.schema.menu_align.options = ['left']; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { delete c.elements.cart; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { c.rowColumns['general-header'].left = 'missing'; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { c.rowSchema.height.type = ''; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { delete c.rowSchema.hide_desktop; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { c.elements.mainmenu!.schema.menu_id.resource = undefined; delete c.elements.mainmenu!.schema.menu_id.resource; },
    (p: HeaderModulePlan, c: NativeHeaderContract) => { c.styleElement.schema.block_id.resource = 'menu'; },
  ]) { const p = plan(), c = native(); mutate(p, c); assert.throws(() => compileHeaderModule(p, 'header_900001', c, resources())); }
});
test('target identities and native resource fields cannot be replaced with literal source IDs or cross-site media', () => {
  for (const mutate of [
    (p: HeaderModulePlan) => { p.layout.rows[0].columns.left[0].params.image = { id: 99, url: 'https://source.example/logo.png', width: 200, height: 50 }; },
    (_p: HeaderModulePlan, _c: NativeHeaderContract, r: ResolvedHeaderResources) => { r.media['brand-logo'].url = 'https://source.example/logo.png'; },
    (_p: HeaderModulePlan, _c: NativeHeaderContract, r: ResolvedHeaderResources) => { r.menus.main.id = 0; },
    (_p: HeaderModulePlan, _c: NativeHeaderContract, r: ResolvedHeaderResources) => { r.menus.main.slug = 'Source menu'; },
    (_p: HeaderModulePlan, c: NativeHeaderContract) => { c.targetOrigin = 'https://other.example'; },
    (_p: HeaderModulePlan, _c: NativeHeaderContract, r: ResolvedHeaderResources) => { r.targetOrigin = 'https://other.example'; },
    (_p: HeaderModulePlan, _c: NativeHeaderContract, r: ResolvedHeaderResources) => { r.styleBlockId = 0; },
  ]) { const p = plan(), c = native(), r = resources(); mutate(p, c, r); assert.throws(() => compileHeaderModule(p, 'header_900001', c, r)); }
  assert.throws(() => compileHeaderModule(plan(), 'default_header', native(), resources()), /header_identity_invalid/);
});
test('resource defaults cannot smuggle source attachment or menu IDs into new native params', () => {
  const c = native(); c.elements.logo!.schema.image.default = { id: 99, url: 'https://source.example/logo.png' }; c.elements.mainmenu!.schema.menu_id.default = 'source-menu';
  const raw = compileHeaderModule(plan(), 'header_900001', c, resources());
  assert.equal(JSON.stringify(raw).includes('source-menu'), false); assert.equal(JSON.stringify(raw).includes('source.example'), false);
  const noImage = plan(); delete noImage.layout.rows[0].columns.left[0].params.image;
  assert.throws(() => compileHeaderModule(noImage, 'header_900001', c, resources()), /logo_media_missing/);
});
test('generated IDs are stable and module-scoped while existing-mobile collisions are rejected', () => {
  assert.equal(headerModuleElementId('studio-moss', 'nav'), headerModuleElementId('studio-moss', 'nav'));
  assert.notEqual(headerModuleElementId('studio-moss', 'nav'), headerModuleElementId('orbit', 'nav'));
  assert.ok(headerModuleElementId('a'.repeat(64), 'b'.repeat(80)).length <= 100);
  const c = native(); c.structure.content![0].content!.push({ id: 'mobile', type: 'column', content: [{ id: headerModuleElementId('studio-moss', 'brand'), type: 'logo' }] });
  assert.throws(() => compileHeaderModule(plan(), 'header_900001', c, resources()), /nonempty_unowned_column/);
});
test('separate planned menus cannot silently resolve to the same existing native menu', () => {
  const p = plan(); p.menus.push({ key: 'utility', name: 'Utility', items: [{ key: 'help', parentKey: null, title: 'Help', url: '/help' }] });
  const r = resources(); r.menus.utility = { ...r.menus.main };
  assert.throws(() => compileHeaderModule(p, 'header_900001', native(), r), /menu_resource_collision/);
});
test('observed empty native defaults remain unset while explicit out-of-domain empty values fail', () => {
  const c = native(), p = plan();
  c.elements.mainmenu!.schema.icon_width = { type: 'slider', valueType: 'number', min: 0, max: 50, default: '' };
  c.elements.mainmenu!.schema.icon_height = { type: 'slider', valueType: 'number', min: 0, max: 50, default: 0 };
  c.elements.cart!.schema.design = { type: 'selector', valueType: 'string', options: ['icon', 'text'], default: '' };
  c.elements.search!.schema.form_width = { type: 'slider', valueType: 'number', min: 0, max: 100, default: '' };
  p.layout.rows[0].columns.right.push({ key: 'find', type: 'search', params: {} });
  const raw = compileHeaderModule(p, 'header_900001', c, resources());
  const navigation = node(raw.structure, headerModuleElementId(p.moduleKey, 'nav'))!;
  assert.equal(Object.hasOwn(navigation.params!, 'icon_width'), false);
  assert.equal(navigation.params!.icon_height.value, 0);
  assert.equal(Object.hasOwn(node(raw.structure, headerModuleElementId(p.moduleKey, 'cart'))!.params!, 'design'), false);
  assert.equal(Object.hasOwn(node(raw.structure, headerModuleElementId(p.moduleKey, 'find'))!.params!, 'form_width'), false);
  for (const [column, index, field] of [['center', 0, 'icon_width'], ['right', 1, 'design'], ['right', 2, 'form_width']] as const) {
    const explicit = structuredClone(p); explicit.layout.rows[0].columns[column][index].params[field] = '';
    assert.throws(() => compileHeaderModule(explicit, 'header_900001', c, resources()), /parameter_domain_/);
  }
});
test('search extra HTML block remains a resolved resource rather than a literal old business ID', () => {
  const c = native(), p = plan();
  c.elements.search!.schema.search_extra_content = { type: 'select', valueType: 'string', resource: 'html-block' };
  p.layout.rows[0].columns.right.push({ key: 'find', type: 'search', params: {} });
  const raw = compileHeaderModule(p, 'header_900001', c, resources());
  const search = node(raw.structure, headerModuleElementId(p.moduleKey, 'find'))!;
  assert.equal(Object.hasOwn(search.params!, 'search_extra_content'), false);
  for (const id of [1496, '1496', 15923, '15923', '']) {
    const explicit = structuredClone(p); explicit.layout.rows[0].columns.right[2].params.search_extra_content = id;
    assert.throws(() => compileHeaderModule(explicit, 'header_900001', c, resources()), /resource_binding_required/);
  }
});

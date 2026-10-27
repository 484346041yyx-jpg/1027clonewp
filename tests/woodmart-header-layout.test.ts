import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFurryHeader, FURRY_HEADER_ELEMENT_IDS, type WhbLayoutNode, type WhbRawHeader } from '../src/woodmart-header/layout.js';

const resources = { menuId: 205, menuSlug: 'test', logo: { id: 409, url: 'https://target.example/wp-content/uploads/header-logo.png', width: 300, height: 84 } };
const p = (id: string, type: string, value: unknown) => ({ id, type, value });
function fixture(): WhbRawHeader {
  const column = (id: string, content: WhbLayoutNode[] = []): WhbLayoutNode => ({ id, type: 'column', content });
  const row = (id: string, content: WhbLayoutNode[]): WhbLayoutNode => ({ id, type: 'row', content, params: { height: p('height', 'slider', 70), hide_desktop: p('hide_desktop', 'switcher', false), sticky: p('sticky', 'switcher', false) } });
  return { id: 'header_193941', name: 'test', structure: { id: 'root', type: 'root', content: [
    row('top-bar', [column('column5'), column('column6'), column('column7')]),
    row('general-header', [column('column8', [{ id: 'old-menu', type: 'mainmenu' }]), column('column9', [{ id: 'old-logo', type: 'logo' }]), column('column10'), column('column_mobile3', [{ id: 'old-mobile-logo', type: 'logo', params: { width: p('width', 'slider', 210) } }])]),
    row('header-bottom', [column('column11'), column('column12'), column('column13')]),
  ] }, settings: { full_width: p('full_width', 'switcher', false), sticky_clone: p('sticky_clone', 'switcher', true), untouched: p('untouched', 'switcher', true) }, extra: { proof: 'preserve' } };
}
function node(raw: WhbRawHeader, id: string): WhbLayoutNode {
  const visit = (current: WhbLayoutNode): WhbLayoutNode | undefined => current.id === id ? current : current.content?.map(visit).find(Boolean);
  const result = visit(raw.structure);
  assert.ok(result, `Missing ${id}`);
  return result;
}

test('WHB recipe binds real target resources and replaces only the three desktop columns', () => {
  const base = fixture(), before = structuredClone(base);
  const result = buildFurryHeader(base, resources);
  assert.deepEqual(base, before);
  assert.equal(result.id, base.id); assert.equal(result.name, base.name);
  assert.deepEqual(result.extra, base.extra); assert.notEqual(result.extra, base.extra);
  assert.deepEqual(node(result, 'column8').content?.map(item => item.type), ['logo']);
  assert.deepEqual(node(result, 'column9').content?.map(item => item.type), ['mainmenu']);
  assert.deepEqual(node(result, 'column10').content?.map(item => item.type), ['account', 'cart']);
  assert.deepEqual(node(result, 'column_mobile3'), node(base, 'column_mobile3'));
  assert.notEqual(node(result, 'column_mobile3'), node(base, 'column_mobile3'));
  const menu = node(result, FURRY_HEADER_ELEMENT_IDS.menu);
  assert.deepEqual(menu.params?.menu_id, p('menu_id', 'select', 'test'));
  assert.equal(menu.params?.menu_align.value, 'right');
  const logo = node(result, FURRY_HEADER_ELEMENT_IDS.logo);
  assert.deepEqual(logo.params?.image.value, resources.logo);
  assert.equal(logo.params?.width.value, 260); assert.equal(logo.params?.sticky_width.value, 260);
  assert.equal(260 * resources.logo.height / resources.logo.width, 72.8);
  assert.deepEqual(node(result, FURRY_HEADER_ELEMENT_IDS.account).params?.display, p('display', 'selector', 'text'));
  assert.equal(node(result, FURRY_HEADER_ELEMENT_IDS.account).params?.login_dropdown.value, false);
  assert.equal(node(result, FURRY_HEADER_ELEMENT_IDS.cart).params?.position.value, 'side');
  assert.equal(node(result, FURRY_HEADER_ELEMENT_IDS.cart).params?.design.value, 'text');
});

test('recipe fixes the source row and sticky geometry without changing preserved settings', () => {
  const result = buildFurryHeader(fixture(), resources);
  const main = node(result, 'general-header');
  assert.equal(main.params?.height.value, 109); assert.equal(main.params?.sticky_height.value, 109);
  assert.equal(main.params?.sticky.value, true); assert.equal(main.params?.hide_desktop.value, false);
  assert.deepEqual(main.params?.background.value, { 'background-color': { r: 232, g: 233, b: 235, a: 1 } });
  for (const id of ['top-bar', 'header-bottom']) {
    assert.equal(node(result, id).params?.hide_desktop.value, true);
    assert.equal(node(result, id).params?.hide_mobile.value, true);
    assert.equal(node(result, id).params?.sticky.value, false);
  }
  assert.equal(result.settings.full_width.value, true);
  assert.equal(result.settings.sticky_clone.value, false);
  assert.deepEqual(result.settings.untouched, p('untouched', 'switcher', true));
  assert.deepEqual(buildFurryHeader(result, resources), result);
});

test('unresolved resources and unsupported skeleton or parameter drift fail before producing a tree', () => {
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => buildFurryHeader(fixture(), { ...resources, menuId: bad }), /resources_invalid/);
  for (const menuSlug of ['', 'Test', ' menu', 'menu name', 'https://target.example/menu', 'test?token=secret', '%xx', 'x'.repeat(201)]) assert.throws(() => buildFurryHeader(fixture(), { ...resources, menuSlug }), /menu_slug_invalid/);
  for (const url of ['http://target.example/logo.png', 'https://user:password@target.example/logo.png', 'https://target.example/logo.png#fragment']) assert.throws(() => buildFurryHeader(fixture(), { ...resources, logo: { ...resources.logo, url } }), /logo_url_invalid/);
  assert.throws(() => buildFurryHeader(fixture(), { ...resources, logo: { ...resources.logo, height: 0 } }), /resources_invalid/);
  const missing = fixture(); node(missing, 'column8').id = 'unknown-column';
  assert.throws(() => buildFurryHeader(missing, resources), /skeleton_column8/);
  const duplicate = fixture(); node(duplicate, 'column9').id = 'column8';
  assert.throws(() => buildFurryHeader(duplicate, resources), /tree_invalid/);
  const drift = fixture(); node(drift, 'general-header').params!.height.type = 'unsupported';
  assert.throws(() => buildFurryHeader(drift, resources), /parameter_contract_height/);
  const collision = fixture(); node(collision, 'column_mobile3').content!.push({ id: FURRY_HEADER_ELEMENT_IDS.logo, type: 'logo' });
  assert.throws(() => buildFurryHeader(collision, resources), /element_id_collision/);
});

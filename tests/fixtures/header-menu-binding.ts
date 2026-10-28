import type { HeaderModulePlan } from '../../src/woodmart-header/generic/contract.js';
import type { NativeHeaderContract, ResolvedHeaderResources } from '../../src/woodmart-header/generic/compiler.js';
import { defaultMenuBindingPolicy } from '../../src/woodmart-header/generic/menu-binding.js';

export function headerMenuFixture() {
  const plan: HeaderModulePlan = {
    version: 1, kind: 'clonewp-header-module', moduleKey: 'menu-binding', name: 'Fixture header', targetOrigin: 'https://target.example',
    owner: { ownerId: 'fixture-task', runId: 'fixture-run' }, menuBindingPolicy: defaultMenuBindingPolicy(),
    menus: [
      { key: 'main', name: '主导航', items: [{ key: 'home', title: 'Home', url: '/', parentKey: null }] },
      { key: 'languages', name: '语言切换', items: [{ key: 'en', title: 'EN', url: '/', parentKey: null }] },
    ],
    layout: { settings: {}, rows: [{ slot: 'general-header', params: {}, columns: {
      left: [{ key: 'logo', type: 'logo', params: { image: { $media: 'logo' } } }],
      center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: { style: 'text', full_screen: false } }],
      right: [{ key: 'languages', type: 'menu', menuKey: 'languages', params: {} }],
    } }], mobile: { version: 1, tablet: 'desktop', mobileMaxWidth: 768, css: '', rows: [{ slot: 'general-header', params: { mobile_height: 70 }, columns: {
      left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }],
      center: [{ key: 'phone-languages', type: 'menu', menuKey: 'languages', params: {} }],
      right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'main', params: { style: 'icon', full_screen: true } }],
    } }] } }, style: { css: '', fonts: [] },
  };
  const contract: NativeHeaderContract = {
    kind: 'clonewp-whb-native-contract', version: 1, menuBindingVersion: 1, fingerprint: 'a'.repeat(64), targetOrigin: plan.targetOrigin,
    structure: { id: 'root', type: 'root', content: ['top-bar', 'general-header', 'header-bottom'].map(id => ({ id, type: 'row', params: {}, content: [
      ...['left', 'center', 'right'].map(position => ({ id: id + '-' + position, type: 'column', desktop_only: true, class: 'whb-col-' + position, content: [] })),
      { id: id + '-mobile', type: 'column', mobile_only: true, content: [] },
    ] })) },
    settings: {}, settingsSchema: {}, rowSchema: {
      hide_desktop: { type: 'switcher', valueType: 'boolean' }, hide_mobile: { type: 'switcher', valueType: 'boolean' }, mobile_height: { type: 'slider', valueType: 'number', min: 40, max: 200 },
    }, rowColumns: Object.fromEntries(['top-bar', 'general-header', 'header-bottom'].map(id => [id, Object.fromEntries(['left', 'center', 'right'].map(position => [position, id + '-' + position]))])) as NativeHeaderContract['rowColumns'],
    elements: {
      logo: { type: 'logo', schema: { image: { type: 'image', valueType: 'image', resource: 'image' } } },
      mainmenu: { type: 'mainmenu', schema: { menu_id: { type: 'select', valueType: 'string', resource: 'menu' }, style: { type: 'selector', valueType: 'string', options: ['text', 'icon'] }, full_screen: { type: 'switcher', valueType: 'boolean' } } },
      menu: { type: 'menu', schema: { menu_id: { type: 'select', valueType: 'string', resource: 'menu' } } },
    }, styleElement: { type: 'HTMLBlock', field: 'block_id', schema: { block_id: { type: 'select', valueType: 'string', resource: 'html-block' } } },
  };
  const resources: ResolvedHeaderResources = {
    targetOrigin: plan.targetOrigin, styleBlockId: 501,
    menus: { main: { id: 910, slug: '%e4%b8%bb%e5%af%bc%e8%88%aa' }, languages: { id: 909, slug: '%e8%af%ad%e8%a8%80%e5%88%87%e6%8d%a2' } },
    media: { logo: { id: 502, url: 'https://target.example/logo.png', width: 200, height: 100 } },
  };
  return { plan, contract, resources };
}

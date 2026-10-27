import { z } from 'zod';
import * as cssTree from 'css-tree';
import type { HeaderModulePlan, HeaderModuleRow } from '../woodmart-header/generic/contract.js';
import { compileHeaderModule, type NativeHeaderContract, type ResolvedHeaderResources } from '../woodmart-header/generic/compiler.js';
import type { WhbLayoutNode } from '../woodmart-header/layout.js';
import { responsiveFail as fail } from './contract.js';
import { compileHeaderModuleStyles } from '../woodmart-header/generic/styles.js';
import { responsiveOwnedHeaderDecisionSchema, expectedHeader, type ResponsiveDecisions } from './decisions.js';

const mobileSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), scroll: responsiveOwnedHeaderDecisionSchema.optional(), mobileMaxWidth: z.number().int().min(600).max(900), tablet: z.literal('desktop'), rows: z.array(z.unknown()).min(1).max(3), css: z.string().max(262144), menuCSS: z.string().max(131072).optional() }).strict();
export interface ResponsiveHeader { version: 1 | 2; scroll?: ResponsiveDecisions['header']; mobileMaxWidth: number; tablet: 'desktop'; rows: HeaderModuleRow[]; css: string; menuCSS?: string }
export function validateResponsiveHeaderPlan(value: HeaderModulePlan, validateBase: (v: unknown) => HeaderModulePlan): HeaderModulePlan {
  const input = structuredClone(value), mobile = mobileSchema.parse(input.layout.mobile);
  if (mobile.version === 2 ? !mobile.scroll : mobile.scroll !== undefined) fail('header_scroll_decision_required');
  delete input.layout.mobile; const base = validateBase(input);
  if (mobile.scroll && expectedHeader(mobile.scroll.views[0]).policy === 'fixed' && [mobile.css, mobile.menuCSS ?? '', base.style.css].some(css => /var\(\s*--wp-admin--admin-bar--height\b/i.test(css))) fail('header_raw_admin_offset_unsafe');
  const presentation = validateBase({ ...input, layout: { rows: mobile.rows, settings: {} } });
  const desktopKeys = new Set(base.layout.rows.flatMap(row => Object.values(row.columns).flat().map(e => e.key)));
  for (const row of presentation.layout.rows) {
    if (Object.keys(row.params).some(k => k !== 'mobile_height')) fail('header_shared_row_setting');
    for (const element of Object.values(row.columns).flat()) {
      if (element.hoverEffects !== undefined) fail('header_mobile_hover_effect_forbidden');
      if (desktopKeys.has(element.key)) fail('header_element_key_collision');
      if (element.type === 'mainmenu' && !(element.params.style === 'icon' && element.params.full_screen === true || element.params.style === 'text' && element.params.full_screen === false)) fail('header_native_icon_menu_required');
    }
  }
  if (!presentation.layout.rows.some(r => Object.values(r.columns).flat().some(e => e.type === 'logo'))) fail('header_mobile_logo_missing');
  if (base.layout.rows.some(r => Object.values(r.columns).flat().some(e => e.type === 'mainmenu')) && !presentation.layout.rows.some(r => Object.values(r.columns).flat().some(e => e.type === 'mainmenu'))) fail('header_mobile_menu_missing');
  if (presentation.layout.rows.flatMap(r => Object.values(r.columns).flat()).filter(e => e.type === 'mainmenu' && e.params.style === 'icon' && e.params.full_screen === true).length !== 1) fail('header_one_phone_menu_required');
  return Object.freeze({ ...base, layout: Object.freeze({ ...base.layout, mobile: Object.freeze({ ...mobile, rows: presentation.layout.rows }) }) });
}
function nodes(root: WhbLayoutNode): Map<string, WhbLayoutNode> {
  const map = new Map<string, WhbLayoutNode>(); const visit = (n: WhbLayoutNode) => { if (map.has(n.id)) fail('header_node_collision'); map.set(n.id, n); n.content?.forEach(visit); }; visit(root); return map;
}
function mobileColumns(row: WhbLayoutNode): WhbLayoutNode[] {
  const columns = row.content?.filter(n => n.type === 'column' && n.mobile_only === true && !n.desktop_only) ?? [];
  if (![1, 3].includes(columns.length)) fail('header_mobile_skeleton'); return columns;
}
/** Same WHB object and native resource bindings. Never assigns a global menu
 * location: mobile uses the native mainmenu icon with its own selected menu. */
export function compileAdaptiveHeaderModule(plan: HeaderModulePlan, id: string, contract: NativeHeaderContract, resources: ResolvedHeaderResources) {
  if (!plan.layout.mobile) return compileHeaderModule(plan, id, contract, resources);
  const { mobile, ...desktop } = plan.layout;
  const base = { ...plan, layout: desktop }, raw = compileHeaderModule(base, id, contract, resources), tree = nodes(raw.structure);
  const mobilePlan = { ...base, layout: { rows: mobile.rows.map(r => ({ ...r, params: {} })), settings: {} } };
  const generated = compileHeaderModule(mobilePlan, id, contract, resources), generatedTree = nodes(generated.structure);
  if (contract.rowSchema.hide_mobile?.type !== 'switcher' || contract.rowSchema.hide_mobile.valueType !== 'boolean') fail('header_mobile_visibility_registration');
  for (const row of raw.structure.content ?? []) {
    const columns = mobileColumns(row), selected = mobile.rows.find(r => r.slot === row.id);
    for (const col of columns) col.content = [];
    row.params ??= {};
    row.params.hide_mobile = { id: 'hide_mobile', type: 'switcher', value: !selected };
    if (!selected) continue;
    for (const [name, value] of Object.entries(selected.params)) {
      const field = contract.rowSchema[name];
      if (name !== 'mobile_height' || field?.valueType !== 'number' || typeof value !== 'number' || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) fail('header_mobile_height_registration');
      row.params[name] = { id: name, type: field.type, value };
    }
    const lists = (['left', 'center', 'right'] as const).map(position => generatedTree.get(contract.rowColumns[selected.slot][position])!.content!.filter(n => !n.id.endsWith('-module-styles')));
    if (columns.length === 1) columns[0].content = lists.flat();
    else for (let i = 0; i < 3; i++) {
      const expected = ['whb-mobile-left', 'whb-mobile-center', 'whb-mobile-right'][i];
      const column = columns.find(c => String(c.class).split(/\s+/).includes(expected)); if (!column) fail('header_mobile_column_identity'); column.content = lists[i];
    }
  }
  const actualNodes = nodes(raw.structure), mainmenuType = contract.elements.mainmenu?.type;
  const lastMenu = [...actualNodes.values()].filter(n => n.type === mainmenuType).at(-1);
  // WoodMart 8.3.4 aggregates element options by type, last node wins.
  // A later desktop menu must never replace the phone panel's own menu.
  const phoneMenu = mobile.rows.flatMap(r => Object.values(r.columns).flat()).find(e => e.type === 'mainmenu' && e.params.style === 'icon' && e.params.full_screen === true)!;
  if (!lastMenu || lastMenu.params?.full_screen?.value !== true || lastMenu.params?.menu_id?.value !== resources.menus[phoneMenu.menuKey!].slug) fail('header_phone_menu_aggregation');
  return raw;
}
/** Scoped bridge keeps tablets on desktop presentation without changing any
 * theme/Elementor global breakpoint. The theme classes are verified by review. */
export function adaptiveHeaderCSS(plan: HeaderModulePlan): string {
  const mobile = plan.layout.mobile; if (!mobile) return '';
  let bridge = ':header .whb-visible-lg{display:flex!important}:header .whb-hidden-lg{display:none!important}';
  for (const slot of ['top-bar', 'general-header', 'header-bottom']) {
    const row = plan.layout.rows.find(r => r.slot === slot), height = row?.params.height;
    bridge += `:header .whb-${slot}{display:${row ? 'block' : 'none'}!important}`;
    if (row && typeof height === 'number') bridge += `:header .whb-${slot}-inner{height:${height}px!important;max-height:none!important}`;
  }
  // The normal WHB compiler scopes every supplied selector to this header ID.
  const phoneCSS = cssTree.generate(cssTree.parse(mobile.css, { onParseError() { fail('header_mobile_css_syntax'); } }));
  // Fixed/static policies have one generated implementation rather than a
  // worker remembering a CSS snippet. Reveal-on-up remains a native behavior
  // adapter and must be demonstrated by the state-based review.
  let scrollCSS = '';
  if (mobile.scroll) {
    const first = expectedHeader(mobile.scroll.views[0]);
    if (mobile.scroll.views.some(v => expectedHeader(v).policy !== first.policy || expectedHeader(v).offset !== first.offset)) fail('header_scroll_native_adapter_required');
    if (first.policy === 'reveal-on-up' && mobile.scroll.implementation !== 'native') fail('header_reveal_native_adapter_required');
    if (first.policy === 'fixed') {
      const height = mobile.rows.reduce((sum, row) => sum + (typeof row.params.mobile_height === 'number' ? row.params.mobile_height : 0), 0);
      if (mobile.rows.some(row => typeof row.params.mobile_height !== 'number' || row.params.mobile_height <= 0)) fail('header_fixed_row_height_required');
      scrollCSS = `:header{position:relative!important;height:${mobile.scroll.flow === 'reserve-space' ? height : 0}px}:header .whb-main-header{position:fixed!important;top:calc(${first.offset}px + var(--clonewp-header-admin-offset,0px))!important;left:0;right:0;width:100%;z-index:390}`;
    }
    if (first.policy === 'static') scrollCSS = ':header .whb-main-header{position:static!important;transform:none!important}';
  }
  return `@media(min-width:${mobile.mobileMaxWidth + 1}px) and (max-width:1024px){${bridge}}\n@media(max-width:${mobile.mobileMaxWidth}px){${phoneCSS}${scrollCSS}}`;
}
/** The WordPress variable can remain 46px in an Elementor iframe without an
 * actual admin bar. Define the effective offset in the header's own stylesheet,
 * which is loaded on both the frontend and the editor canvas. */
export function adaptiveHeaderEnvironmentCSS(plan: HeaderModulePlan, headerId: string): string {
  const mobile = plan.layout.mobile;
  if (!mobile?.scroll || expectedHeader(mobile.scroll.views[0]).policy !== 'fixed') return '';
  if (!/^header_[A-Za-z0-9_-]{1,89}$/.test(headerId)) fail('header_environment_identity');
  const owner = `body:has(.whb-${headerId})`;
  const withBar = `body.admin-bar:has(#wpadminbar):has(.whb-${headerId})`;
  const offset = 'var(--clonewp-header-admin-offset,0px)';
  return `@media(max-width:${mobile.mobileMaxWidth}px){${owner}{--clonewp-header-admin-offset:0px}${withBar}{--clonewp-header-admin-offset:var(--wp-admin--admin-bar--height,0px)}${withBar} #wpadminbar{position:fixed!important;top:0!important}${owner} .wd-fs-menu{top:${offset}!important;height:calc(100dvh - ${offset})!important}}`;
}
/** The native fullscreen panel is rendered outside the WHB root. Its optional
 * supplemental CSS is still owned by the header plan, scoped to the exact page. */
export function responsiveHeaderPageCSS(plan: HeaderModulePlan, pageId: number, headerId = 'header_validation'): string {
  const mobile = plan.layout.mobile, input = mobile?.menuCSS ?? ''; if (!mobile || !input && !mobile.scroll) return '';
  if (!Number.isSafeInteger(pageId) || pageId < 1 || /[<\0]/.test(input)) fail('header_menu_css');
  const ast = cssTree.parse(input, { parseCustomProperty: true, onParseError() { fail('header_menu_css_syntax'); } });
  let documentScrollLock=false;
  cssTree.walk(ast,{visit:'Rule',enter(rule){if(rule.prelude.type!=='SelectorList')return;rule.block.children.forEach((declaration,item,list)=>{if(declaration.type==='Declaration'&&declaration.property==='--clonewp-menu-scroll-lock'){if(cssTree.generate(rule.prelude)!==':mobilemenu'||cssTree.generate(declaration.value)!=='1'||declaration.important)fail('header_menu_scroll_lock_directive');documentScrollLock=true;list.remove(item);}});}});
  cssTree.walk(ast, node => {
    if (['Raw', 'Url', 'NestingSelector'].includes(node.type) || node.type === 'Atrule') fail('header_menu_css');
    if (node.type === 'Declaration' && /^(content|behavior|-moz-binding|--)/i.test(node.property)) fail('header_menu_css');
    if (node.type === 'Rule') {
      if (node.prelude.type !== 'SelectorList') fail('header_menu_css');
      node.prelude.children.forEach(s => {
        if (s.type !== 'Selector') fail('header_menu_css');
        const nodes = s.children.toArray();
        if (nodes[0]?.type !== 'PseudoClassSelector' || nodes[0].name !== 'mobilemenu' || nodes[0].children || nodes.some(n => n.type === 'Combinator' && ['+', '~'].includes(n.name))) fail('header_menu_css_scope');
      });
    }
  });
  const families = compileHeaderModuleStyles({ css: '', fonts: plan.style.fonts }, { moduleKey: plan.moduleKey, headerId }).fontFamilies;
  const variables = Object.entries(families).map(([key, family]) => `--header-font-${key}:"${family}"`).join(';');
  const fixed = mobile.scroll && expectedHeader(mobile.scroll.views[0]).policy === 'fixed';
  // The native fullscreen opener changes the panel outside the header, not a
  // fabricated button class. Keep this cross-root state rule fixed and page-owned.
  const view=mobile.scroll?.views[0],menuHeight=view?.menuOpenHeight;
  const opened=`body.page-id-${pageId}:has(>.wd-fs-menu.wd-opened)`,root=`${opened} .whb-${headerId}`;
  const compact=fixed&&menuHeight&&mobile.scroll?.views.every(v=>v.menuOpenHeight===menuHeight&&v.menuOpenLogo===view.menuOpenLogo)
    ? `${opened}{overflow:hidden!important}${root}{height:${menuHeight}px!important}${root} .whb-main-header{height:${menuHeight}px!important}${view.menuOpenLogo==='hidden'?`${root} .whb-general-header{display:none!important}`:''}${opened} .wd-fs-menu{top:calc(${menuHeight}px + var(--clonewp-header-admin-offset,0px))!important;height:calc(100dvh - ${menuHeight}px - var(--clonewp-header-admin-offset,0px))!important}`:'';
  const rootLock=documentScrollLock?`html:has(>body.page-id-${pageId}>.wd-fs-menu.wd-opened){overflow:hidden!important}`:'';
  return `@media(max-width:${mobile.mobileMaxWidth}px){${variables ? `body.page-id-${pageId} .wd-fs-menu{${variables}}` : ''}${cssTree.generate(ast).replace(/:mobilemenu\b/g, `body.page-id-${pageId} .wd-fs-menu`)}${compact}${rootLock}}`;
}

/** Independent header CSS may include a phone-panel section after the header
 * owns one exact page. Keep both virtual roots under their existing compilers. */
export function splitResponsiveHeaderStyles(input:string):{headerCSS:string;menuCSS:string}{
 const ast=cssTree.parse(input,{onParseError(){fail('header_style_override_syntax')}}),header:cssTree.CssNode[]=[],menu:cssTree.CssNode[]=[];
 if(ast.type!=='StyleSheet')fail('header_style_override_syntax');
 ast.children.forEach(node=>{
  if(node.type==='Rule'&&node.prelude.type==='SelectorList'){
   const roots=node.prelude.children.toArray().map(s=>s.type==='Selector'&&s.children.first?.type==='PseudoClassSelector'?s.children.first.name:'');
   if(roots.every(r=>r==='mobilemenu')){menu.push(node);return;}
   if(roots.some(r=>r==='mobilemenu'))fail('header_menu_override_mixed_root');
  }else{cssTree.walk(node,n=>{if(n.type==='PseudoClassSelector'&&n.name==='mobilemenu')fail('header_menu_override_conditional')});}
  header.push(node);
 });
 return {headerCSS:header.map(n=>cssTree.generate(n)).join(''),menuCSS:menu.map(n=>cssTree.generate(n)).join('')};
}

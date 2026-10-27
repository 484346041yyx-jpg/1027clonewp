import { z } from 'zod';
import * as css from 'css-tree';
import { native44ModuleClass } from '../native44/adapters.js';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const viewport = { width: z.number().int().min(320).max(767), height: z.number().int().min(568).max(1200) };
const owner = { snapshotId: z.string().min(1), nodeId: z.string().min(1) };
const scrollPolicy = z.enum(['static', 'fixed', 'reveal-on-up']);
const override = { requestRef: z.string().trim().min(1), reason: z.string().trim().min(15) };
const evidenceRef = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const responsiveOwnedHeaderDecisionSchema = z.object({
  implementation: z.enum(['native', 'scoped-css']),
  flow: z.enum(['reserve-space', 'overlay']),
  views: z.array(z.object({ ...viewport, ...owner, interactionId: z.string().min(1), policy: scrollPolicy, offset: z.number().finite().min(0).max(200), menuOpenLogo: z.enum(['visible', 'hidden']).optional(), menuOpenHeight: z.number().finite().positive().max(400).optional(), override: z.object({ ...override, policy: scrollPolicy, offset: z.number().finite().min(0).max(200) }).strict().optional() }).strict()).length(2),
}).strict();
export const responsiveReadonlyHeaderDecisionSchema = z.object({
  mode: z.literal('reuse-readonly'), ...override,
  headerId: z.string().regex(/^header_[1-9]\d{0,17}$/), sharedHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: z.array(evidenceRef).min(1).max(20),
}).strict();
/** Frozen before jobs start. Values are source facts, except explicitly named
 * user overrides. Workers implement these decisions; they do not invent them. */
export const responsiveDecisionsSchema = z.object({
  version: z.literal(1),
  layouts: z.array(z.object({
    key, sectionKey: key, containerKey: key, iconKey: key, textKey: key,
    views: z.array(z.object({ ...viewport, ...owner, iconNodeId: z.string().min(1), textNodeId: z.string().min(1), arrangement: z.enum(['row', 'column']), gap: z.number().finite().nonnegative(), iconVisible: z.literal(true) }).strict()).length(2),
  }).strict()).max(2000),
  carousels: z.array(z.object({
    componentKey: key, sectionKey: key, nativeField: z.enum(['slides_per_view_mobile', 'columns_mobile']),
    presentation: z.literal('grid').optional(), conditional: z.literal(true).optional(),
    views: z.array(z.object({ ...viewport, ...owner, interactionId: z.string().min(1), visibleItems: z.number().int().min(0).max(12), columns: z.number().int().min(1).max(6).optional(), override: z.object({ ...override, visibleItems: z.number().int().min(1).max(12) }).strict().optional() }).strict()).length(2),
  }).strict()).max(2000),
  header: z.union([responsiveOwnedHeaderDecisionSchema, responsiveReadonlyHeaderDecisionSchema]),
}).strict();
export type ResponsiveDecisionPlan = z.infer<typeof responsiveDecisionsSchema>;
export type ResponsiveDecisions = Omit<ResponsiveDecisionPlan, 'header'> & { header: z.infer<typeof responsiveOwnedHeaderDecisionSchema> };
export type ResponsiveReadonlyHeaderIdentity = { headerId: string; sharedHash: string; headerHash: string; menuHash: string; styleHash: string };
export type ResponsiveDecisionContext = { version?: number; headerProvider?: string; reusedHeader?: ResponsiveReadonlyHeaderIdentity };
const fail = (code: string): never => { throw Error('replica_responsive_' + code); };
export const isReadonlyHeaderDecision = (header: ResponsiveDecisionPlan['header']): header is z.infer<typeof responsiveReadonlyHeaderDecisionSchema> => 'mode' in header && header.mode === 'reuse-readonly';
export function assertReadonlyHeaderDecisionScope(header: ResponsiveDecisionPlan['header'], context: ResponsiveDecisionContext = {}): void {
  if (!isReadonlyHeaderDecision(header)) return;
  if (!(context.version === 8 && context.headerProvider === undefined || context.version === 4 && context.headerProvider === 'reused-woodmart-header') || !context.reusedHeader || context.reusedHeader.headerId !== header.headerId || context.reusedHeader.sharedHash !== header.sharedHash) fail('readonly_header_scope');
}
export async function verifyReadonlyHeaderDecisionEvidence(header: ResponsiveDecisionPlan['header'], context: ResponsiveDecisionContext, read: (reference: z.infer<typeof evidenceRef>, base?: string) => Promise<{ filename: string; bytes: Buffer }>, base?: string): Promise<void> {
  if (!isReadonlyHeaderDecision(header)) return;
  assertReadonlyHeaderDecisionScope(header, context);
  const fields = ['headerId', 'sharedHash', 'headerHash', 'menuHash', 'styleHash'] as const; let resourceProven = false;
  for (const reference of header.evidence) {
    const file = await read(reference, base), document = JSON.parse(file.bytes.toString('utf8')), actual = document?.reusedHeader ?? document;
    if (!document?.reusedHeader && !fields.every(field => Object.hasOwn(actual ?? {}, field))) continue;
    if (!actual || fields.some(field => actual[field] !== context.reusedHeader![field])) fail('readonly_header_evidence');
    resourceProven = true;
  }
  if (!resourceProven) fail('readonly_header_evidence');
}
export const expectedItems = (view: ResponsiveDecisions['carousels'][number]['views'][number]) => view.override?.visibleItems ?? view.visibleItems;
export const expectedHeader = (view: ResponsiveDecisions['header']['views'][number]) => view.override ?? view;
export function assertDecisionViewports(decisions: ResponsiveDecisionPlan, views: Array<{ width: number; height: number }>) {
  const rows = [...decisions.layouts, ...decisions.carousels, ...(!isReadonlyHeaderDecision(decisions.header) ? [decisions.header] : [])];
  for (const row of rows) if (new Set(row.views.map(v => `${v.width}x${v.height}`)).size !== views.length || views.some(v => !row.views.some(r => r.width === v.width && r.height === v.height))) fail('decision_viewport_coverage');
  for (const values of [decisions.layouts.map(r => r.key), decisions.carousels.map(r => r.componentKey)]) if (new Set(values).size !== values.length) fail('decision_duplicate');
  for (const d of decisions.carousels) {
    if (d.presentation === 'grid' ? d.nativeField !== 'columns_mobile' || d.views.some(v => !v.columns || v.override || v.visibleItems === 0 && !d.conditional) : d.nativeField !== 'slides_per_view_mobile' || d.conditional || d.views.some(v => v.columns !== undefined || v.visibleItems < 1)) fail('product_presentation_contract');
  }
}
function gap(a: { x: number; y: number; width: number; height: number }, b: typeof a, arrangement: 'row' | 'column') { return arrangement === 'row' ? b.x - a.x - a.width : b.y - a.y - a.height; }
export function verifyDecisionSources(decisions: ResponsiveDecisionPlan, packets: ObservationPacketV2[], context: ResponsiveDecisionContext = {}) {
  assertReadonlyHeaderDecisionScope(decisions.header, context);
  const packetFor = (v: { snapshotId: string; nodeId: string; width: number; height: number }) => {
    const packet = packets.find(p => p.snapshot.id === v.snapshotId && p.snapshot.viewport.width === v.width && p.snapshot.viewport.height === v.height && p.nodes[v.nodeId]);
    if (!packet) return fail('decision_source_owner'); return packet;
  };
  for (const layout of decisions.layouts) for (const v of layout.views) {
    const p = packetFor(v), icon = p.nodes[v.iconNodeId], text = p.nodes[v.textNodeId];
    const beneath = (node: typeof icon) => { const seen = new Set<string>(); while (node && !seen.has(node.id)) { if (node.id === v.nodeId) return true; seen.add(node.id); node = p.nodes[node.parentId!]; } return false; };
    if (!icon?.visible || !text?.visible || !beneath(icon) || !beneath(text)) fail('layout_source_roles');
    const a = p.layouts[icon.layoutId].rect, b = p.layouts[text.layoutId].rect;
    const aligned = v.arrangement === 'row' ? Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) : Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x);
    if (!aligned || Math.abs(gap(a, b, v.arrangement) - v.gap) > 2) fail('layout_source_geometry');
    if (!Object.values(p.usages).some(u => u.visible && (u.nodeId === icon.id || (() => { let n = p.nodes[u.nodeId]; while (n?.parentId) { if (n.parentId === icon.id) return true; n = p.nodes[n.parentId]; } return false; })()))) fail('layout_source_icon_missing');
  }
  for (const carousel of decisions.carousels) for (const v of carousel.views) {
    const p = packetFor(v), interaction = p.interactions[v.interactionId];
    const grid = carousel.presentation === 'grid';
    if (!interaction || interaction.nodeId !== v.nodeId || interaction.kind !== (grid ? 'navigation' : 'carousel') || interaction.status !== 'observed' || interaction.details.visibleItems !== v.visibleItems || grid && (interaction.details.presentation !== 'grid' || interaction.details.columns !== v.columns)) fail('carousel_source_observation');
    const ownerRect = p.layouts[p.nodes[v.nodeId].layoutId].rect;
    const visible = [...new Set([...(interaction.itemNodeIds ?? []), ...(interaction.cloneNodeIds ?? [])])].filter(id => {
      const n = p.nodes[id], r = p.layouts[n.layoutId].rect;
      return n.visible && r.width > 0 && r.height > 0 && r.x >= ownerRect.x - 2 && r.x + r.width <= ownerRect.x + ownerRect.width + 2;
    });
    if (visible.length !== v.visibleItems) fail('carousel_source_geometry');
    if (grid) {
      const ids = interaction.itemNodeIds ?? [];
      const beneath = (id: string) => { const seen = new Set<string>(); let cursor: string | null = id; while (cursor && !seen.has(cursor)) { if (cursor === v.nodeId) return true; seen.add(cursor); cursor = p.nodes[cursor]?.parentId ?? null; } return false; };
      if (!ids.length || new Set(ids).size !== ids.length || interaction.cloneNodeIds?.length || ids.some(id => !beneath(id))) fail('grid_source_ownership');
      if (!visible.length) { if (!carousel.conditional || p.nodes[v.nodeId].visible || interaction.itemNodeIds?.length !== 1 || v.columns !== 1) fail('grid_source_hidden_contract'); }
      else {
        const rows = new Map<number, number>(); for (const id of visible) { const r = p.layouts[p.nodes[id].layoutId].rect, y = [...rows.keys()].find(y => Math.abs(y - r.y) < 3) ?? r.y; rows.set(y, (rows.get(y) ?? 0) + 1); }
        const counts = [...rows].sort((a, b) => a[0] - b[0]).map(row => row[1]);
        if (counts.length !== Math.ceil(visible.length / v.columns!) || counts.slice(0, -1).some(count => count !== v.columns) || counts.at(-1)! > v.columns!) fail('grid_source_columns');
      }
    }
  }
  if (isReadonlyHeaderDecision(decisions.header)) return;
  for (const v of decisions.header.views) {
    const p = packetFor(v), interaction = p.interactions[v.interactionId], d = interaction?.details;
    if (!interaction || interaction.nodeId !== v.nodeId || interaction.kind !== 'navigation' || interaction.status !== 'observed' || d?.scrollPolicy !== v.policy || d.offset !== v.offset || d.headerFlow !== decisions.header.flow || typeof d.contentTop !== 'number' || typeof d.downScrollY !== 'number' || d.downScrollY < p.snapshot.viewport.height || typeof d.upScrollY !== 'number' || d.upScrollY >= d.downScrollY || !['topY', 'downY', 'upY', 'menuOpenY'].every(k => typeof d[k] === 'number')) fail('header_source_scroll_observation');
    const headerHeight = p.layouts[p.nodes[v.nodeId].layoutId].rect.height;
    if (v.menuOpenLogo !== undefined && d.menuOpenLogoVisible !== (v.menuOpenLogo === 'visible') || v.menuOpenHeight !== undefined && (typeof d.menuOpenHeight !== 'number' || Math.abs(d.menuOpenHeight - v.menuOpenHeight) > 2)) fail('header_source_menu_layout');
    if (decisions.header.flow === 'reserve-space' ? Number(d.contentTop) < v.offset + headerHeight - 2 : Number(d.contentTop) >= v.offset + headerHeight) fail('header_source_content_flow');
    if (v.policy === 'fixed' && ['topY', 'downY', 'upY', 'menuOpenY'].some(k => Math.abs(Number(d[k]) - v.offset) > 2) || v.policy === 'static' && Number(d.downY) >= 0 || v.policy === 'reveal-on-up' && (Number(d.downY) >= 0 || Math.abs(Number(d.upY) - v.offset) > 2)) fail('header_source_scroll_geometry');
  }
}
/** Reject positional container rules even when inherited from desktop CSS.
 * Desktop-only media rules are preserved; native widget-internal selectors are
 * outside this container-role guard. Stable role/component classes survive the
 * editor's extra child nodes. */
export function assertStableContainerCSS(input: string, containerClasses: Set<string>, mobileMaxWidth: number) {
  const ast = css.parse(input); let desktopDepth = 0;
  const desktopRules = new Set<css.CssNode>();
  css.walk(ast, {
    enter(node: css.CssNode) {
      if (node.type === 'Atrule' && node.name.toLowerCase() === 'media') {
        const q = css.generate(node.prelude!);
        if (!q.includes(',') && !/\bnot\b|\bor\b/i.test(q) && [...q.matchAll(/min-width\s*:\s*(\d+)px/gi)].some(m => Number(m[1]) > mobileMaxWidth)) { desktopRules.add(node); desktopDepth++; }
      }
      if (node.type !== 'Rule' || desktopDepth || node.prelude.type !== 'SelectorList') return;
      node.prelude.children.forEach(selector => {
        let owner = false, positional = false;
        css.walk(selector, n => {
          if (n.type === 'ClassSelector' && containerClasses.has(css.ident.decode(n.name))) owner = true;
          if (n.type === 'PseudoClassSelector' && /^(first|last|only|nth|nth-last)-(child|of-type)$/i.test(css.ident.decode(n.name))) positional = true;
        });
        if (owner && positional) fail('unstable_container_selector');
      });
    },
    leave(node: css.CssNode) { if (desktopRules.has(node)) desktopDepth--; },
  });
}
export function assertDecisionProgram(program: Native44Program, decisions: ResponsiveDecisionPlan, mobileMaxWidth: number, cssInput: string) {
  const nodes = walkNative44(program.blocks), byKey = new Map(nodes.map(n => [n.key, n]));
  const phoneNodes = walkNative44(program.blocks.filter(n => n.kind !== 'composite' || n.settings?.hide_mobile !== 'hidden-mobile'));
  const targetKey = (section: string, key: string) => program.blocks.some(n => n.key === section && n.kind === 'composite' && n.settings?.hide_mobile === 'hidden-mobile') && byKey.has(section + '_phone') ? key + '_phone' : key;
  for (const row of [...decisions.layouts, ...decisions.carousels]) if (!program.blocks.some(b => b.key === row.sectionKey)) fail('decision_section_owner');
  for (const layout of decisions.layouts) {
    const container = byKey.get(targetKey(layout.sectionKey, layout.containerKey)), icon = byKey.get(targetKey(layout.sectionKey, layout.iconKey)), text = byKey.get(targetKey(layout.sectionKey, layout.textKey));
    if (container?.kind !== 'composite' || !icon || !text || icon === text || !walkNative44([container]).includes(icon) || !walkNative44([container]).includes(text) || !walkNative44([program.blocks.find(b => b.key === targetKey(layout.sectionKey, layout.sectionKey))!]).includes(container)) return fail('layout_target_roles');
    const direction = container.settings?.flex_direction_mobile;
    if (direction !== undefined && layout.views.some(v => v.arrangement !== direction)) fail('layout_native_direction_mismatch');
  }
  const iconRoles = new Set(decisions.layouts.map(d => targetKey(d.sectionKey, d.iconKey)));
  for (const n of phoneNodes) if (n.kind === 'native' && ['icon', 'icon-box'].includes(n.widgetType) && ![...iconRoles].some(k => walkNative44([byKey.get(k)!]).includes(n))) fail('icon_layout_decision_missing');
  const declared = new Set(decisions.carousels.map(c => c.componentKey));
  // Product grids opt in to their own registered column field and observed
  // navigation-item geometry. Historical carousel decisions keep their meaning.
  for (const n of phoneNodes) if (n.kind === 'native-products' && !declared.has(n.key)) fail('product_count_decision_missing');
  for (const carousel of decisions.carousels) {
    const n = byKey.get(carousel.componentKey);
    if (!n || n.kind !== 'native-products') return fail('carousel_target_owner');
    if (!walkNative44([program.blocks.find(b => b.key === carousel.sectionKey)!]).includes(n)) fail('carousel_target_owner');
    const grid = carousel.presentation === 'grid';
    if (grid && (n.widgetType !== 'wd_products' || n.widgetSettings.layout !== 'grid') || !grid && n.widgetSettings.layout === 'grid') fail('product_native_layout_mismatch');
    if (grid && carousel.conditional && n.query?.ids.length !== 1) fail('grid_conditional_single_product_required');
    const desired = carousel.views.map(v => grid ? v.columns! : expectedItems(v));
    if (new Set(desired).size !== 1) fail('carousel_count_native_adapter_required');
    const value = n.widgetSettings[carousel.nativeField];
    const count = typeof value === 'number' ? value : value && typeof value === 'object' ? (value as { size?: unknown }).size : undefined;
    if (Number(count) !== desired[0]) fail('carousel_count_plan_mismatch');
  }
  const containers = phoneNodes.filter(n => n.kind === 'composite');
  const classes = new Set(['e-con', 'e-con-inner', 'elementor-element', ...containers.map(n => native44ModuleClass(n.key)), ...containers.flatMap(n => ['css_classes', '_css_classes'].flatMap(field => typeof n.settings?.[field] === 'string' ? String(n.settings[field]).split(/\s+/).filter(Boolean) : []))]);
  assertStableContainerCSS(cssInput, classes, mobileMaxWidth);
  for (const n of nodes) {
    if (n.kind === 'html-static') { assertStableContainerCSS(n.css, classes, mobileMaxWidth); if (n.responsiveCss) assertStableContainerCSS(n.responsiveCss, classes, mobileMaxWidth); }
    const settings = n.kind === 'composite' ? n.settings : 'widgetSettings' in n ? n.widgetSettings : undefined;
    if (typeof settings?.custom_css === 'string') assertStableContainerCSS(settings.custom_css.replace(/\bselector\b/g, '.selector'), new Set([...classes, 'selector']), mobileMaxWidth);
  }
}

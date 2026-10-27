import path from 'node:path';
import { z } from 'zod';
import sharp from 'sharp';
import { parse } from 'parse5';
import { native44Id } from '../native44/adapters.js';
import { expectedHeader, expectedItems, isReadonlyHeaderDecision, verifyReadonlyHeaderDecisionEvidence, type ResponsiveDecisionPlan, type ResponsiveDecisionContext } from './decisions.js';
import {NATIVE_VIEWPORT_CAPTURE,nativeViewportRasterMapping} from '../core/native-viewport-raster.js';

const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict();
const role = z.object({ id: z.string().min(1), rect, display: z.string().min(1), opacity: z.number().min(0).max(1) }).strict();
/** Measured DOM geometry plus the exact raster for both frontend and editor
 * canvas. Counts are derived from item rectangles, never pass/count booleans. */
export const responsiveDecisionObservationSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-responsive-decision-observation'),
  pageId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(), clientWidth: z.number().int().positive(),
  surface: z.enum(['frontend', 'editor']), observedAt: z.string().datetime(), html: z.string().min(1), screenshot: ref,
  captureMode:z.literal(NATIVE_VIEWPORT_CAPTURE).optional(),
  layouts: z.array(z.object({ key: z.string(), scrollY: z.number().finite().nonnegative(), screenshot: ref, container: role, icon: role, text: role }).strict()).max(2000),
  carousels: z.array(z.object({ componentKey: z.string(), id: z.string(), scrollY: z.number().finite().nonnegative(), screenshot: ref, viewport: rect, items: z.array(z.object({ index: z.number().int().nonnegative(), rect, display: z.string(), opacity: z.number().min(0).max(1) }).strict()).min(1).max(2000) }).strict()).max(2000),
  header: z.object({ id: z.string(), contentTop: z.number().finite(), states: z.array(z.object({
    state: z.enum(['top', 'down', 'up', 'menu-open']), scrollY: z.number().finite().nonnegative(), observedAt: z.string().datetime(),
    browserOffset: z.number().finite().min(0).max(200), header: rect, logo: rect, menu: rect,
    position: z.enum(['fixed', 'sticky', 'static', 'relative', 'absolute']), screenshot: ref,
  }).strict()).length(4) }).strict(),
}).strict();
type Ref = z.infer<typeof ref>;
type Read = (r: Ref, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
const fail = (code: string): never => { throw Error('replica_responsive_' + code); };
const visible = (box: z.infer<typeof role>) => !['none', 'hidden'].includes(box.display) && box.opacity > 0 && box.rect.width > 0 && box.rect.height > 0;
const inside = (a: z.infer<typeof rect>, b: z.infer<typeof rect>, epsilon = 2) => a.x >= b.x - epsilon && a.y >= b.y - epsilon && a.x + a.width <= b.x + b.width + epsilon && a.y + a.height <= b.y + b.height + epsilon;

export async function verifyResponsiveDecisionReview(refs: Ref[], decisions: ResponsiveDecisionPlan, views: Array<{ width: number; height: number }>, identity: { taskId: string; pageId: number; fingerprint: string; headerId: string; observedAt: string } & ResponsiveDecisionContext, read: Read, base: string, duplicatedSections: string[] = []) {
  const targetKey = (section: string, key: string) => duplicatedSections.includes(section) ? key + '_phone' : key;
  await verifyReadonlyHeaderDecisionEvidence(decisions.header, identity, read, base);
  if (isReadonlyHeaderDecision(decisions.header) && identity.headerId !== decisions.header.headerId) fail('decision_review_readonly_header_identity');
  if (refs.length !== views.length * 2 || new Set(refs.map(r => r.sha256)).size !== refs.length) fail('decision_review_surfaces');
  const records: Array<z.infer<typeof responsiveDecisionObservationSchema>> = [];
  for (const r of refs) {
    const file = await read(r, base), actual = responsiveDecisionObservationSchema.parse(JSON.parse(file.bytes.toString('utf8')));
    const fresh = (when: string) => Date.parse(when) <= Date.parse(identity.observedAt) && Date.parse(identity.observedAt) - Date.parse(when) <= 3600000;
    if (actual.pageId !== identity.pageId || actual.fingerprint !== identity.fingerprint || !fresh(actual.observedAt) || actual.clientWidth > actual.width || actual.width - actual.clientWidth > 24 || !views.some(v => v.width === actual.width && v.height === actual.height)) fail('decision_review_identity');
    if (records.some(r => r.surface === actual.surface && r.width === actual.width && r.height === actual.height)) fail('decision_review_surface_duplicate');
    records.push(actual);
    const wantedIds = new Set([...decisions.layouts.flatMap(d => [d.containerKey, d.iconKey, d.textKey].map(k => targetKey(d.sectionKey, k))), ...decisions.carousels.map(d => d.componentKey)].map(k => native44Id(identity.taskId, k)));
    const root = parse(actual.html), byId = new Map<string, any>(), instances=new Map<string,any[]>(), ancestors = new Map<any, any>(); let body = false, header = false, editor = false, adminBarElement = false, adminBarClass = false;
    const visit = (n: any, parent?: any) => {
      if (parent) ancestors.set(n, parent);
      const a = Object.fromEntries((n.attrs ?? []).map((a: any) => [a.name, a.value]));
      if (wantedIds.has(a['data-id'])) instances.set(a['data-id'],[...(instances.get(a['data-id'])??[]),n]);
      const classes = String(a.class ?? '').split(/\s+/);
      if (a.id === 'wpadminbar') adminBarElement = true;
      if (n.tagName === 'body' && classes.includes('admin-bar')) adminBarClass = true;
      if (classes.includes(`elementor-${identity.pageId}`) && a['data-elementor-id'] === String(identity.pageId)) body = true;
      if (classes.includes(`whb-${identity.headerId}`)) header = true;
      if (classes.includes('elementor-editor-active')) editor = true;
      for (const child of n.childNodes ?? []) visit(child, n);
    }; visit(root);
    const attrs=(n:any)=>Object.fromEntries((n?.attrs??[]).map((a:any)=>[a.name,a.value]));
    const closest=(n:any,cls:string):any=>{while(n){if(String(attrs(n).class??'').split(/\s+/).includes(cls))return n;n=ancestors.get(n);}return null;};
    const clone=(n:any)=>closest(n,'swiper-slide-duplicate');
    for(const[id,nodes]of instances){
      const originals=nodes.filter(n=>!clone(n));if(originals.length!==1)fail('decision_review_duplicate_id');const original=originals[0];byId.set(id,original);
      for(const n of nodes.filter(n=>clone(n))){
        const a=attrs(n),b=attrs(original),slide=closest(n,'swiper-slide'),originalSlide=closest(original,'swiper-slide'),carrier=closest(n,'e-n-carousel'),originalCarrier=closest(original,'e-n-carousel');let widget=carrier;while(widget&&attrs(widget)['data-widget_type']!=='nested-carousel.default')widget=ancestors.get(widget);
        let settings:any;try{settings=JSON.parse(attrs(widget)['data-settings']??'{}');}catch{fail('decision_review_duplicate_id');}
        const index=attrs(slide)['data-swiper-slide-index'];
        if(!carrier||carrier!==originalCarrier||!slide||!originalSlide||!/^\d+$/.test(index??'')||index!==attrs(originalSlide)['data-swiper-slide-index']||settings.infinite!=='yes'||a['data-element_type']!==b['data-element_type']||a['data-widget_type']!==b['data-widget_type'])fail('decision_review_duplicate_id');
      }
    }
    if (!body || !header || actual.surface === 'editor' && !editor || actual.surface === 'frontend' && editor) fail('decision_review_dom_surface');
    const descendant = (id: string, owner: string) => { let n = byId.get(id); while (n) { if (n === byId.get(owner)) return true; n = ancestors.get(n); } return false; };
    const raster = await read(actual.screenshot, path.dirname(file.filename)), meta = await sharp(raster.bytes).metadata();
    if (meta.width !== actual.clientWidth || !nativeViewportRasterMapping(meta,actual,actual.captureMode)) fail('decision_review_raster');
    const readCanvas = async (ref: Ref) => {
      const image = await read(ref, path.dirname(file.filename)), metadata = await sharp(image.bytes).metadata();
      const mapping=nativeViewportRasterMapping(metadata,actual,actual.captureMode);
      if (metadata.width !== actual.clientWidth || !mapping) fail('decision_review_canvas_raster');
      return { bytes: image.bytes, width: metadata.width!, height: metadata.height!,mapping:mapping! };
    };
    if (new Set(actual.layouts.map(r => r.key)).size !== decisions.layouts.length || actual.layouts.length !== decisions.layouts.length) fail('decision_review_layout_coverage');
    for (const d of decisions.layouts) {
      const row = actual.layouts.find(r => r.key === d.key), expected = d.views.find(v => v.width === actual.width && v.height === actual.height)!;
      if (!row) return fail('decision_review_layout_coverage');
      const canvas = await readCanvas(row.screenshot), frame = { x: 0, y: 0, width: actual.clientWidth, height: actual.height };
      const ownerId = native44Id(identity.taskId, targetKey(d.sectionKey, d.containerKey));
      if (!row || row.container.id !== ownerId || row.icon.id !== native44Id(identity.taskId, targetKey(d.sectionKey, d.iconKey)) || row.text.id !== native44Id(identity.taskId, targetKey(d.sectionKey, d.textKey)) || !descendant(row.icon.id, ownerId) || !descendant(row.text.id, ownerId) || ![row.container, row.icon, row.text].every(visible) || !inside(row.icon.rect, row.container.rect) || !inside(row.text.rect, row.container.rect)) fail('decision_review_layout_roles');
      const a = row.icon.rect, b = row.text.rect;
      if (!inside(a, frame) || !inside(b, frame)) fail('decision_review_layout_outside_canvas');
      const spacing = expected.arrangement === 'row' ? b.x - a.x - a.width : b.y - a.y - a.height;
      const overlap = expected.arrangement === 'row' ? Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) : Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      if (overlap <= 0 || Math.abs(spacing - expected.gap) > 3) fail('decision_review_layout_geometry');
      // An empty/white icon box can pass geometry. Require visible raster detail
      // in the icon's own measured crop as well, including the editor canvas.
      const left = Math.max(0, Math.ceil((a.x + a.width * .2)*canvas.mapping.x)), top = Math.max(0, Math.ceil((a.y + a.height * .2)*canvas.mapping.y));
      const width = Math.min(Math.floor(a.width * .6*canvas.mapping.x), canvas.width - left), height = Math.min(Math.floor(a.height * .6*canvas.mapping.y), canvas.height - top);
      if (width < 2 || height < 2) fail('decision_review_icon_crop');
      const stats = await sharp(canvas.bytes).extract({ left, top, width, height }).removeAlpha().stats();
      if (stats.channels.every(c => c.stdev < 2)) fail('decision_review_icon_not_painted');
    }
    if (new Set(actual.carousels.map(r => r.componentKey)).size !== decisions.carousels.length || actual.carousels.length !== decisions.carousels.length) fail('decision_review_carousel_coverage');
    for (const d of decisions.carousels) {
      const row = actual.carousels.find(r => r.componentKey === d.componentKey), expected = d.views.find(v => v.width === actual.width && v.height === actual.height)!;
      if (!row) return fail('decision_review_carousel_coverage');
      await readCanvas(row.screenshot);
      const dormant = d.presentation === 'grid' && d.conditional && expected.visibleItems === 0;
      if (!dormant && !inside(row.viewport, { x: 0, y: 0, width: actual.clientWidth, height: actual.height })) fail('decision_review_carousel_outside_canvas');
      if (!row || row.id !== native44Id(identity.taskId, d.componentKey) || !byId.has(row.id) || new Set(row.items.map(i => i.index)).size !== row.items.length || !dormant && row.viewport.width < 1) fail('decision_review_carousel_identity');
      // Indexes identify rendered instances, including loop clones whose catalog IDs repeat.
      const count = row.items.filter(i => i.display !== 'none' && i.opacity > 0 && i.rect.width > 0 && i.rect.height > 0 && inside(i.rect, row.viewport)).length;
      if (count !== expectedItems(expected)) fail('decision_review_carousel_count');
      if (d.presentation === 'grid' && count > 0) {
        const rows = new Map<number, number>(); for (const item of row.items.filter(i => i.display !== 'none' && i.opacity > 0 && i.rect.width > 0 && i.rect.height > 0 && inside(i.rect, row.viewport))) { const y = [...rows.keys()].find(y => Math.abs(y - item.rect.y) < 3) ?? item.rect.y; rows.set(y, (rows.get(y) ?? 0) + 1); }
        const counts = [...rows].sort((a, b) => a[0] - b[0]).map(row => row[1]);
        if (counts.length !== Math.ceil(count / expected.columns!) || counts.slice(0, -1).some(count => count !== expected.columns) || counts.at(-1)! > expected.columns!) fail('decision_review_grid_columns');
      }
      const rendered: any[] = [];
      const scanItems = (n: any) => { const cls = n.attrs?.find((a: any) => a.name === 'class')?.value ?? ''; if (String(cls).split(/\s+/).some(c => (d.presentation === 'grid' ? ['product-grid-item'] : ['wd-carousel-item', 'swiper-slide']).includes(c))) rendered.push(n); for (const child of n.childNodes ?? []) scanItems(child); };
      scanItems(byId.get(row.id));
      if (row.items.length !== rendered.length || row.items.some(i => i.index >= rendered.length)) fail('decision_review_carousel_item_dom');
    }
    const readonlyHeader = isReadonlyHeaderDecision(decisions.header), sourceHeader = !isReadonlyHeaderDecision(decisions.header) ? decisions.header.views.find(v => v.width === actual.width && v.height === actual.height)! : undefined;
    const policy = sourceHeader ? expectedHeader(sourceHeader) : undefined;
    if (actual.header.id !== identity.headerId || new Set(actual.header.states.map(s => s.state)).size !== 4) fail('decision_review_header_states');
    const top = actual.header.states.find(s => s.state === 'top')!, down = actual.header.states.find(s => s.state === 'down')!, up = actual.header.states.find(s => s.state === 'up')!, menu = actual.header.states.find(s => s.state === 'menu-open')!;
    if (!isReadonlyHeaderDecision(decisions.header) && (decisions.header.flow === 'reserve-space' ? actual.header.contentTop < top.header.y + top.header.height - 2 : actual.header.contentTop >= top.header.y + top.header.height)) fail('decision_review_header_content_flow');
    if (top.scrollY > 1 || down.scrollY < actual.height || up.scrollY >= down.scrollY || Date.parse(top.observedAt) > Date.parse(down.observedAt) || Date.parse(down.observedAt) > Date.parse(up.observedAt)) fail('decision_review_scroll_sequence');
    for (const state of actual.header.states) {
      if ((!adminBarElement || !adminBarClass) && state.browserOffset !== 0) fail('decision_review_phantom_browser_offset');
      if (!fresh(state.observedAt) || Date.parse(state.observedAt) > Date.parse(actual.observedAt)) fail('decision_review_scroll_stale');
      const image = await read(state.screenshot, path.dirname(file.filename)), metadata = await sharp(image.bytes).metadata();
      if (metadata.width !== actual.clientWidth || !nativeViewportRasterMapping(metadata,actual,actual.captureMode)) fail('decision_review_scroll_raster');
      const hiddenLogo = state.state === 'menu-open' && (sourceHeader?.menuOpenLogo === 'hidden' || readonlyHeader && state.logo.width === 0 && state.logo.height === 0);
      if ((!hiddenLogo && (!inside(state.logo, state.header) || state.logo.width < 1)) || hiddenLogo && (state.logo.width > 0 || state.logo.height > 0) || !inside(state.menu, state.header) || state.menu.width < 1) fail('decision_review_whole_header');
      if (state.state === 'menu-open' && sourceHeader?.menuOpenHeight !== undefined && Math.abs(state.header.height - sourceHeader.menuOpenHeight) > 3) fail('decision_review_menu_header_height');
      const shouldShow = policy?.policy === 'fixed' || state.state === 'top' || policy?.policy === 'reveal-on-up' && ['up', 'menu-open'].includes(state.state);
      if (policy && shouldShow && (Math.abs(state.header.y - state.browserOffset - policy.offset) > 2 || state.header.height < 1 || state.header.y + state.header.height > actual.height)) fail('decision_review_header_not_fixed');
      if (policy?.policy === 'fixed' && !['fixed', 'sticky'].includes(state.position)) fail('decision_review_header_position');
      if (readonlyHeader && ['top', 'menu-open'].includes(state.state) && (state.header.width < 1 || state.header.height < 1 || !inside(state.header, { x: 0, y: 0, width: actual.clientWidth, height: actual.height }))) fail('decision_review_readonly_header_visibility');
    }
    if (policy?.policy === 'static' && down.header.y + down.header.height >= 0 || policy?.policy === 'reveal-on-up' && down.header.y + down.header.height >= 0) fail('decision_review_header_scroll_policy');
    if (policy?.policy === 'fixed' && sourceHeader?.menuOpenLogo !== 'hidden' && Math.abs(menu.logo.y - top.logo.y) > 2) fail('decision_review_logo_drift');
    if (readonlyHeader && menu.screenshot.sha256 === top.screenshot.sha256) fail('decision_review_readonly_menu_change');
  }
}

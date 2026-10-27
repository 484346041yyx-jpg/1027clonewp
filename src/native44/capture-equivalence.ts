import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import { native44BodyCaptureScopeForSnapshot, type Native44BodyCaptureScope } from './capture-scope.js';

/** Compare an auxiliary expanded raster with the two required desktop
 * observations. Original facts are retained; no resize or fabricated pixels
 * can establish this proof. Pure viewport-width backgrounds are compared by
 * their exact visible coverage, while every descendant is checked separately.
 */
export function assertExpandedCaptureEquivalent(original: ObservationPacketV2[], expanded: ObservationPacketV2[], options: {clip?:{top:number;height:number};bodyScope?:Native44BodyCaptureScope} = {}): void {
  const merge = (packets: ObservationPacketV2[]) => ({
    nodes: Object.assign({}, ...packets.map(packet => packet.nodes)) as ObservationPacketV2['nodes'],
    layouts: Object.assign({}, ...packets.map(packet => packet.layouts)) as ObservationPacketV2['layouts'],
    styles: Object.assign({}, ...packets.map(packet => packet.styles)) as ObservationPacketV2['styles'],
    texts: packets.flatMap(packet => Object.values(packet.texts)),
    usages: packets.flatMap(packet => Object.values(packet.usages)),
    resources: Object.assign({}, ...packets.map(packet => packet.resources)) as ObservationPacketV2['resources'],
  });
  if (!original.length || !expanded.length) throw Error('Expanded capture needs actual desktop and auxiliary packets');
  const a = merge(original), b = merge(expanded), source = original[0].snapshot, raster = expanded[0].snapshot;
  const scope = options.bodyScope ? native44BodyCaptureScopeForSnapshot(options.bodyScope, original, source.id) : undefined;
  if (scope) {
    // Associate the auxiliary facts with the original scope row for validation
    // only. Their actual snapshot identity and all retained facts stay intact.
    native44BodyCaptureScopeForSnapshot(options.bodyScope!, expanded.map(packet => ({ ...packet, snapshot: { ...packet.snapshot, id: source.id } })), source.id);
    const selectedRegions = options.bodyScope!.selection ? new Set(options.bodyScope!.snapshots.find(row => row.snapshotId === source.id)!.bodyRegionIds) : undefined;
    const regionIdentity = (packets: ObservationPacketV2[]) => [...new Map(packets.flatMap(packet => packet.regions).filter(region => !selectedRegions || selectedRegions.has(region.id)).map(region => [region.id, [region.id, region.nodeId, region.role, region.order, region.contentNodeId]])).values()].sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    if (JSON.stringify(regionIdentity(original)) !== JSON.stringify(regionIdentity(expanded))) throw Error('Expanded capture changed scoped region ownership');
    if (selectedRegions) {
      // The complete original and auxiliary packets remain immutable. Only
      // the explicitly selected output subtree participates in this rendering
      // equivalence proof; unrelated live counters/carousels are not outputs.
      a.nodes = Object.fromEntries(Object.entries(a.nodes).filter(([, node]) => selectedRegions.has(node.regionId)));
      b.nodes = Object.fromEntries(Object.entries(b.nodes).filter(([, node]) => selectedRegions.has(node.regionId)));
    }
  }
  const direct = raster.viewport.width === source.viewport.clientWidth && raster.viewport.height === source.pageHeight && raster.viewport.scrollbarWidth === 0;
  const tall = raster.viewport.width === source.viewport.width && raster.viewport.height >= source.viewport.height && raster.viewport.scrollbarWidth === source.viewport.scrollbarWidth;
  if (source.url !== raster.url || (!direct && !tall) || raster.viewport.clientWidth !== source.viewport.clientWidth || !scope && raster.pageHeight !== source.pageHeight || raster.viewport.devicePixelRatio !== source.viewport.devicePixelRatio) throw Error('Expanded raster does not preserve the exact source content width/page height');
  if (scope && !options.clip) for (const id of scope.includedNodeIds) {
    const node = b.nodes[id], layout = node && b.layouts[node.layoutId];
    if (!node || !layout || node.visible && [layout.rect, layout.contentRect, ...(layout.captureGeometry ? [layout.captureGeometry.rect, layout.captureGeometry.contentRect] : [])].some(rect => rect.y < 0 || rect.y + rect.height > raster.viewport.height)) throw Error(`Expanded capture does not cover scoped body geometry: ${id}`);
  }
  if (JSON.stringify(Object.keys(a.nodes).sort()) !== JSON.stringify(Object.keys(b.nodes).sort())) throw Error('Expanded capture changed source node identities');
  const geometry = (layout: ObservationPacketV2['layouts'][string]) => layout.captureGeometry ?? layout;
  const paintProperties = ['display', 'position', 'visibility', 'opacity', 'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'white-space', 'border-radius', 'border-width', 'border-color', 'border-style', 'box-shadow', 'overflow', 'object-fit', 'object-position', 'z-index', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-iteration-count'];
  const clipPaintProperties = ['text-shadow', 'filter', 'backdrop-filter', '-webkit-box-reflect', 'mix-blend-mode', 'outline-style', 'outline-width', 'border-image-outset'];
  const coverage = (rect: {x:number;y:number;width:number;height:number}) => [Math.max(0, rect.x), rect.y, Math.min(source.viewport.clientWidth, rect.x + rect.width), rect.height];
  // A clipped frame can exclude a sticky header in both observations. Its
  // viewport state need not match, but a border box alone does not bound
  // shadows, generated content, group effects, or an overflowing descendant.
  // Require explicit no-bleed facts; older packets without them get no waiver.
  const noGroupEffects = (style: Record<string, string>) => ['filter', 'backdrop-filter', '-webkit-box-reflect'].every(property => style[property] === 'none') && style['mix-blend-mode'] === 'normal';
  const zeroLengths = (value: string | undefined) => /^0(?:px)?(?:\s+0(?:px)?){0,3}$/.test(value ?? '');
  const boundedEffects = (style: Record<string, string>) => noGroupEffects(style) &&
    style['box-shadow'] === 'none' && style['text-shadow'] === 'none' &&
    typeof style['outline-style'] === 'string' && typeof style['outline-width'] === 'string' &&
    (style['outline-style'] === 'none' || /^0(?:px)?$/.test(style['outline-width'])) &&
    zeroLengths(style['border-image-outset']);
  const boundedPseudo = (style: Record<string, string>, pseudo: string, rect: {width:number;height:number}) => {
    const content = style[`${pseudo}:content`];
    if (['none', 'normal'].includes(content)) return true;
    const own = Object.fromEntries(Object.entries(style).filter(([key]) => key.startsWith(`${pseudo}:`)).map(([key, value]) => [key.slice(pseudo.length + 1), value]));
    if (own.position !== 'static' || own.transform !== 'none' || !boundedEffects(own) ||
      own['background-image'] !== 'none' || !/^(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\))$/.test(own['background-color'] ?? '') ||
      !zeroLengths(own['border-width']) || !/^(?:none)(?:\s+none){0,3}$/.test(own['border-style'] ?? '') ||
      !['margin', 'padding'].every(kind => ['top', 'right', 'bottom', 'left'].every(side => zeroLengths(own[`${kind}-${side}`]))) ||
      !['visible', 'hidden', 'clip'].includes(own.overflow)) return false;
    const within = (value: string | undefined, maximum: number) => value === 'auto' || /^\d+(?:\.\d+)?px$/.test(value ?? '') && Number.parseFloat(value!) <= maximum;
    if (!within(own.width, rect.width) || !within(own.height, rect.height)) return false;
    // Empty static clear-fix boxes have no own paint under the conditions
    // above. A static inline font glyph uses the same originating-box model
    // as ordinary text; this does not claim to measure exact font ink extents.
    if (['""', "''"].includes(content)) return ['table', 'block', 'inline', 'inline-block', 'flow-root'].includes(own.display);
    return /^(?:"[^"]+"|'[^']+')$/.test(content ?? '') && own.display === 'inline' &&
      /^\d+(?:\.\d+)?px$/.test(own['font-size'] ?? '') && Number.parseFloat(own['font-size']) > 0 &&
      (own['line-height'] === 'normal' || own['line-height'] !== 'auto' && within(own['line-height'], rect.height));
  };
  const boundedPaint = (style: Record<string, string>, rect: {width:number;height:number}) => boundedEffects(style) && ['before', 'after'].every(pseudo => boundedPseudo(style, pseudo, rect));
  const hiddenOwnPaint = (nodes: Array<ObservationPacketV2['nodes'][string]>) => {
    const styles = nodes.map((node, index) => (index === 0 ? a : b).styles[node.styleId]);
    return nodes.every(node => !node.visible) && styles[0].visibility === styles[1].visibility && ['hidden', 'collapse'].includes(styles[0].visibility) &&
      styles.every(style => ['before', 'after'].every(pseudo => ['none', 'normal'].includes(style[`${pseudo}:content`]) || ['hidden', 'collapse'].includes(style[`${pseudo}:visibility`])));
  };
  const outside = (rect: {y:number;height:number}) => Boolean(options.clip && (rect.y + rect.height < options.clip.top || rect.y > options.clip.top + options.clip.height));
  const outsideTreeCache = new Map<string, boolean>();
  const outsideTree = (id: string): boolean => {
    if (outsideTreeCache.has(id)) return outsideTreeCache.get(id)!;
    outsideTreeCache.set(id, false);
    const nodes = [a.nodes[id], b.nodes[id]];
    const hidden = hiddenOwnPaint(nodes);
    if (nodes.some((node, index) => {
      const set = index === 0 ? a : b, layout = set.layouts[node.layoutId], style = set.styles[node.styleId];
      return hidden ? !noGroupEffects(style) : ![layout.rect, layout.contentRect, geometry(layout).rect, geometry(layout).contentRect].every(outside) || !boundedPaint(style, layout.rect) ||
        // SVG descendants are serialized as one media resource, so their own
        // overflow cannot be proven by independently checking child boxes.
        (node.tag === 'svg' && !['hidden', 'clip'].includes(style.overflow));
    })) return false;
    if ([...new Set(nodes.flatMap(node => node.childIds))].some(child => !outsideTree(child))) return false;
    outsideTreeCache.set(id, true);
    return true;
  };
  const excludedPaint = (id: string) => {
    if (!options.clip || !outsideTree(id)) return false;
    for (const set of [a, b]) {
      let parent = set.nodes[id].parentId;
      const seen = new Set<string>();
      while (parent) {
        if (seen.has(parent) || !noGroupEffects(set.styles[set.nodes[parent].styleId])) return false;
        seen.add(parent); parent = set.nodes[parent].parentId;
      }
    }
    return true;
  };
  const displayNoneAncestor = (set: typeof a, id: string) => {
    let current: string | null = id;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      const node: ObservationPacketV2['nodes'][string] = set.nodes[current];
      if (set.styles[node.styleId].display === 'none' && set.layouts[node.layoutId].display === 'none') return true;
      current = node.parentId;
    }
    return false;
  };
  // A subtree hidden by its own visibility paints no pixels in either raster, so viewport-driven popup sizes cannot
  // change the proof. Copy, media and structure of such nodes are still compared above; in-flow shifts show on siblings.
  // An out-of-flow subtree wholly left or right of the page in both rasters (an off-canvas drawer) paints no pixels either.
  const outsidePage = (rect: { x: number; width: number }) => rect.x + rect.width <= 0 || rect.x >= source.viewport.clientWidth;
  const shadowsStayOffPage = (value: string | undefined, rect: { x: number; width: number }, withSpread: boolean) => {
    const shadow = value ?? 'none';
    if (shadow === 'none') return true;
    const parts: string[] = []; let depth = 0, start = 0;
    for (let index = 0; index < shadow.length; index++) { if (shadow[index] === '(') depth++; else if (shadow[index] === ')') depth--; else if (shadow[index] === ',' && depth === 0) { parts.push(shadow.slice(start, index)); start = index + 1; } }
    parts.push(shadow.slice(start));
    return parts.every(part => {
      if (/\binset\b/.test(part)) return withSpread;
      const lengths = [...part.replace(/rgba?\([^)]*\)/g, '').matchAll(/(-?\d*\.?\d+)(?:px)?/g)].map(match => Number(match[1]));
      if (lengths.length < 2 || lengths.length > (withSpread ? 4 : 3) || lengths.some(value => !Number.isFinite(value))) return false;
      const [x, , blur = 0, spread = 0] = lengths, reach = Math.max(0, blur) + (withSpread ? spread : 0);
      return rect.x + rect.width + x + reach <= 0 || rect.x + x - reach >= source.viewport.clientWidth;
    });
  };
  const offCanvasEffects = (style: Record<string, string>, rect: { x: number; width: number }) =>
    noGroupEffects(style) && style['outline-style'] === 'none' && zeroLengths(style['border-image-outset']) && shadowsStayOffPage(style['box-shadow'], rect, true) && shadowsStayOffPage(style['text-shadow'], rect, false);
  const offCanvas = (id: string, root: boolean): boolean => {
    const nodes = [a.nodes[id], b.nodes[id]];
    if (!nodes[0] || !nodes[1]) return false;
    const layouts = [a.layouts[nodes[0].layoutId], b.layouts[nodes[1].layoutId]];
    if (root && layouts.some(layout => !['fixed', 'absolute'].includes(layout.position))) return false;
    if (layouts.some(layout => !outsidePage(geometry(layout).rect) || !outsidePage(geometry(layout).contentRect))) return false;
    if (![0, 1].every(index => offCanvasEffects((index ? b : a).styles[nodes[index].styleId], geometry(layouts[index]).rect))) return false;
    return [...new Set(nodes.flatMap(node => node.childIds))].every(child => offCanvas(child, false));
  };
  const unpaintedCache = new Map<string, boolean>();
  const unpainted = (id: string): boolean => {
    if (unpaintedCache.has(id)) return unpaintedCache.get(id)!;
    unpaintedCache.set(id, false);
    if (offCanvas(id, true)) { unpaintedCache.set(id, true); return true; }
    const nodes = [a.nodes[id], b.nodes[id]];
    if (!nodes[0] || !nodes[1] || !hiddenOwnPaint(nodes) || !noGroupEffects(a.styles[nodes[0].styleId]) || !noGroupEffects(b.styles[nodes[1].styleId])) return false;
    if ([...new Set(nodes.flatMap(node => node.childIds))].some(child => !unpainted(child))) return false;
    unpaintedCache.set(id, true);
    return true;
  };
  // A viewport-anchored fixed overlay (e.g. a vertically centred side bar) keeps its size, x position and paint but sits at a
  // different y in a taller raster. Only a pure vertical shift is allowed, and descendants must shift by exactly the same amount.
  const sameExceptY = (left: { x: number; y: number; width: number; height: number }, right: typeof left) => left.x === right.x && left.width === right.width && left.height === right.height;
  const fixedShiftCache = new Map<string, number | undefined>();
  const fixedShift = (id: string): number | undefined => {
    if (fixedShiftCache.has(id)) return fixedShiftCache.get(id);
    fixedShiftCache.set(id, undefined);
    const nodeA = a.nodes[id], nodeB = b.nodes[id];
    if (!nodeA || !nodeB) return undefined;
    const left = a.layouts[nodeA.layoutId], right = b.layouts[nodeB.layoutId], lg = geometry(left), rg = geometry(right);
    let delta: number | undefined;
    if (left.position === 'fixed' && right.position === 'fixed' && left.display === right.display && sameExceptY(lg.rect, rg.rect) && sameExceptY(lg.contentRect, rg.contentRect) && lg.rect.y - lg.contentRect.y === rg.rect.y - rg.contentRect.y) delta = rg.rect.y - lg.rect.y;
    else if (nodeA.parentId) {
      const parent = fixedShift(nodeA.parentId);
      if (parent !== undefined && left.display === right.display && left.position === right.position && sameExceptY(lg.rect, rg.rect) && sameExceptY(lg.contentRect, rg.contentRect) && rg.rect.y - lg.rect.y === parent && rg.contentRect.y - lg.contentRect.y === parent) delta = parent;
    }
    fixedShiftCache.set(id, delta);
    return delta;
  };
  const unpaintedAncestor = (id: string): boolean => { const seen = new Set<string>(); let parent = a.nodes[id]?.parentId; while (parent && !seen.has(parent)) { if (unpainted(parent)) return true; seen.add(parent); parent = a.nodes[parent]?.parentId; } return false; };
  for (const [id, node] of Object.entries(a.nodes)) {
    const other = b.nodes[id], left = a.layouts[node.layoutId], right = b.layouts[other.layoutId], ls = a.styles[node.styleId], rs = b.styles[other.styleId];
    if (node.selector !== other.selector || node.tag !== other.tag || node.parentId !== other.parentId || JSON.stringify(node.childIds) !== JSON.stringify(other.childIds) || node.visible !== other.visible || scope && node.regionId !== other.regionId) throw Error(`Expanded capture changed source structure: ${id}`);
    const zeroAreaHidden = !node.visible && !other.visible && left.rect.width * left.rect.height === 0 && right.rect.width * right.rect.height === 0;
    const displayNoneExcluded = Boolean(options.clip) && zeroAreaHidden && displayNoneAncestor(a, id) && displayNoneAncestor(b, id);
    const clipExcluded = displayNoneExcluded || excludedPaint(id);
    if (['id','href','alt','title','role','type','placeholder','aria-label','data-sku','data-product-id','data-product_id','data-slick-index'].some(key => (node.attributes[key] ?? '') !== (other.attributes[key] ?? ''))) throw Error(`Expanded capture changed a semantic source attribute: ${id}`);
    if (Boolean(left.captureGeometry) !== Boolean(right.captureGeometry)) throw Error(`Expanded capture changed animation layout identity: ${id}`);
    const originalText = a.texts.filter(text => text.nodeId === id).map(text => text.text), expandedText = b.texts.filter(text => text.nodeId === id).map(text => text.text);
    // A zero-area hidden carousel's live counter is not present in either
    // raster. Its original text is still retained in the desktop packet.
    if ((!zeroAreaHidden || clipExcluded || scope?.includedNodeIds.has(id)) && JSON.stringify(originalText) !== JSON.stringify(expandedText)) throw Error(`Expanded capture changed copy: ${id}`);
    const media = (set: typeof a) => set.usages.filter(usage => usage.nodeId === id).map(usage => [usage.kind, usage.attribute ?? '', usage.media ?? '', usage.visible, set.resources[usage.resourceId]?.inline ?? set.resources[usage.resourceId]?.url]);
    if (JSON.stringify(media(a)) !== JSON.stringify(media(b))) throw Error(`Expanded capture changed media: ${id}`);
    // Header/overlay facts are retained and their semantics/copy/media remain
    // checked. Only the explicitly frozen region's rendering is outside this
    // read-only-header body task; ordinary tasks never reach this exception.
    if (scope?.excludedNodeIds.has(id)) continue;
    // getBoundingClientRect() for a display:none fixed subtree is all-zero;
    // document-space collection still adds scrollY. That offset paints no
    // pixels, including any generated content suppressed by display:none.
    if (clipExcluded) continue;
    if (!zeroAreaHidden && [...paintProperties, ...(options.clip ? clipPaintProperties : [])].some(property => (ls[property] ?? '') !== (rs[property] ?? ''))) throw Error(`Expanded capture changed paint styles: ${id}`);
    if (!zeroAreaHidden && [...new Set([...Object.keys(ls),...Object.keys(rs)])].filter(property=>/^(?:before|after):/.test(property)).some(property=>(ls[property]??'')!==(rs[property]??''))) throw Error(`Expanded capture changed pseudo-element paint: ${id}`);
    if (!zeroAreaHidden && !left.captureGeometry && !right.captureGeometry && (ls.transform ?? '') !== (rs.transform ?? '')) throw Error(`Expanded capture changed a non-animation transform: ${id}`);
    const lg = geometry(left), rg = geometry(right);
    if (JSON.stringify([lg.rect, lg.contentRect, left.display, left.position]) === JSON.stringify([rg.rect, rg.contentRect, right.display, right.position])) continue;
    if (unpainted(id) || unpaintedAncestor(id)) continue;
    if (fixedShift(id) !== undefined) continue;
    const solidWrapper = !originalText.length && !a.usages.some(usage => usage.nodeId === id) && !left.captureGeometry && !right.captureGeometry &&
      left.rect.x <= 0 && right.rect.x <= 0 && left.rect.x + left.rect.width >= source.viewport.clientWidth && right.rect.x + right.rect.width >= source.viewport.clientWidth &&
      (ls['background-image'] ?? 'none') === 'none' && (ls['box-shadow'] ?? 'none') === 'none' && Number.parseFloat(ls['border-width'] ?? '0') === 0 && Number.parseFloat(ls['border-radius'] ?? '0') === 0 &&
      JSON.stringify(coverage(left.rect)) === JSON.stringify(coverage(right.rect));
    if (!solidWrapper) throw Error(`Expanded capture changed source geometry: ${id}`);
  }
}

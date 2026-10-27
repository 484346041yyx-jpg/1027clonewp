import { native44ModuleClass } from '../native44/adapters.js';
import { native44Children, walkNative44, type Native44Component, type Native44Program } from '../native44/types.js';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import type { BodySourceUnits } from './body-prepare.js';

export interface CarouselArrowObservation {
  componentKey: string;
  snapshotId: string;
  sourceNodeIds: { previous: string | null; next: string | null };
  visible: { previous: boolean; next: boolean };
  graphic: { previous: 'svg' | 'pseudo' | 'unknown'; next: 'svg' | 'pseudo' | 'unknown' };
}

const direction = (attributes: Record<string, string>): 'previous' | 'next' | undefined => {
  const classes = attributes.class ?? '';
  if (/(?:^|\s)(?:splide__arrow--prev|swiper-button-prev(?:-\w+)?|swiper-btn-prev)(?:\s|$)/.test(classes)) return 'previous';
  if (/(?:^|\s)(?:splide__arrow--next|swiper-button-next(?:-\w+)?|swiper-btn-next)(?:\s|$)/.test(classes)) return 'next';
  if (/(?:^|\s)button-left(?:\s|$)/.test(classes)) return 'previous';
  if (/(?:^|\s)button-right(?:\s|$)/.test(classes) || /(?:^|\s)carousel-arrow\s+[^\"]*\bright\b/.test(classes)) return 'next';
  return undefined;
};
const observedGraphic = (packet: ObservationPacketV2, nodeId: string): CarouselArrowObservation['graphic']['previous'] => {
  const node = packet.nodes[nodeId];
  if (node.childIds.some(id => packet.nodes[id]?.tag.toLowerCase() === 'svg' && Object.values(packet.usages).some(usage => usage.nodeId === id && usage.kind === 'svg' && packet.resources[usage.resourceId]?.inline))) return 'svg';
  const style = packet.styles[node.styleId];
  if (style?.['before:content'] && style['before:content'] !== 'none' || style?.['after:content'] && style['after:content'] !== 'none') return 'pseudo';
  return 'unknown';
};
const visible = (packet: ObservationPacketV2, id: string) => {
  const node = packet.nodes[id], rect = packet.layouts[node.layoutId]?.rect;
  return node.visible && Boolean(rect && rect.width > 0 && rect.height > 0);
};

/** Elementor's nested carousel already translates its arrow by -50% on Y.
 * A manually pre-subtracted half-height therefore moves the rendered button
 * upward twice unless the native transform is overridden with !important.
 * This guard is intentionally limited to that provable conflict; the final
 * source-relative placement still needs a viewport review. */
export function assertNativeCarouselArrowCSS(css: string, className: string, scopeClasses: string[] = [className]): void {
  const rules = css.split('}').filter(rule => {
    const selector = rule.slice(0, rule.lastIndexOf('{'));
    return scopeClasses.some(scope => selector.includes(`.${scope}`)) && /\.elementor-swiper-button(?:\s|\{|:|,|$)/.test(selector);
  });
  for (const rule of rules) {
    const declarations = rule.slice(rule.lastIndexOf('{') + 1);
    const top = /(?:^|;)\s*top\s*:\s*([^;]+)/i.exec(declarations)?.[1] ?? '';
    if (/calc\([^)]*\b\d+(?:\.\d+)?(?:cqw|%|vw)\s*-\s*\d+(?:\.\d+)?px\s*\)/i.test(top)) {
      const transform = /(?:^|;)\s*transform\s*:\s*([^;]+)/i.exec(declarations)?.[1] ?? '';
      if (!/^none\s*!important\s*$/i.test(transform.trim())) throw Error(`carousel_navigation_double_vertical_offset:${className}`);
    }
    if (/::(?:before|after)/.test(rule)) {
      const zeroTop = /(?:^|;)\s*top\s*:\s*0(?:px)?\s*(?:!important)?\s*(?:;|$)/i.test(declarations);
      const zeroLeft = /(?:^|;)\s*left\s*:\s*0(?:px)?\s*(?:!important)?\s*(?:;|$)/i.test(declarations);
      const graphic = /(?:mask(?:-image)?|clip-path|border-(?:left|right|top|bottom))\s*:/i.test(declarations);
      if (zeroTop && zeroLeft && graphic) throw Error(`carousel_navigation_glyph_top_left:${className}`);
    }
  }
}
const ancestorClasses = (blocks: Native44Component[], componentKey: string): string[] => {
  const visit = (node: Native44Component, parents: string[]): string[] | undefined => {
    const own = native44ModuleClass(node.key), lineage = [...parents, own];
    if (node.key === componentKey) return lineage;
    for (const child of native44Children(node)) { const found = visit(child, lineage); if (found) return found; }
    return undefined;
  };
  for (const block of blocks) { const found = visit(block, []); if (found) return found; }
  return [native44ModuleClass(componentKey)];
};
const sourcePair = (packet: ObservationPacketV2, candidates: Array<ObservationPacketV2['nodes'][string]>, componentKey: string) => {
  const previous = candidates.filter(node => direction(node.attributes) === 'previous');
  const next = candidates.filter(node => direction(node.attributes) === 'next');
  if (!previous.length && !next.length) throw Error(`carousel_navigation_source_ambiguous:${componentKey}/${packet.snapshot.id}`);
  const visiblePrevious = previous.filter(node => visible(packet, node.id));
  const visibleNext = next.filter(node => visible(packet, node.id));
  if (visiblePrevious.length > 1 || visibleNext.length > 1) throw Error(`carousel_navigation_source_ambiguous:${componentKey}/${packet.snapshot.id}`);
  return { previous: visiblePrevious[0] ?? previous[0] ?? null, next: visibleNext[0] ?? next[0] ?? null };
};

/** A source-derived gate for current v3 replicas. Historical programs are not
 * reinterpreted. It prevents native default chevrons from silently passing when
 * a source carousel has its own arrow graphic or responsive visibility. */
export function assertCarouselNavigationMapped(input: {
  program: Native44Program; sourceUnits: BodySourceUnits;
  snapshots: Map<string, ObservationPacketV2>; css: string;
  phone?: { packets: ObservationPacketV2[]; sections: Array<{ key: string; evidence: Array<{ snapshotId: string; nodeId: string }> }> };
}): CarouselArrowObservation[] {
  const observations: CarouselArrowObservation[] = [];
  for (const component of walkNative44(input.program.blocks)) {
    const nestedCarousel = component.kind === 'native-carousel' && component.widgetType === 'nested-carousel' && component.widgetSettings.arrows === 'yes';
    const productTabs = component.kind === 'native-products' && component.widgetType === 'wd_products_tabs';
    if (!nestedCarousel && !productTabs) continue;
    const units = input.sourceUnits.units.filter(unit => unit.componentKeys.includes(component.key) && input.snapshots.has(unit.snapshotId));
    if (!units.length) throw Error(`carousel_navigation_source_missing:${component.key}`);
    const sourceHasArrows = units.some(unit => {
      const packet = input.snapshots.get(unit.snapshotId)!;
      return unit.nodeIds.some(id => packet.nodes[id] && direction(packet.nodes[id].attributes));
    });
    if (productTabs && !sourceHasArrows) {
      const className = native44ModuleClass(component.key);
      const allWidthCss = input.css.replace(/@media\b[^{}]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
      const hidden = allWidthCss.split(/\}/).some(rule => rule.includes(`.${className}`) && /wd-nav-arrows/.test(rule) && /display\s*:\s*none/.test(rule));
      if (!hidden) throw Error(`carousel_navigation_hidden_state_unmapped:${component.key}`);
      continue;
    }
    for (const unit of units) {
      const packet = input.snapshots.get(unit.snapshotId)!;
      const candidates = unit.nodeIds.map(id => packet.nodes[id]).filter(Boolean);
      const { previous, next } = sourcePair(packet, candidates, component.key);
      observations.push({ componentKey: component.key, snapshotId: unit.snapshotId,
        sourceNodeIds: { previous: previous?.id ?? null, next: next?.id ?? null },
        visible: { previous: previous ? visible(packet, previous.id) : false, next: next ? visible(packet, next.id) : false },
        graphic: { previous: previous ? observedGraphic(packet, previous.id) : 'unknown', next: next ? observedGraphic(packet, next.id) : 'unknown' } });
    }
    if (input.phone) {
      const section = input.phone.sections.find(item => component.key === item.key || component.key.startsWith(`${item.key}_`));
      if (!section) throw Error(`carousel_navigation_phone_section_missing:${component.key}`);
      for (const packet of input.phone.packets) {
        const owners = section.evidence.filter(item => item.snapshotId === packet.snapshot.id && packet.nodes[item.nodeId]).map(item => item.nodeId);
        if (!owners.length) continue;
        const underOwner = (id: string) => {
          const seen = new Set<string>(); let node = packet.nodes[id];
          while (node && !seen.has(node.id)) {
            if (owners.includes(node.id)) return true;
            seen.add(node.id); node = node.parentId ? packet.nodes[node.parentId] : undefined!;
          }
          return false;
        };
        const candidates = Object.values(packet.nodes).filter(node => underOwner(node.id));
        const { previous, next } = sourcePair(packet, candidates, component.key);
        observations.push({ componentKey: component.key, snapshotId: packet.snapshot.id,
          sourceNodeIds: { previous: previous?.id ?? null, next: next?.id ?? null },
          visible: { previous: previous ? visible(packet, previous.id) : false, next: next ? visible(packet, next.id) : false },
          graphic: { previous: previous ? observedGraphic(packet, previous.id) : 'unknown', next: next ? observedGraphic(packet, next.id) : 'unknown' } });
      }
    }
    const own = observations.filter(row => row.componentKey === component.key);
    const className = native44ModuleClass(component.key);
    if (nestedCarousel) assertNativeCarouselArrowCSS(input.css, className, ancestorClasses(input.program.blocks, component.key));
    const arrowSelector = productTabs ? /wd-nav-arrows|wd-btn-arrow|wd-arrow-inner/ : /elementor-swiper-button/;
    const scoped = input.css.split(/\}/).filter(rule => rule.includes(`.${className}`) && arrowSelector.test(rule));
    const hasGraphicCSS = scoped.some(rule => /(?:svg|::before|::after)/.test(rule) && /(?:mask(?:-image)?\s*:\s*url\(|border-(?:left|right|top|bottom)\s*:|clip-path\s*:|content\s*:\s*["'][^"']+["'])/.test(rule));
    const previousIcon = component.widgetSettings.navigation_previous_icon;
    const nextIcon = component.widgetSettings.navigation_next_icon;
    const explicitNativeIcons = [previousIcon, nextIcon].every((icon, index) => icon && typeof icon === 'object' && typeof (icon as { value?: unknown }).value === 'string' && Boolean((icon as { value: string }).value) && (icon as { value: string }).value !== (index ? 'eicon-chevron-right' : 'eicon-chevron-left'));
    if (own.some(row => row.visible.previous || row.visible.next) && !hasGraphicCSS && !(nestedCarousel && explicitNativeIcons)) throw Error(`carousel_navigation_graphic_unmapped:${component.key}`);
    if (own.some(row => !row.visible.previous && !row.visible.next) && !scoped.some(rule => /display\s*:\s*none/.test(rule))) throw Error(`carousel_navigation_hidden_state_unmapped:${component.key}`);
  }
  return observations;
}

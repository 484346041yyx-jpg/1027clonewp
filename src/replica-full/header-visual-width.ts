import type { ObservationPacketV2 } from '../replica-v2/observation.js';

/** A source header can paint edge to edge while its contents use a centered
 * width. Require the independent WoodMart header plan to retain that bound. */
export function assertHeaderContentWidthMapped(packets: ObservationPacketV2[], css: string): void {
  const widths = packets.flatMap(packet => {
    const clientWidth = packet.snapshot.viewport.clientWidth;
    const regions = new Set(packet.regions.filter(region => /^(?:header|banner|site-header|main-header)$/i.test(region.role.trim())).map(region => region.id));
    return Object.values(packet.nodes).filter(node => regions.has(node.regionId)).flatMap(node => {
      const style = packet.styles[node.styleId], rect = packet.layouts[node.layoutId]?.rect;
      const maxWidth = Number.parseFloat(style?.['max-width'] ?? '');
      if (!rect || !/^\d+(?:\.\d+)?px$/.test(style?.['max-width'] ?? '') || !Number.isFinite(maxWidth) || rect.width < clientWidth * .5 || rect.width > clientWidth - 80 || Math.abs(rect.width - maxWidth) > 4 || Math.abs(rect.x - (clientWidth - rect.width) / 2) > 4) return [];
      return [maxWidth];
    });
  });
  if (!widths.length) return;
  const expected = Math.max(...widths);
  const rows = [...css.matchAll(/:header\s+([^{}]+)\{([^{}]+)\}/g)].filter(match => /\.whb-(?:general-header|header-bottom)\b/.test(match[1]) && /\.(?:container|whb-flex-row)(?:\b|\s|:)/.test(match[1]));
  const effective = new Map<string, { maxWidth?: string; width?: string }>();
  for (const [, selector, declarations] of rows) {
    const properties = effective.get(selector.trim()) ?? {};
    for (const declaration of declarations.split(';')) {
      const match = /^\s*(max-width|width)\s*:\s*(.*?)\s*$/.exec(declaration);
      if (match) properties[match[1] === 'max-width' ? 'maxWidth' : 'width'] = match[2].replace(/\s*!important\s*$/i, '');
    }
    effective.set(selector.trim(), properties);
  }
  const supported = [...effective.values()].some(properties => {
    const max = /^(\d+(?:\.\d+)?)px$/i.exec(properties.maxWidth ?? '')?.[1];
    const min = /^min\(\s*(?:100%\s*,\s*(\d+(?:\.\d+)?)px|(\d+(?:\.\d+)?)px\s*,\s*100%)\s*\)$/i.exec(properties.width ?? '');
    return [max, min?.[1], min?.[2]].some(bound => bound !== undefined && Math.abs(Number(bound) - expected) <= 8);
  });
  if (!supported) throw Error(`replica_full_header_content_width_unmapped:${expected}px`);
}

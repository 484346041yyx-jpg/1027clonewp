import { z } from 'zod';

const publicUrl = z.string().url().refine(value => /^https?:\/\//i.test(value), 'Product relationship must be a public HTTP(S) URL');
export const CommerceObservationV2Schema = z.object({ version: z.literal(1), productUrls: z.array(publicUrl) }).strict();
const signal = z.object({ nodeId: z.string().min(1), kind: z.enum(['product-id', 'product-schema', 'product-destination', 'commerce-component', 'product-form']), value: z.string().min(1) }).strict();
export const SourceCommerceGroupV2Schema = z.object({ id: z.string().min(1), regionId: z.string().min(1), ownerNodeId: z.string().min(1), cardNodeIds: z.array(z.string().min(1)).min(1), status: z.enum(['catalog', 'uncertain']), signals: z.array(signal).min(1), reason: z.string().min(1) }).strict();
export type SourceCommerceGroupV2 = z.infer<typeof SourceCommerceGroupV2Schema>;
interface CommerceNode { id: string; parentId: string | null; regionId: string; tag: string; attributes: Record<string, string>; childIds: string[] }
/** Evidence inference uses source record identity, typed URLs, commerce markup and
 * repeated DOM relationships. Prices and human copy are never consulted. */
export function analyzeSourceCommerceV2(packet: { nodes: Record<string, CommerceNode>; commerceEvidence?: z.infer<typeof CommerceObservationV2Schema> }): SourceCommerceGroupV2[] {
  if (!packet.commerceEvidence) return [];
  const nodes = packet.nodes, byNode = new Map<string, SourceCommerceGroupV2['signals']>();
  const products = new Set(packet.commerceEvidence.productUrls.map(url => { const parsed = new URL(url); parsed.hash = ''; return parsed.href; }));
  const ancestorCache = new Map<string, CommerceNode[]>();
  const ancestors = (id: string) => { if (ancestorCache.has(id)) return ancestorCache.get(id)!; const result: CommerceNode[] = [], seen = new Set<string>(); let current: CommerceNode | undefined = nodes[id]; while (current && !seen.has(current.id)) { result.push(current); seen.add(current.id); current = current.parentId ? nodes[current.parentId] : undefined; } ancestorCache.set(id, result); return result; };
  const cloned = (id: string) => ancestors(id).some(node => /(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(node.attributes.class || ''));
  const underneath = (id: string, owner: string) => ancestors(id).some(node => node.id === owner);
  const add = (nodeId: string, kind: SourceCommerceGroupV2['signals'][number]['kind'], value: string) => { const values = byNode.get(nodeId) ?? []; values.push({ nodeId, kind, value }); byNode.set(nodeId, values); };
  for (const node of Object.values(nodes)) {
    if (cloned(node.id)) continue;
    for (const key of ['data-pid', 'data-product-id', 'data-product_id', 'data-sku']) if (node.attributes[key]?.trim()) add(node.id, 'product-id', `${key}=${node.attributes[key]}`);
    if (/(?:https?:\/\/)?schema\.org\/Product(?:\s|$|#)/i.test(node.attributes.itemtype || '')) add(node.id, 'product-schema', node.attributes.itemtype);
    const marker = (node.attributes.class || '').split(/\s+/).find(value => /^product-(?:tile|card)(?:-[a-z0-9]+)*$/i.test(value) || ['product-grid-item', 'woocommerce-loop-product__link', 'product-item-info', 'product-small'].includes(value));
    if (marker) add(node.id, 'commerce-component', marker);
    if (node.tag === 'form' && /(?:cart|basket)[-/]?(?:add|Add)|add-to-cart|Cart-AddProduct/.test(node.attributes.action || '')) add(node.id, 'product-form', node.attributes.action);
    const href = node.attributes.href;
    if (href && /^https?:\/\//i.test(href)) { const parsed = new URL(href); parsed.hash = ''; if (products.has(parsed.href)) add(node.id, 'product-destination', parsed.href); if (parsed.searchParams.has('add-to-cart') && /^\d+$/.test(parsed.searchParams.get('add-to-cart') || '')) add(node.id, 'product-id', `add-to-cart=${parsed.searchParams.get('add-to-cart')}`); }
  }
  // One record can expose an ID, schema, image link and title link. Collapse its
  // nested signals before looking for repeated peer cards.
  const seeds = [...byNode.keys()].filter(id => !ancestors(id).slice(1).some(ancestor => byNode.has(ancestor.id)));
  if (!seeds.length) return [];
  const signalCache = new Map<string, SourceCommerceGroupV2['signals']>();
  const signalsWithin = (owner: string) => { if (!signalCache.has(owner)) signalCache.set(owner, [...byNode.entries()].filter(([id]) => underneath(id, owner)).flatMap(([, signals]) => signals)); return signalCache.get(owner)!; };
  const distinctPeerIdentity = (peers: string[]) => ['product-id', 'product-destination'].some(kind => {
    const identities = peers.map(peer => new Set(signalsWithin(peer).filter(signal => signal.kind === kind).map(signal => signal.value)));
    return identities.every(values => values.size) && identities.every((values, index) => identities.every((other, otherIndex) => index === otherIndex || ![...values].some(value => other.has(value))));
  });
  const grouped = new Map<string, Set<string>>();
  for (const seed of seeds) {
    const path = ancestors(seed); let group: CommerceNode | undefined, card: CommerceNode | undefined;
    for (const candidate of path) {
      if (!candidate.parentId) continue;
      const parent = nodes[candidate.parentId], peers = parent.childIds.filter(child => !cloned(child) && signalsWithin(child).length);
      if (peers.length >= 2 && peers.every(peer => nodes[peer].tag === candidate.tag) && (distinctPeerIdentity(peers) || peers.every(child => signalsWithin(child).some(signal => signal.kind === 'product-schema' || signal.kind === 'commerce-component')))) { group = parent; card = candidate; break; }
    }
    group ??= path.find(node => byNode.has(node.id)) ?? nodes[seed]; card ??= nodes[seed];
    const cards = grouped.get(group.id) ?? new Set<string>(); cards.add(card.id); grouped.set(group.id, cards);
  }
  const groups: SourceCommerceGroupV2[] = [];
  for (const [ownerNodeId, cardSet] of grouped) {
    const cards = [...cardSet].filter(id => ![...cardSet].some(other => other !== id && underneath(id, other))), signals = cards.flatMap(card => signalsWithin(card));
    const distinctLinks = cards.map(card => [...new Set(Object.values(nodes).filter(node => underneath(node.id, card) && node.tag === 'a' && /^https?:\/\//.test(node.attributes.href || '')).map(node => node.attributes.href))]);
    const identified = cards.every(card => signalsWithin(card).some(signal => signal.kind === 'product-id' || signal.kind === 'product-schema'));
    const typedDestinations = cards.every(card => signalsWithin(card).some(signal => signal.kind === 'product-destination'));
    const structuralCommerce = cards.every(card => signalsWithin(card).some(signal => ['commerce-component', 'product-form'].includes(signal.kind)));
    const productSchemas = cards.every(card => signalsWithin(card).some(signal => signal.kind === 'product-schema'));
    const separateDestinations = distinctLinks.every((links, index) => links.some(link => distinctLinks.every((other, otherIndex) => index === otherIndex || !other.includes(link))));
    const reliable = cards.length >= 2 && separateDestinations && (productSchemas || identified && distinctPeerIdentity(cards) && structuralCommerce || typedDestinations && structuralCommerce);
    groups.push({ id: `commerce-${ownerNodeId}`, regionId: nodes[ownerNodeId].regionId, ownerNodeId, cardNodeIds: cards, status: reliable ? 'catalog' : 'uncertain', signals: [...new Map(signals.map(signal => [`${signal.nodeId}:${signal.kind}:${signal.value}`, signal])).values()], reason: reliable ? 'Repeated independently identified product records have associated detail destinations and typed source-commerce evidence' : 'Product-related source signals exist, but repeated catalog identity, destinations or commerce-component ownership is incomplete' });
  }
  return groups;
}

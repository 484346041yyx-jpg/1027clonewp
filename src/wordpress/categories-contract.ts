/** Bounded public product-category tree; IDs select existing roots, never create terms. */
export interface TargetCategoriesQueryInput {
  rootIds: number[]; hideEmpty: boolean; includeChildren: true; orderby: 'menu_order'; order: 'ASC';
}
export interface TargetCategoryEvidence {
  id: number; parent: number; name: string; slug: string; permalink: string; count: number; order: number;
}
export interface TargetCategoriesEvidence {
  version: 1; targetOrigin: string; readAt: string; evidence: string[];
  taxonomy: 'product_cat'; query: TargetCategoriesQueryInput; terms: TargetCategoryEvidence[];
}
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function normalizeTargetCategoriesQuery(input: TargetCategoriesQueryInput): TargetCategoriesQueryInput {
  if (!input || !Array.isArray(input.rootIds) || !input.rootIds.length || input.rootIds.length > 100 || input.rootIds.some(v => !id(v)) || new Set(input.rootIds).size !== input.rootIds.length || typeof input.hideEmpty !== 'boolean' || input.includeChildren !== true || input.orderby !== 'menu_order' || input.order !== 'ASC') throw Error('target_categories_query_invalid');
  // Selection order is retained in the declaration. Native sibling display order
  // comes from WooCommerce menu_order, never from an invented include ordering.
  return { rootIds: [...input.rootIds], hideEmpty: input.hideEmpty, includeChildren: true, orderby: 'menu_order', order: 'ASC' };
}
export const targetCategoriesQueryKey = (input: TargetCategoriesQueryInput) => JSON.stringify(normalizeTargetCategoriesQuery(input));
export function assertTargetCategoriesEvidence(value: unknown, origin?: string, query?: TargetCategoriesQueryInput): asserts value is TargetCategoriesEvidence {
  const fail = (): never => { throw Error('target_categories_evidence_invalid'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const v = value as TargetCategoriesEvidence;
  let url: URL; try { url = new URL(v.targetOrigin); } catch { return fail(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== v.targetOrigin || url.username || url.password || origin && v.targetOrigin !== new URL(origin).origin || v.version !== 1 || v.taxonomy !== 'product_cat' || !Number.isFinite(Date.parse(v.readAt)) || !Array.isArray(v.evidence) || v.evidence.some(e => typeof e !== 'string' || !e.trim()) || !Array.isArray(v.terms) || !v.terms.length || v.terms.length > 1000) fail();
  let normalized: TargetCategoriesQueryInput; try { normalized = normalizeTargetCategoriesQuery(v.query); } catch { return fail(); }
  if (query && targetCategoriesQueryKey(normalized) !== targetCategoriesQueryKey(query)) fail();
  const terms = new Map<number, TargetCategoryEvidence>(), orders = new Set<number>();
  for (const t of v.terms) {
    let link: URL; try { link = new URL(t.permalink); } catch { return fail(); }
    if (!id(t.id) || terms.has(t.id) || !Number.isSafeInteger(t.parent) || t.parent < 0 || t.parent === t.id || typeof t.name !== 'string' || !t.name.trim() || typeof t.slug !== 'string' || !t.slug.trim() || link.origin !== v.targetOrigin || link.username || link.password || !Number.isSafeInteger(t.count) || t.count < 0 || !Number.isSafeInteger(t.order) || t.order < 0 || orders.has(t.order)) fail();
    terms.set(t.id, t); orders.add(t.order);
  }
  for (const root of normalized.rootIds) if (!terms.has(root) || terms.get(root)!.parent !== 0) fail();
  for (const t of v.terms) {
    const seen = new Set<number>(); let current = t;
    while (current.parent) { if (seen.has(current.id) || !terms.has(current.parent)) fail(); seen.add(current.id); current = terms.get(current.parent)!; }
    if (!normalized.rootIds.includes(current.id)) fail();
  }
}

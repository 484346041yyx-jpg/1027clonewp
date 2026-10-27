/** A dynamic query against published posts on the configured target site. */
export interface TargetPostsQueryInput {
  itemsPerPage: number; orderby: 'date'; order: 'desc'; offset?: number;
  categoryIds?: number[]; tagIds?: number[];
}
export interface TargetPostsQuery extends TargetPostsQueryInput {
  offset: number; categoryIds: number[]; tagIds: number[];
}
export interface TargetPostEvidence {
  id: number; status: 'publish'; date: string; title: string; excerpt: string; permalink: string;
  /** Bounded public body text for native theme excerpts that use content rather than post_excerpt. */
  contentText?: string;
  featuredMediaId: number; imageUrl?: string; imageVariants: string[]; categoryIds: number[]; tagIds: number[];
}
/** Observation of one query, never an include-IDs instruction for the native widget. */
export interface TargetPostsEvidence {
  version: 1; targetOrigin: string; readAt: string; evidence: string[];
  query: TargetPostsQuery; posts: TargetPostEvidence[];
}

const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const idList = (value: unknown, label: string): number[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some(id => !positiveId(id)) || new Set(value).size !== value.length) throw Error(`Invalid target posts ${label}`);
  return [...value].sort((a, b) => a - b);
};
export function normalizeTargetPostsQuery(input: TargetPostsQueryInput): TargetPostsQuery {
  if (!input || !Number.isSafeInteger(input.itemsPerPage) || input.itemsPerPage < 1 || input.itemsPerPage > 100 || input.orderby !== 'date' || input.order !== 'desc') throw Error('Invalid target posts query: latest published posts require 1–100 items ordered by date descending');
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw Error('Invalid target posts query offset');
  const categoryIds = idList(input.categoryIds, 'category IDs'), tagIds = idList(input.tagIds, 'tag IDs');
  if (categoryIds.length && tagIds.length) throw Error('Combined category and tag target posts filters require a verified native query contract');
  return { itemsPerPage: input.itemsPerPage, orderby: 'date', order: 'desc', offset, categoryIds, tagIds };
}
export const targetPostsQueryKey = (input: TargetPostsQueryInput): string => JSON.stringify(normalizeTargetPostsQuery(input));
function publicUrl(input: unknown): URL | undefined {
  if (typeof input !== 'string') return;
  try { const url = new URL(input); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; } catch { return; }
}

/** Validate server observations before they enter a compilation or a comparison manifest. */
export function assertTargetPostsEvidence(value: unknown, expectedOrigin?: string, expectedQuery?: TargetPostsQueryInput): asserts value is TargetPostsEvidence {
  const invalid = () => { throw Error('Invalid published target posts evidence'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const snapshot = value as TargetPostsEvidence, origin = publicUrl(snapshot.targetOrigin);
  if (snapshot.version !== 1 || !origin || origin.origin !== snapshot.targetOrigin || (expectedOrigin && snapshot.targetOrigin !== new URL(expectedOrigin).origin) || typeof snapshot.readAt !== 'string' || !Number.isFinite(Date.parse(snapshot.readAt)) || !Array.isArray(snapshot.evidence) || snapshot.evidence.some(ref => typeof ref !== 'string' || !ref.trim()) || !Array.isArray(snapshot.posts)) return invalid();
  let query: TargetPostsQuery;
  try { query = normalizeTargetPostsQuery(snapshot.query); } catch { return invalid(); }
  if (!Number.isSafeInteger(snapshot.query.offset) || !Array.isArray(snapshot.query.categoryIds) || !Array.isArray(snapshot.query.tagIds) || (expectedQuery && targetPostsQueryKey(expectedQuery) !== targetPostsQueryKey(query)) || snapshot.posts.length > query.itemsPerPage) return invalid();
  const ids = new Set<number>(); let previousDate = Infinity;
  for (const post of snapshot.posts) {
    if (!post || typeof post !== 'object' || !positiveId(post.id) || ids.has(post.id) || post.status !== 'publish' || typeof post.date !== 'string' || !Number.isFinite(Date.parse(post.date)) || typeof post.title !== 'string' || !post.title.trim() || typeof post.excerpt !== 'string' || publicUrl(post.permalink)?.origin !== snapshot.targetOrigin || !Number.isSafeInteger(post.featuredMediaId) || post.featuredMediaId < 0 || !Array.isArray(post.imageVariants) || post.imageVariants.some(image => !publicUrl(image)) || (post.imageUrl !== undefined && !publicUrl(post.imageUrl))) return invalid();
    if (post.contentText !== undefined && (typeof post.contentText !== 'string' || [...post.contentText].length > 4000)) return invalid();
    if (!Array.isArray(post.categoryIds) || !Array.isArray(post.tagIds)) return invalid();
    try { idList(post.categoryIds, 'category IDs'); idList(post.tagIds, 'tag IDs'); } catch { return invalid(); }
    // Dates, not IDs, are the native query ordering contract; equal dates may use the target's stable native tie order.
    const date = Date.parse(post.date); if (date > previousDate) return invalid(); previousDate = date;
    if ((post.featuredMediaId === 0 && (post.imageUrl !== undefined || post.imageVariants.length > 0)) || (post.imageUrl && !post.imageVariants.includes(post.imageUrl))) return invalid();
    ids.add(post.id);
  }
}

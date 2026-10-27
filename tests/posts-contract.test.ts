import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTargetPostsEvidence, normalizeTargetPostsQuery, targetPostsQueryKey, type TargetPostsEvidence } from '../src/wordpress/posts-contract.js';
import { targetPostsReadPHP } from '../src/wordpress/posts.js';

const query = { itemsPerPage: 4, orderby: 'date', order: 'desc' } as const;
const snapshot = (): TargetPostsEvidence => ({ version: 1, targetOrigin: 'https://target.example', readAt: '2026-10-18T10:00:00Z', evidence: [], query: normalizeTargetPostsQuery(query), posts: [{ id: 1, status: 'publish', date: '2026-10-17T10:00:00Z', title: 'Actual target article', excerpt: 'Existing article excerpt', permalink: 'https://target.example/actual/', featuredMediaId: 2, imageUrl: 'https://cdn.example/article.jpg', imageVariants: ['https://cdn.example/article.jpg'], categoryIds: [5], tagIds: [7] }] });

test('post query normalizes dynamic defaults and category order without freezing observation IDs', () => {
  assert.deepEqual(normalizeTargetPostsQuery(query), { ...query, offset: 0, categoryIds: [], tagIds: [] });
  assert.equal(targetPostsQueryKey({ ...query, categoryIds: [5, 3] }), targetPostsQueryKey({ ...query, categoryIds: [3, 5], offset: 0 }));
  const code = targetPostsReadPHP({ ...query, categoryIds: [5] });
  assert.match(code, /'post_type'=>'post','post_status'=>'publish'/);
  assert.match(code, /'orderby'=>'date','order'=>'DESC'/);
  assert.match(code, /new WP_Query/); assert.match(code, /get_term/);
  assert.match(code, /'include_children'=>true/); assert.match(code, /'tax_query'\]=\['relation'=>'OR'\]/);
  assert.doesNotMatch(code, /ignore_sticky_posts/, 'dynamic native blog retains the theme query sticky behavior');
  assert.match(code, /get_post_time\('c',false,\$post\)/, 'published dates retain target site local calendar dates');
  assert.match(code, /mb_substr\(\$bodyText,0,4000,'UTF-8'\)/, 'native excerpt provenance contains only a bounded actual public body prefix');
  assert.doesNotMatch(code, /wp_insert_post|wp_update_post|update_option|update_post_meta|post__in/);
});

test('post queries reject unbounded, malformed and unverified mixed taxonomy selections before transport', () => {
  for (const itemsPerPage of [0, -1, 101, 1.5, NaN, Infinity, '4);wp_delete_post(1)' as unknown as number]) assert.throws(() => normalizeTargetPostsQuery({ ...query, itemsPerPage }));
  for (const patch of [{ order: 'asc' }, { orderby: 'rand' }, { offset: -1 }, { offset: 10001 }, { categoryIds: [1, 1] }, { tagIds: [0] }, { categoryIds: [1], tagIds: [2] }]) assert.throws(() => normalizeTargetPostsQuery({ ...query, ...patch } as any));
});

test('published target post observations verify origin, query, genuine public records and ordered IDs', () => {
  assertTargetPostsEvidence(snapshot(), 'https://target.example', query);
  const empty = snapshot(); empty.posts = []; assert.doesNotThrow(() => assertTargetPostsEvidence(empty), 'actual shortage is retained rather than fabricated');
  const nativeExcerpt = snapshot(); nativeExcerpt.posts[0].contentText = 'Authentic public body text'; assertTargetPostsEvidence(nativeExcerpt);
  const missingImage = snapshot(); Object.assign(missingImage.posts[0], { featuredMediaId: 0, imageUrl: undefined, imageVariants: [] }); assertTargetPostsEvidence(missingImage);
  const altered: Array<(value: TargetPostsEvidence) => void> = [
    value => { value.targetOrigin = 'https://other.example'; },
    value => { value.posts[0].status = 'draft' as any; },
    value => { value.posts[0].permalink = 'https://source.example/source-article/'; },
    value => { value.posts[0].imageUrl = 'javascript:alert(1)'; },
    value => { value.posts[0].imageVariants = ['https://user:secret@cdn.example/image.jpg']; },
    value => { value.posts.push(structuredClone(value.posts[0])); },
    value => { value.posts[0].categoryIds = undefined as any; },
    value => { value.query.categoryIds = [99]; },
    value => { value.query.itemsPerPage = 1; value.posts.push({ ...value.posts[0], id: 2 }); },
    value => { value.posts.push({ ...value.posts[0], id: 2, date: '2026-10-18T10:00:00Z' }); },
    value => { value.posts[0].date = 'invalid-date'; },
    value => { value.posts[0].contentText = 'a'.repeat(4001); },
  ];
  for (const mutate of altered) { const value = snapshot(); mutate(value); assert.throws(() => assertTargetPostsEvidence(value, 'https://target.example', query)); }
});

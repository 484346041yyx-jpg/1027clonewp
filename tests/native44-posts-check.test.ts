import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectNative44PostChecks, native44ObservedPostProblems, native44PostEvidencePassed, native44PostChecksFromReceipts, type Native44PostCheck } from '../src/native44/post-check.js';
import { analyzeNative44Captures, fingerprintNative44Snapshot, type Native44CompareManifest, type Native44Capture } from '../src/native44/compare.js';
import type { TargetPostsEvidence } from '../src/wordpress/posts-contract.js';

const query = { itemsPerPage: 2, orderby: 'date' as const, order: 'desc' as const, offset: 0, categoryIds: [], tagIds: [] };
const snapshot: TargetPostsEvidence = { version: 1, targetOrigin: 'https://target.test', readAt: '2026-10-18T00:00:00.000Z', evidence: ['actual-published-posts.json'], query, posts: [10, 9].map(id => ({ id, status: 'publish', date: `2026-07-${id.toString().padStart(2, '0')}T08:00:00`, title: `Real target article ${id}`, excerpt: 'This is the actual target article excerpt with useful details.', permalink: `https://target.test/article-${id}/`, featuredMediaId: id + 100, imageUrl: `https://target.test/${id}.svg`, imageVariants: [`https://target.test/${id}.svg`, `https://target.test/${id}-small.svg`], categoryIds: [], tagIds: [] })) };
const check: Native44PostCheck = { componentKey: 'news', selector: '.elementor-42 [data-id="abcdef1"]', widgetType: 'wd_blog', expectedPostIds: [10, 9], posts: snapshot, layout: { mode: 'grid', columns: 2, imageRequired: true, excerptRequired: true, dateRequired: true, pagination: 'none' } };
const card = (id: number, clone = false) => `<article id="post-${id}" class="blog-post-loop post-${id}${clone ? ' swiper-slide-duplicate' : ''}"><div class="post-img-wrapp"><a href="https://target.test/article-${id}/"><img src="https://target.test/${id}-small.svg" width="120" height="80"></a></div><div class="article-body-container"><div class="wd-post-date"><span class="post-date-day">${id}</span><span class="post-date-month">Jul</span></div><h3 class="entry-title"><a href="https://target.test/article-${id}/">Real target article ${id}</a></h3><div class="entry-content">This is the actual target article excerpt with useful details.</div></div></article>`;

test('native blog observer proves actual posts, media, links and columns; copied source cards and missing facts cannot pass', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route('https://target.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: route.request().url().endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="orange"/></svg>' : `<!doctype html><style>body{margin:0}.before{height:1200px}.posts{display:grid;grid-template-columns:repeat(2,1fr);gap:30px}.swiper-slide-duplicate{display:none}</style><div class="before"></div><main class="elementor-42"><div data-id="abcdef1" data-widget_type="wd_blog.default"><div class="posts wd-posts" data-paged="1" data-atts=\'{"post_type":"post","items_per_page":2,"orderby":"date","order":"DESC","offset":"","include":null,"exclude":"","meta_key":null,"taxonomies":""}\'>${card(10)}${card(9)}${card(10, true)}</div></div></main>` }));
  try {
    await page.goto('https://target.test/');
    const [actual] = await collectNative44PostChecks(page, [check], 'desktop-wide');
    assert.equal(actual.status, 'passed', actual.problems.join('; ')); assert.equal(native44PostEvidencePassed(check, actual), true); assert.deepEqual(actual.posts.map(post => post.id), [10, 9]); assert.equal(actual.layout!.columns, 2); assert.equal(await page.evaluate(() => scrollY), 0);
    for (const wrong of [[...actual.posts].reverse(), [{ ...actual.posts[0], title: 'Copied source pet article' }, actual.posts[1]], [{ ...actual.posts[0], permalink: 'https://source.test/pet/' }, actual.posts[1]], [{ ...actual.posts[0], imageDrawable: false }, actual.posts[1]], [{ ...actual.posts[0], titleClipped: true }, actual.posts[1]]]) assert.ok(native44ObservedPostProblems(check, wrong).length);
    assert.equal(native44PostEvidencePassed(check, { ...actual, layout: { ...actual.layout!, columns: 1 } }), false);
    assert.equal(native44PostEvidencePassed(check, { ...actual, nativeQuery: { ...actual.nativeQuery, include: [10, 9] } }), false, 'Even coincidentally matching IDs cannot hide a static include query');
    assert.equal(native44PostEvidencePassed(check, { ...actual, nativeQuery: { ...actual.nativeQuery, orderby: 'modified' } }), false);
    assert.equal(native44PostEvidencePassed(check, { ...actual, nativeQueryPaged: 2 }), false);
    assert.ok(native44ObservedPostProblems(check, [{ ...actual.posts[0], dateMonth: 'Jan' }, actual.posts[1]]).some(problem => problem.includes('publication date')));
    const body = 'This is the authentic article body, with extra text beyond the configured WordPress excerpt length and more useful details.', bodyCheck = structuredClone(check);
    bodyCheck.posts.posts[0].excerpt = 'This is the authentic'; bodyCheck.posts.posts[0].contentText = body;
    assert.deepEqual(native44ObservedPostProblems(bodyCheck, [{ ...actual.posts[0], excerpt: 'This is the authentic article body, with extra text beyond the configured...' }, actual.posts[1]]), []);
    assert.ok(native44ObservedPostProblems(bodyCheck, [{ ...actual.posts[0], excerpt: 'This is the authentic article body, with invented pet food facts...' }, actual.posts[1]]).some(problem => problem.includes('excerpt')));
    await page.locator('#post-10 .entry-title a').first().evaluate(element => { element.textContent = ''; });
    const [missing] = await collectNative44PostChecks(page, [check], 'desktop-wide'); assert.equal(missing.status, 'failed'); assert.equal(missing.posts[0].title, ''); assert.match(missing.problems.join('; '), /title/);
    await page.locator('[data-widget_type]').evaluate(element => element.setAttribute('data-widget_type', 'html.default'));
    const [fake] = await collectNative44PostChecks(page, [check], 'desktop-wide'); assert.equal(fake.status, 'failed'); assert.match(fake.problems.join('; '), /native wd_blog/);
  } finally { await browser.close(); }
});

test('dynamic blog receipts retain actual query evidence and never convert observed posts to an include list', () => {
  const checks = native44PostChecksFromReceipts([{ componentKey: 'news', elementId: 'abcdef1', widgetType: 'wd_blog', provider: 'target-wordpress-posts', targetOrigin: snapshot.targetOrigin, query: { itemsPerPage: 2, orderby: 'date', order: 'desc', evidence: ['source-news-region.json'] }, observedPostIds: [10, 9], evidence: snapshot.evidence, settings: { blog_design: 'default', blog_columns: { size: 2 }, pagination: '', parts_text: '1', parts_published_date: '1' } }], [snapshot], 42);
  assert.equal(checks[0].posts, snapshot); assert.deepEqual(checks[0].expectedPostIds, [10, 9]); assert.equal(checks[0].layout!.columns, 2); assert.equal(checks[0].layout!.pagination, 'none');
  assert.equal(checks[0].layout!.excerptRequired, true); assert.equal(checks[0].layout!.dateRequired, true);
  assert.throws(() => native44PostChecksFromReceipts([{ componentKey: 'news', elementId: 'abcdef1', widgetType: 'wd_blog', provider: 'target-wordpress-posts', targetOrigin: snapshot.targetOrigin, query: { itemsPerPage: 4, orderby: 'date', order: 'desc', evidence: ['source-news-region.json'] }, observedPostIds: [10, 9], evidence: snapshot.evidence, settings: {} }], [snapshot], 42), /exact observed dynamic query/);
});

test('comparison cannot treat a native blog identity or forged passed label as genuine article query proof', () => {
  const digest = 'a'.repeat(64), manifest: Native44CompareManifest = { ...fingerprintNative44Snapshot({ hash: digest, elements: [], settings: {} }), version: 1, strategy: 'native44-css-handoff', taskId: 'fixture', runId: 'fixture-run', pageId: 42, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/', canvasCss: '', cssRules: [], modules: [], widgetTypes: ['wd_blog'] };
  const capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1920, devicePixelRatio: 1, source: { screenshot: '', sha256: digest, modules: [] }, target: { screenshot: '', sha256: digest, modules: [] } };
  assert.ok(analyzeNative44Captures(manifest, [capture]).gaps.some(gap => gap.category === 'query'));
  manifest.postChecks = [check]; capture.target.postChecks = [{ componentKey: 'news', selector: check.selector, widgetType: 'wd_blog', viewport: capture.viewport, expectedPostIds: [10, 9], status: 'passed', problems: [], posts: [], nativeWidgetCount: 1 }];
  assert.ok(analyzeNative44Captures(manifest, [capture]).gaps.some(gap => /identities/.test(gap.detail)));
});

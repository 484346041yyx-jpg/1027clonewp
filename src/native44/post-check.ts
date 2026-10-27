import type { Page } from 'playwright';
import { assertTargetPostsEvidence, type TargetPostsEvidence } from '../wordpress/posts-contract.js';
import { normalizeTargetPostsQuery } from '../wordpress/posts-contract.js';
import type { Native44PostQueryReceipt } from './types.js';

/** Only native article-list owners may use target-post content adaptation. */
export interface Native44PostCheck {
  componentKey: string; selector: string; widgetType: 'wd_blog'; expectedPostIds: number[]; posts: TargetPostsEvidence;
  layout?: { mode: 'grid' | 'list' | 'carousel'; columns?: number; imageRequired?: boolean; excerptRequired?: boolean; dateRequired?: boolean; pagination?: 'none' | 'links' | 'load-more' | 'infinite' };
}
export interface Native44ObservedPost {
  id: number; title: string; permalink: string; imageUrl: string; imageDrawable: boolean;
  excerpt: string; dateText: string; dateTime?: string; visible: boolean;
  dateDay?: string; dateMonth?: string;
  box: { x: number; y: number; width: number; height: number };
  titlePainted: boolean; titleClipped: boolean;
}
export interface Native44PostCheckEvidence {
  componentKey: string; selector: string; widgetType: 'wd_blog'; viewport: string;
  expectedPostIds: number[]; status: 'passed' | 'failed' | 'unverified'; problems: string[];
  nativeWidgetCount: number; actualWidgetType?: string; elementId?: string; posts: Native44ObservedPost[];
  layout?: { columns: number; carousel: boolean; pagination: string[] };
  nativeQuery?: Record<string, unknown>; nativeQueryPaged?: number;
}
export function native44PostChecksFromReceipts(receipts: Native44PostQueryReceipt[], snapshots: TargetPostsEvidence[], pageId: number): Native44PostCheck[] {
  return receipts.map(receipt => {
    const normalized = normalizeTargetPostsQuery(receipt.query), posts = snapshots.find(snapshot => JSON.stringify(snapshot.query) === JSON.stringify(normalized));
    if (!posts || JSON.stringify(receipt.observedPostIds) !== JSON.stringify(posts.posts.map(post => post.id))) throw Error('Blog receipt has no exact observed dynamic query snapshot');
    const size = (value: unknown): number | undefined => { const result = Number(value && typeof value === 'object' ? (value as { size?: unknown }).size : value); return Number.isInteger(result) && result > 0 ? result : undefined; };
    const carousel = receipt.settings.blog_design === 'carousel' || receipt.settings.blog_layout === 'carousel';
    const pagination = String(receipt.settings.pagination ?? '');
    return { componentKey: receipt.componentKey, selector: `.elementor-${pageId} [data-id="${receipt.elementId}"]`, widgetType: 'wd_blog', expectedPostIds: [...receipt.observedPostIds], posts,
      layout: { mode: carousel ? 'carousel' : receipt.settings.blog_design === 'list' || receipt.settings.blog_layout === 'list' ? 'list' : 'grid', ...(size(receipt.settings.blog_columns) ? { columns: size(receipt.settings.blog_columns) } : {}), imageRequired: receipt.settings.parts_media !== '' && receipt.settings.parts_media !== false, excerptRequired: receipt.settings.parts_text === '1' || receipt.settings.show_excerpt === 'yes' || receipt.settings.blog_show_excerpt === 'yes', dateRequired: receipt.settings.parts_published_date === '1' || receipt.settings.show_date === 'yes', pagination: !pagination || ['none', 'disable', 'disabled'].includes(pagination) ? 'none' : ['more-btn', 'load_more', 'load-more'].includes(pagination) ? 'load-more' : pagination === 'infinit' || pagination === 'infinite' ? 'infinite' : 'links' } };
  });
}
const text = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/g, '&').replace(/&#(?:0*39|x0*27);|&apos;/gi, "'").replace(/&quot;|&#(?:0*34|x0*22);/gi, '"').replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value))).replace(/&#x([a-f\d]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16))).normalize('NFC').replace(/\s+/g, ' ').trim();
const excerptText = (value: string) => text(value).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/(?:\s*\[?…\]?|\s*\.{3}|\s*\[\.\.\.\])$/, '').trim();

export function native44ObservedPostQueryProblems(check: Native44PostCheck, actual: Record<string, unknown> | undefined, paged?: number): string[] {
  if (!actual) return ['Native blog has no unique actual published-post query attributes'];
  const empty = (value: unknown) => value === undefined || value === null || value === '' || Array.isArray(value) && !value.length;
  const query = check.posts.query, taxonomy = [...query.categoryIds, ...query.tagIds].sort((a, b) => a - b), observedTaxonomy = empty(actual.taxonomies) ? [] : (Array.isArray(actual.taxonomies) ? actual.taxonomies : String(actual.taxonomies).split(',')).map(Number).sort((a, b) => a - b);
  const valid = actual.post_type === 'post' && Number(actual.items_per_page) === query.itemsPerPage && actual.orderby === 'date' && String(actual.order).toUpperCase() === 'DESC' && Number(actual.offset || 0) === query.offset && JSON.stringify(observedTaxonomy) === JSON.stringify(taxonomy) && ['include', 'exclude', 'meta_key'].every(key => empty(actual[key])) && paged === 1;
  return valid ? [] : ['Actual native blog query differs from the observed dynamic target published-post query'];
}

export function native44ObservedPostProblems(check: Native44PostCheck, observed: Native44ObservedPost[]): string[] {
  const problems: string[] = [];
  try { assertTargetPostsEvidence(check.posts); if (!check.posts.evidence.length) throw Error('Missing target post evidence'); } catch { return ['Target published-post query provenance is invalid']; }
  const expected = new Map(check.posts.posts.map(post => [post.id, post]));
  if (!check.expectedPostIds.length || new Set(check.expectedPostIds).size !== check.expectedPostIds.length || JSON.stringify(check.expectedPostIds) !== JSON.stringify(check.posts.posts.map(post => post.id))) problems.push('Observed latest published-post IDs differ from the declared target query snapshot');
  if (observed.length !== check.expectedPostIds.length || observed.some((post, index) => post.id !== check.expectedPostIds[index])) problems.push('Actual non-clone post identities or order differ from the current target published-post query');
  for (const post of observed) {
    const record = expected.get(post.id);
    if (!record) { problems.push(`Unproven target post identity: ${post.id}`); continue; }
    if (post.permalink !== record.permalink) problems.push(`Post ${post.id} link differs from its actual target record`);
    if (!text(post.title) || text(post.title) !== text(record.title)) problems.push(`Post ${post.id} title differs from its actual target record`);
    if (check.layout?.imageRequired !== false && (!record.imageUrl || !post.imageDrawable || ![record.imageUrl, ...record.imageVariants].includes(post.imageUrl))) problems.push(`Post ${post.id} featured image is missing, undecodable or not a target media variant`);
    if (check.layout?.excerptRequired) {
      const actual = excerptText(post.excerpt), originals = [record.excerpt, record.contentText ?? ''].map(excerptText).filter(Boolean);
      if (!actual || !originals.some(original => actual === original || actual.split(' ').length >= 5 && original.startsWith(actual))) problems.push(`Post ${post.id} excerpt differs from the target article excerpt`);
    }
    if (check.layout?.dateRequired) {
      const date = new Date(record.date), exact = post.dateTime ? post.dateTime.slice(0, 10) === record.date.slice(0, 10) : post.dateDay && post.dateMonth ? Number(post.dateDay) === Number(record.date.slice(8, 10)) && post.dateMonth.toLowerCase() === new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date).toLowerCase() : Number.isFinite(Date.parse(post.dateText)) && new Date(post.dateText).toISOString().slice(0, 10) === record.date.slice(0, 10);
      if (!post.dateText || !exact) problems.push(`Post ${post.id} publication date is missing or differs from the target article`);
    }
    if (!post.visible || !post.titlePainted || post.titleClipped) problems.push(`Post ${post.id} card or complete title is not visibly drawn`);
  }
  return problems;
}

export function native44PostEvidencePassed(check: Native44PostCheck, row: Native44PostCheckEvidence): boolean {
  if (!row || row.componentKey !== check.componentKey || row.selector !== check.selector || row.widgetType !== 'wd_blog' || row.actualWidgetType !== 'wd_blog.default' || row.nativeWidgetCount !== 1 || !/^[a-f0-9]{7}$/.test(row.elementId ?? '') || row.status !== 'passed' || !Array.isArray(row.problems) || row.problems.length || !Array.isArray(row.posts) || JSON.stringify(row.expectedPostIds) !== JSON.stringify(check.expectedPostIds) || native44ObservedPostProblems(check, row.posts).length || native44ObservedPostQueryProblems(check, row.nativeQuery, row.nativeQueryPaged).length) return false;
  if (check.layout?.columns !== undefined && row.layout?.columns !== Math.min(check.layout.columns, row.posts.length)) return false;
  if (Boolean(row.layout?.carousel) !== (check.layout?.mode === 'carousel') || check.layout?.pagination && check.layout.pagination !== 'none' || row.layout?.pagination?.length) return false;
  return true;
}

/** Reads genuine native DOM. Expected backend records never fill DOM gaps. */
export async function collectNative44PostChecks(page: Page, checks: Native44PostCheck[], viewport: string): Promise<Native44PostCheckEvidence[]> {
  const savedScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY })), results: Native44PostCheckEvidence[] = [];
  try {
    for (const check of checks) {
      const row: Native44PostCheckEvidence = { componentKey: check.componentKey, selector: check.selector, widgetType: 'wd_blog', viewport, expectedPostIds: [...check.expectedPostIds], status: 'unverified', problems: [], nativeWidgetCount: 0, posts: [] }; results.push(row);
      try {
        assertTargetPostsEvidence(check.posts, new URL(page.url()).origin);
        const root = page.locator(check.selector); row.nativeWidgetCount = await root.count();
        if (row.nativeWidgetCount !== 1) throw Error('Post query requires one exact native blog widget owner');
        row.actualWidgetType = await root.getAttribute('data-widget_type') ?? undefined; row.elementId = await root.getAttribute('data-id') ?? undefined;
        if (row.actualWidgetType !== 'wd_blog.default' || !/^[a-f0-9]{7}$/.test(row.elementId ?? '')) throw Error('Actual article-list owner is not the exact native wd_blog widget');
        if (!await root.isVisible()) throw Error('Native blog widget is not visible');
        await root.scrollIntoViewIfNeeded();
        // Compile a self-contained observer: tsx's module helper must not be a
        // hidden browser dependency. This adds no globals and makes no writes.
        const observe = (element: Element) => {
          const __name = <T>(value: T) => value;
          const owner = (node: Element) => node.closest('[data-widget_type]') === element;
          const shown = (node: Element) => { const box = node.getBoundingClientRect(); if (box.width <= 1 || box.height <= 1) return false; for (let at: Element | null = node; at; at = at.parentElement) { const css = getComputedStyle(at); if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false; } return true; };
          const candidates = Array.from(element.querySelectorAll('article[id^="post-"],article[class*="post-"],.blog-post-loop[data-id],.blog-post-loop[data-post-id]')).filter(node => owner(node) && !node.closest('.swiper-slide-duplicate,.slick-cloned'));
          const cards = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
          const posts = cards.map(card => {
            const identity = card.getAttribute('data-post-id') ?? card.getAttribute('data-id') ?? card.id.match(/^post-(\d+)$/)?.[1] ?? Array.from(card.classList).map(name => /^post-(\d+)$/.exec(name)?.[1]).find(Boolean) ?? '';
            const heading = card.querySelector('.entry-title a[href],.wd-entities-title a[href],h2 a[href],h3 a[href]') as HTMLAnchorElement | null;
            const image = card.querySelector('.post-img-wrapp img,.entry-thumbnail img,.post-image img,img') as HTMLImageElement | null;
            const excerpt = card.querySelector('.entry-content,.wd-entry-content,.post-excerpt'), date = card.querySelector('time,.meta-date,.post-date,.wd-post-date');
            const box = card.getBoundingClientRect(); let clipped = false;
            if (heading) { const range = document.createRange(); range.selectNodeContents(heading); const rects = Array.from(range.getClientRects()); for (let ancestor: Element | null = heading; ancestor && ancestor !== card.parentElement; ancestor = ancestor.parentElement) { const css = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect(); if (/hidden|clip|auto|scroll/.test(css.overflowY) && rects.some(rect => rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1) || /hidden|clip|auto|scroll/.test(css.overflowX) && rects.some(rect => rect.left < clip.left - 1 || rect.right > clip.right + 1)) clipped = true; } }
            return { id: Number(identity), title: heading?.innerText?.trim() ?? '', permalink: heading?.href ?? '', imageUrl: image?.currentSrc || image?.src || '', imageDrawable: Boolean(image?.complete && image.naturalWidth > 0 && shown(image)), excerpt: (excerpt as HTMLElement | null)?.innerText?.trim() ?? '', dateText: (date as HTMLElement | null)?.innerText?.trim() ?? '', ...(date?.getAttribute('datetime') ? { dateTime: date.getAttribute('datetime')! } : {}), ...(date?.querySelector('.post-date-day') ? { dateDay: date.querySelector('.post-date-day')!.textContent!.trim(), dateMonth: date.querySelector('.post-date-month')?.textContent?.trim() ?? '' } : {}), visible: shown(card), box: { x: box.x, y: box.y, width: box.width, height: box.height }, titlePainted: Boolean(heading && shown(heading) && Number.parseFloat(getComputedStyle(heading).fontSize) > 0 && getComputedStyle(heading).color !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(getComputedStyle(heading).color) && getComputedStyle(heading).webkitTextFillColor !== 'transparent'), titleClipped: clipped };
          });
          const tops: number[] = [], first = posts[0]?.box.y; for (const post of posts) if (first !== undefined && Math.abs(post.box.y - first) <= 3 && !tops.some(left => Math.abs(left - post.box.x) <= 3)) tops.push(post.box.x);
          const carousel = Boolean(element.querySelector('.wd-carousel,.swiper,.owl-carousel'));
          const pagination = Array.from(element.querySelectorAll('.wd-load-more,.load-more,.infinite-scrolling,.woocommerce-pagination,.blog-pagination,.wd-pagination')).filter(owner).map(node => node.className);
          const holders = Array.from(element.querySelectorAll('.wd-posts[data-atts]')).filter(owner); let nativeQuery: Record<string, unknown> | undefined;
          if (holders.length === 1) try { nativeQuery = JSON.parse(holders[0].getAttribute('data-atts')!); } catch { /* Unknown attributes remain absent proof. */ }
          return { posts, layout: { columns: tops.length, carousel, pagination }, nativeQuery, nativeQueryPaged: holders.length === 1 ? Number(holders[0].getAttribute('data-paged')) : undefined };
        };
        const selfContained = new Function('element', `const __name=value=>value;return (${observe.toString()})(element);`) as (element: Element) => { posts: Native44ObservedPost[]; layout: NonNullable<Native44PostCheckEvidence['layout']>; nativeQuery?: Record<string, unknown>; nativeQueryPaged?: number };
        const observed = await root.evaluate(selfContained); row.posts = observed.posts; row.layout = observed.layout; row.nativeQuery = observed.nativeQuery; row.nativeQueryPaged = observed.nativeQueryPaged;
        row.problems.push(...native44ObservedPostProblems(check, row.posts), ...native44ObservedPostQueryProblems(check, row.nativeQuery, row.nativeQueryPaged));
        if (check.layout?.columns !== undefined && row.layout.columns !== Math.min(check.layout.columns, row.posts.length)) row.problems.push('Actual blog card columns differ from the declared desktop layout');
        if (check.layout?.mode !== 'carousel' && row.layout.carousel) row.problems.push('Declared static blog layout unexpectedly exposes a carousel');
        if (check.layout?.mode === 'carousel' && !row.layout.carousel) row.problems.push('Declared blog carousel is not mounted');
        if ((!check.layout?.pagination || check.layout.pagination === 'none') && row.layout.pagination.length) row.problems.push('Native blog exposes undeclared pagination or loading controls');
        if (check.layout?.pagination && check.layout.pagination !== 'none') { row.status = 'unverified'; row.problems.push('Selected blog pagination needs its own actual loading/navigation and restoration proof'); }
        else row.status = row.problems.length ? 'failed' : 'passed';
      } catch (error) { row.status = 'failed'; row.problems.push(error instanceof Error ? error.message : 'Target blog observation failed'); }
    }
  } finally { await page.evaluate(point => scrollTo({ left: point.x, top: point.y, behavior: 'instant' }), savedScroll); }
  return results;
}

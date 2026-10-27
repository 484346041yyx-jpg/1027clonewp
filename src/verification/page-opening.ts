import type { BrowserContext, Page, Response } from 'playwright';

export const PUBLIC_PAGE_OPEN_BUDGET_MS = 180_000;
export const PUBLIC_PAGE_OPEN_STAGGER_MS = 15_000;
export const PUBLIC_PAGE_OPEN_MAX_CANDIDATES = 3;

export interface OpenReadOnlyPageOptions {
  maxCandidates?: number;
  staggerMs?: number;
  budgetMs?: number;
  /** A caller may require a specific page root, rather than treating any body as success. */
  ready?: (page: Page) => Promise<boolean>;
}

function sameDocument(actual: string, expected: URL): boolean {
  try {
    const url = new URL(actual);
    return url.origin === expected.origin && url.pathname === expected.pathname && url.search === expected.search;
  } catch { return false; }
}

/** Race only read-only browser pages. The caller owns the returned page; every loser is closed here. */
export async function openReadOnlyPage(context: BrowserContext, url: string, options: OpenReadOnlyPageOptions = {}): Promise<{ page: Page; attempts: number; status: number | null }> {
  const expected = new URL(url);
  if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password) throw Error('public_page_open_url_invalid');
  const maxCandidates = options.maxCandidates ?? PUBLIC_PAGE_OPEN_MAX_CANDIDATES;
  const staggerMs = options.staggerMs ?? PUBLIC_PAGE_OPEN_STAGGER_MS;
  const budgetMs = options.budgetMs ?? PUBLIC_PAGE_OPEN_BUDGET_MS;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > PUBLIC_PAGE_OPEN_MAX_CANDIDATES
    || !Number.isInteger(staggerMs) || staggerMs < 0 || !Number.isInteger(budgetMs) || budgetMs < 1) throw Error('public_page_open_options_invalid');
  const started = performance.now();
  const pages = new Set<Page>();
  const creations: Promise<Page>[] = [];
  const closures = new Map<Page, Promise<void>>();
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const wait = (ms: number): Promise<void> => new Promise(resolve => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
    timers.set(timer, resolve);
  });
  const cancelWaits = () => {
    for (const [timer, resolve] of timers) { clearTimeout(timer); resolve(); }
    timers.clear();
  };
  const closePage = (page: Page): Promise<void> => {
    let closure = closures.get(page);
    if (!closure) {
      closure = Promise.resolve().then(() => page.close()).catch(() => { throw Error('public_page_open_cleanup_failed'); });
      closures.set(page, closure);
    }
    return closure;
  };
  let finished = false;
  let retainedPage: Page | undefined;
  let attempts = 0;
  const cleanup = async (): Promise<void> => {
    const closing = Promise.all([...pages].filter(page => page !== retainedPage).map(closePage));
    const lateClosing = Promise.allSettled(creations).then(() => Promise.all([...pages].filter(page => page !== retainedPage).map(closePage)));
    await Promise.all([closing, lateClosing]);
  };
  let deadlineTimer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => reject(Error('public_page_open_budget_exhausted')), budgetMs);
  });
  const workers = Array.from({ length: maxCandidates }, async (_, index) => {
    if (index) await wait(staggerMs * index);
    if (finished || performance.now() - started >= budgetMs) throw Error('public_page_open_superseded');
    const creation = context.newPage().then(async page => {
      pages.add(page);
      if (finished && page !== retainedPage) await closePage(page);
      return page;
    });
    creations.push(creation);
    const page = await creation;
    if (finished) { await closePage(page); throw Error('public_page_open_superseded'); }
    attempts++;
    const remaining = Math.max(1, Math.floor(budgetMs - (performance.now() - started)));
    try {
      const response: Response | null = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: remaining });
      if (!sameDocument(page.url(), expected) || !response || response.status() >= 400) throw Error('public_page_open_wrong_document');
      const body = page.locator('body');
      await body.waitFor({ state: 'attached', timeout: Math.min(10_000, Math.max(1, Math.floor(budgetMs - (performance.now() - started)))) });
      const text = (await body.innerText({ timeout: Math.min(5_000, Math.max(1, Math.floor(budgetMs - (performance.now() - started)))) })).slice(0, 1000);
      const title = await page.title();
      if (/just a moment|checking your browser|access denied|verify (?:that )?you are human|captcha/i.test(`${title} ${text}`) && text.length < 800
        || await page.locator('#loginform, input[name="log"]').count() > 0) throw Error('public_page_open_access_required');
      if (options.ready && !await options.ready(page)) throw Error('public_page_open_not_ready');
      if (finished) throw Error('public_page_open_superseded');
      return { page, status: response.status() };
    } catch (error) {
      await closePage(page);
      throw error;
    }
  });
  try {
    const winner = await Promise.race([Promise.any(workers), deadline]);
    finished = true;
    retainedPage = winner.page;
    cancelWaits();
    await Promise.race([cleanup(), deadline]);
    return { ...winner, attempts };
  } catch (error) {
    finished = true;
    retainedPage = undefined;
    cancelWaits();
    let failure = error;
    try { await Promise.race([cleanup(), deadline]); } catch (cleanupError) { failure = cleanupError; }
    if (failure instanceof Error && ['public_page_open_cleanup_failed', 'public_page_open_budget_exhausted'].includes(failure.message)) throw failure;
    if (failure instanceof AggregateError && failure.errors.some(item => item instanceof Error && item.message === 'public_page_open_access_required')) throw Error('public_page_open_access_required');
    throw Error('public_page_open_failed_after_bounded_candidates');
  } finally {
    clearTimeout(deadlineTimer!);
  }
}

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { openReadOnlyPage } from '../../src/verification/page-opening.js';

// Local synthetic integration only: no existing browser, profile, real site or
// proxy setting is inspected. Event callbacks synchronously append in memory.
const browserOptions = existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' };
const url = 'https://reference.example/shop/';
let failures = 0;
for (let run = 1; run <= 6; run++) {
  const mode = run <= 3 ? 'original' : 'blank';
  const started = performance.now();
  const events: Array<Record<string, unknown>> = [];
  const record = (event: string, data: Record<string, unknown> = {}) => events.push({ ms: Math.round(performance.now() - started), event, ...data });
  record('browser.launch.begin');
  const browser = await chromium.launch(browserOptions);
  record('browser.launch.complete');
  let failure: string | undefined, tracePath: string | undefined;
  try {
    const context = await browser.newContext();
    record('context.created');
    // API events only: no screenshot or DOM snapshot recording during the race.
    await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
    const pages = new Map<Page, number>();
    let nextPage = 0, requests = 0, openingStarted = 0;
    let releaseThirdResponse!: () => void, releaseRound!: () => void, thirdResponseReceived = false;
    const thirdResponse = new Promise<void>(resolve => { releaseThirdResponse = resolve; });
    const roundEnded = new Promise<void>(resolve => { releaseRound = resolve; });
    const sourceStates = new Map<number, string>();
    const identify = (page: Page) => { if (!pages.has(page)) pages.set(page, ++nextPage); return pages.get(page)!; };
    context.on('page', page => {
      const id = identify(page); record('context.page', { id });
      sourceStates.set(id, 'not-started');
      let loading = false;
      page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          loading = true;
          if (request.url() === url) sourceStates.set(id, 'requested');
        }
        record('request', { id, url: request.url(), navigation: request.isNavigationRequest(), type: request.resourceType() });
      });
      page.on('response', response => {
        if (response.url() === url && response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) {
          sourceStates.set(id, 'response-received');
          if (id === 3 && response.status() === 200) { thirdResponseReceived = true; record('third.source.response', { id }); releaseThirdResponse(); }
        }
        record('response', { id, url: response.url(), status: response.status() });
      });
      page.on('requestfailed', request => record('requestfailed', { id, url: request.url(), failure: request.failure()?.errorText }));
      page.on('pageerror', error => record('pageerror', { id, error: error.message }));
      page.on('domcontentloaded', () => record('domcontentloaded', { id, url: page.url() }));
      page.on('load', () => { loading = false; record('load', { id, url: page.url() }); });
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame() && frame.url() === url) {
          sourceStates.set(id, 'committed');
          if (id === 3) record('third.source.committed', { id });
        }
        record('framenavigated', { id, main: frame === page.mainFrame(), url: frame.url() });
      });
      page.on('close', () => record('close', { id }));
      // Experimental exact-page cleanup only. The production race calls close
      // only for its owned losers (or all owned pages after failure).
      const originalClose = page.close.bind(page);
      page.close = async options => {
        record('close.requested', { id, loading, sourceState: sourceStates.get(id), mode });
        const remaining = Math.floor(3000 - (performance.now() - openingStarted));
        if (mode === 'blank' && !page.isClosed() && remaining > 0) {
          record('blank.begin', { id, remaining });
          try {
            await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: remaining });
            const actualUrl = page.url();
            record('blank.complete', { id, actualUrl });
            if (actualUrl !== 'about:blank') throw Error('diagnostic_blank_url_mismatch');
          } catch (error) {
            record('blank.error', { id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        record('originalClose.begin', { id, remaining: Math.floor(3000 - (performance.now() - openingStarted)) });
        await originalClose(options);
        record('close.confirmed', { id, closed: page.isClosed() });
      };
    });
    await context.route(url, route => {
      requests++;
      record('route', { number: requests, status: requests === 1 ? 503 : 200 });
      return route.fulfill({ status: requests === 1 ? 503 : 200, contentType: 'text/html', body: requests === 1 ? 'Unavailable' : '<main>Actual reference page</main>' });
    });
    record('opening.begin', { mode, budgetMs: 3000, staggerMs: 10, maxCandidates: 3 });
    openingStarted = performance.now();
    try {
      const result = await openReadOnlyPage(context, url, {
        staggerMs: 10, budgetMs: 3000,
        ready: async page => {
          const id = identify(page); record('ready.enter', { id });
          if (id === 2) { await thirdResponse; record('ready.second.released', { thirdSourceState: sourceStates.get(3) }); return true; }
          if (id === 3) { await roundEnded; record('ready.third.roundEnded', { id }); return false; }
          return false;
        },
      });
      record('opening.complete', { attempts: result.attempts, status: result.status, livePages: context.pages().map(page => ({ id: identify(page), url: page.url() })) });
      assert.ok(result.attempts >= 2 && result.attempts <= 3);
      assert.equal(await result.page.locator('main').innerText(), 'Actual reference page');
      assert.deepEqual(context.pages(), [result.page]);
      assert.equal(thirdResponseReceived, true);
      const losers = [...pages].filter(([page]) => page !== result.page).map(([page, id]) => ({ id, closed: page.isClosed() }));
      assert.ok(losers.every(page => page.closed));
      record('losers.confirmed', { losers });
      record('assertions.complete');
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      failures++;
      record('opening.error', { error: failure, requests, livePages: context.pages().map(page => ({ id: identify(page), url: page.url(), closed: page.isClosed() })) });
    } finally {
      releaseRound(); releaseThirdResponse();
      record('barriers.releasedAfterRound');
    }
    if (failure) {
      await mkdir('D:/cloneWP/.cache/page-opening-diagnostic', { recursive: true });
      tracePath = `D:/cloneWP/.cache/page-opening-diagnostic/response-gated-${mode}-failure-run-${run}.zip`;
      await context.tracing.stop({ path: tracePath });
    } else await context.tracing.stop();
  } finally {
    record('browser.close.begin');
    await browser.close();
    record('browser.close.complete');
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  process.stdout.write(JSON.stringify({ run, mode, outcome: failure ? 'failed' : 'passed', failure, tracePath, events }) + '\n');
}
process.exitCode = failures ? 1 : 0;

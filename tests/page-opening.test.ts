import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type BrowserContext, type Page, type Response } from 'playwright';
import { openReadOnlyPage } from '../src/verification/page-opening.js';

const browserOptions = existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' };

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function controlledPage(livePages: Set<Page>, options: { navigate?: () => Promise<void>; close?: () => Promise<void> } = {}) {
  let closeCalls = 0;
  const closed = deferred<void>();
  const page = {
    goto: async () => { await options.navigate?.(); return { status: () => 200 } as Response; },
    url: () => 'https://reference.example/shop/',
    title: async () => 'Reference',
    locator: () => ({ waitFor: async () => undefined, innerText: async () => 'Actual reference page', count: async () => 0 }),
    close: async () => { closeCalls++; await options.close?.(); livePages.delete(page); closed.resolve(); },
  } as unknown as Page;
  livePages.add(page);
  return { page, closeCalls: () => closeCalls, closed: closed.promise };
}

test('winning cleanup awaits in-flight owned creation and shares concurrent close operations', async () => {
  const livePages = new Set<Page>();
  const userPage = controlledPage(livePages);
  const allStarted = deferred<void>();
  const loserNavigation = deferred<void>();
  const loserCloseStarted = deferred<void>();
  const lateCreation = deferred<Page>();
  const lateCloseStarted = deferred<void>();
  const finishLateClose = deferred<void>();
  const winner = controlledPage(livePages, { navigate: () => allStarted.promise });
  const loser = controlledPage(livePages, {
    navigate: () => loserNavigation.promise,
    close: async () => { loserCloseStarted.resolve(); loserNavigation.reject(Error('closed')); },
  });
  const late = controlledPage(livePages, {
    close: async () => { lateCloseStarted.resolve(); await finishLateClose.promise; },
  });
  let creationCalls = 0;
  const context = {
    newPage: async () => {
      creationCalls++;
      if (creationCalls === 1) return winner.page;
      if (creationCalls === 2) return loser.page;
      allStarted.resolve();
      return lateCreation.promise;
    },
  } as unknown as BrowserContext;
  let returnedBeforeLateClosed = false;
  const opening = openReadOnlyPage(context, 'https://reference.example/shop/', { staggerMs: 0, budgetMs: 3000 }).then(result => {
    returnedBeforeLateClosed = livePages.has(late.page);
    finishLateClose.resolve();
    return result;
  });
  await loserCloseStarted.promise;
  lateCreation.resolve(late.page);
  await lateCloseStarted.promise;
  finishLateClose.resolve();
  const result = await opening;
  assert.equal(result.page, winner.page);
  assert.equal(returnedBeforeLateClosed, false);
  assert.deepEqual([...livePages], [userPage.page, winner.page]);
  assert.equal(loser.closeCalls(), 1);
  assert.equal(late.closeCalls(), 1);
  assert.equal(userPage.closeCalls(), 0);
});

test('a pending creation at the deadline is closed once ownership arrives without extending the budget', async () => {
  const livePages = new Set<Page>();
  const userPage = controlledPage(livePages);
  const creation = deferred<Page>();
  const late = controlledPage(livePages);
  let creationCalls = 0;
  const context = { newPage: () => { creationCalls++; return creation.promise; } } as unknown as BrowserContext;
  await assert.rejects(openReadOnlyPage(context, 'https://reference.example/shop/', {
    maxCandidates: 1, budgetMs: 10,
  }), /public_page_open_budget_exhausted/);
  assert.equal(creationCalls, 1);
  assert.equal(late.closeCalls(), 0);
  creation.resolve(late.page);
  await late.closed;
  assert.equal(late.closeCalls(), 1);
  assert.equal(userPage.closeCalls(), 0);
  assert.deepEqual([...livePages], [userPage.page]);
});

test('a winner is not delivered while a late owned creation remains unresolved at the deadline', async () => {
  const livePages = new Set<Page>();
  const userPage = controlledPage(livePages);
  const lateStarted = deferred<void>();
  const creation = deferred<Page>();
  const winner = controlledPage(livePages, { navigate: () => lateStarted.promise });
  const late = controlledPage(livePages);
  let creationCalls = 0;
  const context = {
    newPage: async () => {
      creationCalls++;
      if (creationCalls === 1) return winner.page;
      lateStarted.resolve();
      return creation.promise;
    },
  } as unknown as BrowserContext;
  await assert.rejects(openReadOnlyPage(context, 'https://reference.example/shop/', {
    maxCandidates: 2, staggerMs: 0, budgetMs: 20,
  }), /public_page_open_budget_exhausted/);
  assert.equal(creationCalls, 2);
  assert.equal(winner.closeCalls(), 1);
  assert.equal(late.closeCalls(), 0);
  creation.resolve(late.page);
  await late.closed;
  assert.deepEqual([...livePages], [userPage.page]);
});

test('winning before the stagger cancels unopened candidates without closing a user page', async () => {
  const livePages = new Set<Page>();
  const userPage = controlledPage(livePages);
  const winner = controlledPage(livePages);
  let creationCalls = 0;
  const context = { newPage: async () => { creationCalls++; return winner.page; } } as unknown as BrowserContext;
  const result = await openReadOnlyPage(context, 'https://reference.example/shop/', { staggerMs: 500, budgetMs: 2000 });
  assert.equal(result.page, winner.page);
  assert.equal(creationCalls, 1);
  assert.deepEqual([...livePages], [userPage.page, winner.page]);
});

test('a never-resolving owned close cannot extend the opening deadline or deliver a winner', { timeout: 1000 }, async () => {
  const livePages = new Set<Page>();
  const userPage = controlledPage(livePages);
  const loserStarted = deferred<void>();
  const loserNavigation = deferred<void>();
  const finishClose = deferred<void>();
  const winner = controlledPage(livePages, { navigate: () => loserStarted.promise });
  const loser = controlledPage(livePages, {
    navigate: () => loserNavigation.promise,
    close: async () => { loserNavigation.reject(Error('closed')); await finishClose.promise; },
  });
  let creationCalls = 0;
  const context = {
    newPage: async () => {
      creationCalls++;
      if (creationCalls === 1) return winner.page;
      loserStarted.resolve();
      return loser.page;
    },
  } as unknown as BrowserContext;
  await assert.rejects(openReadOnlyPage(context, 'https://reference.example/shop/', {
    maxCandidates: 2, staggerMs: 0, budgetMs: 20,
  }), /public_page_open_budget_exhausted/);
  assert.equal(winner.closeCalls(), 1);
  assert.equal(loser.closeCalls(), 1);
  assert.equal(userPage.closeCalls(), 0);
  assert.equal(livePages.has(loser.page), true);
  finishClose.resolve();
  await loser.closed;
  assert.deepEqual([...livePages], [userPage.page]);
  assert.equal(loser.closeCalls(), 1);
});

test('an owned close rejection fails delivery without swallowing it or blindly retrying', async () => {
  const livePages = new Set<Page>();
  const userPage = controlledPage(livePages);
  const loserStarted = deferred<void>();
  const loserNavigation = deferred<void>();
  const winner = controlledPage(livePages, { navigate: () => loserStarted.promise });
  const loser = controlledPage(livePages, {
    navigate: () => loserNavigation.promise,
    close: async () => { loserNavigation.reject(Error('closed')); throw Error('injected_close_rejection'); },
  });
  let creationCalls = 0;
  const context = {
    newPage: async () => {
      creationCalls++;
      if (creationCalls === 1) return winner.page;
      loserStarted.resolve();
      return loser.page;
    },
  } as unknown as BrowserContext;
  await assert.rejects(openReadOnlyPage(context, 'https://reference.example/shop/', {
    maxCandidates: 2, staggerMs: 0, budgetMs: 2000,
  }), /public_page_open_cleanup_failed/);
  await winner.closed;
  assert.equal(loser.closeCalls(), 1);
  assert.equal(userPage.closeCalls(), 0);
  assert.deepEqual([...livePages], [userPage.page, loser.page]);
});

test('a later healthy read-only page wins and every losing owned tab is closed', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext();
    let requests = 0;
    await context.route('https://reference.example/shop/', route => {
      requests++;
      return route.fulfill({ status: requests === 1 ? 503 : 200, contentType: 'text/html', body: requests === 1 ? 'Unavailable' : '<main>Actual reference page</main>' });
    });
    // This integration checks selection/cleanup, not browser startup performance.
    // Other concurrent workspace tasks can consume the original 3s budget.
    // Deterministic deadline/late-cleanup tests above still enforce short hard bounds.
    const result = await openReadOnlyPage(context, 'https://reference.example/shop/', { staggerMs: 10, budgetMs: 10000 });
    assert.ok(result.attempts >= 2 && result.attempts <= 3);
    assert.equal(await result.page.locator('main').innerText(), 'Actual reference page');
    assert.deepEqual(context.pages(), [result.page]);
  } finally { await browser.close(); }
});

test('read-only opening rejects a login redirect and exhausts bounded candidates', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext();
    await context.route('https://target.example/**', route => route.request().url().endsWith('/preview/')
      ? route.fulfill({ status: 302, headers: { location: '/wp-login.php' }, body: '' })
      : route.fulfill({ status: 200, contentType: 'text/html', body: 'Login' }));
    await assert.rejects(openReadOnlyPage(context, 'https://target.example/preview/', {
      maxCandidates: 2, staggerMs: 10, budgetMs: 2000,
    }), /bounded_candidates|budget_exhausted/);
    await Promise.all(context.pages().map(page => page.isClosed() ? Promise.resolve() : page.waitForEvent('close', { timeout: 1000 })));
    assert.equal(context.pages().length, 0);
  } finally { await browser.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { attachEditorStartupNetwork, awaitNativeEditorReady } from '../src/verification/editor-readiness.js';

const privateQuery = 'private-preview-nonce-DO-NOT-PERSIST';
const privateCookie = 'private-auth-cookie-DO-NOT-PERSIST';

async function fixture(options: { roots: string[]; panelDelay?: number; frameDelay?: number; rootsDelay?: number; throwsWhilePanelBoots?: boolean }) {
  const requests: Array<{ method: string; pathname: string }> = [];
  const server = createServer((request: IncomingMessage, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push({ method: request.method ?? '', pathname: url.pathname });
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/styles.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end('.elementor-element{display:block;min-height:50px;background:#eee}');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/preview') {
      response.end(`<!doctype html><html><head><title>Public draft fixture</title><link rel="stylesheet" href="/styles.css?token=${privateQuery}"></head><body><main class="elementor" data-elementor-id="11"><div id="late-native-roots"></div></main><script>
        setTimeout(() => { document.querySelector('#late-native-roots').innerHTML = ${JSON.stringify(options.roots.map(id => `<div class="elementor-element e-con e-parent" data-id="${id}" data-element_type="container"><p>Native source block</p></div>`).join(''))}; }, ${options.rootsDelay ?? 300});
      </script></body></html>`);
      return;
    }
    if (url.pathname === '/wp-admin/post.php') {
      response.setHeader('Set-Cookie', `fixture_auth=${privateCookie}; Path=/; SameSite=Lax`);
      response.end(`<!doctype html><html><head><title>Elementor owned draft fixture</title></head><body><div id="elementor-editor-wrapper"><aside id="elementor-panel"><div id="elementor-panel-inner"><div id="elementor-panel-content-wrapper">Editor panel</div></div></aside><iframe id="elementor-preview-iframe" title="Elementor preview" style="width:700px;height:500px;display:block"></iframe></div><script>
        ${options.throwsWhilePanelBoots ? "window.elementor = { getPanelView: () => { throw new TypeError('Panel view is not initialized yet'); } };" : ''}
        setTimeout(() => { window.elementor = { config: { document: { id: 11 } }, getPanelView: () => ({ getCurrentPageView: () => ({ model: { id: '1111111', get: key => key === 'id' ? '1111111' : undefined } }) }) }; }, ${options.panelDelay ?? 150});
        setTimeout(() => { document.querySelector('#elementor-preview-iframe').src = '/preview?preview=true&nonce=${privateQuery}'; }, ${options.frameDelay ?? 250});
      </script></body></html>`);
      return;
    }
    response.statusCode = 404;
    response.end('Fixture route unavailable');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    editorUrl: `http://127.0.0.1:${address.port}/wp-admin/post.php?post=11&action=elementor&nonce=${privateQuery}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function assertNoPrivateValues(serialized: string) {
  assert.equal(serialized.includes(privateQuery), false, 'query authentication values must never enter readiness evidence');
  assert.equal(serialized.includes(privateCookie), false, 'cookie authentication values must never enter readiness evidence');
  assert.equal(serialized.includes('fixture_auth'), false, 'authentication cookie names must not enter readiness evidence');
  assert.equal(serialized.includes('?post='), false, 'editor response locations must omit query strings');
  assert.equal(serialized.includes('?preview='), false, 'preview response locations must omit query strings');
  assert.equal(serialized.includes('?token='), false, 'resource locations must omit query strings');
}

function assertReadOnlyRequests(requests: Array<{ method: string; pathname: string }>) {
  assert.ok(requests.length >= 2, 'fixture must load both editor and preview documents');
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.ok(requests.every(request => !/save|publish|admin-ajax|wp-json/i.test(request.pathname)), 'readiness must not call an editing or publishing endpoint');
}

test('native editor readiness waits for the actual delayed panel, preview document and every source root under one budget', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-editor-ready-'));
  const source = await fixture({ roots: ['1111111', '2222222'], panelDelay: 400, throwsWhilePanelBoots: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const network = attachEditorStartupNetwork(page);
    await page.goto(source.editorUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(() => {
      try { (window as unknown as { elementor: { getPanelView: () => unknown } }).elementor.getPanelView(); return false; }
      catch (error) { return error instanceof TypeError; }
    }), true, 'fixture must expose the actual transient panel API failure before readiness starts');
    const started = Date.now();
    const report = await awaitNativeEditorReady({ page, editorUrl: source.editorUrl, rootIds: ['1111111', '2222222'], runDir: directory, label: 'delayed-ready', requirePanelAPI: true, timeoutMs: 2000, responses: network });
    assert.equal(report.passed, true);
    assert.ok(Date.now() - started >= 200, 'returning at initial blank iframe or panel markup would miss late native roots');
    assert.equal(await page.frameLocator('#elementor-preview-iframe').locator('[data-id="2222222"][data-element_type="container"]').count(), 1);
    assert.deepEqual(report.stages.map(stage => stage.name), ['panel-model', 'preview-document', 'native-roots']);
    assert.ok(report.stages.every(stage => stage.passed));
    assert.equal(report.readOnly, true);
    const evidence = await readFile(path.join(directory, 'verification', 'editor-readiness', 'delayed-ready.json'), 'utf8');
    assert.equal(JSON.parse(evidence).passed, true);
    assertNoPrivateValues(evidence);
    assert.ok(report.documentResponses.some(response => response.location.endsWith('/preview')));
    assertNoPrivateValues(JSON.stringify(network));
    assert.ok(network.some(response => response.location.endsWith('/wp-admin/post.php')));
    assert.ok(network.some(response => response.location.endsWith('/preview')));
    assertReadOnlyRequests(source.requests);
  } finally {
    await browser.close();
    await source.close();
    assert.ok(path.relative(os.tmpdir(), directory).startsWith('clonewp-editor-ready-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('a visible unrelated native node cannot satisfy a missing source root and timeout persists safe failure evidence without saving', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-editor-missing-root-'));
  const source = await fixture({ roots: ['9999999'], panelDelay: 900, frameDelay: 1100, rootsDelay: 100 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const network = attachEditorStartupNetwork(page);
    await page.goto(source.editorUrl, { waitUntil: 'domcontentloaded' });
    const started = Date.now();
    let failure: unknown;
    try {
      await awaitNativeEditorReady({ page, editorUrl: source.editorUrl, rootIds: ['1111111'], runDir: directory, label: 'missing-root', requirePanelAPI: true, timeoutMs: 2000, responses: network });
    } catch (error) { failure = error; }
    assert.ok(failure instanceof Error, 'absence of the required source root must reject, not report ready');
    assert.match(failure.message, /native|root|readiness/i);
    assertNoPrivateValues(failure.message);
    assert.ok(Date.now() - started < 2800, 'later phases cannot reset the two-second initialization budget');
    assert.equal(await page.frameLocator('#elementor-preview-iframe').locator('[data-id="9999999"]').count(), 1);
    const evidence = await readFile(path.join(directory, 'verification', 'editor-readiness', 'missing-root.json'), 'utf8');
    const report = JSON.parse(evidence);
    assert.equal(report.passed, false);
    assert.deepEqual(report.stages.map((stage: { name: string }) => stage.name), ['panel-model', 'preview-document', 'native-roots']);
    assert.equal(report.stages[0].passed, true);
    assert.equal(report.stages[1].passed, true);
    assert.equal(report.stages[2].passed, false);
    assert.ok(report.stages[2].remainingBudgetMs < 1300, 'late panel and document initialization consume the same budget as native roots');
    for (const stage of report.stages) assert.equal(stage.remainingBudgetMs, Math.max(0, report.budgetMs - stage.elapsedMs));
    assertNoPrivateValues(evidence);
    assertNoPrivateValues(JSON.stringify(network));
    assertReadOnlyRequests(source.requests);
  } finally {
    await browser.close();
    await source.close();
    assert.ok(path.relative(os.tmpdir(), directory).startsWith('clonewp-editor-missing-root-'));
    await rm(directory, { recursive: true, force: true });
  }
});

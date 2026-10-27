import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildNative44PageCSS, verifyNative44AppliedCSS, canonicalNative44CSS } from '../src/native44/css-handoff.js';
import { integrateNative44ComparisonResult, native44CompareBrowserOptions } from '../src/native44/compare-cli.js';
import { analyzeNative44Captures, captureNative44Role, compareNative44Run, fingerprintNative44Snapshot, recordNative44CSSReview, validateNative44CompareManifest, validateNative44StateAdaptations, NATIVE44_COMPARE_VIEWPORTS, type Native44CompareManifest, type Native44Capture } from '../src/native44/compare.js';
import type { LoadedNative44SourceCaptures } from '../src/native44/source-captures.js';

const digest = 'a'.repeat(64);
test('comparison factory preserves actual source layout scrollbar and clientWidth without page CSS or viewport compensation', async () => {
  for (const nativeScrollbars of [true, false]) {
    const sourceBrowser = await chromium.launch({ headless: true, ...(nativeScrollbars ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
    let targetBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      const sourcePage = await sourceBrowser.newPage({ viewport: { width: 1920, height: 1080 } }); await sourcePage.setContent('<main style="height:3000px">Source layout scrollbar fixture</main>');
      const actual = await sourcePage.evaluate(() => ({ width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollbarWidth: innerWidth - document.documentElement.clientWidth }));
      const options = native44CompareBrowserOptions([actual]); assert.equal(Array.isArray(options.ignoreDefaultArgs) && options.ignoreDefaultArgs.includes('--hide-scrollbars'), actual.scrollbarWidth > 0);
      targetBrowser = await chromium.launch(options); const targetPage = await targetBrowser.newPage({ viewport: { width: 1920, height: 1080 } }); await targetPage.setContent('<main style="height:3000px">Target layout scrollbar fixture</main>');
      assert.deepEqual(await targetPage.evaluate(() => ({ width: innerWidth, clientWidth: document.documentElement.clientWidth })), { width: actual.width, clientWidth: actual.clientWidth });
    } finally { await sourceBrowser.close(); await targetBrowser?.close(); }
  }
  assert.throws(() => native44CompareBrowserOptions([{ width: 1920, clientWidth: 1905, scrollbarWidth: 0 }]), /consistent viewport/);
});
function manifest(): Native44CompareManifest {
  const snapshot = fingerprintNative44Snapshot({ hash: digest, elements: [{ id: 'abcdef1', settings: { image: { id: 3, url: 'https://target.test/a.png' }, include: [10, 11], title: 'test' }, elements: [] }], settings: {} });
  return { ...snapshot, version: 1, strategy: 'native44-css-handoff', taskId: 'fixture', runId: 'fixture-run', pageId: 42, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/?page_id=42&preview=true', widgetTypes: ['container', 'heading'], canvasCss: '.elementor-42{width:100%;margin:0}', modules: [{ key: 'hero', className: 'cwp-hero', sourceSelector: '.cwp-hero', targetSelector: '.elementor-42 .cwp-hero', required: true }], cssRules: [{ moduleKey: 'hero', declarations: { 'max-width': '1440px', margin: '0 auto' }, reason: 'Observed centered source content width', evidence: ['source-facts.json#/hero/content-box'] }] };
}

test('page CSS uses actual page and stable module scope, including safe Canvas base styles', () => {
  const input = manifest(), result = buildNative44PageCSS({ pageId: input.pageId, modules: input.modules, rules: input.cssRules, canvasCss: input.canvasCss });
  assert.match(canonicalNative44CSS(result.css), /\.elementor-42 \.cwp-hero\{max-width:1440px;margin:0 auto\}/);
  assert.match(result.css, /Page Settings > Advanced > Custom CSS/);
  assert.equal(result.selectorMap[0].moduleKey, 'hero');
  assert.equal(verifyNative44AppliedCSS(result.css, result.css.replaceAll('\n', ' ')).applied, true);
  assert.equal(verifyNative44AppliedCSS(result.css, `${result.css}.elementor-42 .cwp-hero{color:red}`).applied, false);
});

test('CSS cannot escape the page, select clones, fake content or hide structural errors', () => {
  const input = manifest(), base = { pageId: input.pageId, modules: input.modules, canvasCss: input.canvasCss };
  const cases: Array<{ selector?: string; declarations: Record<string, string> }> = [
    { selector: 'body', declarations: { color: 'red' } },
    { selector: '+ .outside', declarations: { color: 'red' } },
    { selector: '.card:nth-child(2)', declarations: { color: 'red' } },
    { selector: '.swiper-slide-duplicate', declarations: { color: 'red' } },
    { selector: '::before', declarations: { content: '"Cheap products"' } },
    { declarations: { display: 'none' } },
    { declarations: { opacity: '0.0 !important' } },
    { declarations: { display: 'var(--hidden)' } },
    { declarations: { 'font-size': '0px' } },
    { declarations: { 'text-overflow': 'ellipsis' } },
    { declarations: { position: 'absolute', top: '200px' } },
    { declarations: { 'background-image': 'url(https://unbound.test/img.png)' } },
    { declarations: { width: '12px;color:red' } },
  ];
  for (const rule of cases) assert.throws(() => buildNative44PageCSS({ ...base, rules: [{ ...input.cssRules[0], ...rule }] }));
  assert.throws(() => buildNative44PageCSS({ ...base, canvasCss: '.elementor-42{display:none}', rules: [] }), /hide/);
  assert.throws(() => buildNative44PageCSS({ ...base, canvasCss: 'body{margin:0}', rules: [] }), /actual page/);
  assert.throws(() => buildNative44PageCSS({ ...base, rules: [{ ...input.cssRules[0], evidence: [] }] }), /unevidenced/);
});

test('fingerprints allow page CSS application but invalidate structure, media and query changes', () => {
  const original = { hash: digest, elements: [{ widgetType: 'wd_products', settings: { include: [1, 2], image: { id: 4 }, title: 'Products' } }], settings: { custom_css: 'old' } };
  const before = fingerprintNative44Snapshot(original), cssOnly = fingerprintNative44Snapshot({ ...original, hash: 'b'.repeat(64), settings: { custom_css: 'new' } });
  assert.equal(before.structureHash, cssOnly.structureHash); assert.equal(before.resourceHash, cssOnly.resourceHash); assert.equal(before.queryHash, cssOnly.queryHash); assert.notEqual(before.documentHash, cssOnly.documentHash);
  const query = fingerprintNative44Snapshot({ ...original, elements: [{ widgetType: 'wd_products', settings: { include: [3, 4], image: { id: 4 }, title: 'Products' } }] });
  assert.notEqual(before.structureHash, query.structureHash); assert.notEqual(before.queryHash, query.queryHash);
  const media = fingerprintNative44Snapshot({ ...original, elements: [{ widgetType: 'wd_products', settings: { include: [1, 2], image: { id: 8 }, title: 'Products' } }] });
  assert.notEqual(before.resourceHash, media.resourceHash);
});

test('comparison names missing owners, bad media and unmatched carousel states as blockers', () => {
  const input = manifest(); input.modules[0].state = { carouselIndex: 0 };
  const capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1905, devicePixelRatio: 1, source: { screenshot: 'source.png', sha256: digest, modules: [{ key: 'hero', count: 1, visible: true, state: { carouselIndex: 0 } }] }, target: { screenshot: 'target.png', sha256: digest, modules: [{ key: 'hero', count: 1, visible: true, media: [{ kind: 'image', url: '/bad.png', drawable: false }], state: { carouselIndex: 1 } }] } };
  const analyzed = analyzeNative44Captures(input, [capture]); assert.deepEqual(analyzed.gaps.map(gap => gap.category), ['media', 'interaction']);
  capture.target.modules[0].count = 0; assert.equal(analyzeNative44Captures(input, [capture]).gaps[0].category, 'structure');
  assert.throws(() => validateNative44CompareManifest({ ...input, viewports: NATIVE44_COMPARE_VIEWPORTS.slice(0, 1) }), /requires 1920/);
});

test('explicit static adaptation binds every frozen plan viewport and retains the actual source carousel state', () => {
  const input = manifest(), capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1920, devicePixelRatio: 1, source: { screenshot: '', sha256: digest, modules: [{ key: 'hero', count: 1, visible: true, state: { carouselIndex: 3 } }] }, target: { screenshot: '', sha256: digest, modules: [{ key: 'hero', count: 1, visible: true }] } };
  assert.ok(analyzeNative44Captures(input, [capture]).gaps.some(gap => gap.category === 'interaction'));
  const requirements = NATIVE44_COMPARE_VIEWPORTS.map((view, index) => ({ id: `adapt-${index}`, componentId: 'hero', disposition: 'adapt', rule: 'Use all logical cards in a desktop grid and narrow horizontal scroll; replace source runtime controls.', verification: { kind: 'interaction', property: 'carousel', snapshotId: view.name } }));
  const loaded = { set: { componentPlan: { sha256: digest }, viewports: NATIVE44_COMPARE_VIEWPORTS.map(view => ({ viewport: view.name, snapshotId: view.name })) }, plan: { components: [{ id: 'hero', parentId: null }], requirements } } as unknown as LoadedNative44SourceCaptures;
  input.modules[0].stateAdaptation = { mode: 'static-overflow', componentPlanHash: digest, requirementIds: requirements.map(item => item.id), reason: 'Reviewed frozen scrolling adaptation; source index has no target runtime counterpart.' };
  validateNative44StateAdaptations(input, loaded); assert.deepEqual(analyzeNative44Captures(input, [capture]).gaps, []); assert.equal(capture.source.modules[0].state!.carouselIndex, 3);
  input.modules[0].stateAdaptation.requirementIds.pop(); assert.throws(() => validateNative44StateAdaptations(input, loaded), /viewport/);
  input.modules[0].stateAdaptation.requirementIds.push('adapt-3'); input.modules[0].stateAdaptation.componentPlanHash = 'b'.repeat(64); assert.throws(() => validateNative44StateAdaptations(input, loaded), /frozen plan/);
  input.modules[0].stateAdaptation.componentPlanHash = digest; capture.target.modules[0].state = { carouselIndex: 0 }; assert.match(analyzeNative44Captures(input, [capture]).gaps[0].detail, /undeclared target carousel/);
});

test('actual target catalog frame adaptation still requires exact frozen products and both-direction control proof', () => {
  const input = manifest(); input.widgetTypes = ['wd_products'];
  input.productChecks = [{ componentKey: 'query', selector: '[data-id="abcdef1"]', widgetType: 'wd_products', carouselExpected: true, expectedProductIds: [10], catalog: { targetOrigin: 'https://target.test', evidence: ['actual-catalog.json'], products: [{ id: 10, name: 'Actual catalog', permalink: 'https://target.test/product/10/', imageUrl: 'https://target.test/10.png', priceText: '$10' }] } }];
  const requirements = NATIVE44_COMPARE_VIEWPORTS.map((view, index) => ({ id: `adapt-${index}`, componentId: 'query', disposition: 'adapt', rule: 'Use actual target WooCommerce records and order, independently from source pet catalog.', verification: { kind: 'presence', property: 'query', snapshotId: view.name, expected: { widgetType: 'wd_products', productIds: [10] } } }));
  const loaded = { set: { componentPlan: { sha256: digest }, viewports: NATIVE44_COMPARE_VIEWPORTS.map(view => ({ viewport: view.name, snapshotId: view.name })) }, plan: { components: [{ id: 'hero', parentId: null }, { id: 'query', parentId: 'hero' }], requirements } } as unknown as LoadedNative44SourceCaptures;
  input.modules[0].stateAdaptation = { mode: 'target-catalog', componentPlanHash: digest, requirementIds: requirements.map(item => item.id), targetComponentKeys: ['query'], reason: 'Source and target product identities are deliberately different; target controls retain their own actual proof.' };
  validateNative44StateAdaptations(input, loaded);
  const capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1920, devicePixelRatio: 1, source: { screenshot: '', sha256: digest, modules: [{ key: 'hero', count: 1, visible: true, state: { carouselIndex: 4 } }] }, target: { screenshot: '', sha256: digest, modules: [{ key: 'hero', count: 1, visible: true, state: { carouselIndex: 0 } }], productChecks: [{ ...input.productChecks[0], viewport: 'desktop-wide', status: 'passed', problems: [], products: input.productChecks[0].catalog.products, nativeWidgetCount: 1 }], interactionChecks: [{ componentKey: 'query', viewport: 'desktop-wide', selector: '[data-id="abcdef1"]', widgetType: 'wd_products', status: 'passed', problems: [], clickedNext: true, clickedPrevious: true }] } };
  assert.deepEqual(analyzeNative44Captures(input, [capture]).gaps, []);
  capture.target.interactionChecks![0].status = 'failed'; capture.target.interactionChecks![0].problems = ['Actual arrow is clipped']; assert.ok(analyzeNative44Captures(input, [capture]).gaps.some(gap => gap.detail.includes('complete actual product/control proof')));
  input.productChecks[0].expectedProductIds = [20]; assert.throws(() => validateNative44StateAdaptations(input, loaded), /frozen actual product query/);
});

test('real local browser comparison captures four widths without document writes or fake review; exact screenshots can be reviewed without recapture', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'native44-compare-')), input = manifest();
  await writeFile(path.join(runDir, 'compare-manifest.json'), JSON.stringify(input));
  const browser = await chromium.launch({ headless: true });
  let reads = 0, opened = 0;
  const deps = {
    readSnapshot: async () => { reads++; return { documentHash: input.documentHash, structureHash: input.structureHash, resourceHash: input.resourceHash, queryHash: input.queryHash, pageCss: '' }; },
    openPage: async (_url: string, role: 'source' | 'target') => {
      opened++; const page = await browser.newPage({ deviceScaleFactor: 1 });
      await page.setContent(`<style>body{margin:0}.cwp-hero{height:100px;width:100%;max-width:${role === 'source' ? 1440 : 1400}px;margin:auto}</style><main class="elementor-42"><section class="cwp-hero"><h1>Fixture</h1></section></main>`);
      return page;
    },
  };
  try {
    const result = await compareNative44Run(runDir, deps);
    assert.equal(result.deliveryComplete, false); assert.equal(result.css.status, 'candidate'); assert.equal(result.visualVerification, 'awaiting-user-css'); assert.equal(result.comparisonReview, 'pending');
    assert.equal(result.metrics.documentWrites, 0); assert.equal(result.metrics.editorSessions, 0); assert.equal(result.metrics.screenshots, 8); assert.equal(reads, 2); assert.equal(opened, 2);
    assert.equal(result.captures.length, 4); assert.equal((await readFile(result.captures[0].source.screenshot)).subarray(1, 4).toString(), 'PNG');
    const journal = { executionStrategy: input.strategy, taskId: input.taskId, runId: input.runId, runDir, pageId: input.pageId, status: 'awaiting-comparison', documentHash: input.documentHash, mutations: [{ status: 'confirmed' }], deliveryComplete: false };
    await writeFile(path.join(runDir, 'journal.json'), JSON.stringify(journal));
    assert.equal(await integrateNative44ComparisonResult(runDir, runDir, input, result), false);
    assert.equal(JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8')).status, 'awaiting-comparison');
    await assert.rejects(() => recordNative44CSSReview(runDir, { documentHash: 'c'.repeat(64), parentAttribution: 'Measured root width', notes: 'Not the correct document', rules: [] }), /frozen/);
    await recordNative44CSSReview(runDir, { documentHash: input.documentHash, parentAttribution: 'The hero module owns the measured content max width', notes: 'Local browser fixture measurements establish 1440 vs 1400; preserve natural page flow', rules: [{ ...input.cssRules[0], parentAttribution: 'Correct the owning module max width; do not offset its children', measurementRefs: [{ viewport: 'desktop-wide', moduleKey: 'hero', kind: 'box' }] }] });
    const reviews = result.captures.map(capture => ({ viewport: capture.viewport, sourceScreenshotHash: capture.source.sha256, targetScreenshotHash: capture.target.sha256, documentHash: input.documentHash, verdict: 'passed' as const, observedAt: new Date().toISOString(), notes: 'Local test fixture review binding only; this is not a production site acceptance.' }));
    const reviewed = await compareNative44Run(runDir, deps, { reviews });
    assert.equal(reviewed.deliveryComplete, true); assert.equal(reviewed.css.status, 'reviewed-handoff'); assert.equal(reviewed.comparisonReview, 'passed'); assert.equal(reviewed.visualVerification, 'awaiting-user-css'); assert.equal(reviewed.metrics.screenshots, 0); assert.equal(reviewed.metrics.reusedScreenshots, 8); assert.equal(opened, 2);
    assert.equal(await integrateNative44ComparisonResult(runDir, runDir, input, reviewed), true);
    const delivered = JSON.parse(await readFile(path.join(runDir, 'result.json'), 'utf8'));
    assert.equal(delivered.status, 'delivered'); assert.equal(delivered.deliveryComplete, true); assert.equal(delivered.visualVerification, 'pending-css-application'); assert.equal(delivered.completed, false);
    await writeFile(path.join(runDir, 'journal.json'), JSON.stringify({ ...journal, status: 'write-unknown' }));
    await assert.rejects(() => integrateNative44ComparisonResult(runDir, runDir, input, reviewed), /Unresolved/);
    assert.equal(JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8')).status, 'write-unknown');
  } finally { await browser.close(); await rm(runDir, { recursive: true, force: true }); }
});

test('manual structure changes make old CSS stale; comparison does not open browsers or overwrite the draft', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'native44-conflict-')), input = manifest();
  await writeFile(path.join(runDir, 'compare-manifest.json'), JSON.stringify(input));
  try {
    const result = await compareNative44Run(runDir, { readSnapshot: async () => ({ ...input, structureHash: 'c'.repeat(64) }), openPage: async () => { throw Error('Must not open a stale page comparison'); } }, { verifyApplied: true });
    assert.equal(result.deliveryComplete, false); assert.equal(result.visualVerification, 'applied-unverified'); assert.equal(result.metrics.screenshots, 0); assert.equal(result.metrics.documentWrites, 0); assert.match(result.gaps[0].detail, /stale.*preserved/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('current target capture excludes only known WordPress preview chrome, preserves authored spacing and restores it afterward', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-preview-chrome-')), browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  try {
    await page.setContent('<!doctype html><style>html{margin-top:32px!important}body{margin:0}#wpadminbar{position:fixed;left:0;top:0;width:100%;height:32px;background:#222}.elementor-42{padding-top:18px}.cwp-hero{height:1600px;background:#eee}</style><body class="admin-bar"><div id="wpadminbar">WordPress administration preview</div><main class="elementor-42"><section class="cwp-hero">Actual page content</section></main></body>');
    const input = { ...manifest(), replicationProfile: 'desktop-browser-v1' as const };
    const capture = await captureNative44Role(page, 'target', input, path.join(directory, 'target.png'), 'desktop-wide');
    assert.deepEqual(capture.renderPreparation?.previewChrome, { selector: '#wpadminbar', height: 32, reservedHtmlMarginRemoved: 32, persistentWrites: 0 });
    assert.equal(capture.modules[0].box!.y, 18); assert.ok(!capture.screenshotEvidence!.gaps.some(gap => gap.code === 'screenshot-fixed-sticky-overlay'));
    assert.equal(await page.locator('#wpadminbar').isVisible(), true); assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).marginTop), '32px');
    await page.evaluate(() => { const overlay = document.createElement('div'); overlay.id = 'authored-floating-content'; overlay.textContent = 'Important authored fixed content'; overlay.style.cssText = 'position:fixed;right:0;bottom:0;width:300px;height:48px;background:red'; document.body.append(overlay); });
    const authored = await captureNative44Role(page, 'target', input, path.join(directory, 'authored-fixed.png'), 'desktop-wide');
    assert.ok(authored.screenshotEvidence!.gaps.some(gap => gap.code === 'screenshot-fixed-sticky-overlay')); assert.equal(await page.locator('#authored-floating-content').isVisible(), true);
    await page.locator('html').evaluate(element => { (element as HTMLElement).style.setProperty('margin-top', '80px', 'important'); });
    const customMargin = await captureNative44Role(page, 'target', input, path.join(directory, 'custom-margin.png'), 'desktop-wide'); assert.equal(customMargin.renderPreparation?.previewChrome?.reservedHtmlMarginRemoved, 0); assert.equal(customMargin.modules[0].box!.y, 98);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

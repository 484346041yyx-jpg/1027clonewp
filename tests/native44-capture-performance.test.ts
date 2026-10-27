import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { createNative44CaptureMediaSession } from '../src/native44/capture-media-session.js';
import { captureNative44Role, prepareNative44CapturePage, type Native44CompareManifest } from '../src/native44/compare.js';
import { captureLayoutStableScreenshot } from '../src/verification/layout-stable-screenshot.js';

let browser: Browser;
const png = await sharp({ create: { width: 300, height: 180, channels: 3, background: '#147b83' } }).png().toBuffer();
test.before(async () => { browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] }); });
test.after(async () => { await browser?.close(); });
async function fixture(t: TestContext, html: string) {
  const context = await browser.newContext({ viewport: { width: 900, height: 500 } }), page = await context.newPage();
  t.after(async () => { await context.close(); });
  // Offline route fulfils every resource; no reference/target network is used.
  await context.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/media')) await route.fulfill({ status: 200, contentType: 'image/png', body: png });
    else if (pathname.startsWith('/broken')) await route.fulfill({ status: 404, body: '' });
    else await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><style>html,body{margin:0}main{min-height:1700px;background:#f0f3f4}img{width:60px;height:36px}.row{display:flex;gap:5px}.background{width:60px;height:36px;background-image:url('/media.png')}.clip{width:30px;overflow:hidden}</style><main data-id="main001">${html}</main>` });
  });
  await page.goto('https://offline.capture.invalid/');
  await page.evaluate(async () => { await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined))); });
  const cache = path.resolve('D:/cloneWP/.cache'); await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, 'capture-performance-'));
  t.after(async () => { const relative = path.relative(cache, directory); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); await rm(directory, { recursive: true, force: true }); });
  return { page, directory };
}
function manifest(): Native44CompareManifest {
  const digest = 'a'.repeat(64);
  return { version: 1, strategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: digest, taskId: 'generic-capture', runId: 'generic-capture-run', pageId: 123, sourceUrl: 'https://reference.invalid/', targetUrl: 'https://target.invalid/', widgetTypes: ['container'], documentHash: digest, structureHash: digest, resourceHash: digest, queryHash: digest, pageCss: '', canvasCss: '', cssRules: [], modules: [{ key: 'main', className: 'main', sourceSelector: 'main', targetSelector: 'main', required: true }] };
}

test('capture media session decodes resources once, retaining each displayed position, crop and module owner', async t => {
  const { page } = await fixture(t, `<section data-id="row0001" class="row">${Array.from({ length: 12 }, () => '<img src="/media.png">').join('')}<div class="clip"><img src="/media.png"></div><div class="background"></div><img style="display:none" src="/media.png"></section>`);
  const session = await createNative44CaptureMediaSession(page); t.after(() => session.dispose());
  const before = await page.content(); await session.viewport(); await session.viewport();
  const modules = await session.modules([{ key: 'outer', selector: 'main' }, { key: 'row', selector: 'section' }]), metrics = await session.metrics();
  assert.equal(metrics.decodeAttempts, 1); assert.ok(metrics.decodeCacheHits > 20); assert.ok(metrics.maximumConcurrentDecodes <= 4);
  assert.equal(modules[0].media?.length, 14); assert.equal(modules[1].media?.length, 14);
  assert.ok(modules.flatMap(module => module.media ?? []).every(use => use.drawable && use.owner === 'row0001' && use.moduleKey === moduleFor(use.moduleKey)));
  assert.equal(modules[1].media?.[12].clip.right! - modules[1].media?.[12].clip.left!, 30);
  assert.equal(await page.content(), before);
  function moduleFor(value: string) { return ['outer', 'row'].includes(value) ? value : 'invalid'; }
});

test('document and currentSrc changes invalidate decode reuse; a broken actual use stays failed', async t => {
  const { page } = await fixture(t, '<section><img id="changing" src="/media.png"></section>');
  const session = await createNative44CaptureMediaSession(page); t.after(() => session.dispose());
  assert.equal((await session.viewport())[0].ready, true);
  await page.locator('#changing').evaluate(image => { (image as HTMLImageElement).src = '/broken.png'; });
  await page.waitForFunction(() => (document.querySelector('#changing') as HTMLImageElement).complete);
  assert.equal((await session.viewport())[0].failed, true);
  const modules = await session.modules([{ key: 'main', selector: 'main' }]); assert.equal(modules[0].media?.[0].drawable, false);
  assert.ok((await session.metrics()).cacheInvalidations > 0);
});

test('actual resource decodes run within the bounded worker pool', async t => {
  const { page } = await fixture(t, Array.from({ length: 16 }, (_, index) => `<img src="/media.png?resource=${index}">`).join(''));
  const session = await createNative44CaptureMediaSession(page, 3); t.after(() => session.dispose());
  const measured = await session.modules([{ key: 'main', selector: 'main' }]), metrics = await session.metrics();
  assert.equal(measured[0].media?.length, 16); assert.equal(metrics.decodeAttempts, 16); assert.ok(metrics.maximumConcurrentDecodes >= 2 && metrics.maximumConcurrentDecodes <= 3);
});

test('combined desktop capture removes the redundant full pre-scroll while preserving identical real pixels and complete coverage', async t => {
  const { page, directory } = await fixture(t, '<div class="row"><img src="/media.png"><div class="background"></div></div><div style="margin-top:1200px">Actual bottom</div>');
  const legacyStarted = performance.now(), preparation = await prepareNative44CapturePage(page, [], 'desktop');
  const baseline = await captureLayoutStableScreenshot(page, { path: path.join(directory, 'two-pass.png'), selectors: ['main'] });
  const legacyMs = Math.round(performance.now() - legacyStarted), combinedStarted = performance.now();
  const combined = await captureNative44Role(page, 'target', manifest(), path.join(directory, 'combined.png'), 'desktop'), combinedMs = Math.round(performance.now() - combinedStarted);
  assert.equal(baseline.passed, true); assert.deepEqual(combined.screenshotEvidence?.gaps, []);
  assert.equal(combined.renderPreparation?.scanMode, 'combined-viewport-capture'); assert.equal(combined.renderPreparation?.scrollPositions.length, 0);
  assert.equal(combined.screenshotEvidence?.frameCount, baseline.tiles.length);
  const oldScrollLowerBound = preparation.scrollPositions.length + baseline.metrics.scrollCommands;
  assert.ok(combined.screenshotEvidence!.metrics!.scrollCommands < oldScrollLowerBound);
  assert.deepEqual(await readFile(combined.screenshot), await readFile(baseline.pngPath));
  t.diagnostic(JSON.stringify({ fixture: '1700px repeated-media page', legacyMs, combinedMs, legacyScrollCommandsAtLeast: oldScrollLowerBound, combinedScrollCommands: combined.screenshotEvidence!.metrics!.scrollCommands, decodeAttempts: combined.renderPreparation?.mediaMetrics?.decodeAttempts, decodeCacheHits: combined.renderPreparation?.mediaMetrics?.decodeCacheHits, frames: combined.screenshotEvidence?.frameCount }));
});

test('viewport lazy growth discards earlier frames and re-captures the entire stabilized document', async t => {
  const { page, directory } = await fixture(t, '<div style="height:850px"></div><img id="lazy" style="width:300px;height:auto"><div style="height:1000px;background:#cab15a">Bottom</div><script>new IntersectionObserver(rows=>{for(const row of rows)if(row.isIntersecting){row.target.src="/media.png";}}).observe(document.querySelector("#lazy"));</script>');
  const captured = await captureNative44Role(page, 'target', manifest(), path.join(directory, 'lazy.png'), 'desktop');
  const receipt = JSON.parse(await readFile(captured.screenshotEvidence!.receipt.path, 'utf8'));
  assert.equal(receipt.passed, true, JSON.stringify(receipt.gaps));
  assert.ok(receipt.preparation.layoutRefreshes >= 1); assert.ok(receipt.preparation.discardedFrames >= 1);
  assert.equal(receipt.contentRaster.height, receipt.before.scrollHeight); assert.equal(receipt.originalScrollRestored, true);
  assert.equal(receipt.tiles.reduce((sum: number, tile: { documentHeight: number }) => sum + tile.documentHeight, 0), receipt.before.scrollHeight);
  assert.ok(captured.modules[0].media?.every(use => use.drawable));
});

test('combined readiness keeps broken media and persistent layout drift as named blockers', async t => {
  const broken = await fixture(t, '<img src="/broken.png">');
  await assert.rejects(captureNative44Role(broken.page, 'target', manifest(), path.join(broken.directory, 'broken.png'), 'desktop'), /failed\/undecodable/);
  const drifting = await fixture(t, '<section class="moving" style="height:100px;width:100px;background:#456"></section>');
  await drifting.page.evaluate(() => { document.querySelector('.moving')!.animate([{ width: '100px' }, { width: '180px' }], { duration: 100, iterations: Infinity }); });
  const receipt = await captureLayoutStableScreenshot(drifting.page, { path: path.join(drifting.directory, 'drift.png'), selectors: ['.moving'], settleTimeoutMs: 100, maxTiles: 2, prepareFrame: async () => {} });
  assert.equal(receipt.passed, false); assert.ok(receipt.gaps.some(gap => gap.code === 'screenshot-active-animation')); assert.equal(receipt.preparation?.layoutRefreshes, 0);
});

test('a document geometry change without new ready media cannot be waived as lazy preparation', async t => {
  const { page, directory } = await fixture(t, '<section>Stable initial document</section>');
  await page.evaluate(() => { addEventListener('scroll', () => { if (scrollY > 0) document.querySelector('main')!.style.minHeight = '2100px'; }); });
  const receipt = await captureLayoutStableScreenshot(page, { path: path.join(directory, 'non-media-drift.png'), selectors: ['main'], prepareFrame: async () => ({ resourceStateChanged: false }) });
  assert.equal(receipt.passed, false); assert.equal(receipt.preparation?.layoutRefreshes, 0);
  assert.ok(receipt.gaps.some(gap => gap.code === 'screenshot-layout-changed'));
});

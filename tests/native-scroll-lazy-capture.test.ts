import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { captureTarget, type NativeScrollClipEvidence, type ProvenLazyNativeScrollImageEvidence } from '../src/verification/capture-target.js';
import type { TargetViewportEvidence } from '../src/verification/types.js';

let browser: Browser;
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#2a7e3b' } }).png().toBuffer();
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });
type Captured = TargetViewportEvidence & { nativeScrollClips: NativeScrollClipEvidence[]; provenLazyRows: ProvenLazyNativeScrollImageEvidence[] };
async function fixture(t: TestContext, options: { mapped?: boolean; visibleFailure?: boolean; requestedFailure?: boolean; foreign?: boolean } = {}): Promise<Captured> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-native-scroll-')), requestedPaths: string[] = [];
  t.after(async () => { assert.ok(path.relative(os.tmpdir(), directory).startsWith('clonewp-native-scroll-')); await rm(directory, { recursive: true, force: true }); });
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname; requestedPaths.push(pathname);
    if (pathname.endsWith('.png')) { response.writeHead(pathname === '/missing.png' ? 404 : 200, { 'Content-Type': 'image/png' }); response.end(pathname === '/missing.png' ? '' : png); return; }
    const src = options.foreign ? 'https://foreign.invalid/lazy.png' : options.requestedFailure || options.visibleFailure ? '/missing.png' : '/lazy.png';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><head>${options.requestedFailure ? '<link rel="preload" as="image" href="/missing.png">' : ''}<style>body{margin:0}.root{width:600px}.native-scroll{width:300px;height:200px;margin-left:20px;overflow-x:auto;overflow-y:hidden}.track{display:flex;width:14000px;height:180px}.item{flex-shrink:0;width:150px;margin-left:${options.visibleFailure ? 0 : 12000}px}img{width:150px;height:150px}</style></head><body><div class="elementor" data-elementor-type="wp-page"><div class="root" data-id="1111111" data-element_type="container"><div class="native-scroll" data-id="2222222" data-element_type="container"><div class="track"><div class="item"><img loading="lazy" src="${src}" alt="ordinary-source-card"></div></div></div></div></div></body>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const elementMap = { root: { targetId: '1111111', kind: 'container' }, ...(options.mapped === false ? {} : { scroll: { targetId: '2222222', kind: 'container' } }) };
  const result = (await captureTarget({ previewUrl: `http://127.0.0.1:${address.port}/`, runDir: directory, viewports: [{ name: 'mobile', width: 600, height: 400 }], elementMap, nativeRootIds: ['1111111'], nativeCatalogIds: [], browser }))[0] as Captured;
  if (!options.requestedFailure && !options.visibleFailure) assert.equal(requestedPaths.includes('/lazy.png'), false);
  return result;
}

test('ordinary CSS native auto-scroll owns deferred lazy media without pretending to be a product carousel', async t => {
  const result = await fixture(t); assert.equal(result.provenLazyRows.length, 1); const proof = result.provenLazyRows[0];
  assert.equal(proof.deferredKind, 'native-scroll-loading-lazy'); assert.equal(proof.ancestorId, '2222222'); assert.equal(proof.ancestorType, 'container'); assert.equal(proof.loading, 'lazy');
  assert.equal(proof.naturalWidth, 0); assert.equal(proof.currentSrc, ''); assert.equal(proof.complete, false); assert.equal(proof.requested, false);
  assert.ok(proof.scrollWidth > proof.clientWidth); assert.equal(proof.overflowX, 'auto'); assert.ok(proof.childRect.x >= proof.windowRect.x + proof.windowRect.width);
  assert.ok(proof.childDomPath.startsWith(proof.windowDomPath + ' > ')); assert.ok(result.nativeScrollClips.some(clip => clip.childDomPath === proof.childDomPath && clip.ancestorId === proof.ancestorId));
  assert.equal('productId' in proof, false); assert.equal('carouselId' in proof, false); assert.equal('widgetType' in proof, false);
  assert.equal(result.imageFailures.length, 0);
});

test('unmapped scroll, visible zero-pixel media, already-requested failures and foreign sources remain image failures', async t => {
  for (const options of [{ mapped: false }, { visibleFailure: true }, { requestedFailure: true }, { foreign: true }]) {
    const result = await fixture(t, options); assert.equal(result.provenLazyRows.length, 0); assert.ok(result.imageFailures.some(image => image.alt === 'ordinary-source-card'));
  }
});

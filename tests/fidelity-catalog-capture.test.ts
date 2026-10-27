import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { captureTarget, type NativeCarouselClipEvidence, type ProvenLazyCatalogImageEvidence } from '../src/verification/capture-target.js';
import type { TargetViewportEvidence } from '../src/verification/types.js';

type Captured = TargetViewportEvidence & { nativeCarouselClips: NativeCarouselClipEvidence[]; provenLazyRows: ProvenLazyCatalogImageEvidence[] };
let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#2a7e3b' } }).png().toBuffer();
async function captured(t: TestContext, options: { mapped?: boolean; initialized?: boolean; outerRuntime?: boolean; galleryRuntime?: boolean; wideDocument?: boolean; visiblePending?: boolean; requested?: boolean; foreignLazy?: boolean; nativeLazy?: boolean; preloadFailure?: boolean; nativeLoading?: 'lazy'|'eager'; responsivePending?: boolean; fakeSlideSibling?: boolean } = {}): Promise<Captured> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-catalog-capture-')), requestedPaths: string[] = [];
  t.after(async () => { assert.ok(path.relative(os.tmpdir(), directory).startsWith('clonewp-catalog-capture-')); await rm(directory, { recursive: true, force: true }); });
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname; requestedPaths.push(pathname);
    if (pathname === '/responsive-pending.png') {
      response.writeHead(200, { 'Content-Type': 'image/png' }); response.write(png);
      const timer = setTimeout(() => { if (!response.destroyed) response.end(); }, 20_000);
      response.once('close', () => clearTimeout(timer)); return;
    }
    if (pathname.endsWith('.png')) { response.writeHead(pathname === '/requested-failure.png' ? 404 : 200, { 'Content-Type': 'image/png' }); response.end(pathname === '/requested-failure.png' ? '' : png); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const declared = options.foreignLazy ? 'https://foreign.example/lazy.png' : options.requested ? '/requested-failure.png' : '/lazy-own.png';
    response.end(`<!doctype html><html><head>${options.preloadFailure ? `<link rel="preload" as="image" href="${declared}">` : ''}<style>
      body{margin:0}.elementor{width:600px}.owned-root{width:600px}.owned-widget{width:500px;margin-left:20px}.wd-carousel{position:relative;width:500px;height:230px;overflow:hidden}.wd-carousel-wrap{display:flex;width:1800px;height:220px}.wd-carousel-item{width:200px;min-width:200px}.product-grid-item{width:200px;height:220px}.product-grid-item img{width:150px;height:150px}.woocommerce-Price-amount{display:block;width:180px}.e-unrelated-clip{position:relative;overflow:hidden;width:150px;height:30px}.e-unrelated-leaf{position:absolute;left:900px;width:180px}.gallery{overflow:hidden;width:180px}.gallery-wrapper{display:flex;width:500px}.gallery-item{width:180px;min-width:180px}${options.wideDocument ? '.wide-human-sibling{position:absolute;left:900px;width:200px;height:30px}' : ''}
    </style></head><body><div class="elementor" data-elementor-type="wp-page"><div class="owned-root" data-id="1111111" data-element_type="container"><div class="owned-widget elementor-widget" data-id="2222222" data-widget_type="wd_products.default"><div class="wd-carousel"><div class="wd-carousel-wrap">
      <div class="wd-carousel-item"><div class="product-grid-item product" data-id="17"><img ${options.visiblePending ? 'data-src="/visible-pending.png"' : 'src="/loaded.png"'} ${options.responsivePending ? 'srcset="/loaded.png 200w,/responsive-pending.png 400w" sizes="400px"' : ''} alt="visible-own"><div class="product-element-bottom"><span class="woocommerce-Price-amount amount">$12.00</span></div><div class="gallery"><div class="gallery-wrapper"><div class="gallery-item">Gallery image</div></div></div></div></div>
      <div class="wd-carousel-item wd-slide-next" style="margin-left:${options.nativeLazy ? 12000 : 700}px"><div class="product-grid-item product" data-id="18"><img ${options.nativeLazy ? `loading="${options.nativeLoading ?? 'lazy'}" src="${declared}"` : `data-src="${declared}" ${options.requested ? 'src="/requested-failure.png" onerror="this.removeAttribute(\'src\')"' : ''}`} alt="offscreen-own"><div class="product-element-bottom"><span class="woocommerce-Price-amount amount">$25.00</span></div></div></div>
      ${options.fakeSlideSibling ? '<div class="wd-carousel-item wd-slide-next fake-sibling" data-id="fake-sibling" style="margin-left:700px"><div class="product-grid-item product" data-id="19">Fake slide sibling</div></div>' : ''}
    </div></div><div class="e-unrelated-clip"><span class="e-unrelated-leaf">Unrelated clipped sibling</span></div></div><div class="e-unrelated-clip"><div class="product-grid-item product e-unrelated-leaf" data-id="999"><span class="woocommerce-Price-amount amount">Unrelated other product</span></div></div>${options.wideDocument ? '<div class="wide-human-sibling elementor-widget">Real horizontal overflow</div>' : ''}</div></div><script>
      Object.defineProperty(globalThis,'__name',{value:(target)=>target,configurable:true});
      ${options.outerRuntime === false ? '' : `const carousel=document.querySelector('.wd-carousel');carousel.swiper={initialized:${options.initialized !== false},destroyed:false,el:carousel,wrapperEl:carousel.querySelector('.wd-carousel-wrap'),slides:Array.from(carousel.querySelector('.wd-carousel-wrap').children).filter(slide=>!slide.classList.contains('fake-sibling')),params:{slidesPerView:2}};`}
      ${options.galleryRuntime ? `const gallery=document.querySelector('.gallery');gallery.swiper={initialized:true,destroyed:false,el:gallery,wrapperEl:gallery.querySelector('.gallery-wrapper'),params:{slidesPerView:1}};` : ''}
    </script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const result = (await captureTarget({ previewUrl: `http://127.0.0.1:${address.port}/owned-draft/`, runDir: directory, viewports: [{ name: 'desktop', width: 600, height: 400 }], elementMap: { 'root': { targetId: '1111111', kind: 'container' }, 'own-query': { targetId: '2222222', kind: 'container' } }, nativeRootIds: ['1111111'], nativeCatalogIds: options.mapped === false ? [] : ['2222222'], browser }))[0] as Captured;
  if (!options.requested) assert.equal(requestedPaths.includes('/lazy-own.png'), false);
  return result;
}

test('same capture proves anonymous offscreen product leaves only under exact mapped initialized native catalog Swiper and actual CSS clipping', async t => {
  const result = await captured(t), leaf = result.nativeCarouselClips.find(clip => clip.selector === 'span.woocommerce-Price-amount.amount');
  assert.ok(leaf); assert.equal(leaf.carouselId, '2222222'); assert.equal(leaf.widgetType, 'wd_products.default'); assert.equal(leaf.overflowX, 'hidden'); assert.ok(leaf.documentWidth <= leaf.viewportWidth + 4);
  assert.ok(leaf.childRect.x > leaf.windowRect.x + leaf.windowRect.width); assert.ok(leaf.childDomPath.startsWith(leaf.windowDomPath + ' > '));
  assert.ok(result.overflow.some(row => row.selector === 'span.e-unrelated-leaf')); assert.equal(result.nativeCarouselClips.some(clip => clip.selector === 'span.e-unrelated-leaf'), false);
  assert.equal(result.nativeCarouselClips.some(clip => clip.selector === '[data-id="999"]'), false);
});
test('a wd_products type name, unmapped ID or uninitialized runtime does not authorize catalog clipping', async t => {
  for (const options of [{ mapped: false }, { initialized: false }, { outerRuntime: false }]) {
    const result = await captured(t, options); assert.equal(result.nativeCarouselClips.length, 0); assert.equal(result.provenLazyRows.length, 0); assert.ok(result.imageFailures.some(image => image.alt === 'offscreen-own'));
  }
});
test('nested image-gallery runtime cannot impersonate the product carousel wrapper or suppress product image failures', async t => {
  const result = await captured(t, { outerRuntime: false, galleryRuntime: true }); assert.equal(result.nativeCarouselClips.length, 0); assert.equal(result.provenLazyRows.length, 0); assert.ok(result.imageFailures.some(image => image.alt === 'offscreen-own'));
});
test('true document overflow withholds every catalog clipping and pending-image exemption', async t => {
  const result = await captured(t, { wideDocument: true }); assert.equal(result.nativeCarouselClips.length, 0); assert.equal(result.provenLazyRows.length, 0); assert.ok(result.overflow.some(row => row.selector.includes('wide-human-sibling'))); assert.ok(result.imageFailures.some(image => image.alt === 'offscreen-own'));
});
test('only fully offscreen unrequested same-origin native lazy product images get explicit per-occurrence proof', async t => {
  const result = await captured(t, { visiblePending: true }); assert.equal(result.provenLazyRows.length, 1); const lazy = result.provenLazyRows[0];
  assert.equal(lazy.productId, 18); assert.equal(lazy.requested, false); assert.equal(lazy.currentSrc, ''); assert.equal(lazy.srcAttribute, ''); assert.equal(lazy.naturalWidth, 0); assert.equal(lazy.naturalHeight, 0); assert.ok(lazy.declaredURL.endsWith('/lazy-own.png'));
  const image = result.elements.find(element => element.sourceId === 'own-query')!.images.find(image => image.alt === 'offscreen-own')! as typeof result.elements[number]['images'][number] & { domPath: string };
  assert.equal(image.domPath, lazy.childDomPath); assert.deepEqual(image.rect, lazy.childRect);
  assert.ok(result.imageFailures.some(image => image.alt === 'visible-own')); assert.equal(result.imageFailures.some(image => image.alt === 'offscreen-own'), false);
});
test('requested failures and foreign lazy image declarations remain actual failures', async t => {
  for (const options of [{ requested: true }, { foreignLazy: true }]) { const result = await captured(t, options); assert.equal(result.provenLazyRows.length, 0); assert.ok(result.imageFailures.some(image => image.alt === 'offscreen-own')); }
});

test('standard WordPress loading=lazy with a real src remains explicit deferred evidence only while native ownership, clipping and no-request facts agree', async t => {
  const result = await captured(t, { nativeLazy: true });
  assert.equal(result.provenLazyRows.length, 1); const proof = result.provenLazyRows[0];
  assert.equal(proof.deferredKind, 'native-loading-lazy'); assert.equal(proof.loading, 'lazy'); assert.equal(proof.srcAttribute, '/lazy-own.png'); assert.equal(proof.productId, 18);
  assert.equal(proof.complete, false); assert.equal(proof.naturalWidth, 0); assert.equal(proof.requested, false);
  assert.ok(proof.childRect.x >= proof.windowRect.x + proof.windowRect.width); assert.ok(proof.childDomPath.startsWith(proof.windowDomPath + ' > '));
  assert.equal(result.imageFailures.some(image => image.alt === 'offscreen-own'), false);
});

test('standard lazy src cannot suppress an already-requested 404, a foreign image or an unmapped native component', async t => {
  for (const options of [{ nativeLazy: true, requested: true, preloadFailure: true }, { nativeLazy: true, foreignLazy: true }, { nativeLazy: true, mapped: false }, { nativeLazy: true, nativeLoading: 'eager' as const, requested: true }]) {
    const result = await captured(t, options);
    assert.equal(result.provenLazyRows.length, 0); assert.ok(result.imageFailures.some(image => image.alt === 'offscreen-own'));
  }
});

test('decoded pixels of an actual responsive currentSrc remain drawable while HTTP completion is pending', async t => {
  const result = await captured(t, { responsivePending: true });
  const frame = result.elements.find(element => element.sourceId === 'own-query')!.images.find(image => image.alt === 'visible-own')! as typeof result.elements[number]['images'][number] & { currentSrc: string; srcAttribute: string };
  assert.equal(frame.complete, false, 'HTTP completion is still pending even though PNG pixels already arrived');
  assert.ok(frame.naturalWidth > 0 && frame.naturalHeight > 0);
  assert.ok(frame.currentSrc.endsWith('/responsive-pending.png')); assert.equal(frame.srcAttribute, '/loaded.png'); assert.equal(frame.url, frame.currentSrc, 'the measured resource stays the actual selected candidate instead of the declared src or an expected URL');
  const { data, info } = await sharp(result.screenshotPath).raw().toBuffer({ resolveWithObject: true });
  const sampleX = Math.floor(frame.rect.x + frame.rect.width / 2), sampleY = Math.floor(frame.rect.y + frame.rect.height / 2), offset = (sampleY * info.width + sampleX) * info.channels;
  assert.deepEqual([...data.subarray(offset, offset + 3)], [42, 126, 59], 'the actual browser screenshot contains the decoded current picture');
  assert.equal(result.imageFailures.some(image => image.alt === 'visible-own'), false);
  const broken = await captured(t, { visiblePending: true });
  const missing = broken.elements.find(element => element.sourceId === 'own-query')!.images.find(image => image.alt === 'visible-own')!;
  assert.equal(missing.naturalWidth, 0); assert.equal(missing.naturalHeight, 0);
  assert.ok(broken.imageFailures.some(image => image.alt === 'visible-own'), 'a visible image with no decoded pixels is still a failure');
});

test('only exact initialized main-runtime slide members with owned product children receive wrapper clipping proof', async t => {
  const result = await captured(t, { fakeSlideSibling: true });
  const wrapperProofs = result.nativeCarouselClips.filter(proof => proof.selector === 'div.wd-carousel-item.wd-slide-next');
  assert.equal(wrapperProofs.length, 1); assert.ok(wrapperProofs[0].childRect.x > wrapperProofs[0].windowRect.x + wrapperProofs[0].windowRect.width);
  assert.equal(wrapperProofs[0].carouselId, '2222222'); assert.ok(wrapperProofs[0].childDomPath.startsWith(wrapperProofs[0].windowDomPath + ' > '));
  assert.ok(result.overflow.some(row => row.selector === '[data-id="fake-sibling"]'));
  assert.equal(result.nativeCarouselClips.some(proof => proof.selector === '[data-id="fake-sibling"]'), false, 'a matching class and product child do not confer actual runtime membership');
});

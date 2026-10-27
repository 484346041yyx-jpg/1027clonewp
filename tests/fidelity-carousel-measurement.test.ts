import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { carouselState, waitForNativeCarouselReady } from '../src/verification/carousel-runtime.js';

function carouselMarkup(options: { positions?: number[]; width?: number; slideWidth?: number; clone?: { index?: string; left: number }; nested?: boolean; indexed?: boolean } = {}) {
  const positions = options.positions ?? [0, 100, 200, 300, 400, 500];
  const originals = positions.map((left, index) => `<div class="swiper-slide${index === 5 ? ' swiper-slide-active' : ''}" ${options.indexed === false ? '' : `data-swiper-slide-index="${index}"`} style="left:${left}px">Source product ${index}${options.nested && index === 5 ? '<div class="nested-other-carousel swiper"><div class="swiper-wrapper"><div class="swiper-slide" data-swiper-slide-index="99" style="left:0">Nested unrelated product</div><div class="swiper-slide" data-swiper-slide-index="100" style="left:100px">Nested unrelated product 2</div></div></div>' : ''}</div>`).join('');
  const clone = options.clone ? `<div class="swiper-slide swiper-slide-duplicate" ${options.clone.index === undefined ? '' : `data-swiper-slide-index="${options.clone.index}"`} style="left:${options.clone.left}px">Actual loop clone</div>` : '';
  return `<!doctype html><html><head><title>Native carousel measurement fixture</title><style>
    body{margin:0}.owned-widget{width:${options.width ?? 200}px}.swiper{position:relative;width:${options.width ?? 200}px;height:100px;overflow:hidden}
    .swiper-wrapper{position:relative;width:1400px;height:100px}.swiper-slide{position:absolute;width:${options.slideWidth ?? 100}px;height:100px;top:0}
    .nested-other-carousel{width:100px;height:35px;position:absolute;top:60px}.nested-other-carousel .swiper-slide{height:35px;width:50px}
  </style></head><body><div class="elementor"><div class="owned-widget" data-id="bde6000" data-widget_type="nested-carousel.default"><div class="swiper"><div class="swiper-wrapper">${originals}${clone}</div></div></div></div></body></html>`;
}

async function installRuntime(page: import('playwright').Page, state: { initialized: boolean; destroyed?: boolean; animating?: boolean; slidesPerView?: number }) {
  await page.locator('.owned-widget > .swiper').evaluate((element, runtime) => {
    (element as HTMLElement & { swiper: unknown }).swiper = { initialized: runtime.initialized, destroyed: runtime.destroyed ?? false, animating: runtime.animating ?? false, params: { slidesPerView: runtime.slidesPerView ?? 2 } };
  }, state);
}

test('SSR slide geometry cannot pass native readiness until asynchronous Swiper initialization and three stable samples', async () => {
  const requests: Array<{ method: string; pathname: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? '', pathname: new URL(request.url ?? '/', 'http://localhost').pathname });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(carouselMarkup({ positions: [0, 200, 400, 600, 800, 1000], width: 200, slideWidth: 200, indexed: false }).replace('</body>', `<script>
      setTimeout(() => {
        document.querySelectorAll('.owned-widget > .swiper > .swiper-wrapper > .swiper-slide').forEach((slide,index) => slide.setAttribute('data-swiper-slide-index', String(index)));
        document.querySelector('.owned-widget > .swiper').swiper = { initialized:true,destroyed:false,animating:false,params:{slidesPerView:1},currentBreakpoint:'desktop' };
      }, 300);
    </script></body>`));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/owned-preview`, { waitUntil: 'domcontentloaded' });
    const widget = page.locator('[data-id="bde6000"]');
    const ssr = await carouselState(widget);
    assert.equal(ssr.visibleSlides, 1);
    assert.equal(ssr.initialized, false, 'visible SSR classes and geometry do not prove a live Swiper instance');
    const ready = await waitForNativeCarouselReady(widget, 1500);
    assert.equal(ready.state.initialized, true);
    assert.equal(ready.state.animating, false);
    assert.equal(ready.state.visibilityVerified, true);
    assert.equal(ready.state.runtimeSlidesPerView, 1);
    assert.deepEqual(ready.state.visibleSourceIds, ['index:0']);
    assert.ok(ready.elapsedMs >= 200, 'the instance must remain ready over three samples, not one SSR measurement');
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.every(request => !/save|publish|admin-ajax|wp-json/i.test(request.pathname)));
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('missing, destroyed or still animating instances cannot pass the bounded native carousel readiness check', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const state of [undefined, { initialized: true, destroyed: true }, { initialized: true, animating: true }]) {
      await page.setContent(carouselMarkup());
      if (state) await installRuntime(page, state);
      const widget = page.locator('[data-id="bde6000"]'), measured = await carouselState(widget);
      assert.equal(measured.visibleSlides, 2, 'the negative case must have positive visible slide geometry');
      if (state?.animating) assert.equal(measured.animating, true);
      else assert.equal(measured.initialized, false);
      const started = Date.now();
      await assert.rejects(waitForNativeCarouselReady(widget, 350), /bounded readiness window/);
      assert.ok(Date.now() - started < 1500, 'the readiness check must stop at its bounded timeout');
    }
  } finally { await browser.close(); }
});

test('loop-edge originals and proven clones count unique logical source slides from only their own direct track', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(carouselMarkup({ positions: [-500, -400, -300, -200, -100, 0], clone: { index: '0', left: 100 }, nested: true }));
    await installRuntime(page, { initialized: true });
    const widget = page.locator('[data-id="bde6000"]'), edge = await carouselState(widget);
    assert.equal(edge.slideCount, 6, 'nested slides and physical clones must not increase the original source count');
    assert.equal(edge.visibleSlides, 2, 'the visible loop clone must contribute its proven source identity at the loop edge');
    assert.deepEqual(edge.visibleSourceIds, ['index:5', 'index:0']);
    assert.equal(edge.visibleWrappers.length, 2, 'nested other-track slides must not become parent visible wrappers');
    assert.equal(edge.visibleWrappers[0].clone, false);
    assert.equal(edge.visibleWrappers[1].clone, true);
    assert.equal(edge.visibilityVerified, true);
    const ready = await waitForNativeCarouselReady(widget, 1000);
    assert.equal(ready.state.visibleSlides, 2);
    assert.ok(ready.elapsedMs >= 180, 'an already initialized instance still needs three stable geometry samples');

    await page.setContent(carouselMarkup({ positions: [0, 500, 600, 700, 800, 900], clone: { index: '0', left: 100 } }));
    const repeated = await carouselState(page.locator('[data-id="bde6000"]'));
    assert.equal(repeated.visibleWrappers.length, 2);
    assert.equal(repeated.visibleSlides, 1, 'an original and its clone are one logical source slide, not two products');
    assert.deepEqual(repeated.visibleSourceIds, ['index:0']);
    assert.equal(repeated.visibilityVerified, true);
  } finally { await browser.close(); }
});

test('visible clones without an exact same-track original index remain unverified and block readiness', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const index of ['99', undefined]) {
      await page.setContent(carouselMarkup({ positions: [-500, -400, -300, -200, -100, 0], clone: { index, left: 100 }, nested: true }));
      await installRuntime(page, { initialized: true });
      const widget = page.locator('[data-id="bde6000"]'), measured = await carouselState(widget);
      assert.equal(measured.initialized, true);
      assert.equal(measured.visibleWrappers.length, 2);
      assert.equal(measured.visibleSlides, 1, 'the unproved visible clone cannot add a source product');
      assert.deepEqual(measured.visibleSourceIds, ['index:5']);
      assert.equal(measured.visibilityVerified, false, 'an index matching only a nested other-track slide is not source identity proof');
      assert.equal(measured.visibleWrappers[1].sourceId, undefined);
      await assert.rejects(waitForNativeCarouselReady(widget, 350), /bounded readiness window/);
    }
  } finally { await browser.close(); }
});

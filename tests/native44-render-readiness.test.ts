import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { prepareNative44CapturePage, readNative44ModuleCarouselStates } from '../src/native44/compare.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="red"/></svg>';
test('module state reads actual visible WD runtime objects, deduplicates references and preserves multiple-instance ambiguity', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent('<section id="module"><div class="wd-carousel">Actual WD runtime</div><div id="same-instance">Same actual reference</div><div id="hidden" style="display:none">Inactive responsive runtime</div><div id="extra">Second active runtime</div></section>');
    await page.evaluate(() => { const runtime = { initialized: true, destroyed: false, realIndex: 2 }; (document.querySelector('.wd-carousel') as any).swiper = runtime; (document.querySelector('#same-instance') as any).swiper = runtime; (document.querySelector('#hidden') as any).swiper = { initialized: true, realIndex: 5 }; });
    const modules = [{ key: 'products', sourceSelector: '#module', targetSelector: '#module' }];
    assert.deepEqual(await readNative44ModuleCarouselStates(page, modules, 'target'), [{ key: 'products', carouselRuntimeCount: 1, carouselIndex: 2 }]);
    await page.evaluate(() => { (document.querySelector('#extra') as any).swiper = { initialized: true, destroyed: false, realIndex: 4 }; });
    const [ambiguous] = await readNative44ModuleCarouselStates(page, modules, 'target'); assert.equal(ambiguous.carouselRuntimeCount, 2); assert.equal(ambiguous.carouselIndex, undefined);
    await page.evaluate(() => { (document.querySelector('#extra') as any).swiper.destroyed = true; (document.querySelector('.wd-carousel') as any).swiper.realIndex = 3; });
    assert.deepEqual(await readNative44ModuleCarouselStates(page, modules, 'target'), [{ key: 'products', carouselRuntimeCount: 1, carouselIndex: 3 }]);
  } finally { await browser.close(); }
});
test('capture readiness waits for real load/Swiper initialization and natural viewport lazy decoding without changing src/loading', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 800, height: 600 } }), requests: string[] = [];
  await page.route('https://ready.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname; requests.push(pathname);
    if (pathname.endsWith('.svg')) { await new Promise(resolve => setTimeout(resolve, pathname === '/initial.svg' ? 200 : 80)); await route.fulfill({ contentType: 'image/svg+xml', body: svg }); return; }
    await route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}.spacer{height:1600px}</style><div data-id="native-owner" data-widget_type="nested-carousel.default"><div class="swiper">Runtime initializes after real load</div><img src="/initial.svg" width="48" height="48"></div><div style="width:50px;height:50px;overflow:hidden"><img id="clipped" data-src="/inactive.svg" width="48" height="48" style="margin-left:5000px"></div><div class="spacer"></div><footer data-id="footer-photo"><img id="late" data-src="/lazy.svg" loading="lazy" width="48" height="48"></footer><script>
      addEventListener('load',()=>setTimeout(()=>{document.querySelector('.swiper').swiper={initialized:true,destroyed:false,animating:false};},150));
      const image=document.querySelector('#late'),observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();setTimeout(()=>{image.src=image.dataset.src;},220);}});observer.observe(image);
    </script>` });
  });
  try {
    await page.goto('https://ready.test/', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(() => Boolean((document.querySelector('.swiper') as any).swiper)), false);
    let aligned = false;
    const receipt = await prepareNative44CapturePage(page, [{ componentKey: 'native-owner', selector: '[data-id="native-owner"]', widgetType: 'nested-carousel' }], 'desktop-wide', async () => { aligned = true; assert.equal(await page.evaluate(() => (document.querySelector('.swiper') as any).swiper.initialized), true); });
    assert.equal(aligned, true); assert.deepEqual(receipt.initializedOwners, ['native-owner']); assert.ok(receipt.scrollPositions.length > 2); assert.equal(await page.locator('#late').getAttribute('src'), '/lazy.svg'); assert.equal(await page.locator('#late').getAttribute('loading'), 'lazy'); assert.equal(await page.locator('#late').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 48), true); assert.equal(requests.includes('/inactive.svg'), false); assert.equal(await page.locator('#clipped').getAttribute('src'), null); assert.equal(await page.evaluate(() => scrollY), 0);
  } finally { await browser.close(); }
});

test('capture readiness reports actual undecodable visible pixels instead of treating a failed image as a delayed lazy source', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  await page.route('https://broken.test/**', route => route.request().url().endsWith('/broken.svg') ? route.fulfill({ status: 404, body: 'missing' }) : route.fulfill({ contentType: 'text/html', body: '<div data-id="bad-photo"><img src="/broken.svg" loading="lazy" width="48" height="48"></div>' }));
  try { await page.goto('https://broken.test/', { waitUntil: 'load' }); await assert.rejects(() => prepareNative44CapturePage(page, [], 'desktop-wide'), /actual failed\/undecodable pixels in owner bad-photo/); assert.equal(await page.locator('img').getAttribute('src'), '/broken.svg'); assert.equal(await page.locator('img').getAttribute('loading'), 'lazy'); }
  finally { await browser.close(); }
});

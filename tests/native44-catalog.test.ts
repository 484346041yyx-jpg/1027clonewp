import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectNative44ProductChecks, native44ObservedProductProblems, type Native44ProductCheck } from '../src/native44/catalog-check.js';
import { collectNative44InteractionChecks } from '../src/native44/interaction-check.js';
import { analyzeNative44Captures, fingerprintNative44Snapshot, type Native44CompareManifest, type Native44Capture } from '../src/native44/compare.js';

const record = (id: number) => ({ id, name: `Real product ${id}`, permalink: `https://target.test/product/${id}/`, imageUrl: `https://target.test/${id}.svg`, imageVariants: [`https://target.test/${id}-small.svg`], priceText: '$10.00', onSale: false });
const check: Native44ProductCheck = { componentKey: 'products', selector: '[data-id="abcdef1"]', widgetType: 'wd_products', expectedProductIds: [10, 20], catalog: { targetOrigin: 'https://target.test', evidence: ['target/catalog.json'], products: [record(10), record(20)] } };
test('DOM product facts must match real IDs, frozen order, name, image, link and full price', () => {
  assert.deepEqual(native44ObservedProductProblems(check, [record(10), record(20)]), []);
  for (const products of [[record(20), record(10)], [{ ...record(10), name: 'Copied pet title' }, record(20)], [{ ...record(10), priceText: '$10' }, record(20)], [{ ...record(10), imageUrl: 'https://source.test/pet.jpg' }, record(20)], [{ ...record(10), permalink: 'https://source.test/pet/' }, record(20)]]) assert.ok(native44ObservedProductProblems(check, products).length);
});

test('real local native product DOM excludes clones, preserves logical indexes and never fills missing values from catalog; actual controls move and restore', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const card = (id: number, index: number, clone = false) => `<article class="product-grid-item product swiper-slide${clone ? ' swiper-slide-duplicate' : ''}" data-id="${id}" data-swiper-slide-index="${index}" style="display:inline-block;width:200px"><a href="https://target.test/product/${id}/"><img src="https://target.test/${id}-small.svg" width="80" height="80"></a><h3 class="wd-entities-title"><a href="https://target.test/product/${id}/">Real product ${id}</a></h3><span class="price"><span class="woocommerce-Price-amount"><bdi>$10.00</bdi></span></span></article>`;
  await page.route('https://target.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: route.request().url().endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>' : `<main class="elementor-42"><div data-id="abcdef1" data-widget_type="wd_products.default">${card(20, 1)}${card(10, 0)}${card(10, 0, true)}</div><div data-id="abcdef2" data-widget_type="woocommerce-products.default"></div><div data-id="abcdef3" data-widget_type="wd_products_tabs.default"></div><div data-id="abcdef4" data-widget_type="nested-carousel.default"><div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide">One</div><div class="swiper-slide">Two</div></div></div><button type="button" class="previous">Previous</button><button type="button" class="next">Next</button><span class="dot swiper-pagination-bullet-active"></span><span class="dot"></span></div></main>` }));
  try {
    await page.goto('https://target.test/');
    const result = await collectNative44ProductChecks(page, [check], 'desktop-wide');
    assert.equal(result[0].status, 'passed', result[0].problems.join('; ')); assert.deepEqual(result[0].products.map(product => product.id), [10, 20]); assert.equal(result[0].products.length, 2); assert.equal(result[0].products[0].imageUrl, 'https://target.test/10-small.svg');
    await page.locator('[data-id="abcdef1"] .price').first().evaluate(element => { element.textContent = ''; });
    const missing = await collectNative44ProductChecks(page, [check], 'desktop-wide');
    assert.equal(missing[0].status, 'failed'); assert.equal(missing[0].products.find(product => product.id === 20)!.priceText, ''); assert.match(missing[0].problems.join(' '), /full price/);
    for (const [widgetType, id, collectionPath] of [['woocommerce-products', 'abcdef2', undefined], ['wd_products_tabs', 'abcdef3', 'tabs_items.0']] as const) {
      const unqualified = await collectNative44ProductChecks(page, [{ ...check, widgetType, selector: `[data-id="${id}"]`, collectionPath }], 'desktop-wide'); assert.equal(unqualified[0].status, 'unverified'); assert.match(unqualified[0].problems.join(' '), /adapter has not been qualified/);
    }
    await page.evaluate(() => {
      const root = document.querySelector('[data-id="abcdef4"]')!, swiper = root.querySelector('.swiper') as any;
      swiper.swiper = { initialized: true, realIndex: 0, animating: false, slides: root.querySelectorAll('.swiper-slide') };
      root.querySelector('.next')!.addEventListener('click', () => { swiper.swiper.realIndex = (swiper.swiper.realIndex + 1) % 2; root.querySelectorAll('.dot').forEach((dot, index) => dot.classList.toggle('swiper-pagination-bullet-active', index === swiper.swiper.realIndex)); });
      root.querySelector('.previous')!.addEventListener('click', () => { swiper.swiper.realIndex = (swiper.swiper.realIndex + 1) % 2; root.querySelectorAll('.dot').forEach((dot, index) => dot.classList.toggle('swiper-pagination-bullet-active', index === swiper.swiper.realIndex)); });
    });
    const controls = { componentKey: 'hero', selector: '[data-id="abcdef4"]', widgetType: 'nested-carousel', nextSelector: '.next', previousSelector: '.previous', paginationSelector: '.dot' };
    const interactions = await collectNative44InteractionChecks(page, [controls], 'desktop-wide');
    assert.equal(interactions[0].status, 'passed'); assert.equal(interactions[0].before!.logicalIndex, 0); assert.equal(interactions[0].after!.logicalIndex, 1); assert.equal(interactions[0].after!.paginationIndex, 1); assert.equal(interactions[0].restored!.logicalIndex, 0);
    const noProof = await collectNative44InteractionChecks(page, [{ ...controls, nextSelector: undefined }], 'desktop-wide'); assert.equal(noProof[0].status, 'unverified');
    const noSourceItem = await collectNative44InteractionChecks(page, [{ ...controls, requireSourceAlignment: true }], 'desktop-wide'); assert.equal(noSourceItem[0].status, 'unverified'); assert.equal(noSourceItem[0].clickedNext, false);
    const aligned = await collectNative44InteractionChecks(page, [{ ...controls, requireSourceAlignment: true, expectedLogicalIndex: 1 }], 'desktop-wide');
    assert.equal(aligned[0].status, 'passed'); assert.equal(aligned[0].normalizedFrom, 0); assert.equal(aligned[0].normalizationClicks, 1); assert.equal(aligned[0].before!.logicalIndex, 1); assert.equal(aligned[0].restored!.logicalIndex, 1);
  } finally { await browser.close(); }
});

test('product types and carousel initial state cannot bypass per-page actual proofs', () => {
  const snapshot = fingerprintNative44Snapshot({ hash: 'a'.repeat(64), elements: [], settings: {} });
  const manifest: Native44CompareManifest = { ...snapshot, version: 1, strategy: 'native44-css-handoff', taskId: 'fixture', runId: 'fixture-run', pageId: 42, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/', canvasCss: '', cssRules: [], modules: [], widgetTypes: ['wd_products', 'nested-carousel'] };
  const capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1920, devicePixelRatio: 1, source: { screenshot: '', sha256: 'a'.repeat(64), modules: [] }, target: { screenshot: '', sha256: 'a'.repeat(64), modules: [] } };
  const analyzed = analyzeNative44Captures(manifest, [capture]); assert.ok(analyzed.gaps.some(gap => gap.category === 'query')); assert.ok(analyzed.gaps.some(gap => gap.category === 'interaction'));
});

test('nested carousel widget clones retain the exact native scope while two real widget identities still fail', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const one = { ...check, selector: '.canonical [data-id="abcdef1"]', expectedProductIds: [10], catalog: { ...check.catalog, products: [record(10)] } };
  const widget = '<div data-id="abcdef1" data-widget_type="wd_products.default"><article class="product-grid-item product" data-id="10"><a href="https://target.test/product/10/"><img src="https://target.test/10-small.svg" width="80" height="80"></a><h3 class="wd-entities-title"><a href="https://target.test/product/10/">Real product 10</a></h3><span class="price"><span class="woocommerce-Price-amount"><bdi>$10.00</bdi></span></span></article></div>';
  await page.route('https://target.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: route.request().url().endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>' : `<!doctype html><div class="outer"><div class="wrapper"><div class="swiper-slide canonical">${widget}</div><div class="swiper-slide swiper-slide-duplicate">${widget}</div><div class="swiper-slide runtime-copy">${widget}</div></div></div>` }));
  try {
    await page.goto('https://target.test/');
    await page.locator('.outer').evaluate(element => { (element as any).swiper = { initialized: true, destroyed: false, wrapperEl: element.querySelector('.wrapper'), params: { slideDuplicateClass: 'runtime-copy' } }; });
    assert.equal(await page.locator('[data-id="abcdef1"]').count(), 3);
    const [scoped] = await collectNative44ProductChecks(page, [one], 'desktop-wide'); assert.equal(scoped.status, 'passed', scoped.problems.join('; ')); assert.equal(scoped.nativeWidgetCount, 1); assert.deepEqual(scoped.products.map(product => product.id), [10]);
    const [unscoped] = await collectNative44ProductChecks(page, [{ ...one, selector: '[data-id="abcdef1"]' }], 'desktop-wide'); assert.equal(unscoped.status, 'passed', unscoped.problems.join('; ')); assert.equal(unscoped.nativeWidgetCount, 1);
    await page.locator('.canonical').evaluate(element => { const duplicate = element.cloneNode(true) as Element; duplicate.className = 'swiper-slide real-duplicate'; element.parentElement!.append(duplicate); });
    const [duplicate] = await collectNative44ProductChecks(page, [one], 'desktop-wide'); assert.equal(duplicate.status, 'failed'); assert.match(duplicate.problems.join('; '), /unique native product widget.*non-clone/);
    await page.locator('.real-duplicate').evaluate(element => element.remove());
    await page.locator('.canonical').evaluate(element => { const duplicate = element.cloneNode(true) as Element; duplicate.className = 'runtime-copy'; document.body.append(duplicate); });
    const [classCollision] = await collectNative44ProductChecks(page, [one], 'desktop-wide'); assert.equal(classCollision.status, 'failed'); assert.match(classCollision.problems.join('; '), /unique native product widget.*non-clone/);
  } finally { await browser.close(); }
});

test('standards-mode root viewport coordinates preserve visible prices and screen-reader semantics while local title clipping still fails', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const only = { ...check, expectedProductIds: [10], catalog: { ...check.catalog, products: [record(10)] } };
  only.catalog.products[0].priceText = '$10.00 Price range: $10.00 through $10.00';
  await page.route('https://target.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: route.request().url().endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>' : '<!doctype html><style>html{height:100%;overflow-x:hidden}.before{height:1800px}.after{height:1000px}.product{width:200px}.wd-entities-title{font:20px/24px Arial}.screen-reader-text{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)}</style><div class="before"></div><main data-id="abcdef1" data-widget_type="wd_products.default"><article class="product-grid-item product" data-id="10"><a href="https://target.test/product/10/"><img src="https://target.test/10-small.svg" width="80" height="80"></a><h3 class="wd-entities-title"><a href="https://target.test/product/10/">Real product 10</a></h3><span class="price"><span class="woocommerce-Price-amount"><bdi>$10.00</bdi></span> <span class="screen-reader-text">Price range: $10.00 through $10.00</span></span></article></main><div class="after"></div>' }));
  try {
    await page.goto('https://target.test/');
    assert.equal(await page.evaluate(() => scrollY), 0);
    const [natural] = await collectNative44ProductChecks(page, [only], 'desktop-wide');
    assert.equal(natural.status, 'passed', natural.problems.join('; '));
    assert.equal(natural.products[0].cardLayout!.slots.find(slot => slot.role === 'price')!.lineCount, 1);
    const price = natural.textMeasurements!.find(item => item.id === 10 && item.role === 'price')!;
    assert.equal(price.legacyLineCount, 0, 'fixture reproduces the actual scrolling-html observer defect');
    assert.equal(price.lineCount, 1); assert.equal(price.fullLineCount, 1); assert.equal(price.excludedSemanticTextNodes, 1);
    assert.equal(price.legacyCardVisibleFraction, 0); assert.equal(price.cardVisibleFraction, 1); assert.equal(price.textPainted, true);
    assert.equal(price.rootClipOrigin, 'viewport'); assert.equal(price.viewport.height, 700); assert.ok(price.viewport.scrollY > 0); assert.equal(price.viewport.htmlRectTop, -price.viewport.scrollY);
    assert.equal(natural.products[0].priceText, '$10.00 Price range: $10.00 through $10.00', 'non-visual accessible price semantics remain actual catalog evidence');
    assert.equal(await page.evaluate(() => scrollY), 0, 'observer restores screenshot scroll position');
    await page.locator('.wd-entities-title').evaluate(element => { (element as HTMLElement).style.cssText = 'width:55px;height:24px;overflow:hidden'; });
    const [clipped] = await collectNative44ProductChecks(page, [only], 'desktop-wide');
    assert.equal(clipped.status, 'failed'); assert.match(clipped.problems.join('; '), /10 name is clipped/);
    const name = clipped.textMeasurements!.find(item => item.role === 'name')!; assert.equal(name.lineCount, 1); assert.ok(name.fullLineCount > 1); assert.equal(name.cardVisibleFraction, 1);
    assert.ok(!clipped.problems.some(problem => problem.includes('price is clipped')));
    assert.equal(await page.evaluate(() => scrollY), 0);
  } finally { await browser.close(); }
});

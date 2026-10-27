import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';

const source = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
const owl = (name: string) => `<div id="${name}" class="owl-carousel owl-loaded"><div class="owl-stage-outer"><div class="owl-stage"><article class="owl-item cloned"><a href="#c">C</a></article><article class="owl-item"><a href="#a">A</a></article><article class="owl-item"><a href="#b">B</a></article><article class="owl-item active"><a href="#c">C</a></article><article class="owl-item cloned active"><a href="#a">A</a></article></div></div><div class="owl-nav"><button class="owl-prev" aria-label="Previous ${name}">Previous</button><button class="owl-next" aria-label="Next ${name}">Next</button></div><div class="owl-dots"><button class="owl-dot active">1</button><button class="owl-dot">2</button></div></div>`;
const bootstrap = `<div id="services" class="carousel slide" data-ride="carousel" data-interval="false"><ol><li data-target="#services" data-slide-to="0">Design</li><li data-target="#services" data-slide-to="1">Packing</li></ol><div class="carousel-inner"><article class="item active">Design panel</article><article class="item">Packing panel</article></div><button class="carousel-control-next" data-bs-target="#services" data-bs-slide="next">Next service</button></div>`;
async function capture(page: Page, width: number): Promise<ObservationPacketV2> {
  await page.setViewportSize({ width, height: 900 });
  const raw = JSON.parse(await page.evaluate(`${source};collectObservationV2({snapshotId:'carousel-${width}',rootSelectors:['#observed']})`));
  return validateObservationPacketV2(JSON.parse(raw.chunks[0].json));
}

test('Owl and Bootstrap source tracks, originals, clones and targeted controls are discovered at desktop and phone widths', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<title>Carousel ownership</title><main id="observed">${owl('brands')}${owl('reviews')}${bootstrap}<button data-target="#services" data-slide-to="1">External service control</button><button data-target="#elsewhere" data-slide="next">Unrelated control</button></main>`);
    for (const width of [1920, 390, 430]) {
      const packet = await capture(page, width), carousels = Object.values(packet.interactions).filter(item => item.kind === 'carousel');
      assert.equal(carousels.length, 3);
      for (const item of carousels.filter(item => item.details.engine === 'owl')) {
        assert.equal(item.itemNodeIds!.length, 3); assert.equal(item.cloneNodeIds!.length, 2); assert.equal(item.details.currentLogicalIndex, 2); assert.equal(item.details.logicalIndexStatus, 'observed');
        const controlClasses = item.controlNodeIds!.map(id => packet.nodes[id].attributes.class);
        assert.ok(controlClasses.includes('owl-next')); assert.ok(controlClasses.includes('owl-prev')); assert.ok(controlClasses.includes('owl-dot active'));
        const owner = packet.nodes[item.nodeId].attributes.id;
        assert.ok(item.controlNodeIds!.every(id => !packet.nodes[id].attributes['aria-label'] || packet.nodes[id].attributes['aria-label'].endsWith(owner)));
      }
      const services = carousels.find(item => item.details.engine === 'bootstrap')!;
      assert.equal(services.itemNodeIds!.length, 2); assert.equal(services.cloneNodeIds!.length, 0);
      const controls = services.controlNodeIds!.map(id => packet.nodes[id]);
      assert.equal(controls.filter(node => node.attributes['data-slide-to'] !== undefined).length, 3);
      assert.ok(controls.some(node => node.attributes['data-bs-slide'] === 'next'));
      assert.ok(controls.every(node => node.attributes['data-target'] !== '#elsewhere'));
      assert.equal(controls.find(node => node.attributes['data-bs-slide'] === 'next')!.attributes['data-bs-target'], '#services');
    }
  } finally { await browser.close(); }
});

test('read-only DOM state binds real Owl next and restored windows including active clones without plugin internals', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<style>.owl-carousel{width:300px}.owl-stage-outer{width:300px;overflow:hidden}.owl-stage{display:flex;width:1000px;transform:translateX(-300px)}.owl-item{width:100px;flex-shrink:0}@media(max-width:500px){.owl-carousel,.owl-stage-outer{width:100px}}</style><main id="observed">${owl('brands')}</main><script>const track=document.querySelector('.owl-stage');const items=[...track.children];document.querySelector('.owl-next').onclick=()=>{items.forEach(item=>item.classList.remove('active'));items[4].classList.add('active');track.style.transform='translateX(-400px)'};document.querySelector('.owl-prev').onclick=()=>{items[3].classList.add('active');items[4].classList.add('active');track.style.transform='translateX(-300px)'};</script>`);
    await page.setViewportSize({ width: 390, height: 844 });
    const observe = async () => page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
    const before: any = await observe();
    assert.equal(before.status, 'observed'); assert.equal(before.logicalIndex, 2); assert.equal(before.logicalCount, 3); assert.equal(before.motionStatus, 'settled'); assert.equal(before.autoplayStatus, 'unknown');
    assert.deepEqual(before.items.filter((item: any) => item.visible).map((item: any) => item.logicalIndex), [2]);
    await page.getByRole('button', { name: 'Next brands', exact: true }).click();
    const after: any = await observe();
    assert.equal(after.logicalIndex, 0); assert.equal(after.items.find((item: any) => item.active).clone, true);
    assert.deepEqual(after.items.filter((item: any) => item.visible).map((item: any) => item.logicalIndex), [0]);
    const logicalA = after.items.find((item: any) => !item.clone && item.logicalIndex === 0).selector;
    assert.equal(after.items.find((item: any) => item.active).originalSelector, logicalA);
    await page.getByRole('button', { name: 'Previous brands', exact: true }).click();
    const restored: any = await observe();
    assert.equal(restored.logicalIndex, before.logicalIndex); assert.deepEqual(restored.items, before.items);
    assert.equal(await page.evaluate('document.querySelector(".owl-carousel").hasAttribute("data-clonewp-state")'), false);
  } finally { await browser.close(); }
});

test('Bootstrap DOM state reflects trusted selection, transition classes and ambiguous active items', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<style>.item:not(.active){display:none}</style><main id="observed">${bootstrap}</main><script>document.querySelector('button').onclick=()=>{const items=document.querySelectorAll('.item');items[0].classList.remove('active');items[1].classList.add('active')};</script>`);
    const observe = async () => page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.carousel-inner'))`);
    assert.equal((await observe() as any).logicalIndex, 0);
    await page.getByRole('button', { name: 'Next service', exact: true }).click();
    assert.equal((await observe() as any).logicalIndex, 1);
    await page.locator('.item.active').evaluate(element => element.classList.add('left'));
    const moving: any = await observe(); assert.equal(moving.logicalIndex, 1); assert.equal(moving.motionStatus, 'moving');
    await page.locator('.item').first().evaluate(element => element.classList.add('active'));
    const ambiguous: any = await observe(); assert.equal(ambiguous.status, 'unknown'); assert.equal(ambiguous.logicalIndex, null); assert.equal(ambiguous.reason, 'carousel-active-item-ambiguous');
  } finally { await browser.close(); }
});

test('unverified Owl clone content, noncontiguous originals and unavailable motion APIs stay explicit unknown', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<main id="observed">${owl('brands')}</main>`);
    const observe = async () => page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
    await page.locator('.owl-item.cloned').last().evaluate(element => element.textContent = 'not the original');
    const mismatched: any = await observe(); assert.equal(mismatched.status, 'unknown'); assert.equal(mismatched.logicalIndex, null); assert.equal(mismatched.reason, 'carousel-clone-mapping-unverified');
    await page.setContent(`<main id="observed">${owl('brands')}</main>`);
    await page.locator('.owl-stage').evaluate(element => element.insertBefore(element.children[4], element.children[2]));
    assert.equal((await observe() as any).reason, 'carousel-clone-mapping-unverified');
    await page.setContent(`<main id="observed">${owl('brands')}</main>`);
    await page.evaluate(`Object.defineProperty(document.querySelector('.owl-stage'), 'getAnimations', {value:undefined});Object.defineProperty(document, 'getAnimations', {value:undefined});`);
    const limited: any = await observe(); assert.equal(limited.status, 'observed'); assert.equal(limited.motionStatus, 'unknown'); assert.equal(limited.autoplayStatus, 'unknown');
  } finally { await browser.close(); }
});

test('Owl lazy clones normalize only a shared placeholder backed by distinct actual original image sources', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const image = (colour: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${colour}"/></svg>`)}`;
  const sources = ['red', 'blue', 'green'].map(image), placeholder = image('transparent');
  const fixture = `<main id="observed"><div class="owl-carousel owl-loaded"><div class="owl-stage-outer"><div class="owl-stage">${[...sources, ...sources, ...sources].map((url, index) => `<article class="owl-item${index < 3 || index > 5 ? ' cloned' : ''}${index === 6 ? ' active' : ''}"><img src="${index < 3 || index > 5 ? placeholder : url}"${index < 3 || index > 5 ? ` data-src="${url}"` : ''} alt="brand logo"></article>`).join('')}</div></div></div></main>`;
  try {
    await page.setContent(fixture);
    for (const width of [1920, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const observed: any = await page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
      assert.equal(observed.status, 'observed'); assert.equal(observed.logicalIndex, 0); assert.equal(observed.logicalCount, 3);
      assert.equal(observed.items.find((item: any) => item.active).clone, true);
      assert.deepEqual(observed.identityNormalizations, [{ attribute: 'src', placeholder, targets: [...sources].sort(), proof: 'shared-deferred-placeholder-with-distinct-observed-original-sources' }]);
      assert.equal(await page.locator('.owl-item.cloned img').first().getAttribute('src'), placeholder);
    }
    await page.locator('.owl-item.cloned img').last().evaluate((element, conflicting) => element.setAttribute('src', conflicting), sources[1]);
    const conflicting: any = await page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
    assert.equal(conflicting.status, 'unknown'); assert.equal(conflicting.logicalIndex, null); assert.equal(conflicting.reason, 'carousel-clone-mapping-unverified');
    await page.setContent(fixture);
    await page.locator('.owl-item.cloned img').last().evaluate((element, unsupported) => element.setAttribute('data-src', unsupported), image('purple'));
    const unsupported: any = await page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
    assert.equal(unsupported.status, 'unknown'); assert.deepEqual(unsupported.identityNormalizations, []);
  } finally { await browser.close(); }
});

test('a lone differing src and data-src is not sufficient evidence of an Owl lazy placeholder', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<main id="observed"><div class="owl-carousel"><div class="owl-stage"><article class="owl-item"><img src="data:,original" alt="brand"></article><article class="owl-item cloned active"><img src="data:,different" data-src="data:,original" alt="brand"></article></div></div></main>`);
    const observed: any = await page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
    assert.equal(observed.status, 'unknown'); assert.equal(observed.logicalIndex, null); assert.deepEqual(observed.identityNormalizations, []);
  } finally { await browser.close(); }
});

test('Owl lazy originals can use actual matching clones as proof without changing their source attributes', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const image = (colour: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${colour}"/></svg>`)}`;
  const sources = ['red', 'blue', 'green', 'orange', 'purple'].map(image), placeholder = image('transparent');
  const fixture = `<main id="observed"><div class="owl-carousel owl-loaded"><div class="owl-stage-outer"><div class="owl-stage">${[...sources, ...sources, ...sources].map((url, index) => {
    const clone = index < 5 || index >= 10, loaded = index > 5 && index <= 10;
    return `<article class="owl-item${clone ? ' cloned' : ''}${index === 10 ? ' active' : ''}"><img src="${loaded ? url : placeholder}"${loaded ? '' : ` data-src="${url}"`} alt="brand logo"></article>`;
  }).join('')}</div></div></div></main>`;
  const observe = async () => page.evaluate(`${source};collectCarouselDOMStateV2(document.querySelector('.owl-stage'))`);
  try {
    await page.setContent(fixture);
    for (const width of [1920, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const observed: any = await observe();
      assert.equal(observed.status, 'observed'); assert.equal(observed.logicalIndex, 0); assert.equal(observed.logicalCount, 5);
      assert.deepEqual(observed.items.map((item: any) => item.logicalIndex), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
      assert.deepEqual(observed.identityNormalizations, [{ attribute: 'src', placeholder, targets: [...sources].sort(), proof: 'shared-deferred-placeholder-with-distinct-observed-original-sources' }]);
      assert.equal(await page.locator('.owl-item:not(.cloned) img').first().getAttribute('src'), placeholder);
      assert.equal(await page.locator('.owl-item:not(.cloned) img').first().getAttribute('data-src'), sources[0]);
      assert.equal(await page.locator('.owl-item.cloned.active img').getAttribute('src'), sources[0]);
      assert.equal(await page.locator('.owl-item.cloned.active img').getAttribute('data-src'), null);
    }
    await page.locator('.owl-item.cloned.active img').evaluate((element, settings) => { element.setAttribute('src', settings.placeholder); element.setAttribute('data-src', settings.target); }, { placeholder, target: sources[0] });
    const missingActual: any = await observe();
    assert.equal(missingActual.status, 'unknown'); assert.equal(missingActual.logicalIndex, null); assert.deepEqual(missingActual.identityNormalizations, []);
    await page.setContent(fixture);
    await page.locator('.owl-item img').evaluateAll((elements, settings) => elements.forEach((element, index) => {
      if (index % 5 !== 4) return;
      element.setAttribute('src', settings.placeholder); element.removeAttribute('data-src');
    }), { placeholder });
    const realPlaceholder: any = await observe();
    assert.equal(realPlaceholder.status, 'unknown'); assert.equal(realPlaceholder.logicalIndex, null); assert.deepEqual(realPlaceholder.identityNormalizations, []);
    await page.setContent(fixture);
    await page.locator('.owl-item img').evaluateAll((elements, settings) => elements.forEach((element, index) => {
      element.setAttribute('src', settings.placeholder); element.setAttribute('data-src', settings.sources[index % settings.sources.length]);
    }), { placeholder, sources });
    const allPending: any = await observe();
    assert.equal(allPending.status, 'unknown'); assert.equal(allPending.logicalIndex, null); assert.equal(allPending.reason, 'carousel-clone-mapping-unverified'); assert.deepEqual(allPending.identityNormalizations, []);
  } finally { await browser.close(); }
});

test('source rendering binds Owl and Bootstrap states to their actual track and screenshot, retaining unknown gaps', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<title>Source render ownership</title><main id="observed">${owl('brands')}${bootstrap}</main>`);
    const packet = await capture(page, 390), interactions = Object.values(packet.interactions).filter(item => item.kind === 'carousel');
    const options = { taskId: 'carousel-source', snapshotId: packet.snapshot.id, screenshotHash: 'a'.repeat(64), readonlyDOM: true, nodes: interactions.map(item => packet.nodes[item.nodeId]), interactions: interactions.map(item => ({ nodeId: item.nodeId, trackSelector: packet.nodes[item.trackNodeId!].selector })) };
    const observe = async (settings = options) => JSON.parse(await page.evaluate(`${source};collectSourceRenderEvidenceV2(${JSON.stringify(settings)})`));
    const actual = await observe(); assert.equal(actual.states.length, 2); assert.equal(actual.states[0].carouselIndex, 2); assert.equal(actual.states[1].carouselIndex, 0); assert.ok(actual.states.every((item: any) => item.domState.status === 'observed'));
    await page.locator('.owl-item.cloned').last().evaluate(element => element.textContent = 'unverified clone');
    const unknown = await observe(); assert.equal(unknown.states[0].carouselIndex, undefined); assert.equal(unknown.states[0].domState.status, 'unknown'); assert.ok(unknown.gaps.some((item: any) => item.code === 'source-carousel-logical-index-unverified'));
    const wrong = await observe({ ...options, interactions: [{ ...options.interactions[0], trackSelector: '.owl-stage,.carousel-inner' }] }); assert.equal(wrong.states.length, 0); assert.equal(wrong.gaps[0].code, 'source-carousel-track-unresolved');
  } finally { await browser.close(); }
});

test('source rendering refuses a unique track belonging to another independent carousel owner', async () => {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent(`<title>Independent carousel bindings</title><main id="observed">${owl('brands')}${owl('reviews')}</main>`);
    const packet = await capture(page, 390), carousels = Object.values(packet.interactions).filter(item => item.kind === 'carousel');
    const brands = carousels.find(item => packet.nodes[item.nodeId].attributes.id === 'brands')!, reviews = carousels.find(item => packet.nodes[item.nodeId].attributes.id === 'reviews')!;
    const settings = { taskId: 'carousel-source', snapshotId: packet.snapshot.id, screenshotHash: 'a'.repeat(64), readonlyDOM: true, nodes: [packet.nodes[brands.nodeId]], interactions: [{ nodeId: brands.nodeId, trackSelector: packet.nodes[reviews.trackNodeId!].selector }] };
    const result = JSON.parse(await page.evaluate(`${source};collectSourceRenderEvidenceV2(${JSON.stringify(settings)})`));
    assert.deepEqual(result.states, []); assert.deepEqual(result.gaps, [{ nodeId: brands.nodeId, code: 'source-carousel-track-unresolved' }]);
  } finally { await browser.close(); }
});

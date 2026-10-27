import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { validateObservationPacketV2 } from '../src/replica-v2/observation.js';

test('animated SVG descendants retain finite source geometry', async () => {
  const source = await readFile(path.resolve('D:/cloneWP/src/replica-v2/collect.browser.js'), 'utf8'), browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.setContent('<title>Animated SVG fixture</title><style>@keyframes move{from{transform:translateX(0)}to{transform:translateX(20px)}}.moving{animation:move 2s infinite}</style><main id="observation"><div class="moving"><svg width="20" height="20"><path d="M0 0h20v20H0z"/></svg></div></main>');
    const transport = JSON.parse(await page.evaluate(`${source};collectObservationV2({snapshotId:'animated-svg',rootSelectors:['#observation']})`));
    const packet = validateObservationPacketV2(JSON.parse(transport.chunks[0].json));
    for (const node of Object.values(packet.nodes).filter(node => node.tag === 'svg' || node.tag === 'path')) {
      const geometry = packet.layouts[node.layoutId].captureGeometry;
      assert.ok(geometry);
      assert.ok(Number.isFinite(geometry.rect.x) && Number.isFinite(geometry.rect.y));
    }
  } finally { await browser.close(); }
});

test('observation paths retain html and all ancestors beyond ten levels, matching independent scene paths', async () => {
  const source = await readFile(path.resolve('D:/cloneWP/src/replica-v2/collect.browser.js'), 'utf8'), browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const deep = (label: string) => `<section>${'<div>'.repeat(15)}<div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide"><h3>${label}</h3></div></div></div>${'</div>'.repeat(15)}</section>`;
  try {
    await page.setContent(`<main id="observation">${deep('One')}${deep('Two')}</main>`);
    const transport = JSON.parse(await page.evaluate(`${source};collectObservationV2({snapshotId:'deep',rootSelectors:['#observation'],includeSceneInventory:true})`));
    const packet = JSON.parse(transport.chunks[0].json) as ObservationPacketV2, tracks = Object.values(packet.nodes).filter(node => node.attributes.class === 'swiper-wrapper');
    assert.equal(tracks.length, 2); assert.notEqual(tracks[0].selector, tracks[1].selector);
    for (const track of tracks) { assert.ok(track.selector.startsWith('html > body:nth-of-type(1) > ')); assert.ok(track.selector.split(' > ').length > 17); assert.equal(await page.locator(track.selector).count(), 1); }
    for (const heading of Object.values(packet.nodes).filter(node => node.tag === 'h3')) assert.ok(Object.values(transport.sceneInventory.entries as Record<string, { selector: string }>).some(entry => entry.selector === heading.selector));
    assert.equal(await page.evaluate(`${source};sceneSelectorV2(document.documentElement)`), 'html');
    const observedStyle = packet.styles[tracks[0].styleId];
    for (const property of ['box-shadow', 'text-shadow', 'filter', 'backdrop-filter', '-webkit-box-reflect', 'mix-blend-mode', 'outline-style', 'outline-width', 'border-image-outset', 'before:content', 'after:content']) assert.equal(typeof observedStyle[property], 'string', `missing actual computed ${property}`);
    assert.equal(observedStyle['before:content'], 'none');
  } finally { await browser.close(); }
});

test('source render observer reads actual currentSrc, loaded background pixels, SVG geometry and Slick current index', async () => {
  const source = await readFile(path.resolve('D:/cloneWP/src/replica-v2/collect.browser.js'), 'utf8'), browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const image = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2212%22%3E%3Crect width=%2216%22 height=%2212%22 fill=%22red%22/%3E%3C/svg%3E';
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  try {
    await page.setContent(`<style>.background{width:40px;height:30px;background-image:url("${image}")}.slick-slide:not(.slick-current){display:none}</style><main id="observation"><picture><source media="(max-width:1px)" srcset="https://inactive.invalid/never-request.png"><img src="${image}"></picture><div class="background"></div><svg width="20" height="20"><rect width="20" height="20" fill="green"/></svg><div class="slick-slider"><div class="slick-track"><article class="slick-slide" data-slick-index="0">One</article><article class="slick-slide slick-current" data-slick-index="1">Two</article><article class="slick-slide slick-cloned" data-slick-index="0">Clone</article></div></div></main>`);
    const transport = JSON.parse(await page.evaluate(`${source};collectObservationV2({snapshotId:'render',rootSelectors:['#observation']})`)), packet = JSON.parse(transport.chunks[0].json) as ObservationPacketV2;
    const screenshotHash = createHash('sha256').update(await page.screenshot()).digest('hex');
    const options = { taskId: 'new-task', snapshotId: packet.snapshot.id, screenshotHash, nodes: Object.values(packet.nodes), usages: Object.values(packet.usages).map(usage => ({ ...usage, resourceUrl: packet.resources[usage.resourceId].url })), interactions: Object.values(packet.interactions).filter(item => item.kind === 'carousel').map(item => ({ nodeId: item.nodeId, trackSelector: packet.nodes[item.trackNodeId!].selector })) };
    const observed = JSON.parse(await page.evaluate(`${source};collectSourceRenderEvidenceV2(${JSON.stringify(options)})`));
    assert.equal(observed.screenshotHash, screenshotHash); assert.equal(observed.fontsReady, true);
    const actual = observed.media.find((item: any) => item.kind === 'image'); assert.equal(actual.url, image); assert.equal(actual.currentSrc, image); assert.equal(actual.naturalWidth, 16); assert.equal(actual.drawable, true);
    const background = observed.media.find((item: any) => item.kind === 'background'); assert.equal(background.drawable, true); assert.equal(background.decoded, true); assert.equal(background.painted, true);
    const vector = observed.media.find((item: any) => item.kind === 'svg'); assert.equal(vector.drawable, true); assert.equal(vector.naturalWidth, 20);
    assert.equal(observed.states[0].carouselIndex, 1); assert.equal(observed.states[0].engine, 'observed-slick-current-data-index'); assert.equal(packet.nodes[Object.values(packet.nodes).find(node => node.attributes.class?.includes('slick-current'))!.id].attributes['data-slick-index'], '1');
    assert.equal(requests.some(url => url.includes('inactive.invalid')), false); assert.equal(observed.media.some((item: any) => item.url.includes('inactive.invalid')), false);
    // Match the CUA read-only scope: constructors and decode/getBBox are absent,
    // while any attempted canvas construction must fail this test immediately.
    await page.evaluate(`(() => {
      Object.defineProperty(window, 'HTMLImageElement', { value: undefined }); Object.defineProperty(window, 'SVGSVGElement', { value: undefined });
      Object.defineProperty(document.querySelector('img'), 'decode', { value: undefined }); Object.defineProperty(document.querySelector('svg'), 'getBBox', { value: undefined });
      document.createElement = (() => { throw Error('read-only scope forbids createElement'); });
      Object.defineProperty(window, 'Image', { value: function () { throw Error('read-only scope forbids Image'); } });
    })()`);
    const readonly = JSON.parse(await page.evaluate(`${source};collectSourceRenderEvidenceV2(${JSON.stringify({ ...options, readonlyDOM: true })})`));
    const readonlyImage = readonly.media.find((item: any) => item.kind === 'image'); assert.equal(readonlyImage.complete, true); assert.equal(readonlyImage.decoded, true); assert.equal(readonlyImage.drawable, true); assert.equal(readonlyImage.proof, 'browser-complete-currentSrc-natural-dimensions');
    const readonlyBackground = readonly.media.find((item: any) => item.kind === 'background'); assert.equal(readonlyBackground.decoded, null); assert.equal(readonlyBackground.drawable, null); assert.equal(readonlyBackground.painted, true);
    const readonlySVG = readonly.media.find((item: any) => item.kind === 'svg'); assert.equal(readonlySVG.decoded, null); assert.equal(readonlySVG.drawable, true); assert.equal(readonlySVG.proof, 'browser-svg-client-rect+bound-screenshot'); assert.equal(readonlySVG.naturalWidth, 20);
    assert.equal(readonly.observationMode, 'readonlyDOM'); assert.equal(readonly.states[0].carouselIndex, 1);
  } finally { await browser.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectNative44InteractionChecks } from '../src/native44/interaction-check.js';

async function nonLoopFixture(initialIndex: number, options: { fraction?: boolean; freezeFraction?: boolean; loopCloneOffset?: number; group?: number } = {}) {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const group = options.group ?? 1, pages = Math.ceil(6 / group), offset = options.loopCloneOffset ?? 0, loop = options.loopCloneOffset !== undefined, clones = Array.from({ length: offset }, () => '<div class="swiper-slide swiper-slide-duplicate">Clone</div>').join('');
  await page.setContent(`<div data-id="abcdef1" data-widget_type="nested-carousel.default"><div class="swiper"><div class="swiper-wrapper">${clones}${Array.from({ length: 6 }, (_, index) => `<div class="swiper-slide" data-swiper-slide-index="${index}">Item ${index + 1}</div>`).join('')}${clones}</div></div><button type="button" class="previous">Previous</button><button type="button" class="next">Next</button>${options.fraction ? `<div class="fraction"><span class="swiper-pagination-current">${Math.floor(initialIndex / group) + 1}</span> / <span class="swiper-pagination-total">${pages}</span></div>` : Array.from({ length: pages }, (_, index) => `<span class="dot" data-bullet-index="${index}"></span>`).join('')}</div><script>
    const root = document.querySelector('[data-id="abcdef1"]'), swiperElement = root.querySelector('.swiper');
    swiperElement.swiper = { initialized: true, destroyed: false, animating: false, realIndex: ${initialIndex}, snapIndex: ${offset + Math.floor(initialIndex / group)}, snapGrid: Array.from({length:${pages + offset * 2}}, (_,index)=>index), params: { loop: ${loop}, slidesPerGroup: ${group}, pagination: { type: '${options.fraction ? 'fraction' : 'bullets'}', currentClass: 'swiper-pagination-current', totalClass: 'swiper-pagination-total' } }, pagination: { el: root.querySelector('.fraction') }, slides: root.querySelectorAll('.swiper-slide') };
    window.actualControlClicks = [];
    function paint() { const runtime = swiperElement.swiper; root.querySelector('.previous').disabled = !runtime.params.loop && runtime.realIndex === 0; root.querySelector('.next').disabled = !runtime.params.loop && runtime.realIndex === 5; root.querySelectorAll('.dot').forEach((dot,index) => dot.classList.toggle('swiper-pagination-bullet-active', index === Math.floor(runtime.realIndex / runtime.params.slidesPerGroup))); const current = root.querySelector('.swiper-pagination-current'); if (current && ${!options.freezeFraction}) current.textContent = String(Math.floor(runtime.realIndex / runtime.params.slidesPerGroup) + 1); }
    for (const direction of ['next','previous']) root.querySelector('.'+direction).addEventListener('click', event => { window.actualControlClicks.push({ direction, trusted: event.isTrusted }); const runtime = swiperElement.swiper, moved = runtime.realIndex + (direction === 'next' ? 1 : -1) * runtime.params.slidesPerGroup; runtime.realIndex = runtime.params.loop ? (moved + 6) % 6 : Math.max(0, Math.min(5, moved)); runtime.snapIndex = ${offset} + Math.floor(runtime.realIndex / runtime.params.slidesPerGroup); paint(); });
    paint();
  </script>`);
  return { browser, page, check: { componentKey: 'header-promotions', selector: '[data-id="abcdef1"]', widgetType: 'nested-carousel', nextSelector: '.next', previousSelector: '.previous', paginationSelector: options.fraction ? '.fraction' : '.dot', requireSourceAlignment: true } };
}

test('non-loop source-aligned last item proves previous then next and restores synchronized pagination', async () => {
  const fixture = await nonLoopFixture(0);
  try {
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 5 }], 'mobile');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.before!.logicalIndex, 5); assert.equal(row.probeDirection, 'previous'); assert.equal(row.after!.logicalIndex, 4); assert.equal(row.after!.paginationIndex, 4); assert.equal(row.restored!.logicalIndex, 5); assert.equal(row.restored!.paginationIndex, 5); assert.equal(row.clickedNext, true); assert.equal(row.clickedPrevious, true);
    assert.deepEqual(row.normalizationActions, Array(5).fill('next'));
    const clicks = await fixture.page.evaluate('window.actualControlClicks') as Array<{ direction: string; trusted: boolean }>; assert.deepEqual(clicks.map(click => click.direction), [...Array(5).fill('next'), 'previous', 'next']); assert.ok(clicks.every(click => click.trusted)); assert.equal(await fixture.page.locator('.next').isDisabled(), true);
  } finally { await fixture.browser.close(); }
});

test('native fraction reads actual owned current/total text and follows real arrows through last-item normalization and restore', async () => {
  const fixture = await nonLoopFixture(0, { fraction: true });
  try {
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 5 }], 'mobile');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.before!.paginationKind, 'fraction'); assert.equal(row.before!.paginationOwned, true); assert.equal(row.before!.fractionCurrent, 6); assert.equal(row.before!.fractionTotal, 6); assert.equal(row.after!.fractionCurrent, 5); assert.equal(row.after!.paginationIndex, 4); assert.equal(row.restored!.fractionCurrent, 6); assert.equal(row.restored!.paginationIndex, 5); assert.equal(row.clickedNext, true); assert.equal(row.clickedPrevious, true); assert.equal(await fixture.page.locator('.dot').count(), 0);
  } finally { await fixture.browser.close(); }
});

test('static copied fraction digits cannot prove pagination synchronization when the actual slide moves', async () => {
  const fixture = await nonLoopFixture(1, { fraction: true, freezeFraction: true });
  try {
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 1 }], 'desktop-wide');
    assert.equal(row.status, 'failed'); assert.match(row.problems.join(' '), /stable actual logical index and matching pagination/); assert.equal(row.before!.fractionCurrent, 2); assert.equal(row.before!.fractionTotal, 6); assert.equal(row.after, undefined); assert.equal(row.restored!.logicalIndex, 1); assert.equal(row.restored!.fractionCurrent, 2);
  } finally { await fixture.browser.close(); }
});

test('legacy loop fraction uses real logical index across clone offset and wrap without treating native snapIndex as page', async () => {
  const fixture = await nonLoopFixture(0, { fraction: true, loopCloneOffset: 1 });
  try {
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 5 }], 'mobile');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.before!.logicalCount, 6); assert.equal(row.before!.logicalIndex, 5); assert.equal(row.before!.nativeSnapIndex, 6); assert.equal(row.before!.logicalPageIndex, 5); assert.equal(row.before!.fractionCurrent, 6); assert.equal(row.after!.logicalIndex, 0); assert.equal(row.after!.nativeSnapIndex, 1); assert.equal(row.after!.paginationIndex, 0); assert.equal(row.restored!.logicalIndex, 5); assert.equal(row.restored!.fractionCurrent, 6);
  } finally { await fixture.browser.close(); }
});

test('loop bullets use actual slidesPerGroup and bullet mapping with a different clone snap offset', async () => {
  const fixture = await nonLoopFixture(0, { loopCloneOffset: 6, group: 2 });
  try {
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 4 }], 'desktop-wide');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.before!.logicalCount, 6); assert.equal(row.before!.nativeSnapIndex, 8); assert.equal(row.before!.logicalPageIndex, 2); assert.equal(row.before!.paginationIndex, 2); assert.equal(row.after!.nativeSnapIndex, 6); assert.equal(row.after!.logicalPageIndex, 0); assert.equal(row.after!.paginationIndex, 0); assert.equal(row.restored!.logicalIndex, 4);
  } finally { await fixture.browser.close(); }
});

test('non-loop high-to-low source alignment uses real previous clicks before both-direction probe and restore', async () => {
  const fixture = await nonLoopFixture(5);
  try {
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 1 }], 'desktop-narrow');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.normalizedFrom, 5); assert.equal(row.normalizationClicks, 4); assert.deepEqual(row.normalizationActions, Array(4).fill('previous')); assert.equal(row.before!.logicalIndex, 1); assert.equal(row.after!.logicalIndex, 2); assert.equal(row.restored!.logicalIndex, 1); assert.equal(row.restored!.paginationIndex, 1); assert.equal(row.clickedNext, true); assert.equal(row.clickedPrevious, true);
    const clicks = await fixture.page.evaluate('window.actualControlClicks') as Array<{ direction: string; trusted: boolean }>; assert.deepEqual(clicks.map(click => click.direction), [...Array(4).fill('previous'), 'next', 'previous']); assert.ok(clicks.every(click => click.trusted));
  } finally { await fixture.browser.close(); }
});

test('hover-revealed native arrows use a real owner hover and trusted clicks without force', async () => {
  const fixture = await nonLoopFixture(0);
  try {
    await fixture.page.addStyleTag({ content: '[data-id="abcdef1"]{margin-top:300px}.next,.previous{opacity:0;pointer-events:none}[data-id="abcdef1"]:hover .next,[data-id="abcdef1"]:hover .previous{opacity:1;pointer-events:auto}' });
    await fixture.page.mouse.move(0, 0);
    assert.equal(await fixture.page.locator('.next').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    const [row] = await collectNative44InteractionChecks(fixture.page, [{ ...fixture.check, expectedLogicalIndex: 0 }], 'desktop-wide');
    assert.equal(row.status, 'passed', row.problems.join('; '));
    const clicks = await fixture.page.evaluate('window.actualControlClicks') as Array<{ trusted: boolean }>;
    assert.equal(clicks.length, 2); assert.ok(clicks.every(click => click.trusted)); assert.equal(row.restored!.logicalIndex, 0);
  } finally { await fixture.browser.close(); }
});

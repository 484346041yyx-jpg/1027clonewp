import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { installCarouselPlaybackControllers, carouselPlaybackBrowserSource, type CarouselPlaybackBinding, type CarouselPlaybackReceipt } from '../src/native44/behaviors/carousel-playback.js';

const binding: CarouselPlaybackBinding = { key: 'campaign-playback', pageId: 77, ownerId: 'aaaaaaa', buttonId: 'bbbbbbb', widgetType: 'nested-carousel', initialState: 'paused', playLabel: 'Play carousel', pauseLabel: 'Pause carousel' };
// Deliberately a timer fixture, not a claim about the installed site's Swiper.
// It models start/stop, a stale paused flag, native navigation that restarts the
// timer, and event callbacks while moving actual slide DOM content.
const fixture = `
<div data-elementor-id="77"><div data-id="aaaaaaa" data-widget_type="nested-carousel.default"><div class="swiper"><div class="swiper-wrapper"><div>Slide one</div><div>Slide two</div><div>Slide three</div></div></div></div>
<div data-id="bbbbbbb" data-widget_type="button.default" data-clonewp-playback="campaign-playback" data-clonewp-carousel-owner="aaaaaaa"><a class="elementor-button" href="#"><span class="elementor-button-text">Play carousel</span></a></div><button id="native-next" type="button">Next slide</button></div>
<script>(()=>{
const el=document.querySelector('.swiper'), listeners=new Map();let timer;
const emit=name=>(listeners.get(name)||[]).slice().forEach(fn=>fn());
const runtime={initialized:true,destroyed:false,el,slides:[...el.querySelector('.swiper-wrapper').children],realIndex:0,params:{autoplay:{delay:90}},on(name,fn){listeners.set(name,[...(listeners.get(name)||[]),fn]);},off(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(x=>x!==fn));}};
const move=()=>{runtime.realIndex=(runtime.realIndex+1)%3;el.dataset.logicalIndex=String(runtime.realIndex);runtime.slides.forEach((slide,i)=>slide.hidden=i!==runtime.realIndex);emit('slideChange');};
const tick=()=>{clearInterval(timer);if(runtime.autoplay.running&&!runtime.autoplay.paused)timer=setInterval(move,90);};
runtime.autoplay={running:true,paused:false,start(){this.running=true;this.paused=false;tick();emit('autoplayStart');return true;},stop(){this.running=false;this.paused=true;clearInterval(timer);emit('autoplayStop');return true;},resume(){this.paused=false;tick();emit('autoplayResume');}};
el.swiper=runtime;window.fixture=runtime;window.suspend=()=>{runtime.autoplay.paused=true;clearInterval(timer);emit('autoplayPause');};document.querySelector('#native-next').onclick=()=>{move();runtime.autoplay.start();};tick();})();
</script>`;

async function install(page: Page, bindings = [binding], options = { runtimeTimeoutMs: 150, actionTimeoutMs: 100, pollMs: 10 }) {
  return page.evaluate<CarouselPlaybackReceipt[]>(`(async () => { const __name = target => target; const install = (${installCarouselPlaybackControllers.toString()}); window.playbackSession = await install(${JSON.stringify(bindings)},${JSON.stringify(options)}); return window.playbackSession.receipts; })()`);
}
const index = (page: Page) => page.evaluate(() => (window as any).fixture.realIndex as number);

test('generic playback timer fixture proves actual pause, resume, native Next remaining paused, and keyboard state', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(fixture);
    assert.deepEqual(await install(page), [{ key: binding.key, status: 'ready' }]);
    const control = page.getByRole('button', { name: 'Play carousel' });
    assert.equal(await control.getAttribute('aria-controls'), 'clonewp-carousel-77-aaaaaaa');
    assert.equal(await control.getAttribute('aria-pressed'), 'false');
    let paused = await index(page); await page.waitForTimeout(280); assert.equal(await index(page), paused);
    assert.equal(await page.evaluate(() => (window as any).fixture.autoplay.paused), true, 'stale paused flag does not override running=false');
    await control.click();
    await page.waitForFunction(before => (window as any).fixture.realIndex !== before, paused);
    assert.equal(await page.getByRole('button', { name: 'Pause carousel' }).getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => (window as any).fixture.autoplay.stop());
    await page.getByRole('button', { name: 'Play carousel' }).click();
    assert.equal(await page.getByRole('button', { name: 'Pause carousel' }).getAttribute('aria-pressed'), 'true', 'a native stop must not turn the visible Play action into a no-op');
    await page.evaluate(() => (window as any).suspend());
    assert.equal(await page.locator('[data-id="bbbbbbb"]').getAttribute('data-clonewp-playback-state'), 'suspended');
    assert.equal(await page.getByRole('button', { name: 'Pause carousel' }).getAttribute('aria-pressed'), 'true', 'temporary hover/focus suspension is not a user stop');
    await page.getByRole('button', { name: 'Pause carousel' }).click();
    paused = await index(page); await page.waitForTimeout(250); assert.equal(await index(page), paused);
    await page.getByRole('button', { name: 'Next slide' }).click();
    const afterNext = await index(page); assert.equal(afterNext, (paused + 1) % 3);
    await page.waitForTimeout(280); assert.equal(await index(page), afterNext, 'native navigation cannot restart user-paused autoplay');
    await page.getByRole('button', { name: 'Play carousel' }).press('Space');
    await page.waitForFunction(before => (window as any).fixture.realIndex !== before, afterNext);
    await page.getByRole('button', { name: 'Pause carousel' }).press('Enter');
    paused = await index(page); await page.waitForTimeout(250); assert.equal(await index(page), paused);
    assert.equal(await page.locator('.swiper-wrapper').getAttribute('aria-live'), 'polite');
    await page.evaluate(() => (window as any).playbackSession.destroy());
  } finally { await browser.close(); }
});

test('generic playback rejects duplicate owners, alleged clones, duplicate runtimes and duplicate manifest bindings', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const mutation of [
      `document.querySelector('[data-elementor-id]').insertAdjacentHTML('beforeend','<div class="pretend-clone" data-id="aaaaaaa" data-widget_type="nested-carousel.default"></div>');fixture.params.slideDuplicateClass='pretend-clone';`,
      `document.querySelector('[data-id="aaaaaaa"]').classList.add('swiper-slide-duplicate');`,
      `const extra=document.createElement('div');document.querySelector('[data-id="aaaaaaa"]').append(extra);extra.swiper={...fixture,el:extra};`,
    ]) {
      await page.setContent(fixture); await page.evaluate(mutation);
      const result = await install(page); assert.equal(result[0].status, 'failed');
      assert.match(result[0].error ?? '', /widget_owner_ambiguous|widget_owner_invalid|swiper_owner_ambiguous/);
      assert.equal(await page.locator('[data-id="bbbbbbb"]').getAttribute('data-clonewp-playback-attached'), null);
    }
    await page.setContent(fixture);
    const result = await install(page, [binding, { ...binding, key: 'another' }]);
    assert.ok(result.every((row: any) => row.status === 'failed' && row.error === 'binding_invalid_or_ambiguous'));
    assert.equal(await page.locator('[data-id="bbbbbbb"]').getAttribute('data-clonewp-playback-attached'), null);
  } finally { await browser.close(); }
});

test('generic playback isolates nested widget runtimes and fails closed on owner replacement or action timeout', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(fixture);
    await page.evaluate(`const nested=document.createElement('div');nested.dataset.widget_type='nested-carousel.default';nested.innerHTML='<div class="inner-swiper"></div>';document.querySelector('[data-id="aaaaaaa"]').append(nested);nested.firstElementChild.swiper={...fixture,el:nested.firstElementChild};`);
    assert.equal((await install(page))[0].status, 'ready');
    await page.locator('[data-id="aaaaaaa"]').evaluate(owner => owner.remove());
    await page.waitForFunction(() => document.querySelector('[data-id="bbbbbbb"]')?.getAttribute('data-clonewp-playback-state') === 'unavailable');
    assert.equal(await page.evaluate(() => (window as any).fixture.autoplay.running), false);
    assert.equal(await page.locator('.elementor-button').getAttribute('aria-disabled'), 'true');
    await page.setContent(fixture);
    await page.evaluate(() => { (window as any).fixture.autoplay.start = () => {}; });
    assert.equal((await install(page))[0].status, 'ready');
    await page.getByRole('button', { name: 'Play carousel' }).click();
    await page.waitForFunction(() => document.querySelector('[data-id="bbbbbbb"]')?.getAttribute('data-clonewp-playback-state') === 'unavailable');
    assert.equal(await page.evaluate(() => (window as any).playbackSession.receipts[0].error), 'playback_command_timeout');
    await page.setContent(fixture);
    await page.evaluate(() => { delete (document.querySelector('.swiper') as any).swiper; });
    assert.equal((await install(page))[0].error, 'swiper_initialization_timeout');
  } finally { await browser.close(); }
});

test('prepared browser asset boots the same fixed implementation from inert explicit bindings', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(fixture + `<script type="application/json" id="clonewp-playback-bindings">${JSON.stringify([binding])}</script>`);
    await page.addScriptTag({ content: carouselPlaybackBrowserSource() });
    await page.waitForFunction(() => document.querySelector('[data-id="bbbbbbb"]')?.getAttribute('data-clonewp-playback-state') === 'paused');
    const before = await index(page); await page.waitForTimeout(250); assert.equal(await index(page), before);
    assert.ok(carouselPlaybackBrowserSource().includes('locate'));
    assert.ok(!carouselPlaybackBrowserSource().includes('petsupermarket'));
  } finally { await browser.close(); }
});

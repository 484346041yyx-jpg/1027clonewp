import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { compileMobileTouchCSS, mobileTouchTreatmentSchema } from '../src/replica-responsive/touch.js';

const owners = [{ snapshotId: 'phone-390', nodeId: 'source-card-390' }, { snapshotId: 'phone-430', nodeId: 'source-card-430' }];
const row = { key: 'card-image', behavior: 'press-feedback' as const, reason: 'The source phone card remains a one-tap link with brief visual feedback.', sourceOwners: owners, press: { trigger: '.card', target: '.image img', property: 'transform' as const, value: 'scale(1.09)' } };

test('touch treatment requires phone owners, a typed action and bounded page-local paint', () => {
  const css = compileMobileTouchCSS('cwp-n44-a1b2c3', 768, [row]);
  assert.match(css, /hover:none/); assert.match(css, /pointer:coarse/);
  assert.match(css, /:page \.cwp-n44-a1b2c3 \.card:active \.image img\{transform:scale\(1\.09\)\}/);
  assert.throws(() => mobileTouchTreatmentSchema.parse({ ...row, sourceOwners: [owners[0], owners[0]] }), /Two distinct phone observations/);
  assert.throws(() => mobileTouchTreatmentSchema.parse({ ...row, behavior: 'native-disclosure' }), /Press paint must match/);
  assert.throws(() => mobileTouchTreatmentSchema.parse({ ...row, press: { ...row.press, value: 'scale(9)' } }), /bounded visual paint/);
  assert.throws(() => mobileTouchTreatmentSchema.parse({ ...row, press: { ...row.press, trigger: '.card:hover' } }), /Invalid string/);
  assert.throws(() => compileMobileTouchCSS('body', 768, [row]), /touch_scope/);
  assert.equal(compileMobileTouchCSS('cwp-n44-a1b2c3', 768, [{ key: 'nav', behavior: 'native-disclosure', reason: 'The source phone menu expands only on click.', sourceOwners: owners }]), '');
});

test('phone media keeps short active paint scoped; a real touch still follows the link in one tap', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const css = compileMobileTouchCSS('cwp-n44-a1b2c3', 768, [row]).replaceAll(':page', 'body');
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><section class="cwp-n44-a1b2c3"><a class="card" href="#visited"><span class="image"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E" width="100" height="100"></span></a></section><section class="cwp-n44-other"><a class="card" href="#wrong"><span class="image"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E" width="100" height="100"></span></a></section>`);
    const owned = page.locator('.cwp-n44-a1b2c3 img'), foreign = page.locator('.cwp-n44-other img');
    const before = await owned.evaluate(node => getComputedStyle(node).transform);
    const box = await page.locator('.cwp-n44-a1b2c3 .card').boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.down();
    const pressed = await owned.evaluate(node => getComputedStyle(node).transform);
    assert.notEqual(pressed, before);
    assert.equal(await foreign.evaluate(node => getComputedStyle(node).transform), before);
    await page.mouse.move(250, 300);
    await page.mouse.up();
    assert.equal(await owned.evaluate(node => getComputedStyle(node).transform), before);
    await page.locator('.cwp-n44-a1b2c3 .card').tap();
    await page.waitForTimeout(100);
    assert.equal(new URL(page.url()).hash, '#visited');
    await context.close();
  } finally { await browser.close(); }
});

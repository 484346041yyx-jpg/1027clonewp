import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { adjustNative44PreviewChrome } from '../src/native44/compare.js';
import { collectOwnedHeaderScrollGeometry, runOwnedHeaderScrollDiagnostic } from './fixtures/source-probes/diagnose-owned-header-scroll-layout.js';
let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] }); });
test.after(async () => { await browser.close(); });
async function fixture(script = '', admin = false) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0}.header{position:sticky;top:0;height:100px;background:white;z-index:2}.body{height:4000px}.offcanvas{position:fixed;right:-400px;top:0;width:300px;height:300px;visibility:hidden}.inner{height:20px}.moving{position:relative;height:20px}</style>${admin ? '<style>html{margin-top:32px!important}#wpadminbar{position:fixed;top:0;left:0;height:32px;width:100%;background:black}</style>' : ''}<body class="${admin ? 'admin-bar' : ''}">${admin ? '<div id="wpadminbar"></div>' : ''}<main class="owner"><header class="header"></header><section class="body"><div class="moving"></div></section></main><aside class="offcanvas"><div class="inner"></div></aside><script>addEventListener('scroll',()=>{${script}})</script>`);
  return page;
}
test('actual hidden fixed subtree explains legacy scrollY coordinate drift while all body geometry remains stable', async () => {
  const page = await fixture();
  try {
    const original = await page.content(), result = await collectOwnedHeaderScrollGeometry(page, { ownerSelector: '.owner', headerSelector: '.header' });
    const [a, b, c] = result.samples;
    assert.notEqual(a.legacyLayoutHash, b.legacyLayoutHash); assert.equal(a.legacyLayoutHash, c.legacyLayoutHash);
    assert.equal(a.proposedCoordinateHash, b.proposedCoordinateHash); assert.equal(a.proposedCoordinateHash, c.proposedCoordinateHash);
    const fixed = b.rows.filter(row => row.fixedRootIndex !== null); assert.equal(fixed.length, 2);
    assert(fixed.every(row => row.suppressed && !row.possiblyPaintedInViewport));
    assert.equal(await page.content(), original); assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(await page.evaluate(() => typeof (globalThis as any).__name), 'undefined');
    assert(result.samples.every(sample => sample.identityStable));
    const text = JSON.stringify(result); assert(!text.includes('textContent')); assert(!text.includes('href')); assert(!text.includes('inputValue'));
  } finally { await page.close(); }
});
test('actual inner body movement persists after coordinate normalization; diagnostic never calls it passed', async () => {
  const page = await fixture("document.querySelector('.moving').style.top=scrollY>0?'10px':'0px'");
  try {
    const result = await collectOwnedHeaderScrollGeometry(page, { ownerSelector: '.owner', headerSelector: '.header' });
    assert.notEqual(result.samples[0].proposedCoordinateHash, result.samples[1].proposedCoordinateHash);
    assert.equal(result.samples[0].proposedCoordinateHash, result.samples[2].proposedCoordinateHash);
    assert.equal(result.acceptanceVerdict, 'none');
  } finally { await page.close(); }
});
test('same original preview chrome function is restored after actual 0,970,0 reads', async () => {
  const page = await fixture('', true);
  try {
    const chrome = await adjustNative44PreviewChrome(page); assert(chrome); assert.equal(chrome.receipt.reservedHtmlMarginRemoved, 32);
    try { const result = await collectOwnedHeaderScrollGeometry(page, { ownerSelector: '.owner', headerSelector: '.header' }); assert.equal(result.samples[0].ownedHeader.y, 0); }
    finally { await chrome.restore(); }
    assert.equal(await page.locator('#wpadminbar').evaluate(node => getComputedStyle(node).display), 'block');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginTop), '32px');
  } finally { await page.close(); }
});
test('CLI rejects missing or wrong exact run before any credentials/remote construction', async () => {
  await assert.rejects(() => runOwnedHeaderScrollDiagnostic([]), /Usage/);
  await assert.rejects(() => runOwnedHeaderScrollDiagnostic(['--run', 'foreign']), /Usage/);
});
test('diagnostic does not misclassify visible descendants of a visibility-hidden fixed ancestor as suppressed', async () => {
  const page = await fixture();
  try {
    await page.locator('.offcanvas').evaluate(node => { (node as HTMLElement).style.left = '0'; (node as HTMLElement).style.right = 'auto'; });
    await page.locator('.inner').evaluate(node => { (node as HTMLElement).style.visibility = 'visible'; });
    const result = await collectOwnedHeaderScrollGeometry(page, { ownerSelector: '.owner', headerSelector: '.header' });
    const root = result.samples[0].rows.find(row => row.className === 'offcanvas')!, child = result.samples[0].rows.find(row => row.className === 'inner')!;
    assert.equal(root.suppressed, true); assert.equal(child.suppressed, false); assert.equal(child.possiblyPaintedInViewport, true); assert.equal(child.fixedRootIndex, root.index);
  } finally { await page.close(); }
});

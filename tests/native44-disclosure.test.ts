import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { collectNative44DisclosureChecks, native44DisclosureEvidencePassed, validateNative44DisclosureChecks, type Native44DisclosureCheck } from '../src/native44/disclosure-check.js';
import { analyzeNative44Captures, captureNative44Role, type Native44Capture, type Native44CompareManifest } from '../src/native44/compare.js';

const check: Native44DisclosureCheck = { componentKey: 'catalog-menu', selector: '[data-id="abcdef1"]', widgetType: 'nested-accordion', detailsSelector: '.disclosure', triggerSelector: '.trigger', panelSelector: '.panel' };
async function fixture(options: { open?: boolean; controlsDetails?: boolean; staleAria?: boolean; hiddenPanel?: boolean; duplicateId?: boolean; blockSpace?: boolean; foreignToggle?: boolean; nestedOwner?: boolean; unsafeSummary?: boolean } = {}) {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const owner = 'data-id="abcdef1" data-widget_type="nested-accordion.default"', native = `<details class="disclosure" id="menu-details" ${options.open ? 'open' : ''}><summary class="trigger" aria-expanded="${Boolean(options.open)}" aria-controls="${options.controlsDetails ? 'menu-details' : 'menu-panel'}">Browse${options.unsafeSummary ? '<a href="https://business.invalid">Unsafe link</a>' : ''}</summary><div class="panel" id="menu-panel"${options.hiddenPanel ? ' style="display:none"' : ''}><a href="https://business.invalid/category">Editable category</a></div></details>`;
  await page.setContent(`<!doctype html><style>body{margin:0;height:2000px}.shell{margin-top:150px}summary{padding:10px}.panel{padding:12px}</style><div class="shell" ${owner}>${options.nestedOwner ? `<div data-id="nested2" data-widget_type="nested-accordion.default">${native}</div>` : native}</div><div data-id="foreign3" data-widget_type="nested-accordion.default"><details id="foreign-details"><summary>Another owner</summary><div>Must stay unchanged</div></details></div>${options.duplicateId ? '<div id="menu-panel">Duplicate relationship</div>' : ''}<script>
    const disclosure = document.querySelector('.disclosure'), summary = disclosure.querySelector('summary');
    window.actualInputs=[];
    disclosure.addEventListener('toggle',()=>{if (${!options.staleAria}) summary.setAttribute('aria-expanded',String(disclosure.open))});
    summary.addEventListener('click',event=>{window.actualInputs.push({type:'click',trusted:event.isTrusted});if (${Boolean(options.foreignToggle)}) {const foreign=document.querySelector('#foreign-details');foreign.open=!foreign.open}});
    summary.addEventListener('keydown',event=>{window.actualInputs.push({type:event.code,trusted:event.isTrusted});if (${Boolean(options.blockSpace)} && event.code==='Space') event.preventDefault()});
  </script>`);
  return { browser, page };
}

test('native disclosure proves real click, Enter and Space plus owned ARIA, content visibility, focus and restoration', async () => {
  const { browser, page } = await fixture();
  try {
    await page.evaluate(() => scrollTo(0, 90));
    const [row] = await collectNative44DisclosureChecks(page, [check], 'desktop-wide');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(native44DisclosureEvidencePassed(row, check), true);
    assert.deepEqual(row.actions.map(action => [action.input, action.expanded]), [['click', true], ['click', false], ['Enter', true], ['Enter', false], ['Space', true], ['Space', false]]);
    assert.equal(row.before!.expanded, false); assert.equal(row.before!.controlsTarget, 'panel'); assert.equal(row.restored!.panelVisible, false); assert.equal(row.restored!.triggerFocused, true);
    assert.equal(await page.locator('#foreign-details').getAttribute('open'), null); assert.equal(await page.evaluate(() => scrollY), 90);
    const inputs = await page.evaluate('window.actualInputs') as Array<{type:string;trusted:boolean}>; assert.equal(inputs.filter(input=>input.type==='click').length, 6); assert.ok(inputs.every(input=>input.trusted)); assert.equal(page.url(), 'about:blank');
  } finally { await browser.close(); }
});

test('initially expanded native accordion can control its owned details id and returns to expanded state', async () => {
  const { browser, page } = await fixture({ open: true, controlsDetails: true });
  try {
    const [row] = await collectNative44DisclosureChecks(page, [check], 'desktop-narrow');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.before!.controlsTarget, 'details'); assert.equal(row.restored!.expanded, true); assert.equal(row.restored!.panelVisible, true);
  } finally { await browser.close(); }
});

test('copied ARIA and CSS-hidden panels cannot pass merely by changing details.open', async () => {
  for (const option of [{ staleAria: true }, { hiddenPanel: true }]) {
    const { browser, page } = await fixture(option);
    try {
      const [row] = await collectNative44DisclosureChecks(page, [check], 'desktop-wide');
      assert.equal(row.status, 'failed'); assert.match(row.problems.join(' '), /synchronized open, ARIA and visible panel/); assert.equal(row.restored!.expanded, false); assert.equal(await page.locator('.disclosure').getAttribute('open'), null);
    } finally { await browser.close(); }
  }
});

test('a nested foreign native widget, duplicate aria-controls id or unsafe summary is rejected before clicking', async () => {
  for (const option of [{ nestedOwner: true }, { duplicateId: true }, { unsafeSummary: true }]) {
    const { browser, page } = await fixture(option);
    try {
      const [row] = await collectNative44DisclosureChecks(page, [check], 'desktop-wide');
      assert.equal(row.status, 'failed'); assert.equal(row.actions.length, 0); assert.deepEqual(await page.evaluate('window.actualInputs'), []); assert.equal(await page.locator('.disclosure').getAttribute('open'), null);
    } finally { await browser.close(); }
  }
});

test('click-only disclosure fails missing Space support and reports the restored native state', async () => {
  const { browser, page } = await fixture({ blockSpace: true });
  try {
    const [row] = await collectNative44DisclosureChecks(page, [check], 'desktop-wide');
    assert.equal(row.status, 'failed'); assert.equal(row.actions.length, 4); assert.match(row.problems.join(' '), /synchronized open/); assert.equal(row.restored!.expanded, false); assert.equal(native44DisclosureEvidencePassed(row, check), false);
  } finally { await browser.close(); }
});

test('cross-owner disclosure activation fails isolation even when its own panel works', async () => {
  const { browser, page } = await fixture({ foreignToggle: true });
  try {
    const [row] = await collectNative44DisclosureChecks(page, [check], 'desktop-wide');
    assert.equal(row.status, 'failed'); assert.match(row.problems.join(' '), /another native owner/); assert.equal(row.restored!.expanded, false); assert.equal(await page.locator('#foreign-details').getAttribute('open'), null);
  } finally { await browser.close(); }
});

test('disclosure declarations are additive, explicit and restricted to declared native owners and viewports', async () => {
  assert.doesNotThrow(() => validateNative44DisclosureChecks([]));
  assert.throws(() => validateNative44DisclosureChecks([check, check]), /unique component/);
  assert.throws(() => validateNative44DisclosureChecks([{ ...check, panelSelector: '' }]), /explicit panel/);
  assert.throws(() => validateNative44DisclosureChecks([{ ...check, widgetType: 'html' as 'nested-accordion' }]), /exact native/);
  assert.throws(() => validateNative44DisclosureChecks([{ ...check, viewports: ['mobile'] }], ['desktop-wide', 'desktop-narrow']), /viewport/);
  const { browser, page } = await fixture();
  try { assert.deepEqual(await collectNative44DisclosureChecks(page, [{ ...check, viewports: ['desktop-narrow'] }], 'desktop-wide'), []); assert.deepEqual(await page.evaluate('window.actualInputs'), []); }
  finally { await browser.close(); }
});

test('comparison blocks missing or incomplete declared disclosure proof without expanding historical carousel semantics', async () => {
  const { browser, page } = await fixture();
  try {
    const digest = 'a'.repeat(64), manifest = { widgetTypes: [], modules: [], disclosureChecks: [check] } as unknown as Native44CompareManifest;
    const capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1905, devicePixelRatio: 1, source: { screenshot: 'source.png', sha256: digest, modules: [] }, target: { screenshot: 'target.png', sha256: digest, modules: [] } };
    assert.deepEqual(analyzeNative44Captures({ ...manifest, disclosureChecks: undefined }, [capture]).gaps, []);
    assert.match(analyzeNative44Captures(manifest, [capture]).gaps[0].detail, /Declared native disclosure/);
    capture.target.disclosureChecks = await collectNative44DisclosureChecks(page, [check], capture.viewport);
    assert.deepEqual(analyzeNative44Captures(manifest, [capture]).gaps, []);
    capture.target.disclosureChecks[0].actions.pop(); assert.equal(analyzeNative44Captures(manifest, [capture]).gaps[0].blocking, true);
    capture.target.disclosureChecks[0].actions.push({ input: 'Space', expanded: false }); capture.target.disclosureChecks.push(capture.target.disclosureChecks[0]); assert.equal(analyzeNative44Captures(manifest, [capture]).gaps[0].blocking, true);
  } finally { await browser.close(); }
});

test('standard target capture includes actual disclosure proof and leaves the native menu restored before pixels', async () => {
  const { browser, page } = await fixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'native44-disclosure-capture-'));
  try {
    const manifest = { pageId: 42, modules: [{ key: 'menu', sourceSelector: check.selector, targetSelector: check.selector }], disclosureChecks: [check] } as unknown as Native44CompareManifest;
    const captured = await captureNative44Role(page, 'target', manifest, path.join(directory, 'target.png'), 'desktop-wide');
    assert.equal(captured.disclosureChecks?.length, 1); assert.equal(captured.disclosureChecks![0].status, 'passed', captured.disclosureChecks![0].problems.join('; ')); assert.ok(captured.renderPreparation!.stagesMs!.disclosureChecks >= 0); assert.equal(captured.disclosureChecks![0].restored!.expanded, false); assert.equal(await page.locator('.disclosure').getAttribute('open'), null); assert.match(captured.sha256, /^[a-f0-9]{64}$/);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

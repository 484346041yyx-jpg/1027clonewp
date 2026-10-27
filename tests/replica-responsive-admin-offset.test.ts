import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { adaptiveHeaderCSS, adaptiveHeaderEnvironmentCSS } from '../src/replica-responsive/header.js';
import { compileHeaderModuleStyles } from '../src/woodmart-header/generic/styles.js';
import { compileBundleStyles } from '../src/woodmart-header/generic/service.js';

const headerId = 'header_admin_offset';
const plan = (): any => ({
  moduleKey: 'admin-offset',
  style: { css: ':header{color:#111}', fonts: [] },
  layout: { rows: [], mobile: { version: 2, tablet: 'desktop', mobileMaxWidth: 768, css: '', rows: [{ slot: 'general-header', params: { mobile_height: 80 }, columns: { left: [], center: [], right: [] } }], scroll: { flow: 'reserve-space', implementation: 'scoped-css', views: [{ width: 390, height: 844, policy: 'fixed', offset: 0 }, { width: 430, height: 932, policy: 'fixed', offset: 0 }] } } },
});

test('fixed mobile header uses a real admin bar, not a stale WordPress height variable', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const candidate = plan();
    const css = compileHeaderModuleStyles({ css: adaptiveHeaderCSS(candidate), fonts: [] }, { moduleKey: candidate.moduleKey, headerId }).css + adaptiveHeaderEnvironmentCSS(candidate, headerId);
    for (const width of [390, 430]) for (const state of ['visitor', 'editor', 'stale-admin-class', 'admin-bar']) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      try {
        const bodyClass = state === 'editor' ? 'elementor-editor-active' : state.includes('admin') ? 'admin-bar' : '';
        const bar = state === 'admin-bar' ? '<div id="wpadminbar"></div>' : '';
        await page.setContent(`<!doctype html><html style="--wp-admin--admin-bar--height:46px"><head><style>html,body{margin:0}#wpadminbar{height:46px;background:#222}.whb-main-header{height:80px;background:white}.wd-fs-menu{position:fixed}.content{height:4000px}</style><style>${css}</style></head><body class="${bodyClass}">${bar}<header class="whb-${headerId}"><div class="whb-main-header">Header</div></header><div class="wd-fs-menu"></div><main class="content">Content</main></body></html>`);
        await page.evaluate(() => scrollTo(0, 1600));
        const measured = await page.evaluate(() => ({ scrollY, top: document.querySelector('.whb-main-header')!.getBoundingClientRect().top, panelTop: getComputedStyle(document.querySelector('.wd-fs-menu')!).top }));
        assert.ok(measured.scrollY >= 800, `${state} must actually scroll`);
        const expected = state === 'admin-bar' ? 46 : 0;
        assert.equal(measured.top, expected, `${state} header at ${width}px`);
        assert.equal(measured.panelTop, `${expected}px`, `${state} panel at ${width}px`);
        await page.close();
      } finally { if (!page.isClosed()) await page.close(); }
    }
  } finally { await browser.close(); }
});

test('effective offset is emitted with the owned header even without a rich menu or a bound page', () => {
  const candidate = plan();
  const identity = { moduleKey: candidate.moduleKey, headerId, targetOrigin: 'https://target.example', owner: { ownerId: 'clonewp', runId: 'admin-offset-run' } };
  const css = compileBundleStyles({ plan: candidate, state: { identity } } as any);
  assert.match(css, /body:has\(\.whb-header_admin_offset\)\{--clonewp-header-admin-offset:0px\}/);
  assert.match(css, /body\.admin-bar:has\(#wpadminbar\):has\(\.whb-header_admin_offset\)/);
  assert.doesNotMatch(css, /body\.page-id-/);
  candidate.layout.mobile.scroll.views.forEach((view: any) => { view.policy = 'static'; });
  assert.equal(adaptiveHeaderEnvironmentCSS(candidate, headerId), '');
});

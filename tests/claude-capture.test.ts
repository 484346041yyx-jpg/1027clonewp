import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext } from 'playwright';
import { geometryHashFromRows, observeWithClaudeBrowser } from '../src/claude-capture/observe.js';
import { observePhonesWithClaudeBrowser } from '../src/claude-capture/phones.js';
import { native44ObservedGeometryHash, readNative44BrowserObservation } from '../src/native44/source.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';

const url = 'https://8.8.8.8/';
const regions = [
  { id: 'header', selector: '#top', role: 'header' as const },
  { id: 'body-1', selector: '#one' }, { id: 'body-2', selector: '#two' },
  { id: 'footer', selector: '#bottom', role: 'footer' as const },
];
const page = (scrollHeader: boolean) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Claude capture fixture</title><style>
body{margin:0;font:16px/1.5 Arial,sans-serif;color:#222} #top{height:80px;background:#fc0;display:flex;align-items:center;padding:0 24px} #top.fixed{position:fixed;top:0;left:0;right:0;z-index:9}
section{height:700px;padding:40px 24px;box-sizing:border-box} #one{background:#eef} #two{background:#efe} #bottom{height:200px;background:#333;color:#fff;padding:24px}
a.card{display:inline-block;padding:12px 20px;background:#06c;color:#fff;text-decoration:none} a.card:hover{background:#c60} .pop{position:absolute;top:0;visibility:hidden;opacity:0;height:calc(100vh - 100px);width:120px}
</style></head><body><div id="wrap"><header id="top">Fixture header</header></div>
<section id="one"><h1>Fixture one</h1><p>Plain visible source copy for the first block.</p><a class="card" href="/next">Hover card</a><div class="pop">Hidden popup</div></section>
<section id="two"><h2>Fixture two</h2><p>More visible copy that must stay in the capture.</p></section><footer id="bottom">Footer text</footer>
${scrollHeader ? `<script>const bar=document.getElementById('top'),wrap=document.getElementById('wrap');wrap.style.height='80px';addEventListener('scroll',()=>{bar.classList.toggle('fixed',scrollY>40);wrap.style.height=scrollY>40?'0px':'80px'});</script>` : ''}</body></html>`;
const routes = (scroll: boolean) => async (context: BrowserContext) => { await context.route('https://8.8.8.8/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page(scroll) })); };

test('live geometry rows hash with exactly the observed-packet formula', () => {
  const rect = { x: 0, y: 0, width: 100, height: 20 }, base = { id: 'n', parentId: null, regionId: 'r', tag: 'div', selector: '#n', attributes: {}, childIds: [], styleId: 's', layoutId: 'l', visible: true };
  const packet = { version: 2, kind: 'observation-packet', snapshot: { id: 'x', url, title: 't', capturedAt: '2026-10-24T00:00:00.000Z', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1905, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: 1080, screenshot: { path: 'x.png', sha256: '0'.repeat(64), width: 1905, height: 1080 } }, nodes: { 'r-n1': { ...base, id: 'r-n1' } }, regions: [{ id: 'r', nodeId: 'r-n1', role: 'region', order: 0, contentNodeId: 'r-n1', gapBefore: 0 }], texts: {}, styles: { s: { display: 'block', visibility: 'visible', opacity: '1' } }, layouts: { l: { id: 'l', rect, contentRect: rect, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: 0 } }, resources: {}, usages: {}, interactions: {}, gaps: [], commerceEvidence: { version: 1, productUrls: [] } } as unknown as ObservationPacketV2;
  validateObservationPacketV2(packet);
  assert.equal(geometryHashFromRows([['r-n1', 0, 0, 100, 20, 0, 0, 100, 20, 'block', 'static']]), native44ObservedGeometryHash([packet], 'x'));
});

test('Claude browser capture imports through the unchanged v3 contract in segment and expanded modes, plus phone sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-claude-capture-'));
  try {
    const stableDir = path.join(root, 'stable');
    await observeWithClaudeBrowser({ url, outDir: stableDir, prefix: 'fix', regions, autoplayWatchMs: 0, routes: routes(false) });
    const stable = await readNative44BrowserObservation(stableDir, url);
    assert.equal(stable?.version, 3); assert.equal(stable?.browserObservation.tool, 'claude_browser'); assert.equal(stable?.browserObservation.method, 'agent-opened-browser');
    assert.deepEqual(stable?.browserObservation.captures.map(item => item.captureMode), ['viewport-segments', 'viewport-segments']);
    const manifest = JSON.parse(await readFile(path.join(stableDir, 'observation-manifest.json'), 'utf8'));
    assert.equal(manifest.provenance.observer, 'claude_browser'); assert.notEqual(manifest.provenance.observer, 'cua_repl');

    const stickyDir = path.join(root, 'sticky');
    await observeWithClaudeBrowser({ url, outDir: stickyDir, prefix: 'fix', regions, autoplayWatchMs: 0, routes: routes(true) });
    const sticky = await readNative44BrowserObservation(stickyDir, url);
    assert.deepEqual(sticky?.browserObservation.captures.map(item => item.captureMode), ['equivalent-expanded-viewport', 'equivalent-expanded-viewport']);

    const phones = await observePhonesWithClaudeBrowser({ url, outDir: stableDir, prefix: 'fix', taskId: 'fixture-task', regions, routes: routes(false) });
    assert.deepEqual(phones.snapshots.map(item => item.width), [390, 430]);
    const source = JSON.parse(await readFile(phones.sourcePath, 'utf8'));
    assert.equal(source.kind, 'clonewp-responsive-source'); assert.equal(source.taskId, 'fixture-task'); assert.equal(source.packets.length, regions.length * 2);
    const first = validateObservationPacketV2(JSON.parse(await readFile(path.join(stableDir, source.packets[0].path), 'utf8')));
    assert.equal(first.snapshot.viewport.width, 390); assert.equal(first.snapshot.viewport.name, 'mobile-390');
  } finally { await rm(root, { recursive: true, force: true }); }
});

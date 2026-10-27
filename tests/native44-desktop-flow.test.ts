import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { DESKTOP_BROWSER_PROFILE, native44ProfileViewports, assertNative44ProfileIdentity } from '../src/native44/profile.js';
import { NATIVE44_BROWSER_OBSERVATION_FILE, prepareNative44Reference, prepareObservedNative44Reference, native44ObservedGeometryHash, validateNative44BrowserObservation, verifyNative44BrowserSegmentPixels, type Native44BrowserObservation } from '../src/native44/source.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { observationCountsV2, readObservationDirectoryV2, sha256, type ObservationManifestV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { loadNative44SourceCaptures, prepareNative44SourceCaptures } from '../src/native44/source-captures.js';
import { compareNative44Run, recordNative44CSSReview, validateNative44CompareManifest, fingerprintNative44Snapshot, type Native44CompareManifest } from '../src/native44/compare.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { buildNative44PageCSS, assertNative44DesktopCSS } from '../src/native44/css-handoff.js';
import { copySystemReleaseFixture } from './fixtures/system-release.js';

const sourceUrl = 'https://8.8.8.8/', at = '2026-10-16T00:00:00.000Z';
const save = async (filename: string, value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); await writeFile(filename, bytes); return { path: filename, sha256: sha256(bytes) }; };
async function fixture(directory: string, missingMedia = false) {
  const manifest: ObservationManifestV2 = { version: 2, kind: 'observation-manifest', sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] };
  const captures: Native44BrowserObservation['browserObservation']['captures'] = [];
  for (const view of native44ProfileViewports(DESKTOP_BROWSER_PROFILE)) {
    const png = `${view.name}.png`, bytes = await sharp({ create: { width: view.width, height: view.height, channels: 3, background: '#123456' } }).png().toBuffer(); await writeFile(path.join(directory, png), bytes);
    const rect = { x: 0, y: 0, width: view.width, height: view.height }, viewport = { name: view.width === 1920 ? 'desktop' : 'desktop-narrow', width: view.width, height: view.height, clientWidth: view.width, scrollbarWidth: 0, devicePixelRatio: 1 };
    const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: view.name, url: sourceUrl, title: 'Normal source homepage', capturedAt: at, viewport, pageHeight: view.height, screenshot: { path: png, sha256: sha256(bytes), width: view.width, height: view.height } }, nodes: { root: { id: 'root', parentId: null, regionId: 'hero', tag: 'section', selector: '#hero', attributes: {}, childIds: [], styleId: 'style', layoutId: 'layout', visible: true } }, regions: [{ id: 'hero', nodeId: 'root', role: 'hero', order: 0, contentNodeId: 'root', gapBefore: 0 }], texts: {}, styles: { style: { display: 'block', visibility: 'visible', opacity: '1' } }, layouts: { layout: { id: 'layout', rect, contentRect: rect, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 } }, resources: {}, usages: {}, interactions: {}, gaps: [] };
    packet.texts.title = { id: 'title', nodeId: 'root', regionId: 'hero', text: 'Normal homepage fixture with visible content and complete source ownership.', kind: 'body' }; packet.commerceEvidence = { version: 1, productUrls: [] };
    if (missingMedia) { packet.resources.photo = { id: 'photo', kind: 'image', url: 'https://8.8.8.8/photo.png' }; packet.usages.photo = { id: 'photo', nodeId: 'root', regionId: 'hero', resourceId: 'photo', kind: 'img', visible: true }; }
    const reference = await save(path.join(directory, `${view.name}.json`), packet); manifest.packets.push({ ...reference, path: path.basename(reference.path), snapshotId: view.name, regionIds: ['hero'], counts: observationCountsV2(packet), dependencies: [] }); manifest.screenshots.push({ path: png, sha256: sha256(bytes), snapshotId: view.name });
    const { name: _name, ...dimensions } = viewport, geometry = { url: sourceUrl, viewport: dimensions, scrollX: 0, scrollY: 0, pageHeight: view.height, geometryHash: native44ObservedGeometryHash([packet], packet.snapshot.id) };
    captures.push({ snapshotId: view.name, packetHashes: [reference.sha256], screenshotHash: sha256(bytes), captureMode: 'full-page-stable', before: geometry, after: structuredClone(geometry) });
    const scene = await save(path.join(directory, `${view.name}-scene.json`), { version: 2, kind: 'scene-inventory', snapshotId: packet.snapshot.id, sourceUrl, capturedAt: at, viewport: { name: viewport.name, width: view.width, height: view.height }, regions: [{ id: 'hero', selector: '#hero' }], entries: { title: { id: 'title', selector: '#hero', ownerRegionId: 'hero', kind: 'text', label: packet.texts.title.text, rect } }, counts: { total: 1, text: 1, media: 0, control: 0, assigned: 1, unassigned: 0, vendorUtilities: 0 } });
    (manifest.sceneInventories ??= []).push({ ...scene, path: path.basename(scene.path), snapshotId: packet.snapshot.id });
  }
  await save(path.join(directory, 'observation-manifest.json'), manifest);
  const observation = await readObservationDirectoryV2(directory, sourceUrl);
  const binding: Native44BrowserObservation = { version: 2, replicationProfile: DESKTOP_BROWSER_PROFILE, renderEvidenceBySnapshot: {}, browserObservation: { method: 'user-opened-browser', tool: 'cua_repl', browserId: 'connected-chrome', tabId: 'exact-user-tab', requestedUrl: sourceUrl, actualUrl: sourceUrl, observedAt: at, captures } };
  const facts = await save(path.join(directory, 'source-facts.json'), buildSourceFactsV2(observation));
  const plan = await save(path.join(directory, 'component-plan.json'), { replicationProfile: DESKTOP_BROWSER_PROFILE, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, sourceFacts: facts, components: [{ id: 'hero', variants: captures.map(capture => ({ snapshotId: capture.snapshotId, nodeIds: ['root'], visible: true })) }] });
  const collection = await save(path.join(directory, 'collection.json'), { ...binding, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: 'desktop-task', sourceUrl, collectionStartedAt: at });
  const renderEvidenceBySnapshot: Record<string, { path: string; sha256: string }> = {};
  for (const packet of observation.packets) renderEvidenceBySnapshot[packet.snapshot.id] = await save(path.join(directory, `${packet.snapshot.id}-render.json`), { version: 1, taskId: 'desktop-task', snapshotId: packet.snapshot.id, sourceUrl, capturedAt: at, screenshotHash: packet.snapshot.screenshot.sha256, viewport: { width: packet.snapshot.viewport.width, height: packet.snapshot.viewport.height, clientWidth: packet.snapshot.viewport.clientWidth, devicePixelRatio: 1 }, fontsReady: true, media: [], states: [] });
  binding.renderEvidenceBySnapshot = renderEvidenceBySnapshot; Object.assign(collection, await save(collection.path, { ...binding, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: 'desktop-task', sourceUrl, collectionStartedAt: at }));
  return { binding, observation, options: { replicationProfile: DESKTOP_BROWSER_PROFILE, collection, taskId: 'desktop-task', sourceUrl, collectionStartedAt: at, sourceFacts: facts, componentPlan: plan, renderEvidenceBySnapshot } };
}

test('profile identity preserves historical four widths and freezes new exact desktop dimensions', () => {
  assert.equal(native44ProfileViewports().length, 4);
  assert.deepEqual(native44ProfileViewports(DESKTOP_BROWSER_PROFILE).map(({ name, width, height, stage }) => [name, width, height, stage]), [['desktop-wide', 1920, 1080, 'desktop'], ['desktop-narrow', 1440, 1000, 'desktop']]);
  assert.throws(() => native44ProfileViewports('future'), /Unknown/);
  assert.throws(() => assertNative44ProfileIdentity(undefined, DESKTOP_BROWSER_PROFILE), /identity differs/);
});

test('new observed import owns relocated browser packets and segment bytes without target configuration or network', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-import-'));
  try {
    const observed = path.join(directory, 'observed'); await mkdir(observed); await mkdir(path.join(directory, 'data', 'native44'), { recursive: true });
    await copyFile(path.resolve(import.meta.dirname, '../data/native44/index.json'), path.join(directory, 'data', 'native44', 'index.json'));
    await copySystemReleaseFixture(directory);
    const { binding, observation } = await fixture(observed), snapshot = observation.packets[0].snapshot, capture = binding.browserObservation.captures[0];
    for (const reference of Object.values(binding.renderEvidenceBySnapshot)) { const raw = JSON.parse(await readFile(reference.path, 'utf8')); delete raw.taskId; Object.assign(reference, await save(reference.path, raw)); }
    capture.captureMode = 'viewport-segments'; capture.segments = [{ screenshot: { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 }, documentTop: 0, documentHeight: snapshot.pageHeight, cropTop: 0, before: structuredClone(capture.before), after: structuredClone(capture.after) }];
    await save(path.join(observed, NATIVE44_BROWSER_OBSERVATION_FILE), binding);
    const job = await prepareObservedNative44Reference(sourceUrl, observed, { root: directory });
    assert.equal(job.status, 'awaiting-component-plan'); assert.equal(job.replicationProfile, DESKTOP_BROWSER_PROFILE); assert.equal(job.selectionRulesHash, NATIVE44_SELECTION_RULES_HASH);
    assert.equal(job.editorNaming,'native-translated-v1');assert.equal(job.reviewWorkflow,'whole-page-after-css-v1');
    const taskMarker=JSON.parse(await readFile(path.join(job.jobDir,'job.json'),'utf8'));assert.equal(taskMarker.editorNaming,job.editorNaming);assert.equal(taskMarker.reviewWorkflow,job.reviewWorkflow);
    const collection = JSON.parse(await readFile(job.sourceCollection!.path, 'utf8')), imported = await readObservationDirectoryV2(path.dirname(job.observationPath), sourceUrl);
    validateNative44BrowserObservation({ version: collection.version, replicationProfile: collection.replicationProfile, browserObservation: collection.browserObservation, renderEvidenceBySnapshot: collection.renderEvidenceBySnapshot }, imported, sourceUrl);
    await verifyNative44BrowserSegmentPixels(collection, path.dirname(job.observationPath), imported);
    for (const reference of Object.values(job.sourceRenderEvidenceBySnapshot!)) { const derived = JSON.parse(await readFile(reference.path, 'utf8')); assert.equal(derived.taskId, job.jobId); const original = JSON.parse(await readFile(path.resolve(path.dirname(reference.path), derived.originalEvidence.path), 'utf8')); assert.equal(original.taskId, undefined); }
    assert.equal(collection.browserObservation.tabId, binding.browserObservation.tabId); assert.notEqual(collection.browserObservation.captures[0].packetHashes[0], binding.browserObservation.captures[0].packetHashes[0]);
    await writeFile(path.join(observed, snapshot.screenshot.path), Buffer.from('changed original input'));
    await verifyNative44BrowserSegmentPixels(collection, path.dirname(job.observationPath), imported);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('desktop source rendering gaps fail before authentication rather than after draft generation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-render-gaps-'));
  try {
    const { options } = await fixture(directory, true);
    await assert.rejects(() => prepareNative44SourceCaptures(options), /rendering is incomplete or unverified before writing/);
    const reference = Object.values(options.renderEvidenceBySnapshot)[0], raw = JSON.parse(await readFile(reference.path, 'utf8')); raw.fontsReady = false; Object.assign(reference, await save(reference.path, raw));
    const collection = JSON.parse(await readFile(options.collection.path, 'utf8')); collection.renderEvidenceBySnapshot = options.renderEvidenceBySnapshot; Object.assign(options.collection, await save(options.collection.path, collection));
    await assert.rejects(() => prepareNative44SourceCaptures(options), /font readiness/);
    raw.fontsReady = true; Object.assign(reference, await save(reference.path, raw)); collection.renderEvidenceBySnapshot = options.renderEvidenceBySnapshot; Object.assign(options.collection, await save(options.collection.path, collection));
    const noRender = { ...options, renderEvidenceBySnapshot: {} };
    await assert.rejects(() => prepareNative44SourceCaptures(noRender), /render evidence binding/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('expanded viewport evidence verifies actual pixels and survives immutable observed import', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-expanded-import-'));
  try {
    const observed = path.join(directory,'observed'); await mkdir(observed); await mkdir(path.join(directory,'data','native44'),{recursive:true});
    await copyFile(path.resolve(import.meta.dirname,'../data/native44/index.json'),path.join(directory,'data','native44','index.json')); await copySystemReleaseFixture(directory);
    const {binding,observation}=await fixture(observed);
    for(const [index,capture] of binding.browserObservation.captures.entries()) {
      const packet=structuredClone(observation.packets[index]); packet.snapshot.id+='-auxiliary';
      const reference=await save(path.join(observed,`expanded-${index}.json`),packet);
      capture.captureMode='equivalent-expanded-viewport';
      capture.expandedCapture={before:structuredClone(capture.before),after:structuredClone(capture.after),packets:[{...reference,path:path.basename(reference.path)}]};
      if(index===1)capture.expandedCapture.frames=[{screenshot:{path:packet.snapshot.screenshot.path,sha256:packet.snapshot.screenshot.sha256},before:structuredClone(capture.before),after:structuredClone(capture.after),contentHeight:packet.snapshot.viewport.height,documentTop:0,documentHeight:packet.snapshot.pageHeight,cropTop:0,packets:[{...reference,path:path.basename(reference.path)}]}];
    }
    validateNative44BrowserObservation(binding,observation,sourceUrl); await verifyNative44BrowserSegmentPixels(binding,observed,observation);
    const invalid=structuredClone(binding); invalid.browserObservation.captures[0].expandedCapture!.before.viewport.width--;
    assert.throws(()=>validateNative44BrowserObservation(invalid,observation,sourceUrl),/stable auxiliary/);
    for(const reference of Object.values(binding.renderEvidenceBySnapshot)){const value=JSON.parse(await readFile(reference.path,'utf8'));delete value.taskId;Object.assign(reference,await save(reference.path,value));}
    await save(path.join(observed,NATIVE44_BROWSER_OBSERVATION_FILE),binding);
    const job=await prepareObservedNative44Reference(sourceUrl,observed,{root:directory});
    const collection=JSON.parse(await readFile(job.sourceCollection!.path,'utf8')), imported=await readObservationDirectoryV2(path.dirname(job.observationPath),sourceUrl);
    validateNative44BrowserObservation({version:collection.version,replicationProfile:collection.replicationProfile,browserObservation:collection.browserObservation,renderEvidenceBySnapshot:collection.renderEvidenceBySnapshot},imported,sourceUrl);
    await verifyNative44BrowserSegmentPixels(collection,path.dirname(job.observationPath),imported);
    const changed=structuredClone(binding); changed.browserObservation.captures[0].expandedCapture!.packets[0].sha256='0'.repeat(64);
    await assert.rejects(()=>verifyNative44BrowserSegmentPixels(changed,observed,observation),/hash changed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('bare URL waits for user-browser evidence without launching or requesting source/target', async () => {
  const root = path.resolve(import.meta.dirname, '..'), originalLaunch = chromium.launch, originalFetch = globalThis.fetch; let launches = 0, requests = 0;
  chromium.launch = async () => { launches++; throw Error('Browser must not launch'); };
  globalThis.fetch = async () => { requests++; throw Error('Network must not run'); };
  try {
    // An unresolvable host also proves that intake performs no DNS lookup.
    const result = await prepareNative44Reference('https://user-preopened-source.invalid/', { root, capture: async () => { throw Error('Historical capture must not run'); } });
    assert.equal(result.status, 'awaiting-browser-observation'); assert.equal(result.replicationProfile, DESKTOP_BROWSER_PROFILE); assert.equal(result.goalProfile, 'component-reference-v1'); assert.equal(result.requiredViewports.length, 2); assert.equal(launches, 0); assert.equal(requests, 0);
    assert.equal(result.editorNaming,'native-translated-v1');assert.equal(result.reviewWorkflow,'whole-page-after-css-v1');
  } finally { chromium.launch = originalLaunch; globalThis.fetch = originalFetch; }
});

test('user tab evidence binds actual entities, pixels, URL, two desktop geometries and capture stability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-source-'));
  try {
    const { binding, observation, options } = await fixture(directory);
    assert.equal(validateNative44BrowserObservation(binding, observation, sourceUrl).browserObservation.tabId, 'exact-user-tab');
    const set = await prepareNative44SourceCaptures(options); assert.equal(set.version, 2); assert.equal(set.viewports.length, 2); await loadNative44SourceCaptures(set, options);
    await assert.rejects(() => loadNative44SourceCaptures(set, { taskId: options.taskId, sourceUrl }), /identity differs/);
    for (const mutate of [
      (value: Native44BrowserObservation) => { value.browserObservation.actualUrl = 'https://other.invalid/'; },
      (value: Native44BrowserObservation) => { value.browserObservation.captures[0].packetHashes = ['0'.repeat(64)]; },
      (value: Native44BrowserObservation) => { value.browserObservation.captures[0].after.viewport.clientWidth--; },
      (value: Native44BrowserObservation) => { value.browserObservation.captures[0].after.geometryHash = '0'.repeat(64); },
      (value: Native44BrowserObservation) => { value.browserObservation.captures[0].snapshotId = 'mobile'; },
    ]) { const changed = structuredClone(binding); mutate(changed); assert.throws(() => validateNative44BrowserObservation(changed, observation, sourceUrl)); }
    assert.throws(() => validateNative44BrowserObservation({ version: 2, replicationProfile: DESKTOP_BROWSER_PROFILE, browserObservation: { method: 'user-opened-browser' } }, observation, sourceUrl), /Invalid/);
    for (const content of ['Press and hold to confirm you are human. Complete verification to continue.', 'Are you 21 years of age? Please verify your age before entering this website.']) {
      const blocked = structuredClone(observation); blocked.packets[0].texts.title.text = content;
      assert.throws(() => validateNative44BrowserObservation(binding, blocked, sourceUrl), /verification/);
    }
    const overlay = structuredClone(observation); overlay.packets[0].texts.title.text = `${'Normal brand content. '.repeat(40)} Are you over 21?`; overlay.packets[0].nodes.root.attributes['aria-modal'] = 'true';
    assert.throws(() => validateNative44BrowserObservation(binding, overlay, sourceUrl), /verification overlay/);
    const ordinary = structuredClone(observation); ordinary.packets[0].texts.title.text = 'Products are for adults only. Not for sale to anyone under 21. Check product age recommendations.'; assert.doesNotThrow(() => validateNative44BrowserObservation(binding, ordinary, sourceUrl));
    const gap = structuredClone(observation); gap.packets[0].gaps.push({ code: 'age-verification-required', message: 'User must complete age confirmation' }); assert.throws(() => validateNative44BrowserObservation(binding, gap, sourceUrl), /obstructed/);
    const segmented = structuredClone(binding), capture = segmented.browserObservation.captures[0], snapshot = observation.packets[0].snapshot;
    capture.captureMode = 'viewport-segments'; capture.segments = [{ screenshot: { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 }, documentTop: 0, documentHeight: snapshot.pageHeight, cropTop: 0, before: structuredClone(capture.before), after: structuredClone(capture.after) }];
    validateNative44BrowserObservation(segmented, observation, sourceUrl); await verifyNative44BrowserSegmentPixels(segmented, directory, observation);
    const split = 300, full = await readFile(path.join(directory, snapshot.screenshot.path));
    const top = await sharp(full).extract({ left: 0, top: 0, width: snapshot.viewport.width, height: split }).png().toBuffer();
    const bottom = await sharp(full).extract({ left: 0, top: split, width: snapshot.viewport.width, height: snapshot.pageHeight - split }).png().toBuffer();
    await writeFile(path.join(directory, 'top-strip.png'), top); await writeFile(path.join(directory, 'bottom-strip.png'), bottom);
    const strips = structuredClone(segmented), stripCapture = strips.browserObservation.captures[0];
    stripCapture.segments = [
      { screenshot: { path: 'top-strip.png', sha256: sha256(top) }, screenshotTop: 0, documentTop: 0, documentHeight: split, cropTop: 0, before: structuredClone(capture.before), after: structuredClone(capture.after) },
      { screenshot: { path: 'bottom-strip.png', sha256: sha256(bottom) }, screenshotTop: split, documentTop: split, documentHeight: snapshot.pageHeight - split, cropTop: 0, before: structuredClone(capture.before), after: structuredClone(capture.after) },
    ];
    validateNative44BrowserObservation(strips, observation, sourceUrl); await verifyNative44BrowserSegmentPixels(strips, directory, observation);
    stripCapture.segments[1].screenshotTop = split + 1;
    assert.throws(() => validateNative44BrowserObservation(strips, observation, sourceUrl), /incomplete actual coverage/);
    capture.segments[0].screenshot.sha256 = '0'.repeat(64); await assert.rejects(() => verifyNative44BrowserSegmentPixels(segmented, directory, observation), /hash changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new comparison rejects missing/extra/wrong desktop geometry and mobile CSS while historical CSS stays accepted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-compare-'));
  try {
    const { options } = await fixture(directory), sourceCaptures = await prepareNative44SourceCaptures(options), frozen = fingerprintNative44Snapshot({ hash: '2'.repeat(64), elements: [], settings: {} });
    const manifest: Native44CompareManifest = { ...frozen, version: 1, strategy: 'native44-css-handoff', replicationProfile: DESKTOP_BROWSER_PROFILE, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: options.taskId, runId: 'desktop-run', pageId: 42, sourceUrl, targetUrl: 'https://target.invalid/', widgetTypes: ['heading'], canvasCss: '', modules: [{ key: 'hero', className: 'cwp-hero', sourceSelector: '#hero', targetSelector: '.elementor-42 .cwp-hero', required: true }], cssRules: [], sourceCaptures };
    validateNative44CompareManifest(manifest);
    for (const viewports of [native44ProfileViewports(), native44ProfileViewports(DESKTOP_BROWSER_PROFILE).slice(0, 1), native44ProfileViewports(DESKTOP_BROWSER_PROFILE).map(view => ({ ...view, height: 844 }))]) assert.throws(() => validateNative44CompareManifest({ ...manifest, viewports }), /requires/);
    assert.throws(() => validateNative44CompareManifest({ ...manifest, sourceCaptures: undefined }), /user-tab/);
    const rule = { moduleKey: 'hero', declarations: { gap: '20px' }, media: '(max-width: 768px)', reason: 'Measured gap', evidence: ['measurement'] };
    assert.throws(() => buildNative44PageCSS({ replicationProfile: DESKTOP_BROWSER_PROFILE, pageId: 42, modules: manifest.modules, canvasCss: '', rules: [rule] }), /mobile\/tablet/);
    assert.doesNotThrow(() => buildNative44PageCSS({ pageId: 42, modules: manifest.modules, canvasCss: '', rules: [rule] }));
    for (const condition of ['(width < 900px)', '(390px <= width <= 1024px)', '(max-width: 64em)', '(orientation: portrait)']) assert.throws(() => assertNative44DesktopCSS(`@media ${condition}{.x{gap:1px}}`, DESKTOP_BROWSER_PROFILE), /mobile\/tablet/);
    assert.doesNotThrow(() => assertNative44DesktopCSS('@media (max-width:1440px){.x{gap:1px}}', DESKTOP_BROWSER_PROFILE));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('desktop read-only comparison captures only two widths, requires visual review and reuses bound screenshots/receipts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-e2e-')), browser = await chromium.launch({ headless: true });
  try {
    const { options } = await fixture(directory), sourceCaptures = await prepareNative44SourceCaptures(options), loaded = await loadNative44SourceCaptures(sourceCaptures, options), frozen = fingerprintNative44Snapshot({ hash: '2'.repeat(64), elements: [], settings: {} });
    const manifest: Native44CompareManifest = { ...frozen, version: 1, strategy: 'native44-css-handoff', replicationProfile: DESKTOP_BROWSER_PROFILE, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: options.taskId, runId: 'desktop-run', pageId: 42, sourceUrl, targetUrl: 'https://target.invalid/', widgetTypes: ['heading'], canvasCss: '', modules: [{ key: 'hero', className: 'cwp-hero', sourceSelector: '#hero', targetSelector: '.elementor-42 .cwp-hero', required: true }], cssRules: [], sourceCaptures };
    await save(path.join(directory, 'compare-manifest.json'), manifest);
    let sourceOpens = 0, targetOpens = 0, reads = 0;
    const dependencies = { sourceCaptures: loaded, readSnapshot: async () => { reads++; return frozen; }, openPage: async (_url: string, role: 'source' | 'target') => { if (role === 'source') { sourceOpens++; throw Error('No source navigation is permitted'); } targetOpens++; const page = await browser.newPage(); await page.setContent('<style>body{margin:0}.cwp-hero{width:100%;height:100vh;background:#123456}</style><main class="elementor-42"><section class="cwp-hero"></section></main>'); return page; } };
    const first = await compareNative44Run(directory, dependencies);
    assert.equal(first.captures.length, 2); assert.equal(first.metrics.documentWrites, 0); assert.equal(first.metrics.editorSessions, 0); assert.equal(first.metrics.viewportScreenshotFrames, 2); assert.equal(sourceOpens, 0); assert.equal(targetOpens, 1); assert.equal(reads, 2); assert.equal(first.deliveryComplete, false); assert.ok(first.gaps.some(gap => /Codex visual review/.test(gap.detail)));
    await recordNative44CSSReview(directory, { documentHash: frozen.documentHash, parentAttribution: 'Fixture root layout dimensions match', notes: 'Synthetic local raster fixture used only for profile and review binding regression.', rules: [], noCorrectionReason: 'Synthetic source and target module dimensions match at both desktop widths.' });
    const withoutVisual = await compareNative44Run(directory, dependencies); assert.equal(withoutVisual.deliveryComplete, false); assert.equal(withoutVisual.metrics.screenshots, 0); assert.equal(targetOpens, 1);
    const reviews = first.captures.map(capture => ({ viewport: capture.viewport, sourceScreenshotHash: capture.source.sha256, targetScreenshotHash: capture.target.sha256, documentHash: frozen.documentHash, verdict: 'passed' as const, observedAt: at, notes: 'Synthetic fixture review record tests exact hash binding; no production visual judgement is claimed.' }));
    const failed = await compareNative44Run(directory, dependencies, { reviews: reviews.map(review => ({ ...review, verdict: 'failed' as const })) }); assert.equal(failed.deliveryComplete, false); assert.ok(failed.gaps.some(gap => /visual review failed/.test(gap.detail)));
    const delivered = await compareNative44Run(directory, dependencies, { reviews }); assert.equal(delivered.deliveryComplete, true); assert.equal(delivered.comparisonReview, 'passed'); assert.equal(delivered.visualVerification, 'awaiting-user-css'); assert.equal(delivered.metrics.screenshots, 0); assert.equal(targetOpens, 1);
    const receipt = delivered.captures[0].target.screenshotEvidence!.receipt.path; await writeFile(receipt, '{}');
    await assert.rejects(() => recordNative44CSSReview(directory, { documentHash: frozen.documentHash, parentAttribution: 'Frozen fixture', notes: 'Changed receipt must be rejected', rules: [], noCorrectionReason: 'Test' }), /receipt hash changed/);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

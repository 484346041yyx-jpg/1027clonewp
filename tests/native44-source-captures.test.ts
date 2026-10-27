import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import type { ObservationPacketV2, ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import { loadNative44SourceCaptures, prepareNative44JobSourceCaptures, prepareNative44SourceCaptures, readNative44SourceCapture, type Native44SourceRenderEvidence } from '../src/native44/source-captures.js';
import { compareNative44Run, fingerprintNative44Snapshot, NATIVE44_COMPARE_VIEWPORTS, type Native44CompareManifest } from '../src/native44/compare.js';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(directory: string, rendering = true, background = false, carouselFrame?: number) {
  const packets: ObservationPacketV2[] = [], files: ValidatedObservationV2['packetFiles'] = [], renderEvidenceBySnapshot: Record<string, { path: string; sha256: string }> = {};
  for (const viewport of NATIVE44_COMPARE_VIEWPORTS) {
    const id = `current-${viewport.width}`, root = `root-${viewport.width}`, image = `image-${viewport.width}`;
    const raster = sharp({ create: { width: viewport.width, height: viewport.height, channels: 3, background: '#cc3333' } });
    if (carouselFrame !== undefined) raster.composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="5" y="30" font-size="24" fill="white">${carouselFrame + 1}/6</text></svg>`), top: 0, left: 0 }]);
    const png = await raster.png().toBuffer(), screenshot = path.join(directory, `${id}.png`); await writeFile(screenshot, png);
    const layout = { id: 'layout', rect: { x: 0, y: 0, width: viewport.width, height: 100 }, contentRect: { x: 0, y: 0, width: viewport.width, height: 100 }, padding: [0, 0, 0, 0] as [number, number, number, number], margin: [0, 0, 0, 0] as [number, number, number, number], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'column', flowIndex: 0 };
    const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id, url: 'https://source.test/', title: 'Normal source fixture', capturedAt: '2026-10-16T00:01:00.000Z', viewport: { ...viewport, name: viewport.width === 1920 ? 'desktop' : viewport.name, clientWidth: viewport.width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: viewport.height, screenshot: { path: screenshot, sha256: hash(png), width: viewport.width, height: viewport.height } }, nodes: { [root]: { id: root, parentId: null, regionId: 'region', tag: 'section', selector: '#actual-root', attributes: {}, childIds: [image], styleId: 'style', layoutId: 'layout', visible: true }, [image]: { id: image, parentId: root, regionId: 'region', tag: 'img', selector: '#actual-image', attributes: {}, childIds: [], styleId: 'style', layoutId: 'layout', visible: true } }, regions: [{ id: 'region', nodeId: root, contentNodeId: root, role: 'hero', order: 0, gapBefore: 0 }], texts: {}, styles: { style: { display: 'block', 'max-width': 'none', 'background-color': 'rgb(204,51,51)' } }, layouts: { layout }, resources: { photo: { id: 'photo', url: `https://source.test/${viewport.width}.png`, kind: 'image' }, inactive: { id: 'inactive', url: `https://source.test/inactive-${viewport.width}.png`, kind: 'image' } }, usages: { photo: { id: 'photo', nodeId: image, regionId: 'region', resourceId: 'photo', kind: 'img', visible: true }, inactive: { id: 'inactive', nodeId: image, regionId: 'region', resourceId: 'inactive', kind: 'picture', attribute: 'srcset', visible: true } }, interactions: {}, gaps: [] };
    if (background) packet.usages.background = { id: 'background', nodeId: root, regionId: 'region', resourceId: 'photo', kind: 'background', attribute: 'background-image', visible: true };
    if (carouselFrame !== undefined) {
      const track = `track-${viewport.width}`, items = Array.from({ length: 6 }, (_, index) => `slide-${viewport.width}-${index}`);
      packet.nodes[track] = { ...structuredClone(packet.nodes[root]), id: track, parentId: root, tag: 'div', selector: `#${track}`, childIds: items }; packet.nodes[root].childIds.push(track);
      for (const item of items) packet.nodes[item] = { ...structuredClone(packet.nodes[root]), id: item, parentId: track, tag: 'article', selector: `#${item}`, childIds: [] };
      packet.interactions.carousel = { id: 'carousel', nodeId: root, regionId: 'region', kind: 'carousel', status: 'observed', trackNodeId: track, itemNodeIds: items, details: {} };
    }
    const bytes = Buffer.from(JSON.stringify(packet)), filename = path.join(directory, `${id}.json`); await writeFile(filename, bytes); packets.push(packet); files.push({ path: filename, sha256: hash(bytes), snapshotId: id });
    if (rendering) {
      const evidence: Native44SourceRenderEvidence = { version: 1, taskId: 'new-task', snapshotId: id, sourceUrl: packet.snapshot.url, capturedAt: packet.snapshot.capturedAt, screenshotHash: packet.snapshot.screenshot.sha256, viewport: { width: viewport.width, height: viewport.height, clientWidth: viewport.width, devicePixelRatio: 1 }, fontsReady: true, media: [{ nodeId: image, url: packet.resources.photo.url, kind: 'image', decoded: true, drawable: true, naturalWidth: 100, naturalHeight: 100 }], states: [{ nodeId: root, carouselIndex: 0 }] };
      if (background) { evidence.observationMode = 'readonlyDOM'; evidence.media.push({ nodeId: root, url: packet.resources.photo.url, kind: 'background', decoded: null, drawable: null, naturalWidth: 0, naturalHeight: 0, painted: true, proof: 'browser-computed-background-paintability-only' }); }
      const renderBytes = Buffer.from(JSON.stringify(evidence)), renderPath = path.join(directory, `${id}-render.json`); await writeFile(renderPath, renderBytes); renderEvidenceBySnapshot[id] = { path: renderPath, sha256: hash(renderBytes) };
    }
  }
  const facts = buildSourceFactsV2({ packets, packetFiles: files, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'https://source.test/', provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, manifestPath: path.join(directory, 'observation.json'), manifestSha256: 'a'.repeat(64) });
  const factsPath = path.join(directory, 'source-facts.json'), factsBytes = Buffer.from(JSON.stringify(facts)); await writeFile(factsPath, factsBytes);
  const planPath = path.join(directory, 'component-plan.json'), planBytes = Buffer.from(JSON.stringify({ sourceFacts: { path: factsPath, sha256: hash(factsBytes) }, components: [{ id: 'hero', variants: packets.map(packet => ({ snapshotId: packet.snapshot.id, nodeIds: [packet.regions[0].nodeId], visible: true })) }] })); await writeFile(planPath, planBytes);
  const options = { taskId: 'new-task', sourceUrl: 'https://source.test/', collectionStartedAt: '2026-10-16T00:00:00.000Z', sourceFacts: { path: factsPath, sha256: hash(factsBytes) }, componentPlan: { path: planPath, sha256: hash(planBytes) }, renderEvidenceBySnapshot };
  return { options, packets, facts };
}

test('current-task source captures retain actual four viewport PNG hashes and explicit node variants without source navigation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-source-captures-')); const browser = await chromium.launch({ headless: true });
  try {
    const data = await fixture(directory), sourceCaptures = await prepareNative44SourceCaptures(data.options), loaded = await loadNative44SourceCaptures(sourceCaptures, data.options);
    const mobile = await readNative44SourceCapture(loaded, NATIVE44_COMPARE_VIEWPORTS[3], [{ key: 'hero' }], path.join(directory, 'copied-mobile.png'));
    assert.equal(mobile.modules[0].box!.width, 390); assert.equal(mobile.modules[0].media![0].drawable, true); assert.equal(mobile.modules[0].media!.length, 1); assert.ok(Object.values(data.facts.facts).some(fact => fact.kind === 'media' && fact.value.attribute === 'srcset')); assert.equal(mobile.modules[0].state!.carouselIndex, 0); assert.deepEqual(mobile.gaps, []);
    const snapshot = fingerprintNative44Snapshot({ hash: 'b'.repeat(64), elements: [], settings: {} });
    const manifest: Native44CompareManifest = { ...snapshot, version: 1, strategy: 'native44-css-handoff', taskId: 'new-task', runId: 'new-task-run', pageId: 42, sourceUrl: data.options.sourceUrl, targetUrl: 'https://target.test/', widgetTypes: ['heading'], canvasCss: '', modules: [{ key: 'hero', className: 'cwp-hero', sourceSelector: '#actual-root', targetSelector: '.elementor-42 .cwp-hero', required: true }], cssRules: [], sourceCaptures };
    await writeFile(path.join(directory, 'compare-manifest.json'), JSON.stringify(manifest)); let sourceOpens = 0, targetOpens = 0;
    const result = await compareNative44Run(directory, { sourceCaptures: loaded, readSnapshot: async () => snapshot, openPage: async (_url, role) => { if (role === 'source') { sourceOpens++; throw Error('Must not navigate to source'); } targetOpens++; const page = await browser.newPage(); await page.setContent('<style>body{margin:0}.cwp-hero{height:100px}</style><main class="elementor-42"><section class="cwp-hero">Target fixture</section></main>'); return page; } });
    assert.equal(sourceOpens, 0); assert.equal(targetOpens, 1); assert.equal(result.metrics.sourceBrowserNavigations, 0); assert.equal(result.metrics.screenshots, 4); assert.equal(result.metrics.reusedScreenshots, 4); assert.equal(result.captures[3].source.sha256, data.packets[3].snapshot.screenshot.sha256);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('read-only browser backgrounds require current exported bytes and real host decoding, without fabricating browser decode', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-source-host-decode-'));
  try {
    const data = await fixture(directory, true, true), reference = data.options.renderEvidenceBySnapshot[data.packets[0].snapshot.id];
    let set = await prepareNative44SourceCaptures(data.options), loaded = await loadNative44SourceCaptures(set, data.options);
    let capture = await readNative44SourceCapture(loaded, NATIVE44_COMPARE_VIEWPORTS[0], [{ key: 'hero' }], path.join(directory, 'no-host.png'));
    assert.equal(capture.modules[0].media!.find(item => item.kind === 'background')!.drawable, null);
    const evidence = JSON.parse(await readFile(reference.path, 'utf8')) as Native44SourceRenderEvidence;
    const bytes = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#cc3333' } }).png().toBuffer(), filename = path.join(directory, 'exported-current-browser-asset.png'); await writeFile(filename, bytes);
    evidence.hostDecodedAssets = [{ taskId: evidence.taskId, snapshotId: evidence.snapshotId, screenshotHash: evidence.screenshotHash, url: data.packets[0].resources.photo.url, exportedAt: evidence.capturedAt, provenance: 'current-browser-page-asset', asset: { path: filename, sha256: hash(bytes) } }];
    const save = async () => { const rendered = Buffer.from(JSON.stringify(evidence)); await writeFile(reference.path, rendered); reference.sha256 = hash(rendered); };
    await save(); set = await prepareNative44SourceCaptures(data.options); loaded = await loadNative44SourceCaptures(set, data.options);
    const observed = loaded.renderEvidence.get(evidence.snapshotId)!; assert.equal(observed.media.find(item => item.kind === 'background')!.decoded, null); assert.deepEqual(observed.verifiedAssetDecodes, [{ url: evidence.hostDecodedAssets[0].url, sha256: hash(bytes), decoder: 'sharp', format: 'png', width: 12, height: 9 }]);
    capture = await readNative44SourceCapture(loaded, NATIVE44_COMPARE_VIEWPORTS[0], [{ key: 'hero' }], path.join(directory, 'with-host.png')); assert.equal(capture.modules[0].media!.find(item => item.kind === 'background')!.drawable, true);
    evidence.hostDecodedAssets[0].taskId = 'older-task'; await save(); await assert.rejects(() => prepareNative44SourceCaptures(data.options), /not bound to the current browser/);
    evidence.hostDecodedAssets[0].taskId = evidence.taskId; await save(); await writeFile(filename, Buffer.from('not the exported bytes')); await assert.rejects(() => prepareNative44SourceCaptures(data.options), /asset bytes changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('old snapshots, altered screenshot bytes and missing source viewport ownership cannot become fresh comparison evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-source-stale-'));
  try {
    const data = await fixture(directory);
    await assert.rejects(() => prepareNative44SourceCaptures({ ...data.options, collectionStartedAt: '2026-10-16T00:02:00.000Z' }), /previous-task/);
    const set = await prepareNative44SourceCaptures(data.options); set.viewports[3].snapshotId = set.viewports[0].snapshotId;
    await assert.rejects(() => loadNative44SourceCaptures(set, data.options), /incomplete current-task/);
    await writeFile(data.packets[0].snapshot.screenshot.path, Buffer.from('altered bytes'));
    await assert.rejects(() => prepareNative44SourceCaptures(data.options), /screenshot bytes changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('visible source usage does not fabricate image decode or font readiness evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-source-unverified-'));
  try {
    const data = await fixture(directory, false), set = await prepareNative44SourceCaptures(data.options), loaded = await loadNative44SourceCaptures(set, data.options), capture = await readNative44SourceCapture(loaded, NATIVE44_COMPARE_VIEWPORTS[0], [{ key: 'hero' }], path.join(directory, 'copy.png'));
    assert.equal(capture.modules[0].media![0].drawable, null); assert.ok(capture.gaps.some(gap => gap.detail.includes('font readiness'))); assert.equal(hash(await readFile(capture.screenshot)), data.packets[0].snapshot.screenshot.sha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('hash-bound screenshot frame review normalizes a moving carousel without replacing raw DOM state or any slide facts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-source-visual-frame-'));
  try {
    // The actual fixture raster paints 2/6; the later DOM observation is at 1/6.
    const data = await fixture(directory, true, false, 1), packet = data.packets[0], reference = data.options.renderEvidenceBySnapshot[packet.snapshot.id], evidence = JSON.parse(await readFile(reference.path, 'utf8')) as Native44SourceRenderEvidence;
    const rawStateJSON = JSON.stringify(evidence.states), sourceFactsHash = data.options.sourceFacts.sha256;
    evidence.visualStateObservations = [{ method: 'codex-screenshot-review', screenshotHash: packet.snapshot.screenshot.sha256, nodeId: packet.regions[0].nodeId, trackNodeId: packet.interactions.carousel.trackNodeId, observedAt: '2026-10-16T00:02:00.000Z', index: 1, counterText: '2/6', notes: 'The bound fixture screenshot visibly paints 2/6; the later raw DOM is retained at 1/6. Target alignment uses the screenshot frame only.' }];
    const frame = structuredClone(evidence.visualStateObservations[0]), save = async () => { const bytes = Buffer.from(JSON.stringify(evidence)); await writeFile(reference.path, bytes); reference.sha256 = hash(bytes); };
    await save(); const set = await prepareNative44SourceCaptures(data.options), loaded = await loadNative44SourceCaptures(set, data.options), capture = await readNative44SourceCapture(loaded, NATIVE44_COMPARE_VIEWPORTS[0], [{ key: 'hero' }], path.join(directory, 'visual-frame.png'));
    assert.equal(capture.modules[0].state!.carouselIndex, 1); assert.equal(capture.stateEvidence[0].rawDOMIndex, 0); assert.equal(capture.stateEvidence[0].screenshotIndex, 1); assert.equal(capture.stateEvidence[0].method, 'codex-screenshot-review'); assert.equal(capture.stateEvidence[0].screenshotHash, packet.snapshot.screenshot.sha256); assert.equal(capture.stateEvidence[0].counterText, '2/6');
    assert.equal(JSON.stringify(loaded.renderEvidence.get(packet.snapshot.id)!.states), rawStateJSON); assert.equal(hash(await readFile(data.options.sourceFacts.path)), sourceFactsHash); assert.equal(loaded.packets.get(packet.snapshot.id)![0].interactions.carousel.itemNodeIds!.length, 6);
    for (const invalid of [{ screenshotHash: '0'.repeat(64) }, { nodeId: 'foreign-owner' }, { trackNodeId: 'foreign-track' }, { index: 6 }, { counterText: '3/6' }, { observedAt: '2026-10-15T00:00:00.000Z' }, { notes: '' }, { method: 'observed-dom' }]) {
      evidence.visualStateObservations = [Object.assign(structuredClone(frame), invalid)]; await save(); await assert.rejects(() => prepareNative44SourceCaptures(data.options), /Screenshot visual state|Screenshot counter/);
    }
    evidence.visualStateObservations = [frame, frame]; await save(); await assert.rejects(() => prepareNative44SourceCaptures(data.options), /Screenshot visual state/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source carousel state follows the actual visible owned track, including a track-bound child and responsive hidden alternatives', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-source-visible-state-'));
  try {
    const data = await fixture(directory), set = await prepareNative44SourceCaptures(data.options), loaded = await loadNative44SourceCaptures(set, data.options), viewport = NATIVE44_COMPARE_VIEWPORTS[0], packet = loaded.packets.get(set.viewports[0].snapshotId)![0], root = packet.regions[0].nodeId, observed = loaded.renderEvidence.get(packet.snapshot.id)!;
    const add = (id: string, parentId: string, visible: boolean) => {
      packet.styles[id] = { display: visible ? 'block' : 'none', visibility: 'visible', opacity: '1' };
      packet.layouts[id] = { ...structuredClone(packet.layouts.layout), id, rect: { x: 0, y: 0, width: visible ? 600 : 0, height: visible ? 24 : 0 } };
      packet.nodes[id] = { id, parentId, regionId: 'region', tag: 'div', selector: `#${id}`, attributes: {}, childIds: [], styleId: id, layoutId: id, visible }; packet.nodes[parentId].childIds.push(id);
    };
    // Actual Pet shape: hidden tablet owner/track next to a visible desktop
    // owner/track; the component itself may be bound to the track node.
    add('tablet-owner', root, false); add('tablet-track', 'tablet-owner', false); add('desktop-owner', root, true); add('desktop-track', 'desktop-owner', true);
    packet.interactions.tablet = { id: 'tablet', nodeId: 'tablet-owner', regionId: 'region', kind: 'carousel', status: 'observed', trackNodeId: 'tablet-track', details: {} };
    packet.interactions.desktop = { id: 'desktop', nodeId: 'desktop-owner', regionId: 'region', kind: 'carousel', status: 'observed', trackNodeId: 'desktop-track', details: {} };
    observed.states = [{ nodeId: 'tablet-owner', carouselIndex: 6 }, { nodeId: 'desktop-owner', carouselIndex: 2 }];
    loaded.plan.components.push({ id: 'track', variants: [{ snapshotId: packet.snapshot.id, nodeIds: ['desktop-track'], visible: true }] });
    const rawStates = JSON.stringify(observed.states), capture = async () => readNative44SourceCapture(loaded, viewport, [{ key: 'hero' }, { key: 'track' }], path.join(directory, 'states.png'));
    let measured = await capture(); assert.equal(measured.modules[0].state!.carouselIndex, 2); assert.equal(measured.modules[1].state!.carouselIndex, 2); assert.equal(JSON.stringify(observed.states), rawStates);
    // Tablet: both broad owners remain visible, but the desktop track has
    // display:none and zero geometry. Owner visibility alone is insufficient.
    for (const id of ['tablet-owner', 'tablet-track']) { packet.nodes[id].visible = true; packet.styles[id].display = 'block'; packet.layouts[id].rect.width = 600; packet.layouts[id].rect.height = 24; }
    packet.nodes['desktop-track'].visible = false; packet.styles['desktop-track'].display = 'none'; packet.layouts['desktop-track'].rect.width = packet.layouts['desktop-track'].rect.height = 0;
    measured = await capture(); assert.equal(measured.modules[0].state!.carouselIndex, 6); assert.equal(measured.modules[1].state, undefined); assert.equal(JSON.stringify(observed.states), rawStates);
    // Two actually rendered carousels remain ambiguous even with the same
    // logical index. A parent cannot silently borrow the first descendant.
    packet.nodes['desktop-track'].visible = true; packet.styles['desktop-track'].display = 'block'; packet.layouts['desktop-track'].rect.width = 600; packet.layouts['desktop-track'].rect.height = 24; observed.states[1].carouselIndex = 6;
    measured = await capture(); assert.equal(measured.modules[0].state, undefined); assert.equal(measured.modules[1].state!.carouselIndex, 6);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('runtime source collection must be explicitly bound to the exact job, program and raw collection task', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-job-collection-'));
  try {
    const data = await fixture(directory), filename = path.join(directory, 'program.json'), program = { taskId: data.options.taskId, sourceUrl: data.options.sourceUrl, sourceFacts: data.options.sourceFacts, componentPlan: data.options.componentPlan }, programBytes = Buffer.from(JSON.stringify(program)); await writeFile(filename, programBytes);
    const collectionPath = path.join(directory, 'collection.json'), collectionBytes = Buffer.from(JSON.stringify({ taskId: program.taskId, sourceUrl: program.sourceUrl, collectionStartedAt: data.options.collectionStartedAt })); await writeFile(collectionPath, collectionBytes);
    const job = { jobDir: directory, programPath: filename, sourceFactsPath: program.sourceFacts.path, sourceCollection: { path: collectionPath, sha256: hash(collectionBytes) }, sourceRenderEvidenceBySnapshot: data.options.renderEvidenceBySnapshot };
    await writeFile(path.join(directory, 'job.json'), JSON.stringify(job));
    const input = { root: directory, jobDir: directory, filename, programHash: hash(programBytes), program }, set = await prepareNative44JobSourceCaptures(input);
    assert.equal(set.collectionStartedAt, data.options.collectionStartedAt); assert.equal(set.collection!.sha256, hash(collectionBytes)); assert.equal(set.programBinding!.sha256, hash(programBytes));
    await loadNative44SourceCaptures(set, program);
    await writeFile(path.join(directory, 'job.json'), JSON.stringify({ ...job, programPath: path.join(directory, 'other-program.json') }));
    await assert.rejects(() => prepareNative44JobSourceCaptures(input), /matching job\/program/);
    const foreign = Buffer.from(JSON.stringify({ taskId: 'older-task', sourceUrl: program.sourceUrl, collectionStartedAt: data.options.collectionStartedAt })); await writeFile(collectionPath, foreign); await writeFile(path.join(directory, 'job.json'), JSON.stringify({ ...job, sourceCollection: { path: collectionPath, sha256: hash(foreign) } }));
    await assert.rejects(() => prepareNative44JobSourceCaptures(input), /another task/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

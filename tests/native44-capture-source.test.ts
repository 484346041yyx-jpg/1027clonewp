import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { DESKTOP_BROWSER_PROFILE, native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_BROWSER_OBSERVATION_FILE, native44ObservedGeometryHash, readNative44BrowserObservation, prepareObservedNative44Reference, validateNative44BrowserObservation, verifyNative44BrowserSegmentPixels, verifyNative44BrowserCaptureTransactions, type Native44TransactionalBrowserObservation, type Native44BrowserObservation } from '../src/native44/source.js';
import { observationCountsV2, readObservationDirectoryV2, sha256, type ObservationPacketV2, type ObservationManifestV2 } from '../src/replica-v2/observation.js';
import { BrowserCaptureTransactionSchema, type BrowserCaptureTransaction, type CaptureTransactionState } from '../src/replica-v2/capture-transaction.js';
import { browserCaptureTransactionFixture } from './fixtures/browser-capture-transaction-v2.js';
import { copySystemReleaseFixture } from './fixtures/system-release.js';

const url = 'https://8.8.8.8/', collectionAt = '2026-10-16T00:00:00.000Z';
const save = async (filename: string, value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); await writeFile(filename, bytes); return { path: path.basename(filename), sha256: sha256(bytes) }; };
async function fixture(directory: string) {
  const manifest: ObservationManifestV2 = { version: 2, kind: 'observation-manifest', sourceUrl: url, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [], sceneInventories: [] };
  const binding: Native44TransactionalBrowserObservation = { version: 3, replicationProfile: DESKTOP_BROWSER_PROFILE, renderEvidenceBySnapshot: {}, browserObservation: { method: 'user-opened-browser', tool: 'cua_repl', browserId: 'fixture-instance', tabId: 'fixture-tab', frameId: 'fixture-frame', requestedUrl: url, actualUrl: url, observedAt: collectionAt, captures: [] } };
  const receipts: BrowserCaptureTransaction[] = [];
  for (const [index, view] of native44ProfileViewports(DESKTOP_BROWSER_PROFILE).entries()) {
    const bytes = await sharp({ create: { width: view.width, height: view.height, channels: 3, background: '#123456' } }).png().toBuffer(), png = `${view.name}.png`;
    await writeFile(path.join(directory, png), bytes);
    const capturedAt = new Date(Date.parse(collectionAt) + 4_250 + index * 10_000).toISOString();
    const viewport = { name: index === 0 ? 'desktop' : 'desktop-narrow', width: view.width, height: view.height, clientWidth: view.width, scrollbarWidth: 0, devicePixelRatio: 1 }, rect = { x: 0, y: 0, width: view.width, height: view.height };
    const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: view.name, url, title: 'Normal source homepage protocol fixture', capturedAt, viewport, pageHeight: view.height, screenshot: { path: png, sha256: sha256(bytes), width: view.width, height: view.height } }, nodes: { root: { id: 'root', parentId: null, regionId: 'hero', tag: 'section', selector: '#hero', attributes: {}, childIds: [], styleId: 'style', layoutId: 'layout', visible: true } }, regions: [{ id: 'hero', nodeId: 'root', contentNodeId: 'root', role: 'hero', order: 0, gapBefore: 0 }], texts: { title: { id: 'title', nodeId: 'root', regionId: 'hero', kind: 'body', text: 'A normal visible source block for a synthetic protocol fixture.' } }, styles: { style: { display: 'block', visibility: 'visible', opacity: '1' } }, layouts: { layout: { id: 'layout', rect, contentRect: rect, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 } }, resources: {}, usages: {}, interactions: {}, gaps: [], commerceEvidence: { version: 1, productUrls: [] } };
    const packetRef = await save(path.join(directory, `${view.name}.json`), packet);
    manifest.packets.push({ ...packetRef, snapshotId: view.name, regionIds: ['hero'], counts: observationCountsV2(packet), dependencies: [] }); manifest.screenshots.push({ path: png, sha256: sha256(bytes), snapshotId: view.name });
    const scene = await save(path.join(directory, `${view.name}-scene.json`), { version: 2, kind: 'scene-inventory', snapshotId: view.name, sourceUrl: url, capturedAt, viewport: { name: viewport.name, width: view.width, height: view.height }, regions: [{ id: 'hero', selector: '#hero' }], entries: { title: { id: 'title', selector: '#hero', ownerRegionId: 'hero', kind: 'text', label: packet.texts.title.text, rect } }, counts: { total: 1, text: 1, media: 0, control: 0, assigned: 1, unassigned: 0, vendorUtilities: 0 } }); manifest.sceneInventories!.push({ ...scene, snapshotId: view.name });
    const { name: _name, ...dimensions } = viewport, geometry = { url, viewport: dimensions, scrollX: 0, scrollY: 0, pageHeight: view.height, geometryHash: native44ObservedGeometryHash([packet], view.name) };
    const transaction = browserCaptureTransactionFixture(Date.parse(collectionAt) + 10_000 + index * 10_000, { sha256: sha256(bytes), width: view.width, height: view.height });
    transaction.expected.url = url; transaction.expected.carouselOwners = [];
    for (const attempt of transaction.attempts) if (attempt.outcome === 'ok') {
      if (attempt.stage === 'url' || attempt.stage === 'dom') (attempt.data as { actualUrl: string }).actualUrl = url;
      else {
        const data = attempt.data as { state?: CaptureTransactionState; before?: CaptureTransactionState; after?: CaptureTransactionState };
        for (const state of [data.state, data.before, data.after].filter((state): state is CaptureTransactionState => !!state)) { state.geometryHash = geometry.geometryHash; state.carousels = []; }
      }
    }
    receipts.push(transaction);
    const receipt = await save(path.join(directory, `${view.name}-transaction.json`), transaction);
    binding.browserObservation.captures.push({ snapshotId: view.name, packetHashes: [packetRef.sha256], screenshotHash: sha256(bytes), captureMode: 'full-page-stable', before: geometry, after: structuredClone(geometry), captureTransaction: { receipt, document: { ...transaction.expected.document } } });
    binding.renderEvidenceBySnapshot[view.name] = await save(path.join(directory, `${view.name}-render.json`), { version: 1, snapshotId: view.name, sourceUrl: url, capturedAt, screenshotHash: sha256(bytes), viewport: { width: view.width, height: view.height, clientWidth: view.width, devicePixelRatio: 1 }, document: transaction.expected.document, fontsReady: true, media: [], states: [] });
  }
  await save(path.join(directory, 'observation-manifest.json'), manifest); await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), binding);
  return { binding, receipts, observation: await readObservationDirectoryV2(directory, url) };
}
async function updateReceipt(directory: string, binding: Native44TransactionalBrowserObservation, receipt: BrowserCaptureTransaction, index = 0) {
  binding.browserObservation.captures[index].captureTransaction.receipt = await save(path.join(directory, `${index}-changed-transaction.json`), receipt);
  await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), binding);
}

test('version 3 real import reader verifies v2 receipts and actual rasters using capture-period time', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-source-'));
  try {
    const { binding, observation } = await fixture(directory);
    assert.equal((await readNative44BrowserObservation(directory, url))?.version, 3);
    const reports = await verifyNative44BrowserCaptureTransactions(binding, directory, observation);
    assert.equal(reports.length, 2); assert.ok(reports.every(item => item.report.status === 'verified' && item.report.scope === 'capture-consistency-only' && item.report.evidence.rasterBytesVerified));
    assert.equal(Date.parse(collectionAt) < Date.now() - 120_000, true, 'Frozen capture may be replayed after the freshness window');
    const missing = structuredClone(binding) as unknown as { browserObservation: { captures: Array<Record<string, unknown>> } }; delete missing.browserObservation.captures[0].captureTransaction;
    assert.throws(() => validateNative44BrowserObservation(missing, observation, url), /Invalid native44/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('version 3 accepts truthful agent-opened provenance only when manifest and sidecar agree', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-agent-source-'));
  try {
    const { binding, observation } = await fixture(directory);
    const agentBinding = structuredClone(binding);
    agentBinding.browserObservation.method = 'agent-opened-browser';
    await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), agentBinding);
    await assert.rejects(readNative44BrowserObservation(directory, url), /URL\/provenance differs/);
    await save(path.join(directory, 'observation-manifest.json'), { ...observation.manifest, provenance: { ...observation.manifest.provenance, method: 'agent-opened-browser' } });
    const imported = await readNative44BrowserObservation(directory, url);
    assert.equal(imported?.browserObservation.method, 'agent-opened-browser');
    assert.equal((await verifyNative44BrowserCaptureTransactions(imported!, directory, await readObservationDirectoryV2(directory, url))).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('version 3 rejects independently coherent but wrong tab/frame/document/URL/viewport receipts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-identities-'));
  try {
    const initial = await fixture(directory);
    const mutations: Array<(value: BrowserCaptureTransaction) => void> = [
      value => { value.binding.tabId = 'another-tab'; for (const attempt of value.attempts) attempt.binding.tabId = 'another-tab'; },
      value => { value.binding.frameId = 'another-frame'; for (const attempt of value.attempts) attempt.binding.frameId = 'another-frame'; },
      value => { value.expected.document.revision = 'another-revision'; },
      value => { value.expected.url = 'https://8.8.4.4/'; },
      value => { value.expected.viewport.width--; },
    ];
    for (const mutate of mutations) {
      const receipt = structuredClone(initial.receipts[0]), binding = structuredClone(initial.binding); mutate(receipt); await updateReceipt(directory, binding, receipt);
      await assert.rejects(readNative44BrowserObservation(directory, url), /identity differs|viewport differs/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('version 3 binds receipt hashes, packet/render capture period, document and screenshot geometry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-integrity-'));
  try {
    const initial = await fixture(directory), changed = structuredClone(initial.binding);
    changed.browserObservation.captures[0].captureTransaction.receipt.sha256 = '0'.repeat(64); await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), changed);
    await assert.rejects(readNative44BrowserObservation(directory, url), /hash changed/);
    const oldPeriod = structuredClone(initial.receipts[0]); oldPeriod.startedAt = '2026-10-15T00:00:00.000Z'; await updateReceipt(directory, initial.binding, oldPeriod);
    await assert.rejects(readNative44BrowserObservation(directory, url), /different capture periods/);
    for (const mutate of [(state: CaptureTransactionState) => { state.geometryHash = '0'.repeat(64); }, (state: CaptureTransactionState) => { state.scroll.y = 50; }]) {
      const receipt = structuredClone(initial.receipts[0]);
      for (const attempt of receipt.attempts) if (attempt.stage === 'screenshot' && attempt.outcome === 'ok') { const data = attempt.data as { before: CaptureTransactionState; after: CaptureTransactionState }; mutate(data.before); mutate(data.after); }
      await updateReceipt(directory, initial.binding, receipt); await assert.rejects(readNative44BrowserObservation(directory, url), /geometry\/scroll/);
    }
    await updateReceipt(directory, initial.binding, initial.receipts[0]);
    const renderRef = initial.binding.renderEvidenceBySnapshot['desktop-wide'], rendering = JSON.parse(await readFile(path.join(directory, renderRef.path), 'utf8')); rendering.document.key = 'another-document';
    initial.binding.renderEvidenceBySnapshot['desktop-wide'] = await save(path.join(directory, renderRef.path), rendering); await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), initial.binding);
    await assert.rejects(readNative44BrowserObservation(directory, url), /render document identity/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('version 3 requires real full-page coverage evidence and reports incomplete/restoration failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-coverage-'));
  try {
    const initial = await fixture(directory), capture = initial.binding.browserObservation.captures[0], receipt = structuredClone(initial.receipts[0]);
    const coverage = { version: 1, kind: 'native44-capture-coverage', snapshotId: capture.snapshotId, screenshotHash: capture.screenshotHash, captureMode: capture.captureMode, geometryHash: capture.before.geometryHash, pageHeight: capture.before.pageHeight, complete: true, seamless: true, layoutPreserved: true };
    const coverageRef = await save(path.join(directory, 'coverage.json'), coverage);
    for (const attempt of receipt.attempts) if (attempt.stage === 'screenshot' && attempt.outcome === 'ok') Object.assign((attempt.data as { artifact: object }).artifact, { mode: 'full-page', fullPageReceipt: { sha256: coverageRef.sha256, complete: true, seamless: true, layoutPreserved: true } });
    await updateReceipt(directory, initial.binding, receipt); await assert.rejects(readNative44BrowserObservation(directory, url), /actual bound coverage receipt/);
    capture.captureTransaction.fullPageCoverage = coverageRef; await updateReceipt(directory, initial.binding, receipt); assert.equal((await readNative44BrowserObservation(directory, url))?.version, 3);
    const incomplete = structuredClone(receipt); incomplete.attempts.pop(); await updateReceipt(directory, initial.binding, incomplete);
    await assert.rejects(readNative44BrowserObservation(directory, url), /capture_restore_required/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('version 3 owned import relocates immutable receipts and validates them after original inputs change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-relocate-'));
  try {
    const directory = path.join(root, 'observed'); await mkdir(directory); await mkdir(path.join(root, 'data', 'native44'), { recursive: true });
    await copyFile(path.resolve(import.meta.dirname, '../data/native44/index.json'), path.join(root, 'data', 'native44', 'index.json')); await copySystemReleaseFixture(root);
    await mkdir(path.join(root, 'config'), { recursive: true }); await writeFile(path.join(root, 'config', 'project.json'), JSON.stringify({ pageStatus: 'publish' }));
    await writeFile(path.join(root, 'config', 'credentials.local.json'), 'Credentials must not be read by source intake');
    const jobId = 'reference-v2-native-owned-import';
    const { binding } = await fixture(directory), job = await prepareObservedNative44Reference(url, directory, { root, jobId });
    assert.equal(job.jobId, jobId); assert.equal(job.jobDir, path.join(root, 'references', jobId));
    await assert.rejects(prepareObservedNative44Reference(url, directory, { root, jobId }), { code: 'EEXIST' });
    assert.equal(job.finalDeliveryPolicy?.desiredPageStatus, 'publish'); assert.equal(job.finalDeliveryPolicy?.constructionPageStatus, 'draft');
    assert.deepEqual(JSON.parse(await readFile(path.join(job.jobDir, 'job.json'), 'utf8')).finalDeliveryPolicy, job.finalDeliveryPolicy);
    await writeFile(path.join(root, 'config', 'project.json'), JSON.stringify({ pageStatus: 'draft' }));
    assert.equal(JSON.parse(await readFile(path.join(job.jobDir, 'job.json'), 'utf8')).finalDeliveryPolicy.desiredPageStatus, 'publish');
    const collection = JSON.parse(await readFile(job.sourceCollection!.path, 'utf8')), observation = await readObservationDirectoryV2(path.dirname(job.observationPath), url);
    const relocated = validateNative44BrowserObservation({ version: collection.version, replicationProfile: collection.replicationProfile, renderEvidenceBySnapshot: collection.renderEvidenceBySnapshot, browserObservation: collection.browserObservation }, observation, url);
    assert.equal(relocated.version, 3); await verifyNative44BrowserSegmentPixels(relocated, path.dirname(job.observationPath), observation);
    await writeFile(path.join(directory, binding.browserObservation.captures[0].captureTransaction.receipt.path), 'Changed original receipt');
    await verifyNative44BrowserSegmentPixels(relocated, path.dirname(job.observationPath), observation);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('historical version 2 bytes retain their existing semantics without acquiring transactions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-legacy-'));
  try {
    const { binding } = await fixture(directory), legacy = structuredClone(binding) as unknown as Native44BrowserObservation; legacy.version = 2; delete legacy.browserObservation.frameId;
    for (const capture of legacy.browserObservation.captures) delete capture.captureTransaction;
    await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), legacy);
    const before = await readFile(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE));
    assert.equal((await readNative44BrowserObservation(directory, url))?.version, 2);
    assert.ok(before.equals(await readFile(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE))));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Claude browser observer is an independent v3 identity that never borrows Codex provenance', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-claude-source-'));
  try {
    const { binding, observation } = await fixture(directory), manifestPath = path.join(directory, 'observation-manifest.json');
    const claude = structuredClone(binding); claude.browserObservation.method = 'agent-opened-browser'; claude.browserObservation.tool = 'claude_browser';
    await save(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), claude);
    await assert.rejects(readNative44BrowserObservation(directory, url), /URL\/provenance differs/);
    await save(manifestPath, { ...observation.manifest, provenance: { method: 'agent-opened-browser', observer: 'claude_browser', browser: 'chrome' } });
    const imported = await readNative44BrowserObservation(directory, url);
    assert.equal(imported?.browserObservation.tool, 'claude_browser');
    assert.equal((await verifyNative44BrowserCaptureTransactions(imported!, directory, await readObservationDirectoryV2(directory, url))).length, 2);
    await save(manifestPath, { ...observation.manifest, provenance: { method: 'agent-opened-browser', observer: 'claude_browser', browser: 'chromium' } });
    assert.equal((await readNative44BrowserObservation(directory, url))?.browserObservation.tool, 'claude_browser');
    for (const provenance of [{ method: 'user-opened-browser', observer: 'claude_browser', browser: 'chrome' }, { method: 'agent-opened-browser', observer: 'claude_browser', browser: 'iab' }, { method: 'agent-opened-browser', observer: 'cua_repl', browser: 'chromium' }]) {
      await save(manifestPath, { ...observation.manifest, provenance });
      await assert.rejects(readNative44BrowserObservation(directory, url), /provenance/);
    }
    await save(manifestPath, { ...observation.manifest, provenance: { method: 'agent-opened-browser', observer: 'cua_repl', browser: 'chrome' } });
    await assert.rejects(readNative44BrowserObservation(directory, url), /URL\/provenance differs/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('historical version 2 sidecars stay Codex-only and the Codex v3 identity is unchanged', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-claude-v2-'));
  try {
    const { binding, observation } = await fixture(directory), legacy = structuredClone(binding) as unknown as Native44BrowserObservation; legacy.version = 2; delete legacy.browserObservation.frameId;
    for (const capture of legacy.browserObservation.captures) delete capture.captureTransaction;
    legacy.browserObservation.tool = 'claude_browser';
    assert.throws(() => validateNative44BrowserObservation(legacy, observation, url), /Invalid native44/);
    assert.equal(binding.browserObservation.tool, 'cua_repl');
    assert.equal(validateNative44BrowserObservation(binding, observation, url).browserObservation.tool, 'cua_repl');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

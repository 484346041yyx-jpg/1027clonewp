import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { createFullReplicaDependencies, verifyFullReplicaReviewEvidence } from '../src/replica-full/body.js';
import { fullReplicaFingerprint, validateFullReplicaManifest } from '../src/replica-full/contract.js';
import { checkpointHeaderModule } from '../src/woodmart-header/generic/service.js';
import type { FullReplicaFileRef, FullReplicaBoundCheckpoint, FullReplicaReview } from '../src/replica-full/types.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { native44KnowledgeIdentity } from '../src/native44/knowledge.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { assertNative44Compilation } from '../src/native44/compiler.js';
import { documentHashV2, canonicalV2 } from '../src/replica-v2/journal.js';
import { headerJsonHash } from '../src/woodmart-header/contract.js';
import type { HeaderRemoteModule, HeaderModuleDriver, HeaderModuleIdentity } from '../src/woodmart-header/generic/wordpress.js';
import type { NativeHeaderContract } from '../src/woodmart-header/generic/compiler.js';
import type { FullReplicaDriver, FullReplicaRemotePage } from '../src/replica-full/driver.js';
import type { FullReplicaRemoteServices } from '../src/replica-full/body.js';
import { reconcileFullReplica, reviseFullReplicaHeaderStyle, reviseFullReplicaNativeMotion, reviseFullReplicaNavigationReturn, reviseFullReplicaStyle, runFullReplica } from '../src/replica-full/coordinator.js';
import { compileNavigationFormPatch } from '../src/replica-full/navigation-form/index.js';
import { compileNavigationReturnPatch, NAVIGATION_RETURN_RUNTIME, NAVIGATION_RETURN_V1_RUNTIME } from '../src/replica-full/navigation-return.js';
import { contentFixture } from './fixtures/header-menu-content.js';
import { verifyFullReplicaVisualReview } from '../src/replica-full/visual-review.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { prepareActualBody, compileActualBody, resolveActualBodyStyles } from '../src/replica-full/body-prepare.js';
import { sourceFontFixture } from './fixtures/source-font.js';

const hash = 'a'.repeat(64);
async function fixture() {
  const directory = path.join('D:/cloneWP/.cache', `replica-full-factory-${randomUUID()}`); await mkdir(directory, { recursive: true });
  const put = async (name: string, input: unknown): Promise<FullReplicaFileRef> => { const bytes = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)), filename = path.join(directory, name); await writeFile(filename, bytes); return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const assets = await put('header-assets.json', { assets: [] }), body = await put('program.json', {}), css = await put('body.css', ':page{color:black}'), source = await put('source.json', {}), units = await put('units.json', {});
  const manifest = validateFullReplicaManifest({ version: 1, kind: 'clonewp-full-replica', taskId: 'alder-production-factory', runId: 'alder-production-run', title: 'Alder factory fixture', slug: 'alder-production', sourceUrl: 'https://source.example/', targetOrigin: 'https://target.example', sourceEvidence: source, sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] }, header: { bundleDirectory: path.join(directory, 'new-header'), assets, plan: { kind: 'clonewp-header-module', version: 1, moduleKey: 'alder-production', owner: { ownerId: 'clonewp', runId: 'alder-production-run' }, targetOrigin: 'https://target.example', name: 'Alder independent header', menus: [{ key: 'main', name: 'Alder independent menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { settings: {}, rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'main', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }] }, style: { css: ':header{color:black}', fonts: [] } } }, body: { program: body, css, sourceUnits: units } });
  const manifestFile = await put('manifest.json', manifest); return { directory, put, manifest, manifestFile, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
test('production dependency factory and header preparation stay local; unresolved body inputs fail without authentication', async () => {
  const f = await fixture(); try {
    let connections = 0; const deps = await createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: f.manifestFile.path, runDirectory: f.directory, manifest: f.manifest, async loadRemote() { connections++; throw Error('No remote expected'); } });
    const header = await deps.prepareHeader(f.manifest); assert.equal(header.moduleKey, 'alder-production'); await assert.rejects(deps.prepareBody(f.manifest)); assert.equal(connections, 0); await deps.close?.(); assert.equal(connections, 0);
  } finally { await f.cleanup(); }
});
test('header preparation refuses existing attachment adoption and missing materialized source media before authentication', async () => {
  const f = await fixture(); try {
    const assets = await f.put('adopt-assets.json', { assets: [{ key: 'logo', attachmentId: 99, localPath: 'nonexistent.png', sourceUrl: 'https://source.example/logo.png', sha256: hash, mediaType: 'image/png' }] }); f.manifest.header!.assets = assets;
    const deps = await createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: f.manifestFile.path, runDirectory: f.directory, manifest: f.manifest, async loadRemote() { throw Error('No remote expected'); } });
    await assert.rejects(deps.prepareHeader(f.manifest), /existing_media_forbidden/);
  } finally { await f.cleanup(); }
});
test('converted media requires hash-bound original bytes inside this task asset directory', async () => {
  const f = await fixture(); try {
    const image = await f.put('image.png', await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abc' } }).png().toBuffer()), original = await f.put('original.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
    const input = { key: 'logo', localPath: image.path, sourceUrl: 'https://source.example/logo.svg', sha256: image.sha256, mediaType: 'image/png', originalSha256: original.sha256 };
    f.manifest.header!.assets = await f.put('converted-assets.json', { assets: [input] });
    let connections = 0; let deps = await createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: f.manifestFile.path, runDirectory: f.directory, manifest: f.manifest, async loadRemote() { connections++; throw Error('No remote expected'); } }); await assert.rejects(deps.prepareHeader(f.manifest), /original_media_provenance/);
    f.manifest.header!.assets = await f.put('converted-assets.json', { assets: [{ ...input, originalSourcePath: original.path, originalSha256: hash }] });
    deps = await createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: f.manifestFile.path, runDirectory: f.directory, manifest: f.manifest, async loadRemote() { connections++; throw Error('No remote expected'); } }); await assert.rejects(deps.prepareHeader(f.manifest), /input_changed/); assert.equal(connections, 0);
  } finally { await f.cleanup(); }
});
async function reviewFixture() {
  const f = await fixture(), bound: FullReplicaBoundCheckpoint = { pageId: 999, runId: f.manifest.runId, headerId: 'header_test', editUrl: 'https://target.example/wp-admin/post.php?post=999&action=elementor', previewUrl: 'https://target.example/?page_id=999&preview=true', bodyHash: hash, cssHash: hash, documentHash: hash, headerHash: hash, menuHash: hash, styleHash: hash }, observedAt = new Date().toISOString(), fingerprint = fullReplicaFingerprint(bound), rows: any[] = [], viewports: FullReplicaReview['viewports'] = [];
  for (const [width, height] of [[1920, 1080], [1440, 1000]]) {
    const screenshot = await f.put(`${width}.png`, await sharp({ create: { width, height, channels: 3, background: '#abc' } }).png().toBuffer()), html = '<header class="whb-header whb-header_test"></header><div data-elementor-id="999" class="elementor elementor-999"><main>Alder body</main></div>';
    const dom = await f.put(`${width}-dom.json`, { version: 1, kind: 'clonewp-full-replica-browser-dom', pageId: 999, url: bound.previewUrl, observedAt, viewport: { width, height }, html });
    const state = { version: 1, kind: 'clonewp-full-replica-interaction-state', pageId: 999, fingerprint, width, height, selector: '.menu-toggle', observedAt }, before = await f.put(`${width}-before.json`, { ...state, state: { visible: false } }), after = await f.put(`${width}-after.json`, { ...state, state: { visible: true } });
    const interactions = await f.put(`${width}-interactions.json`, { version: 1, kind: 'clonewp-full-replica-interactions', pageId: 999, fingerprint, width, height, reviewSummary: 'Synthetic fixture records actual independent before and after state shapes.', actions: [{ key: 'menu', kind: 'hover', selector: state.selector, summary: 'Synthetic fixture changes menu visibility.', expectedOutcome: 'changed', before, after }] });
    rows.push({ width, height, screenshot, dom, interactions }); viewports.push({ width, height, screenshot, visual: 'passed', interactions: 'passed', headerCount: 1, bodyHeaderCount: 0 });
  }
  const evidence = { version: 1, kind: 'clonewp-full-replica-review-evidence', taskId: f.manifest.taskId, runId: f.manifest.runId, pageId: 999, fingerprint, viewports: rows }, review: FullReplicaReview = { version: 1, kind: 'clonewp-full-replica-review', taskId: f.manifest.taskId, runId: f.manifest.runId, pageId: 999, fingerprint, decision: 'approved', observedAt, reviewerEvidence: await f.put('review-evidence.json', evidence), viewports };
  const refresh = async () => { review.reviewerEvidence = await f.put('review-evidence.json', evidence); }; return { ...f, bound, review, evidence, refresh };
}
test('review checks real raster dimensions, parsed DOM header counts and independent interaction state changes', async () => {
  const f = await reviewFixture(); try { await verifyFullReplicaReviewEvidence(f.review, f.bound, f.manifest);
    const row = f.evidence.viewports[0]; row.dom = await f.put('duplicate-dom.json', { version: 1, kind: 'clonewp-full-replica-browser-dom', pageId: 999, url: f.bound.previewUrl, observedAt: f.review.observedAt, viewport: { width: row.width, height: row.height }, html: '<header class="whb-header whb-header_test"></header><div data-elementor-id="999" class="elementor elementor-999"><header>Duplicated body header</header></div>' }); await f.refresh();
    await assert.rejects(verifyFullReplicaReviewEvidence(f.review, f.bound, f.manifest), /actual_header_count/);
  } finally { await f.cleanup(); }
});
test('stale screenshots, active pending forms and timestamp-only interaction differences cannot approve review', async () => {
  const f = await reviewFixture(); try {
    await assert.rejects(verifyFullReplicaReviewEvidence({ ...f.review, observedAt: '2020-01-01T00:00:00.000Z' }, f.bound, f.manifest), /review_not_current/);
    const row = f.evidence.viewports[0]; row.dom = await f.put('active-form-dom.json', { version: 1, kind: 'clonewp-full-replica-browser-dom', pageId: 999, url: f.bound.previewUrl, observedAt: f.review.observedAt, viewport: { width: row.width, height: row.height }, html: '<header class="whb-header whb-header_test"></header><div data-elementor-id="999" class="elementor elementor-999"><form><input type="email"></form></div>' }); await f.refresh(); await assert.rejects(verifyFullReplicaReviewEvidence(f.review, f.bound, f.manifest), /active_pending_form/);
  } finally { await f.cleanup(); }
});
test('a timestamp change cannot replace a real observed interaction state change', async () => {
  const f = await reviewFixture(); try {
    const row = f.evidence.viewports[0], interactions = JSON.parse(await readFile(row.interactions.path, 'utf8')), before = JSON.parse(await readFile(interactions.actions[0].before.path, 'utf8'));
    interactions.actions[0].after = await f.put('timestamp-only.json', { ...before, observedAt: new Date(Date.parse(before.observedAt) + 1).toISOString() }); f.review.observedAt = new Date(Date.parse(before.observedAt) + 2).toISOString(); row.interactions = await f.put('timestamp-interactions.json', interactions); await f.refresh();
    await assert.rejects(verifyFullReplicaReviewEvidence(f.review, f.bound, f.manifest), /no_observed_change/);
  } finally { await f.cleanup(); }
});

async function actualFixture(navigation = false, styled = false) {
  const f = await fixture(), sourceUrl = navigation ? 'https://hoshiichi.com/' : f.manifest.sourceUrl; f.manifest.sourceUrl = sourceUrl;
  const packets = [[1920, 1080], [1440, 1000]].map(([width, height], index) => {
    const id = index ? 'narrow' : 'wide', nodes = { header: { id: 'header', parentId: null, regionId: 'rh', tag: 'header', selector: 'header', attributes: {}, childIds: [], styleId: 's', layoutId: 'lh', visible: true }, body: { id: 'body', parentId: null, regionId: 'rb', tag: 'main', selector: 'main', attributes: {}, childIds: [], styleId: 's', layoutId: 'lb', visible: true } }, layout = (id: string) => ({ id, rect: { x: 0, y: 0, width, height: 100 }, contentRect: { x: 0, y: 0, width, height: 100 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 });
    const formNodes = navigation ? { form: { id: 'form', parentId: 'body', regionId: 'rb', tag: 'form', selector: '#filter', attributes: { action: 'https://hoshiichi.com/all_product' }, childIds: ['select'], styleId: 's', layoutId: 'lb', visible: true }, select: { id: 'select', parentId: 'form', regionId: 'rb', tag: 'select', selector: '#filter select', attributes: {}, childIds: [], styleId: 's', layoutId: 'lb', visible: true } } : {};
    return validateObservationPacketV2({ version: 2, kind: 'observation-packet', snapshot: { id, url: sourceUrl, title: 'Synthetic adapter boundary fixture', capturedAt: new Date().toISOString(), viewport: { name: index ? 'desktop-narrow' : 'desktop', width, height, clientWidth: width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: height, screenshot: { path: `${id}.png`, sha256: hash, width, height } }, nodes: { ...nodes, ...formNodes, ...(navigation ? { body: { ...nodes.body, childIds: ['form'] } } : {}) }, regions: [{ id: 'rh', nodeId: 'header', contentNodeId: 'header', role: 'header', order: 0, gapBefore: 0 }, { id: 'rb', nodeId: 'body', contentNodeId: 'body', role: 'body', order: 1, gapBefore: 0 }], texts: { text: { id: 'text', nodeId: 'body', regionId: 'rb', text: 'Alder native body', kind: 'heading', level: 1 }, ...(navigation ? { labels: { id: 'labels', nodeId: 'form', regionId: 'rb', text: '用途 すべて スキンケア 検索', kind: 'label' } } : {}) }, styles: { s: {} }, layouts: { lh: layout('lh'), lb: layout('lb') }, resources: {}, usages: {}, interactions: {}, gaps: [] });
  });
  if (styled) for (const packet of packets) packet.styles.s = { color: 'rgb(200, 150, 0)' };
  const packetRefs = await Promise.all(packets.map(packet => f.put(`${packet.snapshot.id}-packet.json`, packet))), evidence = await f.put('actual-evidence.json', { version: 1, kind: 'native44-body-source-evidence', taskId: f.manifest.taskId, sourceUrl, snapshots: packets.map((packet, index) => ({ id: packet.snapshot.id, viewport: packet.snapshot.viewport, packets: [packetRefs[index]] })) });
  const facts = buildSourceFactsV2({ manifestPath: evidence.path, manifestSha256: evidence.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets, packetFiles: packetRefs.map((ref, index) => ({ ...ref, snapshotId: packets[index].snapshot.id })) }), factRef = await f.put('actual-facts.json', facts);
  const units = packets.flatMap(packet => ['header', 'body'].map(type => ({ id: `${packet.snapshot.id}/${type}`, snapshotId: packet.snapshot.id, ownerNodeId: type, nodeIds: type === 'body' && navigation ? ['body', 'form', 'select'] : [type], sourceFactIds: Object.values(facts.facts).filter(fact => fact.snapshotId === packet.snapshot.id && (type === 'body' ? fact.nodeId !== 'header' : fact.nodeId === type)).map(fact => fact.id), componentKeys: type === 'header' ? [] : ['hero', 'heading', ...(navigation ? ['hero_form'] : [])] })));
  const unitsRef = await f.put('actual-units.json', { version: 1, kind: 'native44-body-source-units', taskId: f.manifest.taskId, sourceUrl, units }), emptyAssets = await f.put('body-assets.json', { assets: [] }), plan = await f.put('body-plan.json', { testOnly: true }), identity = await native44KnowledgeIdentity('D:/cloneWP');
  let program = await f.put('actual-program.json', { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: f.manifest.taskId, title: 'Synthetic actual production boundary', sourceUrl, replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, ...identity, sourceFacts: factRef, componentPlan: plan, assetsManifest: emptyAssets, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'hero', children: [{ kind: 'native', key: 'heading', widgetType: 'heading', widgetSettings: { title: 'Alder native body' }, sourceFactIds: ['wide:text:text', 'narrow:text:text'] }] }] });
  if (styled) {
    const value = JSON.parse(await readFile(program.path, 'utf8')); value.styleResolutionVersion = 1;
    value.blocks[0].children[0].styleBindings = [{ sourceFactId: 'wide:text:text', selector: ' .elementor-heading-title', minWidth: 1, maxWidth: 10000, properties: ['color'] }];
    program = await f.put('actual-program.json', value);
  }
  if (navigation) {
    const fields = [{ name: 'application', label: '用途', options: [{ label: 'すべて', value: '' }, { label: 'スキンケア', value: 'app_skincare' }] }], sourceEvidence = await f.put('form-source.json', { version: 1, kind: 'clonewp-navigation-form-source', sourceUrl, observedAt: new Date().toISOString(), forms: packets.map(packet => ({ snapshotId: packet.snapshot.id, formSelector: '#filter', formAction: 'https://hoshiichi.com/all_product', method: 'GET', fields, submitLabel: '検索' })) });
    const sourceFactIds = Object.values(facts.facts).filter(fact => ['form', 'select'].includes(fact.nodeId)).map(fact => fact.id), value = JSON.parse(await readFile(program.path, 'utf8'));
    value.blocks[0].children = [{ kind: 'composite', key: 'hero_form', children: value.blocks[0].children, sourceFactIds }]; program = await f.put('actual-program.json', value);
    f.manifest.body.navigationForms = [{ key: 'product-filter', slotComponentKey: 'hero_form', sourceUnitIds: units.filter(unit => unit.id.endsWith('/body')).map(unit => unit.id), sourceFactIds, sourceEvidence, method: 'get', action: 'https://hoshiichi.com/all_product', fields, submitLabel: '検索' }];
  }
  f.manifest.sourceEvidence = evidence; f.manifest.sourcePartition = { allUnits: units.map(unit => unit.id), headerUnits: units.filter(unit => unit.id.endsWith('/header')).map(unit => unit.id), bodyUnits: units.filter(unit => unit.id.endsWith('/body')).map(unit => unit.id) }; f.manifest.body.program = program; f.manifest.body.sourceUnits = unitsRef; await f.put('manifest.json', f.manifest); return f;
}
test('body source font preparation is hash-bound, CSS-only and never enables fonts in header image assets', async () => {
  for (const scenario of ['valid', 'hash', 'image-mime', 'invalid-ttf', 'native-image', 'unreferenced', 'header'] as const) {
    const fixtureData = await actualFixture(); let connections = 0;
    try {
      const material = await fixtureData.put('source.ttf', scenario === 'invalid-ttf' ? Buffer.from('not a font') : sourceFontFixture());
      const assets = await fixtureData.put('font-assets.json', { assets: [{ key: 'sourcefont', localPath: 'source.ttf', sourceUrl: 'https://source.example/source.ttf', sha256: scenario === 'hash' ? '0'.repeat(64) : material.sha256, mediaType: scenario === 'image-mime' ? 'image/png' : 'font/ttf' }] });
      const program = JSON.parse(await readFile(fixtureData.manifest.body.program.path, 'utf8')); program.assetsManifest = assets;
      if (scenario === 'native-image') program.blocks[0].children[0].widgetSettings.image = { $asset: 'sourcefont' };
      fixtureData.manifest.body.program = await fixtureData.put('font-program.json', program);
      fixtureData.manifest.body.css = await fixtureData.put('font.css', scenario === 'unreferenced' ? ':page{color:black}' : '@font-face{font-family:"Source Fixture";src:url(__ASSET_sourcefont__) format("truetype")} :page{font-family:"Source Fixture"}');
      if (scenario === 'header') fixtureData.manifest.header!.assets = assets;
      const deps = await createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: fixtureData.manifestFile.path, runDirectory: fixtureData.directory, manifest: fixtureData.manifest, async loadRemote() { connections++; throw Error('No remote expected'); } });
      if (scenario === 'valid') await assert.doesNotReject(deps.prepareBody(fixtureData.manifest));
      else if (scenario === 'header') await assert.rejects(deps.prepareHeader(fixtureData.manifest));
      else await assert.rejects(deps.prepareBody(fixtureData.manifest));
      assert.equal(connections, 0, scenario); await deps.close?.();
    } finally { await fixtureData.cleanup(); }
  }
});
test('formal body compiler consumes the resolved native values instead of merely producing a diagnostics report', async () => {
  const f = await actualFixture(false, true);
  try {
    const body = await prepareActualBody(f.manifest), schemas = {
      container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } },
      heading: { type: 'heading', class: 'Heading', controls: { _css_classes: { type: 'text' }, title: { type: 'textarea' }, title_color: { type: 'color', selectors: { '{{WRAPPER}} .elementor-heading-title': 'color: {{VALUE}};' } } } },
    };
    const resolved = resolveActualBodyStyles(body, schemas);
    assert.ok(resolved.receipts.some(row => row.action === 'native-setting' && row.controlId === 'title_color'));
    const compiled = compileActualBody(body, schemas, []);
    assertNative44Compilation(compiled, compiled.composition);
    const nodes = (elements: typeof compiled.composition.elements): typeof elements => elements.flatMap(element => [element, ...nodes(element.elements)]);
    assert.equal(nodes(compiled.composition.elements).find(element => element.widgetType === 'heading')?.settings.title_color, 'rgb(200, 150, 0)');
    assert.equal((body.payload as any).program.blocks[0].children[0].widgetSettings.title_color, undefined);
  } finally { await f.cleanup(); }
});

test('new full replica visual review compares browser samples with frozen source packet values', async () => {
  const f = await actualFixture(); try {
    const program = JSON.parse(await readFile(f.manifest.body.program.path, 'utf8'));
    f.manifest.body.program = await f.put('visual-program.json', { ...program, reviewWorkflow: 'whole-page-after-css-v1', visualAuditVersion: 1 });
    const bound: FullReplicaBoundCheckpoint = { pageId: 999, runId: f.manifest.runId, headerId: 'header_test', editUrl: 'https://target.example/edit', previewUrl: 'https://target.example/preview', bodyHash: hash, cssHash: hash, documentHash: hash, headerHash: hash, menuHash: hash, styleHash: hash };
    const observedAt = new Date().toISOString(), fingerprint = fullReplicaFingerprint(bound);
    const review = { version: 1, kind: 'clonewp-full-replica-review', taskId: f.manifest.taskId, runId: f.manifest.runId, pageId: 999, fingerprint, decision: 'approved', observedAt, reviewerEvidence: f.manifest.sourceEvidence, viewports: [] } as FullReplicaReview;
    const report = { version: 1, kind: 'clonewp-full-replica-visual-audit', pageId: 999, fingerprint, width: 1920, height: 1080, screenshotSha256: hash, observedAt, modules: [{ sourceUnitId: 'wide/body', targetSelector: `.elementor-999 .${native44ModuleClass('hero')}`, visual: { solidBackground: null, texts: [{ text: 'Alder native body', color: 'rgb(50, 50, 50)', fontSize: '16px', lineHeight: '20px', x: 0 }], progress: [] } }] };
    const read = async (ref: FullReplicaFileRef, base = 'D:/cloneWP') => { const filename = path.resolve(base, ref.path), bytes = await readFile(filename); assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256); return { filename, bytes }; };
    let reference = await f.put('visual-review.json', report);
    const input = () => ({ manifest: f.manifest, bound, review, width: 1920, height: 1080, screenshotSha256: hash, reference, reviewDirectory: f.directory, targetHtml: `<div class="elementor-999"><div class="${native44ModuleClass('hero')}"></div></div>`, read });
    await assert.rejects(verifyFullReplicaVisualReview(input()), /mismatch:wide\/body:.*text color/);
    report.modules[0].visual.texts[0] = { text: 'Alder native body', color: '', fontSize: '', lineHeight: '', x: 0 };
    const moduleRow = structuredClone(report.modules[0]);
    reference = await f.put('visual-review.json', report);
    await assert.doesNotReject(verifyFullReplicaVisualReview(input()));
    await assert.rejects(verifyFullReplicaVisualReview({ ...input(), targetHtml: '<div class="elementor-999"></div>' }), /module_dom_identity/);
    report.modules = []; reference = await f.put('visual-review.json', report);
    await assert.rejects(verifyFullReplicaVisualReview(input()), /module_coverage/);
    f.manifest.body.program = await f.put('visual-program-v2.json', { ...program, reviewWorkflow: 'whole-page-after-css-v1', visualAuditVersion: 2 });
    report.modules = [moduleRow]; reference = await f.put('visual-review.json', report);
    await assert.rejects(verifyFullReplicaVisualReview(input()), /paint_coverage/);
    reference = await f.put('visual-review-v2.json', { ...report, modules: [{ ...moduleRow, visual: { ...moduleRow.visual, paintLayers: [] } }] });
    await assert.doesNotReject(verifyFullReplicaVisualReview(input()));
  } finally { await f.cleanup(); }
});
function nativeContract(origin: string): NativeHeaderContract {
  const slots = ['top-bar', 'general-header', 'header-bottom'] as const;
  return { kind: 'clonewp-whb-native-contract', version: 1, targetOrigin: origin, fingerprint: hash, structure: { id: 'root', type: 'root', content: slots.map(id => ({ id, type: 'row', params: {}, content: ['left', 'center', 'right'].map(position => ({ id: `${id}-${position}`, type: 'column', content: [] })) })) }, settings: {}, rowColumns: Object.fromEntries(slots.map(slot => [slot, { left: `${slot}-left`, center: `${slot}-center`, right: `${slot}-right` }])) as NativeHeaderContract['rowColumns'], rowSchema: { hide_desktop: { type: 'switcher', valueType: 'boolean', default: false } }, settingsSchema: {}, elements: { mainmenu: { type: 'mainmenu', schema: { menu_id: { type: 'select', valueType: 'string', resource: 'menu' } } } }, styleElement: { type: 'HTMLBlock', field: 'block_id', schema: { block_id: { type: 'select', valueType: 'string', resource: 'html-block' } } } };
}
async function adapterFlow(damageProtected = false, unknownHeaderStyle = false, bindingBefore = false, bindingRejected = false, motionMode?: 'success' | 'before' | 'after', publicationMode?: 'verified' | 'changed', navigationMode?: 'success' | 'after' | 'before' | 'drift' | 'return-after' | 'return-before', pageClaimDefaults = false, bodyBeforeFailure = false, navigationReturnMode?: 'success' | 'before' | 'after' | 'drift', sameCSS = false, menuReservation = false, interruptedStyle?: 'started'|'complete'|'drift', headerBeforeIntent = false) {
  const f = await actualFixture(!!navigationMode || !!navigationReturnMode), calls: string[] = []; let module: HeaderRemoteModule | null = null, page: FullReplicaRemotePage | null = null, globalHash = hash, sequence = 1000, connections = 0, closes = 0, reads = 0, revisionStarted = false;
  const content = menuReservation ? await contentFixture(f.manifest.runId) : undefined;
  if (content) { const menu = f.manifest.header!.plan.menus[0]; f.manifest.header!.plan = { ...structuredClone(f.manifest.header!.plan), menuContent: [{ ...content.entry, menuKey: menu.key, itemKey: menu.items[0].key }] }; await writeFile(f.manifestFile.path, JSON.stringify(f.manifest)); }
  if (sameCSS) { f.manifest.editorCompletionPolicy = { version: 1, mode: 'align-and-reopen', runtime: 'shared-owned-editor-v1' }; await writeFile(f.manifestFile.path, JSON.stringify(f.manifest)); }
  const dataHash = (value: unknown) => createHash('sha256').update(canonicalV2(value)).digest('hex'), receipts: any = {}, sync = () => { if (page && module) { const persisted = structuredClone(page); if (pageClaimDefaults) { delete persisted.settings.post_title; delete persisted.settings.post_status; } page.bodyHash = dataHash({ elements: persisted.elements, settings: persisted.settings }); persisted.bodyHash = page.bodyHash; module.pages[String(page.pageId)] = { pageId: page.pageId, postType: 'page', status: page.status, template: page.template, runId: page.runId, bodyHash: page.bodyHash, headerId: page.headerId, snapshotHash: dataHash(persisted) }; } };
  const header: HeaderModuleDriver = { async inspect() { sync(); const snapshot = { module: structuredClone(module), globalHash, defaultHeaderId: 'default_header', presetReferences: [], otherReferences: [] }; return { hash: headerJsonHash(snapshot), snapshot, contract: nativeContract(f.manifest.targetOrigin), resources: { targetOrigin: f.manifest.targetOrigin, menus: Object.fromEntries(Object.entries(module?.menus ?? {}).map(([key, menu]) => [key, { id: menu.id, slug: menu.slug }])), media: {}, styleBlockId: module?.style?.id ?? 0 } }; }, async mutate(identity, request) {
    const before = await header.inspect(identity); assert.equal(before.hash, request.expectedHash); assert.ok(module); calls.push(`header:${request.action}`); const payload = request.payload as any;
    if (request.action === 'menu') module.menus[payload.key] = { id: sequence++, slug: `alder-${payload.key}`, name: payload.name, items: payload.items.map((item: any, i: number) => ({ ...item, id: sequence++, order: i + 1, url: new URL(item.url, f.manifest.targetOrigin).href })) };
    else if (request.action === 'style') module.style = { id: module.style?.id ?? sequence++, css: payload.css };
    else if (request.action === 'header') module.header = structuredClone(payload.raw);
    else if (request.action === 'bind') { if (bindingRejected) throw Error('woodmart_header_driver_page_binding_precondition_changed'); assert.ok(page); assert.equal(page.bodyHash, payload.expectedBodyHash); page.headerId = identity.headerId; }
    else throw Error('No other generic mutation expected');
    module.receipts[request.operationId] = { action: request.action, payloadHash: headerJsonHash(payload), state: 'complete', result: {} }; const after = await header.inspect(identity); if (unknownHeaderStyle && request.action === 'style' && calls.filter(call => call === 'header:style').length === 2) throw Error('Synthetic response loss after committed style'); return { hash: after.hash, snapshot: after.snapshot, result: {} };
  } };
  if (content) header.prepareMenuContent = async () => undefined as any;
  const full: FullReplicaDriver = { async inspect(identity) { reads++; const observation = await header.inspect(identity); return { header: observation, page: structuredClone(page), receipts: structuredClone(receipts), hash: dataHash({ header: observation.snapshot, page, receipts }) }; }, async mutate(identity, request) {
    assert.equal((await full.inspect(identity)).hash, request.expectedHash); calls.push(`full:${request.action}`);
    if (request.action === 'motion' && motionMode === 'before') throw Error('Synthetic pre-write request loss');
    if (request.action === 'navigation-forms' && navigationMode === 'before') throw Error('Synthetic request loss before form insertion');
    if (request.action === 'navigation-return' && (navigationMode === 'return-before' || revisionStarted && navigationReturnMode === 'before')) throw Error('Synthetic request loss before return compatibility');
    let motionWidgetIds: string[] | undefined;
    if (request.action === 'create-page') { assert.equal(page, null); module = { identity, name: f.manifest.header!.plan.name, menus: {}, style: null, header: null, pages: {}, receipts: {} }; page = { pageId: sequence++, runId: f.manifest.runId, status: 'draft', template: 'elementor_header_footer', title: f.manifest.title, slug: f.manifest.slug, headerId: null, elements: [], settings: { template: 'elementor_header_footer', hide_title: 'yes' }, bodyHash: hash, built: true, publicUrl: `${f.manifest.targetOrigin}/${f.manifest.slug}/`, flags: { _woodmart_prefooter_off: '1', _woodmart_footer_off: '1', _woodmart_copyrights_off: '1' } }; }
    else if (request.action === 'style') { assert.ok(page); page.settings.custom_css = request.payload.css; page.settings.wd__woodmart_whb_header = identity.headerId; }
    else if (request.action === 'motion') { assert.ok(page); motionWidgetIds = []; const visit = (nodes: NonNullable<typeof page>['elements']) => { for (const node of nodes) { if (node.widgetType === 'nested-carousel') { node.settings.speed = 0; motionWidgetIds!.push(node.id); } visit(node.elements); } }; visit(page.elements); }
    else if (request.action === 'navigation-forms') { assert.ok(page); const patch = compileNavigationFormPatch(page.elements, request.payload.forms as any, String(request.payload.sourceUrl), String(request.payload.taskId)); page.elements = patch.elements; motionWidgetIds = patch.widgetIds; if (navigationMode === 'drift') page.settings.concurrent = true; }
    else if (request.action === 'navigation-return') { assert.ok(page); const patch = compileNavigationReturnPatch(page.elements, request.payload.forms as any, String(request.payload.sourceUrl), String(request.payload.taskId)); page.elements = patch.elements; motionWidgetIds = patch.widgetIds; if (revisionStarted && navigationReturnMode === 'drift') page.settings.concurrent = true; }
    else { assert.ok(page); page.status = 'publish'; }
    const result = { pageId: page!.pageId, ...(motionWidgetIds ? { widgetIds: motionWidgetIds } : {}) }; receipts[request.operationId] = { action: request.action, payloadHash: headerJsonHash(request.payload), state: 'complete', result }; const after = await full.inspect(identity);
    if(request.action==='style'&&interruptedStyle){if(interruptedStyle!=='complete'){receipts[request.operationId].state='started';delete receipts[request.operationId].result;}throw Error('Synthetic interrupted CSS response');}
    if (request.action === 'motion' && motionMode === 'after' || request.action === 'navigation-forms' && navigationMode === 'after' || request.action === 'navigation-return' && (navigationMode === 'return-after' || revisionStarted && navigationReturnMode === 'after')) throw Error('Synthetic loss after completed receipt'); return { snapshot: after, result };
  } };
  full.styleDiagnostics=async()=>({defaults:{},fatal:[{sha256:'b'.repeat(64),at:new Date().toISOString()}],lock:{}});
  full.recoverInterruptedStyle=async(identity,proof)=>{assert.equal(proof.current.hash,(await full.inspect(identity)).hash);calls.push('full:receipt-style');receipts[proof.originalOperationId]={action:'style',state:'complete',payloadHash:proof.originalPayloadHash,result:{pageId:page!.pageId}};return {snapshot:await full.inspect(identity),result:{pageId:page!.pageId}};};
  const client: FullReplicaRemoteServices['client'] = {
    async discoverCapabilities() { return { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, heading: { type: 'heading', class: 'Heading', controls: { _css_classes: { type: 'text' }, title: { type: 'textarea' } } }, html: { type: 'html', class: 'HTML', controls: { html: { type: 'code' } } }, 'nested-carousel': { type: 'nested-carousel', class: 'NestedCarousel', controls: { speed: { type: 'number', frontend_available: true } } } }, versions: { woodmart: 'fixture' }, limitations: [] }; },
    async createDraft(_run, _title, options) { assert.equal(options?.requireExistingPageId, page?.pageId); if (pageClaimDefaults) { page!.settings.post_title = page!.title; page!.settings.post_status = 'draft'; } return { pageId: page!.pageId, editUrl: `${f.manifest.targetOrigin}/wp-admin/post.php?post=${page!.pageId}&action=elementor`, status: 'draft' }; },
    async snapshotDraft() { assert.ok(page); const settings = { ...structuredClone(page.settings), ...(bodyBeforeFailure ? { unrelated_default: 'different' } : {}) }; return { pageId: page.pageId, runId: page.runId, title: page.title, status: 'draft', elements: structuredClone(page.elements), settings, hash: documentHashV2(page.elements, settings) }; },
    async buildDraft(_pageId, composition, _assets, options) { assertNative44Compilation(options?.native44Proof, composition); assert.ok(page); assert.ok('elements' in composition); assert.equal(options?.expectedCurrent.hash, documentHashV2(page.elements, page.settings)); calls.push('client:build'); page.elements = structuredClone(composition.elements); page.settings = { ...page.settings, ...composition.pageSettings }; if (damageProtected) globalHash = 'b'.repeat(64); sync(); return client.snapshotDraft(page.pageId); },
    async verifyImportedAssets() {}, async importAsset() { throw Error('No media required by synthetic fixture'); }, async inspectPendingAsset() { throw Error('No media required by synthetic fixture'); }, async readTargetPosts() { throw Error('No posts required by synthetic fixture'); }, async readTargetCatalog() { throw Error('No products required by synthetic fixture'); },
  };
  const deps = await createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: f.manifestFile.path, runDirectory: f.directory, manifest: f.manifest, async loadRemote() { connections++; return { client, full, header, async close() { closes++; } }; } });
  try {
    const result = await runFullReplica(f.manifest, { ...deps, ...(bindingBefore ? { async bindHeader() { throw Error('replica_full_body_driver_binding_body_changed'); } } : {}), async writeState() {} }); assert.ok('kind' in result); if (!('kind' in result)) throw Error('Unexpected legacy route');
    if(interruptedStyle){
      assert.equal(result.status,'write-unknown');assert.equal(result.pending?.phase,'body');const beforeCalls=[...calls];
      if(interruptedStyle==='drift'){page!.settings.concurrent='kept';sync();}
      const readonly=await reconcileFullReplica(f.manifest,{...deps,async writeState(){}},result);assert.deepEqual(calls,beforeCalls);
      if(interruptedStyle==='complete'){assert.equal(readonly.pending,null);assert.ok(readonly.checkpoints.body);await deps.close?.();return;}
      assert.ok(readonly.pending);
      const repair=await createFullReplicaDependencies({root:'D:/cloneWP',manifestPath:f.manifestFile.path,runDirectory:f.directory,manifest:f.manifest,recoverInterruptedStyle:true,async loadRemote(){return {client,full,header,async close(){}};}});
      if(interruptedStyle==='drift'){await assert.rejects(reconcileFullReplica(f.manifest,{...repair,async writeState(){}},result),/settings_changed/);assert.deepEqual(calls,beforeCalls);}
      else{const recovered=await reconcileFullReplica(f.manifest,{...repair,async writeState(){}},result);assert.equal(recovered.pending,null);assert.ok(recovered.checkpoints.body);assert.deepEqual(calls,[...beforeCalls,'full:receipt-style']);}
      await repair.close?.();await deps.close?.();return;
    }
    if (bodyBeforeFailure) {
      assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'body'); assert.equal(result.lastError?.code, 'replica_full_body_driver_body_before_changed'); assert.equal(calls.includes('client:build'), false);
      const prepared = { manifest: f.manifest, header: await deps.prepareHeader(f.manifest), body: await deps.prepareBody(f.manifest) } as any;
      const intent = await f.put(path.join('operations', `${result.pending!.operationId}-body-save-intent-${randomUUID()}.json`), {}); assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); await rm(intent.path);
      const mediaDirectory = path.join(f.directory, 'body-media', 'assets'); await mkdir(mediaDirectory, { recursive: true }); const ledger = await f.put(path.join('body-media', 'assets', 'ledger.json'), { version: 1, runId: f.manifest.runId, pageId: page!.pageId, assets: [{ key: 'unknown', status: 'unknown' }] }); assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); await rm(ledger.path);
      const previous = [...calls], reconciled = await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, result); assert.deepEqual(calls, previous); assert.equal(reconciled.pending, null); assert.equal(reconciled.checkpoints.body, undefined); assert.deepEqual(reconciled.checkpoints, result.checkpoints);
      const operationDirectory = path.join(f.directory, 'operations'); for (const name of await readdir(operationDirectory)) if (name.startsWith(result.pending!.operationId + '-')) await rm(path.join(operationDirectory, name));
      assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'before', 'loss before registration remains recoverable without a repeated save');
      const unrelated = await f.put(path.join('operations', `${result.pending!.operationId}-unknown-proof.json`), {}); assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); await rm(unrelated.path);
      page!.settings.concurrent = true; sync(); assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); assert.deepEqual(calls, previous); await deps.close?.(); return;
    }
    if (pageClaimDefaults) {
      assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'page'); assert.equal(result.lastError?.code, 'replica_full_body_driver_page_claim_changed');
      const directory = path.join(f.directory, 'operations'), files = await readdir(directory), writeProof = files.find(name => name.includes('-create-page-write-confirmed-')); assert.ok(writeProof);
      assert.equal(JSON.parse(await readFile(path.join(directory, writeProof), 'utf8')).value.fullSnapshot.page.settings.post_title, undefined, 'mutation success is durable before claiming the existing page');
      // The real older task has only its original durable intent and native confirmation.
      await rm(path.join(directory, writeProof));
      const prepared = { manifest: f.manifest, header: await deps.prepareHeader(f.manifest), body: await deps.prepareBody(f.manifest) } as any, receipt = Object.values(receipts)[0] as any, originalPayloadHash = receipt.payloadHash;
      receipt.payloadHash = 'b'.repeat(64); assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); receipt.payloadHash = originalPayloadHash;
      const originalTitle = page!.title; page!.title = 'concurrent title'; assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); page!.title = originalTitle;
      const previous = [...calls], reconciled = await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, result); assert.deepEqual(calls, previous); assert.equal(reconciled.pending, null); assert.equal(reconciled.checkpoints.page?.pageId, page!.pageId); assert.equal(reconciled.checkpoints.page?.bodyHash, page!.bodyHash); assert.equal(calls.filter(call => call === 'full:create-page').length, 1); await deps.close?.(); return;
    }
    if (navigationReturnMode) {
      assert.equal(result.status, 'awaiting-review');
      const legacy = (nodes: NonNullable<typeof page>['elements']): void => { for (const node of nodes) { if (node.widgetType === 'html' && typeof node.settings.html === 'string') node.settings.html = node.settings.html.replace(NAVIGATION_RETURN_RUNTIME, NAVIGATION_RETURN_V1_RUNTIME); legacy(node.elements); } }; legacy(page!.elements); sync();
      const seeded = await full.inspect(module!.identity); await checkpointHeaderModule(f.manifest.header!.bundleDirectory, header, seeded.header.hash);
      const current = structuredClone(result), documentHash = documentHashV2(page!.elements, page!.settings); current.checkpoints.body = { ...current.checkpoints.body!, bodyHash: page!.bodyHash, documentHash }; current.checkpoints.bound = { ...current.checkpoints.bound!, bodyHash: page!.bodyHash, documentHash }; current.review = await currentReviewFixture(f, current.checkpoints.bound); current.status = 'reviewed';
      const programBefore = await readFile(f.manifest.body.program.path, 'utf8'), cssBefore = await readFile(f.manifest.body.css.path, 'utf8'), beforeCount = calls.filter(call => call === 'full:navigation-return').length; revisionStarted = true;
      await assert.rejects(reviseFullReplicaNavigationReturn(f.manifest, { ...deps, async writeState() {} }, current, hash), /navigation_return_stale/);
      const revised = await reviseFullReplicaNavigationReturn(f.manifest, { ...deps, async writeState() {} }, current, fullReplicaFingerprint(current.checkpoints.bound));
      const previous = [...calls], outcome = navigationReturnMode === 'success' ? revised : await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, revised); assert.deepEqual(calls, previous); assert.equal(calls.filter(call => call === 'full:navigation-return').length, beforeCount + 1); assert.equal(outcome.review, null);
      if (navigationReturnMode === 'drift') { assert.ok(outcome.pending); assert.equal(outcome.status, 'write-unknown'); }
      else { assert.equal(outcome.pending, null); assert.equal(outcome.status, 'awaiting-review'); assert.equal(outcome.checkpoints.bound?.cssHash, current.checkpoints.bound.cssHash); assert.equal(outcome.checkpoints.bound?.headerHash, current.checkpoints.bound.headerHash); if (navigationReturnMode === 'before') assert.deepEqual(outcome.checkpoints, current.checkpoints); else assert.notEqual(outcome.checkpoints.body?.bodyHash, current.checkpoints.body.bodyHash); }
      assert.equal(await readFile(f.manifest.body.program.path, 'utf8'), programBefore); assert.equal(await readFile(f.manifest.body.css.path, 'utf8'), cssBefore); await deps.close?.(); return;
    }
    if (navigationMode) {
      assert.equal(calls.filter(call => call === 'client:build').length, 1); assert.equal(calls.filter(call => call === 'full:navigation-forms').length, 1);
      if (navigationMode === 'success') {
        assert.equal(result.status, 'awaiting-review'); assert.ok(result.checkpoints.bound); assert.equal(result.checkpoints.body?.bodyHash, page!.bodyHash);
        const names = await readdir(path.join(f.directory, 'operations')); assert.ok(names.some(name => name.includes('-navigation-form-patch-'))); assert.ok(names.some(name => name.includes('-navigation-forms-')));
      } else {
        assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'body'); assert.equal(calls.includes('header:bind'), false);
        const previous = [...calls], reconciled = await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, result); assert.deepEqual(calls, previous);
        if (navigationMode === 'return-after') { assert.equal(reconciled.pending, null); assert.equal(reconciled.checkpoints.body?.bodyHash, page!.bodyHash); assert.equal(reconciled.checkpoints.bound, undefined); }
        else { assert.ok(reconciled.pending); assert.equal(reconciled.checkpoints.body, undefined); }
      }
      await deps.close?.(); return;
    }
    if (publicationMode) {
      const bound = result.checkpoints.bound!, review = await currentReviewFixture(f, bound), before = reads;
      await deps.verifyReview(review, bound); assert.equal(reads - before, 1);
      if (publicationMode === 'changed') { page!.settings.hide_title = 'concurrent-change'; sync(); }
      const operation = { operationId: randomUUID(), taskId: f.manifest.taskId, runId: f.manifest.runId, phase: 'publish' as const, expectedCheckpointHash: hash, createdAt: new Date().toISOString() };
      if (publicationMode === 'changed') { await assert.rejects(deps.publishPage(bound, review, operation)); assert.equal(calls.includes('full:publish'), false); assert.equal(page!.status, 'draft'); }
      else { const published = await deps.publishPage(bound, review, operation); assert.equal(published.status, 'publish'); assert.equal(reads - before, 3, 'one verification plus server CAS and write readback; no duplicate preflight reads'); }
      await deps.close?.(); assert.equal(closes, 1); return;
    }
    if (motionMode) {
      // Seed a task-owned current native carousel to exercise the independent revision
      // protocol; this synthetic adapter test does not claim source/visual acceptance.
      page!.elements.push({ id: 'native-carousel-fixture', elType: 'widget', widgetType: 'nested-carousel', settings: { speed: 300, loop: 'yes' }, elements: [] }); sync();
      const seeded = await full.inspect(module!.identity); await checkpointHeaderModule(f.manifest.header!.bundleDirectory, header, seeded.header.hash);
      const current = structuredClone(result), bodyHash = page!.bodyHash, documentHash = documentHashV2(page!.elements, page!.settings); current.checkpoints.body = { ...current.checkpoints.body!, bodyHash, documentHash }; current.checkpoints.bound = { ...current.checkpoints.bound!, bodyHash, documentHash };
      const manifestBefore = await readFile(f.manifestFile.path, 'utf8'), cssBefore = await readFile(f.manifest.body.css.path, 'utf8'), revision = await reviseFullReplicaNativeMotion(f.manifest, { ...deps, async writeState() {} }, current, fullReplicaFingerprint(current.checkpoints.bound!));
      const outcome = motionMode === 'success' ? revision : await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, revision);
      assert.equal(outcome.pending, null); assert.equal(outcome.status, 'awaiting-review'); assert.equal(outcome.review, null); assert.equal(outcome.checkpoints.bound?.cssHash, current.checkpoints.bound.cssHash); assert.equal(outcome.checkpoints.bound?.headerHash, current.checkpoints.bound.headerHash); assert.equal(calls.filter(call => call === 'full:motion').length, 1); assert.equal(await readFile(f.manifestFile.path, 'utf8'), manifestBefore); assert.equal(await readFile(f.manifest.body.css.path, 'utf8'), cssBefore);
      if (motionMode === 'before') { assert.deepEqual(outcome.checkpoints, current.checkpoints); assert.equal(page!.elements.at(-1)?.settings.speed, 300); }
      else { assert.notEqual(outcome.checkpoints.body?.bodyHash, current.checkpoints.body.bodyHash); assert.equal(page!.elements.at(-1)?.settings.speed, 0); }
      assert.equal(connections, 1); await deps.close?.(); assert.equal(closes, 1); return;
    }
    if (bindingRejected) {
      assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'binding'); assert.equal(result.lastError?.code, 'woodmart_header_driver_page_binding_precondition_changed'); assert.equal(page!.headerId, null); assert.equal(calls.filter(call => call === 'header:bind').length, 1);
      const native = JSON.parse(await readFile(path.join(f.manifest.header!.bundleDirectory, 'state.json'), 'utf8')); assert.equal(native.pending.action, 'bind'); assert.equal(module!.receipts[native.pending.operationId], undefined);
      const proofName = (await readdir(path.join(f.directory, 'operations'))).find(name => name.includes('-native-binding-unconfirmed-')); assert.ok(proofName);
      const proof = JSON.parse(await readFile(path.join(f.directory, 'operations', proofName), 'utf8')); assert.deepEqual(proof.value, { code: result.lastError!.code, action: 'bind', nativeOperationId: native.pending.operationId, status: 'write-unknown' });
      await deps.close?.(); assert.equal(closes, 1); return;
    }
    if (bindingBefore) {
      assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'binding'); assert.equal(calls.includes('header:bind'), false);
      const prepared = { manifest: f.manifest, header: await deps.prepareHeader(f.manifest), body: await deps.prepareBody(f.manifest) } as any, previousCalls = [...calls], bad = structuredClone(result.checkpoints); bad.body!.cssHash = 'c'.repeat(64);
      assert.equal((await deps.reconcileOperation!(prepared, result.pending!, bad)).status, 'conflict');
      const originalStyle = structuredClone(module!.style!); module!.style!.css += '/* concurrent style edit */';
      assert.equal((await deps.reconcileOperation!(prepared, result.pending!, result.checkpoints)).status, 'conflict'); module!.style = originalStyle;
      const cleared = await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, result); assert.equal(cleared.pending, null); assert.equal(cleared.status, 'building'); assert.deepEqual(cleared.checkpoints, result.checkpoints); assert.deepEqual(calls, previousCalls);
      const resumed = await runFullReplica(f.manifest, { ...deps, async writeState() {} }, { state: cleared }); assert.ok('kind' in resumed); if (!('kind' in resumed)) throw Error('Unexpected legacy route');
      assert.equal(resumed.status, 'awaiting-review'); assert.equal(calls.filter(call => call === 'header:bind').length, 1); assert.equal(calls.filter(call => call === 'client:build').length, 1); assert.equal(calls.filter(call => call === 'full:create-page').length, 1);
      assert.equal(connections, 1); await deps.close?.(); assert.equal(closes, 1); return;
    }
    if (damageProtected) { assert.equal(result.status, 'write-unknown'); assert.equal(result.pending?.phase, 'body'); assert.equal(calls.includes('header:bind'), false); }
    else {
      assert.equal(result.status, 'awaiting-review'); assert.equal(result.checkpoints.bound?.pageId, 1000); assert.deepEqual(calls, ['full:create-page', 'header:menu', 'header:style', 'header:header', 'client:build', 'full:style', 'header:bind']); assert.equal(page!.template, 'elementor_header_footer'); assert.equal(module!.identity.headerId, result.checkpoints.bound?.headerId);
      if (sameCSS) {
        const copied = await f.put('same-content.css', await readFile(f.manifest.body.css.path, 'utf8')), beforeCalls = [...calls];
        const unchanged = await reviseFullReplicaStyle(f.manifest, { ...deps, async writeState() {} }, result, copied, fullReplicaFingerprint(result.checkpoints.bound!));
        assert.equal(unchanged.pending, null); assert.equal(unchanged.revision, result.revision); assert.deepEqual(unchanged.checkpoints, result.checkpoints); assert.deepEqual(calls, beforeCalls);
        // Equal CSS cannot bypass a changed body or global protection baseline.
        globalHash = 'b'.repeat(64);
        const blocked = await reviseFullReplicaStyle(f.manifest, { ...deps, async writeState() {} }, result, copied, fullReplicaFingerprint(result.checkpoints.bound!));
        assert.equal(blocked.status, 'write-unknown'); assert.match(blocked.lastError!.code, /protected_changed/); assert.deepEqual(calls, beforeCalls);
        globalHash = hash;
        const invalid = await f.put('invalid-style.css', ':root{color:red}');
        const preflightFailure = await reviseFullReplicaStyle(f.manifest, { ...deps, async writeState() {} }, result, invalid, fullReplicaFingerprint(result.checkpoints.bound!));
        assert.equal(preflightFailure.status, 'write-unknown'); assert.equal(preflightFailure.pending?.phase, 'style-revision'); assert.deepEqual(calls, beforeCalls);
        const reconciled = await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, preflightFailure);
        assert.equal(reconciled.status, 'awaiting-review'); assert.equal(reconciled.pending, null); assert.deepEqual(reconciled.checkpoints, result.checkpoints); assert.deepEqual(calls, beforeCalls);
        return;
      }
      if (headerBeforeIntent) {
        const operation = { operationId: randomUUID(), phase: 'header-style-revision' as const, taskId: f.manifest.taskId, runId: f.manifest.runId, expectedCheckpointHash: hash, createdAt: new Date().toISOString() };
        const beforeCalls = [...calls], outcome = await deps.reconcileOperation!({} as any, operation, result.checkpoints);
        assert.equal(outcome.status, 'before'); assert.deepEqual(calls, beforeCalls);
        return;
      }
      const frozenCSS = await readFile(f.manifest.body.css.path, 'utf8'), nextCSS = await f.put('qa-revision.css', ':page{color:green}'), revised = await reviseFullReplicaStyle(f.manifest, { ...deps, async writeState() {} }, result, nextCSS, fullReplicaFingerprint(result.checkpoints.bound!));
      assert.equal(revised.status, 'awaiting-review'); assert.equal(revised.review, null); assert.equal(revised.checkpoints.bound?.headerHash, result.checkpoints.bound?.headerHash); assert.notEqual(revised.checkpoints.bound?.cssHash, result.checkpoints.bound?.cssHash); assert.equal(calls.filter(call => call === 'client:build').length, 1); assert.deepEqual(calls.slice(7), ['full:style']); assert.equal(await readFile(f.manifest.body.css.path, 'utf8'), frozenCSS);
      const frozenManifest = await readFile(f.manifestFile.path, 'utf8'), styleId = module!.style!.id, headerCSS = await f.put('qa-header-revision.css', ':header{color:green}'), headerRevised = await reviseFullReplicaHeaderStyle(f.manifest, { ...deps, async writeState() {} }, revised, headerCSS, fullReplicaFingerprint(revised.checkpoints.bound!));
      const confirmed = unknownHeaderStyle ? await reconcileFullReplica(f.manifest, { ...deps, async writeState() {} }, headerRevised) : headerRevised;
      if (unknownHeaderStyle) { assert.equal(headerRevised.status, 'write-unknown'); assert.equal(headerRevised.pending?.phase, 'header-style-revision'); }
      assert.equal(confirmed.status, 'awaiting-review'); assert.equal(confirmed.pending, null); assert.equal(confirmed.review, null); assert.equal(module!.style!.id, styleId); assert.notEqual(confirmed.checkpoints.header?.styleHash, revised.checkpoints.header?.styleHash); assert.deepEqual(confirmed.checkpoints.body, revised.checkpoints.body); assert.equal(await readFile(f.manifestFile.path, 'utf8'), frozenManifest); assert.equal(f.manifest.header!.plan.style.css, ':header{color:black}'); assert.deepEqual(calls.slice(8), ['header:style']);
      assert.equal(JSON.parse(await readFile(path.join(f.directory, 'header-style-current.json'), 'utf8')).kind, 'clonewp-full-header-style-current');
      const secondCSS = await f.put('qa-body-second.css', ':page{color:blue}'), afterAmendment = await reviseFullReplicaStyle(f.manifest, { ...deps, async writeState() {} }, confirmed, secondCSS, fullReplicaFingerprint(confirmed.checkpoints.bound!));
      assert.equal(afterAmendment.status, 'awaiting-review'); assert.equal(afterAmendment.checkpoints.bound?.styleHash, confirmed.checkpoints.bound?.styleHash); assert.deepEqual(calls.slice(8), ['header:style', 'full:style']);
      const secondHeaderCSS = await f.put('qa-header-second.css', ':header{color:orange}'), secondHeader = await reviseFullReplicaHeaderStyle(f.manifest, { ...deps, async writeState() {} }, afterAmendment, secondHeaderCSS, fullReplicaFingerprint(afterAmendment.checkpoints.bound!));
      assert.equal(secondHeader.status, 'awaiting-review'); assert.deepEqual(secondHeader.checkpoints.body, afterAmendment.checkpoints.body); assert.notEqual(secondHeader.checkpoints.header?.styleHash, confirmed.checkpoints.header?.styleHash); assert.equal(module!.style!.id, styleId);
      const headerPath = path.join(f.manifest.header!.bundleDirectory, 'header.css'), currentCSS = await readFile(headerPath, 'utf8'); await writeFile(headerPath, ':header{color:pink}');
      const prepared = { header: await deps.prepareHeader(f.manifest), body: await deps.prepareBody(f.manifest) }, callsBefore = calls.length;
      await assert.rejects(deps.reviseStyle!(prepared as any, secondHeader.checkpoints.bound!, secondCSS, { operationId: randomUUID(), phase: 'style-revision', taskId: f.manifest.taskId, runId: f.manifest.runId, expectedCheckpointHash: hash, createdAt: new Date().toISOString() }), /unproven_plan_change/); assert.equal(calls.length, callsBefore); await writeFile(headerPath, currentCSS);
    }
    assert.equal(connections, 1); await deps.close?.(); assert.equal(closes, 1);
  } finally { await f.cleanup(); await content?.cleanup(); }
}
test('production factory composes real local preparation and compiler with the additive owned draft/header/body/bind flow', async () => adapterFlow());
test('page claim default drift recovers only the original completed empty-page receipt and exact native confirmation without creation retry', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, true));

test('menu-content reservation default drift reconciles its exact opt-in receipt without another page write', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, true, false, undefined, false, true));
test('body before recovery requires the unchanged empty page, no save intent and entirely confirmed media without writing again', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, true));
test('interrupted style explicitly finalizes only its receipt without another body or CSS save',async()=>adapterFlow(false,false,false,false,undefined,undefined,undefined,false,false,undefined,false,false,'started'));
test('completed style response loss reconciles read-only against the exact compiler and original intent',async()=>adapterFlow(false,false,false,false,undefined,undefined,undefined,false,false,undefined,false,false,'complete'));
test('interrupted style preserves an unrelated concurrent page setting without finalizing its receipt',async()=>adapterFlow(false,false,false,false,undefined,undefined,undefined,false,false,undefined,false,false,'drift'));
test('typed navigation insertion follows native proof save and becomes the final body and binding checkpoint', async () => adapterFlow(false, false, false, false, undefined, undefined, 'success'));
test('lost form insertion response remains in conflict until the required return runtime is also proven', async () => adapterFlow(false, false, false, false, undefined, undefined, 'after'));
test('lost new-body return response reconciles a completed exact receipt without another body save', async () => adapterFlow(false, false, false, false, undefined, undefined, 'return-after'));
test('lost new-body return request before mutation keeps the partial body in conflict', async () => adapterFlow(false, false, false, false, undefined, undefined, 'return-before'));
test('navigation loss before mutation keeps partial body in conflict without retrying', async () => adapterFlow(false, false, false, false, undefined, undefined, 'before'));
test('navigation insertion detects unrelated document drift and refuses recovery or binding', async () => adapterFlow(false, false, false, false, undefined, undefined, 'drift'));
test('typed form supplemental values and source hashes are checked before any authentication', async () => {
  const f = await actualFixture(true); try {
    let connections = 0;
    const make = () => createFullReplicaDependencies({ root: 'D:/cloneWP', manifestPath: f.manifestFile.path, runDirectory: f.directory, manifest: f.manifest, async loadRemote() { connections++; throw Error('No remote expected'); } });
    const value = f.manifest.body.navigationForms![0].fields[0].options[1].value; f.manifest.body.navigationForms![0].fields[0].options[1].value = 'invented';
    await assert.rejects((await make()).prepareBody(f.manifest), /typed_spec_changed/); assert.equal(connections, 0);
    f.manifest.body.navigationForms![0].fields[0].options[1].value = value;
    await writeFile(f.manifest.body.navigationForms![0].sourceEvidence.path, '{}');
    await assert.rejects((await make()).prepareBody(f.manifest), /input_hash_changed/); assert.equal(connections, 0);
  } finally { await f.cleanup(); }
});
test('explicit navigation-return revision preserves form/program/CSS and invalidates the current whole-page review', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, false, 'success'));
test('navigation-return revision can reconcile an unchanged before state without retry', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, false, 'before'));
test('navigation-return revision recovers only an exact completed receipt without another save', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, false, 'after'));
test('navigation-return revision refuses unrelated settings drift during recovery', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, false, 'drift'));
test('production factory detects protected state drift after body save and stops before binding', async () => adapterFlow(true));
test('a lost header style response reconciles from exact independent proof and native readback without repeating the write', async () => adapterFlow(false, true));
test('header style reconciliation clears an operation stopped before its intent only after unchanged remote readback', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, false, undefined, false, false, undefined, true));
test('a binding guard that sent no write reconciles only the exact unbound body and confirmed native before state', async () => adapterFlow(false, false, true));
test('the full binding adapter persists the native rejection code despite the old generic service catch', async () => adapterFlow(false, false, false, true));
test('production motion revision changes only the fixed native control and preserves frozen program/CSS', async () => adapterFlow(false, false, false, false, 'success'));
test('motion recovery confirms an unchanged before state without a mutation retry', async () => adapterFlow(false, false, false, false, 'before'));
test('motion recovery accepts only the completed exact receipt and patched current tree', async () => adapterFlow(false, false, false, false, 'after'));

async function currentReviewFixture(f: Awaited<ReturnType<typeof fixture>>, bound: FullReplicaBoundCheckpoint): Promise<FullReplicaReview> {
  const observedAt = new Date().toISOString(), fingerprint = fullReplicaFingerprint(bound), rows: any[] = [], viewports: FullReplicaReview['viewports'] = [];
  for (const [width, height] of [[1920, 1080], [1440, 1000]]) {
    const screenshot = await f.put(`speed-${width}.png`, await sharp({ create: { width, height, channels: 3, background: '#abc' } }).png().toBuffer());
    const dom = await f.put(`speed-${width}-dom.json`, { version: 1, kind: 'clonewp-full-replica-browser-dom', pageId: bound.pageId, url: bound.previewUrl, observedAt, viewport: { width, height }, html: `<header class="whb-header whb-${bound.headerId}"></header><div data-elementor-id="${bound.pageId}" class="elementor elementor-${bound.pageId}"><main>Synthetic boundary fixture</main></div>` });
    const state = { version: 1, kind: 'clonewp-full-replica-interaction-state', pageId: bound.pageId, fingerprint, width, height, selector: '.menu-toggle', observedAt };
    const before = await f.put(`speed-${width}-before.json`, { ...state, state: { open: false } }), after = await f.put(`speed-${width}-after.json`, { ...state, state: { open: true } });
    const interactions = await f.put(`speed-${width}-interactions.json`, { version: 1, kind: 'clonewp-full-replica-interactions', pageId: bound.pageId, fingerprint, width, height, reviewSummary: 'Synthetic independent evidence verifies the production publication boundary.', actions: [{ key: 'menu', kind: 'navigation', selector: '.menu-toggle', summary: 'Synthetic menu visibility changes.', expectedOutcome: 'changed', before, after }] });
    rows.push({ width, height, screenshot, dom, interactions }); viewports.push({ width, height, screenshot, visual: 'passed', interactions: 'passed', headerCount: 1, bodyHeaderCount: 0 });
  }
  const evidence = await f.put('speed-review-evidence.json', { version: 1, kind: 'clonewp-full-replica-review-evidence', taskId: f.manifest.taskId, runId: f.manifest.runId, pageId: bound.pageId, fingerprint, viewports: rows });
  return { version: 1, kind: 'clonewp-full-replica-review', taskId: f.manifest.taskId, runId: f.manifest.runId, pageId: bound.pageId, fingerprint, decision: 'approved', observedAt, reviewerEvidence: evidence, viewports };
}
test('production publish consumes the verified snapshot without duplicate evidence or remote reads', async () => adapterFlow(false, false, false, false, undefined, 'verified'));
test('server CAS still blocks a concurrent document change after cached verification', async () => adapterFlow(false, false, false, false, undefined, 'changed'));

test('identical compiled CSS reads current protection but causes no claim, save or revision', async () => adapterFlow(false, false, false, false, undefined, undefined, undefined, false, false, undefined, true));

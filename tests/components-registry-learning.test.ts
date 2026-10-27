import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readCurrentRelease, loadComponentRegistry, readLearningReleases, writeComponentRegistry } from '../src/components/registry.js';
import { componentCanonical, componentHash, componentFileRef, withComponentReadMetrics, readComponentBytes, writeComponentJson } from '../src/components/io.js';
import { componentCapabilitySummary, NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';
import { learnComponent, learnPage, studyComponentEvidence } from '../src/components/learning.js';
import { runLearningCli } from '../src/components/learn-cli.js';
import { assertAllowedWidget, NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { observationCountsV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';

const project = 'D:/cloneWP';
const fixtureRoots = new Set<string>();
after(async () => {
  const cache = await realpath(path.join(project, '.cache'));
  for (const root of fixtureRoots) {
    const resolved = await realpath(root);
    if (resolved !== path.resolve(root) || path.dirname(resolved) !== cache || !/^component-learning-test-[A-Za-z0-9]{6}$/.test(path.basename(resolved))) throw Error('Unsafe component learning fixture cleanup path');
    const assertNoLinks = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name), info = await lstat(filename);
        if (info.isSymbolicLink()) throw Error('Component learning fixture cleanup refuses reparse points');
        if (info.isDirectory()) await assertNoLinks(filename);
      }
    };
    await assertNoLinks(resolved);
    await rm(resolved, { recursive: true });
    await assert.rejects(lstat(resolved), { code: 'ENOENT' });
  }
});
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(project, '.cache/component-learning-test-'));
  fixtureRoots.add(root);
  for (const name of ['config/native44-component-set.json', 'data/native44', ...NATIVE44_ADAPTER_SOURCE_PATHS, 'src/native44/selection-rules.ts', 'src/native44/selection.ts', 'src/native44/page-context.ts']) {
    const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true }); await cp(path.join(project, name), target, { recursive: true });
  }
  await mkdir(path.join(root, 'tests/evidence'), { recursive: true });
  return root;
}
async function json(root: string, name: string, value: unknown) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`); return componentFileRef(root, name); }
async function sourceFixture(root: string, widgetType = 'future_card') {
  const codePath = `tests/evidence/${widgetType}.php`;
  await writeFile(path.join(root, codePath), `<?php class Example { public function get_name() { return '${widgetType}'; } protected function register_controls() { $this->add_control('title', ['type' => Controls_Manager::TEXT]); } }`);
  const source = await componentFileRef(root, codePath);
  const contract = await json(root, `tests/evidence/${widgetType}-contract.json`, { version: 1, kind: 'component-source-contract', widgetType, provider: 'example-provider', source, controls: [{ id: 'title', type: 'text' }] });
  const manifestName = `tests/evidence/${widgetType}-manifest.json`;
  const manifest = { version: 1, kind: 'component-learning-evidence', widgetType, provider: 'example-provider', evidence: [{ ...contract, kind: 'source-contract', scope: 'source-contract' }], conclusions: [{ responsibility: 'information-card', statement: 'A title setting is available in the studied component source.', evidenceIndexes: [0] }] };
  await json(root, manifestName, manifest);
  return { manifestName, manifest, contract, source };
}
async function pageFixture(root: string, widgetType?: string) {
  const directory = 'tests/evidence/page'; await mkdir(path.join(root, directory), { recursive: true });
  const image = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await writeFile(path.join(root, directory, 'screen.png'), image);
  const rect = { x: 0, y: 0, width: 1920, height: 1080 };
  const packet: ObservationPacketV2 = {
    version: 2, kind: 'observation-packet', snapshot: { id: 'desktop-one', url: 'https://example.com/', title: 'Source page', capturedAt: '2026-10-16T00:00:00Z', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1920, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 1080, screenshot: { path: 'screen.png', sha256: componentHash(image), width: 1920, height: 1080 } },
    nodes: { owner: { id: 'owner', parentId: null, regionId: 'main', tag: 'section', selector: '#main', attributes: widgetType ? { 'data-widget_type': `${widgetType}.default` } : {}, childIds: [], styleId: 'style', layoutId: 'layout', visible: true } },
    regions: [{ id: 'main', nodeId: 'owner', role: 'main-content', order: 0, contentNodeId: 'owner', gapBefore: 0 }],
    texts: { title: { id: 'title', nodeId: 'owner', regionId: 'main', text: 'A complete source section with ordinary information', kind: 'body' } }, styles: { style: { display: 'block' } },
    layouts: { layout: { id: 'layout', rect, contentRect: rect, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 } }, resources: {}, usages: {}, interactions: {}, gaps: [],
  };
  const packetRef = await json(root, `${directory}/packet.json`, packet);
  await json(root, `${directory}/observation-manifest.json`, { version: 2, kind: 'observation-manifest', sourceUrl: packet.snapshot.url, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [{ path: 'packet.json', sha256: packetRef.sha256, snapshotId: packet.snapshot.id, regionIds: ['main'], counts: observationCountsV2(packet), dependencies: [] }], screenshots: [{ path: 'screen.png', sha256: componentHash(image), snapshotId: packet.snapshot.id }] });
  await json(root, `${directory}/learning-conclusions.json`, { version: 1, kind: 'page-learning-conclusions', conclusions: [{ responsibility: 'body-content', statement: 'The visible description belongs to the same section owner.', snapshotId: packet.snapshot.id, ownerNodeIds: ['owner'] }] });
  return { directory, packet, packetRef, imageRef: await componentFileRef(root, `${directory}/screen.png`) };
}

test('component registry derives frozen44, scoped qualifications and adapter gaps without writes or target access', async () => {
  const root = await fixture(), before = await readdir(root); let fetchCalls = 0; const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls++; throw Error('Unexpected network'); }) as typeof fetch;
  try {
    const measured = await withComponentReadMetrics(() => readCurrentRelease(root)), release = measured.value;
    assert.equal(release.componentSet.types.length, 44); assert.equal(release.componentSet.catalog.sha256, NATIVE44_CATALOG_HASH); assert.equal(release.selectionRules.sha256, NATIVE44_SELECTION_RULES_HASH);
    for (const implementation of ['src/native44/environment.ts', 'src/wordpress/checkpoint.ts']) assert.ok(release.adapters.files.some(reference => reference.path.replaceAll('\\', '/') === implementation), `${implementation} must be frozen in the executable release`);
    assert.ok(measured.filesRead >= 15); assert.ok(measured.bytesRead > 1000);
    const registry = await loadComponentRegistry(root); assert.equal(registry.entries.length, 44); assert.equal(registry.enabledSet.widgetTypes.length, 44);
    assert.ok(registry.entries.every(entry => entry.activation === 'enabled' && entry.qualifications.resources.status === 'unverified'));
    assert.ok(registry.entries.every(entry => !Object.hasOwn(entry, 'targetRegistered')));
    const summary = componentCapabilitySummary(registry.adapters)[0]; assert.equal(summary.enabledComponentCount, 44); assert.equal(summary.writeBoundary, 'owned-draft-page-only');
    assert.ok(summary.conditionalComponents.some(entry => entry.widgetType === 'wd_sidebar' && entry.dependencies.includes('sidebar') && entry.status === 'unverified'));
    assert.equal(fetchCalls, 0); assert.deepEqual(await readdir(root), before);
  } finally { globalThis.fetch = oldFetch; }
});

test('component registry reads only requested component profiles and explicit snapshot is a derived view', async () => {
  const root = await fixture();
  const noComponents = await withComponentReadMetrics(() => loadComponentRegistry(root, []));
  const heading = await withComponentReadMetrics(() => loadComponentRegistry(root, ['heading']));
  const all = await withComponentReadMetrics(() => loadComponentRegistry(root));
  assert.deepEqual(noComponents.value.entries, []); assert.equal(heading.value.entries.length, 1); assert.equal(heading.value.entries[0].widgetType, 'heading');
  assert.equal(heading.filesRead, noComponents.filesRead + 1); assert.equal(all.filesRead, noComponents.filesRead + 44);
  await assert.rejects(loadComponentRegistry(root, ['heading', 'heading']), /duplicate_request/);
  await assert.rejects(loadComponentRegistry(root, ['unknown']), /unknown_component/);
  const saved = await writeComponentRegistry(root); assert.equal(saved.ref.path, 'data/system/component-registry.json'); assert.equal(saved.registry.fingerprint, all.value.fingerprint);
});

test('component read cache lasts one context load, counts actual IO and invalidates after explicit writes', async () => {
  const root = await fixture(); await json(root, 'tests/evidence/value.json', { value: 'before' });
  const result = await withComponentReadMetrics(async () => {
    const first = await readComponentBytes(root, 'tests/evidence/value.json');
    const second = await readComponentBytes(root, 'tests/evidence/value.json'); assert.deepEqual(first, second);
    first[0] = 0; assert.notEqual(first[0], (await readComponentBytes(root, 'tests/evidence/value.json'))[0]);
    await writeComponentJson(root, 'tests/evidence/value.json', { value: 'after' });
    return JSON.parse((await readComponentBytes(root, 'tests/evidence/value.json')).toString('utf8'));
  });
  assert.equal(result.value.value, 'after'); assert.equal(result.filesRead, 2);
  const fresh = await withComponentReadMetrics(() => readComponentBytes(root, 'tests/evidence/value.json')); assert.equal(fresh.filesRead, 1);
  let failedReads = 0;
  await assert.rejects(withComponentReadMetrics(async () => { await readComponentBytes(root, 'tests/evidence/value.json'); throw Error('expected'); }, metrics => { failedReads = metrics.filesRead; }), /expected/); assert.equal(failedReads, 1);
});

test('learning component45 appends knowledge without enabling writer or changing production release', async () => {
  const root = await fixture(), fixtureData = await sourceFixture(root), before = await readCurrentRelease(root), frozen = await readFile(path.join(root, 'data/native44/index.json'));
  const first = await learnComponent(root, 'future_card', fixtureData.manifestName), firstBytes = await readFile(path.join(root, first.releaseRef.path));
  assert.equal(first.record.mode, 'new-component-candidate'); assert.equal(first.record.qualification.source, 'source-studied'); assert.equal(first.record.qualification.save, 'unverified');
  const registry = await loadComponentRegistry(root), candidate = registry.entries.find(entry => entry.widgetType === 'future_card')!;
  assert.equal(registry.enabledSet.widgetTypes.length, 44); assert.equal(candidate.activation, 'adapter-pending'); assert.deepEqual(candidate.adapterRefs, []);
  assert.throws(() => assertAllowedWidget('future_card'), /not_allowed/); assert.deepEqual(await readCurrentRelease(root, { learningRelease: null }), before);
  const second = await learnComponent(root, 'future_card', fixtureData.manifestName); assert.notEqual(first.releaseRef.path, second.releaseRef.path); assert.deepEqual(second.release.previous, first.releaseRef);
  assert.deepEqual(await readFile(path.join(root, first.releaseRef.path)), firstBytes); assert.deepEqual(await readFile(path.join(root, 'data/native44/index.json')), frozen);
  assert.equal((await readLearningReleases(root, before.knowledge.fingerprint)).length, 2);
  assert.deepEqual((await readCurrentRelease(root)).knowledge.learningRelease, second.releaseRef);
  assert.deepEqual((await readCurrentRelease(root, { learningRelease: first.releaseRef })).knowledge.learningRelease, first.releaseRef);
  const frozenRegistry = await loadComponentRegistry(root, undefined, { learningRelease: first.releaseRef }); assert.equal(frozenRegistry.learningReleases.length, 1);
  assert.equal((await loadComponentRegistry(root, undefined, { learningRelease: null })).entries.length, 44);
  await json(root, 'data/system/knowledge-current.json', { version: 1, release: { path: 'learning/releases/missing.json', sha256: '0'.repeat(64) } });
  assert.equal((await loadComponentRegistry(root, undefined, { learningRelease: first.releaseRef })).learningReleases.length, 1);
  assert.deepEqual(await readCurrentRelease(root, { learningRelease: null }), before);
});

test('learning verifies source identity, real fields, hash and scope before publishing', async () => {
  const root = await fixture(), data = await sourceFixture(root);
  const badScope = structuredClone(data.manifest); badScope.evidence[0].scope = 'target-registration-observation'; await json(root, 'tests/evidence/bad.json', badScope);
  await assert.rejects(learnComponent(root, 'future_card', 'tests/evidence/bad.json'), /scope_mismatch/);
  const badHash = structuredClone(data.manifest); badHash.evidence[0].sha256 = '0'.repeat(64); await json(root, 'tests/evidence/bad.json', badHash);
  await assert.rejects(learnComponent(root, 'future_card', 'tests/evidence/bad.json'), /hash_mismatch/);
  const fakeContract = await json(root, 'tests/evidence/fake-contract.json', { version: 1, kind: 'component-source-contract', widgetType: 'future_card', provider: 'example-provider', source: data.source, controls: [{ id: 'missing_field', type: 'text' }] });
  const badField = structuredClone(data.manifest); badField.evidence[0] = { ...fakeContract, kind: 'source-contract', scope: 'source-contract' }; await json(root, 'tests/evidence/bad.json', badField);
  await assert.rejects(learnComponent(root, 'future_card', 'tests/evidence/bad.json'), /control_unproven/);
  await assert.rejects(learnComponent(root, 'another_card', data.manifestName), /identity_mismatch/);
  await assert.rejects(readFile(path.join(root, 'data/system/knowledge-current.json')), { code: 'ENOENT' });
});

test('learning rejects credentials, target URLs or resource defaults in reusable metadata', async () => {
  const root = await fixture(), data = await sourceFixture(root);
  const bad = structuredClone(data.manifest); bad.conclusions[0].statement = 'Use https://old.example.test/?token=secret'; await json(root, 'tests/evidence/bad.json', bad);
  await assert.rejects(learnComponent(root, 'future_card', 'tests/evidence/bad.json'), /secret|non_generic/);
  await json(root, 'tests/evidence/private-input.json', { ...data.manifest, password: 'never-export' });
  await assert.rejects(learnComponent(root, 'future_card', 'tests/evidence/private-input.json'), /contains_secret/);
  await assert.rejects(learnComponent(root, 'future_card', 'config/native44-component-set.json'), /path_not_allowed/);
  const code = `${(await readFile(path.join(root, data.source.path))).toString('utf8')}\n$applicationPassword = 'FAKE_SECRET';`;
  await writeFile(path.join(root, data.source.path), code);
  const changedSource = await componentFileRef(root, data.source.path), changedContract = await json(root, data.contract.path, { version: 1, kind: 'component-source-contract', widgetType: 'future_card', provider: 'example-provider', source: changedSource, controls: [{ id: 'title', type: 'text' }] });
  await json(root, data.manifestName, { ...data.manifest, evidence: [{ ...changedContract, kind: 'source-contract', scope: 'source-contract' }] });
  await assert.rejects(learnComponent(root, 'future_card', data.manifestName), /text_evidence_contains_secret/);
  await assert.rejects(readFile(path.join(root, 'data/system/knowledge-current.json')), { code: 'ENOENT' });
});

test('registered schema and DOM identity remain observations of their target, not global registration qualification', async () => {
  const root = await fixture(), data = await sourceFixture(root, 'heading'), page = await pageFixture(root, 'heading');
  const schema = await json(root, 'tests/evidence/registered.json', { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'text' } } });
  const manifest = { ...data.manifest, evidence: [{ ...schema, kind: 'registered-schema', scope: 'target-registration-observation' }, { ...page.packetRef, kind: 'dom-instance', scope: 'dom-instance-observation' }] };
  await json(root, 'tests/evidence/registered-manifest.json', manifest);
  const result = await learnComponent(root, 'heading', 'tests/evidence/registered-manifest.json');
  assert.equal(result.record.qualification.registration, 'task-local-only'); assert.equal(result.record.qualification.source, 'unverified');
  const entry = (await loadComponentRegistry(root, ['heading'])).entries[0]; assert.equal(entry.activation, 'enabled'); assert.equal(entry.qualifications.resources.status, 'unverified'); assert.equal(Object.hasOwn(entry.qualifications, 'registration'), false);
  const forged = { ...manifest, evidence: [{ ...await json(root, 'tests/evidence/empty-schema.json', { type: 'heading', class: 'Heading', controls: {} }), kind: 'registered-schema', scope: 'target-registration-observation' }] };
  await json(root, 'tests/evidence/registered-manifest.json', forged); await assert.rejects(learnComponent(root, 'heading', 'tests/evidence/registered-manifest.json'), /schema_invalid/);
});

test('local save/render replay verifies real document fields and pixels without certifying live usage', async () => {
  const root = await fixture(), data = await sourceFixture(root, 'heading'), page = await pageFixture(root, 'heading');
  const intended = await json(root, 'tests/evidence/intended.json', { elements: [{ id: 'head', elType: 'widget', widgetType: 'heading', settings: { title: 'Example title' }, elements: [] }] });
  const readback = await json(root, 'tests/evidence/readback.json', JSON.parse((await readFile(path.join(root, intended.path))).toString()));
  const save = await json(root, 'tests/evidence/save.json', { version: 1, kind: 'component-save-replay', widgetType: 'heading', elementId: 'head', intended, readback });
  const render = await json(root, 'tests/evidence/render.json', { version: 1, kind: 'component-render-replay', widgetType: 'heading', nodeId: 'owner', packet: page.packetRef, screenshot: page.imageRef });
  await json(root, 'tests/evidence/replay-manifest.json', { ...data.manifest, evidence: [{ ...save, kind: 'save-replay', scope: 'local-save-replay' }, { ...render, kind: 'render-replay', scope: 'local-render-replay' }] });
  const result = await learnComponent(root, 'heading', 'tests/evidence/replay-manifest.json'); assert.equal(result.record.qualification.save, 'local-replay-verified'); assert.equal(result.record.qualification.render, 'local-replay-verified');
  assert.equal((await loadComponentRegistry(root, ['heading'])).entries[0].qualifications.save.status, 'unverified');
  await json(root, readback.path, { elements: [{ id: 'head', elType: 'widget', widgetType: 'heading', settings: { title: 'Changed' }, elements: [] }] });
  await assert.rejects(studyComponentEvidence(root, 'heading', 'tests/evidence/replay-manifest.json'), /hash_mismatch/);
});

test('page learning binds desktop ownership and screenshots without inferring a widget from public appearance', async () => {
  const root = await fixture(), page = await pageFixture(root, 'heading'); let network = 0; const original = globalThis.fetch;
  globalThis.fetch = (async () => { network++; throw Error('network forbidden'); }) as typeof fetch;
  try {
    const result = await learnPage(root, 'https://example.com/', page.directory); assert.equal(result.record.kind, 'page-learning-record'); assert.equal(result.record.mode, 'page-pattern'); assert.equal(result.record.widgetType, undefined);
    assert.equal(result.record.qualification.source, 'unverified'); assert.equal(result.record.qualification.render, 'unverified'); assert.doesNotMatch(JSON.stringify(result.record), /https?:\/\/|productIds|defaultValue/);
    const registry = await loadComponentRegistry(root); assert.equal(registry.entries.length, 44); assert.equal(registry.pagePatterns.total, 1); assert.equal(registry.pagePatterns.entries[0].learningId, result.record.learningId); assert.equal(registry.pagePatterns.entries[0].conclusionStatus, 'candidate-interpretation'); assert.deepEqual(registry.pagePatterns.entries[0].recordRef, result.recordRef);
    assert.equal((await loadComponentRegistry(root, [], { learningRelease: null })).pagePatterns.total, 0);
    const frozen = await readCurrentRelease(root); await learnPage(root, 'https://example.com/', page.directory);
    assert.equal((await loadComponentRegistry(root, [], { learningRelease: frozen.knowledge.learningRelease })).pagePatterns.total, 1); assert.equal((await loadComponentRegistry(root, [])).pagePatterns.total, 2); assert.equal(network, 0);
    await assert.rejects(learnPage(root, 'https://different.example.com/', page.directory), /observation_invalid/);
    await json(root, `${page.directory}/learning-conclusions.json`, { version: 1, kind: 'page-learning-conclusions', conclusions: [{ responsibility: 'body', statement: 'A body paragraph is independently editable.', snapshotId: 'desktop-one', ownerNodeIds: ['missing'] }] });
    await assert.rejects(learnPage(root, 'https://example.com/', page.directory), /owner_missing/);
  } finally { globalThis.fetch = original; }
});

test('component evidence reads enforce limits before accepting bytes', async () => {
  const root = await fixture(); await writeFile(path.join(root, 'tests/evidence/size.txt'), 'more-than-four-bytes');
  await assert.rejects(readComponentBytes(root, 'tests/evidence/size.txt', 4), /too_large_or_invalid/);
});

test('an archived current learning chain preserves frozen evidence and subsequent learning starts a new chain', async () => {
  const root = await fixture(), page = await pageFixture(root, 'heading');
  const first = await learnPage(root, page.packet.snapshot.url, page.directory);
  const second = await learnPage(root, page.packet.snapshot.url, page.directory);
  const preserved = await Promise.all([first.recordRef, first.releaseRef, second.recordRef, second.releaseRef].map(async ref => ({ ref, bytes: await readFile(path.join(root, ref.path)) })));
  await json(root, 'data/system/knowledge-current.json', { version: 1, release: null });

  const base = await readCurrentRelease(root);
  assert.equal(base.knowledge.learningRelease, undefined);
  assert.deepEqual(await readLearningReleases(root, base.knowledge.fingerprint), []);
  assert.equal((await loadComponentRegistry(root, [])).pagePatterns.total, 0);
  const frozen = await loadComponentRegistry(root, [], { learningRelease: second.releaseRef });
  assert.equal(frozen.pagePatterns.total, 2);
  assert.deepEqual((await readCurrentRelease(root, { learningRelease: first.releaseRef })).knowledge.learningRelease, first.releaseRef);

  const next = await learnPage(root, page.packet.snapshot.url, page.directory);
  assert.equal(next.release.previous, undefined);
  assert.equal((await loadComponentRegistry(root, [])).pagePatterns.total, 1);
  assert.equal((await loadComponentRegistry(root, [], { learningRelease: second.releaseRef })).pagePatterns.total, 2);
  for (const item of preserved) assert.deepEqual(await readFile(path.join(root, item.ref.path)), item.bytes);
  assert.equal((await readCurrentRelease(root)).componentSet.types.length, 44);
});

test('interaction learning requires widget ownership, changed DOM state and changed bound screenshots', async () => {
  const root = await fixture(), data = await sourceFixture(root, 'heading'), page = await pageFixture(root, 'heading');
  const before = structuredClone(page.packet); before.interactions.open = { id: 'open', nodeId: 'owner', regionId: 'main', kind: 'navigation', status: 'observed', controlNodeIds: ['owner'], details: { expanded: false } };
  const beforeRef = await json(root, 'tests/evidence/before.json', before), after = structuredClone(before); after.interactions.open.details.expanded = true;
  const dark = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#000000' } }).png().toBuffer(); await writeFile(path.join(root, 'tests/evidence/after.png'), dark);
  const darkRef = await componentFileRef(root, 'tests/evidence/after.png'); after.snapshot.screenshot = { ...after.snapshot.screenshot, sha256: darkRef.sha256, path: 'after.png' };
  let afterRef = await json(root, 'tests/evidence/after.json', after);
  const replay = { version: 1, kind: 'component-interaction-replay', widgetType: 'heading', interactionId: 'open', before: beforeRef, after: afterRef, beforeScreenshot: page.imageRef, afterScreenshot: darkRef };
  let replayRef = await json(root, 'tests/evidence/interaction.json', replay);
  const manifest = { ...data.manifest, evidence: [{ ...replayRef, kind: 'interaction-replay', scope: 'local-interaction-replay' }] };
  await json(root, 'tests/evidence/interaction-manifest.json', manifest); await assert.rejects(studyComponentEvidence(root, 'heading', 'tests/evidence/interaction-manifest.json'), /dom_state_unchanged/);
  after.nodes.owner.attributes['aria-expanded'] = 'true'; afterRef = await json(root, 'tests/evidence/after.json', after);
  replayRef = await json(root, 'tests/evidence/interaction.json', { ...replay, after: afterRef });
  await json(root, 'tests/evidence/interaction-manifest.json', { ...manifest, evidence: [{ ...replayRef, kind: 'interaction-replay', scope: 'local-interaction-replay' }] });
  const result = await learnComponent(root, 'heading', 'tests/evidence/interaction-manifest.json'); assert.equal(result.record.qualification.interaction, 'local-replay-verified'); assert.equal(result.record.conclusionStatus, 'candidate-interpretation');
});

test('learning CLI exposes only knowledge publications and structured local failures', async () => {
  const root = await fixture(), data = await sourceFixture(root); const output: string[] = [];
  assert.equal(await runLearningCli(['component', '--widget', 'future_card', '--evidence', data.manifestName], { root, write: text => output.push(text) }), 0);
  const result = JSON.parse(output[0]); assert.equal(result.status, 'knowledge-published'); assert.equal(result.metrics.siteWrites, 0); assert.equal(result.metrics.remoteRequests, 0); assert.equal(result.enabledComponentCount, 44);
  assert.equal(await runLearningCli(['component', '--widget', 'future_card'], { root, write: text => output.push(text) }), 1); assert.equal(JSON.parse(output[1]).status, 'blocked');
  assert.equal(componentHash(componentCanonical((await readCurrentRelease(root)).adapters.files)), (await readCurrentRelease(root)).adapters.sha256);
});

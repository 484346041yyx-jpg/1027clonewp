import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { observationCountsV2, validateObservationPacketV2, readObservationDirectoryV2, sha256, type ObservationPacketV2, type ObservationManifestV2, type ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import { assertSourceFactsExtensionV2, buildSourceFactsV2, prepareObservedReferenceV2, prepareReferenceV2, verifySourceFactsEvidenceV2 } from '../src/replica-v2/source.js';
import { validateComponentPlanV2, type ComponentPlanV2 } from '../src/replica-v2/component-plan.js';
import { bindSceneInventoryNodesV2, validateSceneInventoryV2, type SceneInventoryV2 } from '../src/replica-v2/scene-inventory.js';

function packet(snapshotId = 'desktop-scene', viewport = 'desktop'): ObservationPacketV2 {
  const layout = (id: string, x = 240, y = 40, width = 1440, height = 200) => ({ id, rect: { x, y, width, height }, contentRect: { x: x + 20, y: y + 10, width: width - 40, height: height - 20 }, padding: [10, 20, 10, 20] as [number, number, number, number], margin: [0, 0, 0, 0] as [number, number, number, number], gap: { row: 16, column: 16 }, display: 'grid', position: 'static', maxWidth: '1440px', direction: 'row', flowIndex: 0 });
  const nodes: ObservationPacketV2['nodes'] = {};
  const layouts: ObservationPacketV2['layouts'] = {}, styles: ObservationPacketV2['styles'] = {};
  for (const [id, tag, parentId, childIds] of [['outer', 'header', null, ['track', 'next']], ['track', 'div', 'outer', ['card-a', 'card-b']], ['card-a', 'article', 'track', ['heading-a', 'image-a']], ['card-b', 'article', 'track', ['heading-b', 'image-b']], ['heading-a', 'h3', 'card-a', []], ['heading-b', 'h3', 'card-b', []], ['image-a', 'img', 'card-a', []], ['image-b', 'img', 'card-b', []], ['next', 'button', 'outer', []]] as const) {
    nodes[id] = { id, parentId, tag, childIds: [...childIds], attributes: {}, regionId: 'opaque-region-938', selector: `#${id}`, styleId: `s-${id}`, layoutId: `l-${id}`, visible: true }; layouts[`l-${id}`] = layout(`l-${id}`); styles[`s-${id}`] = { display: 'grid', 'background-color': '#ffc600' };
  }
  nodes['heading-b'].visible = viewport === 'mobile'; nodes['heading-a'].visible = viewport !== 'mobile';
  return { version: 2, kind: 'observation-packet', snapshot: { id: snapshotId, url: 'https://8.8.8.8/', title: 'A normally loaded public pet shop', capturedAt: '2026-10-15T00:00:00.000Z', viewport: { name: viewport, width: 1920, height: 1080, clientWidth: 1905, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: 1080, screenshot: { path: `${snapshotId}.png`, sha256: 'a'.repeat(64), width: 1920, height: 1080 } }, nodes, regions: [{ id: 'opaque-region-938', nodeId: 'outer', contentNodeId: 'track', role: 'header', order: 0, gapBefore: 46 }], texts: { 'text-a': { id: 'text-a', nodeId: 'heading-a', regionId: 'opaque-region-938', text: 'Desktop card heading with complete public shop wording', kind: 'heading', level: 3 }, 'text-b': { id: 'text-b', nodeId: 'heading-b', regionId: 'opaque-region-938', text: 'Mobile version of the same content', kind: 'heading', level: 3 } }, styles, layouts, resources: { photo: { id: 'photo', url: 'https://8.8.8.8/photo.png', kind: 'image' }, leaf: { id: 'leaf', url: 'https://8.8.8.8/leaf.png', kind: 'background' } }, usages: { a: { id: 'a', nodeId: 'image-a', regionId: 'opaque-region-938', resourceId: 'photo', kind: 'picture', visible: true }, b: { id: 'b', nodeId: 'image-b', regionId: 'opaque-region-938', resourceId: 'photo', kind: 'img', visible: true }, bg: { id: 'bg', nodeId: 'outer', regionId: 'opaque-region-938', resourceId: 'leaf', kind: 'background', attribute: 'background-image', visible: true } }, interactions: { slider: { id: 'slider', nodeId: 'outer', regionId: 'opaque-region-938', kind: 'carousel', status: 'declared', trackNodeId: 'track', itemNodeIds: ['card-a', 'card-b'], cloneNodeIds: [], controlNodeIds: ['next'], details: { behaviorVerified: false } } }, gaps: [] };
}
function observation(packets = [packet()]): ValidatedObservationV2 {
  return { manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'https://8.8.8.8/', provenance: { method: 'user-opened-browser', browser: 'chrome', observer: 'cua_repl' }, packets: [], screenshots: [] }, manifestPath: 'D:/cloneWP/references/current/observation-manifest.json', manifestSha256: 'b'.repeat(64), packets, packetFiles: packets.map((packet, i) => ({ path: `D:/cloneWP/references/current/packet-${i}.json`, sha256: 'c'.repeat(64), snapshotId: packet.snapshot.id })) };
}
function plan(source = buildSourceFactsV2(observation())): ComponentPlanV2 {
  return { version: 2, kind: 'component-plan', sourceFacts: { path: 'D:/cloneWP/references/current/source-facts.json', sha256: 'd'.repeat(64) }, desktopSnapshotId: 'desktop-scene', components: [{ id: 'header-block', parentId: null, role: 'header', renderer: 'composite', editability: 'mixed', sourceRegionIds: ['opaque-region-938'], itemSlots: [{ id: 'first-card', nodeIds: ['card-a'] }, { id: 'second-card', nodeIds: ['card-b'] }], variants: source.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['outer'], visible: true })), firstFold: true }], requirements: Object.values(source.facts).map((fact, index) => ({ id: `requirement-${index}`, factIds: [fact.id], componentId: 'header-block', disposition: 'preserve', rule: 'Retain independently captured source ownership and visible presentation', verification: { kind: fact.kind === 'text' ? 'text' : fact.kind === 'media' ? 'media' : 'presence', selector: '.header-block', snapshotId: fact.snapshotId, ...(fact.kind === 'text' ? { expected: { text: fact.value.text, visible: fact.value.visible } } : fact.kind === 'media' ? { expected: { assetKey: 'current-asset' } } : {}) } })) };
}
function inventory(value = packet()): SceneInventoryV2 {
  return { version: 2, kind: 'scene-inventory', snapshotId: value.snapshot.id, sourceUrl: value.snapshot.url, capturedAt: value.snapshot.capturedAt, viewport: { name: value.snapshot.viewport.name, width: value.snapshot.viewport.width, height: value.snapshot.viewport.height }, regions: [{ id: value.regions[0].id, selector: '#outer' }], entries: { entry: { id: 'entry', selector: '#heading-a', ownerRegionId: value.regions[0].id, kind: 'text', label: value.texts['text-a'].text, rect: value.layouts['l-heading-a'].rect } }, counts: { total: 1, text: 1, media: 0, control: 0, assigned: 1, unassigned: 0, vendorUtilities: 0 } };
}

test('scene utilities recognize the precise Smile loyalty provider without accepting generic rewards or owned content', () => {
  const vendor = (marker: string) => {
    const value=inventory();
    value.entries.entry.ownerRegionId=null;
    value.entries.entry.utility={kind:'source-vendor',marker};
    value.counts.assigned=0;value.counts.vendorUtilities=1;
    return value;
  };
  for(const marker of ['smile.io','js.smile.io','https://js.smile.io/v1/smile-shopify.js','https://js.smile.io/v1/smile-lite-7c2b649db2.js']) {
    assert.doesNotThrow(()=>validateSceneInventoryV2(vendor(marker)));
  }
  for(const marker of ['loyalty','rewards','loyalty-rewards','first-party-rewards','smile','notsmile.io','smile.io.evil.example','https://example.com/smile.io/rewards','https://smile.io@evil.example/rewards']) {
    assert.throws(()=>validateSceneInventoryV2(vendor(marker)),/real feedback\/chat\/loyalty vendor marker/);
  }
  const owned=vendor('smile.io');
  owned.entries.entry.ownerRegionId=owned.regions[0].id;owned.counts.assigned=1;
  assert.throws(()=>validateSceneInventoryV2(owned),/both region-owned and an external utility/);
});

test('flat facts retain CSS backgrounds, repeated image usages, card h3 parents, composite header and parent controls', () => {
  const value = validateObservationPacketV2(packet()), source = buildSourceFactsV2(observation([value]));
  assert.equal(source.snapshots[0].nodes['heading-a'].parentId, 'card-a');
  assert.equal(source.snapshots[0].nodes['heading-b'].parentId, 'card-b');
  assert.equal(Object.values(source.facts).filter(fact => fact.kind === 'media').length, 3);
  assert.equal((source.facts['desktop-scene:media:bg'].value.resource as { kind: string }).kind, 'background');
  assert.equal(source.facts['desktop-scene:region:opaque-region-938'].value.gapBefore, 46);
  assert.deepEqual(source.facts['desktop-scene:interaction:slider'].value.controlNodeIds, ['next']);
  const result = validateComponentPlanV2(plan(source), source, { stage: 'desktop' });
  assert.equal(result.components[0].renderer, 'composite'); assert.deepEqual(result.components[0].itemSlots?.map(item => item.nodeIds), [['card-a'], ['card-b']]);
});

test('responsive identity maps explicit nodes and preserves mutually exclusive source visibility without text union', () => {
  const source = buildSourceFactsV2(observation([packet(), packet('mobile-scene', 'mobile'), packet('tablet-scene', 'tablet')]));
  const result = validateComponentPlanV2(plan(source), source, { stage: 'responsive' });
  assert.equal(result.components[0].variants.length, 3);
  assert.equal(source.facts['desktop-scene:text:text-b'].value.visible, false);
  assert.equal(source.facts['mobile-scene:text:text-b'].value.visible, true);
  assert.equal(Object.values(source.facts).filter(fact => fact.kind === 'text').length, 6);
});

test('truncation, nonfinite geometry, missing ownership and dangling references fail before compilation', () => {
  let value = packet(); value.styles['s-outer'].display = '[MaxDepth]'; assert.throws(() => validateObservationPacketV2(value), /truncated/);
  value = packet(); value.layouts['l-outer'].rect.x = NaN; assert.throws(() => validateObservationPacketV2(value), /non-finite/);
  value = packet(); value.nodes.outer.regionId = 'unknown'; assert.throws(() => validateObservationPacketV2(value), /unknown region/);
  value = packet(); value.interactions.slider.controlNodeIds = ['not-real']; assert.throws(() => validateObservationPacketV2(value), /dangling reference/);
  value = packet(); value.nodes.outer.parentId = 'heading-a'; assert.throws(() => validateObservationPacketV2(value), /cyclic|reciprocal/);
});

test('all facts require dispositions, responsive evidence is staged, HTML is code-editable, unknown facts cannot disappear', () => {
  const source = buildSourceFactsV2(observation()), value = plan(source);
  assert.doesNotThrow(() => validateComponentPlanV2(value, source, { stage: 'desktop' }));
  assert.throws(() => validateComponentPlanV2(value, source, { stage: 'responsive' }), /actual tablet/);
  const omitted = structuredClone(value); omitted.requirements.pop(); assert.throws(() => validateComponentPlanV2(omitted, source), /no preserve/);
  const wrong = structuredClone(value); wrong.components[0].renderer = 'html'; assert.throws(() => validateComponentPlanV2(wrong, source), /code editing/);
  wrong.components[0].editability = 'code'; assert.doesNotThrow(() => validateComponentPlanV2(wrong, source));
  const duplicate = structuredClone(value); duplicate.requirements.push({ ...duplicate.requirements[0], id: 'duplicate' }); assert.throws(() => validateComponentPlanV2(duplicate, source), /multiple dispositions/);
  const unknown = structuredClone(value); unknown.requirements[0].factIds = ['invented']; assert.throws(() => validateComponentPlanV2(unknown, source), /unknown source fact/);
  const fakeText = structuredClone(value), textRequirement = fakeText.requirements.find(requirement => requirement.verification.kind === 'text')!; textRequirement.verification.kind = 'presence'; assert.throws(() => validateComponentPlanV2(fakeText, source), /own actual text verification/);
  textRequirement.verification.kind = 'text'; textRequirement.verification.expected = 'Invented rewrite'; assert.throws(() => validateComponentPlanV2(fakeText, source), /actual normalized source wording/);
  const fakeMedia = structuredClone(value); fakeMedia.requirements.find(requirement => requirement.verification.kind === 'media')!.verification.expected = undefined; assert.throws(() => validateComponentPlanV2(fakeMedia, source), /registered asset identity/);
});

test('external and adapted behaviors carry real verification rules; arbitrary JSON geometry is accepted', () => {
  const source = buildSourceFactsV2(observation()), value = plan(source);
  value.requirements[0] = { ...value.requirements[0], disposition: 'external', verification: { kind: 'external', selector: 'a.search', expected: 'https://8.8.8.8/search/' } };
  value.requirements[1] = { ...value.requirements[1], disposition: 'adapt', rule: 'Manual arrows replace autoplay when pause is unsupported', verification: { kind: 'layout', selector: '.header', expected: { x: 240, width: 1440, padding: [0, 20] }, tolerance: 4 } };
  assert.doesNotThrow(() => validateComponentPlanV2(value, source));
  value.requirements[0].verification.expected = '/made-up'; assert.throws(() => validateComponentPlanV2(value, source), /actual absolute href/);
});

test('source facts revisions may append responsive observations but cannot rewrite desktop bytes or facts', () => {
  const desktop = buildSourceFactsV2(observation()), responsive = buildSourceFactsV2(observation([packet(), packet('tablet-scene', 'tablet'), packet('mobile-scene', 'mobile')]));
  assert.doesNotThrow(() => assertSourceFactsExtensionV2(desktop, responsive));
  const altered = structuredClone(responsive); altered.facts['desktop-scene:text:text-a'].value.text = 'Rewritten wording'; assert.throws(() => assertSourceFactsExtensionV2(desktop, altered), /changed previously captured fact/);
  const removed = structuredClone(responsive); delete removed.facts['desktop-scene:media:bg']; assert.throws(() => assertSourceFactsExtensionV2(desktop, removed), /changed previously captured fact/);
});

test('source gaps block completion stages, and only verified owned decorative adaptations may resolve them', () => {
  const source = buildSourceFactsV2(observation([packet(), packet('tablet-scene', 'tablet'), packet('mobile-scene', 'mobile')]));
  source.gaps.push({ snapshotId: 'mobile-scene', code: 'unsupported-icon', nodeId: 'image-a', message: 'Source decorative icon is unavailable as an image' });
  const value = plan(source);
  assert.doesNotThrow(() => validateComponentPlanV2(value, source, { stage: 'desktop' }));
  assert.throws(() => validateComponentPlanV2(value, source, { stage: 'responsive' }), /remains unresolved/);
  const requirement = value.requirements.find(item => item.factIds.includes('mobile-scene:media:a'))!; requirement.disposition = 'adapt'; requirement.rule = 'Use verified current-job icon substitute';
  value.gapResolutions = [{ snapshotId: 'mobile-scene', code: 'unsupported-icon', nodeId: 'image-a', componentId: 'header-block', rule: 'Verified substitute retains decorative responsibility', requirementId: requirement.id }];
  assert.doesNotThrow(() => validateComponentPlanV2(value, source, { stage: 'final' }));
  const unknown = structuredClone(source); unknown.gaps[0].code = 'unknown-owner'; const unknownPlan = structuredClone(value); unknownPlan.gapResolutions![0].code = 'unknown-owner';
  assert.throws(() => validateComponentPlanV2(unknownPlan, unknown, { stage: 'final' }), /cannot be adapted/);
  for (const code of ['capture-failure', 'truncation', 'unsafe-url']) { const broken = structuredClone(source), attempted = structuredClone(value); broken.gaps[0].code = code; attempted.gapResolutions![0].code = code; assert.throws(() => validateComponentPlanV2(attempted, broken, { stage: 'final' }), /cannot be adapted/); }
  const unbound = structuredClone(value); unbound.gapResolutions![0].requirementId = unbound.requirements[0].id; assert.throws(() => validateComponentPlanV2(unbound, source, { stage: 'final' }), /explicit adaptation|actual source node/);
  const desktopGap = structuredClone(source); desktopGap.gaps.push({ snapshotId: 'desktop-scene', code: 'capture-failure', message: 'Required source screenshot was not captured' }); assert.throws(() => validateComponentPlanV2(value, desktopGap, { stage: 'desktop' }), /remains unresolved/);
});

test('whole-page inventory rejects unassigned content and proves actual source-node/text ownership independently of authored regions', () => {
  const source = buildSourceFactsV2(observation()), scene = inventory(), value = plan(source);
  source.sceneInventories = [{ snapshotId: scene.snapshotId, path: 'D:/cloneWP/references/current/scene-inventory.json', sha256: 'e'.repeat(64) }];
  assert.throws(() => validateComponentPlanV2(value, source), /must be loaded from actual bytes/);
  assert.doesNotThrow(() => validateComponentPlanV2(value, source, { sceneInventories: [scene] }));
  const invented = structuredClone(scene); invented.entries.entry.selector = '#not-captured'; assert.throws(() => validateComponentPlanV2(value, source, { sceneInventories: [invented] }), /absent or ambiguous/);
  const missingText = structuredClone(scene); missingText.entries.entry.label = 'A new uncaptured static promotion'; assert.throws(() => validateComponentPlanV2(value, source, { sceneInventories: [missingText] }), /differs from the actual source facts/);
  const unassigned = structuredClone(scene); unassigned.entries.entry.ownerRegionId = null; unassigned.counts.assigned = 0; unassigned.counts.unassigned = 1; assert.throws(() => validateComponentPlanV2(value, source, { sceneInventories: [unassigned] }), /remains unassigned/);
  const vendor = structuredClone(unassigned); vendor.entries.entry.utility = { kind: 'source-vendor', marker: 'feedback' }; vendor.counts.unassigned = 0; vendor.counts.vendorUtilities = 1;
  assert.throws(() => validateComponentPlanV2(value, source, { sceneInventories: [vendor] }), /unverified vendor/);
  value.requirements[0].disposition = 'adapt'; value.requirements[0].verification.expected = true;
  value.inventoryResolutions = [{ snapshotId: scene.snapshotId, entryIds: ['entry'], componentId: 'header-block', rule: 'Source vendor feedback remains on the external source website and is not embedded into this draft', requirementId: value.requirements[0].id }];
  assert.doesNotThrow(() => validateComponentPlanV2(value, source, { sceneInventories: [vendor] }));
  assert.throws(() => validateComponentPlanV2(value, source, { sceneInventories: [unassigned] }), /Only an independently marked/);
  assert.throws(() => validateSceneInventoryV2({ ...scene, counts: { ...scene.counts, total: 2 } }), /count mismatch/);
  const roots = { 'opaque-region-938': { nodeId: 'outer', selector: '#outer' } };
  assert.equal(bindSceneInventoryNodesV2(scene, source.snapshots[0].nodes, roots).entry, 'heading-a');
});

test('only an explicit native-controller adaptation explains an independently observed dynamic counter state change', () => {
  const value = packet(); value.texts['text-a'].text = '3 / 6'; const source = buildSourceFactsV2(observation([value])), scene = inventory(value), componentPlan = plan(source);
  source.sceneInventories = [{ snapshotId: scene.snapshotId, path: 'D:/cloneWP/references/current/scene-inventory.json', sha256: 'e'.repeat(64) }]; scene.entries.entry.label = '4 / 6';
  assert.throws(() => validateComponentPlanV2(componentPlan, source, { sceneInventories: [scene] }), /without a verified dynamic-counter adaptation/);
  const requirement = componentPlan.requirements.find(item => item.factIds.includes('desktop-scene:text:text-a'))!; requirement.disposition = 'adapt'; requirement.verification = { kind: 'interaction', property: 'carousel', selector: '.actual-native-carousel', expected: { manual: true } };
  assert.doesNotThrow(() => validateComponentPlanV2(componentPlan, source, { sceneInventories: [scene] }));
  scene.entries.entry.label = '4 / 10'; assert.throws(() => validateComponentPlanV2(componentPlan, source, { sceneInventories: [scene] }), /without a verified/);
});

test('automatic v2 intake reports blocked challenge without creating any v1 fallback or target document', async () => {
  const cache = 'D:/cloneWP/.cache'; await mkdir(cache, { recursive: true }); const directory = await mkdtemp(path.join(cache, 'v2-auto-capture-test-'));
  try {
    let captureCalls = 0;
    const job = await prepareReferenceV2('https://8.8.8.8/', { root: directory, capture: async () => { captureCalls++; throw new Error('Public source challenge is visible'); } });
    assert.equal(captureCalls, 1); assert.equal(job.version, 2); assert.equal(job.status, 'blocked'); assert.match(job.error!, /challenge/);
    await assert.rejects(readFile(job.sourceFactsPath), /ENOENT/);
    let unsafeCapture = false; await assert.rejects(prepareReferenceV2('http://127.0.0.1/', { root: directory, capture: async () => { unsafeCapture = true; } }), /private|Loopback/); assert.equal(unsafeCapture, false);
  } finally { assert.ok(directory.startsWith('D:\\cloneWP\\.cache\\') || directory.startsWith('D:/cloneWP/.cache/')); await rm(directory, { recursive: true, force: true }); }
});

test('browser import checks screenshot bytes, manifest counts and immutable reprojected facts, then owns copied evidence', async () => {
  const cache = 'D:/cloneWP/.cache'; await mkdir(cache, { recursive: true }); const directory = await mkdtemp(path.join(cache, 'v2-observation-test-'));
  try {
    const evidenceDir = path.join(directory, 'observed'); await mkdir(evidenceDir);
    const value = packet(), screenshot = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#abcdef' } }).png().toBuffer(); value.commerceEvidence = { version: 1, productUrls: [] };
    value.snapshot.screenshot.sha256 = sha256(screenshot); await writeFile(path.join(evidenceDir, value.snapshot.screenshot.path), screenshot);
    const bytes = JSON.stringify(value); await writeFile(path.join(evidenceDir, 'packet.json'), bytes);
    const manifest: ObservationManifestV2 = { version: 2, kind: 'observation-manifest', sourceUrl: value.snapshot.url, provenance: { method: 'user-opened-browser', browser: 'chrome', observer: 'cua_repl' }, packets: [{ path: 'packet.json', sha256: sha256(bytes), snapshotId: value.snapshot.id, regionIds: value.regions.map(region => region.id), counts: observationCountsV2(value), dependencies: [] }], screenshots: [{ path: value.snapshot.screenshot.path, sha256: sha256(screenshot), snapshotId: value.snapshot.id }] };
    const manifestPath = path.join(evidenceDir, 'observation-manifest.json'); await writeFile(manifestPath, JSON.stringify(manifest));
    const imported = await readObservationDirectoryV2(evidenceDir, value.snapshot.url); assert.equal(imported.packets.length, 1);
    await assert.rejects(prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory }), /independently captured whole-page scene inventory/);
    const sceneBytes = JSON.stringify(inventory(value)); await writeFile(path.join(evidenceDir, 'scene-inventory.json'), sceneBytes); manifest.sceneInventories = [{ path: 'scene-inventory.json', snapshotId: value.snapshot.id, sha256: sha256(sceneBytes) }]; await writeFile(manifestPath, JSON.stringify(manifest));
    const legacy = structuredClone(value); delete legacy.commerceEvidence; const legacyBytes = JSON.stringify(legacy); await writeFile(path.join(evidenceDir, 'packet.json'), legacyBytes); manifest.packets[0].sha256 = sha256(legacyBytes); await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory }), /source-commerce observation evidence/);
    await writeFile(path.join(evidenceDir, 'packet.json'), bytes); manifest.packets[0].sha256 = sha256(bytes); await writeFile(manifestPath, JSON.stringify(manifest));
    const job = await prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory }); assert.equal(job.version, 2); assert.equal(job.status, 'awaiting-component-plan');
    assert.match(job.jobId, /^reference-v2-.+-[a-f0-9]{8}$/);
    const jobId = 'reference-v2-owned-explicit-task', named = await prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory, jobId });
    assert.equal(named.jobId, jobId); assert.equal(named.jobDir, path.join(directory, 'references', jobId));
    const originalJob = await readFile(path.join(named.jobDir, 'job.json'));
    await assert.rejects(prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory, jobId }), { code: 'EEXIST' });
    assert.deepEqual(await readFile(path.join(named.jobDir, 'job.json')), originalJob, 'A conflicting explicit id never overwrites its existing job');
    for (const invalid of ['', '.', '..', '../escape', 'reference-v2-../escape', 'reference-v2-a/b', 'reference-v2-a\\b', 'D:/escape', 'reference-v2-name.json', 'reference-v2-name ', 'reference-v2-a:', 'reference-v2-A', 'reference-v2-a-', 'reference-v2-' + 'a'.repeat(109)]) await assert.rejects(prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory, jobId: invalid }), /bounded reference-v2 directory name/);
    const concurrent = await Promise.allSettled([1, 2].map(() => prepareObservedReferenceV2(value.snapshot.url, evidenceDir, { root: directory, jobId: 'reference-v2-concurrent-owned' })));
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason.code === 'EEXIST').length, 1);
    const facts = JSON.parse(await readFile(job.sourceFactsPath, 'utf8')); assert.ok(facts.observation.path.startsWith(job.jobDir)); await verifySourceFactsEvidenceV2(facts);
    const revisionName = 'observation-manifest-responsive.json', revisionPath = path.join(evidenceDir, revisionName); await writeFile(revisionPath, JSON.stringify(manifest));
    const revision = await readObservationDirectoryV2(evidenceDir, value.snapshot.url, { manifestName: revisionName }), revisedFacts = buildSourceFactsV2(revision);
    assert.equal(revision.manifestPath, revisionPath); assert.equal(revisedFacts.observation.path, revisionPath);
    assert.equal(revisedFacts.observation.sha256, sha256(await readFile(revisionPath))); await verifySourceFactsEvidenceV2(revisedFacts);
    for (const manifestName of ['../outside.json', 'sub/manifest.json', 'sub\\manifest.json', 'D:/outside.json', '.json', 'manifest.txt']) await assert.rejects(readObservationDirectoryV2(evidenceDir, value.snapshot.url, { manifestName }), /safe JSON filename/);
    manifest.packets[0].counts.nodes++; await writeFile(manifestPath, JSON.stringify(manifest)); await assert.rejects(readObservationDirectoryV2(evidenceDir), /entity count mismatch/);
    await verifySourceFactsEvidenceV2(revisedFacts); // A later revision never silently reads the legacy manifest.
    // Changing the original input cannot change the copied job evidence.
    await verifySourceFactsEvidenceV2(facts);
  } finally { assert.ok(directory.startsWith('D:\\cloneWP\\.cache\\') || directory.startsWith('D:/cloneWP/.cache/')); await rm(directory, { recursive: true, force: true }); }
});

test('actual browser collector retains whole card ownership, two-image hero, background and duplicate usages with random region identifiers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(`<!doctype html><html><head><style>body{margin:0}.outer{max-width:1440px;margin:auto;padding:20px;background:#ffc600 url("data:image/svg+xml;base64,PHN2Zy8+")}.swiper-wrapper{display:flex;gap:16px}.card{flex:1}img{width:100px;height:100px}.narrow{display:none}@media(max-width:600px){.wide{display:none}.narrow{display:block}}</style></head><body><header id="top" class="outer"><a href="https://8.8.8.8/search/">Search product, brand and complete public website contents</a><div class="swiper"><div class="swiper-wrapper"><article class="card"><h3 class="wide">First card desktop heading</h3><h3 class="narrow">First card mobile heading</h3><img src="data:image/png;base64,iVBORw0KGgo="></article><article class="card"><h3>Second card heading</h3><img src="data:image/png;base64,iVBORw0KGgo="></article></div><button class="swiper-button-next">Next</button></div></header><main><section id="hero" class="outer" style="margin-top:46px"><img src="data:image/png;base64,iVBORw0KGgo="><img src="data:image/png;base64,iVBORw0KGgo="><p>Two-image hero should stay a distinct two-image composition</p></section></main></body></html>`);
    const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
    await page.evaluate(() => { document.title = 'Public structured layout fixture'; });
    // Actual source controls often cross out of the slider into a shared header.
    await page.evaluate(() => { document.querySelector('header')!.append(document.querySelector('button')!); });
    const options = { capturedAt: '2026-10-15T00:00:00.000Z', snapshotId: 'dom-scene', idPrefix: 'random-id', regions: [{ id: 'random-754', selector: '#top', role: 'header' }, { id: 'random-123', selector: '#hero', role: 'hero', previousSelector: '#top' }] };
    const value = await page.evaluate(`(()=>{${collector}\nreturn collectObservationV2(${JSON.stringify(options)});})()`), parsed = JSON.parse(value as string);
    assert.equal(parsed.chunks.length, 2);
    const header = validateObservationPacketV2(JSON.parse(parsed.chunks[0].json)), hero = validateObservationPacketV2(JSON.parse(parsed.chunks[1].json));
    const firstHeading = Object.values(header.texts).find(item => item.text === 'First card desktop heading')!;
    assert.equal(firstHeading.lineCount, 1);
    assert.equal(header.nodes[header.nodes[firstHeading.nodeId].parentId!].tag, 'article');
    const narrowHeading = Object.values(header.texts).find(item => item.text === 'First card mobile heading')!; assert.equal(header.nodes[narrowHeading.nodeId].visible, false); assert.equal(narrowHeading.lineCount, 0);
    assert.equal(Object.values(header.usages).filter(usage => usage.kind === 'background').length, 1);
    const images = Object.values(header.usages).filter(usage => usage.kind === 'img'); assert.equal(images.length, 2); assert.equal(images[0].resourceId, images[1].resourceId);
    const slider = Object.values(header.interactions).find(item => item.kind === 'carousel')!; assert.equal(slider.itemNodeIds?.length, 2); assert.equal(slider.controlNodeIds?.length, 1); assert.notEqual(header.nodes[slider.controlNodeIds![0]].parentId, slider.trackNodeId);
    assert.equal(Object.values(hero.usages).filter(usage => usage.kind === 'img').length, 2); assert.equal(hero.regions[0].gapBefore, 46);
    assert.equal(header.layouts[header.nodes[header.regions[0].nodeId].layoutId].rect.x, 220);
    const parts = await page.evaluate(`(()=>{${collector}\nreturn collectObservationV2(${JSON.stringify({ ...options, bridgeParts: true })});})()`) as string[];
    assert.ok(parts.every(part => typeof part === 'string' && part.length <= 80000)); assert.equal(JSON.parse(parts.join('')).kind, 'observation-transport');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = JSON.parse(await page.evaluate(`(()=>{${collector}\nreturn collectObservationV2(${JSON.stringify({ ...options, snapshotId: 'dom-mobile', viewportName: 'mobile' })});})()`) as string);
    const mobileHeader = validateObservationPacketV2(JSON.parse(mobile.chunks[0].json));
    assert.equal(mobileHeader.nodes[Object.values(mobileHeader.texts).find(item => item.text === 'First card mobile heading')!.nodeId].visible, true);
    const scene = validateSceneInventoryV2(JSON.parse(await page.evaluate(`(()=>{${collector}\nreturn collectSceneInventoryV2(${JSON.stringify({ snapshotId: 'dom-mobile', viewportName: 'mobile', regions: options.regions })});})()`) as string));
    assert.equal(scene.counts.unassigned, 0); assert.ok(scene.counts.assigned > 0); assert.ok(Object.values(scene.entries).some(entry => entry.label === 'First card mobile heading'));
    await page.evaluate(() => { const outside = document.createElement('aside'); outside.textContent = 'Unassigned visible advertisement'; document.body.append(outside); });
    const incomplete = validateSceneInventoryV2(JSON.parse(await page.evaluate(`(()=>{${collector}\nreturn collectSceneInventoryV2(${JSON.stringify({ snapshotId: 'dom-mobile', viewportName: 'mobile', regions: options.regions })});})()`) as string));
    assert.equal(incomplete.counts.unassigned, 1); assert.ok(Object.values(incomplete.entries).some(entry => entry.ownerRegionId === null && entry.label === 'Unassigned visible advertisement'));
  } finally { await browser.close(); }
});

test('browser collector declares tabs, disclosures and counters without claiming their behavior was verified', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Semantic controls fixture</title><main id="content"><ul><li data-slide-to="1">Product Design</li></ul><a href="#answer" data-toggle="collapse">What can you buy?</a><details><summary>Shipping</summary><p>Worldwide</p></details><em class="counter">45000</em></main>');
    const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
    const transport = JSON.parse(await page.evaluate(`${collector};collectObservationV2({snapshotId:'semantic-controls',rootSelectors:['#content']})`) as string);
    const packet = validateObservationPacketV2(JSON.parse(transport.chunks[0].json));
    const controls = Object.values(packet.interactions).filter(item => item.kind === 'control');
    assert.deepEqual(controls.map(item => item.details.type), ['tab', 'disclosure', 'disclosure', 'counter']);
    assert.ok(controls.every(item => item.status === 'declared'));
    assert.ok(Object.values(packet.interactions).some(item => item.kind === 'link' && item.nodeId === controls[1].nodeId));
  } finally { await browser.close(); }
});
test('browser collector measures source text wrapping rather than inferring lines from copy length', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent('<title>Wrap fixture</title><main id="content"><p style="width:100px;font:16px Arial">The same text must wrap across several visible lines.</p></main>');
    const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
    const transport = JSON.parse(await page.evaluate(`${collector};collectObservationV2({snapshotId:'wrap',rootSelectors:['#content']})`) as string);
    const packet = validateObservationPacketV2(JSON.parse(transport.chunks[0].json));
    const paragraph = Object.values(packet.texts).find(item => item.text.startsWith('The same text'))!;
    assert.ok(paragraph.lineCount! > 1);
    assert.ok(packet.layouts[packet.nodes[paragraph.nodeId].layoutId].contentRect.width <= 100);
  } finally { await browser.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { native44KnowledgeIdentity, loadNative44Knowledge } from '../src/native44/knowledge.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { native44ObservedGeometryHash } from '../src/native44/source.js';
import { NATIVE44_SELECTION_RULES_HASH, native44SelectionHash } from '../src/native44/selection-rules.js';
import { observationCountsV2, readObservationDirectoryV2, sha256, type ObservationManifestV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import type { ComponentPlanV2 } from '../src/replica-v2/component-plan.js';
import type { Native44Program } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import { validateLocalNative44Input } from '../src/native44/runtime.js';
import { prepareLocalTask } from '../src/native44/local-task.js';
import { prepareNative44JobSourceCaptures } from '../src/native44/source-captures.js';
import { native44RegisteredSchemaHash } from '../src/native44/selection.js';

const project = 'D:/cloneWP', profile = 'desktop-browser-v1' as const, url = 'https://8.8.8.8/';
const capturedAt = '2026-10-16T06:00:01.000Z', observedAt = '2026-10-16T06:00:00.000Z';
const copy = ['Independent source paragraph one stays panel editable.', 'Independent source paragraph two retains exact wording.'];
async function json(filename: string, value: unknown) { const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(filename, bytes); return { path: filename, sha256: sha256(bytes) }; }
async function isolatedFixture(t: { after: (callback: () => Promise<void>) => void }, extraType?: 'wd_list' | 'wd_testimonials') {
  const root = await mkdtemp(path.join(project, '.cache', 'desktop-input-'));
  t.after(async () => { const resolved = path.resolve(root), relative = path.relative(path.resolve(project, '.cache'), resolved); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); await rm(resolved, { recursive: true, force: true }); });
  const knowledgeRoot = path.join(root, 'data', 'native44'); await mkdir(path.join(knowledgeRoot, 'components'), { recursive: true }); await mkdir(path.join(root, 'config'));
  const index = JSON.parse(await readFile(path.join(project, 'data/native44/index.json'), 'utf8'));
  const componentTypes = ['container', 'text-editor', ...(extraType ? [extraType] : [])];
  for (const filename of ['index.json', index.sharedControls.path, ...componentTypes.map(type => index.components[type].path)]) await copyFile(path.join(project, 'data/native44', filename), path.join(knowledgeRoot, filename));
  await copyFile(path.join(project, 'config/native44-component-set.json'), path.join(root, 'config/native44-component-set.json'));
  const identity = await native44KnowledgeIdentity(root), knowledge = await loadNative44Knowledge(componentTypes, knowledgeRoot);
  const taskId = 'desktop-input-fixture', jobDir = path.join(root, 'references', taskId), observationDir = path.join(jobDir, 'observation'); await mkdir(observationDir, { recursive: true });
  const packets: ObservationPacketV2[] = [], manifest: ObservationManifestV2 = { version: 2, kind: 'observation-manifest', sourceUrl: url, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [], sceneInventories: [] };
  const renderRefs: Record<string, { path: string; sha256: string }> = {};
  for (const viewport of native44ProfileViewports(profile)) {
    const id = viewport.name, png = await sharp({ create: { width: viewport.width, height: viewport.height, channels: 3, background: '#eeeeee' } }).png().toBuffer(), pngName = `${id}.png`; await writeFile(path.join(observationDir, pngName), png);
    const layout = (id: string, y: number, height: number) => ({ id, rect: { x: 240, y, width: 960, height }, contentRect: { x: 240, y, width: 960, height }, padding: [0, 0, 0, 0] as [number, number, number, number], margin: [0, 0, 0, 0] as [number, number, number, number], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: '1440px', direction: 'row', flowIndex: y });
    const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id, url, title: 'Synthetic normal desktop input contract fixture', capturedAt, viewport: { name: viewport.name === 'desktop-wide' ? 'desktop' : viewport.name, width: viewport.width, height: viewport.height, clientWidth: viewport.width - 15, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: viewport.height, screenshot: { path: pngName, sha256: sha256(png), width: viewport.width, height: viewport.height } }, nodes: { root: { id: 'root', parentId: null, regionId: 'content', tag: 'section', selector: '#root', attributes: {}, childIds: ['one', 'two'], styleId: 'style', layoutId: 'root', visible: true }, one: { id: 'one', parentId: 'root', regionId: 'content', tag: 'p', selector: '#one', attributes: {}, childIds: [], styleId: 'style', layoutId: 'one', visible: true }, two: { id: 'two', parentId: 'root', regionId: 'content', tag: 'p', selector: '#two', attributes: {}, childIds: [], styleId: 'style', layoutId: 'two', visible: true } }, regions: [{ id: 'content', nodeId: 'root', contentNodeId: 'root', role: 'body', order: 0, gapBefore: 0 }], layouts: { root: layout('root', 0, 100), one: layout('one', 0, 30), two: layout('two', 40, 30) }, styles: { style: { display: 'block', color: '#222222' } }, texts: { one: { id: 'one', nodeId: 'one', regionId: 'content', text: copy[0], kind: 'body' }, two: { id: 'two', nodeId: 'two', regionId: 'content', text: copy[1], kind: 'body' } }, resources: {}, usages: {}, interactions: {}, commerceEvidence: { version: 1, productUrls: [] }, gaps: [] };
    const packetName = `${id}.json`, packetRef = await json(path.join(observationDir, packetName), packet); packets.push(packet);
    manifest.packets.push({ ...packetRef, path: packetName, snapshotId: id, regionIds: ['content'], counts: observationCountsV2(packet), dependencies: [] }); manifest.screenshots.push({ path: pngName, sha256: sha256(png), snapshotId: id });
    const inventoryName = `${id}-inventory.json`, inventoryRef = await json(path.join(observationDir, inventoryName), { version: 2, kind: 'scene-inventory', snapshotId: id, sourceUrl: url, capturedAt, viewport: { name: packet.snapshot.viewport.name, width: viewport.width, height: viewport.height }, regions: [{ id: 'content', selector: '#root' }], entries: { one: { id: 'one', selector: '#one', ownerRegionId: 'content', kind: 'text', label: copy[0], rect: packet.layouts.one.rect }, two: { id: 'two', selector: '#two', ownerRegionId: 'content', kind: 'text', label: copy[1], rect: packet.layouts.two.rect } }, counts: { total: 2, text: 2, media: 0, control: 0, assigned: 2, unassigned: 0, vendorUtilities: 0 } });
    manifest.sceneInventories!.push({ ...inventoryRef, path: inventoryName, snapshotId: id });
    renderRefs[id] = await json(path.join(observationDir, `${id}-render.json`), { version: 1, taskId, snapshotId: id, sourceUrl: url, capturedAt, screenshotHash: sha256(png), viewport: { width: viewport.width, height: viewport.height, clientWidth: viewport.width - 15, devicePixelRatio: 1 }, fontsReady: true, observationMode: 'readonlyDOM', media: [], states: [] });
  }
  await json(path.join(observationDir, 'observation-manifest.json'), manifest);
  const observation = await readObservationDirectoryV2(observationDir, url), facts = buildSourceFactsV2(observation), factsRef = await json(path.join(jobDir, 'source-facts.json'), facts);
  const browserBinding = { version: 2, replicationProfile: profile, renderEvidenceBySnapshot: renderRefs, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId, sourceUrl: url, collectionStartedAt: observedAt, browserObservation: { method: 'user-opened-browser', tool: 'cua_repl', browserId: 'synthetic-browser-fixture', tabId: 'synthetic-tab-fixture', requestedUrl: url, actualUrl: url, observedAt, captures: packets.map(packet => { const geometry = { url, viewport: { width: packet.snapshot.viewport.width, height: packet.snapshot.viewport.height, clientWidth: packet.snapshot.viewport.clientWidth, scrollbarWidth: 15, devicePixelRatio: 1 }, scrollX: 0, scrollY: 0, pageHeight: packet.snapshot.pageHeight, geometryHash: native44ObservedGeometryHash(packets, packet.snapshot.id) }; return { snapshotId: packet.snapshot.id, packetHashes: manifest.packets.filter(ref => ref.snapshotId === packet.snapshot.id).map(ref => ref.sha256), screenshotHash: packet.snapshot.screenshot.sha256, captureMode: 'full-page-stable', before: geometry, after: geometry }; }) } };
  const collectionRef = await json(path.join(jobDir, 'native44-browser-observation.json'), browserBinding);
  const schemas: Record<string, LegacySchema> = { container: { type: 'container', class: 'FixtureContainer', controls: {} }, 'text-editor': { type: 'text-editor', class: 'FixtureTextEditor', controls: { editor: { type: 'wysiwyg' } } } };
  if (extraType === 'wd_list') schemas.wd_list = { type: 'wd_list', class: 'XTS\\Elementor\\List_Element', controls: { list_items: { type: 'repeater', fields: [{ name: 'list_content', type: 'textarea' }, { name: 'link', type: 'url' }] } } };
  if (extraType === 'wd_testimonials') schemas.wd_testimonials = { type: 'wd_testimonials', class: 'XTS\\Elementor\\Testimonials', controls: { layout: { type: 'select', default: 'slider', options: { slider: 'Carousel', grid: 'Grid' } }, carousel_sync: { type: 'select', default: '', options: { '': 'Disabled', parent: 'As parent', child: 'As child' }, condition: { layout: 'slider' } }, sync_parent_id: { type: 'text', default: 'wd_6ad3ad27b46b3', condition: { layout: 'slider', carousel_sync: ['parent'] } } } };
  const targetRef = await json(path.join(jobDir, 'registered-schemas.json'), { legacySchemas: schemas });
  const localRef = (type: string) => ({ path: path.join(knowledgeRoot, knowledge.index.components[type].path), sha256: knowledge.index.components[type].sha256 });
  const plan: ComponentPlanV2 = { version: 2, kind: 'component-plan', replicationProfile: profile, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, sourceFacts: factsRef, desktopSnapshotId: 'desktop-wide', components: ['root', 'body'].map(key => ({ id: key, parentId: key === 'root' ? null : 'root', role: key === 'root' ? 'layout' : 'body', renderer: key === 'root' ? 'composite' : 'native', editability: key === 'root' ? 'mixed' : 'controls', sourceRegionIds: ['content'], variants: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: key === 'root' ? ['root'] : ['one', 'two'], visible: true })) })), requirements: Object.values(facts.facts).map((fact, index) => ({ id: `requirement-${index}`, factIds: [fact.id], componentId: fact.kind === 'text' ? 'body' : 'root', disposition: 'preserve', rule: 'Retain the independently observed source text, owner and desktop layout.', verification: { kind: fact.kind === 'text' ? 'text' : 'presence', selector: fact.kind === 'text' ? '.body' : '.root', snapshotId: fact.snapshotId, ...(fact.kind === 'text' ? { expected: { text: fact.value.text, visible: true } } : {}) } })), sourceUnits: [], selectionDecisions: [] };
  for (const snapshot of facts.snapshots) for (const key of ['root', 'body']) {
    const ownFacts = Object.values(facts.facts).filter(fact => fact.snapshotId === snapshot.id && (key === 'root' ? fact.kind !== 'text' : fact.kind === 'text')), type = key === 'root' ? 'container' : 'text-editor', unitId = `${snapshot.id}-${key}`;
    plan.sourceUnits!.push({ id: unitId, snapshotId: snapshot.id, ownerNodeId: 'root', regionId: 'content', role: key === 'root' ? 'layout' : 'body', sourceFactIds: ownFacts.map(fact => fact.id), evidence: { factIds: ownFacts.map(fact => fact.id), screenshots: [{ snapshotId: snapshot.id, screenshot: { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 } }], rationale: 'Synthetic source structure and pixels bind the body to its natural-flow content owner.' }, slots: key === 'root' ? [] : ownFacts.map(fact => ({ id: fact.nodeId, kind: 'text', factIds: [fact.id], required: true })) });
    plan.selectionDecisions!.push({ unitId, componentKeys: [key], candidates: [{ widgetTypes: [type], conclusion: 'selected', reason: 'The researched native model matches this independently authored source responsibility.', evidence: [localRef(type)] }], reason: 'One native component maintains this coherent source content and editing unit.', slotBindings: key === 'root' ? [] : ownFacts.map(fact => ({ slotId: fact.nodeId, componentKey: key, settingPath: 'widgetSettings.editor' })), contractRefs: [{ widgetType: type, scope: 'local-source', schemaSha256: localRef(type).sha256, evidence: localRef(type) }, { widgetType: type, scope: 'target-registered', schemaSha256: sha256(JSON.stringify(schemas[type])), evidence: targetRef }] });
  }
  plan.selectionReview = { reviewer: 'codex', status: 'approved', reviewedAt: capturedAt, sourceFacts: factsRef, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, decisionsSha256: native44SelectionHash({ sourceUnits: plan.sourceUnits, selectionDecisions: plan.selectionDecisions }), screenshots: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, screenshot: { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 } })), reviewedUnitIds: plan.sourceUnits!.map(unit => unit.id), checks: { moduleOrder: true, contentOwnership: true, componentSuitability: true, editingGranularity: true }, judgment: 'Synthetic integration fixture checks the full source-to-component identity and exact field contract, not a live-site visual acceptance.' };
  const planRef = await json(path.join(jobDir, 'component-plan.json'), plan), assetsRef = await json(path.join(jobDir, 'assets.json'), { assets: [] });
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: profile, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId, title: 'Synthetic complete desktop input fixture', sourceUrl: url, ...identity, sourceFacts: factsRef, componentPlan: planRef, assetsManifest: assetsRef, viewports: native44ProfileViewports(profile), blocks: [{ kind: 'composite', key: 'root', children: [{ kind: 'native', key: 'body', widgetType: 'text-editor', widgetSettings: { editor: `<p>${copy[0]}</p><p>${copy[1]}</p>` } }] }] };
  if (extraType) {
    (program.blocks[0] as Extract<Native44Program['blocks'][number], { kind: 'composite' }>).children.push({ kind: 'native', key: 'extra', role: 'decoration', widgetType: extraType, widgetSettings: extraType === 'wd_list' ? { list_items: [] } : { layout: 'grid' } });
    plan.components.push({ id: 'extra', parentId: 'root', role: 'decoration', renderer: 'native', editability: 'controls', sourceRegionIds: ['content'], variants: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['root'], visible: true })) });
    for (const decision of plan.selectionDecisions!.filter(decision => decision.componentKeys.includes('root'))) {
      decision.componentKeys.push('extra'); decision.candidates[0].widgetTypes.push(extraType);
      decision.contractRefs.push({ widgetType: extraType, scope: 'local-source', schemaSha256: localRef(extraType).sha256, evidence: localRef(extraType) }, { widgetType: extraType, scope: 'target-registered', schemaSha256: sha256(JSON.stringify(schemas[extraType])), evidence: targetRef });
    }
    plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: plan.sourceUnits, selectionDecisions: plan.selectionDecisions });
    program.componentPlan = await json(planRef.path, plan);
  }
  const filename = path.join(jobDir, 'program.json'); await json(filename, program);
  const job = { version: 2, workflow: 'block-replication', mode: 'replica', executionStrategy: 'native44-css-handoff', replicationProfile: profile, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId, url, ...identity, jobDir, programPath: filename, sourceFactsPath: factsRef.path, sourceCollection: collectionRef, sourceRenderEvidenceBySnapshot: renderRefs };
  const jobFile = path.join(jobDir, 'job.json'); await json(jobFile, job);
  return { root, jobDir, filename, program, plan, facts, job, jobFile, targetRef, planRef, schemas };
}

async function saveRegisteredEvidence(fixture: Awaited<ReturnType<typeof isolatedFixture>>, hashes?: 'identity' | 'raw', report: unknown = { legacySchemas: fixture.schemas }) {
  const evidence = await json(fixture.targetRef.path, report);
  for (const decision of fixture.plan.selectionDecisions!) for (const contract of decision.contractRefs) if (contract.scope === 'target-registered') {
    contract.evidence = evidence;
    if (hashes) contract.schemaSha256 = hashes === 'identity' ? native44RegisteredSchemaHash(fixture.schemas[contract.widgetType]) : sha256(JSON.stringify(fixture.schemas[contract.widgetType]));
  }
  fixture.plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: fixture.plan.sourceUnits, selectionDecisions: fixture.plan.selectionDecisions });
  fixture.program.componentPlan = await json(fixture.planRef.path, fixture.plan);
  await json(fixture.filename, fixture.program);
}

test('new naming and whole-page review policies must match the frozen task marker before evidence or authentication', async t => {
  const fixture=await isolatedFixture(t);await saveRegisteredEvidence(fixture,'identity');
  const policies={editorNaming:'native-translated-v1' as const,reviewWorkflow:'whole-page-after-css-v1' as const};
  await json(fixture.jobFile,{...fixture.job,...policies});
  await assert.rejects(prepareLocalTask(fixture.filename,fixture.root),/native44_editorNaming_policy_conflict/);
  Object.assign(fixture.program,policies);await json(fixture.filename,fixture.program);
  const local=await prepareLocalTask(fixture.filename,fixture.root);assert.equal(local.program.editorNaming,policies.editorNaming);assert.equal(local.program.reviewWorkflow,policies.reviewWorkflow);
  for(const key of ['editorNaming','reviewWorkflow'] as const){
    for(const value of [undefined,'unknown-policy']){
      await json(fixture.jobFile,{...fixture.job,...policies,[key]:value});
      await assert.rejects(prepareLocalTask(fixture.filename,fixture.root),new RegExp(`native44_${key}_policy_conflict`));
    }
  }
  // A historical task with neither opt-in retains its old behavior.
  delete fixture.program.editorNaming;delete fixture.program.reviewWorkflow;await json(fixture.filename,fixture.program);await json(fixture.jobFile,fixture.job);
  assert.equal((await prepareLocalTask(fixture.filename,fixture.root)).program.editorNaming,undefined);
});

test('prepareLocalTask validates ordinary registered identity, whole-file bytes and declared type at the real file boundary without HTTP', async t => {
  const fixture = await isolatedFixture(t, 'wd_list'), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Registered file validation must precede authentication and HTTP'); }; t.after(() => { globalThis.fetch = originalFetch; });
  await saveRegisteredEvidence(fixture, 'identity');
  assert.equal((await prepareLocalTask(fixture.filename, fixture.root)).program.taskId, fixture.program.taskId);
  const original = structuredClone(fixture.schemas.wd_list);
  fixture.schemas.wd_list.type = 'wd_testimonials';
  await saveRegisteredEvidence(fixture, 'identity');
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /registered schema file is not its declared contract: wd_list/);
  fixture.schemas.wd_list = structuredClone(original); await saveRegisteredEvidence(fixture, 'identity');
  fixture.schemas.wd_list.controls.list_items.default = [];
  await saveRegisteredEvidence(fixture);
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /registered schema file is not its declared contract: wd_list/);
  fixture.schemas.wd_list = structuredClone(original); await saveRegisteredEvidence(fixture, 'identity');
  await writeFile(fixture.targetRef.path, JSON.stringify({ legacySchemas: fixture.schemas, changedBytes: true }));
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /immutable input hash mismatch/);
  await saveRegisteredEvidence(fixture, 'identity', { ...fixture.schemas.wd_list, legacySchemas: { ...fixture.schemas, wd_list: undefined } });
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /registered schema file is not its declared contract: wd_list/);
  assert.equal(requests, 0);
});

test('prepareLocalTask accepts proved generated schema identity but legacy raw evidence only while raw schema exactly matches', async t => {
  const fixture = await isolatedFixture(t, 'wd_testimonials'), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Registered file validation must precede authentication and HTTP'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const sync = fixture.schemas.wd_testimonials.controls.sync_parent_id;
  await saveRegisteredEvidence(fixture, 'identity');
  await prepareLocalTask(fixture.filename, fixture.root);
  sync.default = 'wd_6ad3b122a8a48'; await saveRegisteredEvidence(fixture);
  await prepareLocalTask(fixture.filename, fixture.root);
  sync.default = 'fixed-parent-id'; await saveRegisteredEvidence(fixture);
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /registered schema file is not its declared contract: wd_testimonials/);
  sync.default = 'wd_6ad3ad27b46b3'; await saveRegisteredEvidence(fixture, 'raw');
  await prepareLocalTask(fixture.filename, fixture.root);
  sync.default = 'wd_6ad3b122a8a48'; await saveRegisteredEvidence(fixture);
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /registered schema file is not its declared contract: wd_testimonials/);
  await saveRegisteredEvidence(fixture, 'identity');
  sync.condition = { layout: 'slider', carousel_sync: 'parent' }; await saveRegisteredEvidence(fixture);
  await assert.rejects(prepareLocalTask(fixture.filename, fixture.root), /registered schema file is not its declared contract: wd_testimonials/);
  assert.equal(requests, 0);
});

test('desktop complete offline input passes real prewrite validation and bound source-capture preparation with zero HTTP', async t => {
  const fixture = await isolatedFixture(t), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('The offline prewrite fixture must never authenticate or fetch'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const input = await validateLocalNative44Input(fixture.filename, fixture.root), captures = await prepareNative44JobSourceCaptures(input);
  assert.equal(input.componentPlan.replicationProfile, profile); assert.equal(input.program.blocks.length, 1); assert.equal(captures.viewports.length, 2); assert.equal(input.knowledge.components['text-editor'].componentType, 'text-editor'); assert.equal(requests, 0);
});
test('desktop prewrite rejects altered registered schema bytes, source contract identity and job profile offline', async t => {
  const fixture = await isolatedFixture(t), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Offline validation must precede all target requests'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const before = await readFile(fixture.targetRef.path); await writeFile(fixture.targetRef.path, '{"changed":true}');
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /immutable input hash mismatch/); await writeFile(fixture.targetRef.path, before);
  const wrongSchema = { type: 'text-editor', class: 'Changed', controls: { editor: { type: 'text' } } }, forgedRef = await json(fixture.targetRef.path, wrongSchema);
  for (const decision of fixture.plan.selectionDecisions!) for (const contract of decision.contractRefs) if (contract.scope === 'target-registered') contract.evidence = forgedRef;
  fixture.plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: fixture.plan.sourceUnits, selectionDecisions: fixture.plan.selectionDecisions }); fixture.program.componentPlan = await json(fixture.planRef.path, fixture.plan); await json(fixture.filename, fixture.program);
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /registered schema file is not its declared contract/);
  await writeFile(fixture.targetRef.path, before);
  for (const decision of fixture.plan.selectionDecisions!) for (const contract of decision.contractRefs) if (contract.scope === 'target-registered') contract.evidence = fixture.targetRef;
  fixture.plan.selectionDecisions![0].contractRefs.find(ref => ref.scope === 'local-source')!.schemaSha256 = 'f'.repeat(64);
  fixture.plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: fixture.plan.sourceUnits, selectionDecisions: fixture.plan.selectionDecisions }); fixture.program.componentPlan = await json(fixture.planRef.path, fixture.plan); await json(fixture.filename, fixture.program);
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /researched contract identity changed/);
  fixture.plan.selectionDecisions![0].contractRefs.find(ref => ref.scope === 'local-source')!.schemaSha256 = fixture.plan.selectionDecisions![0].contractRefs.find(ref => ref.scope === 'local-source')!.evidence.sha256;
  fixture.plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: fixture.plan.sourceUnits, selectionDecisions: fixture.plan.selectionDecisions }); fixture.program.componentPlan = await json(fixture.planRef.path, fixture.plan); await json(fixture.filename, fixture.program);
  const oldProgramKnowledge = fixture.program.knowledge.sha256; fixture.program.knowledge.sha256 = 'e'.repeat(64); await json(fixture.filename, fixture.program);
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /current frozen knowledge identity/); fixture.program.knowledge.sha256 = oldProgramKnowledge; await json(fixture.filename, fixture.program);
  const wrongJob = { ...fixture.job, replicationProfile: undefined }; await json(fixture.jobFile, wrongJob);
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /profile identity differs/); assert.equal(requests, 0);
});
test('desktop complete input rejects internal child reordering or reparenting with the same nodes and renderer types', async t => {
  const fixture = await isolatedFixture(t), { program, plan, facts } = fixture;
  const root = program.blocks[0] as Extract<Native44Program['blocks'][number], { kind: 'composite' }>, first = root.children[0] as Extract<Native44Program['blocks'][number], { kind: 'native' }>;
  first.widgetSettings.editor = copy[0]; root.children.push({ ...structuredClone(first), key: 'body-two', widgetSettings: { editor: copy[1] } });
  plan.components.find(component => component.id === 'body')!.variants.forEach(variant => variant.nodeIds = ['one']);
  plan.components.push({ id: 'body-two', parentId: 'root', role: 'body', renderer: 'native', editability: 'controls', sourceRegionIds: ['content'], variants: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['two'], visible: true })) });
  for (const requirement of plan.requirements) if (requirement.factIds.some(id => id.endsWith(':text:two'))) requirement.componentId = 'body-two';
  for (const decision of plan.selectionDecisions!.filter(decision => decision.componentKeys.includes('body'))) { decision.componentKeys.push('body-two'); decision.slotBindings.find(binding => binding.slotId === 'two')!.componentKey = 'body-two'; }
  const save = async () => { plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: plan.sourceUnits, selectionDecisions: plan.selectionDecisions }); program.componentPlan = await json(fixture.planRef.path, plan); await json(fixture.filename, program); };
  await save(); await validateLocalNative44Input(fixture.filename, fixture.root);
  root.children.reverse(); await save();
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /child order differs/);
  root.children.reverse(); plan.components.find(component => component.id === 'body-two')!.parentId = 'body'; await save();
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /child order differs|parent ownership differs/);
});
test('unsupported desktop context resources fail at the real local entrance before HTTP or target credentials', async t => {
  const fixture = await isolatedFixture(t), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Unsupported context must fail before all target requests'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const root = fixture.program.blocks[0] as Extract<Native44Program['blocks'][number], { kind: 'composite' }>;
  root.children[0] = { kind: 'native', key: 'body', widgetType: 'wd_page_heading', widgetSettings: {}, resources: [{ kind: 'page-context', ids: ['invented-record'], targetOrigin: 'https://target.example', evidence: ['not-a-real-evidence-file'] }] };
  await json(fixture.filename, fixture.program);
  await assert.rejects(validateLocalNative44Input(fixture.filename, fixture.root), /native44_resource_adapter_unverified.*wd_page_heading/);
  assert.equal(requests, 0);
});

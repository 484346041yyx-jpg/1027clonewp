import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { prepareActualBody, assertActualPreparedBody, compileActualBody } from '../src/replica-full/body-prepare.js';
import { validateFullReplicaManifest } from '../src/replica-full/contract.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { native44KnowledgeIdentity } from '../src/native44/knowledge.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { prepareNative44StyleInputProof, readNative44StyleInputProof } from '../src/native44/style-input-proof.js';
import { resolvePendingFormStyles } from '../src/native44/pending-form.js';
import { assertNative44Compilation } from '../src/native44/compiler.js';
import type { FullReplicaFileRef } from '../src/replica-full/types.js';
import type { Native44Program } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const ROOT = 'D:/cloneWP', sourceUrl = 'https://alder-source.example/';
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function packet(id: string, width: number, height: number): ObservationPacketV2 {
  const definitions = [{ id: 'header', parentId: null, regionId: 'rh', tag: 'HEADER', childIds: ['header-title'] }, { id: 'header-title', parentId: 'header', regionId: 'rh', tag: 'SPAN', childIds: [] }, { id: 'hero', parentId: null, regionId: 'rb', tag: 'MAIN', childIds: ['headline'] }, { id: 'headline', parentId: 'hero', regionId: 'rb', tag: 'H1', childIds: [] }];
  const layouts = Object.fromEntries(definitions.map((node, i) => [`l${i}`, { id: `l${i}`, rect: { x: 0, y: i < 2 ? 0 : 120, width, height: 100 }, contentRect: { x: 0, y: i < 2 ? 0 : 120, width, height: 100 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: i }]));
  return validateObservationPacketV2({ version: 2, kind: 'observation-packet', snapshot: { id, url: sourceUrl, title: 'Alder source fixture', capturedAt: '2026-10-19T00:00:00.000Z', viewport: { name: width === 1920 ? 'desktop' : 'desktop-narrow', width, height, clientWidth: width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 2000, screenshot: { path: `${id}.png`, sha256: '0'.repeat(64), width, height: 2000 } }, nodes: Object.fromEntries(definitions.map((node, i) => [node.id, { ...node, selector: `#${node.id}`, attributes: {}, styleId: 's', layoutId: `l${i}`, visible: true }])), regions: [{ id: 'rh', nodeId: 'header', contentNodeId: 'header', role: 'header', order: 0, gapBefore: 0 }, { id: 'rb', nodeId: 'hero', contentNodeId: 'hero', role: 'hero', order: 1, gapBefore: 0 }], texts: { th: { id: 'th', nodeId: 'header-title', regionId: 'rh', text: 'Alder navigation', kind: 'label' }, tb: { id: 'tb', nodeId: 'headline', regionId: 'rb', text: 'Alder content', kind: 'heading', level: 1 } }, styles: { s: {} }, layouts, resources: {}, usages: {}, interactions: {}, gaps: [] });
}
async function fixture(mislabelBodyRegion = false, footerInBody = false) {
  const directory = path.join(ROOT, '.cache', `replica-full-body-test-${randomUUID()}`); await mkdir(directory, { recursive: true });
  const put = async (name: string, value: unknown): Promise<FullReplicaFileRef> => { const filename = path.join(directory, name), bytes = typeof value === 'string' ? value : JSON.stringify(value); await writeFile(filename, bytes); return { path: filename, sha256: hash(bytes) }; };
  const packets = [packet('wide', 1920, 1080), packet('narrow', 1440, 1000)];
  if (footerInBody) for (const row of packets) row.nodes.hero.tag = 'FOOTER';
  if (mislabelBodyRegion) for (const row of packets) row.regions.find(region => region.id === 'rb')!.role = 'header';
  const packetRefs = await Promise.all(packets.map(row => put(`${row.snapshot.id}.json`, row)));
  const evidence = { version: 1, kind: 'native44-body-source-evidence', taskId: 'alder-full', sourceUrl, snapshots: packets.map((row, i) => ({ id: row.snapshot.id, viewport: row.snapshot.viewport, packets: [packetRefs[i]] })) };
  const evidenceRef = await put('source-evidence.json', evidence);
  const facts = buildSourceFactsV2({ manifestPath: evidenceRef.path, manifestSha256: evidenceRef.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets, packetFiles: packetRefs.map((ref, i) => ({ ...ref, snapshotId: packets[i].snapshot.id })) });
  const factsRef = await put('source-facts.json', facts), planRef = await put('component-plan.json', { testOnly: true }), assetsRef = await put('assets.json', { version: 1, assets: [] });
  const units = { version: 1, kind: 'native44-body-source-units', taskId: 'alder-full', sourceUrl, units: packets.flatMap(row => [{ id: `${row.snapshot.id}/header`, snapshotId: row.snapshot.id, ownerNodeId: 'header', nodeIds: ['header', 'header-title'], sourceFactIds: Object.values(facts.facts).filter(fact => fact.snapshotId === row.snapshot.id && fact.regionId === 'rh').map(fact => fact.id), componentKeys: [] as string[] }, { id: `${row.snapshot.id}/hero`, snapshotId: row.snapshot.id, ownerNodeId: 'hero', nodeIds: ['hero', 'headline'], sourceFactIds: Object.values(facts.facts).filter(fact => fact.snapshotId === row.snapshot.id && fact.regionId === 'rb').map(fact => fact.id), componentKeys: ['hero', 'headline'] }]) };
  const identity = await native44KnowledgeIdentity(ROOT);
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'alder-full', title: 'Alder body fixture', sourceUrl, replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, ...identity, sourceFacts: factsRef, componentPlan: planRef, assetsManifest: assetsRef, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'hero', children: [{ kind: 'native', key: 'headline', widgetType: 'heading', widgetSettings: { title: 'Alder content' }, sourceFactIds: packets.map(row => `${row.snapshot.id}:text:tb`) }] }] };
  const manifest = validateFullReplicaManifest({ version: 1, kind: 'clonewp-full-replica', taskId: 'alder-full', runId: 'alder-run', title: 'Alder full', slug: 'alder-full', sourceUrl, targetOrigin: 'https://alder-target.example', sourceEvidence: evidenceRef, sourcePartition: { allUnits: units.units.map(row => row.id), headerUnits: units.units.filter(row => row.id.endsWith('/header')).map(row => row.id), bodyUnits: units.units.filter(row => row.id.endsWith('/hero')).map(row => row.id) }, header: { bundleDirectory: path.join(directory, 'header-bundle'), assets: assetsRef, plan: { version: 1, kind: 'clonewp-header-module', moduleKey: 'alder-full', owner: { ownerId: 'clonewp', runId: 'alder-run' }, targetOrigin: 'https://alder-target.example', name: 'Alder header', menus: [{ key: 'main', name: 'Alder menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { settings: {}, rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'main', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }] }, style: { css: ':header { color:#123 }', fonts: [] } } }, body: { program: await put('program.json', program), css: await put('body.css', ':page .replica-module-hero {color:#123}'), sourceUnits: await put('source-units.json', units) } });
  const refresh = async () => { program.sourceFacts = await put('source-facts.json', facts); manifest.body.program = await put('program.json', program); manifest.body.sourceUnits = await put('source-units.json', units); };
  return { directory, put, manifest, program, facts, units, refresh, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('actual body preparation rejects a page footer hidden in a new body-only task before compiling', async () => {
  const f = await fixture(false, true);
  try {
    f.program.visualAuditVersion = 3; f.program.reviewWorkflow = 'whole-page-after-css-v1'; await f.refresh();
    const sha = 'a'.repeat(64), ref = f.manifest.sourceEvidence, origin = f.manifest.targetOrigin;
    const header = { headerId: 'header_123', name: 'Shared header', editUrl: `${origin}/wp-admin/admin.php?page=xts_header_builder`, sharedHash: sha, headerHash: sha, menuHash: sha, styleHash: sha, footerHash: sha, menus: [], blocks: [], mobileMaxWidth: 768, hasSubmenus: false };
    const { header: _owned, ...base } = f.manifest;
    const scoped = validateFullReplicaManifest({ ...base, version: 4, pageScope: 'body-only', headerProvider: 'reused-woodmart-header', reusedHeader: header,
      sourcePartition: { ...base.sourcePartition, footerUnits: [] },
      responsive: { version: 2, tablet: 'desktop', mobileMaxWidth: 768, source: ref, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }],
        decisions: { version: 1, layouts: [], carousels: [], header: { mode: 'reuse-readonly', requestRef: 'body-scope-fixture', reason: 'Reuse the frozen shared header without changing it.', headerId: header.headerId, sharedHash: sha, evidence: [ref] } },
        sections: [{ key: 'hero', mode: 'shared', reason: 'Retain the native source body.', evidence: [{ snapshotId: 'wide', nodeId: 'hero' }, { snapshotId: 'phone', nodeId: 'hero' }], settings: [], childOrders: [], css: '' }] } });
    await assert.rejects(prepareActualBody(scoped), /body_unit_contains_footer/);
  } finally { await f.cleanup(); }
});

test('actual body preparation verifies typed packet ownership and keeps separate current-process compiler proof', async () => {
  const f = await fixture(); try {
    const body = await prepareActualBody(f.manifest); assertActualPreparedBody(body, f.manifest); assert.deepEqual(body.componentSourceUnitIds, ['wide/hero', 'narrow/hero']); assert.equal(body.embeddedHeaderCount, 0);
    assert.throws(() => assertActualPreparedBody(structuredClone(body), f.manifest), /exact_preparation_required/);
    assert.throws(() => { body.sourceUnitIds.push('wide/header'); }, TypeError);
    const schemas: Record<string, LegacySchema> = { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, heading: { type: 'heading', class: 'Heading', controls: { _css_classes: { type: 'text' }, title: { type: 'textarea' } } } };
    const compiled = compileActualBody(body, schemas, []); assertNative44Compilation(compiled, compiled.composition);
    compiled.composition.pageSettings!.custom_css = 'changed'; assert.throws(() => assertNative44Compilation(compiled, compiled.composition), /exact current-process/);
    // The fixture intentionally has auxiliary screenshot placeholders: preparation never confers visual acceptance.
    assert.equal('review' in body, false);
  } finally { await f.cleanup(); }
});
test('a mislabeled region does not turn non-header body content into a site header', async () => {
  const f = await fixture(true); try { await assert.doesNotReject(prepareActualBody(f.manifest)); } finally { await f.cleanup(); }
});
test('a source fact cannot be rewritten while retaining an authentic packet hash', async () => {
  const f = await fixture(); try { f.facts.facts['wide:text:tb'].value.text = 'Invented body'; await f.refresh(); await assert.rejects(prepareActualBody(f.manifest), /facts_not_packet_derived/); } finally { await f.cleanup(); }
});
test('the actual tree cannot borrow header facts or add a semantic site header', async () => {
  const f = await fixture(); try {
    const child = f.program.blocks[0].kind === 'composite' ? f.program.blocks[0].children[0] : null; assert.ok(child);
    child.sourceFactIds!.push('wide:text:th'); await f.refresh(); await assert.rejects(prepareActualBody(f.manifest), /embedded_header_fact/);
    child.sourceFactIds!.pop(); f.program.blocks[0].settings = { html_tag: 'header' }; await f.refresh(); await assert.rejects(prepareActualBody(f.manifest), /embedded_header_semantics/);
    f.program.blocks[0].settings = {}; if (child.kind === 'native') child.widgetSettings.title = '<div role=banner>A second header</div>'; await f.refresh(); await assert.rejects(prepareActualBody(f.manifest), /embedded_header_semantics/);
  } finally { await f.cleanup(); }
});
test('inventory labels cannot launder header descendants into body or invent component coverage', async () => {
  const f = await fixture(); try {
    const hero = f.units.units.find(row => row.id === 'wide/hero')!; hero.ownerNodeId = 'header'; hero.nodeIds = ['header', 'header-title']; hero.sourceFactIds = ['wide:text:th']; await f.refresh(); await assert.rejects(prepareActualBody(f.manifest), /body_unit_contains_header/);
    hero.ownerNodeId = 'hero'; hero.nodeIds = ['hero', 'headline']; hero.sourceFactIds = ['wide:text:tb']; hero.componentKeys = ['headline']; await f.refresh(); await assert.rejects(prepareActualBody(f.manifest), /component_mapping_not_actual/);
  } finally { await f.cleanup(); }
});
test('changed CSS and escaped file references fail before any remote factory is available', async () => {
  const f = await fixture(); try {
    await writeFile(f.manifest.body.css.path, 'changed'); await assert.rejects(prepareActualBody(f.manifest), /input_hash_changed/);
    f.manifest.body.css = { path: 'C:/Windows/win.ini', sha256: hash('changed') }; await assert.rejects(prepareActualBody(f.manifest), /path_escape/);
  } finally { await f.cleanup(); }
});

test('style source proof is minted only from current-process body attestation and rejects substituted inputs', async()=>{
  const f=await fixture();try {
    const body=await prepareActualBody(f.manifest);
    const schemas: Record<string, LegacySchema>={container:{type:'container',class:'Container',controls:{css_classes:{type:'text'}}},heading:{type:'heading',class:'Heading',controls:{_css_classes:{type:'text'},title:{type:'textarea'}}}};
    await assert.rejects(prepareNative44StyleInputProof(structuredClone(body),schemas),/exact_preparation_required/);
    const proof=await prepareNative44StyleInputProof(body,schemas);
    const input=await readNative44StyleInputProof(proof);
    await assert.doesNotReject(resolvePendingFormStyles(input,[],proof));
    const forged=structuredClone(input.source);forged.facts['wide:text:tb'].value.text='Invented same-id source value';
    await assert.rejects(resolvePendingFormStyles({...input,source:forged},[],proof),/style_input_changed/);
    await assert.rejects(resolvePendingFormStyles({...input,css:input.css+'changed'},[],proof),/style_input_changed/);
    await assert.rejects(resolvePendingFormStyles(input,[],structuredClone(proof)),/exact_attestation_required/);
    // Reading a proof exposes only fresh schema copies; it cannot mutate the
    // schema object protected inside the process capability.
    input.schemas.heading.controls.title.type='unsafe';
    await assert.rejects(resolvePendingFormStyles(input,[],proof),/style_input_changed/);
  }finally{await f.cleanup();}
});

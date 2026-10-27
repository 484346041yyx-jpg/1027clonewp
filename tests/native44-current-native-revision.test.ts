import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { native44SubtreeHash, assembleNative44CurrentNativeSnapshot, assertNative44CurrentNativeDelta } from '../src/native44/current-native-patch.js';
import { Native44CurrentNativeRevisionRequestSchema, applyNative44CurrentNativeRevision, prepareNative44CurrentNativeRevision, type Native44CurrentNativeRevisionDependencies, type Native44CurrentNativeRevisionRequest } from '../src/native44/current-native-revision.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import type { CapabilityReport } from '../src/wordpress/types.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { fingerprintNative44Snapshot, type Native44CompareManifest } from '../src/native44/compare.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';

const modules = [{ key: 'panel', className: 'cwp-panel' }], evidence = { path: 'proof.json', sha256: '1'.repeat(64) };
function snapshot(style = '.elementor-77 .cwp-panel .label{color:red;color:blue;padding:4px}.elementor-77 .cwp-panel .other{color:green}') {
  const elements: DraftSnapshot['elements'] = [{ id: 'root123', elType: 'container', settings: { css_classes: 'cwp-panel' }, elements: [{ id: 'head123', elType: 'widget', widgetType: 'heading', settings: { title: 'Editable original' }, elements: [] }] }], settings = { custom_css: style, post_title: 'Draft', post_status: 'draft' };
  return { pageId: 77, runId: 'run-one', title: 'Draft', status: 'draft', elements, settings, hash: documentHashV2(elements, settings) } satisfies DraftSnapshot;
}
const schemas: CapabilityReport['legacySchemas'] = { container: {type:'container',class:'Container',controls:{css_classes:{type:'text'}}}, heading: {type:'heading',class:'Heading',controls:{_css_classes:{type:'text'},title:{type:'textarea'}}} };
const capabilities: CapabilityReport = {mode:'legacy-verified',abilities:[],schemas:{},legacySchemas:schemas,versions:{},limitations:[]};

async function fixture(t: test.TestContext, defaults: {editorNaming?:'native-translated-v1';reviewWorkflow?:'whole-page-after-css-v1'} = {}) {
  const temporary = await mkdtemp(path.resolve(import.meta.dirname, 'fixtures', '.current-native-')); t.after(() => rm(temporary, { recursive: true, force: true })); const root = await realpath(temporary);
  const runId = 'run-one', taskId = 'task-one', runDir = path.join(root, 'runs', runId), folder = path.join(runDir, 'amendments', 'original'), task = path.join(root, 'references', taskId);
  const json = async (filename: string, value: unknown) => { await mkdir(path.dirname(filename), { recursive: true }); const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(filename, bytes); return { path: filename, sha256: hashV2(bytes) }; };
  const before = snapshot(''), after = snapshot(), firstRequest = await json(path.join(folder, 'request.json'), { version: 1, pageId: 77, runId });
  await json(path.join(folder, 'before.json'), before); await json(path.join(folder, 'expected.json'), after); const currentSnapshot = await json(path.join(folder, 'after.json'), after); await writeFile(path.join(folder, 'page-custom.css'), after.settings.custom_css); const currentCSS = { path: path.join(folder, 'page-custom.css'), sha256: hashV2(after.settings.custom_css) };
  const intent = await json(path.join(folder, 'intent.json'), { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: 77, runId, beforeHash: before.hash, expectedHash: after.hash, payloadSha256: after.hash, requestSha256: firstRequest.sha256, cssSha256: currentCSS.sha256 });
  const receipt = await json(path.join(folder, 'receipt.json'), { version: 1, status: 'confirmed', pageId: 77, runId, beforeHash: before.hash, afterHash: after.hash, cssApplied: true });
  const sourceFacts = await json(path.join(task, 'source-facts.json'), { sourceUrl: 'https://source.test/', snapshots: [] }), componentPlan = await json(path.join(task, 'component-plan.json'), {}), assetsManifest = await json(path.join(task, 'asset-manifest.json'), {});
  await mkdir(path.join(root, 'config'), { recursive: true }); await writeFile(path.join(root, 'config/native44-component-set.json'), await readFile(path.resolve(import.meta.dirname, '../config/native44-component-set.json')));
  const componentCatalog = { path: path.join(root, 'config/native44-component-set.json'), sha256: NATIVE44_CATALOG_HASH }, knowledgeRoot = path.join(root, 'data/native44');
  const projectKnowledge = path.resolve(import.meta.dirname, '../data/native44'), realIndex = JSON.parse(await readFile(path.join(projectKnowledge, 'index.json'), 'utf8'));
  for (const name of ['index.json', realIndex.sharedControls.path, realIndex.components.container.path, realIndex.components.heading.path]) { const destination = path.join(knowledgeRoot, name); await mkdir(path.dirname(destination), {recursive:true}); await copyFile(path.join(projectKnowledge, name), destination); }
  const knowledgeRef = {path:path.join(knowledgeRoot, 'index.json'),sha256:hashV2(await readFile(path.join(knowledgeRoot, 'index.json')))}, fingerprint = realIndex.fingerprint, knowledge = {...knowledgeRef,fingerprint}, rulesHash = NATIVE44_SELECTION_RULES_HASH;
  const program = await json(path.join(task, 'program.json'), { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, sourceUrl: 'https://source.test/', componentCatalog, knowledge, sourceFacts, componentPlan, assetsManifest, blocks: [], ...defaults });
  const code = await json(path.join(root, 'src/frozen.json'), { frozen: true }), release = { version: 1, executorId: 'native44', componentSet: { id: 'native44-v1', catalog: componentCatalog, types: [...NATIVE44_ALL_TYPES] }, knowledge: { id: 'knowledge-v1', index: knowledgeRef, fingerprint }, selectionRules: { id: 'desktop-browser-v1', sha256: rulesHash, files: [code] }, adapters: { id: 'native44-desktop-v1', sha256: 'c'.repeat(64), files: [code] } };
  const releaseLock = await json(path.join(task, 'release-lock.json'), { version: 1, kind: 'native44-release-lock', phase: 'final', taskId, replicationProfile: 'desktop-browser-v1', createdAt: new Date().toISOString(), release, program, inputs: { componentCatalog, knowledge, sourceFacts, componentPlan, assetsManifest } });
  const journal = await json(path.join(runDir, 'journal.json'), { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, runId, pageId: 77, targetUrl: 'https://target.test/', selectionRulesHash: rulesHash, releaseLock, programHash: program.sha256, documentHash: before.hash, status: 'draft-saved', mutations: [{ status: 'confirmed', pageId: 77, runId, expectedAfterHash: before.hash, observedHash: before.hash }] });
  const pointer = await json(path.join(runDir, 'current-user-amendment.json'), { version: 1, kind: 'completed-explicit-user-draft-amendment', status: 'applied-pending-review', taskId, runId, pageId: 77, unpublished: true, documentHash: after.hash, cssApplied: true, requestedScope: 'Maintain existing owned draft', counts: { containers: 1, widgets: 1, html: 0, productWidgets: 0 }, currentSnapshot, currentCSS, amendments: [{ intent, receipt, beforeHash: before.hash, afterHash: after.hash }] });
  const views = [{ name: 'desktop-wide', width: 1920, height: 1080 }, { name: 'desktop-narrow', width: 1440, height: 1000 }];
  const manifest: Native44CompareManifest = { version: 1, strategy: 'native44-css-handoff', taskId, runId, pageId: 77, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/', releaseLock, replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, ...fingerprintNative44Snapshot(after), canvasCss: '', widgetTypes: ['container', 'heading'], modules: [{ ...modules[0], sourceSelector: '.panel', targetSelector: '.elementor-77 .cwp-panel', required: true }], cssRules: [], viewports: views, sourceCaptures: { version: 2, taskId, replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, collectionStartedAt: new Date().toISOString(), sourceFacts, componentPlan, viewports: views.map((view, index) => ({ viewport: view.name, snapshotId: index ? 'narrow' : 'wide' })) } };
  const manifestRef = await json(path.join(runDir, 'compare-manifest.json'), manifest), observation = await json(path.join(runDir, 'observation.json'), { observed: true });
  const fragmentProgram = { version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',taskId,title:'Native amendment',sourceUrl:manifest.sourceUrl,replicationProfile:'desktop-browser-v1',selectionRulesHash:rulesHash,componentCatalog,knowledge,sourceFacts,componentPlan,assetsManifest,targetEnvironment:{woodmart:'8.5.5',woodmartCore:'1.1.8',elementor:'3.35.4',elementorPro:'3.35.1'},viewports:views.map(view=>({...view,stage:'desktop'})),blocks:[{kind:'composite',key:'replacement',settings:{css_classes:'cwp-panel'},children:[{kind:'native',key:'editable-content',widgetType:'heading',widgetSettings:{title:'Current compiled native text'}}]}], ...defaults };
  // Ref spellings may use Windows or portable separators; identity is the
  // resolved physical file plus digest, never its JSON path spelling.
  fragmentProgram.componentPlan={...componentPlan,path:componentPlan.path.replaceAll(path.sep,'/')}; fragmentProgram.assetsManifest={...assetsManifest,path:assetsManifest.path.replaceAll(path.sep,'/')};
  const fragment = await json(path.join(runDir,'inputs/native-fragment.json'),fragmentProgram), schemaRef=await json(path.join(runDir,'inputs/schemas.json'),capabilities);
  const request: Native44CurrentNativeRevisionRequest = { version: 1, kind: 'native44-current-native-revision-request', taskId, runId, operationId: 'css-one', pageId: 77, userInstruction: 'Correct observed spacing with native body preserved.', expectedBeforeHash: after.hash, pointer, journal, before: currentSnapshot, css: currentCSS, manifest: manifestRef, releaseLock, program:fragment,schemas:schemaRef,replacements:[{kind:'replace-subtree',elementId:'root123',beforeSubtreeHash:native44SubtreeHash(after.elements[0]),componentKey:'replacement',reason:'Enable requested reusable native interaction.'}],corrections:[] };
  let live: DraftSnapshot = structuredClone(after), saves = 0, factories = 0;
  const remote = (options: { lost?: boolean; published?: boolean; unknown?: boolean } = {}): Native44CurrentNativeRevisionDependencies => ({ remote: async () => { factories++; return { probeOwnedReviewStatus: async (pageId, runId) => ({ pageId, runId, exists: true, postType: 'page', status: options.published ? 'publish' : 'draft', ownerMatches: true, canEdit: true, uniqueRunPage: true, documentExists: true, builtWithElementor: true }), discoverCapabilities: async () => structuredClone(capabilities), readOwnedReviewCheckpoint: async () => { if (options.unknown && saves) throw Error('read unavailable'); return { snapshot: structuredClone(live), proof: {} }; }, saveOwnedNativeRevision: async (before, expected, compiled, replacements, modules, corrections) => { assert.equal(before.hash, live.hash); assertNative44CurrentNativeDelta(before, expected, compiled, replacements, modules, corrections); saves++; live = structuredClone(expected); if (options.lost || options.unknown) throw Error('reply lost'); return structuredClone(live); } }; } });
  return { root, runDir, runId, request, fragmentProgram, before: after, json, remote, saves: () => saves, factories: () => factories };
}

test('v1 native fragments retain frozen naming and review defaults without upgrading old tasks', async t => {
  const defaults={editorNaming:'native-translated-v1' as const,reviewWorkflow:'whole-page-after-css-v1' as const};
  const matching=await fixture(t,defaults);await prepareNative44CurrentNativeRevision(matching.root,matching.request);assert.equal(matching.factories(),0);
  for(const key of ['editorNaming','reviewWorkflow'] as const){
    for(const frozen of [false,true]){
      const f=await fixture(t,frozen?defaults:{}),fragment={...f.fragmentProgram};
      if(frozen)delete fragment[key];else fragment[key]=defaults[key] as never;
      const request={...f.request,program:await f.json(f.request.program.path,fragment)};
      await assert.rejects(prepareNative44CurrentNativeRevision(f.root,request),/fragment_task_defaults_identity_conflict/);assert.equal(f.factories(),0);assert.equal(f.saves(),0);
    }
  }
});

test('current native amendment uses the compiler, retains frozen contract and invalidates review', async t => {
  const f = await fixture(t), journalBytes = await readFile(f.request.journal.path);
  const prepared = await prepareNative44CurrentNativeRevision(f.root, f.request);
  assert.equal(prepared.remoteWrites, 0); assert.equal(f.factories(), 0);
  const result = await applyNative44CurrentNativeRevision(f.root, f.runId, f.request.operationId, f.remote());
  assert.equal(result.status, 'confirmed'); assert.equal(f.saves(), 1);
  assert.equal(result.current?.documentHash, prepared.expectedHash);
  assert.equal(result.current?.visualVerification, 'pending-comparison'); assert.equal(result.current?.axes, undefined);
  const current = JSON.parse(await readFile(result.current!.currentSnapshot.path, 'utf8'));
  assert.equal(current.elements[0].elements[0].settings.title, 'Current compiled native text');
  assert.deepEqual(current.settings, f.before.settings); assert.deepEqual(await readFile(f.request.journal.path), journalBytes);
  const replay = await applyNative44CurrentNativeRevision(f.root, f.runId, f.request.operationId, f.remote());
  assert.equal(replay.remoteWrites, 0); assert.equal(f.saves(), 1);
});
test('unknown native save reconciles read-only; a lost reply does not save twice', async t => {
  const f = await fixture(t); await prepareNative44CurrentNativeRevision(f.root, f.request);
  assert.equal((await applyNative44CurrentNativeRevision(f.root, f.runId, f.request.operationId, f.remote({unknown:true}))).status, 'unknown');
  assert.equal((await applyNative44CurrentNativeRevision(f.root, f.runId, f.request.operationId, f.remote(), 'reconcile')).status, 'confirmed'); assert.equal(f.saves(),1);
  const g = await fixture(t); await prepareNative44CurrentNativeRevision(g.root, g.request);
  assert.equal((await applyNative44CurrentNativeRevision(g.root, g.runId, g.request.operationId, g.remote({lost:true}))).status, 'confirmed'); assert.equal(g.saves(),1);
});
test('current native amendment rejects stale parents, tampered fragments and published pages', async t => {
  const f = await fixture(t); await prepareNative44CurrentNativeRevision(f.root, f.request);
  await writeFile(f.request.program.path, JSON.stringify({...f.fragmentProgram,title:'External change'}));
  await assert.rejects(applyNative44CurrentNativeRevision(f.root, f.runId, f.request.operationId, f.remote()), /hash_mismatch/); assert.equal(f.factories(),0);
  const g = await fixture(t); await prepareNative44CurrentNativeRevision(g.root, g.request);
  await assert.rejects(applyNative44CurrentNativeRevision(g.root, g.runId, g.request.operationId, g.remote({published:true})), /ineligible/); assert.equal(g.saves(),0);
  const h = await fixture(t); await prepareNative44CurrentNativeRevision(h.root, h.request);
  const pointer = JSON.parse(await readFile(h.request.pointer.path,'utf8')); await writeFile(h.request.pointer.path,JSON.stringify({...pointer,requestedScope:'Another accepted change'}));
  await assert.rejects(applyNative44CurrentNativeRevision(h.root,h.runId,h.request.operationId,h.remote()),/parent_changed/); assert.equal(h.factories(),0);
});
test('only compiler-proven, uniquely owned fragments can replace existing native subtrees', async t => {
  const f = await fixture(t), knowledge = await loadNative44Knowledge(['container','heading'],path.dirname(f.fragmentProgram.knowledge.path));
  const compiled = compileNative44(f.fragmentProgram as any,{schemas,assets:[],knowledge:toNative44CompilerKnowledge(knowledge,schemas)});
  const next=assembleNative44CurrentNativeSnapshot(f.before,compiled,f.request.replacements,modules,[]);
  assert.doesNotThrow(()=>assertNative44CurrentNativeDelta(f.before,next,compiled,f.request.replacements,modules,[]));
  assert.throws(()=>assertNative44CurrentNativeDelta(f.before,next,structuredClone(compiled),f.request.replacements,modules,[]),/current-process/);
  assert.throws(()=>assembleNative44CurrentNativeSnapshot(f.before,compiled,[{...f.request.replacements[0],beforeSubtreeHash:'0'.repeat(64)}],modules,[]),/owner_conflict/);
  assert.throws(()=>assembleNative44CurrentNativeSnapshot(f.before,compiled,[...f.request.replacements,...f.request.replacements],modules,[]),/owner_conflict/);
  const altered=structuredClone(next); altered.settings.post_title='Changed page'; altered.hash=documentHashV2(altered.elements,altered.settings);
  assert.throws(()=>assertNative44CurrentNativeDelta(f.before,altered,compiled,f.request.replacements,modules,[]),/unexpected_document_delta/);
  const nested=structuredClone(f.before); nested.elements=[{id:'outer123',elType:'container',settings:{},elements:nested.elements}];nested.hash=documentHashV2(nested.elements,nested.settings);
  const inner=assembleNative44CurrentNativeSnapshot(nested,compiled,f.request.replacements,modules,[]);
  assert.equal(inner.elements[0].elements[0].isInner,true);assert.equal(compiled.composition.elements[0].isInner,false);
});
test('product owners, existing media, HTML and unadapted resources cannot be bypassed by native replacement', async t => {
  const f=await fixture(t), knowledge=await loadNative44Knowledge(['container','heading'],path.dirname(f.fragmentProgram.knowledge.path));
  const compiled=compileNative44(f.fragmentProgram as any,{schemas,assets:[],knowledge:toNative44CompilerKnowledge(knowledge,schemas)});
  const product=structuredClone(f.before); product.elements[0].elements[0].widgetType='wd_products'; product.hash=documentHashV2(product.elements,product.settings);
  assert.throws(()=>assembleNative44CurrentNativeSnapshot(product,compiled,[{...f.request.replacements[0],beforeSubtreeHash:native44SubtreeHash(product.elements[0])}],modules,[]),/product_owner/);
  const media=structuredClone(f.before); media.elements[0].elements[0].settings.image={id:1,url:'https://target.test/owned.png'}; media.hash=documentHashV2(media.elements,media.settings);
  assert.throws(()=>assembleNative44CurrentNativeSnapshot(media,compiled,[{...f.request.replacements[0],beforeSubtreeHash:native44SubtreeHash(media.elements[0])}],modules,[]),/media_binding_removed/);
  assert.throws(()=>Native44CurrentNativeRevisionRequestSchema.parse({...f.request,elements:compiled.composition.elements}));
  const bad=await f.json(path.join(f.runDir,'inputs/unsafe-program.json'),{...f.fragmentProgram,blocks:[{kind:'composite',key:'replacement',children:[{kind:'native',key:'unknown-menu',widgetType:'wd_extra_menu_list',widgetSettings:{menu:'12'},resources:[{kind:'menu',ids:[12],targetOrigin:'https://target.test',evidence:['fake']}]}]}]});
  await assert.rejects(prepareNative44CurrentNativeRevision(f.root,{...f.request,program:bad}),/resource|adapter|capability/); assert.equal(f.factories(),0);
});

test('real native writer requires an attested baseline and compiler proof, then saves once under full CAS without restoring unknown writes', async t => {
  const f=await fixture(t), knowledge=await loadNative44Knowledge(['container','heading'],path.dirname(f.fragmentProgram.knowledge.path));
  const compiled=compileNative44(f.fragmentProgram as any,{schemas,assets:[],knowledge:toNative44CompilerKnowledge(knowledge,schemas)}), expected=assembleNative44CurrentNativeSnapshot(f.before,compiled,f.request.replacements,modules,[]);
  let current=structuredClone(f.before), writes=0;
  const client=new WordPressClient({targetUrl:'https://target.test/',username:'fixture',applicationPassword:'fixture',executionStrategy:'native44-css-handoff',fetch:async()=>{throw Error('No external requests in writer test');}});
  const internals=client as any; internals.ownedPages.set(current.pageId,current.runId); internals.capabilities=structuredClone(capabilities);
  internals.discoverCapabilities=async()=>structuredClone(capabilities);
  internals.php=async(code:string)=>{
    const match=code.match(/\$input=json_decode\(base64_decode\('([^']+)'\), true\);/);
    if(match){assert.match(code,/concurrent_document_change/);assert.match(code,/ambiguous_run_pages/);assert.match(code,/native_revision_save_failed/);writes++; const value=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'));current={...current,...value,hash:documentHashV2(value.elements,value.settings)};return {saved:true};}
    const {hash:_,...plain}=structuredClone(current);return plain;
  };
  await assert.rejects(client.saveOwnedNativeRevision(f.before,expected,compiled,f.request.replacements,modules,[]),/baseline_not_attested|server-read/); assert.equal(writes,0);
  const attested=await client.readDraft(current.pageId);
  await assert.rejects(client.saveOwnedNativeRevision(attested,expected,structuredClone(compiled),f.request.replacements,modules,[]),/current-process/); assert.equal(writes,0);
  assert.equal((await client.saveOwnedNativeRevision(attested,expected,compiled,f.request.replacements,modules,[])).hash,expected.hash); assert.equal(writes,1);
  await assert.rejects(client.saveOwnedNativeRevision(attested,expected,compiled,f.request.replacements,modules,[]),/concurrent_document_change|changed before/); assert.equal(writes,1);
});

test('persistent native history rejects forged knowledge, wrong-task fragments and rewritten manifest declarations even with recomputed index hashes', async t => {
  for (const attack of ['knowledge','task','manifest'] as const) {
    const f=await fixture(t);await prepareNative44CurrentNativeRevision(f.root,f.request);await applyNative44CurrentNativeRevision(f.root,f.runId,f.request.operationId,f.remote());
    const folder=path.join(f.runDir,'amendments',f.request.operationId), pointerPath=path.join(f.runDir,'current-user-amendment.json'), pointer=JSON.parse(await readFile(pointerPath,'utf8'));
    const proof=JSON.parse(await readFile(path.join(folder,'native-proof.json'),'utf8')), request=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8')), intent=JSON.parse(await readFile(path.join(folder,'intent.json'),'utf8'));
    if(attack==='knowledge') proof.knowledge.components.heading.title='Forged knowledge wrapper';
    if(attack==='task') { proof.program.taskId='wrong-task'; request.program=await f.json(request.program.path,proof.program); const requestRef=await f.json(path.join(folder,'request.json'),request);intent.requestSha256=requestRef.sha256; }
    if(attack==='manifest') { proof.manifest.knownGaps=[{category:'evidence',detail:'A fabricated permissive declaration.',blocking:false}];pointer.currentManifest=await f.json(path.join(folder,'compare-manifest.json'),proof.manifest); }
    const proofRef=await f.json(path.join(folder,'native-proof.json'),proof);intent.nativeProofSha256=proofRef.sha256;
    const intentRef=await f.json(path.join(folder,'intent.json'),intent);pointer.amendments[pointer.amendments.length-1].intent=intentRef;await f.json(pointerPath,pointer);
    await assert.rejects(readNative44CurrentState(f.root,f.runDir),attack==='knowledge'?/knowledge_conflict/:attack==='task'?/program_identity_conflict/:/manifest_conflict/);
  }
});

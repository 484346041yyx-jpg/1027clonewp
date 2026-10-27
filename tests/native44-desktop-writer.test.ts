import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { WordPressClient } from '../src/wordpress/client.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { saveNative44Body, type Native44Journal } from '../src/native44/lifecycle.js';
import { documentHashV2, readSnapshotRefV2 } from '../src/replica-v2/journal.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program } from '../src/native44/types.js';
import type { CapabilityReport, DraftSnapshot, ElementorElement, LegacySchema } from '../src/wordpress/types.js';

const root='D:/cloneWP',digest='c'.repeat(64),ref={path:'D:/cloneWP/tests/fixtures/desktop-writer.json',sha256:digest};
const schemas:Record<string,LegacySchema>={
  container:{type:'container',class:'Container',controls:{css_classes:{type:'text'}}},
  heading:{type:'heading',class:'Heading',controls:{_css_classes:{type:'text'},title:{type:'text'}}},
};
function program():Native44Program{return{
  version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',replicationProfile:'desktop-browser-v1',selectionRulesHash:NATIVE44_SELECTION_RULES_HASH,
  taskId:'desktop-writer',title:'Desktop writer fixture',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:digest},targetEnvironment:{...NATIVE44_TARGET_ENVIRONMENT},sourceFacts:ref,componentPlan:ref,assetsManifest:ref,
  viewports:native44ProfileViewports('desktop-browser-v1'),blocks:[{kind:'composite',key:'services',editorTitle:'Services section',children:[{kind:'native',key:'heading',editorTitle:'Services heading',widgetType:'heading',widgetSettings:{title:'Services'}}]}],
};}
const compile=(p=program())=>compileNative44(p,{schemas,assets:[],knowledge:{fingerprint:digest,controlsByWidget:Object.fromEntries(Object.entries(schemas).map(([type,schema])=>[type,new Set(Object.keys(schema.controls))]))}});
function snapshot(elements:ElementorElement[]=[],settings:Record<string,unknown>={existing:'preserve'}):DraftSnapshot{return{pageId:77,runId:'desktop-writer-run',title:'Desktop writer fixture',status:'draft',elements,settings,hash:documentHashV2(elements,settings)};}
interface Internals{ownedPages:Map<number,string>;capabilities:CapabilityReport;php:(code:string)=>Promise<unknown>;}
function actualClient(options:{native44?:boolean;loseAfter?:boolean;assertDurableIntent?:()=>Promise<void>}={}){
  let current=snapshot(),networkCalls=0,reads=0,saves=0,remainingLoss=options.loseAfter??false;
  const savedInputs:Array<{elements:ElementorElement[];settings:Record<string,unknown>}>=[];
  const client=new WordPressClient({targetUrl:'https://target.example/',username:'fixture',applicationPassword:'fixture',...(options.native44===false?{}:{executionStrategy:'native44-css-handoff' as const}),fetch:async()=>{networkCalls++;throw Error('No real network in desktop writer fixture');}}),internal=client as unknown as Internals;
  internal.ownedPages.set(77,current.runId);internal.capabilities={mode:'legacy-verified',abilities:[],schemas:{},legacySchemas:schemas,versions:{},limitations:[]};
  internal.php=async code=>{
    const match=code.match(/\$input=json_decode\(base64_decode\('([^']+)'\), true\);/);
    if(match){
      assert.ok(code.includes('document_save_failed'),'Only the intended body-save operation is mocked');
      await options.assertDurableIntent?.();const input=JSON.parse(Buffer.from(match[1],'base64').toString('utf8')) as {elements:ElementorElement[];settings:Record<string,unknown>};
      saves++;savedInputs.push(structuredClone(input));current=snapshot(input.elements,{...current.settings,...input.settings});
      if(remainingLoss){remainingLoss=false;throw Error('network_error: response lost after save');}
      return{saved:true,elements:structuredClone(current.elements),settings:structuredClone(current.settings)};
    }
    assert.ok(code.includes("'pageId'=>$id")&&code.includes("'runId'=>$run"),'Only readback snapshots may follow the body save');
    reads++;const {hash:_,...plain}=structuredClone(current);return plain;
  };
  return{client,savedInputs,get current(){return structuredClone(current);},get networkCalls(){return networkCalls;},get reads(){return reads;},get saves(){return saves;}};
}
async function journalFixture(t:{after:(fn:()=>Promise<void>)=>void}){
  const folder=await mkdtemp(path.join(root,'.cache','native44-desktop-writer-'));t.after(async()=>{const rel=path.relative(root,folder);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await rm(folder,{recursive:true,force:true});});
  const runDir=path.join(folder,'runs','run');await mkdir(runDir,{recursive:true});const p=program();
  const journal:Native44Journal={version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',replicationProfile:p.replicationProfile,selectionRulesHash:p.selectionRulesHash,taskId:p.taskId,runId:'desktop-writer-run',runDir,targetUrl:'https://target.example/',programHash:digest,sourceFactsHash:digest,componentPlanHash:digest,assetsManifestHash:digest,componentCatalog:p.componentCatalog,knowledge:p.knowledge,targetEnvironment:p.targetEnvironment,status:'running',pageId:77,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),mutations:[],deliveryComplete:false,visualVerification:'pending-comparison',metrics:{}};
  return{runDir,journal};
}

test('desktop writer saves native names without Navigator metadata',async()=>{
  const compiled=compile(),f=actualClient(),saved=await f.client.buildDraft(77,compiled.composition,undefined,{expectedCurrent:snapshot(),native44Proof:compiled,preserveUnknownWrite:true});
  assert.equal(f.saves,1);assert.equal(f.networkCalls,0);assert.equal(saved.elements[0].settings._title,undefined);assert.equal(saved.elements[0].elements[0].settings._title,undefined);
  assert.deepEqual(f.savedInputs[0].elements,saved.elements);assert.equal(saved.hash,documentHashV2(saved.elements,saved.settings));assert.equal(f.client.diagnostics().documentSaves,1);
});

test('writer rejects aliases even when the live schema advertises _title as a control',async()=>{
  for(const target of ['container','widget'] as const){
    const f=actualClient({native44:false}),composition=structuredClone(compile().composition);
    const internal=f.client as unknown as Internals;
    internal.capabilities=structuredClone(internal.capabilities);
    for(const schema of Object.values(internal.capabilities.legacySchemas))schema.controls._title={type:'text'};
    const node=target==='container'?composition.elements[0]:composition.elements[0].elements[0];
    node.settings._title='';
    await assert.rejects(f.client.buildDraft(77,composition,undefined,{expectedCurrent:snapshot()}),/Navigator aliases/);
    assert.equal(f.saves,0);assert.equal(f.reads,0);assert.equal(f.networkCalls,0);
  }
});

test('desktop writer rejects persisted proof copies, changed labels, and extra unknown controls before reading or saving',async()=>{
  for(const attack of ['persisted-proof','metadata-mismatch','tree-label','extra-control'] as const){
    const compiled=compile(),f=actualClient();let proof=compiled;
    if(attack==='persisted-proof')proof=structuredClone(compiled);
    if(attack==='metadata-mismatch')compiled.editorLabels=[{elementId:compiled.composition.elements[0].id,title:'Different metadata'}];
    if(attack==='tree-label')compiled.composition.elements[0].settings._title='Unsealed title';
    if(attack==='extra-control')compiled.composition.elements[0].settings.unregistered_layout='row';
    await assert.rejects(f.client.buildDraft(77,compiled.composition,undefined,{expectedCurrent:snapshot(),native44Proof:proof,preserveUnknownWrite:true}),/compiler proof|current-process|not registered/i,attack);
    assert.equal(f.saves,0);assert.equal(f.reads,0);assert.equal(f.networkCalls,0);
  }
});

test('original and historical writers gain no editor-metadata exception from the desktop proof',async()=>{
  const desktop=compile(),original=actualClient({native44:false});
  const injected=structuredClone(desktop.composition);injected.elements[0].settings._title='Invented alias';
  await assert.rejects(original.client.buildDraft(77,injected,undefined,{expectedCurrent:snapshot(),native44Proof:desktop}),/Navigator aliases/);assert.equal(original.saves,0);assert.equal(original.reads,0);
  const p=program();delete p.replicationProfile;delete p.selectionRulesHash;p.blocks.forEach(node=>{delete node.editorTitle;if(node.kind==='composite')node.children.forEach(child=>delete child.editorTitle);});p.viewports=[{name:'desktop',width:1920,height:1080,stage:'desktop'}];
  const legacy=compile(p),historical=actualClient();legacy.composition.elements[0].settings._title='Invented historical title';legacy.editorLabels=[{elementId:legacy.composition.elements[0].id,title:'Invented historical title'}];
  await assert.rejects(historical.client.buildDraft(77,legacy.composition,undefined,{expectedCurrent:snapshot(),native44Proof:legacy}),/current-process/);assert.equal(historical.saves,0);assert.equal(historical.reads,0);
  await assert.rejects(actualClient().client.buildDraft(77,desktop.composition,undefined,{expectedCurrent:snapshot()}),/current-process/);
});

test('desktop complete-body lifecycle uses the real writer once and durable expected state excludes Navigator aliases',async t=>{
  const {runDir,journal}=await journalFixture(t),compiled=compile(),f=actualClient({assertDurableIntent:async()=>{
    const durable=JSON.parse(await readFile(path.join(runDir,'journal.json'),'utf8')) as Native44Journal;assert.equal(durable.mutations.length,1);assert.equal(durable.mutations[0].status,'intent');
    const expected=await readSnapshotRefV2(runDir,path.join(runDir,'mutations',`${durable.mutations[0].id}-expected.json`));assert.equal(expected.elements[0].settings._title,undefined);assert.equal(expected.elements[0].elements[0].settings._title,undefined);
  }});
  const saved=await saveNative44Body({client:f.client,journal,compiled,baseline:snapshot(),schemas});assert.equal(f.saves,1);assert.equal(journal.mutations[0].status,'confirmed');assert.equal(journal.metrics.bodyWriteAttempts,1);assert.equal(saved.hash,journal.documentHash);
  const reads=f.reads;await saveNative44Body({client:f.client,journal,compiled:compile(),baseline:saved,schemas});assert.equal(f.saves,1);assert.ok(f.reads>reads);assert.equal(f.client.diagnostics().documentSaves,1);
});

test('desktop lost-response recovery and persisted resume reconcile actual after state using reads only',async t=>{
  const {runDir,journal}=await journalFixture(t),f=actualClient({loseAfter:true}),saved=await saveNative44Body({client:f.client,journal,compiled:compile(),baseline:snapshot(),schemas});
  assert.equal(f.saves,1);assert.equal(journal.mutations[0].status,'confirmed');assert.equal(journal.status,'draft-saved');assert.equal(saved.elements[0].settings._title,undefined);
  const resumed=JSON.parse(await readFile(path.join(runDir,'journal.json'),'utf8')) as Native44Journal,reads=f.reads;await saveNative44Body({client:f.client,journal:resumed,compiled:compile(),baseline:saved,schemas});assert.equal(f.saves,1);assert.ok(f.reads>reads);assert.equal(resumed.metrics.bodyWriteAttempts,1);assert.equal(f.networkCalls,0);
});

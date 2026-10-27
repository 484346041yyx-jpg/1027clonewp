import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { saveNative44Body, type Native44Journal } from '../src/native44/lifecycle.js';
import { importNative44Media } from '../src/native44/media.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import { documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program } from '../src/native44/types.js';
import type { DraftSnapshot, LegacySchema, RecoverableAssetImportOptions } from '../src/wordpress/types.js';
import { WordPressClient } from '../src/wordpress/client.js';

const root='D:/cloneWP',hash='a'.repeat(64),ref={path:'fixture.json',sha256:hash};
const schemas:Record<string,LegacySchema>={container:{type:'container',class:'Container',controls:{css_classes:{type:'text'}}},heading:{type:'heading',class:'Heading',controls:{title:{type:'text'}}}};
const program:Native44Program={version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',taskId:'lifecycle-fixture',title:'Fixture',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:hash},targetEnvironment:{...NATIVE44_TARGET_ENVIRONMENT},sourceFacts:ref,componentPlan:ref,assetsManifest:ref,viewports:[{name:'desktop',width:1920,height:1080,stage:'desktop'}],blocks:[{kind:'native',key:'title',widgetType:'heading',widgetSettings:{title:'Full body'}}]};
const compile=()=>compileNative44(program,{schemas,assets:[],knowledge:{fingerprint:hash,controlsByWidget:{container:new Set(['css_classes']),heading:new Set(['title'])}}});
function snapshot(elements:DraftSnapshot['elements']=[],settings:Record<string,unknown>={existing:'keep'}):DraftSnapshot{return{pageId:77,runId:'native44-test-run',title:'Fixture',status:'draft',elements,settings,hash:documentHashV2(elements,settings)};}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){const folder=await mkdtemp(path.join(root,'.cache','native44-lifecycle-'));t.after(async()=>{const rel=path.relative(root,folder);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await rm(folder,{recursive:true,force:true});});const runDir=path.join(folder,'runs','run');await mkdir(runDir,{recursive:true});const journal:Native44Journal={version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',taskId:program.taskId,runId:'native44-test-run',runDir,targetUrl:'https://target.example/',programHash:hash,sourceFactsHash:hash,componentPlanHash:hash,assetsManifestHash:hash,componentCatalog:program.componentCatalog,knowledge:program.knowledge,targetEnvironment:program.targetEnvironment,status:'running',pageId:77,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),mutations:[],deliveryComplete:false,visualVerification:'pending-comparison',metrics:{}};return{folder,runDir,journal};}
type Mode='success'|'lose-after'|'lose-before'|'third-state'|'concurrent';
function bodyClient(journal:Native44Journal,mode:Mode='success'){
  let current=snapshot(),writes=0,reads=0,remaining=mode;
  const client={snapshotDraft:async()=>{reads++;return structuredClone(current);},buildDraft:async(_page:number,composition:any,_assets?:any,options?:any)=>{
    writes++;const durable=JSON.parse(await readFile(path.join(journal.runDir,'journal.json'),'utf8'));assert.equal(durable.mutations.length,1);assert.equal(durable.mutations[0].status,'intent');assert.equal(options.native44Proof.composition,composition);
    if(remaining==='lose-before'){remaining='success';throw Error('network_error before write');}
    if(remaining==='concurrent'){current=snapshot([],{human:'changed'});assert.notEqual(options.expectedCurrent.hash,current.hash);throw Error('concurrent_document_change');}
    if(options.expectedCurrent.hash!==current.hash)throw Error('concurrent_document_change');
    current=snapshot(compileEditorElements(composition.elements,schemas,{executionStrategy:'native44-css-handoff'}),{...current.settings,...composition.pageSettings});
    if(remaining==='third-state'){current=snapshot(current.elements,{human:'third'});throw Error('invalid JSON response');}
    if(remaining==='lose-after'){remaining='success';throw Error('invalid JSON response');}return structuredClone(current);
  }};
  return{client,get current(){return current;},get writes(){return writes;},get reads(){return reads;}};
}
test('native44 body commits once; save intent precedes the call and confirmed resume only reads',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal),compiled=compile(),baseline=snapshot();const saved=await saveNative44Body({client:c.client,journal:f.journal,compiled,baseline,schemas});assert.equal(c.writes,1);assert.equal(saved.settings.existing,'keep');assert.equal(f.journal.mutations[0].status,'confirmed');await saveNative44Body({client:c.client,journal:f.journal,compiled,baseline:saved,schemas});assert.equal(c.writes,1);
});
test('native44 lost save response confirms the actual after state with no second write',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal,'lose-after');await saveNative44Body({client:c.client,journal:f.journal,compiled:compile(),baseline:snapshot(),schemas});assert.equal(c.writes,1);assert.equal(f.journal.status,'draft-saved');assert.equal(f.journal.mutations[0].status,'confirmed');
});
test('native44 unchanged before state is retryable only on explicit resume after read-only reconciliation',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal,'lose-before'),compiled=compile();await assert.rejects(saveNative44Body({client:c.client,journal:f.journal,compiled,baseline:snapshot(),schemas}),/network_error/);assert.equal(c.writes,1);assert.equal(f.journal.mutations[0].status,'retryable');await saveNative44Body({client:c.client,journal:f.journal,compiled,baseline:snapshot(),schemas});assert.equal(c.writes,2);assert.equal(f.journal.mutations.length,1);assert.equal(f.journal.mutations[0].status,'confirmed');
});
test('native44 third state remains a durable conflict and cannot be overwritten on resume',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal,'third-state'),compiled=compile();await assert.rejects(saveNative44Body({client:c.client,journal:f.journal,compiled,baseline:snapshot(),schemas}),/differs/);assert.equal(f.journal.status,'conflict');const reads=c.reads;await assert.rejects(saveNative44Body({client:c.client,journal:f.journal,compiled,baseline:c.current,schemas}),/unresolved document conflict/);assert.equal(c.writes,1);assert.equal(c.reads,reads);
});
test('native44 concurrent modification is preserved by whole-document CAS',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal,'concurrent');await assert.rejects(saveNative44Body({client:c.client,journal:f.journal,compiled:compile(),baseline:snapshot(),schemas}),/Concurrent document content/);assert.deepEqual(c.current.settings,{human:'changed'});assert.equal(f.journal.status,'conflict');assert.equal(c.writes,1);
});
test('native44 inability to persist intent stops before the remote body save',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal);await writeFile(path.join(f.runDir,'mutations'),'not a directory');await assert.rejects(saveNative44Body({client:c.client,journal:f.journal,compiled:compile(),baseline:snapshot(),schemas}));assert.equal(c.writes,0);
});
test('native44 handoff freezes writes before reading or restoring the draft',async t=>{
  const f=await fixture(t),c=bodyClient(f.journal);f.journal.deliveryComplete=true;f.journal.status='delivered';await assert.rejects(saveNative44Body({client:c.client,journal:f.journal,compiled:compile(),baseline:snapshot(),schemas}),/handoff freezes/);assert.equal(c.writes,0);assert.equal(c.reads,0);
});
test('native44 human content before the first body intent is preserved even with a fresh baseline',async t=>{
  const f=await fixture(t),current=snapshot(compile().composition.elements),client={snapshotDraft:async()=>current,buildDraft:async()=>{throw Error('must not write');}};await assert.rejects(saveNative44Body({client,journal:f.journal,compiled:compile(),baseline:current,schemas}),/existing content before/);assert.equal(f.journal.mutations.length,0);
});
async function mediaFixture(t:{after:(fn:()=>Promise<void>)=>void}){const f=await fixture(t),jobDir=path.join(f.folder,'job');await mkdir(jobDir);const bytes=await sharp({create:{width:2,height:2,channels:4,background:'#ffffff'}}).png().toBuffer(),localPath=path.join(jobDir,'logo.png');await writeFile(localPath,bytes);return{...f,jobDir,bytes,source:{key:'logo',localPath:'logo.png',sourceUrl:'https://source.example/logo.png',sha256:hashV2(bytes),mediaType:'image/png'}};}
test('native44 media reuses exact bytes across usage keys and resume without a second upload',async t=>{
  const f=await mediaFixture(t),imported={attachmentId:11,url:'https://target.example/logo.png',sourceUrl:f.source.sourceUrl,sha256:f.source.sha256,mimeType:'image/png'},state={uploads:0,verifies:0};
  const client={verifyImportedAssets:async()=>{state.verifies++;},inspectPendingAsset:async()=>({status:'absent' as const,sha256:f.source.sha256,bytes:0}),importAsset:async(_local:string,options:RecoverableAssetImportOptions)=>{if(options.requireExisting)return imported;await options.onCheckpoint?.({phase:'uploading',remoteWriteStarted:true});const ledger=JSON.parse(await readFile(path.join(f.runDir,'assets','ledger.json'),'utf8'));assert.equal(ledger.assets[0].operations[0].status,'intent');state.uploads++;await options.onCheckpoint?.({phase:'registering',remoteWriteStarted:true});await options.onCheckpoint?.({phase:'complete',remoteWriteStarted:true});return imported;}};
  const opts={client,root,runDir:f.runDir,jobDir:f.jobDir,runId:f.journal.runId,pageId:77,manifest:[f.source,{...f.source,key:'duplicate'}],required:['logo','duplicate']};const assets=await importNative44Media(opts);assert.equal(state.uploads,1);assert.deepEqual(assets.map(a=>[a.key,a.attachmentId]),[['logo',11],['duplicate',11]]);await importNative44Media(opts);assert.equal(state.uploads,1);assert.ok(state.verifies>=3);
});
test('native44 interrupted media registration resolves by exact attachment lookup without an upload',async t=>{
  const f=await mediaFixture(t),ledger={version:1,runId:f.journal.runId,pageId:77,assets:[{key:'logo',sha256:f.source.sha256,status:'unknown',remoteWriteStarted:true,operations:[]}]};await mkdir(path.join(f.runDir,'assets'));await writeFile(path.join(f.runDir,'assets','ledger.json'),JSON.stringify(ledger));let uploads=0;
  const client={verifyImportedAssets:async()=>{},inspectPendingAsset:async()=>{throw Error('Must not inspect registered media');},importAsset:async(_local:string,options:RecoverableAssetImportOptions)=>{assert.equal(options.requireExisting,true);uploads++;return{attachmentId:12,url:'https://target.example/logo.png',sourceUrl:f.source.sourceUrl,sha256:f.source.sha256,mimeType:'image/png'};}};
  const assets=await importNative44Media({client,root,runDir:f.runDir,jobDir:f.jobDir,runId:f.journal.runId,pageId:77,manifest:[f.source],required:['logo']});assert.equal(assets[0].attachmentId,12);assert.equal(uploads,1);
});
test('native44 ambiguous pending media preserves unknown state and forbids duplicate uploads',async t=>{
  const f=await mediaFixture(t);await mkdir(path.join(f.runDir,'assets'));await writeFile(path.join(f.runDir,'assets','ledger.json'),JSON.stringify({version:1,runId:f.journal.runId,pageId:77,assets:[{key:'logo',sha256:f.source.sha256,status:'unknown',remoteWriteStarted:true,operations:[]}]}));let attempts=0;
  const client={verifyImportedAssets:async()=>{},inspectPendingAsset:async()=>({status:'attachment-present' as const,sha256:f.source.sha256,bytes:f.bytes.length}),importAsset:async(_local:string,options:RecoverableAssetImportOptions):Promise<never>=>{assert.equal(options.requireExisting,true);attempts++;throw Object.assign(Error('not found'),{code:'existing_asset_required'});}};
  await assert.rejects(importNative44Media({client,root,runDir:f.runDir,jobDir:f.jobDir,runId:f.journal.runId,pageId:77,manifest:[f.source],required:['logo']}),/Ambiguous media/);const ledger=JSON.parse(await readFile(path.join(f.runDir,'assets','ledger.json'),'utf8'));assert.equal(attempts,1);assert.equal(ledger.assets[0].status,'unknown');assert.equal(ledger.assets[0].remoteWriteStarted,true);
});
test('native44 read-only recovery failure cannot erase an earlier unknown upload state',async t=>{
  const f=await mediaFixture(t);await mkdir(path.join(f.runDir,'assets'));await writeFile(path.join(f.runDir,'assets','ledger.json'),JSON.stringify({version:1,runId:f.journal.runId,pageId:77,assets:[{key:'logo',sha256:f.source.sha256,status:'unknown',remoteWriteStarted:true,operations:[]}]}));
  let fetches=0;const actualClient=new WordPressClient({targetUrl:'https://target.example',username:'fixture',applicationPassword:'fixture',fetch:async()=>{fetches++;throw Error('network failure');}});(actualClient as unknown as {ownedPages:Map<number,string>}).ownedPages.set(77,f.journal.runId);
  const client={verifyImportedAssets:async()=>{},inspectPendingAsset:async()=>{throw Error('Must not start another step after lookup failed');},importAsset:(local:string,options:RecoverableAssetImportOptions)=>{assert.equal(options.requireExisting,true);return actualClient.importAsset(local,options);}};
  await assert.rejects(importNative44Media({client,root,runDir:f.runDir,jobDir:f.jobDir,runId:f.journal.runId,pageId:77,manifest:[f.source],required:['logo']}));const ledger=JSON.parse(await readFile(path.join(f.runDir,'assets','ledger.json'),'utf8'));assert.equal(ledger.assets[0].remoteWriteStarted,true);assert.equal(ledger.assets[0].status,'unknown');assert.ok(fetches>=1&&fetches<=3);
});

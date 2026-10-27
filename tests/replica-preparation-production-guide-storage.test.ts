import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {encodeProductionGuideChunk,decodeProductionGuideChunk,productionGuideChunkFitsStorage,PRODUCTION_GUIDE_STORAGE_BYTES} from '../src/replica-preparation/production-guide-storage.js';
import {preparationJson} from '../src/replica-preparation/contract.js';
import {initializePreparation,readPreparationProductionGuide} from '../src/replica-preparation/io.js';
import {preparationIOFixture} from './helpers/preparation-io-fixture.js';
const digest=(v:unknown)=>createHash('sha256').update(preparationJson(v)).digest('hex');
const settings={form_fields:[{custom_id:'code',field_options:'Country|123\n'.repeat(4300)}],submit_actions:[],_attributes:'inert|true\naria-disabled|true'};
const identity={taskId:'task',runId:'run',scope:'body-1',contractHash:'a'.repeat(64)};
function original(extra:Record<string,unknown>={}) {return {version:1,kind:'clonewp-production-guide-section',...identity,device:'desktop',sectionKey:'hero',guide:{key:'hero',rendered:'not-verified',sourceFacts:{original:{text:'完整隐藏内容'}},sourceNodeDetails:[{nodeId:'original'}],viewports:[{snapshotId:'wide',requirements:Array.from({length:700},(_,i)=>({sourceFactId:'fact-'+i,presentation:{behaviorVerified:false,owners:[{componentKey:'form',responsibility:'assigned-not-render-verified',nativeSettings:settings}]}}))}]},...extra};}
const getOwners=(v:any)=>v.chunk.guide.viewports[0].requirements.map((r:any)=>r.presentation.owners[0]);

test('small historical chunks stay inline and owner-looking source data never collides with the encoding',()=>{
 const old={version:1,kind:'clonewp-production-guide-section',guide:{data:{kind:'clonewp-production-guide-owner-settings-reference',version:1,componentKey:'x',sha256:'b'.repeat(64)}}};
 assert.equal(encodeProductionGuideChunk(old),old);assert.equal(decodeProductionGuideChunk(old),old);
});
test('oversize source-presentation settings encode losslessly without upgrading any evidence status',()=>{
 const source=original(),canonical=preparationJson(source);assert.ok(Buffer.byteLength(canonical)>PRODUCTION_GUIDE_STORAGE_BYTES);
 const encoded:any=encodeProductionGuideChunk(source);assert.equal(encoded.kind,'clonewp-production-guide-native-settings-dictionary');assert.equal(encoded.dictionary.length,1);assert.ok(productionGuideChunkFitsStorage(encoded));
 assert.equal(preparationJson(decodeProductionGuideChunk(encoded)),canonical);assert.equal(source.guide.viewports[0].requirements.length,700);assert.equal(source.guide.rendered,'not-verified');assert.equal(getOwners(encoded)[0].responsibility,'assigned-not-render-verified');
});
test('dictionary refs, hashes, component ownership, version and unchanged-source digest all fail closed',()=>{
 const baseline:any=encodeProductionGuideChunk(original());
 for(const scenario of ['dictionary-hash','missing-ref','component','responsibility','original-hash','version','unused'] as const){
  const value=structuredClone(baseline),owner=getOwners(value)[0];
  if(scenario==='dictionary-hash')value.dictionary[0].nativeSettings.extra='changed';
  if(scenario==='missing-ref')owner.nativeSettings.sha256='0'.repeat(64);
  if(scenario==='component')owner.componentKey='different';
  if(scenario==='responsibility')owner.responsibility='render-verified';
  if(scenario==='original-hash')value.originalSha256='0'.repeat(64);
  if(scenario==='version')value.version=2;
  if(scenario==='unused'){const nativeSettings={other:'unused'};value.dictionary.push({sha256:digest(nativeSettings),nativeSettings});}
  assert.throws(()=>decodeProductionGuideChunk(value),/production_guide_storage_/,scenario);
 }
});
test('storage never raises byte or JSON value budgets and rejects decompression expansion before allocation',()=>{
 assert.throws(()=>encodeProductionGuideChunk({guide:{sourceText:'x'.repeat(PRODUCTION_GUIDE_STORAGE_BYTES+1)}}),/chunk_limit/);
 assert.throws(()=>encodeProductionGuideChunk({guide:{values:Array(2_000_000).fill(null)}}),/json_limit/);
 const encoded:any=encodeProductionGuideChunk(original()),expanded={values:Array(100_000).fill(0)},hash=digest(expanded);encoded.dictionary=[{sha256:hash,nativeSettings:expanded}];for(const owner of getOwners(encoded))owner.nativeSettings.sha256=hash;
 assert.throws(()=>decodeProductionGuideChunk(encoded),/json_limit/);
});
test('v4 indexed read API restores original full section after ordinary reference-hash checks',async()=>{
 const f=await preparationIOFixture();try{
  await initializePreparation(f.plan,{finalRunDirectory:f.finalRunDirectory});const state=await f.readState(),job=state.jobs.find((r:any)=>r.job.jobId==='body-1'),key=job.job.sectionKeys[0];
  const id={taskId:state.taskId,runId:state.runId,scope:'body-1',contractHash:state.contractHash};const context=await f.put('guide/storage-context.json',{version:1,kind:'clonewp-production-guide-context',...id,device:'desktop',guide:{rendered:'not-verified'}});
  const section=original({...id,sectionKey:key});section.guide.key=key;const encoded=encodeProductionGuideChunk(section);const sectionRef=await f.put('guide/storage-section.json',encoded);
  const index={version:4,kind:'source-production-guide-index',...id,contexts:{desktop:context},sections:[{key,desktop:sectionRef}],readCommand:[],instructions:'Hash-bound original guide'};
  const packet=JSON.parse(await readFile(job.packet.path,'utf8'));packet.productionGuide=index;job.packet=await f.put(path.relative(f.directory,job.packet.path),packet);await writeFile(path.join(f.preparationDirectory,'state.json'),JSON.stringify(state));
  const result=await readPreparationProductionGuide(f.preparationDirectory,'body-1',key,'desktop');assert.deepEqual(result.guide,{rendered:'not-verified',sections:[section.guide]});assert.equal(result.remoteWrites,0);
  await writeFile(sectionRef.path,'{}');await assert.rejects(readPreparationProductionGuide(f.preparationDirectory,'body-1',key,'desktop'),/file_changed/);
 }finally{await f.cleanup();}
});

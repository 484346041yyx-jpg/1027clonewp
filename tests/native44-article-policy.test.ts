import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareNative44Reference } from '../src/native44/source.js';
import { prepareLocalTask } from '../src/native44/local-task.js';
import { assertNative44Resume, saveNative44Body, type Native44Journal } from '../src/native44/lifecycle.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import { assertNative44CurrentNativeProgram } from '../src/native44/current-native-patch.js';
import { NATIVE44_ARTICLE_LIST_POLICY, NATIVE44_TARGET_ENVIRONMENT, type Native44Program } from '../src/native44/types.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';

const root='D:/cloneWP',hash='a'.repeat(64),ref={path:'deliberately-missing-evidence.json',sha256:hash};
function program():Native44Program{return{version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',replicationProfile:'desktop-browser-v1',selectionRulesHash:NATIVE44_SELECTION_RULES_HASH,taskId:'article-policy',title:'Policy test',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:hash},targetEnvironment:NATIVE44_TARGET_ENVIRONMENT,sourceFacts:ref,componentPlan:ref,assetsManifest:ref,viewports:native44ProfileViewports('desktop-browser-v1'),blocks:[{kind:'composite',key:'section',children:[{kind:'native',key:'title',widgetType:'heading',widgetSettings:{title:'Unchanged source heading'}}]}]};}
function journal(p:Native44Program):Native44Journal{return{version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',taskId:p.taskId,runId:'policy-run',runDir:`${root}/.cache/policy-run`,targetUrl:'https://target.example/',programHash:hash,sourceFactsHash:hash,componentPlanHash:hash,assetsManifestHash:hash,componentCatalog:p.componentCatalog,knowledge:p.knowledge,targetEnvironment:p.targetEnvironment,replicationProfile:p.replicationProfile,selectionRulesHash:p.selectionRulesHash,status:'running',createdAt:'',updatedAt:'',mutations:[],deliveryComplete:false,visualVerification:'pending-comparison',metrics:{},...(p.articleListPolicy?{articleListPolicy:p.articleListPolicy}:{})};}

test('new reference preparation advertises the native target-posts policy without network access',async t=>{
  const previous=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('must not request network');};t.after(()=>{globalThis.fetch=previous;});
  const prepared=await prepareNative44Reference('https://source.example/',{root});
  assert.equal(prepared.articleListPolicy,NATIVE44_ARTICLE_LIST_POLICY);assert.equal(prepared.status,'awaiting-browser-observation');assert.equal(prepared.editorNaming,'native-translated-v1');assert.equal(prepared.reviewWorkflow,'whole-page-after-css-v1');assert.equal(requests,0);
});
test('a task marker cannot add, remove or rename article policy before local evidence and authentication',async t=>{
  const folder=await mkdtemp(path.join(root,'.cache','article-policy-'));t.after(async()=>{const relative=path.relative(path.join(root,'.cache'),folder);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rm(folder,{recursive:true,force:true});});
  const jobDir=path.join(folder,'references','article-policy');await mkdir(jobDir,{recursive:true});const filename=path.join(jobDir,'program.json'),marker=path.join(jobDir,'job.json');
  for(const [programPolicy,markerPolicy]of [[undefined,NATIVE44_ARTICLE_LIST_POLICY],[NATIVE44_ARTICLE_LIST_POLICY,undefined],[NATIVE44_ARTICLE_LIST_POLICY,'unknown-policy']]as const){const p=program();if(programPolicy)p.articleListPolicy=programPolicy;await writeFile(filename,JSON.stringify(p));await writeFile(marker,JSON.stringify({articleListPolicy:markerPolicy}));await assert.rejects(prepareLocalTask(filename,folder),/native44_articleListPolicy_policy_conflict/);}
  // Absence on both historical inputs passes the policy boundary without
  // inventing a default; deliberately missing knowledge fails later.
  await writeFile(filename,JSON.stringify(program()));await writeFile(marker,'{}');await assert.rejects(prepareLocalTask(filename,folder),error=>!String(error).includes('articleListPolicy_policy_conflict'));assert.equal(JSON.parse(await readFile(filename,'utf8')).articleListPolicy,undefined);
});
test('resume freezes explicit article policy and leaves old task bytes untouched',()=>{
  const old=program(),oldJournal=journal(old),before=JSON.stringify({old,oldJournal});assert.doesNotThrow(()=>assertNative44Resume(oldJournal,old,hash,oldJournal.targetUrl));assert.equal(JSON.stringify({old,oldJournal}),before);
  const current={...old,articleListPolicy:NATIVE44_ARTICLE_LIST_POLICY},currentJournal=journal(current);assert.doesNotThrow(()=>assertNative44Resume(currentJournal,current,hash,currentJournal.targetUrl));
  assert.throws(()=>assertNative44Resume(oldJournal,current,hash,oldJournal.targetUrl),/article list policy changed/);assert.throws(()=>assertNative44Resume(currentJournal,old,hash,currentJournal.targetUrl),/article list policy changed/);
});
test('ordinary native revision fragments cannot smuggle an article query into an unrelated region',()=>{
  const fragment=program();fragment.articleListPolicy=NATIVE44_ARTICLE_LIST_POLICY;fragment.blocks=[{kind:'composite',key:'news',children:[{kind:'native-posts',key:'posts',widgetType:'wd_blog',widgetSettings:{},query:{itemsPerPage:4,orderby:'date',order:'desc',evidence:['scope.json']}}]}];
  assert.throws(()=>assertNative44CurrentNativeProgram(fragment),/fragment_content_rejected/);
});
test('body save rejects a frozen article policy mismatch before remote reads or writes',async()=>{
  const p=program();p.articleListPolicy=NATIVE44_ARTICLE_LIST_POLICY;const j=journal(p);delete j.articleListPolicy;
  const schemas={container:{type:'container',class:'Container',controls:{css_classes:{type:'text'}}},heading:{type:'heading',class:'Heading',controls:{_css_classes:{type:'text'},title:{type:'textarea'}}}};
  const compiled=compileNative44(p,{schemas,assets:[],knowledge:{fingerprint:hash,controlsByWidget:{container:new Set(['css_classes']),heading:new Set(['_css_classes','title'])}}});
  let reads=0,writes=0;const baseline={pageId:77,runId:j.runId,title:p.title,status:'draft' as const,elements:[],settings:{},hash:documentHashV2([],{})};
  await assert.rejects(saveNative44Body({client:{snapshotDraft:async()=>{reads++;return baseline;},buildDraft:async()=>{writes++;return baseline;}},journal:j,compiled,baseline,schemas}),/compiled article list policy identity differ/);assert.equal(reads,0);assert.equal(writes,0);assert.equal(j.mutations.length,0);
});

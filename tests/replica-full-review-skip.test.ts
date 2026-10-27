import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFullReplicaManifest, fullReplicaHash } from '../src/replica-full/contract.js';
import { runFullReplica, reconcileFullReplica } from '../src/replica-full/coordinator.js';
import { fullReplicaDelivery } from '../src/replica-full/delivery.js';
import { WordPressReusedBodyDriver, reusedBodyDriverCode } from '../src/replica-full/reused-driver.js';
import { taskReviewSkipPolicySchema } from '../src/replica-full/review-skip-policy.js';
import type { FullReplicaDependencies, FullReplicaManifest, FullReplicaReusedHeader, FullReplicaRunState } from '../src/replica-full/types.js';
const sha = 'a'.repeat(64), ref = { path: 'source.json', sha256: sha };
const resources: FullReplicaReusedHeader = { headerId: 'header_123', name: 'Existing HUAQI Header', editUrl: 'https://target.example/wp-admin/admin.php?page=xts_header_builder#/builder/header_123', sharedHash: sha, headerHash: sha, menuHash: sha, styleHash: sha, menus: [{ key: 'main', id: 5, name: 'Existing Menu', editUrl: 'https://target.example/wp-admin/nav-menus.php?menu=5' }], blocks: [{ id: 6, name: 'Existing Header Styles', editUrl: 'https://target.example/wp-admin/post.php?post=6&action=edit' }], mobileMaxWidth: 768, hasSubmenus: true };
const viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
const responsive = { version: 2 as const, tablet: 'desktop' as const, mobileMaxWidth: 768, viewports, source: ref, decisions: { version: 1 as const, layouts: [], carousels: [], header: { implementation: 'native' as const, flow: 'reserve-space' as const, views: viewports.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'static' as const, offset: 0 })) } }, sections: [{ key: 'body', mode: 'shared' as const, reason: 'The same native section is used on desktop and phone.', evidence: [{ snapshotId: 'wide', nodeId: 'body' }, { snapshotId: 'phone', nodeId: 'body' }], settings: [], childOrders: [], css: '' }] };
function legacyManifest(): FullReplicaManifest {
  return validateFullReplicaManifest({ version: 4, kind: 'clonewp-full-replica', taskId: 'new-body-task', runId: 'new-body-run', title: 'New body', slug: 'new-body', sourceUrl: 'https://source.example/', targetOrigin: 'https://target.example', headerProvider: 'reused-woodmart-header', reusedHeader: resources, responsive, sourceEvidence: ref, sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] }, body: { program: ref, css: ref, sourceUnits: ref } });
}

const policy = taskReviewSkipPolicySchema.parse({version:1,kind:'clonewp-task-review-skip',taskId:'huaqi-about-20261023-body',runId:'huaqi-about-20261023-body',authorization:{source:'current-user-explicit-instruction',instruction:'执行第 1、2 步，随后发布；允许，仅这次任务跳过',reason:'暴露第二步实施问题'},scope:['visual','interaction','editor-completion']});
const perfumePolicy = taskReviewSkipPolicySchema.parse({version:1,kind:'clonewp-task-review-skip',taskId:'huaqi-perfume-20261024-body',runId:'huaqi-perfume-20261024-body',authorization:{source:'current-user-explicit-instruction',instruction:'第二步后直接发布，第三步不考虑，因为我要暴露问题',reason:'暴露第二步实施问题'},scope:['visual','interaction','editor-completion']});
const cosmeticPolicy = taskReviewSkipPolicySchema.parse({version:1,kind:'clonewp-task-review-skip',taskId:'huaqi-cosmetic-20261024-body',runId:'huaqi-cosmetic-20261024-body',authorization:{source:'current-user-explicit-instruction',instruction:'完成第一、二步后直接发布，跳过第三步检查',reason:'暴露第二步实施问题'},scope:['visual','interaction','editor-completion']});
function manifest(experiment = policy) {
 const old = legacyManifest(), origin = 'https://vapeversse.com';
 const sourceUrl = {'huaqi-about-20261023-body':'https://www.huaqipackage.com/about-huaqi','huaqi-perfume-20261024-body':'https://www.huaqipackage.com/custom-perfume-bottle','huaqi-cosmetic-20261024-body':'https://www.huaqipackage.com/custom-cosmetic--skincare-packing'}[experiment.taskId];
 return validateFullReplicaManifest({...old, taskId:experiment.taskId,runId:experiment.runId,sourceUrl,targetOrigin:origin,reviewSkipPolicy:experiment,reusedHeader:{...old.reusedHeader!,headerId:'header_39589520821341414',editUrl:origin+'/wp-admin/admin.php?page=xts_header_builder#/builder/header_39589520821341414',menus:[],blocks:[]}});
}
function fixture(experiment = policy) {
 const m=manifest(experiment), events:string[]=[], states:FullReplicaRunState[]=[];
 const page={pageId:77,runId:m.runId,status:'draft' as const,template:'elementor_header_footer' as const,editUrl:m.targetOrigin+'/wp-admin/post.php?post=77&action=elementor',previewUrl:m.targetOrigin+'/?page_id=77&preview=true',bodyHash:sha,headerId:null};
 const body={...page,cssHash:sha,documentHash:sha,sourceUnitIds:['body'],embeddedHeaderCount:0 as const};
 const bound={...body,headerId:m.reusedHeader!.headerId,headerHash:sha,menuHash:sha,styleHash:sha};
 const deps:FullReplicaDependencies={
 async prepareHeader(){assert.fail('shared header must remain readonly');},async provisionHeader(){assert.fail('shared header must remain readonly');},
 async prepareBody(){return {programHash:sha,cssInputHash:sha,sourceUnitsHash:sha,sourceEvidenceHash:sha,sourceUnitIds:['body'],componentSourceUnitIds:['body'],embeddedHeaderCount:0,payload:{}};},assertPreparedBody(){},
 async writeState(state){states.push(structuredClone(state));}, async createPage(){events.push('page');return page;},async saveBody(){events.push('body');return body;},async bindHeader(){assert.fail('owned header path forbidden');},async bindReusedHeader(){events.push('binding');return bound;},
 async reviewWholePage(){assert.fail('review must not run');},async verifyReview(){assert.fail('review must not run');},async publishPage(){assert.fail('review path forbidden');},
 async publishWithoutReview(_,op){assert.equal(states.at(-1)?.pending?.operationId,op.operationId);events.push('publish-without-review');return {...bound,status:'publish',publicUrl:m.targetOrigin+'/new-body/'};},
 };
 return {m,events,states,deps};
}
test('review skipping is frozen to each named authorized task, source, target and reused header',()=>{
 const m=manifest();assert.ok(m.reviewSkipPolicy);assert.equal(legacyManifest().reviewSkipPolicy,undefined);
 for(const patch of [{taskId:'other-task'},{runId:'other-run'},{sourceUrl:'https://other.example/'},{targetOrigin:'https://other.example'},{reusedHeader:{...m.reusedHeader!,headerId:'header_999'}}])assert.throws(()=>validateFullReplicaManifest({...m,...patch}),/review_skip_scope_conflict/);
 assert.throws(()=>validateFullReplicaManifest({...m,reviewSkipPolicy:{...policy,authorization:{...policy.authorization,source:'project-default'}}}));
 assert.throws(()=>validateFullReplicaManifest({...m,reviewSkipPolicy:{...policy,scope:['visual']}}));
});
test('perfume experiment preserves its exact authorization and rejects mixed or expanded scopes',()=>{
 const m=manifest(perfumePolicy);assert.deepEqual(m.reviewSkipPolicy,perfumePolicy);assert.deepEqual(manifest().reviewSkipPolicy,policy);
 for(const patch of [{taskId:'other-task'},{runId:'other-run'},{sourceUrl:'https://www.huaqipackage.com/about-huaqi'},{targetOrigin:'https://other.example'},{reusedHeader:{...m.reusedHeader!,headerId:'header_999'}},{reviewSkipPolicy:policy}])assert.throws(()=>validateFullReplicaManifest({...m,...patch}),/review_skip_scope_conflict/);
 assert.throws(()=>taskReviewSkipPolicySchema.parse({...perfumePolicy,runId:policy.runId}));
 assert.throws(()=>taskReviewSkipPolicySchema.parse({...perfumePolicy,authorization:policy.authorization}));
 assert.throws(()=>taskReviewSkipPolicySchema.parse({...perfumePolicy,taskId:'any-task',runId:'any-task'}));
 assert.throws(()=>taskReviewSkipPolicySchema.parse({...perfumePolicy,scope:['visual','interaction','editor-completion','ownership']}));
});
test('perfume experiment uses serial publication readback and reports all skipped capabilities',async()=>{
 const f=fixture(perfumePolicy),result=await runFullReplica(f.m,f.deps,{publish:true});assert.ok('kind' in result);if(!('kind' in result))return;
 assert.deepEqual(f.events,['page','body','binding','publish-without-review']);assert.equal(result.status,'published');assert.equal(result.review,null);assert.equal(result.pending,null);
 const delivery=fullReplicaDelivery(result,f.m);assert.equal(delivery.complete,true);assert.equal(delivery.reviewStatus,'skipped-by-current-user-for-this-task');assert.equal(delivery.editorCompletion.complete,false);assert.deepEqual(delivery.unverifiedCapabilities,['visual','interaction','editor-completion']);assert.deepEqual(delivery.reviewSkipPolicy,perfumePolicy);
});

test('cosmetic experiment preserves its own exact authorization and rejects old task identities',()=>{
 const m=manifest(cosmeticPolicy);assert.deepEqual(m.reviewSkipPolicy,cosmeticPolicy);
 assert.deepEqual(manifest().reviewSkipPolicy,policy);assert.deepEqual(manifest(perfumePolicy).reviewSkipPolicy,perfumePolicy);
 for(const patch of [{taskId:policy.taskId},{runId:perfumePolicy.runId},{sourceUrl:'https://www.huaqipackage.com/about-huaqi'},{sourceUrl:'https://www.huaqipackage.com/custom-perfume-bottle'},{targetOrigin:'https://other.example'},{reusedHeader:{...m.reusedHeader!,headerId:'header_999'}},{reviewSkipPolicy:policy},{reviewSkipPolicy:perfumePolicy}])assert.throws(()=>validateFullReplicaManifest({...m,...patch}),/review_skip_scope_conflict/);
 for(const patch of [{runId:policy.runId},{authorization:perfumePolicy.authorization},{taskId:'any-task',runId:'any-task'},{scope:['visual','interaction','editor-completion','ownership']}])assert.throws(()=>taskReviewSkipPolicySchema.parse({...cosmeticPolicy,...patch}));
});

test('cosmetic experiment publishes serially and discloses all skipped checks',async()=>{
 const f=fixture(cosmeticPolicy),result=await runFullReplica(f.m,f.deps,{publish:true});assert.ok('kind' in result);if(!('kind' in result))return;
 assert.deepEqual(f.events,['page','body','binding','publish-without-review']);assert.equal(result.status,'published');assert.equal(result.review,null);assert.equal(result.pending,null);
 const delivery=fullReplicaDelivery(result,f.m);assert.equal(delivery.complete,true);assert.deepEqual(delivery.reviewSkipPolicy,cosmeticPolicy);assert.deepEqual(delivery.unverifiedCapabilities,['visual','interaction','editor-completion']);assert.equal(delivery.editorCompletion.complete,false);
});
test('explicit experiment publishes serially with persisted intent and no review evidence or editor completion claim',async()=>{
 const f=fixture(), result=await runFullReplica(f.m,f.deps,{publish:true});assert.ok('kind' in result);if(!('kind' in result))return;
 assert.deepEqual(f.events,['page','body','binding','publish-without-review']);assert.equal(result.status,'published');assert.equal(result.review,null);assert.equal(result.pending,null);
 const delivery=fullReplicaDelivery(result,f.m);assert.equal(delivery.complete,true);assert.equal(delivery.reviewFingerprint,null);assert.equal(delivery.reviewStatus,'skipped-by-current-user-for-this-task');assert.equal(delivery.editorCompletion.complete,false);assert.match(delivery.markdown,/未验证视觉、交互及编辑器效果/);assert.doesNotMatch(delivery.markdown,/验证范围：桌面/);
 const resumed=await runFullReplica(f.m,f.deps,{state:result,publish:true});assert.deepEqual(resumed,result);assert.equal(f.events.length,4);
});
test('experiment does not publish on build alone, missing adapter, mixed review, or unknown publication',async()=>{
 const f=fixture(), built=await runFullReplica(f.m,f.deps);assert.ok('kind' in built);if(!('kind' in built))return;assert.equal(built.status,'awaiting-review');assert.equal(f.events.length,3);
 const {publishWithoutReview:_,...noAdapter}=f.deps;await assert.rejects(runFullReplica(f.m,noAdapter,{state:built,publish:true}),/review_skip_adapter_required/);
 await assert.rejects(runFullReplica(f.m,f.deps,{state:built,publish:true,reviewInput:{decision:'approved'}}),/review_skip_conflicting_review/);
 f.deps.publishWithoutReview=async()=>{f.events.push('unknown');throw Error('network_unconfirmed');};const unknown=await runFullReplica(f.m,f.deps,{state:built,publish:true});assert.ok('kind' in unknown);if(!('kind' in unknown))return;assert.equal(unknown.status,'write-unknown');assert.equal(unknown.pending?.phase,'publish');assert.equal(unknown.checkpoints.published,undefined);
 await assert.rejects(runFullReplica(f.m,f.deps,{state:unknown,publish:true}),/reconciliation_required/);assert.equal(f.events.filter(e=>e==='unknown').length,1);
});

test('reviewless driver requires the exact frozen authorization hash before server mutation',async()=>{
 const m=manifest();let writes=0;
 const driver=new WordPressReusedBodyDriver({origin:m.targetOrigin,async readPHP(){assert.fail('no read needed');},async executePHP(){writes++;assert.fail('invalid payload must not write');}},m);
 const before={hash:sha,resources:m.reusedHeader!,page:null,receipts:{}};
 const intent={operationId:'publish-once',runId:m.runId,resource:'full-replica-reuse/'+m.runId,expectedSnapshotSha256:sha,persistedIntentSha256:sha};
 await assert.rejects(driver.mutate('publish',before,intent.operationId,{pageId:77,reviewHash:sha},intent),/reuse_payload/);
 await assert.rejects(driver.mutate('publish',before,intent.operationId,{pageId:77,publicationAuthorizationHash:sha},intent),/review_skip_authorization_changed/);
 assert.equal(writes,0);
 const code=await reusedBodyDriverCode({targetOrigin:m.targetOrigin,headerId:m.reusedHeader!.headerId,mobileMaxWidth:768},{action:'inspect'});
 for(const guard of ['reuse_snapshot_changed','reuse_shared_changed','reuse_owned_draft','reuse_edit_lock','reuse_publish_permission'])assert.ok(code.includes(guard),guard);
 assert.ok(code.includes("$run==='huaqi-about-20261023-body'"));assert.ok(code.includes("$payload['publicationAuthorizationHash']??null"));
});
test('perfume driver rejects a previous experiment authorization hash and retains server protection',async()=>{
 const m=manifest(perfumePolicy);let writes=0;
 const driver=new WordPressReusedBodyDriver({origin:m.targetOrigin,async readPHP(){assert.fail('no read needed');},async executePHP(){writes++;assert.fail('invalid payload must not write');}},m);
 const before={hash:sha,resources:m.reusedHeader!,page:null,receipts:{}},intent={operationId:'perfume-publish-once',runId:m.runId,resource:'full-replica-reuse/'+m.runId,expectedSnapshotSha256:sha,persistedIntentSha256:sha};
 await assert.rejects(driver.mutate('publish',before,intent.operationId,{pageId:77,publicationAuthorizationHash:fullReplicaHash(policy)},intent),/review_skip_authorization_changed/);assert.equal(writes,0);
 const code=await reusedBodyDriverCode({targetOrigin:m.targetOrigin,headerId:m.reusedHeader!.headerId,mobileMaxWidth:768},{action:'inspect'});
 assert.ok(code.includes("$run==='huaqi-perfume-20261024-body'"));
 for(const guard of ['reuse_snapshot_changed','reuse_shared_changed','reuse_owned_draft','reuse_edit_lock','reuse_publish_permission'])assert.ok(code.includes(guard),guard);
});

test('cosmetic driver rejects other experiment authorization hashes and retains server protection',async()=>{
 const m=manifest(cosmeticPolicy);let writes=0;
 const driver=new WordPressReusedBodyDriver({origin:m.targetOrigin,async readPHP(){assert.fail('no read needed');},async executePHP(){writes++;assert.fail('invalid payload must not write');}},m);
 const before={hash:sha,resources:m.reusedHeader!,page:null,receipts:{}},intent={operationId:'cosmetic-publish-once',runId:m.runId,resource:'full-replica-reuse/'+m.runId,expectedSnapshotSha256:sha,persistedIntentSha256:sha};
 for(const other of [policy,perfumePolicy])await assert.rejects(driver.mutate('publish',before,intent.operationId,{pageId:77,publicationAuthorizationHash:fullReplicaHash(other)},intent),/review_skip_authorization_changed/);assert.equal(writes,0);
 const code=await reusedBodyDriverCode({targetOrigin:m.targetOrigin,headerId:m.reusedHeader!.headerId,mobileMaxWidth:768},{action:'inspect'});
 assert.ok(code.includes("$run==='huaqi-cosmetic-20261024-body'"));
 for(const guard of ['reuse_snapshot_changed','reuse_shared_changed','reuse_owned_draft','reuse_edit_lock','reuse_publish_permission'])assert.ok(code.includes(guard),guard);
});

test('unknown experiment publication can be reconciled read only without inventing a review',async()=>{
 const f=fixture();let actual:any;
 f.deps.publishWithoutReview=async bound=>{actual={...bound,status:'publish',publicUrl:f.m.targetOrigin+'/new-body/'};throw Error('network_unconfirmed');};
 const lost=await runFullReplica(f.m,f.deps,{publish:true});assert.ok('kind' in lost);if(!('kind' in lost))return;
 f.deps.reconcileOperation=async()=>({status:'after',checkpoint:actual});
 const confirmed=await reconcileFullReplica(f.m,f.deps,lost);assert.equal(confirmed.status,'published');assert.equal(confirmed.review,null);assert.equal(confirmed.pending,null);assert.equal(fullReplicaDelivery(confirmed,f.m).complete,true);
});

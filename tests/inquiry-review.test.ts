import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { verifyInquiryReview, inquirySubmissionReadPHP, inquirySubmissionReviewRequired } from '../src/replica-full/inquiry-review.js';
import { native44Id } from '../src/native44/adapters.js';
import { assertInquirySourceCoverage } from '../src/replica-preparation/inquiry.js';
import { defaultInquiryPolicy } from '../src/native44/inquiry-form.js';
import { parseFullReplicaArguments } from '../src/replica-full/cli.js';
import { WordPressFullReplicaDriver } from '../src/replica-full/driver.js';

const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
test('new defaults leave real submission and mailbox testing to the user; supplied optional proof remains checked',()=>{
 const program:any={inquiryPolicy:defaultInquiryPolicy()};assert.equal(inquirySubmissionReviewRequired(program,undefined),false);assert.equal(inquirySubmissionReviewRequired(program,{}),true);assert.equal(inquirySubmissionReviewRequired({} as any,undefined),true);
});
async function fixture(){
 const now=new Date(Date.now()-10000).toISOString(),fingerprint='a'.repeat(64),taskId='inquiry-fixture',runId='inquiry-fixture-run',pageId=123,elementId=native44Id(taskId,'quote'),testMarker='clonewp-inquiry-test-'+'b'.repeat(32);
 const fields=[{custom_id:'email',field_type:'email',required:'true'},{custom_id:'message',field_type:'textarea',required:'true'}],fieldHashes={email:hash('qa@example.test'),message:hash(testMarker)};
 const files=new Map<string,Buffer>();const put=(name:string,value:unknown)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));files.set(name,bytes);return{path:name,sha256:hash(bytes)};};
 const screenshot=put('shot.png',await sharp({create:{width:390,height:844,channels:3,background:'#fff'}}).png().toBuffer());
 const identity={pageId,elementId,fingerprint,testMarker,observedAt:now};
 const request=put('request.json',{...identity,kind:'clonewp-inquiry-request',url:'https://target.example/wp-admin/admin-ajax.php',method:'POST',action:'elementor_pro_forms_send_form',status:200,responseSuccess:true,fieldHashes});
 const success=put('success.json',{...identity,kind:'clonewp-inquiry-success',successVisible:true,message:'Thank you.',html:`<div data-elementor-id="123"><div data-widget_type="form.default" data-id="${elementId}"><form><div class="elementor-message elementor-message-success">Thank you.</div></form></div></div>`,screenshot});
 const validation=['required','email'].map(name=>({case:name,evidence:put(name+'.json',{...identity,kind:'clonewp-inquiry-validation',case:name,rejected:true,submissionRequests:0,invalidFieldIds:['email'],screenshot})}));
 const form={componentKey:'quote',elementId,submissionId:17,testMarker,observedAt:now,fieldHashes,request,success,validation};
 const input:any={program:{taskId,blocks:[{kind:'native',key:'quote',widgetType:'form',pendingForm:{version:4},widgetSettings:{form_fields:fields,success_message:'Thank you.'}}]},manifest:{targetOrigin:'https://target.example',runId},bound:{pageId},review:{fingerprint,observedAt:new Date().toISOString()},evidence:{version:1,kind:'clonewp-inquiry-review',pageId,fingerprint,forms:[form]},base:'.',read:async(ref:any)=>{const bytes=files.get(ref.path);assert.ok(bytes);assert.equal(hash(bytes),ref.sha256);return{filename:ref.path,bytes};},backend:async(query:any)=>({...query,observedAt:new Date().toISOString(),createdAt:now,fieldHashes,markerMatches:1,emailAction:'success'})};
 return{input,files,form,put};
}
test('inquiry approval requires browser feedback, input validation and a fresh scoped backend read',async()=>{
 const f=await fixture();let called=0;const read=f.input.backend;f.input.backend=async(query:any)=>{called++;assert.equal(query.pageId,123);assert.equal(query.submissionId,17);return read(query);};await verifyInquiryReview(f.input);assert.equal(called,1);
});
for(const scenario of ['no-backend','no-evidence','false-success','foreign-endpoint','mail-failed','duplicate-submission','wrong-field','stale-record','stale-backend','missing-validation','invalid-requests','no-native-success','wrong-fingerprint'])test('inquiry gate rejects '+scenario,async()=>{
 const f=await fixture(),backend=f.input.backend;
 if(scenario==='no-backend')delete f.input.backend;
 if(scenario==='no-evidence')delete f.input.evidence;
 if(scenario==='false-success'||scenario==='no-native-success'){const data=JSON.parse(f.files.get('success.json')!.toString());if(scenario==='false-success')data.successVisible=false;else data.html='<p>A plain success claim</p>';f.form.success=f.put('success.json',data);}
 if(scenario==='foreign-endpoint'){const data=JSON.parse(f.files.get('request.json')!.toString());data.url='https://source.example/send';f.form.request=f.put('request.json',data);}
 if(scenario==='wrong-fingerprint')f.input.evidence.fingerprint='c'.repeat(64);
 if(scenario==='missing-validation')f.form.validation=[];
 if(scenario==='invalid-requests'){const data=JSON.parse(f.files.get('email.json')!.toString());data.submissionRequests=1;f.form.validation[1].evidence=f.put('email.json',data);}
 if(['mail-failed','duplicate-submission','wrong-field','stale-record','stale-backend'].includes(scenario))f.input.backend=async(query:any)=>{const data=await backend(query);if(scenario==='mail-failed')data.emailAction='failed';if(scenario==='duplicate-submission')data.markerMatches=2;if(scenario==='wrong-field')data.fieldHashes={email:hash('other'),message:hash('x')};if(scenario==='stale-record')data.createdAt='2020-01-01T00:00:00.000Z';if(scenario==='stale-backend')data.observedAt='2020-01-01T00:00:00.000Z';return data;};
 await assert.rejects(()=>verifyInquiryReview(f.input));
});
test('native observer is a bounded read of an owned submission and never retrieves mail or credentials',()=>{
 const code=inquirySubmissionReadPHP({pageId:123,runId:'owned-run',elementId:'abcdef1',submissionId:17,testMarker:'clonewp-inquiry-test-'+'b'.repeat(32)});
 assert.match(code,/current_user_can\('edit_post'/);assert.match(code,/_clonewp_run_id/);assert.match(code,/COUNT\(DISTINCT s.id\)/);assert.match(code,/action_name.*email/s);assert.match(code,/hash\('sha256'/);
 assert.doesNotMatch(code,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b|wp_mail\(|get_option\(|user_pass|Authorization/);
 assert.throws(()=>inquirySubmissionReadPHP({pageId:123,runId:'owned-run',elementId:'abcdef1',submissionId:17,testMarker:"' OR 1=1"}));
});
test('existing CLI accepts only a bounded test-marker lookup; the native reader makes no mutation',async()=>{
 const args=['inspect-inquiry','--run-dir','run','--element-id','abcdef1','--test-marker','clonewp-inquiry-test-'+'b'.repeat(32)];assert.equal(parseFullReplicaArguments(args).command,'inspect-inquiry');assert.throws(()=>parseFullReplicaArguments([...args,'--page-id','999']));assert.throws(()=>parseFullReplicaArguments(args.map(v=>v==='abcdef1'?'foreign':v)));
 const query={pageId:123,runId:'owned-run',elementId:'abcdef1',testMarker:'clonewp-inquiry-test-'+'b'.repeat(32)};let reads=0;
 const driver=new WordPressFullReplicaDriver({origin:'https://target.example',readPHP:async(operation:any)=>{reads++;assert.equal(operation.trustedLocalCode,true);assert.match(operation.code,/SELECT DISTINCT s.id/);return{ok:true,value:{...query,submissionId:17,observedAt:new Date().toISOString(),createdAt:new Date().toISOString(),fieldHashes:{message:hash(query.testMarker)},markerMatches:1,emailAction:'success'}};},executePHP:async()=>{throw Error('unexpected mutation');}} as any);
 const result=await driver.readInquirySubmission(query);assert.equal(result.submissionId,17);assert.equal(reads,1);
});
test('new defaults cannot be bypassed by replacing source form controls with static content',()=>{
 const source:any={snapshots:[{id:'desktop-wide',nodes:{form:{tag:'form',parentId:null},email:{tag:'input',parentId:'form',attributes:{type:'email'}}}}],facts:{field:{id:'field',kind:'interaction',nodeId:'email',snapshotId:'desktop-wide'}}};
 const program:any={inquiryPolicy:defaultInquiryPolicy(),blocks:[{kind:'composite',key:'quote',sourceFactIds:['field'],children:[]}]};
 assert.throws(()=>assertInquirySourceCoverage(source,program),/source_control_unmapped/);
 assert.doesNotThrow(()=>assertInquirySourceCoverage(source,{...program,inquiryPolicy:undefined}));
 assert.doesNotThrow(()=>assertInquirySourceCoverage(source,program,[{sourceFactIds:['field']}]));
});

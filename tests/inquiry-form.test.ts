import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { configureInquirySettings, configureInquiryBlocks, defaultInquiryPolicy, assertInquiryProgram, inquiryConfigurationSchema, resolveInquiryConfiguration, type InquiryConfiguration } from '../src/native44/inquiry-form.js';
import { readProjectInquiryConfiguration } from '../src/replica-preparation/inquiry.js';
import { assertNative44RegisteredSettings, assertNative44Settings } from '../src/native44/settings.js';

const config:InquiryConfiguration={version:1,kind:'clonewp-inquiry-configuration',targetOrigin:'https://target.example',recipients:['sales@target.example'],fromEmail:'web@target.example',fromName:'Website',subject:'New inquiry',successMessage:'Thank you for your inquiry.',errorMessage:'Please try again.'};
const settings={form_fields:[{custom_id:'email',field_type:'email',field_label:'Email',placeholder:'Email',required:'true',width:'100'}],button_text:'Send',submit_actions:[],_attributes:'inert|true\naria-disabled|true\ndata-test|quote'};
const ref={path:'config-snapshot.json',sha256:'a'.repeat(64)};
const node:any={kind:'native',key:'quote',widgetType:'form',widgetSettings:settings,sourceFactIds:['a','b','c','d'],pendingForm:{version:2,kind:'native44-pending-form-v2',sourceControls:[{snapshotId:'a',fieldFactIds:['a'],submitFactId:'b'},{snapshotId:'b',fieldFactIds:['c'],submitFactId:'d'}],appearance:ref,registered:{capabilities:ref,schemaHash:ref.sha256},knowledge:{fingerprint:ref.sha256,formComponentHash:ref.sha256,sharedControlsHash:ref.sha256}}};

test('inquiry defaults configure native database then email without inheriting source addresses or inert',()=>{
  const result=configureInquirySettings(settings,config,'email');
  assert.deepEqual(result.submit_actions,['save-to-database','email']);assert.equal(result._attributes,'data-test|quote');
  assert.equal(result.email_to,'sales@target.example');assert.equal(result.email_content,'[all-fields]');assert.equal(result.email_reply_to,'email');assert.equal(result.email_content_type,'plain');
  assert.deepEqual(result.form_fields,settings.form_fields);assert.deepEqual(settings.submit_actions,[]);
  assert.throws(()=>configureInquirySettings({...settings,email_to_bcc:'source@source.example'},config),/unexpected_business_action/);
  assert.throws(()=>configureInquirySettings(settings,config,'unrelated'),/reply_to_email_field/);
  assert.throws(()=>inquiryConfigurationSchema.parse({...config,recipients:['a@example.com\r\nBcc: b@example.com']}));
  assert.throws(()=>inquiryConfigurationSchema.parse({...config,smtpPassword:'do-not-store-secrets'}));
});
test('new-policy merge upgrades the existing source-bound form; legacy trees remain frozen',()=>{
  const policy={...defaultInquiryPolicy(),configuration:ref};
  const blocks=configureInquiryBlocks([node],policy,config,'task-inquiry');
  assert.equal((blocks[0] as any).pendingForm.version,4);assert.equal(node.pendingForm.version,2);
  assertInquiryProgram({taskId:'task-inquiry',blocks,inquiryPolicy:policy} as any);
  assert.deepEqual(configureInquiryBlocks([node],undefined,undefined,'legacy'),[node]);
  assert.throws(()=>configureInquiryBlocks([node],defaultInquiryPolicy(),undefined,'task'),/configuration_required/);
  assert.throws(()=>assertInquiryProgram({taskId:'task',blocks:[node],inquiryPolicy:policy} as any),/functional_form_required/);
  const changed=structuredClone(blocks);(changed[0] as any).pendingForm.configuration.sha256='b'.repeat(64);
  assert.throws(()=>assertInquiryProgram({taskId:'task-inquiry',blocks:changed,inquiryPolicy:policy} as any),/configuration_binding/);
});
test('only explicit static or source-classified non-inquiry exceptions can preserve pending forms',()=>{
  const policy={...defaultInquiryPolicy(),exceptions:[{componentKey:'quote',mode:'static-user-request' as const,authorization:'user-explicit' as const,sourceFactIds:['a'],reason:'User requested a static visual preview.'}]};
  assertInquiryProgram({blocks:[node],inquiryPolicy:policy} as any);
  assert.throws(()=>assertInquiryProgram({blocks:[node],inquiryPolicy:{...policy,exceptions:[{...policy.exceptions[0],authorization:'source-classification'}]}} as any),/static_requires_user_request/);
  assert.throws(()=>assertInquiryProgram({blocks:[node],inquiryPolicy:{...policy,exceptions:[{...policy.exceptions[0],sourceFactIds:['foreign']}]}} as any),/exception_source_owner/);
});
test('project configuration is optional for pages without forms, origin-scoped, and strict',async()=>{
  const root=await mkdtemp(path.resolve('D:/cloneWP/tests/.tmp-inquiry-config-'));
  try{assert.equal(await readProjectInquiryConfiguration(root,config.targetOrigin),undefined);await mkdir(path.join(root,'config'));await writeFile(path.join(root,'config/inquiry-forms.local.json'),JSON.stringify(config));assert.deepEqual(await readProjectInquiryConfiguration(root,config.targetOrigin),config);assert.equal(await readProjectInquiryConfiguration(root,'https://foreign.example'),undefined);const {fromEmail:_from,fromName:_name,...intake}=config;await writeFile(path.join(root,'config/inquiry-forms.local.json'),JSON.stringify(intake));assert.deepEqual(await readProjectInquiryConfiguration(root,config.targetOrigin),intake);await writeFile(path.join(root,'config/inquiry-forms.local.json'),JSON.stringify({...config,credentials:'no'}));await assert.rejects(()=>readProjectInquiryConfiguration(root,config.targetOrigin));}finally{assert.equal(path.dirname(root),path.resolve('D:/cloneWP/tests'));await rm(root,{recursive:true});}
});
test('different source sites and field sets share recipient policy without a fixed brand or sender',()=>{
  const minimal:InquiryConfiguration={version:1,kind:'clonewp-inquiry-configuration',targetOrigin:'https://one.example',recipients:['owner@example.com']};
  const first=resolveInquiryConfiguration(minimal,'https://www.brand-one.example/contact');assert.equal(first.fromEmail,'noreply@one.example');assert.equal(first.fromName,'brand-one.example inquiries');
  const second=resolveInquiryConfiguration({...minimal,targetOrigin:'https://two.example'},'https://brand-two.example/quote');assert.equal(second.fromEmail,'noreply@two.example');assert.equal(second.fromName,'brand-two.example inquiries');
  const variable={...settings,form_fields:[{custom_id:'message_custom',field_type:'textarea',field_label:'咨询内容',placeholder:'留言',required:'true',width:'100'},{custom_id:'organization',field_type:'text',field_label:'Organization',placeholder:'Company',required:'',width:'100'}]};const result=configureInquirySettings(variable,minimal,'','https://different-source.example');assert.deepEqual(result.form_fields,variable.form_fields);assert.equal(result.email_to,'owner@example.com');assert.equal(result.email_from,'noreply@one.example');assert.equal(result.custom_messages,undefined);assert.equal(result.success_message,undefined);
});
test('site-specific recipient profiles override the project-wide default without borrowing another site sender',async()=>{
 const root=await mkdtemp(path.resolve('D:/cloneWP/tests/.tmp-inquiry-sites-'));try{await mkdir(path.join(root,'config'));await writeFile(path.join(root,'config/inquiry-forms.local.json'),JSON.stringify({version:2,kind:'clonewp-inquiry-sites',defaultRecipients:['default@example.com'],sites:[config]}));assert.deepEqual(await readProjectInquiryConfiguration(root,config.targetOrigin),config);const other=await readProjectInquiryConfiguration(root,'https://another.example');assert.deepEqual(other?.recipients,['default@example.com']);assert.equal(other?.fromEmail,undefined);assert.equal(other?.targetOrigin,'https://another.example');}finally{assert.equal(path.dirname(root),path.resolve('D:/cloneWP/tests'));await rm(root,{recursive:true});}
});
test('Reply-To admits only an email field of this form, preserving researched/live select type checks',()=>{
  const component:any={componentType:'form',controls:[{id:'email_reply_to',type:'select',defaultValue:'',valueDomain:{type:'select',options:[{value:''}]}},{id:'form_fields',type:'form-fields-repeater',repeater:{identityField:'_id',fields:[{id:'custom_id',type:'text'},{id:'field_type',type:'select',valueDomain:{options:[{value:'email'},{value:'text'}]}}]}}]};
  const registered:any={email_reply_to:{type:'select',default:'',options:{'':''}},form_fields:{type:'form-fields-repeater',fields:{custom_id:{type:'text'},field_type:{type:'select',options:{email:'Email',text:'Text'}}}}};
  const values={email_reply_to:'email',form_fields:[{_id:'abcdef1',custom_id:'email',field_type:'email'}]};
  assertNative44Settings(component,values,registered);assertNative44RegisteredSettings(component,values,registered);
  assert.throws(()=>assertNative44Settings(component,{...values,email_reply_to:'foreign'},registered));
  assert.throws(()=>assertNative44RegisteredSettings(component,{...values,form_fields:[{_id:'abcdef1',custom_id:'email',field_type:'text'}]},registered));
});

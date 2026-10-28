import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formWidthAt,prepareFormWidthLayout } from '../src/native44/form-width-layout.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { loadNative44Knowledge,native44KnowledgeIdentity } from '../src/native44/knowledge.js';
import { native44RegisteredSchemaHash } from '../src/native44/selection.js';
import { prepareNative44PendingFormCapabilities,assertNative44PendingFormCapability,NATIVE44_PENDING_FORM_ATTRIBUTES } from '../src/native44/pending-form.js';
import type { Native44Program } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import { configureInquiryBlocks,defaultInquiryPolicy } from '../src/native44/inquiry-form.js';
const componentKey='contact-inquiry-form',selector=`:page .${native44ModuleClass(componentKey)} .elementor-field-group-code`;
const wide=`${selector}{width:93.156px;max-width:93.156px;flex:0 0 93.156px;box-sizing:border-box;padding:0;border-width:0;transform:none}`;
const narrow=`@media(min-width:768px) and (max-width:1599px){${selector}{width:91.797px;max-width:91.797px;flex-basis:91.797px}}`;
const css=wide+narrow;
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'native44-width-'));
 const write=async(name:string,text:string)=>{const file=path.join(root,name);await writeFile(file,text);return {path:file,sha256:sha(text)};};
 const cssRef=await write('section.css',css);
 const proof={version:1,kind:'native44-form-width-layout',componentKey,css:cssRef,fields:[{customId:'code',sourceFieldFactIds:['wide-code','narrow-code']}]};
 const reference=await write('proof.json',JSON.stringify(proof));
 const input={root,reference,componentKey,css,fields:[{custom_id:'email'},{custom_id:'code'}],sourceControls:[{snapshotId:'desktop',fieldFactIds:['wide-email','wide-code']},{snapshotId:'desktop-narrow',fieldFactIds:['narrow-email','narrow-code']}]};
 return {root,input,proof,write,close:()=>rm(root,{recursive:true,force:true})};
}
test('source-bound exact px layout permits a registered fallback without rewriting native widths',async()=>{
 const f=await fixture();try{const proof=await prepareFormWidthLayout(f.input);assert.equal(proof.verify('code','wide-code',1920,93.156),true);assert.equal(proof.verify('code','narrow-code',1440,91.797),true);assert.equal(proof.verify('email','wide-email',1920,1380),false);proof.complete();assert.equal(proof.cssHash,sha(css));}finally{await f.close();}
});
test('entire current CSS cascade is checked rather than mere bound-string inclusion',async()=>{
 const f=await fixture();try{for(const suffix of [`${selector}{width:100px}`,`${selector}{width:100px!important}`,`${selector}:hover{width:100px}`,`${selector},.global{width:100px}`,`@supports(display:grid){${selector}{width:100px}}`,`:page .${native44ModuleClass(componentKey)} div{width:200px;max-width:200px;flex-basis:200px}`,`:page .${native44ModuleClass(componentKey)} *{width:200px}`,`${selector}{box-sizing:content-box;padding:0 20px}`,`${selector}{padding-left:20px}`,`${selector}{border:20px solid}`,`${selector}{scale:2}`,`:page .${native44ModuleClass(componentKey)} .elementor-field-group-other~div{width:200px}`]){const proof=await prepareFormWidthLayout({...f.input,css:css+suffix});assert.throws(()=>proof.verify('code','wide-code',1920,93.156),/native44_form_width_layout_/);}}finally{await f.close();}
});
test('proof hashes, component and both source field owners are mandatory',async()=>{
 const f=await fixture();try{
  await assert.rejects(prepareFormWidthLayout({...f.input,css:undefined}),/actual_css_required/);
  await assert.rejects(prepareFormWidthLayout({...f.input,componentKey:'other'}),/component/);
  await assert.rejects(prepareFormWidthLayout({...f.input,reference:{...f.input.reference,sha256:'0'.repeat(64)}}),/hash/);
  for(const change of [{fields:[{customId:'code',sourceFieldFactIds:['wide-code','wide-code']}]},{fields:[{customId:'code',sourceFieldFactIds:['wide-code','other']}]},{fields:[...f.proof.fields,...f.proof.fields]}]){const reference=await f.write('changed.json',JSON.stringify({...f.proof,...change}));await assert.rejects(prepareFormWidthLayout({...f.input,reference}),/source_ownership|duplicate_field/);}
 }finally{await f.close();}
});
test('source geometry cannot be waived and completion requires both desktop footprints',async()=>{
 const f=await fixture();try{const proof=await prepareFormWidthLayout(f.input);assert.throws(()=>proof.verify('code','wide-code',1920,120),/source_footprint/);assert.throws(()=>proof.verify('code','wrong',1920,93.156),/source_field/);proof.verify('code','wide-code',1920,93.156);assert.throws(()=>proof.complete(),/incomplete_source/);}finally{await f.close();}
});
test('narrow supported grammar rejects unknown units, var, imports and incomplete flex layout',()=>{
 assert.equal(formWidthAt(css,componentKey,'code',1920),93.156);assert.equal(formWidthAt(css,componentKey,'code',1440),91.797);
 for(const text of [`${selector}{width:7%;max-width:7%;flex:0 0 7%}`,`${selector}{width:var(--width);max-width:93.156px;flex:0 0 93.156px}`,`@import url(x);${wide}`,`${selector}{width:93.156px}`,`${selector}{width:93.156px;max-width:92px;flex:0 0 93.156px}`,`.x{${wide}}`])assert.throws(()=>formWidthAt(text,componentKey,'code',1920),/native44_form_width_layout_/);
});
test('only actual ordered ancestor modules qualify section-scoped width selectors, preserving specificity',()=>{
 const ancestors=['contact-section','contact-inner'],classes=ancestors.map(k=>'.'+native44ModuleClass(k));
 const scoped=css.replaceAll(':page ',`:page ${classes.join(' ')} `);
 assert.equal(formWidthAt(scoped,componentKey,'code',1920,ancestors),93.156);
 assert.equal(formWidthAt(scoped,componentKey,'code',1440,ancestors),91.797);
 for(const prefix of [[...classes].reverse().join(' '),'.'+native44ModuleClass('unowned'),classes[0]+' '+classes[0],classes[0]+'>'+classes[1]])assert.throws(()=>formWidthAt(css.replaceAll(':page ',`:page ${prefix} `),componentKey,'code',1920,ancestors),/ancestor_scope/);
 assert.throws(()=>formWidthAt(scoped,componentKey,'code',1920),/ancestor_scope/);
 const high=scoped.replaceAll('93.156px','100px');
 assert.equal(formWidthAt(high+wide,componentKey,'code',1920,ancestors),100,'later lower-specificity directform rule cannot mask an ancestor-qualified rule');
});

test('actual pending factory keeps legacy width rejection and registered-width gate while permitting the bound fallback',async()=>{
 const root=path.resolve('D:/cloneWP'),dir=await mkdtemp(path.join(root,'tests','.tmp-width-integration-'));
 try{
  const put=async(name:string,value:unknown)=>{const text=typeof value==='string'?value:JSON.stringify(value),file=path.join(dir,name);await writeFile(file,text);return {path:file,sha256:sha(text)};};
  const knowledge=await loadNative44Knowledge(['form']),identity=await native44KnowledgeIdentity(root);
  const schema={type:'form',class:'ElementorPro\\Modules\\Forms\\Widgets\\Form',controls:{form_fields:{type:'form-fields-repeater',fields:{field_type:{type:'select',options:{text:'Text',email:'Email'}},field_label:{type:'text'},placeholder:{type:'text'},required:{type:'switcher',return_value:'true'},width:{type:'select',options:{'20':'20%','80':'80%','100':'100%'}},custom_id:{type:'text'}}},button_text:{type:'text'},submit_actions:{type:'select2'},_attributes:{type:'textarea'}}} as unknown as LegacySchema;
  const registration=await put('registration.json',{legacySchemas:{form:schema},versions:{elementor:'fixture',elementorPro:'fixture'},sourceProof:{schemaErrors:{}}});
  const facts:Record<string,any>={},snapshots:any[]=[],rows:any[]=[],sourceControls:any[]=[];
  for(const [id,width,height,formWidth,fieldWidth]of [['wide',1920,1080,1380,93.156],['narrow',1440,1000,1140,91.797]] as const){
   const owner=id+'-form',field=id+'-field',submit=id+'-submit',viewport={width,height},nodes:any={
    [owner]:{id:owner,tag:'form',selector:'#'+owner,parentId:null,visible:true,attributes:{},layoutId:'form'},
    [field]:{id:field,tag:'input',selector:'#'+field,parentId:owner,visible:true,attributes:{type:'text',placeholder:'Code'},layoutId:'field',styleId:'field'},
    [submit]:{id:submit,tag:'input',selector:'#'+submit,parentId:owner,visible:true,attributes:{type:'submit',value:'Submit'},layoutId:'submit',styleId:'submit'},
   };
   const form=JSON.stringify({nodeId:owner,submitControlNodeId:submit}),interaction=(nodeId:string,type:string)=>({id:'i-'+nodeId,nodeId,regionId:'form',kind:'control',status:'unobserved',selector:'#'+nodeId,details:{type,form}});
   const interactions={field:interaction(field,'text'),submit:interaction(submit,'submit')};
   const packet={version:2,kind:'observation-packet',snapshot:{id,viewport},nodes,layouts:{form:{rect:{x:0,y:0,width:formWidth,height:200}},field:{rect:{x:0,y:0,width:fieldWidth,height:36}},submit:{rect:{x:0,y:100,width:120,height:40}}},styles:{field:{display:'block',visibility:'visible'},submit:{display:'block',visibility:'visible'}},interactions};
   const evidence=await put(id+'.json',packet);
   for(const [name,value]of Object.entries(interactions)){const fid=id+'-'+name;facts[fid]={id:fid,kind:'interaction',snapshotId:id,regionId:'form',nodeId:value.nodeId,evidence,value};}
   snapshots.push({id,viewport,nodes});sourceControls.push({snapshotId:id,fieldFactIds:[id+'-field'],submitFactId:id+'-submit'});rows.push({packet:evidence,nodes:[nodes[field],nodes[submit]]});
  }
  const sourceUrl='https://source.example/contact',sourceFacts=await put('source.json',{version:2,kind:'source-facts',sourceUrl,snapshots,facts});
  const appearance=await put('appearance.json',{version:1,kind:'native44-visible-source-form-appearance-extraction',rows,visualPassed:false});
  const node:any={kind:'native',key:componentKey,widgetType:'form',sourceFactIds:Object.keys(facts),widgetSettings:{form_fields:[{field_type:'text',field_label:'',placeholder:'Code',required:'',width:'20',custom_id:'code'}],button_text:'Submit',submit_actions:[],_attributes:NATIVE44_PENDING_FORM_ATTRIBUTES},pendingForm:{version:2,kind:'native44-pending-form-v2',sourceControls,appearance,registered:{capabilities:registration,schemaHash:native44RegisteredSchemaHash(schema)},knowledge:{fingerprint:knowledge.index.fingerprint,formComponentHash:knowledge.index.components.form.sha256,sharedControlsHash:knowledge.index.sharedControls.sha256}}};
  const program={...identity,taskId:'width-test',sourceUrl,sourceFacts,replicationProfile:'desktop-browser-v1',requirementProfile:'source-requirements-v1',goalProfile:'component-reference-v1',blocks:[node]} as unknown as Native44Program;
  await assert.rejects(prepareNative44PendingFormCapabilities({root,program}),/v2_source_field_width/);
  const cssRef=await put('layout.css',css),proof=await put('layout.json',{version:1,kind:'native44-form-width-layout',componentKey,css:cssRef,fields:[{customId:'code',sourceFieldFactIds:['wide-field','narrow-field']}]});
  node.pendingForm.widthLayout=proof;
  assert.equal((await prepareNative44PendingFormCapabilities({root,program,css})).length,1);
  assert.equal(node.widgetSettings.form_fields[0].width,'20');
  const configuration={version:1 as const,kind:'clonewp-inquiry-configuration' as const,targetOrigin:'https://target.example',recipients:['sales@target.example']};
  const configurationRef=await put('inquiry.json',configuration);
  const upgraded=configureInquiryBlocks(program.blocks,{...defaultInquiryPolicy(),configuration:configurationRef},configuration,program.taskId,sourceUrl)[0] as any;
  assert.equal(upgraded.pendingForm.version,4);assert.deepEqual(upgraded.pendingForm.widthLayout,proof);
  const ancestors=['contact-section','contact-inner'],classes=ancestors.map(k=>'.'+native44ModuleClass(k)),scoped=css.replaceAll(':page ',`:page ${classes.join(' ')} `);
  program.blocks=[{kind:'composite',key:ancestors[0],children:[{kind:'composite',key:ancestors[1],children:[node]}]}];
  const scopedCSSRef=await put('section-layout.css',scoped);
  node.pendingForm.widthLayout=await put('section-layout.json',{version:1,kind:'native44-form-width-layout',componentKey,css:scopedCSSRef,fields:[{customId:'code',sourceFieldFactIds:['wide-field','narrow-field']}]});
  const [permit]=await prepareNative44PendingFormCapabilities({root,program,css:scoped});
  assertNative44PendingFormCapability(program,node,{form:schema},permit);
  const moved=structuredClone(program);(moved.blocks[0] as any).children[0].key='wrong-parent';
  assert.throws(()=>assertNative44PendingFormCapability(moved,node,{form:schema},permit),/width_layout_ancestor_changed/);
  node.widgetSettings.form_fields[0].width='10';
  await assert.rejects(prepareNative44PendingFormCapabilities({root,program,css:scoped}),/v2_registered_field/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

import {assertPhoneTypographyWithdrawal,assertPhoneTypographyWithdrawalSource} from './phone-typography-withdrawal.js';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readFile,realpath,statfs,mkdir,open,readdir} from 'node:fs/promises';
import {z} from 'zod';
import {fullReplicaHash} from './contract.js';
import {canonicalFullReplicaJson} from './json.js';
import {validateNative44Program} from '../native44/validate.js';
import {walkNative44,type Native44Program} from '../native44/types.js';
import {referencedNative44Assets,usedNative44WidgetTypes} from '../native44/compiler.js';
import {NATIVE44_CORE_METHOD_CONTRACTS,native44MethodSourceHash} from '../native44/environment.js';
import type {LegacySchema} from '../wordpress/types.js';
import type {FullReplicaDependencies,FullReplicaFileRef,FullReplicaManifest,FullReplicaRunState} from './types.js';
const ROOT='D:/cloneWP';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const ref=z.object({path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const originalRequestSchema=z.object({version:z.literal(1),kind:z.literal('clonewp-unwritten-body-style-amendment-request'),taskId:z.literal('huaqi-about-20261023-body'),runId:z.literal('huaqi-about-20261023-body'),pageId:z.literal(12464),expectedManifestHash:z.string().regex(/^[a-f0-9]{64}$/),expectedStateRevision:z.number().int().nonnegative(),expectedCheckpointHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(10).max(4000),program:ref,responsive:z.unknown().optional(),evidence:z.array(ref).min(1).max(20)}).strict();
const withdrawalRequestSchema=originalRequestSchema.extend({version:z.literal(2),kind:z.literal('clonewp-unwritten-phone-typography-withdrawal-request'),previousAmendment:ref,media:z.object({ledger:ref,imported:ref}).strict(),withdrawnPlans:z.array(z.unknown()).length(2)}).strict();
const breakpointRequestSchema=originalRequestSchema.omit({responsive:true}).extend({version:z.literal(3),kind:z.literal('clonewp-unwritten-breakpoint-edge-amendment-request'),taskId:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,159}$/),runId:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,159}$/),pageId:z.number().int().positive(),media:z.object({ledger:ref,imported:ref}).strict().optional()}).strict();
const correctionRequestSchema=breakpointRequestSchema.extend({version:z.literal(4),kind:z.literal('clonewp-unwritten-control-correction-request'),previousAmendment:ref,registeredCapabilities:ref,media:z.object({ledger:ref,imported:ref}).strict()}).strict();
export const unwrittenBodyStyleRequestSchema=z.discriminatedUnion('version',[originalRequestSchema,withdrawalRequestSchema,breakpointRequestSchema,correctionRequestSchema]);
export type UnwrittenBodyStyleRequest=z.infer<typeof unwrittenBodyStyleRequestSchema>;
export interface BodyStyleAmendment {previous?:BodyStyleAmendment;breakpointSource?:unknown;controlCorrectionSource?:unknown;controlCorrectionSchemas?:Record<string,LegacySchema>;request:UnwrittenBodyStyleRequest;program:Native44Program;responsive:FullReplicaManifest['responsive'];effectiveProgramHash:string;effectiveResponsiveHash:string;reference?:FullReplicaFileRef;}
const fail=(code:string):never=>{throw Error('replica_full_body_style_amendment_'+code);};
async function safe(file:string,missing=false):Promise<string>{
 const root=await realpath(ROOT),absolute=path.resolve(file),relative=path.relative(root,absolute);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('path_escape');
 let cursor=root;for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);try{const info=await lstat(cursor);if(info.isSymbolicLink()||(await realpath(cursor)).toLowerCase()!==cursor.toLowerCase())fail('reparse');}catch(e){if(missing&&(e as NodeJS.ErrnoException).code==='ENOENT')return absolute;throw e;}}return absolute;
}
async function bound(reference:FullReplicaFileRef){ref.parse(reference);const file=await safe(reference.path),info=await lstat(file);if(!info.isFile()||info.size>32*1024*1024)fail('file_size');const bytes=await readFile(file);if(hash(bytes)!==reference.sha256)fail('file_hash');const value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));canonicalFullReplicaJson(value);return value;}
async function writeNew(file:string,value:unknown):Promise<FullReplicaFileRef>{await safe(file,true);const bytes=canonicalFullReplicaJson(value),handle=await open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}return {path:file,sha256:hash(bytes)};}
const scoped=(key:string)=>/^(global|footer|inquiry)(?:_|$)/.test(key);
const signature=(setting:any)=>fullReplicaHash({controlId:setting.controlId,value:setting.value,...(setting.repeaterPath?{repeaterPath:setting.repeaterPath}:{})});
/** Only authoring selectors/ranges/source bindings change. Runtime widget values and all business/content data are identical. */
export function assertBodyStyleMetadataOnly(original:Native44Program,effective:Native44Program,beforeResponsive:FullReplicaManifest['responsive'],afterResponsive:FullReplicaManifest['responsive']):void{
 const before=structuredClone(original),after=structuredClone(effective),oldNodes=new Map(walkNative44(before.blocks).map(n=>[n.key,n]));
 for(const node of walkNative44(after.blocks))if(scoped(node.key)){
  const old=oldNodes.get(node.key)??fail('component_identity');
  const oldSignatures=[...new Set((old.nativeStyleSettings??[]).map(signature))].sort(),newSignatures=[...new Set((node.nativeStyleSettings??[]).map(signature))].sort();if(fullReplicaHash(oldSignatures)!==fullReplicaHash(newSignatures))fail('native_setting_value_changed');
  delete old.styleBindings;delete old.nativeStyleSettings;delete node.styleBindings;delete node.nativeStyleSettings;
 }
 if(fullReplicaHash(before)!==fullReplicaHash(after))fail('program_core_changed');
 const a=structuredClone(beforeResponsive),b=structuredClone(afterResponsive);
 if(a&&b)for(const section of b.sections)if(['global','footer','inquiry'].includes(section.key)){
  const old=a.sections.find(s=>s.key===section.key)??fail('responsive_identity');
  const signatures=(items:any[])=>[...new Set(items.map(i=>i.componentKey+':'+signature(i.setting)))].sort();if(fullReplicaHash(signatures(old.nativeStyleSettings??[]))!==fullReplicaHash(signatures(section.nativeStyleSettings??[])))fail('responsive_native_setting_value_changed');
  delete old.styleBindings;delete old.nativeStyleSettings;delete section.styleBindings;delete section.nativeStyleSettings;
 }
 if(fullReplicaHash(a??null)!==fullReplicaHash(b??null))fail('responsive_core_changed');
 if(fullReplicaHash(original)===fullReplicaHash(effective)&&fullReplicaHash(beforeResponsive??null)===fullReplicaHash(afterResponsive??null))fail('no_change');
}
export function assertUnwrittenBodyStyleState(manifest:FullReplicaManifest,state:FullReplicaRunState,continuation=false){
 if(manifest.taskId!=='huaqi-about-20261023-body'||manifest.runId!==manifest.taskId||manifest.headerProvider!=='reused-woodmart-header'||manifest.targetOrigin!=='https://vapeversse.com'||manifest.reusedHeader?.headerId!=='header_39589520821341414'||state.taskId!==manifest.taskId||state.runId!==manifest.runId||state.manifestHash!==fullReplicaHash(manifest)||state.status!=='building'||state.pending||state.review||Object.keys(state.checkpoints).join(',')!=='page'||state.checkpoints.page?.pageId!==12464||state.checkpoints.page.status!=='draft'||state.checkpoints.page.runId!==state.runId||state.checkpoints.page.template!=='elementor_header_footer'||state.checkpoints.page.headerId!==null||(!continuation&&state.bodyStyleAmendment)||(continuation&&!state.bodyStyleAmendment))fail('unwritten_state_required');
}
/** V3 changes only the one-pixel ownership edge of existing desktop metadata. */
export function assertBreakpointEdgeMetadataOnly(original:Native44Program,effective:Native44Program,responsive:FullReplicaManifest['responsive'],source:unknown):void{
 const edge=responsive?.mobileMaxWidth,s=source as any;
 if(!Number.isInteger(edge)||edge!<600||edge!>900||s?.version!==2||s.kind!=='source-facts'||s.sourceUrl!==original.sourceUrl||!Array.isArray(s.snapshots)||!s.facts)fail('breakpoint_source');
 const before=structuredClone(original),after=structuredClone(effective),old=walkNative44(before.blocks),next=walkNative44(after.blocks);let changes=0;
 if(old.length!==next.length)fail('breakpoint_structure');
 for(let index=0;index<old.length;index++){
  const a=old[index],b=next[index];if(a.key!==b.key)fail('breakpoint_structure');
  for(const field of ['styleBindings','nativeStyleSettings'] as const){
   const rows=a[field],updates=b[field];if(rows===undefined&&updates===undefined)continue;
   if(!rows||!updates||rows.length!==updates.length)return fail('breakpoint_metadata_shape');
   for(let row=0;row<rows.length;row++){
    const previous=rows[row],current=updates[row];if(fullReplicaHash(previous)===fullReplicaHash(current))continue;
    if(previous.minWidth!==edge||current.minWidth!==edge!+1||previous.maxWidth<current.minWidth)fail('breakpoint_exact_edge');
    const restored={...current,minWidth:previous.minWidth};if(fullReplicaHash(previous)!==fullReplicaHash(restored))fail('breakpoint_metadata_changed');
    const ids='sourceFactId'in previous?[previous.sourceFactId]:previous.sourceFactIds;
    if(!Array.isArray(ids)||!ids.length)fail('breakpoint_source');
    for(const id of ids){const fact=s.facts[id],matches=s.snapshots.filter((snapshot:any)=>snapshot.id===fact?.snapshotId),width=matches[0]?.viewport?.width;if(!fact||matches.length!==1||!Number.isFinite(width)||width<current.minWidth||width>current.maxWidth||width<previous.minWidth||width>previous.maxWidth)fail('breakpoint_source_width');}
    updates[row]=restored as any;changes++;
   }
  }
 }
 if(!changes)fail('no_change');if(fullReplicaHash(before)!==fullReplicaHash(after))fail('breakpoint_program_changed');
}
export function assertUnwrittenBreakpointEdgeState(manifest:FullReplicaManifest,state:FullReplicaRunState,pageId:number):void{
 const page=state.checkpoints.page;
 if(manifest.version!==4||manifest.headerProvider!=='reused-woodmart-header'||!manifest.reusedHeader||!manifest.responsive||state.taskId!==manifest.taskId||state.runId!==manifest.runId||state.manifestHash!==fullReplicaHash(manifest)||state.status!=='building'||state.pending||state.review||state.bodyStyleAmendment||Object.keys(state.checkpoints).join(',')!=='page'||!Number.isSafeInteger(pageId)||pageId<1||page?.pageId!==pageId||page.status!=='draft'||page.runId!==state.runId||page.template!=='elementor_header_footer'||page.headerId!==null)fail('unwritten_state_required');
}
export function assertUnwrittenControlCorrectionState(manifest:FullReplicaManifest,state:FullReplicaRunState,pageId:number,previousAmendment:FullReplicaFileRef):void{
 if(!state.bodyStyleAmendment||fullReplicaHash(state.bodyStyleAmendment)!==fullReplicaHash(previousAmendment))fail('previous_pointer');
 const copy={...state};delete copy.bodyStyleAmendment;assertUnwrittenBreakpointEdgeState(manifest,copy,pageId);
}
/** Only source-owned native control spellings/presets can be corrected; all
 * content, media references, source bindings and actual values are preserved. */
export function assertSourceProvenControlCorrections(original:Native44Program,effective:Native44Program,source:unknown,schemas:Record<string,LegacySchema>):void{
 const s=source as any;if(s?.version!==2||s.kind!=='source-facts'||s.sourceUrl!==original.sourceUrl||!Array.isArray(s.snapshots)||!s.facts)fail('control_source');
 const before=structuredClone(original),after=structuredClone(effective),old=walkNative44(before.blocks),next=walkNative44(after.blocks);let changes=0;
 if(old.length!==next.length)fail('control_structure');
 const owner=(node:{sourceFactIds?:string[]},media=false)=>{
  if(!node.sourceFactIds?.length)fail('control_source_owner');
  const facts=node.sourceFactIds!.map(id=>{const fact=s.facts[id];if(!fact||fact.id!==id||s.snapshots.filter((snapshot:any)=>snapshot.id===fact.snapshotId).length!==1)fail('control_source_owner');return fact;});
  if(media&&!facts.some(f=>f.kind==='media'))fail('control_source_media');
 };
 for(let index=0;index<old.length;index++){
  const a=old[index],b=next[index];if(a.key!==b.key||a.kind!==b.kind)fail('control_structure');
  if(fullReplicaHash(a)===fullReplicaHash(b))continue;
  if(a.kind==='composite'&&b.kind==='composite'&&a.settings&&b.settings&&fullReplicaHash(a.settings)!==fullReplicaHash(b.settings)&&Object.hasOwn(a.settings,'direction')){
   const schema=schemas.container,control=schema?.controls.flex_direction,value=a.settings.direction;
   if(schema?.class!=='Elementor\\Includes\\Elements\\Container'||Object.hasOwn(schema.controls,'direction')||control?.type!=='choose'||typeof value!=='string'||!control.options||!Object.hasOwn(control.options,value)||Object.hasOwn(a.settings,'flex_direction')||Object.hasOwn(b.settings,'direction')||b.settings.flex_direction!==value)fail('control_direction');
   owner(a);delete b.settings.flex_direction;b.settings.direction=structuredClone(value);changes++;
  }else if(a.kind==='native'&&b.kind==='native'&&a.widgetType==='wd_image_or_svg'&&b.widgetType===a.widgetType&&a.widgetSettings.size==='full'){
   const schema=schemas.wd_image_or_svg,controls=schema?.controls;
   if(schema?.class!=='XTS\\Elementor\\Image'||controls?.image?.type!=='media'||controls.size?.type!=='select'||!controls.size.options||Object.hasOwn(controls.size.options,'full')||!Object.hasOwn(controls.size.options,'')||controls.image_size?.type!=='select'||!controls.image_size.options||!Object.hasOwn(controls.image_size.options,'full')||b.widgetSettings.size!==''||b.widgetSettings.image_size!=='full'||a.widgetSettings.image_size!==undefined&&a.widgetSettings.image_size!=='full')fail('control_image_preset');
   owner(a,true);b.widgetSettings.size='full';if(Object.hasOwn(a.widgetSettings,'image_size'))b.widgetSettings.image_size=a.widgetSettings.image_size;else delete b.widgetSettings.image_size;changes++;
  }
 }
 if(!changes)fail('no_change');if(fullReplicaHash(before)!==fullReplicaHash(after))fail('control_program_changed');
}
/** Compare the exact controls relevant to the two legal correction families. */
export function controlCorrectionRegistryHash(schemas:Record<string,LegacySchema>):string{
 return fullReplicaHash(Object.fromEntries([['container',['direction','flex_direction']],['wd_image_or_svg',['image','size','image_size']]].map(([type,names])=>{const schema=schemas[type as string];return[type,{class:schema?.class??null,controls:Object.fromEntries((names as string[]).map(name=>[name,schema?.controls[name]??null]))}];})));
}
function assertQualifiedCorrectionRegistry(capabilities:any,program:Native44Program):void{
 if(capabilities?.mode!=='legacy-verified'||capabilities.versions?.activeTemplate!=='woodmart'||!['elementor','elementorPro','woodmart','woodmartCore'].every(key=>typeof capabilities.versions?.[key]==='string'&&capabilities.versions[key]))fail('control_registry_qualification');
 for(const type of usedNative44WidgetTypes(program)){const schema=capabilities.legacySchemas?.[type];if(schema?.type!==type||!schema.class||!schema.controls||!Object.keys(schema.controls).length||capabilities.sourceProof?.schemaErrors?.[type])fail('control_registry_qualification');}
 for(const [key,expected]of Object.entries(NATIVE44_CORE_METHOD_CONTRACTS)){const proof=capabilities.sourceProof?.[key];if(proof?.class!==expected.class||proof.method!==expected.method||typeof proof.source!=='string'||native44MethodSourceHash(proof.source)!==expected.sha256)fail('control_registry_qualification');}
}
async function materialize(requestInput:unknown,manifest:FullReplicaManifest,directory?:string,depth=0):Promise<BodyStyleAmendment>{
 const request=unwrittenBodyStyleRequestSchema.parse(requestInput);if(request.taskId!==manifest.taskId||request.runId!==manifest.runId||request.expectedManifestHash!==fullReplicaHash(manifest))fail('manifest_identity');
 const original=validateNative44Program(await bound(manifest.body.program)),program=validateNative44Program(await bound(request.program)),responsive=request.version===3||request.version===4||request.responsive===undefined?manifest.responsive:request.responsive as FullReplicaManifest['responsive'];
 let breakpointSource:unknown;
 let previous:BodyStyleAmendment|undefined;
 let controlCorrectionSource:unknown,controlCorrectionSchemas:Record<string,LegacySchema>|undefined;
 if(request.version===2){
  if(!directory||depth>0)fail('withdrawal_chain');
  previous=await loadBodyStyleAmendment(directory!,request.previousAmendment,manifest,depth+1);
  if(previous.request.version!==1||fullReplicaHash(request.program)!==fullReplicaHash(previous.request.program))fail('withdrawal_previous_program');
  assertPhoneTypographyWithdrawal(previous.program,program,previous.responsive,responsive,request.withdrawnPlans);
 } else if(request.version===4){
  if(!directory||depth>0)fail('control_correction_chain');previous=await loadBodyStyleAmendment(directory!,request.previousAmendment,manifest,depth+1);
  if(previous.request.version!==3||previous.request.pageId!==request.pageId)fail('control_correction_previous');
  const registry=await bound(request.registeredCapabilities);assertQualifiedCorrectionRegistry(registry,previous.program);controlCorrectionSchemas=registry.legacySchemas;controlCorrectionSource=await bound(previous.program.sourceFacts);
  assertSourceProvenControlCorrections(previous.program,program,controlCorrectionSource,controlCorrectionSchemas!);
 } else if(request.version===3){if(original.taskId!==manifest.taskId||original.sourceUrl!==manifest.sourceUrl)fail('manifest_identity');breakpointSource=await bound(original.sourceFacts);assertBreakpointEdgeMetadataOnly(original,program,manifest.responsive,breakpointSource);}
 else assertBodyStyleMetadataOnly(original,program,manifest.responsive,responsive);
 for(const evidence of request.evidence)await bound(evidence);
 return {...(previous?{previous}:{}),...(breakpointSource?{breakpointSource}:{}),...(controlCorrectionSchemas?{controlCorrectionSource,controlCorrectionSchemas}:{}),request,program,responsive,effectiveProgramHash:fullReplicaHash(program),effectiveResponsiveHash:fullReplicaHash(responsive??null)};
}
export async function readUnwrittenBodyStyleRequest(filename:string,manifest:FullReplicaManifest,state:FullReplicaRunState,directory?:string):Promise<BodyStyleAmendment>{
 const file=await safe(filename),bytes=await readFile(file);if(bytes.length>32*1024*1024)fail('file_size');const request=unwrittenBodyStyleRequestSchema.parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));if(request.version===4)assertUnwrittenControlCorrectionState(manifest,state,request.pageId,request.previousAmendment);else if(request.version===3)assertUnwrittenBreakpointEdgeState(manifest,state,request.pageId);else assertUnwrittenBodyStyleState(manifest,state,request.version===2);if(request.version===2&&fullReplicaHash(request.previousAmendment)!==fullReplicaHash(state.bodyStyleAmendment))fail('previous_pointer');const amendment=await materialize(request,manifest,directory);
 if(amendment.request.expectedStateRevision!==state.revision||amendment.request.expectedCheckpointHash!==fullReplicaHash(state.checkpoints))fail('expected_state');return amendment;
}
export async function loadBodyStyleAmendment(directory:string,reference:FullReplicaFileRef,manifest:FullReplicaManifest,depth=0):Promise<BodyStyleAmendment>{
 if(depth>1)fail('withdrawal_chain');
 const expected=path.join(directory,'body-style-amendments'),relative=path.relative(expected,path.resolve(reference.path));if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.basename(reference.path)!=='bundle.json')fail('bundle_path');
 const value=await bound(reference),request=unwrittenBodyStyleRequestSchema.parse(value?.request);if(value?.version!==1||value.kind!=='clonewp-unwritten-body-style-amendment'||value.manifestHash!==fullReplicaHash(manifest)||value.pageId!==request.pageId||value.remoteWrites!==0||value.renderedVerified!==false||!value.readback||fullReplicaHash(value.readback)!==value.readbackHash)fail('bundle_identity');
 const intent=await bound(ref.parse(value.intent));if(intent?.kind!=='clonewp-unwritten-body-style-amendment-intent'||intent.manifestHash!==value.manifestHash||fullReplicaHash(intent.request)!==fullReplicaHash(value.request)||fullReplicaHash(intent.operation)!==fullReplicaHash(value.intentOperation)||intent.remoteWrites!==0)fail('intent_identity');
 const result=await materialize(value.request,manifest,directory,depth);if(result.effectiveProgramHash!==value.effectiveProgramHash||result.effectiveResponsiveHash!==value.effectiveResponsiveHash)fail('effective_hash');return {...result,reference};
}
export function assertUnwrittenBodyStyleReadback(input:unknown,manifest:FullReplicaManifest,state:FullReplicaRunState):void{
 const proof=input as any,snapshot=proof?.snapshot,page=snapshot?.page;
 if(proof?.remoteWrites!==0||proof?.styleResolution?.renderedVerified!==false||!Array.isArray(proof?.styleResolution?.receipts)||!snapshot||typeof snapshot.hash!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.hash)||fullReplicaHash(snapshot.resources)!==fullReplicaHash(manifest.reusedHeader)||!page||page.pageId!==state.checkpoints.page?.pageId||page.runId!==state.runId||page.status!=='draft'||page.template!=='elementor_header_footer'||page.headerId!==null||!Array.isArray(page.elements)||page.elements.length||String(page.settings?.custom_css??'')!==''||!snapshot.receipts||Object.values(snapshot.receipts).some((r:any)=>r.state!=='complete'||r.action!=='create-page'||r.result?.pageId!==page.pageId))fail('readonly_empty_draft_proof');
}
export async function installBodyStyleAmendment(options:{directory:string;lockId:string;manifest:FullReplicaManifest;state:FullReplicaRunState;amendment:BodyStyleAmendment;dependencies:FullReplicaDependencies;writeState(state:FullReplicaRunState):Promise<void>}){
 const {directory,manifest,state,amendment,dependencies}=options;if(amendment.request.version===4)assertUnwrittenControlCorrectionState(manifest,state,amendment.request.pageId,amendment.request.previousAmendment);else if(amendment.request.version===3)assertUnwrittenBreakpointEdgeState(manifest,state,amendment.request.pageId);else assertUnwrittenBodyStyleState(manifest,state,amendment.request.version===2);
 if(amendment.request.version===2&&fullReplicaHash(state.bodyStyleAmendment)!==fullReplicaHash(amendment.request.previousAmendment))fail('previous_pointer');
 const checkLock=async()=>{const lock=JSON.parse(await readFile(await safe(path.join(directory,'.lock')),'utf8'));if(!options.lockId||lock.lockId!==options.lockId)fail('run_lock_required');};await checkLock();
 const inspect=dependencies.inspectUnwrittenBodyStyle??fail('readonly_adapter_required');
 const current=JSON.parse(await readFile(await safe(path.join(directory,'state.json')),'utf8'));if(fullReplicaHash(current)!==fullReplicaHash(state))fail('local_state_changed');
 if(amendment.request.version===2||amendment.request.version===4||amendment.request.version===3&&amendment.request.media){await readBodyStyleAmendmentMedia(directory,amendment.request,manifest);for(const name of await readdir(await safe(path.join(directory,'operations'))))if(name.includes('body-save-intent'))fail('body_save_intent_exists');}
 else for(const name of ['body-media']){try{await lstat(path.join(directory,name));fail('media_or_body_exists');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 if(amendment.request.version===3){let names:string[]=[];try{names=await readdir(await safe(path.join(directory,'operations')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(names.some(name=>name.includes('body-save-intent')))fail('body_save_intent_exists');}
 const free=await statfs(directory);if(free.bavail*free.bsize<512*1024*1024)fail('evidence_space');
 const parent=path.join(directory,'body-style-amendments');await safe(parent,true);try{await mkdir(parent);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}await safe(parent);const folder=path.join(parent,randomUUID());await mkdir(folder);
 const operation={operationId:randomUUID(),taskId:state.taskId,runId:state.runId,phase:'body' as const,expectedCheckpointHash:fullReplicaHash(state.checkpoints),createdAt:new Date().toISOString()};
 const intent=await writeNew(path.join(folder,'intent.json'),{version:1,kind:'clonewp-unwritten-body-style-amendment-intent',request:amendment.request,manifestHash:state.manifestHash,stateHash:fullReplicaHash(state),operation,remoteWrites:0});
 const body=await dependencies.prepareBody(manifest);await dependencies.assertPreparedBody(body,manifest);
 const receipt=(body.payload as any)?.authoringAmendment;if(receipt?.effectiveProgramHash!==amendment.effectiveProgramHash||receipt?.effectiveResponsiveHash!==amendment.effectiveResponsiveHash||receipt?.originalManifestHash!==state.manifestHash)fail('prepared_metadata_not_current');
 if(amendment.request.version===2)assertPhoneTypographyWithdrawalSource((body.payload as any)?.presentationSource??(body.payload as any)?.sourceFacts);
 const readback=await inspect.call(dependencies,body,state.checkpoints.page!,operation);
 assertUnwrittenBodyStyleReadback(readback,manifest,state);
 if(amendment.request.version===2||amendment.request.version===4||amendment.request.version===3&&amendment.request.media){const media=await readBodyStyleAmendmentMedia(directory,amendment.request,manifest);if(fullReplicaHash((readback as any).mediaVerification)!==fullReplicaHash(media.proof))fail('media_readback');}
 if(amendment.request.version===4&&(!amendment.controlCorrectionSchemas||(readback as any).controlCorrectionRegistryHash!==controlCorrectionRegistryHash(amendment.controlCorrectionSchemas)))fail('control_registry_readback');
 if((readback as any).effectiveProgramHash!==amendment.effectiveProgramHash)fail('readback_effective_program');
 const bundle=await writeNew(path.join(folder,'bundle.json'),{version:1,kind:'clonewp-unwritten-body-style-amendment',manifestHash:state.manifestHash,pageId:amendment.request.pageId,request:amendment.request,effectiveProgramHash:amendment.effectiveProgramHash,effectiveResponsiveHash:amendment.effectiveResponsiveHash,readback,readbackHash:fullReplicaHash(readback),intent,intentOperation:operation,remoteWrites:0,renderedVerified:false});
 await loadBodyStyleAmendment(directory,bundle,manifest);if(fullReplicaHash(JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')))!==fullReplicaHash(state))fail('local_state_changed');
 await checkLock();const next={...state,bodyStyleAmendment:bundle,revision:state.revision+1,updatedAt:new Date().toISOString()};await options.writeState(next);if(fullReplicaHash(JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')))!==fullReplicaHash(next))fail('state_readback');
 return {status:'unwritten-body-style-amended',pageId:amendment.request.pageId,bundle,effectiveProgramHash:amendment.effectiveProgramHash,effectiveResponsiveHash:amendment.effectiveResponsiveHash,manifestHash:state.manifestHash,remoteWrites:0,renderedVerified:false};
}

export function assertBodyStyleAmendment(original:Native44Program,amendment:BodyStyleAmendment,responsive:FullReplicaManifest['responsive']){
 if(amendment.request.version===1)return assertBodyStyleMetadataOnly(original,amendment.program,responsive,amendment.responsive);
 if(amendment.request.version===3){if(fullReplicaHash(responsive??null)!==fullReplicaHash(amendment.responsive??null))fail('breakpoint_responsive_changed');return assertBreakpointEdgeMetadataOnly(original,amendment.program,responsive,amendment.breakpointSource);}
 if(amendment.request.version===4){if(!amendment.previous||amendment.previous.request.version!==3||!amendment.controlCorrectionSchemas)fail('control_correction_chain');assertBodyStyleAmendment(original,amendment.previous!,responsive);if(fullReplicaHash(responsive??null)!==fullReplicaHash(amendment.responsive??null))fail('control_responsive_changed');return assertSourceProvenControlCorrections(amendment.previous!.program,amendment.program,amendment.controlCorrectionSource,amendment.controlCorrectionSchemas!);}
 if(!amendment.previous||amendment.previous.request.version!==1)fail('withdrawal_chain');
 assertBodyStyleMetadataOnly(original,amendment.previous!.program,responsive,amendment.previous!.responsive);
 assertPhoneTypographyWithdrawal(amendment.previous!.program,amendment.program,amendment.previous!.responsive,amendment.responsive,amendment.request.withdrawnPlans);
}
export async function readBodyStyleAmendmentMedia(directory:string,request:UnwrittenBodyStyleRequest,manifest?:FullReplicaManifest){
 if(request.version===3||request.version===4)return readBreakpointMedia(directory,request,manifest);
 if(request.version!==2) return fail('media_request');
 for(const name of ['ledger','imported'] as const)if(path.resolve(request.media[name].path).toLowerCase()!==path.resolve(directory,'body-media','assets',name+'.json').toLowerCase())fail('media_path');
 const ledger=await bound(request.media.ledger),assets=await bound(request.media.imported);
 if(ledger.version!==1||ledger.runId!==request.runId||ledger.pageId!==12464||!Array.isArray(ledger.assets)||ledger.assets.length!==26||!Array.isArray(assets)||assets.length!==26||new Set(assets.map((a:any)=>a.key)).size!==26||new Set(ledger.assets.map((a:any)=>a.key)).size!==26)fail('media_inventory');
 for(const entry of ledger.assets){if(entry.status!=='complete'||!Array.isArray(entry.operations)||entry.operations.some((o:any)=>o.status!=='confirmed')||!entry.imported||entry.key!==entry.imported.key||entry.sha256!==entry.imported.sha256||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.imported.attachmentId)||entry.imported.attachmentId<1||fullReplicaHash(assets.find((a:any)=>a.key===entry.key)??null)!==fullReplicaHash(entry.imported))fail('media_inventory');}
 return {assets,proof:{count:26,assetsHash:fullReplicaHash(assets),ledger:request.media.ledger,imported:request.media.imported,ownership:'verified-readonly',remoteWrites:0}};
}

/** Restore only the exact existing page's in-memory ownership. The required
 * existing-page branch throws before insertion when absent or mismatched. */
export async function verifyBodyStyleAmendmentMedia(directory:string,request:UnwrittenBodyStyleRequest,title:string,client:Pick<import('../wordpress/client.js').WordPressClient,'createDraft'|'verifyImportedAssets'>,manifest?:FullReplicaManifest){
 const media=await readBodyStyleAmendmentMedia(directory,request,manifest),pageId=request.pageId;
 const page=await client.createDraft(request.runId,title,{requireExistingPageId:pageId});
 if(page.pageId!==pageId||page.status!=='draft')fail('media_owned_page');
 await client.verifyImportedAssets(pageId,media.assets);
 return media.proof;
}
async function readBreakpointMedia(directory:string,request:z.infer<typeof breakpointRequestSchema>|z.infer<typeof correctionRequestSchema>,manifest?:FullReplicaManifest){
 if(!request.media||!manifest||manifest.taskId!==request.taskId||manifest.runId!==request.runId||request.expectedManifestHash!==fullReplicaHash(manifest))return fail('media_request');
 for(const name of ['ledger','imported']as const)if(path.resolve(request.media[name].path).toLowerCase()!==path.resolve(directory,'body-media','assets',name+'.json').toLowerCase())fail('media_path');
 const ledger=await bound(request.media.ledger),assets=await bound(request.media.imported),program=validateNative44Program(await bound(manifest.body.program)),assetManifest=await bound(program.assetsManifest);
 const cssBytes=await readFile(await safe(manifest.body.css.path));if(hash(cssBytes)!==manifest.body.css.sha256)fail('file_hash');
 const required=[...new Set([...referencedNative44Assets(program),...[...cssBytes.toString('utf8').matchAll(/__ASSET_([A-Za-z][A-Za-z0-9_-]{0,100})__/g)].map(match=>match[1])])].sort();
 if(ledger.version!==1||ledger.runId!==request.runId||ledger.pageId!==request.pageId||!Array.isArray(ledger.assets)||!Array.isArray(assets)||!Array.isArray(assetManifest.assets)||ledger.assets.length!==required.length||assets.length!==required.length||fullReplicaHash(assets.map((a:any)=>a.key).sort())!==fullReplicaHash(required)||fullReplicaHash(ledger.assets.map((a:any)=>a.key).sort())!==fullReplicaHash(required))fail('media_inventory');
 for(const entry of ledger.assets){const source=assetManifest.assets.filter((a:any)=>a.key===entry.key);if(source.length!==1||source[0].sha256!==entry.sha256||entry.status!=='complete'||!Array.isArray(entry.operations)||!entry.operations.length||entry.operations.some((o:any)=>o.status!=='confirmed')||!entry.imported||entry.key!==entry.imported.key||entry.sha256!==entry.imported.sha256||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.imported.attachmentId)||entry.imported.attachmentId<1||new URL(entry.imported.url).origin!==manifest.targetOrigin||fullReplicaHash(assets.find((a:any)=>a.key===entry.key)??null)!==fullReplicaHash(entry.imported))fail('media_inventory');}
 return {assets,proof:{count:required.length,assetsHash:fullReplicaHash(assets),ledger:request.media.ledger,imported:request.media.imported,ownership:'verified-readonly',remoteWrites:0}};
}

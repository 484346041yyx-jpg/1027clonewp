import path from 'node:path';
import { mkdir, readFile, writeFile, rename, lstat, realpath, statfs } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { loadConfig } from '../core/config.js';
import { acquireLock } from '../core/files.js';
import { assertWorkspaceAccess } from '../workspace/service.js';
import { WordPressConnection } from '../wordpress/connection.js';
import { WordPressClient } from '../wordpress/client.js';
import { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { NATIVE44_ALL_TYPES } from '../native44/catalog.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../native44/knowledge.js';
import { referencedNative44Assets, usedNative44WidgetTypes } from '../native44/compiler.js';
import { importNative44Media, type Native44Asset } from '../native44/media.js';
import { readNativeContentRef, verifyNativeContentSource } from '../native44/content-source.js';
import { prepareResponsiveBody, compileResponsiveBody } from '../replica-responsive/body.js';
import { verifyResponsiveSections } from '../replica-responsive/source.js';
import { assertResponsiveTarget, certifyResponsiveSchemas } from '../replica-responsive/target.js';
import { verifySourceHoverReview } from '../replica-v2/hover-review.js';
import { validateObservationPacketV2 } from '../replica-v2/observation.js';
import { buildSourceFactsV2 } from '../replica-v2/source.js';
import { publicHoverFacts, publicSourceNodes } from './public-source.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { createHeaderBundle, loadHeaderBundle } from '../woodmart-header/generic/bundle.js';
import { provisionHeaderModule, createHeaderModulePage, bindHeaderModulePage, checkpointHeaderModule, reconcileHeaderModule } from '../woodmart-header/generic/service.js';
import { FullReplicaHeaderModuleDriver } from './native-header.js';
import { validateHeaderModulePlan } from '../woodmart-header/generic/contract.js';
import { fullReplicaHash } from './contract.js';
import { BodySourceEvidenceSchema } from './body-prepare.js';
import { compileFullPageCSS } from './css.js';
import { validatePublicReplicaManifest, validatePublicFooterProgram, type PublicReplicaManifest } from './public-contract.js';
import { PublicResourceDriver, publicPayloadHash, type PublicAction, type PublicInspection } from './public-driver.js';
import type { HeaderRemoteSnapshot } from '../woodmart-header/generic/wordpress.js';

const ROOT='D:/cloneWP';
interface PublicState {version:1;kind:'clonewp-public-replica-run';taskId:string;runId:string;manifestHash:string;status:'building'|'draft-for-user-review'|'write-unknown';pending:null|{operationId:string;action:PublicAction;beforeHash:string;payloadHash:string};headerPending?:boolean;snapshot?:PublicInspection;header?:unknown;headerProtection?:string;error?:string}
export function publicHeaderProtection(snapshot:HeaderRemoteSnapshot){const module=snapshot.module;return fullReplicaHash({globalHash:snapshot.globalHash,defaultHeaderId:snapshot.defaultHeaderId,presetReferences:snapshot.presetReferences,otherReferences:snapshot.otherReferences,module:module?{identity:module.identity,name:module.name,menus:module.menus,style:module.style,header:module.header,menuContent:module.menuContent??null}:null});}
async function atomic(file:string,value:unknown){const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),{flag:'wx'});await rename(temp,file);}
async function checkedDirectory(directory:string,create=false){const root=await realpath(ROOT),target=path.resolve(directory),relative=path.relative(root,target);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('replica_full_public_directory');let cursor=root;for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);try{const s=await lstat(cursor);if(!s.isDirectory()||s.isSymbolicLink()||(await realpath(cursor)).toLowerCase()!==cursor.toLowerCase())throw Error('replica_full_public_reparse');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'||!create)throw e;await mkdir(cursor);}}const space=await statfs(target);if(space.bavail*space.bsize<512*1024*1024)throw Error('replica_full_public_space');return target;}
const boundJSON=async(ref:{path:string;sha256:string},base?:string)=>JSON.parse((await readNativeContentRef(ref,base)).toString('utf8'));

/** Public scopes use the full replica entry, native44 compiler, responsive and
 * header modules. Only the owned save target changes to a reusable cms_block. */
export async function runPublicReplica(input:unknown,options:{manifestPath:string;runDirectory:string;command:'run'|'resume'|'status'|'reconcile'}){
  const manifest=validatePublicReplicaManifest(input),base=path.dirname(options.manifestPath);
  const absolute=(ref:{path:string;sha256:string})=>({...ref,path:path.resolve(base,ref.path)});
  const m:PublicReplicaManifest={...manifest,sourceEvidence:absolute(manifest.sourceEvidence),...(manifest.footer?{footer:{...manifest.footer,program:absolute(manifest.footer.program),css:absolute(manifest.footer.css),assets:absolute(manifest.footer.assets),responsive:{...manifest.footer.responsive,source:absolute(manifest.footer.responsive.source)}}}:{}),...(manifest.header?{header:{...manifest.header,bundleDirectory:path.resolve(base,manifest.header.bundleDirectory)}}:{})};
  const manifestHash=fullReplicaHash(m);
  if(options.command!=='status')await assertWorkspaceAccess(ROOT);
  const directory=await checkedDirectory(options.runDirectory,options.command==='run'),statePath=path.join(directory,'state.json');let state:PublicState;
  if(options.command==='run'){
    try{await lstat(statePath);throw Error('replica_full_public_run_exists');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    state={version:1,kind:'clonewp-public-replica-run',taskId:m.taskId,runId:m.runId,manifestHash,status:'building',pending:null};
  }else{state=JSON.parse(await readFile(statePath,'utf8'));if(state.kind!=='clonewp-public-replica-run'||state.manifestHash!==manifestHash||state.runId!==m.runId||state.taskId!==m.taskId)throw Error('replica_full_public_run_changed');}
  const delivery=()=>({status:state.status,scope:m.pageScope,runId:m.runId,resources:[...(state.snapshot?.snapshot.footer?[{kind:'footer',...state.snapshot.snapshot.footer}]:[]),...(state.snapshot?.snapshot.preview?[{kind:'preview-page',...state.snapshot.snapshot.preview}]:[])].map(({elements,settings,content,...item}:any)=>item),header:state.header??null,pending:state.pending??(state.headerPending?{kind:'header-module'}:null),error:state.error??null,visualReview:'user-review-pending',globalBinding:'unchanged'});
  if(options.command==='status')return delivery();
  // Evidence and native knowledge are verified before target authentication.
  const evidence=BodySourceEvidenceSchema.parse(await boundJSON(m.sourceEvidence));if(evidence.taskId!==m.taskId||evidence.sourceUrl!==m.sourceUrl)throw Error('replica_full_public_evidence_identity');
  const packets:ReturnType<typeof validateObservationPacketV2>[]=[],packetFiles:Array<{path:string;sha256:string;snapshotId:string}>=[],widths=new Set<number>();
  for(const snapshot of evidence.snapshots)for(const ref of snapshot.packets){const p=validateObservationPacketV2(await boundJSON(ref,path.dirname(m.sourceEvidence.path)));if(p.snapshot.url!==m.sourceUrl||p.snapshot.id!==snapshot.id||!publicSourceNodes(p,m.pageScope).size)throw Error('replica_full_public_evidence_changed');widths.add(p.snapshot.viewport.width);const raster=await readNativeContentRef(p.snapshot.screenshot,path.dirname(path.resolve(path.dirname(m.sourceEvidence.path),ref.path))),meta=await sharp(raster).metadata();if(meta.width!==p.snapshot.screenshot.width||meta.height!==p.snapshot.screenshot.height)throw Error('replica_full_public_screenshot');packets.push(p);packetFiles.push({...ref,snapshotId:p.snapshot.id});}
  if([...widths].filter(w=>w>1024).length<2||[...widths].filter(w=>w<=768).length<2)throw Error('replica_full_public_four_viewports');
  const facts=publicHoverFacts(buildSourceFactsV2({manifestPath:m.sourceEvidence.path,manifestSha256:m.sourceEvidence.sha256,manifest:{version:2,kind:'observation-manifest',sourceUrl:m.sourceUrl,provenance:{method:'user-opened-browser',observer:'cua_repl',browser:'chrome'},packets:[],screenshots:[]},packets,packetFiles}),packets,m.pageScope);
  if(Object.values(facts.facts).some(f=>f.kind==='interaction'&&f.value.kind==='hover'&&(f.value.details as any)?.source==='css-hover-selector')){
    const reviews=[];for(const ref of evidence.additionalEvidence??[]){const value=await boundJSON(ref,path.dirname(m.sourceEvidence.path));if(value.kind==='source-hover-review')reviews.push({value,base:path.dirname(path.resolve(path.dirname(m.sourceEvidence.path),ref.path))});}
    if(reviews.length!==1)throw Error('replica_full_public_hover_review_missing');verifySourceHoverReview(facts,reviews[0].value);
    for(const row of reviews[0].value.rows)for(const capture of row.captures??[]){const raster=await readNativeContentRef(capture.screenshot,reviews[0].base);await sharp(raster).metadata();}
  }
  let footer:undefined|{program:ReturnType<typeof validatePublicFooterProgram>;css:string;assets:Native44Asset[]};
  if(m.footer){const raw=validatePublicFooterProgram(await boundJSON(m.footer.program),m),program={...raw};for(const key of ['sourceFacts','componentPlan','assetsManifest'] as const)program[key]={...program[key],path:path.resolve(path.dirname(m.footer.program.path),program[key].path)};await verifyNativeContentSource(program,'footer');
    const read=async(ref:{path:string;sha256:string},base?:string)=>({filename:path.resolve(base??ROOT,ref.path),bytes:await readNativeContentRef(ref,base)});
    await verifyResponsiveSections(m.footer.responsive,{taskId:m.taskId,sourceUrl:m.sourceUrl},read);
    const css=(await readNativeContentRef(m.footer.css)).toString('utf8'),responsive=prepareResponsiveBody(program,m.footer.responsive,css);
    const assets=await boundJSON(m.footer.assets);if(!Array.isArray(assets))throw Error('replica_full_public_assets');footer={program:responsive.program,css:responsive.css,assets};
  }
  await mkdir(path.join(directory,'operations'),{recursive:true});if(options.command==='run'){await writeFile(path.join(directory,'manifest.json'),JSON.stringify(m,null,2),{flag:'wx'});await atomic(statePath,state);}
  const lock=await acquireLock(ROOT);let connection:WordPressConnection|undefined,activeDriver:PublicResourceDriver|undefined;
  try{
    const {config,credentials}=await loadConfig(ROOT);if(new URL(config.targetUrl).origin!==m.targetOrigin)throw Error('replica_full_public_config_target');
    const credentialsOptions={targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password,networkRoute:config.wordpressNetworkRoute};connection=new WordPressConnection(credentialsOptions);
    const client=new WordPressClient({...credentialsOptions,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES},connection),transport=new WoodMartHeaderTransport(credentialsOptions,connection),driver=new PublicResourceDriver(transport,{targetOrigin:m.targetOrigin,runId:m.runId,contractHash:manifestHash});
    activeDriver=driver;
    let current=await driver.inspect();state.snapshot=current;
    if(state.pending){if(options.command!=='reconcile')throw Error('replica_full_public_reconcile_required');const receipt=current.snapshot.receipts[state.pending.operationId];if(receipt?.state==='complete'&&receipt.payloadHash===state.pending.payloadHash||!receipt&&current.hash===state.pending.beforeHash){state.pending=null;state.status='building';delete state.error;}await atomic(statePath,state);return delivery();}
    if(state.headerPending&&options.command!=='reconcile')throw Error('replica_full_public_header_reconcile_required');
    if(options.command==='reconcile'){if(m.header){const bundle=await loadHeaderBundle(m.header.bundleDirectory);if(bundle.state.pending){const result=await reconcileHeaderModule(m.header.bundleDirectory,new FullReplicaHeaderModuleDriver(transport,client));state.headerPending=result.status==='conflict';state.status=state.headerPending?'write-unknown':'building';}}await atomic(statePath,state);return delivery();}
    const mutate=async(action:PublicAction,payload:Record<string,unknown>,compiled?:Parameters<PublicResourceDriver['mutate']>[4],schemas?:Parameters<PublicResourceDriver['mutate']>[5])=>{
      const operationId=randomUUID(),intent={operationId,action,beforeHash:current.hash,payloadHash:publicPayloadHash(payload)};state.pending=intent;await atomic(statePath,state);const proof=path.join(directory,'operations',operationId+'.json'),bytes=JSON.stringify({manifestHash,intent,payload});await writeFile(proof,bytes,{flag:'wx'});
      current=await driver.mutate(action,payload,current,{operationId,runId:m.runId,resource:`public-resources/${m.runId}`,expectedSnapshotSha256:current.hash,persistedIntentSha256:createHash('sha256').update(bytes).digest('hex')},compiled,schemas);state.snapshot=current;state.pending=null;await atomic(statePath,state);
    };
    let headerDriver:FullReplicaHeaderModuleDriver|undefined,headerBundle:Awaited<ReturnType<typeof loadHeaderBundle>>|undefined;
    if(m.header){const plan=validateHeaderModulePlan(m.header.plan);await checkedDirectory(path.dirname(m.header.bundleDirectory),true);try{headerBundle=await loadHeaderBundle(m.header.bundleDirectory);if(fullReplicaHash(headerBundle.plan)!==fullReplicaHash(plan))throw Error('replica_full_public_header_changed');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;headerBundle=await createHeaderBundle(m.header.bundleDirectory,plan,m.header.mediaIds??{});}
      headerDriver=new FullReplicaHeaderModuleDriver(transport,client);const results=await provisionHeaderModule(m.header.bundleDirectory,headerDriver);if(results.some(r=>r.status==='write-unknown'))throw Error('replica_full_public_header_unknown');
      const headerObserved=await headerDriver.inspect(headerBundle.state.identity,m.header.mediaIds??{});state.header={headerId:headerBundle.state.identity.headerId,name:headerObserved.snapshot.module?.name,menus:headerObserved.snapshot.module?.menus,style:headerObserved.snapshot.module?.style,editUrl:m.targetOrigin+'/wp-admin/admin.php?page=xts_header_builder#/builder/'+headerBundle.state.identity.headerId};
      state.headerProtection??=publicHeaderProtection(headerObserved.snapshot);if(state.headerProtection!==publicHeaderProtection(headerObserved.snapshot))throw Error('replica_full_public_header_resources_changed');await atomic(statePath,state);
      if(!current.snapshot.preview){let inspected=headerObserved,pages=Object.values(inspected.snapshot.module?.pages??{});if(!pages.length){const created=await createHeaderModulePage(m.header.bundleDirectory,headerDriver,m.preview);if(created.status==='write-unknown')throw Error('replica_full_public_header_unknown');inspected=await headerDriver.inspect(headerBundle.state.identity,m.header.mediaIds??{});pages=Object.values(inspected.snapshot.module?.pages??{});}if(pages.length!==1)throw Error('replica_full_public_header_preview_ambiguous');await mutate('adopt-preview',{pageId:pages[0].pageId,headerIdentity:headerBundle.state.identity});}
    }else if(!current.snapshot.preview)await mutate('create-preview',m.preview);
    if(footer&&m.footer){
      if(!current.snapshot.footer)await mutate('create-footer',{title:m.title,slug:m.preview.slug+'-footer'});
      const imported=await importNative44Media({client,root:ROOT,runDir:directory,jobDir:path.dirname(m.footer.assets.path),runId:m.runId,pageId:current.snapshot.preview!.id,manifest:footer.assets,required:[...referencedNative44Assets(footer.program)]});
      const types=usedNative44WidgetTypes(footer.program),capabilities=await client.discoverCapabilities(types),target=await assertResponsiveTarget(transport,m.footer.responsive.mobileMaxWidth),schemas=certifyResponsiveSchemas(capabilities.legacySchemas,target),knowledge=await loadNative44Knowledge(types);
      const compiled=compileResponsiveBody(footer.program,{schemas,assets:imported,targetOrigin:m.targetOrigin,knowledge:toNative44CompilerKnowledge(knowledge,schemas)},footer.css,m.footer.responsive.mobileMaxWidth),elements=compileEditorElements(compiled.composition.elements,schemas,{executionStrategy:'native44-css-handoff'}),css=compileFullPageCSS(footer.css,current.snapshot.footer!.id,imported,m.runId),settings={custom_css:css};
      if(!current.snapshot.footer!.elements.length)await mutate('save-footer',{elements,settings},compiled,schemas);
      else if(publicPayloadHash(current.snapshot.footer!.elements)!==publicPayloadHash(elements)||current.snapshot.footer!.settings.custom_css!==css)throw Error('replica_full_public_saved_footer_changed');
      if(!current.snapshot.preview!.content)await mutate('save-preview',{});else if(current.snapshot.preview!.content!==`[html_block id="${current.snapshot.footer!.id}"]`)throw Error('replica_full_public_preview_changed');
    }
    if(m.header&&headerDriver&&headerBundle){const observed=await headerDriver.inspect(headerBundle.state.identity,m.header.mediaIds??{});if(publicHeaderProtection(observed.snapshot)!==state.headerProtection)throw Error('replica_full_public_header_resources_changed');await checkpointHeaderModule(m.header.bundleDirectory,headerDriver,observed.hash);const bound=await bindHeaderModulePage(m.header.bundleDirectory,headerDriver,current.snapshot.preview!.id);if(bound.status==='write-unknown')throw Error('replica_full_public_header_unknown');}
    state.snapshot=await driver.inspect();state.status='draft-for-user-review';delete state.error;await atomic(statePath,state);return delivery();
  }catch(error){if(m.header)try{state.headerPending=!!(await loadHeaderBundle(m.header.bundleDirectory)).state.pending;}catch{}state.status=state.pending||state.headerPending?'write-unknown':'building';state.error=error instanceof Error&&/^(replica_|woodmart_|native44_)[a-z0-9_:-]+$/.test(error.message)?error.message:'replica_full_public_failed';if(activeDriver)try{state.snapshot=await activeDriver.inspect();}catch{}await atomic(statePath,state);throw error;}
  finally{await connection?.close();await lock();}
}

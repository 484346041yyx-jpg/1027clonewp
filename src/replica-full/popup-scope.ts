import path from 'node:path';
import { readFile,mkdir,writeFile,statfs } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import sharp from 'sharp';
import * as csstree from 'css-tree';
import { loadConfig } from '../core/config.js';
import { acquireLock,writeJson } from '../core/files.js';
import { localPath,hash } from '../workspace/files.js';
import { remoteResource } from '../workspace/operation-resources.js';
import { assertWorkspaceAccess } from '../workspace/service.js';
import { WordPressConnection } from '../wordpress/connection.js';
import { WordPressClient } from '../wordpress/client.js';
import { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { assertNative44Compilation } from '../native44/compiler.js';
import { NATIVE44_ALL_TYPES } from '../native44/catalog.js';
import { popupManifestSchema,type PopupManifest } from './popup-contract.js';
import { compilePopupNative,POPUP_TYPES } from './popup-native.js';
import { publicPayloadHash } from './public-driver.js';

const ROOT='D:/cloneWP';
async function bound(ref:{path:string;sha256:string}){const rel=path.relative(ROOT,path.resolve(ref.path)).replaceAll('\\','/'),p=await localPath(ROOT,rel),b=await readFile(p);if(hash(b)!==ref.sha256)throw Error('replica_full_popup_evidence_changed');return b;}
export function assertPopupScopedCSS(css:string,id:number,urls:string[]){
  if(css.length>60000)throw Error('replica_full_popup_css_size');const ast=csstree.parse(css);
  csstree.walk(ast,node=>{
    if(node.type==='Atrule'&&!['font-face','media'].includes(node.name))throw Error('replica_full_popup_css_atrule');
    if(node.type==='Atrule'&&node.name==='font-face'&&node.block){csstree.walk(node.block,n=>{if(n.type==='Declaration'&&n.property==='font-family'&&csstree.generate(n.value)!=='CloneWPPopupPoppins')throw Error('replica_full_popup_font_scope');});}
    if(node.type==='Url'&&!urls.includes(node.value))throw Error('replica_full_popup_css_url');
    if(node.type==='Selector'){const s=csstree.generate(node);if(![`#popup-${id}`,`.mfp-bg.wd-mfp-popup-bg-${id}`,`.wd-popup-wrap:has(#popup-${id})`].some(prefix=>s===prefix||s.startsWith(prefix+' ')||s.startsWith(prefix+'>')))throw Error('replica_full_popup_css_scope');if(/[+~]/.test(s))throw Error('replica_full_popup_css_sibling');}
  });
}
export async function runPopupReplica(input:unknown,options:{command:'run'|'status'|'reconcile'|'activate'|'style'|'behavior';runDirectory?:string;cssPath?:string;expectedHash?:string;planPath?:string}){
  const m=popupManifestSchema.parse(input),dir=await localPath(ROOT,`runs/${m.runId}`);
  if(options.runDirectory&&path.resolve(options.runDirectory)!==dir)throw Error('replica_full_popup_directory');
  const stateFile=path.join(dir,'state.json'),manifestHash=hash(JSON.stringify(m));let state:any;
  try{state=JSON.parse(await readFile(stateFile,'utf8'));if(state.manifestHash!==manifestHash)throw Error('replica_full_popup_contract_changed');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state={version:1,kind:'clonewp-popup-replica-run',taskId:m.taskId,runId:m.runId,manifestHash,status:'preparing',pending:null};}
  const delivery=()=>({status:state.status,scope:'popup-only',submission:{action:'save-to-database',testing:'user-managed',tested:false},resources:[state.current?.snapshot?.popup&&{name:state.current.snapshot.popup.title,id:state.current.snapshot.popup.id,type:'wd_popup',status:state.current.snapshot.popup.status,editUrl:`${m.targetOrigin}/wp-admin/post.php?post=${state.current.snapshot.popup.id}&action=elementor`},state.current?.snapshot?.preview&&{name:state.current.snapshot.preview.title,id:state.current.snapshot.preview.id,type:'page',status:state.current.snapshot.preview.status,editUrl:`${m.targetOrigin}/wp-admin/post.php?post=${state.current.snapshot.preview.id}&action=edit`,previewUrl:`${m.targetOrigin}/?page_id=${state.current.snapshot.preview.id}&preview=true`}].filter(Boolean),pending:state.pending,writeAttempts:state.writes??0});
  if(options.command==='status')return delivery();
  await assertWorkspaceAccess(ROOT);
  const disk=await statfs(ROOT);if(disk.bavail*disk.bsize<512*1024*1024)throw Error('replica_full_popup_disk_space');
  const source=JSON.parse((await bound(m.sourceEvidence)).toString()),screenshot=await bound(m.sourceScreenshot);const raster=await sharp(screenshot).metadata();
  if(source.kind!=='clonewp-popup-source'||source.sourceUrl!==m.sourceUrl||source.visualSource!=='user-provided-screenshot'||!raster.width||raster.width<1000||source.form?.targetAction!=='save-to-database'||source.form?.testing!=='user-managed')throw Error('replica_full_popup_source');
  await mkdir(dir,{recursive:true});await mkdir(path.join(dir,'operations'),{recursive:true});
  try{await writeFile(path.join(dir,'manifest.json'),JSON.stringify(m,null,2),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const prior=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));if(hash(JSON.stringify(prior))!==manifestHash)throw Error('replica_full_popup_manifest_changed');}
  await writeJson(stateFile,state);
  const config=await loadConfig(ROOT);if(new URL(config.config.targetUrl).origin!==m.targetOrigin)throw Error('replica_full_popup_target');
  const o={targetUrl:config.config.targetUrl,username:config.credentials.wp_user,applicationPassword:config.credentials.wp_app_password,networkRoute:config.config.wordpressNetworkRoute};const connection=new WordPressConnection(o),transport=new WoodMartHeaderTransport(o,connection),client=new WordPressClient({...o,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES},connection);
  const php=await readFile(new URL('./popup-driver.php',import.meta.url),'utf8');
  const code=(data:any)=>{
    // Media is already base64. Encoding it a second time needlessly exceeds the reviewed helper budget.
    const media=data.action==='asset'?data.payload?.bytes:undefined;
    if(media!==undefined&&(typeof media!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(media)))throw Error('replica_full_popup_media_encoding');
    const clean=media===undefined?data:{...data,payload:{...data.payload,bytes:undefined}};
    return `$input=json_decode(base64_decode('${Buffer.from(JSON.stringify({targetOrigin:m.targetOrigin,runId:m.runId,contractHash:manifestHash,...clean})).toString('base64')}'),true);\n${media===undefined?'':`$input['payload']['bytes']='${media}';\n`}${php}`;
  };
  const unwrap=(r:any)=>{if(!r?.ok||!r.value?.snapshot||!r.value?.hash)throw Error('replica_full_'+(/^popup_[a-z0-9_]+$/.test(r?.code)?r.code:'popup_response'));return r.value;};
  const inspect=async()=>unwrap(await transport.readPHP({name:'popup.inspect',trustedLocalCode:true,code:code({action:'inspect'})}));
  const mutate=async(action:string,payload:any,proof?:ReturnType<typeof compilePopupNative> extends Promise<infer T>?T:never)=>{
    const keys=[`local:runs/${m.runId}`,state.current?.snapshot?.popup?remoteResource(m.targetOrigin,'post',state.current.snapshot.popup.id):remoteResource(m.targetOrigin,'create',`popup-${m.runId}`)];
    if(state.current?.snapshot?.preview)keys.push(remoteResource(m.targetOrigin,'post',state.current.snapshot.preview.id));
    const unlock=await acquireLock(ROOT,keys);
    try{
      const fresh=await inspect();if(fresh.hash!==state.current.hash)throw Error('replica_full_popup_cas_conflict');
      if(action==='save'){if(!proof)throw Error('replica_full_popup_compiler_required');assertNative44Compilation(proof.compilation,proof.compilation.composition);if(hash(JSON.stringify(payload.elements))!==hash(JSON.stringify(proof.elements)))throw Error('replica_full_popup_compilation_changed');}
      const operationId=randomUUID(),record={operationId,action,beforeHash:fresh.hash,payloadHash:hash(JSON.stringify(payload)),payload};
      const intent=path.join(dir,'operations',operationId+'.json');await writeFile(intent,JSON.stringify(record),{flag:'wx'});state.pending={operationId,action,beforeHash:fresh.hash};await writeJson(stateFile,state);
      state.writes=(state.writes??0)+1;const observed=unwrap(await transport.executePHP({name:'popup.'+action,trustedLocalCode:true,code:code({action,payload,operationId,expectedHash:fresh.hash}),intent:{runId:m.runId,operationId,resource:`popup/${m.runId}`,expectedSnapshotSha256:fresh.hash,persistedIntentSha256:hash(await readFile(intent))}}));
      if(observed.snapshot.receipts?.[operationId]?.state!=='complete')throw Error('replica_full_popup_receipt');state.current=observed;state.pending=null;await writeJson(stateFile,state);
    }finally{await unlock();}
  };
  try{
    const current=await inspect();
    if(state.pending){const receipt=current.snapshot.receipts?.[state.pending.operationId];
      const without=structuredClone(current.snapshot);if(without.receipts)delete without.receipts[state.pending.operationId];
      if(options.command==='reconcile'&&receipt?.state==='started'&&publicPayloadHash(without)===publicPayloadHash(state.current.snapshot)){
        const pending=state.pending;state.current=current;await mutate('reconcile-before',{operationId:pending.operationId,expectedBeforeHash:pending.beforeHash});state.status='preparing';await writeJson(stateFile,state);
      }else if(receipt?.state==='complete'||!receipt&&current.hash===state.pending.beforeHash){await writeFile(path.join(dir,'operations',state.pending.operationId+'-reconciled.json'),JSON.stringify({observedHash:current.hash,receipt:receipt??null,decision:receipt?'confirmed-after':'confirmed-before',observedAt:new Date().toISOString()}),{flag:'wx'});state.current=current;state.pending=null;state.status='preparing';await writeJson(stateFile,state);}else{state.status='write-unknown';state.current=current;await writeJson(stateFile,state);return delivery();}}
    else if(state.current&&state.current.hash!==current.hash)throw Error('replica_full_popup_remote_changed');else state.current=current;
    if(options.command==='reconcile'){await writeJson(stateFile,state);return delivery();}
    if(options.command==='behavior'){
      if(options.expectedHash!==state.current.hash||!options.planPath)throw Error('replica_full_popup_behavior_cas');
      const p=await localPath(ROOT,path.relative(ROOT,path.resolve(options.planPath)).replaceAll('\\','/')),plan=JSON.parse(await readFile(p,'utf8'));
      if(plan.kind!=='clonewp-popup-close-policy'||!['0','1'].includes(plan.persistentClose))throw Error('replica_full_popup_behavior_plan');
      await mutate('behavior',{wd_popup_persistent_close:plan.persistentClose});state.status='awaiting-review';await writeJson(stateFile,state);return delivery();
    }
    if(options.command==='style'){
      if(options.expectedHash!==state.current.hash||!options.cssPath)throw Error('replica_full_popup_style_cas');
      const file=await localPath(ROOT,path.relative(ROOT,path.resolve(options.cssPath)).replaceAll('\\','/')),css=await readFile(file,'utf8');assertPopupScopedCSS(css,state.current.snapshot.popup.id,Object.values(state.current.snapshot.assets).map((a:any)=>a.url));
      await mutate('style',{css});state.status='awaiting-review';await writeJson(stateFile,state);return delivery();
    }
    if(options.command==='activate'){
      const review=JSON.parse(await readFile(path.join(dir,'review.json'),'utf8'));if(review.decision!=='approved'||review.snapshotHash!==state.current.hash||review.nativeEditorVerified!==true||!['desktop','desktop-small','phone','phone-small','close','escape','overlay','repeat','email-config'].every(k=>review.checks?.[k]===true))throw Error('replica_full_popup_review_required');
      await mutate('activate',{});state.status='published';await writeJson(stateFile,state);return delivery();
    }
    if(!state.current.snapshot.popup)await mutate('create-popup',{title:m.title});
    for(const[key,ref,mime,name]of [['pouch',m.assets.image,'image/webp','tomtoc-popup-pouch.webp'],['regular-font',m.assets.regularFont,'font/woff2','tomtoc-popup-poppins-400.woff2'],['semibold-font',m.assets.semiboldFont,'font/woff2','tomtoc-popup-poppins-600.woff2']]as const){
      const bytes=await bound(ref);if(key==='pouch'){const meta=await sharp(bytes,{animated:true}).metadata();if(meta.format!=='webp'||!meta.pages||meta.pages<2)throw Error('replica_full_popup_animation_missing');}
      const existing=state.current.snapshot.assets?.[key];if(existing){if(existing.sha256!==ref.sha256)throw Error('replica_full_popup_asset_changed');continue;}
      await mutate('asset',{key,mime,name,sha256:hash(bytes),bytes:bytes.toString('base64')});
    }
    if(!state.current.snapshot.popup.elements.length){
      const caps=await client.discoverCapabilities(POPUP_TYPES),assets=Object.values(state.current.snapshot.assets)as any[],registration=path.join(dir,'registered-capabilities.json');await writeJson(registration,caps);
      const native=await compilePopupNative(m,caps.legacySchemas,assets,state.current.snapshot.popup.id,registration);
      const authored=path.join(dir,'authored',randomUUID());await mkdir(authored,{recursive:true});await writeFile(path.join(authored,'native-program.json'),JSON.stringify(native.program,null,2),{flag:'wx'});await writeFile(path.join(authored,'native-elements.json'),JSON.stringify(native.elements,null,2),{flag:'wx'});await writeFile(path.join(authored,'page-custom.css'),native.css,{flag:'wx'});state.authored=authored;await writeJson(stateFile,state);
      await mutate('save',{elements:native.elements,settings:native.settings},native);
    }
    if(!state.current.snapshot.preview)await mutate('create-preview',{title:m.title+' — Preview'});
    if(state.current.snapshot.popup.status==='draft')await mutate('preview',{});
    state.status='awaiting-review';await writeJson(stateFile,state);return delivery();
  }catch(e){state.error=e instanceof Error?e.message:'replica_full_popup_failed';state.status=state.pending?'write-unknown':'blocked';await writeJson(stateFile,state);return {...delivery(),error:state.error};}finally{await connection.close();}
}

import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,statfs } from 'node:fs/promises';
import { loadConfig } from '../src/core/config.js';
import { WoodMartHeaderTransport } from '../src/woodmart-header/transport.js';
const root='D:/cloneWP';const dir=root+'/.cache/header-test';await mkdir(dir,{recursive:true});
const action=process.argv[2]??'read';const inputPath=process.argv[3];
const base={runId:'furry_header_20261018',headerId:'header_193941',backupId:'header_786410'};
const extra=inputPath?JSON.parse(await readFile(inputPath,'utf8')):{};const input={...extra,...base,action};
const code='$input=json_decode(base64_decode(\''+Buffer.from(JSON.stringify(input)).toString('base64')+'\'),true);\n'+await readFile(root+'/src/woodmart-header/operations.php','utf8');
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const {config,credentials}=await loadConfig(root);const t=new WoodMartHeaderTransport({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password});
try {
  let result:any;
  if(action==='read')result=await t.readPHP({name:'whb.read-state',code,trustedLocalCode:true});
  else {
    const disk=await statfs(root);if(disk.bavail*disk.bsize<512*1024*1024)throw new Error('insufficient_evidence_space');
    if(!input.expectedStateHash)throw new Error('expected_state_missing');
    const intent={...input,codeHash:sha(code),createdAt:new Date().toISOString(),finalDeliveryPolicy:'publish',preserveComponentPageId:15769,preserveMenuIds:[48,47,49,50,349],viewports:[{width:1920,height:1080},{width:1440,height:1000}]};
    const json=JSON.stringify(intent,null,2);const file=dir+'/intent-'+action+'-'+Date.now()+'.json';await writeFile(file,json,{flag:'wx'});
    result=await t.executePHP({name:'whb.'+action,code,trustedLocalCode:true,intent:{runId:base.runId,operationId:action+'-'+Date.now(),resource:'header/'+base.headerId,expectedSnapshotSha256:input.expectedStateHash,persistedIntentSha256:sha(json)}});
  }
  const file=dir+'/'+action+'-'+Date.now()+'.json';await writeFile(file,JSON.stringify(result,null,2));
  const state=result.state??result;await writeFile(dir+'/current.json',JSON.stringify({state,stateHash:result.stateHash??null},null,2));
  console.log(JSON.stringify({file,stateHash:result.stateHash,mainHeader:state.mainHeader,themeHeader:state.themeHeader,pointerPaths:state.headerPointerPaths,protected:state.protected,themeOptionsHash:state.themeOptionsHash,themeOptionsExceptHeaderPointersHash:state.themeOptionsExceptHeaderPointersHash,page:state.page,menu:state.menu?{id:state.menu.id,count:state.menu.items.length}:null,protectionUnchanged:result.protectionUnchanged,diagnostics:t.diagnostics()},null,2));
} catch(error) {
  await writeFile(dir+'/unconfirmed-'+action+'-'+Date.now()+'.json',JSON.stringify({action,runId:base.runId,status:'unconfirmed',code:(error as {code?:string}).code??'local_or_remote_failure',diagnostics:t.diagnostics()},null,2));
  throw error;
} finally {await t.close();}

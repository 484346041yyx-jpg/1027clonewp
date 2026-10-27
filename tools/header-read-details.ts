import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/core/config.js';
import { WoodMartHeaderTransport } from '../src/woodmart-header/transport.js';
const root='D:/cloneWP';const {config,credentials}=await loadConfig(root);
const t=new WoodMartHeaderTransport({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password});
try {const result=await t.readPHP<any>({name:'whb.inspect-live-implementation',code:await readFile(root+'/src/woodmart-header/target-details.php','utf8'),trustedLocalCode:true});await mkdir(root+'/.cache/header-test',{recursive:true});await writeFile(root+'/.cache/header-test/details.json',JSON.stringify(result,null,2));const {classes,elementFiles,...summary}=result;console.log(JSON.stringify({...summary,classes:Object.fromEntries(Object.entries<any>(classes).map(([k,v])=>[k,{class:v.class,methods:v.methods}])),elementFiles:Object.keys(elementFiles)},null,2));} finally {await t.close();}

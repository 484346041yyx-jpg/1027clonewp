import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/core/config.js';
import { WoodMartHeaderTransport } from '../src/woodmart-header/transport.js';
import { inspectHeaderPHP } from '../src/woodmart-header/inspection.js';
const root='D:/cloneWP';
const {config,credentials}=await loadConfig(root);
const t=new WoodMartHeaderTransport({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password});
try {
  const result=await t.readPHP<Record<string,unknown>>({name:'whb.inspect-installation',code:inspectHeaderPHP,trustedLocalCode:true});
  const dir=root+'/.cache/header-test';await mkdir(dir,{recursive:true});
  await writeFile(dir+'/inspection.json',JSON.stringify(result,null,2));
  const {sourceFiles,...summary}=result;console.log(JSON.stringify(summary,null,2));
  console.log(JSON.stringify({sourceFiles:Object.keys(sourceFiles as object),diagnostics:t.diagnostics()}));
} finally {await t.close();}

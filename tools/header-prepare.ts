import {readFile,writeFile} from 'node:fs/promises';
import {validateHeaderMenuItems,validateHeaderPlan,assertHeaderIsolation} from '../src/woodmart-header/contract.js';
import {buildFurryHeader} from '../src/woodmart-header/layout.js';
import {furryHeaderPageCSS,furryHeaderTestBody,furryHeaderTestElements} from '../src/woodmart-header/presentation.js';
const dir='D:/cloneWP/.cache/header-test';const action=process.argv[2];const current=JSON.parse(await readFile(dir+'/current.json','utf8'));const s=current.state;
const plan=validateHeaderPlan({version:1,targetOrigin:'https://primevapeoutlet.com',explicitHeaderId:'header_193941',expectedDefaultHeaderId:s.mainHeader,menuName:'test',owner:{ownerId:'clonewp',runId:'furry_header_20261018'},preservedComponentPageIds:[15769],preservedMenuIds:[48,47,49,50,349],tree:{key:'root',type:'root',children:[{key:'main',type:'row',children:[{key:'left',type:'column',children:[{key:'logo',type:'logo',children:[]}]},{key:'middle',type:'column',children:[{key:'nav',type:'main-menu',children:[]}]},{key:'right',type:'column',children:[{key:'account',type:'account',children:[]},{key:'cart',type:'cart',children:[]}]}]}]}});
assertHeaderIsolation(plan,{targetOrigin:plan.targetOrigin,headerId:plan.explicitHeaderId,defaultHeaderId:s.mainHeader,coverage:{explicitReferences:'complete',presets:'complete',cssJs:'complete'},explicitReferences:s.otherExplicitReferences.map((r:any)=>({kind:'other',id:String(r.post_id)})),presetReferences:s.themeTestReferences,cssJsReferences:[]});
let request:any={expectedStateHash:current.stateHash};
if(action==='create'){
  const source=JSON.parse(await readFile(dir+'/source-menu.json','utf8'));const items=source.flatMap((i:any)=>[{key:i.key,title:i.title,url:i.url,parentKey:null},...i.children.map((c:any)=>({...c,parentKey:i.key}))]);
  request={...request,slug:'furrys-kitchen-woodmart-header-test',body:furryHeaderTestBody,items:validateHeaderMenuItems(items,plan.targetOrigin)};
}else if(action==='save'){
  if(!s.page||!s.menu||s.menu.slug!=='test')throw new Error('test_resources_missing');
  const raw=buildFurryHeader(s.header,{menuId:s.menu.id,menuSlug:s.menu.slug,logo:{id:15771,url:'https://primevapeoutlet.com/wp-content/uploads/2026/10/header-logo.png',width:300,height:84}});
  request={...request,raw,body:furryHeaderTestBody,css:furryHeaderPageCSS(s.page.id),elements:furryHeaderTestElements()};
}else if(action!=='publish')throw new Error('unknown_prepare_action');
await writeFile(dir+'/'+action+'-request.json',JSON.stringify(request,null,2));console.log({action,expectedStateHash:current.stateHash,pageId:s.page?.id,menuId:s.menu?.id,menuItemCount:request.items?.length});

import {z} from 'zod';
import type {HeaderBundle} from './bundle.js';
import type {HeaderRemoteSnapshot} from './wordpress.js';
import {walkNative44} from '../../native44/types.js';

// DOMRect.toJSON also supplies top/right/bottom/left; normalize to the four measured fields.
const rect=z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().positive(),height:z.number().positive()});
const link=z.object({text:z.string(),url:z.string().url()}).strict();
const planSchema=z.object({key:z.string().min(1),url:z.string().url(),headerId:z.string().regex(/^header_[A-Za-z0-9_-]+$/),blockId:z.number().int().positive(),viewport:z.object({width:z.number().int().min(769).max(3840),height:z.number().int().min(400).max(2160)}).strict(),trigger:z.string().min(1),panel:z.string().min(1),event:z.enum(['hover','click']),links:z.array(link).min(1),imageIds:z.array(z.number().int().positive()),timeoutMs:z.number().int().min(100).max(10000).default(5000)}).strict();
export type HeaderMenuReviewPlan=z.infer<typeof planSchema>;
export interface HeaderMenuObservation{url:string;headerId:string;blockId:number;viewport:{width:number;height:number};revision:string;hovered:boolean;visible:boolean;opacity:number;box:{x:number;y:number;width:number;height:number};links:Array<{text:string;url:string}>;images:Array<{id:number;loaded:boolean;box:{x:number;y:number;width:number;height:number}}>}
export interface HeaderMenuReviewPort{
  setViewport(viewport:HeaderMenuReviewPlan['viewport'],options:ReviewTimeout):Promise<void>;
  observe(plan:HeaderMenuReviewPlan,options:ReviewTimeout):Promise<HeaderMenuObservation>;
  hover?(selector:string,options:ReviewTimeout):Promise<void>;
  click?(selector:string,options:ReviewTimeout):Promise<void>;
  /** Wait for actual visibility, opacity=1, loaded images and two stable geometry samples. */
  waitForPanel(plan:HeaderMenuReviewPlan,options:ReviewTimeout):Promise<HeaderMenuObservation>;
  capture(plan:HeaderMenuReviewPlan,options:ReviewTimeout):Promise<{path:string;sha256:string}>;
  restore(options:ReviewTimeout):Promise<void>;
}
export interface ReviewTimeout{timeoutMs:number;signal:AbortSignal}
async function bounded<T>(timeoutMs:number,action:(options:ReviewTimeout)=>Promise<T>):Promise<T>{
 const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([action({timeoutMs,signal:abort.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('header_menu_review_step_timeout'));},timeoutMs);})]);}finally{if(timer)clearTimeout(timer);}
}
const text=(v:string)=>v.replace(/\s+/g,' ').trim();
function fail(code:string):never{throw Error('header_menu_review_'+code);}
function binding(plan:HeaderMenuReviewPlan,o:HeaderMenuObservation){if(o.url!==plan.url||o.headerId!==plan.headerId||o.blockId!==plan.blockId||o.viewport.width!==plan.viewport.width||o.viewport.height!==plan.viewport.height||!/^[a-f0-9]{64}$/.test(o.revision))fail('binding_changed');}
function opened(plan:HeaderMenuReviewPlan,o:HeaderMenuObservation){
 binding(plan,o);if(!o.visible||o.opacity!==1||plan.event==='hover'&&!o.hovered)fail('not_actually_open');
 const b=rect.parse(o.box);if(b.x< -1||b.y< -1||b.x+b.width>plan.viewport.width+1)fail('panel_outside_viewport');
 const expected=plan.links.map(l=>({...l,text:text(l.text)}));
 for(const l of expected)if(!o.links.some(a=>text(a.text)===l.text&&a.url===l.url))fail('link_missing');
 if(o.links.some(a=>!expected.some(e=>e.url===a.url)))fail('unexpected_link');
 if(o.images.length!==plan.imageIds.length||[...o.images.map(i=>i.id)].sort().join(',')!==[...plan.imageIds].sort().join(','))fail('image_binding_changed');
 for(const image of o.images){const box=rect.parse(image.box);if(!image.loaded||box.x< -1||box.x+box.width>plan.viewport.width+1)fail('image_not_ready');}
}
/** Fixed bounded sequence. Missing hover support never falls back to context menus, drag or synthetic DOM events. */
export async function captureHeaderMenuReview(input:unknown,port:HeaderMenuReviewPort){
 const plan=planSchema.parse(input);const u=new URL(plan.url);if(u.username||u.password||u.search||u.hash)fail('public_url_required');
 const open=plan.event==='hover'?port.hover:port.click;
 if(!open)return{status:'unsupported' as const,key:plan.key,reason:plan.event+'_input_unavailable',captures:0,needsVisualReview:true as const};
 let changed=false;
 const deadline=Date.now()+18000,step=<T>(action:(options:ReviewTimeout)=>Promise<T>)=>bounded(Math.max(1,Math.min(plan.timeoutMs,deadline-Date.now())),action);
 try{
  changed=true;await step(o=>port.setViewport(plan.viewport,o));
  const before=await step(o=>port.observe(plan,o));binding(plan,before);
  await step(o=>open.call(port,plan.trigger,o));
  const ready=await step(o=>port.waitForPanel(plan,o));opened(plan,ready);
  if(before.revision!==ready.revision)fail('document_changed');
  const screenshot=await step(o=>port.capture(plan,o));if(!/^[a-f0-9]{64}$/.test(screenshot.sha256)||!screenshot.path)fail('capture_missing');
  const after=await step(o=>port.observe(plan,o));opened(plan,after);
  if(after.revision!==ready.revision||JSON.stringify(after.box)!==JSON.stringify(ready.box))fail('capture_state_changed');
  return{status:'captured' as const,key:plan.key,viewport:plan.viewport,screenshot,revision:ready.revision,captures:1,needsVisualReview:true as const};
 }finally{if(changed)await bounded(Math.min(1000,plan.timeoutMs),o=>port.restore(o));}
}

/** A local schedule, not fresh target evidence or a declaration of visual success. */
export function headerMenuReviewPlans(bundle:HeaderBundle,publicUrl:string):HeaderMenuReviewPlan[]{
 const url=new URL(publicUrl);if(url.origin!==bundle.plan.targetOrigin||url.username||url.password||url.search||url.hash)fail('public_url_required');
 const snapshot=bundle.state.confirmed?.snapshot as HeaderRemoteSnapshot|undefined,module=snapshot?.module;
 if(!module||bundle.state.pending)fail('confirmed_module_required');
 const pages=Object.values(module.pages);if(pages.length!==1)fail('single_owned_page_required');
 const page=pages[0];if(page.headerId!==bundle.state.identity.headerId||page.runId!==bundle.plan.owner.runId)fail('page_not_bound');
 const plans:HeaderMenuReviewPlan[]=[];
 for(const content of bundle.plan.menuContent?.filter(c=>c.version===2)??[]){
  const item=module.menus[content.menuKey]?.items.find(i=>i.key===content.itemKey),block=module.menuContent?.[content.key];if(!item||!block||item.content?.blockId!==block.id)fail('content_not_bound');
  const links:HeaderMenuReviewPlan['links']=[],imageIds:number[]=[];
  for(const n of walkNative44(content.program.blocks)){
   if(n.kind==='native-products')fail('product_review_adapter_required');if(n.kind!=='native')continue;const s=n.widgetSettings;
   const add=(t:unknown,l:unknown)=>{if(typeof t==='string'&&l&&typeof l==='object'&&typeof(l as any).url==='string'&&(l as any).url)links.push({text:text(t),url:(l as any).url});};
   add(s.title_text??s.title??s.text,s.link);
   if(n.widgetType==='wd_image_or_svg')add('',s.link);
   for(const row of Array.isArray(s.list_items)?s.list_items:[])add(row.list_content,row.link);
   if(['image-box','wd_image_or_svg'].includes(n.widgetType)){const key=(s.image as any)?.$asset,id=bundle.mediaIds[key];if(!Number.isSafeInteger(id)||id<1)fail('media_not_bound');imageIds.push(id);}
  }
  const base=`.whb-${bundle.state.identity.headerId} #menu-item-${item.id}`;
  for(const viewport of content.program.viewports)plans.push(planSchema.parse({key:content.key+'-'+viewport.width,url:url.href,headerId:bundle.state.identity.headerId,blockId:block.id,viewport:{width:viewport.width,height:viewport.height},trigger:base+'>a',panel:base+'>.wd-dropdown-menu',event:content.dropdown!.event,links,imageIds}));
 }
 return plans;
}

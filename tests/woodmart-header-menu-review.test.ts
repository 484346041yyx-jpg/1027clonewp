import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {captureHeaderMenuReview,headerMenuReviewPlans,type HeaderMenuReviewPlan,type HeaderMenuObservation,type HeaderMenuReviewPort} from '../src/woodmart-header/generic/menu-review.js';

const plan:HeaderMenuReviewPlan={key:'catalog-wide',url:'https://menu-fixture.example/',headerId:'header_123',blockId:42,viewport:{width:1440,height:900},trigger:'#nav>a',panel:'#panel',event:'hover',links:[{text:'One',url:'https://source.example/one/'}],imageIds:[77],timeoutMs:3000};
function observation():HeaderMenuObservation{return{url:plan.url,headerId:plan.headerId,blockId:42,viewport:plan.viewport,revision:'a'.repeat(64),hovered:true,visible:true,opacity:1,box:{x:0,y:80,width:1440,height:400},links:plan.links,images:[{id:77,loaded:true,box:{x:40,y:100,width:150,height:190}}]};}
test('missing real hover support stops before all UI input instead of trying context menus or drag',async()=>{
 const touched=()=>{throw Error('No UI calls expected');};
 const result=await captureHeaderMenuReview(plan,{setViewport:touched,observe:touched,waitForPanel:touched,capture:touched,restore:touched});assert.equal(result.status,'unsupported');assert.equal(result.captures,0);
});
test('one fixed sequence captures once, restores viewport and keeps the visual judgment explicit',async()=>{
 const calls:string[]=[],port:HeaderMenuReviewPort={async setViewport(){calls.push('viewport');},async observe(){calls.push('observe');return observation();},async hover(){calls.push('hover');},async waitForPanel(){calls.push('ready');return observation();},async capture(){calls.push('capture');return{path:'result.png',sha256:'b'.repeat(64)};},async restore(){calls.push('restore');}};
 const result=await captureHeaderMenuReview(plan,port);assert.equal(result.status,'captured');assert.equal(result.needsVisualReview,true);assert.deepEqual(calls,['viewport','observe','hover','ready','capture','observe','restore']);
});
test('wrong links, missing images, hidden panels, overflow and stale capture identity fail without another input attempt',async()=>{
 for(const edit of [(o:HeaderMenuObservation)=>o.links=[],(o:HeaderMenuObservation)=>o.images[0].loaded=false,(o:HeaderMenuObservation)=>o.visible=false,(o:HeaderMenuObservation)=>o.opacity=0,(o:HeaderMenuObservation)=>o.box.x=100,(o:HeaderMenuObservation)=>o.revision='c'.repeat(64)]){
  let hovered=0,captured=0,restored=0;await assert.rejects(captureHeaderMenuReview(plan,{async setViewport(){},async observe(){return observation();},async hover(){hovered++;},async waitForPanel(){const o=observation();edit(o);return o;},async capture(){captured++;return{path:'x.png',sha256:'a'.repeat(64)};},async restore(){restored++;}}),/header_menu_review_/);assert.equal(hovered,1);assert.equal(captured,0);assert.equal(restored,1);
 }
});
test('a hung adapter has a bounded deadline and restoration, never an unbounded retry loop',async()=>{
 let restored=0;const start=Date.now();await assert.rejects(captureHeaderMenuReview({...plan,timeoutMs:100},{async setViewport(){},async observe(){return observation();},async hover(){},async waitForPanel(){return new Promise(()=>{});},async capture(){throw Error('No capture');},async restore(){restored++;}}),/step_timeout/);assert.equal(restored,1);assert.ok(Date.now()-start<2000);
});
test('native CSS hover and delayed layout are observed through a real browser without link navigation',async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage();let captures=0;
 try{
  await page.route(plan.url,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}#nav{height:80px}#panel{position:absolute;top:80px;left:0;width:100vw;height:400px;visibility:hidden;opacity:0;transition:opacity .1s}#nav:hover #panel{visibility:visible;opacity:1}img{width:150px;height:190px}</style><header data-header="header_123"><div id="nav"><a href="https://source.example/">Catalog</a><div id="panel" data-elementor-id="42"><a href="https://source.example/one/">One</a><img class="wp-image-77" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div></div></header>`}));
  await page.goto(plan.url);
  await page.mouse.move(1000,700);
  const observe=async()=>{const o=await page.evaluate(()=>{const panel=document.querySelector('#panel')!,image=panel.querySelector('img')!;return{url:location.href,headerId:document.querySelector('header')!.getAttribute('data-header')!,blockId:42,viewport:{width:innerWidth,height:innerHeight},revision:panel.outerHTML,hovered:document.querySelector('#nav')!.matches(':hover'),visible:getComputedStyle(panel).visibility==='visible',opacity:Number(getComputedStyle(panel).opacity),box:panel.getBoundingClientRect().toJSON(),links:Array.from(panel.querySelectorAll('a')).map(a=>({text:a.textContent!,url:a.href})),images:[{id:77,loaded:image.complete&&image.naturalWidth>0,box:image.getBoundingClientRect().toJSON()}]};});return{...o,revision:createHash('sha256').update(o.revision).digest('hex')};};
  const result=await captureHeaderMenuReview(plan,{setViewport:async v=>{await page.setViewportSize(v);},observe,hover:async(selector,o)=>{await page.locator(selector).hover({timeout:o.timeoutMs});},waitForPanel:async(_p,o)=>{await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#panel')!).opacity)===1,{},{timeout:o.timeoutMs});const actual=await observe();assert.ok(actual.hovered&&actual.visible&&actual.opacity===1,JSON.stringify({hovered:actual.hovered,visible:actual.visible,opacity:actual.opacity}));return actual;},capture:async()=>{captures++;const bytes=await page.screenshot();return{path:'fixture.png',sha256:createHash('sha256').update(bytes).digest('hex')};},restore:async()=>{await page.mouse.move(0,700);}});
  assert.equal(result.status,'captured');assert.equal(captures,1);assert.equal(page.url(),plan.url);
 }finally{await browser.close();}
});
test('the local schedule uses stable owned IDs and frozen widths without authenticating or declaring acceptance',()=>{
 const bundle:any={
  plan:{targetOrigin:'https://menu-fixture.example',owner:{runId:'run'},menuContent:[{version:2,key:'catalog',menuKey:'main',itemKey:'catalog',dropdown:{event:'hover'},program:{viewports:[{width:1920,height:1080},{width:1440,height:1000}],blocks:[{kind:'native',key:'one',widgetType:'image-box',widgetSettings:{title_text:'One',link:{url:'https://source.example/one/'},image:{$asset:'photo'}}}]}}]},
  mediaIds:{photo:77},
  state:{pending:null,identity:{headerId:'header_123'},confirmed:{snapshot:{module:{
   pages:{9:{pageId:9,runId:'run',headerId:'header_123'}},
   menus:{main:{items:[{id:55,key:'catalog',content:{blockId:42}}]}},
   menuContent:{catalog:{id:42}}
  }}}}
 };
 const plans=headerMenuReviewPlans(bundle,plan.url);assert.deepEqual(plans.map(p=>p.viewport.width),[1920,1440]);assert.equal(plans[0].trigger,'.whb-header_123 #menu-item-55>a');assert.throws(()=>headerMenuReviewPlans(bundle,'https://foreign.example/'),/public_url/);
});

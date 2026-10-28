import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import path from 'node:path';
import {projectObservedPhoneCarousel} from '../src/replica-responsive/interaction-projection.js';

async function fixture(){
 const files=new Map<string,Buffer>();
 const put=(name:string,value:unknown)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));files.set(path.resolve('/evidence/'+name),bytes);return{path:path.resolve('/evidence/'+name),sha256:createHash('sha256').update(bytes).digest('hex')};};
 const shot=put('before.png',await sharp({create:{width:390,height:844,channels:3,background:'#fff'}}).png().toBuffer());
 const afterShot=put('after.png',await sharp({create:{width:390,height:844,channels:3,background:'#abc'}}).png().toBuffer());
 const viewport={name:'mobile-390',width:390,height:844,clientWidth:390,scrollbarWidth:0,devicePixelRatio:1},url='https://source.example/product';
 const defs=[{id:'owner',parentId:null,childIds:['track'],attributes:{}},{id:'track',parentId:'owner',childIds:[0,1,2,3].map(i=>'item'+i),attributes:{}},...[0,1,2,3].map(i=>({id:'item'+i,parentId:'track',childIds:[],attributes:{class:'swiper-slide','aria-label':`${i+1} / 4`}}))];
 const packet:any={version:2,kind:'observation-packet',snapshot:{id:'phone-390',url,title:'Product',capturedAt:'2026-10-28T00:00:00.000Z',viewport,pageHeight:844,screenshot:{...shot,width:390,height:844}},nodes:Object.fromEntries(defs.map(n=>[n.id,{...n,tag:'div',regionId:'body',selector:'#'+n.id,styleId:'style',layoutId:n.id,visible:true}])),regions:[{id:'body',nodeId:'owner',role:'region',order:0,contentNodeId:'owner',gapBefore:0}],texts:{},styles:{style:{}},layouts:Object.fromEntries(defs.map((n,i)=>[n.id,{id:n.id,rect:{x:i<2?0:(i-3)*100,y:0,width:i<2?200:100,height:100},contentRect:{x:0,y:0,width:200,height:100},padding:[0,0,0,0],margin:[0,0,0,0],gap:{row:0,column:0},display:'block',position:'static',maxWidth:'none',direction:'ltr',flowIndex:i}])),resources:{},usages:{},interactions:{carousel:{id:'carousel',nodeId:'owner',regionId:'body',kind:'carousel',status:'declared',trackNodeId:'track',itemNodeIds:[0,1,2,3].map(i=>'item'+i),cloneNodeIds:[],controlNodeIds:[],details:{engine:'swiper',behaviorVerified:false}}},gaps:[]};
 const state=(next:boolean)=>({url,observedAt:next?'2026-10-28T00:02:00.000Z':'2026-10-28T00:01:00.000Z',viewport,carousels:[{rect:{x:0,width:200},slides:[0,1,2,3].map(i=>({index:i,label:`${i+1} / 4`,class:'swiper-slide'+(i===(next?2:1)?' swiper-slide-active':''),rect:{x:(i-(next?2:1))*100,width:100}}))}]});
 const capture=(next:boolean)=>({before:state(next),after:state(next),screenshot:next?afterShot:shot});
 const action:any={version:1,kind:'source-native-interactions',sourceUrl:url,viewport,provenance:{method:'agent-opened-browser',observer:'playwright',browser:'chromium'},binding:{browserId:'browser',tabId:'tab',frameId:'main'},records:[{name:'next',kind:'click',selector:'.next',target:{insideForm:false},before:capture(false),after:capture(true)}]};
 const input=()=>({sourcePacket:put('packet.json',packet),actionSource:put('action.json',action),actionName:'next',interactionId:'carousel',componentKey:'related_widget',sectionKey:'related',taskId:'task',read:async(r:{path:string},base?:string)=>{const filename=path.resolve(base??'/evidence',r.path);return{filename,bytes:files.get(filename)!};}});
 return{packet,action,input,files};
}
test('real native action projection preserves its declared source and binds observed motion to pixel references',async()=>{
 const f=await fixture(),result=await projectObservedPhoneCarousel(f.input());
 assert.equal(f.packet.interactions.carousel.status,'declared');assert.equal(result.packet.interactions.carousel.status,'observed');assert.equal(result.packet.interactions.carousel.details.visibleItems,2);
 assert.deepEqual(result.packet.layouts,f.packet.layouts);assert.equal(result.motionRow.before.activeIndex,1);assert.equal(result.motionRow.after.activeIndex,2);assert.equal(result.receipt.provenance.observer,'playwright');
 f.action.records[0].after=f.action.records[0].before;
 await assert.rejects(projectObservedPhoneCarousel(f.input()),/no_track_motion/);
});
test('projection rejects forged bytes, reordering and native actions within private forms',async()=>{
 const f=await fixture(),input=f.input();f.files.set(input.actionSource.path,Buffer.from('{}'));
 await assert.rejects(projectObservedPhoneCarousel(input),/reference_changed/);
 f.action.records[0].target.insideForm=true;await assert.rejects(projectObservedPhoneCarousel(f.input()),/native_action/);
 f.action.records[0].target.insideForm=false;f.action.records[0].after.before.carousels[0].slides.reverse();await assert.rejects(projectObservedPhoneCarousel(f.input()),/track_ambiguous|unsettled_or_reordered/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSourceProvenControlCorrections,assertUnwrittenControlCorrectionState} from '../src/replica-full/unwritten-body-style-amendment.js';
import {fullReplicaHash} from '../src/replica-full/contract.js';

/** Isolated authoring fixtures. Never read credentials or operate a target site. */
function fixture(){
 const original:any={version:2,taskId:'control-fixture',sourceUrl:'https://reference.example/contact',blocks:[{kind:'composite',key:'toolbar',settings:{direction:'column'},sourceFactIds:['layout'],children:[{kind:'composite',key:'toolbar_fixed',settings:{direction:'column'},sourceFactIds:['layout'],children:[{kind:'composite',key:'toolbar_group',settings:{direction:'column'},sourceFactIds:['layout'],children:[{kind:'native',key:'toolbar_qr',widgetType:'wd_image_or_svg',widgetSettings:{image:{$asset:'qr'},size:'full'},sourceFactIds:['media']}]}]}]}]};
 const effective=structuredClone(original);
 for(const n of [effective.blocks[0],effective.blocks[0].children[0],effective.blocks[0].children[0].children[0]]){delete n.settings.direction;n.settings.flex_direction='column';}
 const image=effective.blocks[0].children[0].children[0].children[0];image.widgetSettings.size='';image.widgetSettings.image_size='full';
 const source:any={version:2,kind:'source-facts',sourceUrl:original.sourceUrl,snapshots:[{id:'desktop'}],facts:{layout:{id:'layout',snapshotId:'desktop',kind:'layout'},media:{id:'media',snapshotId:'desktop',kind:'media'}}};
 const schemas:any={container:{class:'Elementor\\Includes\\Elements\\Container',controls:{flex_direction:{type:'choose',options:{column:{},row:{}}}}},wd_image_or_svg:{class:'XTS\\Elementor\\Image',controls:{image:{type:'media'},size:{type:'select',options:{'':'Default',custom:'Custom'}},image_size:{type:'select',options:{full:'Full',medium:'Medium'}}}}};
 return{original,effective,source,schemas};
}
const qr=(p:any)=>p.blocks[0].children[0].children[0].children[0];
test('source proven native control corrections accept four exact changes without mutating evidence',()=>{const f=fixture(),before=structuredClone(f);assert.doesNotThrow(()=>assertSourceProvenControlCorrections(f.original,f.effective,f.source,f.schemas));assert.deepEqual(f,before);});
test('source proven correction can be independently limited to a container or image',()=>{for(const family of ['container','image']){const f=fixture();if(family==='container'){f.original.blocks[0].children=[];f.effective.blocks[0].children=[];}else{f.original.blocks=[qr(f.original)];f.effective.blocks=[qr(f.effective)];}assert.doesNotThrow(()=>assertSourceProvenControlCorrections(f.original,f.effective,f.source,f.schemas));}});
const attacks:Array<[string,(f:ReturnType<typeof fixture>)=>void]>=[
 ['no correction',f=>{f.effective=structuredClone(f.original);}],
 ['changed preserved direction',f=>{f.effective.blocks[0].settings.flex_direction='row';}],
 ['direction old value is unregistered',f=>{f.original.blocks[0].settings.direction='diagonal';f.effective.blocks[0].settings.flex_direction='diagonal';}],
 ['registered original alias',f=>{f.schemas.container.controls.direction={type:'choose',options:{column:{}}};}],
 ['unregistered replacement control',f=>{delete f.schemas.container.controls.flex_direction;}],
 ['replacement control has different type',f=>{f.schemas.container.controls.flex_direction.type='text';}],
 ['replacement enum excludes value',f=>{delete f.schemas.container.controls.flex_direction.options.column;}],
 ['foreign container class',f=>{f.schemas.container.class='Foreign\\Container';}],
 ['image replacement size differs',f=>{qr(f.effective).widgetSettings.size='custom';}],
 ['image replacement preset differs',f=>{qr(f.effective).widgetSettings.image_size='medium';}],
 ['image original is not invalid full enum',f=>{qr(f.original).widgetSettings.size='custom';}],
 ['image old preset already exists',f=>{qr(f.original).widgetSettings.image_size='medium';}],
 ['image asset changes',f=>{qr(f.effective).widgetSettings.image.$asset='foreign';}],
 ['image source fact is not media',f=>{f.source.facts.media.kind='text';}],
 ['image class differs',f=>{f.schemas.wd_image_or_svg.class='Foreign\\Image';}],
 ['image full was already valid',f=>{f.schemas.wd_image_or_svg.controls.size.options.full='Full';}],
 ['image replacement full unavailable',f=>{delete f.schemas.wd_image_or_svg.controls.image_size.options.full;}],
 ['image empty size unavailable',f=>{delete f.schemas.wd_image_or_svg.controls.size.options[''];}],
 ['image control is not media',f=>{f.schemas.wd_image_or_svg.controls.image.type='text';}],
 ['unknown source fact',f=>{delete f.source.facts.layout;}],
 ['unknown snapshot',f=>{f.source.facts.layout.snapshotId='missing';}],
 ['missing corrected owner facts',f=>{f.original.blocks[0].sourceFactIds=[];f.effective.blocks[0].sourceFactIds=[];}],
 ['source identity differs',f=>{f.source.sourceUrl='https://foreign.example';}],
 ['component identity changes',f=>{f.effective.blocks[0].key='foreign';}],
 ['widget content added',f=>{qr(f.effective).widgetSettings.caption='Added text';}],
 ['phone setting added',f=>{f.effective.blocks[0].settings.flex_direction_mobile='row';}],
 ['breakpoint intent changed',f=>{f.effective.blocks[0].styleBindings=[{minWidth:1000}];}],
 ['program identity changed',f=>{f.effective.taskId='foreign';}],
 ['component order changed',f=>{f.effective.blocks.push(structuredClone(f.effective.blocks[0]));}],
];
for(const[name,attack]of attacks)test('native control correction rejects '+name,()=>{const f=fixture();attack(f);assert.throws(()=>assertSourceProvenControlCorrections(f.original,f.effective,f.source,f.schemas));});

function stateFixture(){const manifest:any={version:4,taskId:'controls-task',runId:'controls-run',headerProvider:'reused-woodmart-header',reusedHeader:{headerId:'header-owned'},responsive:{mobileMaxWidth:768}},previous:any={path:'D:/cloneWP/runs/owned/previous.json',sha256:'a'.repeat(64)},pageId=21850;const state:any={taskId:manifest.taskId,runId:manifest.runId,manifestHash:fullReplicaHash(manifest),status:'building',pending:null,review:null,revision:8,bodyStyleAmendment:previous,checkpoints:{page:{pageId,runId:manifest.runId,status:'draft',template:'elementor_header_footer',headerId:null}}};return{manifest,state,pageId,previous};}
test('native control correction accepts only exact installed prior amendment state',()=>{const f=stateFixture();assert.doesNotThrow(()=>assertUnwrittenControlCorrectionState(f.manifest,f.state,f.pageId,f.previous));});
const stateAttacks:Array<[string,(f:ReturnType<typeof stateFixture>)=>void]>=[
 ['previous hash differs',f=>{f.previous={...f.previous,sha256:'b'.repeat(64)};}],
 ['previous path differs',f=>{f.previous={...f.previous,path:'foreign.json'};}],
 ['no installed amendment',f=>{delete f.state.bodyStyleAmendment;}],
 ['pending unknown write',f=>{f.state.pending={id:'unknown'};}],
 ['saved body',f=>{f.state.checkpoints.body={pageId:f.pageId};}],
 ['bound page',f=>{f.state.checkpoints.page.headerId='bound';}],
 ['published page',f=>{f.state.checkpoints.page.status='publish';}],
 ['different page',f=>{f.pageId++;}],
 ['foreign run',f=>{f.state.runId='foreign';}],
 ['manifest drift',f=>{f.state.manifestHash='c'.repeat(64);}],
 ['write unknown status',f=>{f.state.status='write-unknown';}],
 ['already reviewed',f=>{f.state.review={accepted:true};}],
];
for(const[name,attack]of stateAttacks)test('native control correction state rejects '+name,()=>{const f=stateFixture();attack(f);assert.throws(()=>assertUnwrittenControlCorrectionState(f.manifest,f.state,f.pageId,f.previous));});

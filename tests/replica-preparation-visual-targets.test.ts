import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPreparationVisualTargets} from '../src/replica-preparation/visual-targets.js';

const shot={path:'D:/cloneWP/evidence/source.png',sha256:'a'.repeat(64)};
const evidence={path:'D:/cloneWP/evidence/source-packet.json',sha256:'b'.repeat(64)};
const rect={x:15,y:40,width:360,height:300};
const facts:any={version:2,kind:'source-facts',sourceUrl:'https://example.com/product',observation:evidence,
 snapshots:[{id:'desktop',viewport:{name:'desktop',width:1440,height:1000,clientWidth:1440,scrollbarWidth:0,devicePixelRatio:1},screenshot:{...shot,width:1440,height:1000},evidence:[evidence],nodes:{}}],
 facts:{
  'desktop:media:image':{id:'desktop:media:image',snapshotId:'desktop',regionId:'body',nodeId:'image',kind:'media',evidence,value:{visible:true,layout:{rect},style:{'background-color':'rgba(0, 0, 0, 0)'}}},
  'desktop:text:title':{id:'desktop:text:title',snapshotId:'desktop',regionId:'body',nodeId:'title',kind:'text',evidence,value:{visible:true,lineCount:2,layout:{rect,contentRect:{...rect,width:350}},style:{'background-color':'rgb(255, 255, 255)'}}},
 },gaps:[]};
const plans:any={version:8,sections:[
 {key:'gallery',sourceFactIds:['desktop:media:image'],visualTargets:[{kind:'geometry',sourceFactId:'desktop:media:image',rect,evidence:shot},{kind:'paint',sourceFactId:'desktop:media:image',property:'background-color',value:'rgba(0, 0, 0, 0)',evidence:shot},{kind:'item-count',sourceFactIds:['desktop:media:image'],count:1,evidence:shot}]},
 {key:'title',sourceFactIds:['desktop:text:title'],visualTargets:[{kind:'geometry',sourceFactId:'desktop:text:title',rect,evidence:shot},{kind:'paint',sourceFactId:'desktop:text:title',property:'background-color',value:'rgb(255, 255, 255)',evidence:shot},{kind:'text-wrap',sourceFactId:'desktop:text:title',lineCount:2,widthPx:350,evidence:shot}]},
]};
test('measured media and text packet layouts support multi-owner visual targets',()=>{
 assert.doesNotThrow(()=>verifyPreparationVisualTargets(plans,facts));
 const changed=structuredClone(plans);changed.sections[0].visualTargets[0].rect.x=17;
 assert.throws(()=>verifyPreparationVisualTargets(changed,facts),/body_visual_target_geometry/);
 const painted=structuredClone(plans);painted.sections[0].visualTargets[1].value='red';
 assert.throws(()=>verifyPreparationVisualTargets(painted,facts),/body_visual_target_paint/);
});

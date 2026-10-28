import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDecisionProgram,responsiveDecisionsSchema} from '../src/replica-responsive/decisions.js';
import {requiredPhoneCarousels,verifyPhoneMotionSource} from '../src/replica-responsive/motion-review.js';
import type {Native44Program} from '../src/native44/types.js';
import type {ResponsivePlan} from '../src/replica-responsive/contract.js';

const views=[{width:390,height:844},{width:430,height:932}];
function fixture(){
 const program={blocks:[{kind:'composite',key:'product',children:[
  {kind:'native',key:'gallery',widgetType:'wd_single_product_gallery',widgetSettings:{thumbnails_position:'bottom',thumbnails_bottom_columns_mobile:'4'}},
  {kind:'native-related-products',key:'related',widgetType:'woocommerce-product-related',widgetSettings:{columns_mobile:2},query:{source:'related',contextKey:'product',limit:6}},
 ]}]} as unknown as Native44Program;
 const decisions=responsiveDecisionsSchema.parse({version:1,layouts:[],header:{mode:'reuse-readonly',requestRef:'Task reuses its existing header.',reason:'Existing header is a read-only dependency for this native product body.',headerId:'header_123',sharedHash:'a'.repeat(64),evidence:[{path:'header.json',sha256:'b'.repeat(64)}]},carousels:[
  {componentKey:'gallery',sectionKey:'product',nativeField:'thumbnails_bottom_columns_mobile',views:views.map(v=>({...v,snapshotId:`phone-${v.width}`,nodeId:'gallery-owner',interactionId:'gallery-action',visibleItems:4}))},
  {componentKey:'related',sectionKey:'product',nativeField:'columns_mobile',views:views.map(v=>({...v,snapshotId:`phone-${v.width}`,nodeId:'related-owner',interactionId:'related-action',visibleItems:2}))},
 ]});
 return {program,decisions};
}

test('product gallery and qualified typed related use their actual distinct mobile count fields',()=>{
 const {program,decisions}=fixture();
 assert.doesNotThrow(()=>assertDecisionProgram(program,decisions,768,''));
 const gallery=(program.blocks[0] as any).children[0];
 gallery.widgetSettings.thumbnails_bottom_columns_mobile='2';
 assert.throws(()=>assertDecisionProgram(program,decisions,768,''),/count_plan_mismatch/);
 gallery.widgetSettings.thumbnails_bottom_columns_mobile='4';
 gallery.widgetSettings.thumbnails_position='inherit';
 assert.throws(()=>assertDecisionProgram(program,decisions,768,''),/native_layout_mismatch/);
});

test('the added fields cannot mislabel ordinary products, a gallery grid or a related grid as a carousel',()=>{
 const {program,decisions}=fixture();
 const children=(program.blocks[0] as any).children;
 children[1]={kind:'native-products',key:'related',widgetType:'wd_products',widgetSettings:{columns_mobile:2,layout:'carousel'}};
 assert.throws(()=>assertDecisionProgram(program,decisions,768,''),/native_layout_mismatch/);
 const again=fixture();again.decisions.carousels[1].presentation='grid';again.decisions.carousels[1].views.forEach(v=>v.columns=2);
 assert.throws(()=>assertDecisionProgram(again.program,again.decisions,768,''),/native_layout_mismatch/);
 const third=fixture();third.decisions.carousels=[];
 assert.throws(()=>assertDecisionProgram(third.program,third.decisions,768,''),/count_decision_missing/);
});

test('both current-product carousel owners need real phone motion even when a decision was accidentally omitted',async()=>{
 const {program}=fixture();
 const plan={version:2,sections:[{key:'product',mode:'shared'}],viewports:views} as unknown as ResponsivePlan;
 assert.deepEqual(requiredPhoneCarousels(program,plan),[{componentKey:'gallery',sectionKey:'product'},{componentKey:'related',sectionKey:'product'}]);
 await assert.rejects(verifyPhoneMotionSource({taskId:'task',sourceUrl:'https://source.example/',program,plan,packets:[],read:async()=>{throw Error('unexpected read');}}),/source_missing/);
 plan.sections[0].mode='desktop-only';assert.deepEqual(requiredPhoneCarousels(program,plan),[]);
});

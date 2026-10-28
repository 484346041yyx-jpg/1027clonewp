import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBoundaryTable } from '../src/replica-preparation/boundaries.js';
const hash='a'.repeat(64);
const expected={taskId:'t',runId:'r',sourceHash:hash,sectionKeys:['a','b'],snapshots:[{id:'desktop',clientWidth:1440}],factSnapshot:{f:'desktop'}};
const row={before:'a',after:'b',snapshotId:'desktop',clientWidth:1440,gapPx:80,evidenceFactIds:['f'],backgroundDecision:'blue to white',contributors:[{id:'padding-a',role:'internal-padding',owner:'a',sourceFactIds:['f'],effectId:'inside-a'},{id:'padding-b',role:'internal-padding',owner:'b',sourceFactIds:['f'],effectId:'inside-b'}]};
const table={version:1,kind:'clonewp-section-boundaries',taskId:'t',runId:'r',sourceHash:hash,boundaries:[row]};
test('separate source internal padding is accepted',()=>assert.equal(validateBoundaryTable(table,expected).boundaries.length,1));
test('missing coverage and repeated logical effect are rejected',()=>{assert.throws(()=>validateBoundaryTable({...table,boundaries:[]},expected),/boundary_missing/);assert.throws(()=>validateBoundaryTable({...table,boundaries:[{...row,contributors:[row.contributors[0],{...row.contributors[1],effectId:'inside-a'}]}]},expected),/boundary_effect_duplicate/)});
test('external spacing must belong to coordinator and source view must match',()=>{assert.throws(()=>validateBoundaryTable({...table,boundaries:[{...row,contributors:[{...row.contributors[0],role:'external-spacing'}]}]},expected),/boundary_owner/);assert.throws(()=>validateBoundaryTable(table,{...expected,factSnapshot:{f:'phone'}}),/boundary_evidence/)});

import { assertBoundaryFragment, boundaryCSS } from '../src/replica-preparation/boundaries.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
test('root native and CSS external spacing rejected; padding and descendants retained',()=>{
 const root=':page .'+native44ModuleClass('a');
 const fragment:any={key:'a',blocks:[{kind:'composite',key:'a',settings:{padding:{top:'40',bottom:'40'}},children:[]}],css:root+'{padding:40px}'+root+' .card{margin-top:12px}'};
 assert.doesNotThrow(()=>assertBoundaryFragment(fragment));
 assert.throws(()=>assertBoundaryFragment({...fragment,css:root+'{margin-top:40px}'}),/boundary_css_conflict/);
 assert.throws(()=>assertBoundaryFragment({...fragment,blocks:[{...fragment.blocks[0],settings:{margin_mobile:{top:'40'}}}]}),/boundary_native_conflict/);
 assert.throws(()=>assertBoundaryFragment({...fragment,responsive:{css:root+'{margin-bottom:40px}'}}),/boundary_css_conflict/);
});
test('central styles scope and media overlap checked',()=>{
 const styles=[{sectionKey:'b',property:'margin-top',valuePx:20,minWidth:0,maxWidth:767,sourceFactIds:['f']}];
 const parsed=validateBoundaryTable({...table,styles},expected);
 assert.match(boundaryCSS({boundaryTable:parsed} as any),/margin-top:20px/);
 assert.throws(()=>validateBoundaryTable({...table,styles:[...styles,...styles]},expected),/style_overlap/);
});

test('phone native settings and style bindings cannot add root external spacing',()=>{
 const fragment:any={key:'a',blocks:[{kind:'composite',key:'a',children:[]}],css:''};
 assert.throws(()=>assertBoundaryFragment({...fragment,responsive:{settings:[{componentKey:'a',values:{margin:{top:'40'}}}]}}),/boundary_native_conflict/);
 assert.throws(()=>assertBoundaryFragment({...fragment,blocks:[{...fragment.blocks[0],styleBindings:[{selector:':scope',properties:['margin-top']}]}]}),/boundary_binding_conflict/);
});

import { preparationPolicyFixture } from './helpers/preparation-policy-fixture.js';
import { preparationHash, preparationSharedHash, validatePreparationPlan } from '../src/replica-preparation/contract.js';
test('optional boundary contract preserves historical hashes and new ownership changes shared hash',()=>{
 const legacy=preparationPolicyFixture();
 const hash=preparationHash(legacy);
 assert.equal(preparationHash(validatePreparationPlan(legacy)),hash);
 assert.equal(validatePreparationPlan(legacy).boundaryTable,undefined);
 const newer={...legacy,boundaryTable:{...table,styles:[],taskId:legacy.taskId,runId:legacy.runId}};
 assert.notEqual(preparationSharedHash(newer as any),preparationSharedHash(legacy));
});

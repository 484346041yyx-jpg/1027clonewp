import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture, fakeRemote } from './helpers/revision-flow-fixture.js';
import { prepareNative44Revision, applyNative44Revision, recordNative44RevisionReview } from '../src/native44/revision.js';
import { readNative44CurrentState, reuseNative44CurrentStateForDelivery, validateNative44CurrentRevisionPointer, type Native44CurrentRevisionPointer } from '../src/native44/current-state.js';
import { buildNative44DeliverySummary, emitNative44DeliverySummary } from '../src/native44/delivery-summary.js';
import { hashV2 } from '../src/replica-v2/journal.js';

async function reviewed(t: test.TestContext) {
  const f=await fixture(t,'heading'),remote=fakeRemote(f);
  await prepareNative44Revision(f.root,f.request);await applyNative44Revision(f.root,f.runId,f.request.operationId,remote.deps);
  await recordNative44RevisionReview(f.root,f.runId,await f.review(await f.expected()));
  const state=await readNative44CurrentState(f.root,f.runDir);assert.ok(state);
  assert.equal(remote.stats().saves,1);assert.equal(state.axes?.review.status,'reviewed');
  return {...f,state,remote,pointerFile:path.join(f.runDir,'current-user-amendment.json')};
}

test('genuine validated state retains every delivery axis and acquires fresh persisted pointer evidence',async t=>{
  const f=await reviewed(t),before=structuredClone(f.state),reused=await reuseNative44CurrentStateForDelivery(f.root,f.runId,f.state);
  assert.ok(reused);assert.notEqual(reused,f.state);assert.deepEqual(reused.axes,f.state.axes);assert.equal(reused.documentHash,f.state.documentHash);
  const pointer=await readFile(f.pointerFile),proof=reused.evidence.filter(item=>item.path===f.pointerFile);
  assert.equal(proof.length,1);assert.equal(proof[0].sha256,hashV2(pointer));assert.equal(proof[0].bytes,pointer.length);assert.match(proof[0].reason,/Fresh persisted pointer/);
  assert.deepEqual(f.state,before);
  const delivery=await emitNative44DeliverySummary(f.root,f.runId,{expectedState:f.state});
  const expectedAxes=buildNative44DeliverySummary(f.state,{generatedAt:new Date().toISOString()}).axes;
  assert.deepEqual(delivery.summary.axes,{...expectedAxes,delivery:'awaiting-editor-alignment-and-reopen'});
  assert.equal(f.state.deliveryComplete,true);assert.equal(delivery.summary.deliveryComplete,false);assert.equal(delivery.summary.status,'editor-completion-pending');
  assert.equal(f.remote.stats().saves,1);await f.assertHistoricalUnchanged();
});

test('cloned or serialized state confers no trust and delivery recomputes its actual acceptance axes',async t=>{
  const f=await reviewed(t);
  for(const value of [structuredClone(f.state),JSON.parse(JSON.stringify(f.state)),{taskId:f.taskId,runId:f.runId,pageId:f.pageId,documentHash:f.state.documentHash}])assert.equal(await reuseNative44CurrentStateForDelivery(f.root,f.runId,value),undefined);
  const forged={...structuredClone(f.state),deliveryComplete:!f.state.deliveryComplete,axes:undefined};
  const delivery=await emitNative44DeliverySummary(f.root,f.runId,{expectedState:forged});
  assert.equal(f.state.deliveryComplete,true);assert.equal(delivery.summary.deliveryComplete,false);
  assert.deepEqual(delivery.summary.axes,{...buildNative44DeliverySummary(f.state,{generatedAt:new Date().toISOString()}).axes,delivery:'awaiting-editor-alignment-and-reopen'});
  assert.equal(delivery.summary.status,'editor-completion-pending');
  const restored=await readNative44CurrentState(f.root,f.runDir);assert.deepEqual(restored?.axes,f.state.axes);assert.equal(f.remote.stats().saves,1);
});

test('mutated branded state is rejected instead of becoming a trusted delivery override',async t=>{
  const f=await reviewed(t);f.state.deliveryComplete=!f.state.deliveryComplete;
  await assert.rejects(reuseNative44CurrentStateForDelivery(f.root,f.runId,f.state),/verified_state_mutated/);
  await assert.rejects(emitNative44DeliverySummary(f.root,f.runId,{expectedState:f.state}),/verified_state_mutated/);
});

test('fresh pointer and evidence barriers reject changes made after state validation',async t=>{
  for(const target of ['pointer','css'] as const){
    const f=await reviewed(t),filename=target==='pointer'?f.pointerFile:f.state.currentCSS.path,previous=await readFile(filename);
    if(target==='pointer')await writeFile(filename,JSON.stringify({...JSON.parse(previous.toString('utf8')),requestedScope:'Concurrent scope changed after state validation.'}));
    else await writeFile(filename,Buffer.concat([previous,Buffer.from('/* externally changed */')]));
    await assert.rejects(reuseNative44CurrentStateForDelivery(f.root,f.runId,f.state),/hash_mismatch|pointer_changed/);
    await assert.rejects(emitNative44DeliverySummary(f.root,f.runId,{expectedState:f.state}),/hash_mismatch|pointer_changed/);
    assert.equal(f.remote.stats().saves,1);
  }
});

test('fully verified candidate must match the persisted pointer before delivery can reuse it',async t=>{
  const f=await reviewed(t),pointer=JSON.parse(await readFile(f.pointerFile,'utf8')) as Native44CurrentRevisionPointer;
  const unchanged=await validateNative44CurrentRevisionPointer(f.root,f.runDir,pointer),reused=await reuseNative44CurrentStateForDelivery(f.root,f.runId,unchanged);
  assert.ok(reused?.evidence.some(item=>item.path===f.pointerFile));assert.deepEqual(reused?.axes,f.state.axes);
  const candidate=await validateNative44CurrentRevisionPointer(f.root,f.runDir,{...pointer,requestedScope:'Fully checked candidate which has not been committed.'});
  await assert.rejects(reuseNative44CurrentStateForDelivery(f.root,f.runId,candidate),/pointer_changed_during_read/);
  await assert.rejects(emitNative44DeliverySummary(f.root,f.runId,{expectedState:candidate}),/pointer_changed_during_read/);
  assert.deepEqual(JSON.parse(await readFile(f.pointerFile,'utf8')),pointer);assert.equal(f.remote.stats().saves,1);
});

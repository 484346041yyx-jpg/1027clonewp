import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { queuePreparationFixture } from './helpers/queue-preparation-fixture.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { initializePreparation, nextPreparationJob, startPreparationJob, completePreparationJob, failPreparationJob, requestPreparationRework, preparationStatus } from '../src/replica-preparation/io.js';
import { parsePreparationArgs } from '../src/replica-preparation/cli.js';
import { assertPreparationQueueCapacity, nextPreparationQueueRow, preparationQueueTiming } from '../src/replica-preparation/queue-runtime.js';
import type { PreparationQueueRow } from '../src/replica-preparation/queue-runtime.js';

test('queue CLI bounds IDs, exposes atomic claims and keeps rework separate from publication', () => {
  assert.deepEqual(parsePreparationArgs(['next','--directory','d','--worker','producer-A']), {command:'next',directory:'d',worker:'producer-A'});
  assert.deepEqual(parsePreparationArgs(['start','--directory','d','--job','body-2000','--worker','producer-A']), {command:'start',directory:'d',job:'body-2000',worker:'producer-A'});
  assert.deepEqual(parsePreparationArgs(['rework','--directory','d','--evidence','batch.json']), {command:'rework',directory:'d',evidence:'batch.json'});
  for (const args of [['next','--directory','d'],['next','--directory','d','--worker','../escape'],['start','--directory','d','--job','body-2001'],['rework','--directory','d'],['rework','--directory','d','--evidence','b','--publish','yes']]) assert.throws(()=>parsePreparationArgs(args),/arguments/);
});

test('queue wall measurement unions overlaps and counts failure/rework occupancy without inventing model time', () => {
  const job: PreparationQueueRow['job'] = {version:1,kind:'clonewp-preparation-job',taskId:'task',runId:'run',jobId:'body-1',responsibility:'body',contractHash:'a'.repeat(64),sharedHash:'b'.repeat(64),sectionKeys:['section'],sourceUnitIds:['unit'],sourceFactIds:['fact'],estimatedEffort:2};
  const rows: PreparationQueueRow[] = [
    {job,status:'complete',startedAt:'2026-10-27T01:00:00.000Z',finishedAt:'2026-10-27T01:00:10.000Z'},
    {job:{...job,jobId:'body-2'},status:'complete',startedAt:'2026-10-27T01:00:05.000Z',finishedAt:'2026-10-27T01:00:15.000Z',previousAttempts:[{startedAt:'2026-10-27T00:59:50.000Z',finishedAt:'2026-10-27T00:59:55.000Z',elapsedMs:5000,status:'failed'}]},
  ];
  const t = preparationQueueTiming(rows);
  assert.equal(t.activeWallMs,20000); assert.equal(t.spanMs,25000); assert.equal(t.workerOccupancyMs,25000); assert.equal(t.pureModelTime,'not-measured');
  const active = [{job,status:'running',workerId:'producer-A'}] as PreparationQueueRow[];
  assert.throws(()=>assertPreparationQueueCapacity(active,2,'producer-A'),/worker_busy/);
  assert.throws(()=>assertPreparationQueueCapacity(active,1,'producer-B'),/queue_capacity/);
  const queued = [{job,status:'ready',workerId:'producer-A'}, {job:{...job,jobId:'body-2',estimatedEffort:50},status:'ready'}] as PreparationQueueRow[];
  assert.equal(nextPreparationQueueRow(queued,'producer-A')?.job.jobId,'body-1');
  assert.equal(nextPreparationQueueRow(queued,'producer-B')?.job.jobId,'body-2');
});

test('legacy task keeps its contract and cannot be silently claimed through the new queue', async () => {
  const f=await preparationIOFixture(); try {
    await initializePreparation(f.plan,{finalRunDirectory:f.finalRunDirectory});
    const contract=await readFile(path.join(f.preparationDirectory,'contract.json'),'utf8');
    await assert.rejects(nextPreparationJob(f.preparationDirectory,'producer-A'),/queue_policy_required/);
    const job = f.jobs.find(row => row.responsibility === 'body')!;
    await startPreparationJob(f.preparationDirectory, job.jobId);
    const result = structuredClone(f.results.find(row => row.jobId === job.jobId)!);
    await f.writeResult(job.jobId, { ...result, workRevision: 0 });
    await assert.rejects(completePreparationJob(f.preparationDirectory, job.jobId, path.join(f.preparationDirectory, 'jobs', job.jobId, 'result.json')), /result_work_revision/);
    assert.equal(await readFile(path.join(f.preparationDirectory,'contract.json'),'utf8'),contract);
  } finally {await f.cleanup();}
});

test('durable queue atomically caps slots, batches original-owner rework and rejects stale outputs', async () => {
  const f=await queuePreparationFixture(); try {
    await initializePreparation(f.plan,{finalRunDirectory:f.finalRunDirectory});
    const header=await startPreparationJob(f.preparationDirectory,'header','producer-A') as any;
    const claims=await Promise.all(['producer-B','producer-C'].map(id=>nextPreparationJob(f.preparationDirectory,id)));
    const active=claims.filter((r:any)=>r.status==='running') as any[];
    assert.equal(active.length,1); assert.equal(claims.filter((r:any)=>r.status==='queue-busy').length,1);
    const body=active[0];
    assert.ok(header);assert.ok(body);
    await assert.rejects(nextPreparationJob(f.preparationDirectory,header.workerId),/worker_busy/);
    const value={...structuredClone(f.results.find(row=>row.jobId==='header')!),contractHash:header.job.contractHash,sharedHash:header.job.sharedHash,workRevision:0};
    const filename=await f.writeResult('header',value);
    await completePreparationJob(f.preparationDirectory,'header',filename);
    const before=await readFile(path.join(f.preparationDirectory,'state.json'),'utf8');
    assert.equal((await completePreparationJob(f.preparationDirectory,'header',filename) as any).unchanged,true);
    assert.equal(await readFile(path.join(f.preparationDirectory,'state.json'),'utf8'),before);
    const state=await f.readState(), row=state.jobs.find((row:any)=>row.job.jobId==='header');
    const evidence=await f.put('rework.json',{version:1,kind:'clonewp-preparation-rework',taskId:f.plan.taskId,runId:f.plan.runId,contractHash:state.contractHash,requests:[{jobId:'header',expectedResultSha256:row.result.sha256,reason:'Review found an actual header alignment difference.'}]});
    await requestPreparationRework(f.preparationDirectory,evidence.path);
    const unrelated=await nextPreparationJob(f.preparationDirectory,'unrelated-worker') as any;
    assert.equal(unrelated.status,'running'); assert.notEqual(unrelated.job.jobId,'header');
    await failPreparationJob(f.preparationDirectory,unrelated.job.jobId);
    assert.equal((await nextPreparationJob(f.preparationDirectory,'another-worker') as any).status,'waiting-for-owner');
    assert.equal((await requestPreparationRework(f.preparationDirectory,evidence.path) as any).unchanged,true);
    const repair=await nextPreparationJob(f.preparationDirectory,header.workerId) as any;
    assert.equal(repair.job.jobId,'header');assert.equal(repair.workRevision,1);
    await assert.rejects(completePreparationJob(f.preparationDirectory,'header',filename),/result_work_revision/);
    await f.writeResult('header',{...value,workRevision:1});
    await completePreparationJob(f.preparationDirectory,'header',filename);
    const after=await preparationStatus(f.preparationDirectory);
    assert.equal(after.jobs.find(job=>job.jobId==='header')!.previousResults!.length,1);
    assert.equal(after.jobs.find(job=>job.jobId===body.job.jobId)!.status,'running');
    await failPreparationJob(f.preparationDirectory,body.job.jobId);
    const retry=await startPreparationJob(f.preparationDirectory,body.job.jobId,body.workerId);
    assert.equal(retry.workRevision,1);
    assert.ok(after.queue);assert.equal(after.remoteWrites,0);
  } finally {await f.cleanup();}
});

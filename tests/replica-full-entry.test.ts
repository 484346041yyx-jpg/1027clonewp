import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReplicaEntry,runReplicaEntry} from '../src/replica-full/entry.js';
import {preparationIOFixture} from './helpers/preparation-io-fixture.js';
import { randomUUID } from 'node:crypto';
import { claimWorkspace, checkpointWorkspace, inspectWorkspace } from '../src/workspace/service.js';

const ROOT = 'D:/cloneWP';
async function withWorkspaceClaim<T>(work: () => Promise<T>): Promise<T> {
 const taskId=`replica-full-entry-test-${randomUUID()}`, before=await inspectWorkspace(ROOT);
 const owner=await claimWorkspace(ROOT,{agent:'codex',sessionId:`test-${randomUUID()}`,taskId,
  resources:[`task:${taskId}`],expectedRevision:before.revision,expectedFingerprint:before.fingerprint});
 const previous=process.env.CLONEWP_WORKSPACE_TOKEN;process.env.CLONEWP_WORKSPACE_TOKEN=owner.token;
 let completed=false;
 try {const result=await work();completed=true;return result;}
 finally {
  if(previous===undefined)delete process.env.CLONEWP_WORKSPACE_TOKEN;else process.env.CLONEWP_WORKSPACE_TOKEN=previous;
  const current=await inspectWorkspace(ROOT);
  await checkpointWorkspace(ROOT,{token:owner.token,expectedRevision:owner.revision,expectedFingerprint:current.fingerprint,release:true,
   notes:{goal:'Exercise replica entry under a real scoped workspace claim',summary:completed?'Local entry fixture completed':'Local entry fixture failed',
    progress:completed?'completed':'blocked',decisions:[],changes:[],checks:[{command:'replica-full-entry.test.ts',status:completed?'passed':'failed'}],
    openItems:completed?[]:['Inspect the failing test assertion.'],nextSteps:completed?['No fixture follow-up.']:['Review the failing test output.']}});
 }
}

test('new replica entry cannot silently send a legacy body program to Canvas',()=>{
 const legacy={workflow:'block-replication'};
 assert.throws(()=>selectReplicaEntry(legacy,[]),/manifest_required/);
 assert.throws(()=>selectReplicaEntry(legacy,['--provider','component']),/entry_provider/);
 assert.throws(()=>selectReplicaEntry(legacy,['--resume','D:/cloneWP/runs/frozen']),/retired_entry/);
 assert.throws(()=>selectReplicaEntry(legacy,['--provider','woodmart-header-builder','--resume','frozen']),/entry_provider|retired_entry/);
});
test('replica entry rejects ambiguous provider instructions before credentials',()=>{
 assert.throws(()=>selectReplicaEntry({},['--provider','auto']),/entry_provider/);
 assert.throws(()=>selectReplicaEntry({},['--provider','component','--provider','component']),/entry_provider/);
 assert.throws(()=>selectReplicaEntry({kind:'clonewp-full-replica'},['--provider','component']),/entry_provider|retired_entry/);
 assert.throws(()=>selectReplicaEntry({workflow:'original-design'},['--provider','component']),/entry_provider/);
});
test('entry help exposes only current creation without remote work',async()=>{
 const result=await runReplicaEntry(['--help']) as {help:string;remoteWrites:number};
 assert.equal(result.remoteWrites,0);assert.doesNotMatch(result.help,/create:replica:component/);assert.match(result.help,/PREPARATION\.json/);
});
test('new preparation routes to native collaboration and cannot be mixed with legacy resume',async()=>{
 const fixture=await preparationIOFixture();
 try{
  assert.equal(selectReplicaEntry(fixture.plan,[]),'preparation');
  assert.throws(()=>selectReplicaEntry(fixture.plan,['--provider','component']),/entry_provider|retired_entry/);
  assert.throws(()=>selectReplicaEntry(fixture.plan,['--resume','old-run']),/entry_provider|retired_entry/);
  const input=await fixture.put('preparation.json',fixture.plan);
  const result=await withWorkspaceClaim(()=>runReplicaEntry([input.path,'--run-dir',fixture.finalRunDirectory])) as any;
  assert.equal(result.status,'awaiting-preparation');assert.equal(result.remoteWrites,0);
  assert.deepEqual(result.jobs.map((job:any)=>job.jobId),['header','body-1','body-2']);
 }finally{await fixture.cleanup();}
});

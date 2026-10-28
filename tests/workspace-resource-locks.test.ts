import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { claimWorkspace, inspectWorkspace, heartbeatWorkspace, checkpointWorkspace, assertWorkspaceAccess, recoverWorkspace } from '../src/workspace/service.js';
import { withResourceLock, resourceOwner, resourceKeys } from '../src/workspace/resources.js';
import { hash } from '../src/workspace/files.js';
import { remoteResource, runResources } from '../src/workspace/operation-resources.js';
import { WORKSPACE_LEASE_MS } from '../src/workspace/contracts.js';

async function fixture(t: any) {
  const parent = path.resolve(import.meta.dirname, '../.cache'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'resource-test-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); });
  for (const f of ['AGENTS.md','SYSTEM.md','COMPONENTS.md','package.json']) await writeFile(path.join(root,f),'{}');
  return root;
}
async function claim(root: string, taskId: string, scoped = true, now = Date.now()) {
  const s = await inspectWorkspace(root,now);
  return claimWorkspace(root,{agent:'codex',sessionId:taskId+'-session',taskId,expectedRevision:s.revision,expectedFingerprint:s.fingerprint,...(scoped?{resources:[`local:reports/${taskId}`]}:{})},now);
}
test('new task claims preserve a live v1 owner byte-for-byte and renew independently',async t=>{
  const root=await fixture(t),legacy=await claim(root,'legacy',false);
  const before=await readFile(path.join(root,'data/workspace/state.json'));
  const a=await claim(root,'popup'),b=await claim(root,'product');
  await assertWorkspaceAccess(root,a.token);await assertWorkspaceAccess(root,b.token);await assertWorkspaceAccess(root,legacy.token);
  await heartbeatWorkspace(root,{token:a.token,expectedRevision:a.revision});
  await heartbeatWorkspace(root,{token:b.token,expectedRevision:b.revision});
  assert.ok(before.equals(await readFile(path.join(root,'data/workspace/state.json'))));
  const s=await inspectWorkspace(root);assert.equal(s.tasks.length,2);assert.equal(s.lock?.taskId,'legacy');
  await assert.rejects(assertWorkspaceAccess(root,'0'.repeat(64)),/not_lock_owner/);
  await assert.rejects(claim(root,'popup'),/task_already_owned/);
  assert.ok(!String(await readFile(path.join(root,'data/workspace/resources.json'))).includes(a.token));
});
test('different records run together; overlapping record tickets wait FIFO without blocking another record',async t=>{
  const root=await fixture(t),events:string[]=[];
  const release=await withResourceLock(root,['remote:site/post/42'],'a');
  let secondRelease:(()=>Promise<void>)|undefined;
  const second=withResourceLock(root,['remote:site/post/42'],'b').then(r=>{events.push('second');secondRelease=r;});
  await delay(40);
  let thirdRelease:(()=>Promise<void>)|undefined;
  const third=withResourceLock(root,['remote:site/post/42'],'c').then(r=>{events.push('third');thirdRelease=r;});
  await delay(40);
  const disjoint=await withResourceLock(root,['remote:site/post/43'],'d');await disjoint();
  assert.deepEqual(events,[]);await release();await second;assert.deepEqual(events,['second']);
  await secondRelease!();await third;assert.deepEqual(events,['second','third']);await thirdRelease!();
  assert.equal((await inspectWorkspace(root)).queue.length,0);
});
test('multi-resource requests are atomic and ancestor paths conflict case-insensitively',async t=>{
  const root=await fixture(t),release=await withResourceLock(root,['local:src/workspace'],'a');
  await assert.rejects(withResourceLock(root,['local:SRC/WORKSPACE/service.ts','remote:site/post/42'],'b',{waitMs:100}),/resource_wait_timeout/);
  const other=await withResourceLock(root,['remote:site/post/42'],'c');await other();await release();
  assert.deepEqual(resourceKeys(['local:SRC/A','local:src/a']),['local:src/a']);
  assert.throws(()=>resourceKeys(['local:src/../other']));assert.throws(()=>resourceKeys(['local:src//other']));
});
test('waiting owner is revalidated before entry; loss cannot execute a queued write',async t=>{
  const root=await fixture(t),release=await withResourceLock(root,['remote:site/post/42'],'a');
  let valid=true;
  const waiting=withResourceLock(root,['remote:site/post/42'],'b',{validate:async()=>{if(!valid)throw Error('lease_lost');}});
  await delay(80);valid=false;await assert.rejects(waiting,/lease_lost/);await release();
  assert.equal((await inspectWorkspace(root)).queue.length,0);
});
test('expired task requires explicit exact recovery; another task remains unchanged',async t=>{
  const root=await fixture(t),at=Date.now(),a=await claim(root,'popup',true,at),b=await claim(root,'product',true,at);
  const before=await resourceOwner(root,b.token),s=await inspectWorkspace(root,at);
  await assert.rejects(recoverWorkspace(root,{agent:'codex',sessionId:'new',taskId:'popup',expectedRevision:1,expectedFingerprint:s.fingerprint,expectedFence:a.fence,confirmPreviousSessionStopped:true,reason:'Previous session stopped'},at),/exact_expired/);
  const recovered=await recoverWorkspace(root,{agent:'codex',sessionId:'new',taskId:'popup',expectedRevision:1,expectedFingerprint:s.fingerprint,expectedFence:a.fence,confirmPreviousSessionStopped:true,reason:'Previous session stopped'},at+WORKSPACE_LEASE_MS+1);
  await assert.rejects(assertWorkspaceAccess(root,a.token,at),/not_lock_owner/);
  await assertWorkspaceAccess(root,recovered.token,at+WORKSPACE_LEASE_MS+1);
  assert.deepEqual(await resourceOwner(root,b.token),before);
});
test('explicit expired recovery clears only tickets whose command process has stopped',async t=>{
  const root=await fixture(t),at=Date.now(),owner=await claim(root,'stopped',true,at),other=await claim(root,'other',true,at);
  const file=path.join(root,'data/workspace/resources.json'),store=JSON.parse(await readFile(file,'utf8'));
  const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});
  assert.equal(child.status,0); assert.ok(child.pid);
  store.tickets.push({id:'00000000-0000-4000-8000-000000000001',tokenHash:hash(owner.token),pid:child.pid,resources:['local:reports/stopped'],state:'held',createdAt:new Date(at).toISOString()});
  store.tickets.push({id:'00000000-0000-4000-8000-000000000002',tokenHash:hash(other.token),pid:process.pid,resources:['local:reports/other'],state:'held',createdAt:new Date(at).toISOString()});
  await writeFile(file,JSON.stringify(store));
  const snapshot=await inspectWorkspace(root,at);
  const recovered=await recoverWorkspace(root,{agent:'codex',sessionId:'stopped-recovery',taskId:'stopped',expectedRevision:owner.revision,expectedFingerprint:snapshot.fingerprint,expectedFence:owner.fence,confirmPreviousSessionStopped:true,reason:'Recorded command has stopped; remote writes require separate reconciliation'},at+WORKSPACE_LEASE_MS+1);
  assert.ok(recovered.token);
  const after=await inspectWorkspace(root,at+WORKSPACE_LEASE_MS+1);
  assert.equal(after.queue.length,1); assert.equal(after.queue[0].id,'00000000-0000-4000-8000-000000000002');
  await assert.rejects(recoverWorkspace(root,{agent:'codex',sessionId:'other-recovery',taskId:'other',expectedRevision:other.revision,expectedFingerprint:after.fingerprint,expectedFence:other.fence,confirmPreviousSessionStopped:true,reason:'This command is still running'},at+WORKSPACE_LEASE_MS+1),/task_has_running_or_queued_operation_reconcile_required/);
});
test('release cannot abandon a held operation, and task handoffs do not change other revisions',async t=>{
  const root=await fixture(t),a=await claim(root,'popup'),b=await claim(root,'product');
  const s=await inspectWorkspace(root),notes={goal:'Popup',summary:'Prepared popup',progress:'ready-for-next-step',decisions:[],changes:[],checks:[],openItems:[],nextSteps:['Continue popup']};
  const input={token:a.token,expectedRevision:1,expectedFingerprint:s.fingerprint,notes,release:true};
  const release=await withResourceLock(root,['remote:site/post/42'],hash(a.token));
  await assert.rejects(checkpointWorkspace(root,input),/running_or_queued/);await release();
  await checkpointWorkspace(root,input);assert.equal((await resourceOwner(root,b.token))?.revision,1);
  await assert.rejects(assertWorkspaceAccess(root,a.token),/not_lock_owner/);
});
test('independent runs of the same page resolve the same remote resource; reused headers stay unlocked',async t=>{
  const root=await fixture(t);
  for(const id of ['run-a','run-b']){await mkdir(path.join(root,'runs',id),{recursive:true});await writeFile(path.join(root,'runs',id,'manifest.json'),JSON.stringify({targetOrigin:'https://site.test',slug:'contact',headerProvider:'reused-woodmart-header'}));await writeFile(path.join(root,'runs',id,'state.json'),JSON.stringify({checkpoints:{bound:{pageId:42},header:{headerId:'header-1'}}}));}
  const a=await runResources(root,'run-a'),b=await runResources(root,'run-b');
  assert.ok(a.includes(remoteResource('https://site.test','post',42)));assert.ok(b.includes(remoteResource('https://site.test','post',42)));
  assert.ok(!a.some(k=>k.includes('/header/')));assert.notEqual(remoteResource('https://other.test','post',42),remoteResource('https://site.test','post',42));
});

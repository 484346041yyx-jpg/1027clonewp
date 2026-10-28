import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { WORKSPACE_LEASE_MS, claimSchema, checkpointSchema, ownedSchema, lockSchema, recordRef, recoverSchema, handoffSchema } from './contracts.js';
import { atomicJson, captureWorkspace, changedFiles, fail, hash, readLocal, transaction, verifySnapshot } from './files.js';

// Separate storage deliberately preserves v1 state and tokens in already-running clients.
const FILE = 'data/workspace/resources.json';
export const resourceKey = z.string().min(1).max(500).regex(/^(?:local|remote|task):[a-z0-9][a-z0-9._:/-]*$/)
  .refine(s => !s.includes('..') && !s.includes('//') && !s.endsWith('/') && !s.includes('/./'));
export function resourceKeys(input: string[]): string[] {
  if (!input.length || input.length > 100) fail('resource_list_required');
  // Windows paths are case-insensitive; aliases must never create two locks.
  return [...new Set(input.map(s => resourceKey.parse(s.toLowerCase())))].sort();
}
export function resourcesOverlap(a: string[], b: string[]): boolean {
  return a.some(x => b.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/') || x === 'task:unscoped' || y === 'task:unscoped'));
}
const ownerSchema = lockSchema.extend({ revision: z.number().int().positive(), resources: z.array(resourceKey).min(1), head: recordRef.nullable() }).strict();
const ticketSchema = z.object({ id: z.string().uuid(), tokenHash: z.string(), pid: z.number().int().positive(), resources: z.array(resourceKey).min(1), state: z.enum(['waiting', 'held']), createdAt: z.string() }).strict();
const storeSchema = z.object({ version: z.literal(1), kind: z.literal('clonewp-resource-workspace'), fence: z.number().int().nonnegative(), owners: z.array(ownerSchema), tickets: z.array(ticketSchema), handoffs: z.array(z.object({taskId:z.string(),ref:recordRef}).strict()).default([]) }).strict();
type Store = z.infer<typeof storeSchema>;
export type ResourceOwner = z.infer<typeof ownerSchema>;
async function read(root: string): Promise<Store> {
  try { const store = storeSchema.parse(JSON.parse((await readLocal(root, FILE)).toString())); for (const owner of store.owners) verifySnapshot(owner.baseline); return store; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, kind: 'clonewp-resource-workspace', fence: 0, owners: [], tickets: [], handoffs: [] }; throw error; }
}
// Only the tiny metadata transaction retries. A remote operation is never retried here.
async function update<T>(root: string, fn: (store: Store) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 15000;
  for (;;) {
    try { return await transaction(root, async () => { const store = await read(root); const result = await fn(store); await atomicJson(root, FILE, store); return result; }); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'workspace_transaction_busy_inspect_before_repair' || Date.now() >= deadline) throw error; await delay(40); }
  }
}
export async function resourceOwner(root: string, token?: string) {
  if (!token) return undefined;
  return (await read(root)).owners.find(o => o.tokenHash === hash(token));
}
export async function hasResourceOperations(root: string, tokenHash: string) {
  return (await read(root)).tickets.some(t=>t.tokenHash===tokenHash);
}
export async function inspectResourceWorkspace(root: string, now = Date.now()) {
  const s = await read(root);
  const handoffs = await Promise.all(s.handoffs.map(async o => {
    const bytes = await readLocal(root, `data/workspace/handoffs/${o.ref.id}.json`);
    if (hash(bytes) !== o.ref.sha256) fail('handoff_hash_changed');
    return handoffSchema.parse(JSON.parse(bytes.toString()));
  }));
  return { tasks: s.owners.map(({ tokenHash: _token, baseline, ...o }) => ({ ...o, baselineFingerprint: baseline.fingerprint, expired: Date.parse(o.expiresAt) <= now })),
    queue: s.tickets.map(({ tokenHash: _token, ...ticket }) => ticket), taskHandoffs: handoffs };
}
export async function recoverResourceWorkspace(root: string, input: unknown, now = Date.now()) {
  const req = recoverSchema.parse(input);
  return update(root, async s => {
    const owner = s.owners.find(o => o.taskId === req.taskId && o.runId === req.runId);
    if (!owner || owner.fence !== req.expectedFence || owner.revision !== req.expectedRevision || Date.parse(owner.expiresAt) > now) fail('recovery_requires_exact_expired_owner');
    const staleTickets = s.tickets.filter(t => t.tokenHash === owner.tokenHash);
    for (const ticket of staleTickets) {
      try { process.kill(ticket.pid, 0); fail('task_has_running_or_queued_operation_reconcile_required'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    // An expired owner may be recovered only after every recorded command has
    // stopped. Remove its dead-process tickets in this same metadata transaction;
    // the run's unknown remote operation still requires separate reconciliation.
    s.tickets = s.tickets.filter(t => t.tokenHash !== owner.tokenHash);
    const snapshot = await captureWorkspace(root);
    if (snapshot.fingerprint !== req.expectedFingerprint) fail('stale_fingerprint_reload');
    const token = randomBytes(32).toString('hex'); s.fence++;
    owner.tokenHash = hash(token); owner.sessionId = req.sessionId; owner.agent = req.agent; owner.fence = s.fence; owner.revision++;
    owner.heartbeatAt = new Date(now).toISOString(); owner.expiresAt = new Date(now + WORKSPACE_LEASE_MS).toISOString();
    // Recovery records the transition and preserves the original baseline until reconciliation.
    const id = randomUUID(), file = `data/workspace/handoffs/${id}.json`;
    const record = handoffSchema.parse({version:1,kind:'clonewp-shared-handoff',authority:'reported-context-not-authorization',id,revision:owner.revision,createdAt:new Date(now).toISOString(),agent:owner.agent,sessionId:owner.sessionId,taskId:owner.taskId,...(owner.runId?{runId:owner.runId}:{}),fence:owner.fence,previous:owner.head,snapshot,changedFiles:changedFiles(owner.baseline,snapshot),notes:{goal:'Recover a stopped task',summary:req.reason,progress:'blocked',decisions:[],changes:[],checks:[],openItems:['Reconcile pending operations before writing'],nextSteps:['Read actual task state']}});
    await atomicJson(root,file,record,true); owner.head={id,sha256:hash(await readLocal(root,file))};
    s.handoffs=s.handoffs.filter(h=>h.taskId!==owner.taskId);s.handoffs.push({taskId:owner.taskId,ref:owner.head});
    return {revision:owner.revision,fence:owner.fence,token,expiresAt:owner.expiresAt,requiresVerification:true};
  });
}
export async function claimResourceWorkspace(root: string, input: unknown, now = Date.now()) {
  const req = claimSchema.extend({ resources: z.array(z.string()).min(1).max(100) }).strict().parse(input);
  const baseline = await captureWorkspace(root);
  if (baseline.fingerprint !== req.expectedFingerprint) fail('stale_fingerprint_reload');
  return update(root, async s => {
    if (s.owners.some(o => o.taskId === req.taskId)) fail('task_already_owned_explicit_recovery_required');
    const token = randomBytes(32).toString('hex'); s.fence++;
    const owner: ResourceOwner = { agent: req.agent, sessionId: req.sessionId, taskId: req.taskId, ...(req.runId ? { runId: req.runId } : {}), goal: req.goal ?? req.taskId,
      fence: s.fence, tokenHash: hash(token), claimedAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), expiresAt: new Date(now + WORKSPACE_LEASE_MS).toISOString(), baseline,
      revision: 1, resources: resourceKeys(req.resources), head: s.handoffs.find(h=>h.taskId===req.taskId)?.ref ?? null };
    s.owners.push(owner);
    return { revision: owner.revision, fence: owner.fence, token, expiresAt: owner.expiresAt, taskId: owner.taskId, coordination: 'resource-scoped' as const };
  });
}
export async function heartbeatResourceWorkspace(root: string, input: unknown, now = Date.now()) {
  const req = ownedSchema.parse(input);
  return update(root, async s => {
    const owner = s.owners.find(o => o.tokenHash === hash(req.token));
    if (!owner) fail('not_lock_owner');
    if (owner.revision !== req.expectedRevision) fail('stale_task_revision_reload');
    owner.revision++; owner.heartbeatAt = new Date(now).toISOString(); owner.expiresAt = new Date(now + WORKSPACE_LEASE_MS).toISOString();
    return { revision: owner.revision, fence: owner.fence, expiresAt: owner.expiresAt };
  });
}
export async function checkpointResourceWorkspace(root: string, input: unknown, now = Date.now()) {
  const req = checkpointSchema.parse(input);
  return update(root, async s => {
    const owner = s.owners.find(o => o.tokenHash === hash(req.token));
    if (!owner) fail('not_lock_owner');
    if (owner.revision !== req.expectedRevision) fail('stale_task_revision_reload');
    if (Date.parse(owner.expiresAt) <= now) fail('lease_expired_heartbeat_or_recover');
    if (s.tickets.some(t => t.tokenHash === owner.tokenHash)) fail('task_has_running_or_queued_operation');
    const snapshot = await captureWorkspace(root);
    if (snapshot.fingerprint !== req.expectedFingerprint) fail('stale_fingerprint_reload');
    if (owner.runId && req.notes.progress === 'completed') {
      const run = JSON.parse((await readLocal(root, `runs/${owner.runId}/state.json`)).toString());
      if (run.runId !== owner.runId || run.taskId !== owner.taskId) fail('run_identity_changed');
      if (run.pending || run.headerPending || ['write-unknown', 'restore-pending', 'conflict'].includes(run.status)) fail('pending_run_cannot_be_completed');
    }
    const id = randomUUID();
    const record = { version: 1, kind: 'clonewp-shared-handoff', authority: 'reported-context-not-authorization', id, revision: owner.revision + 1, createdAt: new Date(now).toISOString(),
      agent: owner.agent, sessionId: owner.sessionId, taskId: owner.taskId, ...(owner.runId ? { runId: owner.runId } : {}), fence: owner.fence, previous: owner.head, snapshot, changedFiles: changedFiles(owner.baseline, snapshot), notes: req.notes };
    const file = `data/workspace/handoffs/${id}.json`; await atomicJson(root, file, record, true);
    owner.head = { id, sha256: hash(await readLocal(root, file)) }; owner.revision++; owner.baseline = snapshot;
    s.handoffs=s.handoffs.filter(h=>h.taskId!==owner.taskId);s.handoffs.push({taskId:owner.taskId,ref:owner.head});
    const result = { revision: owner.revision, fence: owner.fence, released: req.release, record: owner.head };
    if (req.release) s.owners = s.owners.filter(o => o !== owner);
    else { owner.heartbeatAt = new Date(now).toISOString(); owner.expiresAt = new Date(now + WORKSPACE_LEASE_MS).toISOString(); }
    return result;
  });
}
export async function withResourceLock(root: string, keys: string[], tokenHash: string, options: { waitMs?: number; validate?: () => Promise<void> } = {}): Promise<() => Promise<void>> {
  const resources = resourceKeys(keys), id = randomUUID(), deadline = Date.now() + (options.waitMs ?? 120000);
  await update(root, async s => { s.tickets.push({ id, tokenHash, pid: process.pid, resources, state: 'waiting', createdAt: new Date().toISOString() }); });
  let held = false;
  try {
    while (!held) {
      if (Date.now() > deadline) fail('resource_wait_timeout');
      await options.validate?.();
      held = await update(root, async s => {
        const index = s.tickets.findIndex(t => t.id === id);
        if (index < 0) fail('resource_ticket_lost');
        const ticket = s.tickets[index];
        // Multi-resource grants are atomic. Disjoint tickets pass, overlapping ones remain FIFO.
        if (s.tickets.some((t, i) => t.id !== id && (t.state === 'held' || i < index) && resourcesOverlap(t.resources, resources))) return false;
        ticket.state = 'held'; return true;
      });
      if (!held) await delay(75);
    }
    await options.validate?.(); // Lease/CAS must still be fresh after waiting.
  } catch (error) {
    await update(root, async s => { s.tickets = s.tickets.filter(t => t.id !== id); }); throw error;
  }
  let released = false;
  return async () => { if (released) return; await update(root, async s => { const ticket = s.tickets.find(t => t.id === id); if (!ticket || ticket.tokenHash !== tokenHash) fail('resource_owner_changed'); s.tickets = s.tickets.filter(t => t.id !== id); }); released = true; };
}

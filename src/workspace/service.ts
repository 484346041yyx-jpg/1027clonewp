import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WORKSPACE_LEASE_MS, initialState, stateSchema, handoffSchema, claimSchema, ownedSchema, checkpointSchema, recoverSchema, type WorkspaceState, type SharedHandoff } from './contracts.js';
import { STATE, hash, fail, readLocal, atomicJson, transaction, captureWorkspace, changedFiles, inspectTransaction, verifySnapshot } from './files.js';
import { claimResourceWorkspace, resourceOwner, inspectResourceWorkspace, heartbeatResourceWorkspace, checkpointResourceWorkspace, recoverResourceWorkspace, hasResourceOperations } from './resources.js';

export async function readWorkspaceState(root: string): Promise<WorkspaceState> {
  try { const state = stateSchema.parse(JSON.parse((await readLocal(root, STATE)).toString())); if (state.lock) verifySnapshot(state.lock.baseline); return state; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initialState(); throw error; }
}
async function readHandoff(root: string, ref: NonNullable<WorkspaceState['head']>): Promise<SharedHandoff> {
  const bytes = await readLocal(root, `data/workspace/handoffs/${ref.id}.json`);
  if (hash(bytes) !== ref.sha256) fail('handoff_hash_changed');
  const record = handoffSchema.parse(JSON.parse(bytes.toString()));
  verifySnapshot(record.snapshot);
  if (record.id !== ref.id) fail('handoff_identity_changed');
  return record;
}
async function runObservation(root: string, runId?: string, taskId?: string) {
  if (!runId) return undefined;
  const bytes = await readLocal(root, `runs/${runId}/state.json`), row = JSON.parse(bytes.toString());
  if (!['clonewp-full-replica-run','clonewp-public-replica-run'].includes(row.kind) || row.runId !== runId || row.taskId !== taskId) fail('run_identity_changed');
  return { sha256: hash(bytes), pending: !!row.pending || !!row.headerPending || ['write-unknown', 'restore-pending', 'conflict'].includes(row.status) };
}
async function noRunningOperation(root: string) {
  try {
    const row = JSON.parse((await readLocal(root, '.cache/clone.lock', 4096)).toString());
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0) fail('operation_lock_unreadable');
    try { process.kill(row.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
    fail('operation_still_running');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function inspectWorkspace(root: string, now = Date.now()) {
  const state = await readWorkspaceState(root), snapshot = await captureWorkspace(root);
  const handoff = state.head ? await readHandoff(root, state.head) : null;
  if (handoff && (handoff.revision > state.revision || handoff.fence > state.fence)) fail('handoff_state_conflict');
  let run: Awaited<ReturnType<typeof runObservation>>;
  let runUnavailable = false;
  if (handoff?.runId) {
    try { run = await runObservation(root, handoff.runId, handoff.taskId); }
    catch { runUnavailable = true; }
  }
  const lock = state.lock ? (({ tokenHash: _token, baseline, ...owner }) => ({ ...owner, baselineFingerprint: baseline.fingerprint, expired: Date.parse(owner.expiresAt) <= now }))(state.lock) : null;
  return {
    ...await inspectResourceWorkspace(root, now),
    authority: 'reported-context-not-authorization' as const, revision: state.revision, fence: state.fence, lock,
    fingerprint: snapshot.fingerprint, rulesFingerprint: snapshot.rulesFingerprint,
    handoff, handoffFresh: handoff ? handoff.snapshot.fingerprint === snapshot.fingerprint && (!handoff.runId || run?.sha256 === handoff.runStateHash) : null,
    runStateChanged: handoff?.runId ? run?.sha256 !== handoff.runStateHash : false,
    runUnavailable,
    runHasPendingOperation: run?.pending ?? false,
    changedSinceHandoff: handoff ? changedFiles(handoff.snapshot, snapshot) : [],
    changedSinceClaim: state.lock ? changedFiles(state.lock.baseline, snapshot) : [],
    transaction: await inspectTransaction(root),
    nextAction: lock ? 'Respect the owner; expiry never grants permission to steal a lock.' : 'Read current rules and handoff; claim before making changes.',
  };
}
function revision(state: WorkspaceState, expected: number) { if (state.revision !== expected) fail('stale_revision_reload'); }
async function fingerprint(root: string, expected: string) {
  const snapshot = await captureWorkspace(root);
  if (snapshot.fingerprint !== expected) fail('stale_fingerprint_reload');
  return snapshot;
}
function owned(state: WorkspaceState, token: string) {
  if (!state.lock || state.lock.tokenHash !== hash(token)) fail('not_lock_owner');
  return state.lock!;
}
function lease(lock: NonNullable<WorkspaceState['lock']>, now: number) { if (Date.parse(lock.expiresAt) <= now) fail('lease_expired_heartbeat_or_recover'); }

export async function claimWorkspace(root: string, input: unknown, now = Date.now()) {
  if (input && typeof input === 'object' && 'resources' in input) {
    const legacy = await readWorkspaceState(root);
    if (legacy.lock && legacy.lock.taskId === (input as {taskId?:string}).taskId) fail('task_already_owned_explicit_recovery_required');
    return claimResourceWorkspace(root, input, now);
  }
  const request = claimSchema.parse(input);
  return transaction(root, async () => {
    const state = await readWorkspaceState(root); revision(state, request.expectedRevision);
    if (state.head) await readHandoff(root, state.head);
    if (state.lock) fail(Date.parse(state.lock.expiresAt) <= now ? 'expired_lock_requires_explicit_recovery' : 'writer_already_owned');
    const baseline = await fingerprint(root, request.expectedFingerprint), token = randomBytes(32).toString('hex');
    state.fence++; state.revision++;
    state.lock = { agent: request.agent, sessionId: request.sessionId, taskId: request.taskId, ...(request.runId ? { runId: request.runId } : {}), fence: state.fence, tokenHash: hash(token), claimedAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), expiresAt: new Date(now + WORKSPACE_LEASE_MS).toISOString(), baseline };
    state.lock.goal = request.goal ?? request.taskId;
    state.lock.runStateHash = (await runObservation(root, request.runId, request.taskId))?.sha256;
    await atomicJson(root, STATE, state);
    return { revision: state.revision, fence: state.fence, token, expiresAt: state.lock.expiresAt, taskId: state.lock.taskId };
  });
}
export async function heartbeatWorkspace(root: string, input: unknown, now = Date.now()) {
  const request = ownedSchema.parse(input);
  if (await resourceOwner(root, request.token)) return heartbeatResourceWorkspace(root, request, now);
  return transaction(root, async () => {
    const state = await readWorkspaceState(root); revision(state, request.expectedRevision);
    const lock = owned(state, request.token);
    lock.heartbeatAt = new Date(now).toISOString(); lock.expiresAt = new Date(now + WORKSPACE_LEASE_MS).toISOString(); state.revision++;
    await atomicJson(root, STATE, state);
    return { revision: state.revision, fence: lock.fence, expiresAt: lock.expiresAt };
  });
}
export async function checkpointWorkspace(root: string, input: unknown, now = Date.now()) {
  const request = checkpointSchema.parse(input);
  if (await resourceOwner(root, request.token)) return checkpointResourceWorkspace(root, request, now);
  return transaction(root, async () => {
    const state = await readWorkspaceState(root); revision(state, request.expectedRevision);
    if (state.head) await readHandoff(root, state.head);
    const lock = owned(state, request.token); lease(lock, now);
    if (request.release && await hasResourceOperations(root, lock.tokenHash)) fail('task_has_running_or_queued_operation');
    if (request.release) await noRunningOperation(root);
    const snapshot = await fingerprint(root, request.expectedFingerprint);
    const run = await runObservation(root, lock.runId, lock.taskId);
    if (run?.pending && request.notes.progress === 'completed') fail('pending_run_cannot_be_completed');
    const record = handoffSchema.parse({ version: 1, kind: 'clonewp-shared-handoff', authority: 'reported-context-not-authorization', id: randomUUID(), revision: state.revision + 1, createdAt: new Date(now).toISOString(), agent: lock.agent, sessionId: lock.sessionId, taskId: lock.taskId, ...(lock.runId ? { runId: lock.runId } : {}), fence: lock.fence, previous: state.head, snapshot, changedFiles: changedFiles(lock.baseline, snapshot), notes: request.notes });
    const name = `data/workspace/handoffs/${record.id}.json`;
    record.runStateHash = run?.sha256;
    await atomicJson(root, name, record, true);
    // Files can still be edited outside the protocol; refuse a known concurrent change.
    await fingerprint(root, snapshot.fingerprint);
    state.head = { id: record.id, sha256: hash(await readLocal(root, name)) }; state.revision++;
    if (request.release) state.lock = null;
    else { lock.baseline = snapshot; lock.heartbeatAt = new Date(now).toISOString(); lock.expiresAt = new Date(now + WORKSPACE_LEASE_MS).toISOString(); }
    await atomicJson(root, STATE, state);
    return { revision: state.revision, fence: state.fence, released: request.release, record: state.head };
  });
}
export async function recoverWorkspace(root: string, input: unknown, now = Date.now()) {
  const request = recoverSchema.parse(input);
  if ((await inspectResourceWorkspace(root, now)).tasks.some(o => o.taskId === request.taskId)) return recoverResourceWorkspace(root, request, now);
  return transaction(root, async () => {
    const state = await readWorkspaceState(root); revision(state, request.expectedRevision);
    if (state.head) await readHandoff(root, state.head);
    const old = state.lock;
    if (!old || old.fence !== request.expectedFence || Date.parse(old.expiresAt) > now) fail('recovery_requires_exact_expired_owner');
    if (old.taskId !== request.taskId || old.runId !== request.runId) fail('recovery_task_identity_changed');
    if (await hasResourceOperations(root, old.tokenHash)) fail('task_has_running_or_queued_operation_reconcile_required');
    await noRunningOperation(root);
    const snapshot = await fingerprint(root, request.expectedFingerprint), token = randomBytes(32).toString('hex');
    const record = handoffSchema.parse({ version: 1, kind: 'clonewp-shared-handoff', authority: 'reported-context-not-authorization', id: randomUUID(), revision: state.revision + 1, createdAt: new Date(now).toISOString(), agent: request.agent, sessionId: request.sessionId, taskId: request.taskId, ...(request.runId ? { runId: request.runId } : {}), fence: state.fence + 1, previous: state.head, snapshot, changedFiles: changedFiles(old.baseline, snapshot), notes: { goal: 'Recover an explicitly stopped local session', summary: request.reason, progress: 'blocked', decisions: ['No remote reconciliation or permission is granted by this recovery.'], changes: [], checks: [], openItems: ['Recheck current files and any pending remote operations before continuing.'], nextSteps: ['Read the previous handoff and actual task state.'] }, recovery: { previousAgent: old.agent, previousSession: old.sessionId, reason: request.reason } });
    const run = await runObservation(root, request.runId, request.taskId);
    record.runStateHash = run?.sha256;
    const name = `data/workspace/handoffs/${record.id}.json`; await atomicJson(root, name, record, true);
    await fingerprint(root, snapshot.fingerprint);
    state.fence++; state.revision++;
    state.head = { id: record.id, sha256: hash(await readLocal(root, name)) };
    state.lock = { agent: request.agent, sessionId: request.sessionId, taskId: request.taskId, ...(request.runId ? { runId: request.runId } : {}), fence: state.fence, tokenHash: hash(token), claimedAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), expiresAt: new Date(now + WORKSPACE_LEASE_MS).toISOString(), baseline: snapshot };
    state.lock.goal = request.goal ?? old.goal ?? request.taskId;
    state.lock.runStateHash = run?.sha256;
    await atomicJson(root, STATE, state);
    return { revision: state.revision, fence: state.fence, token, expiresAt: state.lock.expiresAt, requiresVerification: true };
  });
}
/** Supplemental gate. An uninitialized/idle workspace preserves existing CLI behavior.
 * It does not replace the site's operation lock, ownership, CAS, or readback. */
export async function assertWorkspaceAccess(root: string, token = process.env.CLONEWP_WORKSPACE_TOKEN, now = Date.now()) {
  const scoped = await resourceOwner(root, token);
  if (scoped) { lease(scoped, now); return; }
  const state = await readWorkspaceState(root);
  if (!state.lock && !(await inspectResourceWorkspace(root, now)).tasks.length) return;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) fail('writer_token_required');
  lease(owned(state, token), now);
}
export const repairInputSchema = z.object({ expectedTransactionHash: z.string().regex(/^[a-f0-9]{64}$/), confirmNoRunningCommand: z.literal(true) }).strict();

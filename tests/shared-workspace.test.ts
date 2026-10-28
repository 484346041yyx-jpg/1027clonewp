import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { claimWorkspace, checkpointWorkspace, heartbeatWorkspace, inspectWorkspace, recoverWorkspace, assertWorkspaceAccess, readWorkspaceState } from '../src/workspace/service.js';
import { captureWorkspace, readLocal, hash, inspectTransaction, repairTransaction, transaction } from '../src/workspace/files.js';
import { runWorkspaceCLI, parseWorkspaceArgs } from '../src/workspace/cli.js';
import { WORKSPACE_LEASE_MS, type HandoffNotes } from '../src/workspace/contracts.js';
import type { ContextLoadResult } from '../src/context/contracts.js';
import { acquireLock } from '../src/core/files.js';
import { SOURCE_OBSERVER_TOOLS } from '../src/replica-v2/observers.js';
import { execWorkspace } from '../src/workspace/exec.js';

const workspace = path.resolve(import.meta.dirname, '..');
const now = Date.parse('2026-10-25T00:00:00.000Z');
const notes = (): HandoffNotes => ({ goal: 'Shared maintenance', summary: 'Updated the current implementation', progress: 'ready-for-next-step', decisions: ['Use the same rules'], changes: ['Changed the example module'], checks: [{ command: 'npm test', status: 'passed' }], openItems: ['Actual site is unverified'], nextSteps: ['Read the current source before continuing'] });
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(workspace, '.cache', 'workspace-test-'));
  t.after(async () => { assert.equal(path.dirname(root), path.join(workspace, '.cache')); await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, 'src'));
  for (const file of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', 'CLAUDE.md']) await writeFile(path.join(root, file), file + '\nOne shared rule set.');
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'src/example.ts'), 'export const value = 1;\n');
  return root;
}
async function claim(root: string, client: 'codex' | 'claude' | 'workbuddy' = 'codex', at = now) {
  const status = await inspectWorkspace(root, at);
  return claimWorkspace(root, { agent: client, sessionId: client + '-session', taskId: 'shared-task', expectedRevision: status.revision, expectedFingerprint: status.fingerprint }, at);
}
const readyContext: ContextLoadResult = { status: 'ready', exitCode: 0, intent: 'maintain', documents: [], records: [], components: [], gaps: [], nextAction: 'Read common rules', metrics: { elapsedMs: 0, filesRead: 0, bytesRead: 0, networkRequests: 0, credentialLoads: 0, browserStarts: 0, fileWrites: 0 } };

test('all three startup identities call the same reader exactly once and startup never writes', async t => {
  const root = await fixture(t); let calls = 0;
  const services = { loadContext: async () => { calls++; return structuredClone(readyContext); } };
  const before = await readdir(root);
  const a = await runWorkspaceCLI(['start', '--agent', 'codex', '--intent', 'maintain'], root, undefined, services) as any;
  const b = await runWorkspaceCLI(['start', '--agent', 'claude', '--intent', 'maintain'], root, undefined, services) as any;
  const c = await runWorkspaceCLI(['start', '--agent', 'workbuddy', '--intent', 'maintain'], root, undefined, services) as any;
  assert.equal(calls, 3); assert.deepEqual(a.context, b.context); assert.deepEqual(a.shared, b.shared);
  assert.equal(a.remoteWrites, 0); assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(c.agent, 'workbuddy'); assert.equal(c.status, 'ready'); assert.equal(c.remoteWrites, 0);
  assert.deepEqual(await readdir(root), before);
  await assert.rejects(readFile(path.join(root, 'data/workspace/state.json')), { code: 'ENOENT' });
});

test('a WorkBuddy record identity claims and hands off without changing the observation identity', async t => {
  const root = await fixture(t), owner = await claim(root, 'workbuddy');
  assert.equal((await readWorkspaceState(root)).lock?.agent, 'workbuddy');
  const status = await inspectWorkspace(root, now);
  await checkpointWorkspace(root, { token: owner.token, expectedRevision: owner.revision, expectedFingerprint: status.fingerprint, notes: { ...notes(), summary: 'WorkBuddy kept the claude_browser observation identity' }, release: true }, now);
  const after = await inspectWorkspace(root, now);
  assert.equal(after.handoff?.agent, 'workbuddy'); assert.equal(after.lock, null);
  // The record identity never becomes a browser observation identity.
  assert.equal(SOURCE_OBSERVER_TOOLS.includes('workbuddy' as never), false);
  // This client identity contract does not freeze the independent observer registry.
  assert.equal(SOURCE_OBSERVER_TOOLS.includes('cua_repl'), true);
  assert.equal(SOURCE_OBSERVER_TOOLS.includes('claude_browser'), true);
});

test('Codex -> Claude -> Codex handoff preserves decisions, checks, changed files and the hash chain', async t => {
  const root = await fixture(t), a = await claim(root);
  await writeFile(path.join(root, 'src/example.ts'), 'export const value = 2;\n');
  let status = await inspectWorkspace(root, now);
  await checkpointWorkspace(root, { token: a.token, expectedRevision: a.revision, expectedFingerprint: status.fingerprint, notes: notes(), release: true }, now);
  status = await inspectWorkspace(root, now);
  assert.equal(status.handoff?.agent, 'codex'); assert.equal(status.handoffFresh, true); assert.equal(status.lock, null);
  assert.deepEqual(status.handoff?.changedFiles, ['src/example.ts']);
  assert.deepEqual(status.handoff?.notes.checks, notes().checks);
  const first = (await readWorkspaceState(root)).head;
  const b = await claim(root, 'claude');
  await writeFile(path.join(root, 'SYSTEM.md'), 'Changed shared rules.\n');
  const fresh = await inspectWorkspace(root, now);
  assert.equal(fresh.handoffFresh, false); assert.ok(fresh.changedSinceHandoff.includes('SYSTEM.md'));
  assert.notEqual(fresh.rulesFingerprint, status.rulesFingerprint);
  await checkpointWorkspace(root, { token: b.token, expectedRevision: b.revision, expectedFingerprint: fresh.fingerprint, notes: { ...notes(), summary: 'Claude continued the same work' }, release: true }, now);
  status = await inspectWorkspace(root, now);
  assert.equal(status.handoff?.agent, 'claude'); assert.deepEqual(status.handoff?.previous, first);
  const c = await claim(root, 'codex'); assert.ok(c.fence > b.fence);
  const bytes = await readFile(path.join(root, 'data/workspace/state.json'), 'utf8');
  assert.ok(!bytes.includes(a.token) && !bytes.includes(b.token) && !bytes.includes(c.token));
});

test('concurrent claimants yield exactly one owner, and stale startup receipts cannot claim', async t => {
  const root = await fixture(t), status = await inspectWorkspace(root, now);
  const request = { agent: 'codex', sessionId: 'one', taskId: 'shared-task', expectedRevision: 0, expectedFingerprint: status.fingerprint };
  const results = await Promise.allSettled([claimWorkspace(root, request, now), claimWorkspace(root, { ...request, agent: 'claude', sessionId: 'two' }, now)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal((await inspectWorkspace(root, now)).revision, 1);
  await assert.rejects(claimWorkspace(root, request, now), /stale_revision|writer_already/);
});

test('a changed source invalidates an old fingerprint before owner state is installed', async t => {
  const root = await fixture(t), status = await inspectWorkspace(root, now);
  await writeFile(path.join(root, 'src/example.ts'), 'changed');
  await assert.rejects(claimWorkspace(root, { agent: 'claude', sessionId: 'two', taskId: 'shared-task', expectedRevision: 0, expectedFingerprint: status.fingerprint }, now), /stale_fingerprint/);
  assert.equal((await inspectWorkspace(root, now)).lock, null);
});

test('wrong and expired tokens cannot write; expiry never steals ownership', async t => {
  const root = await fixture(t), owner = await claim(root);
  await assert.rejects(assertWorkspaceAccess(root, '', now), /writer_token_required/);
  await assert.rejects(assertWorkspaceAccess(root, '0'.repeat(64), now), /not_lock_owner/);
  await assert.doesNotReject(assertWorkspaceAccess(root, owner.token, now));
  await assert.rejects(assertWorkspaceAccess(root, owner.token, now + WORKSPACE_LEASE_MS), /lease_expired/);
  const status = await inspectWorkspace(root, now + WORKSPACE_LEASE_MS);
  await assert.rejects(claimWorkspace(root, { agent: 'claude', sessionId: 'two', taskId: 'shared-task', expectedRevision: owner.revision, expectedFingerprint: status.fingerprint }, now + WORKSPACE_LEASE_MS), /expired_lock_requires/);
  const beat = await heartbeatWorkspace(root, { token: owner.token, expectedRevision: owner.revision }, now + WORKSPACE_LEASE_MS);
  await assert.doesNotReject(assertWorkspaceAccess(root, owner.token, now + WORKSPACE_LEASE_MS));
  assert.ok(beat.revision > owner.revision);
});

test('explicit expired recovery fences out the old tool and records an unverified transition', async t => {
  const root = await fixture(t), owner = await claim(root), later = now + WORKSPACE_LEASE_MS + 1;
  const status = await inspectWorkspace(root, later);
  const request = { agent: 'claude', sessionId: 'replacement', taskId: 'shared-task', expectedRevision: owner.revision, expectedFingerprint: status.fingerprint, expectedFence: owner.fence, confirmPreviousSessionStopped: true, reason: 'Previous local session has stopped' };
  await assert.rejects(recoverWorkspace(root, request, now), /exact_expired_owner/);
  const next = await recoverWorkspace(root, request, later);
  assert.ok(next.fence > owner.fence);
  await assert.rejects(heartbeatWorkspace(root, { token: owner.token, expectedRevision: next.revision }, later), /not_lock_owner/);
  await assert.doesNotReject(assertWorkspaceAccess(root, next.token, later));
  assert.equal((await inspectWorkspace(root, later)).handoff?.notes.progress, 'blocked');
});

test('handoff CAS refuses stale revisions, stale file bytes and token disclosure without releasing the owner', async t => {
  const root = await fixture(t), owner = await claim(root), status = await inspectWorkspace(root, now);
  const input = { token: owner.token, expectedRevision: owner.revision, expectedFingerprint: status.fingerprint, notes: notes(), release: true };
  await assert.rejects(checkpointWorkspace(root, { ...input, expectedRevision: 0 }, now), /stale_revision/);
  await assert.rejects(checkpointWorkspace(root, { ...input, notes: { ...notes(), summary: owner.token } }, now));
  await assert.rejects(checkpointWorkspace(root, { ...input, notes: { ...notes(), summary: 'Cookie=private' } }, now));
  await assert.rejects(checkpointWorkspace(root, { ...input, notes: { ...notes(), summary: 'See https://example.test/?nonce=private' } }, now));
  await writeFile(path.join(root, 'src/example.ts'), 'different');
  await assert.rejects(checkpointWorkspace(root, input, now), /stale_fingerprint/);
  const state = await readWorkspaceState(root); assert.equal(state.revision, 1); assert.ok(state.lock); assert.equal(state.head, null);
});

test('reported handoff cannot call a pending native run completed and later run changes are visible', async t => {
  const root = await fixture(t); await mkdir(path.join(root, 'runs/native-run'), { recursive: true });
  const stateFile = path.join(root, 'runs/native-run/state.json');
  await writeFile(stateFile, JSON.stringify({ kind: 'clonewp-full-replica-run', runId: 'native-run', taskId: 'shared-task', status: 'write-unknown', pending: { phase: 'body' } }));
  let status = await inspectWorkspace(root, now);
  const owner = await claimWorkspace(root, { agent: 'codex', sessionId: 'one', taskId: 'shared-task', runId: 'native-run', expectedRevision: 0, expectedFingerprint: status.fingerprint }, now);
  const input = { token: owner.token, expectedRevision: owner.revision, expectedFingerprint: status.fingerprint, notes: { ...notes(), progress: 'completed' }, release: true };
  await assert.rejects(checkpointWorkspace(root, input, now), /pending_run_cannot/);
  await checkpointWorkspace(root, { ...input, notes: { ...notes(), progress: 'blocked' } }, now);
  status = await inspectWorkspace(root, now); assert.equal(status.runHasPendingOperation, true);
  await writeFile(stateFile, JSON.stringify({ kind: 'clonewp-full-replica-run', runId: 'native-run', taskId: 'shared-task', status: 'awaiting-review', pending: null }));
  status = await inspectWorkspace(root, now); assert.equal(status.runStateChanged, true); assert.equal(status.handoffFresh, false);
  await rm(stateFile); status = await inspectWorkspace(root, now); assert.equal(status.runUnavailable, true);
});

test('tampered handoff hashes and internal snapshot identities fail closed', async t => {
  const root = await fixture(t), owner = await claim(root), status = await inspectWorkspace(root, now);
  await checkpointWorkspace(root, { token: owner.token, expectedRevision: 1, expectedFingerprint: status.fingerprint, notes: notes(), release: true }, now);
  const state = await readWorkspaceState(root), file = path.join(root, 'data/workspace/handoffs', state.head!.id + '.json');
  const record = JSON.parse(await readFile(file, 'utf8')); record.notes.summary = 'Independently changed';
  await writeFile(file, JSON.stringify(record));
  await assert.rejects(inspectWorkspace(root, now), /handoff_hash_changed/);
});

test('local operation locks block release and recovery while a command is alive', async t => {
  const root = await fixture(t), owner = await claim(root), status = await inspectWorkspace(root, now);
  await writeFile(path.join(root, '.cache/clone.lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(checkpointWorkspace(root, { token: owner.token, expectedRevision: 1, expectedFingerprint: status.fingerprint, notes: notes(), release: true }, now), /operation_still_running/);
  assert.ok((await readWorkspaceState(root)).lock);
});

test('transaction repair checks a dead PID and exact bytes without changing the task owner', async t => {
  const root = await fixture(t), owner = await claim(root), before = await readFile(path.join(root, 'data/workspace/state.json'));
  const file = path.join(root, '.cache/workspace-transaction.lock');
  await writeFile(file, JSON.stringify({ pid: process.pid, nonce: 'live' }));
  let observed = await inspectTransaction(root); assert.equal(observed!.alive, true);
  await assert.rejects(repairTransaction(root, observed!.sha256), /repair_precondition/);
  await writeFile(file, JSON.stringify({ pid: 2147483647, nonce: 'dead' }));
  observed = await inspectTransaction(root); assert.equal(observed!.alive, false);
  await assert.rejects(repairTransaction(root, hash('wrong')), /repair_precondition/);
  await repairTransaction(root, observed!.sha256);
  assert.deepEqual(await readFile(path.join(root, 'data/workspace/state.json')), before);
  assert.equal((await inspectWorkspace(root, now)).fence, owner.fence);
});

test('reparse metadata and escaped paths cannot redirect shared writes outside the project', async t => {
  const root = await fixture(t), other = await fixture(t);
  await assert.rejects(readLocal(root, '../other.json'), /path_escape/);
  await mkdir(path.join(root, 'data'));
  try { await symlink(other, path.join(root, 'data/workspace'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Host does not allow a junction'); return; } throw error; }
  await assert.rejects(inspectWorkspace(root, now), /reparse_point/);
  assert.deepEqual((await readdir(other)).sort(), ['AGENTS.md', 'CLAUDE.md', 'COMPONENTS.md', 'SYSTEM.md', 'package.json', 'src']);
});

test('existing protected lock behavior remains unchanged when shared state is absent or idle', async t => {
  const root = await fixture(t); const release = await acquireLock(root); await release();
  assert.equal((await readWorkspaceState(root)).revision, 0);
  const owner = await claim(root, 'codex', Date.now()), status = await inspectWorkspace(root);
  await checkpointWorkspace(root, { token: owner.token, expectedRevision: 1, expectedFingerprint: status.fingerprint, notes: notes(), release: true });
  const released = await acquireLock(root); await released();
});

test('existing protected write gate rejects the other tool and accepts only the owner environment', async t => {
  const root = await fixture(t), owner = await claim(root, 'codex', Date.now());
  const previous = process.env.CLONEWP_WORKSPACE_TOKEN;
  try {
    delete process.env.CLONEWP_WORKSPACE_TOKEN;
    await assert.rejects(acquireLock(root), /writer_token_required/);
    process.env.CLONEWP_WORKSPACE_TOKEN = '0'.repeat(64);
    await assert.rejects(acquireLock(root), /not_lock_owner/);
    process.env.CLONEWP_WORKSPACE_TOKEN = owner.token;
    const release = await acquireLock(root); await release();
    assert.equal((await readWorkspaceState(root)).revision, owner.revision);
  } finally {
    if (previous === undefined) delete process.env.CLONEWP_WORKSPACE_TOKEN;
    else process.env.CLONEWP_WORKSPACE_TOKEN = previous;
  }
});

test('CLI rejects token arguments and malformed stdin without echoing secrets', async t => {
  const root = await fixture(t);
  assert.throws(() => parseWorkspaceArgs(['claim', '--token', 'private']), /arguments_invalid/);
  const run = (input: string) => new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    const child = execFile(process.execPath, ['--import', pathToFileURL(path.join(workspace, 'node_modules/tsx/dist/loader.mjs')).href, path.join(workspace, 'src/workspace/cli.ts'), 'claim'], { cwd: root, timeout: 15000 }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr })); child.stdin!.end(input);
  });
  const invalid = await run('{"password":"PRIVATE_TEST_VALUE"}');
  assert.equal(invalid.code, 1); assert.doesNotMatch(invalid.stdout + invalid.stderr, /PRIVATE_TEST_VALUE/);
  assert.equal((await readWorkspaceState(root)).revision, 0);
});

test('exec only launches a registered command and injects the capability in memory, never argv', async t => {
  const root = await fixture(t), owner = await claim(root, 'codex', Date.now());
  await mkdir(path.join(root, 'tools'));
  await writeFile(path.join(root, 'tools/build.mjs'), `import fs from 'node:fs';import crypto from 'node:crypto';const token=process.env.CLONEWP_WORKSPACE_TOKEN;fs.writeFileSync('.cache/exec-receipt.json',JSON.stringify({hasToken:!!token,inArgs:process.argv.includes(token),matches:crypto.createHash('sha256').update(token).digest('hex')===process.argv[2]}));`);
  const previous = process.env.CLONEWP_WORKSPACE_TOKEN;
  await assert.rejects(execWorkspace(root, { token: owner.token, command: 'arbitrary-shell', args: [] }));
  await assert.rejects(execWorkspace(root, { token: owner.token, command: 'build', args: [owner.token] }), /token_in_arguments/);
  const result = await execWorkspace(root, { token: owner.token, command: 'build', args: [hash(owner.token)] });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.cache/exec-receipt.json'), 'utf8')), { hasToken: true, inArgs: false, matches: true });
  assert.equal(process.env.CLONEWP_WORKSPACE_TOKEN, previous);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(owner.token));
});

test('CLI can read a compact stdin packet without closing the input pipe', async t => {
  const root = await fixture(t);
  const result = await new Promise<{ code: number; stdout: string }>(resolve => {
    const child = execFile(process.execPath, ['--import', pathToFileURL(path.join(workspace, 'node_modules/tsx/dist/loader.mjs')).href, path.join(workspace, 'src/workspace/cli.ts'), 'claim'], { cwd: root, timeout: 5000 }, (error, stdout) => resolve({ code: error ? 1 : 0, stdout }));
    child.stdin!.write('{"unexpected":"private-test-value"}\n');
  });
  assert.equal(result.code, 1); assert.match(result.stdout, /workspace_invalid/); assert.doesNotMatch(result.stdout, /private-test-value/);
});

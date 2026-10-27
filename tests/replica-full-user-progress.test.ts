import test from 'node:test';
import assert from 'node:assert/strict';
import { fullReplicaUserProgress, USER_PROGRESS_STAGES } from '../src/replica-full/user-progress.js';
import { preparationJobStale, preparationLeaseUntil, preparationStaleMinutes, PREPARATION_LEASE_MS } from '../src/replica-preparation/lease.js';
import type { FullReplicaRunState } from '../src/replica-full/types.js';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const run = (value: Record<string, unknown> = {}): FullReplicaRunState => ({
  version: 1, kind: 'clonewp-full-replica-run', taskId: 'task', runId: 'run', manifestHash: 'a'.repeat(64),
  status: 'preparing', revision: 0, createdAt: at(60), updatedAt: at(1), pending: null, checkpoints: {}, review: null, ...value,
} as unknown as FullReplicaRunState);

test('preparation lease expires 30 minutes after start and only reports stale, never rewrites status', () => {
  const startedAt = '2026-10-24T11:00:00.000Z';
  assert.equal(PREPARATION_LEASE_MS, 30 * 60_000);
  assert.equal(preparationLeaseUntil(startedAt), '2026-10-24T11:30:00.000Z');
  assert.equal(preparationLeaseUntil('not-a-date'), undefined);
  const running = { status: 'running', startedAt };
  assert.equal(preparationJobStale(running, Date.parse('2026-10-24T11:29:59.000Z')), false);
  assert.equal(preparationJobStale(running, Date.parse('2026-10-24T11:30:01.000Z')), true);
  assert.equal(preparationStaleMinutes(running, Date.parse('2026-10-24T12:00:00.000Z')), 30);
  assert.equal(preparationJobStale({ status: 'complete', startedAt }, NOW), false);
  assert.equal(preparationJobStale({ status: 'running' }, NOW), false);
  assert.equal(preparationJobStale({ status: 'running', startedAt, leaseUntil: '2026-10-24T13:00:00.000Z' }, NOW), false);
});

test('user progress maps four internal state machines onto five user stages without claiming completion', () => {
  const fresh = fullReplicaUserProgress(run(), null, NOW);
  assert.equal(fresh.step, 2); assert.equal(fresh.total, 5); assert.deepEqual(fresh.stages.map(stage => stage.label), [...USER_PROGRESS_STAGES]);
  assert.equal(fresh.stages[0].status, 'done'); assert.equal(fresh.stages[1].status, 'active'); assert.equal(fresh.stages[2].status, 'pending');
  assert.equal(fresh.needsYou, null); assert.equal(fresh.stalled, false);

  const merged = fullReplicaUserProgress(run(), { merged: true, jobs: [{ jobId: 'body-1', status: 'complete' }] }, NOW);
  assert.equal(merged.stages[1].status, 'done'); assert.equal(merged.step, 2);

  const writing = fullReplicaUserProgress(run({ status: 'building', checkpoints: { page: {} } }), { merged: true, jobs: [] }, NOW);
  assert.equal(writing.step, 3); assert.equal(writing.stages[2].status, 'active'); assert.match(writing.headline, /写入/);

  const waitingReview = fullReplicaUserProgress(run({ status: 'awaiting-review', checkpoints: { bound: {} } }), { merged: true, jobs: [] }, NOW);
  assert.equal(waitingReview.step, 4); assert.equal(waitingReview.stages[3].status, 'active'); assert.equal(waitingReview.needsYou, null);

  const approved = fullReplicaUserProgress(run({ status: 'reviewed', checkpoints: { bound: {} }, review: { decision: 'approved' } }), null, NOW);
  assert.equal(approved.step, 5); assert.equal(approved.stages[4].status, 'active'); assert.match(approved.needsYou!.action, /发布/);

  const published = fullReplicaUserProgress(run({ status: 'published', checkpoints: { bound: {}, published: { status: 'publish', publicUrl: 'https://target.example/page/' } } }), null, NOW);
  assert.equal(published.step, 5); assert.ok(published.stages.every(stage => stage.status === 'done'));
  assert.equal(published.needsYou, null); assert.equal(published.stalled, false); assert.equal(published.stalledMinutes, null); assert.match(published.waitingOn, /https:\/\/target\.example/);

  const changes = fullReplicaUserProgress(run({ status: 'review-changes-required', checkpoints: { bound: {} }, review: { decision: 'changes-required' } }), null, NOW);
  assert.equal(changes.stages[3].status, 'blocked'); assert.match(changes.needsYou!.action, /差异/);

  const unknown = fullReplicaUserProgress(run({ status: 'write-unknown', pending: { phase: 'body', operationId: 'op' }, checkpoints: { bound: {} } }), null, NOW);
  assert.equal(unknown.step, 3); assert.equal(unknown.stages[2].status, 'blocked'); assert.match(unknown.needsYou!.action, /对账/); assert.match(unknown.waitingOn, /对账/);
});

test('silence is surfaced as stalled instead of looking active', () => {
  const quiet = fullReplicaUserProgress(run({ updatedAt: at(40) }), null, NOW);
  assert.equal(quiet.stalled, true); assert.equal(quiet.stalledMinutes, 40); assert.match(quiet.needsYou!.reason, /静默 40 分钟/);

  const deadJob = fullReplicaUserProgress(run({ updatedAt: at(1) }), { merged: false, jobs: [{ jobId: 'header', status: 'running', startedAt: at(60) }] }, NOW);
  assert.equal(deadJob.stalled, true); assert.deepEqual(deadJob.stalledJobs, ['header']); assert.equal(deadJob.stages[1].status, 'blocked'); assert.equal(deadJob.stalledMinutes, 30);

  const liveJob = fullReplicaUserProgress(run({ updatedAt: at(1) }), { merged: false, jobs: [{ jobId: 'header', status: 'running', startedAt: at(5) }] }, NOW);
  assert.equal(liveJob.stalled, false); assert.equal(liveJob.stages[1].status, 'active'); assert.match(liveJob.stages[1].detail, /header/);
});

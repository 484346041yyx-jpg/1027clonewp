import test from 'node:test';
import assert from 'node:assert/strict';
import { FullReplicaReviewBarrier } from '../src/replica-full/review-barrier.js';
import type { FullReplicaBoundCheckpoint, FullReplicaReview } from '../src/replica-full/types.js';
import type { FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';

const bound: FullReplicaBoundCheckpoint = { pageId: 12, runId: 'speed-test', headerId: 'header_speed', editUrl: 'https://target.example/edit', previewUrl: 'https://target.example/preview', bodyHash: 'a'.repeat(64), cssHash: 'b'.repeat(64), documentHash: 'c'.repeat(64), headerHash: 'd'.repeat(64), menuHash: 'e'.repeat(64), styleHash: 'f'.repeat(64) };
const review = () => ({ version: 1, kind: 'clonewp-full-replica-review', taskId: 'speed-test', runId: 'speed-test', pageId: 12, fingerprint: 'a'.repeat(64), decision: 'approved', observedAt: new Date().toISOString(), reviewerEvidence: { path: 'actual-review.json', sha256: 'b'.repeat(64) }, viewports: [] }) as FullReplicaReview;
const snapshot = () => ({ hash: '9'.repeat(64), page: { pageId: 12 }, header: { snapshot: { globalHash: '8'.repeat(64) } }, receipts: {} }) as unknown as FullReplicaRemoteSnapshot;

test('fresh verified observation is copied and consumed once within its command, without another read', () => {
  const barrier = new FullReplicaReviewBarrier(() => 100), r = review(), s = snapshot();
  barrier.remember(r, bound, s); s.hash = 'changed';
  assert.equal(barrier.take(r, bound)?.hash, '9'.repeat(64));
  assert.equal(barrier.take(r, bound), null);
});
test('changed page, body, CSS, header, menu or style cannot reuse verification', () => {
  for (const key of ['pageId', 'bodyHash', 'cssHash', 'documentHash', 'headerId', 'headerHash', 'menuHash', 'styleHash'] as const) {
    const barrier = new FullReplicaReviewBarrier(), r = review(); barrier.remember(r, bound, snapshot());
    assert.equal(barrier.take(r, { ...bound, [key]: key === 'pageId' ? 13 : 'changed' }), null);
    assert.equal(barrier.take(r, bound), null);
  }
});
test('changed review, another object or another command cannot reuse verification', () => {
  const barrier = new FullReplicaReviewBarrier(), r = review(); barrier.remember(r, bound, snapshot());
  assert.equal(barrier.take(structuredClone(r), bound), null);
  assert.equal(new FullReplicaReviewBarrier().take(r, bound), null);
  r.reviewerEvidence.sha256 = '7'.repeat(64);
  assert.equal(barrier.take(r, bound), null);
});
test('expired or backwards-clock observations force a new verification', () => {
  let now = 1_000; const barrier = new FullReplicaReviewBarrier(() => now), r = review();
  barrier.remember(r, bound, snapshot()); now = 31_001; assert.equal(barrier.take(r, bound), null);
  barrier.remember(r, bound, snapshot()); now = 31_000; assert.equal(barrier.take(r, bound), null);
});

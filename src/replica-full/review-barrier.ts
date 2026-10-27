import { fullReplicaFingerprint, fullReplicaHash } from './contract.js';
import type { FullReplicaBoundCheckpoint, FullReplicaReview } from './types.js';
import type { FullReplicaRemoteSnapshot } from './driver.js';

/** One command may consume its own fresh verification once; never a persisted cache. */
export class FullReplicaReviewBarrier {
  private readonly proofs = new WeakMap<FullReplicaReview, { fingerprint: string; reviewHash: string; at: number; snapshot: FullReplicaRemoteSnapshot }>();
  constructor(private readonly now: () => number = Date.now) {}
  remember(review: FullReplicaReview, bound: FullReplicaBoundCheckpoint, snapshot: FullReplicaRemoteSnapshot): void {
    this.proofs.set(review, { fingerprint: fullReplicaFingerprint(bound), reviewHash: fullReplicaHash(review), at: this.now(), snapshot: structuredClone(snapshot) });
  }
  take(review: FullReplicaReview, bound: FullReplicaBoundCheckpoint): FullReplicaRemoteSnapshot | null {
    const proof = this.proofs.get(review); this.proofs.delete(review);
    if (!proof || this.now() < proof.at || this.now() - proof.at > 30_000 || proof.fingerprint !== fullReplicaFingerprint(bound) || proof.reviewHash !== fullReplicaHash(review)) return null;
    return proof.snapshot;
  }
}

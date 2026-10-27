/** A running preparation job carries a lease so a dead agent turn becomes
 * visible as stale instead of looking active forever. The lease is advisory:
 * it never changes the stored status, it only lets readers report the gap. */
export const PREPARATION_LEASE_MS = 30 * 60_000;

export interface PreparationLeaseRow { status: string; startedAt?: string; leaseUntil?: string }

export function preparationLeaseUntil(startedAt: string, leaseMs = PREPARATION_LEASE_MS): string | undefined {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return undefined;
  return new Date(started + leaseMs).toISOString();
}

/** True only for a job that still claims to run past its lease; callers keep the stored status untouched. */
export function preparationJobStale(row: PreparationLeaseRow, now = Date.now(), leaseMs = PREPARATION_LEASE_MS): boolean {
  if (row.status !== 'running' || !row.startedAt) return false;
  const started = Date.parse(row.startedAt);
  if (!Number.isFinite(started)) return false;
  const lease = row.leaseUntil ? Date.parse(row.leaseUntil) : NaN;
  const expiry = Number.isFinite(lease) ? lease : started + leaseMs;
  return now > expiry;
}

/** Minutes a stale job has been silent, rounded down; null when the row is not stale. */
export function preparationStaleMinutes(row: PreparationLeaseRow, now = Date.now(), leaseMs = PREPARATION_LEASE_MS): number | null {
  if (!preparationJobStale(row, now, leaseMs)) return null;
  const expiry = row.leaseUntil && Number.isFinite(Date.parse(row.leaseUntil)) ? Date.parse(row.leaseUntil) : Date.parse(row.startedAt!) + leaseMs;
  return Math.max(0, Math.floor((now - expiry) / 60_000));
}

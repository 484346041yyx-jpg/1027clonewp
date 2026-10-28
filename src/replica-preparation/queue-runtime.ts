import { z } from 'zod';
import type { PreparationFileRef, PreparationJob } from './types.js';

export const preparationWorkerSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
export interface PreparationQueueAttempt { startedAt: string; finishedAt: string; elapsedMs: number; status: 'failed' }
export interface PreparationCompletedAttempt {
  result: PreparationFileRef; originalSha256: string; startedAt: string; finishedAt: string; elapsedMs: number;
  workRevision: number; request: PreparationFileRef;
}
export interface PreparationQueueRow {
  job: PreparationJob; status: 'ready' | 'running' | 'complete' | 'failed';
  workerId?: string; workRevision?: number; startedAt?: string; finishedAt?: string; elapsedMs?: number;
  previousAttempts?: PreparationQueueAttempt[]; previousResults?: PreparationCompletedAttempt[];
}
const jobId = z.string().regex(/^(?:header|body-[1-9][0-9]{0,3})$/).refine(value => value === 'header' || Number(value.slice(5)) <= 2000);
export const preparationReworkSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-preparation-rework'), taskId: preparationWorkerSchema,
  runId: preparationWorkerSchema, contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  requests: z.array(z.object({ jobId, expectedResultSha256: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2000) }).strict()).min(1).max(2001),
}).strict().refine(value => new Set(value.requests.map(row => row.jobId)).size === value.requests.length, { message: 'rework_job_duplicate' });

/** Logical worker labels do not grant workspace or remote authority. Running stale jobs still occupy slots. */
export function assertPreparationQueueCapacity(rows: PreparationQueueRow[], maxWorkers: number, workerId: string) {
  preparationWorkerSchema.parse(workerId);
  if (rows.some(row => row.status === 'running' && row.workerId === workerId)) throw Error('replica_preparation_worker_busy');
  if (rows.filter(row => row.status === 'running').length >= maxWorkers) throw Error('replica_preparation_queue_capacity');
}
export function nextPreparationQueueRow<T extends PreparationQueueRow>(rows: T[], workerId: string): T | undefined {
  return rows.filter(row => row.status === 'ready' && (!row.workerId || row.workerId === workerId))
    .sort((a, b) => Number(b.workerId === workerId) - Number(a.workerId === workerId)
      || b.job.estimatedEffort - a.job.estimatedEffort || a.job.jobId.localeCompare(b.job.jobId, undefined, { numeric: true }))[0];
}

/** Interval union is elapsed active wall time. Sum of worker occupancy is explicitly not user wait time. */
export function preparationQueueTiming(rows: PreparationQueueRow[], now = Date.now()) {
  const intervals: Array<[number, number]> = [];
  const add = (start?: string, end?: string) => {
    if (!start) return;
    const a = Date.parse(start), b = end ? Date.parse(end) : now;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) throw Error('replica_preparation_clock_changed');
    intervals.push([a, b]);
  };
  for (const row of rows) {
    for (const previous of [...row.previousAttempts ?? [], ...row.previousResults ?? []]) add(previous.startedAt, previous.finishedAt);
    if (row.status !== 'ready') add(row.startedAt, row.finishedAt);
  }
  const sorted = intervals.sort((a, b) => a[0] - b[0]), union: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const previous = union.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else union.push([start, end]);
  }
  return {
    measurement: 'utc-wall-intervals' as const,
    activeWallMs: union.reduce((sum, [a, b]) => sum + b - a, 0),
    spanMs: sorted.length ? sorted.reduce((latest, row) => Math.max(latest, row[1]), sorted[0][1]) - sorted[0][0] : 0,
    workerOccupancyMs: intervals.reduce((sum, [a, b]) => sum + b - a, 0),
    durationRule: 'activeWallMs is interval union; workerOccupancyMs is not user wait or pure model time',
    pureModelTime: 'not-measured' as const,
  };
}

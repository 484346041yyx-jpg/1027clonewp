import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { FullReplicaDependencies } from '../replica-full/types.js';

export const PREPARATION_TIMING_STAGES = [
  'preparation-preflight', 'header-plan', 'body-content-plan', 'body-interaction-plan', 'merge',
  'source-observation', 'shared-planning', 'material-preparation',
  'prepareHeader', 'prepareBody', 'assertPreparedBody', 'createPage', 'provisionHeader', 'saveBody',
  'bindHeader', 'bindReusedHeader', 'reviewWholePage', 'verifyReview', 'publishPage', 'publishWithoutReview', 'reviseStyle', 'reviseHeaderStyle',
  'reviseNativeMotion', 'reviseLayout', 'reviseNavigationReturn', 'reconcileOperation', 'rebaseCurrentDraft',
] as const;
export type PreparationTimingStage = typeof PREPARATION_TIMING_STAGES[number];
export type PreparationTimingStatus = 'succeeded' | 'failed' | 'cancelled';
export type PreparationTimingSource = 'local-function' | 'agent-dispatch' | 'agent-start' | 'external-observation';
export interface TimingClock { monotonicNow(): number; utcNow(): string }
export interface PreparationTimingEntry {
  id: string; stage: PreparationTimingStage; source: PreparationTimingSource;
  status: 'running' | PreparationTimingStatus; startedAt: string;
  finishedAt?: string; elapsedMs?: number;
  /** A cancelled observer cannot claim that an external worker actually stopped. */
  completionObserved?: boolean;
}
export interface PreparationTimingDocument {
  version: 1; kind: 'clonewp-preparation-timings'; command: string; measurementId: string;
  status: 'running' | PreparationTimingStatus; startedAt: string; finishedAt?: string;
  wallElapsedMs: number;
  /** Entries can overlap or nest. Never sum them as total elapsed time. */
  durationRule: 'wall-clock-total; phase-durations-may-overlap';
  stages: PreparationTimingEntry[];
}
export interface TimingIO { writeAtomic(filename: string, document: PreparationTimingDocument): Promise<void> }
export interface PreparationTimingOptions {
  runDirectory: string; command: string; clock?: TimingClock; io?: TimingIO; id?: string;
}
export interface PreparationTimingRecorder {
  readonly filename: string;
  measure<T>(stage: PreparationTimingStage, work: () => Promise<T> | T): Promise<T>;
  externalStart(stage: PreparationTimingStage, options: { source: Exclude<PreparationTimingSource, 'local-function'> }): Promise<string>;
  externalFinish(marker: string, status: PreparationTimingStatus): Promise<void>;
  flush(): Promise<void>;
  finish(status: PreparationTimingStatus): Promise<void>;
  summary(): PreparationTimingDocument;
}

const stageSet = new Set<string>(PREPARATION_TIMING_STAGES);
const commandSet = new Set(['prepare', 'run', 'amend-unwritten-body-style', 'resume', 'review', 'publish', 'reconcile', 'rebase-current-draft', 'recover-style', 'revise-style', 'revise-header-style', 'revise-native-motion', 'revise-layout', 'revise-navigation-return']);
const statusSet = new Set(['succeeded', 'failed', 'cancelled']);
const sourceSet = new Set(['agent-dispatch', 'agent-start', 'external-observation']);
const systemClock: TimingClock = { monotonicNow: () => performance.now(), utcNow: () => new Date().toISOString() };

function atomicTimingIO(): TimingIO {
  const written = new Set<string>();
  return { async writeAtomic(filename, document) {
    const directory = path.dirname(filename), resolved = await realpath(directory), info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(directory).toLowerCase() !== resolved.toLowerCase()) throw Error('replica_preparation_timing_path_invalid');
    const space = await statfs(directory);
    if (space.bavail * space.bsize < 512 * 1024 * 1024) throw Error('replica_preparation_timing_space');
    const reservation = `${filename}.lock`, lease = await open(reservation, 'wx');
    const temporary = path.join(directory, `.timing-${randomUUID()}.tmp`);
    try {
      await lease.close();
      if (written.has(filename)) {
        const existing = await lstat(filename);
        if (!existing.isFile() || existing.isSymbolicLink() || (await realpath(filename)).toLowerCase() !== filename.toLowerCase()) throw Error('replica_preparation_timing_path_invalid');
      } else {
        let exists = false; try { await lstat(filename); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (exists) throw Error('replica_preparation_timing_identity_exists');
      }
      const handle = await open(temporary, 'wx');
      try { await handle.writeFile(JSON.stringify(document, null, 2) + '\n', 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, filename); written.add(filename);
    } finally {
      try { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
      finally { await unlink(reservation); }
    }
  } };
}

/** Local diagnostics only: no arguments, outputs, URLs, error text, or model prompts enter this file. */
export function createPreparationTiming(options: PreparationTimingOptions): PreparationTimingRecorder {
  if (!commandSet.has(options.command)) throw Error('replica_preparation_timing_command_invalid');
  const measurementId = options.id ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(measurementId)) throw Error('replica_preparation_timing_id_invalid');
  const filename = path.resolve(options.runDirectory, `timings-${options.command}-${measurementId}.json`);
  const clock = options.clock ?? systemClock, io = options.io ?? atomicTimingIO();
  const starts = new Map<string, number>();
  let lastTick = clock.monotonicNow();
  if (!Number.isFinite(lastTick)) throw Error('replica_preparation_timing_clock_invalid');
  const commandStart = lastTick;
  const utc = () => { const value = clock.utcNow(); if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('replica_preparation_timing_clock_invalid'); return value; };
  const tick = () => { const value = clock.monotonicNow(); if (!Number.isFinite(value) || value < lastTick) throw Error('replica_preparation_timing_clock_invalid'); lastTick = value; return value; };
  const document: PreparationTimingDocument = {
    version: 1, kind: 'clonewp-preparation-timings', command: options.command, measurementId,
    status: 'running', startedAt: utc(), wallElapsedMs: 0,
    durationRule: 'wall-clock-total; phase-durations-may-overlap', stages: [],
  };
  let queue = Promise.resolve(), failed = false, finished = false;
  const available = () => { if (failed) throw Error('replica_preparation_timing_persist_failed'); if (finished) throw Error('replica_preparation_timing_closed'); };
  const snapshot = (): PreparationTimingDocument => structuredClone({ ...document, wallElapsedMs: finished ? document.wallElapsedMs : tick() - commandStart });
  const flush = async () => {
    if (failed) throw Error('replica_preparation_timing_persist_failed');
    const value = snapshot();
    const operation = queue.then(async () => {
      if (failed) throw Error('replica_preparation_timing_persist_failed');
      try { await io.writeAtomic(filename, value); }
      catch { failed = true; throw Error('replica_preparation_timing_persist_failed'); }
    });
    queue = operation.catch(() => {});
    return operation;
  };
  const start = (stage: PreparationTimingStage, source: PreparationTimingSource) => {
    available(); if (!stageSet.has(stage)) throw Error('replica_preparation_timing_stage_invalid');
    const entry: PreparationTimingEntry = { id: randomUUID(), stage, source, status: 'running', startedAt: utc() };
    starts.set(entry.id, tick()); document.stages.push(entry); return entry;
  };
  const end = (entry: PreparationTimingEntry, status: PreparationTimingStatus, observed: boolean) => {
    if (!statusSet.has(status)) throw Error('replica_preparation_timing_status_invalid');
    if (entry.status !== 'running') throw Error('replica_preparation_timing_already_finished');
    entry.finishedAt = utc(); entry.elapsedMs = tick() - starts.get(entry.id)!; entry.status = status; entry.completionObserved = observed;
  };
  return {
    filename,
    async measure<T>(stage: PreparationTimingStage, work: () => Promise<T> | T): Promise<T> {
      const entry = start(stage, 'local-function'); await flush();
      try {
        available(); const result = await work();
        if (entry.status === 'running') { end(entry, 'succeeded', true); await flush(); }
        return result;
      } catch (error) {
        if (entry.status === 'running') {
          end(entry, error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed', true); await flush();
        }
        throw error;
      }
    },
    async externalStart(stage, options) {
      if (!sourceSet.has(options.source)) throw Error('replica_preparation_timing_source_invalid');
      const entry = start(stage, options.source); await flush(); return entry.id;
    },
    async externalFinish(marker, status) {
      available(); const entry = document.stages.find(row => row.id === marker);
      if (!entry || entry.source === 'local-function') throw Error('replica_preparation_timing_marker_invalid');
      end(entry, status, true); await flush();
    },
    flush,
    async finish(status) {
      if (failed) throw Error('replica_preparation_timing_persist_failed');
      if (finished) { if (document.status !== status) throw Error('replica_preparation_timing_already_finished'); await queue; return; }
      if (!statusSet.has(status)) throw Error('replica_preparation_timing_status_invalid');
      for (const entry of document.stages) if (entry.status === 'running') end(entry, 'cancelled', false);
      document.status = status; document.finishedAt = utc(); document.wallElapsedMs = tick() - commandStart;
      finished = true; await flush();
    },
    summary: snapshot,
  };
}

/** Keep values and call order intact; persistence failure prevents the next wrapped remote call. */
export function wrapFullReplicaDependencies<T extends Omit<FullReplicaDependencies, 'writeState'>>(dependencies: T, timing: PreparationTimingRecorder): T {
  const wrapped = { ...dependencies };
  for (const stage of PREPARATION_TIMING_STAGES) {
    const original = (dependencies as unknown as Record<string, unknown>)[stage];
    if (typeof original === 'function') (wrapped as unknown as Record<string, unknown>)[stage] = (...args: unknown[]) => timing.measure(stage, () => original.apply(dependencies, args));
  }
  return wrapped;
}

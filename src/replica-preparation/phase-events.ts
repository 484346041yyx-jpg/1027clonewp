import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = 'D:/cloneWP';
export const PREPARATION_PHASE_STAGES = ['source-observation', 'shared-planning', 'material-preparation', 'visual-acceptance'] as const;
export type PreparationPhaseStage = typeof PREPARATION_PHASE_STAGES[number];
export type PreparationPhaseEvent = 'start' | 'succeeded' | 'failed' | 'cancelled';
export interface PreparationPhaseEntry {
  marker: string; stage: PreparationPhaseStage; status: 'running' | Exclude<PreparationPhaseEvent, 'start'>;
  startedAt: string; finishedAt?: string; elapsedMs?: number; clockSkewDetected?: boolean;
}
export interface PreparationPhaseDocument {
  version: 1; kind: 'clonewp-preparation-phase-events';
  durationSource: 'cross-command-utc-wall'; monotonic: false;
  entries: PreparationPhaseEntry[];
}
export interface PreparationPhaseResult {
  marker: string; timingFile: string; stage: PreparationPhaseStage; event: PreparationPhaseEvent; entry: PreparationPhaseEntry;
}
const stages = new Set<string>(PREPARATION_PHASE_STAGES);
const events = new Set(['start', 'succeeded', 'failed', 'cancelled']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
function fail(code: string): never { throw Error(`replica_preparation_phase_${code}`); }

/** The caller creates its owned task material directory. This module cannot create a task or a site. */
async function checkedDirectory(input: string): Promise<string> {
  if (typeof input !== 'string') fail('directory_invalid');
  const root = await realpath(ROOT), directory = path.resolve(input), relative = path.relative(root, directory), parts = relative.split(path.sep);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || parts.length !== 2 || !['references', 'runs'].includes(parts[0]) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(parts[1])) fail('directory_scope');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part); const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) fail('directory_reparse');
  }
  return directory;
}
async function checkedFile(filename: string): Promise<boolean> {
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024 || (await realpath(filename)).toLowerCase() !== filename.toLowerCase()) fail('file_invalid');
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function validateDocument(input: unknown): PreparationPhaseDocument {
  const document = input as PreparationPhaseDocument;
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || Object.keys(document).sort().join(',') !== 'durationSource,entries,kind,monotonic,version'
    || document.version !== 1 || document.kind !== 'clonewp-preparation-phase-events' || document.durationSource !== 'cross-command-utc-wall' || document.monotonic !== false || !Array.isArray(document.entries)) fail('log_invalid');
  const seen = new Set<string>();
  for (const row of document.entries) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !uuid.test(row.marker) || seen.has(row.marker) || !stages.has(row.stage)
      || !['running', 'succeeded', 'failed', 'cancelled'].includes(row.status) || !utc.test(row.startedAt) || !Number.isFinite(Date.parse(row.startedAt))) fail('log_invalid');
    seen.add(row.marker);
    const expectedKeys = row.status === 'running' ? 'marker,stage,startedAt,status' : 'clockSkewDetected,elapsedMs,finishedAt,marker,stage,startedAt,status';
    if (Object.keys(row).sort().join(',') !== expectedKeys) fail('log_invalid');
    if (row.status !== 'running') {
      if (typeof row.finishedAt !== 'string' || !utc.test(row.finishedAt) || !Number.isFinite(Date.parse(row.finishedAt))
        || typeof row.elapsedMs !== 'number' || !Number.isFinite(row.elapsedMs) || row.elapsedMs !== Date.parse(row.finishedAt) - Date.parse(row.startedAt)
        || row.clockSkewDetected !== (row.elapsedMs < 0)) fail('log_invalid');
    }
  }
  return document;
}
async function readDocument(directory: string): Promise<PreparationPhaseDocument | null> {
  const filename = path.join(directory, 'phase-events.json'); if (!await checkedFile(filename)) return null;
  let input: unknown; try { input = JSON.parse(await readFile(filename, 'utf8')); } catch { fail('log_invalid'); }
  return validateDocument(input);
}
/** Missing stages remain absent: no estimates or zero placeholders are created. */
export async function readPreparationPhases(input: string): Promise<PreparationPhaseDocument | null> {
  return readDocument(await checkedDirectory(input));
}

async function acquire(directory: string): Promise<() => Promise<void>> {
  const filename = path.join(directory, '.phase-events.lock'), token = randomUUID(), deadline = performance.now() + 1500;
  while (true) {
    try {
      const handle = await open(filename, 'wx');
      try { await handle.writeFile(JSON.stringify({ token }), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      return async () => {
        if (!await checkedFile(filename)) fail('lock_changed');
        let current: unknown; try { current = JSON.parse(await readFile(filename, 'utf8')); } catch { fail('lock_changed'); }
        if (!current || typeof current !== 'object' || (current as { token?: unknown }).token !== token) fail('lock_changed');
        await unlink(filename);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await checkedFile(filename);
      if (performance.now() >= deadline) fail('lock_busy');
      await sleep(25);
    }
  }
}
async function persist(directory: string, document: PreparationPhaseDocument): Promise<void> {
  const space = await statfs(directory); if (space.bavail * space.bsize < 512 * 1024 * 1024) fail('evidence_space');
  const filename = path.join(directory, 'phase-events.json'); await checkedFile(filename);
  const serialized = JSON.stringify(document, null, 2) + '\n'; if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) fail('log_size');
  const temporary = path.join(directory, `.phase-events-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

/** Only fixed stage names, generated IDs, UTC boundaries and outcome enter the task-local log. */
export async function recordPreparationPhase(input: string, stage: PreparationPhaseStage, event: PreparationPhaseEvent, marker?: string): Promise<PreparationPhaseResult> {
  if (!stages.has(stage)) fail('stage_invalid'); if (!events.has(event)) fail('event_invalid');
  if (event === 'start' ? marker !== undefined : typeof marker !== 'string' || !uuid.test(marker)) fail('marker_invalid');
  const directory = await checkedDirectory(input), release = await acquire(directory);
  try {
    const document = await readDocument(directory) ?? { version: 1, kind: 'clonewp-preparation-phase-events', durationSource: 'cross-command-utc-wall', monotonic: false, entries: [] };
    let entry: PreparationPhaseEntry;
    if (event === 'start') {
      entry = { marker: randomUUID(), stage, status: 'running', startedAt: new Date().toISOString() }; document.entries.push(entry);
    } else {
      const found = document.entries.find(row => row.marker === marker);
      if (!found || found.stage !== stage || found.status !== 'running') fail('marker_conflict');
      const finishedAt = new Date().toISOString(), elapsedMs = Date.parse(finishedAt) - Date.parse(found.startedAt);
      Object.assign(found, { status: event, finishedAt, elapsedMs, clockSkewDetected: elapsedMs < 0 }); entry = found;
    }
    validateDocument(document); await persist(directory, document);
    const observed = await readDocument(directory);
    if (!observed || JSON.stringify(observed) !== JSON.stringify(document)) fail('readback_changed');
    return { marker: entry.marker, timingFile: path.join(directory, 'phase-events.json'), stage, event, entry: structuredClone(entry) };
  } finally { await release(); }
}

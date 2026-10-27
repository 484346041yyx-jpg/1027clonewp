import path from 'node:path';
import { mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ContextReader, contextContained, contextHash, contextId } from './files.js';
import type { ContextIndex, ContextRunIndexEntry, ContextTaskIndexEntry } from './contracts.js';
import { readCurrentRelease } from '../components/registry.js';
import type { SystemRelease } from '../system/contracts.js';

const identityKeys = ['version', 'workflow', 'mode', 'taskId', 'jobId', 'runId', 'url', 'sourceUrl', 'executionStrategy', 'replicationProfile', 'selectionRulesHash', 'programHash', 'programSha256', 'programPath', 'inputDesignPath', 'inputDesignSha256', 'componentCatalog', 'knowledge', 'releaseLock', 'releaseLockRef'];
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export function contextRecordIdentity(value: Record<string, unknown>): string { return contextHash(JSON.stringify(canonical(Object.fromEntries(identityKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))))); }
export function contextRecordMode(value: Record<string, unknown>): 'replica' | undefined {
  if (value.workflow !== 'block-replication' || ![1, 2].includes(Number(value.version)) || typeof value.version !== 'number' || value.mode !== undefined && value.mode !== 'replica') return undefined;
  if (value.executionStrategy !== undefined && (value.executionStrategy !== 'native44-css-handoff' || value.version !== 2)) return undefined;
  if (value.replicationProfile !== undefined && (value.replicationProfile !== 'desktop-browser-v1' || value.executionStrategy !== 'native44-css-handoff' || typeof value.selectionRulesHash !== 'string' || !/^[a-f\d]{64}$/.test(value.selectionRulesHash))) return undefined;
  if (value.replicationProfile === undefined && value.selectionRulesHash !== undefined) return undefined;
  return 'replica';
}
async function childDirectories(root: string, name: string): Promise<string[]> {
  let entries; try { entries = await readdir(path.join(root, name), { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  if (entries.length > 10_000) throw Error('context_index_directory_limit');
  return entries.filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && contextId(entry.name)).map(entry => entry.name).sort();
}
/** Bounded direct-child scan; no source dumps, documents, reports, credentials or mutable state are indexed. */
export async function scanContextIndex(root: string, suppliedReader?: ContextReader): Promise<ContextIndex> {
  const reader = suppliedReader ?? new ContextReader(await realpath(root));
  const index: ContextIndex = { version: 1, kind: 'clonewp-context-index', tasks: [], runs: [], issues: [] };
  const jobRunLinks = new Map<string, string>();
  for (const family of ['references']) for (const directory of await childDirectories(reader.root, family)) {
    const relative = `${family}/${directory}/job.json`;
    try {
      const { data, path: filename } = await reader.json(relative), mode = contextRecordMode(data), taskId = data.taskId ?? data.jobId;
      if (!mode || !contextId(taskId) || taskId !== directory && data.jobId !== directory || (data.mode !== undefined && data.mode !== mode)) throw Error('context_job_identity_invalid');
      index.tasks.push({ taskId, mode, job: { path: filename, identityHash: contextRecordIdentity(data) } });
      if (contextId(data.runId)) jobRunLinks.set(data.runId, taskId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') index.issues.push({ code: error instanceof Error && /^context_/.test(error.message) ? error.message : 'context_job_unreadable', path: relative }); }
  }
  for (const runId of await childDirectories(reader.root, 'runs')) {
    for (const recordKind of ['journal', 'result'] as const) {
      const relative = `runs/${runId}/${recordKind}.json`;
      try {
        const { data, path: filename } = await reader.json(relative), mode = contextRecordMode(data);
        if (!mode || data.runId !== runId || (data.mode !== undefined && data.mode !== mode)) throw Error('context_run_identity_invalid');
        let taskId = contextId(data.taskId) ? data.taskId : jobRunLinks.get(runId);
        if (!taskId && typeof data.inputDesignPath === 'string') { const parent = path.dirname(path.resolve(reader.root, data.inputDesignPath)); taskId = index.tasks.find(task => task.mode === mode && path.dirname(task.job.path) === parent)?.taskId; }
        index.runs.push({ runId, ...(taskId ? { taskId } : {}), mode, recordKind, record: { path: filename, identityHash: contextRecordIdentity(data) } }); break;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { index.issues.push({ code: error instanceof Error && /^context_/.test(error.message) ? error.message : 'context_run_unreadable', path: relative }); break; } }
    }
  }
  return index;
}
export function validateContextIndex(value: unknown): ContextIndex {
  const index = value as ContextIndex;
  if (!index || index.version !== 1 || index.kind !== 'clonewp-context-index' || !Array.isArray(index.tasks) || !Array.isArray(index.runs) || !Array.isArray(index.issues)) throw Error('context_index_invalid');
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
  for (const task of index.tasks) if (!contextId(task.taskId) || !['original', 'replica'].includes(task.mode) || typeof task.job?.path !== 'string' || !hash(task.job.identityHash)) throw Error('context_index_task_invalid');
  for (const run of index.runs) if (!contextId(run.runId) || (run.taskId !== undefined && !contextId(run.taskId)) || !['original', 'replica'].includes(run.mode) || !['journal', 'result'].includes(run.recordKind) || typeof run.record?.path !== 'string' || !hash(run.record.identityHash)) throw Error('context_index_run_invalid');
  if (new Set(index.tasks.map(item => item.taskId)).size !== index.tasks.length || new Set(index.runs.map(item => item.runId)).size !== index.runs.length) throw Error('context_index_duplicate_identity');
  if (index.contracts) {
    const contracts = index.contracts, references = [contracts.componentSet?.ref, contracts.knowledge?.ref, ...(contracts.selectionRules?.files ?? []), ...(contracts.adapters?.files ?? [])];
    if (!contextId(contracts.componentSet?.id) || !contextId(contracts.knowledge?.id) || !contextId(contracts.selectionRules?.id) || !contextId(contracts.adapters?.id) || !hash(contracts.knowledge?.fingerprint) || !hash(contracts.selectionRules?.sha256) || !hash(contracts.adapters?.sha256) || references.some(ref => !ref || typeof ref.path !== 'string' || !hash(ref.sha256))) throw Error('context_index_contract_invalid');
  }
  return index;
}
/** Explicit mutation entrypoint; lifecycle hooks call this after confirmed local persistence. */
export async function refreshContextIndex(root: string, dependencies: { readRelease(root: string): Promise<SystemRelease> } = { readRelease: readCurrentRelease }): Promise<ContextIndex> {
  const actualRoot = await realpath(root), index = await scanContextIndex(actualRoot);
  const release = await dependencies.readRelease(actualRoot);
  index.contracts = { componentSet: { id: release.componentSet.id, ref: release.componentSet.catalog }, knowledge: { id: release.knowledge.id, fingerprint: release.knowledge.fingerprint, ref: release.knowledge.index }, selectionRules: release.selectionRules, adapters: release.adapters };
  const directory = path.join(actualRoot, 'data', 'system'); await mkdir(directory, { recursive: true }); contextContained(actualRoot, await realpath(directory));
  const filename = path.join(directory, 'context-index.json'), temporary = path.join(directory, `.context-index-${randomUUID()}.tmp`);
  try { await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
  return index;
}
export function selectContextRecords(index: ContextIndex, input: { task?: string; run?: string }): { task?: ContextTaskIndexEntry; run?: ContextRunIndexEntry; candidates?: Array<{ taskId?: string; runId?: string; mode: string }> } {
  if (input.task !== undefined && !contextId(input.task) || input.run !== undefined && !contextId(input.run)) throw Error('context_selector_invalid');
  const task = input.task ? index.tasks.find(item => item.taskId === input.task) : undefined;
  if (input.task && !task) throw Error('context_task_not_found');
  const runs = index.runs.filter(item => (!input.run || item.runId === input.run) && (!task || item.taskId === task.taskId));
  if (input.run && runs.length !== 1) throw Error('context_run_not_found_or_task_conflict');
  if (runs.length > 1) return { task, candidates: runs.map(item => ({ taskId: item.taskId, runId: item.runId, mode: item.mode })) };
  if (runs.length === 1) { const run = runs[0]; return { run, task: task ?? index.tasks.find(item => item.taskId === run.taskId) }; }
  if (task) return { task };
  if (index.tasks.length === 1) return { task: index.tasks[0] };
  return { candidates: index.tasks.map(item => ({ taskId: item.taskId, mode: item.mode })) };
}

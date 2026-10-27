import path from 'node:path';
import { mkdir, readFile, stat, statfs } from 'node:fs/promises';
import { z } from 'zod';
import { acquireLock, writeJson } from '../core/files.js';
import { editorHash, editorScopeSchema, type EditorScope } from './contract.js';
import { editorPath } from './store.js';
import { assertEditorRecoveryPage, executeEditorRecoveryAction, nextEditorRecoveryAction, packetSchema, type EditorLoadingAdapter, type EditorRecoveryAction, type EditorRecoveryEvent, type EditorRecoveryResult } from './recovery.js';

const requestSchema = z.object({ version: z.literal(2), scope: editorScopeSchema,
  incidentId: z.string().regex(/^[a-zA-Z0-9][\w-]{0,79}$/), cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  event: packetSchema.shape.events.unwrap().element.optional(),
}).strict();
export type DurableRecoveryRequest = z.infer<typeof requestSchema>;
interface RecoveryRecord { version: 1; scope: EditorScope; incidentId: string; startedAt: number; events: EditorRecoveryEvent[]; pending?: EditorRecoveryAction; revision: number }
function assertPersistableEvent(scope: EditorScope, event: EditorRecoveryEvent) {
  if ((event.kind === 'probe' || event.kind === 'guard') && event.result.outcome === 'ok') {
    assertEditorRecoveryPage(scope, event.result.observation);
    // Browser performance.timeOrigin, not a browser binding or arbitrary text.
    if (!/^\d+(?:\.\d+)?$/.test(event.result.observation.documentId)) throw Error('editor_recovery_document_identity');
  }
}

/** Only sanitized observations are stored. Claims precede refresh/connection dispatch.
 * A lost refresh response consumes the allowance instead of inviting a second reload. */
export async function advanceEditorRecovery(runDir: string, input: unknown, now = Date.now()) {
  const request = requestSchema.parse(input);
  if (request.event) assertPersistableEvent(request.scope, request.event);
  const child = await editorPath(runDir, 'editor-runtime', true);
  try { await mkdir(child); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const directory = await editorPath(runDir, child), cache = await editorPath(directory, '.cache', true);
  try { await mkdir(cache); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  await editorPath(directory, '.cache');
  const unlock = await acquireLock(directory);
  try {
    const file = await editorPath(directory, `${editorHash(request.scope)}-${request.incidentId}.json`, true);
    let record: RecoveryRecord;
    try {
      if ((await stat(file)).size > 256 * 1024) throw Error('editor_recovery_state_size');
      record = JSON.parse(await readFile(file, 'utf8'));
      if (record.version !== 1 || editorHash(record.scope) !== editorHash(request.scope) || record.incidentId !== request.incidentId
        || !Number.isSafeInteger(record.startedAt) || record.startedAt > now || !Number.isSafeInteger(record.revision)) throw Error('editor_recovery_state_identity');
      packetSchema.parse({ version: 1, scope: record.scope, events: record.events });
      record.events.forEach(event => assertPersistableEvent(record.scope, event));
      const before = nextEditorRecoveryAction({ version: 1, scope: record.scope, events: record.events });
      if (editorHash(record.pending ?? null) !== editorHash(before.status === 'continue' ? before.action : null)) throw Error('editor_recovery_pending_changed');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      if (request.cursor || request.event) throw Error('editor_recovery_state_missing');
      record = { version: 1, scope: request.scope, incidentId: request.incidentId, startedAt: now, events: [], revision: 0 };
    }
    if (request.cursor && request.cursor !== editorHash(record)) throw Error('editor_recovery_stale_cursor');
    if (request.event) {
      if (!request.cursor || request.event.kind !== record.pending?.kind) throw Error('editor_recovery_event_without_claim');
      record.events.push({ ...request.event, elapsedMs: Math.max(request.event.elapsedMs, now - record.startedAt) });
    } else if (record.pending?.kind === 'refresh' || record.pending?.kind === 'reconnect') {
      // The previously returned operation might already have run. Never dispatch again.
      const elapsedMs = Math.max(now - record.startedAt, record.events.at(-1)?.elapsedMs ?? 0);
      record.events.push(record.pending.kind === 'refresh' ? { kind: 'refresh', elapsedMs, result: 'unknown' } : { kind: 'reconnect', elapsedMs, result: 'failed' });
    }
    const step = nextEditorRecoveryAction({ version: 1, scope: record.scope, events: record.events });
    if (step.status === 'continue') record.pending = step.action; else delete record.pending;
    record.revision++;
    const space = await statfs(directory); if (space.bavail * space.bsize < 512 * 1024 * 1024) throw Error('editor_recovery_evidence_space');
    await writeJson(file, record);
    return { ...step, cursor: editorHash(record), elapsedFloorMs: Math.max(now - record.startedAt, record.events.at(-1)?.elapsedMs ?? 0), incidentId: request.incidentId };
  } finally { await unlock(); }
}

export async function recoverDurableEditor(runDir: string, scope: EditorScope, incidentId: string, adapter: EditorLoadingAdapter): Promise<EditorRecoveryResult> {
  let step = await advanceEditorRecovery(runDir, { version: 2, scope, incidentId });
  if (step.status === 'ready') {
    // A terminal receipt from an earlier invocation is never current UI proof.
    const event = await executeEditorRecoveryAction(scope, adapter, { kind: 'guard', timeoutMs: 10_000 }, () => step.elapsedFloorMs);
    if (event.kind !== 'guard' || event.result.outcome !== 'ok' || event.result.observation.mode !== 'editable' || !event.result.observation.ownershipVerified) throw Error('editor_runtime_ready_changed');
    assertEditorRecoveryPage(scope, event.result.observation);
  }
  while (step.status === 'continue') {
    const start = performance.now(), floor = step.elapsedFloorMs;
    const elapsed = () => floor + Math.max(0, Math.round(performance.now() - start));
    const event = await executeEditorRecoveryAction(scope, adapter, step.action, elapsed);
    step = await advanceEditorRecovery(runDir, { version: 2, scope, incidentId, cursor: step.cursor, event });
  }
  return step;
}

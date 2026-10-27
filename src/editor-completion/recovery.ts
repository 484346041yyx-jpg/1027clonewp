import { z } from 'zod';
import { editorScopeSchema, type EditorScope } from './contract.js';

export const EDITOR_LOAD_WAIT_MS = 120_000;
export const EDITOR_RECOVERY_TOTAL_MS = 240_000;
const tri = z.union([z.boolean(), z.literal('unknown')]);
export const editorLoadingObservationSchema = z.object({
  pageId: z.number().int().positive(), editUrl: z.string().url(), documentId: z.string().min(1).max(100),
  mode: z.enum(['loading', 'editable', 'login', 'safe-mode', 'history-preview', 'error']),
  dirty: tri, saving: tri, pendingSaveRequests: z.number().int().nonnegative().nullable(),
  saveOutcomeUnknown: z.boolean(), ownershipVerified: z.boolean(),
}).strict();
export type EditorLoadingObservation = z.infer<typeof editorLoadingObservationSchema>;
const error = z.object({ outcome: z.literal('disconnected') }).strict();
const observed = z.object({ outcome: z.literal('ok'), observation: editorLoadingObservationSchema }).strict();
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['probe', 'guard']), elapsedMs: z.number().int().nonnegative(), result: z.union([observed, error]) }).strict(),
  z.object({ kind: z.literal('wait'), elapsedMs: z.number().int().nonnegative(), delayMs: z.number().int().min(1).max(5000) }).strict(),
  z.object({ kind: z.literal('reconnect'), elapsedMs: z.number().int().nonnegative(), result: z.enum(['connected', 'failed']) }).strict(),
  z.object({ kind: z.literal('refresh'), elapsedMs: z.number().int().nonnegative(), result: z.enum(['refreshed', 'unknown', 'blocked']) }).strict(),
]);
export type EditorRecoveryEvent = z.infer<typeof eventSchema>;
export const packetSchema = z.object({ version: z.literal(1), scope: editorScopeSchema, events: z.array(eventSchema).max(120).default([]) }).strict();
export type EditorRecoveryPacket = z.input<typeof packetSchema>;
export type EditorRecoveryAction = { kind: 'probe' | 'guard'; timeoutMs: 10_000 } | { kind: 'wait'; delayMs: number }
  | { kind: 'reconnect'; timeoutMs: 45_000 } | { kind: 'refresh'; timeoutMs: 15_000; expectedDocumentId: string };
export interface EditorRecoveryResult {
  status: 'ready' | 'user-action-required' | 'scope-conflict'; code: string; userHelpRequired: boolean;
  contentWrites: 0; refreshAttempts: number; reconnectAttempts: number; elapsedMs: number;
}
export type EditorRecoveryStep = { status: 'continue'; action: EditorRecoveryAction } | EditorRecoveryResult;

export function assertEditorRecoveryPage(scope: EditorScope, o: EditorLoadingObservation) {
  const u = new URL(o.editUrl);
  if (o.pageId !== scope.pageId || u.origin !== scope.targetOrigin || u.pathname !== '/wp-admin/post.php'
    || u.searchParams.get('post') !== String(scope.pageId) || u.searchParams.get('action') !== 'elementor'
    || [...u.searchParams.keys()].some(k => !['post', 'action'].includes(k)) || u.searchParams.size !== 2) throw Error('editor_recovery_page_changed');
}
export function editorRefreshSafe(o: EditorLoadingObservation) {
  return o.mode === 'loading' && o.ownershipVerified && o.dirty === false && o.saving === false && o.pendingSaveRequests === 0 && !o.saveOutcomeUnknown;
}
function* flow(scope: EditorScope): Generator<EditorRecoveryAction, EditorRecoveryResult, EditorRecoveryEvent> {
  let elapsedMs = 0, phaseStarted = 0, refreshAttempts = 0, reconnectAttempts = 0, refreshBlocked = false;
  const end = (code: string, status: EditorRecoveryResult['status'] = 'user-action-required'): EditorRecoveryResult => ({ status, code, userHelpRequired: status === 'user-action-required', contentWrites: 0, refreshAttempts, reconnectAttempts, elapsedMs });
  function* ask(action: EditorRecoveryAction): Generator<EditorRecoveryAction, EditorRecoveryEvent, EditorRecoveryEvent> {
    const e = yield action;
    if (e.kind !== action.kind || e.elapsedMs < elapsedMs || e.kind === 'wait' && (action.kind !== 'wait' || e.delayMs !== action.delayMs || e.elapsedMs < elapsedMs + action.delayMs)) throw Error('editor_recovery_event_order');
    elapsedMs = e.elapsedMs; return e;
  }
  function* reconnect(): Generator<EditorRecoveryAction, boolean, EditorRecoveryEvent> {
    if (reconnectAttempts) return false;
    reconnectAttempts++;
    const e = yield* ask({ kind: 'reconnect', timeoutMs: 45_000 });
    return e.kind === 'reconnect' && e.result === 'connected';
  }
  for (;;) {
    if (elapsedMs >= EDITOR_RECOVERY_TOTAL_MS) return end('editor-load-exhausted');
    const e = yield* ask({ kind: 'probe', timeoutMs: 10_000 });
    if (e.kind !== 'probe') throw Error('editor_recovery_event_order');
    if (e.result.outcome === 'disconnected') { if (yield* reconnect()) continue; return end('connection-unavailable-after-recovery'); }
    const o = e.result.observation;
    try { assertEditorRecoveryPage(scope, o); } catch { return end('current-task-page-changed', 'scope-conflict'); }
    if (!o.ownershipVerified) return end('current-task-ownership-unconfirmed', 'scope-conflict');
    if (o.mode === 'editable') return end('ready', 'ready');
    if (refreshBlocked) return end('refresh-precondition-changed');
    if (elapsedMs >= EDITOR_RECOVERY_TOTAL_MS) return end('editor-load-exhausted');
    if (['login', 'safe-mode', 'history-preview'].includes(o.mode)) return end(`editor-${o.mode}`);
    const phaseRemaining = EDITOR_LOAD_WAIT_MS - (elapsedMs - phaseStarted);
    if (phaseRemaining > 0) { yield* ask({ kind: 'wait', delayMs: Math.min(5000, phaseRemaining, EDITOR_RECOVERY_TOTAL_MS - elapsedMs) }); continue; }
    if (refreshAttempts) return end('editor-load-exhausted-after-single-refresh');
    if (o.saving === true || o.pendingSaveRequests !== null && o.pendingSaveRequests > 0 || o.saveOutcomeUnknown) {
      if (elapsedMs + 5000 >= EDITOR_RECOVERY_TOTAL_MS) return end('save-unsettled-reconcile-without-refresh');
      yield* ask({ kind: 'wait', delayMs: 5000 }); continue;
    }
    if (o.dirty === true) return end('unsaved-changes-preserved');
    if (!editorRefreshSafe(o)) return end('refresh-safety-unconfirmed');
    // Two fresh idle observations separated by quiet time catch delayed saves.
    const first = yield* ask({ kind: 'guard', timeoutMs: 10_000 });
    if (first.kind !== 'guard') throw Error('editor_recovery_event_order');
    if (first.result.outcome === 'disconnected') { if (yield* reconnect()) continue; return end('connection-unavailable-after-recovery'); }
    try { assertEditorRecoveryPage(scope, first.result.observation); } catch { return end('current-task-page-changed', 'scope-conflict'); }
    if (first.result.observation.mode === 'editable') return end('ready', 'ready');
    if (!editorRefreshSafe(first.result.observation)) continue;
    yield* ask({ kind: 'wait', delayMs: 1000 });
    const second = yield* ask({ kind: 'guard', timeoutMs: 10_000 });
    if (second.kind !== 'guard') throw Error('editor_recovery_event_order');
    if (second.result.outcome === 'disconnected') { if (yield* reconnect()) continue; return end('connection-unavailable-after-recovery'); }
    const fresh = second.result.observation;
    try { assertEditorRecoveryPage(scope, fresh); } catch { return end('current-task-page-changed', 'scope-conflict'); }
    if (fresh.mode === 'editable') return end('ready', 'ready');
    if (!editorRefreshSafe(fresh) || first.result.observation.documentId !== fresh.documentId) continue;
    if (elapsedMs >= EDITOR_RECOVERY_TOTAL_MS) return end('editor-load-exhausted');
    refreshAttempts++; // Consume BEFORE dispatch; an unknown reply never grants another refresh.
    const reloaded = yield* ask({ kind: 'refresh', timeoutMs: 15_000, expectedDocumentId: fresh.documentId });
    if (reloaded.kind !== 'refresh') throw Error('editor_recovery_event_order');
    // The editor may have become ready between the last guard and native reload.
    // Observe once more before asking for help; the refresh allowance stays spent.
    refreshBlocked = reloaded.result === 'blocked';
    phaseStarted = elapsedMs;
  }
}
/** Memory-only protocol for the current browser tool. No credentials, navigation or content writes here. */
export function nextEditorRecoveryAction(input: unknown): EditorRecoveryStep {
  const p = packetSchema.parse(input), f = flow(p.scope); let step = f.next();
  for (const event of p.events) { if (step.done) throw Error('editor_recovery_already_finished'); step = f.next(event); }
  return step.done ? step.value : { status: 'continue', action: step.value };
}

export interface EditorLoadingAdapter {
  observe(scope: EditorScope, context: { signal: AbortSignal; ownershipCheck: boolean }): Promise<EditorLoadingObservation>;
  /** Reuse the bounded connection recovery ONCE; acquire only the original task tab, never restart Chrome. */
  reconnect(scope: EditorScope, context: { signal: AbortSignal }): Promise<boolean>;
  /** Recheck URL, ownership, dirty and all save states immediately before the single native reload. */
  refresh(scope: EditorScope, documentId: string, context: { signal: AbortSignal }): Promise<'refreshed' | 'unknown' | 'blocked'>;
  wait(ms: number): Promise<void>;
}
export async function recoverLoadingEditor(scopeInput: EditorScope, adapter: EditorLoadingAdapter, now = () => performance.now(), alreadyWaitedMs = 0): Promise<EditorRecoveryResult> {
  if (!Number.isInteger(alreadyWaitedMs) || alreadyWaitedMs < 0 || alreadyWaitedMs > EDITOR_LOAD_WAIT_MS) throw Error('editor_recovery_prior_wait_invalid');
  const scope = editorScopeSchema.parse(scopeInput), events: EditorRecoveryEvent[] = [], start = now();
  const elapsed = () => alreadyWaitedMs + Math.max(0, Math.round(now() - start));
  for (;;) {
    const step = nextEditorRecoveryAction({ version: 1, scope, events }); if (step.status !== 'continue') return step;
    events.push(await executeEditorRecoveryAction(scope, adapter, step.action, elapsed));
  }
}

export async function executeEditorRecoveryAction(scope: EditorScope, adapter: EditorLoadingAdapter, a: EditorRecoveryAction, elapsed: () => number): Promise<EditorRecoveryEvent> {
    if (a.kind === 'wait') { await adapter.wait(a.delayMs); return ({ kind: 'wait', delayMs: a.delayMs, elapsedMs: elapsed() }); }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = a.kind === 'reconnect' ? adapter.reconnect(scope, { signal: controller.signal })
        : a.kind === 'refresh' ? adapter.refresh(scope, a.expectedDocumentId, { signal: controller.signal })
        : adapter.observe(scope, { signal: controller.signal, ownershipCheck: a.kind === 'guard' });
      const value = await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('editor_recovery_operation_timeout')); }, a.timeoutMs); })]);
      if (a.kind === 'reconnect') return ({ kind: 'reconnect', result: value === true ? 'connected' : 'failed', elapsedMs: elapsed() });
      else if (a.kind === 'refresh') return ({ kind: 'refresh', result: value as 'refreshed' | 'unknown' | 'blocked', elapsedMs: elapsed() });
      else return ({ kind: a.kind, result: { outcome: 'ok', observation: editorLoadingObservationSchema.parse(value) }, elapsedMs: elapsed() });
    } catch (e) {
      if (a.kind === 'refresh') return ({ kind: 'refresh', result: 'unknown', elapsedMs: elapsed() });
      else if (a.kind === 'reconnect') return ({ kind: 'reconnect', result: 'failed', elapsedMs: elapsed() });
      else {
        // Only actual transport failures enter connection recovery. Unknown API/runtime
        // failures are not evidence that the user must reconnect their browser.
        const message = e instanceof Error ? e.message : '';
        if (!/editor_recovery_operation_timeout|(?:CDP|connection|transport).{0,60}(?:closed|disconnect|timeout|timed out)|(?:closed|disconnect).{0,60}(?:connection|transport)|not attached/i.test(message)) throw Error('editor_recovery_probe_unverified');
        return ({ kind: a.kind, result: { outcome: 'disconnected' }, elapsedMs: elapsed() });
      }
    } finally { if (timer) clearTimeout(timer); }
}

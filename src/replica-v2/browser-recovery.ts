import { z } from 'zod';
import { BROWSER_REQUEST_BUDGET_BYTES, browserCallBudgetValid, classifyBrowserReadFailure, type BrowserReadFailure } from './browser-diagnostics.js';

export const BROWSER_RECOVERY_BACKOFF_MS = [0, 2000, 5000] as const;
export const BROWSER_RECOVERY_OPERATION_TIMEOUT_MS = 5000;
/** Acquisition may include the tool's first AX/DOM setup; it is not a warm probe. */
export const BROWSER_RECOVERY_INITIALIZATION_TIMEOUT_MS = 55_000;
const timeoutBudgetsSchema = z.object({
  initializationMs: z.number().int().positive().max(55_000).default(BROWSER_RECOVERY_INITIALIZATION_TIMEOUT_MS),
  // Browser tool setup/transport can outlast the page's small evaluate timeout.
  readMs: z.number().int().positive().max(55_000).default(55_000),
  probeMs: z.number().int().positive().max(30_000).default(BROWSER_RECOVERY_OPERATION_TIMEOUT_MS),
  toolTimeoutMs: z.number().int().positive().max(60_000).default(60_000),
  returnMarginMs: z.number().int().positive().max(10_000).default(5000),
}).strict();
const identifier = z.string().min(1).max(240);
const publicUrl = z.string().url().refine(value => {
  const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
const bindingSchema = z.object({ browserId: identifier, tabId: identifier }).strict();
export type BrowserRecoveryBinding = z.infer<typeof bindingSchema>;
const inventorySchema = z.object({ browsers: z.array(z.object({
  browserId: identifier, tabs: z.array(z.object({ tabId: identifier, url: z.string().max(8192) }).strict()).max(1000),
}).strict()).max(100) }).strict();
export type BrowserRecoveryInventory = z.infer<typeof inventorySchema>;
const errorEvent = z.object({ outcome: z.literal('error'), error: z.string().min(1).max(8192) }).strict();
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inventory'), result: z.union([z.object({ outcome: z.literal('ok'), inventory: inventorySchema }).strict(), errorEvent]) }).strict(),
  z.object({ kind: z.literal('bind'), binding: bindingSchema, result: z.union([z.object({ outcome: z.literal('ok') }).strict(), errorEvent]) }).strict(),
  z.object({ kind: z.literal('url'), binding: bindingSchema, result: z.union([z.object({ outcome: z.literal('ok'), actualUrl: publicUrl }).strict(), errorEvent]) }).strict(),
  z.object({ kind: z.literal('dom'), binding: bindingSchema, result: z.union([z.object({
    outcome: z.literal('ok'), actualUrl: publicUrl, readyState: z.enum(['loading', 'interactive', 'complete']), bodyPresent: z.boolean(),
    access: z.enum(['normal', 'login', 'challenge', 'permission-required']),
  }).strict(), errorEvent]) }).strict(),
  z.object({ kind: z.literal('wait'), delayMs: z.number().int().min(1).max(5000), result: z.object({ outcome: z.literal('ok') }).strict() }).strict(),
  z.object({ kind: z.literal('open'), result: z.union([z.object({ outcome: z.literal('ok'), binding: bindingSchema }).strict(), errorEvent]) }).strict(),
]);
export type BrowserRecoveryEvent = z.infer<typeof eventSchema>;
const inputSchema = z.object({
  version: z.literal(1), sourceUrl: publicUrl, initialBinding: bindingSchema.optional(),
  nextRequestUtf8Bytes: z.number().int().nonnegative(),
  probeRequestUtf8Bytes: z.object({ url: z.number().int().nonnegative(), dom: z.number().int().nonnegative() }).strict(),
  failure: z.object({ scope: z.enum(['source-read', 'source-capture', 'tool-runtime', 'target-write']), error: z.string().min(1).max(8192), probeStage: z.enum(['url', 'dom']).optional() }).strict().optional(),
  sameBindingRetryUsed: z.boolean().default(false),
  autoOpen: z.boolean().default(false),
  timeoutBudgets: timeoutBudgetsSchema.optional(),
  events: z.array(eventSchema).max(40).default([]),
}).strict();
export type BrowserRecoveryInput = z.input<typeof inputSchema>;
type ParsedInput = z.infer<typeof inputSchema>;
export type BrowserRecoveryAction =
  | { kind: 'inventory'; attempt: number; timeoutMs: number; toolTimeoutMs: number }
  | { kind: 'bind'; binding: BrowserRecoveryBinding; timeoutMs: number; toolTimeoutMs: number }
  | { kind: 'url' | 'dom'; binding: BrowserRecoveryBinding; timeoutMs: number; probeTimeoutMs: number; toolTimeoutMs: number }
  | { kind: 'open'; sourceUrl: string; maxCandidates: 3; staggerMs: 15_000; timeoutMs: 180_000 }
  | { kind: 'wait'; delayMs: number };
export type BrowserRecoveryCode = 'ready' | 'reduce-request' | 'resume-bounded-capture' | 'inspect-tool-runtime' | 'inspect-read-failure'
  | 'configure-tool-budget' | 'inspect-operation-deadline'
  | 'reconcile-target-write' | 'source-url-changed' | 'source-access-required' | 'source-tab-ambiguous'
  | 'connection-unavailable' | 'source-tab-missing' | 'tab-attachment-unavailable' | 'source-document-not-ready' | 'automatic-open-unavailable';
export interface BrowserRecoveryOutcome {
  kind: 'browser-recovery'; version: 1; status: 'ready' | 'agent-action-required' | 'user-action-required'; code: BrowserRecoveryCode;
  userHelpRequired: boolean; remoteWrites: 0; binding?: BrowserRecoveryBinding;
  metrics: { inventoryCalls: number; binds: number; urlProbes: number; domProbes: number; sameBindingRetries: number; backoffMs: number };
}
export type BrowserRecoveryStep = { status: 'continue'; action: BrowserRecoveryAction } | BrowserRecoveryOutcome;

function sameUrl(actual: string, expected: string): boolean {
  try { const a = new URL(actual), b = new URL(expected); a.hash = ''; b.hash = ''; return a.href === b.href; } catch { return false; }
}
function sameBinding(a: BrowserRecoveryBinding, b: BrowserRecoveryBinding): boolean { return a.browserId === b.browserId && a.tabId === b.tabId; }

/** Classification has no side effects. Screenshot/tool/write faults never masquerade as an offline extension. */
export function browserRecoveryFailureAction(scope: 'source-read' | 'source-capture' | 'tool-runtime' | 'target-write', error: string): BrowserRecoveryCode | undefined {
  if (scope === 'target-write') return 'reconcile-target-write';
  const failure = classifyBrowserReadFailure(error);
  if (failure === 'tool_execution_timeout') return 'inspect-tool-runtime';
  if (failure === 'operation_deadline') return 'inspect-operation-deadline';
  if (scope === 'tool-runtime' || /(?:is not a (?:constructor|function)|ReferenceError|SyntaxError|tool runtime|execution context.{0,30}(?:invalid|unavailable))/i.test(error)) return 'inspect-tool-runtime';
  if (classifyBrowserReadFailure(error) === 'message_too_large') return 'reduce-request';
  if (scope === 'source-capture' && /(?:time(?:d)?\s*out|timeout|transaction.{0,30}(?:limit|exceed))/i.test(error)) return 'resume-bounded-capture';
  if (classifyBrowserReadFailure(error) === 'unknown_probe_failure') return 'inspect-read-failure';
  return undefined;
}

type ProbeResult = { ok: true } | { ok: false; failure: BrowserReadFailure | 'not-ready' } | { terminal: BrowserRecoveryOutcome };
type Flow = Generator<BrowserRecoveryAction, BrowserRecoveryOutcome, BrowserRecoveryEvent>;
function* recoveryFlow(input: ParsedInput): Flow {
  const metrics = { inventoryCalls: 0, binds: 0, urlProbes: 0, domProbes: 0, sameBindingRetries: 0, backoffMs: 0 };
  const done = (code: BrowserRecoveryCode, user = false, binding?: BrowserRecoveryBinding): BrowserRecoveryOutcome => ({
    kind: 'browser-recovery', version: 1, status: code === 'ready' ? 'ready' : user ? 'user-action-required' : 'agent-action-required',
    code, userHelpRequired: user, remoteWrites: 0, ...(binding ? { binding } : {}), metrics: { ...metrics },
  });
  // A previously sent write must be reconciled before planning any new read or
  // capture request; its outcome cannot be hidden by an unrelated request size.
  if (input.failure?.scope === 'target-write') return done('reconcile-target-write');
  if ([input.nextRequestUtf8Bytes, input.probeRequestUtf8Bytes.url, input.probeRequestUtf8Bytes.dom].some(size => size > BROWSER_REQUEST_BUDGET_BYTES)) return done('reduce-request');
  if (input.failure) {
    const action = browserRecoveryFailureAction(input.failure.scope, input.failure.error);
    if (action) return done(action);
  }
  const budgets = timeoutBudgetsSchema.parse(input.timeoutBudgets ?? {});
  if (budgets.probeMs > budgets.readMs || [budgets.initializationMs, budgets.readMs, BROWSER_RECOVERY_OPERATION_TIMEOUT_MS].some(operationMs => !browserCallBudgetValid(operationMs, budgets.toolTimeoutMs, budgets.returnMarginMs))) return done('configure-tool-budget');
  let retryUsed = input.sameBindingRetryUsed, loadingWaitUsed = false;
  function* probe(binding: BrowserRecoveryBinding, startStage: 'url' | 'dom' = 'url'): Generator<BrowserRecoveryAction, ProbeResult, BrowserRecoveryEvent> {
    for (const stage of (startStage === 'dom' ? ['dom'] : ['url', 'dom']) as Array<'url' | 'dom'>) {
      for (;;) {
        if (stage === 'url') metrics.urlProbes++; else metrics.domProbes++;
        const event = yield { kind: stage, binding, timeoutMs: budgets.readMs, probeTimeoutMs: budgets.probeMs, toolTimeoutMs: budgets.toolTimeoutMs };
        if (event.kind !== stage) throw Error('browser_recovery_event_mismatch');
        if (event.result.outcome === 'error') {
          const action = browserRecoveryFailureAction('source-read', event.result.error);
          if (action) return { terminal: done(action) };
          const failure = classifyBrowserReadFailure(event.result.error);
          if (failure === 'cdp_timeout' && !retryUsed) { retryUsed = true; metrics.sameBindingRetries++; continue; }
          return { ok: false, failure };
        }
        if (!sameUrl(event.result.actualUrl, input.sourceUrl)) return { terminal: done('source-url-changed') };
        if (event.kind === 'dom' && event.result.outcome === 'ok') {
          if (event.result.access !== 'normal') return { terminal: done('source-access-required', true) };
          if (!event.result.bodyPresent || event.result.readyState === 'loading') {
            if (!loadingWaitUsed) {
              loadingWaitUsed = true; metrics.backoffMs += 2000;
              yield { kind: 'wait', delayMs: 2000 }; continue;
            }
            return { ok: false, failure: 'not-ready' };
          }
        }
        break;
      }
    }
    return { ok: true };
  }
  let lastFailure: BrowserReadFailure | 'not-ready' | 'missing' | 'offline' = 'offline', accessRequired = false;
  if (input.initialBinding && (!input.failure || classifyBrowserReadFailure(input.failure.error) === 'cdp_timeout' && !input.sameBindingRetryUsed)) {
    // The supplied failure is already the first attempt; retry its same small probe only once.
    if (input.failure) { retryUsed = true; metrics.sameBindingRetries++; }
    const result = yield* probe(input.initialBinding, input.failure?.probeStage);
    if ('terminal' in result) return result.terminal;
    if (result.ok) return done('ready', false, input.initialBinding);
    lastFailure = result.failure;
  }
  for (const [round, delayMs] of BROWSER_RECOVERY_BACKOFF_MS.entries()) {
    if (delayMs) { metrics.backoffMs += delayMs; yield { kind: 'wait', delayMs }; }
    metrics.inventoryCalls++;
    const event = yield { kind: 'inventory', attempt: round + 1, timeoutMs: BROWSER_RECOVERY_OPERATION_TIMEOUT_MS, toolTimeoutMs: budgets.toolTimeoutMs };
    if (event.kind !== 'inventory') throw Error('browser_recovery_event_mismatch');
    if (event.result.outcome === 'error') {
      const action = browserRecoveryFailureAction('source-read', event.result.error);
      if (action) return done(action);
      lastFailure = classifyBrowserReadFailure(event.result.error); continue;
    }
    if (!event.result.inventory.browsers.length) { lastFailure = 'offline'; continue; }
    const candidates = event.result.inventory.browsers.flatMap(browser => browser.tabs.filter(tab => sameUrl(tab.url, input.sourceUrl)).map(tab => ({ browserId: browser.browserId, tabId: tab.tabId })));
    if (!candidates.length) { lastFailure = 'missing'; continue; }
    const preferred = candidates.find(binding => input.initialBinding && sameBinding(binding, input.initialBinding));
    const ordered = preferred ? [preferred, ...candidates.filter(binding => !sameBinding(binding, preferred))] : candidates;
    for (const selected of ordered) {
      metrics.binds++;
      const bound = yield { kind: 'bind', binding: selected, timeoutMs: budgets.initializationMs, toolTimeoutMs: budgets.toolTimeoutMs };
      if (bound.kind !== 'bind') throw Error('browser_recovery_event_mismatch');
      if (bound.result.outcome === 'error') {
        const action = browserRecoveryFailureAction('source-read', bound.result.error);
        if (action) return done(action);
        lastFailure = classifyBrowserReadFailure(bound.result.error); continue;
      }
      const result = yield* probe(selected);
      if ('terminal' in result) {
        if (result.terminal.code === 'source-access-required' && ordered.length > 1) { accessRequired = true; continue; }
        if (result.terminal.code === 'source-url-changed' && ordered.length > 1) { lastFailure = 'missing'; continue; }
        return result.terminal;
      }
      if (result.ok) return done('ready', false, selected);
      lastFailure = result.failure;
    }
  }
  if (input.autoOpen && !accessRequired) {
    // The tool adapter owns and closes losing tabs. This is a single bounded attempt,
    // never a fresh retry packet after an unknown open result.
    const opened = yield { kind: 'open', sourceUrl: input.sourceUrl, maxCandidates: 3, staggerMs: 15_000, timeoutMs: 180_000 };
    if (opened.kind !== 'open') throw Error('browser_recovery_event_mismatch');
    if (opened.result.outcome === 'error') return /\b(?:login|challenge|captcha|permission|authorization|authentication)\b/i.test(opened.result.error)
      ? done('source-access-required', true) : done('automatic-open-unavailable');
    const selected = opened.result.binding;
    metrics.binds++;
    const bound = yield { kind: 'bind', binding: selected, timeoutMs: budgets.initializationMs, toolTimeoutMs: budgets.toolTimeoutMs };
    if (bound.kind !== 'bind') throw Error('browser_recovery_event_mismatch');
    if (bound.result.outcome === 'error') return done(browserRecoveryFailureAction('source-read', bound.result.error) ?? 'tab-attachment-unavailable');
    const result = yield* probe(selected);
    if ('terminal' in result) return result.terminal;
    if (result.ok) return done('ready', false, selected);
    return done('source-document-not-ready');
  }
  return done(accessRequired ? 'source-access-required' : lastFailure === 'missing' ? 'source-tab-missing' : lastFailure === 'tab_debugger_not_attached' ? 'tab-attachment-unavailable' : lastFailure === 'not-ready' ? 'source-document-not-ready' : 'connection-unavailable', accessRequired || lastFailure === 'offline');
}

/** Local replay for a tool-driving agent. Every event must answer exactly the preceding action. No browser access or persistence. */
export function nextBrowserRecoveryAction(value: unknown): BrowserRecoveryStep {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw Error('browser_recovery_input_invalid');
  const flow = recoveryFlow(parsed.data); let step = flow.next();
  for (const event of parsed.data.events) {
    if (step.done || event.kind !== step.value.kind) throw Error('browser_recovery_event_mismatch');
    if ('binding' in step.value && (!('binding' in event) || !sameBinding(event.binding, step.value.binding))) throw Error('browser_recovery_binding_mismatch');
    if (step.value.kind === 'wait' && (event.kind !== 'wait' || event.delayMs !== step.value.delayMs)) throw Error('browser_recovery_event_mismatch');
    step = flow.next(event);
  }
  return step.done ? step.value : { status: 'continue', action: step.value };
}

type OperationContext = {
  /** Complete adapter action, including tool setup and transport. */
  timeoutMs: number; signal: AbortSignal;
  /** Enclosing browser tool invocation; adapters must pass this to the real tool. */
  toolTimeoutMs?: number;
  /** Only the page-side read/evaluate timeout; never wrap the complete tool with it. */
  probeTimeoutMs?: number;
};
export interface BrowserRecoveryAdapter {
  inventory(context: OperationContext): Promise<BrowserRecoveryInventory>;
  /** Reacquire the inventory's existing tab through a documented API; never launch, navigate, attach through an invented API, or restart. */
  bind(binding: BrowserRecoveryBinding, context: OperationContext): Promise<void>;
  readUrl(binding: BrowserRecoveryBinding, context: OperationContext): Promise<{ actualUrl: string }>;
  readDom(binding: BrowserRecoveryBinding, context: OperationContext): Promise<{ actualUrl: string; readyState: 'loading' | 'interactive' | 'complete'; bodyPresent: boolean; access: 'normal' | 'login' | 'challenge' | 'permission-required' }>;
  /** Optional browser-tool operation: race at most three owned read-only tabs and close losers. */
  openCandidates?(sourceUrl: string, context: OperationContext & { maxCandidates: 3; staggerMs: 15_000 }): Promise<BrowserRecoveryBinding>;
  wait(delayMs: number): Promise<void>;
}
/** Actual bounded executor for adapters with supported tool operations. It never retries writes or captures. */
export async function recoverSourceBrowser(input: Omit<BrowserRecoveryInput, 'events'>, adapter: BrowserRecoveryAdapter): Promise<BrowserRecoveryOutcome> {
  const events: BrowserRecoveryEvent[] = [];
  for (;;) {
    const step = nextBrowserRecoveryAction({ ...input, events });
    if (step.status !== 'continue') return step;
    const action = step.action;
    if (action.kind === 'wait') { await adapter.wait(action.delayMs); events.push({ kind: 'wait', delayMs: action.delayMs, result: { outcome: 'ok' } }); continue; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const context = { timeoutMs: action.timeoutMs, signal: controller.signal, ...('toolTimeoutMs' in action ? { toolTimeoutMs: action.toolTimeoutMs } : {}), ...('probeTimeoutMs' in action ? { probeTimeoutMs: action.probeTimeoutMs } : {}) };
      const operation = action.kind === 'inventory' ? adapter.inventory(context)
        : action.kind === 'open' ? adapter.openCandidates ? adapter.openCandidates(action.sourceUrl, { ...context, maxCandidates: action.maxCandidates, staggerMs: action.staggerMs }) : Promise.reject(Error('automatic open not supported by browser tool'))
        : action.kind === 'bind' ? adapter.bind(action.binding, context)
        : action.kind === 'url' ? adapter.readUrl(action.binding, context) : adapter.readDom(action.binding, context);
      const value = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Settle our deadline first. A synchronous abort listener may reject
          // the adapter promise, but cannot relabel our deadline as disconnect.
          reject(Error(`browser_recovery_operation_deadline:${action.kind}`)); controller.abort();
        }, action.timeoutMs);
      })]);
      if (action.kind === 'inventory') events.push({ kind: 'inventory', result: { outcome: 'ok', inventory: value as BrowserRecoveryInventory } });
      else if (action.kind === 'open') events.push({ kind: 'open', result: { outcome: 'ok', binding: value as BrowserRecoveryBinding } });
      else if (action.kind === 'bind') events.push({ kind: 'bind', binding: action.binding, result: { outcome: 'ok' } });
      else if (action.kind === 'url') events.push({ kind: 'url', binding: action.binding, result: { outcome: 'ok', ...value as { actualUrl: string } } });
      else events.push({ kind: 'dom', binding: action.binding, result: { outcome: 'ok', ...value as Awaited<ReturnType<BrowserRecoveryAdapter['readDom']>> } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown browser read failure';
      const result = { outcome: 'error' as const, error: message.slice(0, 8192) || 'unknown browser read failure' };
      if (action.kind === 'inventory') events.push({ kind: 'inventory', result });
      else if (action.kind === 'open') events.push({ kind: 'open', result });
      else events.push({ kind: action.kind, binding: action.binding, result });
    } finally { if (timer) clearTimeout(timer); }
  }
}

const captureIdentitySchema = z.object({
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/), styleSha256: z.string().regex(/^[a-f0-9]{64}$/), geometrySha256: z.string().regex(/^[a-f0-9]{64}$/),
  stateSha256: z.string().regex(/^[a-f0-9]{64}$/), viewport: z.object({ width: z.number().positive(), height: z.number().positive(), clientWidth: z.number().positive() }).strict(),
}).strict();
export type BrowserCaptureRecoveryIdentity = z.infer<typeof captureIdentitySchema>;
/** Only a scheduling guard. Existing capture-consistency, coverage, raster and actual visual/interaction checks remain mandatory. */
export function canResumeBrowserCapture(before: unknown, restored: unknown): boolean {
  const a = captureIdentitySchema.safeParse(before), b = captureIdentitySchema.safeParse(restored);
  return a.success && b.success && a.data.documentSha256 === b.data.documentSha256 && a.data.styleSha256 === b.data.styleSha256
    && a.data.geometrySha256 === b.data.geometrySha256 && a.data.stateSha256 === b.data.stateSha256
    && a.data.viewport.width === b.data.viewport.width && a.data.viewport.height === b.data.viewport.height && a.data.viewport.clientWidth === b.data.viewport.clientWidth;
}

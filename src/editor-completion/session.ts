import { AsyncLocalStorage } from 'node:async_hooks';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { DraftSnapshot } from '../wordpress/client.js';
import { createScopedContext } from '../verification/capture-target.js';
import type { ScopedBrowserAuth } from '../verification/types.js';
import { editorHash, editorScopeSchema, type EditorScope } from './contract.js';
import { readEditorTaskContract } from './task.js';
import { createEditorLoadingAdapter, observeLoadingEditor, trackEditorRecoverySaves } from './recovery-browser.js';
import { recoverDurableEditor } from './recovery-store.js';

interface Workflow {
  runDir: string; scope: EditorScope; hiddenRootIds: string[]; verifyOwnership(): Promise<boolean>;
  context?: BrowserContext; browser?: Browser; authHash?: string; page?: Page; saves?: ReturnType<typeof trackEditorRecoverySaves>; leased: boolean;
  cleanModelHash?: string;
}
const workflows = new AsyncLocalStorage<Workflow>();
const pageWorkflows = new WeakMap<Page, Workflow>();
async function modelHash(page: Page) {
  const model = await page.evaluate(() => {
    const editor = (window as any).elementor;
    try { const elements = editor?.elements?.toJSON?.(); return Array.isArray(elements) ? elements : null; } catch { return null; }
  });
  return model === null ? undefined : editorHash(model);
}

/** The policy belongs to the frozen task, never to whichever run happened most recently. */
export async function taskEditorRuntimeScope(runDir: string, snapshot: Pick<DraftSnapshot, 'pageId' | 'runId' | 'hash'>, editorUrl: string) {
  const task = await readEditorTaskContract(runDir);
  if (task?.policy?.runtime !== 'shared-owned-editor-v1') return undefined;
  if (task.runId !== snapshot.runId || task.pageId && task.pageId !== snapshot.pageId) throw Error('editor_runtime_task_changed');
  const u = new URL(editorUrl), origin = task.targetOrigin;
  if (u.origin !== origin || u.pathname !== '/wp-admin/post.php' || u.searchParams.get('post') !== String(snapshot.pageId) || u.searchParams.get('action') !== 'elementor') throw Error('editor_runtime_page_changed');
  return editorScopeSchema.parse({ taskId: task.taskId, runId: task.runId, pageId: snapshot.pageId, targetOrigin: origin, documentHash: snapshot.hash });
}

export async function withTaskEditorWorkflow<T>(options: { runDir: string; snapshot: DraftSnapshot; editorUrl: string; verifyOwnership(): Promise<boolean> }, work: () => Promise<T>): Promise<T> {
  const scope = await taskEditorRuntimeScope(options.runDir, options.snapshot, options.editorUrl);
  if (!scope) return work(); // Frozen old tasks keep their original execution route.
  if (workflows.getStore()) throw Error('editor_runtime_nested_workflow');
  const state: Workflow = { runDir: options.runDir, scope, hiddenRootIds: options.snapshot.elements.filter(n => n.settings?.hide_desktop === 'yes').map(n => n.id), verifyOwnership: options.verifyOwnership, leased: false };
  try { return await workflows.run(state, work); }
  finally { state.saves?.dispose(); await state.context?.close(); }
}

/** One cached context, one serial editor lease. Read-only checks may share the
 * live model; temporary edits/restoration always invalidate that model. */
export async function leaseVerificationEditor(browser: Browser, editorUrl: string, auth?: ScopedBrowserAuth) {
  const state = workflows.getStore();
  if (!state) {
    const context = await createScopedContext(browser, editorUrl, auth), page = await context.newPage();
    return { context, page, navigate: () => page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }), release: async (_clean = false) => { await context.close(); } };
  }
  if (state.leased) throw Error('editor_runtime_concurrent_lease');
  const u = new URL(editorUrl), authHash = editorHash(auth ?? {});
  if (u.origin !== state.scope.targetOrigin || u.searchParams.get('post') !== String(state.scope.pageId) || u.pathname !== '/wp-admin/post.php' || u.searchParams.get('action') !== 'elementor') throw Error('editor_runtime_lease_scope');
  if (state.context && (state.browser !== browser || state.authHash !== authHash)) throw Error('editor_runtime_session_scope');
  state.context ??= await createScopedContext(browser, editorUrl, auth); state.browser = browser; state.authHash = authHash;
  state.leased = true;
  const reusable = state.page && !state.page.isClosed();
  if (!reusable) { state.saves?.dispose(); state.page = await state.context.newPage(); state.saves = trackEditorRecoverySaves(state.page, state.scope.targetOrigin); pageWorkflows.set(state.page, state); }
  const context = state.context, page = state.page!;
  return { context, page,
    async navigate() {
      if (!await state.verifyOwnership()) throw Error('editor_runtime_ownership_unconfirmed');
      if (reusable) {
        const o = await observeLoadingEditor(page, state.scope, ['__unused__'], state.saves!.read(), true);
        if (o.dirty !== false || o.saving !== false || o.pendingSaveRequests !== 0 || o.saveOutcomeUnknown) throw Error('editor_runtime_reuse_not_idle');
        if (!state.cleanModelHash || await modelHash(page) !== state.cleanModelHash) throw Error('editor_runtime_reuse_model_changed');
        return null;
      }
      return page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    },
    async release(clean = false) {
      try {
        for (const other of context.pages()) if (other !== page) await other.close();
        state.cleanModelHash = clean && !page.isClosed() ? await modelHash(page) : undefined;
        if ((!clean || !state.cleanModelHash) && !page.isClosed()) await page.close();
      } finally { state.leased = false; }
    },
  };
}

/** Actual verification entry: no second startup budget and no new browser on a
 * slow response. Final completion reopen is deliberately outside this pool. */
export async function awaitWorkflowEditorReady(page: Page, rootIds: string[], label: string) {
  const state = pageWorkflows.get(page); if (!state) return undefined;
  const options = { page, rootIds, hiddenRootIds: state.hiddenRootIds.filter(id => rootIds.includes(id)), saves: state.saves!,
    verifyOwnership: () => state.verifyOwnership(), reconnect: async () => false };
  const adapter = createEditorLoadingAdapter(options);
  const result = await recoverDurableEditor(state.runDir, state.scope, label, adapter);
  if (result.status !== 'ready') throw Error(`editor_runtime_${result.code}`);
  return result;
}

import type { Page, Request } from 'playwright';
import type { EditorScope } from './contract.js';
import { assertEditorRecoveryPage, editorRefreshSafe, recoverLoadingEditor, type EditorLoadingAdapter, type EditorLoadingObservation } from './recovery.js';

export interface EditorSaveActivity { complete: boolean; pending: number; unknownOutcome: boolean }
/** Classify in memory only. Unknown mutations remain save blockers; POST bodies
 * and action payloads are never returned or written to diagnostics. */
export function isEditorSaveRisk(url: string, method: string, origin: string, body: string | null) {
  const u = new URL(url);
  if (u.origin !== origin || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (u.pathname !== '/wp-admin/admin-ajax.php' || !body || body.length > 8 * 1024 * 1024) return true;
  try {
    const form = new URLSearchParams(body);
    if (form.get('action') !== 'heartbeat') return true;
    const data = JSON.parse(form.get('data') ?? '{}');
    // Heartbeat may carry an actual autosave. Only the known auth/lock pings
    // are proven unrelated to document writes; new/unknown keys stay guarded.
    return !data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['wp-auth-check', 'wp-refresh-post-lock'].includes(k));
  } catch { return true; }
}
/** Attach before the task-owned editor's first navigation. */
export function trackEditorRecoverySaves(page: Page, targetOrigin: string) {
  const origin = new URL(targetOrigin);
  if (origin.origin !== targetOrigin || !['http:', 'https:'].includes(origin.protocol)) throw Error('editor_recovery_save_origin');
  const pending = new Set<Request>(); let complete = page.url() === 'about:blank', unknownOutcome = false;
  const isMutation = (r: Request) => isEditorSaveRisk(r.url(), r.method(), targetOrigin, r.postData());
  const started = (r: Request) => { if (isMutation(r)) pending.add(r); };
  const finished = (r: Request) => { if (pending.has(r)) pending.delete(r); };
  const failed = (r: Request) => { if (isMutation(r)) { pending.delete(r); unknownOutcome = true; } };
  const response = (r: import('playwright').Response) => { if (isMutation(r.request()) && r.status() >= 400) unknownOutcome = true; };
  page.on('request', started); page.on('requestfinished', finished); page.on('requestfailed', failed); page.on('response', response);
  return {
    read: (): EditorSaveActivity => ({ complete, pending: pending.size, unknownOutcome }),
    // An already-open session needs a real external save reconciliation before its
    // missing network history can be trusted. No optimistic default to idle.
    confirmReconciledIdle() { if (pending.size) throw Error('editor_recovery_save_pending'); complete = true; unknownOutcome = false; },
    dispose() { page.off('request', started); page.off('requestfinished', finished); page.off('requestfailed', failed); page.off('response', response); },
  };
}

/** Read actual native panel/model/preview state; an HTTP/DOM load event alone is insufficient. */
export async function observeLoadingEditor(page: Page, scope: EditorScope, rootIds: string[], saves: EditorSaveActivity, ownershipVerified = false, hiddenRootIds: string[] = []): Promise<EditorLoadingObservation> {
  if (rootIds.some(id => !/^[\w-]+$/.test(id)) || !rootIds.length) throw Error('editor_recovery_native_roots');
  if (hiddenRootIds.some(id => !rootIds.includes(id))) throw Error('editor_recovery_hidden_root_scope');
  const value = await page.evaluate(({ ids, expectedPage, hidden }) => {
    const editor = (window as any).elementor;
    const actualId = Number(editor?.config?.document?.id ?? new URL(location.href).searchParams.get('post'));
    let dirty: boolean | 'unknown' = 'unknown';
    try { const d = editor?.saver?.isEditorChanged?.(); if (typeof d === 'boolean') dirty = d; } catch { /* Initialization is not proof of clean state. */ }
    let nativeSaving: boolean | 'unknown' = 'unknown';
    try { const s = typeof editor?.saver?.isSaving === 'function' ? editor.saver.isSaving() : editor?.saver?.isSaving; if (typeof s === 'boolean') nativeSaving = s; } catch { /* Network observation remains independent. */ }
    const iframe = document.querySelector<HTMLIFrameElement>('#elementor-preview-iframe'), doc = iframe?.contentDocument;
    let panel = false; try { panel = !!document.querySelector('#elementor-panel') && !!editor?.getPanelView?.()?.getCurrentPageView?.(); } catch { /* Panel is still booting. */ }
    let mode: EditorLoadingObservation['mode'] = 'loading';
    if (document.querySelector('#loginform')) mode = 'login';
    else if (document.body.classList.contains('elementor-safe-mode') || new URL(location.href).searchParams.has('elementor-mode')) mode = 'safe-mode';
    else if (document.body.classList.contains('elementor-editor-preview') || document.querySelector('.elementor-revision-preview')) mode = 'history-preview';
    else if (document.querySelector('.wp-die-message,.php-error-message') || doc?.querySelector('#loginform,.wp-die-message,.php-error-message')) mode = 'error';
    else if (panel && actualId === expectedPage && doc?.readyState === 'complete' && doc.body && new URL(doc.URL).origin === location.origin
      && iframe && iframe.getBoundingClientRect().width > 0 && iframe.getBoundingClientRect().height > 0
      && ids.every(id => { const nodes = [...doc.querySelectorAll(`[data-id="${id}"]`)].filter(n => !n.closest('.slick-cloned,.swiper-slide-duplicate,.elementor-sticky__spacer')); if (nodes.length !== 1) return false; const n = nodes[0], css = doc.defaultView!.getComputedStyle(n), b = n.getBoundingClientRect(); return !!n.closest(`[data-elementor-id="${expectedPage}"]`) && (b.width > 0 && b.height > 0 && css.display !== 'none' && css.visibility !== 'hidden' || hidden.includes(id) && !!n.closest('.elementor-hidden-desktop')); })) mode = 'editable';
    // Only stable editor identity is returned, never nonce/query/session values.
    const u = new URL(location.href), editUrl = `${u.origin}${u.pathname}?post=${u.searchParams.get('post')}&action=${u.searchParams.get('action')}`;
    return { pageId: actualId, editUrl, documentId: String(performance.timeOrigin), mode, dirty, nativeSaving };
  }, { ids: rootIds, expectedPage: scope.pageId, hidden: hiddenRootIds });
  const observation: EditorLoadingObservation = { ...value, ownershipVerified, pendingSaveRequests: saves.complete ? saves.pending : null,
    saving: value.nativeSaving === true || saves.pending > 0 ? true : saves.complete ? false : 'unknown', saveOutcomeUnknown: saves.unknownOutcome };
  delete (observation as any).nativeSaving;
  assertEditorRecoveryPage(scope, observation); return observation;
}

/** Concrete adapter for existing native Playwright sessions. CUA uses the same
 * protocol through its documented tools; it must not launch this as a fallback. */
export function createEditorLoadingAdapter(options: {
  page: Page; rootIds: string[]; saves: { read(): EditorSaveActivity };
  hiddenRootIds?: string[];
  verifyOwnership(scope: EditorScope, signal: AbortSignal): Promise<boolean>;
  reconnect(scope: EditorScope, signal: AbortSignal): Promise<boolean>;
}): EditorLoadingAdapter {
  let owned: boolean | undefined;
  const read = async (scope: EditorScope, ownershipCheck: boolean, signal: AbortSignal) => {
    const checked = owned === undefined || ownershipCheck;
    if (checked) owned = await options.verifyOwnership(scope, signal);
    if (signal.aborted) throw Error('editor_recovery_cancelled');
    const observation = await observeLoadingEditor(options.page, scope, options.rootIds, options.saves.read(), owned, options.hiddenRootIds);
    if (observation.mode === 'editable' && !checked) observation.ownershipVerified = owned = await options.verifyOwnership(scope, signal);
    if (signal.aborted) throw Error('editor_recovery_cancelled');
    return observation;
  };
  return {
    observe: (scope, ctx) => read(scope, ctx.ownershipCheck, ctx.signal),
    reconnect: (scope, ctx) => options.reconnect(scope, ctx.signal),
    async refresh(scope, documentId, ctx) {
      const fresh = await read(scope, true, ctx.signal);
      if (!editorRefreshSafe(fresh) || fresh.documentId !== documentId || ctx.signal.aborted) return 'blocked';
      await options.page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }); return 'refreshed';
    },
    wait: ms => options.page.waitForTimeout(ms),
  };
}
export async function recoverOwnedNativeEditor(scope: EditorScope, options: Parameters<typeof createEditorLoadingAdapter>[0] & { alreadyWaitedMs?: number }) {
  return recoverLoadingEditor(scope, createEditorLoadingAdapter(options), () => performance.now(), options.alreadyWaitedMs);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { recoverLoadingEditor, nextEditorRecoveryAction, type EditorLoadingObservation, type EditorLoadingAdapter } from '../src/editor-completion/recovery.js';
import { createEditorLoadingAdapter, observeLoadingEditor, trackEditorRecoverySaves } from '../src/editor-completion/recovery-browser.js';
import type { EditorScope } from '../src/editor-completion/contract.js';

const scope: EditorScope = { taskId: 'loading-task', runId: 'loading-run', pageId: 9, documentHash: 'a'.repeat(64), targetOrigin: 'https://target.example' };
const observation = (patch: Partial<EditorLoadingObservation> = {}): EditorLoadingObservation => ({ pageId: 9, editUrl: `${scope.targetOrigin}/wp-admin/post.php?post=9&action=elementor`, documentId: 'doc-1', mode: 'loading', dirty: false, saving: false, pendingSaveRequests: 0, saveOutcomeUnknown: false, ownershipVerified: true, ...patch });
function fixture(overrides: Partial<EditorLoadingAdapter> = {}) {
  let time = 0, refreshes = 0, connections = 0; const waits: number[] = [], guards: number[] = [];
  const adapter: EditorLoadingAdapter = {
    observe: async (_scope, ctx) => { if (ctx.ownershipCheck) guards.push(time); return observation(); },
    refresh: async () => { refreshes++; return 'refreshed'; },
    reconnect: async () => { connections++; return true; },
    wait: async ms => { time += ms; waits.push(ms); }, ...overrides,
  };
  return { adapter, now: () => time, waits, guards, counts: () => ({ refreshes, connections }), advance: (ms: number) => { time += ms; } };
}

test('a connected slow editor waits for real editable readiness without reconnecting or refreshing', async () => {
  const f = fixture(); f.adapter.observe = async () => observation({ mode: f.now() >= 100_000 ? 'editable' : 'loading' });
  const r = await recoverLoadingEditor(scope, f.adapter, f.now);
  assert.equal(r.status, 'ready'); assert.equal(r.elapsedMs, 100_000); assert.deepEqual(f.counts(), { refreshes: 0, connections: 0 }); assert.ok(f.waits.every(ms => ms <= 5000));
});

test('only one refresh follows two fresh idle guards; readiness after refresh ends immediately', async () => {
  const f = fixture(); let refreshed = false;
  f.adapter.refresh = async (_s, id) => { assert.equal(id, 'doc-1'); assert.deepEqual(f.guards, [120_000, 121_000]); refreshed = true; return 'refreshed'; };
  f.adapter.observe = async (_s, c) => { if (c.ownershipCheck) f.guards.push(f.now()); return observation({ mode: refreshed ? 'editable' : 'loading', documentId: refreshed ? 'doc-2' : 'doc-1' }); };
  const r = await recoverLoadingEditor(scope, f.adapter, f.now);
  assert.equal(r.status, 'ready'); assert.equal(r.refreshAttempts, 1); assert.equal(r.reconnectAttempts, 0); assert.equal(r.elapsedMs, 121_000);
});

test('existing startup wait is charged to the same incident rather than repeated', async () => {
  const f = fixture(); let refreshed = false;
  f.adapter.observe = async () => observation({ mode: refreshed ? 'editable' : 'loading' });
  f.adapter.refresh = async () => { refreshed = true; return 'refreshed'; };
  const r = await recoverLoadingEditor(scope, f.adapter, f.now, 120_000);
  assert.equal(r.status, 'ready'); assert.equal(r.refreshAttempts, 1); assert.equal(f.now(), 1000); assert.equal(r.elapsedMs, 121_000);
});

test('readiness arriving immediately before reload cancels the reload and continues without user help', async () => {
  const f = fixture(); let ready = false;
  f.adapter.observe = async () => observation({ mode: ready ? 'editable' : 'loading' });
  f.adapter.refresh = async () => { ready = true; return 'blocked'; };
  const r = await recoverLoadingEditor(scope, f.adapter, f.now);
  assert.equal(r.status, 'ready'); assert.equal(r.userHelpRequired, false); assert.equal(r.reconnectAttempts, 0);
});

test('a still-stuck editor asks once after the single refresh; lost refresh replies never resend', async () => {
  for (const lost of [false, true]) {
    const f = fixture(); let count = 0;
    f.adapter.refresh = async () => { count++; if (lost) throw Error('response lost after dispatch'); return 'refreshed'; };
    const r = await recoverLoadingEditor(scope, f.adapter, f.now);
    assert.equal(r.userHelpRequired, true); assert.equal(r.refreshAttempts, 1); assert.equal(count, 1); assert.equal(r.reconnectAttempts, 0); assert.ok(r.elapsedMs <= 240_000);
  }
});

for (const [name, patch, code] of [
  ['dirty', { dirty: true }, 'unsaved-changes-preserved'],
  ['unknown dirty state', { dirty: 'unknown' }, 'refresh-safety-unconfirmed'],
  ['untracked save history', { pendingSaveRequests: null, saving: 'unknown' }, 'refresh-safety-unconfirmed'],
  ['active save', { pendingSaveRequests: 1, saving: true }, 'save-unsettled-reconcile-without-refresh'],
  ['unknown save outcome', { saveOutcomeUnknown: true }, 'save-unsettled-reconcile-without-refresh'],
] as const) test(`${name} preserves all edits and never refreshes or requests a reconnect`, async () => {
  const f = fixture({ observe: async () => observation(patch) });
  const r = await recoverLoadingEditor(scope, f.adapter, f.now);
  assert.equal(r.code, code); assert.equal(r.refreshAttempts, 0); assert.deepEqual(f.counts(), { refreshes: 0, connections: 0 }); assert.ok(r.elapsedMs >= 120_000);
});

test('a delayed save starting during the quiet guard prevents refresh until actual completion', async () => {
  const f = fixture(); let guarded = 0, refreshed = false;
  f.adapter.observe = async (_s, c) => {
    if (c.ownershipCheck) guarded++;
    const pending = guarded >= 2 && f.now() < 140_000;
    return observation({ pendingSaveRequests: pending ? 1 : 0, saving: pending, mode: refreshed ? 'editable' : 'loading' });
  };
  f.adapter.refresh = async () => { assert.ok(f.now() >= 140_000); refreshed = true; return 'refreshed'; };
  const r = await recoverLoadingEditor(scope, f.adapter, f.now); assert.equal(r.status, 'ready'); assert.equal(r.refreshAttempts, 1);
});

test('task identity and actual URL/ownership guard every operation, including refresh guards', async () => {
  for (const patch of [{ pageId: 10 }, { editUrl: `${scope.targetOrigin}/wp-admin/post.php?post=10&action=elementor` }, { ownershipVerified: false }]) {
    const f = fixture({ observe: async () => observation(patch) }), r = await recoverLoadingEditor(scope, f.adapter, f.now);
    assert.equal(r.status, 'scope-conflict'); assert.equal(r.refreshAttempts, 0); assert.equal(r.elapsedMs, 0);
  }
  const f = fixture({ observe: async (_s, c) => observation(c.ownershipCheck ? { pageId: 10 } : {}) });
  assert.equal((await recoverLoadingEditor(scope, f.adapter, f.now)).status, 'scope-conflict'); assert.equal(f.counts().refreshes, 0);
});

test('genuine transport failure uses connection recovery once, but a runtime error never asks for a reconnect', async () => {
  const f = fixture(); let calls = 0;
  f.adapter.observe = async () => { if (++calls <= 2) throw Error('browser transport disconnected'); return observation({ mode: 'editable' }); };
  const r = await recoverLoadingEditor(scope, f.adapter, f.now); assert.equal(r.code, 'connection-unavailable-after-recovery'); assert.equal(f.counts().connections, 1);
  const g = fixture({ observe: async () => { throw Error('TypeError: control API unavailable'); } });
  await assert.rejects(recoverLoadingEditor(scope, g.adapter, g.now), /probe_unverified/); assert.equal(g.counts().connections, 0);
});

test('loading protocol rejects invented elapsed waits, out-of-order events and post-terminal restarts', () => {
  const initial = { version: 1, scope, events: [] };
  assert.equal(nextEditorRecoveryAction(initial).status, 'continue');
  assert.throws(() => nextEditorRecoveryAction({ ...initial, events: [{ kind: 'refresh', result: 'refreshed', elapsedMs: 0 }] }), /event_order/);
  const p = { kind: 'probe', elapsedMs: 0, result: { outcome: 'ok', observation: observation() } };
  assert.throws(() => nextEditorRecoveryAction({ ...initial, events: [p, { kind: 'wait', delayMs: 5000, elapsedMs: 1 }] }), /event_order/);
  assert.throws(() => nextEditorRecoveryAction({ ...initial, events: [{ ...p, result: { outcome: 'ok', observation: observation({ mode: 'editable' }) } }, p] }), /already_finished/);
});

test('real Chromium adapter reloads only the owned clean page once and observes the recovered native roots', async () => {
  let loads = 0; const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost'); requests.push(`${req.method} ${url.pathname}`); res.setHeader('Content-Type', 'text/html'); res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/wp-admin/post.php') {
      loads++; res.end(`<div id="elementor-panel"></div><iframe id="elementor-preview-iframe" style="width:400px;height:300px" src="/preview?ready=${loads > 1}"></iframe><script>window.elementor={config:{document:{id:9}},saver:{isEditorChanged:()=>false,isSaving:false},getPanelView:()=>({getCurrentPageView:()=>({})})}</script>`);
    } else res.end(`<main class="elementor" data-elementor-id="9">${url.searchParams.get('ready') === 'true' ? '<div data-id="root" style="width:300px;height:100px">Ready</div>' : ''}</main>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), localScope = { ...scope, targetOrigin: `http://127.0.0.1:${address.port}` }, saves = trackEditorRecoverySaves(page, localScope.targetOrigin);
    const url = `${localScope.targetOrigin}/wp-admin/post.php?post=9&action=elementor`;
    await page.goto(url); let time = 0, ownershipChecks = 0;
    await page.route('https://analytics.invalid/**', route => route.abort());
    await page.evaluate(async () => { await fetch('https://analytics.invalid/event', { method: 'POST', mode: 'no-cors' }).catch(() => undefined); });
    assert.deepEqual(saves.read(), { complete: true, pending: 0, unknownOutcome: false }, 'A failed foreign analytics POST cannot be mistaken for a task document save.');
    const adapter = createEditorLoadingAdapter({ page, rootIds: ['root'], saves, verifyOwnership: async s => { assert.equal(s.pageId, 9); ownershipChecks++; return true; }, reconnect: async () => { throw Error('healthy connection'); } });
    adapter.wait = async ms => { time += ms; await page.waitForTimeout(5); };
    const r = await recoverLoadingEditor(localScope, adapter, () => time);
    assert.equal(r.status, 'ready'); assert.equal(loads, 2); assert.equal(r.refreshAttempts, 1); assert.ok(ownershipChecks >= 4); assert.ok(requests.every(v => v.startsWith('GET ')));
    const current = await observeLoadingEditor(page, localScope, ['root'], saves.read(), true);
    await page.evaluate(() => { (window as any).elementor.saver.isEditorChanged = () => true; });
    assert.equal(await adapter.refresh(localScope, current.documentId, { signal: new AbortController().signal }), 'blocked'); assert.equal(loads, 2);
    saves.dispose();
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { advanceEditorRecovery } from '../src/editor-completion/recovery-store.js';
import { isEditorSaveRisk } from '../src/editor-completion/recovery-browser.js';
import { defaultEditorCompletionPolicy } from '../src/editor-completion/contract.js';
import { leaseVerificationEditor, taskEditorRuntimeScope, withTaskEditorWorkflow } from '../src/editor-completion/session.js';
import { awaitNativeEditorReady } from '../src/verification/editor-readiness.js';
import { canonicalHeaderJson } from '../src/woodmart-header/contract.js';
import { largeEditorDocument } from './fixtures/editor-large-document.js';

const scope = { taskId: 'runtime-test', runId: 'runtime-run', pageId: 9, documentHash: 'a'.repeat(64), targetOrigin: 'https://target.example' };
const observation = { pageId: 9, editUrl: `${scope.targetOrigin}/wp-admin/post.php?post=9&action=elementor`, documentId: '1000', mode: 'loading', dirty: false, saving: false, pendingSaveRequests: 0, saveOutcomeUnknown: false, ownershipVerified: true };
async function fixture(work: (dir: string) => Promise<void>) {
  const dir = path.join('D:/cloneWP/.cache', `editor-runtime-test-${randomUUID()}`); await mkdir(dir, { recursive: true });
  try { await work(dir); }
  finally { const resolved = await realpath(dir); assert.equal(resolved.toLowerCase(), path.resolve(dir).toLowerCase()); assert.ok(path.relative('D:/cloneWP/.cache', resolved).startsWith('editor-runtime-test-')); await rm(resolved, { recursive: true }); }
}

test('durable recovery retains its budget and consumes a lost refresh before a restarted caller can retry', async () => fixture(async dir => {
  let now = 1000;
  const request = { version: 2, scope, incidentId: 'sections' };
  let step: any = await advanceEditorRecovery(dir, request, now); assert.equal(step.status, 'continue');
  const ack = async (event: any) => { step = await advanceEditorRecovery(dir, { ...request, cursor: step.cursor, event }, now); return step; };
  now += 120_000; await ack({ kind: 'probe', elapsedMs: 120_000, result: { outcome: 'ok', observation } });
  assert.ok(step.status === 'continue' && step.action.kind === 'guard');
  await ack({ kind: 'guard', elapsedMs: 120_000, result: { outcome: 'ok', observation } });
  assert.ok(step.status === 'continue' && step.action.kind === 'wait');
  now += 1000; await ack({ kind: 'wait', elapsedMs: 121_000, delayMs: 1000 });
  await ack({ kind: 'guard', elapsedMs: 121_000, result: { outcome: 'ok', observation } });
  assert.ok(step.status === 'continue' && step.action.kind === 'refresh'); const oldCursor = step.cursor;
  // A new process has no response. The prior claim is preserved as unknown.
  now += 10; step = await advanceEditorRecovery(dir, request, now);
  assert.ok(step.status === 'continue' && step.action.kind === 'probe');
  await assert.rejects(advanceEditorRecovery(dir, { ...request, cursor: oldCursor, event: { kind: 'refresh', elapsedMs: 121_010, result: 'refreshed' } }, now), /stale_cursor/);
  now += 120_000; await ack({ kind: 'probe', elapsedMs: 0, result: { outcome: 'ok', observation } });
  assert.equal(step.status, 'user-action-required'); if (step.status === 'continue') throw Error('terminal expected');
  assert.equal(step.refreshAttempts, 1); assert.ok(step.elapsedMs >= 240_000);
  const again = await advanceEditorRecovery(dir, request, now + 1); assert.equal(again.status, step.status);
  const files = (await readdir(path.join(dir, 'editor-runtime'))).filter(n => n.endsWith('.json'));
  const bytes = await readFile(path.join(dir, 'editor-runtime', files[0]), 'utf8'); assert.equal(/nonce|cookie|authorization/i.test(bytes), false);
}));

test('durable protocol rejects unclaimed observations, unsafe paths and stale state without issuing browser actions', async () => fixture(async dir => {
  const request = { version: 2, scope, incidentId: 'fields' };
  const first = await advanceEditorRecovery(dir, request, 0);
  await assert.rejects(advanceEditorRecovery(dir, { ...request, event: { kind: 'probe', elapsedMs: 0, result: { outcome: 'ok', observation } } }, 0), /without_claim/);
  await assert.rejects(advanceEditorRecovery(dir, { ...request, incidentId: '../escape' }, 0));
  await assert.rejects(advanceEditorRecovery(dir, { ...request, cursor: first.cursor, event: { kind: 'probe', elapsedMs: 0, result: { outcome: 'ok', observation: { ...observation, editUrl: observation.editUrl + '&nonce=private' } } } }, 0), /page_changed/);
  const files = (await readdir(path.join(dir, 'editor-runtime'))).filter(n => n.endsWith('.json')); assert.equal((await readFile(path.join(dir, 'editor-runtime', files[0]), 'utf8')).includes('private'), false);
  assert.equal((await advanceEditorRecovery(dir, { ...request, cursor: first.cursor }, 1)).status, 'continue');
}));

test('save classification excludes proven lock/auth heartbeats but guards autosaves and every unknown mutation', () => {
  const url = `${scope.targetOrigin}/wp-admin/admin-ajax.php`;
  const data = (v: unknown) => new URLSearchParams({ action: 'heartbeat', data: JSON.stringify(v) }).toString();
  assert.equal(isEditorSaveRisk(url, 'POST', scope.targetOrigin, data({ 'wp-auth-check': true })), false);
  assert.equal(isEditorSaveRisk(url, 'POST', scope.targetOrigin, data({ wp_autosave: { post_id: 9 } })), true);
  assert.equal(isEditorSaveRisk(url, 'POST', scope.targetOrigin, data({ unknown: true })), true);
  assert.equal(isEditorSaveRisk(url, 'POST', scope.targetOrigin, 'action=elementor_ajax'), true);
  assert.equal(isEditorSaveRisk(`${scope.targetOrigin}/wp-json/private`, 'POST', scope.targetOrigin, null), true);
  assert.equal(isEditorSaveRisk('https://analytics.invalid/event', 'POST', scope.targetOrigin, null), false);
});

test('actual editor checks share a clean model and context, hidden planned roots are ready, restored models are discarded', async () => fixture(async dir => {
  let loads = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url?.startsWith('/wp-admin/post.php')) { loads++; res.end(`<div id="elementor-panel"></div><iframe id="elementor-preview-iframe" width="500" height="500" src="/preview"></iframe><script>window.elementor={elements:{toJSON:()=>[{id:'root'}]},config:{document:{id:9}},saver:{isEditorChanged:()=>false,isSaving:false},getPanelView:()=>({getCurrentPageView:()=>({})})}</script>`); }
    else res.end('<main class="elementor" data-elementor-id="9"><div data-id="root" style="width:300px;height:100px">Body</div><div data-id="phone" class="elementor-hidden-desktop" style="display:none">Phone alternative</div></main>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const a = server.address(); assert.ok(a && typeof a === 'object');
  const origin = `http://127.0.0.1:${a.port}`, editorUrl = `${origin}/wp-admin/post.php?post=9&action=elementor`;
  const snapshot: any = { ...scope, hash: scope.documentHash, elements: [{ id: 'root', settings: {} }, { id: 'phone', settings: { hide_desktop: 'yes' } }] };
  await writeFile(path.join(dir, 'journal.json'), JSON.stringify({ executionStrategy: 'native44-css-handoff', taskId: scope.taskId, runId: scope.runId, pageId: 9, targetUrl: origin, editorCompletionPolicy: defaultEditorCompletionPolicy() }));
  const browser = await chromium.launch({ headless: true }); let ownershipChecks = 0;
  try {
    await withTaskEditorWorkflow({ runDir: dir, snapshot, editorUrl, verifyOwnership: async () => { ownershipChecks++; return true; } }, async () => {
      const first = await leaseVerificationEditor(browser, editorUrl); await first.navigate();
      const report = await awaitNativeEditorReady({ page: first.page, editorUrl, rootIds: ['root', 'phone'], runDir: dir, label: 'sections' });
      assert.equal(report.passed, true); await first.release(true);
      const second = await leaseVerificationEditor(browser, editorUrl); assert.equal(second.page, first.page); await second.navigate(); assert.equal(loads, 1);
      await assert.rejects(leaseVerificationEditor(browser, editorUrl), /concurrent_lease/);
      await awaitNativeEditorReady({ page: second.page, editorUrl, rootIds: ['root'], runDir: dir, label: 'fields' });
      await second.release(); assert.equal(second.page.isClosed(), true);
      const third = await leaseVerificationEditor(browser, editorUrl); assert.equal(third.context, first.context); assert.notEqual(third.page, first.page); await third.navigate(); assert.equal(loads, 2);
      await third.page.evaluate(() => { (window as any).elementor.saver.isEditorChanged = () => true; }); await third.release(true);
      const dirty = await leaseVerificationEditor(browser, editorUrl); await assert.rejects(dirty.navigate(), /reuse_not_idle/); await dirty.release();
    });
    assert.equal(browser.contexts().length, 0); assert.ok(ownershipChecks >= 5);
    const journal = JSON.parse(await readFile(path.join(dir, 'journal.json'), 'utf8')); delete journal.editorCompletionPolicy.runtime; await writeFile(path.join(dir, 'journal.json'), JSON.stringify(journal));
    assert.equal(await taskEditorRuntimeScope(dir, snapshot, editorUrl), undefined, 'Frozen legacy tasks do not migrate');
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test('large clean editor models can be reused while unapproved model changes remain rejected', async () => fixture(async dir => {
  const document = largeEditorDocument();
  assert.throws(() => canonicalHeaderJson(document.elements), /woodmart_header_json_limit_exceeded/);
  let loads = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url?.startsWith('/wp-admin/post.php')) {
      loads++;
      response.end(`<div id="elementor-panel"></div><iframe id="elementor-preview-iframe" src="/preview"></iframe><script>window.editorModel=${JSON.stringify(document.elements)};window.elementor={elements:{toJSON:()=>window.editorModel},config:{document:{id:9}},saver:{isEditorChanged:()=>false,isSaving:false},getPanelView:()=>({getCurrentPageView:()=>({})})}</script>`);
    } else response.end('<main class="elementor" data-elementor-id="9"><div data-id="section_0">Body</div></main>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`, editorUrl = `${origin}/wp-admin/post.php?post=9&action=elementor`;
  const snapshot: any = { ...scope, hash: scope.documentHash, elements: document.elements };
  await writeFile(path.join(dir, 'journal.json'), JSON.stringify({ executionStrategy: 'native44-css-handoff', taskId: scope.taskId, runId: scope.runId, pageId: 9, targetUrl: origin, editorCompletionPolicy: defaultEditorCompletionPolicy() }));
  const browser = await chromium.launch({ headless: true });
  try {
    await withTaskEditorWorkflow({ runDir: dir, snapshot, editorUrl, verifyOwnership: async () => true }, async () => {
      const first = await leaseVerificationEditor(browser, editorUrl); await first.navigate(); await first.release(true);
      const second = await leaseVerificationEditor(browser, editorUrl); assert.equal(second.page, first.page); await second.navigate(); await second.release(true);
      assert.equal(loads, 1);
      await second.page.evaluate(() => { (window as any).editorModel[0].elements[0].settings.editor = '<p>Unapproved model change</p>'; });
      const changed = await leaseVerificationEditor(browser, editorUrl);
      await assert.rejects(changed.navigate(), /reuse_model_changed/); await changed.release();
    });
    assert.equal(browser.contexts().length, 0);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkEditorObservation, editorHash, assertEditorReopen, type EditorScope, type EditorObservation, type EditorDocument } from '../src/editor-completion/contract.js';
import { alignEditorCompletion, editorCompletionDirectory, editorCompletionGate, editorPath, prepareEditorCompletion, requireEditorCompletion, verifyEditorCompletion, type EditorDriver } from '../src/editor-completion/store.js';
import { WordPressEditorCompletion } from '../src/editor-completion/wordpress.js';
import { runEditorCompletionCLI } from '../src/editor-completion/cli.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import { spawnSync } from 'node:child_process';
import { canonicalHeaderJson, headerJsonHash } from '../src/woodmart-header/contract.js';
import { largeEditorDocument } from './fixtures/editor-large-document.js';

test('native page template context and empty media equivalence preserve real changes', async context => {
  const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') { context.skip('PHP executable unavailable; run the same pure fixture on the target read-only adapter.'); return; }
  const helper = await readFile(new URL('../src/editor-completion/settings-equivalence.php', import.meta.url), 'utf8');
  const fixture = await readFile(new URL('./fixtures/editor-settings-equivalence.php', import.meta.url), 'utf8');
  const code = `$comparison=base64_decode('${Buffer.from(helper).toString('base64')}');$result=(static function()use($comparison){${fixture}})();echo json_encode($result);`;
  const result = spawnSync('php', ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const checks = JSON.parse(result.stdout); assert.equal(Object.keys(checks).length, 10); assert.ok(Object.values(checks).every(value => value === true), result.stdout);
});

const H = (x: string) => x.repeat(64);
const scope: EditorScope = { taskId: 'editor-test', runId: 'run-test', pageId: 9, targetOrigin: 'https://target.example', documentHash: H('a') };
const doc: EditorDocument = { elements: [{ id: 'one', elType: 'container', settings: {}, elements: [{ id: 'two', elType: 'widget', widgetType: 'heading', settings: { title: 'Hello' }, elements: [] }] }], settings: { custom_css: '.elementor-9{color:red}' } };
function driver(initial: 'known-stale' | 'current' | 'conflict' | 'foreign' = 'known-stale') {
  let observation: EditorObservation = { pageId: 9, runId: scope.runId, mainHash: H('b'), approvedMatches: true, autosaves: [{ id: 11, parent: 9, hash: H('c'), state: initial }] };
  let writes = 0, lose = false, beforeOnly = false;
  const adapter: EditorDriver = {
    inspect: async () => structuredClone(observation),
    align: async (intent, ih) => { assert.equal(ih, editorHash(intent)); assert.deepEqual(intent.before, observation); writes++; if (!beforeOnly) observation.autosaves[0] = { ...observation.autosaves[0], hash: H('d'), state: 'current' }; if (lose) throw Error('lost reply'); return structuredClone(observation); },
  };
  return { adapter, writes: () => writes, set: (x: Partial<EditorObservation>) => Object.assign(observation, x), lost: (before = false) => { lose = true; beforeOnly = before; } };
}
async function fixture(fn: (dir: string) => Promise<void>) {
  const base = path.resolve('D:/cloneWP/.cache'), dir = path.join(base, `editor-completion-${randomUUID()}`); await mkdir(dir, { recursive: true });
  try { await fn(dir); } finally { const resolved = await realpath(dir); assert.equal(path.dirname(resolved).toLowerCase(), (await realpath(base)).toLowerCase()); await rm(resolved, { recursive: true }); }
}
async function evidence(dir: string, alignedAt: string) {
  const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: 'white' } }).png().toBuffer();
  const picture = path.join(dir, 'editor.png'); await writeFile(picture, bytes);
  const value = { version: 1, scope, reopenedAt: alignedAt, observedAt: alignedAt, editUrl: 'https://target.example/wp-admin/post.php?post=9&action=elementor', mode: 'editable', safeMode: false, historicalRevisionPreview: false, loadedElementIds: ['one', 'two'], document: doc, pageCss: doc.settings.custom_css, viewport: { width: 400, height: 300 }, screenshot: { path: picture, sha256: createHash('sha256').update(bytes).digest('hex') } };
  const file = path.join(dir, 'reopen.json'); await writeFile(file, JSON.stringify(value)); return { value, file, picture };
}
test('only the exact owned page, approved document and autosave parent are accepted', () => {
  const o = { pageId: 9, runId: scope.runId, mainHash: H('b'), approvedMatches: true, autosaves: [{ id: 11, parent: 9, hash: H('c'), state: 'current' }] };
  assert.doesNotThrow(() => checkEditorObservation(o, scope));
  for (const patch of [{ pageId: 10 }, { runId: 'other' }, { approvedMatches: false }, { mainHash: H('d') }, { autosaves: [{ ...o.autosaves[0], parent: 10 }] }]) assert.throws(() => checkEditorObservation({ ...o, ...patch }, scope, H('b')));
});
test('known stale autosave aligns once; actual reopen and unchanged remote are required for completion', () => fixture(async dir => {
  const d = driver(); await prepareEditorCompletion(dir, scope, doc, [doc], d.adapter);
  await requireEditorCompletion(dir, scope.taskId, scope.runId, scope.documentHash);
  assert.equal((await editorCompletionGate(dir, scope, false)).complete, false);
  const aligned = await alignEditorCompletion(dir, scope.documentHash, d.adapter); assert.equal(d.writes(), 1); assert.equal(aligned.state.status, 'aligned');
  assert.equal((await editorCompletionGate(dir, scope, false)).complete, false);
  const e = await evidence(dir, aligned.state.alignedAt!); await verifyEditorCompletion(dir, scope.documentHash, e.file, d.adapter);
  assert.equal((await editorCompletionGate(dir, scope, false)).complete, true);
  await alignEditorCompletion(dir, scope.documentHash, d.adapter); assert.equal(d.writes(), 1); assert.equal((await editorCompletionGate(dir, scope, false)).complete, true);
  await writeFile(e.picture, 'replaced'); await assert.rejects(editorCompletionGate(dir, scope, false), /screenshot_changed/);
}));
test('missing autosaves/current autosaves still require a reopen but no write', () => fixture(async dir => {
  const d = driver('current'); d.set({ autosaves: [] }); const s = await prepareEditorCompletion(dir, scope, doc, [], d.adapter);
  assert.equal(s.status, 'aligned'); await alignEditorCompletion(dir, scope.documentHash, d.adapter); assert.equal(d.writes(), 0);
}));

test('relative screenshot references remain bound after verification', () => fixture(async dir => {
  const d = driver('current'), s = await prepareEditorCompletion(dir, scope, doc, [], d.adapter), e = await evidence(dir, s.alignedAt!);
  e.value.screenshot.path = 'editor.png'; await writeFile(e.file, JSON.stringify(e.value));
  await verifyEditorCompletion(dir, scope.documentHash, e.file, d.adapter);
  assert.equal((await editorCompletionGate(dir, scope, true)).complete, true);
}));

test('reopened native controls must match even when element IDs and CSS are unchanged', () => fixture(async dir => {
  const d = driver('current'), s = await prepareEditorCompletion(dir, scope, doc, [], d.adapter), e = await evidence(dir, s.alignedAt!);
  e.value.document = structuredClone(doc); e.value.document.elements[0].settings = { mobile_columns: 1 };
  await writeFile(e.file, JSON.stringify(e.value));
  const guarded: EditorDriver = { ...d.adapter, inspect: async (sc, expected, previous) => ({ ...await d.adapter.inspect(sc, expected, previous), approvedMatches: editorHash(expected) === editorHash(doc) }) };
  await assert.rejects(verifyEditorCompletion(dir, scope.documentHash, e.file, guarded), /saved_document_changed/);
  assert.equal((await editorCompletionGate(dir, scope, true)).complete, false);
}));
for (const state of ['foreign', 'conflict'] as const) test(`${state} autosave is preserved without any write`, () => fixture(async dir => {
  const d = driver(state); assert.equal((await prepareEditorCompletion(dir, scope, doc, [], d.adapter)).status, 'conflict');
  await assert.rejects(alignEditorCompletion(dir, scope.documentHash, d.adapter), /conflict/); assert.equal(d.writes(), 0);
}));
test('lost successful response reconciles without resending; before-state needs explicit later apply', () => fixture(async dir => {
  const d = driver(); await prepareEditorCompletion(dir, scope, doc, [doc], d.adapter); d.lost();
  assert.equal((await alignEditorCompletion(dir, scope.documentHash, d.adapter)).state.status, 'unknown');
  assert.equal((await alignEditorCompletion(dir, scope.documentHash, d.adapter, true)).state.status, 'aligned'); assert.equal(d.writes(), 1);
}));
test('unknown before-state is never automatically retried', () => fixture(async dir => {
  const d = driver(); await prepareEditorCompletion(dir, scope, doc, [doc], d.adapter); d.lost(true);
  await alignEditorCompletion(dir, scope.documentHash, d.adapter);
  await assert.rejects(alignEditorCompletion(dir, scope.documentHash, d.adapter), /reconcile_required/);
  assert.equal((await alignEditorCompletion(dir, scope.documentHash, d.adapter, true)).state.status, 'retryable'); assert.equal(d.writes(), 1);
}));
test('concurrent parent or autosave edits invalidate the intent before mutation', () => fixture(async dir => {
  const d = driver(); await prepareEditorCompletion(dir, scope, doc, [doc], d.adapter); d.set({ mainHash: H('f') });
  await assert.rejects(alignEditorCompletion(dir, scope.documentHash, d.adapter), /changed/); assert.equal(d.writes(), 0);
}));
test('loading/safe mode/history preview, stale CSS, missing nodes and old reopen cannot pass', () => fixture(async dir => {
  const d = driver('current'), s = await prepareEditorCompletion(dir, scope, doc, [], d.adapter), e = await evidence(dir, s.alignedAt!);
  const intent = JSON.parse(await readFile(path.join(editorCompletionDirectory(dir, scope.documentHash), 'intent.json'), 'utf8'));
  for (const patch of [{ mode: 'loading' }, { safeMode: true }, { historicalRevisionPreview: true }, { pageCss: 'old' }, { loadedElementIds: ['one'] }, { scope: { ...scope, pageId: 10 } }, { reopenedAt: '2000-01-01T00:00:00.000Z' }, { editUrl: 'https://target.example/wp-admin/post.php?post=10&action=elementor' }]) assert.throws(() => assertEditorReopen({ ...e.value, ...patch }, intent, s.alignedAt!));
  d.set({ mainHash: H('e') }); await assert.rejects(verifyEditorCompletion(dir, scope.documentHash, e.file, d.adapter), /changed/);
}));
test('historical contracts are unchanged; a new amendment marker applies only to its exact saved revision', () => fixture(async dir => {
  assert.equal((await editorCompletionGate(dir, scope, false)).required, false);
  await requireEditorCompletion(dir, scope.taskId, scope.runId, scope.documentHash);
  assert.equal((await editorCompletionGate(dir, scope, false)).complete, false);
  assert.equal((await editorCompletionGate(dir, { ...scope, documentHash: H('d') }, false)).required, false);
  await assert.rejects(editorPath(dir, '../other'), /escape/);
}));
test('transport never writes on inspect; mutation is bound to durable intent and scoped autosaves', async () => {
  const d = driver(), o = await d.adapter.inspect(scope, doc, []); let writes = 0;
  const transport = { origin: scope.targetOrigin, readPHP: async () => ({ ok: true, value: o }), executePHP: async (r: any) => { writes++; assert.equal(r.intent.resource, 'page/9/autosaves'); assert.equal(r.intent.persistedIntentSha256, editorHash(intent)); return { ok: true, value: { ...o, autosaves: [{ ...o.autosaves[0], state: 'current' }] } }; } };
  const wp = new WordPressEditorCompletion(transport as any), intent = { version: 1 as const, scope, expected: doc, previous: [doc], before: o, operationId: randomUUID(), createdAt: new Date().toISOString() };
  await wp.inspect(scope, doc, []); assert.equal(writes, 0); await wp.align(intent, editorHash(intent)); assert.equal(writes, 1);
  await assert.rejects(wp.align({ ...intent, expected: { ...doc, settings: {} } }, editorHash(intent)), /intent_changed/); assert.equal(writes, 1);
});

test('editor whole-page hashing retains historical small hashes without increasing the header limit', () => {
  for (const value of [scope, doc, { z: true, a: [-0, 1e21, '\ud800'] }]) assert.equal(editorHash(value), headerJsonHash(value));
  const large = largeEditorDocument();
  assert.throws(() => canonicalHeaderJson(large), /woodmart_header_json_limit_exceeded/);
  assert.match(editorHash(large), /^[a-f0-9]{64}$/);
  assert.throws(() => editorHash({ value: undefined }), /replica_full_json_invalid/);
});

test('large expected and previous documents survive real transport encoding, durable intent and reopen verification', () => fixture(async dir => {
  const expected = largeEditorDocument(), previous = structuredClone(expected);
  previous.settings.custom_css = '.elementor-9 .source-owned{color:#777777}';
  const initial = await driver().adapter.inspect(scope, expected, [previous]);
  let observed = initial, reads = 0, writes = 0;
  const decode = (operation: { code: string }) => {
    const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)?.[1];
    assert.ok(encoded);
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  };
  const transport = {
    origin: scope.targetOrigin,
    readPHP: async (operation: { code: string }) => {
      reads++;
      const input = decode(operation);
      assert.equal(input.action, 'inspect'); assert.deepEqual(input.expected, expected);
      assert.ok(input.previous.length === 0 || input.previous.length === 1);
      if (input.previous.length) assert.deepEqual(input.previous, [previous]);
      return { ok: true, value: structuredClone(observed) };
    },
    executePHP: async (operation: { code: string; intent: { persistedIntentSha256: string } }) => {
      writes++;
      const input = decode(operation);
      assert.equal(input.action, 'align'); assert.deepEqual(input.expected, expected); assert.deepEqual(input.previous, [previous]);
      const intent = JSON.parse(await readFile(path.join(editorCompletionDirectory(dir, scope.documentHash), 'intent.json'), 'utf8'));
      assert.throws(() => canonicalHeaderJson(intent), /woodmart_header_json_limit_exceeded/);
      assert.equal(operation.intent.persistedIntentSha256, editorHash(intent));
      observed = { ...observed, autosaves: observed.autosaves.map(autosave => ({ ...autosave, state: 'current' as const })) };
      return { ok: true, value: structuredClone(observed) };
    },
  };
  const adapter = new WordPressEditorCompletion(transport as any);
  const prepared = await prepareEditorCompletion(dir, scope, expected, [previous], adapter);
  assert.equal(prepared.status, 'prepared'); assert.equal(writes, 0);
  const aligned = await alignEditorCompletion(dir, scope.documentHash, adapter);
  assert.equal(aligned.state.status, 'aligned'); assert.equal(writes, 1);
  const reopened = await evidence(dir, aligned.state.alignedAt!);
  reopened.value.document = expected; reopened.value.pageCss = expected.settings.custom_css;
  reopened.value.loadedElementIds = expected.elements.flatMap(section => [String(section.id), ...(section.elements as Array<{ id: string }>).map(element => element.id)]);
  assert.equal(reopened.value.loadedElementIds.length, 399);
  await writeFile(reopened.file, JSON.stringify(reopened.value));
  await verifyEditorCompletion(dir, scope.documentHash, reopened.file, adapter);
  assert.equal((await editorCompletionGate(dir, scope, true)).complete, true);
  assert.ok(reads >= 4); assert.equal(writes, 1);
}));

test('CLI rejects foreign saved checkpoints and unknown previous files before contacting the adapter', () => fixture(async root => {
  const dir = path.join(root, 'runs', scope.runId); await mkdir(dir, { recursive: true });
  const dh = documentHashV2(doc.elements as any, doc.settings);
  await writeFile(path.join(dir, 'journal.json'), JSON.stringify({ executionStrategy: 'native44-css-handoff', ...scope, documentHash: dh, targetUrl: scope.targetOrigin, mutations: [{ status: 'confirmed' }] }));
  const saved = { ...doc, pageId: 10, runId: scope.runId, hash: dh };
  await writeFile(path.join(dir, 'saved.json'), JSON.stringify(saved)); await writeFile(path.join(dir, 'previous.json'), '[]');
  let reads = 0; const adapter: EditorDriver = { inspect: async () => { reads++; throw Error('unexpected remote'); }, align: async () => { throw Error('unexpected write'); } };
  const args = ['prepare', '--run-dir', dir, '--saved', 'saved.json', '--previous', 'previous.json'];
  await assert.rejects(runEditorCompletionCLI(args, root, adapter), /saved_checkpoint/); assert.equal(reads, 0);
  saved.pageId = 9; await writeFile(path.join(dir, 'saved.json'), JSON.stringify(saved));
  await writeFile(path.join(dir, 'previous.json'), JSON.stringify([{ path: '../outside.json', sha256: H('a') }]));
  await assert.rejects(runEditorCompletionCLI(args, root, adapter), /path_escape/); assert.equal(reads, 0);
  await writeFile(path.join(dir, 'previous.json'), '[]');
  await assert.rejects(runEditorCompletionCLI(args, root, adapter), /unexpected remote/); assert.equal(reads, 1);
  const recovery = ['recover', '--run-dir', dir, '--stdin'], packet = { version: 1, scope: { ...scope, documentHash: dh }, events: [] };
  assert.deepEqual(await runEditorCompletionCLI(recovery, root, adapter, packet), { status: 'continue', action: { kind: 'probe', timeoutMs: 10_000 } });
  await assert.rejects(runEditorCompletionCLI(recovery, root, adapter, { ...packet, scope: { ...packet.scope, pageId: 10 } }), /task_changed/);
  assert.equal(reads, 1, 'Recovery protocol resolves the task locally without loading credentials or writing remotely.');
}));

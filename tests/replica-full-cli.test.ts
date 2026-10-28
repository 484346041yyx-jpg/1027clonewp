import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseFullReplicaArguments, runFullReplicaCLI, FULL_REPLICA_HELP } from '../src/replica-full/cli.js';
import type { FullReplicaDependencies } from '../src/replica-full/types.js';
import { fullReplicaHash, validateFullReplicaManifest } from '../src/replica-full/contract.js';
import { claimWorkspace, checkpointWorkspace, inspectWorkspace } from '../src/workspace/service.js';

const ROOT = 'D:/cloneWP';
async function withWorkspaceClaim<T>(work: (token: string) => Promise<T>): Promise<T> {
  const taskId = `replica-full-cli-test-${randomUUID()}`, before = await inspectWorkspace(ROOT);
  const owner = await claimWorkspace(ROOT, { agent: 'codex', sessionId: `test-${randomUUID()}`, taskId,
    resources: [`task:${taskId}`], expectedRevision: before.revision, expectedFingerprint: before.fingerprint });
  const previous = process.env.CLONEWP_WORKSPACE_TOKEN;
  process.env.CLONEWP_WORKSPACE_TOKEN = owner.token;
  let completed = false;
  try { const result = await work(owner.token); completed = true; return result; }
  finally {
    if (previous === undefined) delete process.env.CLONEWP_WORKSPACE_TOKEN;
    else process.env.CLONEWP_WORKSPACE_TOKEN = previous;
    const current = await inspectWorkspace(ROOT);
    await checkpointWorkspace(ROOT, { token: owner.token, expectedRevision: owner.revision,
      expectedFingerprint: current.fingerprint, release: true,
      notes: { goal: 'Exercise full replica CLI under a real scoped workspace claim',
        summary: completed ? 'Local CLI fixture completed' : 'Local CLI fixture failed',
        progress: completed ? 'completed' : 'blocked', decisions: [], changes: [],
        checks: [{ command: 'replica-full-cli.test.ts', status: completed ? 'passed' : 'failed' }],
        openItems: completed ? [] : ['Inspect the failing test assertion.'], nextSteps: completed ? ['No fixture follow-up.'] : ['Review the failing test output.'] } });
  }
}

test('full replica CLI rejects ambiguous commands/flags and requires a concrete new manifest/run directory', () => {
  for (const command of ['auto', 'constructor', '__proto__']) assert.throws(() => parseFullReplicaArguments([command]), /unknown_command/);
  assert.throws(() => parseFullReplicaArguments(['run', '--manifest', 'm']), /required_argument/);
  assert.throws(() => parseFullReplicaArguments(['run', '--manifest', 'm', '--run-dir', 'r', '--stage', 'desktop']), /arguments_invalid/);
  assert.throws(() => parseFullReplicaArguments(['status', '--run-dir', 'r', '--run-dir', 'other']), /arguments_invalid/);
  const parsed = parseFullReplicaArguments(['review', '--run-dir', 'r', '--evidence', 'e']); assert.equal(parsed.command, 'review'); assert.equal(parsed.flags.evidence, 'e');
  assert.equal(parseFullReplicaArguments(['reconcile', '--run-dir', 'r']).command, 'reconcile');
  assert.equal(parseFullReplicaArguments(['rebase-current-draft', '--run-dir', 'r', '--expected-fingerprint', 'a'.repeat(64), '--current-body-hash', 'b'.repeat(64), '--current-document-hash', 'c'.repeat(64)]).command, 'rebase-current-draft');
  assert.throws(() => parseFullReplicaArguments(['rebase-current-draft', '--run-dir', 'r', '--expected-fingerprint', 'a'.repeat(64), '--current-body-hash', 'invalid', '--current-document-hash', 'c'.repeat(64)]), /fingerprint_invalid/);
  assert.equal(parseFullReplicaArguments(['recover-style', '--run-dir', 'r']).command, 'recover-style');
  assert.throws(()=>parseFullReplicaArguments(['recover-style','--run-dir','r','--css','foreign']),/arguments_invalid/);
  assert.throws(() => parseFullReplicaArguments(['revise-style', '--run-dir', 'r', '--css', 'c', '--expected-fingerprint', 'auto']), /fingerprint_invalid/);
  assert.equal(parseFullReplicaArguments(['revise-style', '--run-dir', 'r', '--css', 'c', '--expected-fingerprint', 'a'.repeat(64)]).command, 'revise-style');
  assert.equal(parseFullReplicaArguments(['revise-header-style', '--run-dir', 'r', '--css', 'c', '--expected-fingerprint', 'a'.repeat(64)]).command, 'revise-header-style');
  assert.throws(() => parseFullReplicaArguments(['revise-header-style', '--run-dir', 'r', '--css', 'c', '--expected-fingerprint', 'auto']), /fingerprint_invalid/);
  assert.equal(parseFullReplicaArguments(['revise-native-motion', '--run-dir', 'r', '--expected-fingerprint', 'a'.repeat(64)]).command, 'revise-native-motion');
  assert.throws(() => parseFullReplicaArguments(['revise-native-motion', '--run-dir', 'r', '--css', 'c', '--expected-fingerprint', 'a'.repeat(64)]), /arguments_invalid/);
  assert.equal(parseFullReplicaArguments(['revise-navigation-return', '--run-dir', 'r', '--expected-fingerprint', 'a'.repeat(64)]).command, 'revise-navigation-return');
  assert.throws(() => parseFullReplicaArguments(['revise-navigation-return', '--run-dir', 'r', '--expected-fingerprint', 'auto']), /fingerprint_invalid/);
  assert.throws(() => parseFullReplicaArguments(['revise-navigation-return', '--run-dir', 'r', '--css', 'c', '--expected-fingerprint', 'a'.repeat(64)]), /arguments_invalid/);
});
test('full replica help is local and does not instantiate an adapter or authenticate', async () => {
  let factories = 0;
  const result = await runFullReplicaCLI(['--help'], { async createDependencies() { factories++; throw Error('Must not load adapter'); } }) as { remoteWrites: number };
  assert.equal(result.remoteWrites, 0); assert.equal(factories, 0); assert.match(FULL_REPLICA_HELP, /serial remote writes/); assert.match(FULL_REPLICA_HELP, /review --run-dir DIR --evidence FILE/);
});

for (const navigation of ['none', 'relative', 'absolute'] as const) test(`new run preserves ${navigation} navigation evidence through CLI manifest persistence and adapter preparation; status stays local`, async () => {
  const directory = path.join('D:/cloneWP/.cache', `replica-full-cli-${randomUUID()}`); await mkdir(directory, { recursive: true });
  try {
    const inputPath = path.join(directory, 'manifest.json'), run = path.join(directory, 'run');
    const put = async (name: string, contents: string) => { await writeFile(path.join(directory, name), contents); return { path: name, sha256: createHash('sha256').update(contents).digest('hex') }; };
    const program = await put('program.json', '{}'), css = await put('body.css', ':page{color:black}'), units = await put('source-units.json', '{}'), evidence = await put('source-evidence.json', '{}'), assets = await put('header-assets.json', '{}');
    const manifest = { version: 1, kind: 'clonewp-full-replica', taskId: 'alder-local', runId: 'alder-run', title: 'Alder local factory fixture', slug: 'alder-local', sourceUrl: 'https://alder.example/alder-local', targetOrigin: 'https://target.example', sourceEvidence: evidence, sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] }, header: { assets, bundleDirectory: 'new-module', plan: { version: 1, kind: 'clonewp-header-module', moduleKey: 'alder-local', name: 'Alder header', owner: { ownerId: 'clonewp', runId: 'alder-run' }, targetOrigin: 'https://target.example', menus: [{ key: 'main', name: 'Alder menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { settings: {}, rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'main', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }] }, style: { css: ':header{color:black}', fonts: [] } } }, body: { program, css, sourceUnits: units } };
    const formEvidence = await put('form-source.json', '{}'), form = { key: 'filter', slotComponentKey: 'body_search', sourceUnitIds: ['body'], sourceFactIds: ['desktop:interaction:form'], sourceEvidence: { ...formEvidence, path: navigation === 'absolute' ? path.join(directory, formEvidence.path) : formEvidence.path }, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }] }], submitLabel: '検索' };
    const input = navigation === 'none' ? manifest : { ...manifest, sourceUrl: 'https://hoshiichi.com/alder-local', body: { ...manifest.body, navigationForms: [form] } };
    await writeFile(inputPath, JSON.stringify(input)); let factories = 0, closes = 0;
    await withWorkspaceClaim(async () => assert.rejects(runFullReplicaCLI(['run', '--manifest', inputPath, '--run-dir', run], { async createDependencies(options) {
      factories++; const state = JSON.parse(await readFile(path.join(run, 'state.json'), 'utf8')); assert.equal(state.status, 'preparing'); assert.equal(state.taskId, 'alder-local'); assert.ok(path.isAbsolute(options.manifest.header!.assets.path));
      const persisted = JSON.parse(await readFile(path.join(run, 'manifest.json'), 'utf8')); assert.deepEqual(persisted.body.navigationForms, options.manifest.body.navigationForms); assert.equal(state.manifestHash, fullReplicaHash(options.manifest));
      assert.deepEqual(persisted.nativeImagePolicy, { version: 2, mode: 'native-first' });
      assert.deepEqual(persisted.editorCompletionPolicy, { version: 1, mode: 'align-and-reopen', runtime: 'shared-owned-editor-v1' });
      if(persisted.header)assert.deepEqual(persisted.header.plan.menuBindingPolicy,{version:1,editorReview:'desktop-and-mobile-reopen'});
      if (navigation === 'none') assert.equal(options.manifest.body.navigationForms, undefined);
      else { assert.equal(options.manifest.body.navigationForms?.length, 1); assert.deepEqual(options.manifest.body.navigationForms![0], { ...form, sourceEvidence: { ...form.sourceEvidence, path: path.join(directory, 'form-source.json') } }); }
      const never = async () => { throw Error('No remote call allowed'); };
      return { close: async () => { closes++; }, prepareHeader: async () => { throw Error('Synthetic local preparation failure'); }, prepareBody: never, assertPreparedBody: never, provisionHeader: never, createPage: never, saveBody: never, bindHeader: never, reviewWholePage: never, verifyReview: never, publishPage: never } as Omit<FullReplicaDependencies, 'writeState'>;
    } }), /Synthetic local preparation failure/));
    assert.equal(closes, 1); assert.equal(factories, 1);
    const status = await runFullReplicaCLI(['status', '--run-dir', run], { async createDependencies() { throw Error('Status must not load credentials'); } }) as { remoteWrites: number; status: string; userProgress?: { step: number; headline: string; needsYou: unknown } };
    assert.equal(status.remoteWrites, 0); assert.equal(status.status, 'preparing');
    assert.equal(status.userProgress?.step, 2); assert.match(status.userProgress!.headline, /排版/); assert.equal(status.userProgress?.needsYou, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function navigationReturnEntryFixture(directory: string) {
  await mkdir(directory, { recursive: true });
  const put = async (name: string, contents: string) => { const filename = path.join(directory, name); await writeFile(filename, contents); return { path: filename, sha256: createHash('sha256').update(contents).digest('hex') }; };
  const program = await put('program.json', '{}'), css = await put('body.css', ':page{color:black}'), units = await put('source-units.json', '{}'), evidence = await put('source-evidence.json', '{}'), assets = await put('header-assets.json', '{}'), formEvidence = await put('form-source.json', '{}');
  const manifest = validateFullReplicaManifest({ version: 1, kind: 'clonewp-full-replica', taskId: 'return-cli', runId: 'return-cli-run', title: 'Return CLI fixture', slug: 'return-cli', sourceUrl: 'https://hoshiichi.com/', targetOrigin: 'https://target.example', sourceEvidence: evidence, sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] }, header: { assets, bundleDirectory: path.join(directory, 'header-module'), plan: { version: 1, kind: 'clonewp-header-module', moduleKey: 'return-cli', name: 'Return header', owner: { ownerId: 'clonewp', runId: 'return-cli-run' }, targetOrigin: 'https://target.example', menus: [{ key: 'main', name: 'Main menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { settings: {}, rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'main', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }] }, style: { css: ':header{color:black}', fonts: [] } } }, body: { program, css, sourceUnits: units, navigationForms: [{ key: 'filter', slotComponentKey: 'body_search', sourceUnitIds: ['body'], sourceFactIds: ['desktop:interaction:form'], sourceEvidence: formEvidence, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }] }], submitLabel: '検索' }] } });
  const hash = 'a'.repeat(64), editUrl = 'https://target.example/wp-admin/post.php?post=9&action=elementor', previewUrl = 'https://target.example/?page_id=9&preview=true';
  const page = { pageId: 9, runId: manifest.runId, status: 'draft', template: 'elementor_header_footer', editUrl, previewUrl, bodyHash: hash, headerId: null };
  const body = { ...page, cssHash: hash, documentHash: hash, sourceUnitIds: ['body'], embeddedHeaderCount: 0 };
  const header = { headerId: 'header_return', name: 'Return header', editUrl: 'https://target.example/wp-admin/admin.php?page=xts_header_builder#/builder/header_return', headerHash: hash, menuHash: hash, styleHash: hash, menus: [{ key: 'main', id: 10, name: 'Main menu', editUrl: 'https://target.example/wp-admin/nav-menus.php?menu=10' }], styleBlock: { id: 11, name: 'Return styles', editUrl: 'https://target.example/wp-admin/post.php?post=11&action=edit' } };
  const bound = { pageId: 9, runId: manifest.runId, headerId: header.headerId, editUrl, previewUrl, bodyHash: hash, cssHash: hash, documentHash: hash, headerHash: hash, menuHash: hash, styleHash: hash };
  const state = { version: 1, kind: 'clonewp-full-replica-run', taskId: manifest.taskId, runId: manifest.runId, manifestHash: fullReplicaHash(manifest), status: 'awaiting-review', revision: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pending: null, checkpoints: { page, body, header, bound }, review: null };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest)); await writeFile(path.join(directory, 'state.json'), JSON.stringify(state));
}

test('timing initialization failure occurs before the CLI creates any command lock or dependency', async context => {
  const directory = path.join('D:/cloneWP/.cache', `replica-full-cli-init-${randomUUID()}`); await navigationReturnEntryFixture(directory);
  try {
    let factories = 0;
    await withWorkspaceClaim(async () => {
      const toISOString = context.mock.method(Date.prototype, 'toISOString', () => { throw Error('Synthetic timing initialization failure'); });
      try { await assert.rejects(runFullReplicaCLI(['revise-navigation-return', '--run-dir', directory, '--expected-fingerprint', 'b'.repeat(64)], { async createDependencies() { factories++; throw Error('Must not reach dependencies'); } }), /Synthetic timing initialization failure/); }
      finally { toISOString.mock.restore(); }
    });
    assert.equal(factories, 0); await assert.rejects(readFile(path.join(directory, '.lock')), { code: 'ENOENT' });
    assert.equal((await readdir(directory)).some(name => name.startsWith('timings-')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real navigation-return CLI entry creates timing and releases its exact lock on repeated local fingerprint rejection', async () => {
  const directory = path.join('D:/cloneWP/.cache', `replica-full-cli-entry-${randomUUID()}`); await navigationReturnEntryFixture(directory);
  try {
    const state = await readFile(path.join(directory, 'state.json'), 'utf8'), manifest = await readFile(path.join(directory, 'manifest.json'), 'utf8');
    await withWorkspaceClaim(async token => { for (let attempt = 0; attempt < 2; attempt++) {
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        // Default CLI, timing recorder and dependency factory; the stale fingerprint
        // rejects before preparation, credential loading, or any remote operation.
        const child = spawn(process.execPath, ['--import', 'tsx', 'D:/cloneWP/src/replica-full/cli.ts', 'revise-navigation-return', '--run-dir', directory, '--expected-fingerprint', 'b'.repeat(64)], { cwd: 'D:/cloneWP', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLONEWP_WORKSPACE_TOKEN: token } });
        let stdout = '', stderr = ''; child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; }); child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
      });
      assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.deepEqual(JSON.parse(result.stderr), { error: 'replica_full_navigation_return_stale' });
      await assert.rejects(readFile(path.join(directory, '.lock')), { code: 'ENOENT' }); assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), state); assert.equal(await readFile(path.join(directory, 'manifest.json'), 'utf8'), manifest);
    } });
    const timingFiles = (await readdir(directory)).filter(name => name.startsWith('timings-revise-navigation-return-') && name.endsWith('.json')); assert.equal(timingFiles.length, 2);
    for (const filename of timingFiles) { const timing = JSON.parse(await readFile(path.join(directory, filename), 'utf8')); assert.equal(timing.command, 'revise-navigation-return'); assert.equal(timing.status, 'failed'); assert.deepEqual(timing.stages, []); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

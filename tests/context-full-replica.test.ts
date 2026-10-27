import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { fullReplicaContext } from '../src/context/full-replica.js';
import { validateFullReplicaManifest, fullReplicaHash } from '../src/replica-full/contract.js';
import { contextHash } from '../src/context/files.js';

test('full context selects exact frozen state despite a different directory name, rejects drift and ambiguity', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'full-context-'));
 try {
  const put = async (name: string, text: string) => { await writeFile(path.join(root, name), text); return { path: name, sha256: contextHash(text) }; };
  const source = await put('source.json', '{}'), assets = await put('assets.json', '[]'), program = await put('program.json', '{}'), units = await put('units.json', '{}'), css = await put('body.css', ':page{color:red}');
  const manifest = validateFullReplicaManifest({ version: 1, kind: 'clonewp-full-replica', taskId: 'task', runId: 'run', title: 'Example', slug: 'example', sourceUrl: 'https://source.example/', targetOrigin: 'https://target.example', sourceEvidence: source, sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] }, header: { bundleDirectory: 'bundle', assets, plan: { version: 1, kind: 'clonewp-header-module', moduleKey: 'example', owner: { ownerId: 'clonewp', runId: 'run' }, targetOrigin: 'https://target.example', name: 'Example header', menus: [{ key: 'main', name: 'Menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { settings: {}, rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'menu', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }] }, style: { css: ':header{color:red}', fonts: [] } } }, body: { program, css, sourceUnits: units } });
  const state = { version: 1, kind: 'clonewp-full-replica-run', taskId: 'task', runId: 'run', status: 'write-unknown', pending: {}, manifestHash: fullReplicaHash(manifest), checkpoints: { page: { pageId: 123 } } };
  const run = async (dir: string) => { await mkdir(path.join(root, 'runs', dir), { recursive: true }); await writeFile(path.join(root, 'runs', dir, 'state.json'), JSON.stringify(state)); await writeFile(path.join(root, 'runs', dir, 'manifest.json'), JSON.stringify(manifest)); };
  await run('run-final');
  const result = await fullReplicaContext(root, { root, intent: 'resume', run: 'run' }); assert.equal(result?.status, 'ready'); assert.equal(result?.task?.state.pageId, 123); assert.match(result!.nextAction!, /reconcile/); assert.equal(result?.contractSelection, 'task-frozen');
  await writeFile(path.join(root, 'body.css'), ':page{color:blue}'); await assert.rejects(fullReplicaContext(root, { root, intent: 'resume', run: 'run' }), /input_changed/);
  await writeFile(path.join(root, 'body.css'), ':page{color:red}'); await run('run-other'); assert.equal((await fullReplicaContext(root, { root, intent: 'resume', run: 'run' }))?.status, 'needs-task-selection'); assert.equal((await fullReplicaContext(root, { root, intent: 'resume', run: 'run-final' }))?.status, 'ready');
 } finally { await rm(root, { recursive: true, force: true }); }
});

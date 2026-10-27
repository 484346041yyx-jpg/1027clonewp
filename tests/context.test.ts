import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { loadContext, type ContextServices } from '../src/context/loader.js';
import { contextRecordIdentity, refreshContextIndex, scanContextIndex } from '../src/context/index.js';
import { ContextReader, contextAllowed, contextHash, contextSafeText, UNIFIED_ELEMENTOR_GUIDE } from '../src/context/files.js';
import { parseContextArguments } from '../src/context/cli.js';
import type { ComponentRegistry } from '../src/components/types.js';
import type { SystemRelease } from '../src/system/contracts.js';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';
import { createNative44ReleaseDraft, prepareNative44ReleaseLock } from '../src/native44/release-lock.js';
import { readCurrentRelease } from '../src/components/registry.js';
import type { Native44Program } from '../src/native44/types.js';
import { componentCanonical } from '../src/components/io.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';

const sha = 'a'.repeat(64);
const release = { version: 1, executorId: 'native44', componentSet: { id: 'native44-v1', catalog: { path: 'config/native44-component-set.json', sha256: sha }, types: ['heading'] }, knowledge: { id: 'knowledge-v1', index: { path: 'data/native44/index.json', sha256: sha }, fingerprint: sha }, selectionRules: { id: 'desktop-browser-v1', sha256: sha, files: [] }, adapters: { id: 'native44-desktop-v1', sha256: sha, files: [] } } as SystemRelease;
const registry = { version: 1, kind: 'component-registry', enabledSet: { id: 'native44-v1', ref: release.componentSet.catalog, widgetTypes: ['heading'] }, knowledge: { fingerprint: sha, index: release.knowledge.index }, entries: [], pagePatterns: { total: 0, entries: [], additionalRecordRefs: [] }, adapters: [{ id: 'native44-desktop-v1', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', widgetTypes: ['heading'], implemented: ['settings'], resourceAdapters: [], unavailableDependencies: { wd_sidebar: ['sidebar'] }, writeBoundary: 'owned-draft-page-only', sourceRefs: [] }], learningReleases: [], fingerprint: sha } as ComponentRegistry;
const deps: ContextServices = { readCurrentRelease: async () => release, loadComponentRegistry: async (_root, used) => { assert.deepEqual(used, []); return registry; } };
async function json(root: string, name: string, value: unknown) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), JSON.stringify(value)); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-context-'));
  for (const name of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md', '.agents/skills/reference-elementor/SKILL.md', '.agents/skills/clonewp/references/original-mode.md', UNIFIED_ELEMENTOR_GUIDE]) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), `${name}\nProject guide.`); }
  return root;
}
async function fixtureRelease(root: string): Promise<SystemRelease> { return { ...release, componentSet: { ...release.componentSet, catalog: { path: 'SYSTEM.md', sha256: contextHash(await readFile(path.join(root, 'SYSTEM.md'))) } }, knowledge: { ...release.knowledge, index: { path: 'COMPONENTS.md', sha256: contextHash(await readFile(path.join(root, 'COMPONENTS.md'))) } } }; }
async function copyRealContracts(root: string): Promise<void> {
  const project = path.resolve(import.meta.dirname, '..');
  for (const name of ['config/native44-component-set.json', 'data/native44/index.json', 'data/native44/shared-controls.json', 'data/native44/components/heading.json', ...NATIVE44_ADAPTER_SOURCE_PATHS, 'src/native44/selection-rules.ts', 'src/native44/selection.ts', 'src/native44/page-context.ts']) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await cp(path.join(project, name), path.join(root, name)); }
}
async function appendLegacyLearningFixture(root: string, fingerprint: string): Promise<void> {
  const learningId = 'legacy-new-pattern', evidence = Buffer.from('{"kind":"generic-layout-example"}'), digest = contextHash(evidence), evidencePath = `learning/${learningId}/evidence/${digest}.json`;
  await json(root, evidencePath, JSON.parse(evidence.toString('utf8')));
  const record = { version: 1, kind: 'page-learning-record', learningId, createdAt: new Date().toISOString(), mode: 'page-pattern', evidence: [{ path: evidencePath, sha256: digest, kind: 'observation-packet', scope: 'user-browser-page-pattern' }], conclusions: [{ responsibility: 'navigation-list', statement: 'A newly published candidate pattern.', evidenceIndexes: [0] }], conclusionStatus: 'candidate-interpretation', qualification: { source: 'unverified', save: 'unverified', render: 'unverified', interaction: 'unverified', resources: 'task-local-only', registration: 'task-local-only' }, constraints: ['Knowledge only.'], baseKnowledgeFingerprint: fingerprint };
  const recordPath = `learning/${learningId}/record.json`; await json(root, recordPath, record);
  const identity = { version: 1, kind: 'component-learning-release', records: [{ path: recordPath, sha256: contextHash(await readFile(path.join(root, recordPath))) }], baseKnowledgeFingerprint: fingerprint, enabledSetHash: NATIVE44_CATALOG_HASH, activation: 'knowledge-only' }, releaseId = contextHash(componentCanonical(identity)), releasePath = `learning/releases/${releaseId}.json`;
  await json(root, releasePath, { ...identity, releaseId }); await json(root, 'data/system/knowledge-current.json', { version: 1, release: { path: releasePath, sha256: contextHash(await readFile(path.join(root, releasePath))) } });
}
const job = (taskId: string) => ({ version: 2, workflow: 'block-replication', taskId, url: 'https://example.test/', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: sha });
const run = (taskId: string, runId: string) => ({ ...job(taskId), runId, programHash: sha, status: 'awaiting-comparison', pageId: 77, deliveryComplete: false, visualVerification: 'pending-css-application', mutations: [{ status: 'confirmed' }], previewUrl: 'https://example.test/?preview_nonce=SUPER_SECRET', error: 'password=SUPER_SECRET', metrics: { bodyCommits: 1, editorSessions: 0 } });

test('frozen publication preference remains readable before a run exists and is not added to an older run', async () => {
  const root = await fixture();
  const finalDeliveryPolicy = { version: 1, kind: 'clonewp-final-delivery-policy', desiredPageStatus: 'publish', constructionPageStatus: 'draft', publicationGate: 'current-review-quality-floor', authorization: 'project-default-at-task-creation' };
  try {
    await json(root, 'references/task-one/job.json', { ...job('task-one'), finalDeliveryPolicy });
    const initial = await loadContext({ root, intent: 'resume', task: 'task-one' }, deps);
    assert.equal(initial.status, 'ready', JSON.stringify(initial.gaps)); assert.equal(initial.task?.runId, undefined);
    assert.deepEqual(initial.task?.state.finalDeliveryPolicy, finalDeliveryPolicy);
    assert.match(initial.nextAction, /先构建本任务草稿/); assert.doesNotMatch(initial.nextAction, /--run ""/);
    const oldRun = run('task-one', 'run-one'); await json(root, 'runs/run-one/journal.json', oldRun);
    const legacy = await loadContext({ root, intent: 'resume', run: 'run-one' }, deps);
    assert.equal(legacy.status, 'ready', JSON.stringify(legacy.gaps)); assert.deepEqual(legacy.task?.state.finalDeliveryPolicy, finalDeliveryPolicy);
    assert.match(legacy.nextAction, /当前旧 run 未冻结发布策略/); assert.doesNotMatch(legacy.nextAction, /publication -- finalize/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runs/run-one/journal.json'), 'utf8')), oldRun);
    await json(root, 'runs/run-one/journal.json', { ...oldRun, finalDeliveryPolicy });
    const current = await loadContext({ root, intent: 'resume', run: 'run-one' }, deps);
    assert.equal(current.status, 'ready', JSON.stringify(current.gaps)); assert.match(current.nextAction, /publication -- finalize --run "run-one"/);
    await json(root, 'runs/run-one/journal.json', { ...oldRun, finalDeliveryPolicy: { ...finalDeliveryPolicy, desiredPageStatus: 'draft' } });
    const conflict = await loadContext({ root, intent: 'resume', run: 'run-one' }, deps);
    assert.equal(conflict.status, 'blocked'); assert.equal(conflict.gaps[0].code, 'context_final_delivery_policy_conflict');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('new replicas never inherit existing task; local context performs no writes/network/auth', async () => {
  const root = await fixture(), originalFetch = globalThis.fetch; let requests = 0;
  try {
    await json(root, 'references/old-task/job.json', job('old-task'));
    globalThis.fetch = (async () => { requests++; throw Error('network forbidden'); }) as typeof fetch;
    const before = await readdir(root);
    const result = await loadContext({ root, intent: 'replica' }, deps);
    assert.equal(result.status, 'ready'); assert.equal(result.task, undefined); assert.equal(result.metrics.fileWrites, 0); assert.equal(requests, 0); assert.deepEqual(await readdir(root), before);
    await assert.rejects(readFile(path.join(root, 'data/system/context-index.json')), { code: 'ENOENT' });
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});

test('fresh replicas read the full unified guide with raw hash and no candidate page statements', async () => {
  const root = await fixture();
  try {
    const text = '# Unified component knowledge\n\nKeep owner, source and editing model distinct.\n'.repeat(100);
    await writeFile(path.join(root, UNIFIED_ELEMENTOR_GUIDE), text);
    const candidates: ComponentRegistry = { ...registry, pagePatterns: { total: 1, entries: [{ learningId: 'old-page', recordRef: { path: 'learning/old-page/record.json', sha256: sha }, conclusionStatus: 'candidate-interpretation', conclusionCount: 1, conclusions: [{ responsibility: 'sample-detail', statement: 'ARCHIVED_PAGE_CANDIDATE', statementTruncated: false, evidenceIndexes: [0] }], evidenceCount: 0, evidence: [] }], additionalRecordRefs: [] } };
    const replica = await loadContext({ root, intent: 'replica' }, { ...deps, loadComponentRegistry: async () => candidates });
    for (const result of [replica]) {
      assert.equal(result.status, 'ready', JSON.stringify(result.gaps));
      const guide = result.documents.find(item => item.path === path.join(root, UNIFIED_ELEMENTOR_GUIDE));
      assert.ok(guide); assert.equal(guide.content, text); assert.equal(guide.sha256, contextHash(text)); assert.equal(guide.bytes, Buffer.byteLength(text));
      assert.equal(result.pagePatterns, undefined); assert.doesNotMatch(JSON.stringify(result), /ARCHIVED_PAGE_CANDIDATE/);
      assert.deepEqual([result.metrics.networkRequests, result.metrics.credentialLoads, result.metrics.browserStarts, result.metrics.fileWrites], [0, 0, 0, 0]);
    }
    const maintenance = await loadContext({ root, intent: 'maintain' }, { ...deps, loadComponentRegistry: async () => candidates });
    assert.match(JSON.stringify(maintenance.pagePatterns), /ARCHIVED_PAGE_CANDIDATE/);
    assert.equal(maintenance.documents.some(item => item.path === path.join(root, UNIFIED_ELEMENTOR_GUIDE)), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the unified guide uses normal safe text handling while its hash identifies the original bytes', async () => {
  const root = await fixture();
  try {
    const text = '# Guide\nhttps://example.test/docs/\nhttps://example.test/wp-admin/?session=GUIDE_SECRET\nAuthorization: Bearer GUIDE_SECRET\nCookie=GUIDE_SECRET';
    await writeFile(path.join(root, UNIFIED_ELEMENTOR_GUIDE), text);
    for (const intent of ['replica'] as const) {
      const result = await loadContext({ root, intent }, deps), guide = result.documents.find(item => item.path === path.join(root, UNIFIED_ELEMENTOR_GUIDE));
      assert.equal(result.status, 'ready'); assert.ok(guide); assert.equal(guide.content, contextSafeText(text)); assert.equal(guide.sha256, contextHash(text));
      assert.doesNotMatch(guide.content, /GUIDE_SECRET/); assert.match(guide.content, /https:\/\/example.test\/docs\//);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a missing or escaped unified guide blocks fresh builds and its allowlist grants no sibling docs', async () => {
  const root = await fixture(), outside = await fixture(), originalFetch = globalThis.fetch; let requests = 0;
  try {
    globalThis.fetch = (async () => { requests++; throw Error('network forbidden'); }) as typeof fetch;
    assert.equal(contextAllowed(UNIFIED_ELEMENTOR_GUIDE), true);
    assert.equal(contextAllowed('docs/knowledge/other.md'), false);
    assert.equal(contextAllowed('docs/other.md'), false);
    const reader = new ContextReader(root);
    await assert.rejects(reader.read('docs/knowledge/other.md'), /context_path_not_allowed/);
    await assert.rejects(reader.read('../elementor-container-patterns.md'), /context_path_escape/);
    await rm(path.join(root, UNIFIED_ELEMENTOR_GUIDE));
    for (const intent of ['replica'] as const) {
      const result = await loadContext({ root, intent }, deps);
      assert.equal(result.status, 'blocked'); assert.equal(result.gaps[0].code, 'context_file_missing'); assert.equal(result.metrics.fileWrites, 0);
    }
    assert.equal((await loadContext({ root, intent: 'learn' }, deps)).status, 'ready');
    await rm(path.join(root, 'docs/knowledge'), { recursive: true });
    await symlink(path.join(outside, 'docs/knowledge'), path.join(root, 'docs/knowledge'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const intent of ['replica'] as const) {
      const result = await loadContext({ root, intent }, deps);
      assert.equal(result.status, 'blocked'); assert.equal(result.gaps[0].code, 'context_path_escape'); assert.equal(result.metrics.fileWrites, 0);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('resume/compare returns ambiguity instead of selecting most recent run', async () => {
  const root = await fixture();
  try {
    await json(root, 'references/task-one/job.json', job('task-one'));
    for (const name of ['run-one', 'run-two']) await json(root, `runs/${name}/journal.json`, run('task-one', name));
    const result = await loadContext({ root, intent: 'resume' }, deps);
    assert.equal(result.status, 'needs-task-selection'); assert.equal(result.exitCode, 2); assert.equal(result.candidates?.length, 2);
    const exact = await loadContext({ root, intent: 'compare', run: 'run-one' }, deps);
    assert.equal(exact.status, 'ready'); assert.equal(exact.task?.runId, 'run-one'); assert.deepEqual(exact.task?.state.mutations, { confirmed: 1 });
    assert.doesNotMatch(JSON.stringify(exact), /SUPER_SECRET|preview_nonce|previewUrl/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('version two product omissions are descriptive context only and retain exact bounded identities', async () => {
  const root = await fixture();
  try {
    await json(root, 'references/task-one/job.json', job('task-one'));
    await json(root, 'runs/run-one/journal.json', run('task-one', 'run-one'));
    const scope = { version: 2, kind: 'clonewp-task-scope', taskId: 'task-one', summary: 'Keep native product layout; this user specifically omitted one area.', constraints: ['Native product styles remain in scope.'], catalogAreaOmissions: [{ snapshotId: 'desktop-wide', groupId: 'products', componentId: 'product-row', action: 'leave-product-area-empty', userInstruction: 'Leave only this one product area empty.' }] };
    await json(root, 'references/task-one/task-scope.json', scope);
    const loaded = await loadContext({ root, intent: 'resume', run: 'run-one' }, deps);
    assert.equal(loaded.status, 'ready'); assert.equal(loaded.task?.scope?.authority, 'descriptive-not-authorization'); assert.equal(loaded.task?.scope?.summary, scope.summary);
    for (const patch of [{ version: '2' }, { catalogAreaOmissions: [{ ...scope.catalogAreaOmissions[0], action: 'products-deferred-to-user' }] }, { catalogAreaOmissions: [{ ...scope.catalogAreaOmissions[0], userInstruction: '' }] }, { catalogAreaOmissions: [{ ...scope.catalogAreaOmissions[0], authorization: true }] }]) {
      await json(root, 'references/task-one/task-scope.json', { ...scope, ...patch });
      assert.equal((await loadContext({ root, intent: 'resume', run: 'run-one' }, deps)).gaps[0].code, 'context_task_scope_invalid');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit index stores identities and paths only, then summary rereads mutable runtime state', async () => {
  const root = await fixture();
  try {
    await json(root, 'references/task-one/job.json', job('task-one')); const originalRun = run('task-one', 'run-one');
    await json(root, 'runs/run-one/journal.json', originalRun); const index = await refreshContextIndex(root, { readRelease: fixtureRelease });
    assert.equal(index.tasks.length, 1); assert.equal(index.runs.length, 1); assert.doesNotMatch(JSON.stringify(index), /status|SUPER_SECRET|previewUrl/);
    await json(root, 'runs/run-one/journal.json', { ...originalRun, status: 'delivered', deliveryComplete: true });
    const loaded = await loadContext({ root, intent: 'resume', task: 'task-one' }, { ...deps, readCurrentRelease: fixtureRelease });
    assert.equal(loaded.status, 'ready'); assert.equal(loaded.task?.state.status, 'delivered'); assert.equal(loaded.task?.state.deliveryComplete, true); assert.match(loaded.nextAction, /只读/);
    await json(root, 'runs/run-one/journal.json', { ...originalRun, programHash: 'b'.repeat(64) });
    const stale = await loadContext({ root, intent: 'resume', run: 'run-one' }, deps);
    assert.equal(stale.status, 'blocked'); assert.equal(stale.gaps[0].code, 'context_index_stale_identity');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('retired original jobs are not indexed or resumed',async()=>{const root=await fixture();try{await json(root,'original/task-original/job.json',{version:1,workflow:'original-design',taskId:'task-original'});const index=await scanContextIndex(root);assert.equal(index.tasks.length,0);const result=await loadContext({root,intent:'resume',task:'task-original'},deps);assert.notEqual(result.status,'ready');}finally{await rm(root,{recursive:true,force:true});}});

test('historical replica task does not gain native44 component knowledge requirements', async () => {
  const root = await fixture();
  try {
    await json(root, 'references/old-task/job.json', { version: 1, workflow: 'block-replication', jobId: 'old-task', programPath: path.join(root, 'references/old-task/program.json') });
    await json(root, 'references/old-task/program.json', { version: 1, workflow: 'block-replication', blocks: [{ widgetType: 'image' }] });
    const loaded = await loadContext({ root, intent: 'resume', task: 'old-task' }, { readCurrentRelease: async () => { throw Error('should not apply new defaults'); }, loadComponentRegistry: async () => { throw Error('should not apply native44 whitelist'); } });
    assert.equal(loaded.status, 'ready'); assert.equal(loaded.currentRelease, undefined); assert.deepEqual(loaded.components, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing docs, missing selectors and duplicate index identities are blocking', async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, 'SYSTEM.md'));
    assert.equal((await loadContext({ root, intent: 'maintain' }, deps)).gaps[0].code, 'context_file_missing');
    await writeFile(path.join(root, 'SYSTEM.md'), 'System');
    assert.equal((await loadContext({ root, intent: 'resume', run: 'missing-run' }, deps)).gaps[0].code, 'context_run_not_found_or_task_conflict');
    const task = { taskId: 'task-one', mode: 'replica', job: { path: 'references/task-one/job.json', identityHash: sha } };
    await json(root, 'data/system/context-index.json', { version: 1, kind: 'clonewp-context-index', tasks: [task, task], runs: [], issues: [] });
    assert.equal((await loadContext({ root, intent: 'resume' }, deps)).gaps[0].code, 'context_index_duplicate_identity');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('allowlisted paths and realpath containment reject index and symlink escapes without returning secrets', async () => {
  const root = await fixture(), outside = await fixture();
  try {
    const value = job('task-one'); await json(root, 'config/credentials.json', value);
    await json(root, 'data/system/context-index.json', { version: 1, kind: 'clonewp-context-index', tasks: [{ taskId: 'task-one', mode: 'replica', job: { path: 'config/credentials.json', identityHash: contextRecordIdentity(value) } }], runs: [], issues: [] });
    assert.equal((await loadContext({ root, intent: 'resume', task: 'task-one' }, deps)).gaps[0].code, 'context_path_not_allowed');
    await rm(path.join(root, 'data/system/context-index.json'));
    await rm(path.join(root, '.agents/skills/clonewp'), { recursive: true }); await symlink(path.join(outside, '.agents/skills/clonewp'), path.join(root, '.agents/skills/clonewp'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await loadContext({ root, intent: 'maintain' }, deps)).gaps[0].code, 'context_path_escape');
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('explicit components are selective and resource adapter gaps do not pretend widget incompatibility', async () => {
  const root = await fixture(); let requested: readonly string[] = [];
  try {
    const result = await loadContext({ root, intent: 'learn', components: ['wd_sidebar'] }, { ...deps, loadComponentRegistry: async (_root, used) => { requested = used; return registry; } });
    assert.equal(result.status, 'ready'); assert.deepEqual(requested, ['wd_sidebar']); assert.equal(result.gaps[0].code, 'context_component_resource_adapter_unverified');
    assert.equal((await loadContext({ root, intent: 'learn', components: ['heading', 'heading'] }, deps)).status, 'blocked');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('documentation sanitizes credential and session-bearing links', () => {
  assert.doesNotMatch(contextSafeText('https://user:secret@example.test/ https://x.test/?preview_nonce=secret Authorization: Bearer secret Cookie=secret wp_app_password=secret'), /secret/);
  assert.match(contextSafeText('https://example.test/docs/'), /https:\/\/example.test\/docs\//);
  assert.doesNotMatch(contextSafeText('{"password":"DEMO_SECRET","Authorization":"Basic DEMO_SECRET","Cookie":"DEMO_SECRET"}'), /DEMO_SECRET/);
});

test('unrelated native44 contract drift cannot block original or historical replica context', async () => {
  const root = await fixture();
  try {
    await json(root, 'original/original-task/job.json', { version: 1, workflow: 'original-design', taskId: 'original-task' });
    await json(root, 'references/legacy-task/job.json', { version: 1, workflow: 'block-replication', jobId: 'legacy-task' });
    await refreshContextIndex(root, { readRelease: fixtureRelease }); await writeFile(path.join(root, 'COMPONENTS.md'), 'Updated native44 source description');
    const forbiddenDeps: ContextServices = { readCurrentRelease: async () => { throw Error('irrelevant new defaults'); }, loadComponentRegistry: async () => { throw Error('irrelevant new defaults'); } };
    assert.notEqual((await loadContext({ root, intent: 'resume', task: 'original-task' }, forbiddenDeps)).status, 'ready');
    assert.equal((await loadContext({ root, intent: 'resume', task: 'legacy-task' }, forbiddenDeps)).status, 'ready');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unknown or conflicting task strategy, profile, version and mode are blocked before contract loads', async () => {
  const root = await fixture(); let libraryReads = 0;
  try {
    const forbiddenDeps: ContextServices = { readCurrentRelease: async () => { libraryReads++; throw Error('must not read'); }, loadComponentRegistry: async () => { libraryReads++; throw Error('must not read'); } };
    for (const patch of [{ executionStrategy: 'unknown' }, { replicationProfile: 'phone-v1' }, { version: 3 }, { version: '2' }, { mode: 'original' }, { executionStrategy: undefined }, { replicationProfile: undefined }]) {
      await json(root, 'references/task-one/job.json', { ...job('task-one'), ...patch });
      assert.equal((await loadContext({ root, intent: 'resume', task: 'task-one' }, forbiddenDeps)).status, 'blocked');
    }
    assert.equal(libraryReads, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('selected task components load from actual program without copying business text or media IDs', async () => {
  const root = await fixture(); let selected: readonly string[] = [];
  try {
    const filename = path.join(root, 'references/task-one/program.json'), program = { ...job('task-one'), sourceUrl: 'https://example.test/', blocks: [{ kind: 'composite', children: [{ widgetType: 'heading', widgetSettings: { title: 'DO_NOT_COPY_BUSINESS_TEXT' } }, { widgetType: 'wd_image_or_svg', widgetSettings: { image: { id: 999999 } } }] }] };
    await json(root, 'references/task-one/program.json', program); const hash = contextHash(await readFile(filename));
    await json(root, 'references/task-one/job.json', { ...job('task-one'), programPath: filename });
    await json(root, 'runs/run-one/journal.json', { ...run('task-one', 'run-one'), programHash: hash });
    const result = await loadContext({ root, intent: 'resume', run: 'run-one' }, { ...deps, loadComponentRegistry: async (_root, types) => { selected = types; return registry; } });
    assert.equal(result.status, 'ready'); assert.deepEqual(selected, ['heading', 'wd_image_or_svg']); assert.doesNotMatch(JSON.stringify(result), /DO_NOT_COPY_BUSINESS_TEXT|999999/);
    for (const [patch, code] of [[{ taskId: 'wrong-task' }, 'context_selected_program_task_conflict'], [{ selectionRulesHash: 'b'.repeat(64) }, 'context_selected_program_contract_conflict'], [{ sourceUrl: 'https://wrong.example/' }, 'context_selected_program_source_conflict']] as const) { await json(root, 'references/task-one/program.json', { ...program, ...patch }); assert.equal((await loadContext({ root, intent: 'resume', run: 'run-one' }, deps)).gaps[0].code, code); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('contract index preserves references while unlocked legacy task keeps its own compatibility path', async () => {
  const root = await fixture();
  try {
    await json(root, 'references/task-one/job.json', job('task-one'));
    const index = await refreshContextIndex(root, { readRelease: fixtureRelease }); assert.ok(index.contracts); assert.equal(index.contracts.knowledge.id, 'knowledge-v1');
    await writeFile(path.join(root, 'COMPONENTS.md'), 'changed contract');
    const loaded = await loadContext({ root, intent: 'resume', task: 'task-one' }, deps);
    assert.equal(loaded.status, 'ready'); assert.equal(loaded.contractSelection, 'legacy-task-base-only');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('frozen release is loaded by hash, detects contract drift and never rewrites the task', async () => {
  const root = await fixture();
  try {
    const system = await readFile(path.join(root, 'SYSTEM.md')), components = await readFile(path.join(root, 'COMPONENTS.md'));
    const frozen = { ...release, componentSet: { ...release.componentSet, catalog: { path: 'SYSTEM.md', sha256: contextHash(system) } }, knowledge: { ...release.knowledge, index: { path: 'COMPONENTS.md', sha256: contextHash(components) } } };
    const lock = { version: 1, kind: 'native44-release-lock', phase: 'draft', taskId: 'task-one', replicationProfile: 'desktop-browser-v1', createdAt: new Date().toISOString(), release: frozen };
    await json(root, 'references/task-one/release-draft.json', lock);
    const lockPath = path.join(root, 'references/task-one/release-draft.json'), lockedJob = { ...job('task-one'), releaseLock: { path: lockPath, sha256: contextHash(await readFile(lockPath)) } };
    await json(root, 'references/task-one/job.json', lockedJob); const jobBefore = await readFile(path.join(root, 'references/task-one/job.json'));
    const frozenDeps = { ...deps, readCurrentRelease: async () => frozen };
    const loaded = await loadContext({ root, intent: 'resume', task: 'task-one' }, frozenDeps);
    assert.equal(loaded.status, 'ready'); assert.equal(loaded.task?.frozenIdentity.releasePhase, 'draft');
    const drift = await loadContext({ root, intent: 'resume', task: 'task-one' }, deps);
    assert.equal(drift.status, 'blocked'); assert.equal(drift.gaps[0].code, 'context_locked_contract_drift');
    assert.deepEqual(await readFile(path.join(root, 'references/task-one/job.json')), jobBefore);
    await writeFile(path.join(root, 'SYSTEM.md'), 'modified source');
    assert.equal((await loadContext({ root, intent: 'resume', task: 'task-one' }, frozenDeps)).gaps[0].code, 'context_release_contract_hash_mismatch');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('context CLI parsing rejects unknown/duplicate options and accepts documented intents', () => {
  assert.equal(parseContextArguments(['load', '--intent', 'missing'], '/tmp'), undefined);
  assert.equal(parseContextArguments(['load', '--intent', 'resume', '--intent', 'learn'], '/tmp'), undefined);
  assert.equal(parseContextArguments(['index', '--intent', 'learn'], '/tmp'), undefined);
  assert.deepEqual(parseContextArguments(['load', '--intent', 'learn', '--components', 'heading,wd_list'], '/tmp'), { command: 'load', options: { root: '/tmp', intent: 'learn', components: ['heading', 'wd_list'] } });
});

test('optional task scope is descriptive, hash referenced, sanitized and strictly bound to its task', async () => {
  const root = await fixture();
  try {
    await json(root, 'references/task-one/job.json', job('task-one'));
    const scope = { version: 1, kind: 'clonewp-task-scope', taskId: 'task-one', summary: 'Prior task scope; password=SECRET', constraints: ['Do not rebuild the historical page.', 'https://example.test/?preview_nonce=SECRET'] };
    await json(root, 'references/task-one/task-scope.json', scope);
    const loaded = await loadContext({ root, intent: 'resume', task: 'task-one' }, deps);
    assert.equal(loaded.status, 'ready'); assert.equal(loaded.task?.scope?.authority, 'descriptive-not-authorization'); assert.ok(loaded.records.some(ref => ref.path.endsWith('task-scope.json') && /^[a-f\d]{64}$/.test(ref.sha256))); assert.doesNotMatch(JSON.stringify(loaded), /SECRET/); assert.equal(loaded.task?.state.status, undefined);
    await json(root, 'references/task-one/task-scope.json', { ...scope, taskId: 'another-task' });
    assert.equal((await loadContext({ root, intent: 'resume', task: 'task-one' }, deps)).gaps[0].code, 'context_task_scope_invalid');
    await json(root, 'references/task-one/task-scope.json', { ...scope, completed: true });
    assert.equal((await loadContext({ root, intent: 'resume', task: 'task-one' }, deps)).gaps[0].code, 'context_task_scope_invalid');
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const profile of ['historical-four-view', 'existing-desktop'] as const) test(`unlocked ${profile} task stays base-only across real knowledge publication and unrelated adapter index drift`, async () => {
  const root = await fixture();
  try {
    await copyRealContracts(root); const current = await readCurrentRelease(root), taskId = `legacy-${profile}`;
    const marker = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, url: 'https://example.test/', ...(profile === 'existing-desktop' ? { replicationProfile: 'desktop-browser-v1', selectionRulesHash: current.selectionRules.sha256 } : {}), componentCatalog: current.componentSet.catalog, knowledge: { ...current.knowledge.index, fingerprint: current.knowledge.fingerprint } };
    const jobPath = `references/${taskId}/job.json`; await json(root, jobPath, marker); const originalJob = await readFile(path.join(root, jobPath));
    const before = await loadContext({ root, intent: 'resume', task: taskId, components: ['heading'] });
    assert.equal(before.status, 'ready', JSON.stringify(before.gaps)); assert.equal(before.contractSelection, 'legacy-task-base-only'); assert.equal((before.pagePatterns as { total: number }).total, 0);
    await appendLegacyLearningFixture(root, current.knowledge.fingerprint);
    const latest = await loadContext({ root, intent: 'maintain', components: ['heading'] }); assert.equal(latest.status, 'ready'); assert.equal((latest.pagePatterns as { total: number }).total, 1); assert.ok((latest.currentRelease as SystemRelease).knowledge.learningRelease);
    await refreshContextIndex(root);
    const adapterFile = path.join(root, 'src/native44/interaction-check.ts'); await writeFile(adapterFile, `${await readFile(adapterFile, 'utf8')}\n// unrelated current adapter index drift\n`);
    const after = await loadContext({ root, intent: 'resume', task: taskId, components: ['heading'] });
    assert.equal(after.status, 'ready', JSON.stringify(after.gaps)); assert.equal(after.contractSelection, 'legacy-task-base-only'); assert.equal((after.pagePatterns as { total: number }).total, 0); assert.equal((after.currentRelease as SystemRelease).knowledge.learningRelease, undefined); assert.deepEqual(after.components, before.components); assert.deepEqual(after.task?.frozenIdentity, before.task?.frozenIdentity); assert.deepEqual(await readFile(path.join(root, jobPath)), originalJob);
    assert.equal(after.metrics.fileWrites, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real current release draft and final locks load every declared source contract with selective component knowledge', async () => {
  const root = await fixture();
  try {
    await copyRealContracts(root);
    const release = await readCurrentRelease(root), jobDir = path.join(root, 'references/real-task'); await mkdir(jobDir, { recursive: true });
    const releaseLock = await createNative44ReleaseDraft(root, jobDir, 'real-task');
    const programFile = path.join(jobDir, 'program.json');
    await json(root, 'references/real-task/job.json', { ...job('real-task'), selectionRulesHash: release.selectionRules.sha256, releaseLock });
    const draft = await loadContext({ root, intent: 'resume', task: 'real-task' });
    assert.equal(draft.status, 'ready', JSON.stringify(draft.gaps)); assert.equal(draft.task?.frozenIdentity.releasePhase, 'draft');
    const appendLearning = async (id: string, previous?: { path: string; sha256: string }, kind: 'component-learning-record' | 'page-learning-record' = 'component-learning-record') => {
      const evidence = Buffer.from(JSON.stringify({ kind: 'generic-layout-example', example: id })), evidenceHash = contextHash(evidence), evidencePath = `learning/${id}/evidence/${evidenceHash}.json`;
      await json(root, evidencePath, JSON.parse(evidence.toString('utf8')));
      const record = { version: 1, kind, learningId: id, ...(kind === 'component-learning-record' ? { widgetType: 'heading', provider: 'elementor' } : {}), createdAt: new Date().toISOString(), mode: kind === 'component-learning-record' ? 'existing-component-recipe' : 'page-pattern', evidence: [{ path: evidencePath, sha256: evidenceHash, kind: 'dom-instance', scope: 'dom-instance-observation' }], conclusions: [{ responsibility: 'heading', statement: 'Scoped example only; password=PATTERN_SECRET', evidenceIndexes: [0] }], conclusionStatus: 'candidate-interpretation', qualification: { source: 'unverified', save: 'unverified', render: 'unverified', interaction: 'unverified', resources: 'task-local-only', registration: 'task-local-only' }, constraints: ['Knowledge only.'], baseKnowledgeFingerprint: release.knowledge.fingerprint };
      const recordPath = `learning/${id}/record.json`; await json(root, recordPath, record);
      const identity = { version: 1, kind: 'component-learning-release', ...(previous ? { previous } : {}), records: [{ path: recordPath, sha256: contextHash(await readFile(path.join(root, recordPath))) }], baseKnowledgeFingerprint: release.knowledge.fingerprint, enabledSetHash: NATIVE44_CATALOG_HASH, activation: 'knowledge-only' };
      const releaseId = contextHash(componentCanonical(identity)), releasePath = `learning/releases/${releaseId}.json`; await json(root, releasePath, { ...identity, releaseId });
      const ref = { path: releasePath, sha256: contextHash(await readFile(path.join(root, releasePath))) }; await json(root, 'data/system/knowledge-current.json', { version: 1, release: ref }); return ref;
    };
    const firstLearning = await appendLearning('learn-first');
    const firstPageLearning = await appendLearning('page-first', firstLearning, 'page-learning-record');
    const baseAfterLearning = await loadContext({ root, intent: 'resume', task: 'real-task' });
    assert.equal(baseAfterLearning.status, 'ready', JSON.stringify(baseAfterLearning.gaps)); assert.equal((baseAfterLearning.task?.frozenIdentity.release as SystemRelease).knowledge.learningRelease, undefined); assert.equal(baseAfterLearning.contractSelection, 'task-frozen');
    const learnedJobDir = path.join(root, 'references/learned-task'); await mkdir(learnedJobDir, { recursive: true });
    const learnedLock = await createNative44ReleaseDraft(root, learnedJobDir, 'learned-task');
    await json(root, 'references/learned-task/job.json', { ...job('learned-task'), selectionRulesHash: release.selectionRules.sha256, releaseLock: learnedLock });
    const learnedJobBefore = await readFile(path.join(learnedJobDir, 'job.json')), learnedLockBefore = await readFile(path.resolve(root, learnedLock.path));
    const secondLearning = await appendLearning('learn-second', firstPageLearning);
    await appendLearning('page-second', secondLearning, 'page-learning-record');
    await writeFile(path.join(root, UNIFIED_ELEMENTOR_GUIDE), '# LATEST_GUIDE_MUST_NOT_ENTER_FROZEN_CONTEXT');
    const learnedTask = await loadContext({ root, intent: 'resume', task: 'learned-task', components: ['heading'] });
    assert.equal(learnedTask.status, 'ready', JSON.stringify(learnedTask.gaps)); assert.deepEqual((learnedTask.task?.frozenIdentity.release as SystemRelease).knowledge.learningRelease, firstPageLearning);
    assert.match(JSON.stringify(learnedTask.components), /learn-first/); assert.doesNotMatch(JSON.stringify(learnedTask.components), /learn-second/);
    assert.match(JSON.stringify(learnedTask.pagePatterns), /page-first/); assert.doesNotMatch(JSON.stringify(learnedTask.pagePatterns), /page-second|PATTERN_SECRET/);
    await rm(path.join(root, UNIFIED_ELEMENTOR_GUIDE));
    for (const intent of ['resume', 'compare'] as const) {
      const historical = await loadContext({ root, intent, task: 'learned-task', components: ['heading'] });
      assert.equal(historical.status, 'ready', JSON.stringify(historical.gaps));
      assert.deepEqual(historical.pagePatterns, learnedTask.pagePatterns);
      assert.equal(historical.documents.some(item => item.path === path.join(root, UNIFIED_ELEMENTOR_GUIDE)), false);
      assert.doesNotMatch(JSON.stringify(historical), /LATEST_GUIDE_MUST_NOT_ENTER_FROZEN_CONTEXT/);
      assert.equal(historical.metrics.fileWrites, 0);
    }
    assert.deepEqual(await readFile(path.join(learnedJobDir, 'job.json')), learnedJobBefore);
    assert.deepEqual(await readFile(path.resolve(root, learnedLock.path)), learnedLockBefore);
    const refs: Record<string, { path: string; sha256: string }> = {};
    for (const [key, filename] of [['sourceFacts', 'source-facts.json'], ['componentPlan', 'component-plan.json'], ['assetsManifest', 'assets-manifest.json']]) { const name = `references/real-task/${filename}`; await json(root, name, { version: 2, fixture: key, ...(key === 'sourceFacts' ? { largeSourceObservation: 'x'.repeat(17 * 1024 * 1024) } : {}) }); refs[key] = { path: path.join(root, name), sha256: contextHash(await readFile(path.join(root, name))) }; }
    const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: release.selectionRules.sha256, taskId: 'real-task', title: 'Fixture', sourceUrl: 'https://example.test/', componentCatalog: { ...release.componentSet.catalog, path: path.join(root, release.componentSet.catalog.path) }, knowledge: { ...release.knowledge.index, path: path.join(root, release.knowledge.index.path), fingerprint: release.knowledge.fingerprint }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: refs.sourceFacts, componentPlan: refs.componentPlan, assetsManifest: refs.assetsManifest, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' }, { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' }], blocks: [{ key: 'intro', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Local fixture' } }] };
    await json(root, 'references/real-task/program.json', program);
    const final = await prepareNative44ReleaseLock(root, jobDir, { filename: programFile, sha256: contextHash(await readFile(programFile)), program }); assert.ok(final);
    const currentJob = JSON.parse(await readFile(path.join(jobDir, 'job.json'), 'utf8')); await json(root, 'references/real-task/job.json', { ...currentJob, programPath: programFile });
    const loaded = await loadContext({ root, intent: 'resume', task: 'real-task' });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded.gaps)); assert.equal(loaded.task?.frozenIdentity.releasePhase, 'final'); assert.equal(loaded.components.length, 1); assert.equal(loaded.metrics.fileWrites, 0); assert.ok(loaded.metrics.filesRead > 30);
    assert.ok(loaded.metrics.bytesRead > 17 * 1024 * 1024, 'Large frozen source observations are hashed without entering the context documents');
    const alternative = path.join(root, 'references/alternate-task/program.json'); await json(root, 'references/alternate-task/program.json', program);
    await json(root, 'references/real-task/job.json', { ...currentJob, programPath: alternative }); await refreshContextIndex(root);
    assert.equal((await loadContext({ root, intent: 'resume', task: 'real-task' })).gaps[0].code, 'context_selected_program_release_conflict');
    await json(root, 'references/real-task/job.json', { ...currentJob, programPath: programFile }); await refreshContextIndex(root);
    await writeFile(path.join(root, 'src/wordpress/editor-serialization.ts'), 'changed contract');
    const stale = await loadContext({ root, intent: 'resume', task: 'real-task' }); assert.equal(stale.status, 'blocked'); assert.equal(stale.gaps[0].code, 'context_index_contract_stale');
    await rm(path.join(root, 'data/system/context-index.json'));
    const staleLock = await loadContext({ root, intent: 'resume', task: 'real-task' }); assert.equal(staleLock.status, 'blocked'); assert.equal(staleLock.gaps[0].code, 'context_release_contract_hash_mismatch');
  } finally { await rm(root, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { copySystemReleaseFixture } from './fixtures/system-release.js';
import { readCurrentRelease, readLearningReleases } from '../src/components/registry.js';
import { learnComponent } from '../src/components/learning.js';
import { createNative44ReleaseDraft, prepareNative44ReleaseLock, readNative44ReleaseLock, assertNative44ReleaseIdentity } from '../src/native44/release-lock.js';
import { hashV2 } from '../src/replica-v2/journal.js';
import { acquireLock } from '../src/core/files.js';
import { native44KnowledgeIdentity, loadNative44Knowledge } from '../src/native44/knowledge.js';
import { DESKTOP_BROWSER_PROFILE, native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { prepareLocalTask, validateLocalNative44Input } from '../src/native44/runtime.js';
import { prepareTargetContext, Native44TargetContextError, type Native44TargetReader } from '../src/native44/target-context.js';
import { preflightNative44 } from '../src/native44/compiler.js';
import type { Native44Program } from '../src/native44/types.js';
import type { ValidatedTaskInput } from '../src/native44/local-task.js';
import type { PreflightReport, CapabilityReport } from '../src/wordpress/types.js';
import { normalizeTargetPostsQuery } from '../src/wordpress/posts-contract.js';

async function json(filename: string, value: unknown) { const bytes = Buffer.from(JSON.stringify(value)); await writeFile(filename, bytes); return { path: filename, sha256: hashV2(bytes) }; }
async function fixture(t: { after(callback: () => Promise<void>): void }, locked = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native44-release-')); t.after(async () => { assert.ok(path.basename(root).startsWith('native44-release-')); await rm(root, { recursive: true, force: true }); });
  await copySystemReleaseFixture(root); const taskId = 'lock-fixture', jobDir = path.join(root, 'references', taskId); await mkdir(jobDir, { recursive: true });
  const identity = await native44KnowledgeIdentity(root), local = await json(path.join(jobDir, 'input.json'), { local: true });
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: DESKTOP_BROWSER_PROFILE, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId, title: 'Lock fixture', sourceUrl: 'https://source.example/', ...identity, sourceFacts: local, componentPlan: local, assetsManifest: local, viewports: native44ProfileViewports(DESKTOP_BROWSER_PROFILE), blocks: [] };
  const filename = path.join(jobDir, 'program.json'), ref = await json(filename, program), releaseLock = locked ? await createNative44ReleaseDraft(root, jobDir, taskId) : undefined;
  const jobFile = path.join(jobDir, 'job.json'); await json(jobFile, { taskId, ...(releaseLock ? { releaseLock } : {}) });
  return { root, taskId, jobDir, jobFile, binding: { filename, sha256: ref.sha256, program }, releaseLock };
}
test('release lock freezes actual local contracts then binds final program once without a job/hash cycle', async t => {
  const f = await fixture(t), draftBytes = await readFile(f.releaseLock!.path), before = await readNative44ReleaseLock(f.root, f.releaseLock!, { taskId: f.taskId });
  assert.equal(before.phase, 'draft'); assert.equal(before.program, undefined);
  const ref = await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), lock = await readNative44ReleaseLock(f.root, ref!, { taskId: f.taskId, program: f.binding });
  assert.equal(lock.phase, 'final'); assert.equal(lock.program!.sha256, f.binding.sha256); assert.equal(lock.release.componentSet.types.length, 44); assert.equal('jobHash' in lock, false);
  assert.deepEqual((JSON.parse(await readFile(f.jobFile, 'utf8'))).releaseLock, ref); assert.deepEqual(await readFile(f.releaseLock!.path), draftBytes);
  const finalBytes = await readFile(ref!.path); assert.deepEqual(await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), ref); assert.deepEqual(await readFile(ref!.path), finalBytes);
});
test('historical jobs have no release lock added and a changed final program cannot refresh its release', async t => {
  const old = await fixture(t, false), before = await readFile(old.jobFile), names = await readdir(old.jobDir);
  assert.equal(await prepareNative44ReleaseLock(old.root, old.jobDir, old.binding), undefined); assert.deepEqual(await readFile(old.jobFile), before); assert.deepEqual(await readdir(old.jobDir), names);
  const f = await fixture(t), ref = await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), locked = await readFile(ref!.path);
  f.binding.program.title = 'Human changed title'; Object.assign(f.binding, { sha256: (await json(f.binding.filename, f.binding.program)).sha256 });
  await assert.rejects(prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), /release_reference_changed|release_program_changed/); assert.deepEqual(await readFile(ref!.path), locked);
});
test('release finalization serializes cooperating generators and recovers a final file whose job reference was not committed', async t => {
  const f = await fixture(t), before = await readFile(f.jobFile), unlock = await acquireLock(f.jobDir);
  try { await assert.rejects(prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), /Another cloneWP run/); assert.deepEqual(await readFile(f.jobFile), before); }
  finally { await unlock(); }
  const ref = await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), finalBytes = await readFile(ref!.path);
  await writeFile(f.jobFile, before); // Simulates termination after final lock, before marker rename.
  assert.deepEqual(await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), ref); assert.deepEqual(await readFile(ref!.path), finalBytes);
  await json(f.jobFile, { taskId: f.taskId });
  await assert.rejects(prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), /ref_missing_with_existing_lock/);
});
test('self-authored release JSON cannot expand components, omit adapters or replace contract files', async t => {
  const f = await fixture(t), lock = await readNative44ReleaseLock(f.root, f.releaseLock!);
  lock.release.componentSet.types[0] = 'unapproved'; let forged = await json(path.join(f.jobDir, 'forged.json'), lock); await assert.rejects(readNative44ReleaseLock(f.root, forged), /cannot_expand/);
  lock.release = await readCurrentRelease(f.root); lock.release.adapters.files.pop(); forged = await json(forged.path, lock); await assert.rejects(readNative44ReleaseLock(f.root, forged), /locked_contract_drift/);
  lock.release = await readCurrentRelease(f.root); const adapter = path.join(f.root, lock.release.adapters.files[0].path); await writeFile(adapter, 'changed adapter'); await assert.rejects(readNative44ReleaseLock(f.root, f.releaseLock!), /reference_changed/);
  assert.throws(() => assertNative44ReleaseIdentity(f.releaseLock, undefined), /identity_differs/);
});
test('append-only knowledge releases keep old task locks and their selected learning chain frozen', async t => {
  const f = await fixture(t, false), evidenceDir = path.join(f.root, 'tests', 'evidence'); await mkdir(evidenceDir, { recursive: true });
  const phpName = path.join(evidenceDir, 'future-card.php'), php = Buffer.from("<?php class Example { public function get_name() { return 'future_card'; } protected function register_controls() { $this->add_control('title', ['type' => Controls_Manager::TEXT]); } }"); await writeFile(phpName, php);
  const source = { path: 'tests/evidence/future-card.php', sha256: hashV2(php) }, contract = await json(path.join(evidenceDir, 'contract.json'), { version: 1, kind: 'component-source-contract', widgetType: 'future_card', provider: 'example', source, controls: [{ id: 'title', type: 'text' }] });
  const manifest = path.join(evidenceDir, 'manifest.json'); await json(manifest, { version: 1, kind: 'component-learning-evidence', widgetType: 'future_card', provider: 'example', evidence: [{ ...contract, kind: 'source-contract', scope: 'source-contract' }], conclusions: [{ responsibility: 'information-card', statement: 'The studied source provides a title content field.', evidenceIndexes: [0] }] });
  const first = await learnComponent(f.root, 'future_card', manifest), draftRef = await createNative44ReleaseDraft(f.root, f.jobDir, f.taskId); await json(f.jobFile, { taskId: f.taskId, releaseLock: draftRef });
  const finalRef = await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), finalBytes = await readFile(finalRef!.path);
  const second = await learnComponent(f.root, 'future_card', manifest); assert.notDeepEqual(first.releaseRef, second.releaseRef);
  const lock = await readNative44ReleaseLock(f.root, finalRef!, { taskId: f.taskId, program: f.binding }); assert.deepEqual(lock.release.knowledge.learningRelease, first.releaseRef);
  assert.equal((await readLearningReleases(f.root, lock.release.knowledge.fingerprint, { release: lock.release.knowledge.learningRelease })).length, 1);
  assert.equal((await readLearningReleases(f.root, lock.release.knowledge.fingerprint)).length, 2);
  assert.deepEqual(await prepareNative44ReleaseLock(f.root, f.jobDir, f.binding), finalRef); assert.deepEqual(await readFile(finalRef!.path), finalBytes);
  await writeFile(path.join(f.root, 'data/system/knowledge-current.json'), '{broken latest pointer');
  assert.deepEqual((await readNative44ReleaseLock(f.root, finalRef!)).release.knowledge.learningRelease, first.releaseRef);
  const record = first.record.evidence[0]; await writeFile(path.join(f.root, record.path), 'changed frozen evidence'); await assert.rejects(readNative44ReleaseLock(f.root, finalRef!), /hash_mismatch/);
});
test('local service keeps the historical validator alias and target preparation exposes only read capabilities', async () => {
  assert.equal(prepareLocalTask, validateLocalNative44Input);
  const root = path.resolve(import.meta.dirname, '..'), core = JSON.parse(await readFile(path.join(root, 'tests/fixtures/native44-core-source.json'), 'utf8'));
  const knowledge = await loadNative44Knowledge(['container', 'heading']), identity = await native44KnowledgeIdentity(root), dummy = { path: 'fixture.json', sha256: 'a'.repeat(64) };
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'service-fixture', title: 'Service fixture', sourceUrl: 'https://source.example/', ...identity, sourceFacts: dummy, componentPlan: dummy, assetsManifest: dummy, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }, { name: 'mobile', width: 390, height: 844, stage: 'responsive' }], blocks: [{ kind: 'native', key: 'title', widgetType: 'heading', widgetSettings: { title: 'Editable title' } }] };
  const preflight: PreflightReport = { targetUrl: 'https://target.example/', authenticated: true, userId: 1, plugins: [{ plugin: 'elementor/elementor', name: 'Elementor', status: 'active', version: '3.33.2' }, { plugin: 'elementor-pro/elementor-pro', name: 'Pro', status: 'active', version: '3.32.1' }, { plugin: 'woodmart-core/woodmart-core', name: 'Core', status: 'active', version: '1.1.5' }], themes: [], namespaces: [], novamiraInstalled: true, novamiraActive: true, blockers: [] };
  const capabilities: CapabilityReport = { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, heading: { type: 'heading', class: 'Heading', controls: { title: { type: 'textarea' } } } }, versions: { elementor: '3.33.2', elementorPro: '3.32.1', woodmart: '8.3.4', woodmartCore: '1.1.5', activeTemplate: 'woodmart' }, sourceProof: core.sourceProof, limitations: [] };
  const calls: string[] = [], reader: Native44TargetReader = { preflight: async () => { calls.push('preflight'); return preflight; }, discoverCapabilities: async types => { calls.push(`contracts:${types!.join(',')}`); return capabilities; }, readTargetCatalog: async () => { throw Error('Static page must not read product resources'); } };
  const input = { program, componentPlan: {} as ValidatedTaskInput['componentPlan'], sourceFacts: {} as ValidatedTaskInput['sourceFacts'], knowledge };
  const context = await prepareTargetContext(reader, input, preflight.targetUrl); assert.equal(context.environment.contractCompatible, true); assert.equal(context.catalog, undefined); assert.deepEqual(calls, ['preflight', 'contracts:container,heading']);
  preflight.blockers.push('Platform unavailable'); await assert.rejects(prepareTargetContext(reader, input, preflight.targetUrl), Native44TargetContextError); assert.equal(calls.filter(call => call.startsWith('contracts')).length, 1);
});
test('read-only product preparation accepts a real unpersisted catalog; compiler preflight follows durable local catalog evidence', async t => {
  const root = path.resolve(import.meta.dirname, '..'), core = JSON.parse(await readFile(path.join(root, 'tests/fixtures/native44-core-source.json'), 'utf8'));
  const knowledge = await loadNative44Knowledge(['container', 'wd_products']), identity = await native44KnowledgeIdentity(root), dummy = { path: 'fixture.json', sha256: 'a'.repeat(64) };
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'product-service-fixture', title: 'Product service fixture', sourceUrl: 'https://source.example/', ...identity, sourceFacts: dummy, componentPlan: dummy, assetsManifest: dummy, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }, { name: 'mobile', width: 390, height: 844, stage: 'responsive' }], blocks: [{ kind: 'native-products', key: 'products', widgetType: 'wd_products', widgetSettings: {}, query: { ids: [1], evidence: ['frozen-query.json'] } }] };
  const preflight: PreflightReport = { targetUrl: 'https://target.example/', authenticated: true, userId: 1, plugins: [{ plugin: 'elementor/elementor', name: 'Elementor', status: 'active', version: '3.33.2' }, { plugin: 'elementor-pro/elementor-pro', name: 'Pro', status: 'active', version: '3.32.1' }, { plugin: 'woodmart-core/woodmart-core', name: 'Core', status: 'active', version: '1.1.5' }, { plugin: 'woocommerce/woocommerce', name: 'WooCommerce', status: 'active', version: '10.7.0' }], themes: [], namespaces: [], novamiraInstalled: true, novamiraActive: true, blockers: [] };
  const capabilities: CapabilityReport = { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, wd_products: { type: 'wd_products', class: 'Products', controls: { post_type: { type: 'select', options: { ids: 'IDs' } }, include: { type: 'wd_autocomplete' }, orderby: { type: 'select', options: { date: 'Date' } }, items_per_page: { type: 'number' } } } }, versions: { elementor: '3.33.2', elementorPro: '3.32.1', woodmart: '8.3.4', woodmartCore: '1.1.5', activeTemplate: 'woodmart' }, sourceProof: core.sourceProof, limitations: [] };
  const catalog: Awaited<ReturnType<Native44TargetReader['readTargetCatalog']>> = { version: 1, targetOrigin: 'https://target.example', readAt: new Date().toISOString(), evidence: [], query: { limit: 200, status: 'publish', visibility: 'visible', orderby: 'date', order: 'DESC', tieBreak: { orderby: 'ID', order: 'DESC' } }, products: [{ id: 1, name: 'Actual catalog fixture product', permalink: 'https://target.example/product/one/', imageUrl: 'https://target.example/one.png', imageVariants: [], priceText: '$10.00' }] };
  const calls: string[] = [], reader: Native44TargetReader = { preflight: async () => { calls.push('preflight'); return preflight; }, discoverCapabilities: async () => { calls.push('contracts'); return capabilities; }, readTargetCatalog: async () => { calls.push('catalog-read'); return catalog; } };
  const context = await prepareTargetContext(reader, { program, componentPlan: {} as ValidatedTaskInput['componentPlan'], sourceFacts: {} as ValidatedTaskInput['sourceFacts'], knowledge }, preflight.targetUrl);
  assert.deepEqual(context.catalog!.evidence, []); assert.deepEqual(calls, ['preflight', 'contracts', 'catalog-read']);
  const options = { schemas: context.capabilities.legacySchemas, knowledge: context.knowledge, catalog: context.catalog, targetOrigin: 'https://target.example' };
  assert.throws(() => preflightNative44(program, options), /Actual target catalog proof is missing/);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native44-product-proof-')); t.after(async () => { assert.ok(path.basename(directory).startsWith('native44-product-proof-')); await rm(directory, { recursive: true, force: true }); });
  const filename = path.join(directory, 'catalog.json'); context.catalog!.evidence = [filename]; await json(filename, context.catalog);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')).products, catalog.products);
  assert.equal(preflightNative44(program, options).passed, true); assert.deepEqual(calls, ['preflight', 'contracts', 'catalog-read']);
});

test('target preparation reads each distinct latest-posts query once and never requests a product catalog for article lists', async () => {
  const root = path.resolve(import.meta.dirname, '..'), core = JSON.parse(await readFile(path.join(root, 'tests/fixtures/native44-core-source.json'), 'utf8'));
  const knowledge = await loadNative44Knowledge(['container', 'wd_blog']), identity = await native44KnowledgeIdentity(root), dummy = { path: 'fixture.json', sha256: 'a'.repeat(64) };
  const query = { itemsPerPage: 4, orderby: 'date', order: 'desc', evidence: ['source-news-query.json'] } as const;
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', articleListPolicy: 'target-posts-v1', taskId: 'posts-service-fixture', title: 'Posts service fixture', sourceUrl: 'https://source.example/', ...identity, sourceFacts: dummy, componentPlan: dummy, assetsManifest: dummy, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks: ['latest', 'more'].map(key => ({ kind: 'native-posts', key, widgetType: 'wd_blog', widgetSettings: {}, query: { ...query, evidence: [...query.evidence] } })) };
  const preflight: PreflightReport = { targetUrl: 'https://target.example/', authenticated: true, userId: 1, plugins: [{ plugin: 'elementor/elementor', name: 'Elementor', status: 'active', version: '3.33.2' }, { plugin: 'elementor-pro/elementor-pro', name: 'Pro', status: 'active', version: '3.32.1' }, { plugin: 'woodmart-core/woodmart-core', name: 'Core', status: 'active', version: '1.1.5' }], themes: [], namespaces: [], novamiraInstalled: true, novamiraActive: true, blockers: [] };
  const capabilities: CapabilityReport = { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, wd_blog: { type: 'wd_blog', class: 'Blog', controls: { post_type: { type: 'select', options: { post: 'Posts' } }, orderby: { type: 'select', options: { date: 'Date' } }, order: { type: 'select', options: { desc: 'Descending' } }, items_per_page: { type: 'number' } } } }, versions: { elementor: '3.33.2', elementorPro: '3.32.1', woodmart: '8.3.4', woodmartCore: '1.1.5', activeTemplate: 'woodmart' }, sourceProof: core.sourceProof, limitations: [] };
  const calls: string[] = [], reader: Native44TargetReader = { preflight: async () => preflight, discoverCapabilities: async () => capabilities, readTargetCatalog: async () => { throw Error('Article lists cannot read products'); }, readTargetPosts: async actualQuery => { calls.push(JSON.stringify(actualQuery)); return { version: 1, targetOrigin: 'https://target.example', readAt: new Date().toISOString(), evidence: [], query: normalizeTargetPostsQuery(actualQuery), posts: [] }; } };
  const input = { program, componentPlan: {} as ValidatedTaskInput['componentPlan'], sourceFacts: {} as ValidatedTaskInput['sourceFacts'], knowledge };
  const context = await prepareTargetContext(reader, input, preflight.targetUrl);
  assert.equal(context.catalog, undefined); assert.equal(context.posts?.length, 1); assert.deepEqual(calls, [JSON.stringify(normalizeTargetPostsQuery(query))]);
  assert.deepEqual(context.posts?.[0].evidence, [], 'runtime must persist observation before compiler authorization');
  reader.readTargetPosts = undefined; await assert.rejects(prepareTargetContext(reader, input, preflight.targetUrl), /published-posts query adapter/);
});

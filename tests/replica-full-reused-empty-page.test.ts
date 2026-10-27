import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fullReplicaHash } from '../src/replica-full/contract.js';
import { emptyReusedPageProjectionEvidence, createReusedBodyDependencies, emptyPageMetadataProofSchema } from '../src/replica-full/reused-body.js';
import type { ReusedBodySnapshot } from '../src/replica-full/reused-driver.js';
import type { FullReplicaManifest, FullReplicaPageCheckpoint, FullReplicaOperation } from '../src/replica-full/types.js';

const hash = 'a'.repeat(64);
function fixture() {
  const resources = { headerId: 'header_123', sharedHash: hash, headerHash: hash, menuHash: hash, styleHash: hash };
  const manifest = { taskId: 'empty-page-task', runId: 'empty-page-run', title: 'Empty page', slug: 'empty-page', headerProvider: 'reused-woodmart-header', reusedHeader: resources, body: {} } as FullReplicaManifest;
  const page = { pageId: 77, runId: manifest.runId, status: 'draft', title: manifest.title, slug: manifest.slug, template: 'elementor_header_footer', headerId: null, elements: [], settings: { template: 'elementor_header_footer', hide_title: 'yes', custom_css: '', post_featured_image: { url: '', id: false, size: '' } }, bodyHash: '', documentHash: '', publicUrl: 'https://target.example/?page_id=77', metaHash: hash, flags: { _woodmart_title_off: '1', _woodmart_footer_off: '1' } };
  const before = { hash: '', resources, page, receipts: { create: { action: 'create-page', state: 'complete', payloadHash: fullReplicaHash({ title: manifest.title, slug: manifest.slug }), result: { pageId: 77 } } } } as unknown as ReusedBodySnapshot;
  const seal = (snapshot: ReusedBodySnapshot, content = '') => { const value = snapshot.page!; value.bodyHash = fullReplicaHash([value.title, content, '', value.slug, value.elements, value.settings]); value.documentHash = fullReplicaHash([value.elements, value.settings]); const { hash: _hash, ...raw } = snapshot; snapshot.hash = fullReplicaHash(raw); return snapshot; };
  seal(before);
  const checkpoint: FullReplicaPageCheckpoint = { pageId: 77, runId: manifest.runId, status: 'draft', template: 'elementor_header_footer', headerId: null, bodyHash: before.page!.bodyHash, editUrl: 'https://target.example/edit/77', previewUrl: 'https://target.example/?page_id=77' };
  const current = structuredClone(before); (current.page!.settings.post_featured_image as Record<string, unknown>).id = 0; seal(current);
  return { manifest, before, current, checkpoint, seal };
}
function cacheFixture() {
  const value = fixture();
  const baseline: Record<string, string[]> = { _clonewp_run_id: [value.manifest.runId], _clonewp_reused_header_contract: [fullReplicaHash(value.manifest)], _elementor_data: ['[]'], _elementor_page_assets: ['a:0:{}'], protected: ['unchanged'] };
  value.before.page!.metaHash = fullReplicaHash(baseline); value.seal(value.before); value.checkpoint.bodyHash = value.before.page!.bodyHash;
  const metadata: Record<string, string[]> = { ...baseline, _elementor_css: ['a:1:{s:6:"status";s:4:"file";}'] };
  const readback = { pageId: 77, runId: value.manifest.runId, observedAt: new Date().toISOString(), metadata, remoteWrites: 0 };
  value.current.page!.metaHash = fullReplicaHash(readback.metadata); value.seal(value.current);
  return { ...value, baseline, readback };
}

test('empty page false/zero media ID projection proves both complete snapshots without mutating checkpoints', () => {
  const value = fixture(), original = structuredClone({ before: value.before, current: value.current, checkpoint: value.checkpoint });
  const evidence = emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current);
  assert.equal(evidence?.preservedBodyHash, value.checkpoint.bodyHash);
  assert.equal(evidence?.before.featuredImageId, false); assert.equal(evidence?.current.featuredImageId, 0);
  assert.deepEqual(value.before, original.before); assert.deepEqual(value.current, original.current); assert.deepEqual(value.checkpoint, original.checkpoint);
});

test('empty page projection rejects metadata, receipts, flags, actions, content and every nonempty media mutation', () => {
  const mutations: Array<(snapshot: ReusedBodySnapshot) => void> = [
    snapshot => { snapshot.page!.metaHash = 'b'.repeat(64); },
    snapshot => { snapshot.page!.flags._woodmart_title_off = '0'; },
    snapshot => { snapshot.receipts.create.action = 'style'; },
    snapshot => { snapshot.receipts.extra = { action: 'create-page', state: 'started', payloadHash: hash }; },
    snapshot => { snapshot.resources.sharedHash = 'b'.repeat(64); },
    snapshot => { snapshot.page!.settings.hide_title = ''; },
    snapshot => { snapshot.page!.settings.custom_css = ':page{color:red}'; },
    snapshot => { (snapshot.page!.settings.post_featured_image as Record<string, unknown>).id = 1; },
    snapshot => { (snapshot.page!.settings.post_featured_image as Record<string, unknown>).url = 'https://target.example/image.png'; },
    snapshot => { (snapshot.page!.settings.post_featured_image as Record<string, unknown>).extra = ''; },
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value.current); value.seal(value.current); assert.equal(emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current), null); }
  const value = fixture(); value.seal(value.current, 'unknown post content');
  assert.equal(emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current), null);
  value.seal(value.current); value.current.page!.documentHash = hash;
  assert.equal(emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current), null);
});

test('normal reused reconcile records exact projection evidence and returns before without altering the checkpoint or making a remote write', async () => {
  const value = fixture(), directory = await mkdtemp('D:/cloneWP/tests/.tmp-reused-empty-'), operations = path.join(directory, 'operations');
  const operation: FullReplicaOperation = { operationId: '11111111-1111-1111-1111-111111111111', taskId: value.manifest.taskId, runId: value.manifest.runId, phase: 'body', expectedCheckpointHash: hash, createdAt: new Date().toISOString() };
  const pageOperation = { ...operation, operationId: '22222222-2222-2222-2222-222222222222', phase: 'page' };
  await mkdir(operations);
  await writeFile(path.join(operations, `${pageOperation.operationId}-reuse-page-confirmed-33333333-3333-3333-3333-333333333333.json`), JSON.stringify({ version: 1, kind: 'clonewp-full-replica-operation', operation: pageOperation, value: { snapshot: value.before, checkpoint: value.checkpoint } }));
  const records: unknown[] = [], checkpoint = structuredClone(value.checkpoint);
  try {
    const dependencies = await createReusedBodyDependencies({ manifest: value.manifest, runDirectory: directory, async remote() { return { reused: { async inspect() { return value.current; }, async mutate() { assert.fail('no remote mutation'); } } } as any; }, async close() {}, async operationFile(_operation, label, proof) { assert.equal(label, 'reuse-empty-page-projection'); records.push(proof); return { path: 'record.json', sha256: hash }; }, async readBound() { assert.fail('no external reference'); }, async assetManifest() { return []; } });
    assert.deepEqual(await dependencies.reconcileOperation!({} as any, operation, { page: value.checkpoint }), { status: 'before' });
    assert.equal(records.length, 1); assert.deepEqual(value.checkpoint, checkpoint);
    await writeFile(path.join(operations, `${operation.operationId}-reuse-body-save-intent-44444444-4444-4444-4444-444444444444.json`), '{}');
    assert.deepEqual(await dependencies.reconcileOperation!({} as any, operation, { page: value.checkpoint }), { status: 'conflict' });
    assert.equal(records.length, 1);
  } finally { assert.equal(path.resolve(path.dirname(directory)), path.resolve('D:/cloneWP/tests')); assert.ok(path.basename(directory).startsWith('.tmp-reused-empty-')); await rm(directory, { recursive: true }); }
});

test('only an added native CSS cache with the exact previous complete metadata preimage can accompany the empty image projection', () => {
  const value = cacheFixture();
  assert.equal(emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current), null);
  const evidence = emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current, value.readback);
  assert.deepEqual(evidence?.metadataProjection?.omittedKeys, ['_elementor_css']);
  assert.equal(evidence?.metadataProjection?.baselineMetadataHash, fullReplicaHash(value.baseline));
  assert.deepEqual(value.readback.metadata._elementor_page_assets, ['a:0:{}']);
});

test('CSS cache proof refuses unknown metadata, modified prior values, other cache omissions and unbound readback declarations', () => {
  const mutations: Array<(metadata: Record<string, string[]>) => void> = [
    metadata => { metadata.protected = ['changed']; },
    metadata => { metadata.unknown = ['added']; },
    metadata => { delete metadata._elementor_page_assets; },
    metadata => { metadata._elementor_controls_usage = ['a:0:{}']; },
    metadata => { metadata._elementor_css = ['not serialized native cache']; },
  ];
  for (const mutate of mutations) {
    const value = cacheFixture(); mutate(value.readback.metadata);
    value.current.page!.metaHash = fullReplicaHash(value.readback.metadata); value.seal(value.current);
    assert.equal(emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current, value.readback), null);
  }
  const value = cacheFixture();
  value.baseline._elementor_css = ['a:1:{s:6:"status";s:6:"inline";}'];
  value.before.page!.metaHash = fullReplicaHash(value.baseline); value.seal(value.before);
  assert.equal(emptyReusedPageProjectionEvidence(value.manifest, value.checkpoint, value.before, value.current, value.readback), null);
  const unbound = cacheFixture(); unbound.readback.metadata._elementor_css = ['a:0:{}'];
  assert.equal(emptyReusedPageProjectionEvidence(unbound.manifest, unbound.checkpoint, unbound.before, unbound.current, unbound.readback), null);
});

test('explicit fixed metadata proof protocol is hash-bound and absence or stale identity cannot grant recovery', async () => {
  const value = cacheFixture(), directory = await mkdtemp('D:/cloneWP/tests/.tmp-reused-empty-'), operations = path.join(directory, 'operations');
  const operation: FullReplicaOperation = { operationId: '11111111-1111-1111-1111-111111111111', taskId: value.manifest.taskId, runId: value.manifest.runId, phase: 'body', expectedCheckpointHash: hash, createdAt: new Date().toISOString() };
  const pageOperation = { ...operation, operationId: '22222222-2222-2222-2222-222222222222', phase: 'page' };
  await mkdir(operations);
  await writeFile(path.join(operations, `${pageOperation.operationId}-reuse-page-confirmed-33333333-3333-3333-3333-333333333333.json`), JSON.stringify({ version: 1, kind: 'clonewp-full-replica-operation', operation: pageOperation, value: { snapshot: value.before, checkpoint: value.checkpoint } }));
  const metadataBytes = JSON.stringify(value.readback), metadataHash = createHash('sha256').update(metadataBytes).digest('hex');
  await writeFile(path.join(directory, 'explicit-readback.json'), metadataBytes);
  const protocol = { version: 1, kind: 'clonewp-empty-page-metadata-proof', taskId: value.manifest.taskId, runId: value.manifest.runId, pageId: 77, baselineMetadataHash: value.before.page!.metaHash, currentMetadataHash: value.current.page!.metaHash, metadata: { path: 'explicit-readback.json', sha256: metadataHash } };
  assert.throws(() => emptyPageMetadataProofSchema.parse({ ...protocol, ignoredKeys: ['protected'] }));
  const records: any[] = [];
  try {
    const dependencies = await createReusedBodyDependencies({ manifest: value.manifest, runDirectory: directory, async remote() { return { reused: { async inspect() { return value.current; }, async mutate() { assert.fail('no remote write'); } } } as any; }, async close() {}, async operationFile(_operation, _label, evidence) { records.push(evidence); return { path: 'record.json', sha256: hash }; }, async readBound(reference, base) { const filename = path.resolve(base!, reference.path), bytes = await readFile(filename); assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256); return { filename, bytes }; }, async assetManifest() { return []; } });
    assert.deepEqual(await dependencies.reconcileOperation!({} as any, operation, { page: value.checkpoint }), { status: 'conflict' });
    await writeFile(path.join(directory, 'empty-page-metadata-proof.json'), JSON.stringify(protocol));
    assert.deepEqual(await dependencies.reconcileOperation!({} as any, operation, { page: value.checkpoint }), { status: 'before' });
    assert.equal(records.length, 1); assert.equal(records[0].metadataProof.readback.sha256, metadataHash);
    await writeFile(path.join(directory, 'empty-page-metadata-proof.json'), JSON.stringify({ ...protocol, pageId: 78 }));
    assert.deepEqual(await dependencies.reconcileOperation!({} as any, operation, { page: value.checkpoint }), { status: 'conflict' });
    assert.equal(records.length, 1);
  } finally { assert.equal(path.resolve(path.dirname(directory)), path.resolve('D:/cloneWP/tests')); assert.ok(path.basename(directory).startsWith('.tmp-reused-empty-')); await rm(directory, { recursive: true }); }
});

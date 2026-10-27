import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { canonicalFullReplicaJson, fullReplicaJsonHash, FULL_REPLICA_JSON_LIMITS } from '../src/replica-full/json.js';
import { canonicalHeaderJson, headerJsonHash } from '../src/woodmart-header/contract.js';
import { fullReplicaHash, validateFullReplicaManifest } from '../src/replica-full/contract.js';
import { runFullReplicaCLI } from '../src/replica-full/cli.js';
import { WordPressFullReplicaDriver } from '../src/replica-full/driver.js';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';

test('full JSON preserves exact historical canonical bytes and hashes for valid small inputs', () => {
  const golden = '{"a":[0,1e+21,"\\ud800"],"b":true}', input = { b: true, a: [-0, 1e21, '\ud800'] };
  assert.equal(canonicalFullReplicaJson(input), golden);
  assert.equal(fullReplicaJsonHash(input), createHash('sha256').update(golden).digest('hex'));
  const repeated = { z: 'same', a: null };
  for (const value of [null, false, -0, 1e-7, '汉字/é', input, { '10': 10, '2': 2, nested: { z: 1, a: 2 } }, [repeated, repeated], Object.assign(Object.create(null), { z: 1, a: 2 })]) {
    assert.equal(canonicalFullReplicaJson(value), canonicalHeaderJson(value));
    assert.equal(fullReplicaHash(value), headerJsonHash(value));
  }
  assert.ok(NATIVE44_ADAPTER_SOURCE_PATHS.includes('src/replica-full/json.ts'));
});

test('full JSON rejects dangerous or non-JSON values without invoking accessors or toJSON', () => {
  let reads = 0;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { reads++; return 1; } });
  const arrayGetter = Object.defineProperty([], '0', { enumerable: true, get() { reads++; return 1; } });
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const hiddenArray = Object.defineProperty([1], 'hidden', { value: 1 });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const custom = Object.create({ inherited: true }); custom.visible = true;
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol('value'), new Date(), new Map(), custom, getter, arrayGetter, hidden, hiddenArray, cycle, Array(2), { value: undefined }, { toJSON() { reads++; return {}; } }, { [Symbol('key')]: 1 }, JSON.parse('{"__proto__":{}}'), { constructor: 1 }, { prototype: 1 }]) assert.throws(() => canonicalFullReplicaJson(value), /replica_full_json_invalid/);
  assert.equal(reads, 0);
});

test('full domain remains bounded independently while the header limits stay unchanged', () => {
  const body = { sections: Array.from({ length: 25_000 }, (_, index) => ({ key: `part_${index}`, value: index })) };
  assert.throws(() => canonicalHeaderJson(body), /woodmart_header_json_limit_exceeded/);
  assert.doesNotThrow(() => canonicalFullReplicaJson(body));
  assert.throws(() => canonicalFullReplicaJson(Array(FULL_REPLICA_JSON_LIMITS.values).fill(null)), /replica_full_json_limit/);
  assert.throws(() => canonicalFullReplicaJson('x'.repeat(FULL_REPLICA_JSON_LIMITS.bytes)), /replica_full_json_limit/);
  let maximum: unknown = null;
  for (let depth = 0; depth < FULL_REPLICA_JSON_LIMITS.depth; depth++) maximum = [maximum];
  assert.doesNotThrow(() => canonicalFullReplicaJson(maximum));
  assert.throws(() => canonicalFullReplicaJson([maximum]), /replica_full_json_limit/);
  assert.throws(() => canonicalHeaderJson('x'.repeat(4 * 1024 * 1024)), /woodmart_header_json_limit_exceeded/);
});

test('a whole responsive manifest above 20000 values can enter the local CLI and keep its exact persisted hash', async () => {
  const cache = await realpath('D:/cloneWP/.cache'), directory = path.join(cache, `full-json-${randomUUID()}`);
  await mkdir(directory);
  try {
    const bytes = '{}', sha256 = createHash('sha256').update(bytes).digest('hex'), ref = { path: path.join(directory, 'evidence.json'), sha256 };
    await writeFile(ref.path, bytes);
    const sections = Array.from({ length: 19 }, (_, sectionIndex) => ({ key: `section_${sectionIndex}`, mode: 'shared', reason: 'Synthetic source-owned phone settings exercise whole-page serialization.', evidence: [{ snapshotId: 'phone-390', nodeId: 'root' }, { snapshotId: 'phone-430', nodeId: 'root' }], settings: Array.from({ length: 120 }, (_, itemIndex) => ({ componentKey: `section_${sectionIndex}_item_${itemIndex}`, values: { padding_mobile: { unit: 'px', top: 0, right: 0, bottom: 0, left: 0, isLinked: false } } })), childOrders: [], css: '' }));
    const header = { headerId: 'header_123', name: 'Readonly existing header', editUrl: 'https://target.example/wp-admin/admin.php?page=xts_header_builder', sharedHash: sha256, headerHash: sha256, menuHash: sha256, styleHash: sha256, menus: [], blocks: [], mobileMaxWidth: 768, hasSubmenus: false };
    const input = { version: 4, kind: 'clonewp-full-replica', taskId: 'full-json-test', runId: 'full-json-test', title: 'Synthetic whole page', slug: 'synthetic-whole-page', sourceUrl: 'https://source.example/synthetic-whole-page', targetOrigin: 'https://target.example', headerProvider: 'reused-woodmart-header', reusedHeader: header, responsive: { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }], source: ref, decisions: { version: 1, layouts: [], carousels: [], header: { mode: 'reuse-readonly', requestRef: 'synthetic-explicit-readonly-request', reason: 'This synthetic case reuses the exact existing header without changing it.', headerId: header.headerId, sharedHash: header.sharedHash, evidence: [ref] } }, sections }, sourceEvidence: ref, sourcePartition: { allUnits: ['header', ...sections.map(section => section.key)], headerUnits: ['header'], bodyUnits: sections.map(section => section.key) }, body: { program: ref, css: ref, sourceUnits: ref } };
    assert.throws(() => canonicalHeaderJson(input), /json_limit_exceeded/);
    assert.equal(validateFullReplicaManifest(input).responsive!.sections.length, 19);
    const filename = path.join(directory, 'input.json'), run = path.join(directory, 'run');
    await writeFile(filename, canonicalFullReplicaJson(input));
    let factories = 0;
    await assert.rejects(runFullReplicaCLI(['run', '--manifest', filename, '--run-dir', run], { async createDependencies() { factories++; throw Error('Synthetic stop before all remote dependencies'); } }), /Synthetic stop/);
    assert.equal(factories, 1);
    const stored = JSON.parse(await readFile(path.join(run, 'manifest.json'), 'utf8')), state = JSON.parse(await readFile(path.join(run, 'state.json'), 'utf8'));
    assert.equal(state.manifestHash, fullReplicaHash(stored));
    const status = await runFullReplicaCLI(['status', '--run-dir', run], { async createDependencies() { assert.fail('Read-only status must not create remote dependencies'); } }) as { remoteWrites: number };
    assert.equal(status.remoteWrites, 0);
  } finally {
    const actual = await realpath(directory);
    assert.equal(actual, directory); assert.ok(path.relative(cache, actual).startsWith('full-json-'));
    await rm(actual, { recursive: true, force: true });
  }
});

test('whole driver payloads use full canonical hashes while small receipt hashes stay compatible', async () => {
  const identity = { moduleKey: 'full-json-driver', owner: { ownerId: 'clonewp', runId: 'full-json-driver' }, targetOrigin: 'https://target.example', headerId: 'header_123' }, hash = 'a'.repeat(64);
  const payload = { title: 'Synthetic payload', items: Array.from({ length: 21_000 }, (_, index) => ({ index })) };
  assert.throws(() => headerJsonHash(payload), /json_limit_exceeded/);
  let calls = 0;
  const driver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP() { assert.fail('No inspection is needed in this local transport test'); }, async executePHP<Type>(operation: { code: string }) {
    calls++;
    const encoded = operation.code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1], input = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    assert.deepEqual(input.payload, payload); assert.equal(input.payloadHash, fullReplicaHash(payload));
    const result = { pageId: 99 };
    return { ok: true, value: { result, snapshot: { hash, page: null, receipts: { [input.operationId]: { action: 'create-page', payloadHash: input.payloadHash, state: 'complete', result } }, header: { hash, contract: { targetOrigin: identity.targetOrigin }, snapshot: { module: null, globalHash: hash, defaultHeaderId: 'default', presetReferences: [], otherReferences: [] } } } } } as Type;
  } });
  await driver.mutate(identity, { action: 'create-page', operationId: 'large-payload', expectedHash: hash, payload }, { operationId: 'large-payload', runId: identity.owner.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash });
  assert.equal(calls, 1);
});

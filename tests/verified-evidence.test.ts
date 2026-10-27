import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { VerifiedEvidenceReader, activeVerifiedEvidenceReader, withVerifiedEvidenceReader } from '../src/core/verified-evidence.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
test('a command reuses verified bytes/JSON without sharing mutable values and enforces every caller bound', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const contents = '{"value":{"number":1}}', ref = { path: path.join(root, 'packet.json'), sha256: hash(contents) };
    await writeFile(ref.path, contents);
    const reader = new VerifiedEvidenceReader(root), first = await reader.json(ref); first.value.number = 99;
    assert.equal((await reader.json(ref)).value.number, 1);
    const bytes = await reader.read(ref); bytes.fill(0); assert.equal((await reader.read(ref)).toString(), contents);
    await assert.rejects(reader.read(ref, 1), /too_large/);
    assert.deepEqual(reader.metrics, { fileReads: 1, bytesRead: contents.length, hashChecks: 1, byteCacheHits: 2, jsonParses: 1, jsonCacheHits: 1, freshBarriers: 0,
      verificationCacheHits: 1, coalescedReads: 0, derivations: 0, derivationCacheHits: 0 });
    await reader.revalidateAll(); assert.equal(reader.metrics.fileReads, 2);
    await writeFile(ref.path, '{"value":{"number":2}}');
    await assert.rejects(reader.revalidateAll(), /hash_mismatch/);
    await assert.rejects(reader.read(ref), /reader_invalidated/);
    await assert.rejects(new VerifiedEvidenceReader(root).read(ref), /hash_mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('coalescing preserves each caller size bound in both wide-first and narrow-first ordering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const contents = 'bounded evidence', ref = { path: path.join(root, 'packet.txt'), sha256: hash(contents) };
    await writeFile(ref.path, contents);
    for (const narrowFirst of [false, true]) {
      const reader = new VerifiedEvidenceReader(root);
      const results = await Promise.allSettled(narrowFirst ? [reader.read(ref, 1), reader.read(ref, 100)] : [reader.read(ref, 100), reader.read(ref, 1)]);
      const wide = results[narrowFirst ? 1 : 0], narrow = results[narrowFirst ? 0 : 1];
      assert.equal(wide.status, 'fulfilled', `wide read must succeed when narrowFirst=${narrowFirst}`);
      if (wide.status === 'fulfilled') assert.equal(wide.value.toString(), contents);
      assert.equal(narrow.status, 'rejected');
      if (narrow.status === 'rejected') assert.match(String(narrow.reason), /too_large/);
      assert.equal(reader.metrics.fileReads, 1); assert.equal(reader.metrics.hashChecks, 1);
    }
    const shared = new VerifiedEvidenceReader(root);
    const [verified, one, two] = await Promise.all([shared.verify(ref, 100), shared.read(ref, 100), shared.read(ref, 100)]);
    assert.equal(verified.bytes, contents.length); assert.equal(one.toString(), contents); assert.equal(two.toString(), contents);
    assert.equal(shared.metrics.fileReads, 1); assert.equal(shared.metrics.hashChecks, 1); assert.equal(shared.metrics.coalescedReads, 2);
    one.fill(0); assert.equal(two.toString(), contents);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verification-only and LRU-evicted evidence remain dependencies, enforce later strict max and fail fresh tamper barrier', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const firstText = '11111111', secondText = '22222222';
    const first = { path: path.join(root, 'first.txt'), sha256: hash(firstText) }, second = { path: path.join(root, 'second.txt'), sha256: hash(secondText) };
    await writeFile(first.path, firstText); await writeFile(second.path, secondText);
    const verificationOnly = new VerifiedEvidenceReader(root, 1);
    await verificationOnly.verify(first); await verificationOnly.verify(first);
    await assert.rejects(verificationOnly.verify(first, 7), /too_large/);
    assert.equal(verificationOnly.metrics.fileReads, 1); assert.equal(verificationOnly.metrics.verificationCacheHits, 1);
    await verificationOnly.revalidateAll(); assert.equal(verificationOnly.metrics.fileReads, 2);
    const evicting = new VerifiedEvidenceReader(root, 8);
    await evicting.read(first); await evicting.read(second); // first no longer fits the byte cache
    await evicting.verify(first);
    assert.equal(evicting.metrics.fileReads, 2); assert.equal(evicting.metrics.verificationCacheHits, 1);
    await evicting.revalidateAll(); assert.equal(evicting.metrics.fileReads, 4);
    await writeFile(first.path, 'tampered');
    await assert.rejects(verificationOnly.revalidateAll(), /hash_mismatch/);
    await assert.rejects(evicting.revalidateAll(), /hash_mismatch/);
    await assert.rejects(evicting.verify(second), /reader_invalidated/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fresh dependency barrier rejects an alias swap even when aliased bytes have the same digest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const owned = path.join(root, 'owned'), moved = path.join(root, 'moved');
    await mkdir(owned); const ref = { path: path.join(owned, 'packet.txt'), sha256: hash('same bytes') }; await writeFile(ref.path, 'same bytes');
    const reader = new VerifiedEvidenceReader(root); await reader.verify(ref);
    await mkdir(moved); await writeFile(path.join(moved, 'packet.txt'), 'same bytes');
    await rm(owned, { recursive: true, force: true }); await symlink(moved, owned, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(reader.revalidateAll(), /reference_alias/);
    await assert.rejects(reader.read(ref), /reader_invalidated/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('derived results coalesce by input and validator identities, isolate returned mutations and do not cache failed derivations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const reader = new VerifiedEvidenceReader(root); let calls = 0;
    const operation = async () => { calls++; return { nested: { value: 1 } }; };
    const [first, second] = await Promise.all([reader.derive('validator-v1', 'input-a', operation), reader.derive('validator-v1', 'input-a', operation)]);
    first.nested.value = 99; second.nested.value = 42;
    assert.equal((await reader.derive('validator-v1', 'input-a', operation)).nested.value, 1); assert.equal(calls, 1);
    await reader.derive('validator-v2', 'input-a', operation); await reader.derive('validator-v1', 'input-b', operation); assert.equal(calls, 3);
    let failures = 0;
    await assert.rejects(reader.derive('validator-v1', 'failed', async () => { failures++; throw Error('validation rejected'); }), /validation rejected/);
    await reader.derive('validator-v1', 'failed', async () => { failures++; return { accepted: true }; }); assert.equal(failures, 2);
    assert.equal(reader.metrics.derivationCacheHits, 2); assert.equal(reader.metrics.derivations, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('nested command scopes share one reader, while later commands verify from disk again', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const ref = { path: path.join(root, 'packet.txt'), sha256: hash('same bytes') }; await writeFile(ref.path, 'same bytes');
    await withVerifiedEvidenceReader(root, async outer => {
      await outer.verify(ref);
      await withVerifiedEvidenceReader(root, async inner => { assert.equal(inner, outer); await inner.verify(ref); });
      assert.equal(outer.metrics.fileReads, 1); assert.equal(outer.metrics.verificationCacheHits, 1);
    });
    await writeFile(ref.path, 'changed');
    await assert.rejects(withVerifiedEvidenceReader(root, reader => reader.verify(ref)), /hash_mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('evidence cache is isolated to one command and never weakens path, hash or JSON validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const ref = { path: path.join(root, 'one.json'), sha256: hash('null') }; await writeFile(ref.path, 'null');
    await withVerifiedEvidenceReader(root, async reader => {
      assert.equal(activeVerifiedEvidenceReader(root), reader); assert.equal(activeVerifiedEvidenceReader(path.dirname(root)), undefined);
      assert.equal(await reader.json(ref), null); assert.equal(await reader.json(ref), null);
      await assert.rejects(reader.read({ ...ref, path: '../escape.json' }), /path_escape/);
      await assert.rejects(reader.read({ ...ref, sha256: 'bad' }), /reference_invalid/);
    });
    assert.equal(activeVerifiedEvidenceReader(root), undefined);
    await withVerifiedEvidenceReader(root, async reader => { await reader.read(ref); assert.equal(reader.metrics.fileReads, 1); assert.equal(reader.metrics.byteCacheHits, 0); });
    await writeFile(ref.path, 'bad');
    await assert.rejects(new VerifiedEvidenceReader(root).json({ ...ref, sha256: hash('bad') }), /json_invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

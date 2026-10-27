import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preparedBodyAttestationDigest } from '../src/replica-full/body-prepare.js';
import { canonicalFullReplicaJson } from '../src/replica-full/json.js';
import type { FullReplicaPreparedBody } from '../src/replica-full/types.js';

function fixture(): FullReplicaPreparedBody {
  return { programHash: 'a'.repeat(64), cssInputHash: 'b'.repeat(64), sourceUnitsHash: 'c'.repeat(64), sourceEvidenceHash: 'd'.repeat(64), sourceUnitIds: ['body'], componentSourceUnitIds: ['body'], embeddedHeaderCount: 0, payload: { program: { marker: 'program' }, css: ':page{color:black}', sourceUnits: { marker: 'units' }, sourceEvidence: { marker: 'evidence' }, sourceFacts: { marker: 'facts' }, knowledge: { marker: 'knowledge' }, manifest: { marker: 'manifest' }, programPath: 'program.json', sourceFactsPath: 'facts.json', assetsManifestPath: 'assets.json', assetsManifest: { assets: [] } } };
}

test('small actual-body attestation hashes remain byte-for-byte compatible with the original canonical proof', () => {
  const body = fixture(), expected = createHash('sha256').update(canonicalFullReplicaJson(body)).digest('hex');
  assert.equal(preparedBodyAttestationDigest(body), expected);
  assert.match(expected, /^[a-f0-9]{64}$/);
});

test('independently bounded 3.2 million source values use a domain-separated hierarchical proof without dropping fields', () => {
  const body = fixture(), payload = body.payload as Record<string, unknown>;
  payload.sourceFacts = { facts: Array(800_000).fill(0) };
  payload.presentationSource = { facts: Array(1_400_000).fill(1) };
  payload.styleCapabilities = { controls: Array(600_000).fill(2) };
  payload.knowledge = { controls: Array(400_000).fill(3) };
  const digest = preparedBodyAttestationDigest(body);
  assert.match(digest, /^hierarchical-v2:[a-f0-9]{64}$/);
  payload.program = { marker: 'changed-actual-program-with-unchanged-file-sha' };
  assert.notEqual(preparedBodyAttestationDigest(body), digest);
});

test('every actual payload field, its name and all root metadata are signed rather than trusting caller file hashes', () => {
  const original = fixture(), digest = preparedBodyAttestationDigest(original), fields = Object.keys(original.payload as object);
  for (const key of fields) {
    const changed = structuredClone(original); (changed.payload as Record<string, unknown>)[key] = { changed: key };
    assert.notEqual(preparedBodyAttestationDigest(changed), digest, key);
  }
  const swapped = structuredClone(original), payload = swapped.payload as Record<string, unknown>;
  [payload.program, payload.sourceFacts] = [payload.sourceFacts, payload.program];
  assert.notEqual(preparedBodyAttestationDigest(swapped), digest);
  assert.notEqual(preparedBodyAttestationDigest({ ...original, sourceUnitIds: ['other'] }), digest);
  assert.throws(() => preparedBodyAttestationDigest({ ...original, extra: true } as FullReplicaPreparedBody), /json_invalid/);
  assert.throws(() => preparedBodyAttestationDigest({ ...original, payload: { ...original.payload as object, extra: true } }), /json_invalid/);
  const missing = structuredClone(original); delete (missing.payload as Record<string, unknown>).sourceFacts;
  assert.throws(() => preparedBodyAttestationDigest(missing), /json_invalid/);
});

test('a single oversized or unsafe actual field cannot be laundered through the hierarchical summary', () => {
  const body = fixture(), payload = body.payload as Record<string, unknown>;
  payload.sourceFacts = Array(2_000_000).fill(null);
  assert.throws(() => preparedBodyAttestationDigest(body), /json_limit/);
  let deep: unknown = null; for (let index = 0; index < 97; index++) deep = [deep];
  payload.sourceFacts = deep;
  assert.throws(() => preparedBodyAttestationDigest(body), /json_limit/);
  let reads = 0;
  const getter = Object.defineProperty({}, 'unsafe', { enumerable: true, get() { reads++; return 1; } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const unsafe of [getter, cycle, { [Symbol('unsafe')]: 1 }, Object.create({ inherited: true }), Array(1), { hidden: undefined }, { value: Infinity }, JSON.parse('{"__proto__":1}')]) {
    payload.sourceFacts = unsafe;
    assert.throws(() => preparedBodyAttestationDigest(body), /json_invalid/);
  }
  assert.equal(reads, 0);
  assert.throws(() => preparedBodyAttestationDigest(Object.defineProperty(fixture(), 'payload', { enumerable: true, get() { reads++; return {}; } })), /json_invalid/);
  assert.equal(reads, 0);
});

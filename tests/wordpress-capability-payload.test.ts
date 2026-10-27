import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decodeCapabilityPayload, MAX_CAPABILITY_PAYLOAD_BYTES } from '../src/wordpress/capability-payload.js';
import { WordPressError } from '../src/wordpress/errors.js';

function pack(raw: Buffer) {
  return { __clonewpCapabilityPayload: 'gzip-base64-v1', rawBytes: raw.length,
    sha256: createHash('sha256').update(raw).digest('hex'), data: gzipSync(raw).toString('base64') };
}
const invalid = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof WordPressError && e.code === 'invalid_capability_payload');

test('large capability payload preserves all controls, source evidence and checkpoint identities', () => {
  const original = { versions: { elementor: '3.35.4' }, schemas: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`widget-${i}`, {
    controls: { content: { type: 'text', default: '中文'.repeat(60000) }, select: { multiple: false, options: { a: 'A' } },
      repeater: { fields: [{ name: 'options', multiple: true, options: { a: 'A' } }] } },
    nativeChildContract: { childType: 'container', policy: 'fixed', count: 1 },
  }])), sourceProof: { save: { source: 'Exact source evidence', sha256: 'a'.repeat(64) } },
  checkpointProof: { version: 1, sha256: 'b'.repeat(64), types: ['widget-0', 'widget-1'] } };
  const raw = Buffer.from(JSON.stringify(original));
  assert.ok(raw.length > 1400000);
  const wire = pack(raw);
  assert.ok(wire.data.length < raw.length / 10);
  assert.deepEqual(decodeCapabilityPayload(wire), original);
  assert.equal(decodeCapabilityPayload(original), original);
});

test('large base64 payload does not exhaust the validation regex stack', () => {
  const original = { source: randomBytes(600000).toString('base64') };
  const wire = pack(Buffer.from(JSON.stringify(original)));
  assert.ok(wire.data.length > 700000);
  assert.deepEqual(decodeCapabilityPayload(wire), original);
});

test('corruption, truncation, unsupported formats and inconsistent sizes fail closed', () => {
  const wire = pack(Buffer.from(JSON.stringify({ schemas: { container: { controls: {} } } })));
  for (const changed of [
    { __clonewpCapabilityPayload: 'gzip-base64-v2' }, { rawBytes: wire.rawBytes - 1 }, { rawBytes: wire.rawBytes + 1 },
    { sha256: '0'.repeat(64) }, { data: wire.data.slice(0, -4) }, { data: wire.data + '\n' },
    { rawBytes: MAX_CAPABILITY_PAYLOAD_BYTES + 1 }, { rawBytes: 0 }, { extra: true },
  ]) invalid(() => decodeCapabilityPayload({ ...wire, ...changed }));
  invalid(() => decodeCapabilityPayload(pack(Buffer.from('not JSON'))));
  const bomb = pack(Buffer.alloc(1024 * 1024, 'x'));
  invalid(() => decodeCapabilityPayload({ ...bomb, rawBytes: 8 }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintMediaTransformationBytes, reconcileMediaTransformation, type MediaTransformationContract, type MediaTransformationPolicy } from '../src/assets/media-transformation.js';

const owner = { pageId: 999, runId: 'fixture-owned-draft' }, operationId = 'fixture-media-operation';
const svg = fingerprintMediaTransformationBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml');
const png = fingerprintMediaTransformationBytes(Buffer.from('actual submitted byte fixture'), 'image/png');
const cleanSvg = fingerprintMediaTransformationBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml');
const policies: MediaTransformationPolicy[] = [
  { id: 'fixture-rasterizer', version: '1', kind: 'svg-rasterization', phase: 'local', fromMimeType: 'image/svg+xml', toMimeType: 'image/png' },
  { id: 'fixture-sanitizer', version: '1', kind: 'svg-sanitization', phase: 'server', fromMimeType: 'image/svg+xml', toMimeType: 'image/svg+xml' },
];
function receipt(phase: 'local' | 'server') {
  const local = phase === 'local';
  return { policyId: local ? 'fixture-rasterizer' : 'fixture-sanitizer', policyVersion: '1', kind: local ? 'svg-rasterization' as const : 'svg-sanitization' as const,
    owner: { ...owner }, operationId, inputSha256: svg.sha256, outputSha256: local ? png.sha256 : cleanSvg.sha256, receiptSha256: 'a'.repeat(64) };
}
function fixture(): any {
  return { version: 1, kind: 'media-transformation-contract', owner: { ...owner }, operationId, original: { ...svg }, submitted: { ...svg },
    stored: { owner: { ...owner }, operationId, attachmentId: 1001, observedAt: '2026-10-17T06:00:00.000Z', actual: { ...svg } } } satisfies MediaTransformationContract;
}

test('unchanged bytes are exact only after matching owned-operation storage readback', () => {
  const input = fixture(), report = reconcileMediaTransformation(input);
  assert.equal(report.status, 'verified-exact'); assert.equal(report.exactStoredBytes, true);
  assert.deepEqual(report.hashes, { original: svg.sha256, submitted: svg.sha256, stored: svg.sha256 });
  assert.deepEqual(report.owner, owner); assert.equal(report.operationId, operationId); assert.equal(report.attachmentId, 1001);
  assert.equal(report.automaticRetryAllowed, false); assert.equal(report.remoteWrites, 0);
});

test('versioned local conversion retains original/submitted/stored identities without calling converted bytes original', () => {
  const input = fixture(); input.submitted = { ...png }; input.stored.actual = { ...png }; input.localTransformation = receipt('local');
  const report = reconcileMediaTransformation(input, { policies });
  assert.equal(report.status, 'verified-transformed'); assert.equal(report.exactStoredBytes, true);
  assert.notEqual(report.hashes.original, report.hashes.submitted); assert.equal(report.hashes.submitted, report.hashes.stored);
  assert.deepEqual(report.transformations, [{ phase: 'local', policyId: 'fixture-rasterizer', policyVersion: '1', receiptSha256: 'a'.repeat(64) }]);
});

test('unknown SVG server sanitation never grants exact verification or automatic re-upload', () => {
  const input = fixture(); input.stored.actual = { ...cleanSvg };
  let report = reconcileMediaTransformation(input, { policies });
  assert.equal(report.status, 'needs-reconciliation'); assert.equal(report.code, 'server_transformation_receipt_missing');
  assert.equal(report.exactStoredBytes, false); assert.equal(report.automaticRetryAllowed, false); assert.equal(report.nextAction, 'reconcile-existing-attachment');
  input.stored.serverTransformation = receipt('server');
  report = reconcileMediaTransformation(input);
  assert.equal(report.status, 'needs-reconciliation'); assert.equal(report.code, 'server_transformation_policy_unverified');
});

test('verified server sanitation is transformed lineage rather than exact submitted bytes', () => {
  const input = fixture(); input.stored.actual = { ...cleanSvg }; input.stored.serverTransformation = receipt('server');
  const report = reconcileMediaTransformation(input, { policies });
  assert.equal(report.status, 'verified-transformed'); assert.equal(report.exactStoredBytes, false);
  assert.equal(report.transformations[0].phase, 'server'); assert.equal(report.automaticRetryAllowed, false);
});

test('policy version, MIME, transformation kind and hash links cannot be guessed', () => {
  for (const [mutate, expected] of [
    [(v: any) => { v.localTransformation.policyVersion = '2'; }, 'local_transformation_policy_unverified'],
    [(v: any) => { v.localTransformation.outputSha256 = 'b'.repeat(64); }, 'transformation_receipt_hash_mismatch'],
    [(v: any) => { v.submitted.mimeType = 'image/jpeg'; }, 'local_transformation_policy_unverified'],
  ] as const) {
    const input = fixture(); input.submitted = { ...png }; input.stored.actual = { ...png }; input.localTransformation = receipt('local'); mutate(input);
    const report = reconcileMediaTransformation(input, { policies });
    assert.equal(report.status, 'needs-reconciliation'); assert.equal(report.code, expected); assert.equal(report.automaticRetryAllowed, false);
  }
});

test('owner/operation conflicts block even when actual bytes match', () => {
  for (const mutate of [(v: any) => { v.stored.owner.pageId++; }, (v: any) => { v.stored.operationId = 'different-operation'; }]) {
    const input = fixture(); mutate(input);
    const report = reconcileMediaTransformation(input, { policies });
    assert.equal(report.status, 'blocked'); assert.equal(report.code, 'stored_media_owner_mismatch'); assert.equal(report.nextAction, 'stop-identity-conflict');
    assert.equal(report.operationId, operationId);
  }
  const input = fixture(); input.submitted = { ...png }; input.stored.actual = { ...png }; input.localTransformation = receipt('local'); input.localTransformation.owner.runId = 'other-run';
  assert.equal(reconcileMediaTransformation(input, { policies }).code, 'transformation_receipt_owner_mismatch');
});

test('missing readback, changed stored metadata and redundant receipts fail closed', () => {
  const absent = fixture(); delete absent.stored;
  assert.equal(reconcileMediaTransformation(absent).code, 'stored_media_readback_missing');
  const mismatch = fixture(); mismatch.stored.actual.bytes++;
  assert.equal(reconcileMediaTransformation(mismatch).code, 'identical_hash_metadata_conflict');
  const redundant = fixture(); redundant.localTransformation = receipt('local');
  assert.equal(reconcileMediaTransformation(redundant, { policies }).code, 'redundant_local_transformation_receipt');
});

test('contract is bounded and unknown credential/policy fields are not accepted', () => {
  assert.throws(() => reconcileMediaTransformation({ ...fixture(), authorization: 'secret' }), /media_transformation_contract_invalid/);
  assert.throws(() => reconcileMediaTransformation(fixture(), { policies: [...policies, policies[0]] }), /media_transformation_policy_registry_invalid/);
  assert.throws(() => fingerprintMediaTransformationBytes(new Uint8Array(), 'image/png'));
  assert.throws(() => reconcileMediaTransformation({ ...fixture(), operationId: 'https://example.com/?token=secret' }), /media_transformation_contract_invalid/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { applyNative44Revision, prepareNative44Revision, recordNative44RevisionReview, type Native44RevisionDependencies, type Native44RevisionRequest } from '../src/native44/revision.js';
import { readNative44CurrentState, type Native44CurrentRef } from '../src/native44/current-state.js';
import { createNative44CSSModel, compileNative44CSSModel } from '../src/native44/css-model.js';
import { createNative44RequirementContract, native44RequirementsHash, type Native44AcceptanceObservation, type Native44AcceptancePolicy, type Native44CapabilityProof } from '../src/native44/requirements.js';
import { fingerprintNative44Snapshot, type Native44CompareManifest } from '../src/native44/compare.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { Native44SourceUnit } from '../src/native44/selection-types.js';
import type { Native44Component } from '../src/native44/types.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';

import { fixture, fakeRemote, views } from './helpers/revision-flow-fixture.js';

for (const layout of ['heading', 'cards'] as const) test(`revision flow for ${layout}: prepare, single owned save, current state, pixel review and tolerated minor completion`, async t => {
  const f = await fixture(t, layout), remote = fakeRemote(f);
  const prepared = await prepareNative44Revision(f.root, f.request);
  assert.equal(prepared.status, 'prepared'); assert.equal(prepared.remoteWrites, 0); assert.equal(prepared.coverage.ready, true); assert.equal(remote.stats().factories, 0);
  assert.ok(prepared.evidenceWork.byteCacheHits > 0); assert.ok(prepared.evidenceWork.jsonCacheHits > 0); assert.equal(prepared.evidenceWork.freshBarriers, 1);
  const applied = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(applied.status, 'confirmed'); assert.equal(applied.remoteWrites, 1); assert.equal(remote.stats().saves, 1);
  // Before authentication/save, before local pointer CAS, and before summary
  // reuse: each barrier checks unique immutable dependencies, not the chain.
  assert.equal(applied.evidenceWork.freshBarriers, 4); assert.equal(applied.delivery?.summary.deliveryComplete, false);
  assert.equal(applied.delivery?.summary.requirementsComplete, false); assert.ok(applied.delivery?.summary.sections.unverified.length);
  const pending = await readNative44CurrentState(f.root, f.runDir);
  assert.equal(pending?.status, 'pending-css-review'); assert.equal(pending?.deliveryComplete, false); assert.equal(pending?.axes?.review.status, 'not-run'); assert.equal(pending?.documentHash, prepared.expectedHash);
  assert.equal(remote.snapshot().elements[0].elements![0].settings.header_size, 'h1');
  if (layout === 'cards') { assert.equal(pending?.counts.productWidgets, 1); assert.deepEqual(remote.snapshot().elements[0].elements![1].settings.include, [501, 502]); assert.match(String(remote.snapshot().settings.custom_css), /product-grid-item[\s\S]*border-radius:12px/); }
  const review = await f.review(await f.expected());
  for (const capture of review.captures) assert.equal((await sharp(capture.targetScreenshot.path).metadata()).format, 'png');
  const reviewed = await recordNative44RevisionReview(f.root, f.runId, review);
  assert.equal(reviewed.status, 'delivered-with-deviations'); assert.equal(reviewed.deliveryComplete, true); assert.equal(reviewed.axes?.review.status, 'reviewed'); assert.equal(reviewed.axes?.requirements.status, 'satisfied-with-deviations'); assert.equal(reviewed.axes?.requirements.deviations.length, 1);
  assert.equal(reviewed.convergence.recommendation, 'stop', 'An accepted minor deviation must not create an endless correction loop');
  assert.equal(reviewed.delivery.summary.deliveryComplete, false); assert.equal(reviewed.delivery.summary.sections.minorIssues.length, 1);
  assert.equal(reviewed.delivery.summary.status, 'editor-completion-pending');
  assert.ok(reviewed.delivery.summary.sections.unverified.some(item => item.region === 'editor-and-autosave'));
  assert.match(await readFile(reviewed.delivery.markdownRef.path, 'utf8'), /未完成|unfinished/i);
  assert.equal(reviewed.axes?.remote.status, 'not-freshly-observed'); // Local evidence never claims a fresh remote read.
  const replay = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(replay.remoteWrites, 0); assert.equal(remote.stats().saves, 1); assert.equal(remote.stats().factories, 1);
  await f.assertHistoricalUnchanged();
});

test('mutable operation state remains freshly CAS guarded outside immutable evidence reuse', async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request);
  const filename = path.join(f.runDir, 'amendments', f.request.operationId, 'operation-state.json');
  const deps: Native44RevisionDependencies = { remote: async manifest => {
    const adapter = await remote.deps.remote(manifest);
    await f.json(filename, { version: 1, kind: 'native44-revision-operation', status: 'conflict', attempts: 99, updatedAt: new Date().toISOString() });
    return adapter;
  } };
  await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, deps), /operation_state_changed/);
  assert.equal(remote.stats().saves, 0); assert.equal(remote.stats().closes, 1);
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).status, 'conflict');
});

test('oversized review import fails before traversing a broken historical journal', async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request); await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  const review = await f.review(await f.expected());
  review.verification = await f.json(review.verification.path, { padding: 'x'.repeat(17 * 1024 * 1024) });
  await writeFile(path.join(f.runDir, 'journal.json'), 'broken historical JSON');
  await assert.rejects(recordNative44RevisionReview(f.root, f.runId, review), /artifact_too_large/);
  assert.equal(remote.stats().saves, 1);
});

test('revision preparation invokes the async caption source verifier before any remote factory or opacity compilation', async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f), model = JSON.parse(await readFile(f.request.cssModel.path, 'utf8'));
  const proof = { path: path.join(f.root, 'references', f.taskId, 'unproven-caption.json'), sha256: 'a'.repeat(64) };
  for (const state of ['default', 'hover', 'focus-within']) model.rules.push({ id: `caption-${state}`, moduleKey: 'panel', slot: 'caption', selector: `.cwp-card${state === 'default' ? '' : `:${state}`} .elementor-image-box-content`, property: 'opacity', responsibility: 'css', value: state === 'default' ? '0' : '1', reason: 'This intentionally unproven source graph must fail before remote access.', evidence: [proof.path], nativeStructure: { kind: 'image-box-caption-reveal', componentKey: 'card', elementId: 'head123', cardClass: 'cwp-card', state, proof, sourceEvidence: proof.path } });
  f.request.cssModel = await f.json(f.request.cssModel.path, model);
  // The frozen fixture has no caption-bearing component-plan/source identity.
  // A missing verifier would instead reach the synchronous not-verified gate.
  await assert.rejects(prepareNative44Revision(f.root, f.request), /native44_image_box_caption_frozen_source_identity_invalid/);
  assert.equal(remote.stats().factories, 0); assert.equal(remote.stats().saves, 0);
});

test('known critical capability gap stays blocked after a current honest review, while native product styling remains required', async t => {
  const f = await fixture(t, 'cards', true), remote = fakeRemote(f);
  const prepared = await prepareNative44Revision(f.root, f.request); assert.equal(prepared.coverage.ready, false);
  assert.ok(prepared.coverage.gaps.some(gap => gap.severity === 'critical'));
  await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  const reviewed = await recordNative44RevisionReview(f.root, f.runId, await f.review(await f.expected(), true));
  assert.equal(reviewed.status, 'reviewed-with-gaps'); assert.equal(reviewed.deliveryComplete, false); assert.equal(reviewed.axes?.review.status, 'reviewed'); assert.equal(reviewed.axes?.review.automated, 'has-failures'); assert.equal(reviewed.axes?.requirements.status, 'blocked'); assert.equal(reviewed.axes?.delivery.status, 'pending');
  assert.ok(reviewed.axes?.requirements.issues.some(issue => issue.code === 'capability-gap'));
  assert.ok(f.contract.requirements.some(row => row.sourceKey === 'unit:cards' && row.dimension === 'presentation' && row.disposition === 'preserve'));
  assert.ok(f.contract.requirements.some(row => row.sourceKey === 'unit:cards' && row.dimension === 'data' && row.disposition === 'target-product-data'));
  assert.equal(reviewed.counts.productWidgets, 1); assert.equal(remote.stats().saves, 1); await f.assertHistoricalUnchanged();
});

test('explicit component-reference revision delivers a verified native draft with named pending integration and stops minor polishing', async t => {
  // The historical program remains byte-for-byte unchanged; the explicit new
  // revision binds this goal in its frozen requirements, rather than migrating.
  const f = await fixture(t, 'cards', true, true), remote = fakeRemote(f);
  const prepared = await prepareNative44Revision(f.root, f.request);
  assert.equal(prepared.coverage.draftReady, true); assert.equal(prepared.coverage.requirementsComplete, false);
  await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  const reviewed = await recordNative44RevisionReview(f.root, f.runId, await f.review(await f.expected()));
  assert.equal(reviewed.status, 'delivered-with-open-items'); assert.equal(reviewed.deliveryComplete, true);
  assert.equal(reviewed.axes?.requirements.requirementsComplete, false); assert.equal(reviewed.axes?.requirements.qualityFloor.status, 'passed');
  assert.equal(reviewed.convergence.recommendation, 'stop');
  assert.ok(reviewed.delivery.summary.sections.unfinished.some(item => /search|query/i.test(item.issue)));
  assert.ok(reviewed.delivery.summary.sections.minorIssues.length > 0);
  assert.ok(reviewed.delivery.summary.sections.productContentReplacement.length > 0);
  assert.equal(reviewed.counts.productWidgets, 1); assert.equal(remote.stats().saves, 1);
  assert.match(await readFile(reviewed.delivery.markdownRef.path, 'utf8'), /未验证/);
  await f.assertHistoricalUnchanged();
});

test('command evidence reuse rechecks cached source bytes after authentication and before any remote save', async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request);
  const packet = f.contract.requirements[0].checks[0].sourceEvidence[0];
  const deps: Native44RevisionDependencies = { remote: async manifest => {
    const adapter = await remote.deps.remote(manifest); await writeFile(packet.path, 'Changed while the remote read was in progress.'); return adapter;
  } };
  await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, deps), /artifact_hash_mismatch/);
  assert.equal(remote.stats().saves, 0); assert.equal(remote.stats().closes, 1);
  assert.equal(await readNative44CurrentState(f.root, f.runDir), undefined);
  const operation = JSON.parse(await readFile(path.join(f.runDir, 'amendments', f.request.operationId, 'operation-state.json'), 'utf8'));
  assert.equal(operation.status, 'prepared'); assert.equal(operation.attempts, 0);
});

for (const dependency of ['component-plan', 'catalog'] as const) test(`fresh barrier includes historical ${dependency} inputs verified outside the command reader`, async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f); await prepareNative44Revision(f.root, f.request);
  const filename = dependency === 'catalog' ? path.join(f.root, 'config', 'native44-component-set.json') : path.join(f.root, 'references', f.taskId, 'component-plan.json');
  const deps: Native44RevisionDependencies = { remote: async manifest => { const adapter = await remote.deps.remote(manifest); await writeFile(filename, '{"changed":true}'); return adapter; } };
  await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, deps), /artifact_hash_mismatch/);
  assert.equal(remote.stats().saves, 0); assert.equal(remote.stats().closes, 1);
});

test('lost save reply and first readback timeout require reconciliation and never issue a duplicate save', async t => {
  const f = await fixture(t, 'cards'), remote = fakeRemote(f, { lostReply: true, failReadAfterSave: true });
  const prepared = await prepareNative44Revision(f.root, f.request);
  const unknown = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.remoteWrites, 1); assert.equal(remote.stats().saves, 1);
  assert.equal(await readNative44CurrentState(f.root, f.runDir), undefined);
  const stateFile = path.join(f.runDir, 'amendments', f.request.operationId, 'operation-state.json');
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).status, 'unknown');
  const reconciled = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps, 'reconcile');
  assert.equal(reconciled.status, 'confirmed'); assert.equal(reconciled.remoteWrites, 0); assert.equal(remote.stats().saves, 1); assert.equal((await readNative44CurrentState(f.root, f.runDir))?.documentHash, prepared.expectedHash);
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).attempts, 1); await f.assertHistoricalUnchanged();
});

test('unknown save reconciled to the old document permits only a later explicit apply, with no automatic repeat', async t => {
  const f = await fixture(t, 'heading'), failure = { lostReply: true, failReadAfterSave: true, ignoreSave: true }, remote = fakeRemote(f, failure);
  const prepared = await prepareNative44Revision(f.root, f.request);
  const unknown = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(unknown.status, 'unknown'); assert.equal(remote.stats().saves, 1); assert.equal(remote.snapshot().hash, f.before.hash);
  const retryable = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps, 'reconcile');
  assert.equal(retryable.status, 'retryable'); assert.equal(retryable.remoteWrites, 0); assert.equal(retryable.action, 'explicit-apply'); assert.equal(remote.stats().saves, 1);
  const stillReadOnly = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps, 'reconcile');
  assert.equal(stillReadOnly.remoteWrites, 0); assert.equal(remote.stats().saves, 1); assert.equal(await readNative44CurrentState(f.root, f.runDir), undefined);
  failure.lostReply = false; failure.failReadAfterSave = false; failure.ignoreSave = false;
  const applied = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(applied.status, 'confirmed'); assert.equal(applied.remoteWrites, 1); assert.equal(remote.stats().saves, 2); assert.equal(remote.snapshot().hash, prepared.expectedHash);
  const operation = JSON.parse(await readFile(path.join(f.runDir, 'amendments', f.request.operationId, 'operation-state.json'), 'utf8'));
  assert.equal(operation.status, 'confirmed'); assert.equal(operation.attempts, 2); await f.assertHistoricalUnchanged();
});

test('prepared revision uses immutable bundle copies when mutable caller input files are replaced later', async t => {
  const f = await fixture(t, 'cards'), remote = fakeRemote(f), prepared = await prepareNative44Revision(f.root, f.request);
  const refs = [f.request.before, f.request.cssModel, f.request.requirements, f.request.acceptancePolicy, f.request.sourceUnits, f.request.manifest], changed = new Set(refs.map(ref => ref.path));
  const replacement = JSON.stringify({ unrelatedCallerEdit: 'Must not alter a prepared operation.' });
  for (const ref of refs) await writeFile(ref.path, replacement);
  const applied = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(applied.status, 'confirmed'); assert.equal(remote.stats().saves, 1); assert.equal(remote.snapshot().hash, prepared.expectedHash);
  assert.equal((await readNative44CurrentState(f.root, f.runDir))?.status, 'pending-css-review');
  for (const ref of refs) assert.equal(await readFile(ref.path, 'utf8'), replacement, 'Applying a frozen revision must preserve newer caller input edits');
  await f.assertHistoricalUnchanged(changed);
});

test('stale visual evidence retains a confirmed write and requirement axes without declaring completion', async t => {
  const f = await fixture(t, 'cards'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request); await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  const review = await f.review(await f.expected()), report = JSON.parse(await readFile(review.verification.path, 'utf8')), visual = JSON.parse(await readFile(review.visualReview.path, 'utf8')) as Array<Record<string, unknown>>;
  const verification = await f.json(review.verification.path, { ...report, documentHash: f.before.hash }), visualReview = await f.json(review.visualReview.path, visual.map(item => ({ ...item, documentHash: f.before.hash })));
  const observation = JSON.parse(await readFile(review.acceptanceObservation.path, 'utf8')) as Native44AcceptanceObservation;
  observation.review = { verification, visualReview };
  for (const check of observation.checks) check.evidence = [verification];
  const acceptanceObservation = await f.json(review.acceptanceObservation.path, observation);
  const current = await recordNative44RevisionReview(f.root, f.runId, { verification, visualReview, acceptanceObservation });
  assert.equal(current.status, 'stale-review'); assert.equal(current.deliveryComplete, false); assert.equal(current.visualVerification, 'stale');
  assert.equal(current.axes?.write.status, 'confirmed'); assert.equal(current.axes?.css.status, 'applied'); assert.equal(current.axes?.review.status, 'stale'); assert.equal(current.axes?.review.documentHash, f.before.hash); assert.equal(current.axes?.requirements.status, 'satisfied-with-deviations'); assert.equal(current.axes?.delivery.status, 'pending');
  assert.equal(remote.stats().saves, 1); await f.assertHistoricalUnchanged();
});

test('CAS conflict preserves an external edit and never writes a current pointer or overwrites the draft', async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request); const external = remote.externalEdit();
  const applied = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(applied.status, 'conflict'); assert.equal(applied.remoteWrites, 0); assert.equal(applied.observedHash, external.hash); assert.equal(remote.stats().saves, 0); assert.deepEqual(remote.snapshot(), external);
  await assert.rejects(readFile(path.join(f.runDir, 'current-user-amendment.json')), { code: 'ENOENT' });
  const factories = remote.stats().factories;
  await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps), /operation_conflict_requires_new_revision/);
  assert.equal(remote.stats().factories, factories); assert.deepEqual(remote.snapshot(), external); await f.assertHistoricalUnchanged();
});

test('omitted source responsibilities and post-prepare requirement tampering fail before authentication', async t => {
  const f = await fixture(t, 'cards'), remote = fakeRemote(f), invalid = structuredClone(f.contract);
  invalid.requirements = invalid.requirements.filter(row => !(row.sourceKey === 'unit:cards' && row.dimension === 'presentation'));
  const invalidRef = await f.json(path.join(f.runDir, 'inputs', 'bad-requirements.json'), invalid);
  await assert.rejects(prepareNative44Revision(f.root, { ...f.request, requirements: invalidRef }), /Source requirements missing/);
  assert.equal(remote.stats().factories, 0); assert.equal(remote.stats().saves, 0);
  await prepareNative44Revision(f.root, f.request);
  const requirementFile = path.join(f.runDir, 'amendments', f.request.operationId, 'requirements.json');
  await writeFile(requirementFile, JSON.stringify(invalid));
  await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps), /artifact_hash_mismatch/);
  assert.equal(remote.stats().factories, 0); assert.equal(remote.stats().saves, 0); await f.assertHistoricalUnchanged();
});

test('every intent identity stays pre-auth guarded even after an attacker refreshes the bundle intent digest', async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f), prepared = await prepareNative44Revision(f.root, f.request);
  const bundle = JSON.parse(await readFile(prepared.bundle, 'utf8')), intentFile = bundle.files.intent.path as string, originalIntent = JSON.parse(await readFile(intentFile, 'utf8'));
  const replacements: Record<string, unknown> = { version: 2, kind: 'another-intent', pageId: f.pageId + 1, runId: 'another-run', beforeHash: 'd'.repeat(64), expectedHash: 'd'.repeat(64), payloadSha256: 'd'.repeat(64), requestSha256: 'd'.repeat(64), cssSha256: 'd'.repeat(64) };
  assert.deepEqual(Object.keys(originalIntent).sort(), Object.keys(replacements).sort(), 'New durable intent identity fields need their own tampering case');
  const pointer = path.join(f.runDir, 'current-user-amendment.json');
  for (const [field, value] of Object.entries(replacements)) {
    const intent = await f.json(intentFile, { ...originalIntent, [field]: value });
    await f.json(prepared.bundle, { ...bundle, files: { ...bundle.files, intent } });
    await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps), /native44_revision_bundle_derived_output_conflict/, field);
    assert.equal(remote.stats().factories, 0, field); assert.equal(remote.stats().saves, 0, field); assert.equal(remote.stats().closes, 0, field);
    await assert.rejects(readFile(pointer), { code: 'ENOENT' });
  }
  await f.json(intentFile, originalIntent); await f.json(prepared.bundle, bundle);
  const state = JSON.parse(await readFile(path.join(f.runDir, 'amendments', f.request.operationId, 'operation-state.json'), 'utf8'));
  assert.equal(state.status, 'prepared'); assert.equal(state.attempts, 0);
  assert.equal((await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps)).status, 'confirmed'); assert.equal(remote.stats().saves, 1); assert.equal(remote.stats().closes, 1);
  await f.assertHistoricalUnchanged();
});

for (const outcome of ['success', 'unknown', 'ineligible'] as const) test(`remote lifetime closes exactly once after ${outcome} without hidden saves`, async t => {
  const f = await fixture(t, 'heading'), remote = fakeRemote(f, outcome === 'unknown' ? { lostReply: true, failReadAfterSave: true } : { ineligible: outcome === 'ineligible' });
  await prepareNative44Revision(f.root, f.request);
  if (outcome === 'ineligible') {
    await assert.rejects(applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps), /native44_revision_remote_draft_ineligible/);
    assert.equal(remote.stats().reads, 0); assert.equal(remote.stats().saves, 0);
  } else {
    const result = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
    assert.equal(result.status, outcome === 'success' ? 'confirmed' : 'unknown'); assert.equal(remote.stats().saves, 1);
  }
  assert.equal(remote.stats().factories, 1); assert.equal(remote.stats().closes, 1); await f.assertHistoricalUnchanged();
});

const invalidReviews = [
  ['corrupt-target-pixels', 'native44_current_visual_image_invalid'],
  ['source-dimensions', 'native44_current_visual_image_dimensions_invalid'],
  ['missing-product-checks', 'native44_current_verification_product_coverage_invalid'],
  ['wrong-product-identity', 'native44_current_verification_product_coverage_invalid'],
] as const;
for (const [fault, reason] of invalidReviews) test(`review import rejects ${fault} despite matching artifact digests and leaves the pending current pointer unchanged`, async t => {
  const f = await fixture(t, 'cards'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request); await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  const pointerFile = path.join(f.runDir, 'current-user-amendment.json'), beforePointer = await readFile(pointerFile), review = await f.review(await f.expected());
  const report = JSON.parse(await readFile(review.verification.path, 'utf8')), visual = JSON.parse(await readFile(review.visualReview.path, 'utf8')) as Array<Record<string, unknown>>;
  if (fault === 'corrupt-target-pixels' || fault === 'source-dimensions') {
    const field = fault === 'corrupt-target-pixels' ? 'targetScreenshot' : 'sourceScreenshot', hashField = fault === 'corrupt-target-pixels' ? 'targetScreenshotHash' : 'sourceScreenshotHash', filename = report.captures[0][field].path as string;
    const bytes = fault === 'corrupt-target-pixels' ? Buffer.from('Hash-consistent text is not decoded image evidence.') : await sharp({ create: { width: views[0].width, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await writeFile(filename, bytes); report.captures[0][field] = { path: filename, sha256: hashV2(bytes) }; visual[0][hashField] = hashV2(bytes);
  } else if (fault === 'missing-product-checks') report.captures[0].queries = [];
  else if (fault === 'wrong-product-identity') report.captures[0].queries[0].expectedProductIds = [999];
  const verification = await f.json(review.verification.path, report), visualReview = await f.json(review.visualReview.path, visual), observation = JSON.parse(await readFile(review.acceptanceObservation.path, 'utf8')) as Native44AcceptanceObservation;
  observation.review = { verification, visualReview }; for (const check of observation.checks) check.evidence = [verification];
  const acceptanceObservation = await f.json(review.acceptanceObservation.path, observation);
  await assert.rejects(recordNative44RevisionReview(f.root, f.runId, { verification, visualReview, acceptanceObservation }), error => error instanceof Error && error.message.startsWith(reason));
  assert.deepEqual(await readFile(pointerFile), beforePointer); assert.equal((await readNative44CurrentState(f.root, f.runDir))?.status, 'pending-css-review'); assert.equal(remote.stats().saves, 1); assert.equal(remote.stats().closes, 1); await f.assertHistoricalUnchanged();
});

test('evidence observed before write confirmation remains recorded as stale with delivery blocked', async t => {
  const f = await fixture(t, 'cards'), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request); await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  const review = await f.review(await f.expected()), report = JSON.parse(await readFile(review.verification.path, 'utf8')), visual = JSON.parse(await readFile(review.visualReview.path, 'utf8')) as Array<Record<string, unknown>>;
  const oldTime = '2000-01-01T00:00:00.000Z', verification = await f.json(review.verification.path, { ...report, observedAt: oldTime }), visualReview = await f.json(review.visualReview.path, visual.map(item => ({ ...item, observedAt: oldTime })));
  const observation = JSON.parse(await readFile(review.acceptanceObservation.path, 'utf8')) as Native44AcceptanceObservation;
  observation.review = { verification, visualReview }; for (const check of observation.checks) check.evidence = [verification];
  const current = await recordNative44RevisionReview(f.root, f.runId, { verification, visualReview, acceptanceObservation: await f.json(review.acceptanceObservation.path, observation) });
  assert.equal(current.status, 'stale-review'); assert.equal(current.axes?.write.status, 'confirmed'); assert.equal(current.axes?.css.status, 'applied'); assert.equal(current.axes?.review.status, 'stale'); assert.equal(current.axes?.requirements.status, 'satisfied-with-deviations'); assert.equal(current.axes?.delivery.status, 'pending'); assert.equal(current.deliveryComplete, false);
  assert.equal(current.axes?.review.observedAt, oldTime); assert.notEqual(current.convergence.recommendation, 'stop'); assert.equal(remote.stats().saves, 1); await f.assertHistoricalUnchanged();
});

test('persistent critical gaps advise revisiting the model after three reviews without ever passing acceptance', async t => {
  const f = await fixture(t, 'cards', true), remote = fakeRemote(f);
  await prepareNative44Revision(f.root, f.request); await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  for (let round = 1; round <= 3; round++) {
    const current = await recordNative44RevisionReview(f.root, f.runId, await f.review(await f.expected(), true));
    assert.equal(current.status, 'reviewed-with-gaps'); assert.equal(current.axes?.review.status, 'reviewed'); assert.equal(current.axes?.requirements.status, 'blocked'); assert.equal(current.axes?.delivery.status, 'pending'); assert.equal(current.deliveryComplete, false);
    assert.equal(current.convergence.rounds, round); assert.equal(current.convergence.recommendation, round === 3 ? 'revisit-model' : 'continue');
  }
  assert.equal(remote.stats().saves, 1); assert.equal(remote.stats().closes, 1); await f.assertHistoricalUnchanged();
});

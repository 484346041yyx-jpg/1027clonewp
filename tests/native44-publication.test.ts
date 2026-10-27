import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { publicationFixture } from './helpers/publication-fixture.js';
import { assertNative44PublicationGate, prepareNative44Publication, applyNative44Publication, finalizeNative44Publication, readNative44Publication, native44PublicationIssueHash, type Native44PublicationRemote, type Native44PublicationRequest } from '../src/native44/publication.js';
import { readNative44CurrentState, type Native44CurrentState } from '../src/native44/current-state.js';
import { emitNative44DeliverySummary } from '../src/native44/delivery-summary.js';
import { verifyNative44CurrentRevision } from '../src/native44/compare-cli.js';
import { documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import type { PublishedSnapshot } from '../src/wordpress/types.js';
import { freezeNewTaskFinalDeliveryPolicy } from '../src/core/delivery-policy.js';

async function setup(t: test.TestContext) {
  const f = await publicationFixture(t), state = (await readNative44CurrentState(f.root, f.runDir))!;
  await f.json(path.join(f.runDir, 'compare-manifest.json'), f.manifest);
  const request: Native44PublicationRequest = { version: 1, kind: 'native44-page-publication-request', taskId: f.taskId, runId: f.runId, pageId: 77, operationId: 'publication-one', documentHash: f.after.hash, expectedPointerHash: hashV2(await readFile(f.pointerFile)), review: f.pointer.verification, authorization: { basis: 'explicit-user-instruction', instruction: 'Publish the exact task-owned page after its current review.' }, acceptedOmissions: [] };
  let snapshot: typeof f.after | PublishedSnapshot = structuredClone(f.after), writes = 0, reads = 0, fault: 'none' | 'lost-response' | 'no-change' | 'changed' | 'unobservable' = 'none', visible = true;
  const remote: Native44PublicationRemote = {
    async probeOwnedReviewStatus(pageId, runId) { if (!visible) throw Error('offline'); return { pageId, runId, exists: true, postType: 'page', status: snapshot.status, ownerMatches: true, canEdit: true, uniqueRunPage: true, documentExists: true, builtWithElementor: true }; },
    async readOwnedReviewCheckpoint() { reads++; assert.equal(snapshot.status, 'draft'); return { snapshot: structuredClone(snapshot) as typeof f.after }; },
    async readOwnedPublishedCheckpoint() { reads++; assert.equal(snapshot.status, 'publish'); return { snapshot: structuredClone(snapshot) as PublishedSnapshot, publicUrl: 'https://target.test/pet-page/' }; },
    async publishOwnedDraft(before, intent) {
      writes++; assert.equal(before.hash, f.after.hash); assert.equal(intent.durableIntentConfirmed, true); assert.ok(intent.freeBytes >= 512 * 1024 * 1024);
      const intentFile = JSON.parse(await readFile(path.join(f.runDir, 'publications', intent.operationId, 'intent.json'), 'utf8')); assert.equal(intentFile.beforeHash, before.hash);
      if (fault === 'no-change') throw Error('request-rejected');
      snapshot = { ...structuredClone(before), status: 'publish' };
      if (fault === 'changed') { snapshot.settings.external = true; snapshot.hash = documentHashV2(snapshot.elements, snapshot.settings); }
      if (fault === 'unobservable') { visible = false; throw Error('timeout'); }
      if (fault === 'lost-response') throw Error('timeout');
      return { snapshot, publicUrl: 'https://target.test/pet-page/', settingsStatus: 'retained' };
    },
  };
  return { ...f, state, request, remote, deps: { remote: async () => remote }, get writes() { return writes; }, get reads() { return reads; }, get fault(): typeof fault { return fault; }, set fault(value: typeof fault) { fault = value; }, get visible() { return visible; }, set visible(value: boolean) { visible = value; }, get snapshot() { return snapshot; }, set snapshot(value: typeof snapshot) { snapshot = value; } };
}

test('publication is exact, independently recorded, idempotent, and published checkpoint stays read-only', async t => {
  const f = await setup(t), original = await readFile(f.pointerFile), oldJournal = await readFile(path.join(f.runDir, 'journal.json'));
  await prepareNative44Publication(f.root, f.request); assert.equal(f.writes, 0);
  const result = await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps); assert.equal(result.status, 'confirmed'); assert.equal(f.writes, 1);
  assert.deepEqual(await readFile(f.pointerFile), original); assert.deepEqual(await readFile(path.join(f.runDir, 'journal.json')), oldJournal);
  const publication = await readNative44Publication(f.root, f.state); assert.equal(publication?.unpublished, false); assert.equal(publication?.draftDocumentHash, f.after.hash);
  const second = await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps); assert.equal(second.status, 'confirmed'); assert.equal(f.writes, 1);
  const verified = await verifyNative44CurrentRevision(f.root, f.runDir, f.remote); assert.equal(verified.inspectionComplete, true); assert.equal(verified.kind, 'native44-publication-read-only-verification'); assert.equal(f.writes, 1);
  const delivery = await emitNative44DeliverySummary(f.root, f.runId); assert.equal(delivery.summary.publication?.pageId, 77); assert.equal(delivery.summary.status, 'published'); assert.ok((await readFile(delivery.markdownRef.path, 'utf8')).includes('Published page:'));
});

test('a lost publication response reconciles actual publish without a second write', async t => {
  const f = await setup(t); f.fault = 'lost-response'; await prepareNative44Publication(f.root, f.request);
  const result = await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps); assert.equal(result.status, 'confirmed'); assert.equal(f.writes, 1);
});

test('unobservable response stays unknown and a later reconcile confirms without retry', async t => {
  const f = await setup(t); f.fault = 'unobservable'; await prepareNative44Publication(f.root, f.request);
  const result = await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps); assert.equal(result.status, 'unknown'); assert.equal(f.writes, 1);
  f.visible = true; const reconciled = await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps, 'reconcile'); assert.equal(reconciled.status, 'confirmed'); assert.equal(f.writes, 1);
});

test('rejected or externally changed results never get a false publication receipt', async t => {
  const f = await setup(t); f.fault = 'no-change'; await prepareNative44Publication(f.root, f.request);
  assert.equal((await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps)).status, 'retryable'); assert.equal(f.writes, 1);
  assert.equal(await readNative44Publication(f.root, f.state), undefined);
  f.fault = 'changed'; assert.equal((await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps)).status, 'conflict'); assert.equal(f.writes, 2);
  assert.equal(await readNative44Publication(f.root, f.state), undefined);
});

test('external already-published page is not adopted without this persisted attempt', async t => {
  const f = await setup(t); await prepareNative44Publication(f.root, f.request); f.snapshot = { ...f.after, status: 'publish' };
  await assert.rejects(applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps), /published_without_this_intent/); assert.equal(f.writes, 0);
});

test('a confirmed publication with a lost index cannot republish a reverted page', async t => {
  const f = await setup(t); await prepareNative44Publication(f.root, f.request); await applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps);
  await unlink(path.join(f.runDir, 'current-publication.json')); f.snapshot = structuredClone(f.after);
  await assert.rejects(applyNative44Publication(f.root, f.runId, f.request.operationId, f.deps), /published_page_reverted/); assert.equal(f.writes, 1);
});

test('stale pointer fails before authentication and old tasks do not inherit the new project default', async t => {
  const f = await setup(t); await assert.rejects(prepareNative44Publication(f.root, { ...f.request, expectedPointerHash: 'f'.repeat(64) }), /current_identity_conflict/);
  assert.equal((await readdir(f.runDir)).includes('publications'), false);
  assert.equal((await finalizeNative44Publication(f.root, f.runId, { remote: async () => { throw Error('must-not-authenticate'); } })).status, 'draft-preserved');
});

test('frozen publication default finalizes the verified current revision once and repeated finalization only reads', async t => {
  const f = await setup(t);
  await f.json(path.join(f.root, 'config', 'project.json'), { pageStatus: 'publish', credentialsFile: 'credentials-must-not-be-read.json' });
  const finalDeliveryPolicy = await freezeNewTaskFinalDeliveryPolicy(f.root);
  const marker = { version: 2, workflow: 'block-replication', mode: 'replica', executionStrategy: 'native44-css-handoff', taskId: f.taskId, url: f.manifest.sourceUrl, jobDir: path.join(f.root, 'references', f.taskId), programPath: path.join(f.root, 'references', f.taskId, 'program.json'), finalDeliveryPolicy };
  await f.json(path.join(f.root, 'references', f.taskId, 'job.json'), marker);
  await f.json(path.join(f.runDir, 'journal.json'), { ...f.journal, finalDeliveryPolicy });
  const pointerBefore = await readFile(f.pointerFile), journalBefore = await readFile(path.join(f.runDir, 'journal.json')), taskBefore = await readFile(path.join(f.root, 'references', f.taskId, 'job.json'));
  const result = await finalizeNative44Publication(f.root, f.runId, f.deps);
  assert.equal(result.status, 'confirmed'); assert.equal(result.remoteWrites, 1); assert.equal(f.writes, 1);
  const repeated = await finalizeNative44Publication(f.root, f.runId, f.deps);
  assert.equal(repeated.status, 'confirmed'); assert.equal(repeated.remoteWrites, 0); assert.equal(f.writes, 1);
  assert.ok(pointerBefore.equals(await readFile(f.pointerFile))); assert.ok(journalBefore.equals(await readFile(path.join(f.runDir, 'journal.json')))); assert.ok(taskBefore.equals(await readFile(path.join(f.root, 'references', f.taskId, 'job.json'))));
  const state = (await readNative44CurrentState(f.root, f.runDir))!, publication = await readNative44Publication(f.root, state);
  assert.equal(state.visualVerification, 'applied-verified'); assert.equal(publication?.unpublished, false); assert.equal(publication?.draftDocumentHash, f.after.hash);
});

test('only explicitly accepted named missing interaction is scoped out; actual failed checks remain blocked', () => {
  const issue = 'hero: Playback control is absent.';
  const state = { currentCaptureReview: { review: 'reviewed', automated: 'passed', qualityFloor: { status: 'blocked', issues: [issue] }, notes: { unfinished: [{ domain: 'interaction', region: 'hero', issue: 'Playback control is absent.' }] } } } as Native44CurrentState;
  const request = { authorization: { basis: 'explicit-user-instruction', instruction: 'Skip this omitted control and publish.' }, acceptedOmissions: [{ issueHash: native44PublicationIssueHash(issue), reason: 'User declined the optional control plugin.' }] } as Native44PublicationRequest;
  assert.doesNotThrow(() => assertNative44PublicationGate(state, request));
  assert.throws(() => assertNative44PublicationGate(state, { ...request, acceptedOmissions: [] }), /quality_floor/);
  assert.throws(() => assertNative44PublicationGate({ ...state, currentCaptureReview: { ...state.currentCaptureReview!, automated: 'has-failures' } }, request), /actual_checks_not_passed/);
  assert.throws(() => assertNative44PublicationGate({ ...state, currentCaptureReview: { ...state.currentCaptureReview!, qualityFloor: { status: 'blocked', issues: ['product query failed'] } } }, request), /quality_floor/);
});

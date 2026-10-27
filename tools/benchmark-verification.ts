/** Local, reproducible verification workload. No live page or credentials.
 * Fixture creation and fake remote setup are outside the measured region.
 * Run baseline before source edits, then optimized on the same fixture bytes. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fixture, fakeRemote } from '../tests/helpers/revision-flow-fixture.js';
import { prepareNative44Revision, applyNative44Revision, recordNative44RevisionReview } from '../src/native44/revision.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
import { native44RequirementsHash } from '../src/native44/requirements.js';
import { canonicalV2, hashV2 } from '../src/replica-v2/journal.js';

const root = await realpath(path.resolve(import.meta.dirname, '..'));
const outputDir = path.join(root, '.cache', 'verification-benchmark');
const mode = process.argv[2];
assert.ok(['setup', 'baseline', 'optimized', 'cleanup'].includes(mode), 'setup|baseline|optimized|cleanup');
const descriptor = path.join(outputDir, 'fixture.json');
if (mode === 'setup') {
  await mkdir(outputDir, { recursive: true });
  const f = await fixture({ after: () => {} } as any, 'cards', false, false, { evidencePaddingBytes: 2 * 1024 * 1024 });
  const packet = f.contract.requirements[0].checks[0].sourceEvidence[0];
  // Repeated references model the large shared observations encountered in
  // real contracts. Their original checks/coverage/tolerance remain intact.
  for (const row of f.contract.requirements) for (const check of row.checks) check.sourceEvidence.push(...Array.from({ length: 64 }, () => check.sourceEvidence[0]));
  f.policy.requirementsHash = native44RequirementsHash(f.contract);
  f.request.requirements = await f.json(f.request.requirements.path, f.contract);
  f.request.acceptancePolicy = await f.json(f.request.acceptancePolicy.path, f.policy);
  await prepareNative44Revision(f.root, f.request);
  const remote = fakeRemote(f);
  const applied = await applyNative44Revision(f.root, f.runId, f.request.operationId, remote.deps);
  assert.equal(applied.status, 'confirmed'); assert.equal(remote.stats().saves, 1);
  const review = await f.review(await f.expected());
  await recordNative44RevisionReview(f.root, f.runId, review);
  await writeFile(descriptor, JSON.stringify({ root: f.root, runId: f.runId, runDir: f.runDir, review, checks: f.contract.requirements.flatMap(row => row.checks).length, repeatedPacket: packet }));
  console.log(JSON.stringify({ status: 'ready', descriptor, checks: f.contract.requirements.flatMap(row => row.checks).length }));
} else if (mode === 'cleanup') {
  const config = JSON.parse(await readFile(descriptor, 'utf8'));
  const parent = path.join(root, 'tests', 'fixtures');
  assert.equal(path.dirname(config.root), parent); assert.ok(path.basename(config.root).startsWith('.native44-revision-flow-'));
  assert.equal(await realpath(config.root), config.root);
  await rm(config.root, { recursive: true }); await rm(descriptor);
  console.log(JSON.stringify({ status: 'cleaned' }));
} else {
  const config = JSON.parse(await readFile(descriptor, 'utf8'));
  const samples = [];
  let identity: string | undefined;
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const state = (await readNative44CurrentState(config.root, config.runDir))!;
    const stateMs = performance.now() - started;
    const reviewStarted = performance.now();
    const reviewed = await recordNative44RevisionReview(config.root, config.runId, config.review);
    const reviewMs = performance.now() - reviewStarted;
    assert.equal(reviewed.deliveryComplete, true); assert.equal(reviewed.axes!.review.status, 'reviewed');
    const outcome = canonicalV2({ documentHash: state.documentHash, axes: state.axes, counts: state.counts, visualVerification: state.visualVerification, delivery: reviewed.delivery.summary.axes, checks: config.checks });
    const outcomeHash = hashV2(outcome);
    if (identity) assert.equal(outcomeHash, identity); identity = outcomeHash;
    samples.push({ stateMs, reviewMs, totalMs: stateMs + reviewMs, evidenceReferences: state.evidence.length, uniqueFiles: new Set(state.evidence.map(ref => ref.path)).size, logicalEvidenceBytes: state.evidence.reduce((sum, ref) => sum + ref.bytes, 0), evidenceWork: reviewed.evidenceWork });
  }
  const median = (key: 'stateMs' | 'reviewMs' | 'totalMs') => samples.map(sample => sample[key]).sort((a, b) => a - b)[1];
  const result = { mode, fixtureHash: hashV2(await readFile(descriptor)), outcomeHash: identity, checks: config.checks, samples, median: { stateMs: median('stateMs'), reviewMs: median('reviewMs'), totalMs: median('totalMs') } };
  await writeFile(path.join(outputDir, `${mode}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

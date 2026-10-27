import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { hashV2 } from '../src/replica-v2/journal.js';
import { qualifyNative44CurrentNativeReviewEvidence, native44CurrentNativeReviewEvidenceAllows, native44CurrentNativeReviewDependencies } from '../src/native44/current-native-review-evidence.js';
import type { Native44CurrentNativeSourceBinding } from '../src/native44/current-native-model.js';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';
type Ref = { path: string; sha256: string };
async function fixture(t: any, options: { foreignReport?: string; foreignMember?: boolean; measurementViewport?: string; measurementWidth?: number; orphan?: boolean; badDerivative?: boolean; standard?: boolean; probe?: boolean } = {}) {
  const root = await mkdtemp(path.resolve('D:/cloneWP/tests/fixtures/.native-review-evidence-'));
  t.after(async () => { const resolved = await realpath(root); assert.ok(resolved.startsWith(path.resolve('D:/cloneWP/tests/fixtures') + path.sep)); await rm(resolved, { recursive: true }); });
  const identity = { taskId: 'task-a', runId: 'owned-run', pageId: 77 }, documentHash = 'a'.repeat(64), owner = path.join(root, 'runs', 'historical-review');
  const put = async (name: string, value: unknown, raw = false): Promise<Ref> => { const filename = path.join(root, name), bytes = raw ? Buffer.from(value as string) : Buffer.from(JSON.stringify(value)); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); return { path: filename, sha256: hashV2(bytes) }; };
  const manifest = await put('runs/owned-run/amendments/before/compare-manifest.json', { ...identity, documentHash, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080 }] }), snapshot = await put('runs/owned-run/amendments/before/after.json', { runId: identity.runId, pageId: identity.pageId, hash: documentHash });
  const source = await put('runs/historical-review/source.png', 'source-pixels', true), target = await put('runs/historical-review/target.png', 'target-pixels', true), census = await put('runs/historical-review/census.json', { ...identity, documentHash, ...(options.foreignMember ? { pageId: 88 } : {}) }), layout = await put('runs/historical-review/target.png.layout.json', { version: 1, pngPath: target.path });
  const measurement = await put('runs/historical-review/measurements.json', { viewport: { name: options.measurementViewport ?? 'desktop-wide', width: options.measurementWidth ?? 1920, height: 1080 }, source: { screenshot: source.path, sha256: source.sha256 }, target: { screenshot: target.path, sha256: target.sha256 }, targetDOMCensus: census });
  const derivative = await put(options.badDerivative ? 'runs/historical-review/not-qa.png' : 'runs/historical-review/qa-module-pairs/wide.png', 'paired-pixels', true);
  const observation = await put('runs/historical-review/style.json', { version: 1, kind: 'actual-owned-testimonial-style-probe', current: { ...identity, documentHash } });
  let report: any = { version: 1, kind: 'native44-current-review', ...identity, ...(options.foreignReport ? { [options.foreignReport]: options.foreignReport === 'pageId' ? 88 : 'foreign' } : {}), documentHash, documentUnchanged: true, metrics: { documentWrites: 0, editorSessions: 0 }, currentManifest: manifest, visualReview: { verdict: 'failed' }, captures: [{ viewport: 'desktop-wide', sourceScreenshot: source, targetScreenshot: target, targetDOMCensus: census, screenshotEvidence: { receipt: layout } }] };
  if (options.standard) report = { ...report, kind: undefined, executionStrategy: 'native44-css-handoff', finalReadHash: documentHash, baselineDocumentHash: documentHash, captures: [{ viewport: 'desktop-wide', source: { screenshot: source.path, sha256: source.sha256 }, target: { screenshot: target.path, sha256: target.sha256, screenshotEvidence: { receipt: layout } } }] };
  if (options.probe) report = { version: 1, kind: 'actual-owned-current-testimonial-style-diagnostic', ...identity, documentHash, currentUnchanged: true, documentWrites: 0, targetWrites: 0, editorSessions: 0, manifest, snapshot, observations: [{ documentHash, observations: observation }], visualPassed: false, acceptancePassed: false };
  const reportRef = await put('runs/historical-review/report.json', report), qa = await put('runs/historical-review/qa-module-pairs/index.json', { version: 1, kind: 'actual-current-review-qa-derivatives', report: reportRef, documentHash, visualVerdict: 'unreviewed', rows: [{ viewport: 'desktop-wide', derivative, actualInputReferences: { source, target, measurements: measurement } }] });
  const evidence = options.probe ? [reportRef, observation] : options.standard ? [reportRef, source, target, layout] : [qa, source, target, census, measurement, derivative, layout];
  if (options.orphan) evidence.push(await put('runs/historical-review/orphan.json', { ...identity, documentHash }));
  const binding: Native44CurrentNativeSourceBinding = { elementId: 'abc1234', originalComponentKey: 'original', replacementComponentKey: 'replacement', sourceUnitIds: ['wide-unit', 'narrow-unit'], reason: 'The exact same-task historical review remains diagnostic source evidence.', evidence };
  return { input: { root, ...identity, sourceBindings: [binding] }, root, owner, identity, binding, evidence, report: reportRef, qa, measurement, census, target, put };
}
test('same-task historical failed review and exact QA/capture members qualify without promoting acceptance', async t => {
  const f = await fixture(t), token = await qualifyNative44CurrentNativeReviewEvidence(f.input);
  for (const ref of f.evidence) assert.equal(native44CurrentNativeReviewEvidenceAllows(token, f.root, ref, f.identity, true), true);
  assert.equal(native44CurrentNativeReviewEvidenceAllows(token, f.root, f.report, f.identity, true), false); assert.equal(native44CurrentNativeReviewEvidenceAllows(token, f.root, f.report, f.identity), true);
  assert.ok(native44CurrentNativeReviewDependencies(token).some(ref => ref.path.endsWith('compare-manifest.json')));
  assert.ok(NATIVE44_ADAPTER_SOURCE_PATHS.includes('src/native44/current-native-review-evidence.ts'));
});
test('standard review reports and same-task historical testimonial probes retain their typed read-only routes', async t => {
  for (const options of [{ standard: true }, { probe: true }]) { const f = await fixture(t, options), token = await qualifyNative44CurrentNativeReviewEvidence(f.input); assert.equal(native44CurrentNativeReviewEvidenceAllows(token, f.root, f.evidence[0], f.identity, true), true); }
});
test('cross-task/run/page reports, conflicting member identity and orphan files reject', async t => {
  for (const foreignReport of ['taskId', 'runId', 'pageId']) { const f = await fixture(t, { foreignReport }); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(f.input), /report_identity_conflict/); }
  const member = await fixture(t, { foreignMember: true }); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(member.input), /member_identity_conflict/);
  const orphan = await fixture(t, { orphan: true }); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(orphan.input), /undeclared_report_member/);
});
test('wrong QA owner/derivative/measurement anchors and declared hash changes reject', async t => {
  const derivative = await fixture(t, { badDerivative: true }); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(derivative.input), /qa_capture_membership_conflict/);
  const measurement = await fixture(t, { measurementViewport: 'desktop-narrow' }); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(measurement.input), /measurement_capture_membership_conflict/);
  const dimension = await fixture(t, { measurementWidth: 1440 }); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(dimension.input), /measurement_capture_membership_conflict/);
  const hash = await fixture(t); hash.binding.evidence.find(ref => ref.path === hash.target.path)!.sha256 = 'f'.repeat(64); await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(hash.input), /undeclared_report_member|hash_mismatch/);
  const owner = await fixture(t), qa = JSON.parse(await readFile(owner.qa.path, 'utf8')); qa.report.path = path.join(owner.root, 'runs', 'foreign-review', 'report.json'); const ref = await owner.put('runs/historical-review/qa-module-pairs/index.json', qa); owner.binding.evidence[0] = ref; await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(owner.input), /qa_report_owner_conflict/);
});
test('tokens are process-local and bound to exact reference digest and task identity', async t => {
  const f = await fixture(t), token = await qualifyNative44CurrentNativeReviewEvidence(f.input);
  assert.equal(native44CurrentNativeReviewEvidenceAllows(structuredClone(token), f.root, f.target, f.identity), false);
  assert.equal(native44CurrentNativeReviewEvidenceAllows(token, f.root, { ...f.target, sha256: 'f'.repeat(64) }, f.identity), false);
  for (const identity of [{ ...f.identity, taskId: 'foreign' }, { ...f.identity, runId: 'foreign' }, { ...f.identity, pageId: 88 }]) assert.equal(native44CurrentNativeReviewEvidenceAllows(token, f.root, f.target, identity), false);
});
test('review directory junctions cannot change the declared physical owner', async t => {
  const f = await fixture(t), alias = path.join(f.root, 'runs', 'review-alias'); try { await symlink(f.owner, alias, 'junction'); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Host does not permit a junction fixture'); return; } throw error; } f.binding.evidence = [{ ...f.target, path: path.join(alias, path.basename(f.target.path)) }]; await assert.rejects(qualifyNative44CurrentNativeReviewEvidence(f.input), /reference_alias/);
});

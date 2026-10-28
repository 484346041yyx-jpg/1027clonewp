import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationPolicyFixture } from './helpers/preparation-policy-fixture.js';
import { buildPreparationJobs, preparationHash } from '../src/replica-preparation/contract.js';
import { defaultPreparationExecutionPolicy } from '../src/replica-preparation/execution-policy.js';
import { createPreparationCoordination, checkPreparationBrowserWorkspace, createPreparationRepairPlan } from '../src/replica-preparation/coordination.js';
import { summarizePreparationPhases, type PreparationPhaseDocument } from '../src/replica-preparation/phase-events.js';

function fixture() {
  const plan = preparationPolicyFixture(); plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
  return { plan, jobs: buildPreparationJobs(plan) };
}
test('coordination binds full workflow to source identity without claiming browsers, production or review occurred', () => {
  const { plan, jobs } = fixture(), value = createPreparationCoordination(plan, jobs);
  assert.equal(value.contractHash, preparationHash(plan)); assert.equal(value.browser.windows.length, 2);
  assert.equal(value.planIsRuntimeEvidence, false); assert.equal(value.materials.backendStateCache, false);
  assert.equal(value.review.finalQualityGates, 'unchanged'); assert.equal(value.controller.workersMayWriteRemote, false);
  assert.equal(value.ownership.length, jobs.length); assert.equal(value.inquiryTesting, 'user-managed-no-automatic-submission-or-test-email');
  assert.throws(() => createPreparationCoordination(plan, jobs.slice(1)), /jobs_changed/);
  const old = structuredClone(plan); delete old.executionPolicy;
  assert.throws(() => createPreparationCoordination(old, buildPreparationJobs(old)), /policy_required/);
});
test('browser binding checks role, actual paired widths, same browser and unique owned editor without reducing required views', () => {
  const { plan } = fixture();
  const proof = { version: 1, kind: 'clonewp-browser-workspace-observation', taskId: plan.taskId, runId: plan.runId, contractHash: preparationHash(plan),
    windows: [{ role: 'desktop', browserId: 'chrome', windowId: 'wide', sourceTabId: 'source-wide', targetTabId: 'target-wide', sourceClientWidth: 1440, targetClientWidth: 1440 }, { role: 'phone', browserId: 'chrome', windowId: 'phone', sourceTabId: 'source-phone', targetTabId: 'target-phone', sourceClientWidth: 390, targetClientWidth: 390 }],
    editor: { tabId: 'editor', browserId: 'chrome', windowId: 'wide', pageId: 42, dirty: false, saving: false, pendingSaveRequests: 0, saveOutcomeUnknown: false } };
  assert.equal(checkPreparationBrowserWorkspace(plan, proof, 42).canRefreshEditor, true);
  assert.equal(checkPreparationBrowserWorkspace(plan, proof, 42).allRequiredViewsVerified, false);
  for (const change of [
    (p: typeof proof) => { p.windows[1].targetClientWidth = 430; },
    (p: typeof proof) => { p.windows[1].windowId = 'wide'; },
    (p: typeof proof) => { p.windows[1].browserId = 'other'; },
    (p: typeof proof) => { p.editor.tabId = 'source-wide'; },
    (p: typeof proof) => { p.editor.pageId = 99; },
  ]) { const changed = structuredClone(proof); change(changed); assert.throws(() => checkPreparationBrowserWorkspace(plan, changed, 42), /coordination_/); }
  assert.equal(checkPreparationBrowserWorkspace(plan, { ...proof, editor: { ...proof.editor, dirty: true } }, 42).canRefreshEditor, false);
});
test('one consolidated repair plan preserves every finding and routes local versus shared ownership without granting writes or approval', () => {
  const { plan, jobs } = fixture();
  const findings = [{ sourceFactId: plan.sections[0].sourceFactIds[0], code: 'different', field: 'color' }, { sourceFactId: 'phone-fact', code: 'different', field: 'width' }, { sourceFactId: 'shared-font', code: 'different', field: 'font' }];
  const value = createPreparationRepairPlan(plan, jobs, findings, { 'phone-fact': plan.sections.at(-1)!.key });
  assert.equal(value.batches.flatMap(b => b.findings).length, 2); assert.equal(value.coordinatorFindings.length, 1);
  assert.equal(value.globalChangeRequiresAllViews, true); assert.equal(value.findingsAreApproval, false);
  assert.equal(value.automaticRemoteWrite, false); assert.equal(createPreparationRepairPlan(plan, jobs, []).zeroFindingsAreApproval, false);
  assert.throws(() => createPreparationRepairPlan(plan, jobs, findings, { 'phone-fact': 'missing' }), /repair_owner/);
  assert.notEqual(createPreparationRepairPlan(plan, jobs, findings).batchHash, value.batchHash);
});

function phaseLog(): PreparationPhaseDocument {
  const row = (index: number, stage: PreparationPhaseDocument['entries'][number]['stage'], start: number, end: number, status: 'failed' | 'succeeded' = 'succeeded') => ({ marker: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, stage, status, startedAt: new Date(start).toISOString(), finishedAt: new Date(end).toISOString(), elapsedMs: end - start, clockSkewDetected: end < start });
  return { version: 1, kind: 'clonewp-preparation-phase-events', durationSource: 'cross-command-utc-wall', monotonic: false, entries: [row(1, 'body-production', 0, 10000), row(2, 'body-production', 2000, 12000), row(3, 'browser-wait', 4000, 8000, 'failed'), row(4, 'system-development', 12000, 15000)] };
}
test('timing reports interval union and observed wall rather than adding workers, nested waits or pretending missing stages are zero', () => {
  const value = summarizePreparationPhases(phaseLog());
  assert.equal(value.totalWallMs, 15000); assert.equal(value.coveredActiveMs, 15000);
  assert.equal(value.stages?.find(s => s.stage === 'body-production')?.activeMs, 12000);
  assert.equal(value.stages?.find(s => s.stage === 'browser-wait')?.failures, 1);
  assert.equal(value.stages?.find(s => s.stage === 'publication')?.activeMs, null);
  assert.equal(value.speedup, 'not-measured'); assert.equal(summarizePreparationPhases(null).totalWallMs, null);
  const running = phaseLog(); running.entries.push({ marker: '00000000-0000-4000-8000-000000000005', stage: 'editor-completion', status: 'running', startedAt: new Date(16000).toISOString() });
  assert.equal(summarizePreparationPhases(running).totalWallMs, null);
});

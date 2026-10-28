import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreparationJobs, preparationHash, preparationSharedHash, validatePreparationJobResult, validatePreparationPlan } from '../src/replica-preparation/contract.js';
import { defaultPreparationExecutionPolicy, isPreparationJobId, preparationConcurrency, preparationExecutionGroups, preparationExecutionPolicySchema } from '../src/replica-preparation/execution-policy.js';
import { preparationPolicyFixture as fixture } from './helpers/preparation-policy-fixture.js';
import type { PreparationPlan } from '../src/replica-preparation/types.js';
test('frozen plans without the policy keep legacy two-body grouping and hashes', () => {
  const plan = fixture(), before = preparationHash(plan), jobs = buildPreparationJobs(plan);
  assert.equal(validatePreparationPlan(plan).executionPolicy, undefined);
  assert.deepEqual(jobs.map(j => j.jobId), ['header', 'body-1', 'body-2']);
  assert.equal(preparationHash(validatePreparationPlan(plan)), before);
  assert.equal(preparationConcurrency(plan), 3);
});

test('new policy creates a deterministic queue beyond the worker count without lost or duplicated regions', () => {
  const plan = fixture(); plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
  const jobs = buildPreparationJobs(plan), body = jobs.filter(j => j.responsibility === 'body');
  assert.ok(body.length > 3); assert.equal(preparationConcurrency(plan), 3);
  assert.deepEqual(jobs, buildPreparationJobs(structuredClone(plan)));
  assert.deepEqual(body.flatMap(j => j.sectionKeys), plan.sections.map(s => s.key));
  assert.equal(new Set(body.flatMap(j => j.sourceFactIds)).size, plan.sections.length);
  assert.deepEqual(body.map((j, i) => j.jobId === `body-${i + 1}`), body.map(() => true));
});

test('dependency chains and cycles remain atomic even beyond the soft three-region packet target', () => {
  const plan = fixture(); plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
  for (let i = 1; i <= 4; i++) plan.sections[i].dependsOn = [plan.sections[i - 1].key];
  plan.sections[0].dependsOn = [plan.sections[4].key];
  const group = buildPreparationJobs(plan).find(j => j.sectionKeys.includes('section0'))!;
  assert.deepEqual(group.sectionKeys, ['section0', 'section1', 'section2', 'section3', 'section4']);
});

test('a high-effort region gets its own work packet instead of waiting behind several simple regions', () => {
  const plan = fixture(); plan.sections[4].estimatedEffort = 40; plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
  const group = buildPreparationJobs(plan).find(j => j.sectionKeys.includes('section4'))!;
  assert.deepEqual(group.sectionKeys, ['section4']); assert.equal(group.estimatedEffort, 40);
});

test('default workers are three except genuinely small low-effort content; dependencies never add a fourth slot', () => {
  for (const [count, expected] of [[1, 1], [2, 1], [3, 3], [6, 3], [8, 3], [12, 3]]) {
    const plan = fixture(count); plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
    assert.equal(plan.executionPolicy.maxWorkers, expected); assert.equal(preparationConcurrency(plan), expected);
  }
  const plan = fixture(12); for (let i = 1; i < 12; i++) plan.sections[i].dependsOn = ['section0'];
  plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
  assert.equal(plan.executionPolicy.maxWorkers, 2); assert.equal(preparationConcurrency(plan), 2);
  assert.equal(preparationExecutionGroups({ ...plan, executionPolicy: { ...plan.executionPolicy, maxWorkers: 1 } }).length, 1);
});

test('few regions with interaction, motion or heavy effort do not silently select the minimal-page exception', () => {
  for (const customize of [
    (plan: PreparationPlan) => { plan.sections[0].family = 'interaction'; },
    (plan: PreparationPlan) => { plan.sections[0].estimatedEffort = 5; },
    (plan: PreparationPlan) => { plan.sections[0].fidelity!.find(row => row.kind === 'motion')!.status = 'required'; },
    (plan: PreparationPlan) => { plan.sections[0].fidelity!.find(row => row.kind === 'interaction')!.status = 'required'; },
  ]) {
    const plan = fixture(2); customize(plan); plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
    assert.equal(plan.executionPolicy.maxWorkers, 3); assert.equal(preparationConcurrency(plan), 3);
  }
  const plan = fixture(6); for (let index = 2; index < 6; index++) plan.sections[index].dependsOn = [index % 2 ? 'section1' : 'section0'];
  const bodyOnly = { sections: plan.sections, reusedHeader: {} as NonNullable<PreparationPlan['reusedHeader']> };
  const policy = defaultPreparationExecutionPolicy(bodyOnly);
  assert.equal(policy.maxWorkers, 2);
  assert.equal(preparationConcurrency({ ...bodyOnly, executionPolicy: policy }), 2);
});

test('policy is hash-bound, v8-only, bounded and cannot relax browser, reuse, write or review invariants', () => {
  const plan = fixture(), before = preparationSharedHash(plan); plan.executionPolicy = defaultPreparationExecutionPolicy(plan);
  assert.notEqual(preparationSharedHash(plan), before);
  const hash = preparationSharedHash(plan); plan.executionPolicy.maxWorkers = 2; assert.notEqual(preparationSharedHash(plan), hash);
  plan.version = 7; assert.throws(() => validatePreparationPlan(plan), /execution_policy_version/);
  for (const override of [{ maxWorkers: 4 }, { targetSectionsPerJob: 0 }, { browserMode: 'many-controllers' }, { remoteWrites: 'parallel' }, { reviewMode: 'skip' }, { reuse: 'stale-cross-task' }]) assert.equal(preparationExecutionPolicySchema.safeParse({ ...defaultPreparationExecutionPolicy(fixture()), ...override }).success, false);
});

test('dynamic job identities and result work revisions reject path escapes, unbounded IDs and stale-shaped revisions', () => {
  for (const id of ['header', 'body-1', 'body-3', 'body-2000']) assert.equal(isPreparationJobId(id), true);
  for (const id of ['body-0', 'body-01', 'body-2001', 'body-1/../../x', 'body--1', 'body-1.5', 'body-99999']) assert.equal(isPreparationJobId(id), false);
  const result = { version: 1, kind: 'clonewp-preparation-result', taskId: 'task', runId: 'run', jobId: 'body-4', contractHash: 'a'.repeat(64), sharedHash: 'b'.repeat(64), sections: [{ key: 'section0', blocks: [{ key: 'root' }], css: '' }] };
  assert.equal(validatePreparationJobResult(result).workRevision, undefined);
  assert.equal(validatePreparationJobResult({ ...result, workRevision: 2 }).workRevision, 2);
  for (const workRevision of [-1, 1.5, '1']) assert.throws(() => validatePreparationJobResult({ ...result, workRevision }), /result_invalid/);
});

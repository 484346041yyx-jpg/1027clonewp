import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NATIVE44_COMPONENT_REFERENCE_GOAL, Native44RequirementProfileSchema, evaluateNative44Acceptance, applyNative44ActualCheckResults, adviseNative44Convergence, native44RequirementsHash, type Native44Requirement, type Native44RequirementContract, type Native44AcceptanceObservation, type Native44AcceptancePolicy } from '../src/native44/requirements.js';
import { prepareLocalTask } from '../src/native44/local-task.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { validateNative44Program } from '../src/native44/validate.js';

const ref = { path: 'D:/cloneWP/.cache/component-reference-proof.json', sha256: 'a'.repeat(64) }, current = { documentHash: 'b'.repeat(64), cssHash: 'c'.repeat(64) };
function fixture(goal = true) {
  const requirement = (id: string, dimension: Native44Requirement['dimension'], capability: Native44Requirement['capability'], severity: Native44Requirement['severity'], metrics: string[], gap = false): Native44Requirement => ({ id, sourceKey: `${dimension === 'behavior' ? 'interaction' : 'unit'}:${id}`, dimension, capability, severity, disposition: dimension === 'data' ? 'target-product-data' : 'preserve', checks: metrics.map((metric, index) => ({ id: `${id}-${index}`, viewport: 'desktop-wide', state: 'default', scope: dimension === 'behavior' ? 'control' : 'content', metric, sourceEvidence: [ref] })), fulfillment: gap ? { route: 'gap', gapId: `${id}-pending`, reason: 'This named source feature requires connection or configuration on the target site.', state: 'pending-configuration', componentKeys: [id] } : { route: 'verified-native', capability, componentKeys: [id], proof: ref } });
  const contract: Native44RequirementContract = { version: 1, kind: 'native44-requirements', profile: 'source-requirements-v1', ...(goal ? { goalProfile: NATIVE44_COMPONENT_REFERENCE_GOAL } : {}), taskId: 'reference-task', sourceFacts: ref, sourceUnitsHash: ref.sha256, requirements: [
    requirement('body', 'presence', 'render-content', 'blocking', ['presence']), requirement('editor', 'editability', 'editable-native', 'blocking', ['editability']),
    requirement('layout', 'layout', 'render-layout', 'minor', ['bounds', 'order', 'content-flow', 'inset', 'gap']), requirement('type', 'presentation', 'render-presentation', 'cosmetic', ['typography']), requirement('decoration', 'presentation', 'render-presentation', 'cosmetic', ['decoration']),
    requirement('products', 'data', 'target-product-data', 'minor', ['data']), requirement('product-truth', 'authenticity', 'authentic-business', 'blocking', ['authenticity']),
    requirement('carousel', 'behavior', 'carousel-next-previous', 'blocking', ['carousel-next-previous']), requirement('accordion', 'behavior', 'accordion-toggle', 'blocking', ['accordion-toggle']),
    requirement('search', 'behavior', 'search-input', 'critical', ['search-input'], true), requirement('cart', 'behavior', 'cart-state', 'critical', ['cart-state'], true), requirement('form', 'behavior', 'form-submit', 'blocking', ['form-submit'], true), requirement('service', 'behavior', 'third-party-service', 'blocking', ['third-party-service'], true), requirement('pause', 'behavior', 'carousel-playback-toggle', 'blocking', ['carousel-playback-toggle'], true),
  ] };
  const policy = (): Native44AcceptancePolicy => ({ version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] });
  const observed = (): Native44AcceptanceObservation => ({ version: 1, kind: 'native44-acceptance-observation', requirementsHash: native44RequirementsHash(contract), ...current, review: { verification: ref, visualReview: ref }, checks: contract.requirements.flatMap(requirement => requirement.checks.map(check => ({ requirementId: requirement.id, checkId: check.id, outcome: requirement.fulfillment.route === 'gap' ? 'unverified' : 'pass', evidence: [ref] }))) });
  return { contract, policy, observed };
}
function failure(observed: Native44AcceptanceObservation, requirementId: string, code: NonNullable<Native44AcceptanceObservation['checks'][number]['issue']>['category'], delta?: number, checkId?: string) {
  const item = observed.checks.find(item => item.requirementId === requirementId && (!checkId || item.checkId === checkId))!; item.outcome = 'fail'; item.issue = { category: code, message: `Observed ${code} in ${requirementId}`, ...(delta !== undefined ? { delta, unit: 'px' } : {}) }; return item;
}

test('component reference can generate and deliver a quality-verified draft with named open integrations without claiming completion', () => {
  const f = fixture(), result = evaluateNative44Acceptance(f.contract, f.policy(), f.observed(), current);
  assert.equal(result.draftReady, true); assert.equal(result.qualityFloor.status, 'passed'); assert.equal(result.delivery, 'delivered-with-open-items'); assert.equal(result.requirementsComplete, false); assert.equal(result.status, 'satisfied-with-open-items');
  assert.ok(result.findings.some(item => item.requirementId === 'search' && item.category === 'unfinished' && item.componentKeys.includes('search')));
  assert.ok(result.findings.some(item => item.requirementId === 'search' && item.category === 'unverified' && item.evidence.length));
  assert.equal(result.productSubstitutions.length, 1); assert.equal(result.productSubstitutions[0].domain, 'product-substitution');
});

test('old contracts without the new goal remain strict and do not auto-migrate', () => {
  const f = fixture(false), before = native44RequirementsHash(f.contract), result = evaluateNative44Acceptance(f.contract, f.policy(), f.observed(), current);
  assert.equal(result.delivery, 'pending'); assert.equal(result.verdict, 'needs-work'); assert.equal(result.draftReady, false); assert.equal(native44RequirementsHash(f.contract), before);
});

test('generic small geometry and explicit native decoration differences do not require per-check tolerances', () => {
  const f = fixture(), observed = f.observed(); failure(observed, 'layout', 'geometry', 2, 'layout-0'); failure(observed, 'layout', 'geometry', 4, 'layout-4'); failure(observed, 'decoration', 'native-decoration');
  const result = evaluateNative44Acceptance(f.contract, f.policy(), observed, current);
  assert.equal(result.qualityFloor.status, 'passed'); assert.equal(result.deviations.filter(item => item.basis === 'component-reference-default').length, 3); assert.equal(result.findings.filter(item => item.category === 'minor').length, 3);
  assert.ok(result.findings.find(item => item.checkId === 'layout-4')?.delta?.value === 4);
  failure(observed, 'layout', 'geometry', 4.01, 'layout-4'); assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), observed, current).delivery, 'pending');
});

test('order, overflow, fake business, native editing and major typography do not become cosmetic under the new goal', () => {
  const f = fixture();
  for (const [id, category, metric] of [['layout', 'geometry', 'layout-1'], ['layout', 'overflow', 'layout-0'], ['products', 'fake-business', undefined], ['editor', 'editability', undefined], ['type', 'presentation', undefined]] as const) {
    const observed = f.observed(); failure(observed, id, category, 0, metric);
    const result = evaluateNative44Acceptance(f.contract, f.policy(), observed, current); assert.equal(result.delivery, 'pending', `${id}/${category}`); assert.equal(result.qualityFloor.status, 'blocked');
  }
});

test('only measured small font-size and line-height differences receive default typography tolerance', () => {
  const f = fixture();
  for (const [property, delta, allowed] of [['font-size', 0, true], ['font-size', 1, true], ['font-size', 1.001, false], ['line-height', 2, true], ['line-height', 2.001, false], ['font-weight', 0, false], ['font-family', 0, false], ['unknown-property', .1, false]] as const) {
    for (const category of ['presentation', 'geometry'] as const) {
      const observed = f.observed(), item = failure(observed, 'type', category, delta); item.issue!.property = property;
      const result = evaluateNative44Acceptance(f.contract, f.policy(), observed, current);
      assert.equal(result.qualityFloor.status === 'passed', allowed, `${property}/${delta}/${category}`);
      if (allowed) assert.ok(result.findings.some(finding => finding.requirementId === 'type' && finding.category === 'minor' && finding.delta?.property === property));
    }
  }
  for (const category of ['overflow', 'structure', 'fake-business', 'editability', 'behavior'] as const) {
    const observed = f.observed(), item = failure(observed, 'type', category, .1); item.issue!.property = 'font-size';
    assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), observed, current).delivery, 'pending', category);
  }
  const wrongUnit = f.observed(), item = failure(wrongUnit, 'type', 'presentation', .1); item.issue!.property = 'font-size'; item.issue!.unit = 'em';
  assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), wrongUnit, current).delivery, 'pending');
  const critical = f.observed(), serious = failure(critical, 'type', 'presentation', .1); serious.issue!.property = 'font-size'; serious.issue!.severity = 'critical';
  assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), critical, current).delivery, 'pending');
  const unverified = f.observed(); unverified.checks.find(item => item.requirementId === 'type')!.outcome = 'unverified';
  assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), unverified, current).qualityFloor.status, 'unverified');
});

test('unmeasured quality prevents delivery while optional decoration remains visibly unverified', () => {
  const f = fixture(), decoration = f.observed(); decoration.checks = decoration.checks.filter(item => item.requirementId !== 'decoration');
  const open = evaluateNative44Acceptance(f.contract, f.policy(), decoration, current); assert.equal(open.delivery, 'delivered-with-open-items'); assert.equal(open.requirementsComplete, false); assert.ok(open.findings.some(item => item.requirementId === 'decoration' && item.category === 'unverified'));
  for (const id of ['body', 'editor', 'product-truth', 'carousel', 'type']) {
    const observed = f.observed(); observed.checks = observed.checks.filter(item => item.requirementId !== id);
    assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), observed, current).qualityFloor.status, 'unverified', id);
  }
});

test('missing modules, fake query capability and unavailable native carousel still block drafting', () => {
  for (const id of ['body', 'editor', 'product-truth', 'carousel', 'accordion']) {
    const f = fixture(), requirement = f.contract.requirements.find(item => item.id === id)!; requirement.fulfillment = { route: 'gap', gapId: `${id}-missing`, reason: 'The required native source responsibility cannot currently be represented.' };
    const result = evaluateNative44Acceptance(f.contract, f.policy(), undefined, current); assert.equal(result.draftReady, false, id); assert.equal(result.delivery, 'pending');
  }
});

test('actual product failures and exact-owned native interactions remain hard; integration failures stay named open work', () => {
  const f = fixture(), base = evaluateNative44Acceptance(f.contract, f.policy(), f.observed(), current);
  const integration = applyNative44ActualCheckResults(f.contract, f.policy(), base, [{ kind: 'interaction', componentKey: 'search', viewport: 'desktop-wide', status: 'missing', problems: ['Search integration not connected.'], evidence: [ref] }]);
  assert.equal(integration.delivery, 'delivered-with-open-items'); assert.equal(integration.qualityFloor.status, 'passed');
  for (const check of [{ kind: 'product-query', componentKey: 'products' }, { kind: 'interaction', componentKey: 'carousel' }, { kind: 'interaction', componentKey: 'accordion' }, { kind: 'interaction', componentKey: 'unknown-owner' }] as const) {
    const result = applyNative44ActualCheckResults(f.contract, f.policy(), base, [{ ...check, viewport: 'desktop-wide', status: 'failed', problems: ['Actual native check failed.'], evidence: [ref] }]); assert.equal(result.delivery, 'pending'); assert.equal(result.requirementsComplete, false);
  }
});

test('a proven native playback toggle that stops working is not reclassified as an unconnected optional control', () => {
  const f = fixture(), pause = f.contract.requirements.find(item => item.id === 'pause')!; pause.fulfillment = { route: 'verified-native', componentKeys: ['pause'], capability: 'carousel-playback-toggle', proof: ref };
  const observed = f.observed(); failure(observed, 'pause', 'behavior'); assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), observed, current).delivery, 'pending');
});

test('fully measured and connected reference requirements can be complete; no configured feature is left hidden as a gap', () => {
  const f = fixture();
  for (const requirement of f.contract.requirements) if (requirement.fulfillment.route === 'gap') requirement.fulfillment = { route: 'verified-native', componentKeys: [requirement.id], capability: requirement.capability, proof: ref };
  const result = evaluateNative44Acceptance(f.contract, f.policy(), f.observed(), current); assert.equal(result.requirementsComplete, true); assert.equal(result.delivery, 'delivered'); assert.equal(result.findings.length, 0);
});

test('revision count never excuses a failed native or quality responsibility', () => {
  const f = fixture(), observed = f.observed(); failure(observed, 'carousel', 'behavior');
  const history = Array.from({ length: 8 }, (_, index) => ({ documentHash: String(index).repeat(64), blockingIssueIds: ['carousel'], weightedError: 10 }));
  assert.equal(adviseNative44Convergence(history).recommendation, 'revisit-model'); assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), observed, current).delivery, 'pending');
});

test('new marker v2 enforces goal opt-in before knowledge/authentication and marker v1 remains unchanged', async () => {
  const marker = { version: 2, kind: 'native44-requirement-profile', profile: 'source-requirements-v1', goalProfile: NATIVE44_COMPONENT_REFERENCE_GOAL };
  assert.equal(Native44RequirementProfileSchema.parse(marker).version, 2); assert.deepEqual(Native44RequirementProfileSchema.parse({ version: 1, kind: 'native44-requirement-profile', profile: 'source-requirements-v1' }), { version: 1, kind: 'native44-requirement-profile', profile: 'source-requirements-v1' });
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-goal-preauth-'));
  try {
    const job = path.join(root, 'references', 'goal-task'); await mkdir(job, { recursive: true }); await writeFile(path.join(job, 'requirement-profile.json'), JSON.stringify(marker));
    const program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'goal-task', title: 'New reference goal', sourceUrl: 'https://source.example/', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, requirementProfile: 'source-requirements-v1', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: ref.sha256 }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' }, { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' }], blocks: [{ kind: 'composite', key: 'root', children: [{ kind: 'native', key: 'title', widgetType: 'heading', widgetSettings: {} }] }] };
    await writeFile(path.join(job, 'program.json'), JSON.stringify(program)); await assert.rejects(prepareLocalTask(path.join(job, 'program.json'), root), /native44_goal_profile_required/);
    assert.equal(validateNative44Program({ ...program, goalProfile: NATIVE44_COMPONENT_REFERENCE_GOAL }).goalProfile, NATIVE44_COMPONENT_REFERENCE_GOAL);
  } finally { await rm(root, { recursive: true, force: true }); }
});

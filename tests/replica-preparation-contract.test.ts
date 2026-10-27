import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { buildPreparationJobs, preparationHash, preparationSharedHash, validatePreparationJobResult, validatePreparationPlan } from '../src/replica-preparation/contract.js';
import { BODY_FIDELITY_KINDS, PREPARATION_COMPATIBILITY_KEYS, PREPARATION_DECISION_KEYS, type PreparationPlan } from '../src/replica-preparation/types.js';

const ref = (name: string) => ({ path: name, sha256: 'a'.repeat(64) });
function fixture(): PreparationPlan {
  const sourceUrl = 'https://source.example/', targetOrigin = 'https://target.example';
  return { version: 1, kind: 'clonewp-replica-preparation', taskId: 'task', runId: 'run', title: 'Store', slug: 'store', sourceUrl, targetOrigin, sourceEvidence: ref('evidence.json'), sourceFacts: ref('facts.json'), sourceUnits: ref('units.json'), headerAssets: ref('header-assets.json'), bodyAssets: ref('assets.json'),
    bodyBase: { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'task', title: 'Store', sourceUrl, replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, editorNaming: 'native-translated-v1', reviewWorkflow: 'whole-page-after-css-v1', goalProfile: 'component-reference-v1', requirementProfile: 'source-requirements-v1', articleListPolicy: 'target-posts-v1', componentCatalog: { ...ref('catalog.json'), sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref('knowledge.json'), fingerprint: 'a'.repeat(64) }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: ref('facts.json'), componentPlan: ref('pending-plan.json'), assetsManifest: ref('assets.json'), viewports: native44ProfileViewports('desktop-browser-v1') },
    headerBase: { version: 1, kind: 'clonewp-header-module', moduleKey: 'store', targetOrigin, owner: { ownerId: 'clonewp', runId: 'run' }, name: 'Store header', menus: [{ key: 'main', name: 'Store menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: ':header{color:#123}', fonts: [] } },
    sourcePartition: { allUnits: ['header', 'hero', 'faq', 'news'], headerUnits: ['header'], bodyUnits: ['hero', 'faq', 'news'] }, shared: { decisions: PREPARATION_DECISION_KEYS.map(key => ({ key, value: key === 'content-width' ? 1660 : 'source-derived', evidence: [ref('source.png')] })), compatibility: PREPARATION_COMPATIBILITY_KEYS.map(key => ({ key, status: 'verified', reason: 'Current source and native contract checked.', evidence: [ref('contract.json')] })), css: ':page{font-family:Nunito}' },
    sections: [{ key: 'hero', sourceUnitIds: ['hero'], sourceFactIds: ['fact-hero'], family: 'content', dependsOn: [], estimatedEffort: 10 }, { key: 'faq', sourceUnitIds: ['faq'], sourceFactIds: ['fact-faq'], family: 'interaction', dependsOn: [], estimatedEffort: 8 }, { key: 'news', sourceUnitIds: ['news'], sourceFactIds: ['fact-news'], family: 'content', dependsOn: [], estimatedEffort: 2 }],
  };
}

function v5Fixture(): PreparationPlan {
  const input = fixture(); input.version = 5; input.bodyBase.visualAuditVersion = 3;
  const viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
  input.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports, source: ref('phones.json'), decisions: { version: 1, layouts: [], carousels: [], header: { implementation: 'native', flow: 'reserve-space', views: viewports.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'fixed' as const, offset: 0 })) } } };
  input.sections.forEach(section => { section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: kind === 'text-layout' ? 'required' : 'not-applicable', sourceFactIds: [...section.sourceFactIds], expected: `Source ${kind} has been inspected for ${section.key}.`, evidence: [ref('source.png')] })); });
  return input;
}

test('new preparation freezes six body fidelity decisions before dispatch without migrating old plans', () => {
  const plan = v5Fixture(); assert.equal(validatePreparationPlan(plan).version, 5);
  assert.notEqual(preparationHash(plan), preparationHash({ ...plan, sections: plan.sections.map(section => ({ ...section, fidelity: section.fidelity?.map(check => ({ ...check, expected: check.expected + ' More detail.' })) })) }));
  const missing = v5Fixture(); delete missing.sections[0].fidelity; assert.throws(() => buildPreparationJobs(missing), /body_fidelity_incomplete/);
  const duplicate = v5Fixture(); duplicate.sections[0].fidelity![1].kind = duplicate.sections[0].fidelity![0].kind; assert.throws(() => validatePreparationPlan(duplicate), /body_fidelity_incomplete/);
  const foreign = v5Fixture(); foreign.sections[0].fidelity![0].sourceFactIds = ['fact-faq']; assert.throws(() => validatePreparationPlan(foreign), /body_fidelity_fact_scope/);
  const old = fixture(); assert.equal(validatePreparationPlan(old).version, 1);
});

test('new visual preparation requires measurable section targets without changing frozen v5 plans', () => {
  const old = v5Fixture(); assert.equal(validatePreparationPlan(old).version, 5);
  const next = v5Fixture(); next.version = 6;
  assert.throws(() => validatePreparationPlan(next), /body_visual_targets_incomplete/);
  next.sections.forEach(section => { section.visualTargets = [
    { kind: 'geometry', sourceFactId: section.sourceFactIds[0], rect: { x: 0, y: 0, width: 100, height: 100 }, evidence: ref('source.png') },
    { kind: 'paint', sourceFactId: section.sourceFactIds[0], property: 'background-color', value: 'transparent', evidence: ref('source.png') },
  ]; });
  assert.equal(validatePreparationPlan(next).version, 6);
  next.sections[0].visualTargets![0] = { kind: 'geometry', sourceFactId: 'fact-faq', rect: { x: 0, y: 0, width: 100, height: 100 }, evidence: ref('source.png') };
  assert.throws(() => validatePreparationPlan(next), /body_visual_target_fact_scope/);
});

test('preparation freezes shared evidence and assigns actual independent header/body responsibilities', () => {
  const plan = validatePreparationPlan(fixture()), jobs = buildPreparationJobs(plan);
  assert.equal(jobs.length, 3); assert.equal(jobs[0].responsibility, 'header'); assert.deepEqual(jobs[0].sourceUnitIds, ['header']);
  assert.deepEqual(jobs.slice(1).map(job => job.estimatedEffort), [10, 10]);
  assert.deepEqual(jobs.slice(1).flatMap(job => job.sectionKeys).sort(), ['faq', 'hero', 'news']);
  assert.ok(jobs.every(job => job.contractHash === preparationHash(plan) && job.sharedHash === preparationSharedHash(plan)));
  assert.equal('blocks' in plan.bodyBase, false);
});
test('dependency-connected sections stay together even when that prevents equal load', () => {
  const input = fixture(); input.sections[1].dependsOn = ['hero'];
  const jobs = buildPreparationJobs(input);
  assert.deepEqual(jobs[1].sectionKeys, ['hero', 'faq']); assert.deepEqual(jobs[2].sectionKeys, ['news']);
  input.sections[2].dependsOn = ['faq']; assert.equal(buildPreparationJobs(input).length, 2);
});
test('dependency graph cycles form one indivisible responsibility rather than losing sections', () => {
  const input = fixture(); input.sections[0].dependsOn = ['faq']; input.sections[1].dependsOn = ['hero'];
  const jobs = buildPreparationJobs(input); assert.deepEqual(jobs[1].sectionKeys, ['hero', 'faq']); assert.deepEqual(jobs[2].sectionKeys, ['news']);
});
for (const key of PREPARATION_COMPATIBILITY_KEYS) test(`unresolved ${key} blocks dispatch before any remote capability`, () => {
  const input = fixture(); input.shared.compatibility.find(row => row.key === key)!.status = 'unresolved';
  assert.throws(() => buildPreparationJobs(input), /replica_preparation_compatibility_unresolved/);
});
test('high-impact rules need source evidence and complete fixed compatibility coverage', () => {
  const input = fixture(); input.shared.decisions[0].evidence = []; assert.throws(() => validatePreparationPlan(input), /replica_preparation_plan_invalid/);
  const missing = fixture(); missing.shared.decisions.pop(); assert.throws(() => validatePreparationPlan(missing), /decisions_incomplete/);
  const duplicate = fixture(); duplicate.shared.compatibility[1] = duplicate.shared.compatibility[0]; assert.throws(() => validatePreparationPlan(duplicate), /compatibility_duplicate/);
});
for (const key of ['goalProfile', 'requirementProfile', 'articleListPolicy'] as const) test(`new preparation cannot omit the current ${key} policy`, () => {
  const input = fixture(); delete input.bodyBase[key];
  assert.throws(() => buildPreparationJobs(input), /replica_preparation_quality_policy/);
});
test('header/body partition and each fact/unit owner must be exact and unique', () => {
  const overlap = fixture(); overlap.sourcePartition.bodyUnits.push('header'); assert.throws(() => validatePreparationPlan(overlap), /unit_partition/);
  const missing = fixture(); missing.sections.pop(); assert.throws(() => validatePreparationPlan(missing), /section_partition/);
  const facts = fixture(); facts.sections[1].sourceFactIds = ['fact-hero']; assert.throws(() => validatePreparationPlan(facts), /section_fact_duplicate/);
  const units = fixture(); units.sections[1].sourceUnitIds = ['hero']; assert.throws(() => validatePreparationPlan(units), /section_unit_duplicate/);
});
test('unknown/self dependencies and task seed drift fail safely', () => {
  const input = fixture(); input.sections[0].dependsOn = ['unknown']; assert.throws(() => validatePreparationPlan(input), /dependency_unknown/);
  input.sections[0].dependsOn = ['hero']; assert.throws(() => validatePreparationPlan(input), /dependency_unknown/);
  const other = fixture(); other.bodyBase.taskId = 'other'; assert.throws(() => validatePreparationPlan(other), /identity/);
  const existing = fixture() as unknown as Record<string, unknown>; (existing.bodyBase as Record<string, unknown>).blocks = []; assert.throws(() => validatePreparationPlan(existing), /plan_invalid/);
});
test('worker identities are stable across property order but change with frozen evidence/decisions', () => {
  const a = fixture(), b = Object.fromEntries(Object.entries(structuredClone(a)).reverse()) as unknown as PreparationPlan;
  assert.deepEqual(buildPreparationJobs(a), buildPreparationJobs(b));
  b.shared.decisions[0].value = 'different-font'; assert.notEqual(preparationSharedHash(a), preparationSharedHash(b));
});
test('result envelope prevents header/body workers exchanging write responsibilities', () => {
  const plan = fixture(), identity = { version: 1, kind: 'clonewp-preparation-result', taskId: 'task', runId: 'run', contractHash: preparationHash(validatePreparationPlan(plan)), sharedHash: preparationSharedHash(plan) };
  assert.throws(() => validatePreparationJobResult({ ...identity, jobId: 'body-1', header: plan.headerBase }), /result_responsibility/);
  assert.throws(() => validatePreparationJobResult({ ...identity, jobId: 'header', header: plan.headerBase, sections: [] }), /result_invalid/);
  assert.equal(validatePreparationJobResult({ ...identity, jobId: 'header', header: plan.headerBase }).header?.name, 'Store header');
});
test('canonical preparation identity rejects accessors/cycles/non-JSON rather than executing or dropping them', () => {
  let invoked = false; const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => preparationHash(accessor), /json_invalid/); assert.equal(invoked, false);
  const cycle: unknown[] = []; cycle.push(cycle); assert.throws(() => preparationHash(cycle), /json_invalid/);
  assert.throws(() => preparationHash({ value: undefined }), /json_invalid/);
  assert.throws(() => preparationHash({ value: Infinity }), /json_invalid/);
});
test('optional typed navigation forms bind one section and participate in frozen shared identity', () => {
  const input = fixture(); input.sourceUrl = input.bodyBase.sourceUrl = 'https://hoshiichi.com/';
  input.navigationForms = [{ key: 'filter', slotComponentKey: 'hero_search', sourceUnitIds: ['hero'], sourceFactIds: ['fact-hero'], sourceEvidence: ref('form-source.json'), method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }] }], submitLabel: '検索' }];
  const plan = validatePreparationPlan(input), initial = preparationSharedHash(plan); assert.equal(plan.navigationForms?.[0].slotComponentKey, 'hero_search');
  input.navigationForms[0].fields[0].options.push({ label: 'スキンケア', value: 'app_skincare' }); assert.notEqual(preparationSharedHash(input), initial);
  input.navigationForms[0].sourceUnitIds = ['header']; assert.throws(() => validatePreparationPlan(input), /navigation_form_scope/);
});

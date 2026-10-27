import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import type { ObservationPacketV2, ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import { TRANSIENT_PRIVATE_LINK_OMISSION_RULE, validateComponentPlanV2, type ComponentPlanV2 } from '../src/replica-v2/component-plan.js';
import { createNative44RequirementContract, validateNative44Requirements } from '../src/native44/requirements.js';
import type { Native44SourceUnit } from '../src/native44/selection-types.js';
import { NATIVE44_SELECTION_RULES_HASH, native44SelectionHash } from '../src/native44/selection.js';

const ref = { path: 'D:/cloneWP/.cache/private-gap-fixture/packet.json', sha256: 'a'.repeat(64) };
const sourceRef = { path: 'D:/cloneWP/.cache/private-gap-fixture/source-facts.json', sha256: 'b'.repeat(64) };
const privateFactId = (snapshotId = 'wide') => `${snapshotId}:interaction:account`;
function packet(snapshotId: string): ObservationPacketV2 {
  const narrow = snapshotId === 'narrow', width = narrow ? 1440 : 1920, height = narrow ? 1000 : 1080;
  const nodes: ObservationPacketV2['nodes'] = {}, layouts: ObservationPacketV2['layouts'] = {};
  for (const [id, tag, parentId, childIds] of [['header', 'header', null, ['account', 'public']], ['account', 'a', 'header', []], ['public', 'a', 'header', []]] as const) {
    nodes[id] = { id, tag, parentId, childIds: [...childIds], regionId: 'header-region', selector: `#${id}`, attributes: {}, styleId: id === 'account' ? 'hidden' : 'normal', layoutId: id, visible: id !== 'account' };
    layouts[id] = { id, rect: { x: 0, y: 0, width: id === 'account' ? 0 : 200, height: id === 'account' ? 0 : 40 }, contentRect: { x: 0, y: 0, width: id === 'account' ? 0 : 200, height: id === 'account' ? 0 : 40 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: id === 'account' ? 'none' : 'block', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: 0 };
  }
  return {
    version: 2, kind: 'observation-packet',
    snapshot: { id: snapshotId, url: 'https://source.example/', title: 'Observed header with a private destination safely omitted', capturedAt: '2026-10-17T00:00:00.000Z', viewport: { name: narrow ? 'desktop-narrow' : 'desktop', width, height, clientWidth: width - 15, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: height, screenshot: { path: `${snapshotId}.png`, sha256: ref.sha256, width, height } },
    nodes, regions: [{ id: 'header-region', nodeId: 'header', contentNodeId: 'header', role: 'header', order: 0, gapBefore: 0 }], texts: {}, styles: { normal: { display: 'block' }, hidden: { display: 'none' } }, layouts, resources: {}, usages: {},
    interactions: {
      account: { id: 'account', nodeId: 'account', regionId: 'header-region', kind: 'link', status: 'unobserved', details: { privateHrefOmitted: true, behaviorVerified: false } },
      public: { id: 'public', nodeId: 'public', regionId: 'header-region', kind: 'link', status: 'declared', href: 'https://source.example/pages/contact', details: { behaviorVerified: false } },
    },
    gaps: [{ code: 'transient-private-link-omitted', nodeId: 'account', message: 'Private transient destination intentionally omitted under the user privacy rule.' }],
  };
}
function fixture() {
  const packets = [packet('wide'), packet('narrow')];
  const observation: ValidatedObservationV2 = { manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'https://source.example/', provenance: { method: 'user-opened-browser', browser: 'chrome', observer: 'cua_repl' }, packets: [], screenshots: [] }, manifestPath: ref.path, manifestSha256: ref.sha256, packets, packetFiles: packets.map(value => ({ path: `${value.snapshot.id}.json`, sha256: ref.sha256, snapshotId: value.snapshot.id })) };
  const source = buildSourceFactsV2(observation);
  const units: Native44SourceUnit[] = source.snapshots.map(snapshot => {
    const factIds = Object.values(source.facts).filter(fact => fact.snapshotId === snapshot.id).map(fact => fact.id);
    return { id: `${snapshot.id}-header`, snapshotId: snapshot.id, ownerNodeId: 'header', regionId: 'header-region', role: 'layout', sourceFactIds: factIds, evidence: { factIds, screenshots: [{ snapshotId: snapshot.id, screenshot: ref }], rationale: 'Actual header ownership retains every captured source responsibility.' }, slots: [] };
  });
  const plan: ComponentPlanV2 = {
    version: 2, kind: 'component-plan', sourceFacts: sourceRef, desktopSnapshotId: 'wide', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH,
    sourceUnits: units,
    selectionDecisions: units.map(unit => ({ unitId: unit.id, componentKeys: ['header'], candidates: [{ widgetTypes: ['container'], conclusion: 'selected', reason: 'A native header container owns the observed source header structure.', evidence: [ref] }], reason: 'Retain complete source ownership and independently verify target behavior.', slotBindings: [], contractRefs: [{ widgetType: 'container', scope: 'local-source', schemaSha256: ref.sha256, evidence: ref }] })),
    selectionReview: { reviewer: 'codex', status: 'approved', reviewedAt: '2026-10-17T01:00:00.000Z', sourceFacts: sourceRef, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, decisionsSha256: ref.sha256, screenshots: source.snapshots.map(snapshot => ({ snapshotId: snapshot.id, screenshot: ref })), reviewedUnitIds: units.map(unit => unit.id), checks: { moduleOrder: true, contentOwnership: true, componentSuitability: true, editingGranularity: true }, judgment: 'Retain all source facts and the unknown private-link behavior for independent target review.' },
    requirementContract: createNative44RequirementContract(source, units, sourceRef, 'private-link-fixture', { goalProfile: 'component-reference-v1' }),
    components: [{ id: 'header', parentId: null, role: 'header', renderer: 'composite', editability: 'mixed', sourceRegionIds: ['header-region'], variants: source.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['header', 'account'], visible: true })) }],
    requirements: Object.values(source.facts).map((fact, index) => fact.kind === 'interaction' && fact.nodeId === 'account' ? { id: `requirement-${index}`, factIds: [fact.id], componentId: 'header', disposition: 'adapt', rule: TRANSIENT_PRIVATE_LINK_OMISSION_RULE, verification: { kind: 'interaction', selector: '.replica-header', snapshotId: fact.snapshotId, expected: { privateDestinationOmitted: true, destinationBehaviorVerified: false } } } : { id: `requirement-${index}`, factIds: [fact.id], componentId: 'header', disposition: 'preserve', rule: 'Retain observed source responsibility and actual node ownership.', verification: { kind: 'presence', selector: '.replica-header', snapshotId: fact.snapshotId } }),
  };
  plan.selectionReview!.decisionsSha256 = native44SelectionHash(plan.selectionDecisions);
  plan.gapResolutions = source.gaps.map(gap => ({ snapshotId: gap.snapshotId, code: gap.code, nodeId: gap.nodeId, componentId: 'header', rule: TRANSIENT_PRIVATE_LINK_OMISSION_RULE, requirementId: plan.requirements.find(requirement => requirement.factIds.includes(privateFactId(gap.snapshotId)))!.id }));
  return { source, plan };
}
const validate = (value: ReturnType<typeof fixture>) => validateComponentPlanV2(value.plan, value.source, { stage: 'final', replicationProfile: 'desktop-browser-v1' });

test('intentional private-link omission retains immutable source facts and independent unknown-control requirements', () => {
  const value = fixture(), before = JSON.stringify(value.source);
  const result = validate(value);
  assert.equal(JSON.stringify(value.source), before);
  assert.equal(Object.hasOwn(value.source.facts[privateFactId()].value, 'href'), false);
  const controls = result.requirementContract!.requirements.filter(requirement => requirement.capability === 'unknown-control');
  assert.equal(controls.length, 2);
  assert.ok(controls.every(requirement => requirement.fulfillment.route === 'gap'));
  assert.ok(controls.every(requirement => requirement.sourceKey.includes(':interaction:account:unknown-control')));
  const coverage = validateNative44Requirements(result.requirementContract, { source: value.source, sourceUnits: result.sourceUnits!, sourceFactsHash: sourceRef.sha256 }).coverage;
  assert.equal(coverage.ready, false);
});

test('private-link policy requires explicit desktop component-reference opt-in and honest omission expectations', () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { delete value.plan.requirementContract; },
    (value: ReturnType<typeof fixture>) => { delete value.plan.requirementContract!.goalProfile; },
    (value: ReturnType<typeof fixture>) => { delete value.plan.replicationProfile; delete value.plan.selectionRulesHash; delete value.plan.sourceUnits; delete value.plan.selectionDecisions; delete value.plan.selectionReview; delete value.plan.requirementContract; },
    (value: ReturnType<typeof fixture>) => { value.plan.gapResolutions![0].rule = 'A generic visual adaptation'; },
    (value: ReturnType<typeof fixture>) => { value.plan.requirements.find(requirement => requirement.factIds.includes(privateFactId()))!.rule = 'A generic visual adaptation'; },
    (value: ReturnType<typeof fixture>) => { value.plan.requirements.find(requirement => requirement.factIds.includes(privateFactId()))!.verification.kind = 'presence'; },
    ...[{ destinationBehaviorVerified: false }, { privateDestinationOmitted: false, destinationBehaviorVerified: false }, { privateDestinationOmitted: true }, { privateDestinationOmitted: true, destinationBehaviorVerified: true }].map(expected => (value: ReturnType<typeof fixture>) => { value.plan.requirements.find(requirement => requirement.factIds.includes(privateFactId()))!.verification.expected = expected; }),
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => validate(value), /privacy rule|explicitly selected execution path/);
  }
});

test('private omission requires actual same-node redaction evidence and exact same-snapshot component binding', () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { delete (value.source.facts[privateFactId()].value.details as Record<string, unknown>).privateHrefOmitted; },
    (value: ReturnType<typeof fixture>) => { (value.source.facts[privateFactId()].value.details as Record<string, unknown>).privateHrefOmitted = false; },
    (value: ReturnType<typeof fixture>) => { value.source.facts[privateFactId()].value.href = 'https://source.example/pages/account'; },
    (value: ReturnType<typeof fixture>) => { value.source.facts[privateFactId()].value.href = ''; },
    (value: ReturnType<typeof fixture>) => { value.source.facts[privateFactId()].value.kind = 'navigation'; },
    (value: ReturnType<typeof fixture>) => { value.plan.components[0].variants.find(variant => variant.snapshotId === 'wide')!.nodeIds = ['header']; },
    (value: ReturnType<typeof fixture>) => { value.plan.components[0].variants.find(variant => variant.snapshotId === 'narrow')!.nodeIds = ['header']; value.plan.components[0].sourceNodeIds = ['account']; },
    (value: ReturnType<typeof fixture>) => { value.source.gaps[0].nodeId = 'public'; value.plan.gapResolutions![0].nodeId = 'public'; },
    (value: ReturnType<typeof fixture>) => { value.plan.gapResolutions![0].requirementId = value.plan.requirements.find(requirement => requirement.factIds.includes(privateFactId('narrow')))!.id; },
  ]) {
    const value = fixture(); mutate(value);
    value.plan.requirementContract = createNative44RequirementContract(value.source, value.plan.sourceUnits!, sourceRef, 'private-link-fixture', { goalProfile: 'component-reference-v1' });
    assert.throws(() => validate(value), /privacy rule|different viewport/);
  }
  const desktopBinding = fixture(); desktopBinding.plan.components[0].variants.find(variant => variant.snapshotId === 'wide')!.nodeIds = ['header']; desktopBinding.plan.components[0].sourceNodeIds = ['account'];
  assert.doesNotThrow(() => validate(desktopBinding));
});

test('privacy omission cannot waive capture failures or fulfill the unknown control as a working link', () => {
  for (const code of ['capture-failure', 'truncation', 'unsafe-url', 'unknown-owner', 'transient-private-link-unobserved']) {
    const value = fixture(); value.source.gaps[0].code = code; value.plan.gapResolutions![0].code = code;
    assert.throws(() => validate(value), /cannot be adapted/);
  }
  const omitted = fixture(); omitted.plan.requirementContract!.requirements = omitted.plan.requirementContract!.requirements.filter(requirement => requirement.capability !== 'unknown-control');
  assert.throws(() => validate(omitted), /Source requirements missing/);
  const falseProof = fixture(), control = falseProof.plan.requirementContract!.requirements.find(requirement => requirement.capability === 'unknown-control')!;
  control.fulfillment = { route: 'verified-native', capability: 'unknown-control', componentKeys: ['header'], proof: ref };
  assert.throws(() => validate(falseProof), /Capability substitution/);
});

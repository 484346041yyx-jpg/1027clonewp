import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePresentationFacts, sourcePresentation } from '../src/replica-preparation/presentation.js';
import { createProductionGuide } from '../src/replica-preparation/production-guide.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { PreparationSection } from '../src/replica-preparation/types.js';
import { diagnosePresentationAssignments } from '../src/replica-preparation/build-diagnostics.js';
import type { Native44Program } from '../src/native44/types.js';

function fixture(width = 1920) {
  const rect = { x: 100, y: 100, width: 600, height: 80 };
  const source = { version: 2, gaps: [], snapshots: [{ id: 'view', viewport: { name: width < 768 ? 'mobile' : 'desktop', width, height: 1000, clientWidth: width - 15, devicePixelRatio: 1 }, screenshot: { path: 'source.png' }, nodes: { root: { tag: 'section', parentId: null, childIds: ['copy', 'tab'] }, copy: { tag: 'p', parentId: 'root', childIds: [] }, tab: { tag: 'button', parentId: 'root', childIds: [], attributes: { 'aria-selected': 'true', 'aria-controls': 'panel' } } } }], facts: {
    root: { id: 'root', snapshotId: 'view', nodeId: 'root', kind: 'layout', value: { rect: { x: 80, y: 50, width: 900, height: 500 }, contentRect: { x: 100, y: 90, width: 860, height: 420 }, padding: [40, 20, 40, 20], margin: [0, 0, 0, 0], gap: { row: 12, column: 20 } } },
    text: { id: 'text', snapshotId: 'view', nodeId: 'copy', kind: 'text', value: { text: 'Alpha beta gamma delta', visible: true, lineCount: 2, textLayout: { status: 'measured', scope: 'direct-text-nodes', fontStatus: 'loaded', hardBreaks: false, lines: [{ text: 'Alpha beta' }, { text: 'gamma delta' }] }, style: { 'font-family': 'Arial', 'font-size': '17px', 'word-spacing': '1px', 'overflow-wrap': 'normal' }, layout: { rect, padding: [0, 0, 0, 0], margin: [0, 0, 10, 0] } } },
    tab: { id: 'tab', snapshotId: 'view', nodeId: 'tab', kind: 'interaction', value: { kind: 'control', details: { type: 'tab' }, itemNodeIds: ['panel'] } },
  } } as unknown as SourceFactsV2;
  return source;
}
const binding = { sourceFactId: 'text', targetFactId: 'text', sourceState: 'default', targetState: 'default', sourceAnchorFactId: 'root', targetAnchorFactId: 'root' };

test('all four widths carry spacing responsibility, exact line words and real native owners without changing input', () => {
  for (const width of [1920, 1440, 390, 430]) {
    const source = fixture(width), original = JSON.stringify(source);
    const guide = createProductionGuide(source, [{ key: 'intro', sourceFactIds: ['root', 'text', 'tab'] }] as PreparationSection[], [{ kind: 'composite', key: 'intro', children: [{ kind: 'native', key: 'copy', widgetType: 'text-editor', widgetSettings: { _margin: { top: '0', bottom: '10' } }, sourceFactIds: ['text'] }] }]);
    const row = guide.sections[0].viewports[0].requirements.find(row => row.sourceFactId === 'text')!;
    assert.equal(guide.version, 3);
    assert.equal(row.presentation.spacing.parentContentOffsets?.top, 10);
    assert.deepEqual(row.presentation.text?.lines.map((line: any) => line.text), ['Alpha beta', 'gamma delta']);
    assert.equal(row.presentation.properties.typography['word-spacing'], '1px');
    assert.equal(row.presentation.owners[0].componentKey, 'copy');
    assert.equal(JSON.stringify(source), original);
  }
});

test('investigation candidates separate persistent selection and hover without claiming live behavior', () => {
  const source = fixture(), plan = sourcePresentation(source, source.facts.tab, []);
  assert.ok(plan.statePlan?.statesToInvestigate.includes('selected'));
  assert.ok(plan.statePlan?.statesToInvestigate.includes('hover'));
  assert.ok(plan.statePlan?.statesToInvestigate.includes('focus'));
  assert.equal(plan.statePlan?.behaviorVerified, false);
  assert.deepEqual(plan.statePlan?.controlledNodeIds, ['panel']);
  for (const [type, state] of [['combobox', 'option-selected'], ['disclosure', 'collapsed'], ['email', 'invalid'], ['checkbox', 'unchecked'], ['counter', 'settled']]) {
    source.facts.tab.value.details = { type };
    assert.ok(sourcePresentation(source, source.facts.tab, []).statePlan?.statesToInvestigate.includes(state));
  }
});

test('same number of lines but different breaking words is a difference, not a wrap pass', () => {
  const source = fixture(), target = structuredClone(source);
  (target.facts.text.value.textLayout as any).lines = [{ text: 'Alpha beta gamma' }, { text: 'delta' }];
  const report = comparePresentationFacts(source, target, ['text'], [binding]);
  assert.ok(report.findings.some(row => row.field === 'line-words'));
  assert.equal(report.deliveryComplete, false);
  assert.equal(report.interactionsVerified, false);
});

test('logical owner positions ignore page/header displacement but expose internal inset drift', () => {
  const source = fixture(), target = structuredClone(source);
  (target.facts.root.value.rect as any).y += 500;
  (target.facts.text.value.layout as any).rect.y += 500;
  assert.equal(comparePresentationFacts(source, target, ['text'], [binding]).findings.length, 0);
  (target.facts.text.value.layout as any).rect.y += 20;
  assert.ok(comparePresentationFacts(source, target, ['text'], [binding]).findings.some(row => row.field === 'owner-offset-y'));
});

test('wrong actual width, state, missing line/font proof and missing bindings stay unverified', () => {
  const source = fixture(), target = structuredClone(source);
  target.snapshots[0].viewport.clientWidth -= 1;
  assert.equal(comparePresentationFacts(source, target, ['text'], [binding]).findings[0].code, 'incomparable');
  assert.equal(comparePresentationFacts(source, source, ['text'], [{ ...binding, targetState: 'hover' }]).findings[0].code, 'incomparable');
  delete target.facts.text.value.textLayout;
  target.snapshots[0].viewport.clientWidth += 1;
  assert.ok(comparePresentationFacts(source, target, ['text'], [binding]).findings.some(row => row.code === 'unverified'));
  assert.equal(comparePresentationFacts(source, target, ['text'], []).findings[0].field, 'unmapped-target');
  assert.throws(() => comparePresentationFacts(source, target, ['text'], [binding, binding]), /presentation_binding/);
  assert.throws(() => comparePresentationFacts(source, target, ['text'], [{ ...binding, targetAnchorFactId: 'tab' }]), /presentation_anchor/);
});

test('font, crop, color, spacing and default-state differences are proactively reported', () => {
  const source = fixture(), target = structuredClone(source);
  Object.assign(source.facts.text.value.style as object, { 'object-fit': 'cover', 'background-color': 'gold' });
  Object.assign(target.facts.text.value.style as object, { 'font-family': 'Other', 'object-fit': 'contain', 'background-color': 'green' });
  (target.facts.text.value.layout as any).margin[2] = 30;
  const fields = comparePresentationFacts(source, target, ['text'], [binding]).findings.map(row => row.field);
  for (const field of ['font-family', 'object-fit', 'background-color', 'margin']) assert.ok(fields.includes(field));
  target.snapshots[0].nodes.tab.attributes!['aria-selected'] = 'false';
  assert.ok(comparePresentationFacts(source, target, ['tab'], [{ ...binding, sourceFactId: 'tab', targetFactId: 'tab' }]).findings.some(row => row.field === 'aria-selected'));
});

test('authoring flags native spacing conflicts and unobserved states on desktop and phone without a new completion gate', () => {
  for (const width of [1920, 390, 430]) {
    const source = fixture(width);
    delete source.facts.text.value.textLayout;
    const original = JSON.stringify(source);
    const program = { blocks: [{ key: 'intro', kind: 'composite', sourceFactIds: ['root'], settings: { padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0' }, padding_mobile: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20' } }, children: [{ key: 'text', kind: 'native', widgetType: 'text-editor', widgetSettings: {}, sourceFactIds: ['text'] }] }] } as unknown as Native44Program;
    const issues = diagnosePresentationAssignments(source, [{ key: 'intro', sourceFactIds: ['root', 'text', 'tab'] }] as PreparationSection[], program, { mobileSnapshotIds: width < 768 ? ['view'] : [] });
    assert.equal(issues.some(row => row.code === 'presentation-native-spacing-differs'), width >= 768);
    assert.ok(issues.some(row => row.code === 'presentation-text-measurement-unavailable'));
    assert.ok(issues.some(row => row.code === 'presentation-state-cycle-unverified'));
    assert.equal(JSON.stringify(source), original);
  }
});

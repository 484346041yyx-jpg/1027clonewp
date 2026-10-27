import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectionRelationships, measureRelationships } from '../src/replica-preparation/section-relationships.js';
import { createProductionGuide } from '../src/replica-preparation/production-guide.js';
import { diagnoseSectionRelationships } from '../src/replica-preparation/build-diagnostics.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { Native44Component, Native44Program } from '../src/native44/types.js';
import type { PreparationSection } from '../src/replica-preparation/types.js';

function fixture() {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const facts: SourceFactsV2['facts'] = {};
  const snapshots = ['desktop', 'desktop-narrow', 'mobile'].map((snapshotId, index) => {
    const nodes = Object.fromEntries([
      ['section', null, ['image', 'copy']], ['image', 'section', []], ['copy', 'section', ['title', 'questions']],
      ['title', 'copy', []], ['questions', 'copy', ['question', 'answer']], ['question', 'questions', []], ['answer', 'questions', []],
    ].map(([nodeId, parentId, childIds]) => [nodeId as string, { parentId, childIds, selector: `.${nodeId}`, tag: 'div', regionId: 'feature' }]));
    const add = (nodeId: string, kind: string, value: Record<string, unknown>) => {
      const id = `${snapshotId}:${kind}:${nodeId}`;
      facts[id] = { id, nodeId, kind, snapshotId, regionId: 'feature', evidence: { path: `${snapshotId}.json`, sha256: 'a'.repeat(64) }, value } as SourceFactsV2['facts'][string];
    };
    add('section', 'layout', { purpose: 'outer', rect: rect(0, 0, 840, 600) });
    add('image', 'media', { visible: true, layout: { rect: rect(0, 0, 400, 600) }, kind: 'img' });
    add('title', 'text', { visible: true, text: 'Section title', layout: { rect: rect(index === 2 ? 0 : 440, index === 2 ? 640 : 100, 400, 50) } });
    add('question', 'text', { visible: true, text: 'A question', layout: { rect: rect(index === 2 ? 0 : 440, index === 2 ? 700 : 160, 400, 340) } });
    add('answer', 'text', { visible: false, text: 'Full hidden answer', layout: { rect: rect(0, 0, 0, 0) } });
    add('questions', 'interaction', { kind: 'control', status: 'observed', details: { type: 'accordion' }, itemNodeIds: ['question', 'answer'], controlNodeIds: ['question'] });
    return { id: snapshotId, nodes, viewport: { name: snapshotId }, screenshot: { path: `${snapshotId}.png` } };
  });
  const source = { snapshots, facts, gaps: [] } as unknown as SourceFactsV2;
  const section = { key: 'feature', sourceFactIds: Object.keys(facts) } as PreparationSection;
  const factIds = (nodeId: string) => Object.values(facts).filter(fact => fact.nodeId === nodeId).map(fact => fact.id);
  const blocks: Native44Component[] = [{ kind: 'composite', key: 'feature', settings: { flex_direction: 'row', align_items: 'center' }, children: [
    { kind: 'native', key: 'feature_image', widgetType: 'wd_image_or_svg', widgetSettings: {}, sourceFactIds: factIds('image') },
    { kind: 'composite', key: 'feature_copy', settings: { flex_direction: 'column' }, children: [
      { kind: 'native', key: 'feature_title', widgetType: 'heading', widgetSettings: {}, sourceFactIds: factIds('title') },
      { kind: 'native', key: 'feature_questions', widgetType: 'nested-accordion', widgetSettings: {}, sourceFactIds: [...factIds('question'), ...factIds('answer')] },
    ] },
  ] }];
  return { source, section, blocks };
}

test('derives section, nested content groups and measured alignment before selecting widgets', () => {
  const { source, section } = fixture();
  const original = JSON.stringify(source);
  const result = createSectionRelationships(source, section);
  const wide = result.viewports[0];
  const outer = wide.groups.find(group => group.nodeId === 'section')!;
  assert.equal(outer.arrangement, 'row');
  assert.deepEqual(outer.crossAxisAlignmentCandidates, ['center']);
  assert.deepEqual(outer.gapsPx, [40]);
  assert.equal(outer.children[1].offsetPx.y, 100);
  assert.equal(outer.children[1].measuredWidthShare, 400 / 840);
  assert.equal(outer.mappingStatus, 'awaiting-authoring');
  assert.equal(wide.groups.find(group => group.nodeId === 'copy')?.parentGroupNodeId, 'section');
  assert.equal(JSON.stringify(source), original);
});

test('keeps phone layout, hidden content, state ownership and screenshot identity independent', () => {
  const { source, section } = fixture();
  const result = createSectionRelationships(source, section);
  const phone = result.viewports[2];
  assert.equal(phone.groups.find(group => group.nodeId === 'section')?.arrangement, 'column');
  assert.deepEqual(phone.hiddenContentFactIds, ['mobile:text:answer']);
  assert.deepEqual(phone.states[0].itemNodeIds, ['question', 'answer']);
  assert.equal(phone.screenshot.path, 'mobile.png');
  assert.equal(phone.groups.some(group => group.sourceFactIds.includes('mobile:text:answer')), false);
});

test('maps actual leaf content to the smallest responsible container without claiming rendered success', () => {
  const { source, section, blocks } = fixture();
  const result = createSectionRelationships(source, section, blocks);
  assert.equal(result.viewports[0].groups.find(group => group.nodeId === 'copy')?.targetContainerKey, 'feature_copy');
  assert.equal(result.viewports[0].groups.find(group => group.nodeId === 'section')?.targetContainerKey, 'feature');
  assert.equal(result.nativeTree[0].parentComponentKey, 'feature');
  assert.equal(result.rendered, 'not-verified');
  assert.equal(result.viewports[0].groups[0].mappingStatus, 'assigned-not-render-verified');
  blocks[0].sourceFactIds = section.sourceFactIds;
  if (blocks[0].kind === 'composite') blocks[0].children = [];
  assert.equal(createSectionRelationships(source, section, blocks).viewports[0].groups[0].mappingStatus, 'unmapped');
});

test('alignment remains an advisory decision and never forces equal height or changes native settings', () => {
  const { source, section, blocks } = fixture();
  const program = { blocks } as Native44Program;
  assert.equal(diagnoseSectionRelationships(source, [section], program).some(item => item.code === 'section-alignment-needs-decision'), false);
  blocks[0].settings = { flex_direction: 'row', align_items: 'flex-start' };
  const original = JSON.stringify(program);
  const findings = diagnoseSectionRelationships(source, [section], program);
  assert.equal(findings.filter(item => item.code === 'section-alignment-needs-decision').length, 2);
  assert.equal(findings[0].snapshotId, 'desktop');
  assert.equal(JSON.stringify(program), original);
});

test('does not infer a row for a grid or overlap, or a unique alignment for equal boxes', () => {
  assert.equal(measureRelationships([{ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 }]).arrangement, 'mixed-or-overlapping');
  assert.deepEqual(measureRelationships([{ x: 0, y: 0, width: 100, height: 100 }, { x: 110, y: 0, width: 100, height: 100 }]).crossAxisAlignmentCandidates, ['start', 'center', 'end']);
});

test('different viewport arrangements remain explicit advisory work and grid is not mistaken for a missing flex row', () => {
  const { source, section, blocks } = fixture();
  const program = { blocks } as Native44Program;
  const before = diagnoseSectionRelationships(source, [section], program).filter(item => item.code === 'section-arrangement-needs-decision');
  assert.equal(before.some(item => item.snapshotId === 'mobile' && item.sourceNodeId === 'section'), true);
  blocks[0].settings = { container_type: 'grid', align_items: 'center' };
  const after = diagnoseSectionRelationships(source, [section], program).filter(item => item.code === 'section-arrangement-needs-decision');
  assert.equal(after.some(item => item.sourceNodeId === 'section'), false);
});

test('production guide carries the same relationship evidence and defaults decisions before and after authoring', () => {
  const { source, section, blocks } = fixture();
  const before = createProductionGuide(source, [section]);
  const after = createProductionGuide(source, [section], blocks);
  assert.equal(before.version, 3);
  assert.equal(before.sections[0].relationships.viewports.length, 3);
  assert.deepEqual(before.sections[0].relationships.viewports[0].groups.map(group => group.sourceFactIds), after.sections[0].relationships.viewports[0].groups.map(group => group.sourceFactIds));
  assert.match(before.stages.author.join(' '), /conditional controls/);
  assert.match(before.stages.collectAndPlan.join(' '), /never silently replace/);
  assert.match(after.stages.confirm.join(' '), /affected section/);
});

test('live content replacement is surfaced without rewriting the frozen policy or source inventory', () => {
  const { source, section, blocks } = fixture();
  if (blocks[0].kind === 'composite') blocks[0].children.push({ kind: 'native-posts', key: 'feature_news', widgetType: 'wd_blog', widgetSettings: {}, query: { itemsPerPage: 3, orderby: 'date', order: 'desc', evidence: [] } });
  const program = { blocks, articleListPolicy: 'target-posts-v1' } as Native44Program;
  const original = JSON.stringify({ source, program });
  assert.equal(diagnoseSectionRelationships(source, [section], program).some(item => item.code === 'source-content-substitution'), true);
  assert.equal(JSON.stringify({ source, program }), original);
});

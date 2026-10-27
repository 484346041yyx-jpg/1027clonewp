import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosePreparationBuild } from '../src/replica-preparation/build-diagnostics.js';
import type { Native44Program } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';

const rectangle = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
function fixture() {
  const source = {
    snapshots: [{ id: 'desktop', viewport: { name: 'desktop' }, nodes: {
      form: { tag: 'form', parentId: null }, field: { tag: 'input', parentId: 'form' },
    } }],
    facts: {
      left: { id: 'left', snapshotId: 'desktop', kind: 'text', value: { layout: { rect: rectangle(10, 10, 300, 130) } } },
      right: { id: 'right', snapshotId: 'desktop', kind: 'media', value: { layout: { rect: rectangle(330, 10, 300, 130) } } },
      field: { id: 'field', snapshotId: 'desktop', nodeId: 'field', kind: 'interaction', value: { details: { type: 'text' } } },
    },
  } as unknown as SourceFactsV2;
  const program = { blocks: [
    { kind: 'composite', key: 'feature', children: [
      { kind: 'composite', key: 'copy', sourceFactIds: ['left'], children: [] },
      { kind: 'composite', key: 'art', sourceFactIds: ['right'], children: [] },
    ] },
    { kind: 'composite', key: 'contact', sourceFactIds: ['field'], children: [
      { kind: 'native', key: 'fake-field', widgetType: 'heading', widgetSettings: { title: 'Your name' } },
    ] },
  ] } as unknown as Native44Program;
  return { source, program };
}

test('reports source side-by-side groups missing native row direction before build', () => {
  const { source, program } = fixture();
  assert.deepEqual(diagnosePreparationBuild(source, program).map(finding => finding.code), [
    'horizontal-source-without-native-row', 'source-form-without-native-form',
  ]);
  program.blocks[0].settings = { flex_direction: 'row' };
  assert.deepEqual(diagnosePreparationBuild(source, program).map(finding => finding.code), ['source-form-without-native-form']);
  program.blocks[0].settings = { container_type: 'grid' };
  assert.deepEqual(diagnosePreparationBuild(source, program).map(finding => finding.code), ['source-form-without-native-form']);
});

test('accepts a native form and ignores controls outside source forms', () => {
  const { source, program } = fixture();
  const contact = program.blocks[1];
  assert.equal(contact.kind, 'composite');
  if (contact.kind !== 'composite') throw new Error('Expected composite contact fixture');
  contact.children.push({ kind: 'native', key: 'real-form', widgetType: 'form', widgetSettings: {} });
  assert.equal(diagnosePreparationBuild(source, program).some(finding => finding.code === 'source-form-without-native-form'), false);
  contact.children.pop();
  source.snapshots[0].nodes.field.parentId = null;
  assert.equal(diagnosePreparationBuild(source, program).some(finding => finding.code === 'source-form-without-native-form'), false);
});

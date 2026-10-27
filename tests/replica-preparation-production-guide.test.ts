import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionGuide } from '../src/replica-preparation/production-guide.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { PreparationSection } from '../src/replica-preparation/types.js';

test('production preserves independent desktop wraps and does not count wrapper assignments as implemented text', () => {
  const source = {
    gaps: [],
    snapshots: ['wide', 'narrow'].map(id => ({ id, viewport: { name: id === 'wide' ? 'desktop' : 'desktop-narrow' }, nodes: { title: { parentId: 'section' } }, screenshot: { path: `${id}.png` } })),
    facts: Object.fromEntries(['wide', 'narrow'].map((id, index) => [id, { id, snapshotId: id, nodeId: 'title', kind: 'text', value: { text: 'A long heading', visible: true, lineCount: index + 1, layout: { contentRect: { width: index ? 300 : 600 } }, style: { 'font-size': '24px', 'border-bottom-width': '1px' } } }])),
  } as unknown as SourceFactsV2;
  const sections = [{ key: 'intro', sourceFactIds: ['wide', 'narrow'] }] as PreparationSection[];
  const before = createProductionGuide(source, sections);
  assert.equal(before.sections[0].viewports[0].requirements[0].assignment, 'awaiting-authoring');
  const after = createProductionGuide(source, sections, [{ key: 'intro', kind: 'composite', sourceFactIds: ['wide', 'narrow'], children: [{ key: 'title', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'A long heading' }, sourceFactIds: ['wide'] }] }]);
  const [wide, narrow] = after.sections[0].viewports;
  assert.equal(wide.requirements[0].assignment, 'mapped');
  assert.equal(narrow.requirements[0].assignment, 'unmapped');
  assert.equal(wide.requirements[0].lineCount, 1);
  assert.equal(narrow.requirements[0].lineCount, 2);
  assert.equal(narrow.requirements[0].text, 'A long heading');
  assert.deepEqual(wide.requirements[0].targets.map(target => target.key), ['title']);
  assert.equal(wide.requirements[0].paint?.['border-bottom-width'], '1px');
  assert.equal(narrow.requirements[0].geometry?.contentRect && (narrow.requirements[0].geometry.contentRect as { width: number }).width, 300);
});

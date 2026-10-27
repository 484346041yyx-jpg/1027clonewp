import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNative44Styles } from '../src/native44/style-resolution.js';
import type { Native44Control } from '../src/native44/knowledge.js';
import type { Native44Program, Native44Native } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';

function fixture(observeSize: boolean) {
  const condition = { type: 'predicate' as const, operator: 'equals', field: 'mode', value: 'custom', scope: 'component' };
  const controls: Native44Control[] = [
    { id: 'mode', type: 'select', defaultValue: '', panel: { tab: 'style' }, valueDomain: { options: [{ value: '' }, { value: 'custom' }] } },
    { id: 'family', type: 'font', panel: { tab: 'style' }, condition, effectTargets: { selectors: { '{{WRAPPER}} .label': 'font-family: {{VALUE}};' } } },
    { id: 'size', type: 'slider', panel: { tab: 'style' }, condition, effectTargets: { selectors: { '{{WRAPPER}} .label': 'font-size: {{SIZE}}{{UNIT}};' } } },
  ];
  const source = { snapshots: [{ id: 'desktop', viewport: { width: 1440, height: 1000 } }], facts: { label: { id: 'label', snapshotId: 'desktop', kind: 'text', nodeId: 'label', value: { style: { 'font-family': 'Arial', 'font-size': '50px' } } } } } as unknown as SourceFactsV2;
  const node: Native44Native = { kind: 'native', widgetType: 'button', key: 'label', sourceFactIds: ['label'], widgetSettings: { size: { size: 50, unit: 'px' } }, styleBindings: [{ sourceFactId: 'label', selector: ' .label', minWidth: 769, maxWidth: 10000, properties: observeSize ? ['font-family', 'font-size'] : ['font-family'] }] };
  return { program: { styleResolutionVersion: 2, blocks: [node] } as unknown as Native44Program, source, css: '', mobileMaxWidth: 768,
    schemas: { button: { type: 'button', class: 'Button', controls: { mode: { type: 'select', default: '', options: { '': 'Default', custom: 'Custom' } }, family: { type: 'font', condition: { mode: 'custom' }, selectors: { '{{WRAPPER}} .label': 'font-family: {{VALUE}};' } }, size: { type: 'slider', condition: { mode: 'custom' }, selectors: { '{{WRAPPER}} .label': 'font-size: {{SIZE}}{{UNIT}};' } } } } },
    knowledge: { fingerprint: 'a'.repeat(64), controlsByWidget: { button: new Set(controls.map(control => control.id)) }, styleControlsByWidget: { button: controls }, validateSettings: (_type: string, values: Record<string, unknown>) => values },
  };
}

test('enabling a mode cannot silently activate another previously inactive native style', () => {
  const result = resolveNative44Styles(fixture(false)), values = (result.program.blocks[0] as Native44Native).widgetSettings;
  assert.equal(values.mode, undefined);
  assert.equal(values.family, undefined);
  assert.ok(result.receipts.some(receipt => receipt.reason === 'native-bundle-has-unobserved-or-conflicting-side-effect'));
});

test('a mode and its full observed dependency bundle use native settings without patch CSS', () => {
  const result = resolveNative44Styles(fixture(true)), values = (result.program.blocks[0] as Native44Native).widgetSettings;
  assert.equal(values.mode, 'custom');
  assert.equal(values.family, 'Arial');
  assert.equal(result.css, '');
  assert.equal(result.receipts.filter(receipt => receipt.action === 'native-setting').length, 2);
});

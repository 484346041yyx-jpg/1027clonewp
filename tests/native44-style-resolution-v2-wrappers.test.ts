import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { readNative44StyleVariableConsumers, readNative44StyleWrapperClasses } from '../src/native44/style-capabilities.js';
import { resolveNative44Styles } from '../src/native44/style-resolution.js';
import type { Native44Native, Native44Program } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const sourceKnowledge = loadNative44Knowledge(['nested-accordion']);
async function fixture() {
  const knowledge = await sourceKnowledge;
  const normalTitleColor = knowledge.components['nested-accordion'].controls.find(control => control.id === 'normal_title_color')!;
  const schema: LegacySchema = { type: 'nested-accordion', class: 'NestedAccordion', controls: { normal_title_color: { type: 'color', selectors: (normalTitleColor.effectTargets as { selectors: unknown }).selectors } } };
  const [consumers, wrappers] = await Promise.all([readNative44StyleVariableConsumers(knowledge), readNative44StyleWrapperClasses(knowledge)]);
  const node: Native44Native = {
    kind: 'native', widgetType: 'nested-accordion', key: 'faq', widgetSettings: {}, sourceFactIds: ['question'],
    styleBindings: [{ sourceFactId: 'question', selector: ' .e-n-accordion-item-title', properties: ['color'], minWidth: 769, maxWidth: 10000 }],
  };
  return {
    program: { styleResolutionVersion: 2, blocks: [node] } as unknown as Native44Program,
    source: { snapshots: [{ id: 'desktop', viewport: { width: 1440, height: 1000 } }], facts: { question: { id: 'question', nodeId: 'title', kind: 'text', snapshotId: 'desktop', value: { style: { color: 'rgb(255, 255, 255)' } } } } } as unknown as SourceFactsV2,
    schemas: { 'nested-accordion': schema }, knowledge: { ...toNative44CompilerKnowledge(knowledge, { 'nested-accordion': schema }), styleVariableConsumers: consumers, styleWrapperClassesByWidget: wrappers }, css: '', mobileMaxWidth: 768,
  };
}

async function archivesAvailable() {
  for (const definition of Object.values((await sourceKnowledge).index.source.packages ?? {})) {
    try { await access(definition.path); } catch { return false; }
  }
  return true;
}

test('real nested accordion wrapper proof connects registered color setting to its actual source CSS variable consumer', async context => {
  if (!await archivesAvailable()) { context.skip('The exact locally installed source archives are not available in this environment.'); return; }
  const input = await fixture(), proof = input.knowledge.styleWrapperClassesByWidget['nested-accordion'][0];
  assert.equal(proof.className, 'elementor-widget-n-accordion');
  assert.ok(proof.entry.endsWith('nested-accordion.php'));
  assert.ok(input.knowledge.styleVariableConsumers.some(consumer => consumer.direct && consumer.variable === '--n-accordion-title-normal-color' && consumer.selector === '.elementor-widget-n-accordion .e-n-accordion-item-title'));
  const result = resolveNative44Styles(input), settings = (result.program.blocks[0] as Native44Native).widgetSettings;
  assert.equal(settings.normal_title_color, 'rgb(255, 255, 255)');
  assert.ok(result.receipts.some(receipt => receipt.action === 'native-setting' && receipt.controlId === 'normal_title_color'));
  assert.equal(result.receipts.some(receipt => receipt.action === 'scoped-css'), false);
  assert.equal(result.css, '');
});

test('real source CSS consumer without wrapper source proof cannot authorize guessing a nested widget alias', async context => {
  if (!await archivesAvailable()) { context.skip('The exact locally installed source archives are not available in this environment.'); return; }
  const input = await fixture(); input.knowledge.styleWrapperClassesByWidget = {};
  const result = resolveNative44Styles(input), settings = (result.program.blocks[0] as Native44Native).widgetSettings;
  assert.equal(settings.normal_title_color, undefined);
  assert.equal(result.receipts.some(receipt => receipt.action === 'native-setting' && receipt.controlId === 'normal_title_color'), false);
  assert.ok(result.receipts.some(receipt => receipt.action === 'scoped-css' || receipt.action === 'unresolved'));
});

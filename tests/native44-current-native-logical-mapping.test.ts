import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalV2, documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { native44Id, native44ModuleClass } from '../src/native44/adapters.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { createNative44CSSModel, compileNative44CSSModel, updateNative44CSSModel, native44CSSModelRuleHash, type Native44CSSModelChange } from '../src/native44/css-model.js';
import { native44SnapshotNodes } from '../src/native44/revision-snapshot.js';
import { native44SubtreeHash } from '../src/native44/current-native-patch.js';
import { deriveNative44CurrentNativeModel, finalizeNative44CurrentNativeModelRecord, projectNative44CurrentNativeModelRecords, rebindNative44CurrentNativeManifest, Native44CurrentNativeSourceBindingSchema, type Native44CurrentNativeModelInputs } from '../src/native44/current-native-model.js';
import { createNative44RequirementContract, native44RequirementsHash } from '../src/native44/requirements.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { walkNative44, type Native44Program } from '../src/native44/types.js';
import type { CapabilityReport, DraftSnapshot } from '../src/wordpress/types.js';

const reason = 'The observed original logical content remains editable in a fresh registered native carousel.', root = 'D:/cloneWP';
async function fixture() {
  const taskId = 'logical-carousel', runId = 'logical-run', pageId = 77, ref = (name: string) => ({ path: `${root}/references/${taskId}/${name}.json`, sha256: hashV2(name) }), sourceFacts = ref('source'), componentPlan = ref('plan');
  const nested = (repeaterKey: string) => ({ policy: 'repeater' as const, childType: 'container' as const, repeaterKey, titleSettingKey: 'slide_title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'a'.repeat(64) });
  const repeater = { type: 'nested-elements-repeater', fields: { slide_title: { type: 'text' } } };
  const schemas: CapabilityReport['legacySchemas'] = { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, heading: { type: 'heading', class: 'Heading', controls: { _css_classes: { type: 'text' }, title: { type: 'textarea' } } }, 'nested-carousel': { type: 'nested-carousel', class: 'Carousel', controls: { _css_classes: { type: 'text' }, carousel_items: repeater }, nativeChildContract: nested('carousel_items') }, wd_nested_carousel: { type: 'wd_nested_carousel', class: 'WDCarousel', controls: { _css_classes: { type: 'text' }, slides: repeater, autoheight: { type: 'switcher' } }, nativeChildContract: nested('slides') } };
  const knowledge = await loadNative44Knowledge(['container', 'heading', 'nested-carousel', 'wd_nested_carousel']);
  const carousel: any = { kind: 'native-carousel', key: 'ordering-carousel', widgetType: 'nested-carousel', widgetSettings: {}, slides: Array.from({ length: 5 }, (_, i) => ({ kind: 'composite', key: `card-${i}`, children: ['number', 'title', 'body'].map(role => ({ kind: 'native', key: `step-${i}-${role}`, role: 'text', widgetType: 'heading', widgetSettings: { title: `${i} ${role}` } })) })) };
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, title: 'Logical mapping fixture', sourceUrl: 'https://source.example/', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, componentCatalog: { ...ref('catalog'), sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref('knowledge'), fingerprint: knowledge.index.fingerprint }, sourceFacts, componentPlan, assetsManifest: ref('assets'), targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' }, { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' }], blocks: [{ kind: 'composite', key: 'panel', settings: { css_classes: 'cwp-panel' }, children: [carousel] }] };
  const options = { schemas, knowledge: toNative44CompilerKnowledge(knowledge, schemas), assets: [] }, original = compileNative44(program, options);
  const fresh = structuredClone(carousel); for (const node of walkNative44([fresh])) node.key = `fresh-${node.key}`; fresh.widgetType = 'wd_nested_carousel'; fresh.widgetSettings = { autoheight: 'yes' };
  const fragment: Native44Program = { ...program, blocks: [{ kind: 'composite', key: 'fresh-shell', children: [fresh] }] }, compiled = compileNative44(fragment, options), originals = walkNative44([carousel]), evidence = ref('evidence');
  const baselineModel = createNative44CSSModel({ taskId, runId, pageId, replicationProfile: 'desktop-browser-v1', modules: [{ key: 'panel', className: 'cwp-panel' }], rules: originals.map(node => ({ id: `style-${node.key}`, moduleKey: 'panel', slot: 'text', selector: `.${native44ModuleClass(node.key)}`, property: 'color', value: '#333', responsibility: 'css', reason, evidence: [evidence.path] })) });
  const changes: Native44CSSModelChange[] = baselineModel.rules.flatMap(rule => [{ kind: 'remove' as const, id: rule.id, expectedHash: native44CSSModelRuleHash(rule), reason, evidence: [evidence.path] }, { kind: 'add' as const, rule: { ...rule, id: `fresh-${rule.id}`, selector: `.${native44ModuleClass(`fresh-${rule.id.slice(6)}`)}` } }]);
  const settings = { custom_css: compileNative44CSSModel(baselineModel, { elements: original.composition.elements }).css, post_title: 'Draft', post_status: 'draft' }, before: DraftSnapshot = { pageId, runId, title: 'Draft', status: 'draft', elements: original.composition.elements, settings, hash: documentHashV2(original.composition.elements, settings) };
  const source: any = { sourceUrl: program.sourceUrl, snapshots: [1920, 1440].map((width, i) => ({ id: i ? 'narrow' : 'wide', viewport: { name: i ? 'desktop-narrow' : 'desktop-wide', width, height: 1080 }, evidence: [evidence], nodes: {} })), facts: {}, gaps: [] }, sourceUnits: any[] = [], selectionDecisions: any[] = [];
  for (const snapshot of source.snapshots) for (const key of ['ordering-carousel', 'step-0-number', 'step-0-title', 'step-0-body']) {
    const factId = `${snapshot.id}:${key}`, unitId = `${snapshot.id}-${key}`;
    snapshot.nodes[key] = { parentId: null, regionId: key, tag: 'div', childIds: [], selector: `#${key}` }; source.facts[factId] = { id: factId, snapshotId: snapshot.id, nodeId: key, regionId: key, kind: 'text', value: { text: key }, evidence };
    sourceUnits.push({ id: unitId, snapshotId: snapshot.id, ownerNodeId: key, regionId: key, role: 'body', sourceFactIds: [factId], slots: [{ id: 'copy', kind: 'text', factIds: [factId], required: true }], evidence: { factIds: [factId], screenshots: [{ snapshotId: snapshot.id, screenshot: evidence }], rationale: reason } });
    selectionDecisions.push({ unitId, componentKeys: key === 'ordering-carousel' && snapshot.id === 'wide' ? originals.filter(node => !['step-0-number', 'step-0-title', 'step-0-body'].includes(node.key)).map(node => node.key) : [key] });
  }
  const associated = (key: string) => selectionDecisions.filter(row => row.componentKeys.includes(key)).map(row => row.unitId), contract = createNative44RequirementContract(source, sourceUnits, sourceFacts, taskId), policy = { version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] }, old = native44SnapshotNodes(before.elements).get(native44Id(taskId, carousel.key))!.node;
  const binding = { elementId: old.id, originalComponentKey: carousel.key, replacementRootComponentKey: 'fresh-shell', replacementComponentKey: fresh.key, sourceUnitIds: associated(carousel.key), reason, evidence: [evidence], descendantBindings: originals.slice(1).map(node => ({ originalComponentKey: node.key, replacementComponentKey: `fresh-${node.key}`, sourceUnitIds: associated(node.key), reason, evidence: [evidence] })) };
  return { root, before, baselineModel, proposedModel: updateNative44CSSModel(baselineModel, changes), compiled, fragment, changes, replacements: [{ kind: 'replace-subtree', elementId: old.id, beforeSubtreeHash: native44SubtreeHash(old), componentKey: 'fresh-shell', reason }], sourceBindings: [binding], frozenProgram: program, source, sourcePlan: { sourceFacts, sourceUnits, selectionDecisions }, sourceUnits, contract, policy, schemas, references: { frozenProgram: ref('program'), sourceFacts, componentPlan, requirements: ref('requirements'), acceptancePolicy: ref('policy'), sourceUnits: ref('units'), baselineSnapshot: ref('before'), baselineManifest: ref('manifest'), baselineModel: ref('model'), fragmentProgram: ref('fragment'), registeredSchemas: ref('schemas'), proposedModel: ref('proposed') } } satisfies Native44CurrentNativeModelInputs;
}
function finish(f: Native44CurrentNativeModelInputs) { const derived = deriveNative44CurrentNativeModel(f), settings = { ...f.before.settings, custom_css: compileNative44CSSModel(derived.model, { elements: derived.elements }).css }, expected = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) }; return { derived, expected, record: finalizeNative44CurrentNativeModelRecord(derived, expected) }; }
test('fresh native carousel preserves all 20 logical descendants and assigns original facts once', async () => {
  const f = await fixture(), frozen = canonicalV2([f.frozenProgram, f.source, f.sourceUnits, f.contract]), { record, expected } = finish(f), owner = record.owners[0], projected = projectNative44CurrentNativeModelRecords([record], expected);
  assert.equal(owner.descendantMappings?.length, 20); assert.equal(projected.length, 21); assert.equal(projected.find(row => row.originalComponentKey === 'step-0-body')!.sourceFactIds.length, 2);
  const facts = projected.flatMap(row => row.sourceFactBindings.map(row => row.factId)); assert.equal(new Set(facts).size, facts.length); assert.equal(facts.length, 8);
  assert.equal(owner.newRootId, f.compiled.elementMap['fresh-ordering-carousel']); assert.equal(owner.replacementRootId, f.compiled.elementMap['fresh-shell']);
  assert.equal(canonicalV2([f.frozenProgram, f.source, f.sourceUnits, f.contract]), frozen);
});
test('missing, duplicate, cross-scope, reordered and changed-copy descendants cannot be remapped', async () => {
  for (const mutation of [(f: any) => f.sourceBindings[0].descendantBindings.pop(), (f: any) => f.sourceBindings[0].descendantBindings.push(f.sourceBindings[0].descendantBindings[0]), (f: any) => f.sourceBindings[0].descendantBindings[0].replacementComponentKey = 'fresh-shell', (f: any) => f.sourceBindings[0].descendantBindings[0].sourceUnitIds = []]) { const f = await fixture(); mutation(f); assert.throws(() => deriveNative44CurrentNativeModel(f), /descendant_mapping/); }
  for (const mutation of [(f: any) => f.fragment.blocks[0].children[0].slides.reverse(), (f: any) => f.fragment.blocks[0].children[0].slides[0].children[0].widgetSettings.title = 'changed']) { const f = await fixture(); mutation(f); const loaded = await loadNative44Knowledge(['container', 'heading', 'wd_nested_carousel']); f.compiled = compileNative44(f.fragment, { schemas: f.schemas, knowledge: toNative44CompilerKnowledge(loaded, f.schemas), assets: [] }); assert.throws(() => deriveNative44CurrentNativeModel(f), /descendant_mapping/); }
});
test('a descendant CSS value change cannot pass as relocation, and serialized compilation has no permit', async () => {
  const f = await fixture(), change = (f.changes as any[]).find(row => row.kind === 'add' && row.rule.id === 'fresh-style-step-0-body'); change.rule.value = '#999'; f.proposedModel = updateNative44CSSModel(f.baselineModel, f.changes as Native44CSSModelChange[]); assert.throws(() => deriveNative44CurrentNativeModel(f), /presentation_not_exact/);
  const copied = await fixture(); copied.compiled = structuredClone(copied.compiled); assert.throws(() => deriveNative44CurrentNativeModel(copied), /current-process/);
});
test('fresh logical correspondence does not grant reuse of removed native IDs or extra shell content', async () => {
  for (const retainId of [false, true]) {
    const f = await fixture(), carousel: any = (f.fragment.blocks[0] as any).children[0];
    if (retainId) { carousel.slides[0].key = 'card-0'; (f.sourceBindings[0] as any).descendantBindings.find((row: any) => row.originalComponentKey === 'card-0').replacementComponentKey = 'card-0'; }
    else (f.fragment.blocks[0] as any).children.push({ kind: 'native', key: 'extra-unowned', widgetType: 'heading', widgetSettings: { title: 'Extra' } });
    const loaded = await loadNative44Knowledge(['container', 'heading', 'wd_nested_carousel']); f.compiled = compileNative44(f.fragment, { schemas: f.schemas, knowledge: toNative44CompilerKnowledge(loaded, f.schemas), assets: [] });
    assert.throws(() => deriveNative44CurrentNativeModel(f), retainId ? /owner_or_unit_conflict|new_compiled_ids/ : /shell_or_renderer_scope/);
  }
  const f = await fixture(), { record, expected } = finish(f), outside = structuredClone(record); outside.owners[0].descendantMappings![0].newRootId = record.owners[0].replacementRootId!; assert.throws(() => projectNative44CurrentNativeModelRecords([outside], expected), /scope_conflict/);
});
test('native repeater labels must preserve the original card slot names', async () => {
  const f = await fixture(), carousel: any = (f.fragment.blocks[0] as any).children[0], old = native44SnapshotNodes(f.before.elements).get(f.replacements[0].elementId)!.node;
  carousel.widgetSettings.slides = (old.settings.carousel_items as any[]).map((row, index) => ({ _id: native44Id(f.fragment.taskId, `fresh-row-${index}`), slide_title: index ? row.slide_title : 'Changed editor slot title' }));
  const loaded = await loadNative44Knowledge(['container', 'heading', 'wd_nested_carousel']); f.compiled = compileNative44(f.fragment, { schemas: f.schemas, knowledge: toNative44CompilerKnowledge(loaded, f.schemas), assets: [] });
  assert.throws(() => deriveNative44CurrentNativeModel(f), /repeater_slot_conflict/);
});
test('later partial descendant or ancestor replacement rejects before snapshot assembly or any save', async () => {
  for (const ancestor of [false, true]) {
    const f = await fixture(), { record, expected, derived } = finish(f), alias = record.owners[0].descendantMappings!.find(row => row.originalComponentKey === 'step-0-body')!, elementId = ancestor ? native44Id(f.fragment.taskId, 'panel') : alias.newRootId, originalComponentKey = ancestor ? 'panel' : alias.originalComponentKey;
    f.before = expected; f.baselineModel = derived.model; (f as Native44CurrentNativeModelInputs).priorRecords = [record];
    f.sourceBindings = [{ ...f.sourceBindings[0], elementId, originalComponentKey }]; f.replacements = [{ ...f.replacements[0], elementId, beforeSubtreeHash: native44SubtreeHash(native44SnapshotNodes(expected.elements).get(elementId)!.node) }];
    assert.throws(() => deriveNative44CurrentNativeModel(f), /prior_replacement_partial_scope_overlap/);
  }
  const f = await fixture(), { record, expected, derived } = finish(f); f.before = expected; f.baselineModel = derived.model; (f as Native44CurrentNativeModelInputs).priorRecords = [record]; const binding: any = { ...f.sourceBindings[0], elementId: record.owners[0].newRootId }; delete binding.descendantBindings; f.sourceBindings = [binding]; assert.throws(() => deriveNative44CurrentNativeModel(f), /prior_replacement_descendant_inventory_required/);
});
test('renderer preset rebinding preserves original logical/source interaction identities and alignment', async () => {
  const f = await fixture(), { record } = finish(f), check = { componentKey: 'ordering-carousel', sourceComponentKey: 'ordering-carousel', selector: `.elementor-77 [data-id="${f.replacements[0].elementId}"]`, widgetType: 'nested-carousel', expectedLogicalIndex: 2, requireSourceAlignment: true, viewports: ['desktop-wide'] }, manifest: any = { interactionChecks: [check] }, rebound = rebindNative44CurrentNativeManifest(manifest, record).interactionChecks![0];
  assert.equal(rebound.widgetType, 'wd_nested_carousel'); assert.equal(rebound.componentKey, check.componentKey); assert.equal(rebound.sourceComponentKey, check.sourceComponentKey); assert.equal(rebound.requireSourceAlignment, true); assert.equal(rebound.expectedLogicalIndex, 2); assert.equal(rebound.paginationSelector, '.wd-nav-pagin-item'); assert.match(rebound.selector, new RegExp(record.owners[0].newRootId)); assert.deepEqual(manifest.interactionChecks[0], check);
});
test('new optional binding fields remain absent in historical inputs', () => { const old = { elementId: 'abc1234', originalComponentKey: 'old', replacementComponentKey: 'new', sourceUnitIds: ['wide', 'narrow'], reason, evidence: [{ path: 'proof.json', sha256: 'a'.repeat(64) }] }; assert.deepEqual(Native44CurrentNativeSourceBindingSchema.parse(old), old); });

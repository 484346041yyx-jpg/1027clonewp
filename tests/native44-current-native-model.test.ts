import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { canonicalV2, documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import { compileNative44 } from '../src/native44/compiler.js';
import { native44Id, native44ModuleClass } from '../src/native44/adapters.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { createNative44CSSModel, compileNative44CSSModel, updateNative44CSSModel, native44CSSModelRuleHash, type Native44CSSModelChange } from '../src/native44/css-model.js';
import { native44SnapshotNodes } from '../src/native44/revision-snapshot.js';
import { native44SubtreeHash } from '../src/native44/current-native-patch.js';
import { deriveNative44CurrentNativeModel, finalizeNative44CurrentNativeModelRecord, validateNative44CurrentNativeModelChanges, native44CurrentPendingFormLeaf, bindNative44CurrentNativeModelCompilation, assertNative44CurrentNativeModelDelta, projectNative44CurrentNativeModelRecords, type Native44CurrentNativeModelInputs } from '../src/native44/current-native-model.js';
import { createNative44RequirementContract, native44RequirementsHash } from '../src/native44/requirements.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import type { Native44Program } from '../src/native44/types.js';
import type { CapabilityReport, DraftSnapshot } from '../src/wordpress/types.js';
import { prepareNative44PendingFormCapabilities, NATIVE44_PENDING_FORM_ATTRIBUTES } from '../src/native44/pending-form.js';
import { native44RegisteredSchemaHash } from '../src/native44/selection.js';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';

const schemas: CapabilityReport['legacySchemas'] = { container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } }, heading: { type: 'heading', class: 'Heading', controls: { _css_classes: { type: 'text' }, title: { type: 'textarea' } } } };
test('new native replacement and pending form implementations are covered by the executable release identity', () => {
  for (const filename of ['src/native44/current-native-model.ts', 'src/native44/current-native-v2.ts', 'src/native44/pending-form.ts'] as const) assert.ok(NATIVE44_ADAPTER_SOURCE_PATHS.includes(filename));
});
test('model-based native revisions reject a genuine compiled target-posts query instead of bypassing the resource revision boundary',async()=>{
  const f=await fixture(),registered={...f.schemas,wd_blog:{type:'wd_blog',class:'XTS\\Elementor\\Blog',controls:{_css_classes:{type:'text'},post_type:{type:'select',options:{post:'Post',ids:'IDs'}},orderby:{type:'select',options:{date:'Date'}},order:{type:'select',options:{DESC:'Descending'}},offset:{type:'text'},items_per_page:{type:'number'}}}},knowledge=await loadNative44Knowledge(['container','wd_blog']);
  f.fragment={...f.fragment,articleListPolicy:'target-posts-v1',blocks:[{kind:'composite',key:'new-one',children:[{kind:'native-posts',key:'new-posts',widgetType:'wd_blog',widgetSettings:{},query:{itemsPerPage:1,orderby:'date',order:'desc',evidence:['article-scope.json']}}]}]};
  f.compiled=compileNative44(f.fragment,{schemas:registered,knowledge:toNative44CompilerKnowledge(knowledge,registered),assets:[],targetOrigin:'https://target.example',posts:[{version:1,targetOrigin:'https://target.example',readAt:'2026-10-18T00:00:00.000Z',evidence:['actual-target-posts.json'],query:{itemsPerPage:1,orderby:'date',order:'desc',offset:0,categoryIds:[],tagIds:[]},posts:[{id:15,status:'publish',date:'2026-10-17T00:00:00',title:'Real target article',excerpt:'Target article excerpt',permalink:'https://target.example/real-article/',featuredMediaId:0,imageVariants:[],categoryIds:[],tagIds:[]}]}]});
  assert.equal(f.compiled.postQueryReceipts?.length,1);assert.throws(()=>deriveNative44CurrentNativeModel(f),/compiled_scope_invalid/);
});
async function fixture() {
  const taskId = 'model-replacement', runId = 'run-replacement', pageId = 77, root = 'D:/cloneWP', r = (name: string) => ({ path: `${root}/references/${taskId}/${name}.json`, sha256: hashV2(name) }), sourceFacts = r('source-facts'), componentPlan = r('component-plan'), knowledge = await loadNative44Knowledge(['container', 'heading']);
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, title: 'Replacement fixture', sourceUrl: 'https://source.example/', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, componentCatalog: { ...r('catalog'), sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...r('knowledge'), fingerprint: knowledge.index.fingerprint }, sourceFacts, componentPlan, assetsManifest: r('assets'), targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' }, { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' }], blocks: [{ kind: 'composite', key: 'panel', settings: { css_classes: 'cwp-panel' }, children: ['old-one', 'old-two', 'retained'].map(key => ({ kind: 'native' as const, key, widgetType: 'heading' as const, widgetSettings: { title: `Original ${key}` } })) }] };
  const original = compileNative44(program, { schemas, knowledge: toNative44CompilerKnowledge(knowledge, schemas), assets: [] }), roots = native44SnapshotNodes(original.composition.elements);
  const fragment: Native44Program = { ...program, blocks: ['new-one', 'new-two'].map(key => ({ kind: 'composite', key, children: [{ kind: 'native', key: `${key}-content`, widgetType: 'heading', widgetSettings: { title: `Compiled ${key}` } }] })) }, compiled = compileNative44(fragment, { schemas, knowledge: toNative44CompilerKnowledge(knowledge, schemas), assets: [] });
  const evidence = r('observed-source'), reason = 'The independently observed source unit is represented by this compiled native replacement.';
  const baselineModel = createNative44CSSModel({ taskId, runId, pageId, replicationProfile: 'desktop-browser-v1', modules: [{ key: 'panel', className: 'cwp-panel' }], rules: ['old-one', 'old-two', 'retained'].map(key => ({ id: `style-${key}`, moduleKey: 'panel', slot: 'text', selector: `.${native44ModuleClass(key)} .elementor-heading-title`, property: 'color', value: '#333', responsibility: 'css', reason, evidence: [evidence.path] })) });
  const settings = { custom_css: compileNative44CSSModel(baselineModel, { elements: original.composition.elements }).css, post_title: 'Draft', post_status: 'draft' }, before: DraftSnapshot = { pageId, runId, title: 'Draft', status: 'draft', elements: original.composition.elements, settings, hash: documentHashV2(original.composition.elements, settings) };
  const changes: Native44CSSModelChange[] = ['old-one', 'old-two'].map(key => ({ kind: 'remove', id: `style-${key}`, expectedHash: native44CSSModelRuleHash(baselineModel.rules.find(rule => rule.id === `style-${key}`)!), reason, evidence: [evidence.path] }));
  for (const key of ['new-one', 'new-two']) changes.push({ kind: 'add', rule: { id: `style-${key}`, moduleKey: 'panel', slot: 'text', selector: `.${native44ModuleClass(key)} .elementor-heading-title`, property: 'color', value: '#333', responsibility: 'css', reason, evidence: [evidence.path] } });
  const source: any = { sourceUrl: program.sourceUrl, snapshots: [1920, 1440].map((width, index) => ({ id: index ? 'narrow' : 'wide', viewport: { name: index ? 'desktop-narrow' : 'desktop-wide', width, height: index ? 1000 : 1080 }, evidence: [evidence], nodes: {} })), facts: {}, gaps: [] }, sourceUnits: any[] = [], decisions: any[] = [];
  for (const key of ['old-one', 'old-two']) for (const snapshot of source.snapshots) { const factId = `${snapshot.id}:${key}`, unitId = `${snapshot.id}-${key}`; source.facts[factId] = { id: factId, snapshotId: snapshot.id, nodeId: key, regionId: key, kind: 'text', value: { text: `Original ${key}` }, evidence }; snapshot.nodes[key] = { parentId: null, regionId: key, tag: 'div', childIds: [], selector: `#${key}` }; sourceUnits.push({ id: unitId, snapshotId: snapshot.id, ownerNodeId: key, regionId: key, role: 'body', sourceFactIds: [factId], slots: [{ id: 'copy', kind: 'text', factIds: [factId], required: true }], evidence: { factIds: [factId], screenshots: [{ snapshotId: snapshot.id, screenshot: evidence }], rationale: reason } }); decisions.push({ unitId, componentKeys: [key], slotBindings: [{ slotId: 'copy', componentKey: key, settingPath: 'widgetSettings.title' }] }); }
  const contract = createNative44RequirementContract(source, sourceUnits, sourceFacts, taskId), policy = { version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] };
  const input: Native44CurrentNativeModelInputs = { root, before, baselineModel, proposedModel: updateNative44CSSModel(baselineModel, changes), compiled, fragment, changes, replacements: ['old-one', 'old-two'].map((key, index) => ({ kind: 'replace-subtree', elementId: native44Id(taskId, key), beforeSubtreeHash: native44SubtreeHash(roots.get(native44Id(taskId, key))!.node), componentKey: index ? 'new-two' : 'new-one', reason })), sourceBindings: ['old-one', 'old-two'].map((key, index) => ({ elementId: native44Id(taskId, key), originalComponentKey: key, replacementComponentKey: index ? 'new-two' : 'new-one', sourceUnitIds: [`wide-${key}`, `narrow-${key}`], reason, evidence: [evidence] })), frozenProgram: program, source, sourcePlan: { sourceFacts, sourceUnits, selectionDecisions: decisions }, sourceUnits, contract, policy, schemas: structuredClone(schemas), references: { frozenProgram: r('program'), sourceFacts, componentPlan, requirements: r('requirements'), acceptancePolicy: r('acceptance-policy'), sourceUnits: r('source-units'), baselineSnapshot: r('snapshot'), baselineManifest: r('manifest'), baselineModel: r('model-before'), fragmentProgram: r('fragment'), registeredSchemas: r('registered'), proposedModel: r('model-after') } };
  return input;
}
test('normal compiled fragment derives exact model/history and complete two-desktop current native correspondence without changing frozen inputs', async () => {
  const f = await fixture(), before = canonicalV2(f), derived = deriveNative44CurrentNativeModel(f), css = compileNative44CSSModel(derived.model, { elements: derived.elements }).css, settings = { ...f.before.settings, custom_css: css }, expected = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) }, record = finalizeNative44CurrentNativeModelRecord(derived, expected);
  assert.equal(canonicalV2(f), before); assert.equal(record.owners.length, 2); assert.equal(record.removedRules.length, 2); assert.equal(record.addedOrReboundRules.length, 2); assert.equal(derived.model.history.length, 2); assert.equal(derived.model.rules.length, 3); assert.deepEqual(derived.model.rules.find(rule => rule.id === 'style-retained'), f.baselineModel.rules[2]);
  assert.equal(record.requirements.sha256, f.references.requirements.sha256); assert.equal(record.acceptancePolicy.sha256, f.references.acceptancePolicy.sha256); assert.equal(record.sourceUnits.sha256, f.references.sourceUnits.sha256); assert.equal(record.frozenInputsChanged, false); assert.equal(record.businessAcceptanceChanged, false);
  for (const owner of record.owners) { assert.equal(owner.sourceUnitIds.length, 2); assert.equal(owner.requirements.length, 8); assert.ok(owner.requirements.every(row => row.currentInspection === 'required' && !row.behavioralAcceptanceChanged)); assert.equal(owner.nativeControls[0].widgetType, 'heading'); assert.ok(owner.nativeControls[0].controlIds.includes('title')); assert.notEqual(owner.oldElementId, owner.newRootId); }
  assert.notEqual(expected.hash, f.before.hash); assert.equal(record.afterHash, expected.hash);
});
test('a current replacement cannot omit source units, required editability, native control ownership or frozen reference binding', async () => {
  const missingUnit = await fixture(); (missingUnit.sourceBindings[0] as any).sourceUnitIds.pop(); assert.throws(() => deriveNative44CurrentNativeModel(missingUnit));
  const missingRequirement = await fixture(); const contract = missingRequirement.contract as any; contract.requirements = contract.requirements.filter((row: any) => !(row.dimension === 'editability' && row.sourceKey === 'unit:wide-old-one')); (missingRequirement.policy as any).requirementsHash = native44RequirementsHash(contract); assert.throws(() => deriveNative44CurrentNativeModel(missingRequirement), /requirement_inventory/);
  const control = await fixture(); delete control.schemas.heading.controls.title; assert.throws(() => deriveNative44CurrentNativeModel(control), /editability_owner/);
  const ref = await fixture(); ref.sourcePlan.sourceFacts = { ...ref.references.sourceFacts, sha256: 'f'.repeat(64) }; assert.throws(() => deriveNative44CurrentNativeModel(ref), /frozen_contract/);
});
test('a large retained rule inventory preserves exact rule contents through indexed identity lookup', async () => {
  const f = await fixture(), retained = f.baselineModel.rules.find(rule => rule.id === 'style-retained')!;
  for (let index = 0; index < 750; index++) f.baselineModel.rules.push({ ...structuredClone(retained), id: `retained-${index}`, selector: `${retained.selector}.detail-${index}` });
  f.proposedModel = updateNative44CSSModel(f.baselineModel, f.changes as Native44CSSModelChange[]);
  const original = canonicalV2(f.baselineModel.rules.filter(rule => rule.id.startsWith('retained-'))), derived = deriveNative44CurrentNativeModel(f);
  assert.equal(canonicalV2(derived.model.rules.filter(rule => rule.id.startsWith('retained-'))), original);
  const changed = await fixture(); changed.proposedModel.rules.find(rule => rule.id === 'style-retained')!.reason += ' altered';
  assert.throws(() => deriveNative44CurrentNativeModel(changed), /not_exact_derived/);
  const duplicate = await fixture(); duplicate.baselineModel.rules.push(structuredClone(duplicate.baselineModel.rules[2]));
  assert.throws(() => deriveNative44CurrentNativeModel(duplicate), /duplicate|ambiguous|rule/i);
});
test('only exact old-owner removal and new compiled-owner additions may alter the current model', async () => {
  const unrelated = await fixture(); (unrelated.changes as any[]).push({ kind: 'remove', id: 'style-retained', expectedHash: native44CSSModelRuleHash(unrelated.baselineModel.rules[2]), reason: 'Do not remove unrelated content styles.', evidence: [(unrelated.sourceBindings[0] as any).evidence[0].path] }); unrelated.proposedModel = updateNative44CSSModel(unrelated.baselineModel, unrelated.changes as Native44CSSModelChange[]); assert.throws(() => deriveNative44CurrentNativeModel(unrelated), /outside_replacement_scope/);
  const dangling = await fixture(); dangling.changes = (dangling.changes as any[]).filter(row => row.id !== 'style-old-two'); dangling.proposedModel = updateNative44CSSModel(dangling.baselineModel, dangling.changes as Native44CSSModelChange[]); assert.throws(() => deriveNative44CurrentNativeModel(dangling), /old_owner_remains/);
  const mismatch = await fixture(); mismatch.proposedModel.rules[1].value = 'red'; assert.throws(() => deriveNative44CurrentNativeModel(mismatch), /not_exact_derived/);
  const unboundEvidence = await fixture(); (unboundEvidence.changes as any[])[2].rule.evidence = ['not-hash-bound']; unboundEvidence.proposedModel = updateNative44CSSModel(unboundEvidence.baselineModel, unboundEvidence.changes as Native44CSSModelChange[]); assert.throws(() => deriveNative44CurrentNativeModel(unboundEvidence), /outside_replacement_scope/);
  for (const selector of [`:not(.${native44ModuleClass('new-one')})`, `.${native44ModuleClass('new-one')} + .retained`, `.${native44ModuleClass('new-one')} ~ .retained`]) { const escaped = await fixture(); (escaped.changes as any[])[2].rule.selector = selector; assert.throws(() => { escaped.proposedModel = updateNative44CSSModel(escaped.baselineModel, escaped.changes as Native44CSSModelChange[]); deriveNative44CurrentNativeModel(escaped); }, /outside_replacement_scope|stable class selectors/); }
  assert.throws(() => validateNative44CurrentNativeModelChanges([{ kind: 'remove', id: 'rule', expectedHash: 'a'.repeat(64), reason: 'reason', evidence: ['proof'], allowAny: true }]), /envelope/);
});
test('serialized compiler output, changed old subtree and forged after CSS/settings cannot become a replacement record', async () => {
  const copied = await fixture(); copied.compiled = structuredClone(copied.compiled); assert.throws(() => deriveNative44CurrentNativeModel(copied), /current-process/);
  const hash = await fixture(); hash.replacements[0].beforeSubtreeHash = 'f'.repeat(64); assert.throws(() => deriveNative44CurrentNativeModel(hash), /owner_conflict/);
  const f = await fixture(), derived = deriveNative44CurrentNativeModel(f), settings = { ...f.before.settings, custom_css: '.foreign{display:none}' }, invalid = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) }; assert.throws(() => finalizeNative44CurrentNativeModelRecord(derived, invalid), /record_expected/);
  const title = { ...invalid, title: 'Another page' }; assert.throws(() => finalizeNative44CurrentNativeModelRecord(derived, title), /record_expected/);
});
test('all pending behavior requirements and original source-fact ownership remain explicit after native replacement', async () => {
  const f = await fixture();
  for (const snapshot of f.source.snapshots) {
    const factId = `${snapshot.id}:submit`, unit = f.sourceUnits.find(row => row.id === `${snapshot.id}-old-one`)!;
    f.source.facts[factId] = { id: factId, snapshotId: snapshot.id, nodeId: 'old-one', regionId: 'old-one', kind: 'interaction', value: { kind: 'control', details: { action: 'submit', label: 'Subscribe' } }, evidence: f.references.sourceFacts };
    unit.sourceFactIds.push(factId); unit.evidence.factIds.push(factId);
  }
  const contract = createNative44RequirementContract(f.source, f.sourceUnits, f.references.sourceFacts, f.frozenProgram.taskId);
  for (const row of contract.requirements.filter(row => row.capability === 'form-submit')) row.fulfillment = { route: 'gap', gapId: `pending-${row.id}`, reason: 'Native layout is editable but the external business submission service remains unconfigured.', state: 'pending-configuration', componentKeys: ['old-one'] };
  f.contract = contract; f.policy = { version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] };
  const unchanged = canonicalV2(contract), derived = deriveNative44CurrentNativeModel(f), owner = derived.owners.find(row => row.originalComponentKey === 'old-one')!;
  assert.equal(owner.requirements.filter(row => row.capability === 'form-submit').length, 2); assert.ok(owner.requirements.filter(row => row.capability === 'form-submit').every(row => row.frozenFulfillmentRoute === 'gap' && !row.behavioralAcceptanceChanged && row.currentInspection === 'required')); assert.equal(owner.sourceFactBindings.filter(row => row.factId.endsWith(':submit')).length, 2); assert.ok(owner.sourceFactBindings.every(row => !row.originalUnitOwnershipChanged)); assert.equal(canonicalV2(contract), unchanged);
});
test('pending form correspondence names exact scoped native leaves while requiring actual runtime inspection', () => {
  const email = native44CurrentPendingFormLeaf(15769, 'abc1234', 'email'), submit = native44CurrentPendingFormLeaf(15769, 'def5678', 'submit');
  assert.equal(email.selector, '.elementor-15769 [data-id="abc1234"] .elementor-form input.elementor-field[type="email"][name="form_fields[email]"]');
  assert.equal(email.expectedId, 'form-field-email'); assert.equal(email.geometryOwner, 'native-control-leaf'); assert.equal(email.runtimeInspection, 'required');
  assert.equal(submit.selector, '.elementor-15769 [data-id="def5678"] .elementor-form button.elementor-button[type="submit"]'); assert.equal(submit.tag, 'button'); assert.equal(submit.runtimeInspection, 'required');
  assert.throws(() => native44CurrentPendingFormLeaf(0, 'abc1234', 'email'));
  assert.throws(() => native44CurrentPendingFormLeaf(15769, 'abc"123', 'submit'));
  assert.throws(() => native44CurrentPendingFormLeaf(15769, 'abc1234', 'other' as any));
});
test('the model writer requires exact process-local full derivation and an independently live-compiled identical fragment', async () => {
  const f = await fixture(), derived = deriveNative44CurrentNativeModel(f), settings = { ...f.before.settings, custom_css: compileNative44CSSModel(derived.model, { elements: derived.elements }).css }, expected = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) };
  assert.throws(() => assertNative44CurrentNativeModelDelta(f.before, expected, f.compiled, f.replacements, derived.model.modules, derived.model), /current_process/);
  assert.throws(() => finalizeNative44CurrentNativeModelRecord(structuredClone(derived), expected), /current_process/);
  finalizeNative44CurrentNativeModelRecord(derived, expected);
  assert.doesNotThrow(() => assertNative44CurrentNativeModelDelta(f.before, expected, f.compiled, f.replacements, derived.model.modules, derived.model));
  assert.throws(() => assertNative44CurrentNativeModelDelta(f.before, expected, f.compiled, f.replacements, derived.model.modules, structuredClone(derived.model)), /current_process/);
  const loaded = await loadNative44Knowledge(['container', 'heading']), live = compileNative44(f.fragment, { schemas: f.schemas, knowledge: toNative44CompilerKnowledge(loaded, f.schemas), assets: [] });
  assert.throws(() => assertNative44CurrentNativeModelDelta(f.before, expected, live, f.replacements, derived.model.modules, derived.model), /current_process/);
  bindNative44CurrentNativeModelCompilation(derived.model, live);
  assert.doesNotThrow(() => assertNative44CurrentNativeModelDelta(f.before, expected, live, f.replacements, derived.model.modules, derived.model));
  const altered = await fixture(), mutable = deriveNative44CurrentNativeModel(altered); mutable.model.rules[0].value = '#123';
  assert.throws(() => finalizeNative44CurrentNativeModelRecord(mutable, expected), /current_process/);
  const badProgram = structuredClone(f.fragment); (badProgram.blocks[0] as any).children[0].widgetSettings.title = 'Different live content';
  const changed = compileNative44(badProgram, { schemas: f.schemas, knowledge: toNative44CompilerKnowledge(loaded, f.schemas), assets: [] });
  assert.throws(() => bindNative44CurrentNativeModelCompilation(derived.model, changed), /binding_changed/);
});
test('current mapping rejects missing native owners and changed types instead of reusing historical editability', async () => {
  const f = await fixture(), derived = deriveNative44CurrentNativeModel(f), settings = { ...f.before.settings, custom_css: compileNative44CSSModel(derived.model, { elements: derived.elements }).css }, expected = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) }, record = finalizeNative44CurrentNativeModelRecord(derived, expected);
  assert.equal(projectNative44CurrentNativeModelRecords([record], expected).length, 2);
  const missing = structuredClone(expected); missing.elements[0].elements!.splice(0, 1); assert.throws(() => projectNative44CurrentNativeModelRecords([record], missing), /root_missing/);
  const type = structuredClone(expected); type.elements[0].elements![0].elements![0].widgetType = 'text-editor'; assert.throws(() => projectNative44CurrentNativeModelRecords([record], type), /control_changed/);
  const foreign = structuredClone(record); foreign.pageId++; assert.throws(() => projectNative44CurrentNativeModelRecords([foreign], expected), /identity_conflict/);
});
test('a sole same-type native widget inside the compiled shell owns its original logical source units', async () => {
  const f = await fixture();
  for (const binding of f.sourceBindings as any[]) { binding.replacementRootComponentKey = binding.replacementComponentKey; binding.replacementComponentKey += '-content'; }
  const changes = f.changes as Native44CSSModelChange[];
  for (const change of changes) if (change.kind === 'add') change.rule.selector = `.${native44ModuleClass(`${change.rule.id.slice(6)}-content`)} .elementor-heading-title`;
  f.proposedModel = updateNative44CSSModel(f.baselineModel, changes);
  const derived = deriveNative44CurrentNativeModel(f), settings = { ...f.before.settings, custom_css: compileNative44CSSModel(derived.model, { elements: derived.elements }).css }, expected = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) }, record = finalizeNative44CurrentNativeModelRecord(derived, expected);
  assert.equal(record.owners[0].newRootId, f.compiled.elementMap['new-one-content']); assert.equal(record.owners[0].replacementRootId, f.compiled.elementMap['new-one']); assert.equal(record.owners[0].sourceFactBindings.length, 2);
  assert.equal(projectNative44CurrentNativeModelRecords([record], expected).length, 2);
  const changed = structuredClone(expected); native44SnapshotNodes(changed.elements).get(record.owners[0].replacementRootId!)!.node.elements = []; assert.throws(() => projectNative44CurrentNativeModelRecords([record], changed), /root_missing|shell_changed/);
  (f.sourceBindings[0] as any).replacementComponentKey = 'new-two'; assert.throws(() => deriveNative44CurrentNativeModel(f), /contained_native_owner_scope/);
});
test('normally compiled pending form maps primary email units and separate dormant submit facts to exact leaf controls without reassigning frozen units', async t => {
  const f = await fixture(), dir = await mkdtemp(path.resolve('D:/cloneWP/tests/fixtures/.native-model-form-'));
  t.after(async () => { const checked = await realpath(dir); assert.ok(checked.startsWith(path.resolve('D:/cloneWP/tests/fixtures') + path.sep)); await rm(checked, { recursive: true }); });
  const put = async (name: string, value: unknown) => { const filename = path.join(dir, name), buffer = Buffer.from(JSON.stringify(value)); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, buffer); return { path: filename, sha256: hashV2(buffer) }; };
  const loaded = await loadNative44Knowledge(['container', 'heading', 'form']), projection = JSON.parse(await readFile(path.resolve('D:/cloneWP/tests/fixtures/native44-pending-form-registered.json'), 'utf8')), schema = projection.schema;
  f.schemas.form = schema; const registered = await put('registered.json', { mode: 'legacy-verified', legacySchemas: { form: schema }, versions: projection.versions, sourceProof: { schemaErrors: {} } }), sourceControls: any[] = [], appearanceRows: any[] = [];
  Object.assign(f.source, { version: 2, kind: 'source-facts' });
  for (const snapshot of f.source.snapshots) {
    const emailId = `${snapshot.id}-email`, submitId = `${snapshot.id}-submit`, formId = `${snapshot.id}-form`, emailFactId = `${snapshot.id}:old-one`, submitFactId = `${snapshot.id}:submit`;
    const form = JSON.stringify({ nodeId: formId, selector: `#${formId}`, submitControlNodeId: submitId, action: 'https://source.example/subscribe', method: 'post' }), interaction = (type: string, nodeId: string) => ({ id: `interaction-${nodeId}`, nodeId, regionId: 'old-one', kind: 'control', status: 'unobserved', selector: `#${nodeId}`, details: { type, nodeType: type, form } });
    const nodes = { [formId]: { id: formId, tag: 'form', parentId: null, regionId: 'old-one', selector: `#${formId}`, visible: true, childIds: [emailId, submitId], attributes: {} }, [emailId]: { id: emailId, tag: 'input', parentId: formId, regionId: 'old-one', selector: `#${emailId}`, visible: true, childIds: [], attributes: { type: 'email', placeholder: 'Enter email' }, styleId: 'email-style', layoutId: 'email-layout' }, [submitId]: { id: submitId, tag: 'input', parentId: formId, regionId: 'old-one', selector: `#${submitId}`, visible: true, childIds: [], attributes: { type: 'submit' }, styleId: 'submit-style', layoutId: 'submit-layout' } };
    const packet = { version: 2, kind: 'observation-packet', snapshot: { id: snapshot.id, viewport: snapshot.viewport }, nodes, styles: { 'email-style': { display: 'block', visibility: 'visible' }, 'submit-style': { display: 'block', visibility: 'visible' } }, layouts: { 'email-layout': { rect: { x: 0, y: 1, width: 200, height: 40 } }, 'submit-layout': { rect: { x: 200, y: 1, width: 80, height: 40 } } }, interactions: { email: interaction('email', emailId), submit: interaction('submit', submitId) } }, packetRef = await put(`${snapshot.id}-packet.json`, packet);
    Object.assign(snapshot.nodes, nodes); f.source.facts[emailFactId] = { id: emailFactId, kind: 'interaction', snapshotId: snapshot.id, regionId: 'old-one', nodeId: emailId, evidence: packetRef, value: packet.interactions.email }; f.source.facts[submitFactId] = { id: submitFactId, kind: 'interaction', snapshotId: snapshot.id, regionId: 'old-one', nodeId: submitId, evidence: packetRef, value: packet.interactions.submit };
    const primary = f.sourceUnits.find(unit => unit.id === `${snapshot.id}-old-one`)!; primary.ownerNodeId = emailId; primary.slots = [];
    f.sourceUnits.push({ id: `${snapshot.id}-dormant-submit`, snapshotId: snapshot.id, ownerNodeId: submitId, regionId: 'old-one', role: 'body', sourceFactIds: [submitFactId], slots: [], evidence: { factIds: [submitFactId], screenshots: [{ snapshotId: snapshot.id, screenshot: packetRef }], rationale: 'The submit fact belongs to its original separate dormant source unit.' } });
    sourceControls.push({ snapshotId: snapshot.id, emailFactId, submitFactId }); appearanceRows.push({ packet: packetRef, nodes: [nodes[emailId], nodes[submitId]] });
  }
  const sourceFacts = await put('source.json', f.source), appearance = await put('appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: appearanceRows });
  const knowledge = { path: path.resolve('D:/cloneWP/data/native44/index.json'), sha256: hashV2(await readFile('D:/cloneWP/data/native44/index.json')), fingerprint: loaded.index.fingerprint };
  const node: any = { kind: 'native', key: 'new-one-content', widgetType: 'form', sourceFactIds: sourceControls.flatMap(row => [row.emailFactId, row.submitFactId]), widgetSettings: { form_fields: [{ field_type: 'email', field_label: '', placeholder: 'Enter email', required: '', width: '100', custom_id: 'email' }], button_text: 'Subscribe', submit_actions: [], _attributes: NATIVE44_PENDING_FORM_ATTRIBUTES }, pendingForm: { version: 1, kind: 'native44-pending-form-v1', sourceControls, appearance, registered: { capabilities: registered, schemaHash: native44RegisteredSchemaHash(schema) }, knowledge: { fingerprint: loaded.index.fingerprint, formComponentHash: loaded.index.components.form.sha256, sharedControlsHash: loaded.index.sharedControls.sha256 } } };
  Object.assign(f.fragment, { sourceFacts, knowledge, goalProfile: 'component-reference-v1', requirementProfile: 'source-requirements-v1' }); (f.fragment.blocks[0] as any).children = [node]; f.frozenProgram.sourceFacts = sourceFacts; f.references.sourceFacts = sourceFacts; f.sourcePlan.sourceFacts = sourceFacts;
  f.contract = createNative44RequirementContract(f.source, f.sourceUnits, sourceFacts, f.frozenProgram.taskId); f.policy = { version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(f.contract), tolerances: [], acceptedDeviations: [] };
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: f.root, program: f.fragment }), options = { schemas: f.schemas, assets: [], knowledge: toNative44CompilerKnowledge(loaded, f.schemas), pendingForms }; f.compiled = compileNative44(f.fragment, options);
  const frozenUnits = canonicalV2(f.sourceUnits), contract = canonicalV2(f.contract), derived = deriveNative44CurrentNativeModel(f), owner = derived.owners[0];
  assert.equal(owner.sourceUnitIds.length, 2); assert.equal(owner.sourceFactBindings.length, 4); assert.equal(owner.nativeControls[0].widgetType, 'form');
  for (const binding of owner.sourceFactBindings) { assert.equal(binding.currentLeaf?.geometryOwner, 'native-control-leaf'); assert.equal(binding.currentLeaf?.runtimeInspection, 'required'); assert.equal(binding.currentElementIds[0], f.compiled.elementMap['new-one-content']); assert.equal(binding.originalUnitOwnershipChanged, false); if (binding.role === 'submit') assert.match(binding.originalUnitId, /dormant-submit/); }
  assert.ok(owner.requirements.filter(row => row.capability === 'form-submit').every(row => row.frozenFulfillmentRoute === 'gap' && row.currentLeafSelectors.every(selector => selector.includes('button.elementor-button'))));
  assert.equal(canonicalV2(f.sourceUnits), frozenUnits); assert.equal(canonicalV2(f.contract), contract);
  const settings = { ...f.before.settings, custom_css: compileNative44CSSModel(derived.model, { elements: derived.elements }).css }, expected = { ...f.before, elements: derived.elements, settings, hash: documentHashV2(derived.elements, settings) }, record = finalizeNative44CurrentNativeModelRecord(derived, expected);
  assert.equal(projectNative44CurrentNativeModelRecords([record], expected).length, 2);
  const enabled = structuredClone(expected), form = native44SnapshotNodes(enabled.elements).get(f.compiled.elementMap['new-one-content'])!.node; delete form.settings._attributes; form.settings.submit_actions = ['email'];
  assert.throws(() => projectNative44CurrentNativeModelRecords([record], enabled), /control_changed/);
});

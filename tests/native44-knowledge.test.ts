import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { assertAllowedWidget, NATIVE44_ALL_TYPES, NATIVE44_WIDGETS, validateNative44Catalog, verifyNative44Catalog } from '../src/native44/catalog.js';
import { loadNative44Knowledge, native44KnowledgeIdentity, toNative44CompilerKnowledge, type Native44Control } from '../src/native44/knowledge.js';
import { assertNative44RegisteredSettings, expandedNative44Controls, responsiveSettingKey, solveNative44Settings, evaluateNative44Condition } from '../src/native44/settings.js';
import { native44Usage } from '../src/native44/recipes.js';
import { normalizeImportedControl } from '../tools/import-native44-knowledge.js';

const controls = (rows: Native44Control[]) => ({ componentType: 'heading', controls: rows });
test('registered media URL emptiness accepts an exact pending task asset but never guesses literal URLs or unknown media',()=>{
  const component=controls([{id:'image',type:'media'},{id:'position',type:'text'}]);
  const registered:any={image:{type:'media',default:{url:''}},position:{type:'text',condition:{'image[url]!':''}}};
  assert.doesNotThrow(()=>assertNative44RegisteredSettings(component,{image:{$asset:'current-task-image'},position:'center'},registered));
  assert.throws(()=>assertNative44RegisteredSettings(component,{image:{},position:'center'},registered),/compound condition/);
  assert.throws(()=>assertNative44RegisteredSettings(component,{image:{$asset:''},position:'center'},registered),/compound condition/);
  registered.position.condition={'image[url]':'https://invented.example/a.png'};
  assert.throws(()=>assertNative44RegisteredSettings(component,{image:{$asset:'current-task-image'},position:'center'},registered),/compound condition/);
});
test('native44 loads the exact user catalog and rejects substitutes, duplicates and extras', async () => {
  assert.equal(NATIVE44_ALL_TYPES.length, 44); assert.equal(NATIVE44_WIDGETS.length, 43);
  await verifyNative44Catalog();
  const catalog = JSON.parse(await readFile('D:/cloneWP/config/native44-component-set.json', 'utf8'));
  validateNative44Catalog(catalog);
  for (const type of ['image', 'spacer', 'shortcode', 'n-carousel']) assert.throws(() => assertAllowedWidget(type), /not_allowed/);
  assert.throws(() => validateNative44Catalog({ ...catalog, components: [...catalog.components, catalog.components[0]] }), /count_or_duplicate/);
  const duplicate = structuredClone(catalog); duplicate.components[0] = duplicate.components[1]; assert.throws(() => validateNative44Catalog(duplicate), /count_or_duplicate/);
  const unknown: any = structuredClone(catalog); unknown.components[0].componentType = 'image'; assert.throws(() => validateNative44Catalog(unknown), /not_allowed/);
});
test('all 44 profiles retain qualified evidence and selective loading reads only requested components', async () => {
  const all = await loadNative44Knowledge(); assert.equal(Object.keys(all.components).length, 44);
  assert.equal(all.index.historicalEnvironment.woodmartCore, '1.1.6'); assert.equal(all.index.requiredEnvironment.woodmartCore, '1.1.8');
  assert.ok(all.index.sharedControls.count > 0);
  for (const [type, component] of Object.entries(all.components)) {
    assert.ok(component.controls.length > 0, type); assert.ok(component.usage.suitableFor.length > 0, type);
    assert.equal(component.evidence.targetRegistered, false); assert.ok(component.evidence.runtimeRetestRequired.length > 0, type);
  }
  assert.equal(all.components.wd_banner_carousel.evidence.interactionChanged, 0);
  assert.equal(all.components.wd_sidebar.evidence.usageVerified, 'source-only');
  const selected = await loadNative44Knowledge(['heading']); assert.deepEqual(Object.keys(selected.components), ['heading']);
  await assert.rejects(loadNative44Knowledge(['image']), /not_allowed/);
  await assert.rejects(loadNative44Knowledge(['heading', 'heading']), /duplicate_component_request/);
  const identity = await native44KnowledgeIdentity(); assert.equal(identity.knowledge.fingerprint, all.index.fingerprint);
});
test('knowledge component and shared-control bytes are checked before use', async () => {
  const temp = await mkdtemp('D:/cloneWP/runs/native44-knowledge-test-');
  try {
    // Only the three files this assertion actually reads: the loader verifies the
    // index, the shared controls and the requested component, so a full 44-component
    // copy would leave ~100 files to clean up per run for no extra coverage.
    await mkdir(path.join(temp, 'components'), { recursive: true });
    for (const name of ['index.json', 'shared-controls.json', 'components/heading.json']) {
      await cp(path.join('D:/cloneWP/data/native44', name), path.join(temp, name));
    }
    const file = path.join(temp, 'components/heading.json'); await writeFile(file, (await readFile(file, 'utf8')) + ' ');
    await assert.rejects(loadNative44Knowledge(['heading'], temp), /knowledge_hash_mismatch/);
  } finally { await rm(temp, { recursive: true, force: true }).catch(() => undefined); }
});
test('resources, form actions, calibration samples and source URLs never become recipe defaults', () => {
  const raw = { id: 'query_posts_ids', type: 'query', valueDomain: { options: [{ value: 151, label: 'Old product' }], calibrationSamples: [151], calibrationSampleKind: 'product' }, defaultValue: [151] };
  const normalized = normalizeImportedControl(raw, new Set()); assert.equal(normalized.defaultValue, undefined); assert.deepEqual(normalized.valueDomain?.options, []); assert.equal(normalized.valueDomain?.calibrationSamples, undefined);
  for (const id of ['form_id', 'sidebar_name', 'email_to', 'slack_webhook']) {
    const safe = normalizeImportedControl({ id, type: 'text', valueDomain: { options: [{ value: 'old-lab-resource' }] }, defaultValue: 'old-lab-resource' }, new Set());
    assert.equal(safe.defaultValue, undefined); assert.deepEqual(safe.valueDomain?.options, []);
  }
  assert.equal(normalizeImportedControl({ id: 'other', type: 'text', defaultValue: 'https://old.example.test/image.png' }, new Set()).defaultValue, undefined);
});
test('actual imported profiles contain no historical resource samples or dynamic defaults', async () => {
  const knowledge = await loadNative44Knowledge();
  const visit = (control: Native44Control) => {
    assert.equal(control.valueDomain?.calibrationSamples, undefined, control.id);
    if (control.defaultPolicy === 'task-resource-required') assert.equal(control.defaultValue, undefined, control.id);
    for (const child of control.repeater?.fields || []) visit(child);
  };
  Object.values(knowledge.components).forEach(component => component.controls.forEach(visit));
  assert.equal(knowledge.components.wd_sidebar.usage.primaryContentFields[0], 'sidebar_name');
});
test('slider validates selected unit range, step and shape without numeric coercion of enum values', () => {
  const component = controls([{ id: 'width', type: 'slider', valueDomain: { type: 'slider', size_units: ['px', '%'], range: { px: { min: 500, max: 1600, step: 20 }, '%': { min: 10, max: 100, step: 0.5 } } } }]);
  assert.equal(solveNative44Settings(component, { width: { unit: 'px', size: 4000 } }).ok, false);
  assert.equal(solveNative44Settings(component, { width: { unit: 'px', size: 510 } }).ok, false);
  assert.equal(solveNative44Settings(component, { width: { unit: '%', size: 20.5, sizes: [] } }).ok, true);
  assert.equal(solveNative44Settings(component, { width: { unit: 'em', size: 20 } }).ok, false);
  assert.equal(solveNative44Settings(component, { width: 1000 }).ok, false);
  assert.equal(solveNative44Settings(component, { width: { unit: 'px', size: Infinity } }).ok, false);
  assert.equal(solveNative44Settings(component, { width: null }).ok, false);
  assert.equal(solveNative44Settings(controls([{ id: 'choice', valueDomain: { type: 'select', options: [{ value: '1' }] } }]), { choice: 1 }).ok, false);
});
test('dimensions validate each edge, boolean link flag, declared unit and unknown shape fields', () => {
  const component = controls([{ id: 'padding', type: 'dimensions', valueDomain: { type: 'dimensions', size_units: ['px'], range: { px: { min: 0, max: 100, step: 1 } } } }]);
  assert.equal(solveNative44Settings(component, { padding: { unit: 'px', top: 10, right: '', bottom: 4, left: 3, isLinked: false } }).ok, true);
  assert.equal(solveNative44Settings(component, { padding: { unit: 'px', top: 101 } }).ok, false);
  assert.equal(solveNative44Settings(component, { padding: { unit: 'px', top: 4, isLinked: 'yes' } }).ok, false);
  assert.equal(solveNative44Settings(component, { padding: { unit: 'px', color: 'red' } }).ok, false);
});
test('responsive keys are expanded once and only from source declarations', () => {
  const map = expandedNative44Controls([{ id: 'width', responsive: true }, { id: 'width_tablet', responsive: true }, { id: 'custom', responsive: true, devices: ['desktop', 'laptop'] }]);
  assert.ok(map.has('width_tablet')); assert.ok(map.has('width_mobile')); assert.ok(map.has('custom_laptop'));
  assert.equal(map.has('width_tablet_tablet'), false); assert.equal(map.has('custom_mobile'), false);
  assert.throws(() => responsiveSettingKey('width_tablet', 'tablet'), /suffix_already_present/);
  assert.equal(solveNative44Settings(controls([...map.values()]), { width_tablet_tablet: 5 }).ok, false);
});
test('component and repeater condition scopes use their own drivers and preserve deterministic identities', () => {
  const component = controls([
    { id: 'mode', defaultValue: 'show', defaultPolicy: 'source-declared' },
    { id: 'items', repeater: { itemIdentityField: '_id', fields: [
      { id: 'mode', defaultValue: 'local', defaultPolicy: 'source-declared' },
      { id: 'title', condition: { type: 'predicate', field: 'mode', operator: 'equals', value: 'local', scope: 'repeater:items' } },
      { id: 'rootOnly', condition: { type: 'predicate', field: 'mode', operator: 'equals', value: 'show', scope: 'component' } },
    ] } },
  ]);
  const input = { items: [{ title: 'A', rootOnly: 'B' }, { title: 'C', mode: 'hidden' }] };
  const first = solveNative44Settings(component, input); const second = solveNative44Settings(component, input);
  assert.equal(first.ok, true, first.errors.join('\n')); assert.deepEqual(first.settings, second.settings);
  const items = first.settings.items as Record<string, unknown>[]; assert.equal(items[0].title, 'A'); assert.equal(items[0].rootOnly, 'B'); assert.equal(items[1].title, undefined); assert.notEqual(items[0]._id, items[1]._id);
  assert.equal(first.settings.mode, 'show'); assert.equal((input.items[0] as any)._id, undefined);
  assert.equal(solveNative44Settings(component, { items: [{ _id: 'same' }, { _id: 'same' }] }).ok, false);
  assert.equal(solveNative44Settings(component, { items: [{ unknown: 'x' }] }).ok, false);
});
test('conditions resolve compound fields and unknown scopes fail instead of using the wrong owner', () => {
  assert.equal(evaluateNative44Condition({ type: 'predicate', field: 'link[url]', operator: 'not-empty', scope: 'component' }, { link: { url: '/store' } }), true);
  assert.equal(evaluateNative44Condition({ type: 'predicate', field: 'state', operator: 'equals', value: 'yes', scope: 'repeater:other' }, { state: 'yes' }, { state: 'yes' }, 'repeater:items'), false);
});
test('local and target controls remain separate contracts', async () => {
  const knowledge = await loadNative44Knowledge(['heading']);
  const bridge = toNative44CompilerKnowledge(knowledge, { heading: { controls: { title: { type: 'textarea' } } } });
  assert.ok(bridge.controlsByWidget.heading.has('align_tablet'));
  bridge.validateSettings('heading', { title: 'Panel editable' });
  assert.throws(() => bridge.validateSettings('heading', { title: 'Text', align: 'center' }), /not registered/);
  assert.throws(() => bridge.validateSettings('image', {}), /not_allowed/);
});
test('actual target range, step and control type are stricter independent gates', () => {
  const component = controls([{ id: 'width', type: 'slider', valueDomain: { type: 'slider', size_units: ['px'], range: { px: { min: 0, max: 1000, step: 1 } } } }]);
  const registered = { width: { type: 'slider', size_units: ['px'], range: { px: { min: 0, max: 100, step: 10 } } } };
  assert.doesNotThrow(() => assertNative44RegisteredSettings(component, { width: { unit: 'px', size: 80 } }, registered));
  assert.throws(() => assertNative44RegisteredSettings(component, { width: { unit: 'px', size: 200 } }, registered), /above 100/);
  assert.throws(() => assertNative44RegisteredSettings(component, { width: { unit: 'px', size: 25 } }, registered), /step 10/);
  assert.throws(() => assertNative44RegisteredSettings(component, { width: { unit: 'px', size: 80 } }, { width: { type: 'number' } }), /type mismatch/);
  assert.throws(() => assertNative44RegisteredSettings(component, { width: { unit: 'px', size: 80 } }, { width: { type: 'slider', range: '[MaxDepth]' } }), /range contract is unverified/);
});
test('actual flat compound and rich conditions are evaluated rather than silently accepted', () => {
  const component = controls([{ id: 'mode', type: 'select' }, { id: 'link', type: 'url' }, { id: 'title', type: 'text' }]);
  const raw = {
    mode: { type: 'select', options: { show: 'Show', hide: 'Hide' }, default: 'hide' },
    link: { type: 'url', default: { url: '' } },
    title: { type: 'text', condition: { 'link[url]!': '' }, conditions: { relation: 'or', terms: [{ name: 'mode', operator: '===', value: 'show' }, { name: 'mode', operator: '===', value: 'also-show' }] } },
  };
  assert.doesNotThrow(() => assertNative44RegisteredSettings(component, { mode: 'show', link: { url: '/actual' }, title: 'Text' }, raw));
  assert.throws(() => assertNative44RegisteredSettings(component, { mode: 'hide', link: { url: '/actual' }, title: 'Text' }, raw), /inactive setting/);
  assert.throws(() => assertNative44RegisteredSettings(component, { mode: 'show', link: { url: '' }, title: 'Text' }, raw), /inactive setting/);
  assert.throws(() => assertNative44RegisteredSettings(component, { title: 'Text' }, { ...raw, title: { type: 'text', conditions: { relation: 'or', terms: [{ name: 'mode', value: 'hide' }, { name: 'unknown', value: 'yes' }] } } }), /driver is unverified/);
  assert.throws(() => assertNative44RegisteredSettings(component, { title: 'Text' }, { ...raw, title: { type: 'text', conditions: { terms: [{ name: 'mode', operator: 'unsupported', value: 'show' }] } } }), /unsupported or incomplete/);
  assert.throws(() => assertNative44RegisteredSettings(component, { title: 'Text' }, { ...raw, title: { type: 'text', conditions: { terms: [{ name: 'mode', value: 'hide', scope: 'repeater:missing' }] } } }), /scope is unverified/);
  assert.throws(() => assertNative44RegisteredSettings(component, { title: 'Text' }, { ...raw, title: { type: 'text', conditions: { terms: [] } } }), /incomplete/);
});
test('actual Repeater field contracts and local scopes are validated recursively', () => {
  const component = controls([{ id: 'mode', type: 'select' }, { id: 'items', type: 'repeater', repeater: { fields: [
    { id: '_id', type: 'text' }, { id: 'mode', type: 'select' }, { id: 'label', type: 'text' },
  ] } }]);
  const raw = { mode: { type: 'select' }, items: { type: 'repeater', fields: [
    { name: 'mode', type: 'select', options: { show: 'Show', hide: 'Hide' }, default: 'hide' },
    { name: 'label', type: 'text', condition: { mode: 'show' } },
  ] } };
  assert.doesNotThrow(() => assertNative44RegisteredSettings(component, { mode: 'hide', items: [{ _id: 'a123456', mode: 'show', label: 'A' }] }, raw));
  assert.throws(() => assertNative44RegisteredSettings(component, { mode: 'show', items: [{ _id: 'a123456', mode: 'hide', label: 'A' }] }, raw), /inactive setting/);
  assert.throws(() => assertNative44RegisteredSettings(component, { items: [{ _id: 'a123456', mode: 'show', label: 'A' }] }, { ...raw, items: { type: 'repeater', fields: [{ name: 'mode', type: 'select' }] } }), /field contract is unverified/);
  assert.throws(() => assertNative44RegisteredSettings(component, { items: [{ mode: 'show' }] }, { ...raw, items: { type: 'repeater' } }), /repeater field contract is unverified/);
});
test('nested relationships and product recipes do not confuse content repeaters with fixed children', () => {
  assert.equal(native44Usage('wd_toggle').nested?.policy, 'fixed');
  assert.equal(native44Usage('nested-carousel').nested?.policy, 'repeater');
  assert.equal(native44Usage('wd_banner_carousel').nested, undefined);
  assert.equal(native44Usage('slides').contentModel, 'repeater');
  assert.equal(native44Usage('wd_products_tabs').queryAdapter, 'wd_products_tabs');
  assert.ok(native44Usage('html').restrictions.some(rule => rule.includes('普通标题')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildNative44StyleCapabilities, classifyNative44StyleControl, findNative44StyleCapability, getNative44StyleCapabilitiesForType, native44StyleTemplateFields, readNative44StyleVariableConsumers, readNative44StyleWrapperClasses } from '../src/native44/style-capabilities.js';
import { loadNative44Knowledge, type Native44Control } from '../src/native44/knowledge.js';

const loaded = loadNative44Knowledge();
const fullCatalog = loaded.then(knowledge => buildNative44StyleCapabilities(knowledge));

test('all 44 component controls and nested fields are classified once without claiming current registration or rendering', async () => {
  const knowledge = await loaded, catalog = await fullCatalog;
  assert.equal(Object.keys(catalog.components).length, 44);
  assert.equal(catalog.coverage.complete44, true);
  assert.equal(catalog.coverage.rootControlOccurrences, Object.values(knowledge.components).reduce((sum, component) => sum + component.controls.length, 0));
  assert.equal(Object.values(catalog.coverage.categories).reduce((sum, count) => sum + count, 0), catalog.coverage.controlOccurrences);
  assert.ok(catalog.coverage.controlOccurrences > catalog.coverage.rootControlOccurrences);
  assert.ok(catalog.coverage.uniqueCapabilities < catalog.coverage.controlOccurrences);
  for (const [componentType, component] of Object.entries(knowledge.components)) {
    const actual = getNative44StyleCapabilitiesForType(catalog, componentType);
    for (const control of component.controls) assert.ok(actual.some(item => item.controlId === control.id && item.repeaterPath.length === 0), `${componentType}.${control.id}`);
    assert.equal(actual.length, catalog.components[componentType].counts.controls);
    for (const item of actual) {
      assert.equal(item.evidence.targetRegistered, false);
      assert.equal(item.evidence.renderedVerified, false);
      assert.equal(item.evidence.knowledgeFingerprint, knowledge.index.fingerprint);
    }
  }
  assert.equal(catalog.coverage.targetRegistered, false);
  assert.equal(catalog.coverage.renderedVerified, false);
  assert.throws(() => getNative44StyleCapabilitiesForType(catalog, 'image'), /not_allowed/);
});

test('shared advanced settings retain ordinary optimized and container differences rather than merging IDs', async () => {
  const catalog = await fullCatalog;
  const margins = catalog.sharedAdvanced.byControlId._margin;
  assert.ok(margins.variants.length >= 2);
  const templates = margins.variants.flatMap(item => catalog.controls[item.ref].effects);
  assert.ok(templates.some(item => item.selector.includes('elementor-widget-container')));
  assert.ok(templates.some(item => item.template.includes('--kit-widget-spacing')));
  const containerMargin = findNative44StyleCapability(catalog, 'container', 'margin');
  assert.equal(containerMargin?.controlId, 'margin');
  assert.ok(containerMargin?.effects.every(item => !item.template.includes('--kit-widget-spacing')));
  assert.ok(catalog.components.container.sharedAdvancedRefs.includes(containerMargin!.ref));
  assert.equal(findNative44StyleCapability(catalog, 'button', '_padding')?.control.responsive, true);
  assert.deepEqual(findNative44StyleCapability(catalog, 'button', '_padding')?.declaredDevices, ['desktop', 'tablet', 'mobile']);
  assert.deepEqual(findNative44StyleCapability(catalog, 'nested-tabs', 'tabs_justify_horizontal_mobile')?.declaredDevices, ['mobile']);
});

test('native controls preserve multi-effect dictionaries class modes and group preconditions as executable metadata', async () => {
  const catalog = await fullCatalog;
  const color = findNative44StyleCapability(catalog, 'button', 'button_text_color')!;
  assert.equal(color.nativeStyleEligible, true);
  assert.deepEqual(color.effects.map(item => item.property).sort(), ['color', 'fill']);
  const direction = findNative44StyleCapability(catalog, 'container', 'flex_direction')!;
  assert.ok(direction.effects.some(item => item.dictionaryValue === 'row' && item.property === '--flex-direction' && item.template === 'row'));
  assert.ok(direction.effects.some(item => item.dictionaryValue === 'row' && item.property === '--container-widget-align-self'));
  assert.ok(direction.dependencyFields.some(item => item.field === 'container_type'));
  const typography = findNative44StyleCapability(catalog, 'button', 'typography_typography')!;
  assert.equal(typography.mechanism, 'condition-driver');
  assert.ok(typography.drivesControls.includes('typography_font_size'));
  assert.equal(findNative44StyleCapability(catalog, 'button', 'button_type')?.mechanism, 'class-setting');
  assert.ok(color.evidence.packageHashes.elementor);
  assert.equal(findNative44StyleCapability(catalog, 'wd_button', 'color')?.mechanism, 'condition-driver');
});

test('raw custom CSS HTML business actions and resource data never count as native-style implementation', async () => {
  const catalog = await fullCatalog;
  for (const [componentType, controlId, expected] of [['button', 'custom_css', 'custom-css'], ['html', 'html', 'custom-css'], ['form', 'submit_actions', 'business-action'], ['form', 'email_to', 'business-action'], ['button', 'text', 'content-resource']]) {
    const capability = findNative44StyleCapability(catalog, componentType, controlId)!;
    assert.equal(capability.category, expected, `${componentType}.${controlId}`);
    assert.equal(capability.nativeStyleEligible, false);
  }
  assert.equal(classifyNative44StyleControl({ id: 'new_style', panel: { tab: 'style' }, effectClass: 'structural' }).mechanism, 'unresolved');
  assert.equal(classifyNative44StyleControl({ id: 'runtime', panel: { tab: 'content' }, effectTargets: { frontendAvailable: true } }).mechanism, 'frontend-setting');
});

test('cross-control selector template references create real native drivers without promoting resources or business actions', async () => {
  const catalog = await fullCatalog;
  const position = findNative44StyleCapability(catalog, 'button', 'button_box_shadow_box_shadow_position')!;
  assert.equal(position.mechanism, 'template-driver');
  assert.equal(position.nativeStyleEligible, true);
  assert.ok(position.templateDrivesControls.includes('button_box_shadow_box_shadow'));
  assert.deepEqual(findNative44StyleCapability(catalog, 'button', 'button_box_shadow_box_shadow')?.templateDependencyFields, [{ field: 'button_box_shadow_box_shadow_position', token: 'VALUE', scope: 'component' }]);
  assert.equal(classifyNative44StyleControl({ id: 'mode', panel: { tab: 'content' } }, { templateDrivesControls: ['shadow'] }).category, 'content-visual-driver');
  for (const control of [{ id: 'image', type: 'media', defaultPolicy: 'task-resource-required' as const }, { id: 'submit_actions', type: 'select2' }, { id: 'custom_css', type: 'code' }]) {
    assert.equal(classifyNative44StyleControl(control, { templateDrivesControls: ['paint'] }).nativeStyleEligible, false, control.id);
  }
  assert.deepEqual(native44StyleTemplateFields({ id: 'paint', scope: 'repeater:items', effectTargets: { selectors: { '{{WRAPPER}}': 'width:calc({{size.SIZE}}{{size.UNIT}} + {{VALUE}});color:{{ink.VALUE}}' } } }), [{ field: 'size', token: 'SIZE', scope: 'repeater:items' }, { field: 'size', token: 'UNIT', scope: 'repeater:items' }, { field: 'ink', token: 'VALUE', scope: 'repeater:items' }]);
});

test('repeater fields keep their local identity device declarations and exact parent-scoped dependencies', async () => {
  const knowledge = await loadNative44Knowledge(['heading']);
  knowledge.components.heading.controls = [
    { id: 'mode', type: 'select', panel: { tab: 'style' } },
    { id: 'items', type: 'repeater', repeater: { fields: [
      { id: 'mode', type: 'select', panel: { tab: 'style' } },
      { id: 'color', type: 'color', responsive: true, devices: ['desktop', 'mobile'], panel: { tab: 'style' }, condition: { type: 'predicate', field: 'mode', value: 'yes', scope: 'repeater:items' }, effectTargets: { selectors: { '{{WRAPPER}} {{CURRENT_ITEM}}': 'color: {{VALUE}}; background-image: url("data:text/plain;a:b"); content: "a;b";' } } },
    ] } },
  ] satisfies Native44Control[];
  const catalog = buildNative44StyleCapabilities(knowledge);
  assert.equal(catalog.coverage.complete44, false);
  const root = findNative44StyleCapability(catalog, 'heading', 'mode')!;
  const local = findNative44StyleCapability(catalog, 'heading', 'mode', ['items'])!;
  assert.equal(root.mechanism, 'unresolved');
  assert.equal(local.mechanism, 'condition-driver');
  assert.deepEqual(local.drivesControls, ['items.color']);
  const color = findNative44StyleCapability(catalog, 'heading', 'color', ['items'])!;
  assert.deepEqual(color.declaredDevices, ['desktop', 'mobile']);
  assert.equal(color.effects.length, 3);
  assert.equal(color.opaqueSelectorTemplates.length, 0);
  assert.ok(color.effects.some(item => item.template === '"a;b"'));
  assert.throws(() => getNative44StyleCapabilitiesForType(catalog, 'button'), /type_not_loaded/);
});

function zip(name: string, source: string): Buffer {
  const filename = Buffer.from(name), data = Buffer.from(source), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const header = Buffer.concat([local, filename, data]), directory = Buffer.concat([central, filename]);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(header.length, 16);
  return Buffer.concat([header, directory, end]);
}

test('CSS variable consumer evidence is read from hash-verified source bytes and never guessed from variable spelling', async () => {
  const directory = await mkdtemp('D:/cloneWP/runs/native44-style-capabilities-');
  try {
    const knowledge = await loadNative44Knowledge(['container']);
    knowledge.components.container.controls = [{ id: 'size', panel: { tab: 'style' }, effectTargets: { selectors: { '{{WRAPPER}}': '--test-size: {{SIZE}}{{UNIT}}' } } }];
    const source = '.parent{--test-size:2px;height:var(--test-size);width:calc(var(--test-size) + 1px);padding:var(--unrelated)}@media(max-width:768px){.child{margin:var(--test-size,0)}}';
    const bytes = zip('fixture/assets/frontend.css', source), digest = createHash('sha256').update(bytes).digest('hex');
    const filename = path.join(directory, 'fixture.zip'); await writeFile(filename, bytes);
    knowledge.index.source.packages = { fixture: { path: filename, sha256: digest, header: 'fixture/fixture.php', version: '1.0' } };
    knowledge.index.source.packageHashes = { fixture: digest };
    const consumers = await readNative44StyleVariableConsumers(knowledge);
    assert.deepEqual(consumers.map(item => item.property), ['height', 'width', 'margin']);
    assert.deepEqual(consumers.map(item => item.direct), [true, false, false]);
    assert.deepEqual(consumers[2].atRules, ['@media (max-width:768px)']);
    assert.equal(consumers[0].sourceSha256, createHash('sha256').update(source).digest('hex'));
    assert.equal(buildNative44StyleCapabilities(knowledge, { variableConsumers: consumers }).variableConsumers.length, 3);
    assert.throws(() => buildNative44StyleCapabilities(knowledge, { variableConsumers: [{ ...consumers[0], packageSha256: '0'.repeat(64) }] }), /consumer_evidence_invalid/);
    knowledge.index.source.packages.fixture.sha256 = '0'.repeat(64);
    await assert.rejects(readNative44StyleVariableConsumers(knowledge), /package_hash_mismatch/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve('D:/cloneWP/runs') + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('real installed package wrapper classes are derived from literal methods or proven inheritance, not guessed aliases', async context => {
  const knowledge = await loaded;
  for (const definition of Object.values(knowledge.index.source.packages ?? {})) {
    try { await access(definition.path); } catch { context.skip('The exact locally installed source archives are not available in this environment.'); return; }
  }
  const wrappers = await readNative44StyleWrapperClasses(knowledge);
  assert.equal(wrappers['nested-accordion'][0].className, 'elementor-widget-n-accordion');
  assert.equal(wrappers['nested-tabs'][0].className, 'elementor-widget-n-tabs');
  assert.equal(wrappers['nested-carousel'][0].className, 'elementor-widget-n-carousel');
  assert.equal(wrappers.wd_nested_carousel[0].className, 'wd-nested-carousel');
  assert.equal(wrappers.container[0].className, 'e-con');
  assert.equal(wrappers.container[0].method, 'add_render_attributes');
  assert.equal(wrappers.button[0].expression, 'get-name-concatenation');
  assert.equal(wrappers.button[0].getNameProof?.name, 'button');
  assert.ok(wrappers.button[0].inheritance.length >= 2);
  assert.ok(Object.values(wrappers).every(rows => rows.length > 0));
  for (const rows of Object.values(wrappers)) for (const proof of rows) {
    assert.equal(proof.packageSha256, knowledge.index.source.packageHashes[proof.packageId]);
    assert.match(proof.sourceSha256, /^[a-f0-9]{64}$/);
  }
  const selected = await loadNative44Knowledge(['nested-accordion']);
  const catalog = buildNative44StyleCapabilities(selected, { wrapperClassesByType: wrappers });
  assert.equal(catalog.wrapperClassesByType['nested-accordion'][0].className, 'elementor-widget-n-accordion');
  assert.throws(() => buildNative44StyleCapabilities(selected, { wrapperClassesByType: { 'nested-accordion': [{ ...wrappers['nested-accordion'][0], packageSha256: '0'.repeat(64) }] } }), /wrapper_class_evidence_invalid/);
});

test('unknown dynamic wrapper expressions and commented-out method examples never manufacture wrapper proof', async () => {
  const directory = await mkdtemp('D:/cloneWP/runs/native44-wrapper-capabilities-');
  try {
    const knowledge = await loadNative44Knowledge(['heading']);
    const source = `<?php\nnamespace Fixture;\nclass UnknownWrapper {\n/*\n protected function get_html_wrapper_class() { return 'comment-only-wrapper'; }\n*/\n public function get_name() { return 'heading'; }\n protected function get_html_wrapper_class() { return $this->settings['class']; }\n}\n`;
    const bytes = zip('fixture/widget.php', source), digest = createHash('sha256').update(bytes).digest('hex');
    const filename = path.join(directory, 'fixture.zip'); await writeFile(filename, bytes);
    knowledge.index.source.packages = { fixture: { path: filename, sha256: digest, header: 'fixture/fixture.php', version: '1.0' } };
    knowledge.index.source.packageHashes = { fixture: digest };
    knowledge.components.heading.sourceOwnership = { primary: { symbol: 'Fixture\\UnknownWrapper', packageId: 'fixture', entry: 'fixture/widget.php', sourceSha256: createHash('sha256').update(source).digest('hex') } };
    assert.deepEqual(await readNative44StyleWrapperClasses(knowledge), { heading: [] });
    knowledge.index.source.packages.fixture.sha256 = '0'.repeat(64);
    await assert.rejects(readNative44StyleWrapperClasses(knowledge), /package_hash_mismatch/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve('D:/cloneWP/runs') + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, validateRegisteredSettings } from '../src/planning/plan.js';
import { redactor, projectSchema } from '../src/core/config.js';
import { acquireLock } from '../src/core/files.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const composition = { elements: [{ id: 'aa00001', elType: 'container', settings: { flex_direction: 'column' }, elements: [{ id: 'aa00002', elType: 'widget', widgetType: 'heading', settings: { title: 'Observed heading' }, elements: [] }] }] };
const makePlan = (data: unknown = composition) => ({ title: 'Clone', mode: 'legacy-verified', compositionJson: JSON.stringify(data), mappings: [{ sourceId: 'source1', targetId: 'aa00002' }], unsupported: [], rationale: 'Evidence' });
const options = { mode: 'legacy-verified', sourceIds: new Set(['source1']), widgetSchemas: { container: { controls: { flex_direction: { type: 'select', options: { column: 'Column', row: 'Row' } } } }, heading: { controls: { title: { type: 'text' } } } } };

test('requires discovered native settings and real source mappings', () => {
  const result = validatePlan(makePlan(), options);
  assert.equal(result.elementMap.source1, 'aa00002');
  const bad = structuredClone(composition); bad.elements[0].elements[0].settings = { imagined_style: 'red' } as never;
  assert.throws(() => validatePlan(makePlan(bad), options), /Undiscovered setting/);
  assert.throws(() => validatePlan({ ...makePlan(), mappings: [{ sourceId: 'invented', targetId: 'aa00002' }] }, options), /invents source/);
});
test('rejects HTML page substitution, executable content, duplicate IDs and mode changes', () => {
  const bad = structuredClone(composition); bad.elements[0].elements[0].widgetType = 'html';
  assert.throws(() => validatePlan(makePlan(bad), options), /editable/);
  bad.elements[0].elements[0].widgetType = 'heading'; bad.elements[0].elements[0].settings.title = '<img onerror="run()">';
  assert.throws(() => validatePlan(makePlan(bad), options), /Executable/);
  const duplicate = structuredClone(composition); duplicate.elements[0].elements[0].id = 'aa00001';
  assert.throws(() => validatePlan(makePlan(duplicate), options), /unique/);
  assert.throws(() => validatePlan({ ...makePlan(), mode: 'native-v4' }, options), /changed target mode/);
});
test('redacts spaced/normalized app passwords and auth headers', () => {
  const redact = redactor({ wp_user: 'a', wp_app_password: 'ab cd ef' });
  assert.equal(redact('ab cd ef abcdef'), '[REDACTED] [REDACTED]');
  assert.ok(!redact('Authorization: Basic aGVsbG8=').includes('aGVsbG8='));
  assert.equal(redact('https://x/?token=secret'), 'https://x/?token=[REDACTED]');
});
test('target lock prevents simultaneous site mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-lock-'));
  try { const release = await acquireLock(root); await assert.rejects(acquireLock(root), /owns the target lock/); await release(); const next = await acquireLock(root); await next(); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('configuration declares the final delivery status and rejects other WordPress states', () => { for (const status of ['draft', 'publish']) assert.equal(projectSchema.shape.pageStatus.safeParse(status).success, true); for (const status of ['pending', 'private', 'future', 'trash']) assert.equal(projectSchema.shape.pageStatus.safeParse(status).success, false); });
test('model cannot override target routing in Atomic or legacy composition', () => {
  assert.throws(() => validatePlan(makePlan({ ...composition, post_id: 1 }), options), /Unsupported composition field/);
  const atomic = { title: 'Atomic', mode: 'native-v4', compositionJson: JSON.stringify({ xml_structure: '<e-div-block configuration-id="root"/>', element_config: { root: {} }, style: {}, post_id: 1 }), mappings: [], unsupported: [], rationale: 'Evidence' };
  assert.throws(() => validatePlan(atomic, { mode: 'native-v4' }), /Unsupported composition field/);
});
test('enum controls reject numeric values instead of coercing them', () => {
  const bad = structuredClone(composition); bad.elements[0].settings.flex_direction = 12 as never;
  assert.throws(() => validatePlan(makePlan(bad), options), /Invalid setting option/);
});
test('image controls require imported real attachment identity', () => {
  const image = { elements: [{ id: 'aa00002', elType: 'widget', widgetType: 'image', settings: { image: { id: 99, url: 'https://elsewhere.invalid/image.png' } }, elements: [] }] };
  const imageOptions = { ...options, widgetSchemas: { image: { controls: { image: { type: 'media' } } } }, allowedMedia: [{ attachmentId: 77, url: 'https://target.example/image.png', sourceUrl: 'https://source.example/image.png' }] };
  assert.throws(() => validatePlan(makePlan(image), imageOptions), /imported attachment/);
  image.elements[0].settings.image = { id: 77, url: 'https://target.example/image.png' };
  assert.doesNotThrow(() => validatePlan(makePlan(image), imageOptions));
});
test('dimensional units and declared mode conditions are checked', () => {
  const settings = { mode: 'classic', height: { size: 80, unit: 'px' } };
  const tree = { elements: [{ id: 'aa00002', elType: 'container', settings, elements: [] }] };
  const dimensionOptions = { ...options, widgetSchemas: { container: { controls: { mode: { type: 'select', options: { classic: 'Classic', custom: 'Custom' } }, height: { type: 'slider', condition: { mode: 'custom' }, size_units: ['px', 'vh'], range: { px: { min: 0, max: 100 } } } } } } };
  assert.throws(() => validatePlan(makePlan(tree), dimensionOptions), /Inactive setting/);
  tree.elements[0].settings.mode = 'custom';
  assert.doesNotThrow(() => validatePlan(makePlan(tree), dimensionOptions));
  tree.elements[0].settings.height.unit = 'unknown';
  assert.throws(() => validatePlan(makePlan(tree), dimensionOptions), /unit/);
});

test('registered scalar conditions use native membership for actual multi-select controls', () => {
  const schema = { controls: { actions: { type: 'select2', default: ['database'] }, metadata: { type: 'select2', condition: { actions: 'database' } }, excluded: { type: 'text', condition: { 'actions!': 'email' } } } };
  assert.doesNotThrow(() => validateRegisteredSettings('form', { actions: ['database'], metadata: [], excluded: 'Safe' }, schema));
  assert.doesNotThrow(() => validateRegisteredSettings('form', { metadata: [] }, schema));
  assert.throws(() => validateRegisteredSettings('form', { actions: ['email'], metadata: [] }, schema), /Inactive setting form.metadata/);
  assert.throws(() => validateRegisteredSettings('form', { actions: [], metadata: [] }, schema), /Inactive setting form.metadata/);
  assert.throws(() => validateRegisteredSettings('form', { actions: ['database', 'email'], excluded: 'Unsafe' }, schema), /Inactive setting form.excluded/);
  assert.doesNotThrow(() => validateRegisteredSettings('form', { actions: ['database'], excluded: 'Safe' }, schema));
});
test('declared custom dimension expressions work and UI drag ranges do not clamp native values', () => {
  const tree = { elements: [{ id: 'aa00002', elType: 'container', settings: { width: { size: 640 as string | number, unit: 'px' } }, elements: [] }] };
  const widthOptions = { ...options, widgetSchemas: { container: { controls: { width: { type: 'slider', size_units: ['px', 'custom'], range: { px: { min: 0, max: 500 } } } } } } };
  assert.doesNotThrow(() => validatePlan(makePlan(tree), widthOptions));
  tree.elements[0].settings.width = { size: 'min(100%, 640px)', unit: 'custom' };
  assert.doesNotThrow(() => validatePlan(makePlan(tree), widthOptions));
  tree.elements[0].settings.width = { size: 'url(https://private/)', unit: 'custom' };
  assert.throws(() => validatePlan(makePlan(tree), widthOptions), /Invalid dimension/);
});
test('real section aliases normalize to primary source nodes without invented evidence', () => {
  const input = { ...makePlan(), mappings: [{ sourceId: 'source1', targetId: 'aa00002' }, { sourceId: 'section-source1', targetId: 'aa00002' }] };
  const result = validatePlan(input, { ...options, sourceAliases: { 'section-source1': 'source1' } });
  assert.deepEqual(result.plan.mappings, [{ sourceId: 'source1', targetId: 'aa00002' }]);
  assert.equal(Object.keys(result.elementMap).length, 1);
});
test('custom HTML attributes cannot introduce executable handlers or alternate media', () => {
  const tree = { elements: [{ id: 'aa00002', elType: 'widget', widgetType: 'heading', settings: { _attributes: 'onclick|send()' }, elements: [] }] };
  const attributes = { ...options, widgetSchemas: { heading: { controls: { _attributes: { type: 'textarea' } } } } };
  assert.throws(() => validatePlan(makePlan(tree), attributes), /HTML attribute/);
  tree.elements[0].settings._attributes = 'dir|rtl\nlang|ar';
  assert.doesNotThrow(() => validatePlan(makePlan(tree), attributes));
  const embedded = structuredClone(composition); embedded.elements[0].elements[0].settings.title = '<img src="https://unregistered.invalid/a.png">';
  assert.throws(() => validatePlan(makePlan(embedded), options), /embedded media/);
});

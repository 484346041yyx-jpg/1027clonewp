import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFullReplicaArguments } from '../src/replica-full/cli.js';
import { catalogSchema } from '../src/configurator/contract.js';
import { widgetSettings } from '../src/configurator/compile.js';
import { prepareConfiguratorCatalogRevision, reconcileConfiguratorCatalogRevision } from '../src/configurator/flow.js';
import type { ElementorElement } from '../src/wordpress/types.js';

const media = { id: 123, url: 'https://target.example/wp-content/uploads/bottle.png' };
function catalog() { const part = (id: string) => ({ id, label: id, image: media, preview: media,
  position: { x: 0, y: 0, width: 100, height: 100 }, fit: ['visual-only'], attributes: {} });
  return catalogSchema.parse({ version: 1, title: 'Build a bottle', bottles: [part('bottle')],
    pumps: [part('pump')], caps: [part('cap')], decorations: [], fonts: [{ id: 'arial', label: 'Arial', family: 'Arial' }],
    logoArea: { x: 20, y: 20, width: 60, height: 60 },
    form: { widgetId: 'bbbbbbb', summaryField: 'configuration', uploadField: 'logo' } }); }
function tree(old = catalog()): ElementorElement[] { return [
  { id: 'aaaaaaa', elType: 'container', settings: {}, elements: [
    { id: 'ddddddd', elType: 'widget', widgetType: 'heading', settings: { title: 'Source heading' }, elements: [] },
    { id: 'ccccccc', elType: 'widget', widgetType: 'clonewp_bottle_configurator', settings: widgetSettings(old), elements: [] },
  ] },
  { id: 'bbbbbbb', elType: 'widget', widgetType: 'form', settings: { submit_actions: ['save-to-database', 'email'],
    form_fields: [{ _id: 'eeeeeee', custom_id: 'configuration', field_type: 'hidden' },
      { _id: 'fffffff', custom_id: 'logo', field_type: 'upload' }] }, elements: [] },
]; }

test('catalog revision CLI requires an exact run, catalog file, and fingerprint', () => {
  const args = ['revise-configurator-catalog', '--run-dir', 'D:/cloneWP/runs/example',
    '--catalog', 'D:/cloneWP/catalog.json', '--package-manifest', 'D:/cloneWP/package/manifest.json',
    '--expected-fingerprint', 'a'.repeat(64)];
  assert.equal(parseFullReplicaArguments(args).command, 'revise-configurator-catalog');
  assert.throws(() => parseFullReplicaArguments(args.slice(0, -2)), /required_argument/);
  assert.throws(() => parseFullReplicaArguments([...args, '--page-id', '999']), /arguments_invalid/);
  assert.throws(() => parseFullReplicaArguments([...args.slice(0, -1), 'stale']), /fingerprint_invalid/);
});

test('same-media catalog revision changes only one saved widget and reconciles by exact tree', () => {
  const oldCatalog = catalog(), newCatalog = catalog(); newCatalog.bottles[0].label = 'Replacement label';
  const before = tree(oldCatalog);
  const revised = prepareConfiguratorCatalogRevision({ taskId: 'task-run', pageId: 203,
    targetOrigin: 'https://target.example', slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb',
    priorOperationId: 'prior-operation', settingsHash: 'a'.repeat(64), baseElements: before, oldCatalog, newCatalog });
  assert.deepEqual(revised.elements[0].elements[0], before[0].elements[0]);
  assert.deepEqual(revised.elements[1], before[1]);
  assert.equal((revised.elements[0].elements[1].settings.options as Array<{ label: string }>)[0].label, 'Replacement label');
  assert.equal(reconcileConfiguratorCatalogRevision(revised.intent, before), 'not-applied');
  assert.equal(reconcileConfiguratorCatalogRevision(revised.intent, revised.elements), 'applied');
  const drift = structuredClone(revised.elements); drift[1].settings.email_to = 'attacker@example';
  assert.throws(() => reconcileConfiguratorCatalogRevision(revised.intent, drift), /conflict/);
  newCatalog.bottles[0].image = { id: 124, url: 'https://target.example/replacement.png' };
  assert.throws(() => prepareConfiguratorCatalogRevision({ taskId: 'task-run', pageId: 203,
    targetOrigin: 'https://target.example', slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb',
    priorOperationId: 'prior-operation', settingsHash: 'a'.repeat(64), baseElements: before, oldCatalog, newCatalog }), /media_or_form/);
});

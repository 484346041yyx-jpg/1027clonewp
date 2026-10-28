import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationPolicyFixture } from './helpers/preparation-policy-fixture.js';
import { preparationSharedHash, validatePreparationPlan } from '../src/replica-preparation/contract.js';
import { validateFullReplicaManifest } from '../src/replica-full/contract.js';
import type { FullReplicaConfiguratorSpec } from '../src/replica-full/types.js';

const sha = 'a'.repeat(64), ref = (path: string) => ({ path, sha256: sha });
const header = { headerId: 'header_123', name: 'Existing header', editUrl: 'https://target.example/wp-admin/admin.php?page=xts_header_builder#/builder/header_123', sharedHash: sha, headerHash: sha, menuHash: sha, styleHash: sha, footerHash: sha, menus: [], blocks: [], mobileMaxWidth: 768, hasSubmenus: false };
function spec(): FullReplicaConfiguratorSpec { return {
  version: 1, kind: 'clonewp-bottle-configurator', widgetType: 'clonewp_bottle_configurator', sourceUrl: 'https://source.example/', sourceUnitIds: ['unit0'], sourceFactIds: ['fact0'],
  slotComponentKey: 'section0_slot', formComponentKey: 'section0_form', widgetKey: 'section0_configurator',
  catalogTemplate: ref('catalog-unbound.json'), imageManifest: ref('native-images.json'), mediaKeys: ['reference-bottles-1'], sourceEvidence: [ref('desktop.jpg'), ref('phone.jpg')],
  packageManifest: ref('package.json'), registrationEvidence: ref('registration.json'), packageFiles: { php: sha, js: sha, css: sha },
}; }
function plan() {
  const value = preparationPolicyFixture(1);
  delete value.headerBase; delete value.headerAssets;
  value.reusedHeader = header;
  value.pageScope = 'body-only';
  value.responsive!.decisions!.header = { mode: 'reuse-readonly', requestRef: 'Task requests the current production header unchanged.', reason: 'Existing header is verified and remains shared by this task.', headerId: header.headerId, sharedHash: header.sharedHash, evidence: [ref('header-proof.json')] };
  value.configurator = spec();
  return value;
}
test('new body-only preparation freezes a scoped configurator without adding it to the native catalog', () => {
  const value = plan(), frozen = validatePreparationPlan(value);
  assert.equal(frozen.configurator?.widgetType, 'clonewp_bottle_configurator');
  const without = structuredClone(value); delete without.configurator;
  assert.notEqual(preparationSharedHash(value), preparationSharedHash(without));
  assert.deepEqual(frozen.bodyBase.componentCatalog, value.bodyBase.componentCatalog);
});
test('configurator scope rejects unrelated facts, duplicate media keys and old tasks', () => {
  const value = plan();
  assert.throws(() => validatePreparationPlan({ ...value, configurator: { ...spec(), sourceFactIds: ['other'] } }), /configurator_scope/);
  assert.throws(() => validatePreparationPlan({ ...value, configurator: { ...spec(), mediaKeys: ['same','same'] } }), /configurator_scope/);
  assert.throws(() => validatePreparationPlan({ ...value, version: 7 }));
  assert.throws(() => validatePreparationPlan({ ...value, configurator: { ...spec(), widgetType: 'html' } }), /plan_invalid/);
});
test('full v4 body manifest preserves source-bound configurator and rejects out-of-scope units', () => {
  const value = plan(), c = spec();
  const manifest = { version: 4, kind: 'clonewp-full-replica', taskId: value.taskId, runId: value.runId, title: value.title, slug: value.slug, sourceUrl: value.sourceUrl, targetOrigin: value.targetOrigin,
    headerProvider: 'reused-woodmart-header', pageScope: 'body-only', reusedHeader: header, responsive: { ...value.responsive, sections: [{ key: 'section0', mode: 'shared', reason: 'The same source-owned content remains visible on mobile.', evidence: [{ snapshotId: 'phone-390', nodeId: 'root' }, { snapshotId: 'phone-430', nodeId: 'root' }], settings: [], childOrders: [], css: '' }] }, sourceEvidence: ref('source.json'), sourcePartition: value.sourcePartition,
    body: { program: ref('program.json'), css: ref('style.css'), sourceUnits: ref('source-units.json'), configurator: c } };
  assert.equal(validateFullReplicaManifest(manifest).body.configurator?.widgetKey, c.widgetKey);
  assert.throws(() => validateFullReplicaManifest({ ...manifest, body: { ...manifest.body, configurator: { ...c, sourceUnitIds: ['foreign'] } } }), /configurator_scope/);
});

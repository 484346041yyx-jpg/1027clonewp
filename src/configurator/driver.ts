import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { catalogSchema, type Catalog } from './contract.js';
import { type ConfiguratorPatchIntent, type ConfiguratorCatalogRevisionIntent, prepareConfiguratorCatalogRevision, reconcileConfiguratorPatch, reconcileConfiguratorCatalogRevision } from './flow.js';
import { compileConfiguratorPatch, widgetSettings } from './compile.js';
import type { ElementorElement } from '../wordpress/types.js';
import type { HeaderPHPWriteIntent, WoodMartHeaderTransport } from '../woodmart-header/transport.js';

const sha = /^[a-f0-9]{64}$/;
const nativeId = /^[a-f0-9]{7}$/;
const runPattern = /^[a-z][a-z0-9-]{1,79}$/;
const files = ['clonewp-bottle-configurator.php', 'runtime.js', 'style.css'] as const;
type Transport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;

export interface ConfiguratorOwnedAsset {
  id: number; url: string; sha256: string;
}
export interface ConfiguratorDriverIdentity {
  targetOrigin: string; runId: string; pageId: number; contractHash: string;
}
export interface ConfiguratorRemoteSnapshot {
  pageId: number; status: 'draft'; elements: ElementorElement[]; elementsHash: string; settingsHash: string;
  pluginFiles: Record<(typeof files)[number], string>; controlsHash: string; controls: Record<string, unknown>;
}
export interface ConfiguratorRemoteReceipt {
  pageId: number; contractHash: string; operationId: string;
  state: 'started' | 'complete' | 'not-applied'; baseHash: string; patchedHash: string; settingsHash: string;
  kind?: 'catalog-revision'; priorOperationId?: string;
}
export interface ConfiguratorRemoteState { snapshot: ConfiguratorRemoteSnapshot; receipt: ConfiguratorRemoteReceipt | null }

function unwrap(value: unknown): ConfiguratorRemoteState {
  const response = value as { ok?: boolean; value?: ConfiguratorRemoteState; code?: string };
  if (response?.ok !== true || !response.value) throw Error(`configurator_${typeof response?.code === 'string' && /^configurator_[a-z0-9_]{1,100}$/.test(response.code) ? response.code : 'unconfirmed'}`);
  return response.value;
}
function validState(value: ConfiguratorRemoteState, identity: ConfiguratorDriverIdentity): ConfiguratorRemoteState {
  const s = value?.snapshot;
  if (!s || s.pageId !== identity.pageId || s.status !== 'draft' || !Array.isArray(s.elements) ||
    !sha.test(s.elementsHash) || !sha.test(s.settingsHash) || !sha.test(s.controlsHash) ||
    !s.pluginFiles || files.some(name => !sha.test(s.pluginFiles[name])) ||
    !s.controls || typeof s.controls !== 'object' || Array.isArray(s.controls)) throw Error('configurator_remote_snapshot_invalid');
  const r = value.receipt;
  if (r && (r.pageId !== identity.pageId || r.contractHash !== identity.contractHash ||
    !['started', 'complete', 'not-applied'].includes(r.state) || !sha.test(r.baseHash) || !sha.test(r.patchedHash) || !sha.test(r.settingsHash) ||
    r.kind !== undefined && (r.kind !== 'catalog-revision' || !/^[A-Za-z0-9_-]{4,100}$/.test(r.priorOperationId ?? ''))))
    throw Error('configurator_remote_receipt_invalid');
  return value;
}

/** Only locally reviewed PHP is executed; the catalog is JSON data, never PHP source. */
export async function configuratorDriverCode(identity: ConfiguratorDriverIdentity, data: Record<string, unknown>): Promise<string> {
  if (new URL(identity.targetOrigin).origin !== identity.targetOrigin || !runPattern.test(identity.runId) ||
    !Number.isSafeInteger(identity.pageId) || identity.pageId <= 0 || !sha.test(identity.contractHash))
    throw Error('configurator_driver_identity');
  const encoded = Buffer.from(JSON.stringify({ ...identity, ...data })).toString('base64');
  return `$input=json_decode(base64_decode('${encoded}'),true);\n${await readFile(new URL('./driver.php', import.meta.url), 'utf8')}`;
}

function allMedia(catalog: Catalog): Map<number, string> {
  const refs = [...catalog.bottles, ...catalog.pumps, ...catalog.caps].flatMap(option => [option.image, option.preview]);
  refs.push(...catalog.decorations.flatMap(option => [option.image, ...option.overlays.map(overlay => overlay.image)]));
  if (catalog.placeholders) refs.push(...Object.values(catalog.placeholders).map(placeholder => placeholder.image));
  const out = new Map<number, string>();
  for (const ref of refs) { const prior = out.get(ref.id); if (prior && prior !== ref.url) throw Error('configurator_media_id_url_conflict'); out.set(ref.id, ref.url); }
  return out;
}

/** A fresh inspect is required before every apply/reconcile; unknown responses are never retried. */
export class WordPressConfiguratorDriver {
  constructor(private readonly transport: Transport, readonly identity: ConfiguratorDriverIdentity) {
    if (identity.targetOrigin !== transport.origin || !runPattern.test(identity.runId) || !sha.test(identity.contractHash))
      throw Error('configurator_driver_origin');
  }
  private async code(data: Record<string, unknown>) { return configuratorDriverCode(this.identity, data); }
  async inspect(): Promise<ConfiguratorRemoteState> {
    return validState(unwrap(await this.transport.readPHP({ name: 'configurator.postsave-inspect', code: await this.code({ action: 'inspect' }), trustedLocalCode: true })), this.identity);
  }
  async apply(input: {
    before: ConfiguratorRemoteState; patch: ConfiguratorPatchIntent; catalog: Catalog;
    assets: ConfiguratorOwnedAsset[]; expectedPackageFiles: ConfiguratorRemoteSnapshot['pluginFiles'];
    expectedControlsHash: string; operationId: string; intent: HeaderPHPWriteIntent;
  }): Promise<ConfiguratorRemoteState> {
    const before = validState(input.before, this.identity), patch = input.patch, catalog = catalogSchema.parse(input.catalog);
    if (before.receipt && before.receipt.state !== 'not-applied') throw Error('configurator_reconcile_required');
    if (!sha.test(input.expectedControlsHash) || input.expectedControlsHash !== before.snapshot.controlsHash ||
      files.some(name => !sha.test(input.expectedPackageFiles[name]) || input.expectedPackageFiles[name] !== before.snapshot.pluginFiles[name]))
      throw Error('configurator_registered_package_changed');
    if (patch.version !== 1 || patch.kind !== 'clonewp-configurator-postsave-patch' ||
      patch.taskId !== this.identity.runId || patch.pageId !== this.identity.pageId || patch.targetOrigin !== this.identity.targetOrigin ||
      patch.formWidgetId !== catalog.form.widgetId || !nativeId.test(patch.slotId) || !nativeId.test(patch.widgetId) ||
      patch.baseHash !== before.snapshot.elementsHash || !sha.test(patch.patchedHash)) throw Error('configurator_patch_identity');
    const wanted = allMedia(catalog), actual = new Map<number, ConfiguratorOwnedAsset>();
    for (const asset of input.assets) {
      if (!Number.isSafeInteger(asset.id) || asset.id < 1 || !sha.test(asset.sha256) ||
          actual.has(asset.id) || wanted.get(asset.id) !== asset.url) throw Error('configurator_asset_ledger');
      actual.set(asset.id, asset);
    }
    if (actual.size !== wanted.size) throw Error('configurator_asset_ledger');
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(input.operationId) || input.intent.operationId !== input.operationId ||
      input.intent.runId !== this.identity.runId || input.intent.resource !== `full-replica-configurator/${this.identity.runId}` ||
      input.intent.expectedSnapshotSha256 !== createHash('sha256').update(JSON.stringify(before.snapshot)).digest('hex') ||
      !sha.test(input.intent.persistedIntentSha256)) throw Error('configurator_persisted_intent');
    const expectedElements = compileConfiguratorPatch(before.snapshot.elements, catalog, patch.slotId, patch.widgetId).elements;
    if (createHash('sha256').update(JSON.stringify(expectedElements)).digest('hex') !== patch.patchedHash)
      throw Error('configurator_patch_identity');
    const data = { action: 'apply', operationId: input.operationId, baseHash: patch.baseHash,
      patchedHash: patch.patchedHash, settingsHash: before.snapshot.settingsHash, slotId: patch.slotId,
      widgetId: patch.widgetId, formWidgetId: patch.formWidgetId, packageFiles: before.snapshot.pluginFiles,
      controlsHash: before.snapshot.controlsHash, catalog, assets: input.assets };
    const result = validState(unwrap(await this.transport.executePHP({ name: 'configurator.postsave-apply', code: await this.code(data), trustedLocalCode: true, intent: input.intent })), this.identity);
    if (!isDeepStrictEqual(result.snapshot.elements, expectedElements) || result.snapshot.settingsHash !== before.snapshot.settingsHash ||
      result.receipt?.operationId !== input.operationId || result.receipt.state !== 'complete') throw Error('configurator_write_readback');
    return result;
  }
  async reviseCatalog(input: {
    before: ConfiguratorRemoteState; revision: ConfiguratorCatalogRevisionIntent; oldCatalog: Catalog; newCatalog: Catalog;
    assets: ConfiguratorOwnedAsset[]; expectedPackageFiles: ConfiguratorRemoteSnapshot['pluginFiles'];
    expectedControlsHash: string; operationId: string; intent: HeaderPHPWriteIntent;
  }): Promise<ConfiguratorRemoteState> {
    const before = validState(input.before, this.identity), oldCatalog = catalogSchema.parse(input.oldCatalog), newCatalog = catalogSchema.parse(input.newCatalog);
    const revision = input.revision, prior = before.receipt;
    if (!prior || prior.state !== 'complete' || prior.operationId !== revision.priorOperationId || input.operationId === prior.operationId ||
      revision.kind !== 'clonewp-configurator-catalog-revision' || revision.version !== 1 ||
      revision.taskId !== this.identity.runId || revision.pageId !== this.identity.pageId || revision.targetOrigin !== this.identity.targetOrigin ||
      revision.baseHash !== before.snapshot.elementsHash || revision.settingsHash !== before.snapshot.settingsHash)
      throw Error('configurator_revision_identity');
    if (!sha.test(input.expectedControlsHash) || input.expectedControlsHash !== before.snapshot.controlsHash ||
      files.some(name => !sha.test(input.expectedPackageFiles[name]) || input.expectedPackageFiles[name] !== before.snapshot.pluginFiles[name]))
      throw Error('configurator_registered_package_changed');
    const wanted = allMedia(newCatalog), oldMedia = allMedia(oldCatalog), actual = new Map<number, ConfiguratorOwnedAsset>();
    if (!isDeepStrictEqual(wanted, oldMedia)) throw Error('configurator_revision_media_or_form');
    for (const asset of input.assets) {
      if (!Number.isSafeInteger(asset.id) || asset.id < 1 || !sha.test(asset.sha256) || actual.has(asset.id) || wanted.get(asset.id) !== asset.url)
        throw Error('configurator_asset_ledger');
      actual.set(asset.id, asset);
    }
    if (actual.size !== wanted.size) throw Error('configurator_asset_ledger');
    const prepared = prepareConfiguratorCatalogRevision({ taskId: this.identity.runId, pageId: this.identity.pageId,
      targetOrigin: this.identity.targetOrigin, slotId: revision.slotId, widgetId: revision.widgetId,
      formWidgetId: revision.formWidgetId, priorOperationId: revision.priorOperationId,
      settingsHash: before.snapshot.settingsHash, baseElements: before.snapshot.elements, oldCatalog, newCatalog });
    if (!isDeepStrictEqual(prepared.intent, revision)) throw Error('configurator_revision_identity');
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(input.operationId) || input.intent.operationId !== input.operationId ||
      input.intent.runId !== this.identity.runId || input.intent.resource !== `full-replica-configurator/${this.identity.runId}` ||
      input.intent.expectedSnapshotSha256 !== createHash('sha256').update(JSON.stringify(before.snapshot)).digest('hex') ||
      !sha.test(input.intent.persistedIntentSha256)) throw Error('configurator_persisted_intent');
    const data = { action: 'revise-catalog', operationId: input.operationId, priorOperationId: revision.priorOperationId,
      baseHash: revision.baseHash, patchedHash: revision.patchedHash, settingsHash: revision.settingsHash,
      slotId: revision.slotId, widgetId: revision.widgetId, formWidgetId: revision.formWidgetId,
      oldWidgetHash: revision.oldWidgetHash, newWidgetHash: revision.newWidgetHash,
      expectedOldSettings: prepared.oldWidgetSettings, expectedOldCanonicalSettings: widgetSettings(oldCatalog),
      packageFiles: before.snapshot.pluginFiles, controlsHash: before.snapshot.controlsHash, catalog: newCatalog, assets: input.assets };
    const result = validState(unwrap(await this.transport.executePHP({ name: 'configurator.catalog-revise', code: await this.code(data),
      trustedLocalCode: true, intent: input.intent })), this.identity);
    if (!isDeepStrictEqual(result.snapshot.elements, prepared.elements) || result.snapshot.settingsHash !== before.snapshot.settingsHash ||
      result.receipt?.operationId !== input.operationId || result.receipt.state !== 'complete' ||
      result.receipt.kind !== 'catalog-revision' || result.receipt.priorOperationId !== revision.priorOperationId)
      throw Error('configurator_revision_readback');
    return result;
  }
  async reconcileRevision(input: { before: ConfiguratorRemoteState; revision: ConfiguratorCatalogRevisionIntent;
    expectedElements: ElementorElement[]; operationId: string; intent: HeaderPHPWriteIntent }): Promise<ConfiguratorRemoteState> {
    const before = validState(input.before, this.identity), receipt = before.receipt, revision = input.revision;
    if (revision.kind !== 'clonewp-configurator-catalog-revision' || revision.taskId !== this.identity.runId ||
      revision.pageId !== this.identity.pageId || revision.targetOrigin !== this.identity.targetOrigin ||
      input.intent.operationId !== input.operationId || input.intent.runId !== this.identity.runId ||
      input.intent.resource !== `full-replica-configurator/${this.identity.runId}` ||
      !sha.test(input.intent.expectedSnapshotSha256) ||
      !sha.test(input.intent.persistedIntentSha256) || !receipt || receipt.state !== 'started' ||
      receipt.kind !== 'catalog-revision' || receipt.priorOperationId !== revision.priorOperationId ||
      receipt.operationId !== input.operationId || receipt.baseHash !== revision.baseHash ||
      receipt.patchedHash !== revision.patchedHash || receipt.settingsHash !== revision.settingsHash ||
      createHash('sha256').update(JSON.stringify(input.expectedElements)).digest('hex') !== revision.patchedHash ||
      !['applied', 'not-applied'].includes(reconcileConfiguratorCatalogRevision(revision, before.snapshot.elements, input.expectedElements)))
      throw Error('configurator_revision_reconcile_identity');
    const result = validState(unwrap(await this.transport.executePHP({ name: 'configurator.catalog-reconcile',
      code: await this.code({ action: 'reconcile-revision', operationId: input.operationId, baseHash: revision.baseHash,
        patchedHash: revision.patchedHash, expectedElements: input.expectedElements }), trustedLocalCode: true, intent: input.intent })), this.identity);
    if (result.receipt?.operationId !== input.operationId || result.receipt.kind !== 'catalog-revision' ||
      !['complete', 'not-applied'].includes(result.receipt.state) ||
      reconcileConfiguratorCatalogRevision(revision, result.snapshot.elements, input.expectedElements) !==
        (result.receipt.state === 'complete' ? 'applied' : 'not-applied')) throw Error('configurator_revision_reconcile_readback');
    return result;
  }
  async reconcile(input: { before: ConfiguratorRemoteState; patch: ConfiguratorPatchIntent; expectedElements: ElementorElement[]; operationId: string; intent: HeaderPHPWriteIntent }) {
    const before = validState(input.before, this.identity), receipt = before.receipt;
    if (input.patch.kind !== 'clonewp-configurator-postsave-patch' || input.patch.taskId !== this.identity.runId ||
      input.patch.pageId !== this.identity.pageId || input.patch.targetOrigin !== this.identity.targetOrigin ||
      input.intent.operationId !== input.operationId || input.intent.runId !== this.identity.runId ||
      input.intent.resource !== `full-replica-configurator/${this.identity.runId}` ||
      input.intent.expectedSnapshotSha256 !== createHash('sha256').update(JSON.stringify(before.snapshot)).digest('hex') ||
      !sha.test(input.intent.persistedIntentSha256) ||
      !receipt || receipt.state !== 'started' || receipt.operationId !== input.operationId ||
      receipt.baseHash !== input.patch.baseHash || receipt.patchedHash !== input.patch.patchedHash ||
      !['applied', 'not-applied'].includes(reconcileConfiguratorPatch(input.patch, before.snapshot.elements, input.expectedElements)))
      throw Error('configurator_reconcile_identity');
    const result = validState(unwrap(await this.transport.executePHP({ name: 'configurator.postsave-reconcile',
      code: await this.code({ action: 'reconcile', operationId: input.operationId, baseHash: input.patch.baseHash, patchedHash: input.patch.patchedHash, expectedElements: input.expectedElements }),
      trustedLocalCode: true, intent: input.intent })), this.identity);
    if (result.receipt?.operationId !== input.operationId || !['complete', 'not-applied'].includes(result.receipt.state) ||
      reconcileConfiguratorPatch(input.patch, result.snapshot.elements, input.expectedElements) !== (result.receipt.state === 'complete' ? 'applied' : 'not-applied'))
      throw Error('configurator_reconcile_readback');
    return result;
  }
}

import { prepareProgramCategories } from '../native44/native-categories.js';
import { isNativeReplicaSlug } from '../core/replica-url.js';
import {verifyBodyStyleAmendmentMedia,controlCorrectionRegistryHash} from './unwritten-body-style-amendment.js';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { prepareActualBody, assertActualPreparedBody, compileActualBody, prepareActualBodyPendingForms, resolveActualBodyStyles } from './body-prepare.js';
import { fullReplicaHash, fullReplicaFingerprint, validateFullReplicaReview } from './contract.js';
import { fullPageCSSAssetKeys, importFullReplicaBodyAssets, matchesNativeBodyBefore, matchesPublishedDocument, verifyFullReplicaReviewEvidence, type FullReplicaRemoteServices } from './body.js';
import { compileFullPageCSS } from './css.js';
import { referencedNative44Assets, usedNative44WidgetTypes } from '../native44/compiler.js';
import type { Native44Asset } from '../native44/media.js';
import type { ImportedAssetV2 } from '../replica-v2/types.js';
import { walkNative44 } from '../native44/types.js';
import { validateNative44Program } from '../native44/validate.js';
import { assertInquiryElement } from './inquiry-review.js';
import { prepareProgramCurrentProduct, prepareProgramRelatedProducts, assertCoreProductPageRuntime } from '../native44/current-product.js';
import { toNative44CompilerKnowledge } from '../native44/knowledge.js';
import { certifyResponsiveSchemas } from '../replica-responsive/target.js';
import { responsivePageShellCSS } from '../replica-responsive/defaults.js';
import { prepareResponsiveBody } from '../replica-responsive/body.js';
import { documentHashV2 } from '../replica-v2/journal.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { comparisonTree } from '../wordpress/client.js';
import { native44Id } from '../native44/adapters.js';
import { bindConfiguratorCatalog } from '../configurator/binding.js';
import { prepareConfiguratorPatch, prepareConfiguratorCatalogRevision, reconcileConfiguratorCatalogRevision, reconcileConfiguratorPatch, type ConfiguratorPatchIntent, type ConfiguratorCatalogRevisionIntent } from '../configurator/flow.js';
import { compileConfiguratorPatch } from '../configurator/compile.js';
import { WordPressConfiguratorDriver, type ConfiguratorOwnedAsset, type ConfiguratorRemoteState } from '../configurator/driver.js';
import type { Catalog } from '../configurator/contract.js';
import type { ConfiguratorSourceCatalog } from '../configurator/source.js';
import { assertNativeImageCSS } from './native-image-policy.js';
import type { TargetPostsEvidence } from '../wordpress/posts-contract.js';
import type { TargetCatalogEvidence } from '../wordpress/catalog-contract.js';
import type { ReusedBodyAction, ReusedBodySnapshot } from './reused-driver.js';
import type { FullReplicaManifest, FullReplicaDependencies, FullReplicaOperation, FullReplicaFileRef, FullReplicaPageCheckpoint, FullReplicaBodyCheckpoint, FullReplicaBoundCheckpoint, FullReplicaPreparedBody } from './types.js';

const ROOT = 'D:/cloneWP';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function fail(code: string): never { throw Error(`replica_full_reuse_${code}`); }
export const emptyPageMetadataProofSchema = z.object({ version: z.literal(1), kind: z.literal('clonewp-empty-page-metadata-proof'), taskId: z.string().min(1), runId: z.string().min(1), pageId: z.number().int().positive(), baselineMetadataHash: z.string().regex(/^[a-f0-9]{64}$/), currentMetadataHash: z.string().regex(/^[a-f0-9]{64}$/), metadata: z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict();
export function emptyReusedPageCacheEvidence(manifest: FullReplicaManifest, before: ReusedBodySnapshot, current: ReusedBodySnapshot, readback: unknown) {
  const parsed = z.object({ pageId: z.number().int().positive(), runId: z.string(), observedAt: z.string(), metadata: z.record(z.string(), z.array(z.string())), projections: z.unknown().optional(), remoteWrites: z.literal(0) }).strict().safeParse(readback);
  if (!parsed.success || !before.page || !current.page) return null;
  const value = parsed.data, metadata = value.metadata;
  if (['_clonewp_run_id', '_clonewp_reused_header_contract', '_elementor_data', '_elementor_css'].some(key => !Object.hasOwn(metadata, key))) return null;
  if (value.pageId !== current.page.pageId || value.runId !== manifest.runId || !Number.isFinite(Date.parse(value.observedAt)) || fullReplicaHash(metadata) !== current.page.metaHash || fullReplicaHash(metadata._clonewp_run_id) !== fullReplicaHash([manifest.runId]) || fullReplicaHash(metadata._clonewp_reused_header_contract) !== fullReplicaHash([fullReplicaHash(manifest)]) || fullReplicaHash(metadata._elementor_data) !== fullReplicaHash(['[]']) || !Object.hasOwn(metadata, '_elementor_css') || metadata._elementor_css.length !== 1 || !/^a:\d+:\{[\s\S]*\}$/.test(metadata._elementor_css[0])) return null;
  const { _elementor_css: added, ...baseline } = metadata;
  if (fullReplicaHash(baseline) !== before.page.metaHash) return null;
  return { version: 1, kind: 'clonewp-empty-page-added-css-cache', omittedKeys: ['_elementor_css'], currentMetadataHash: current.page.metaHash, baselineMetadataHash: before.page.metaHash, addedValueHash: fullReplicaHash(added), observedAt: value.observedAt };
}
export function emptyReusedPageProjectionEvidence(manifest: FullReplicaManifest, checkpoint: FullReplicaPageCheckpoint, before: ReusedBodySnapshot, current: ReusedBodySnapshot, metadataReadback?: unknown) {
  if (!before.page || !current.page || fullReplicaHash(before.resources) !== fullReplicaHash(manifest.reusedHeader) || fullReplicaHash(current.resources) !== fullReplicaHash(before.resources)) return null;
  const receipts = Object.values(before.receipts);
  if (receipts.length !== 1 || receipts[0].action !== 'create-page' || receipts[0].state !== 'complete' || receipts[0].payloadHash !== fullReplicaHash({ title: manifest.title, slug: manifest.slug }) || fullReplicaHash(receipts[0].result) !== fullReplicaHash({ pageId: checkpoint.pageId })) return null;
  for (const snapshot of [before, current]) {
    const value = snapshot.page!;
    if (value.pageId !== checkpoint.pageId || value.runId !== manifest.runId || value.status !== 'draft' || value.template !== 'elementor_header_footer' || value.headerId !== null || value.title !== manifest.title || !isNativeReplicaSlug(manifest.slug, value.slug) || value.elements.length || value.settings.template !== 'elementor_header_footer' || value.settings.hide_title !== 'yes' || value.settings.custom_css !== undefined && value.settings.custom_css !== '') return null;
    const image = value.settings.post_featured_image;
    if (!image || typeof image !== 'object' || Array.isArray(image) || fullReplicaHash(image) !== fullReplicaHash({ url: '', id: (image as Record<string, unknown>).id, size: '' }) || ![false, 0].includes((image as Record<string, unknown>).id as false | number)) return null;
    if (value.bodyHash !== fullReplicaHash([value.title, '', '', value.slug, [], value.settings]) || value.documentHash !== fullReplicaHash([[], value.settings])) return null;
    const { hash: _hash, ...raw } = snapshot;
    if (snapshot.hash !== fullReplicaHash(raw)) return null;
  }
  if (before.page.bodyHash !== checkpoint.bodyHash || checkpoint.runId !== manifest.runId || checkpoint.status !== 'draft' || checkpoint.template !== 'elementor_header_footer' || checkpoint.headerId !== null) return null;
  const metadataProjection = before.page.metaHash !== current.page.metaHash ? emptyReusedPageCacheEvidence(manifest, before, current, metadataReadback) : undefined;
  if (before.page.metaHash !== current.page.metaHash && !metadataProjection) return null;
  const normalize = (snapshot: ReusedBodySnapshot) => {
    const { hash: _hash, page: value, ...rest } = snapshot;
    const { bodyHash: _bodyHash, documentHash: _documentHash, ...page } = value!;
    return { ...rest, page: { ...page, metaHash: before.page!.metaHash, settings: { ...page.settings, post_featured_image: { url: '', id: 0, size: '' } } } };
  };
  if (fullReplicaHash(normalize(before)) !== fullReplicaHash(normalize(current))) return null;
  return { version: 1, kind: 'clonewp-empty-page-media-id-projection', pageId: checkpoint.pageId, preservedBodyHash: checkpoint.bodyHash, before: { snapshotHash: before.hash, bodyHash: before.page.bodyHash, documentHash: before.page.documentHash, featuredImageId: (before.page.settings.post_featured_image as Record<string, unknown>).id }, current: { snapshotHash: current.hash, bodyHash: current.page.bodyHash, documentHash: current.page.documentHash, featuredImageId: (current.page.settings.post_featured_image as Record<string, unknown>).id }, metadataHash: before.page.metaHash, ...(metadataProjection ? { metadataProjection } : {}), rule: 'Only the empty registered media id false/0 projection and independently hash-preimage-proven added CSS cache may differ; all other snapshot values and the exact empty content/document hash preimages match.' };
}
interface Helpers {
  bodyStyleAmendment?: import('./unwritten-body-style-amendment.js').BodyStyleAmendment;
  recoverInterruptedStyle?: boolean;
  manifest: FullReplicaManifest; runDirectory: string; remote(): Promise<FullReplicaRemoteServices>; close(): Promise<void>;
  operationFile(operation: FullReplicaOperation, label: string, value: unknown): Promise<FullReplicaFileRef>;
  readBound(reference: FullReplicaFileRef, base?: string): Promise<{ filename: string; bytes: Buffer }>;
  assetManifest(value: unknown, directory: string, required: string[], sourceFontKeys?: readonly string[]): Promise<Native44Asset[]>;
}
export async function createReusedBodyDependencies(input: Helpers): Promise<Omit<FullReplicaDependencies, 'writeState'>> {
  const { manifest, runDirectory, operationFile } = input, resources = manifest.reusedHeader!;
  if (!resources || manifest.headerProvider !== 'reused-woodmart-header' || manifest.body.navigationForms?.length) fail('provider_contract');
  const remote = async () => { const services = await input.remote(); if (!services.reused) fail('driver_required'); return { ...services, reused: services.reused }; };
  const page = (snapshot: ReusedBodySnapshot, pageId?: number, status: 'draft' | 'publish' = 'draft') => {
    const current = snapshot.page;
    if (!current || current.status !== status || current.runId !== manifest.runId || current.template !== 'elementor_header_footer' || pageId !== undefined && current.pageId !== pageId) fail('owned_page_changed');
    return current;
  };
  const pageCheckpoint = (snapshot: ReusedBodySnapshot): FullReplicaPageCheckpoint => {
    const current = page(snapshot); if (current.headerId !== null) fail('already_bound');
    return { pageId: current.pageId, runId: manifest.runId, status: 'draft', template: 'elementor_header_footer', headerId: null, editUrl: `${manifest.targetOrigin}/wp-admin/post.php?post=${current.pageId}&action=elementor`, previewUrl: `${manifest.targetOrigin}/?page_id=${current.pageId}&preview=true`, bodyHash: current.bodyHash };
  };
  const assertBound = (snapshot: ReusedBodySnapshot, bound: FullReplicaBoundCheckpoint, status: 'draft' | 'publish' = 'draft') => {
    const current = page(snapshot, bound.pageId, status);
    if (current.headerId !== resources.headerId || current.bodyHash !== bound.bodyHash || digest(String(current.settings.custom_css ?? '')) !== bound.cssHash || !matchesPublishedDocument(current.elements, current.settings, bound.documentHash, status) || bound.headerHash !== resources.headerHash || bound.menuHash !== resources.menuHash || bound.styleHash !== resources.styleHash) fail('bound_changed');
  };
  const mutate = async (action: ReusedBodyAction, before: ReusedBodySnapshot, operation: FullReplicaOperation, payload: Record<string, unknown>) => {
    const services = await remote(), operationId = randomUUID();
    const intent = await operationFile(operation, `reuse-${action}-intent`, { action, operationId, beforeHash: before.hash, protectedHash: resources.sharedHash, payload, payloadHash: fullReplicaHash(payload) });
    return services.reused.mutate(action, before, operationId, payload, { operationId, runId: manifest.runId, resource: `full-replica-reuse/${manifest.runId}`, expectedSnapshotSha256: before.hash, persistedIntentSha256: intent.sha256 });
  };
  const claim = async (body: FullReplicaPreparedBody, pageId: number) => {
    assertActualPreparedBody(body, manifest); const services = await remote();
    const capabilities = await services.client.discoverCapabilities(usedNative44WidgetTypes(body.payload.program));
    if (capabilities.mode === 'unavailable') fail('registry_unavailable');
    if (manifest.responsive) capabilities.legacySchemas = certifyResponsiveSchemas(capabilities.legacySchemas, services.responsiveTarget);
    await services.client.createDraft(manifest.runId, manifest.title, { requireExistingPageId: pageId, ...(manifest.currentRecord?{currentRecord:manifest.currentRecord}:{}) });
    return { services, capabilities };
  };
  const sameTreeIgnoringGeneratedCategoryIds = (left: unknown, right: unknown) => {
    const expectedTree = structuredClone(left) as any[], actualTree = structuredClone(right) as any[];
    const normalize = (aNodes: any[], bNodes: any[]) => {
      if (aNodes.length !== bNodes.length) return;
      for (let index = 0; index < aNodes.length; index++) {
        const a = aNodes[index], b = bNodes[index];
        if (a.widgetType === 'wd_product_categories' && b.widgetType === a.widgetType && /^wd_[a-f0-9]{13}$/.test(a.settings?.sync_parent_id) && /^wd_[a-f0-9]{13}$/.test(b.settings?.sync_parent_id)) { delete a.settings.sync_parent_id; delete b.settings.sync_parent_id; }
        normalize(a.elements ?? [], b.elements ?? []);
      }
    };
    normalize(expectedTree, actualTree);
    return fullReplicaHash(expectedTree) === fullReplicaHash(actualTree);
  };
  const partialSavedBody = async (snapshot: ReusedBodySnapshot, operationId?: string) => {
    const current = snapshot.page;
    if (!current || current.status !== 'draft' || current.runId !== manifest.runId || current.headerId !== null || current.settings.custom_css && current.settings.custom_css !== '') return null;
    const active = Object.entries(snapshot.receipts).filter(([,row]) => row.state !== 'complete');
    if (active.length > 1 || active.some(([,row]) => row.action !== 'style' || row.state !== 'started')) return null;
    const names = (await readdir(path.join(runDirectory, 'operations'))).filter(name => /^[a-f0-9-]{36}-reuse-body-save-intent-[a-f0-9-]{36}\.json$/.test(name) && (!operationId || name.startsWith(`${operationId}-`)));
    const candidates = [];
    for (const name of names) {
      const record = JSON.parse(await readFile(path.join(runDirectory, 'operations', name), 'utf8'));
      const intent = record.value;
      if (record.kind !== 'clonewp-full-replica-operation' || record.operation?.taskId !== manifest.taskId || record.operation?.runId !== manifest.runId || record.operation?.phase !== 'body' || !name.startsWith(`${record.operation.operationId}-`) || !intent?.before?.page || !intent?.composition?.elements || typeof intent.css !== 'string') continue;
      const original = intent.before as ReusedBodySnapshot;
      const receipts = { ...snapshot.receipts };for (const [id] of active) delete receipts[id];
      if (original.page?.pageId !== current.pageId || original.page.status !== 'draft' || original.page.headerId !== null || fullReplicaHash(original.resources) !== fullReplicaHash(snapshot.resources) || fullReplicaHash(original.receipts) !== fullReplicaHash(receipts) || original.page.title !== current.title || original.page.slug !== current.slug || original.page.template !== current.template || fullReplicaHash(original.page.flags) !== fullReplicaHash(current.flags)) continue;
      const program = validateNative44Program(JSON.parse(await readFile(manifest.body.program.path, 'utf8')));
      const services = await remote(), capabilities = await services.client.discoverCapabilities(usedNative44WidgetTypes(program));
      if (capabilities.mode === 'unavailable') continue;
      const expected = compileEditorElements(intent.composition.elements, capabilities.legacySchemas, { executionStrategy: 'native44-css-handoff' });
      if (!sameTreeIgnoringGeneratedCategoryIds(comparisonTree(expected), comparisonTree(current.elements))) continue;
      candidates.push({ intent, operation: record.operation });
    }
    return candidates.length === 1 ? candidates[0] : null;
  };
  type ConfiguratorStage = { patch: ConfiguratorPatchIntent; catalog: Catalog; assets: ConfiguratorOwnedAsset[]; css: string;
    applyOperationId: string; intentHash: string;
    packageFiles: { 'clonewp-bottle-configurator.php': string; 'runtime.js': string; 'style.css': string }; controlsHash: string;
    base: ConfiguratorRemoteState };
  const expectedConfiguratorElements = (stage: ConfiguratorStage) =>
    compileConfiguratorPatch(stage.base.snapshot.elements, stage.catalog, stage.patch.slotId, stage.patch.widgetId).elements;
  const readConfiguratorStage = async (operationId: string): Promise<ConfiguratorStage | null> => {
    if (!manifest.body.configurator) return null;
    const directory = path.join(runDirectory, 'operations');
    const names = (await readdir(directory)).filter(name => name.startsWith(`${operationId}-reuse-configurator-patch-intent-`) && name.endsWith('.json'));
    if (names.length !== 1) return null;
    const bytes = await readFile(path.join(directory, names[0])), record = JSON.parse(bytes.toString('utf8'));
    if (record.operation?.operationId !== operationId || record.operation?.runId !== manifest.runId ||
        record.operation?.taskId !== manifest.taskId || record.operation?.phase !== 'body' ||
        record.value?.patch?.taskId !== manifest.runId || !Array.isArray(record.value?.assets) ||
        !/^[A-Za-z0-9_-]{4,100}$/.test(record.value?.applyOperationId ?? '') ||
        typeof record.value?.css !== 'string' || !Array.isArray(record.value?.base?.snapshot?.elements)) return null;
    return { ...record.value, intentHash: createHash('sha256').update(bytes).digest('hex') } as ConfiguratorStage;
  };
  type CatalogRevisionStage = { revision: ConfiguratorCatalogRevisionIntent; oldCatalog: Catalog; newCatalog: Catalog;
    assets: ConfiguratorOwnedAsset[]; applyOperationId: string; packageFiles: ConfiguratorRemoteState['snapshot']['pluginFiles'];
    controlsHash: string; packageManifest: FullReplicaFileRef; base: ConfiguratorRemoteState };
  const readCatalogRevisionStage = async (operationId: string): Promise<CatalogRevisionStage | null> => {
    const directory = path.join(runDirectory, 'operations');
    const names = (await readdir(directory)).filter(name => name.startsWith(`${operationId}-reuse-configurator-catalog-revision-intent-`) && name.endsWith('.json'));
    if (names.length !== 1) return null;
    const record = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    if (record.operation?.operationId !== operationId || record.operation?.taskId !== manifest.taskId ||
        record.operation?.runId !== manifest.runId || record.operation?.phase !== 'catalog-revision' ||
        record.value?.revision?.taskId !== manifest.runId || !Array.isArray(record.value?.assets) ||
        !Array.isArray(record.value?.base?.snapshot?.elements)) return null;
    return record.value as CatalogRevisionStage;
  };
  const currentCatalogStage = async (receiptId: string) => {
    const directory = path.join(runDirectory, 'operations');
    const names = await readdir(directory);
    const originals: ConfiguratorStage[] = [], revisions: CatalogRevisionStage[] = [];
    for (const name of names) {
      if (/^[a-f0-9-]{36}-reuse-configurator-patch-intent-[a-f0-9-]{36}\.json$/.test(name)) {
        const stage = await readConfiguratorStage(name.slice(0, 36));
        if (stage?.applyOperationId === receiptId) originals.push(stage);
      }
      if (/^[a-f0-9-]{36}-reuse-configurator-catalog-revision-intent-[a-f0-9-]{36}\.json$/.test(name)) {
        const stage = await readCatalogRevisionStage(name.slice(0, 36));
        if (stage?.applyOperationId === receiptId) revisions.push(stage);
      }
    }
    if (originals.length + revisions.length !== 1) fail('configurator_catalog_history_ambiguous');
    const original = originals[0], revision = revisions[0];
    return original ? { catalog: original.catalog, assets: original.assets, slotId: original.patch.slotId,
      widgetId: original.patch.widgetId, formWidgetId: original.patch.formWidgetId,
      packageFiles: original.packageFiles, controlsHash: original.controlsHash } :
      { catalog: revision.newCatalog, assets: revision.assets, slotId: revision.revision.slotId,
        widgetId: revision.revision.widgetId, formWidgetId: revision.revision.formWidgetId,
        packageFiles: revision.packageFiles, controlsHash: revision.controlsHash };
  };
  const configuratorDriver = async (services: FullReplicaRemoteServices, pageId: number) => {
    if (!services.configuratorTransport || !manifest.body.configurator) fail('configurator_transport_missing');
    return new WordPressConfiguratorDriver(services.configuratorTransport, { targetOrigin: manifest.targetOrigin,
      runId: manifest.runId, pageId, contractHash: fullReplicaHash(manifest) });
  };
  const reconcileConfiguratorReceipt = async (driver: WordPressConfiguratorDriver, state: ConfiguratorRemoteState,
    stage: ConfiguratorStage, operation: FullReplicaOperation) => {
    const receipt = state.receipt;
    const expectedElements = expectedConfiguratorElements(stage);
    if (!receipt || receipt.state !== 'started' || receipt.baseHash !== stage.patch.baseHash ||
        receipt.patchedHash !== stage.patch.patchedHash || !['applied','not-applied'].includes(reconcileConfiguratorPatch(stage.patch, state.snapshot.elements, expectedElements)))
      fail('configurator_reconcile_conflict');
    const recorded = await operationFile(operation, 'reuse-configurator-reconcile-intent', { patch: stage.patch, before: state,
      operationId: receipt.operationId, effect: reconcileConfiguratorPatch(stage.patch, state.snapshot.elements, expectedElements) });
    return driver.reconcile({ before: state, patch: stage.patch, expectedElements, operationId: receipt.operationId,
      intent: { operationId: receipt.operationId, runId: manifest.runId, resource: `full-replica-configurator/${manifest.runId}`,
        expectedSnapshotSha256: digest(JSON.stringify(state.snapshot)), persistedIntentSha256: recorded.sha256 } });
  };
  const prepareConfiguratorStage = async (compiled: ReturnType<typeof compileActualBody>, imported: ImportedAssetV2[], css: string) => {
    const spec = manifest.body.configurator; if (!spec) return null;
    const [templateFile, imagesFile, packageFile, registrationFile] = await Promise.all([
      input.readBound(spec.catalogTemplate), input.readBound(spec.imageManifest), input.readBound(spec.packageManifest), input.readBound(spec.registrationEvidence),
    ]);
    await Promise.all(spec.sourceEvidence.map(ref => input.readBound(ref)));
    const template = JSON.parse(templateFile.bytes.toString('utf8')) as ConfiguratorSourceCatalog;
    const images = JSON.parse(imagesFile.bytes.toString('utf8')) as Native44Asset[];
    const packageManifest = JSON.parse(packageFile.bytes.toString('utf8')) as { files?: Array<{ path: string; sha256: string }> };
    const registration = JSON.parse(registrationFile.bytes.toString('utf8')) as { origin?: string; registered?: boolean; className?: string; controls?: Record<string, unknown>; files?: Record<string, string> };
    const expectedFiles = { 'clonewp-bottle-configurator.php': spec.packageFiles.php, 'runtime.js': spec.packageFiles.js, 'style.css': spec.packageFiles.css };
    if (registration.origin !== manifest.targetOrigin || registration.registered !== true || registration.className !== 'CloneWP_Bottle_Configurator' ||
        !registration.controls?.options || !registration.controls?.form_widget || !registration.controls?.decorations || !registration.controls?.overlays ||
        fullReplicaHash(registration.files) !== fullReplicaHash(expectedFiles) ||
        fullReplicaHash(Object.fromEntries((packageManifest.files ?? []).map(row => [row.path, row.sha256]))) !== fullReplicaHash(expectedFiles)) fail('configurator_registration_changed');
    const formWidgetId = compiled.widgetTargets[spec.formComponentKey];
    const slotId = native44Id(manifest.taskId, spec.slotComponentKey), widgetId = native44Id(manifest.taskId, spec.widgetKey);
    if (!/^[a-f0-9]{7}$/.test(formWidgetId ?? '') || new Set([slotId, formWidgetId, widgetId]).size !== 3) fail('configurator_native_mapping');
    const nodes = new Map<string, { id: string; elType: string; widgetType?: string; elements: unknown[] }>();
    const walk = (rows: typeof compiled.composition.elements) => { for (const row of rows) { nodes.set(row.id, row); walk(row.elements); } }; walk(compiled.composition.elements);
    if (nodes.get(slotId)?.elType !== 'container' || !nodes.get(slotId)?.elements.length || nodes.get(formWidgetId)?.widgetType !== 'form' || nodes.has(widgetId)) fail('configurator_native_mapping');
    const binding = bindConfiguratorCatalog({ template, sourceImages: images, mediaKeys: spec.mediaKeys, imported,
      formWidgetId, summaryField: 'configuration', uploadField: 'logo' });
    return { ...binding, slotId, widgetId, formWidgetId, css, packageFiles: expectedFiles,
      controlsHash: digest(JSON.stringify(registration.controls)) };
  };
  const mediaFor = async (body: FullReplicaPreparedBody) => {
    assertActualPreparedBody(body, manifest); const payload = body.payload;
    const nativeKeys = referencedNative44Assets(payload.program), cssKeys = fullPageCSSAssetKeys(payload.css), required = [...new Set([...nativeKeys, ...cssKeys, ...(manifest.body.configurator?.mediaKeys ?? [])])];
    return { required, assets: await input.assetManifest(payload.assetsManifest, path.dirname(payload.assetsManifestPath), required, cssKeys.filter(key => !nativeKeys.has(key))), directory: path.dirname(payload.assetsManifestPath) };
  };
  const proveEmptyBefore = async (current: ReusedBodySnapshot, checkpoint: FullReplicaPageCheckpoint, operation: FullReplicaOperation) => {
    const directory = path.join(runDirectory, 'operations'), names = await readdir(directory);
    if (names.some(name => name.startsWith(`${operation.operationId}-`) && !new RegExp(`^${operation.operationId}-reuse-empty-page-projection-[a-f0-9-]{36}\\.json$`).test(name))) return false;
    const candidates = [];
    for (const name of names.filter(name => /^[a-f0-9-]{36}-reuse-page-confirmed-[a-f0-9-]{36}\.json$/.test(name))) {
      const filename = path.join(directory, name), bytes = await readFile(filename), record = JSON.parse(bytes.toString('utf8'));
      if (record.version !== 1 || record.kind !== 'clonewp-full-replica-operation' || record.operation?.phase !== 'page' || record.operation.taskId !== manifest.taskId || record.operation.runId !== manifest.runId || !name.startsWith(`${record.operation.operationId}-`) || !record.value?.snapshot || !record.value.checkpoint || fullReplicaHash(record.value.checkpoint) !== fullReplicaHash(checkpoint)) continue;
      let metadataReadback: unknown, metadataProof;
      if (record.value.snapshot.page?.metaHash !== current.page?.metaHash) {
        const proofFilename = path.join(runDirectory, 'empty-page-metadata-proof.json');
        let proofBytes: Buffer;
        try { proofBytes = await readFile(proofFilename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        const proof = emptyPageMetadataProofSchema.parse(JSON.parse(proofBytes.toString('utf8')));
        if (proof.taskId !== manifest.taskId || proof.runId !== manifest.runId || proof.pageId !== checkpoint.pageId || proof.baselineMetadataHash !== record.value.snapshot.page?.metaHash || proof.currentMetadataHash !== current.page?.metaHash) continue;
        const relative = path.relative(runDirectory, path.resolve(runDirectory, proof.metadata.path));
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
        const readback = await input.readBound(proof.metadata, runDirectory);
        metadataReadback = JSON.parse(readback.bytes.toString('utf8'));
        metadataProof = { protocol: { path: proofFilename, sha256: createHash('sha256').update(proofBytes).digest('hex') }, readback: proof.metadata };
      }
      const evidence = emptyReusedPageProjectionEvidence(manifest, checkpoint, record.value.snapshot, current, metadataReadback);
      if (evidence) candidates.push({ sourceProof: { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') }, ...(metadataProof ? { metadataProof } : {}), evidence, before: record.value.snapshot, current });
    }
    if (candidates.length !== 1) return false;
    await operationFile(operation, 'reuse-empty-page-projection', candidates[0]); return true;
  };
  const dependencies: Omit<FullReplicaDependencies, 'writeState'> = {
    close: input.close,
    async prepareHeader() { return fail('header_readonly'); },
    async provisionHeader() { return fail('header_readonly'); },
    async bindHeader() { return fail('owned_header_not_applicable'); },
    async prepareBody(value) { const body = await prepareActualBody(value, input.bodyStyleAmendment); await mediaFor(body); return body; },
    assertPreparedBody: assertActualPreparedBody,
    async inspectUnwrittenBodyStyle(body, checkpoint, operation) {
      assertActualPreparedBody(body, manifest);
      const services = await remote(), before = await services.reused.inspect(), current = page(before, checkpoint.pageId);
      if (current.elements.length || current.headerId !== null || String(current.settings.custom_css ?? '') !== '' || current.bodyHash !== checkpoint.bodyHash && !await proveEmptyBefore(before, checkpoint, operation)) fail('style_amendment_empty_page_changed');
      if (Object.values(before.receipts).some(receipt => receipt.state !== 'complete' || receipt.action !== 'create-page')) fail('style_amendment_remote_receipts');
      const capabilities = await services.client.discoverCapabilities(usedNative44WidgetTypes(body.payload.program));
      if (capabilities.mode === 'unavailable') fail('registry_unavailable');
      if (manifest.responsive) capabilities.legacySchemas = certifyResponsiveSchemas(capabilities.legacySchemas, services.responsiveTarget);
      const resolved = resolveActualBodyStyles(body, capabilities.legacySchemas);
      let mediaVerification:unknown;
      if(input.bodyStyleAmendment?.request.version===2||input.bodyStyleAmendment?.request.version===4||input.bodyStyleAmendment?.request.version===3&&input.bodyStyleAmendment.request.media){mediaVerification=await verifyBodyStyleAmendmentMedia(runDirectory,input.bodyStyleAmendment.request,manifest.title,services.client,manifest);}
      const fresh = await services.reused.inspect();
      if (fresh.hash !== before.hash) fail('style_amendment_snapshot_changed');
      return { ...(mediaVerification?{mediaVerification}:{}),...(input.bodyStyleAmendment?.request.version===4?{controlCorrectionRegistryHash:controlCorrectionRegistryHash(capabilities.legacySchemas)}:{}),snapshot: fresh, styleResolution: { receipts: resolved.receipts, renderedVerified: false }, effectiveProgramHash: body.payload.authoringAmendment?.effectiveProgramHash, remoteWrites: 0 };
    },
    async createPage(prepared, operation) {
      assertActualPreparedBody(prepared.body, manifest); const services = await remote(), before = await services.reused.inspect();
      if (before.page) fail('page_exists_reconcile');
      const result = await mutate('create-page', before, operation, { title: manifest.title, slug: manifest.slug }), checkpoint = pageCheckpoint(result.snapshot);
      if (page(result.snapshot).elements.length || page(result.snapshot).title !== manifest.title || !isNativeReplicaSlug(manifest.slug, page(result.snapshot).slug)) fail('created_page_changed');
      await claim(prepared.body, checkpoint.pageId);
      const fresh = await services.reused.inspect();
      if (fresh.hash !== result.snapshot.hash) {
        const evidence = emptyReusedPageProjectionEvidence(manifest, checkpoint, result.snapshot, fresh);
        if (!evidence) fail('page_claim_changed');
        await operationFile(operation, 'reuse-page-claim-projection', { before: result.snapshot, current: fresh, evidence });
      }
      const confirmed = pageCheckpoint(fresh);
      await operationFile(operation, 'reuse-page-confirmed', { snapshot: fresh, checkpoint: confirmed }); return confirmed;
    },
    async saveBody(body, checkpoint, operation) {
      const { services, capabilities } = await claim(body, checkpoint.pageId), before = await services.reused.inspect(), current = page(before, checkpoint.pageId);
      const partial = current.bodyHash !== checkpoint.bodyHash ? await partialSavedBody(before) : null;
      let priorConfigurator = await readConfiguratorStage(operation.operationId);
      const configurator = manifest.body.configurator ? await configuratorDriver(services, checkpoint.pageId) : null;
      let configuratorState = configurator ? await configurator.inspect() : null;
      if (!priorConfigurator && configuratorState?.receipt?.state === 'complete') {
        const names = (await readdir(path.join(runDirectory, 'operations')))
          .filter(name => /^[a-f0-9-]{36}-reuse-configurator-patch-intent-[a-f0-9-]{36}\.json$/.test(name));
        const candidates: ConfiguratorStage[] = [];
        for (const name of names) {
          const stage = await readConfiguratorStage(name.slice(0, 36));
          if (stage && stage.applyOperationId === configuratorState.receipt.operationId &&
              isDeepStrictEqual(configuratorState.snapshot.elements, expectedConfiguratorElements(stage)) &&
              fullReplicaHash(configuratorState.snapshot.elements) === fullReplicaHash(current.elements)) candidates.push(stage);
        }
        if (candidates.length !== 1) fail('configurator_completed_stage_ambiguous');
        priorConfigurator = candidates[0];
      }
      const appliedConfigurator = !!(priorConfigurator && configuratorState &&
        isDeepStrictEqual(configuratorState.snapshot.elements, expectedConfiguratorElements(priorConfigurator)) &&
        configuratorState.receipt?.operationId === priorConfigurator.applyOperationId &&
        ['started','complete'].includes(configuratorState.receipt.state) &&
        fullReplicaHash(configuratorState.snapshot.elements) === fullReplicaHash(current.elements));
      if (current.headerId !== null || current.bodyHash !== checkpoint.bodyHash && !partial && !appliedConfigurator && !await proveEmptyBefore(before, checkpoint, operation)) fail('body_before_changed');
      assertActualPreparedBody(body, manifest); const payload = body.payload, media = await mediaFor(body), resolved = resolveActualBodyStyles(body, capabilities.legacySchemas);
      const currentRecord = resolved.program.currentRecord ? await prepareProgramCurrentProduct(services.client, resolved.program, { targetOrigin: manifest.targetOrigin, schemas: capabilities.legacySchemas, controlsByWidget: toNative44CompilerKnowledge(payload.knowledge, capabilities.legacySchemas).controlsByWidget }) : undefined;
      if (currentRecord) {
        await operationFile(operation, 'target-current-product', { observation: currentRecord.observation, bindings: currentRecord.bindings });
        if(!services.client.readCurrentProductRuntime)fail('current_product_runtime_reader_missing');
        const selection=resolved.program.currentRecord!;currentRecord.runtime=await services.client.readCurrentProductRuntime(checkpoint.pageId,manifest.runId,selection.productId,selection.contextKey);
        assertCoreProductPageRuntime(currentRecord.bindings,currentRecord.runtime,selection,manifest.targetOrigin);
      }
      const assets = await importFullReplicaBodyAssets({ client: services.client, root: ROOT, runDir: path.join(runDirectory, 'body-media'), jobDir: media.directory, runId: manifest.runId, pageId: checkpoint.pageId, manifest: media.assets, required: media.required });
      const categories = await prepareProgramCategories(services.client, payload.program, manifest.targetOrigin, async (_query, observed) => (await operationFile(operation, 'target-categories', observed)).path);
      const relatedProducts = await prepareProgramRelatedProducts(services.client, payload.program, manifest.targetOrigin, async (_query, observed) => operationFile(operation, 'target-related-products', observed));
      const posts: TargetPostsEvidence[] = [];
      for (const node of walkNative44(payload.program.blocks)) if (node.kind === 'native-posts') { const observed = await services.client.readTargetPosts(node.query), evidence = await operationFile(operation, `target-posts-${node.key}`, observed); observed.evidence = [evidence.path]; posts.push(observed); }
      let catalog: TargetCatalogEvidence | undefined;
      if (walkNative44(payload.program.blocks).some(node => node.kind === 'native-products')) { const observed = await services.client.readTargetCatalog(200), evidence = await operationFile(operation, 'target-products', observed); catalog = { targetOrigin: observed.targetOrigin, products: observed.products, evidence: [evidence.path] }; }
      const pendingForms = await prepareActualBodyPendingForms(body, capabilities.legacySchemas), compiled = compileActualBody(body, capabilities.legacySchemas, assets, { pendingForms, ...(relatedProducts.length ? { relatedProducts, relatedQualification: payload.knowledge.extension?.relatedQualification } : {}), ...(categories.length ? { categories } : {}), ...(currentRecord ? { currentProduct: currentRecord.provider,currentProductRuntime:currentRecord.runtime } : {}), ...(posts.length ? { posts } : {}), ...(catalog ? { catalog } : {}) });
      const css = compileFullPageCSS(resolved.css, checkpoint.pageId, assets, manifest.runId) + (manifest.responsive ? responsivePageShellCSS(checkpoint.pageId) : '');
      if (partial && (fullReplicaHash(partial.intent.composition.pageSettings) !== fullReplicaHash(compiled.composition.pageSettings) || !sameTreeIgnoringGeneratedCategoryIds(comparisonTree(partial.intent.composition.elements), comparisonTree(compiled.composition.elements)) || partial.intent.css !== css)) fail('partial_body_compilation_changed');
      const configured = manifest.body.configurator ? await prepareConfiguratorStage(compiled, assets, css) : null;
      if (priorConfigurator && (!configured || priorConfigurator.css !== css ||
          fullReplicaHash(priorConfigurator.catalog) !== fullReplicaHash(configured.catalog) ||
          fullReplicaHash(priorConfigurator.assets) !== fullReplicaHash(configured.assets) ||
          fullReplicaHash(priorConfigurator.packageFiles) !== fullReplicaHash(configured.packageFiles) ||
          priorConfigurator.controlsHash !== configured.controlsHash || priorConfigurator.patch.slotId !== configured.slotId ||
          priorConfigurator.patch.widgetId !== configured.widgetId || priorConfigurator.patch.formWidgetId !== configured.formWidgetId)) fail('configurator_staged_inputs_changed');
      const expectedCurrent = await services.client.snapshotDraft(checkpoint.pageId);
      if (!matchesNativeBodyBefore(current.elements, current.settings, expectedCurrent)) fail('document_before_changed');
      if (!partial && !appliedConfigurator) {
        await operationFile(operation, 'reuse-body-save-intent', { before, expectedCurrent, composition: compiled.composition, css, assets, styleResolution: { receipts: resolved.receipts, renderedVerified: false }, sourceUnitIds: body.sourceUnitIds });
        await services.client.buildDraft(checkpoint.pageId, compiled.composition, assets, { expectedCurrent, native44Proof: compiled, htmlProofs: compiled.htmlProofs, preserveUnknownWrite: true });
      }
      let saved = await services.reused.inspect(); if (page(saved).headerId !== null) fail('body_binding_changed');
      if (configured && configurator) {
        configuratorState = await configurator.inspect();
        let stage = priorConfigurator;
        if (!stage) {
          if (fullReplicaHash(configuratorState.snapshot.elements) !== fullReplicaHash(page(saved).elements)) fail('configurator_base_readback');
          const prepared = prepareConfiguratorPatch({ taskId: manifest.runId, pageId: checkpoint.pageId,
            targetOrigin: manifest.targetOrigin, packageSha256: manifest.body.configurator!.packageManifest.sha256,
            registration: { version: 1, widgetType: 'clonewp_bottle_configurator', targetOrigin: manifest.targetOrigin,
              packageSha256: manifest.body.configurator!.packageManifest.sha256, registered: true, controlsVerified: true, packageFilesVerified: true },
            baseElements: configuratorState.snapshot.elements, catalog: configured.catalog, slotId: configured.slotId, widgetId: configured.widgetId });
          const applyOperationId = randomUUID();
          const persisted = await operationFile(operation, 'reuse-configurator-patch-intent', { patch: prepared.intent,
            catalog: configured.catalog, assets: configured.assets, css, packageFiles: configured.packageFiles,
            controlsHash: configured.controlsHash, applyOperationId, base: configuratorState });
          stage = { patch: prepared.intent, catalog: configured.catalog, assets: configured.assets, css,
            packageFiles: configured.packageFiles, controlsHash: configured.controlsHash, applyOperationId, intentHash: persisted.sha256,
            base: configuratorState };
        }
        if (configuratorState.receipt?.state === 'started' && configuratorState.receipt.operationId === stage.applyOperationId)
          configuratorState = await reconcileConfiguratorReceipt(configurator, configuratorState, stage, operation);
        if (configuratorState.snapshot.elementsHash === stage.patch.baseHash &&
            (!configuratorState.receipt || configuratorState.receipt.state === 'not-applied')) {
          try {
            configuratorState = await configurator.apply({ before: configuratorState, patch: stage.patch, catalog: stage.catalog,
              assets: stage.assets, expectedPackageFiles: stage.packageFiles, expectedControlsHash: stage.controlsHash,
              operationId: stage.applyOperationId, intent: { operationId: stage.applyOperationId, runId: manifest.runId,
                resource: `full-replica-configurator/${manifest.runId}`, expectedSnapshotSha256: digest(JSON.stringify(configuratorState.snapshot)),
                persistedIntentSha256: stage.intentHash } });
          } catch (error) {
            const observed = await configurator.inspect();
            const failure = error instanceof Error ? error.message : 'unknown';
            await operationFile(operation, 'reuse-configurator-apply-diagnostic', {
              code: /^[A-Za-z0-9_.:-]{1,160}$/.test(failure) ? failure : 'unclassified',
              receiptState: observed.receipt?.state ?? null,
              baseMatches: observed.snapshot.elementsHash === stage.patch.baseHash,
              patchedMatches: observed.snapshot.elementsHash === stage.patch.patchedHash,
            });
            if (observed.receipt?.operationId !== stage.applyOperationId ||
                !['started','complete'].includes(observed.receipt.state) ||
                !isDeepStrictEqual(observed.snapshot.elements, expectedConfiguratorElements(stage))) throw error;
            configuratorState = observed.receipt.state === 'started'
              ? await reconcileConfiguratorReceipt(configurator, observed, stage, operation) : observed;
          }
        }
        if (!isDeepStrictEqual(configuratorState.snapshot.elements, expectedConfiguratorElements(stage)) || configuratorState.receipt?.state !== 'complete') fail('configurator_patch_readback');
        saved = await services.reused.inspect();
        if (fullReplicaHash(page(saved).elements) !== fullReplicaHash(configuratorState.snapshot.elements)) fail('configurator_reused_readback');
        await operationFile(operation, 'reuse-configurator-confirmed', { patch: stage.patch, remote: configuratorState,
          pageSnapshotHash: saved.hash, catalogHash: fullReplicaHash(stage.catalog), assetIds: stage.assets.map(row => row.id) });
      }
      const styled = configured && String(page(saved).settings.custom_css ?? '') === css
        ? saved : (await mutate('style', saved, operation, { pageId: checkpoint.pageId, css })).snapshot;
      const actual = page(styled);
      if (fullReplicaHash(actual.elements) !== fullReplicaHash(page(saved).elements) || digest(String(actual.settings.custom_css ?? '')) !== digest(css)) fail('body_style_readback');
      const resultCheckpoint: FullReplicaBodyCheckpoint = { ...pageCheckpoint(styled), cssHash: digest(css), documentHash: documentHashV2(actual.elements, actual.settings), sourceUnitIds: [...body.sourceUnitIds], embeddedHeaderCount: 0 };
      await operationFile(operation, 'reuse-body-confirmed', { snapshot: styled, checkpoint: resultCheckpoint }); return resultCheckpoint;
    },
    async bindReusedHeader(body, operation) {
      const services = await remote(), before = await services.reused.inspect(), current = page(before, body.pageId);
      if (current.headerId !== null || current.bodyHash !== body.bodyHash || documentHashV2(current.elements, current.settings) !== body.documentHash || digest(String(current.settings.custom_css ?? '')) !== body.cssHash) fail('binding_before_changed');
      const result = await mutate('bind', before, operation, { pageId: body.pageId }), actual = page(result.snapshot);
      const checkpoint: FullReplicaBoundCheckpoint = { pageId: body.pageId, runId: manifest.runId, headerId: resources.headerId, editUrl: body.editUrl, previewUrl: body.previewUrl, bodyHash: actual.bodyHash, documentHash: documentHashV2(actual.elements, actual.settings), cssHash: body.cssHash, headerHash: resources.headerHash, menuHash: resources.menuHash, styleHash: resources.styleHash };
      assertBound(result.snapshot, checkpoint); await operationFile(operation, 'reuse-binding-confirmed', { snapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async reviewWholePage(_prepared, bound, reviewInput) { return reviewInput === undefined ? null : validateFullReplicaReview(reviewInput, manifest, bound); },
    async inspectInquirySubmission(bound,elementId,testMarker) {
      const services=await remote(),fresh=await services.reused.inspect();assertBound(fresh,bound);
      const program=validateNative44Program(JSON.parse((await input.readBound(manifest.body.program)).bytes.toString('utf8')));assertInquiryElement(program,elementId);
      if(!services.full.readInquirySubmission)fail('inquiry_reader_unavailable');
      return services.full.readInquirySubmission({pageId:bound.pageId,runId:manifest.runId,elementId,testMarker});
    },
    async verifyReview(review, bound) {
      validateFullReplicaReview(review, manifest, bound); const services = await remote(), current = await services.reused.inspect(); assertBound(current, bound);
      await verifyFullReplicaReviewEvidence(review, bound, manifest, current.page!.elements,services.full.readInquirySubmission?.bind(services.full));
    },
    async publishWithoutReview(bound, operation) {
      if (!manifest.reviewSkipPolicy) fail('review_skip_policy_required');
      const services = await remote(), before = await services.reused.inspect(); assertBound(before, bound);
      const authorizationHash = fullReplicaHash(manifest.reviewSkipPolicy);
      await operationFile(operation, 'reuse-review-skipped', { policy: manifest.reviewSkipPolicy, authorizationHash, fingerprint: fullReplicaFingerprint(bound), checks: 'not-performed' });
      const result = await mutate('publish', before, operation, { pageId: bound.pageId, publicationAuthorizationHash: authorizationHash }); assertBound(result.snapshot, bound, 'publish');
      const { previewUrl: _preview, ...rest } = bound, checkpoint = { ...rest, status: 'publish' as const, publicUrl: result.snapshot.page!.publicUrl };
      await operationFile(operation, 'reuse-publish-confirmed', { snapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async publishPage(bound, review, operation) {
      await dependencies.verifyReview(review, bound); const services = await remote(), before = await services.reused.inspect(); assertBound(before, bound);
      const result = await mutate('publish', before, operation, { pageId: bound.pageId, reviewHash: fullReplicaHash(review) }); assertBound(result.snapshot, bound, 'publish');
      const { previewUrl: _preview, ...rest } = bound, checkpoint = { ...rest, status: 'publish' as const, publicUrl: result.snapshot.page!.publicUrl }; await operationFile(operation, 'reuse-publish-confirmed', { snapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async reviseConfiguratorCatalog(prepared, bound, newCatalog, packageManifest, operation) {
      if (!manifest.body.configurator) fail('configurator_catalog_scope');
      assertActualPreparedBody(prepared.body, manifest);
      const services = await remote(), before = await services.reused.inspect(); assertBound(before, bound);
      const driver = await configuratorDriver(services, bound.pageId), current = await driver.inspect();
      if (!current.receipt || current.receipt.state !== 'complete' ||
          fullReplicaHash(current.snapshot.elements) !== fullReplicaHash(page(before).elements)) fail('configurator_catalog_before');
      const prior = await currentCatalogStage(current.receipt.operationId);
      const packageFile = await input.readBound(packageManifest);
      const packageData = JSON.parse(packageFile.bytes.toString('utf8')) as { version?: number; kind?: string;
        files?: Array<{ path: string; sha256: string; bytes: number }> };
      const packageFiles = Object.fromEntries((packageData.files ?? []).map(row => [row.path, row.sha256]));
      if (packageData.version !== 1 || packageData.kind !== 'clonewp-configurator-package' ||
          packageData.files?.length !== 3 ||
          fullReplicaHash(packageFiles) !== fullReplicaHash(current.snapshot.pluginFiles))
        fail('configurator_registered_package_changed');
      const requiredControls = ['options','form_widget','summary_field','upload_field','decorations','overlays','fonts',
        'filter_groups_json','logo_colors'];
      // PHP hashes its ordered registration object; JavaScript reorders integer-like keys
      // when parsing that object. Keep the server hash opaque and verify required controls.
      if (requiredControls.some(key => !Object.hasOwn(current.snapshot.controls, key)))
        fail('configurator_registered_controls_changed');
      const preparedRevision = prepareConfiguratorCatalogRevision({ taskId: manifest.runId, pageId: bound.pageId,
        targetOrigin: manifest.targetOrigin, slotId: prior.slotId, widgetId: prior.widgetId,
        formWidgetId: prior.formWidgetId, priorOperationId: current.receipt.operationId,
        settingsHash: current.snapshot.settingsHash, baseElements: current.snapshot.elements,
        oldCatalog: prior.catalog, newCatalog });
      const applyOperationId = randomUUID();
      const stage = { revision: preparedRevision.intent, oldCatalog: prior.catalog, newCatalog,
        assets: prior.assets, applyOperationId, packageFiles: current.snapshot.pluginFiles,
        controlsHash: current.snapshot.controlsHash, packageManifest, base: current };
      const persisted = await operationFile(operation, 'reuse-configurator-catalog-revision-intent', stage);
      const result = await driver.reviseCatalog({ before: current, revision: preparedRevision.intent,
        oldCatalog: prior.catalog, newCatalog, assets: prior.assets, expectedPackageFiles: current.snapshot.pluginFiles,
        expectedControlsHash: current.snapshot.controlsHash, operationId: applyOperationId,
        intent: { operationId: applyOperationId, runId: manifest.runId,
          resource: `full-replica-configurator/${manifest.runId}`,
          expectedSnapshotSha256: digest(JSON.stringify(current.snapshot)), persistedIntentSha256: persisted.sha256 } });
      const fresh = await services.reused.inspect(), actual = page(fresh, bound.pageId);
      if (!isDeepStrictEqual(result.snapshot.elements, actual.elements) ||
          result.snapshot.settingsHash !== current.snapshot.settingsHash ||
          digest(String(actual.settings.custom_css ?? '')) !== bound.cssHash) fail('configurator_catalog_readback');
      const checkpoint = { ...bound, bodyHash: actual.bodyHash,
        documentHash: documentHashV2(actual.elements, actual.settings) };
      assertBound(fresh, checkpoint);
      await operationFile(operation, 'reuse-configurator-catalog-revision-confirmed', { stage, snapshot: fresh, checkpoint });
      return checkpoint;
    },
    async reviseStyle(prepared, bound, reference, operation) {
      assertActualPreparedBody(prepared.body, manifest); const file = await input.readBound(reference), sourceCSS = file.bytes.toString('utf8'); assertNativeImageCSS(manifest.nativeImagePolicy, prepared.body.payload.program, sourceCSS);
      const ledger = JSON.parse(await readFile(path.join(runDirectory, 'body-media', 'assets', 'ledger.json'), 'utf8'));
      if (ledger.runId !== manifest.runId || ledger.pageId !== bound.pageId || ledger.assets.some((entry: any) => entry.status !== 'complete')) fail('media_ledger_changed');
      const effectiveCSS = manifest.responsive ? prepareResponsiveBody(prepared.body.payload.baseProgram!, manifest.responsive, sourceCSS).css : sourceCSS;
      const css = compileFullPageCSS(effectiveCSS, bound.pageId, ledger.assets.map((entry: any) => entry.imported), manifest.runId) + (manifest.responsive ? responsivePageShellCSS(bound.pageId) : '');
      const services = await remote(), before = await services.reused.inspect(); assertBound(before, bound);
      if (css === String(before.page!.settings.custom_css ?? '')) return bound;
      const result = await mutate('style', before, operation, { pageId: bound.pageId, css }), actual = page(result.snapshot), checkpoint = { ...bound, bodyHash: actual.bodyHash, documentHash: documentHashV2(actual.elements, actual.settings), cssHash: digest(css) };
      assertBound(result.snapshot, checkpoint); await operationFile(operation, 'reuse-style-revision-confirmed', { snapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async reconcileOperation(_prepared, operation, checkpoints) {
      const services = await remote(), current = await services.reused.inspect(), directory = path.join(runDirectory, 'operations');
      if (operation.phase === 'catalog-revision' && checkpoints.bound && manifest.body.configurator) {
        const bound = checkpoints.bound, stage = await readCatalogRevisionStage(operation.operationId);
        if (!stage) {
          const driver = await configuratorDriver(services, bound.pageId), remoteState = await driver.inspect();
          if (remoteState.receipt?.state === 'started' ||
              !isDeepStrictEqual(remoteState.snapshot.elements, current.page?.elements)) return { status: 'conflict' };
          try { assertBound(current, bound); return { status: 'before' }; } catch { return { status: 'conflict' }; }
        }
        if (stage.revision.pageId !== bound.pageId || stage.revision.taskId !== manifest.runId ||
            stage.revision.targetOrigin !== manifest.targetOrigin) return { status: 'conflict' };
        const driver = await configuratorDriver(services, bound.pageId);
        let remoteState = await driver.inspect();
        await operationFile(operation, 'reuse-configurator-catalog-reconcile-observation', {
          receipt: remoteState.receipt ? { state: remoteState.receipt.state, operationId: remoteState.receipt.operationId, kind: remoteState.receipt.kind } : null,
          pluginMatch: fullReplicaHash(remoteState.snapshot.pluginFiles) === fullReplicaHash(stage.packageFiles),
          controlsMatch: remoteState.snapshot.controlsHash === stage.controlsHash,
          pageElementsMatch: isDeepStrictEqual(remoteState.snapshot.elements, current.page?.elements),
          baseHash: stage.revision.baseHash, currentElementsHash: fullReplicaHash(remoteState.snapshot.elements),
        });
        if (fullReplicaHash(remoteState.snapshot.pluginFiles) !== fullReplicaHash(stage.packageFiles) ||
            remoteState.snapshot.controlsHash !== stage.controlsHash) return { status: 'conflict' };
        const expected = prepareConfiguratorCatalogRevision({ taskId: manifest.runId, pageId: bound.pageId,
          targetOrigin: manifest.targetOrigin, slotId: stage.revision.slotId, widgetId: stage.revision.widgetId,
          formWidgetId: stage.revision.formWidgetId, priorOperationId: stage.revision.priorOperationId,
          settingsHash: stage.revision.settingsHash, baseElements: stage.base.snapshot.elements,
          oldCatalog: stage.oldCatalog, newCatalog: stage.newCatalog });
        if (!isDeepStrictEqual(expected.intent, stage.revision) ||
            !isDeepStrictEqual(remoteState.snapshot.elements, current.page?.elements)) return { status: 'conflict' };
        if (remoteState.receipt?.state === 'started' && remoteState.receipt.operationId === stage.applyOperationId) {
          const proof = await operationFile(operation, 'reuse-configurator-catalog-reconcile-intent',
            { revision: stage.revision, before: remoteState, applyOperationId: stage.applyOperationId });
          remoteState = await driver.reconcileRevision({ before: remoteState, revision: stage.revision,
            expectedElements: expected.elements, operationId: stage.applyOperationId,
            intent: { operationId: stage.applyOperationId, runId: manifest.runId,
              resource: `full-replica-configurator/${manifest.runId}`,
              expectedSnapshotSha256: digest(JSON.stringify(remoteState.snapshot)), persistedIntentSha256: proof.sha256 } });
        }
        const effect = reconcileConfiguratorCatalogRevision(stage.revision, remoteState.snapshot.elements, expected.elements);
        if (effect === 'not-applied' && (remoteState.receipt?.state === 'not-applied' ||
            remoteState.receipt?.state === 'complete' && remoteState.receipt.operationId === stage.revision.priorOperationId)) {
          try { assertBound(current, bound); return { status: 'before' }; } catch { return { status: 'conflict' }; }
        }
        if (effect === 'applied' && remoteState.receipt?.state === 'complete' &&
            remoteState.receipt.operationId === stage.applyOperationId && remoteState.receipt.kind === 'catalog-revision') {
          const actual = page(current, bound.pageId);
          const checkpoint = { ...bound, bodyHash: actual.bodyHash,
            documentHash: documentHashV2(actual.elements, actual.settings) };
          try { assertBound(current, checkpoint); } catch { return { status: 'conflict' }; }
          await operationFile(operation, 'reuse-configurator-catalog-revision-confirmed',
            { stage, snapshot: current, checkpoint, reconciled: true });
          return { status: 'after', checkpoint };
        }
        return { status: 'conflict' };
      }
      const names = (await readdir(directory)).filter(name => name.startsWith(`${operation.operationId}-reuse-`) && name.includes('-confirmed-'));
      for (const name of names) {
        const proof = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
        if (fullReplicaHash(proof.operation) !== fullReplicaHash(operation) || proof.value?.snapshot?.hash !== current.hash || !proof.value?.checkpoint) continue;
        const checkpoint = proof.value.checkpoint;
        if (operation.phase === 'page' && checkpoint.pageId === current.page?.pageId && current.page?.headerId === null && !current.page?.elements.length || operation.phase === 'body' && current.page?.headerId === null && checkpoint.bodyHash === current.page?.bodyHash && checkpoint.documentHash === documentHashV2(current.page!.elements, current.page!.settings)) return { status: 'after', checkpoint };
        if (['binding', 'publish', 'style-revision'].includes(operation.phase)) { assertBound(current, checkpoint, operation.phase === 'publish' ? 'publish' : 'draft'); return { status: 'after', checkpoint }; }
      }
      if (input.recoverInterruptedStyle && operation.phase === 'style-revision' && checkpoints.bound && current.page) {
        const all = await readdir(directory), intentNames = all.filter(name => name.startsWith(`${operation.operationId}-reuse-style-intent-`) && name.endsWith('.json'));
        if (intentNames.length === 1) {
          const style = JSON.parse(await readFile(path.join(directory, intentNames[0]), 'utf8'));
          const intent = style.value, bound = checkpoints.bound, started = current.receipts[intent?.operationId];
          const confirmedNames = all.filter(name => name.includes('-reuse-style-revision-confirmed-') && name.endsWith('.json'));
          const prior = [];
          for (const name of confirmedNames) { const record = JSON.parse(await readFile(path.join(directory, name), 'utf8')); if (record.value?.checkpoint?.bodyHash === bound.bodyHash && record.value?.checkpoint?.documentHash === bound.documentHash && record.value?.checkpoint?.cssHash === bound.cssHash) prior.push(record.value.snapshot as ReusedBodySnapshot); }
          if (prior.length === 1 && started?.action === 'style' && started.state === 'started' && started.payloadHash === intent?.payloadHash && fullReplicaHash(style.operation) === fullReplicaHash(operation) && intent?.action === 'style' && intent.payload?.pageId === bound.pageId && intent.payload?.css === current.page.settings.custom_css && intent.protectedHash === resources.sharedHash && /^[a-f0-9]{64}$/.test(intent.beforeHash)) {
            const before = prior[0], actual = current.page, earlier = before.page!;
            const { custom_css: _oldCSS, ...oldSettings } = earlier.settings, { custom_css: _newCSS, ...newSettings } = actual.settings;
            const receipts = { ...current.receipts }; delete receipts[intent.operationId];
            const elementsProved = fullReplicaHash(actual.elements) === fullReplicaHash(earlier.elements);
            if (elementsProved && fullReplicaHash(oldSettings) === fullReplicaHash(newSettings) && fullReplicaHash(receipts) === fullReplicaHash(before.receipts) && fullReplicaHash(current.resources) === fullReplicaHash(before.resources) && actual.pageId === earlier.pageId && actual.status === 'draft' && actual.headerId === earlier.headerId && actual.title === earlier.title && actual.slug === earlier.slug && fullReplicaHash(actual.flags) === fullReplicaHash(earlier.flags)) {
              const recoveryId = randomUUID(), payload = { receiptId: intent.operationId, payloadHash: intent.payloadHash, bodyHash: actual.bodyHash, documentHash: actual.documentHash, cssHash: digest(intent.payload.css) };
              const proof = await operationFile(operation, 'reuse-style-after-recovery-intent', { operationId: recoveryId, payload, styleIntent: intentNames[0], priorBodyHash: bound.bodyHash });
              const recovered = await services.reused.recoverStartedStyleAfter(current, recoveryId, payload, { operationId: recoveryId, runId: manifest.runId, resource: `full-replica-reuse/${manifest.runId}`, expectedSnapshotSha256: current.hash, persistedIntentSha256: proof.sha256 });
              const checkpoint = { ...bound, bodyHash: actual.bodyHash, documentHash: documentHashV2(actual.elements, actual.settings), cssHash: payload.cssHash };
              assertBound(recovered.snapshot, checkpoint);
              await operationFile(operation, 'reuse-style-revision-confirmed', { snapshot: recovered.snapshot, checkpoint, recoveredStartedReceipt: intent.operationId });
              return { status: 'after', checkpoint };
            }
          }
        }
      }
      if (operation.phase === 'page' && !current.page && !Object.values(current.receipts).some(row => row.state === 'started')) return { status: 'before' };
      if (operation.phase === 'body' && checkpoints.page && current.page?.bodyHash === checkpoints.page.bodyHash && current.page.headerId === null) return { status: 'before' };
      if (operation.phase === 'body' && checkpoints.page && !checkpoints.body && !checkpoints.bound && await proveEmptyBefore(current, checkpoints.page, operation)) return { status: 'before' };
      if (operation.phase === 'body' && checkpoints.page && !checkpoints.body && !checkpoints.bound) {
        const partial = await partialSavedBody(current, operation.operationId);
        if (partial) {
          const currentPage = current.page!;
          const started = Object.entries(current.receipts).filter(([,row]) => row.state === 'started');
          if (!started.length) return { status: 'before' };
          if (input.recoverInterruptedStyle && started.length === 1) {
            const [receiptId, receipt] = started[0];
            const files = (await readdir(directory)).filter(name => name.startsWith(`${operation.operationId}-reuse-style-intent-`) && name.endsWith('.json'));
            if (files.length !== 1) return { status: 'conflict' };
            const style = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8'));
            if (fullReplicaHash(style.operation) !== fullReplicaHash(operation) || style.value?.operationId !== receiptId || style.value?.action !== 'style' || style.value?.payloadHash !== receipt.payloadHash || style.value?.payload?.pageId !== currentPage.pageId || style.value?.payload?.css !== partial.intent.css) return { status: 'conflict' };
            const recoveryId = randomUUID(), payload = { receiptId, payloadHash: receipt.payloadHash, bodyHash: currentPage.bodyHash };
            const intent = await operationFile(operation, 'reuse-style-recovery-intent', { operationId: recoveryId, action: 'recover-style-before', beforeHash: current.hash, payload, proof: files[0] });
            const recovered = await services.reused.recoverStartedStyleBefore(current, recoveryId, payload, { operationId: recoveryId, runId: manifest.runId, resource: `full-replica-reuse/${manifest.runId}`, expectedSnapshotSha256: current.hash, persistedIntentSha256: intent.sha256 });
            await operationFile(operation, 'reuse-style-recovery-confirmed', { snapshot: recovered.snapshot, removedReceiptId: receiptId, bodyHash: currentPage.bodyHash });
            return { status: 'before' };
          }
        }
      }
      if (operation.phase === 'body' && manifest.body.configurator && checkpoints.page && !checkpoints.body && !checkpoints.bound && current.page) {
        const stage = await readConfiguratorStage(operation.operationId);
        if (stage && stage.patch.pageId === checkpoints.page.pageId && stage.patch.targetOrigin === manifest.targetOrigin &&
            stage.patch.taskId === manifest.runId && current.page.headerId === null &&
            ['', stage.css].includes(String(current.page.settings.custom_css ?? ''))) {
          const driver = await configuratorDriver(services, checkpoints.page.pageId);
          let state = await driver.inspect();
          if (!state.receipt && state.snapshot.elementsHash === stage.patch.baseHash &&
              fullReplicaHash(state.snapshot.elements) === fullReplicaHash(current.page.elements) &&
              Object.values(current.receipts).every(row => row.state === 'complete'))
            return { status: 'before' };
          if (fullReplicaHash(state.snapshot.elements) === fullReplicaHash(current.page.elements) &&
              state.receipt?.operationId === stage.applyOperationId) {
            if (state.receipt.state === 'started') state = await reconcileConfiguratorReceipt(driver, state, stage, operation);
            if (isDeepStrictEqual(state.snapshot.elements, expectedConfiguratorElements(stage)) && state.receipt?.state === 'complete') {
              const started = Object.entries(current.receipts).filter(([, row]) => row.state !== 'complete');
              if (!started.length) return { status: 'before' };
              if (input.recoverInterruptedStyle && started.length === 1 && started[0][1].action === 'style' &&
                  started[0][1].state === 'started' && String(current.page.settings.custom_css ?? '') === '') {
                const [receiptId, receipt] = started[0];
                const files = (await readdir(directory)).filter(name => name.startsWith(`${operation.operationId}-reuse-style-intent-`) && name.endsWith('.json'));
                if (files.length !== 1) return { status: 'conflict' };
                const style = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8'));
                if (fullReplicaHash(style.operation) !== fullReplicaHash(operation) || style.value?.operationId !== receiptId ||
                    style.value?.action !== 'style' || style.value?.payloadHash !== receipt.payloadHash ||
                    style.value?.payload?.pageId !== current.page.pageId || style.value?.payload?.css !== stage.css)
                  return { status: 'conflict' };
                const recoveryId = randomUUID(), payload = { receiptId, payloadHash: receipt.payloadHash, bodyHash: current.page.bodyHash };
                const intent = await operationFile(operation, 'reuse-style-recovery-intent', { operationId: recoveryId,
                  action: 'recover-style-before', beforeHash: current.hash, payload, proof: files[0], configuratorPatchHash: stage.patch.patchedHash });
                const recovered = await services.reused.recoverStartedStyleBefore(current, recoveryId, payload, {
                  operationId: recoveryId, runId: manifest.runId, resource: `full-replica-reuse/${manifest.runId}`,
                  expectedSnapshotSha256: current.hash, persistedIntentSha256: intent.sha256 });
                await operationFile(operation, 'reuse-style-recovery-confirmed', { snapshot: recovered.snapshot,
                  removedReceiptId: receiptId, configuratorPatchHash: stage.patch.patchedHash });
                return { status: 'before' };
              }
            }
            if (state.snapshot.elementsHash === stage.patch.baseHash && state.receipt?.state === 'not-applied' &&
                Object.values(current.receipts).every(row => row.state === 'complete')) return { status: 'before' };
          }
        }
      }
      // A page-scoped CSS candidate can be rejected by the local compiler before
      // a remote mutation begins. Only the exact unchanged bound draft, with no
      // started receipt, permits that operation to be cleared as "before".
      if (operation.phase === 'style-revision' && checkpoints.bound && !Object.values(current.receipts).some(row => row.state === 'started')) {
        try { assertBound(current, checkpoints.bound, 'draft'); return { status: 'before' }; }
        catch { /* A changed draft remains an unresolved conflict. */ }
      }
      return { status: 'conflict' };
    },
  };
  return dependencies;
}

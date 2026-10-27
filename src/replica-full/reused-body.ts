import { isNativeReplicaSlug } from '../core/replica-url.js';
import {verifyBodyStyleAmendmentMedia} from './unwritten-body-style-amendment.js';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { prepareActualBody, assertActualPreparedBody, compileActualBody, prepareActualBodyPendingForms, resolveActualBodyStyles } from './body-prepare.js';
import { fullReplicaHash, fullReplicaFingerprint, validateFullReplicaReview } from './contract.js';
import { fullPageCSSAssetKeys, importFullReplicaBodyAssets, matchesNativeBodyBefore, matchesPublishedDocument, verifyFullReplicaReviewEvidence, type FullReplicaRemoteServices } from './body.js';
import { compileFullPageCSS } from './css.js';
import { referencedNative44Assets, usedNative44WidgetTypes } from '../native44/compiler.js';
import type { Native44Asset } from '../native44/media.js';
import { walkNative44 } from '../native44/types.js';
import { validateNative44Program } from '../native44/validate.js';
import { assertInquiryElement } from './inquiry-review.js';
import { prepareProgramCurrentProduct, assertCoreProductPageRuntime } from '../native44/current-product.js';
import { toNative44CompilerKnowledge } from '../native44/knowledge.js';
import { certifyResponsiveSchemas } from '../replica-responsive/target.js';
import { responsivePageShellCSS } from '../replica-responsive/defaults.js';
import { prepareResponsiveBody } from '../replica-responsive/body.js';
import { documentHashV2 } from '../replica-v2/journal.js';
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
  const mediaFor = async (body: FullReplicaPreparedBody) => {
    assertActualPreparedBody(body, manifest); const payload = body.payload;
    const nativeKeys = referencedNative44Assets(payload.program), cssKeys = fullPageCSSAssetKeys(payload.css), required = [...new Set([...nativeKeys, ...cssKeys])];
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
      if(input.bodyStyleAmendment?.request.version===2){mediaVerification=await verifyBodyStyleAmendmentMedia(runDirectory,input.bodyStyleAmendment.request,manifest.title,services.client);}
      const fresh = await services.reused.inspect();
      if (fresh.hash !== before.hash) fail('style_amendment_snapshot_changed');
      return { ...(mediaVerification?{mediaVerification}:{}),snapshot: fresh, styleResolution: { receipts: resolved.receipts, renderedVerified: false }, effectiveProgramHash: body.payload.authoringAmendment?.effectiveProgramHash, remoteWrites: 0 };
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
      if (current.headerId !== null || current.bodyHash !== checkpoint.bodyHash && !await proveEmptyBefore(before, checkpoint, operation)) fail('body_before_changed');
      assertActualPreparedBody(body, manifest); const payload = body.payload, media = await mediaFor(body), resolved = resolveActualBodyStyles(body, capabilities.legacySchemas);
      const currentRecord = resolved.program.currentRecord ? await prepareProgramCurrentProduct(services.client, resolved.program, { targetOrigin: manifest.targetOrigin, schemas: capabilities.legacySchemas, controlsByWidget: toNative44CompilerKnowledge(payload.knowledge, capabilities.legacySchemas).controlsByWidget }) : undefined;
      if (currentRecord) {
        await operationFile(operation, 'target-current-product', { observation: currentRecord.observation, bindings: currentRecord.bindings });
        if(!services.client.readCurrentProductRuntime)fail('current_product_runtime_reader_missing');
        const selection=resolved.program.currentRecord!;currentRecord.runtime=await services.client.readCurrentProductRuntime(checkpoint.pageId,manifest.runId,selection.productId,selection.contextKey);
        assertCoreProductPageRuntime(currentRecord.bindings,currentRecord.runtime,selection,manifest.targetOrigin);
      }
      const assets = await importFullReplicaBodyAssets({ client: services.client, root: ROOT, runDir: path.join(runDirectory, 'body-media'), jobDir: media.directory, runId: manifest.runId, pageId: checkpoint.pageId, manifest: media.assets, required: media.required });
      const posts: TargetPostsEvidence[] = [];
      for (const node of walkNative44(payload.program.blocks)) if (node.kind === 'native-posts') { const observed = await services.client.readTargetPosts(node.query), evidence = await operationFile(operation, `target-posts-${node.key}`, observed); observed.evidence = [evidence.path]; posts.push(observed); }
      let catalog: TargetCatalogEvidence | undefined;
      if (walkNative44(payload.program.blocks).some(node => node.kind === 'native-products')) { const observed = await services.client.readTargetCatalog(200), evidence = await operationFile(operation, 'target-products', observed); catalog = { targetOrigin: observed.targetOrigin, products: observed.products, evidence: [evidence.path] }; }
      const pendingForms = await prepareActualBodyPendingForms(body, capabilities.legacySchemas), compiled = compileActualBody(body, capabilities.legacySchemas, assets, { pendingForms, ...(currentRecord ? { currentProduct: currentRecord.provider,currentProductRuntime:currentRecord.runtime } : {}), ...(posts.length ? { posts } : {}), ...(catalog ? { catalog } : {}) });
      const css = compileFullPageCSS(resolved.css, checkpoint.pageId, assets, manifest.runId) + (manifest.responsive ? responsivePageShellCSS(checkpoint.pageId) : '');
      const expectedCurrent = await services.client.snapshotDraft(checkpoint.pageId); if (!matchesNativeBodyBefore(current.elements, current.settings, expectedCurrent)) fail('document_before_changed');
      await operationFile(operation, 'reuse-body-save-intent', { before, expectedCurrent, composition: compiled.composition, css, assets, styleResolution: { receipts: resolved.receipts, renderedVerified: false }, sourceUnitIds: body.sourceUnitIds });
      await services.client.buildDraft(checkpoint.pageId, compiled.composition, assets, { expectedCurrent, native44Proof: compiled, htmlProofs: compiled.htmlProofs, preserveUnknownWrite: true });
      const saved = await services.reused.inspect(); if (page(saved).headerId !== null) fail('body_binding_changed');
      const result = await mutate('style', saved, operation, { pageId: checkpoint.pageId, css }), actual = page(result.snapshot);
      if (fullReplicaHash(actual.elements) !== fullReplicaHash(page(saved).elements) || digest(String(actual.settings.custom_css ?? '')) !== digest(css)) fail('body_style_readback');
      const resultCheckpoint: FullReplicaBodyCheckpoint = { ...pageCheckpoint(result.snapshot), cssHash: digest(css), documentHash: documentHashV2(actual.elements, actual.settings), sourceUnitIds: [...body.sourceUnitIds], embeddedHeaderCount: 0 };
      await operationFile(operation, 'reuse-body-confirmed', { snapshot: result.snapshot, checkpoint: resultCheckpoint }); return resultCheckpoint;
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
      const names = (await readdir(directory)).filter(name => name.startsWith(`${operation.operationId}-reuse-`) && name.includes('-confirmed-'));
      for (const name of names) {
        const proof = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
        if (fullReplicaHash(proof.operation) !== fullReplicaHash(operation) || proof.value?.snapshot?.hash !== current.hash || !proof.value?.checkpoint) continue;
        const checkpoint = proof.value.checkpoint;
        if (operation.phase === 'page' && checkpoint.pageId === current.page?.pageId && current.page?.headerId === null && !current.page?.elements.length || operation.phase === 'body' && current.page?.headerId === null && checkpoint.bodyHash === current.page?.bodyHash && checkpoint.documentHash === documentHashV2(current.page!.elements, current.page!.settings)) return { status: 'after', checkpoint };
        if (['binding', 'publish', 'style-revision'].includes(operation.phase)) { assertBound(current, checkpoint, operation.phase === 'publish' ? 'publish' : 'draft'); return { status: 'after', checkpoint }; }
      }
      if (operation.phase === 'page' && !current.page && !Object.values(current.receipts).some(row => row.state === 'started')) return { status: 'before' };
      if (operation.phase === 'body' && checkpoints.page && current.page?.bodyHash === checkpoints.page.bodyHash && current.page.headerId === null) return { status: 'before' };
      if (operation.phase === 'body' && checkpoints.page && !checkpoints.body && !checkpoints.bound && await proveEmptyBefore(current, checkpoints.page, operation)) return { status: 'before' };
      return { status: 'conflict' };
    },
  };
  return dependencies;
}

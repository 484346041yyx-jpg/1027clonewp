import { isNativeReplicaSlug } from '../core/replica-url.js';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, statfs } from 'node:fs/promises';
import { z } from 'zod';
import sharp from 'sharp';
import { parse } from 'parse5';
import {nativeViewportRasterMapping} from '../core/native-viewport-raster.js';
import {assertCompletedStyleRevision} from './style-revision.js';
import { createHeaderBundle, loadHeaderBundle, withHeaderBundleLock, type HeaderBundle } from '../woodmart-header/generic/bundle.js';
import { validateHeaderModulePlan, modulePlanHash } from '../woodmart-header/generic/contract.js';
import { compileHeaderModuleStyles } from '../woodmart-header/generic/styles.js';
import { provisionHeaderModule, checkpointHeaderModule, bindHeaderModulePage, updateHeaderModule, reconcileHeaderModule, compileBundleStyles } from '../woodmart-header/generic/service.js';
import type { HeaderModuleDriver, HeaderRemoteModule, HeaderModuleIdentity } from '../woodmart-header/generic/wordpress.js';
import { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { WordPressClient } from '../wordpress/client.js';
import {WordPressConnection} from '../wordpress/connection.js';
import type { DraftSnapshot, CapabilityReport } from '../wordpress/types.js';
import { importNative44Media, importNative44SourceFonts, type Native44Asset } from '../native44/media.js';
import { referencedNative44Assets, usedNative44WidgetTypes } from '../native44/compiler.js';
import { walkNative44 } from '../native44/types.js';
import { prepareProgramCurrentProduct, assertCoreProductPageRuntime } from '../native44/current-product.js';
import { toNative44CompilerKnowledge } from '../native44/knowledge.js';
import { validateAssetBytesV2 } from '../assets/validation.js';
import { validateSourceFontBytes } from '../wordpress/source-font.js';
import { canonicalV2, documentHashV2 } from '../replica-v2/journal.js';
import type { ImportedAssetV2 } from '../replica-v2/types.js';
import type { TargetPostsEvidence } from '../wordpress/posts-contract.js';
import type { TargetCatalogEvidence } from '../wordpress/catalog-contract.js';
import { prepareActualBody, assertActualPreparedBody, compileActualBody, prepareActualBodyPendingForms, resolveActualBodyStyles, type ActualBodyPayload } from './body-prepare.js';
import { requiredReplicaViewports } from '../replica-responsive/contract.js';
import { prepareResponsiveBody } from '../replica-responsive/body.js';
import { verifyResponsiveReview } from '../replica-responsive/review.js';
import { assertResponsiveTarget, certifyResponsiveSchemas, type ResponsiveTarget } from '../replica-responsive/target.js';
import { responsivePageShellCSS } from '../replica-responsive/defaults.js';
import { responsiveHeaderPageCSS, adaptiveHeaderCSS } from '../replica-responsive/header.js';
import { WordPressFullReplicaDriver, type FullReplicaDriver, type FullReplicaDriverAction, type FullReplicaRemoteSnapshot } from './driver.js';
import { compileFullPageCSS } from './css.js';
import { captureNativeHeaderFailure } from './native-diagnostics.js';
import { FullReplicaHeaderModuleDriver } from './native-header.js';
import { patchNativeCarouselMotion, assertNativeMotionBoundary, type NativeMotionPatch } from './native-motion.js';
import { FullReplicaReviewBarrier } from './review-barrier.js';
import { compileNavigationFormPatch, assertNavigationFormBoundary } from './navigation-form/index.js';
import { assertNavigationFormDOM, assertNavigationFormInteraction, navigationFormSelector } from './navigation-form-review.js';
import { compileNavigationReturnPatch, assertNavigationReturnBoundary, NAVIGATION_RETURN_VERSION, type NavigationReturnPatch } from './navigation-return.js';
import { assertEffectiveHeaderPlan, prepareHeaderStyle, beginHeaderStyle, replaceHeaderCSS, confirmHeaderStyle, readPendingHeaderStyle, confirmedHeaderStyleResult, restoreHeaderStyleBefore, assertHeaderStyleRemoteBoundary } from './header-style.js';
import { fullReplicaHash, fullReplicaFingerprint, validateFullReplicaManifest, validateFullReplicaReview } from './contract.js';
import { assertNativeImageCSS, verifyNativeImageChecks } from './native-image-policy.js';
import { activeVerifiedEvidenceReader, withVerifiedEvidenceReader } from '../core/verified-evidence.js';
import { validateNative44Program } from '../native44/validate.js';
import { prepareHeaderMenuContentLocal } from '../woodmart-header/generic/menu-content.js';
import { verifyFullReplicaVisualReview, verifyFullReplicaPhoneVisualReview } from './visual-review.js';
import { verifyResponsiveSource } from '../replica-responsive/source.js';
import { carouselMotionFrameSchema, compareCarouselMotion, verifyPhoneMotionSource } from '../replica-responsive/motion-review.js';
import { native44ModuleClass } from '../native44/adapters.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { validateRegisteredSettings } from '../planning/plan.js';
import { applyContainerTreePlan, containerTreePlanSchema, type ContainerTreePlan } from './container-tree.js';
import { assertRecoveredStyleSettings, assertInterruptedStyleProof, savedStyleSerializationSchemas, type InterruptedStyleProof } from './style-recovery.js';
import type { FullReplicaManifest, FullReplicaDependencies, FullReplicaPreparedHeader, FullReplicaPreparedBody, FullReplicaPrepared, FullReplicaOperation, FullReplicaHeaderCheckpoint, FullReplicaPageCheckpoint, FullReplicaBodyCheckpoint, FullReplicaBoundCheckpoint, FullReplicaReview, FullReplicaPublishedCheckpoint, FullReplicaFileRef } from './types.js';
import { WordPressReusedBodyDriver } from './reused-driver.js';
import { prepareTargetSubmissionFormReview, withoutAuthorizedTargetSubmissionForms } from './target-submissions-review.js';
import { verifyInquiryReview, inquirySubmissionReviewRequired, assertInquiryElement, type InquiryBackendReader } from './inquiry-review.js';

const ROOT = 'D:/cloneWP';
const digest = (input: Uint8Array | string) => createHash('sha256').update(input).digest('hex');
const dataHash = (input: unknown) => digest(canonicalV2(input));
/** Elementor exposes the current WordPress status as an unsaved document control. */
export function matchesPublishedDocument(elements: unknown, settings: Record<string, unknown>, expectedHash: string, status: 'draft' | 'publish'): boolean {
  if (documentHashV2(elements as any, settings) === expectedHash) return true;
  return status === 'publish' && settings.post_status === 'publish' && documentHashV2(elements as any, { ...settings, post_status: 'draft' }) === expectedHash;
}
/** WordPress represents the same unset featured image as id=false or id=0 across read contexts. */
export function matchesNativeBodyBefore(elements: unknown, settings: Record<string, unknown>, expected: DraftSnapshot): boolean {
  if (documentHashV2(expected.elements, expected.settings) !== expected.hash) return false;
  if (documentHashV2(elements as any, settings) === expected.hash) return true;
  const emptyImage = (value: unknown): value is { id: false | 0; url: ''; size: '' } => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'id,size,url' && (value as any).url === '' && (value as any).size === '' && ((value as any).id === false || (value as any).id === 0);
  if (!emptyImage(settings.post_featured_image) || !emptyImage(expected.settings.post_featured_image)) return false;
  return documentHashV2(elements as any, { ...settings, post_featured_image: { url: '', id: 0, size: '' } }) === documentHashV2(expected.elements, { ...expected.settings, post_featured_image: { url: '', id: 0, size: '' } });
}
function fail(code: string): never { throw Error(`replica_full_body_driver_${code}`); }
const fileRef = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const assetSchema = z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/), localPath: z.string().min(1), sourceUrl: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), mediaType: z.string().min(1), alt: z.string().optional(), originalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), originalSourcePath: z.string().min(1).optional() }).passthrough();
type PreparedHeaderPayload = { manifestHash: string; assets: Native44Asset[]; jobDirectory: string; required: string[]; assetsHash: string };
const headerProofs = new WeakMap<object, string>();

async function checkedPath(filename: string, missingFinal = false): Promise<string> {
  const root = await realpath(ROOT), target = path.resolve(filename), relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('path_escape');
  let current = root; const parts = relative.split(path.sep);
  for (const [index, segment] of parts.entries()) { current = path.join(current, segment); let info; try { info = await lstat(current); } catch (error) { if (missingFinal && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return target; throw error; } if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) fail('reparse_path'); }
  return target;
}
async function readBound(ref: FullReplicaFileRef, base = ROOT): Promise<{ filename: string; bytes: Buffer }> {
  fileRef.parse({ path: ref.path, sha256: ref.sha256 }); const filename = await checkedPath(path.resolve(base, ref.path)), info = await lstat(filename);
  const reader = activeVerifiedEvidenceReader(ROOT);
  if (reader) return { filename, bytes: await reader.read({ path: filename, sha256: ref.sha256 }) };
  if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('file_limit'); const bytes = await readFile(filename); if (digest(bytes) !== ref.sha256) fail('input_changed'); return { filename, bytes };
}
async function space(directory: string): Promise<void> { const info = await statfs(directory); if (info.bavail * info.bsize < 512 * 1024 * 1024) fail('evidence_space'); }
async function writeNew(filename: string, value: unknown): Promise<FullReplicaFileRef> {
  await checkedPath(filename, true); await space(path.dirname(filename)); const bytes = JSON.stringify(value), handle = await open(filename, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } return { path: filename, sha256: digest(bytes) };
}
async function atomicFile(filename: string, value: unknown): Promise<void> {
  await checkedPath(filename); const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}-${randomUUID()}.tmp`); await writeNew(temporary, value); await rename(temporary, filename);
}
function collectMedia(value: unknown): string[] { const keys = new Set<string>(); const visit = (entry: unknown): void => { if (!entry || typeof entry !== 'object') return; if (!Array.isArray(entry) && typeof (entry as { $media?: unknown }).$media === 'string') keys.add((entry as { $media: string }).$media); else Object.values(entry).forEach(visit); }; visit(value); return [...keys]; }
export function fullPageCSSAssetKeys(css: string): string[] { return [...new Set([...css.matchAll(/__ASSET_([A-Za-z][A-Za-z0-9_-]{0,100})__/g)].map(match => match[1]))]; }
async function assetManifest(input: unknown, jobDirectory: string, required: string[], sourceFontKeys: readonly string[] = []): Promise<Native44Asset[]> {
  const rows = Array.isArray(input) ? input : input && typeof input === 'object' ? (input as { assets?: unknown }).assets : null;
  if (!Array.isArray(rows) || rows.length > 200 || new Set(required).size !== required.length) fail('media_manifest');
  const assets: Native44Asset[] = [];
  for (const raw of rows) {
    const row = assetSchema.parse(raw);
    if (['id', 'attachmentId', 'targetAttachmentId', 'targetId'].some(key => Object.hasOwn(row, key) && row[key] !== null)) fail('existing_media_forbidden');
    if (assets.some(asset => asset.key === row.key)) fail('duplicate_media');
    const source = new URL(row.sourceUrl); if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || /(?:token|nonce|password|secret|authorization)=/i.test(source.search)) fail('media_source_url');
    const local = await checkedPath(path.resolve(jobDirectory, row.localPath)), relative = path.relative(jobDirectory, local); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('media_outside_job');
    const bytes = await readFile(local); if (digest(bytes) !== row.sha256) fail('media_bytes_changed');
    if (row.mediaType === 'font/ttf' && sourceFontKeys.includes(row.key)) validateSourceFontBytes(bytes, row.mediaType); else await validateAssetBytesV2(bytes, row.mediaType);
    if (row.originalSha256 !== undefined || row.originalSourcePath !== undefined) {
      if (!row.originalSha256 || !row.originalSourcePath) fail('original_media_provenance');
      const original = await readBound({ path: row.originalSourcePath, sha256: row.originalSha256 }, jobDirectory), originalRelative = path.relative(jobDirectory, original.filename);
      if (!originalRelative || originalRelative.startsWith('..') || path.isAbsolute(originalRelative)) fail('original_media_outside_job');
    }
    assets.push({ key: row.key, localPath: relative, sourceUrl: row.sourceUrl, sha256: row.sha256, mediaType: row.mediaType, ...(row.alt === undefined ? {} : { alt: row.alt }), ...(row.originalSha256 === undefined ? {} : { originalSha256: row.originalSha256 }) });
  }
  if (required.some(key => !assets.some(asset => asset.key === key))) fail('required_media_missing'); return assets;
}
function assertPreparedHeader(header: FullReplicaPreparedHeader, manifest: FullReplicaManifest): PreparedHeaderPayload {
  if (headerProofs.get(header) !== dataHash(header) || (header.payload as PreparedHeaderPayload).manifestHash !== fullReplicaHash(manifest)) fail('header_exact_preparation'); return header.payload as PreparedHeaderPayload;
}
export interface FullReplicaRemoteServices {
  responsiveTarget?: ResponsiveTarget;
  client: Pick<WordPressClient, 'createDraft' | 'discoverCapabilities' | 'snapshotDraft' | 'buildDraft' | 'verifyImportedAssets' | 'importAsset' | 'inspectPendingAsset' | 'readTargetPosts' | 'readTargetCatalog'> & Partial<Pick<WordPressClient, 'importSourceFont' | 'readTargetProduct' | 'readCurrentProductRuntime'>>;
  full: FullReplicaDriver; header: HeaderModuleDriver; reused?: WordPressReusedBodyDriver; close(): Promise<void>;
}
function bodyFontAssetKeys(payload: Pick<ActualBodyPayload, 'program' | 'css'>): string[] {
  const nativeKeys = referencedNative44Assets(payload.program); return fullPageCSSAssetKeys(payload.css).filter(key => !nativeKeys.has(key));
}
export async function importFullReplicaBodyAssets(options: Omit<Parameters<typeof importNative44Media>[0], 'client'> & { client: FullReplicaRemoteServices['client'] }): Promise<ImportedAssetV2[]> {
  const fontKeys = options.required.filter(key => options.manifest.find(asset => asset.key === key)?.mediaType === 'font/ttf'), fontSet = new Set(fontKeys), client = options.client;
  if (fontKeys.length && typeof client.importSourceFont !== 'function') fail('source_font_adapter_required');
  const assets = await importNative44Media({ ...options, required: options.required.filter(key => !fontSet.has(key)) });
  if (!fontKeys.length) return assets;
  return importNative44SourceFonts({ ...options, required: fontKeys, client: { verifyImportedAssets: client.verifyImportedAssets.bind(client), inspectPendingAsset: client.inspectPendingAsset.bind(client), importSourceFont: client.importSourceFont!.bind(client) } });
}
export interface FullReplicaFactoryOptions { bodyStyleAmendment?: import('./unwritten-body-style-amendment.js').BodyStyleAmendment; root: string; manifestPath: string; runDirectory: string; manifest: FullReplicaManifest; recoverInterruptedStyle?: boolean; loadRemote?: () => Promise<FullReplicaRemoteServices> }
export async function createFullReplicaDependencies(options: FullReplicaFactoryOptions): Promise<Omit<FullReplicaDependencies, 'writeState'>> {
  if (path.resolve(options.root).toLowerCase() !== path.resolve(ROOT).toLowerCase()) fail('root_mismatch');
  const manifest = validateFullReplicaManifest(options.manifest), runDirectory = await checkedPath(options.runDirectory); await space(runDirectory);
  await checkedPath(options.manifestPath);
  let remotePromise: Promise<FullReplicaRemoteServices> | undefined, closed = false;
  const reviewBarrier = new FullReplicaReviewBarrier();
  const remote = (): Promise<FullReplicaRemoteServices> => {
    if (closed) fail('closed');
    return remotePromise ??= options.loadRemote ? options.loadRemote() : (async () => {
      const { loadConfig } = await import('../core/config.js'), { config, credentials } = await loadConfig(ROOT);
      if (new URL(config.targetUrl).origin !== manifest.targetOrigin) fail('configured_target_mismatch');
      const connection = { targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute };
      const session=new WordPressConnection(connection);
      const client = new WordPressClient({ ...connection, executionStrategy: 'native44-css-handoff',...(manifest.componentExtension?{componentExtension:manifest.componentExtension}:{}) },session), transport = new WoodMartHeaderTransport(connection,session);
      if(manifest.currentRecord) {try{await client.verifyCurrentProductRuntimeSupport();}catch(error){await session.close();throw error;}}
      let responsiveTarget: ResponsiveTarget | undefined;
      if (manifest.responsive) {
        try { responsiveTarget = await assertResponsiveTarget(transport, manifest.responsive.mobileMaxWidth); } catch (error) { await session.close(); throw error; }
      }
      return { client, ...(responsiveTarget ? { responsiveTarget } : {}), ...(manifest.headerProvider === 'reused-woodmart-header' ? { reused: new WordPressReusedBodyDriver(transport, manifest) } : {}), full: new WordPressFullReplicaDriver(transport, manifest.currentRecord), header: new FullReplicaHeaderModuleDriver(transport, client,manifest.currentRecord), close: async () => {try{await session.close();}catch{fail('connection_close_unconfirmed');}} };
    })();
  };
  const operationFile = async (operation: FullReplicaOperation, label: string, value: unknown): Promise<FullReplicaFileRef> => {
    const directory = path.join(runDirectory, 'operations'); try { await mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } await checkedPath(directory);
    return writeNew(path.join(directory, `${operation.operationId}-${label}-${randomUUID()}.json`), { version: 1, kind: 'clonewp-full-replica-operation', operation, value });
  };
  const fullMutation = async (services: FullReplicaRemoteServices, identity: HeaderModuleIdentity, before: FullReplicaRemoteSnapshot, operation: FullReplicaOperation, action: FullReplicaDriverAction, payload: Record<string, unknown>) => {
    const operationId = randomUUID(), intent = await operationFile(operation, action, { operationId, action, identity, beforeHash: before.hash, protectedHash: before.header.snapshot.globalHash, payload, payloadHash: fullReplicaHash(payload) });
    const result = await services.full.mutate(identity, { action, operationId, expectedHash: before.hash, payload }, { operationId, runId: manifest.runId, resource: `full-replica/${identity.moduleKey}`, expectedSnapshotSha256: before.hash, persistedIntentSha256: intent.sha256 });
    if (result.snapshot.header.snapshot.globalHash !== before.header.snapshot.globalHash) fail('protected_state_changed'); return { ...result, operationId };
  };
  if (manifest.headerProvider === 'reused-woodmart-header') {
    const { createReusedBodyDependencies } = await import('./reused-body.js');
    return createReusedBodyDependencies({ manifest, runDirectory, bodyStyleAmendment: options.bodyStyleAmendment, remote, operationFile, readBound, assetManifest, close: async () => { closed = true; if (remotePromise) await (await remotePromise).close(); } });
  }
  const bundle = async (): Promise<HeaderBundle> => { const loaded = await loadHeaderBundle(manifest.header!.bundleDirectory); await assertEffectiveHeaderPlan(manifest, runDirectory, loaded); const receipt = JSON.parse(await readFile(await checkedPath(path.join(loaded.directory, 'full-replica.json')), 'utf8')); if (receipt.manifestHash !== fullReplicaHash(manifest) || dataHash(receipt.identity) !== dataHash(loaded.state.identity)) fail('bundle_not_current_task'); return loaded; };
  const initializeBundle = async (): Promise<HeaderBundle> => {
    const directory = manifest.header!.bundleDirectory;
    try { await lstat(directory); return await bundle(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const created = await createHeaderBundle(directory, manifest.header!.plan);
    await writeNew(path.join(created.directory, 'choice.json'), { version: 1, kind: 'clonewp-replica-header-choice', provider: 'woodmart-header-builder', sourcePartition: manifest.sourcePartition });
    await writeNew(path.join(created.directory, 'full-replica.json'), { version: 1, kind: 'clonewp-full-replica-module-owner', manifestHash: fullReplicaHash(manifest), identity: created.state.identity }); return created;
  };
  const actualPage = (value: FullReplicaRemoteSnapshot, pageId?: number, status: 'draft' | 'publish' = 'draft') => { const page = value.page; if (!page || page.runId !== manifest.runId || page.status !== status || page.template !== 'elementor_header_footer' || !page.built || pageId !== undefined && page.pageId !== pageId) fail('owned_page_changed'); return page; };
  const pageCheckpoint = (value: FullReplicaRemoteSnapshot): FullReplicaPageCheckpoint => { const page = actualPage(value); if (page.headerId !== null) fail('page_already_bound'); return { pageId: page.pageId, runId: manifest.runId, status: 'draft', template: 'elementor_header_footer', editUrl: `${manifest.targetOrigin}/wp-admin/post.php?post=${page.pageId}&action=elementor`, previewUrl: `${manifest.targetOrigin}/?page_id=${page.pageId}&preview=true`, bodyHash: page.bodyHash, headerId: null }; };
  const headerCheckpoint = (module: HeaderRemoteModule, identity: HeaderModuleIdentity): FullReplicaHeaderCheckpoint => {
    if (!module.header || !module.style || Object.keys(module.menus).length !== manifest.header!.plan.menus.length) fail('header_incomplete');
    const content = manifest.header!.plan.menuContent;
    if (content && (Object.keys(module.menuContent ?? {}).length !== content.length || content.some(item => !module.menuContent?.[item.key] || module.menuContent[item.key].programHash !== dataHash(item.program)))) fail('header_menu_content_incomplete');
    return { headerId: identity.headerId, name: module.name, editUrl: `${manifest.targetOrigin}/wp-admin/admin.php?page=xts_header_builder#/builder/${identity.headerId}`, headerHash: dataHash(module.header), menuHash: dataHash(module.menus), styleHash: dataHash(module.style), menus: manifest.header!.plan.menus.map(menu => { const actual = module.menus[menu.key]; if (!actual) fail('header_menu_missing'); return { key: menu.key, id: actual.id, name: actual.name, editUrl: `${manifest.targetOrigin}/wp-admin/nav-menus.php?menu=${actual.id}` }; }), styleBlock: { id: module.style.id, name: `${module.name} styles`, editUrl: `${manifest.targetOrigin}/wp-admin/post.php?post=${module.style.id}&action=edit` }, ...(content ? { menuContent: content.map(item => { const actual = module.menuContent![item.key]; return { key: item.key, id: actual.id, name: actual.name, editUrl: `${manifest.targetOrigin}/wp-admin/post.php?post=${actual.id}&action=elementor` }; }) } : {}) };
  };
  const assertHeaderCheckpoint = (snapshot: FullReplicaRemoteSnapshot, expected: FullReplicaHeaderCheckpoint): void => { if (!snapshot.header.snapshot.module) fail('header_missing'); const actual = headerCheckpoint(snapshot.header.snapshot.module, snapshot.header.snapshot.module.identity); if (actual.headerId !== expected.headerId || actual.headerHash !== expected.headerHash || actual.menuHash !== expected.menuHash || actual.styleHash !== expected.styleHash) fail('header_changed'); };
  const assertBound = (snapshot: FullReplicaRemoteSnapshot, expected: FullReplicaBoundCheckpoint, status: 'draft' | 'publish' = 'draft'): void => { const page = actualPage(snapshot, expected.pageId, status), module = snapshot.header.snapshot.module; if (!module) fail('header_missing'); const header = headerCheckpoint(module, module.identity); if (page.headerId !== expected.headerId || page.bodyHash !== expected.bodyHash || digest(String(page.settings.custom_css ?? '')) !== expected.cssHash || !matchesPublishedDocument(page.elements, page.settings, expected.documentHash, status) || header.headerHash !== expected.headerHash || header.menuHash !== expected.menuHash || header.styleHash !== expected.styleHash) fail('bound_fingerprint_changed'); };
  const claimed = new Set<number>();
  const claim = async (services: FullReplicaRemoteServices, pageId: number, body?: FullReplicaPreparedBody): Promise<CapabilityReport> => {
    const program = body && (assertActualPreparedBody(body, manifest), body.payload.program), capabilities = await services.client.discoverCapabilities(program ? [...new Set([...usedNative44WidgetTypes(program), ...(manifest.body.navigationForms ? ['html'] : [])])] : ['container']);
    if (capabilities.mode === 'unavailable') fail('native_registry_unavailable');
    if (manifest.responsive) capabilities.legacySchemas = certifyResponsiveSchemas(capabilities.legacySchemas, services.responsiveTarget);
    if (!claimed.has(pageId)) { const result = await services.client.createDraft(manifest.runId, manifest.title, { requireExistingPageId: pageId, ...(manifest.currentRecord?{currentRecord:manifest.currentRecord}:{}) }); if (result.pageId !== pageId) fail('claim_page_changed'); claimed.add(pageId); } return capabilities;
  };
  const confirmedLedger = async (directory: string, pageId: number, assets: Native44Asset[], required: string[]): Promise<ImportedAssetV2[] | null> => {
    let ledger: any; try { const filename = await checkedPath(path.join(runDirectory, directory, 'assets', 'ledger.json')), info = await lstat(filename); if (!info.isFile() || info.size > 32 * 1024 * 1024) return null; ledger = JSON.parse(await readFile(filename, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return required.length ? null : []; throw error; }
    if (ledger?.version !== 1 || ledger.runId !== manifest.runId || ledger.pageId !== pageId || !Array.isArray(ledger.assets) || new Set(ledger.assets.map((entry: any) => entry.key)).size !== ledger.assets.length || required.some(key => !ledger.assets.some((entry: any) => entry.key === key))) return null;
    const imported: ImportedAssetV2[] = [];
    for (const entry of ledger.assets) {
      const source = assets.find(asset => asset.key === entry.key), value = entry.imported;
      if (!source || entry.status !== 'complete' || !value || value.key !== entry.key || entry.sha256 !== source.sha256 || value.sha256 !== source.sha256 || value.mimeType !== source.mediaType || !Number.isSafeInteger(value.attachmentId) || value.attachmentId < 1 || !Array.isArray(entry.operations) || entry.operations.some((operation: any) => operation.status !== 'confirmed')) return null;
      let url: URL; try { url = new URL(value.url); } catch { return null; } if (url.origin !== manifest.targetOrigin || url.username || url.password || /(?:token|nonce|password|secret|authorization)=/i.test(url.search)) return null;
      imported.push(value);
    }
    return imported;
  };
  const appendNavigationReturn = async (services: FullReplicaRemoteServices, identity: HeaderModuleIdentity, before: FullReplicaRemoteSnapshot, operation: FullReplicaOperation, proofScope: { bound?: FullReplicaBoundCheckpoint; cssHash: string; sourceUnitIds: string[] }): Promise<FullReplicaRemoteSnapshot> => {
    const forms = manifest.body.navigationForms; if (!forms || !before.page) fail('navigation_return_form_required');
    const patch = compileNavigationReturnPatch(before.page.elements, forms, manifest.sourceUrl, manifest.taskId); if (!patch.changedWidgetIds.length) return before;
    await operationFile(operation, 'navigation-return-patch', { version: 1, kind: 'clonewp-full-navigation-return-patch', before, formsHash: fullReplicaHash(forms), patch, ...proofScope });
    const payload = { pageId: before.page.pageId, sourceUrl: manifest.sourceUrl, taskId: manifest.taskId, forms }, result = await fullMutation(services, identity, before, operation, 'navigation-return', payload);
    assertNavigationReturnBoundary(before, result.snapshot, patch, forms, manifest.sourceUrl, manifest.taskId);
    const receipt = result.snapshot.receipts[result.operationId]; if (receipt?.state !== 'complete' || receipt.action !== 'navigation-return' || receipt.payloadHash !== fullReplicaHash(payload) || dataHash(receipt.result) !== dataHash(result.result) || dataHash(result.result.widgetIds) !== dataHash(patch.widgetIds)) fail('navigation_return_receipt');
    const { [result.operationId]: _receipt, ...remaining } = result.snapshot.receipts; if (dataHash(remaining) !== dataHash(before.receipts)) fail('navigation_return_receipt_boundary');
    return result.snapshot;
  };

  const dependencies: Omit<FullReplicaDependencies, 'writeState'> = {
    async close() { closed = true; if (remotePromise) await (await remotePromise).close(); },
    async prepareHeader(input) {
      if (fullReplicaHash(input) !== fullReplicaHash(manifest)) fail('manifest_changed'); const plan = validateHeaderModulePlan(input.header!.plan);
      if (plan.menuContent) await prepareHeaderMenuContentLocal(plan.menuContent);
      compileHeaderModuleStyles(plan.layout.mobile ? { ...plan.style, css: plan.style.css + '\n' + adaptiveHeaderCSS(plan) } : plan.style, { moduleKey: plan.moduleKey, headerId: 'header_validation' });
      if (plan.layout.mobile) responsiveHeaderPageCSS(plan, 1);
      const file = await readBound(input.header!.assets, path.dirname(options.manifestPath)), jobDirectory = path.dirname(file.filename), required = [...new Set([...collectMedia(plan.layout), ...(plan.menuItemMedia?.map(binding => binding.mediaKey) ?? []), ...(plan.menuContent?.filter(entry=>entry.assetSource==='header-assets').flatMap(entry=>[...referencedNative44Assets(entry.program)])??[])])], assets = await assetManifest(JSON.parse(file.bytes.toString('utf8')), jobDirectory, required);
      const prepared: FullReplicaPreparedHeader = { planHash: modulePlanHash(plan), moduleKey: plan.moduleKey, bundleDirectory: input.header!.bundleDirectory, payload: { manifestHash: fullReplicaHash(manifest), assets, jobDirectory, required, assetsHash: input.header!.assets.sha256 } satisfies PreparedHeaderPayload };
      headerProofs.set(prepared, dataHash(prepared)); return prepared;
    },
    async prepareBody(input) { const body = await prepareActualBody(input); assertActualPreparedBody(body, manifest); await assetManifest(body.payload.assetsManifest, path.dirname(body.payload.assetsManifestPath), [...new Set([...referencedNative44Assets(body.payload.program), ...fullPageCSSAssetKeys(body.payload.css)])], bodyFontAssetKeys(body.payload)); return body; },
    assertPreparedBody: assertActualPreparedBody,
    async createPage(prepared, operation) {
      assertPreparedHeader(prepared.header!, manifest); assertActualPreparedBody(prepared.body, manifest); const local = await initializeBundle(), services = await remote(), before = await services.full.inspect(local.state.identity);
      if (before.page) fail('page_already_exists_use_reconcile');
      if (manifest.header!.plan.menuContent?.every(entry=>entry.assetSource!=='header-assets')) { if (!services.header.prepareMenuContent) fail('menu_content_adapter_required'); await services.header.prepareMenuContent(local.state.identity, manifest.header!.plan.menuContent, local.directory); }
      const result = await fullMutation(services, local.state.identity, before, operation, 'create-page', { title: manifest.title, slug: manifest.slug, headerName: manifest.header!.plan.name, ...(manifest.header!.plan.menuContent ? { menuContent: true } : {}) });
      const page = actualPage(result.snapshot); if (page.elements.length || page.headerId !== null) fail('new_page_not_empty');
      await operationFile(operation, 'create-page-write-confirmed', { fullSnapshot: result.snapshot, result: result.result, nativeOperationId: result.operationId });
      await checkpointHeaderModule(local.directory, services.header, result.snapshot.header.hash); await claim(services, page.pageId, prepared.body);
      const after = await services.full.inspect(local.state.identity); if (after.hash !== result.snapshot.hash) fail('page_claim_changed');
      await operationFile(operation, 'create-page-confirmed', { fullSnapshot: after }); return pageCheckpoint(after);
    },
    async provisionHeader(prepared, page, operation) {
      const payload = assertPreparedHeader(prepared, manifest), local = await bundle(), services = await remote(), before = await services.full.inspect(local.state.identity), current = actualPage(before, page.pageId);
      if (current.bodyHash !== page.bodyHash || current.headerId !== null) fail('header_page_changed'); await claim(services, page.pageId);
      const currentAssets = await readBound(manifest.header!.assets, path.dirname(options.manifestPath)), checkedAssets = await assetManifest(JSON.parse(currentAssets.bytes.toString('utf8')), payload.jobDirectory, payload.required); if (dataHash(checkedAssets) !== dataHash(payload.assets)) fail('header_prepared_media_changed');
      const assets = await importNative44Media({ client: services.client, root: ROOT, runDir: path.join(runDirectory, 'header-media'), jobDir: payload.jobDirectory, runId: manifest.runId, pageId: page.pageId, manifest: payload.assets, required: payload.required });
      const ids = Object.fromEntries(assets.filter(asset => payload.required.includes(asset.key)).map(asset => [asset.key, asset.attachmentId]));
      await withHeaderBundleLock(local.directory, async latest => { if (Object.keys(latest.mediaIds).length && dataHash(latest.mediaIds) !== dataHash(ids)) fail('header_media_changed'); await atomicFile(path.join(latest.directory, 'media.json'), ids); });
      const results = await provisionHeaderModule(local.directory, services.header, assets); if (results.some(result => !['confirmed', 'unchanged'].includes(result.status))) fail('header_provision_unconfirmed');
      const after = await services.full.inspect(local.state.identity); if (after.header.snapshot.globalHash !== before.header.snapshot.globalHash || actualPage(after, page.pageId).bodyHash !== page.bodyHash) fail('header_boundary_changed');
      const checkpoint = headerCheckpoint(after.header.snapshot.module!, local.state.identity); await operationFile(operation, 'header-confirmed', { fullSnapshot: after, checkpoint }); return checkpoint;
    },
    async saveBody(body, page, operation) {
      assertActualPreparedBody(body, manifest); const payload = body.payload, local = await bundle(), services = await remote(), before = await services.full.inspect(local.state.identity), current = actualPage(before, page.pageId);
      if (current.bodyHash !== page.bodyHash || current.headerId !== null || !before.header.snapshot.module?.header) fail('body_page_changed');
      const capabilities = await claim(services, page.pageId, body); await operationFile(operation, 'registered-components', { capabilities });
      const resolved = resolveActualBodyStyles(body, capabilities.legacySchemas);
      const currentRecord = resolved.program.currentRecord ? await prepareProgramCurrentProduct(services.client, resolved.program, { targetOrigin: manifest.targetOrigin, schemas: capabilities.legacySchemas, controlsByWidget: toNative44CompilerKnowledge(payload.knowledge, capabilities.legacySchemas).controlsByWidget }) : undefined;
      if (currentRecord) {
        await operationFile(operation, 'target-current-product', { observation: currentRecord.observation, bindings: currentRecord.bindings });
        if(!services.client.readCurrentProductRuntime)fail('current_product_runtime_reader_missing');
        const selection=resolved.program.currentRecord!;currentRecord.runtime=await services.client.readCurrentProductRuntime(page.pageId,manifest.runId,selection.productId,selection.contextKey);
        assertCoreProductPageRuntime(currentRecord.bindings,currentRecord.runtime,selection,manifest.targetOrigin);
      }
      const required = [...new Set([...referencedNative44Assets(payload.program), ...fullPageCSSAssetKeys(payload.css)])], manifestAssets = await assetManifest(payload.assetsManifest, path.dirname(payload.assetsManifestPath), required, bodyFontAssetKeys(payload));
      const assets = await importFullReplicaBodyAssets({ client: services.client, root: ROOT, runDir: path.join(runDirectory, 'body-media'), jobDir: path.dirname(payload.assetsManifestPath), runId: manifest.runId, pageId: page.pageId, manifest: manifestAssets, required });
      const posts: TargetPostsEvidence[] = [];
      for (const node of walkNative44(payload.program.blocks)) if (node.kind === 'native-posts') { const observed = await services.client.readTargetPosts(node.query), evidence = await operationFile(operation, `target-posts-${node.key}`, observed); observed.evidence = [evidence.path]; posts.push(observed); }
      let catalog: TargetCatalogEvidence | undefined;
      if (walkNative44(payload.program.blocks).some(node => node.kind === 'native-products')) { const observed = await services.client.readTargetCatalog(200), evidence = await operationFile(operation, 'target-products', observed); catalog = { targetOrigin: observed.targetOrigin, products: observed.products, evidence: [evidence.path] }; }
      const pendingForms = await prepareActualBodyPendingForms(body, capabilities.legacySchemas), compiled = compileActualBody(body, capabilities.legacySchemas, assets, { pendingForms, ...(currentRecord ? { currentProduct: currentRecord.provider,currentProductRuntime:currentRecord.runtime } : {}), ...(posts.length ? { posts } : {}), ...(catalog ? { catalog } : {}) });
      const css = compileFullPageCSS(resolved.css, page.pageId, assets, manifest.runId) + (manifest.responsive ? responsivePageShellCSS(page.pageId) + responsiveHeaderPageCSS(manifest.header!.plan, page.pageId, local.state.identity.headerId) : ''), expectedCurrent = await services.client.snapshotDraft(page.pageId);
      if (!matchesNativeBodyBefore(current.elements, current.settings, expectedCurrent)) fail('body_before_changed');
      await operationFile(operation, 'body-save-intent', { beforeFullHash: before.hash, protectedHash: before.header.snapshot.globalHash, expectedDocumentHash: expectedCurrent.hash, program: manifest.body.program, cssInput: manifest.body.css, composition: compiled.composition, css, ...(payload.program.styleResolutionVersion ? { styleResolution: { receipts: resolved.receipts, renderedVerified: false } } : {}), sourceUnitIds: body.sourceUnitIds, ...(manifest.body.navigationForms ? { navigationReturn: NAVIGATION_RETURN_VERSION } : {}) });
      await services.client.buildDraft(page.pageId, compiled.composition, assets, { expectedCurrent, native44Proof: compiled, htmlProofs: compiled.htmlProofs, preserveUnknownWrite: true });
      const saved = await services.full.inspect(local.state.identity); if (saved.header.snapshot.globalHash !== before.header.snapshot.globalHash || dataHash(saved.header.snapshot.module?.header) !== dataHash(before.header.snapshot.module?.header) || dataHash(saved.header.snapshot.module?.menus) !== dataHash(before.header.snapshot.module?.menus) || dataHash(saved.header.snapshot.module?.style) !== dataHash(before.header.snapshot.module?.style)) fail('body_protected_changed');
      const result = await fullMutation(services, local.state.identity, saved, operation, 'style', { pageId: page.pageId, css }); let after = result.snapshot, actual = actualPage(after, page.pageId);
      if (digest(String(actual.settings.custom_css ?? '')) !== digest(css) || dataHash(saved.page!.elements) !== dataHash(actual.elements) || actual.headerId !== null) fail('body_css_readback');
      if (manifest.body.navigationForms) {
        if (capabilities.legacySchemas.html?.controls?.html?.type !== 'code') fail('navigation_form_control_unavailable');
        const patch = compileNavigationFormPatch(actual.elements, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId);
        await operationFile(operation, 'navigation-form-patch', { version: 1, kind: 'clonewp-full-navigation-form-patch', before: after, formsHash: fullReplicaHash(manifest.body.navigationForms), patch, cssHash: digest(css), sourceUnitIds: body.sourceUnitIds });
        const inserted = await fullMutation(services, local.state.identity, after, operation, 'navigation-forms', { pageId: page.pageId, sourceUrl: manifest.sourceUrl, taskId: manifest.taskId, forms: manifest.body.navigationForms });
        assertNavigationFormBoundary(after, inserted.snapshot, patch, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId);
        if (dataHash(inserted.result.widgetIds) !== dataHash(patch.widgetIds)) fail('navigation_form_widget_readback');
        const receipt = inserted.snapshot.receipts[inserted.operationId]; if (receipt?.state !== 'complete' || receipt.action !== 'navigation-forms' || receipt.payloadHash !== fullReplicaHash({ pageId: page.pageId, sourceUrl: manifest.sourceUrl, taskId: manifest.taskId, forms: manifest.body.navigationForms }) || dataHash(receipt.result) !== dataHash(inserted.result)) fail('navigation_form_receipt_unconfirmed');
        const { [inserted.operationId]: _receipt, ...remaining } = inserted.snapshot.receipts; if (dataHash(remaining) !== dataHash(after.receipts)) fail('navigation_form_receipt_boundary');
        after = inserted.snapshot; actual = actualPage(after, page.pageId);
        after = await appendNavigationReturn(services, local.state.identity, after, operation, { cssHash: digest(css), sourceUnitIds: body.sourceUnitIds }); actual = actualPage(after, page.pageId);
      }
      await checkpointHeaderModule(local.directory, services.header, after.header.hash);
      const checkpoint: FullReplicaBodyCheckpoint = { ...pageCheckpoint(after), cssHash: digest(css), documentHash: documentHashV2(actual.elements, actual.settings), sourceUnitIds: [...body.sourceUnitIds], embeddedHeaderCount: 0 };
      await operationFile(operation, 'body-confirmed', { fullSnapshot: after, checkpoint }); return checkpoint;
    },
    async bindHeader(header, body, operation) {
      const local = await bundle(), services = await remote(), before = await services.full.inspect(local.state.identity), page = actualPage(before, body.pageId); assertHeaderCheckpoint(before, header);
      if (page.bodyHash !== body.bodyHash || documentHashV2(page.elements, page.settings) !== body.documentHash || digest(String(page.settings.custom_css ?? '')) !== body.cssHash || page.headerId !== null) fail('binding_body_changed');
      const diagnostics = captureNativeHeaderFailure(services.header), result = await bindHeaderModulePage(local.directory, diagnostics.driver, body.pageId);
      if (!['confirmed', 'unchanged'].includes(result.status)) {
        const failure = diagnostics.failure(), code = failure?.code ?? 'replica_full_body_driver_binding_unconfirmed';
        await operationFile(operation, 'native-binding-unconfirmed', { code, action: 'bind', nativeOperationId: result.operationId ?? failure?.operationId ?? null, status: result.status });
        throw Error(code);
      }
      const after = await services.full.inspect(local.state.identity), checkpoint: FullReplicaBoundCheckpoint = { pageId: body.pageId, runId: manifest.runId, headerId: header.headerId, editUrl: body.editUrl, previewUrl: body.previewUrl, bodyHash: body.bodyHash, cssHash: body.cssHash, documentHash: body.documentHash, headerHash: header.headerHash, menuHash: header.menuHash, styleHash: header.styleHash };
      assertBound(after, checkpoint); if (after.header.snapshot.globalHash !== before.header.snapshot.globalHash) fail('binding_protected_changed'); await operationFile(operation, 'binding-confirmed', { fullSnapshot: after, checkpoint }); return checkpoint;
    },
    async reviewWholePage(_prepared, bound, reviewInput) { return reviewInput === undefined ? null : validateFullReplicaReview(reviewInput, manifest, bound); },
    async inspectInquirySubmission(bound,elementId,testMarker) {
      const local=await bundle(),services=await remote(),fresh=await services.full.inspect(local.state.identity);assertBound(fresh,bound);
      const program=validateNative44Program(JSON.parse((await readBound(manifest.body.program)).bytes.toString('utf8')));assertInquiryElement(program,elementId);
      if(!services.full.readInquirySubmission)fail('inquiry_reader_unavailable');
      return services.full.readInquirySubmission({pageId:bound.pageId,runId:manifest.runId,elementId,testMarker});
    },
    async verifyReview(review, bound) {
      validateFullReplicaReview(review, manifest, bound);
      const local = await bundle(), services = await remote(), fresh = await services.full.inspect(local.state.identity); assertBound(fresh, bound);
      await verifyFullReplicaReviewEvidence(review, bound, manifest, fresh.page!.elements,services.full.readInquirySubmission?.bind(services.full));
      reviewBarrier.remember(review, bound, fresh);
    },
    async publishPage(bound, review, operation) {
      let before = reviewBarrier.take(review, bound);
      if (!before) { await dependencies.verifyReview(review, bound); before = reviewBarrier.take(review, bound); }
      if (!before) fail('publication_review_barrier_missing');
      const local = await bundle(), services = await remote(); assertBound(before, bound);
      if (dataHash(before.header.snapshot.module?.identity) !== dataHash(local.state.identity)) fail('publication_review_identity_changed');
      const result = await fullMutation(services, local.state.identity, before, operation, 'publish', { pageId: bound.pageId, reviewHash: fullReplicaHash(review) }); assertBound(result.snapshot, bound, 'publish');
      const { previewUrl: _preview, ...rest } = bound, checkpoint: FullReplicaPublishedCheckpoint = { ...rest, status: 'publish', publicUrl: result.snapshot.page!.publicUrl }; await operationFile(operation, 'publish-confirmed', { fullSnapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async reviseStyle(prepared, bound, cssRef, operation) {
      assertActualPreparedBody(prepared.body, manifest); const file = await readBound(cssRef), cssInput = file.bytes.toString('utf8'), local = await bundle();
      assertNativeImageCSS(manifest.nativeImagePolicy, prepared.body.payload.program, cssInput);
      const ledgerPath = await checkedPath(path.join(runDirectory, 'body-media', 'assets', 'imported.json')), assets = JSON.parse(await readFile(ledgerPath, 'utf8')) as ImportedAssetV2[];
      if (!Array.isArray(assets)) fail('style_revision_media_ledger'); const css = compileFullPageCSS(manifest.responsive ? prepareResponsiveBody(prepared.body.payload.baseProgram!, manifest.responsive, cssInput).css : cssInput, bound.pageId, assets, manifest.runId) + (manifest.responsive ? responsivePageShellCSS(bound.pageId) + responsiveHeaderPageCSS(manifest.header!.plan, bound.pageId, bound.headerId) : ''), services = await remote(), before = await services.full.inspect(local.state.identity); assertBound(before, bound);
      if (manifest.editorCompletionPolicy?.runtime && String(before.page!.settings.custom_css ?? '') === css && before.page!.settings.wd__woodmart_whb_header === bound.headerId) {
        if (!local.state.confirmed || before.header.snapshot.globalHash !== (local.state.confirmed.snapshot as { globalHash?: unknown }).globalHash) fail('style_revision_protected_changed');
        await operationFile(operation, 'style-revision-confirmed', { fullSnapshot: before, checkpoint: bound, cssInput: cssRef, contentWrites: 0, unchanged: true });
        return bound;
      }
      await claim(services, bound.pageId);
      for (let offset = 0; offset < assets.length; offset += 100) await services.client.verifyImportedAssets(bound.pageId, assets.slice(offset, offset + 100));
      const result = await fullMutation(services, local.state.identity, before, operation, 'style', { pageId: bound.pageId, css }), page = actualPage(result.snapshot, bound.pageId);
      if (dataHash(page.elements) !== dataHash(before.page!.elements) || page.headerId !== bound.headerId || page.settings.wd__woodmart_whb_header !== bound.headerId || digest(String(page.settings.custom_css ?? '')) !== digest(css)) fail('style_revision_readback');
      const checkpoint: FullReplicaBoundCheckpoint = { ...bound, bodyHash: page.bodyHash, cssHash: digest(css), documentHash: documentHashV2(page.elements, page.settings) };
      assertBound(result.snapshot, checkpoint); await checkpointHeaderModule(local.directory, services.header, result.snapshot.header.hash); await operationFile(operation, 'style-revision-confirmed', { fullSnapshot: result.snapshot, checkpoint, cssInput: cssRef }); return checkpoint;
    },
    async reviseHeaderStyle(prepared, bound, cssRef, operation) {
      assertPreparedHeader(prepared.header!, manifest); assertActualPreparedBody(prepared.body, manifest);
      const local = await bundle(), candidate = await prepareHeaderStyle(manifest, local, cssRef), services = await remote(), before = await services.full.inspect(local.state.identity); assertBound(before, bound);
      const priorHeader = headerCheckpoint(before.header.snapshot.module!, local.state.identity), amendment = await beginHeaderStyle(manifest, runDirectory, local, candidate, before, { header: priorHeader, bound }, operation);
      await withHeaderBundleLock(local.directory, async current => { await assertEffectiveHeaderPlan(manifest, runDirectory, current); if (modulePlanHash(current.plan) !== modulePlanHash(local.plan)) fail('header_style_local_changed'); await replaceHeaderCSS(current, local.plan.style.css, candidate.css); });
      const result = await updateHeaderModule(local.directory, services.header, 'style'); if (!['confirmed', 'unchanged'].includes(result.status)) fail('header_style_unconfirmed');
      const after = await services.full.inspect(local.state.identity), actual = await loadHeaderBundle(local.directory); assertHeaderStyleRemoteBoundary(before, after, compileBundleStyles(actual));
      const header = headerCheckpoint(after.header.snapshot.module!, local.state.identity), nextBound = { ...bound, styleHash: header.styleHash }; assertBound(after, nextBound);
      await confirmHeaderStyle(manifest, runDirectory, actual, amendment.intent, amendment.ref, after, { header, bound: nextBound });
      await operationFile(operation, 'header-style-revision-confirmed', { fullSnapshot: after, checkpoint: { header, bound: nextBound } }); return { header, bound: nextBound };
    },
    async reviseNavigationReturn(prepared, bound, operation) {
      assertActualPreparedBody(prepared.body, manifest); if (!manifest.body.navigationForms) fail('navigation_return_form_required');
      const local = await bundle(), services = await remote(), before = await services.full.inspect(local.state.identity); assertBound(before, bound);
      const capabilities = await claim(services, bound.pageId, prepared.body); if (capabilities.legacySchemas.html?.controls?.html?.type !== 'code') fail('navigation_return_control_unavailable');
      const after = await appendNavigationReturn(services, local.state.identity, before, operation, { bound, cssHash: bound.cssHash, sourceUnitIds: prepared.body.sourceUnitIds }), page = actualPage(after, bound.pageId);
      const checkpoint = { ...bound, bodyHash: page.bodyHash, documentHash: documentHashV2(page.elements, page.settings) }; assertBound(after, checkpoint);
      await checkpointHeaderModule(local.directory, services.header, after.header.hash); await operationFile(operation, 'navigation-return-revision-confirmed', { fullSnapshot: after, checkpoint }); return checkpoint;
    },
    async reviseNativeMotion(prepared, bound, operation) {
      assertActualPreparedBody(prepared.body, manifest); const local = await bundle(), services = await remote(), before = await services.full.inspect(local.state.identity); assertBound(before, bound);
      const capabilities = await claim(services, bound.pageId, prepared.body), speed = capabilities.legacySchemas['nested-carousel']?.controls?.speed as { type?: string; frontend_available?: boolean; min?: number; max?: number } | undefined;
      if (speed?.type !== 'number' || speed.frontend_available !== true || speed.min !== undefined && speed.min > 0 || speed.max !== undefined && speed.max < 0) fail('native_motion_control_unavailable');
      const patch = patchNativeCarouselMotion(before.page!.elements);
      await operationFile(operation, 'native-motion-patch', { version: 1, kind: 'clonewp-full-native-motion-patch', before, bound, patch });
      const result = await fullMutation(services, local.state.identity, before, operation, 'motion', { pageId: bound.pageId });
      assertNativeMotionBoundary(before, result.snapshot, patch);
      if (dataHash(result.result.widgetIds) !== dataHash(patch.widgetIds)) fail('native_motion_widget_readback');
      const page = actualPage(result.snapshot, bound.pageId), checkpoint = { ...bound, bodyHash: page.bodyHash, documentHash: documentHashV2(page.elements, page.settings) }; assertBound(result.snapshot, checkpoint);
      await checkpointHeaderModule(local.directory, services.header, result.snapshot.header.hash); await operationFile(operation, 'motion-revision-confirmed', { fullSnapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async reviseLayout(prepared, bound, planRef, operation) {
      assertActualPreparedBody(prepared.body, manifest);
      const plan = containerTreePlanSchema.parse(JSON.parse((await readBound(planRef)).bytes.toString('utf8'))), local = await bundle(), services = await remote(), before = await services.full.inspect(local.state.identity);
      assertBound(before, bound);
      const capabilities = await claim(services, bound.pageId, prepared.body), registered = capabilities.legacySchemas.container?.controls;
      if (!registered || plan.operations.some(change => Object.keys(change.controls).some(control => !registered[control]))) fail('layout_registered_controls_missing');
      for (const change of plan.operations) validateRegisteredSettings('container', change.controls, capabilities.legacySchemas.container, { onlyControls: new Set(Object.keys(change.controls)), allowedMedia: [] });
      const elements = applyContainerTreePlan(before.page!.elements, plan);
      await operationFile(operation, 'layout-patch', { version: 1, kind: 'clonewp-full-layout-patch', before, bound, plan: planRef, elementsHash: dataHash(elements) });
      const result = await fullMutation(services, local.state.identity, before, operation, 'layout', { pageId: bound.pageId, plan }), page = actualPage(result.snapshot, bound.pageId);
      if (dataHash(page.elements) !== dataHash(elements) || dataHash(page.settings) !== dataHash(before.page!.settings) || page.headerId !== bound.headerId) fail('layout_revision_readback');
      const checkpoint = { ...bound, bodyHash: page.bodyHash, documentHash: documentHashV2(page.elements, page.settings) }; assertBound(result.snapshot, checkpoint);
      await checkpointHeaderModule(local.directory, services.header, result.snapshot.header.hash); await operationFile(operation, 'layout-revision-confirmed', { fullSnapshot: result.snapshot, checkpoint }); return checkpoint;
    },
    async rebaseCurrentDraft(bound, operation, currentBodyHash, currentDocumentHash) {
      const local = await bundle(), directory = await checkedPath(path.join(runDirectory, 'operations'));
      if (local.state.pending || operation.phase !== 'layout-revision') fail('rebase_local_state_changed');
      const names = await readdir(directory);
      const existing = names.filter(name => name.startsWith(`${operation.operationId}-`));
      if (existing.some(name => !name.includes('-current-draft-rebase-confirmed-')) || existing.length > 1) fail('rebase_operation_started');
      const services = await remote(), current = await services.full.inspect(local.state.identity);
      const page = actualPage(current, bound.pageId), adopted = { ...bound, bodyHash: currentBodyHash, documentHash: currentDocumentHash };
      if (page.bodyHash !== currentBodyHash || documentHashV2(page.elements, page.settings) !== currentDocumentHash || page.title !== manifest.title || !isNativeReplicaSlug(manifest.slug, page.slug) || current.receipts[operation.operationId]) fail('rebase_current_state_changed');
      assertBound(current, adopted);
      let prior: FullReplicaRemoteSnapshot | undefined;
      for (const name of names.filter(entry => /-(?:style|layout|motion)-revision-confirmed-.*\.json$/.test(entry))) {
        const record = JSON.parse(await readFile(await checkedPath(path.join(directory, name)), 'utf8'));
        if (record.kind === 'clonewp-full-replica-operation' && record.operation?.taskId === manifest.taskId && record.operation?.runId === manifest.runId && dataHash(record.value?.checkpoint) === dataHash(bound)) { prior = record.value.fullSnapshot; break; }
      }
      if (!prior?.page || !prior.header || prior.page.bodyHash !== bound.bodyHash || dataHash(prior.receipts) !== dataHash(current.receipts) || prior.header.snapshot.globalHash !== current.header.snapshot.globalHash) fail('rebase_prior_proof_missing');
      const { bodyHash: _beforeBodyHash, elements: _beforeElements, settings: _beforeSettings, ...beforePage } = prior.page;
      const { bodyHash: _currentBodyHash, elements: _currentElements, settings: _currentSettings, ...currentPage } = page;
      if (dataHash(beforePage) !== dataHash(currentPage)) fail('rebase_page_changed');
      const elementShape = (elements: typeof page.elements): unknown => elements.map(element => ({ id: element.id, elType: element.elType, widgetType: element.widgetType ?? null, children: elementShape(element.elements ?? []) }));
      if (dataHash(elementShape(prior.page.elements)) !== dataHash(elementShape(page.elements))) fail('rebase_element_structure_changed');
      const withoutOwnedPage = (snapshot: FullReplicaRemoteSnapshot) => {
        const header = structuredClone(snapshot.header), pages = header.snapshot.module!.pages;
        delete pages[String(bound.pageId)];
        delete (header as { hash?: string }).hash;
        return header;
      };
      if (dataHash(withoutOwnedPage(prior)) !== dataHash(withoutOwnedPage(current))) fail('rebase_header_changed');
      if (!local.state.confirmed || ![prior.header.hash, current.header.hash].includes(local.state.confirmed.hash)) fail('rebase_local_header_changed');
      const expectedHeader = local.state.confirmed.hash === prior.header.hash ? prior.header.snapshot : current.header.snapshot;
      if (dataHash(local.state.confirmed.snapshot) !== dataHash(expectedHeader)) fail('rebase_local_header_changed');
      const fresh = await services.full.inspect(local.state.identity);
      if (fresh.hash !== current.hash) fail('rebase_readback_changed');
      await checkpointHeaderModule(local.directory, services.header, current.header.hash);
      if (existing.length) {
        const proof = JSON.parse(await readFile(await checkedPath(path.join(directory, existing[0])), 'utf8'));
        if (proof.kind !== 'clonewp-full-replica-operation' || dataHash(proof.operation) !== dataHash(operation) || proof.value?.currentSnapshot?.hash !== current.hash || dataHash(proof.value?.adopted) !== dataHash(adopted)) fail('rebase_proof_changed');
      } else await operationFile(operation, 'current-draft-rebase-confirmed', { priorSnapshotHash: prior.hash, currentSnapshot: current, before: bound, adopted, remoteWrites: 0 });
      return adopted;
    },
    async reconcileOperation(_prepared, operation, checkpoints) {
      if (operation.phase === 'page' && !Object.keys(checkpoints).length) {
        const local = await bundle();
        if (!local.state.pending && !local.state.confirmed) {
          const { readdir } = await import('node:fs/promises');
          let entries: string[];
          try { entries = await readdir(await checkedPath(path.join(runDirectory, 'operations'))); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; entries = []; }
          if (!entries.length) return { status: 'before' };
        }
      }
      if (operation.phase === 'header-style-revision') {
        let local = await loadHeaderBundle(manifest.header!.bundleDirectory); const services = await remote(), completed = await confirmedHeaderStyleResult(manifest, runDirectory, local, operation.operationId);
        if (completed) { const current = await services.full.inspect(local.state.identity); assertBound(current, completed.bound); return { status: 'after', checkpoint: completed }; }
        // A failure before beginHeaderStyle has no intent and cannot have sent a
        // remote mutation. Recheck both local and remote state before clearing it.
        try { await lstat(path.join(runDirectory, 'header-amendments', `${operation.operationId}-intent.json`)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          if (local.state.pending || !checkpoints.bound) return { status: 'conflict' };
          await assertEffectiveHeaderPlan(manifest, runDirectory, local);
          const current = await services.full.inspect(local.state.identity);
          assertBound(current, checkpoints.bound);
          return { status: 'before' };
        }
        const amendment = await readPendingHeaderStyle(manifest, runDirectory, local, operation), beforeFile = await readBound(amendment.intent.beforeSnapshot), before = JSON.parse(beforeFile.bytes.toString('utf8')) as FullReplicaRemoteSnapshot;
        if (!checkpoints.bound || fullReplicaFingerprint(checkpoints.bound) !== fullReplicaFingerprint(amendment.intent.before.bound)) fail('header_style_reconcile_stale');
        if (local.state.pending) { const reconciled = await reconcileHeaderModule(local.directory, services.header); if (reconciled.status === 'conflict') return { status: 'conflict' }; local = await loadHeaderBundle(local.directory); }
        const current = await services.full.inspect(local.state.identity);
        if (current.hash === before.hash) { await withHeaderBundleLock(local.directory, latest => restoreHeaderStyleBefore(manifest, runDirectory, latest, amendment.intent, current)); return { status: 'before' }; }
        assertHeaderStyleRemoteBoundary(before, current, compileBundleStyles(local));
        const header = headerCheckpoint(current.header.snapshot.module!, local.state.identity), nextBound = { ...amendment.intent.before.bound, styleHash: header.styleHash }; assertBound(current, nextBound);
        await confirmHeaderStyle(manifest, runDirectory, local, amendment.intent, amendment.ref, current, { header, bound: nextBound });
        await operationFile(operation, 'header-style-revision-confirmed', { fullSnapshot: current, checkpoint: { header, bound: nextBound } }); return { status: 'after', checkpoint: { header, bound: nextBound } };
      }
      const local = await bundle(), services = await remote(), current = await services.full.inspect(local.state.identity);
      if(operation.phase==='style-revision'&&checkpoints.bound&&!local.state.pending){
        const {readdir}=await import('node:fs/promises'),directory=await checkedPath(path.join(runDirectory,'operations')),names=await readdir(directory),prefix=`${operation.operationId}-style-`;
        const files=names.filter(n=>n.startsWith(prefix)&&/^[a-f0-9-]{36}\.json$/.test(n.slice(prefix.length)));
        if (!files.length && !names.some(name => name.startsWith(`${operation.operationId}-`)) && local.state.confirmed?.hash === current.header.hash && dataHash(local.state.confirmed.snapshot) === dataHash(current.header.snapshot)) {
          for (const name of names.filter(entry => entry.includes('-confirmed-') && entry.endsWith('.json'))) {
            const prior = JSON.parse(await readFile(await checkedPath(path.join(directory, name)), 'utf8'));
            if (prior.kind === 'clonewp-full-replica-operation' && prior.operation?.taskId === manifest.taskId && prior.operation?.runId === manifest.runId && prior.value?.fullSnapshot?.hash === current.hash && dataHash(prior.value?.checkpoint) === dataHash(checkpoints.bound)) { assertBound(current, checkpoints.bound); return { status: 'before' }; }
          }
        }
        if(files.length===1){
          const record=JSON.parse(await readFile(await checkedPath(path.join(directory,files[0])),'utf8')),intent=record.value;
          if(record.version!==1||record.kind!=='clonewp-full-replica-operation'||dataHash(record.operation)!==dataHash(operation)||intent?.action!=='style'||dataHash(intent.identity)!==dataHash(local.state.identity)||intent.payload?.pageId!==checkpoints.bound.pageId||typeof intent.payload.css!=='string'||Object.keys(intent.payload).sort().join(',')!=='css,pageId'||intent.payloadHash!==fullReplicaHash(intent.payload)||intent.protectedHash!==current.header.snapshot.globalHash)return{status:'conflict'};
          const receipt=current.receipts[intent.operationId];if(receipt?.state!=='complete')return{status:'conflict'};
          let before:FullReplicaRemoteSnapshot|undefined;
          for(const name of names.filter(n=>n.includes('-confirmed-')&&n.endsWith('.json'))){
            const prior=JSON.parse(await readFile(await checkedPath(path.join(directory,name)),'utf8'));
            if(prior.kind==='clonewp-full-replica-operation'&&prior.operation?.taskId===manifest.taskId&&prior.operation?.runId===manifest.runId&&prior.value?.fullSnapshot?.hash===intent.beforeHash){before=prior.value.fullSnapshot;break;}
          }
          if(!before)return{status:'conflict'};assertBound(before,checkpoints.bound);assertCompletedStyleRevision(before,current,{operationId:intent.operationId,payloadHash:intent.payloadHash,css:intent.payload.css});
          const page=actualPage(current,checkpoints.bound.pageId),checkpoint={...checkpoints.bound,bodyHash:page.bodyHash,cssHash:digest(intent.payload.css),documentHash:documentHashV2(page.elements,page.settings)};assertBound(current,checkpoint);
          await checkpointHeaderModule(local.directory,services.header,current.header.hash);await operationFile(operation,'style-revision-confirmed',{fullSnapshot:current,checkpoint,recoveredCompletedReceipt:true});return{status:'after',checkpoint};
        }
      }
      if (operation.phase === 'page' && !Object.keys(checkpoints).length) {
        if (local.state.pending || !local.state.confirmed || local.state.confirmed.hash !== current.header.hash || dataHash(local.state.confirmed.snapshot) !== dataHash(current.header.snapshot)) return { status: 'conflict' };
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations')), names = await readdir(directory), prefix = `${operation.operationId}-create-page-`;
        const files = names.filter(name => name.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/.test(name.slice(prefix.length)));
        if (files.length !== 1) return { status: 'conflict' };
        const record = JSON.parse(await readFile(await checkedPath(path.join(directory, files[0])), 'utf8')), intent = record.value;
        const payload = { title: manifest.title, slug: manifest.slug, headerName: manifest.header!.plan.name, ...(manifest.header!.plan.menuContent ? { menuContent: true } : {}) }, page = current.page, module = current.header.snapshot.module;
        if (record.version !== 1 || record.kind !== 'clonewp-full-replica-operation' || dataHash(record.operation) !== dataHash(operation) || intent?.action !== 'create-page' || !/^[A-Za-z0-9_-]{1,100}$/.test(intent.operationId) || !/^[a-f0-9]{64}$/.test(intent.beforeHash) || dataHash(intent.identity) !== dataHash(local.state.identity) || intent.protectedHash !== current.header.snapshot.globalHash || dataHash(intent.payload) !== dataHash(payload) || intent.payloadHash !== fullReplicaHash(payload)) return { status: 'conflict' };
        const receipt = current.receipts[intent.operationId];
        if (Object.keys(current.receipts).length !== 1 || receipt?.action !== 'create-page' || receipt.state !== 'complete' || receipt.payloadHash !== intent.payloadHash || !page || receipt.result?.pageId !== page.pageId || Object.keys(receipt.result).join(',') !== 'pageId') return { status: 'conflict' };
        if (!module || dataHash(module.identity) !== dataHash(local.state.identity) || module.name !== manifest.header!.plan.name || module.header !== null || module.style !== null || Object.keys(module.menus).length || Object.keys(module.receipts).length || Object.keys(module.pages).length !== 1 || !module.pages[String(page.pageId)] || page.title !== manifest.title || !isNativeReplicaSlug(manifest.slug, page.slug) || page.elements.length || page.headerId !== null || page.settings.template !== 'elementor_header_footer' || page.settings.hide_title !== 'yes' || page.settings.custom_css !== undefined && page.settings.custom_css !== '' || page.settings.post_title !== undefined && page.settings.post_title !== manifest.title || page.settings.post_status !== undefined && page.settings.post_status !== 'draft') return { status: 'conflict' };
        const nativePage = module.pages[String(page.pageId)];
        if (nativePage.pageId !== page.pageId || nativePage.postType !== (manifest.currentRecord?'woodmart_layout':'page') || nativePage.status !== 'draft' || nativePage.template !== 'elementor_header_footer' || nativePage.runId !== manifest.runId || nativePage.headerId !== null || nativePage.bodyHash !== page.bodyHash || Object.keys(page.flags).sort().join(',') !== '_woodmart_copyrights_off,_woodmart_footer_off,_woodmart_prefooter_off' || Object.values(page.flags).some(value => value !== '1')) return { status: 'conflict' };
        return { status: 'after', checkpoint: pageCheckpoint(current) };
      }
      // A header operation that failed before any persisted intent or remote receipt is provably not applied when the actual
      // remote module still equals the confirmed local bundle and carries no header, menu, style or receipt.
      if (operation.phase === 'header' && checkpoints.page && !checkpoints.header && !checkpoints.body && !checkpoints.bound && !local.state.pending && local.state.confirmed?.hash === current.header.hash && dataHash(local.state.confirmed.snapshot) === dataHash(current.header.snapshot)) {
        const { readdir } = await import('node:fs/promises'), names = await readdir(await checkedPath(path.join(runDirectory, 'operations'))), module = current.header.snapshot.module;
        if (names.some(name => name.startsWith(operation.operationId + '-'))) return { status: 'conflict' };
        if (!module || module.header !== null || module.style !== null || Object.keys(module.menus).length || Object.keys(module.receipts).length || dataHash(pageCheckpoint(current)) !== dataHash(checkpoints.page)) return { status: 'conflict' };
        return { status: 'before' };
      }
      if(operation.phase==='body'&&checkpoints.page&&checkpoints.header&&!checkpoints.body&&!checkpoints.bound&&!manifest.body.navigationForms&&!local.state.pending){
        const {readdir}=await import('node:fs/promises'),directory=await checkedPath(path.join(runDirectory,'operations')),names=await readdir(directory);
        const readProof=async(label:string)=>{const matches=names.filter(n=>n.startsWith(`${operation.operationId}-${label}-`)&&/^[a-f0-9-]{36}\.json$/.test(n.slice(`${operation.operationId}-${label}-`.length)));if(matches.length!==1)return null;const r=JSON.parse(await readFile(await checkedPath(path.join(directory,matches[0])),'utf8'));return dataHash(r.operation)===dataHash(operation)?r.value:null;};
        const save=await readProof('body-save-intent'),style=await readProof('style'),receipt=style&&current.receipts[style.operationId];
        if(save&&style&&receipt?.action==='style'&&['started','complete'].includes(receipt.state)){
          if(receipt.state==='started'&&!options.recoverInterruptedStyle)return {status:'conflict'};
          if(!services.full.styleDiagnostics||receipt.state==='started'&&!services.full.recoverInterruptedStyle)fail('style_recovery_adapter_missing');
          const page=actualPage(current,checkpoints.page.pageId);assertHeaderCheckpoint(current,checkpoints.header);assertActualPreparedBody(_prepared.body,manifest);const body=_prepared.body.payload;
          if(page.headerId!==null||current.header.snapshot.globalHash!==save.protectedHash||style.action!=='style'||style.protectedHash!==save.protectedHash||style.payloadHash!==dataHash(style.payload)||style.payload.pageId!==page.pageId||receipt.payloadHash!==style.payloadHash||dataHash(save.program)!==dataHash(manifest.body.program)||dataHash(save.cssInput)!==dataHash(manifest.body.css)||dataHash(save.sourceUnitIds)!==dataHash(_prepared.body.sourceUnitIds))fail('style_recovery_intent_changed');
          if(walkNative44(body.program.blocks).some(n=>n.kind==='native-posts'))fail('style_recovery_posts_not_supported');

          const required=[...new Set([...referencedNative44Assets(body.program),...fullPageCSSAssetKeys(body.css)])],assets=await assetManifest(body.assetsManifest,path.dirname(body.assetsManifestPath),required,bodyFontAssetKeys(body)),media=await confirmedLedger('body-media',page.pageId,assets,required);if(!media)fail('style_recovery_media_unconfirmed');
          const capabilities=await claim(services,page.pageId,_prepared.body);for(let offset=0;offset<media.length;offset+=100)await services.client.verifyImportedAssets(page.pageId,media.slice(offset,offset+100));
          const resolved=resolveActualBodyStyles(_prepared.body,capabilities.legacySchemas);
          const pendingForms=await prepareActualBodyPendingForms(_prepared.body,capabilities.legacySchemas),catalog=walkNative44(body.program.blocks).some(n=>n.kind==='native-products')?await services.client.readTargetCatalog(200):undefined;
          const currentRecord=resolved.program.currentRecord?await prepareProgramCurrentProduct(services.client,resolved.program,{targetOrigin:manifest.targetOrigin,schemas:capabilities.legacySchemas,controlsByWidget:toNative44CompilerKnowledge(body.knowledge,capabilities.legacySchemas).controlsByWidget}):undefined;
          if(currentRecord){if(!services.client.readCurrentProductRuntime)fail('current_product_runtime_reader_missing');const selection=resolved.program.currentRecord!;currentRecord.runtime=await services.client.readCurrentProductRuntime(page.pageId,manifest.runId,selection.productId,selection.contextKey);}
          const compiled=compileActualBody(_prepared.body,capabilities.legacySchemas,media,{pendingForms,...(currentRecord?{currentProduct:currentRecord.provider,currentProductRuntime:currentRecord.runtime}:{}),...(catalog?{catalog:{targetOrigin:catalog.targetOrigin,products:catalog.products,evidence:[(await operationFile(operation,'recovery-target-products',catalog)).path]}}:{})});
          const registration=await readProof('registered-components');if(!registration||dataHash(registration.capabilities.versions)!==dataHash(capabilities.versions))fail('style_recovery_original_registration_changed');
          const serializationSchemas=savedStyleSerializationSchemas(registration.capabilities.legacySchemas,capabilities.legacySchemas,compiled.usedTypes);
          const elements=compileEditorElements(compiled.composition.elements,serializationSchemas,{executionStrategy:'native44-css-handoff'}),css=compileFullPageCSS(resolved.css,page.pageId,media,manifest.runId)+(manifest.responsive?responsivePageShellCSS(page.pageId)+responsiveHeaderPageCSS(manifest.header!.plan,page.pageId,local.state.identity.headerId):'');
          if(dataHash(save.composition)!==dataHash(compiled.composition)||css!==save.css||css!==style.payload.css||css!==page.settings.custom_css||dataHash(elements)!==dataHash(page.elements)){
            await operationFile(operation,'style-recovery-diagnostic',{composition:compiled.composition,elements,cssHash:digest(css),sourceCompositionHash:dataHash(save.composition),currentElementsHash:dataHash(page.elements),schemas:capabilities.legacySchemas});fail('style_recovery_compilation_changed');
          }
          const createdFiles=names.filter(n=>n.includes('-create-page-write-confirmed-'));if(createdFiles.length!==1)fail('style_recovery_original_page_proof_missing');const created=JSON.parse(await readFile(await checkedPath(path.join(directory,createdFiles[0])),'utf8'));
          if(created.operation.taskId!==manifest.taskId||created.operation.runId!==manifest.runId||created.operation.phase!=='page'||created.value.fullSnapshot.page.pageId!==page.pageId)fail('style_recovery_original_page_proof_changed');
          const {[style.operationId]:_r,...otherReceipts}=current.receipts;if(dataHash(otherReceipts)!==dataHash(created.value.fullSnapshot.receipts))fail('style_recovery_other_receipts_changed');
          const diagnostic=await services.full.styleDiagnostics(local.state.identity),baseline={...created.value.fullSnapshot.page.settings,...compiled.composition.pageSettings,custom_css:css,wd__woodmart_whb_header:local.state.identity.headerId};assertRecoveredStyleSettings(baseline,page.settings,diagnostic.defaults);
          let after=current;
          if(receipt.state==='started'){
            const fatal=diagnostic.fatal.filter(f=>Date.parse(f.at)>=Date.parse(operation.createdAt)).at(-1);if(!fatal)fail('style_recovery_fatal_unproven');
            const proof:InterruptedStyleProof={current,originalOperationId:style.operationId,originalPayloadHash:style.payloadHash,startedAt:operation.createdAt,elements,settings:page.settings,css,fatal};assertInterruptedStyleProof(proof);
            const operationId=randomUUID(),intent=await operationFile(operation,'style-recovery-intent',{operationId,proof});
            after=(await services.full.recoverInterruptedStyle!(local.state.identity,proof,{operationId,runId:manifest.runId,resource:`full-replica/${local.state.identity.moduleKey}`,expectedSnapshotSha256:current.hash,persistedIntentSha256:intent.sha256})).snapshot;
          }else if(dataHash(receipt.result)!==dataHash({pageId:page.pageId}))fail('style_recovery_receipt_result');
          const actual=actualPage(after,page.pageId);await checkpointHeaderModule(local.directory,services.header,after.header.hash);
          const checkpoint:FullReplicaBodyCheckpoint={...pageCheckpoint(after),cssHash:digest(css),documentHash:documentHashV2(actual.elements,actual.settings),sourceUnitIds:[..._prepared.body.sourceUnitIds],embeddedHeaderCount:0};await operationFile(operation,'body-confirmed',{fullSnapshot:after,checkpoint});return {status:'after',checkpoint};
        }
      }
      if (operation.phase === 'body' && checkpoints.page && checkpoints.header && !checkpoints.body && !checkpoints.bound && !local.state.pending && local.state.confirmed?.hash === current.header.hash && dataHash(local.state.confirmed.snapshot) === dataHash(current.header.snapshot)) {
        const page = actualPage(current, checkpoints.page.pageId); assertHeaderCheckpoint(current, checkpoints.header);
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations')), prefix = `${operation.operationId}-`, names = (await readdir(directory)).filter(name => name.startsWith(prefix));
        const registered = names.filter(name => name.startsWith(prefix + 'registered-components-') && /^[a-f0-9-]{36}\.json$/.test(name.slice((prefix + 'registered-components-').length)));
        // Discovery/claim can fail before the first body proof is written. An empty
        // operation directory is recoverable only under the same strict before
        // snapshot and confirmed-media checks, never as evidence of a completed save.
        if (!names.some(name => name.startsWith(prefix + 'body-save-intent-')) && (names.length === 0 || registered.length === 1 && names.every(name => name.startsWith(prefix + 'registered-components-') || name.startsWith(prefix + 'target-posts-') || name.startsWith(prefix + 'target-products-'))) && page.bodyHash === checkpoints.page.bodyHash && !page.elements.length && page.headerId === null && page.title === manifest.title && isNativeReplicaSlug(manifest.slug, page.slug) && page.settings.template === 'elementor_header_footer' && page.settings.hide_title === 'yes' && (page.settings.custom_css === undefined || page.settings.custom_css === '')) {
          if (registered.length) {
            const registration = JSON.parse(await readFile(await checkedPath(path.join(directory, registered[0])), 'utf8'));
            if (registration.version !== 1 || registration.kind !== 'clonewp-full-replica-operation' || dataHash(registration.operation) !== dataHash(operation)) return { status: 'conflict' };
          }
          assertActualPreparedBody(_prepared.body, manifest); const body = _prepared.body.payload, header = assertPreparedHeader(_prepared.header!, manifest);
          const required = [...new Set([...referencedNative44Assets(body.program), ...fullPageCSSAssetKeys(body.css)])], assets = await assetManifest(body.assetsManifest, path.dirname(body.assetsManifestPath), required, bodyFontAssetKeys(body));
          // No operation file and no body-media directory prove the crash happened before any import began.
          const noBodyImportStarted = names.length === 0 && await lstat(path.join(runDirectory, 'body-media')).then(() => false, (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
          const bodyMedia = await confirmedLedger('body-media', page.pageId, assets, required) ?? (noBodyImportStarted ? [] : null), headerMedia = await confirmedLedger('header-media', page.pageId, header.assets, header.required);
          if (!bodyMedia || !headerMedia) return { status: 'conflict' };
          // Claim only the exact already-owned page; this branch performs no creation or save.
          await claim(services, page.pageId, _prepared.body);
          const media = [...bodyMedia, ...headerMedia]; for (let offset = 0; offset < media.length; offset += 100) await services.client.verifyImportedAssets(page.pageId, media.slice(offset, offset + 100));
          const fresh = await services.full.inspect(local.state.identity); if (fresh.hash !== current.hash) return { status: 'conflict' };
          return { status: 'before' };
        }
      }
      if ((operation.phase === 'navigation-return-revision' || operation.phase === 'body' && !checkpoints.body) && manifest.body.navigationForms) {
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations')), names = await readdir(directory);
        const readProof = async (label: string) => { const prefix = `${operation.operationId}-${label}-`, files = names.filter(name => name.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/.test(name.slice(prefix.length))); if (files.length !== 1) return null; const record = JSON.parse(await readFile(await checkedPath(path.join(directory, files[0])), 'utf8')); return dataHash(record.operation) === dataHash(operation) ? record.value : null; };
        const proof = await readProof('navigation-return-patch') as { version: number; kind: string; before: FullReplicaRemoteSnapshot; formsHash: string; patch: NavigationReturnPatch; bound?: FullReplicaBoundCheckpoint; cssHash: string; sourceUnitIds: string[] } | null;
        if (proof) {
          const intent = await readProof('navigation-return') as { operationId: string; action: string; beforeHash: string; protectedHash: string; payload: Record<string, unknown>; payloadHash: string } | null, payload = { pageId: proof.before.page?.pageId, sourceUrl: manifest.sourceUrl, taskId: manifest.taskId, forms: manifest.body.navigationForms };
          if (!intent || local.state.pending || proof.version !== 1 || proof.kind !== 'clonewp-full-navigation-return-patch' || proof.formsHash !== fullReplicaHash(manifest.body.navigationForms) || intent.action !== 'navigation-return' || intent.beforeHash !== proof.before.hash || intent.protectedHash !== proof.before.header.snapshot.globalHash || dataHash(intent.payload) !== dataHash(payload) || intent.payloadHash !== fullReplicaHash(payload) || dataHash([...proof.sourceUnitIds].sort()) !== dataHash([...manifest.sourcePartition.bodyUnits].sort()) || dataHash(compileNavigationReturnPatch(proof.before.page!.elements, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId)) !== dataHash(proof.patch)) return { status: 'conflict' };
          if (operation.phase === 'navigation-return-revision') {
            if (!checkpoints.bound || !proof.bound || fullReplicaFingerprint(proof.bound) !== fullReplicaFingerprint(checkpoints.bound)) return { status: 'conflict' }; assertBound(proof.before, proof.bound);
            if (current.hash === proof.before.hash && local.state.confirmed?.hash === current.header.hash && dataHash(local.state.confirmed.snapshot) === dataHash(current.header.snapshot) && !current.receipts[intent.operationId]) return { status: 'before' };
          } else {
            if (!checkpoints.page || !checkpoints.header || proof.bound || proof.before.page?.headerId !== null) return { status: 'conflict' }; actualPage(proof.before, checkpoints.page.pageId); assertHeaderCheckpoint(proof.before, checkpoints.header);
          }
          if (digest(String(proof.before.page!.settings.custom_css ?? '')) !== proof.cssHash) return { status: 'conflict' };
          const receipt = current.receipts[intent.operationId]; if (receipt?.state !== 'complete' || receipt.action !== 'navigation-return' || receipt.payloadHash !== intent.payloadHash || dataHash(receipt.result) !== dataHash({ pageId: proof.before.page!.pageId, widgetIds: proof.patch.widgetIds })) return { status: 'conflict' };
          try { assertNavigationReturnBoundary(proof.before, current, proof.patch, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId); } catch { return { status: 'conflict' }; }
          const { [intent.operationId]: _receipt, ...remaining } = current.receipts; if (dataHash(remaining) !== dataHash(proof.before.receipts)) return { status: 'conflict' };
          const page = actualPage(current, proof.before.page!.pageId), checkpoint = proof.bound ? { ...proof.bound, bodyHash: page.bodyHash, documentHash: documentHashV2(page.elements, page.settings) } : { ...pageCheckpoint(current), cssHash: proof.cssHash, documentHash: documentHashV2(page.elements, page.settings), sourceUnitIds: [...proof.sourceUnitIds], embeddedHeaderCount: 0 as const };
          if (proof.bound) assertBound(current, checkpoint as FullReplicaBoundCheckpoint); await checkpointHeaderModule(local.directory, services.header, current.header.hash); return { status: 'after', checkpoint };
        }
        if (operation.phase === 'navigation-return-revision') {
          const confirmed = await readProof('navigation-return-revision-confirmed'); if (!confirmed || confirmed.fullSnapshot?.hash !== current.hash || !checkpoints.bound) return { status: 'conflict' }; assertBound(current, confirmed.checkpoint); return { status: 'after', checkpoint: confirmed.checkpoint };
        }
        const save = await readProof('body-save-intent'); if (save?.navigationReturn === NAVIGATION_RETURN_VERSION || save?.navigationReturn === 'pageshow-persisted-reload-v1') return { status: 'conflict' };
      }
      if (operation.phase === 'body' && manifest.body.navigationForms && !checkpoints.body) {
        if (!checkpoints.page || !checkpoints.header || checkpoints.bound || local.state.pending) return { status: 'conflict' };
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations')), names = await readdir(directory);
        const readProof = async (label: string) => {
          const prefix = `${operation.operationId}-${label}-`, files = names.filter(name => name.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/.test(name.slice(prefix.length)));
          if (files.length !== 1) return null; const record = JSON.parse(await readFile(await checkedPath(path.join(directory, files[0])), 'utf8')); return dataHash(record.operation) === dataHash(operation) ? record.value : null;
        };
        const proof = await readProof('navigation-form-patch') as { version: number; kind: string; before: FullReplicaRemoteSnapshot; formsHash: string; patch: ReturnType<typeof compileNavigationFormPatch>; cssHash: string; sourceUnitIds: string[] } | null;
        const intent = await readProof('navigation-forms') as { operationId: string; action: string; beforeHash: string; protectedHash: string; payload: Record<string, unknown>; payloadHash: string } | null;
        const payload = { pageId: checkpoints.page.pageId, sourceUrl: manifest.sourceUrl, taskId: manifest.taskId, forms: manifest.body.navigationForms };
        if (!proof || !intent || proof.version !== 1 || proof.kind !== 'clonewp-full-navigation-form-patch' || proof.formsHash !== fullReplicaHash(manifest.body.navigationForms) || intent.action !== 'navigation-forms' || intent.beforeHash !== proof.before.hash || intent.protectedHash !== proof.before.header.snapshot.globalHash || dataHash(intent.payload) !== dataHash(payload) || intent.payloadHash !== fullReplicaHash(payload) || dataHash(proof.sourceUnitIds) !== dataHash(manifest.sourcePartition.bodyUnits)) return { status: 'conflict' };
        const priorPage = actualPage(proof.before, checkpoints.page.pageId); assertHeaderCheckpoint(proof.before, checkpoints.header);
        if (priorPage.headerId !== null || digest(String(priorPage.settings.custom_css ?? '')) !== proof.cssHash || dataHash(compileNavigationFormPatch(priorPage.elements, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId)) !== dataHash(proof.patch)) return { status: 'conflict' };
        const receipt = current.receipts[intent.operationId];
        if (receipt?.state !== 'complete' || receipt.action !== 'navigation-forms' || receipt.payloadHash !== intent.payloadHash || receipt.result?.pageId !== checkpoints.page.pageId || dataHash(receipt.result.widgetIds) !== dataHash(proof.patch.widgetIds)) return { status: 'conflict' };
        try { assertNavigationFormBoundary(proof.before, current, proof.patch, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId); } catch { return { status: 'conflict' }; }
        const { [intent.operationId]: _receipt, ...remaining } = current.receipts; if (dataHash(remaining) !== dataHash(proof.before.receipts)) return { status: 'conflict' };
        const actual = actualPage(current, checkpoints.page.pageId), checkpoint: FullReplicaBodyCheckpoint = { ...pageCheckpoint(current), cssHash: proof.cssHash, documentHash: documentHashV2(actual.elements, actual.settings), sourceUnitIds: [...proof.sourceUnitIds], embeddedHeaderCount: 0 };
        await checkpointHeaderModule(local.directory, services.header, current.header.hash); return { status: 'after', checkpoint };
      }
      if (operation.phase === 'publish' && checkpoints.bound && current.page?.status === 'publish') {
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations'));
        const prefix = `${operation.operationId}-publish-`;
        const names = (await readdir(directory)).filter(name => name.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/.test(name.slice(prefix.length)));
        if (names.length !== 1) return { status: 'conflict' };
        const record = JSON.parse(await readFile(await checkedPath(path.join(directory, names[0])), 'utf8')), intent = record.value, receipt = current.receipts[intent?.operationId];
        if (dataHash(record.operation) !== dataHash(operation) || intent?.action !== 'publish' || intent.payload?.pageId !== checkpoints.bound.pageId || intent.payloadHash !== fullReplicaHash(intent.payload) || intent.protectedHash !== current.header.snapshot.globalHash || !receipt || receipt.state !== 'complete' || receipt.action !== 'publish' || receipt.payloadHash !== intent.payloadHash || receipt.result?.pageId !== checkpoints.bound.pageId || receipt.result.publicUrl !== current.page.publicUrl) return { status: 'conflict' };
        assertBound(current, checkpoints.bound, 'publish');
        const { previewUrl: _preview, ...rest } = checkpoints.bound;
        const checkpoint: FullReplicaPublishedCheckpoint = { ...rest, status: 'publish', publicUrl: current.page.publicUrl };
        await operationFile(operation, 'publish-confirmed', { fullSnapshot: current, checkpoint });
        return { status: 'after', checkpoint };
      }
      if (operation.phase === 'motion-revision') {
        if (!checkpoints.bound || local.state.pending) return { status: 'conflict' };
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations')), names = await readdir(directory);
        const readProof = async (label: string) => { const prefix = `${operation.operationId}-${label}-`; const files = names.filter(name => name.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/.test(name.slice(prefix.length))); if (files.length !== 1) return null; const record = JSON.parse(await readFile(await checkedPath(path.join(directory, files[0])), 'utf8')); return dataHash(record.operation) === dataHash(operation) ? record.value : null; };
        const proof = await readProof('native-motion-patch') as { version: number; kind: string; before: FullReplicaRemoteSnapshot; bound: FullReplicaBoundCheckpoint; patch: NativeMotionPatch } | null, intent = await readProof('motion') as { operationId: string; action: string; beforeHash: string; protectedHash: string; payload: { pageId: number }; payloadHash: string } | null;
        if (!proof || !intent || proof.version !== 1 || proof.kind !== 'clonewp-full-native-motion-patch' || intent.action !== 'motion' || intent.beforeHash !== proof.before.hash || intent.protectedHash !== proof.before.header.snapshot.globalHash || intent.payload.pageId !== checkpoints.bound.pageId || intent.payloadHash !== fullReplicaHash({ pageId: checkpoints.bound.pageId }) || fullReplicaFingerprint(proof.bound) !== fullReplicaFingerprint(checkpoints.bound) || dataHash(patchNativeCarouselMotion(proof.before.page!.elements)) !== dataHash(proof.patch)) return { status: 'conflict' };
        assertBound(proof.before, proof.bound);
        if (current.hash === proof.before.hash && local.state.confirmed?.hash === current.header.hash && dataHash(local.state.confirmed.snapshot) === dataHash(current.header.snapshot) && !current.receipts[intent.operationId]) return { status: 'before' };
        const receipt = current.receipts[intent.operationId];
        if (receipt?.state !== 'complete' || receipt.action !== 'motion' || receipt.payloadHash !== intent.payloadHash || receipt.result?.pageId !== checkpoints.bound.pageId || dataHash(receipt.result.widgetIds) !== dataHash(proof.patch.widgetIds)) return { status: 'conflict' };
        try { assertNativeMotionBoundary(proof.before, current, proof.patch); } catch { return { status: 'conflict' }; }
        const { [intent.operationId]: _receipt, ...priorReceipts } = current.receipts; if (dataHash(priorReceipts) !== dataHash(proof.before.receipts)) return { status: 'conflict' };
        const page = actualPage(current, proof.bound.pageId), checkpoint = { ...proof.bound, bodyHash: page.bodyHash, documentHash: documentHashV2(page.elements, page.settings) }; assertBound(current, checkpoint);
        await checkpointHeaderModule(local.directory, services.header, current.header.hash); return { status: 'after', checkpoint };
      }
      if (operation.phase === 'layout-revision') {
        if (!checkpoints.bound || local.state.pending) return { status: 'conflict' };
        const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations')), names = await readdir(directory);
        const readProof = async (label: string) => { const prefix = `${operation.operationId}-${label}-`; const files = names.filter(name => name.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/.test(name.slice(prefix.length))); if (files.length !== 1) return null; const record = JSON.parse(await readFile(await checkedPath(path.join(directory, files[0])), 'utf8')); return dataHash(record.operation) === dataHash(operation) ? record.value : null; };
        const proof = await readProof('layout-patch') as { version: number; kind: string; before: FullReplicaRemoteSnapshot; bound: FullReplicaBoundCheckpoint; plan: FullReplicaFileRef; elementsHash: string } | null;
        const intent = await readProof('layout') as { operationId: string; action: string; beforeHash: string; protectedHash: string; payload: { pageId: number; plan: ContainerTreePlan }; payloadHash: string } | null;
        if (!proof || !intent || proof.version !== 1 || proof.kind !== 'clonewp-full-layout-patch' || intent.action !== 'layout' || intent.beforeHash !== proof.before.hash || intent.protectedHash !== proof.before.header.snapshot.globalHash || intent.payload.pageId !== checkpoints.bound.pageId || intent.payloadHash !== fullReplicaHash(intent.payload) || fullReplicaFingerprint(proof.bound) !== fullReplicaFingerprint(checkpoints.bound)) return { status: 'conflict' };
        const plan = containerTreePlanSchema.parse(JSON.parse((await readBound(proof.plan)).bytes.toString('utf8')));
        if (dataHash(plan) !== dataHash(intent.payload.plan) || dataHash(applyContainerTreePlan(proof.before.page!.elements, plan)) !== proof.elementsHash) return { status: 'conflict' };
        assertBound(proof.before, proof.bound);
        if (current.hash === proof.before.hash && local.state.confirmed?.hash === current.header.hash && dataHash(local.state.confirmed.snapshot) === dataHash(current.header.snapshot) && !current.receipts[intent.operationId]) return { status: 'before' };
        const receipt = current.receipts[intent.operationId]; if (receipt?.state !== 'complete' || receipt.action !== 'layout' || receipt.payloadHash !== intent.payloadHash || receipt.result?.pageId !== checkpoints.bound.pageId) return { status: 'conflict' };
        const page = actualPage(current, checkpoints.bound.pageId);
        if (dataHash(page.elements) !== proof.elementsHash || dataHash(page.settings) !== dataHash(proof.before.page!.settings) || current.header.snapshot.globalHash !== proof.before.header.snapshot.globalHash) return { status: 'conflict' };
        const { [intent.operationId]: _receipt, ...priorReceipts } = current.receipts; if (dataHash(priorReceipts) !== dataHash(proof.before.receipts)) return { status: 'conflict' };
        const checkpoint = { ...proof.bound, bodyHash: page.bodyHash, documentHash: documentHashV2(page.elements, page.settings) }; assertBound(current, checkpoint);
        await checkpointHeaderModule(local.directory, services.header, current.header.hash); return { status: 'after', checkpoint };
      }
      if (operation.phase === 'binding' && current.page?.headerId === null) {
        const page = current.page, body = checkpoints.body, header = checkpoints.header, confirmed = local.state.confirmed, module = current.header.snapshot.module;
        // A guard can fail before any native binding request. Clear that intent only when
        // both independent checkpoints and the complete confirmed native snapshot still match.
        if (!body || !header || checkpoints.bound || local.state.pending || !confirmed || !module?.header || !module.style || Object.keys(module.menus).length !== manifest.header!.plan.menus.length || manifest.header!.plan.menus.some(menu => !module.menus[menu.key]) || page.pageId !== body.pageId || page.runId !== manifest.runId || page.status !== 'draft' || page.template !== 'elementor_header_footer' || !page.built || page.bodyHash !== body.bodyHash || documentHashV2(page.elements, page.settings) !== body.documentHash || digest(String(page.settings.custom_css ?? '')) !== body.cssHash || confirmed.hash !== current.header.hash || dataHash(confirmed.snapshot) !== dataHash(current.header.snapshot) || dataHash(headerCheckpoint(module, local.state.identity)) !== dataHash(header)) return { status: 'conflict' };
        return { status: 'before' };
      }
      // Accept only a durable, exact locally confirmed operation result. A partial native/media write stays in conflict.
      const { readdir } = await import('node:fs/promises'), directory = await checkedPath(path.join(runDirectory, 'operations'));
      const suffix = operation.phase === 'page' ? 'create-page-confirmed' : operation.phase === 'header' ? 'header-confirmed' : operation.phase === 'body' ? 'body-confirmed' : operation.phase === 'binding' ? 'binding-confirmed' : operation.phase === 'style-revision' ? 'style-revision-confirmed' : 'publish-confirmed';
      const files = (await readdir(directory)).filter(name => name.startsWith(`${operation.operationId}-${suffix}-`) && name.endsWith('.json'));
      if (files.length !== 1) return { status: 'conflict' };
      const record = JSON.parse(await readFile(await checkedPath(path.join(directory, files[0])), 'utf8')), checkpoint = record.value?.checkpoint;
      if (record.operation?.operationId !== operation.operationId || record.operation?.expectedCheckpointHash !== operation.expectedCheckpointHash || record.value?.fullSnapshot?.hash !== current.hash) return { status: 'conflict' };
      if (operation.phase === 'page') return { status: 'after', checkpoint: pageCheckpoint(current) };
      if (!checkpoint) return { status: 'conflict' };
      if (operation.phase === 'header') assertHeaderCheckpoint(current, checkpoint);
      else if (operation.phase === 'body') { const page = actualPage(current, checkpoints.page?.pageId); if (page.bodyHash !== checkpoint.bodyHash || documentHashV2(page.elements, page.settings) !== checkpoint.documentHash) return { status: 'conflict' }; }
      else assertBound(current, checkpoint, operation.phase === 'publish' ? 'publish' : 'draft');
      return { status: 'after', checkpoint };
    },
  };
  return dependencies;
}

const browserDOM = z.object({ version: z.literal(1), kind: z.literal('clonewp-full-replica-browser-dom'), pageId: z.number().int().positive(), url: z.url(), observedAt: z.string(), viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(), html: z.string().min(1).max(12 * 1024 * 1024) }).strict();
const interactionState = z.object({ version: z.literal(1), kind: z.literal('clonewp-full-replica-interaction-state'), pageId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(), selector: z.string().min(1), observedAt: z.string(), state: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])), motion: carouselMotionFrameSchema.optional(), screenshot: fileRef.optional() }).strict();
/** Evidence is deliberately independent from a caller's pass/count booleans. */
export async function verifyFullReplicaReviewEvidence(review: FullReplicaReview, bound: FullReplicaBoundCheckpoint, manifest: FullReplicaManifest, currentElements?: unknown[], inquiryBackend?:InquiryBackendReader): Promise<void> {
  return withVerifiedEvidenceReader(ROOT, async reader => {
  if (!Number.isFinite(Date.parse(review.observedAt)) || Math.abs(Date.now() - Date.parse(review.observedAt)) > 60 * 60 * 1000) fail('review_not_current');
  const file = await readBound(review.reviewerEvidence), evidence = JSON.parse(file.bytes.toString('utf8'));
  if (evidence.version !== 1 || evidence.kind !== 'clonewp-full-replica-review-evidence' || evidence.taskId !== manifest.taskId || evidence.runId !== manifest.runId || evidence.pageId !== bound.pageId || evidence.fingerprint !== fullReplicaFingerprint(bound) || !Array.isArray(evidence.viewports) || evidence.viewports.length !== requiredReplicaViewports(manifest.responsive).length) fail('review_evidence_identity');
  const visualProgramFile = await readBound(manifest.body.program), visualProgramRaw = JSON.parse(visualProgramFile.bytes.toString('utf8'));
  const visualAuditRequired = review.decision === 'approved' && [1, 2, 3].includes(visualProgramRaw?.visualAuditVersion);
  if (manifest.version === 4 && visualProgramRaw?.visualAuditVersion !== 3) fail('review_phone_visual_audit_required');
  const visualProgram = visualAuditRequired ? validateNative44Program(visualProgramRaw) : null;
  const submissionBase = Array.isArray(visualProgramRaw?.blocks) && walkNative44(visualProgramRaw.blocks).some(node => node.kind === 'native' && [3,4].includes(node.pendingForm?.version ?? 0)) ? validateNative44Program(visualProgramRaw) : null;
  const submissionProgram = submissionBase && manifest.responsive ? prepareResponsiveBody(submissionBase, manifest.responsive, '').program : submissionBase;
  const submissionAuthorization = submissionProgram ? await prepareTargetSubmissionFormReview({ root: ROOT, program: submissionProgram, pageId: bound.pageId, currentElements, read: readBound }) : null;
  if (submissionProgram && review.decision === 'approved' && inquirySubmissionReviewRequired(submissionProgram,evidence.inquiryForms)) await verifyInquiryReview({program:submissionProgram,manifest,bound,review,evidence:evidence.inquiryForms,base:path.dirname(file.filename),read:readBound,backend:inquiryBackend});
  const phonePackets = manifest.version === 4 && review.decision === 'approved' && manifest.responsive
    ? await verifyResponsiveSource(manifest.responsive, manifest, readBound) : [];
  const motionRows = manifest.version === 4 && review.decision === 'approved' && manifest.responsive && visualProgram
    ? await verifyPhoneMotionSource({ taskId: manifest.taskId, sourceUrl: manifest.sourceUrl, plan: manifest.responsive, program: visualProgram, packets: phonePackets, read: readBound }) : [];
  const responsiveDOM = new Map<string, string>();
  if (manifest.nativeImagePolicy && review.decision === 'approved') {
    const programFile = await readBound(manifest.body.program), base = validateNative44Program(JSON.parse(programFile.bytes.toString('utf8')));
    const program = manifest.responsive ? prepareResponsiveBody(base, manifest.responsive, '').program : base;
    await verifyNativeImageChecks({ policy: manifest.nativeImagePolicy, program, checks: review.nativeImageChecks, pageId: bound.pageId, fingerprint: review.fingerprint, observedAt: review.observedAt, targetOrigin: manifest.targetOrigin, base: path.dirname(file.filename), read: readBound, currentElements });
  }
  for (const view of review.viewports) {
    const row = evidence.viewports.find((item: { width: number; height: number }) => item.width === view.width && item.height === view.height); if (!row || row.screenshot?.sha256 !== view.screenshot.sha256) fail('review_viewport_binding');
    const raster = await readBound(view.screenshot, path.dirname(file.filename)), metadata = await sharp(raster.bytes).metadata();
    if (!nativeViewportRasterMapping(metadata,view,row.captureMode)) fail('review_raster_dimensions');
    const raw = await readBound(row.dom, path.dirname(file.filename)), dom = browserDOM.parse(JSON.parse(raw.bytes.toString('utf8'))), url = new URL(dom.url);
    if (dom.pageId !== bound.pageId || dom.viewport.width !== view.width || dom.viewport.height !== view.height || url.origin !== manifest.targetOrigin || url.username || url.password || /(?:token|nonce|password|secret|authorization)=/i.test(url.search) || !Number.isFinite(Date.parse(dom.observedAt)) || Date.parse(dom.observedAt) > Date.parse(review.observedAt) || Date.parse(review.observedAt) - Date.parse(dom.observedAt) > 60 * 60 * 1000) fail('review_dom_identity');
    if (visualAuditRequired && view.width >= 1024) {
      if (!row.visualAudit) fail('review_visual_audit_missing');
      await verifyFullReplicaVisualReview({ manifest, bound, review, width: view.width, height: view.height, screenshotSha256: view.screenshot.sha256, reference: row.visualAudit, reviewDirectory: path.dirname(file.filename), targetHtml: dom.html, read: readBound });
    } else if (manifest.version === 4 && visualAuditRequired) {
      if (!row.visualAudit) fail('review_phone_visual_audit_missing');
      const phoneView = evidence.responsive?.views?.find((item: { width: number; height: number }) => item.width === view.width && item.height === view.height);
      if (!phoneView || !Number.isInteger(phoneView.clientWidth)) fail('review_phone_client_width_missing');
      await verifyFullReplicaPhoneVisualReview({ manifest, bound, review, width: view.width, height: view.height, clientWidth: phoneView.clientWidth, screenshotSha256: view.screenshot.sha256, reference: row.visualAudit, reviewDirectory: path.dirname(file.filename), targetHtml: dom.html, read: readBound, packets: phonePackets });
    }
    responsiveDOM.set(`${view.width}x${view.height}`, dom.html);
    let headerCount = 0, bodyHeaderCount = 0, roots = 0; const activeForms: any[] = [];
    const walk = (node: any, inBody = false, inInert = false) => { const attrs = Object.fromEntries((node.attrs ?? []).map((attr: { name: string; value: string }) => [attr.name, attr.value])), classes = String(attrs.class ?? '').split(/\s+/), bodyRoot = attrs['data-elementor-id'] === String(bound.pageId) && classes.includes(`elementor-${bound.pageId}`), body = inBody || bodyRoot, inert = inInert || Object.hasOwn(attrs, 'inert'); if (bodyRoot) roots++; if (classes.includes(`whb-${bound.headerId}`)) headerCount++; if (body && (node.tagName === 'header' || String(attrs.role).toLowerCase() === 'banner' || classes.includes('whb-header'))) bodyHeaderCount++; if (body && node.tagName === 'form' && !inert) activeForms.push(node); for (const child of node.childNodes ?? []) walk(child, body, inert); };
    walk(parse(dom.html)); if (roots !== 1 || headerCount !== view.headerCount || bodyHeaderCount !== view.bodyHeaderCount || headerCount !== 1 || bodyHeaderCount !== 0) fail('review_actual_header_count');
    const remainingActiveForms = submissionAuthorization ? withoutAuthorizedTargetSubmissionForms(activeForms, submissionAuthorization) : activeForms;
    if (manifest.body.navigationForms) assertNavigationFormDOM(remainingActiveForms, manifest.body.navigationForms, manifest.sourceUrl, manifest.taskId);
    else if (remainingActiveForms.length) fail('review_active_pending_form');
    const interactionFile = await readBound(row.interactions, path.dirname(file.filename)), interactions = JSON.parse(interactionFile.bytes.toString('utf8'));
    if (interactions.version !== 1 || interactions.kind !== 'clonewp-full-replica-interactions' || interactions.pageId !== bound.pageId || interactions.fingerprint !== fullReplicaFingerprint(bound) || interactions.width !== view.width || interactions.height !== view.height || typeof interactions.reviewSummary !== 'string' || interactions.reviewSummary.trim().length < 20 || !Array.isArray(interactions.actions) || !interactions.actions.length) fail('review_interactions_evidence');
    if (manifest.responsive && view.width <= manifest.responsive.mobileMaxWidth) {
      const hasSubmenus = manifest.reusedHeader?.hasSubmenus ?? manifest.header!.plan.menus.some(m => m.items.some(i => i.parentKey !== null));
      const required = ['mobile-menu-open', 'mobile-menu-close', ...(hasSubmenus ? ['mobile-submenu'] : [])];
      if (required.some(key => !interactions.actions.some((a: any) => a.key === key && a.kind === 'navigation' && a.expectedOutcome === 'changed'))) fail('review_mobile_menu_missing');
      for (const motion of motionRows.filter(item => item.width === view.width && item.height === view.height)) {
        const selector = `.elementor-${bound.pageId} .${native44ModuleClass(motion.componentKey)}`;
        if (interactions.actions.filter((a: any) => a.key === `carousel-motion:${motion.componentKey}` && a.kind === 'carousel' && a.selector === selector && a.expectedOutcome === 'changed').length !== 1) fail(`review_carousel_motion_missing:${motion.componentKey}`);
      }
    }
    for (const action of interactions.actions) {
      if (typeof action.key !== 'string' || !['navigation', 'hover', 'carousel', 'form', 'link'].includes(action.kind) || typeof action.selector !== 'string' || !action.selector.trim() || typeof action.summary !== 'string' || action.summary.trim().length < 10 || !['changed', 'inert', 'navigated'].includes(action.expectedOutcome)) fail('review_interaction_action');
      const before = await readBound(action.before, path.dirname(interactionFile.filename)), after = await readBound(action.after, path.dirname(interactionFile.filename));
      const states = [interactionState.parse(JSON.parse(before.bytes.toString('utf8'))), interactionState.parse(JSON.parse(after.bytes.toString('utf8')))];
      for (const state of states) {
        if (state.pageId !== bound.pageId || state.fingerprint !== fullReplicaFingerprint(bound) || state.width !== view.width || state.height !== view.height || state.selector !== action.selector || !Number.isFinite(Date.parse(state.observedAt)) || Date.parse(state.observedAt) > Date.parse(review.observedAt) || Date.parse(review.observedAt) - Date.parse(state.observedAt) > 60 * 60 * 1000 || !Object.keys(state.state).length) fail('review_interaction_state_identity');
        if (state.screenshot) { const image = await readBound(state.screenshot, path.dirname(interactionFile.filename)), dimensions = await sharp(image.bytes).metadata(); if (!nativeViewportRasterMapping(dimensions,view,row.captureMode)) fail('review_interaction_raster'); }
      }
      if (Date.parse(states[1].observedAt) < Date.parse(states[0].observedAt) || action.expectedOutcome !== 'inert' && dataHash(states[0].state) === dataHash(states[1].state)) fail('review_interaction_no_observed_change');
      if (manifest.responsive && view.width <= manifest.responsive.mobileMaxWidth && ['mobile-menu-open', 'mobile-menu-close', 'mobile-submenu'].includes(action.key)) {
        const closing = action.key === 'mobile-menu-close';
        if (states[0].state.expanded !== closing || states[1].state.expanded !== !closing) fail('review_mobile_menu_state');
      }
      if (action.expectedOutcome === 'inert' && (states[1].state.inert !== true || states[1].state.submissionRequests !== 0)) fail('review_pending_form_submission_unproven');
      const motion = motionRows.find(item => item.width === view.width && item.height === view.height && action.key === `carousel-motion:${item.componentKey}`);
      if (motion) {
        if (action.kind !== 'carousel' || action.selector !== `.elementor-${bound.pageId} .${native44ModuleClass(motion.componentKey)}` || !states[0].screenshot || !states[1].screenshot || !states[0].motion || !states[1].motion) fail('review_carousel_motion_evidence');
        const differences = compareCarouselMotion(motion.before, motion.after, states[0].motion, states[1].motion);
        if (differences.length) fail(`review_carousel_motion_mismatch:${motion.componentKey}:${differences.join(',')}`);
      }
      const navigationForm = manifest.body.navigationForms?.find(form => action.selector === navigationFormSelector(form, manifest.taskId));
      if (navigationForm) assertNavigationFormInteraction(navigationForm, action, states, manifest.sourceUrl, manifest.targetOrigin, manifest.taskId);
    }
    for (const form of manifest.body.navigationForms ?? []) if (!interactions.actions.some((action: any) => action.kind === 'form' && action.selector === navigationFormSelector(form, manifest.taskId) && action.expectedOutcome === 'navigated')) fail('review_navigation_form_interaction_missing');
  }
  if (manifest.responsive) await verifyResponsiveReview(evidence.responsive, manifest.responsive, { ...manifest, pageId: bound.pageId, headerId: bound.headerId, fingerprint: review.fingerprint, observedAt: review.observedAt }, readBound, path.dirname(file.filename), responsiveDOM);
  await reader.revalidateAll();
  });
}

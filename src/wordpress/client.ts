import {nativeProductRequestPHP} from './native-product-request.js';
import {nativeProductPreviewPHP} from './native-product-preview.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { NovamiraTransport } from './mcp.js';
import {createWordPressNetwork} from './network.js';
import type {WordPressConnection} from './connection.js';
import { validateSourceFontBytes } from './source-font.js';
import { WordPressError } from './errors.js';
import { compileEditorElements } from './editor-serialization.js';
import { canvasShellCSS, type CanvasShellProof } from './canvas-shell.js';
import { findGeneratedHtmlProof } from '../replica-v2/html.js';
import { nativeCheckpointPHP } from './checkpoint.js';
import { capabilityPayloadReturnPHP, decodeCapabilityPayload } from './capability-payload.js';
import { targetPostsReadPHP } from './posts.js';
import { targetCategoriesReadPHP, parseTargetCategoriesObservation } from './categories.js';
import type { TargetCategoriesEvidence, TargetCategoriesQueryInput } from './categories-contract.js';
import { normalizeRelatedProductsQuery, targetRelatedProductsReadPHP, parseRelatedProductsSnapshot, type RelatedProductsQueryInput, type RelatedProductsSnapshot } from './related-products.js';
import { targetProductReadPHP } from './product.js';
import { parseTargetProductSnapshot, targetProductId, type TargetProductSnapshot } from './product-contract.js';
import { productRuntimeReadPHP, productRuntimeCapability, type ProductRuntimeCapability, type ProductRuntimeObservation } from './current-product-runtime.js';
import {currentProductSelectionSchema,type CurrentProductSelection} from '../native44/current-product.js';
import { assertTargetPostsEvidence, normalizeTargetPostsQuery, type TargetPostsEvidence, type TargetPostsQueryInput } from './posts-contract.js';
import { assertOwnedPublishedSnapshot } from './publication-contract.js';
import type { GeneratedHtmlProof } from '../replica-v2/types.js';
import { NATIVE44_ALL_TYPES, EXTENDED_NATIVE_TYPES, assertAllowedWidget, assertKnownNativeWidget } from '../native44/catalog.js';
import { assertProductExtensionReference, productExtensionWidgetTypes } from '../native44/product-extension.js';
import { validateRegisteredChildren, validateRegisteredSettings } from '../planning/plan.js';
import { assertNative44Compilation, assertNative44PendingFormCompilation } from '../native44/compiler.js';
import type { Native44Compiled } from '../native44/types.js';
import { assertNative44RevisionDelta } from '../native44/revision-snapshot.js';
import { compileNative44CSSModel, type Native44CSSModel } from '../native44/css-model.js';
import { assertNative44CurrentCSSDelta, type Native44CurrentCSSCorrection } from '../native44/current-css-patch.js';
import { assertNative44CurrentNativeDelta, type Native44CurrentNativeReplacement } from '../native44/current-native-patch.js';
import type { Native44CSSModule } from '../native44/css-handoff.js';
import { MediaTransformationContractSchema, fingerprintMediaTransformationBytes, reconcileMediaTransformation, type MediaTransformationContract, type MediaTransformationPolicy } from '../assets/media-transformation.js';
import type { AbilityInfo, AssetImportOptions, AssetImportCheckpoint, RecoverableAssetImportOptions, PendingAssetInspection, CapabilityReport, DraftComposition, DraftSnapshot, PublishedSnapshot, OwnedPublicationIntentProof, OwnedPublishedCheckpoint, OwnedPublicationResult, ElementorElement, ImportedAsset, LegacySchema, PreflightReport, PreviewAccess, TargetCatalogSnapshot, WordPressCredentials } from './types.js';

const encodePHP = (value: unknown) => `json_decode(base64_decode('${Buffer.from(JSON.stringify(value)).toString('base64')}'), true)`;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(sortObject(value));
function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortObject(v)]));
  return value;
}
const hashDocument = (elements: unknown, settings: unknown) => sha256(canonical({ elements, settings }));
const assetImportFailures = new WeakMap<object, AssetImportCheckpoint>();
/** Process-local provenance: persisted or fabricated errors cannot authorize a retry. */
export function getAssetImportFailure(error: unknown): AssetImportCheckpoint | undefined { const checkpoint = error && typeof error === 'object' ? assetImportFailures.get(error) : undefined; return checkpoint ? { ...checkpoint } : undefined; }
function stagingPath(path: string, runId: string, digest: string): string { return `wp-content/uploads/clonewp-import/${runId}/${digest.slice(0, 16)}-${basename(path).replace(/[^a-zA-Z0-9._-]/g, '_')}`; }
export const comparisonTree = (nodes: ElementorElement[]): unknown => nodes.map(node => ({
  id: node.id, elType: node.elType, ...(node.widgetType ? { widgetType: node.widgetType } : {}),
  settings: Array.isArray(node.settings) && !node.settings.length ? {} : node.settings,
  isInner: Boolean(node.isInner), elements: comparisonTree(node.elements ?? []),
}));

export interface OwnedReviewStatus {
  pageId: number; runId: string; exists: boolean; postType: string | null; status: string | null;
  ownerMatches: boolean; canEdit: boolean; uniqueRunPage: boolean; documentExists: boolean; builtWithElementor: boolean;
}

export class WordPressClient {
  readonly targetUrl: string;
  readonly origin: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly transport: NovamiraTransport;
  private readonly sharedConnection?:WordPressConnection;
  private readonly network?:ReturnType<typeof createWordPressNetwork>;
  private readonly native44: boolean;
  private readonly allowedWidgetTypes?: ReadonlySet<string>;
  private ownedPages = new Map<number, string>();
  private ownedNativeProductDocuments=new Set<number>();
  /** Exact server-read snapshots may be restored; this never approves newly authored HTML. */
  private readSnapshotAttestations = new Set<string>();
  /** An ambiguous publication must be reconciled through a read-only checkpoint. */
  private publicationAttempts = new Set<string>();
  private abilities = new Map<string, AbilityInfo>();
  private capabilities?: CapabilityReport;
  private canvasShells = new Map<number, CanvasShellProof>();
  private metrics={httpAttempts:0,httpCompleted:0,httpFailed:0,httpDurationMs:0,restCalls:0,abilityCalls:0,phpCalls:0,documentReads:0,documentSaves:0,documentRestores:0,pagePublications:0,mediaImportCalls:0,mediaUploadBytes:0,capabilityDiscoveries:0,registryCacheHits:0,schemaCacheHits:0};

  /** Aggregate counts only: credentials, tokens, request bodies and URLs are never included. */
  diagnostics(){return structuredClone(this.metrics);}

  constructor(options: WordPressCredentials,connection?:WordPressConnection) {
    this.native44 = options.executionStrategy === 'native44-css-handoff';
    if (options.allowedWidgetTypes && !this.native44) throw new WordPressError('component_policy_conflict', 'A component allowlist requires the explicit native44 strategy.');
    if (this.native44) {
      if(options.componentExtension)assertProductExtensionReference(options.componentExtension);
      const expected = productExtensionWidgetTypes(options.componentExtension);
      const types = options.allowedWidgetTypes ?? expected;
      types.forEach(type=>options.componentExtension?assertKnownNativeWidget(type):assertAllowedWidget(type));
      if (types.length !== expected.length || new Set(types).size !== expected.length || expected.some(type=>!types.includes(type))) throw new WordPressError('component_policy_conflict', options.componentExtension?'Native components require the exact qualified additive extension.':'Native44 requires the exact fixed 44 component identities.');
      this.allowedWidgetTypes = new Set(types);
    }
    const target = new URL(options.targetUrl);
    if (target.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
      throw new WordPressError('insecure_target', 'Remote WordPress authentication requires HTTPS.');
    }
    if (target.username || target.password) throw new WordPressError('invalid_target', 'Target URLs must not contain credentials.');
    this.origin = target.origin;
    this.targetUrl = `${target.origin}/`;
    if(connection){connection.assertMatches(options);this.sharedConnection=connection;}
    else this.network=createWordPressNetwork(this.origin,options.networkRoute,options.fetch);
    this.fetchImpl = connection?.fetch ?? this.network!.fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.authorization = `Basic ${Buffer.from(`${options.username}:${options.applicationPassword}`).toString('base64')}`;
    this.transport = connection?.mcp ?? new NovamiraTransport(new URL('/wp-json/mcp/novamira', this.origin), this.authenticatedFetch.bind(this));
  }

  /** Authentication never crosses origin, including redirects returned by WordPress or the MCP SDK. */
  private assertNativeScope(type:string):void {
    if(this.native44 && !this.allowedWidgetTypes?.has(type))throw Error(`native44_component_not_allowed: ${type}`);
    assertKnownNativeWidget(type);
  }

  /** Authentication never crosses origin, including redirects returned by WordPress or the MCP SDK. */
  private async authenticatedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input.toString(), this.origin);
    if (url.origin !== this.origin) throw new WordPressError('cross_origin_blocked', 'Refused to send WordPress credentials to another origin.');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    headers.set('Authorization', this.authorization);
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    const started=performance.now();this.metrics.httpAttempts++;
    try { response = await this.fetchImpl(input instanceof Request ? new Request(url, input) : url, { ...init, headers, redirect: 'manual', signal });this.metrics.httpCompleted++; }
    catch { this.metrics.httpFailed++;throw new WordPressError('network_error', 'The configured WordPress server did not respond in time.'); }
    finally{this.metrics.httpDurationMs+=Math.round(performance.now()-started);}
    if (response.status >= 300 && response.status < 400) throw new WordPressError('redirect_blocked', 'Authenticated WordPress requests may not follow redirects.', response.status);
    return response;
  }

  async rest<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    this.metrics.restCalls++;
    if (!path.startsWith('/wp-json/')) throw new WordPressError('invalid_rest_path', 'Only relative WordPress REST paths are accepted.');
    const response = await this.authenticatedFetch(new URL(path, this.origin), {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const value = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) {
      const code = typeof value?.code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.code) ? value.code : 'wordpress_request_failed';
      throw new WordPressError(code, `WordPress REST request failed (${response.status}).`, response.status);
    }
    if (value === undefined) throw new WordPressError('invalid_rest_response', 'WordPress returned an invalid JSON response.');
    return value as T;
  }

  async preflight(): Promise<PreflightReport> {
    const [index, user, plugins, themes] = await Promise.all([
      this.rest<{ namespaces: string[] }>('/wp-json/?_fields=namespaces'),
      this.rest<{ id: number; capabilities: Record<string, boolean> }>('/wp-json/wp/v2/users/me?context=edit&_fields=id,capabilities'),
      this.rest<PreflightReport['plugins']>('/wp-json/wp/v2/plugins?_fields=plugin,name,version,status'),
      this.rest<PreflightReport['themes']>('/wp-json/wp/v2/themes?status=active'),
    ]);
    const novamira = plugins.find(x => x.plugin === 'novamira/novamira');
    const report: PreflightReport = {
      targetUrl: this.targetUrl, authenticated: Boolean(user.id), userId: user.id,
      plugins: plugins.map(x => ({ plugin: x.plugin, name: x.name, version: x.version, status: x.status })),
      themes: themes.map(x => ({ stylesheet: x.stylesheet, version: x.version, status: x.status })),
      namespaces: index.namespaces ?? [], novamiraInstalled: Boolean(novamira), novamiraActive: novamira?.status === 'active', blockers: [],
    };
    try {
      const env = await this.rest<Record<string, string>>('/wp-json/wp-abilities/v1/abilities/core/get-environment-info/run');
      report.wordpressVersion = env.wp_version; report.phpVersion = env.php_version; report.environment = env.environment;
    } catch { /* Older installations may not expose the read-only core ability. */ }
    if (!novamira) report.blockers.push('Novamira is not installed.');
    else if (novamira.status !== 'active') report.blockers.push('Novamira is inactive.');
    if (!plugins.some(x => x.plugin === 'elementor/elementor' && x.status === 'active')) report.blockers.push('Elementor Core is not active.');
    if (!user.capabilities?.edit_pages || !user.capabilities?.upload_files) report.blockers.push('The authenticated user needs edit_pages and upload_files.');
    return report;
  }

  private async registry(): Promise<void> {
    if (this.abilities.size) {this.metrics.registryCacheHits++;return;}
    const list = await this.transport.discover();
    for (const ability of list) this.abilities.set(ability.name, ability);
  }

  async abilityInfo(name: string): Promise<AbilityInfo> {
    await this.registry();
    if (!this.abilities.has(name)) throw new WordPressError('ability_unavailable', `Required registered ability is unavailable: ${name}.`);
    const cached = this.abilities.get(name)!;
    if (cached.input_schema) return structuredClone(cached);
    const info = await this.transport.info(name);
    this.abilities.set(name, info);
    return structuredClone(info);
  }

  private async execute(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    this.metrics.abilityCalls++;
    await this.abilityInfo(name);
    const value = await this.transport.execute(name, parameters);
    if (value && typeof value === 'object' && (value as Record<string, unknown>).code && (value as Record<string, unknown>).data) {
      throw new WordPressError('ability_execution_failed', 'A registered WordPress ability rejected the request.');
    }
    return value;
  }

  /** Internal fixed helpers only: source-page text is encoded as data and never interpolated as PHP. */
  private async php(code: string): Promise<unknown> {
    this.metrics.phpCalls++;
    const value = await this.execute('novamira/execute-php', { code }) as Record<string, unknown>;
    if (value.success !== true) throw new WordPressError('php_execution_failed', 'The bounded Novamira WordPress operation failed.');
    return value.return_value;
  }

  /** Fixed public product observation only; no product, media or site record is changed. */
  async readTargetCatalog(limit = 48): Promise<TargetCatalogSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new WordPressError('invalid_catalog_limit', 'Target catalog reads require an integer limit between 1 and 200.');
    const value = await this.php(`
if (!function_exists('wc_get_products') || !class_exists('WC_Product')) { throw new RuntimeException('woocommerce_catalog_missing'); }
$catalogProducts=wc_get_products(['status'=>'publish','visibility'=>'visible','limit'=>${limit},'orderby'=>['date'=>'DESC','ID'=>'DESC'],'order'=>'DESC','return'=>'objects']);
$catalog=[];
$publicText=static function($value){return trim(preg_replace('/[\\s\\x{00a0}]+/u',' ',html_entity_decode(wp_strip_all_tags((string)$value),ENT_QUOTES|ENT_HTML5,'UTF-8')));};
foreach ($catalogProducts as $product) {
  if (!($product instanceof WC_Product) || $product->get_status()!=='publish' || !$product->is_visible()) { continue; }
  $imageId=(int)$product->get_image_id();$image=$imageId?wp_get_attachment_image_url($imageId,'full'):false;$variants=[];
  if ($imageId) {
    $metadata=wp_get_attachment_metadata($imageId);$sizes=array_keys(is_array($metadata)?($metadata['sizes']??[]):[]);
    foreach ($sizes as $size) {$variant=wp_get_attachment_image_url($imageId,$size);if(is_string($variant)&&$variant!==''){$variants[]=$variant;}}
  }
  if (!is_string($image)||$image==='') {$image=wc_placeholder_img_src('woocommerce_thumbnail');}
  if(is_string($image)&&$image!==''){$variants[]=$image;}
  $catalog[]=['id'=>(int)$product->get_id(),'name'=>$publicText($product->get_name()),'permalink'=>(string)$product->get_permalink(),'imageUrl'=>(string)$image,'imageVariants'=>array_values(array_unique($variants)),'priceText'=>$publicText($product->get_price_html()),'onSale'=>(bool)$product->is_on_sale(),'averageRating'=>(float)$product->get_average_rating(),'ratingCount'=>(int)$product->get_rating_count()];
}
return $catalog;`);
    const invalid = () => new WordPressError('invalid_catalog_response', 'The read-only target catalog returned invalid public product evidence.');
    if (!Array.isArray(value) || value.length > limit) throw invalid();
    const publicURL = (input: unknown): URL | undefined => {
      if (typeof input !== 'string') return;
      try { const url = new URL(input); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; }
      catch { return; }
    };
    const ids = new Set<number>();
    const products = value.map(input => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
      const product = input as Record<string, unknown>;
      if (typeof product.id !== 'number' || !Number.isSafeInteger(product.id) || product.id < 1 || ids.has(product.id) || typeof product.name !== 'string' || !product.name.trim() || typeof product.priceText !== 'string' || publicURL(product.permalink)?.origin !== this.origin || !publicURL(product.imageUrl) || !Array.isArray(product.imageVariants) || product.imageVariants.some(variant => !publicURL(variant))) throw invalid();
      if(product.onSale!==undefined&&typeof product.onSale!=='boolean')throw invalid();
        if (product.averageRating !== undefined && (typeof product.averageRating !== 'number' || !Number.isFinite(product.averageRating) || product.averageRating < 0 || product.averageRating > 5)) throw invalid();
        if (product.ratingCount !== undefined && (typeof product.ratingCount !== 'number' || !Number.isSafeInteger(product.ratingCount) || product.ratingCount < 0)) throw invalid();
      ids.add(product.id);
      return { id: product.id, name: product.name, permalink: product.permalink as string, imageUrl: product.imageUrl as string, imageVariants: [...new Set(product.imageVariants as string[])], priceText: product.priceText,...(typeof product.onSale==='boolean'?{onSale:product.onSale}:{}),...(typeof product.averageRating === 'number' ? {averageRating: product.averageRating} : {}),...(typeof product.ratingCount === 'number' ? {ratingCount: product.ratingCount} : {}) };
    });
    return { version: 1, targetOrigin: this.origin, readAt: new Date().toISOString(), evidence: [], query: { limit, status: 'publish', visibility: 'visible', orderby: 'date', order: 'DESC', tieBreak: {orderby: 'ID', order: 'DESC'} }, products };
  }

  /** Explicit existing target product only; never creates records or submits business actions. */
  async readTargetProduct(productId: number): Promise<TargetProductSnapshot> {
    targetProductId(productId);
    const result = await this.php(targetProductReadPHP(productId));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new WordPressError('invalid_product_response', 'Invalid public target product response.');
    try { return parseTargetProductSnapshot({ ...result, version: 1, provider: 'target-woocommerce-product-v1', targetOrigin: this.origin, readAt: new Date().toISOString() }, this.origin, productId); }
    catch { throw new WordPressError('invalid_product_response', 'Invalid public target product response.'); }
  }

  /** Read real published target articles without changing posts, media, settings or queries. */
  async verifyCurrentProductRuntimeSupport():Promise<void> {
    await this.php("if(!post_type_exists('woodmart_layout')||!class_exists('XTS\\\\Modules\\\\Layouts\\\\Single_Product')||!method_exists('XTS\\\\Modules\\\\Layouts\\\\Single_Product','setup_postdata')){throw new RuntimeException('native_product_template_provider_missing');}return true;");
  }
  /** Bounded public product_cat hierarchy; does not mutate terms or order metadata. */
  async readTargetCategories(query: TargetCategoriesQueryInput): Promise<TargetCategoriesEvidence> {
    return parseTargetCategoriesObservation(await this.php(targetCategoriesReadPHP(query)), query, this.origin);
  }
  async readTargetRelatedProducts(productId: number, input: RelatedProductsQueryInput): Promise<RelatedProductsSnapshot> {
    const query = normalizeRelatedProductsQuery(input), value = await this.php(targetRelatedProductsReadPHP(productId, query));
    return parseRelatedProductsSnapshot({ version: 1, provider: 'target-woocommerce-related-v1', targetOrigin: this.origin, readAt: new Date().toISOString(), query, ...(value as Record<string, unknown>) }, this.origin, productId, query);
  }
  async readCurrentProductRuntime(pageId:number,runId:string,productId:number,contextKey='currentProduct'):Promise<ProductRuntimeCapability> {
    const value=await this.php(productRuntimeReadPHP(pageId,runId,productId,contextKey));
    const capability=productRuntimeCapability({...value as ProductRuntimeObservation,readAt:new Date().toISOString()},{targetOrigin:this.origin,pageId,runId,productId,contextKey});
    this.ownedNativeProductDocuments.add(pageId);return capability;
  }

  /** Read real published target articles without changing posts, media, settings or queries. */
  async readTargetPosts(input: TargetPostsQueryInput): Promise<TargetPostsEvidence> {
    let query;
    try { query = normalizeTargetPostsQuery(input); }
    catch { throw new WordPressError('invalid_posts_query', 'Target article reads require a bounded latest-published-posts query.'); }
    const posts = await this.php(targetPostsReadPHP(query));
    const observation: unknown = { version: 1, targetOrigin: this.origin, readAt: new Date().toISOString(), evidence: [], query, posts };
    try { assertTargetPostsEvidence(observation, this.origin, query); }
    catch { throw new WordPressError('invalid_posts_response', 'The read-only target article query returned invalid published post evidence.'); }
    return observation;
  }

  /** Bounded read-only implementation proof for the installed native product query adapter. */
  async readNativeProductQuerySourceProof(): Promise<{targetOrigin: string; sources: Array<{name: string; sha256: string; source: string}>}> {
    const value = await this.php(`
$out=[];if(class_exists('Elementor\\Plugin')){\\Elementor\\Plugin::$instance->widgets_manager->get_widget_types('wd_products');}
if(class_exists('XTS\\Elementor\\Products')){$r=new ReflectionMethod('XTS\\Elementor\\Products','render');$file=$r->getFileName();$lines=file($file);$source=implode('',array_slice($lines,$r->getStartLine()-1,$r->getEndLine()-$r->getStartLine()+1));if(strlen($source)>100000){throw new RuntimeException('product_query_source_too_large');}$out[]=['name'=>'XTS.Elementor.Products.render','sha256'=>hash('sha256',$source),'source'=>$source];}
foreach(['woodmart_shortcode_products','woodmart_get_products_query','woodmart_get_products_shortcode_query']as$name){if(!function_exists($name)){continue;}$r=new ReflectionFunction($name);$file=$r->getFileName();$lines=file($file);$source=implode('',array_slice($lines,$r->getStartLine()-1,$r->getEndLine()-$r->getStartLine()+1));if(strlen($source)>100000){throw new RuntimeException('product_query_source_too_large');}$out[]=['name'=>$name,'sha256'=>hash('sha256',$source),'source'=>$source];}
if(class_exists('WC_Query')){$r=new ReflectionMethod('WC_Query','get_catalog_ordering_args');$file=$r->getFileName();$lines=file($file);$source=implode('',array_slice($lines,$r->getStartLine()-1,$r->getEndLine()-$r->getStartLine()+1));if(strlen($source)>100000){throw new RuntimeException('product_query_source_too_large');}$out[]=['name'=>'WC_Query.get_catalog_ordering_args','sha256'=>hash('sha256',$source),'source'=>$source];}
return $out;`);
    if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new WordPressError('invalid_product_query_source', 'The native product query source proof is unavailable.');
    const sources = value.map(row => {
      if (!row || typeof row !== 'object') throw new WordPressError('invalid_product_query_source', 'Invalid native product query source proof.');
      const record = row as {name?: unknown; sha256?: unknown; source?: unknown};
      if (typeof record.name !== 'string' || !['XTS.Elementor.Products.render','woodmart_shortcode_products','woodmart_get_products_query','woodmart_get_products_shortcode_query','WC_Query.get_catalog_ordering_args'].includes(record.name) || typeof record.source !== 'string' || record.source.length > 100000 || record.sha256 !== sha256(record.source)) throw new WordPressError('invalid_product_query_source', 'Invalid native product query source bytes/hash.');
      return {name: record.name, source: record.source, sha256: record.sha256 as string};
    });
    return {targetOrigin: this.origin, sources};
  }

  async discoverCapabilities(widgetTypes: string[] = ['container', 'heading', 'text-editor', 'image', 'button', 'icon', 'divider', 'spacer']): Promise<CapabilityReport> {
    if (this.native44) {
      if (arguments.length === 0) widgetTypes = [...this.allowedWidgetTypes!];
      for (const type of widgetTypes) this.assertNativeScope(type);
    }
    this.metrics.capabilityDiscoveries++;
    await this.registry();
    const abilities: AbilityInfo[] = [],names=[...this.abilities.keys()].filter(name=>name.startsWith('elementor/')||['novamira/execute-php','novamira/create-upload-link','novamira/create-admin-access-link','novamira/agent-context'].includes(name));
    // These are independent read-only registry descriptions, never document mutations.
    for(let offset=0;offset<names.length;offset+=4)abilities.push(...await Promise.all(names.slice(offset,offset+4).map(name=>this.abilityInfo(name))));
    if (!this.abilities.has('novamira/execute-php')) {
      this.capabilities = { mode: 'unavailable', abilities, schemas: {}, legacySchemas: {}, versions: {}, limitations: ['Novamira PHP is required for ownership guards, media registration and full document readback.'] };
      return this.capabilities;
    }
    const data = decodeCapabilityPayload(await this.php(`
if (!defined('ELEMENTOR_VERSION') || !class_exists('Elementor\\Plugin')) { throw new RuntimeException('elementor_missing'); }
$p=\\Elementor\\Plugin::$instance; $out=['versions'=>['elementor'=>ELEMENTOR_VERSION,'wordpress'=>get_bloginfo('version'),'php'=>PHP_VERSION],'schemas'=>[],'sourceProof'=>[],'atomicActive'=>false];
if (defined('ELEMENTOR_PRO_VERSION')) {$out['versions']['elementorPro']=ELEMENTOR_PRO_VERSION;}
${this.native44 ? "$out['versions']['woodmart']=(string)wp_get_theme('woodmart')->get('Version');$out['versions']['activeTemplate']=(string)get_template();if(!function_exists('get_plugins')){require_once ABSPATH.'wp-admin/includes/plugin.php';}foreach(get_plugins() as $pluginFile=>$pluginData){if(strpos($pluginFile,'woodmart-core/')===0&&is_plugin_active($pluginFile)){$out['versions']['woodmartCore']=(string)$pluginData['Version'];}}" : ''}
if (defined('NOVAMIRA_VERSION')) {$out['versions']['novamira']=NOVAMIRA_VERSION;}
if (isset($p->experiments)) {$out['atomicActive']=$p->experiments->is_feature_active('e_atomic_elements');}
$types=${encodePHP(widgetTypes)};
$frontendProperty=null;$originalFrontend=null;
if(class_exists('Elementor\\Core\\Frontend\\Performance')){$frontendProperty=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$frontendProperty->setAccessible(true);$originalFrontend=$frontendProperty->getValue();$frontendProperty->setValue(null,false);}
$originalResponsiveMode=$p->breakpoints->get_responsive_control_duplication_mode();
$out['sourceProof']['responsiveDevices']=['active'=>$p->breakpoints->get_active_devices_list(['reverse'=>true,'desktop_first'=>true]),'breakpoints'=>[],'originalDuplicationMode'=>$originalResponsiveMode];
foreach($p->breakpoints->get_active_breakpoints() as $name=>$breakpoint){$out['sourceProof']['responsiveDevices']['breakpoints'][$name]=['value'=>$breakpoint->get_value(),'direction'=>$breakpoint->get_direction()];}
// CSS\Base::parse_content uses this mode to register actual per-device controls.
// Only the request's registry changes; no site option or breakpoint is modified.
$p->breakpoints->set_responsive_control_duplication_mode('on');
$p->controls_manager->clear_stack_cache();
try {
foreach ($types as $type) {
  ${this.native44 ? 'try {' : ''}
  $obj=$p->widgets_manager->get_widget_types($type);
  if (!$obj) {$all=$p->elements_manager->get_element_types(); $obj=$all[$type]??null;}
  if (!$obj || !method_exists($obj,'get_controls')) {continue;}
  $stack=$obj->get_stack();$allControls=array_merge($stack['controls']??[],$stack['style_controls']??[]);
  $controls=[]; foreach ($allControls as $key=>$control) {
    $item=[];foreach (['type','label','default','options','multiple','condition','conditions','selectors','responsive','fields','min','max','step','range','size_units','separator','frontend_available','render_type','save_default'] as $field) {if(array_key_exists($field,$control)){$item[$field]=$control[$field];}}
    $controls[$key]=$item;
  }
  $out['schemas'][$type]=['type'=>$type,'class'=>get_class($obj),'controls'=>$controls];
  ${this.native44 ? `if(is_subclass_of($obj,'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base')&&method_exists($obj,'get_default_children_elements')&&method_exists($obj,'get_default_repeater_title_setting_key')){
    $cm=new ReflectionMethod($obj,'get_default_children_elements');$cm->setAccessible(true);$defaultChildren=$cm->invoke($obj);$tm=new ReflectionMethod($obj,'get_default_repeater_title_setting_key');$tm->setAccessible(true);$titleKey=$tm->invoke($obj);$nestedKeys=[];foreach($allControls as $k=>$c){if(($c['type']??'')==='nested-elements-repeater'){$nestedKeys[]=$k;}}
    if(is_array($defaultChildren)&&count($defaultChildren)>0&&count(array_filter($defaultChildren,static function($c){return ($c['elType']??'')==='container';}))===count($defaultChildren)){
      $base=['childType'=>'container','baseClass'=>'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base','sourceSha256'=>hash_file('sha256',$cm->getFileName())];
      if(count($nestedKeys)===1&&is_string($titleKey)&&$titleKey!==''){$out['schemas'][$type]['nativeChildContract']=array_merge($base,['policy'=>'repeater','repeaterKey'=>$nestedKeys[0],'titleSettingKey'=>$titleKey]);}
      elseif(count($nestedKeys)===0&&$titleKey===''){$out['schemas'][$type]['nativeChildContract']=array_merge($base,['policy'=>'fixed','count'=>count($defaultChildren),'childSettings'=>$defaultChildren[0]['settings']??[]]);}
    }
  }` : ''}
  if(is_subclass_of($obj,'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base')){
    $repeaters=[];foreach($allControls as $key=>$control){if(($control['type']??'')==='nested-elements-repeater'){$repeaters[]=$key;}}
    if(count($repeaters)===1&&method_exists($obj,'get_default_children_elements')&&method_exists($obj,'get_default_repeater_title_setting_key')){
      $childrenMethod=new ReflectionMethod($obj,'get_default_children_elements');$childrenMethod->setAccessible(true);$children=$childrenMethod->invoke($obj);
      $titleMethod=new ReflectionMethod($obj,'get_default_repeater_title_setting_key');$titleMethod->setAccessible(true);$titleKey=$titleMethod->invoke($obj);
      if($children&&count(array_filter($children,static function($child){return ($child['elType']??'')==='container';}))===count($children)){
        $out['schemas'][$type]['nativeChildren']=['childType'=>'container','repeaterKey'=>$repeaters[0],'titleSettingKey'=>$titleKey,'baseClass'=>'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base','sourceSha256'=>hash_file('sha256',$childrenMethod->getFileName())];
      }
    }
  }
  ${this.native44 ? "} catch (Throwable $widgetError) {unset($out['schemas'][$type]);$out['sourceProof']['schemaErrors'][$type]=['code'=>'widget_observation_failed','exception'=>get_class($widgetError)];}" : ''}
}
} finally {$p->breakpoints->set_responsive_control_duplication_mode($originalResponsiveMode);if($frontendProperty){$frontendProperty->setValue(null,$originalFrontend);}$p->controls_manager->clear_stack_cache();}
foreach (['save','get_elements_data'] as $method) {$r=new ReflectionMethod('Elementor\\Core\\Base\\Document',$method);$file=$r->getFileName();$lines=file($file);$out['sourceProof'][$method]=['class'=>$r->getDeclaringClass()->getName(),'method'=>$method,'sha256'=>hash_file('sha256',$file),'startLine'=>$r->getStartLine(),'endLine'=>$r->getEndLine(),'source'=>implode('',array_slice($lines,$r->getStartLine()-1,$r->getEndLine()-$r->getStartLine()+1))];}
foreach ([['Elementor\\Controls_Stack','add_responsive_control','responsiveRegistration'],['Elementor\\Core\\Files\\CSS\\Base','parse_content','responsiveCSSExpansion']] as $entry){$r=new ReflectionMethod($entry[0],$entry[1]);$file=$r->getFileName();$lines=file($file);$out['sourceProof'][$entry[2]]=['class'=>$r->getDeclaringClass()->getName(),'method'=>$entry[1],'sha256'=>hash_file('sha256',$file),'startLine'=>$r->getStartLine(),'endLine'=>$r->getEndLine(),'source'=>implode('',array_slice($lines,$r->getStartLine()-1,$r->getEndLine()-$r->getStartLine()+1))];}
${nativeCheckpointPHP(this.native44 ? "array_keys($out['schemas'])" : '$types')}$out['checkpointProof']=$checkpointProof;
${capabilityPayloadReturnPHP}`)) as { versions: Record<string, string>; schemas: Record<string, LegacySchema>; sourceProof: Record<string, unknown>; atomicActive: boolean; checkpointProof?: import('./types.js').NativeCheckpointProof };
    const hasAtomic = data.atomicActive && this.abilities.has('elementor/build-composition') && this.abilities.has('elementor/get-widget-schema');
    const schemas: Record<string, unknown> = {};
    if (hasAtomic && this.abilities.has('elementor/list-widget-schemas')) {
      const listing = await this.execute('elementor/list-widget-schemas', { summary: true });
      schemas.catalog = listing;
    }
    if (this.native44 && this.capabilities && canonical(this.capabilities.versions) !== canonical(data.versions)) throw new WordPressError('capability_environment_changed', 'The target environment changed between native44 capability batches.');
    this.capabilities = {
      mode: hasAtomic ? 'native-v4' : Object.keys(data.schemas).length ? 'legacy-verified' : 'unavailable',
      abilities, schemas, legacySchemas: this.native44 ? { ...this.capabilities?.legacySchemas, ...data.schemas } : data.schemas, versions: data.versions, sourceProof: this.native44 ? { ...data.sourceProof, schemaErrors: { ...(this.capabilities?.sourceProof?.schemaErrors as Record<string,unknown>??{}), ...(data.sourceProof.schemaErrors as Record<string,unknown>??{}) } } : data.sourceProof, checkpointProof: data.checkpointProof,
      limitations: hasAtomic ? [] : ['The existing site uses the installed legacy widget and container controls; Atomic-only APIs are unavailable.'],
    };
    return this.capabilities;
  }

  async getWidgetSchema(widgetType: string): Promise<unknown> {
    if (this.native44) this.assertNativeScope(widgetType);
    if(this.capabilities?.legacySchemas[widgetType])this.metrics.schemaCacheHits++;
    if (!this.capabilities) await this.discoverCapabilities([widgetType]);
    if (this.capabilities!.mode === 'native-v4') return this.execute('elementor/get-widget-schema', { widget_type: widgetType });
    if (!this.capabilities!.legacySchemas[widgetType]) await this.discoverCapabilities([...Object.keys(this.capabilities!.legacySchemas), widgetType]);
    const schema = this.capabilities!.legacySchemas[widgetType];
    if (!schema) throw new WordPressError('widget_unavailable', `Widget type is not registered on this site: ${widgetType}.`);
    return schema;
  }

  /** Remove only the tagged, inactive installer left by an ambiguous bootstrap response. */
  async cleanupOwnedInstallerSnippet(snippetId: number): Promise<boolean> {
    if (!Number.isInteger(snippetId) || snippetId < 1) throw new WordPressError('invalid_installer_id', 'A valid owned installer ID is required.');
    return await this.php(`if(!function_exists('Code_Snippets\\get_snippet')||!function_exists('Code_Snippets\\delete_snippet')){throw new RuntimeException('snippet_api_missing');}$s=\\Code_Snippets\\get_snippet(${snippetId},false);if(!$s||strpos($s->name,'cloneWP temporary official Novamira installer ')!==0||$s->active||!in_array('clonewp-bootstrap',(array)$s->tags,true)){throw new RuntimeException('owned_installer_guard');}$ok=\\Code_Snippets\\delete_snippet(${snippetId},false);return (bool)$ok;`) as boolean;
  }

  private ownedGuard(pageId: number, mutation = true): string {
    const runId = this.ownedPages.get(pageId);
    if (!runId) throw new WordPressError('unowned_page', 'Refused to mutate a page not created by this run.');
    const native=this.ownedNativeProductDocuments.has(pageId), postType=native?'woodmart_layout':'page';
    return `$id=${pageId};$run=${encodePHP(runId)};if(get_post_type($id)!=='${postType}'${native?"||get_post_meta($id,'wd_layout_type',true)!=='single_product'":''}||get_post_status($id)!=='draft'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)){throw new RuntimeException('owned_draft_guard');}$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc){throw new RuntimeException('document_missing');}${mutation ? "require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($id)){throw new RuntimeException('another_user_editing');}" : ''}`;
  }

  private expectedStateGuard(pageId: number, expected: DraftSnapshot): string {
    if (expected.pageId !== pageId || expected.runId !== this.ownedPages.get(pageId) || expected.status !== 'draft' || hashDocument(expected.elements, expected.settings) !== expected.hash) throw new WordPressError('invalid_snapshot', 'Expected current snapshot does not match this owned draft.');
    return `$expectedCurrent=${encodePHP({ elements: expected.elements, settings: expected.settings })};$normalize=function($value)use(&$normalize){if(!is_array($value)){return $value;}$keys=array_keys($value);if($keys!==range(0,count($value)-1)){ksort($value,SORT_STRING);}foreach($value as $key=>$child){$value[$key]=$normalize($child);}return $value;};$actualCurrent=['elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()];if(json_encode($normalize($actualCurrent))!==json_encode($normalize($expectedCurrent))){throw new RuntimeException('concurrent_document_change');}`;
  }

  async createDraft(runId: string, title: string, options?: { requireExistingPageId?: number; currentRecord?: CurrentProductSelection }): Promise<{ pageId: number; editUrl: string; status: 'draft' }> {
    if (!/^[a-zA-Z0-9_-]{4,100}$/.test(runId)) throw new WordPressError('invalid_run_id', 'Run identifiers must use letters, numbers, underscores or dashes.');
    if (options?.requireExistingPageId !== undefined && (!Number.isInteger(options.requireExistingPageId) || options.requireExistingPageId < 1)) throw new WordPressError('invalid_page_id', 'An existing owned page ID must be a positive integer.');
    if (!this.capabilities) await this.discoverCapabilities();
    const selection=options?.currentRecord?currentProductSelectionSchema.parse(options.currentRecord):undefined;
    const postType=selection?'woodmart_layout':'page', requireExisting=options?.requireExistingPageId!==undefined;
    if(selection){if(!this.allowedWidgetTypes?.has('wd_single_product_title'))throw Error('native_product_extension_required');await this.verifyCurrentProductRuntimeSupport();}
    const value = await this.php(`
if(!current_user_can('edit_pages')){throw new RuntimeException('permission_denied');}
$existing=get_posts(['post_type'=>'${postType}','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>${encodePHP(runId)}]);
if(count($existing)>1){throw new RuntimeException('ambiguous_run_pages');}
if($existing){$id=(int)$existing[0];${requireExisting ? `if($id!==${options!.requireExistingPageId}){throw new RuntimeException('existing_run_page_mismatch');}` : ''}${selection?"if(get_post_meta($id,'wd_layout_type',true)!=='single_product'){throw new RuntimeException('native_product_template_owner');}":''}if(get_post_status($id)!=='draft'){throw new RuntimeException('existing_run_not_draft');}$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc||!$doc->is_built_with_elementor()){throw new RuntimeException('existing_run_incomplete');}return ['pageId'=>$id,'editUrl'=>$doc->get_edit_url(),'status'=>'draft'];}
${requireExisting ? "throw new RuntimeException('required_owned_page_missing');" : ''}
$id=wp_insert_post(['post_title'=>${encodePHP(title)},'post_type'=>'${postType}','post_status'=>'draft','meta_input'=>['_clonewp_run_id'=>${encodePHP(runId)},'_wp_page_template'=>'elementor_canvas'${selection?",'wd_layout_type'=>'single_product'":''}]],true);
if(is_wp_error($id)){throw new RuntimeException('draft_create_failed');}
$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc){wp_delete_post($id,true);throw new RuntimeException('document_missing');}
$doc->set_is_built_with_elementor(true);$ok=$doc->save(['elements'=>[],'settings'=>[]]);if(!$ok){wp_delete_post($id,true);throw new RuntimeException('document_save_failed');}
return ['pageId'=>(int)$id,'editUrl'=>$doc->get_edit_url(),'status'=>get_post_status($id)];`) as { pageId: number; editUrl: string; status: 'draft' };
    if (!Number.isInteger(value.pageId) || value.status !== 'draft') throw new WordPressError('invalid_created_draft', 'WordPress did not return a new draft page.');
    this.ownedPages.set(value.pageId, runId); if(selection)this.ownedNativeProductDocuments.add(value.pageId);
    return value;
  }

  private validateLegacy(elements: ElementorElement[], htmlProofs?: readonly GeneratedHtmlProof[]): void {
    const seen = new Set<string>(); let count = 0;
    const walk = (nodes: ElementorElement[], depth: number) => {
      if (!Array.isArray(nodes) || depth > 16) throw new WordPressError('invalid_element_tree', 'Elementor tree exceeds the supported depth.');
      for (const node of nodes) {
        if (++count > 2500 || !/^[a-zA-Z0-9]{4,12}$/.test(node.id) || seen.has(node.id)) throw new WordPressError('invalid_element_tree', 'Elementor IDs must be unique and the tree must stay below 2500 elements.');
        seen.add(node.id);
        const type = node.elType === 'widget' ? node.widgetType : node.elType;
        if (this.native44) { if (!type) throw new WordPressError('widget_schema_missing', 'Native44 requires an explicit registered widget identity.'); this.assertNativeScope(type); }
        const schema = type ? this.capabilities?.legacySchemas[type] : undefined;
        if (!schema || !node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings)) throw new WordPressError('widget_schema_missing', 'Every Elementor element must have a discovered live schema.');
        if (type === 'html') {
          try { findGeneratedHtmlProof(htmlProofs, node.id, node.settings.html); }
          catch { throw new WordPressError('html_widget_rejected', 'Static HTML requires an exact current-process v2 compiler proof.'); }
          if (node.elements?.length) throw new WordPressError('invalid_element_tree', 'Static HTML widgets cannot own native children.');
        }
        for (const [key, value] of Object.entries(node.settings)) {
          if (key === '_title') throw new WordPressError('navigator_alias_rejected', 'Navigator aliases (_title) are not allowed; use native component names.');
          const control = schema.controls[key];
          if (!control) throw new WordPressError('unknown_control', `Control ${key} is not registered for ${type}.`);
          if (['select', 'choose'].includes(control.type) && control.options && (typeof value !== 'string' || (value !== '' && !(value in control.options)))) {
            // Elementor Pro populates this one selector from the form's email fields in the editor.
            // Keep the PHP registry strict for every other selector and reuse the contextual validator.
            let dynamicReplyTo = false;
            if (type === 'form' && key === 'email_reply_to') {
              try {
                validateRegisteredSettings(type, node.settings, schema, { onlyControls: new Set([key]) });
                dynamicReplyTo = true;
              } catch { /* Unsupported dynamic values still fail below. */ }
            }
            if (!dynamicReplyTo) throw new WordPressError('invalid_control_value', `Control ${key} has an unsupported value.`);
          }
          if (!(type === 'html' && key === 'html') && typeof value === 'string' && /<\s*(script|style|iframe)|\bon\w+\s*=|javascript\s*:/i.test(value)) throw new WordPressError('unsafe_content', 'Active code is not accepted as Elementor content.');
        }
        if(node.elType==='widget'&&(node.elements??[]).length){
          if (this.native44 && schema.nativeChildContract) {
            try { validateRegisteredChildren(type!, node.settings, node.elements.map(child => child.elType === 'container' ? 'container' : child.widgetType ?? ''), schema); }
            catch { throw new WordPressError('invalid_nested_widget', 'Native44 children differ from the installed fixed/repeater relationship.'); }
          } else {
          const nested=schema.nativeChildren, rows=nested?node.settings[nested.repeaterKey]:undefined;
          if(!nested||nested.baseClass!=='Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base'||!Array.isArray(rows)||rows.length!==node.elements.length||node.elements.some(child=>child.elType!=='container'))throw new WordPressError('invalid_nested_widget','Nested native children require registered class proof and one repeater row per container.');
          }
        }
        walk(node.elements ?? [], depth + 1);
      }
    };
    walk(elements, 0);
  }

  async buildDraft(pageId: number, composition: DraftComposition, _assets?: ImportedAsset[], options?: { expectedCurrent: DraftSnapshot; htmlProofs?: readonly GeneratedHtmlProof[]; preserveUnknownWrite?: boolean; native44Proof?: Native44Compiled }): Promise<DraftSnapshot> {
    if(this.native44)assertNative44Compilation(options?.native44Proof,composition);
    const currentBinding=options?.native44Proof?.currentProductBinding;
    if(currentBinding){if(currentBinding.pageId!==pageId||currentBinding.runId!==this.ownedPages.get(pageId)||currentBinding.targetOrigin!==this.origin)throw Error('current_product_compilation_owner');await this.readCurrentProductRuntime(pageId,currentBinding.runId,currentBinding.productId,currentBinding.contextKey);}
    this.metrics.documentSaves++;
    const guard = this.ownedGuard(pageId);
    if (!this.capabilities) await this.discoverCapabilities();
    if ('elements' in composition) {
      this.validateLegacy(composition.elements, options?.htmlProofs);
      composition = { ...composition, elements: compileEditorElements(composition.elements, this.capabilities!.legacySchemas, this.native44 ? { executionStrategy: 'native44-css-handoff' } : undefined) };
      this.validateLegacy(composition.elements, options?.htmlProofs);
      const shell = this.canvasShells.get(pageId);
      if (shell?.enabled && shell.css) {
        if (composition.pageSettings?.custom_css && composition.pageSettings.custom_css !== shell.css) throw new WordPressError('unexpected_page_css', 'Only the fixed owned-page Canvas shell CSS is accepted.');
        composition.pageSettings = { ...composition.pageSettings, custom_css: shell.css };
      }
    }
    const before = await this.snapshotDraft(pageId);
    const shell = this.canvasShells.get(pageId);
    if (shell?.enabled && before.settings.custom_css && before.settings.custom_css !== shell.css) throw new WordPressError('unexpected_page_css', 'An existing page CSS value must be preserved.');
    if (options && before.hash !== options.expectedCurrent.hash) throw new WordPressError('concurrent_document_change', 'The document changed before the save; the concurrent edit was preserved.');
    const optimisticGuard = this.expectedStateGuard(pageId, options?.expectedCurrent ?? before);
    let mutationAttempted = false;
    let savedState: DraftSnapshot | undefined;
    try {
      if ('xml_structure' in composition) {
        if (this.capabilities!.mode !== 'native-v4') throw new WordPressError('atomic_unavailable', 'The target has no verified active native Atomic construction API.');
        await this.php(`${guard}return true;`);
        const input = { xml_structure: composition.xml_structure, element_config: composition.element_config, style: composition.style ?? {}, classes: composition.classes ?? {}, post_id: pageId, parent_id: 'document', mode: 'replace_children' };
        await this.execute('elementor/build-composition', { ...input, dry_run: true });
        mutationAttempted = true;
        const saved = await this.php(`${guard}${optimisticGuard}if(!function_exists('wp_get_ability')){throw new RuntimeException('ability_api_missing');}$ability=wp_get_ability('elementor/build-composition');if(!$ability){throw new RuntimeException('ability_missing');}$result=$ability->execute(${encodePHP(input)});if(is_wp_error($result)){throw new RuntimeException('composition_save_failed');}return ['elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()];`) as { elements: ElementorElement[]; settings: Record<string, unknown> };
        const settings = saved.settings && !Array.isArray(saved.settings) ? saved.settings : {};
        savedState = { ...before, elements: saved.elements, settings, hash: hashDocument(saved.elements, settings) };
      } else {
        mutationAttempted = true;
        const saveCode=`${guard}${optimisticGuard}$input=${encodePHP({ elements: composition.elements, settings: composition.pageSettings ?? {} })};$ok=$doc->save($input);if(!$ok){throw new RuntimeException('document_save_failed');}return ['saved'=>true,'elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()];`;const saved=await this.php(currentBinding?nativeProductRequestPHP(currentBinding.productId,saveCode):saveCode) as { elements: ElementorElement[]; settings: Record<string, unknown> };
        const settings = saved.settings && !Array.isArray(saved.settings) ? saved.settings : {};
        savedState = { ...before, elements: saved.elements, settings, hash: hashDocument(saved.elements, settings) };
      }
      const readback = await this.readDraft(pageId);
      if ('elements' in composition && canonical(comparisonTree(readback.elements)) !== canonical(comparisonTree(composition.elements))) throw new WordPressError('readback_tree_mismatch', 'Elementor changed the saved element tree; browser verification must not continue.');
      return readback;
    } catch (error) {
      if (mutationAttempted && !options?.preserveUnknownWrite) {
        const current = await this.readDraft(pageId);
        if (current.hash !== (savedState ?? before).hash) throw new WordPressError('concurrent_document_change', 'The document changed after the save attempt; recovery preserved the concurrent edit.');
        await this.restoreDraft(pageId, before, { expectedCurrent: current });
      }
      throw error;
    }
  }

  async readDraft(pageId: number): Promise<DraftSnapshot> {
    this.metrics.documentReads++;
    const value = await this.php(`${this.ownedGuard(pageId, false)}return ['pageId'=>$id,'runId'=>$run,'title'=>get_the_title($id),'status'=>get_post_status($id),'elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()];`) as Omit<DraftSnapshot, 'hash'>;
    const elements = Array.isArray(value.elements) ? value.elements : [];
    const settings = value.settings && !Array.isArray(value.settings) ? value.settings : {};
    const snapshot = { ...value, elements, settings, hash: hashDocument(elements, settings) };
    if (snapshot.pageId === pageId && snapshot.runId === this.ownedPages.get(pageId) && snapshot.status === 'draft') this.readSnapshotAttestations.add(`${pageId}:${snapshot.runId}:${snapshot.hash}`);
    return snapshot;
  }

  async snapshotDraft(pageId: number): Promise<DraftSnapshot> { return this.readDraft(pageId); }

  /** Explicit correction transaction, separate from the one-shot generator.
   * A server-attested baseline, current CSS model and registered controls are
   * required. Unknown outcomes are left for the caller's durable reconciliation;
   * this method never retries a save or restores over an external edit. */
  async saveOwnedRevision(before: DraftSnapshot, expected: DraftSnapshot, model: Native44CSSModel): Promise<DraftSnapshot> {
    if (!this.native44 || this.ownedPages.get(before.pageId) !== before.runId || !this.readSnapshotAttestations.has(`${before.pageId}:${before.runId}:${before.hash}`)) throw new WordPressError('revision_baseline_not_attested', 'A revision requires a current server-read owned draft baseline.');
    assertNative44RevisionDelta(before, expected);
    const compiled = compileNative44CSSModel(model, { elements: expected.elements });
    if (model.pageId !== before.pageId || model.runId !== before.runId || compiled.css !== expected.settings.custom_css) throw new WordPressError('revision_css_model_mismatch', 'The complete revision CSS must be compiled from its current model.');
    const baselineNodes = new Map<string, ElementorElement>();
    const index = (nodes: ElementorElement[]) => { for (const node of nodes) { baselineNodes.set(node.id, node); index(node.elements ?? []); } }; index(before.elements);
    const checkResponsibilities = (nodes: ElementorElement[]) => { for (const node of nodes) { for (const [controlId, value] of Object.entries(node.settings)) { if (canonical(baselineNodes.get(node.id)?.settings[controlId]) !== canonical(value) && !compiled.nativeBindings.some(binding => binding.native!.elementId === node.id && binding.native!.controlId === controlId && canonical(binding.native!.expectedValue) === canonical(value))) throw new WordPressError('revision_native_responsibility_missing', 'Each changed native control must belong to the current CSS/native responsibility model.'); } checkResponsibilities(node.elements ?? []); } }; checkResponsibilities(expected.elements);
    const types = [...new Set(['container', ...[...function* visit(nodes: ElementorElement[]): Generator<string> { for (const node of nodes) { if (node.widgetType) yield node.widgetType; yield* visit(node.elements ?? []); } }(expected.elements)]])];
    const capabilities = await this.discoverCapabilities(types);
    assertNative44RevisionDelta(before, expected, capabilities.legacySchemas);
    const validateChildren = (nodes: ElementorElement[]): void => { for (const node of nodes) { if (node.elType === 'widget' && node.elements?.length) { const schema = capabilities.legacySchemas[node.widgetType!]; if (schema?.nativeChildContract) validateRegisteredChildren(node.widgetType!, node.settings, node.elements.map(child => child.elType === 'container' ? 'container' : child.widgetType ?? ''), schema); else { const relationship = schema?.nativeChildren, rows = relationship && node.settings[relationship.repeaterKey]; if (!relationship || !Array.isArray(rows) || rows.length !== node.elements.length || node.elements.some(child => child.elType !== 'container')) throw new WordPressError('invalid_nested_widget', 'Revision changed an unproved native child relationship.'); } } validateChildren(node.elements ?? []); } }; validateChildren(expected.elements);
    const current = await this.snapshotDraft(before.pageId);
    if (current.hash !== before.hash) throw new WordPressError('concurrent_document_change', 'The owned document changed before its revision; the external state was preserved.');
    const guard = this.ownedGuard(before.pageId), optimistic = this.expectedStateGuard(before.pageId, before);
    this.metrics.documentSaves++;
    await this.php(`${guard}$matches=get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($matches)!==1||(int)$matches[0]!==$id){throw new RuntimeException('ambiguous_run_pages');}${optimistic}$input=${encodePHP({ elements: expected.elements, settings: expected.settings })};if(!$doc->save($input)){throw new RuntimeException('revision_save_failed');}return ['saved'=>true];`);
    const after = await this.snapshotDraft(before.pageId);
    if (after.hash !== expected.hash) throw new WordPressError('revision_readback_mismatch', 'The complete revision readback differs from its durable expected snapshot.');
    return after;
  }
  /** V1 draft maintenance changes only the page stylesheet. The accepted tree,
   * products and page metadata remain byte-for-byte equivalent after parsing.
   * This never authorizes a body rewrite, automatic retry or restore. */
  async saveOwnedCSSRevision(before: DraftSnapshot, expected: DraftSnapshot, modules: Native44CSSModule[], corrections: Native44CurrentCSSCorrection[]): Promise<DraftSnapshot> {
    if (!this.native44 || this.ownedPages.get(before.pageId) !== before.runId || !this.readSnapshotAttestations.has(`${before.pageId}:${before.runId}:${before.hash}`)) throw new WordPressError('revision_baseline_not_attested', 'CSS maintenance requires a fresh server-read owned draft baseline.');
    assertNative44CurrentCSSDelta(before, expected, modules, corrections);
    const current = await this.snapshotDraft(before.pageId);
    if (current.hash !== before.hash) throw new WordPressError('concurrent_document_change', 'The owned document changed before its stylesheet revision.');
    const guard = this.ownedGuard(before.pageId), optimistic = this.expectedStateGuard(before.pageId, before);
    this.metrics.documentSaves++;
    await this.php(`${guard}$matches=get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($matches)!==1||(int)$matches[0]!==$id){throw new RuntimeException('ambiguous_run_pages');}${optimistic}$stack=$doc->get_stack();$controls=array_merge($stack['controls']??[],$stack['style_controls']??[]);if(($controls['custom_css']['type']??'')!=='code'){throw new RuntimeException('page_custom_css_unregistered');}$input=${encodePHP({ elements: expected.elements, settings: expected.settings })};if(!$doc->save($input)){throw new RuntimeException('css_revision_save_failed');}return ['saved'=>true];`);
    const after = await this.snapshotDraft(before.pageId);
    if (after.hash !== expected.hash) throw new WordPressError('revision_readback_mismatch', 'The CSS maintenance readback differs from the durable expected snapshot.');
    assertNative44CurrentCSSDelta(before, after, modules, corrections); return after;
  }
  /** Explicit, local native compilation replaces only named existing subtrees.
   * The retained document is server-attested; new roots require process-local
   * compiler proof. Unknown saves are reconciled by the durable transaction. */
  async saveOwnedNativeRevision(before: DraftSnapshot, expected: DraftSnapshot, compiled: Native44Compiled, replacements: Native44CurrentNativeReplacement[], modules: Native44CSSModule[], corrections: Native44CurrentCSSCorrection[], model?: Native44CSSModel): Promise<DraftSnapshot> {
    if (!this.native44 || this.ownedPages.get(before.pageId) !== before.runId || !this.readSnapshotAttestations.has(`${before.pageId}:${before.runId}:${before.hash}`)) throw new WordPressError('revision_baseline_not_attested', 'Native component maintenance requires a fresh server-read owned draft baseline.');
    assertNative44CurrentNativeDelta(before, expected, compiled, replacements, modules, corrections, model);
    for (let offset = 0; offset < compiled.usedTypes.length; offset += 4) await this.discoverCapabilities(compiled.usedTypes.slice(offset, offset + 4));
    assertNative44PendingFormCompilation(compiled, this.capabilities?.legacySchemas);
    this.validateLegacy(compiled.composition.elements, compiled.htmlProofs);
    const current = await this.snapshotDraft(before.pageId);
    if (current.hash !== before.hash) throw new WordPressError('concurrent_document_change', 'The owned document changed before its native component revision.');
    const guard = this.ownedGuard(before.pageId), optimistic = this.expectedStateGuard(before.pageId, before);
    this.metrics.documentSaves++;
    await this.php(`${guard}$matches=get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($matches)!==1||(int)$matches[0]!==$id){throw new RuntimeException('ambiguous_run_pages');}${optimistic}$input=${encodePHP({ elements: expected.elements, settings: expected.settings })};if(!$doc->save($input)){throw new RuntimeException('native_revision_save_failed');}return ['saved'=>true];`);
    const after = await this.snapshotDraft(before.pageId);
    if (after.hash !== expected.hash) throw new WordPressError('revision_readback_mismatch', 'The native component revision readback differs from the durable expected snapshot.');
    assertNative44CurrentNativeDelta(before, after, compiled, replacements, modules, corrections, model); return after;
  }
  /** Fixed read-only diagnosis, including a page that the user has since
   * published. This never acknowledges a page as writable or attests a saved
   * snapshot; all existing draft-only write guards remain in force. */
  async probeOwnedReviewStatus(pageId: number, runId: string): Promise<OwnedReviewStatus> {
    if (!Number.isSafeInteger(pageId) || pageId < 1 || !/^[A-Za-z\d_-]{4,100}$/.test(runId)) throw new WordPressError('invalid_owned_identity', 'Review status probe requires an exact page and run identity.');
    this.metrics.documentReads++;
    const value = await this.php(`$reviewStatusProbe=true;$id=${pageId};$run=${encodePHP(runId)};$post=get_post($id);$exists=(bool)$post;$type=$exists?get_post_type($id):null;$status=$exists?get_post_status($id):null;$owner=$exists&&get_post_meta($id,'_clonewp_run_id',true)===$run;$edit=$exists&&current_user_can('edit_post',$id);$pages=get_posts(['post_type'=>'${this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'}','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);$unique=count($pages)===1&&(int)$pages[0]===$id;$doc=null;$built=false;if($owner&&$edit&&$type==='${this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'}'&&class_exists('\\Elementor\\Plugin')){try{$doc=\\Elementor\\Plugin::$instance->documents->get($id);$built=$doc&&(bool)$doc->is_built_with_elementor();}catch(\\Throwable $error){$doc=null;}}return ['pageId'=>$id,'runId'=>$run,'exists'=>$exists,'postType'=>$type,'status'=>$status,'ownerMatches'=>$owner,'canEdit'=>$edit,'uniqueRunPage'=>$unique,'documentExists'=>(bool)$doc,'builtWithElementor'=>(bool)$built];`) as OwnedReviewStatus;
    if (!value || value.pageId !== pageId || value.runId !== runId || ['exists', 'ownerMatches', 'canEdit', 'uniqueRunPage', 'documentExists', 'builtWithElementor'].some(key => typeof value[key as keyof OwnedReviewStatus] !== 'boolean') || [value.postType, value.status].some(item => item !== null && (typeof item !== 'string' || !/^[a-zA-Z\d_-]{1,80}$/.test(item))) || !value.exists && (value.postType !== null || value.status !== null || value.ownerMatches || value.canEdit || value.documentExists || value.builtWithElementor) || value.builtWithElementor && !value.documentExists || value.documentExists && (!value.ownerMatches || !value.canEdit || value.postType !== (this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'))) throw new WordPressError('invalid_review_status', 'Read-only review status returned inconsistent page identity.');
    return value;
  }
  /** Acknowledge exact reviewed output with one read, without draft creation or full discovery. */
  async readOwnedReviewCheckpoint(pageId: number, runId: string, widgetTypes: string[]): Promise<{ snapshot: DraftSnapshot; proof: import('./types.js').NativeCheckpointProof }> {
    if (!Number.isInteger(pageId) || pageId < 1 || !/^[A-Za-z\d_-]{4,100}$/.test(runId) || !widgetTypes.length || widgetTypes.some(type => !/^[A-Za-z\d_-]{1,80}$/.test(type))) throw new WordPressError('invalid_owned_identity', 'Reviewed checkpoint requires an explicit owned draft and native widget set.');
    this.metrics.documentReads++;
    const result = await this.php(`$id=${pageId};$run=${encodePHP(runId)};if(get_post_type($id)!=='${this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'}'||get_post_status($id)!=='draft'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)){throw new RuntimeException('owned_draft_guard');}$pages=get_posts(['post_type'=>'${this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'}','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($pages)!==1||(int)$pages[0]!==$id){throw new RuntimeException('ambiguous_run_pages');}$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc||!$doc->is_built_with_elementor()){throw new RuntimeException('document_missing');}${nativeCheckpointPHP(encodePHP([...new Set(widgetTypes)].sort()))}return ['snapshot'=>['pageId'=>$id,'runId'=>$run,'title'=>get_the_title($id),'status'=>get_post_status($id),'elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()],'proof'=>$checkpointProof];`) as { snapshot: Omit<DraftSnapshot, 'hash'>; proof: import('./types.js').NativeCheckpointProof };
    const elements = Array.isArray(result.snapshot.elements) ? result.snapshot.elements : [], settings = result.snapshot.settings && !Array.isArray(result.snapshot.settings) ? result.snapshot.settings : {}, snapshot = { ...result.snapshot, elements, settings, hash: hashDocument(elements, settings) };
    if (snapshot.pageId !== pageId || snapshot.runId !== runId || snapshot.status !== 'draft' || result.proof?.version !== 1 || !/^[a-f\d]{64}$/.test(result.proof.sha256) || canonical(result.proof.types) !== canonical([...new Set(widgetTypes)].sort())) throw new WordPressError('invalid_checkpoint', 'Owned reviewed checkpoint returned inconsistent document or environment identity.');
    this.ownedPages.set(pageId, runId); this.readSnapshotAttestations.add(`${pageId}:${runId}:${snapshot.hash}`); return { snapshot, proof: result.proof };
  }
  /** Published reads never acknowledge write ownership or create a draft
   * attestation. This is also the sole recovery path after a lost publish reply. */
  async readOwnedPublishedCheckpoint(pageId: number, runId: string, widgetTypes: string[]): Promise<OwnedPublishedCheckpoint> {
    if (!Number.isSafeInteger(pageId) || pageId < 1 || !/^[A-Za-z\d_-]{4,100}$/.test(runId) || !widgetTypes.length || widgetTypes.some(type => !/^[A-Za-z\d_-]{1,80}$/.test(type))) throw new WordPressError('invalid_owned_identity', 'Published checkpoint requires an exact page, run and native widget set.');
    widgetTypes.forEach(type=>this.assertNativeScope(type));
    this.metrics.documentReads++;
    const result = await this.php(`$ownedPublicationCheckpoint=true;$id=${pageId};$run=${encodePHP(runId)};if(get_post_type($id)!=='${this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'}'||get_post_status($id)!=='publish'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)){throw new RuntimeException('owned_published_guard');}$pages=get_posts(['post_type'=>'${this.ownedNativeProductDocuments.has(pageId)?'woodmart_layout':'page'}','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($pages)!==1||(int)$pages[0]!==$id){throw new RuntimeException('ambiguous_run_pages');}$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc||!$doc->is_built_with_elementor()){throw new RuntimeException('document_missing');}${nativeCheckpointPHP(encodePHP([...new Set(widgetTypes)].sort()))}return ['snapshot'=>['pageId'=>$id,'runId'=>$run,'title'=>get_the_title($id),'status'=>get_post_status($id),'elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()],'proof'=>$checkpointProof,'publicUrl'=>get_permalink($id)];`) as { snapshot: Omit<PublishedSnapshot, 'hash'>; proof: import('./types.js').NativeCheckpointProof; publicUrl: string };
    const value = result?.snapshot;
    if (!value || value.pageId !== pageId || value.runId !== runId || value.status !== 'publish' || typeof value.title !== 'string' || !Array.isArray(value.elements) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings) || result.proof?.version !== 1 || !/^[a-f\d]{64}$/.test(result.proof.sha256) || canonical(result.proof.types) !== canonical([...new Set(widgetTypes)].sort())) throw new WordPressError('invalid_published_checkpoint', 'Published checkpoint returned inconsistent document or environment identity.');
    let url: URL;
    try { if (typeof result.publicUrl !== 'string') throw Error(); url = new URL(result.publicUrl); } catch { throw new WordPressError('invalid_public_url', 'The published page has no safe configured-site public permalink.'); }
    if (url.origin !== this.origin || url.username || url.password || url.hash || /^\/(?:wp-admin|wp-login\.php|wp-json)(?:\/|$)/i.test(url.pathname) || [...url.searchParams].some(([key, item]) => !['p', 'page_id'].includes(key) || item !== String(pageId)) || [...url.searchParams.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) throw new WordPressError('invalid_public_url', 'The published permalink must be same-origin, public and free of credentials or access tokens.');
    return { snapshot: { ...value, hash: hashDocument(value.elements, value.settings) }, proof: result.proof, publicUrl: url.href };
  }
  /** One protected draft-to-publish transition. The upper transaction persists
   * the intent before calling this method. No response loss or mismatch triggers
   * a retry, document save, restore, unpublish or other compensating mutation. */
  async publishOwnedDraft(before: DraftSnapshot, intent: OwnedPublicationIntentProof): Promise<OwnedPublicationResult> {
    if (!this.native44 || before?.status !== 'draft' || this.ownedPages.get(before.pageId) !== before.runId || !this.readSnapshotAttestations.has(`${before.pageId}:${before.runId}:${before.hash}`) || hashDocument(before.elements, before.settings) !== before.hash) throw new WordPressError('publication_baseline_not_attested', 'Publication requires a fresh server-read owned native draft baseline.');
    if (!intent || Object.keys(intent).sort().join(',') !== 'beforeHash,durableIntentConfirmed,freeBytes,intentSha256,kind,operationId,version' || intent.version !== 1 || intent.kind !== 'owned-page-publication-intent' || !/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/.test(intent.operationId) || intent.operationId.includes('..') || !/^[a-f\d]{64}$/.test(intent.intentSha256) || intent.beforeHash !== before.hash || intent.durableIntentConfirmed !== true || !Number.isSafeInteger(intent.freeBytes) || intent.freeBytes < 512 * 1024 * 1024) throw new WordPressError('invalid_publication_intent', 'Publication requires the exact persisted intent and at least 512 MiB available for evidence.');
    if (Object.hasOwn(before.settings, 'post_status') && before.settings.post_status !== 'draft') throw new WordPressError('invalid_publication_baseline', 'The draft page settings contain an inconsistent post status.');
    const attempt = `${before.pageId}:${intent.operationId}`;
    if (this.publicationAttempts.has(attempt)) throw new WordPressError('publication_reconciliation_required', 'This publication was already attempted; read its published checkpoint before any further action.');
    const current = await this.snapshotDraft(before.pageId);
    if (current.hash !== before.hash || current.title !== before.title) throw new WordPressError('concurrent_document_change', 'The owned page changed before publication; the current document was preserved.');
    const types = new Set<string>();
    const visit = (nodes: ElementorElement[]) => { for (const node of nodes) { const type = node.elType === 'container' ? 'container' : node.widgetType; if (!type) throw new WordPressError('invalid_publication_baseline', 'Publication requires an explicit native element identity.'); this.assertNativeScope(type); types.add(type); visit(node.elements ?? []); } }; visit(before.elements);
    if (!types.size) throw new WordPressError('invalid_publication_baseline', 'An empty document cannot be published by the native page workflow.');
    const guard = this.ownedGuard(before.pageId), optimistic = this.expectedStateGuard(before.pageId, before);
    this.publicationAttempts.add(attempt); this.metrics.pagePublications++;
    await this.php(`$publishOwnedDraft=true;${guard}if(!$doc->is_built_with_elementor()||!current_user_can('publish_pages')){throw new RuntimeException('owned_publish_permission_guard');}$pages=get_posts(['post_type'=>'${this.ownedNativeProductDocuments.has(before.pageId)?'woodmart_layout':'page'}','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($pages)!==1||(int)$pages[0]!==$id){throw new RuntimeException('ambiguous_run_pages');}if(get_the_title($id)!==${encodePHP(before.title)}){throw new RuntimeException('concurrent_document_change');}${optimistic}$published=wp_update_post(['ID'=>$id,'post_status'=>'publish'],true);if(is_wp_error($published)||(int)$published!==$id||get_post_status($id)!=='publish'){throw new RuntimeException('page_publication_failed');}return ['published'=>true,'pageId'=>$id,'runId'=>$run];`);
    const after = await this.readOwnedPublishedCheckpoint(before.pageId, before.runId, [...types]);
    const settingsStatus = assertOwnedPublishedSnapshot(before, after.snapshot);
    this.readSnapshotAttestations.delete(`${before.pageId}:${before.runId}:${before.hash}`);
    return { ...after, settingsStatus };
  }
  /** Narrow isolation of source-absent Woodmart toolbar on an owned Canvas draft. */
  async configureCanvasShell(pageId: number, sourceAbsentToolbar: boolean, replicationProfile?: Native44Compiled['replicationProfile']): Promise<CanvasShellProof> {
    if (!sourceAbsentToolbar) return { enabled: false, pageId, reason: 'The source did not prove toolbar absence.' };
    const proof = await this.php(`${this.ownedGuard(pageId, false)}if(get_post_meta($id,'_wp_page_template',true)!=='elementor_canvas'||get_template()!=='woodmart'||!function_exists('woodmart_get_opt')||!woodmart_get_opt('sticky_toolbar')){return ['enabled'=>false,'pageId'=>$id,'reason'=>'The owned draft has no matching Woodmart Canvas toolbar.'];}$path=get_template_directory().'/css/parts/opt-bottom-toolbar.min.css';if(!is_file($path)){throw new RuntimeException('toolbar_source_missing');}$p=\\Elementor\\Plugin::$instance;$f=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$f->setAccessible(true);$o=$f->getValue();$f->setValue(null,false);$p->controls_manager->clear_stack_cache();try{$stack=$doc->get_stack();$controls=array_merge($stack['controls']??[],$stack['style_controls']??[]);$control=$controls['custom_css']??null;if(!$control||($control['type']??'')!=='code'){return ['enabled'=>false,'pageId'=>$id,'reason'=>'Native page custom CSS is not registered.'];}return ['enabled'=>true,'pageId'=>$id,'sourceCSS'=>file_get_contents($path),'cssSourceSha256'=>hash_file('sha256',$path),'control'=>array_intersect_key($control,array_flip(['type','default']))];}finally{$f->setValue(null,$o);$p->controls_manager->clear_stack_cache();}`) as CanvasShellProof & { sourceCSS?: string };
    if (proof.enabled) {
      proof.css = canvasShellCSS(pageId, proof.sourceCSS ?? '', replicationProfile);
      proof.sourceRule = '@media (max-width: 1024px) .sticky-toolbar-on padding-bottom:55px; .wd-toolbar hidden >=1025px';
      delete proof.sourceCSS;
      this.canvasShells.set(pageId, proof);
    }
    return proof;
  }
  async restoreDraft(pageId: number, snapshot: DraftSnapshot, options?: { expectedCurrent: DraftSnapshot; htmlProofs?: readonly GeneratedHtmlProof[] }): Promise<DraftSnapshot> {
    this.metrics.documentRestores++;
    if (snapshot.pageId !== pageId || snapshot.runId !== this.ownedPages.get(pageId) || snapshot.status !== 'draft') throw new WordPressError('invalid_snapshot', 'Snapshot ownership does not match this draft.');
    if (hashDocument(snapshot.elements, snapshot.settings) !== snapshot.hash) throw new WordPressError('invalid_snapshot', 'Snapshot contents do not match their hash.');
    const containsHTML = (nodes: ElementorElement[]): boolean => nodes.some(node => node.widgetType === 'html' || containsHTML(node.elements ?? []));
    if (containsHTML(snapshot.elements) && !this.readSnapshotAttestations.has(`${pageId}:${snapshot.runId}:${snapshot.hash}`)) {
      // A persisted journal snapshot must be recompiled from its accepted v2 inputs.
      // Its own JSON hash and run marker alone cannot authorize arbitrary HTML.
      try {
        const normalize = (nodes: ElementorElement[]): ElementorElement[] => nodes.map(node => ({ ...node, settings: Array.isArray(node.settings) && !node.settings.length ? {} : node.settings, elements: normalize(node.elements ?? []) }));
        this.validateLegacy(normalize(snapshot.elements), options?.htmlProofs);
      } catch { throw new WordPressError('html_widget_rejected', 'HTML restoration requires an exact server-read snapshot or current v2 compiler proof.'); }
    }
    const expected = options?.expectedCurrent;
    const optimisticGuard = expected ? this.expectedStateGuard(pageId, expected) : '';
    await this.php(`${this.ownedGuard(pageId)}${optimisticGuard}$input=${encodePHP({ elements: snapshot.elements, settings: snapshot.settings })};if(!$doc->save($input)){throw new RuntimeException('restore_failed');}return true;`);
    const restored = await this.readDraft(pageId);
    if (restored.hash !== snapshot.hash) throw new WordPressError('restore_hash_mismatch', 'The owned draft did not return to the saved snapshot.');
    return restored;
  }

  private async inspectStagedAsset(path: string, options: AssetImportOptions, digest: string): Promise<PendingAssetInspection> {
    const guard = this.ownedGuard(options.pageId);
    if (this.ownedPages.get(options.pageId) !== options.runId) throw new WordPressError('unowned_asset', 'Pending media must belong to the current owned draft.');
    const remotePath = stagingPath(path, options.runId, digest);
    const value = await this.php(`${guard}$pendingAssetInspection=true;$path=ABSPATH.${encodePHP(remotePath)};$expectedDigest=${encodePHP(digest)};$upload=realpath(wp_get_upload_dir()['basedir']);$candidates=get_posts(['post_type'=>'attachment','post_status'=>'inherit','post_parent'=>$id,'fields'=>'ids','numberposts'=>513]);if(count($candidates)>512){throw new RuntimeException('pending_asset_scan_limit');}$same=[];foreach($candidates as$a){$original=get_post_mime_type($a)==='font/ttf'?get_attached_file($a):(function_exists('wp_get_original_image_path')?wp_get_original_image_path($a):get_attached_file($a));$actual=$original?realpath($original):false;if($actual&&$upload&&str_starts_with($actual,$upload.DIRECTORY_SEPARATOR)&&is_file($actual)&&hash_file('sha256',$actual)===$expectedDigest){$same[]=(int)$a;}}if($same){return ['status'=>'attachment-present','sha256'=>$expectedDigest,'bytes'=>0,'attachmentIds'=>$same];}if(!file_exists($path)){return ['status'=>'absent','sha256'=>$expectedDigest,'bytes'=>0];}$root=realpath(ABSPATH.'wp-content/uploads/clonewp-import/'.$run);$real=realpath($path);if(!$real||!$root||!$upload||!str_starts_with($root,$upload.DIRECTORY_SEPARATOR)||dirname($real)!==$root||!is_file($real)||is_link($path)||hash_file('sha256',$real)!==$expectedDigest){throw new RuntimeException('pending_asset_identity_changed');}return ['status'=>'staged','sha256'=>$expectedDigest,'bytes'=>filesize($real)];`) as PendingAssetInspection;
    if (!value || !['staged', 'absent', 'attachment-present'].includes(value.status) || value.sha256 !== digest || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.status === 'attachment-present' && (!Array.isArray(value.attachmentIds) || !value.attachmentIds.length || value.attachmentIds.some(id => !Number.isInteger(id) || id < 1))) throw new WordPressError('invalid_pending_asset', 'Pending media inspection returned invalid identity.');
    return value;
  }

  /** Read-only inspection of the exact current-run upload path; no link, upload or registration. */
  async inspectPendingAsset(path: string, options: AssetImportOptions): Promise<PendingAssetInspection> {
    const file = await readFile(path), digest = sha256(file);
    if (!options.verifiedSha256 || options.verifiedSha256 !== digest) throw new WordPressError('asset_hash_mismatch', 'Pending media inspection requires verified exact local bytes.');
    const inspection = await this.inspectStagedAsset(path, options, digest);
    if (inspection.status === 'staged' && inspection.bytes !== file.length) throw new WordPressError('pending_asset_identity_changed', 'Pending media byte size changed.');
    return inspection;
  }

  async importAsset(path: string, options: RecoverableAssetImportOptions): Promise<ImportedAsset> {
    let checkpoint: AssetImportCheckpoint = { phase: 'lookup', remoteWriteStarted: false };
    const mark = async (phase: AssetImportCheckpoint['phase'], willWrite = false) => { const next = { phase, remoteWriteStarted: checkpoint.remoteWriteStarted || willWrite }; await options.onCheckpoint?.(next); checkpoint = next; };
    try { return await this.importAssetAttempt(path, options, mark); }
    catch (error) { if (error && typeof error === 'object') assetImportFailures.set(error, { ...checkpoint }); throw error; }
  }

  /** Exact source TTF bytes, no installation, global font registry or MIME filter. */
  async importSourceFont(path: string, options: RecoverableAssetImportOptions): Promise<ImportedAsset> {
    validateSourceFontBytes(await readFile(path), options.mimeType);
    if (!/\.ttf$/i.test(path) || !options.verifiedSha256) throw new WordPressError('invalid_source_font', 'Source fonts require a TTF file and exact frozen byte hash.');
    let checkpoint: AssetImportCheckpoint = { phase: 'lookup', remoteWriteStarted: false };
    const mark = async (phase: AssetImportCheckpoint['phase'], willWrite = false) => { const next = { phase, remoteWriteStarted: checkpoint.remoteWriteStarted || willWrite }; await options.onCheckpoint?.(next); checkpoint = next; };
    try { return await this.importAssetAttempt(path, options, mark, true); }
    catch (error) { if (error && typeof error === 'object') assetImportFailures.set(error, { ...checkpoint }); throw error; }
  }

  private async importAssetAttempt(path: string, options: RecoverableAssetImportOptions, mark: (phase: AssetImportCheckpoint['phase'], willWrite?: boolean) => Promise<void>, sourceFont = false): Promise<ImportedAsset> {
    this.metrics.mediaImportCalls++;
    const guard = this.ownedGuard(options.pageId);
    if (this.ownedPages.get(options.pageId) !== options.runId) throw new WordPressError('unowned_asset', 'Media must belong to the current owned draft.');
    const source = new URL(options.sourceUrl);
    const inline = source.protocol === 'data:' && /^data:image\/(png|jpeg|webp|gif|avif|svg\+xml)[;,]/i.test(options.sourceUrl);
    if ((!inline && !['http:', 'https:'].includes(source.protocol)) || source.username || source.password) throw new WordPressError('unsafe_media_url', 'Media must be a verified image URL or an inline image.');
    if (sourceFont ? options.mimeType !== 'font/ttf' : !/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(options.mimeType)) throw new WordPressError('unsupported_media_type', 'Only explicitly verified supported media may be imported.');
    const file = await readFile(path);
    if (!file.length || file.length > 20 * 1024 * 1024) throw new WordPressError('asset_size_limit', 'Media files must be between 1 byte and 20 MiB.');
    const digest = sha256(file);
    if (options.verifiedSha256 && options.verifiedSha256 !== digest) throw new WordPressError('asset_hash_mismatch', 'Local media differs from its verified download manifest.');
    if (inline) {
      const comma = options.sourceUrl.indexOf(',');
      const encoded = options.sourceUrl.slice(comma + 1);
      const original = /;base64$/i.test(options.sourceUrl.slice(0, comma)) ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded));
      if (!original.equals(file) && !(options.originalSha256 === sha256(original) && options.verifiedSha256 === digest)) throw new WordPressError('inline_asset_mismatch', 'Inline media bytes do not match the local file or its verified conversion provenance.');
    }
    const storedSourceUrl = inline ? `urn:clonewp:sha256:${digest}` : options.sourceUrl;
    // One bounded metadata reader is shared by cache hits and registration. Both paths
    // prove the attachment's page/run, source, digest and actual original bytes.
    const metadata=`$assetMetadata=static function($a)use($id,$run){$expectedDigest=${encodePHP(digest)};$expectedSource=${encodePHP(storedSourceUrl)};$media=get_post($a);if(!$media||$media->post_type!=='attachment'||(int)$media->post_parent!==$id||get_post_meta($a,'_clonewp_run_id',true)!==$run||get_post_meta($a,'_clonewp_sha256',true)!==$expectedDigest||get_post_meta($a,'_clonewp_source_url',true)!==$expectedSource||get_post_mime_type($a)!==${encodePHP(options.mimeType)}){throw new RuntimeException('owned_attachment_identity_changed');}$upload=realpath(wp_get_upload_dir()['basedir']);$file=get_post_mime_type($a)==='font/ttf'?get_attached_file($a):(function_exists('wp_get_original_image_path')?wp_get_original_image_path($a):get_attached_file($a));$real=$file?realpath($file):false;if(!$real||!$upload||!str_starts_with($real,$upload.DIRECTORY_SEPARATOR)||hash_file('sha256',$real)!==$expectedDigest){throw new RuntimeException('owned_attachment_bytes_changed');}$m=wp_get_attachment_metadata($a);$variants=[];foreach(array_keys($m['sizes']??[]) as $size){$src=wp_get_attachment_image_src($a,$size);if(is_array($src)&&!empty($src[0])){$variants[]=$src[0];}}if(!empty($m['original_image'])&&function_exists('wp_get_original_image_url')){$original=wp_get_original_image_url($a);if($original){$variants[]=$original;}}return ['attachmentId'=>(int)$a,'url'=>wp_get_attachment_url($a),'variants'=>array_values(array_unique($variants)),'width'=>$m['width']??null,'height'=>$m['height']??null,'mimeType'=>get_post_mime_type($a)];};`;
    await mark('lookup');
    let asset = await this.php(`${guard}${metadata}$ids=get_posts(['post_type'=>'attachment','post_status'=>'inherit','post_parent'=>$id,'fields'=>'ids','numberposts'=>1,'meta_query'=>[['key'=>'_clonewp_run_id','value'=>$run],['key'=>'_clonewp_sha256','value'=>${encodePHP(digest)}],['key'=>'_clonewp_source_url','value'=>${encodePHP(storedSourceUrl)}]]]);return $ids?$assetMetadata((int)$ids[0]):null;`);
    if(asset===null&&options.requireExisting)throw new WordPressError('existing_asset_required','The exact current-run attachment was not found; no media was uploaded or registered.');
    if (asset===null) {
      const remotePath = stagingPath(path, options.runId, digest);
      if (options.recoverPendingUpload) {
        const inspection = await this.inspectStagedAsset(path, options, digest);
        if (inspection.status !== 'staged' || inspection.bytes !== file.length) throw new WordPressError('pending_asset_absent', 'The exact owned staged media is absent; recovery did not upload or register anything.');
      } else {
      await mark('upload-link');
      const link = await this.execute('novamira/create-upload-link', { path: remotePath, overwrite: false, create_directories: true }) as { upload_url: string; upload_token: string; token_header: string };
      if (!link.upload_url || !link.upload_token || !/^x-[a-z0-9-]+$/i.test(link.token_header)) throw new WordPressError('invalid_upload_link', 'Novamira returned an invalid upload endpoint.');
      const url = new URL(link.upload_url);
      if (url.origin !== this.origin) throw new WordPressError('cross_origin_blocked', 'Novamira upload endpoint must remain on the configured WordPress origin.');
      await mark('uploading', true); this.metrics.mediaUploadBytes += file.length;
      const response = await this.authenticatedFetch(url, { method: 'PUT', headers: { [link.token_header]: link.upload_token, 'Content-Type': options.mimeType }, body: file as unknown as BodyInit });
      if (!response.ok) throw new WordPressError('media_upload_failed', 'Novamira could not write the media file.', response.status);
      await response.json(); // Registration uses the known path, never server supplied paths.
      await mark('uploaded');
      }
      await mark('registering', true);
      asset = await this.php(`${guard}${metadata}require_once ABSPATH.'wp-admin/includes/file.php';require_once ABSPATH.'wp-admin/includes/media.php';require_once ABSPATH.'wp-admin/includes/image.php';$path=ABSPATH.${encodePHP(remotePath)};if(!is_file($path)||hash_file('sha256',$path)!==${encodePHP(digest)}){throw new RuntimeException('uploaded_asset_hash_mismatch');}$root=realpath(ABSPATH.'wp-content/uploads/clonewp-import/'.$run);$real=realpath($path);if(!$root||!$real||dirname($real)!==$root||is_link($path)){throw new RuntimeException('pending_asset_identity_changed');}$handle=fopen($path,'rb');if(!$handle||!flock($handle,LOCK_EX|LOCK_NB)){throw new RuntimeException('media_registration_in_progress');}try{${sourceFont ? `$attachmentId=wp_insert_attachment(['post_parent'=>$id,'post_status'=>'inherit','post_title'=>${encodePHP(options.alt ?? basename(path))},'post_mime_type'=>'font/ttf','meta_input'=>['_clonewp_run_id'=>$run,'_clonewp_sha256'=>${encodePHP(digest)},'_clonewp_source_url'=>${encodePHP(storedSourceUrl)}]],$path,$id,true);` : `$attachmentId=media_handle_sideload(['name'=>${encodePHP(basename(path))},'tmp_name'=>$path],$id,null,['meta_input'=>['_clonewp_run_id'=>$run,'_clonewp_sha256'=>${encodePHP(digest)},'_clonewp_source_url'=>${encodePHP(storedSourceUrl)},'_wp_attachment_image_alt'=>${encodePHP(options.alt ?? '')}]]);`}if(is_wp_error($attachmentId)){throw new RuntimeException('media_registration_failed');}return $assetMetadata((int)$attachmentId);}finally{flock($handle,LOCK_UN);fclose($handle);}`);
    }
    if(!asset||typeof asset!=='object'||Array.isArray(asset))throw new WordPressError('invalid_attachment','WordPress did not return registered attachment metadata.');
    const registered=asset as Record<string,unknown>;
    if(!Number.isInteger(registered.attachmentId)||Number(registered.attachmentId)<1||typeof registered.url!=='string'||registered.mimeType!==options.mimeType||registered.variants!==undefined&&!Array.isArray(registered.variants)||['width','height'].some(key=>registered[key]!==null&&registered[key]!==undefined&&(typeof registered[key]!=='number'||!Number.isFinite(registered[key])||Number(registered[key])<1)))throw new WordPressError('invalid_attachment','WordPress returned invalid registered attachment metadata.');
    let attachmentURL:URL;try{attachmentURL=new URL(registered.url);}catch{throw new WordPressError('invalid_attachment','WordPress returned an invalid registered media URL.');}
    if (attachmentURL.origin !== this.origin||attachmentURL.username||attachmentURL.password) throw new WordPressError('remote_attachment_url', 'Registered media URLs must belong to the configured WordPress site.');
    const variants = ((registered.variants??[]) as unknown[]).filter((url):url is string => {
      if(typeof url!=='string')return false;
      try { const resolved = new URL(url); return resolved.origin === this.origin && !resolved.username && !resolved.password && ['http:', 'https:'].includes(resolved.protocol); }
      catch { return false; }
    });
    await mark('complete');
    return {attachmentId:Number(registered.attachmentId),url:registered.url,mimeType:options.mimeType,...(typeof registered.width==='number'?{width:registered.width}:{}),...(typeof registered.height==='number'?{height:registered.height}:{}),variants: [...new Set(variants)], sourceUrl: options.sourceUrl, sha256: digest };
  }

  async verifyImportedAssets(pageId: number, assets: ImportedAsset[]): Promise<void> {
    const guard = this.ownedGuard(pageId, false);
    if (assets.length > 100) throw new WordPressError('asset_count_limit', 'Owned media verification is bounded to 100 records.');
    for (const asset of assets) {
      const url = new URL(asset.url);
      if (!Number.isInteger(asset.attachmentId) || asset.attachmentId <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256) || url.origin !== this.origin || url.username || url.password) throw new WordPressError('invalid_cached_media', 'Cached media must retain verified own-site identity and hashes.');
    }
    const expected = assets.map(asset => ({ id: asset.attachmentId, sha256: asset.sha256, url: asset.url }));
    const verified = await this.php(`${guard}$expected=${encodePHP(expected)};$upload=realpath(wp_get_upload_dir()['basedir']);foreach($expected as $a){$media=get_post($a['id']);if(!$media||$media->post_type!=='attachment'||(int)$media->post_parent!==$id||get_post_meta($a['id'],'_clonewp_run_id',true)!==$run||get_post_meta($a['id'],'_clonewp_sha256',true)!==$a['sha256']||wp_get_attachment_url($a['id'])!==$a['url']){throw new RuntimeException('cached_media_identity_changed');}$file=get_post_mime_type($a['id'])==='font/ttf'?get_attached_file($a['id']):(function_exists('wp_get_original_image_path')?wp_get_original_image_path($a['id']):get_attached_file($a['id']));$real=$file?realpath($file):false;if(!$real||!$upload||!str_starts_with($real,$upload.DIRECTORY_SEPARATOR)||hash_file('sha256',$real)!==$a['sha256']){throw new RuntimeException('cached_media_bytes_changed');}}return true;`);
    if (verified !== true) throw new WordPressError('cached_media_verification_failed', 'Owned media proof did not return success.');
  }

  /** Inspect an attachment that already exists after sanitation or response loss.
   * Exact-byte import remains strict; this read never uploads, registers again,
   * changes metadata, or assumes an unknown server transformation is acceptable. */
  async reconcileOwnedMediaTransformation(input: {
    contract: Omit<MediaTransformationContract, 'stored'>; attachmentId: number;
    submittedPath: string; originalPath?: string; policies?: readonly MediaTransformationPolicy[];
  }) {
    const contract = MediaTransformationContractSchema.parse(input.contract);
    if (contract.stored || !Number.isSafeInteger(input.attachmentId) || input.attachmentId < 1 || this.ownedPages.get(contract.owner.pageId) !== contract.owner.runId) throw new WordPressError('invalid_media_reconciliation', 'Media reconciliation requires the exact existing owned draft and attachment.');
    const submitted = fingerprintMediaTransformationBytes(await readFile(input.submittedPath), contract.submitted.mimeType);
    const original = input.originalPath ? fingerprintMediaTransformationBytes(await readFile(input.originalPath), contract.original.mimeType) : submitted;
    if (canonical(submitted) !== canonical(contract.submitted) || canonical(original) !== canonical(contract.original)) throw new WordPressError('media_reconciliation_local_bytes_changed', 'Original and submitted bytes must match the local transformation contract.');
    const preliminary = reconcileMediaTransformation(contract, { policies: input.policies });
    if (preliminary.status === 'blocked' || preliminary.nextAction === 'verify-local-conversion') return preliminary;
    const stored = await this.php(`${this.ownedGuard(contract.owner.pageId, false)}$mediaTransformationRead=true;$a=${input.attachmentId};$p=get_post($a);if(!$p||$p->post_type!=='attachment'||(int)$p->post_parent!==$id||get_post_meta($a,'_clonewp_run_id',true)!==$run||get_post_meta($a,'_clonewp_sha256',true)!==${encodePHP(contract.submitted.sha256)}){throw new RuntimeException('owned_attachment_identity_changed');}$upload=realpath(wp_get_upload_dir()['basedir']);$file=function_exists('wp_get_original_image_path')?wp_get_original_image_path($a):get_attached_file($a);$real=$file?realpath($file):false;if(!$real||!$upload||!str_starts_with($real,$upload.DIRECTORY_SEPARATOR)||is_link($file)){throw new RuntimeException('owned_attachment_path_changed');}return ['owner'=>['pageId'=>$id,'runId'=>$run],'operationId'=>${encodePHP(contract.operationId)},'attachmentId'=>(int)$a,'observedAt'=>gmdate('Y-m-d\\TH:i:s\\Z'),'actual'=>['sha256'=>hash_file('sha256',$real),'bytes'=>filesize($real),'mimeType'=>get_post_mime_type($a)]];`);
    if (!stored || typeof stored !== 'object' || (stored as Record<string, unknown>).attachmentId !== input.attachmentId) throw new WordPressError('media_reconciliation_attachment_conflict', 'Media readback identifies a different existing attachment.');
    return reconcileMediaTransformation({ ...contract, stored }, { policies: input.policies });
  }

  async readCurrentProductPreview(pageId:number,runId:string,selection:CurrentProductSelection):Promise<{id:number;productId:number;html:string;existingUnchanged:boolean}> {
    currentProductSelectionSchema.parse(selection);await this.readCurrentProductRuntime(pageId,runId,selection.productId,selection.contextKey);
    const result=decodeCapabilityPayload(await this.php(nativeProductPreviewPHP(pageId,runId,selection.productId,selection.contextKey))) as {id:number;productId:number;html:string;existingUnchanged:boolean};
    if(result.id!==pageId||result.productId!==selection.productId||!result.existingUnchanged||typeof result.html!=='string'||!result.html.includes('<!doctype html>'))throw Error('native_product_preview_unconfirmed');return result;
  }

  async getPreviewAccess(pageId: number): Promise<PreviewAccess> {
    if(this.ownedNativeProductDocuments.has(pageId))return await this.php(`${this.ownedGuard(pageId,false)}return ['previewUrl'=>$doc->get_preview_url(),'editUrl'=>$doc->get_edit_url()];`) as PreviewAccess;
    const result = await this.php(`${this.ownedGuard(pageId, false)}return ['previewUrl'=>get_preview_post_link($id),'editUrl'=>$doc->get_edit_url()];`) as PreviewAccess;
    let ownedPreview: URL | undefined;
    if (this.native44) {
      try { ownedPreview = new URL(result.previewUrl); } catch { throw new WordPressError('invalid_preview_redirect', 'Owned frontend preview URL is unavailable.'); }
      if (ownedPreview.origin !== this.origin || ownedPreview.username || ownedPreview.password || ownedPreview.hash || /^\/wp-admin(?:\/|$)/.test(ownedPreview.pathname)) throw new WordPressError('invalid_preview_redirect', 'Native44 preview authentication must land on the owned same-origin frontend.');
    }
    if (this.abilities.has('novamira/create-admin-access-link')) {
      const info = await this.abilityInfo('novamira/create-admin-access-link');
      const properties = (info.input_schema?.properties ?? {}) as Record<string, unknown>;
      const params: Record<string, unknown> = {};
      if (this.native44 && !('admin_path' in properties)) throw new WordPressError('invalid_preview_redirect', 'Native44 preview authentication requires an explicit owned frontend redirect contract.');
      if ('admin_path' in properties) params.admin_path = ownedPreview ? `..${ownedPreview.pathname}${ownedPreview.search}` : `post.php?post=${pageId}&action=elementor`;
      if ('session_expires_in' in properties) params.session_expires_in = 1800;
      const link = await this.execute('novamira/create-admin-access-link', params) as Record<string, unknown>;
      if (ownedPreview) {
        let redirected: URL | undefined;
        try { if (typeof link.redirect_url === 'string') redirected = new URL(link.redirect_url, this.origin); } catch { /* Reject below without exposing an auth URL. */ }
        if (redirected?.href !== ownedPreview.href) throw new WordPressError('invalid_preview_redirect', 'Native44 browser authentication did not preserve its owned frontend redirect.');
      }
      let candidate = link.url ?? link.access_url ?? link.login_url;
      if (typeof link.exchange_url === 'string' && typeof link.access_token === 'string' && typeof link.access_nonce === 'string' && typeof link.token_header === 'string' && typeof link.nonce_header === 'string') {
        const exchange = new URL(link.exchange_url);
        if (exchange.origin !== this.origin || !/^x-[a-z0-9-]+$/i.test(link.token_header) || !/^x-[a-z0-9-]+$/i.test(link.nonce_header)) throw new WordPressError('invalid_admin_exchange', 'Admin session exchange must remain on the configured site.');
        const response = await this.authenticatedFetch(exchange, { method: 'POST', headers: { [link.token_header]: link.access_token, [link.nonce_header]: link.access_nonce } });
        if (!response.ok) throw new WordPressError('admin_exchange_failed', 'Could not exchange the one-time browser admin session.', response.status);
        const exchangeResult = await response.json() as Record<string, unknown>;
        candidate = exchangeResult.login_url;
      }
      if (typeof candidate === 'string' && new URL(candidate).origin === this.origin) result.adminAccessUrl = candidate;
    }
    return result;
  }

  async verifyEditable(pageId: number, htmlProofs?: readonly GeneratedHtmlProof[]): Promise<{ editable: boolean; elementCount: number; status: string }> {
    if (htmlProofs?.length) {
      const snapshot = await this.readDraft(pageId);
      const normalize = (nodes: ElementorElement[]): ElementorElement[] => nodes.map(node => ({ ...node, settings: Array.isArray(node.settings) && !node.settings.length ? {} : node.settings, elements: normalize(node.elements ?? []) }));
      this.validateLegacy(normalize(snapshot.elements), htmlProofs);
      const approved = htmlProofs.map(proof => ({ id: proof.elementId, sha256: proof.sha256 }));
      return await this.php(`${this.ownedGuard(pageId, false)}$approved=${encodePHP(approved)};$proofs=[];foreach($approved as$p){$proofs[$p['id']]=$p['sha256'];}$tree=$doc->get_elements_data();$count=0;$walk=function($nodes)use(&$walk,&$count,$proofs){foreach($nodes as$node){$count++;if(($node['widgetType']??'')==='html'&&(!isset($proofs[$node['id']])||hash('sha256',(string)($node['settings']['html']??''))!==$proofs[$node['id']])){throw new RuntimeException('html_widget_rejected');}$walk($node['elements']??[]);}};$walk(is_array($tree)?$tree:[]);return ['editable'=>$doc->is_built_with_elementor()&&$doc->is_editable_by_current_user(),'elementCount'=>$count,'status'=>get_post_status($id)];`) as { editable: boolean; elementCount: number; status: string };
    }
    return await this.php(`${this.ownedGuard(pageId, false)}$tree=$doc->get_elements_data();$count=0;$walk=function($nodes)use(&$walk,&$count){foreach($nodes as $node){$count++;if(($node['widgetType']??'')==='html'){throw new RuntimeException('html_widget_rejected');}$walk($node['elements']??[]);}};$walk(is_array($tree)?$tree:[]);return ['editable'=>$doc->is_built_with_elementor()&&$doc->is_editable_by_current_user(),'elementCount'=>$count,'status'=>get_post_status($id)];`) as { editable: boolean; elementCount: number; status: string };
  }

  /** Read-only ownership check for recovering an explicitly identified failed run. */
  async inspectOwnedDraft(pageId: number, runId: string): Promise<{ pageId: number; exists: boolean; markerMatches: boolean; status: string | false; treeEmpty: boolean; attachmentIds: number[] }> {
    if (!Number.isInteger(pageId) || pageId < 1 || !/^[a-zA-Z0-9_-]{4,100}$/.test(runId)) throw new WordPressError('invalid_owned_identity', 'A valid page ID and run identity are required.');
    return await this.php(`$id=${pageId};$run=${encodePHP(runId)};$isPage=get_post_type($id)==='page';$matches=$isPage&&get_post_meta($id,'_clonewp_run_id',true)===$run;$doc=$isPage?\\Elementor\\Plugin::$instance->documents->get($id):null;$tree=$doc?$doc->get_elements_data():null;$assets=$matches?get_posts(['post_type'=>'attachment','post_status'=>'inherit','fields'=>'ids','numberposts'=>-1,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]):[];return ['pageId'=>$id,'exists'=>$isPage,'markerMatches'=>$matches,'status'=>get_post_status($id),'treeEmpty'=>is_array($tree)&&count($tree)===0,'attachmentIds'=>array_map('intval',$assets)];`) as { pageId: number; exists: boolean; markerMatches: boolean; status: string | false; treeEmpty: boolean; attachmentIds: number[] };
  }

  async deleteOwnedDraft(pageId: number, deleteMedia = true): Promise<void> {
    await this.php(`${this.ownedGuard(pageId)}${deleteMedia ? "$assets=get_posts(['post_type'=>'attachment','post_status'=>'inherit','fields'=>'ids','numberposts'=>-1,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);foreach($assets as $a){wp_delete_attachment($a,true);}" : ''}if(!wp_delete_post($id,true)){throw new RuntimeException('draft_delete_failed');}return true;`);
    this.ownedPages.delete(pageId);
  }

  async close(): Promise<void> {if(this.sharedConnection)return;try{await this.transport.close();}finally{await this.network?.close();}}
}

export { WordPressError } from './errors.js';
export * from './types.js';


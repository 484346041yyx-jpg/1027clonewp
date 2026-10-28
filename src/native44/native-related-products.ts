import { createHash } from 'node:crypto';
import { normalizeRelatedProductsQuery, parseRelatedProductsSnapshot, relatedProductsQueryKey, type RelatedProductsQueryInput, type RelatedProductsSnapshot } from '../wordpress/related-products.js';
import { currentProductSelectionSchema, type CurrentProductSelection } from './current-product.js';
import type { LegacySchema } from '../wordpress/types.js';
import { validateRegisteredSettings } from '../planning/plan.js';
import { expandedNative44Controls } from './settings.js';
import { assertNativeRelatedProductQualification, NATIVE_RELATED_PRODUCT_CLASS, NATIVE_RELATED_PRODUCT_TYPE, type NativeRelatedProductQualification } from './related-product-extension.js';

export interface RelatedProductsReader { readTargetRelatedProducts(productId: number, query: RelatedProductsQueryInput): Promise<RelatedProductsSnapshot> }
export interface RelatedProductsProvider {
  readonly provider: 'target-woocommerce-related-v1'; readonly contextKey: string;
  readonly currentProductId: number; readonly targetOrigin: string; readonly readAt: string; readonly queryKey: string;
}
const observations = new WeakMap<RelatedProductsProvider, { snapshot: RelatedProductsSnapshot; digest: string }>();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A fresh current-process reader, not persisted JSON, creates the handle. */
export async function readRelatedProductsProvider(reader: RelatedProductsReader, selectionInput: CurrentProductSelection, queryInput: RelatedProductsQueryInput, origin: string): Promise<RelatedProductsProvider> {
  const selection = currentProductSelectionSchema.parse(selectionInput), query = normalizeRelatedProductsQuery(queryInput);
  if (query.contextKey !== selection.contextKey) throw Error('related_products_context_mismatch');
  const snapshot = parseRelatedProductsSnapshot(await reader.readTargetRelatedProducts(selection.productId, query), origin, selection.productId, query);
  const provider: RelatedProductsProvider = Object.freeze({ provider: 'target-woocommerce-related-v1', contextKey: selection.contextKey, currentProductId: selection.productId, targetOrigin: snapshot.targetOrigin, readAt: snapshot.readAt, queryKey: relatedProductsQueryKey(query) });
  observations.set(provider, { snapshot: structuredClone(snapshot), digest: digest(provider) });
  return provider;
}
export function relatedProductsObservation(provider: RelatedProductsProvider, selectionInput: CurrentProductSelection, queryInput: RelatedProductsQueryInput, origin: string): RelatedProductsSnapshot {
  const selection = currentProductSelectionSchema.parse(selectionInput), query = normalizeRelatedProductsQuery(queryInput), proof = observations.get(provider);
  if (!proof || proof.digest !== digest(provider) || provider.currentProductId !== selection.productId || provider.contextKey !== selection.contextKey || query.contextKey !== selection.contextKey || provider.targetOrigin !== new URL(origin).origin || provider.queryKey !== relatedProductsQueryKey(query)) throw Error('related_products_provider_identity_mismatch');
  const age = Date.now() - Date.parse(proof.snapshot.readAt);
  if (age < -60000 || age > 15 * 60 * 1000) throw Error('related_products_provider_stale');
  return structuredClone(proof.snapshot);
}

/**
 * wd_products does not have a related Data source in the current frozen local
 * declaration. query_type is its OR/AND taxonomy operator, not a data source.
 * Keep this explicit guard until a separate native related widget qualifies.
 */
export function assertNativeRelatedProductsQueryControls(schema: LegacySchema, localPostTypes: ReadonlySet<string>): void {
  if (schema.type !== 'wd_products' || !schema.controls?.post_type || !Object.hasOwn(schema.controls.post_type.options ?? {}, 'related') || !localPostTypes.has('related')) throw Error('native_related_products_runtime_adapter_unqualified');
}

export interface NativeRelatedProductNode {
  key: string; widgetType: string; widgetSettings: Record<string, unknown>; sourceFactIds?: string[];
  children?: unknown[]; resources?: unknown[];
  model?: { data?: { source: string; recordType?: string; contextKey?: string; field?: string; evidenceFactIds?: string[] } };
}
export interface NativeRelatedProductBinding {
  componentKey: string; widgetType: typeof NATIVE_RELATED_PRODUCT_TYPE; settings: Record<string, unknown>;
  provider: 'target-woocommerce-related-v1'; contextKey: string; productId: number; targetOrigin: string; observedAt: string;
  field: 'related-products'; reads: readonly string[]; actions: readonly string[]; dependencies: readonly string[];
  nativeDataOwner: 'current-woocommerce-related-products'; runtimeContextRequired: true; renderedVerified: false;
  /** Audit only; these IDs are never copied into widget settings. */
  observedRelatedProductIds: number[];
}

/** The real Elementor widget owns the live WooCommerce query on each request. */
export function adaptNativeRelatedProductComponent(node: NativeRelatedProductNode, options: {
  provider: RelatedProductsProvider; selection: CurrentProductSelection; query: RelatedProductsQueryInput;
  targetOrigin: string; schema: LegacySchema; qualification: NativeRelatedProductQualification;
}): NativeRelatedProductBinding {
  const component = assertNativeRelatedProductQualification(options.qualification, options.targetOrigin);
  const data = node.model?.data, selection = currentProductSelectionSchema.parse(options.selection), query = normalizeRelatedProductsQuery(options.query);
  if (node.widgetType !== NATIVE_RELATED_PRODUCT_TYPE || options.schema.type !== node.widgetType || options.schema.class !== NATIVE_RELATED_PRODUCT_CLASS || data?.source !== 'current-record' || data.recordType !== 'product' || data.contextKey !== selection.contextKey || data.field !== 'related-products' || !data.evidenceFactIds?.length || data.evidenceFactIds.some(id => !node.sourceFactIds?.includes(id)) || node.children?.length || node.resources?.length || query.excludeIds.length) throw Error(`native_related_product_binding_mismatch: ${node.key}`);
  const observation = relatedProductsObservation(options.provider, selection, query, options.targetOrigin);
  const settings = structuredClone(node.widgetSettings), controls = expandedNative44Controls(component.controls);
  for (const name of ['product_id', 'include', 'ids', 'query_post_type', 'query_posts_ids', 'post_type', '__dynamic__', 'related_products']) if (Object.hasOwn(settings, name)) throw Error(`native_related_product_query_override: ${node.key}/${name}`);
  for (const name of Object.keys(settings)) if (!controls.has(name) || !options.schema.controls[name]) throw Error(`native_related_product_control_unverified: ${node.key}/${name}`);
  validateRegisteredSettings(node.widgetType, settings, options.schema, { allowedMedia: [] });
  const count = Number(settings.posts_per_page ?? options.schema.controls.posts_per_page?.default ?? 4);
  if (!Number.isInteger(count) || count < 1 || count > 20 || count !== query.limit) throw Error(`native_related_product_limit_mismatch: ${node.key}`);
  return { componentKey: node.key, widgetType: NATIVE_RELATED_PRODUCT_TYPE, settings, provider: observation.provider, contextKey: selection.contextKey, productId: selection.productId, targetOrigin: observation.targetOrigin, observedAt: observation.readAt, field: 'related-products', reads: ['categories', 'tags', 'upsellIds', 'related-products'], actions: [], dependencies: ['current-product', 'native-woocommerce-related-query', 'native-woocommerce-related-template'], nativeDataOwner: 'current-woocommerce-related-products', runtimeContextRequired: true, renderedVerified: false, observedRelatedProductIds: observation.products.map(p => p.id) };
}

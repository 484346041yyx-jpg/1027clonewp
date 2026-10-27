import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseTargetProductSnapshot, targetProductId, type TargetProductSnapshot } from '../wordpress/product-contract.js';
import { validateRegisteredSettings } from '../planning/plan.js';
import type { LegacySchema } from '../wordpress/types.js';
import type { Native44Native, Native44Program } from './types.js';
import { walkNative44 } from './types.js';
import { assertProductRuntimeCapability, type ProductRuntimeCapability } from '../wordpress/current-product-runtime.js';

/** A target selection, never a source example ID, record mutation or display default. */
export const currentProductSelectionSchema = z.object({ recordType: z.literal('product'), contextKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/), productId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export type CurrentProductSelection = z.infer<typeof currentProductSelectionSchema>;
export interface CurrentProductReader { readTargetProduct(productId: number): Promise<TargetProductSnapshot> }
export interface CurrentProductProvider { readonly provider: 'target-woocommerce-product-v1'; readonly contextKey: string; readonly productId: number; readonly targetOrigin: string; readonly readAt: string }
const observations = new WeakMap<CurrentProductProvider, { snapshot: TargetProductSnapshot; digest: string }>();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Only a current-process bounded read mints this handle. Persisted snapshots are comparison evidence. */
export async function readCurrentProductProvider(reader: CurrentProductReader, input: CurrentProductSelection, origin: string): Promise<CurrentProductProvider> {
  const selection = currentProductSelectionSchema.parse(input), productId = targetProductId(selection.productId);
  const snapshot = parseTargetProductSnapshot(await reader.readTargetProduct(productId), origin, productId);
  const handle: CurrentProductProvider = Object.freeze({ provider: 'target-woocommerce-product-v1', contextKey: selection.contextKey, productId, targetOrigin: snapshot.targetOrigin, readAt: snapshot.readAt });
  observations.set(handle, { snapshot: structuredClone(snapshot), digest: digest(handle) }); return handle;
}
export function currentProductObservation(provider: CurrentProductProvider, selection: CurrentProductSelection, origin: string): TargetProductSnapshot {
  const proof = observations.get(provider), expected = currentProductSelectionSchema.parse(selection);
  if (!proof || proof.digest !== digest(provider) || provider.contextKey !== expected.contextKey || provider.productId !== expected.productId || provider.targetOrigin !== new URL(origin).origin) throw Error('current_product_provider_identity_mismatch');
  const age = Date.now() - Date.parse(proof.snapshot.readAt);
  if (age < -60000 || age > 15 * 60 * 1000) throw Error('current_product_provider_stale');
  return structuredClone(proof.snapshot);
}

/** Source-backed native field ownership, independent of permission to generate the widget. */
export const CORE_PRODUCT_ADAPTERS = {
  wd_single_product_gallery: { field: 'media', reads: ['media', 'variations'], actions: ['gallery'], dependencies: ['current-product', 'native-gallery-scripts'] },
  wd_single_product_title: { field: 'title', reads: ['name'], actions: [], dependencies: ['current-product'] },
  wd_single_product_rating: { field: 'rating', reads: ['reviews'], actions: [], dependencies: ['current-product', 'native-rating-settings'] },
  wd_single_product_short_description: { field: 'short-description', reads: ['shortDescription'], actions: [], dependencies: ['current-product'] },
  wd_single_product_price: { field: 'price', reads: ['price', 'variations'], actions: [], dependencies: ['current-product', 'native-currency-tax-price-filters'] },
  wd_single_product_add_to_cart: { field: 'purchase', reads: ['type', 'stock', 'variations', 'attributes', 'defaultAttributes', 'soldIndividually'], actions: ['selection', 'purchase'], dependencies: ['current-product', 'native-cart-session', 'native-variation-scripts'] },
  wd_single_product_meta: { field: 'meta', reads: ['sku', 'categories', 'tags'], actions: [], dependencies: ['current-product'] },
  wd_single_product_content: { field: 'content', reads: ['description'], actions: [], dependencies: ['current-product', 'native-content-renderer'] },
  wd_single_product_additional_info_table: { field: 'attributes', reads: ['attributes'], actions: [], dependencies: ['current-product', 'native-product-attributes'] },
  wd_single_product_tabs: { field: 'content', reads: ['description', 'attributes', 'reviews'], actions: ['disclosure', 'reviews'], dependencies: ['current-product', 'native-product-tabs-filters', 'native-review-service'] },
  wd_single_product_reviews: { field: 'reviews', reads: ['reviews'], actions: ['reviews'], dependencies: ['current-product', 'native-review-service'] },
  wd_wc_notices: { field: 'notices', reads: [], actions: [], dependencies: ['current-product', 'native-cart-session', 'native-notice-service'] },
} as const;
export type CoreProductWidget = keyof typeof CORE_PRODUCT_ADAPTERS;
export function coreProductAdapter(type: string) { return Object.hasOwn(CORE_PRODUCT_ADAPTERS, type) ? CORE_PRODUCT_ADAPTERS[type as CoreProductWidget] : undefined; }
export interface CoreProductBinding {
  componentKey: string; widgetType: CoreProductWidget; settings: Record<string, unknown>;
  provider: 'target-woocommerce-product-v1'; contextKey: string; productId: number; targetOrigin: string; observedAt: string;
  field: string; reads: readonly string[]; actions: readonly string[]; dependencies: readonly string[];
  /** The real WooCommerce provider renders every field. Snapshot values are never copied to settings. */
  nativeDataOwner: 'current-woocommerce-product'; runtimeContextRequired: true; renderedVerified: false;
}
export function adaptCoreProductComponent(node: Native44Native, options: { provider: CurrentProductProvider; selection: CurrentProductSelection; targetOrigin: string; schema: LegacySchema; localControls: ReadonlySet<string> }): CoreProductBinding {
  const adapter = coreProductAdapter(node.widgetType), binding = node.model?.data;
  if (!adapter || binding?.source !== 'current-record' || binding.recordType !== 'product' || binding.contextKey !== options.selection.contextKey || binding.field !== adapter.field || !binding.evidenceFactIds.length || binding.evidenceFactIds.some(id => !node.sourceFactIds?.includes(id))) throw Error(`core_product_binding_mismatch: ${node.key}`);
  const observation = currentProductObservation(options.provider, options.selection, options.targetOrigin);
  const settings = structuredClone(node.widgetSettings);
  // Main::setup_preview returns early on ordinary page posts. A product_id is
  // neither a current-product runtime nor authority to change global product data.
  if (Object.hasOwn(settings, 'product_id') || Object.hasOwn(settings, '__dynamic__') || node.children?.length || node.resources?.length) throw Error(`core_product_explicit_provider_override: ${node.key}`);
  if (!options.schema || options.schema.type !== node.widgetType || !options.schema.class || !options.schema.controls) throw Error(`core_product_registered_contract_missing: ${node.key}`);
  for (const field of Object.keys(settings)) if (!options.localControls.has(field) || !options.schema.controls[field]) throw Error(`core_product_control_unverified: ${node.key}/${field}`);
  validateRegisteredSettings(node.widgetType, settings, options.schema, { allowedMedia: [] });
  const actions = [...adapter.actions] as string[];
  if (node.widgetType === 'wd_single_product_add_to_cart' && observation.product.type === 'simple') actions.splice(actions.indexOf('selection'), 1);
  if (node.widgetType === 'wd_single_product_tabs') {
    // Source render defaults enable reviews; an explicit registered 'no' disables
    // that owner. Do not reproduce the sample's duplicate review forms.
    const reviews = settings.enable_reviews ?? options.schema.controls.enable_reviews?.default ?? 'yes';
    if (reviews !== 'yes') actions.splice(actions.indexOf('reviews'), 1);
  }
  for (const action of node.model?.interactions ?? []) if (!actions.includes(action.kind) || action.contextKey && action.contextKey !== options.selection.contextKey || action.evidenceFactIds.some(id => !node.sourceFactIds?.includes(id))) throw Error(`core_product_interaction_mismatch: ${node.key}/${action.kind}`);
  const dependencies = adapter.dependencies.filter(dependency => !(dependency === 'native-variation-scripts' && observation.product.type === 'simple'));
  return { componentKey: node.key, widgetType: node.widgetType as CoreProductWidget, settings, provider: observation.provider, contextKey: options.selection.contextKey, productId: observation.product.id, targetOrigin: observation.targetOrigin, observedAt: observation.readAt, field: adapter.field, reads: adapter.reads, actions, dependencies, nativeDataOwner: 'current-woocommerce-product', runtimeContextRequired: true, renderedVerified: false };
}

/** Uses the same tree and the same registered/local control intersection as the compiler. */
export function prepareCoreProductBindings(program: Pick<Native44Program, 'blocks' | 'currentRecord'>, options: { provider: CurrentProductProvider; targetOrigin: string; schemas: Record<string, LegacySchema>; controlsByWidget: Record<string, ReadonlySet<string>> }): CoreProductBinding[] {
  if (!program.currentRecord) throw Error('current_product_selection_required');
  currentProductObservation(options.provider, program.currentRecord, options.targetOrigin);
  const bindings: CoreProductBinding[] = [], owners = new Set<string>();
  for (const node of walkNative44(program.blocks)) {
    const data = node.model?.data;
    if (data?.source !== 'current-record') continue;
    if (node.kind !== 'native' || !coreProductAdapter(node.widgetType)) throw Error(`current_product_native_adapter_missing: ${node.key}`);
    const binding = adaptCoreProductComponent(node, { ...options, selection: program.currentRecord, schema: options.schemas[node.widgetType], localControls: options.controlsByWidget[node.widgetType] ?? new Set() });
    for (const action of binding.actions.filter(action => ['purchase', 'reviews'].includes(action))) { if (owners.has(action)) throw Error(`current_product_duplicate_business_owner: ${action}`); owners.add(action); }
    bindings.push(binding);
  }
  if (!bindings.length) throw Error('current_product_selection_unused');
  return bindings;
}

/** Shared target-read step for the existing preparation and body-save paths.
 * Ordinary programs make no additional request and acquire no new defaults. */
export async function prepareProgramCurrentProduct(reader: Partial<CurrentProductReader>, program: Pick<Native44Program, 'blocks' | 'currentRecord'>, options: { targetOrigin: string; schemas: Record<string, LegacySchema>; controlsByWidget: Record<string, ReadonlySet<string>> }) {
  if (!program.currentRecord) return;
  if (!reader.readTargetProduct) throw Error('target_current_product_reader_missing');
  const provider = await readCurrentProductProvider({ readTargetProduct: id => reader.readTargetProduct!(id) }, program.currentRecord, options.targetOrigin);
  const bindings = prepareCoreProductBindings(program, { ...options, provider });
  return { provider, bindings, runtime:undefined as ProductRuntimeCapability|undefined,observation: currentProductObservation(provider, program.currentRecord, options.targetOrigin) };
}

/** Ordinary owned page drafts have no singular WooCommerce product context.
 * Keep that independent gate until the existing writer has a qualified owner.
 * Implemented adapters and read receipts must never silently broaden its scope. */
export function assertCoreProductPageRuntime(bindings: readonly CoreProductBinding[], runtime?: ProductRuntimeCapability, selection?: CurrentProductSelection, origin?: string): void {
  if (!bindings.length) return;
  if (!runtime || !selection || !origin) throw Error('current_product_runtime_not_supported: native product document runtime required');
  assertProductRuntimeCapability(runtime,selection,origin);
}

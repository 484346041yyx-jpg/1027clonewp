import { createHash } from 'node:crypto';
import { assertTargetCategoriesEvidence, normalizeTargetCategoriesQuery, targetCategoriesQueryKey, type TargetCategoriesEvidence, type TargetCategoriesQueryInput } from '../wordpress/categories-contract.js';
import type { LegacySchema } from '../wordpress/types.js';
import { walkNative44, type Native44Categories, type Native44CategoryQueryReceipt, type Native44Program } from './types.js';

export interface TargetCategoriesReader { readTargetCategories(query: TargetCategoriesQueryInput): Promise<TargetCategoriesEvidence> }
export interface TargetCategoriesProvider { readonly provider: 'target-woocommerce-categories-v1'; readonly targetOrigin: string; readonly readAt: string; readonly queryKey: string }
const observations = new WeakMap<TargetCategoriesProvider, TargetCategoriesEvidence>();
export async function readCurrentCategoriesProvider(reader: TargetCategoriesReader, query: TargetCategoriesQueryInput, origin: string): Promise<TargetCategoriesProvider> {
  const normalized = normalizeTargetCategoriesQuery(query), value = await reader.readTargetCategories(normalized);
  assertTargetCategoriesEvidence(value, origin, normalized);
  const handle = Object.freeze({ provider: 'target-woocommerce-categories-v1' as const, targetOrigin: value.targetOrigin, readAt: value.readAt, queryKey: targetCategoriesQueryKey(normalized) });
  observations.set(handle, structuredClone(value)); return handle;
}
export function currentCategoriesObservation(provider: TargetCategoriesProvider, query: TargetCategoriesQueryInput, origin: string): TargetCategoriesEvidence {
  const value = observations.get(provider), age = Date.now() - Date.parse(provider.readAt);
  if (!value || provider.queryKey !== targetCategoriesQueryKey(query) || provider.targetOrigin !== new URL(origin).origin || age < -60000 || age > 15 * 60000) throw Error('target_categories_provider_identity_or_age');
  assertTargetCategoriesEvidence(value, origin, query); return structuredClone(value);
}
export async function prepareProgramCategories(reader: Partial<TargetCategoriesReader>, program: Pick<Native44Program, 'blocks'>, origin: string, persist?: (query: TargetCategoriesQueryInput, observation: TargetCategoriesEvidence) => Promise<string>): Promise<TargetCategoriesProvider[]> {
  const nodes = walkNative44(program.blocks).filter(n => n.kind === 'native-categories');
  if (!nodes.length) return [];
  if (!reader.readTargetCategories) throw Error('target_categories_reader_missing');
  const queries = new Map(nodes.map(n => [targetCategoriesQueryKey(n.query), normalizeTargetCategoriesQuery(n.query)]));
  const handles: TargetCategoriesProvider[] = [];
  for (const query of queries.values()) handles.push(await readCurrentCategoriesProvider({ readTargetCategories: async q => {
    const observation = await reader.readTargetCategories!(q);
    assertTargetCategoriesEvidence(observation, origin, q);
    return persist ? { ...observation, evidence: [await persist(q, observation)] } : observation;
  } }, query, origin));
  return handles;
}
export function adaptNative44Categories(node: Native44Categories, schema: LegacySchema, providers: readonly TargetCategoriesProvider[] | undefined, elementId: string, origin?: string): { settings: Record<string, unknown>; receipt: Native44CategoryQueryReceipt } {
  if (!origin) throw Error('target_categories_origin_required');
  const query = normalizeTargetCategoriesQuery(node.query), provider = providers?.find(v => v.queryKey === targetCategoriesQueryKey(query));
  if (!provider) throw Error('target_categories_current_process_read_required');
  const value = currentCategoriesObservation(provider, query, origin);
  if (!value.evidence.length) throw Error('target_categories_persisted_evidence_required');
  for (const key of ['type', 'data_source', 'ids', 'hide_empty', 'orderby', 'order', 'nav_disable_active_style']) if (!schema.controls[key]) throw Error(`target_categories_registered_field_missing:${key}`);
  if (!Object.hasOwn(schema.controls.type.options ?? {}, 'navigation') || !Object.hasOwn(schema.controls.data_source.options ?? {}, 'custom_query') || !Object.hasOwn(schema.controls.orderby.options ?? {}, 'menu_order') || !Object.hasOwn(schema.controls.order.options ?? {}, 'ASC')) throw Error('target_categories_registered_query_contract');
  for (const key of ['type', 'data_source', 'ids', 'hide_empty', 'orderby', 'order', 'number', 'subcategories', 'nav_disable_active_style', '__dynamic__']) if (Object.hasOwn(node.widgetSettings, key)) throw Error(`target_categories_owned_query_field:${key}`);
  // The actual renderer passes ids as wp_list_categories(include). Supplying
  // only roots excludes their descendants. Select the actual observed subtree;
  // newly created descendants need a fresh template save, not a false live claim.
  const ids = [...value.terms].sort((a, b) => a.order - b.order).map(t => t.id);
  // Its render() tests truthiness rather than === 'yes'; the registered default
  // string 'no' would disable active styling. Explicit empty switcher is required.
  const settings = { ...node.widgetSettings, type: 'navigation', data_source: 'custom_query', ids, hide_empty: query.hideEmpty ? 'yes' : '', orderby: 'menu_order', order: 'ASC', nav_disable_active_style: '' };
  // The native navigation renderer owns hierarchy and active-class behavior.
  // A read/receipt is not a claim that a particular single-product runtime is visually verified.
  return { settings, receipt: { componentKey: node.key, elementId, widgetType: 'wd_product_categories', provider: provider.provider, targetOrigin: origin, query, observedTermIds: ids, nativeSelection: 'observed-root-and-descendant-ids', evidence: [...new Set([...value.evidence, ...node.query.evidence])], observationSha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'), settings: structuredClone(settings), renderedVerified: false } };
}

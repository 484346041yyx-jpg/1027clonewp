import { z } from 'zod';
import { NATIVE44_ALL_TYPES, EXTENDED_NATIVE_TYPES } from './catalog.js';
import { assertProductExtensionReference, productExtensionWidgetTypes } from './product-extension.js';
import type { Native44Component, Native44Program } from './types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import { coreProductAdapter } from './current-product.js';

/** Describes intent in the existing compiler, never a permission or a new renderer. */
export const COMPONENT_MODEL_POLICY = 'unified-components-v1' as const;
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
const evidence = z.array(z.string().min(1)).min(1).max(1000);
export const componentDataSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('static') }).strict(),
  z.object({ source: z.literal('current-record'), recordType: z.enum(['product', 'post']), contextKey: key, field: z.enum(['title', 'media', 'rating', 'short-description', 'price', 'attributes', 'content', 'meta', 'purchase', 'reviews', 'navigation', 'notices', 'related-products']), evidenceFactIds: evidence }).strict(),
  z.object({ source: z.literal('collection'), query: z.enum(['ids', 'latest-posts', 'product-categories', 'related', 'bestselling', 'recently_viewed']), contextKey: key.optional(), evidenceFactIds: evidence }).strict(),
  z.object({ source: z.literal('shared-resource'), resourceType: z.enum(['content-block', 'page-context']), resourceKey: key, evidenceFactIds: evidence }).strict(),
]);
export const componentModelSchema = z.object({
  data: componentDataSchema.optional(),
  interactions: z.array(z.object({ kind: z.enum(['navigation', 'disclosure', 'gallery', 'selection', 'purchase', 'reviews', 'wishlist', 'compare', 'share', 'timer']), controllerKey: key.optional(), contextKey: key.optional(), evidenceFactIds: evidence }).strict()).min(1).max(50).optional(),
}).strict();
export type ComponentModel = z.infer<typeof componentModelSchema>;

const recordFields: Record<string, string> = {
  wd_single_product_gallery: 'media', wd_single_product_title: 'title', wd_single_product_rating: 'rating',
  wd_single_product_short_description: 'short-description', wd_single_product_price: 'price',
  wd_single_product_add_to_cart: 'purchase', wd_single_product_meta: 'meta',
  wd_single_product_content: 'content', wd_single_product_tabs: 'content',
  wd_single_product_additional_info_table: 'attributes', wd_single_product_reviews: 'reviews', wd_single_product_nav: 'navigation',
  wd_wc_notices: 'notices',
  'woocommerce-product-related': 'related-products',
};
const businessActions = new Set(['selection', 'purchase', 'reviews', 'wishlist', 'compare', 'timer']);
const allowed = new Set<string>(NATIVE44_ALL_TYPES);
const children = (n: Native44Component): Native44Component[] => n.kind === 'composite' || n.kind === 'native' ? n.children ?? [] : n.kind === 'native-carousel' ? n.slides ?? [] : [];
const typeOf = (n: Native44Component) => n.kind === 'composite' ? 'container' : n.kind === 'html-static' ? 'html' : n.widgetType;
const settingsOf = (n: Native44Component) => n.kind === 'composite' ? n.settings ?? {} : 'widgetSettings' in n ? n.widgetSettings : {};
export interface ModelPhoneSection {
  key: string; mode: string;
  settings: Array<{ componentKey: string; values: Record<string, unknown> }>;
  nativeStyleSettings?: Array<{ componentKey: string; setting: { controlId: string } }>;
  contentBindings?: Array<{ componentKey: string; snapshotId: string; nodeId: string }>;
}
export interface ComponentModelGap { componentKey: string; code: string; requirement: string }

/** Same tree, settings and phone plan for every page; provider gaps stay explicit. */
export function analyzeComponentModel(program: Pick<Native44Program, 'blocks'> & Partial<Pick<Native44Program, 'currentRecord' | 'componentExtension'>>, phone: readonly ModelPhoneSection[] = []) {
  if(program.componentExtension) assertProductExtensionReference(program.componentExtension);
  const enabled = program.componentExtension ? new Set<string>(productExtensionWidgetTypes(program.componentExtension)) : allowed;
  const nodes: Array<{ node: Native44Component; parentKey: string | null; sectionKey: string }> = [];
  const walk = (node: Native44Component, parentKey: string | null, sectionKey: string) => {
    nodes.push({ node, parentKey, sectionKey }); children(node).forEach(child => walk(child, node.key, sectionKey));
  };
  program.blocks.forEach(node => walk(node, null, node.key));
  const gaps: ComponentModelGap[] = [], keys = new Set(nodes.map(({ node }) => node.key));
  const counts = new Map<string, number>(); nodes.forEach(({ node }) => counts.set(node.key, (counts.get(node.key) ?? 0) + 1));
  const gap = (componentKey: string, code: string, requirement: string) => gaps.push({ componentKey, code, requirement });
  const contexts = new Map<string, Set<string>>(), uniqueActions = new Set<string>();
  const components = nodes.map(({ node, parentKey, sectionKey }) => {
    const widgetType = typeOf(node), settings = settingsOf(node), model = componentModelSchema.parse(node.model ?? {});
    const facts = new Set<string>(); const collect = (n: Native44Component) => { n.sourceFactIds?.forEach(id => facts.add(id)); children(n).forEach(collect); }; collect(node);
    if (counts.get(node.key) !== 1) gap(node.key, 'duplicate-component', 'One actual component identity per tree node');
    if (!enabled.has(widgetType)) gap(node.key, 'component-not-enabled', widgetType);
    let data: { source: string; field?: string; contextKey?: string; recordType?: string; query?: string } = model.data ??
      (node.kind === 'native-products' ? { source: 'collection', query: 'ids' } : node.kind === 'native-posts' ? { source: 'collection', query: 'latest-posts' } : node.kind === 'native-categories' ? { source: 'collection', query: 'product-categories' } :
        recordFields[widgetType] ? { source: 'current-record', recordType: 'product', contextKey: 'currentRecord', field: recordFields[widgetType] } : { source: 'static' });
    for (const id of [...('evidenceFactIds' in (model.data ?? {}) ? (model.data as { evidenceFactIds: string[] }).evidenceFactIds : []), ...(model.interactions ?? []).flatMap(action => action.evidenceFactIds)]) {
      if (!facts.has(id)) gap(node.key, 'binding-source-owner', id);
    }
    if (recordFields[widgetType] && (data.source !== 'current-record' || data.field !== recordFields[widgetType] || data.recordType !== 'product')) gap(node.key, 'record-role-mismatch', widgetType);
    if (data.source === 'current-record') {
      const set = contexts.get(data.recordType!) ?? new Set<string>(); set.add(data.contextKey!); contexts.set(data.recordType!, set);
      if(!(program.componentExtension&&program.currentRecord&&coreProductAdapter(widgetType)))gap(node.key, coreProductAdapter(widgetType) ? 'record-provider-required' : 'record-provider-pending', `${data.recordType}:${data.field}; explicit target selection and current-process read required`);
      if (coreProductAdapter(widgetType)&&!program.componentExtension) gap(node.key, 'record-runtime-pending', 'Existing page owner has no qualified current WooCommerce product context');
      if (!recordFields[widgetType]) gap(node.key, 'static-substitute-for-record', widgetType);
      if (program.currentRecord && (data.recordType !== program.currentRecord.recordType || data.contextKey !== program.currentRecord.contextKey)) gap(node.key, 'record-selection-mismatch', String(data.contextKey));
    }
    if (data.source === 'collection') {
      const actualQuery = node.kind === 'native-products' ? 'ids' : node.kind === 'native-posts' ? 'latest-posts' : node.kind === 'native-categories' ? 'product-categories' : undefined;
      if (actualQuery !== data.query) gap(node.key, 'collection-provider-pending', String(data.query));
    } else if (node.kind === 'native-products' || node.kind === 'native-posts' || node.kind === 'native-categories') gap(node.key, 'collection-role-mismatch', widgetType);
    if (data.source === 'shared-resource') gap(node.key, 'resource-provider-pending', 'Task-owned target resource and provider binding required');
    if (Object.hasOwn(settings, '__dynamic__')) gap(node.key, 'dynamic-tag-provider-pending', 'Typed dynamic provider and registered field contract required');
    const interactions = [...model.interactions ?? []];
    const nativeAction = recordFields[widgetType] === 'purchase' ? 'purchase' : recordFields[widgetType] === 'reviews' ? 'reviews' : recordFields[widgetType] === 'media' ? 'gallery' : undefined;
    if (nativeAction && !interactions.some(action => action.kind === nativeAction)) interactions.push({ kind: nativeAction, contextKey: data.contextKey, evidenceFactIds: [...facts] });
    if (widgetType === 'wd_single_product_tabs' && (settings.enable_reviews ?? 'yes') === 'yes' && !interactions.some(action => action.kind === 'reviews')) interactions.push({ kind: 'reviews', contextKey: data.contextKey, evidenceFactIds: [...facts] });
    for (const action of interactions) {
      if (action.controllerKey && !keys.has(action.controllerKey)) gap(node.key, 'interaction-owner-missing', action.controllerKey);
      if (action.controllerKey && nodes.some(row => row.node.key === action.controllerKey && row.sectionKey !== sectionKey)) gap(node.key, 'interaction-owner-scope', action.controllerKey);
      if (action.contextKey && data.source === 'static') gap(node.key, 'interaction-context-pending', action.contextKey);
      if ((businessActions.has(action.kind) || action.kind === 'gallery')&&!(program.componentExtension&&program.currentRecord&&(coreProductAdapter(widgetType)?.actions as readonly string[]|undefined)?.includes(action.kind))) gap(node.key, 'interaction-provider-pending', action.kind);
      if (action.kind === 'disclosure' && !['accordion', 'nested-accordion', 'wd_toggle'].includes(widgetType) && !(node.kind === 'native-categories' && ['on', 'side-hidden'].includes(String(settings.mobile_accordion)))) gap(node.key, 'disclosure-controller-pending', 'Registered native controller/target relationship required');
      if (['purchase', 'reviews'].includes(action.kind)) {
        const identity = `${action.kind}:${action.contextKey ?? data.contextKey ?? 'currentRecord'}`;
        if (uniqueActions.has(identity)) gap(node.key, 'duplicate-business-owner', identity); uniqueActions.add(identity);
      }
    }
    if (settings.button_collapsible_content === 'yes' && !interactions.some(action => action.kind === 'disclosure' && action.controllerKey)) gap(node.key, 'disclosure-owner-missing', 'Bind the button to its actual content container');
    const phoneOwner = phone.find(row => row.key === sectionKey);
    if (phoneOwner?.mode === 'duplicate' && (data.source !== 'static' || interactions.some(action => businessActions.has(action.kind)) || widgetType === 'form')) gap(node.key, 'dynamic-phone-duplicate', 'Keep one data/action owner and use shared native responsive fields');
    const adapter = coreProductAdapter(widgetType);
    return { componentKey: node.key, parentKey, sectionKey, widgetType, sourceFactIds: [...facts], data, interactions,
      ...(adapter ? { implementation: { provider: 'target-woocommerce-product-v1', adapter: program.componentExtension?'implemented-context-required':'implemented-disabled', reads: adapter.reads, dependencies: adapter.dependencies, runtimeVerified: false } } : {}),
      settings: { fields: Object.keys(settings), nativeControls: (node.nativeStyleSettings ?? []).map(setting => setting.controlId), modeConditionsMustBeValidated: true },
      phone: phoneOwner ? { mode: phoneOwner.mode, fields: phoneOwner.settings.filter(patch => patch.componentKey === node.key).flatMap(patch => Object.keys(patch.values)), nativeControls: phoneOwner.nativeStyleSettings?.filter(item => item.componentKey === node.key).map(item => item.setting.controlId) ?? [], sourceOwners: phoneOwner.contentBindings?.filter(item => item.componentKey === node.key) ?? [] } : null,
    };
  });
  for (const [recordType, identities] of contexts) if (identities.size > 1) gap(program.blocks[0]?.key ?? 'page', 'mixed-current-record-contexts', recordType);
  for (const section of phone) {
    if (!keys.has(section.key)) gap(section.key, 'phone-owner-missing', section.key);
    for (const owner of [...section.settings, ...section.nativeStyleSettings ?? [], ...section.contentBindings ?? []]) if (!nodes.some(row => row.sectionKey === section.key && row.node.key === owner.componentKey)) gap(owner.componentKey, 'phone-component-scope', section.key);
  }
  return { version: 1 as const, kind: 'unified-component-model' as const, policy: COMPONENT_MODEL_POLICY,
    execution: 'existing-native44-compiler' as const, components, gaps, executable: gaps.length === 0, renderedVerified: false,
  };
}

export function assertComponentModelExecutable(program: Pick<Native44Program, 'blocks' | 'componentModelPolicy'> & Partial<Pick<Native44Program,'currentRecord'|'componentExtension'>>, phone?: readonly ModelPhoneSection[]) {
  if (!program.componentModelPolicy) return;
  const report = analyzeComponentModel(program, phone);
  const gaps = report.gaps.filter(gap => {
    const component=report.components.find(row=>row.componentKey===gap.componentKey);
    return !(program.componentExtension && program.currentRecord && component && coreProductAdapter(component.widgetType) && ['record-provider-required','record-runtime-pending'].includes(gap.code));
  });
  if (gaps.length) throw Error(`unified_component_model_gaps: ${gaps.map(gap => `${gap.componentKey}/${gap.code}`).join(', ')}`);
}

/** A native static substitute must not erase a proved dynamic source owner. */
export function assertComponentModelSource(program: Pick<Native44Program, 'blocks' | 'componentModelPolicy'>, source: SourceFactsV2) {
  if (!program.componentModelPolicy) return;
  const visit = (node: Native44Component) => {
    if (node.kind !== 'composite') for (const id of node.sourceFactIds ?? []) {
      const fact = source.facts[id]; if (!fact || !['text', 'media', 'interaction'].includes(fact.kind)) continue;
      const snapshot = source.snapshots.find(row => row.id === fact.snapshotId); if (!snapshot) continue;
      const seen = new Set<string>(); let owner: string | null = fact.nodeId;
      while (owner && !seen.has(owner)) {
        seen.add(owner); const sourceNode: SourceFactsV2['snapshots'][number]['nodes'][string] | undefined = snapshot.nodes[owner]; if (!sourceNode) break;
        const sourceType = sourceNode.attributes?.['data-widget_type']?.split('.')[0], field = sourceType && sourceType !== 'wd_single_product_tabs' ? recordFields[sourceType] : undefined;
        if (field) {
          if (node.model?.data?.source !== 'current-record' || node.model.data.field !== field) throw Error(`unified_component_source_binding_required: ${node.key}/${field}`);
          break;
        }
        // A nested static Widget/resource is its own owner. Product Tabs can
        // contain both current-record panels and static shared content.
        if (sourceType) break;
        owner = sourceNode.parentId;
      }
    }
    children(node).forEach(visit);
  };
  program.blocks.forEach(visit);
}

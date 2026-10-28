import type { ElementorElement, LegacyComposition, ModelPlan } from '../planning/plan.js';
import type { FileRef, HtmlStaticComponentV2, ImportedAssetV2, BindingV2, GeneratedHtmlProof, ViewportV2 } from '../replica-v2/types.js';
import type { LegacySchema } from '../wordpress/types.js';
import type { TargetCatalogEvidence } from '../wordpress/catalog-contract.js';
import type { Native44ReplicationProfile } from './profile.js';
import type { Native44PendingFormDeclaration, Native44PendingFormBinding, PendingFormCapability } from './pending-form.js';
import type { TargetPostsEvidence } from '../wordpress/posts-contract.js';
import type { Native44StyleBinding, Native44StyleSetting } from './style-resolution.js';
import type { Native44Control } from './knowledge.js';
import type { Native44StyleVariableConsumer, Native44StyleWrapperClassProof } from './style-capabilities.js';
import type { ComponentModel } from './component-model.js';
import type { CurrentProductSelection, CurrentProductProvider } from './current-product.js';
import type { ProductRuntimeCapability } from '../wordpress/current-product-runtime.js';
import type { TargetCategoriesQueryInput } from '../wordpress/categories-contract.js';
import type { TargetCategoriesProvider } from './native-categories.js';
import type { RelatedProductsQueryInput } from '../wordpress/related-products.js';
import type { RelatedProductsProvider, NativeRelatedProductBinding } from './native-related-products.js';
import type { NativeRelatedProductQualification } from './related-product-extension.js';

export const NATIVE44_STRATEGY = 'native44-css-handoff' as const;
export const NATIVE44_NATIVE_EDITOR_NAMING = 'native-translated-v1' as const;
export const NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW = 'whole-page-after-css-v1' as const;
export const NATIVE44_ARTICLE_LIST_POLICY = 'target-posts-v1' as const;
export const NATIVE44_TARGET_ENVIRONMENT = { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' } as const;
export type Native44Environment = { [K in keyof typeof NATIVE44_TARGET_ENVIRONMENT]: string };
export type Native44Role = 'heading' | 'text' | 'image' | 'button' | 'link' | 'card' | 'layout' | 'carousel' | 'product' | 'navigation' | 'form' | 'decoration' | 'other';
export interface Native44Base { key: string; model?: ComponentModel; settings?: Record<string, unknown>; sourceFactIds?: string[]; role?: Native44Role; editorTitle?: string; styleBindings?: Native44StyleBinding[]; nativeStyleSettings?: Native44StyleSetting[]; }
export interface Native44ResourceBinding { kind: 'categories' | 'brands' | 'posts' | 'menu' | 'sidebar' | 'form' | 'page-context' | 'wishlist' | 'compare'; settingPath?: string; ids: Array<number | string>; targetOrigin: string; evidence: string[]; }
export interface Native44Native extends Native44Base { kind: 'native'; widgetType: string; widgetSettings: Record<string, unknown>; children?: Native44Component[]; resources?: Native44ResourceBinding[]; pendingForm?: Native44PendingFormDeclaration; }
export interface Native44Composite extends Native44Base { kind: 'composite'; children: Native44Component[]; }
export interface Native44Html extends Native44Base, Omit<HtmlStaticComponentV2, 'settings' | 'stage' | 'kind' | 'key' | 'sourceFactIds'> {
  kind: 'html-static';
  exception: { reason: 'unsupported-content-model' | 'unsupported-local-semantics'; summary: string; candidates: Array<{ widgetType: string; limitation: string; evidence: FileRef[] }> };
}
export interface Native44Carousel extends Native44Base { kind: 'native-carousel'; widgetType: 'nested-carousel' | 'wd_nested_carousel' | 'slides' | 'wd_banner_carousel' | 'wd_infobox_carousel' | 'wd_testimonials'; widgetSettings: Record<string, unknown>; slides?: Native44Component[]; }
export interface Native44Query { ids: number[]; evidence: string[]; allowOverlap?: boolean; }
export interface Native44Products extends Native44Base { kind: 'native-products'; widgetType: 'wd_products' | 'woocommerce-products' | 'wd_products_tabs'; widgetSettings: Record<string, unknown>; query?: Native44Query; tabs?: Array<{ key: string; title: string; settings?: Record<string, unknown>; query: Native44Query }>; }
/** A live latest-posts query; observed IDs are proof of a read, never a frozen include list. */
export interface Native44PostsQuery { itemsPerPage: number; orderby: 'date'; order: 'desc'; offset?: number; categoryIds?: number[]; tagIds?: number[]; evidence: string[]; }
export interface Native44Posts extends Native44Base { kind: 'native-posts'; widgetType: 'wd_blog'; widgetSettings: Record<string, unknown>; query: Native44PostsQuery; }
export interface Native44Categories extends Native44Base { kind: 'native-categories'; widgetType: 'wd_product_categories'; widgetSettings: Record<string, unknown>; query: TargetCategoriesQueryInput & { evidence: string[] }; }
export interface Native44RelatedProducts extends Native44Base { kind: 'native-related-products'; widgetType: 'woocommerce-product-related'; widgetSettings: Record<string, unknown>; query: RelatedProductsQueryInput; }
export type Native44Component = Native44Native | Native44Composite | Native44Html | Native44Carousel | Native44Products | Native44Posts | Native44Categories | Native44RelatedProducts;
export interface Native44Program {
  inquiryPolicy?: import('./inquiry-form.js').InquiryPolicy;
  componentExtension?: FileRef;
  currentRecord?: CurrentProductSelection;
  componentModelPolicy?: 'unified-components-v1';
  componentLearning?: FileRef;
  styleResolutionVersion?: 1 | 2;
  styleCapabilities?: FileRef;
  version: 2; workflow: 'block-replication'; executionStrategy: typeof NATIVE44_STRATEGY;
  /** Absent on historical native44 tasks: never reinterpret their tree or viewports. */
  replicationProfile?: Native44ReplicationProfile;
  selectionRulesHash?: string;
  /** New tasks keep the site's native translated Navigator names. Absent preserves frozen aliases. */
  editorNaming?: typeof NATIVE44_NATIVE_EDITOR_NAMING;
  /** New tasks run their full visual/interaction review after the complete body and CSS. */
  reviewWorkflow?: typeof NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW;
  /** New tasks compare actual color, type size, controls and effective section paint. */
  visualAuditVersion?: 1 | 2 | 3;
  /** Explicit article-list substitution; absent historical programs retain their source copy contract. */
  articleListPolicy?: typeof NATIVE44_ARTICLE_LIST_POLICY;
  /** Explicit new requirement contract; absent historical tasks are never migrated. */
  requirementProfile?: 'source-requirements-v1';
  goalProfile?: 'component-reference-v1';
  taskId: string; title: string; sourceUrl: string;
  componentCatalog: FileRef; knowledge: FileRef & { fingerprint: string }; targetEnvironment: Native44Environment;
  sourceFacts: FileRef; componentPlan: FileRef; assetsManifest: FileRef;
  viewports: ViewportV2[]; blocks: Native44Component[];
}
export interface Native44QueryReceipt {
  componentKey: string; elementId: string; widgetType: Native44Products['widgetType']; collectionPath?: string;
  provider: 'target-woocommerce'; targetOrigin: string; productIds: number[]; evidence: string[]; settings: Record<string, unknown>;
}
export interface Native44PostQueryReceipt {
  componentKey: string; elementId: string; widgetType: 'wd_blog'; provider: 'target-wordpress-posts';
  targetOrigin: string; query: Native44PostsQuery; observedPostIds: number[]; evidence: string[]; settings: Record<string, unknown>;
}
export interface Native44CategoryQueryReceipt {
  componentKey: string; elementId: string; widgetType: 'wd_product_categories'; provider: 'target-woocommerce-categories-v1';
  targetOrigin: string; query: TargetCategoriesQueryInput; observedTermIds: number[]; evidence: string[];
  nativeSelection: 'observed-root-and-descendant-ids'; observationSha256: string; settings: Record<string, unknown>; renderedVerified: false;
}
export interface Native44Compiled {
  currentProductBinding?: { productId: number; contextKey: string; targetOrigin: string; pageId: number; runId: string };
  replicationProfile?: Native44ReplicationProfile;
  selectionRulesHash?: string;
  editorNaming?: typeof NATIVE44_NATIVE_EDITOR_NAMING;
  articleListPolicy?: typeof NATIVE44_ARTICLE_LIST_POLICY;
  composition: LegacyComposition; plan: ModelPlan; elementMap: Record<string, string>;
  sectionIds: string[]; sections: Array<{ key: string; targetId: string; elementIds: string[] }>;
  usedTypes: string[]; htmlProofs: GeneratedHtmlProof[]; bindings: BindingV2[]; queryReceipts: Native44QueryReceipt[];
  postQueryReceipts?: Native44PostQueryReceipt[];
  categoryQueryReceipts?: Native44CategoryQueryReceipt[];
  relatedProductBindings?: NativeRelatedProductBinding[];
  moduleClasses: Record<string, string>;
  /** Actual emitted widget IDs; consumers must not guess a compiler suffix. */
  widgetTargets: Record<string, string>;
  editorLabels?: Array<{ elementId: string; title: string }>;
  repeaterBindings?: Array<{ componentKey: string; elementId: string; settingPath: string; repeaterRows: Array<{ path: string; rowId: string }> }>;
  /** Source-declared nested editor labels are metadata, never arbitrary settings. */
  nestedChildMetadata?: Array<{ parentComponentKey:string; widgetType:string; childComponentKeys:string[]; editorTitle:string; sourceSha256:string }>;
  /** Layout candidates only: never submission, delivery or frontend inert proof. */
  pendingFormBindings?: Native44PendingFormBinding[];
}
export interface Native44CompileOptions {
  schemas: Record<string, LegacySchema>; assets: ImportedAssetV2[]; catalog?: TargetCatalogEvidence;
  posts?: TargetPostsEvidence[];
  categories?: readonly TargetCategoriesProvider[];
  relatedProducts?: readonly RelatedProductsProvider[];
  relatedQualification?: NativeRelatedProductQualification;
  currentProduct?: CurrentProductProvider;
  currentProductRuntime?: ProductRuntimeCapability;
  targetOrigin?: string;
  /** Only hash-bound local factory objects qualify; serialized receipts do not. */
  pendingForms?: readonly PendingFormCapability[];
  /** V2 image policy: exact Woodmart image widgets render their imported URL directly when a crop defeats srcset selection. */
  directImageSlots?: readonly { componentKey: string; assetKey: string }[];
  /** Keep normalized local knowledge distinct from live registered schemas. */
  knowledge: { fingerprint: string; controlsByWidget: Record<string, ReadonlySet<string>>; styleControlsByWidget?: Record<string, Native44Control[]>; styleVariableConsumers?: Native44StyleVariableConsumer[]; styleWrapperClassesByWidget?: Record<string, readonly Native44StyleWrapperClassProof[]>; validateSettings?: (widgetType: string, settings: Record<string, unknown>) => Record<string,unknown> | void };
}
export const native44Children = (node: Native44Component): Native44Component[] => node.kind === 'composite' || node.kind === 'native' ? node.children ?? [] : node.kind === 'native-carousel' ? node.slides ?? [] : [];
export const walkNative44 = (nodes: Native44Component[]): Native44Component[] => nodes.flatMap(node => [node, ...walkNative44(native44Children(node))]);
export type { ElementorElement };

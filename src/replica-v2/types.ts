import type { ElementorElement, LegacyComposition, ModelPlan } from '../planning/plan.js';
import type { ImportedAsset } from '../wordpress/types.js';

export type ReplicaStage = 'desktop' | 'responsive' | 'final';
export interface FileRef { path: string; sha256: string }
export interface ViewportV2 { name: string; width: number; height: number; stage: 'desktop' | 'responsive' }
export interface MediaSlotV2 {
  assetKey: string; alt?: string;
  /** Responsive sources are emitted only after desktop acceptance. */
  responsive?: Array<{ assetKey: string; media: string }>;
}
export interface LinkSlotV2 { url: string; isExternal?: boolean; title?: string }
export interface HtmlSlotsV2 {
  text: Record<string, string>;
  media: Record<string, MediaSlotV2>;
  links: Record<string, LinkSlotV2>;
}
interface ComponentBaseV2 {
  key: string; kind: string; settings?: Record<string, unknown>;
  stage?: 'desktop' | 'responsive'; sourceFactIds?: string[];
}
export interface NativeComponentV2 extends ComponentBaseV2 {
  kind: 'native'; widgetType: string; widgetSettings: Record<string, unknown>; children?: ComponentV2[];
}
export interface HtmlStaticComponentV2 extends ComponentBaseV2 {
  kind: 'html-static'; template: string; css: string; responsiveCss?: string; slots: HtmlSlotsV2;
  /** Static promotional facts only; product records require native-products. */
  contentRole?: 'marketing' | 'navigation' | 'category' | 'service' | 'decoration' | 'footer';
}
export interface NativeCarouselComponentV2 extends ComponentBaseV2 {
  kind: 'native-carousel'; widgetType: 'nested-carousel'; widgetSettings: Record<string, unknown>;
  slides: ComponentV2[];
}
export interface NativeProductsComponentV2 extends ComponentBaseV2 {
  kind: 'native-products'; widgetType: 'wd_products'; widgetSettings: Record<string, unknown>;
  query: { count: number; offset?: number; ids?: number[]; evidence: string[] };
}
export interface CompositeComponentV2 extends ComponentBaseV2 { kind: 'composite'; children: ComponentV2[] }
export type ComponentV2 = NativeComponentV2 | HtmlStaticComponentV2 | NativeCarouselComponentV2 | NativeProductsComponentV2 | CompositeComponentV2;
export interface ProgramV2 {
  version: 2; workflow: 'block-replication'; taskId: string; title: string; sourceUrl: string;
  sourceFacts: FileRef; componentPlan: FileRef; assetsManifest: FileRef;
  viewports: ViewportV2[]; blocks: ComponentV2[];
}
export type ImportedAssetV2 = ImportedAsset & { key: string };
export interface BindingV2 {
  componentKey: string; elementId: string; kind: 'text' | 'media' | 'link' | 'native';
  slot?: string; settingPath?: string; value?: string; assetKey?: string;
}
/** Process-local compiler-issued capabilities. JSON copies are never authorized. */
export interface GeneratedHtmlProof {
  version: 2; taskId: string; componentKey: string; elementId: string;
  scopeId: string; html: string; sha256: string; bindings: BindingV2[];
}
export interface QueryReceiptV2 {
  componentKey: string; elementId: string; provider: 'target-woocommerce';
  targetOrigin: string; productIds: number[]; evidence: string[]; settings: Record<string, unknown>;
}
export interface CompiledReplicaV2 {
  composition: LegacyComposition; plan: ModelPlan; elementMap: Record<string, string>;
  sectionIds: string[]; sections: Array<{ key: string; targetId: string; elementIds: string[] }>;
  usedTypes: string[]; htmlProofs: GeneratedHtmlProof[]; bindings: BindingV2[];
  queryReceipts: QueryReceiptV2[];
}
export const componentChildrenV2 = (component: ComponentV2): ComponentV2[] => component.kind === 'composite' || component.kind === 'native'
  ? component.children ?? [] : component.kind === 'native-carousel' ? component.slides : [];
export const visibleAtStageV2 = (component: ComponentV2, stage: ReplicaStage): boolean => stage !== 'desktop' || component.stage !== 'responsive';
export const walkComponentsV2 = (nodes: ComponentV2[], stage: ReplicaStage = 'final'): ComponentV2[] => nodes.filter(node => visibleAtStageV2(node, stage)).flatMap(node => [node, ...walkComponentsV2(componentChildrenV2(node), stage)]);
export type { ElementorElement };

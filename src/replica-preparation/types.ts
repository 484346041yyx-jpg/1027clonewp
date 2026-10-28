import type { Native44Component, Native44Program } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { BodySourceUnits } from '../replica-full/body-prepare.js';
import type { FullReplicaFileRef, FullReplicaSourcePartition, FullReplicaReusedHeader, FullReplicaConfiguratorSpec } from '../replica-full/types.js';
import type { HeaderModulePlan } from '../woodmart-header/generic/contract.js';
import type { NavigationFormSpec } from '../replica-full/navigation-form/index.js';
import type { ResponsiveSource, ResponsiveSection, ResponsivePlan } from '../replica-responsive/contract.js';
import type { TaskReviewSkipPolicy } from '../replica-full/review-skip-policy.js';
import type { NativeImagePolicy } from '../replica-full/native-image-policy.js';
import type { PreparationBuildDiagnostic } from './build-diagnostics.js';
import type { ComponentGuidanceReview } from './component-guidance.js';
import type { PreparationExecutionPolicy, PreparationJobId } from './execution-policy.js';

export type PreparationFileRef = FullReplicaFileRef;
export const PREPARATION_DECISION_KEYS = ['fonts', 'content-width', 'spacing', 'breakpoints', 'native-style'] as const;
export const PREPARATION_COMPATIBILITY_KEYS = ['page-shell', 'fonts', 'header-layout', 'motion', 'native-controls'] as const;
export const BODY_FIDELITY_KINDS = ['text-layout', 'item-inventory', 'visual-boundaries', 'default-state', 'interaction', 'motion'] as const;
export type BodyFidelityKind = typeof BODY_FIDELITY_KINDS[number];
export interface BodyFidelityCheck {
  kind: BodyFidelityKind; status: 'required' | 'not-applicable'; sourceFactIds: string[];
  expected: string; evidence: PreparationFileRef[];
}
export type BodyVisualTarget =
  | { kind: 'text-wrap'; sourceFactId: string; lineCount: number; widthPx: number; evidence: PreparationFileRef }
  | { kind: 'item-count'; sourceFactIds: string[]; count: number; evidence: PreparationFileRef }
  | { kind: 'geometry'; sourceFactId: string; rect: { x: number; y: number; width: number; height: number }; evidence: PreparationFileRef }
  | { kind: 'paint'; sourceFactId: string; property: 'background-color' | 'color' | 'border-color' | 'border-width' | 'border-style' | 'font-size' | 'font-weight' | 'border-radius'; value: string; evidence: PreparationFileRef };
export interface PreparationSection {
  key: string; sourceUnitIds: string[]; sourceFactIds: string[];
  family: 'content' | 'interaction'; dependsOn: string[]; estimatedEffort: number;
  fidelity?: BodyFidelityCheck[];
  visualTargets?: BodyVisualTarget[];
  phoneSourceOwners?: Array<{ snapshotId: string; nodeId: string }>;
}
/** A source-derived contract, not an already authored header/body product. */
export interface PreparationPlan {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; kind: 'clonewp-replica-preparation'; taskId: string; runId: string;
  title: string; slug: string; sourceUrl: string; targetOrigin: string;
  sourceEvidence: PreparationFileRef; sourceFacts: PreparationFileRef; sourceUnits: PreparationFileRef;
  headerAssets?: PreparationFileRef; bodyAssets: PreparationFileRef;
  bodyBase: Omit<Native44Program, 'blocks'>; headerBase?: HeaderModulePlan;
  reusedHeader?: FullReplicaReusedHeader;
  pageScope?: 'body-only';
  sourcePartition: FullReplicaSourcePartition;
  navigationForms?: NavigationFormSpec[];
  configurator?: FullReplicaConfiguratorSpec;
  reviewSkipPolicy?: TaskReviewSkipPolicy;
  nativeImagePolicy?: NativeImagePolicy;
  responsive?: ResponsiveSource;
  boundaryTable?: import('./boundaries.js').BoundaryTable;
  executionPolicy?: PreparationExecutionPolicy;
  shared: {
    decisions: Array<{ key: string; value: unknown; evidence: PreparationFileRef[] }>;
    compatibility: Array<{ key: typeof PREPARATION_COMPATIBILITY_KEYS[number]; status: 'verified' | 'not-applicable' | 'unresolved'; reason: string; evidence: PreparationFileRef[] }>;
    css: string;
  };
  sections: PreparationSection[];
}
export interface PreparationJob {
  version: 1; kind: 'clonewp-preparation-job'; taskId: string; runId: string;
  jobId: PreparationJobId; responsibility: 'header' | 'body';
  contractHash: string; sharedHash: string;
  sectionKeys: string[]; sourceUnitIds: string[]; sourceFactIds: string[]; estimatedEffort: number;
}
export interface PreparationSectionResult {
  key: string; blocks: Native44Component[]; css: string; responsive?: ResponsiveSection;
  fidelity?: Array<{ kind: BodyFidelityKind; componentKeys: string[]; mechanism: 'native' | 'scoped-css' | 'task-local-html'; implementation: string }>;
}
export interface PreparationJobResult {
  componentGuidanceReview?: ComponentGuidanceReview;
  version: 1; kind: 'clonewp-preparation-result'; taskId: string; runId: string;
  jobId: PreparationJob['jobId']; contractHash: string; sharedHash: string;
  workRevision?: number;
  header?: HeaderModulePlan; sections?: PreparationSectionResult[];
}
export interface PreparationMergeInputs { sourceFacts: SourceFactsV2; sourceUnits: BodySourceUnits }
export interface PreparationComponentPlan {
  version: 1; kind: 'task-native-body-component-plan'; taskId: string; sourceUrl: string; headerExcluded: true;
  modules: Array<{ key: string; sourceUnitIds: string[]; sourceFactIds: string[]; componentKeys: string[] }>;
}
export interface MergedPreparation {
  header?: HeaderModulePlan; program: Native44Program; css: string; sourceUnits: BodySourceUnits;
  buildDiagnostics: PreparationBuildDiagnostic[];
  navigationForms?: NavigationFormSpec[];
  configurator?: FullReplicaConfiguratorSpec;
  reviewSkipPolicy?: TaskReviewSkipPolicy;
  nativeImagePolicy?: NativeImagePolicy;
  responsive?: ResponsivePlan;
  componentPlan: PreparationComponentPlan; contractHash: string; sharedHash: string;
}

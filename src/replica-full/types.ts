import type { TaskReviewSkipPolicy } from './review-skip-policy.js';
import type { HeaderModulePlan } from '../woodmart-header/generic/contract.js';
import type { NavigationFormSpec } from './navigation-form/index.js';
import type { NativeImagePolicy, NativeImageCheck } from './native-image-policy.js';
import type { ResponsivePlan } from '../replica-responsive/contract.js';

export interface FullReplicaFileRef { path: string; sha256: string }
export interface FullReplicaSourcePartition { allUnits: string[]; headerUnits: string[]; bodyUnits: string[]; footerUnits?: string[]; unselectedBodyUnits?: string[]; selection?: { version: 1; userInstruction: string; targetSlug?: string; evidence: FullReplicaFileRef } }
export interface FullReplicaManifest {
  componentExtension?: FullReplicaFileRef;
  currentRecord?: import('../native44/current-product.js').CurrentProductSelection;
  version: 1 | 2 | 3 | 4; kind: 'clonewp-full-replica'; taskId: string; runId: string;
  title: string; slug: string; sourceUrl: string; targetOrigin: string;
  headerProvider: 'woodmart-header-builder' | 'component' | 'reused-woodmart-header';
  reusedHeader?: FullReplicaReusedHeader;
  /** New body tasks inherit the site footer; historical tasks omit this. */
  pageScope?: 'body-only';
  deliveryPolicy: 'publish-after-review';
  reviewSkipPolicy?: TaskReviewSkipPolicy;
  /** Frozen only for new creation; absent historical tasks retain their contract. */
  nativeImagePolicy?: NativeImagePolicy;
  editorCompletionPolicy?: { version: 1; mode: 'align-and-reopen'; runtime?: 'shared-owned-editor-v1' };
  responsive?: ResponsivePlan;
  sourceEvidence: FullReplicaFileRef;
  sourcePartition: FullReplicaSourcePartition;
  header?: { plan: HeaderModulePlan; bundleDirectory: string; assets: FullReplicaFileRef };
  body: { program: FullReplicaFileRef; css: FullReplicaFileRef; sourceUnits: FullReplicaFileRef; navigationForms?: NavigationFormSpec[] };
}
export interface FullReplicaPreparedHeader { planHash: string; moduleKey: string; bundleDirectory: string; payload: unknown }
export interface FullReplicaPreparedBody {
  programHash: string; cssInputHash: string; sourceUnitsHash: string; sourceEvidenceHash: string;
  sourceUnitIds: string[]; componentSourceUnitIds: string[];
  embeddedHeaderCount: number; payload: unknown;
}
export interface FullReplicaPrepared {
  manifest: FullReplicaManifest; manifestHash: string;
  header?: FullReplicaPreparedHeader; body: FullReplicaPreparedBody;
}
export interface FullReplicaNamedResource { id: number; name: string; editUrl: string }
export interface FullReplicaReusedHeader {
  headerId: string; name: string; editUrl: string; sharedHash: string;
  headerHash: string; menuHash: string; styleHash: string;
  menus: Array<FullReplicaNamedResource & { key: string }>;
  blocks: FullReplicaNamedResource[];
  mobileMaxWidth: number; hasSubmenus: boolean;
  footerHash?: string;
}
export interface FullReplicaHeaderCheckpoint {
  headerId: string; name: string; editUrl: string;
  headerHash: string; menuHash: string; styleHash: string;
  menus: Array<FullReplicaNamedResource & { key: string }>;
  styleBlock: FullReplicaNamedResource;
  menuContent?: Array<FullReplicaNamedResource & { key: string }>;
}
export interface FullReplicaPageCheckpoint {
  pageId: number; runId: string; status: 'draft'; template: 'elementor_header_footer';
  editUrl: string; previewUrl: string; bodyHash: string; headerId: null;
}
export interface FullReplicaBodyCheckpoint extends FullReplicaPageCheckpoint {
  cssHash: string; documentHash: string; sourceUnitIds: string[]; embeddedHeaderCount: 0;
}
export interface FullReplicaBoundCheckpoint {
  pageId: number; runId: string; headerId: string; editUrl: string; previewUrl: string;
  bodyHash: string; cssHash: string; documentHash: string;
  headerHash: string; menuHash: string; styleHash: string;
}
export interface FullReplicaReview {
  version: 1; kind: 'clonewp-full-replica-review'; taskId: string; runId: string; pageId: number;
  fingerprint: string; decision: 'approved' | 'changes-required'; observedAt: string;
  reviewerEvidence: FullReplicaFileRef;
  nativeImageChecks?: NativeImageCheck[];
  viewports: Array<{ width: number; height: number; screenshot: FullReplicaFileRef; visual: 'passed' | 'failed'; interactions: 'passed' | 'failed'; headerCount: number; bodyHeaderCount: number }>;
}
export interface FullReplicaPublishedCheckpoint extends Omit<FullReplicaBoundCheckpoint, 'previewUrl'> {
  status: 'publish'; publicUrl: string;
}
export type FullReplicaRemotePhase = 'header' | 'page' | 'body' | 'binding' | 'publish' | 'style-revision' | 'header-style-revision' | 'motion-revision' | 'layout-revision' | 'navigation-return-revision';
export interface FullReplicaOperation {
  operationId: string; taskId: string; runId: string; phase: FullReplicaRemotePhase;
  expectedCheckpointHash: string; createdAt: string;
}
export interface FullReplicaRunState {
  version: 1; kind: 'clonewp-full-replica-run'; taskId: string; runId: string; manifestHash: string;
  status: 'preparing' | 'building' | 'awaiting-review' | 'reviewed' | 'published' | 'write-unknown' | 'review-changes-required';
  revision: number; createdAt: string; updatedAt: string;
  pending: FullReplicaOperation | null;
  lastError?: { phase: FullReplicaRemotePhase | 'preparation' | 'review'; operationId?: string; code: string };
  checkpoints: { header?: FullReplicaHeaderCheckpoint; page?: FullReplicaPageCheckpoint; body?: FullReplicaBodyCheckpoint; bound?: FullReplicaBoundCheckpoint; published?: FullReplicaPublishedCheckpoint };
  review: FullReplicaReview | null;
  bodyStyleAmendment?: FullReplicaFileRef;
}
/** Production adapters verify actual native contracts and return fresh readbacks. */
export interface FullReplicaDependencies {
  inspectInquirySubmission?(bound:FullReplicaBoundCheckpoint,elementId:string,testMarker:string):Promise<import('./inquiry-review.js').InquiryBackendObservation>;
  close?(): Promise<void>;
  prepareHeader(manifest: FullReplicaManifest): Promise<FullReplicaPreparedHeader>;
  prepareBody(manifest: FullReplicaManifest): Promise<FullReplicaPreparedBody>;
  assertPreparedBody(body: FullReplicaPreparedBody, manifest: FullReplicaManifest): void | Promise<void>;
  writeState(state: FullReplicaRunState): Promise<void>;
  provisionHeader(header: FullReplicaPreparedHeader, page: FullReplicaPageCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaHeaderCheckpoint>;
  createPage(prepared: FullReplicaPrepared, operation: FullReplicaOperation): Promise<FullReplicaPageCheckpoint>;
  saveBody(body: FullReplicaPreparedBody, page: FullReplicaPageCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaBodyCheckpoint>;
  bindHeader(header: FullReplicaHeaderCheckpoint, body: FullReplicaBodyCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaBoundCheckpoint>;
  bindReusedHeader?(body: FullReplicaBodyCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaBoundCheckpoint>;
  reviewWholePage(prepared: FullReplicaPrepared, bound: FullReplicaBoundCheckpoint, reviewInput?: unknown): Promise<FullReplicaReview | null>;
  verifyReview(review: FullReplicaReview, bound: FullReplicaBoundCheckpoint): Promise<void>;
  inspectUnwrittenBodyStyle?(body: FullReplicaPreparedBody, page: FullReplicaPageCheckpoint, operation: FullReplicaOperation): Promise<unknown>;
  publishWithoutReview?(bound: FullReplicaBoundCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaPublishedCheckpoint>;
  publishPage(bound: FullReplicaBoundCheckpoint, review: FullReplicaReview, operation: FullReplicaOperation): Promise<FullReplicaPublishedCheckpoint>;
  reviseStyle?(prepared: FullReplicaPrepared, bound: FullReplicaBoundCheckpoint, css: FullReplicaFileRef, operation: FullReplicaOperation): Promise<FullReplicaBoundCheckpoint>;
  reviseHeaderStyle?(prepared: FullReplicaPrepared, bound: FullReplicaBoundCheckpoint, css: FullReplicaFileRef, operation: FullReplicaOperation): Promise<FullReplicaHeaderStyleRevision>;
  reviseNativeMotion?(prepared: FullReplicaPrepared, bound: FullReplicaBoundCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaBoundCheckpoint>;
  reviseLayout?(prepared: FullReplicaPrepared, bound: FullReplicaBoundCheckpoint, plan: FullReplicaFileRef, operation: FullReplicaOperation): Promise<FullReplicaBoundCheckpoint>;
  rebaseCurrentDraft?(bound: FullReplicaBoundCheckpoint, operation: FullReplicaOperation, currentBodyHash: string, currentDocumentHash: string): Promise<FullReplicaBoundCheckpoint>;
  reviseNavigationReturn?(prepared: FullReplicaPrepared, bound: FullReplicaBoundCheckpoint, operation: FullReplicaOperation): Promise<FullReplicaBoundCheckpoint>;
  /** Read-only remote reconciliation. `before` confirms no mutation occurred; it never retries. */
  reconcileOperation?(prepared: FullReplicaPrepared, operation: FullReplicaOperation, checkpoints: FullReplicaRunState['checkpoints']): Promise<FullReplicaReconciliation>;
}
export interface FullReplicaHeaderStyleRevision { header: FullReplicaHeaderCheckpoint; bound: FullReplicaBoundCheckpoint }
export type FullReplicaReconciliation = { status: 'before' } | { status: 'conflict' } | { status: 'after'; checkpoint: FullReplicaPageCheckpoint | FullReplicaHeaderCheckpoint | FullReplicaBodyCheckpoint | FullReplicaBoundCheckpoint | FullReplicaPublishedCheckpoint | FullReplicaHeaderStyleRevision };
export interface FullReplicaRunOptions { state?: FullReplicaRunState; reviewInput?: unknown; publish?: boolean; onProgress?: (message: string) => void | Promise<void> }
export type FullReplicaRunResult = FullReplicaRunState | { status: 'legacy-component-route'; entryPoint: 'src/cli.ts'; invocation: string; remoteWrites: 0 };

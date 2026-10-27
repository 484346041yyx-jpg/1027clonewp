export interface WordPressCredentials {
  targetUrl: string;
  username: string;
  applicationPassword: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  networkRoute?:import('./network.js').WordPressNetworkRoute;
  /** Explicit new replica policy; omitted for every historical execution path. */
  executionStrategy?: 'native44-css-handoff';
  allowedWidgetTypes?: readonly string[];
  componentExtension?: import('../replica-v2/types.js').FileRef;
}

export interface PluginInfo { plugin: string; name: string; version: string; status: string }
export interface PreflightReport {
  targetUrl: string;
  authenticated: boolean;
  userId: number;
  environment?: string;
  wordpressVersion?: string;
  phpVersion?: string;
  plugins: PluginInfo[];
  themes: Array<{ stylesheet: string; version: string; status: string }>;
  namespaces: string[];
  novamiraInstalled: boolean;
  novamiraActive: boolean;
  blockers: string[];
}
export interface AbilityInfo {
  name: string;
  label?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ControlInfo {
  type: string;
  label?: string;
  default?: unknown;
  options?: Record<string, unknown>;
  multiple?: boolean;
  condition?: Record<string, unknown>;
  conditions?: unknown;
  selectors?: unknown;
  responsive?: unknown;
  fields?: unknown;
  [key: string]: unknown;
}
export interface LegacySchema {
  type: string; class: string; controls: Record<string, ControlInfo>;
  /** Exact registered nested-widget inheritance and child/repeater source proof. */
  nativeChildren?: { childType: 'container'; repeaterKey: string; titleSettingKey: string; baseClass: string; sourceSha256: string };
  /** Opt-in native44 relationship observed from the installed widget implementation. */
  nativeChildContract?: NativeChildContract;
}
export type NativeChildContract = { childType: 'container'; baseClass: string; sourceSha256: string } & (
  { policy: 'repeater'; repeaterKey: string; titleSettingKey: string } |
  { policy: 'fixed'; count: number; childSettings?: Record<string, unknown> }
);
export interface CapabilityReport {
  mode: 'native-v4' | 'legacy-verified' | 'unavailable';
  abilities: AbilityInfo[];
  schemas: Record<string, unknown>;
  legacySchemas: Record<string, LegacySchema>;
  versions: Record<string, string>;
  sourceProof?: Record<string, unknown>;
  limitations: string[];
  /** Optional sealed proof used only to acknowledge an already captured stage. */
  checkpointProof?: NativeCheckpointProof;
}
export interface NativeCheckpointProof { version: 1; sha256: string; types: string[] }
export interface ElementorElement {
  id: string;
  elType: string;
  widgetType?: string;
  settings: Record<string, unknown>;
  elements: ElementorElement[];
  isInner?: boolean;
  [key: string]: unknown;
}
export interface NativeComposition {
  xml_structure: string;
  element_config: Record<string, Record<string, unknown>>;
  style?: Record<string, unknown>;
  classes?: Record<string, string[]>;
}
export interface LegacyComposition {
  elements: ElementorElement[];
  pageSettings?: Record<string, unknown>;
}
export type DraftComposition = NativeComposition | LegacyComposition;
export interface DraftSnapshot {
  pageId: number;
  runId: string;
  title: string;
  status: 'draft';
  elements: ElementorElement[];
  settings: Record<string, unknown>;
  hash: string;
}
/** Published checkpoints remain read-only; they are never accepted by draft writers. */
export interface PublishedSnapshot extends Omit<DraftSnapshot, 'status'> { status: 'publish' }
/** The transaction owner must persist its exact intent and check free space
 * before constructing this proof. This is not a replacement for user authority. */
export interface OwnedPublicationIntentProof {
  version: 1;
  kind: 'owned-page-publication-intent';
  operationId: string;
  intentSha256: string;
  beforeHash: string;
  durableIntentConfirmed: true;
  freeBytes: number;
}
export interface OwnedPublishedCheckpoint {
  snapshot: PublishedSnapshot;
  proof: NativeCheckpointProof;
  publicUrl: string;
}
export interface OwnedPublicationResult extends OwnedPublishedCheckpoint {
  /** Elementor may keep post_status in its saved settings or expose WordPress status. */
  settingsStatus: 'retained' | 'published';
}
export interface ImportedAsset {
  attachmentId: number;
  url: string;
  sourceUrl: string;
  sha256: string;
  width?: number;
  height?: number;
  mimeType: string;
  /** Explicit URLs returned for registered WordPress attachment sizes; never inferred filenames. */
  variants?: string[];
  /** Paint already present in the verified asset pixels; do not apply it a second time. */
  bakedOpacity?: number;
  bakedEffects?: string[];
}
export interface AssetImportOptions {
  runId: string;
  pageId: number;
  sourceUrl: string;
  mimeType: string;
  alt?: string;
  originalSha256?: string;
  verifiedSha256?: string;
}
export interface AssetImportCheckpoint {
  phase: 'lookup' | 'upload-link' | 'uploading' | 'uploaded' | 'registering' | 'complete';
  /** Set only when the process has reached a request that can alter media bytes or records. */
  remoteWriteStarted: boolean;
}
export interface RecoverableAssetImportOptions extends AssetImportOptions {
  requireExisting?: boolean;
  /** Recover an already uploaded, exact-hash file; this path never sends another PUT. */
  recoverPendingUpload?: boolean;
  onCheckpoint?: (checkpoint: AssetImportCheckpoint) => Promise<void> | void;
}
export interface PendingAssetInspection {
  status: 'staged' | 'absent' | 'attachment-present';
  sha256: string;
  bytes: number;
  /** Same bytes under this owned page, but not yet proven by the exact metadata lookup. */
  attachmentIds?: number[];
}
export interface PreviewAccess {
  previewUrl: string;
  editUrl: string;
  publicPreviewUrl?: string;
  adminAccessUrl?: string;
}

/** Public target catalog observation; the caller attaches its current-run evidence file. */
export interface TargetCatalogSnapshot {
  version: 1;
  targetOrigin: string;
  readAt: string;
  evidence: string[];
  query: { limit: number; status: 'publish'; visibility: 'visible'; orderby: 'date'; order: 'DESC'; tieBreak?: {orderby: 'ID'; order: 'DESC'} };
  products: Array<{ id: number; name: string; permalink: string; imageUrl: string; imageVariants: string[]; priceText: string; onSale?: boolean; averageRating?: number; ratingCount?: number }>;
}

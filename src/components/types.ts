export interface ComponentFileRef { path: string; sha256: string }
export type QualificationStatus = 'unverified' | 'source-studied' | 'historical-qualified' | 'local-replay-verified';
export interface ComponentQualification {
  status: QualificationStatus;
  scope: string;
  evidence: ComponentFileRef[];
  limitations: string[];
}
export interface ComponentRegistration {
  widgetType: string;
  provider: string;
  activation: 'enabled' | 'reference-only' | 'adapter-pending';
  contractRefs: ComponentFileRef[];
  recipeRefs: ComponentFileRef[];
  resourceDependencies: string[];
  adapterRefs: string[];
  contentModel: string;
  suitableFor: string[];
  restrictions: string[];
  qualifications: Record<'source' | 'save' | 'render' | 'interaction' | 'resources', ComponentQualification>;
}
export interface ExecutionAdapterDeclaration {
  id: string;
  executionStrategy: 'native44-css-handoff';
  replicationProfile: 'desktop-browser-v1';
  widgetTypes: string[];
  implemented: Array<'settings' | 'repeater' | 'nested-repeater' | 'nested-fixed' | 'products' | 'product-tabs' | 'container' | 'html'>;
  resourceAdapters: string[];
  unavailableDependencies: Record<string, string[]>;
  writeBoundary: 'owned-draft-page-only';
  sourceRefs: ComponentFileRef[];
}
export interface ComponentRegistry {
  version: 1;
  kind: 'component-registry';
  enabledSet: { id: 'native44-v1' | 'native44-plus-core-product-v1'; ref: ComponentFileRef; widgetTypes: string[] };
  knowledge: { fingerprint: string; index: ComponentFileRef; learningRelease?: ComponentFileRef };
  entries: ComponentRegistration[];
  adapters: ExecutionAdapterDeclaration[];
  learningReleases: ComponentFileRef[];
  pagePatterns: {
    total: number;
    entries: Array<{
      learningId: string; recordRef: ComponentFileRef; conclusionStatus: 'candidate-interpretation';
      conclusionCount: number; conclusions: Array<{ responsibility: string; statement: string; statementTruncated: boolean; evidenceIndexes: number[] }>;
      evidenceCount: number; evidence: Array<ComponentFileRef & { kind: string; scope: string }>;
    }>;
    additionalRecordRefs: ComponentFileRef[];
  };
  fingerprint: string;
}
export interface LearningQualificationSummary {
  source: 'unverified' | 'source-studied';
  save: 'unverified' | 'local-replay-verified';
  render: 'unverified' | 'local-replay-verified';
  interaction: 'unverified' | 'local-replay-verified';
  resources: 'task-local-only';
  registration: 'task-local-only';
}
export interface LearningRecord {
  version: 1;
  kind: 'component-learning-record' | 'page-learning-record';
  learningId: string;
  createdAt: string;
  widgetType?: string;
  provider?: string;
  mode: 'existing-component-recipe' | 'new-component-candidate' | 'page-pattern';
  evidence: Array<ComponentFileRef & { kind: string; scope: string }>;
  conclusions: Array<{ responsibility: string; statement: string; evidenceIndexes: number[] }>;
  conclusionStatus: 'candidate-interpretation';
  qualification: LearningQualificationSummary;
  constraints: string[];
  baseKnowledgeFingerprint: string;
}
export interface LearningRelease {
  version: 1;
  kind: 'component-learning-release';
  releaseId: string;
  previous?: ComponentFileRef;
  records: ComponentFileRef[];
  baseKnowledgeFingerprint: string;
  enabledSetHash: string;
  activation: 'knowledge-only';
}

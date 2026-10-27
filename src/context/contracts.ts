export const CONTEXT_INTENTS = ['replica', 'learn', 'compare', 'resume', 'maintain'] as const;
export type ContextIntent = typeof CONTEXT_INTENTS[number];
export interface ContextRecordRef { path: string; identityHash: string }
export interface ContextTaskIndexEntry { taskId: string; mode: 'original' | 'replica'; job: ContextRecordRef }
export interface ContextRunIndexEntry { runId: string; taskId?: string; mode: 'original' | 'replica'; record: ContextRecordRef; recordKind: 'journal' | 'result' }
export interface ContextIssue { code: string; path?: string }
export interface ContextContractIndex { componentSet: { id: string; ref: { path: string; sha256: string } }; knowledge: { id: string; fingerprint: string; ref: { path: string; sha256: string } }; selectionRules: { id: string; sha256: string; files: Array<{ path: string; sha256: string }> }; adapters: { id: string; sha256: string; files: Array<{ path: string; sha256: string }> } }
export interface ContextIndex { version: 1; kind: 'clonewp-context-index'; tasks: ContextTaskIndexEntry[]; runs: ContextRunIndexEntry[]; contracts?: ContextContractIndex; issues: ContextIssue[] }
export interface ContextLoadedFile { path: string; sha256: string; bytes: number; reason: string; content?: string }
export interface ContextLoadOptions { root: string; intent: ContextIntent; task?: string; run?: string; components?: string[] }
export interface ContextLoadResult {
  status: 'ready' | 'needs-task-selection' | 'blocked'; exitCode: 0 | 1 | 2; intent: ContextIntent;
  documents: ContextLoadedFile[]; records: ContextLoadedFile[]; candidates?: Array<{ taskId?: string; runId?: string; mode: string }>;
  task?: { taskId?: string; runId?: string; mode: string; state: Record<string, unknown>; frozenIdentity: Record<string, unknown>; scope?: { summary: string; constraints: string[]; authority: 'descriptive-not-authorization' } };
  currentRelease?: unknown; components: unknown[]; capabilities?: unknown; gaps: ContextIssue[]; nextAction: string;
  pagePatterns?: unknown;
  contractSelection?: 'current-default' | 'task-frozen' | 'legacy-task-base-only' | 'task-amendment-read-only';
  metrics: { elapsedMs: number; filesRead: number; bytesRead: number; networkRequests: 0; credentialLoads: 0; browserStarts: 0; fileWrites: 0 };
}

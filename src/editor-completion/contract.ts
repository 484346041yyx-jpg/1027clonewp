import { z } from 'zod';
import { fullReplicaJsonHash } from '../replica-full/json.js';

export const editorCompletionPolicySchema = z.object({ version: z.literal(1), mode: z.literal('align-and-reopen'), runtime: z.literal('shared-owned-editor-v1').optional() }).strict();
export const defaultEditorCompletionPolicy = () => ({ version: 1, mode: 'align-and-reopen', runtime: 'shared-owned-editor-v1' } as const);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/);
export const editorScopeSchema = z.object({ taskId: key, runId: key, pageId: z.number().int().positive(), targetOrigin: z.string().url(), documentHash: hash }).strict().superRefine((v, ctx) => {
  const u = new URL(v.targetOrigin);
  if (u.origin !== v.targetOrigin || !['http:', 'https:'].includes(u.protocol) || u.username || u.password) ctx.addIssue({ code: 'custom', message: 'editor_completion_origin' });
});
export type EditorScope = z.infer<typeof editorScopeSchema>;
export const editorDocumentSchema = z.object({ elements: z.array(z.record(z.string(), z.unknown())).max(20000), settings: z.record(z.string(), z.unknown()) }).strict();
export type EditorDocument = z.infer<typeof editorDocumentSchema>;
export const editorObservationSchema = z.object({
  pageId: z.number().int().positive(), runId: key, mainHash: hash, approvedMatches: z.boolean(),
  autosaves: z.array(z.object({ id: z.number().int().positive(), parent: z.number().int().positive(), hash, state: z.enum(['current', 'known-stale', 'conflict', 'foreign']) }).strict()).max(100),
}).strict();
export type EditorObservation = z.infer<typeof editorObservationSchema>;
export interface EditorIntent {
  version: 1; scope: EditorScope; operationId: string; expected: EditorDocument; previous: EditorDocument[];
  before: EditorObservation; createdAt: string;
}
export interface EditorState { version: 1; intentHash: string; status: 'prepared' | 'unknown' | 'retryable' | 'aligned' | 'conflict' | 'complete'; alignedAt?: string; readback?: EditorObservation; reopen?: { evidence: { path: string; sha256: string }; screenshot: { path: string; sha256: string } } }
export const editorHash = (value: unknown) => fullReplicaJsonHash(value);
export function checkEditorObservation(value: unknown, scope: EditorScope, mainHash?: string): EditorObservation {
  const o = editorObservationSchema.parse(value);
  if (o.pageId !== scope.pageId || o.runId !== scope.runId || !o.approvedMatches || mainHash && o.mainHash !== mainHash || new Set(o.autosaves.map(a => a.id)).size !== o.autosaves.length || o.autosaves.some(a => a.id === scope.pageId || a.parent !== scope.pageId)) throw Error('editor_completion_scope_or_saved_document_changed');
  return o;
}
export function editorAligned(o: EditorObservation): boolean { return o.approvedMatches && o.autosaves.every(a => a.state === 'current'); }
export function editorCanAlign(o: EditorObservation): boolean { return o.approvedMatches && o.autosaves.every(a => ['current', 'known-stale'].includes(a.state)); }
export const editorReopenEvidenceSchema = z.object({
  version: z.literal(1), scope: editorScopeSchema, reopenedAt: z.iso.datetime(), observedAt: z.iso.datetime(),
  editUrl: z.string().url(), mode: z.literal('editable'), safeMode: z.literal(false), historicalRevisionPreview: z.literal(false),
  loadedElementIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)).max(20000),
  document: editorDocumentSchema,
  pageCss: z.string().max(2_000_000), viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  screenshot: z.object({ path: z.string().min(1), sha256: hash }).strict(),
}).strict();
export function assertEditorReopen(input: unknown, intent: EditorIntent, alignedAt: string) {
  const e = editorReopenEvidenceSchema.parse(input), u = new URL(e.editUrl);
  if (editorHash(e.scope) !== editorHash(intent.scope) || u.origin !== intent.scope.targetOrigin || u.pathname !== '/wp-admin/post.php' || u.searchParams.size !== 2 || u.searchParams.get('post') !== String(intent.scope.pageId) || u.searchParams.get('action') !== 'elementor' || Date.parse(e.reopenedAt) < Date.parse(alignedAt) || Date.parse(e.observedAt) < Date.parse(e.reopenedAt) || Date.parse(e.observedAt) > Date.now() + 60_000) throw Error('editor_completion_reopen_identity_or_time');
  const ids: string[] = []; const walk = (ns: any[]) => { for (const n of ns) { if (typeof n.id !== 'string') throw Error('editor_completion_node_identity'); ids.push(n.id); walk(n.elements ?? []); } }; walk(intent.expected.elements);
  if (new Set(ids).size !== ids.length || new Set(e.loadedElementIds).size !== e.loadedElementIds.length || ids.some(id => !e.loadedElementIds.includes(id)) || e.loadedElementIds.some(id => !ids.includes(id))) throw Error('editor_completion_reopen_elements');
  const css = String(intent.expected.settings.custom_css ?? '');
  if (css && !e.pageCss.includes(css)) throw Error('editor_completion_reopen_css');
  return e;
}

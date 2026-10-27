import { readFile, stat } from 'node:fs/promises';
import { validateFullReplicaManifest, fullReplicaHash, fullReplicaFingerprint } from '../replica-full/contract.js';
import { readNative44CurrentState } from '../native44/current-state.js';
import { readNative44Publication } from '../native44/publication.js';
import { editorCompletionPolicySchema, type EditorScope } from './contract.js';
import { editorPath } from './store.js';
const read = async (p: string) => { if ((await stat(p)).size > 32 * 1024 * 1024) throw Error('editor_completion_file_size'); return JSON.parse(await readFile(p, 'utf8')); };

export async function readEditorTaskContract(runDir: string) {
  let task: any;
  try { task = await read(await editorPath(runDir, 'manifest.json')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (task) {
    if (task.kind !== 'clonewp-full-replica') throw Error('editor_runtime_unknown_task');
    const manifest = validateFullReplicaManifest(task);
    return { taskId: manifest.taskId, runId: manifest.runId, targetOrigin: manifest.targetOrigin, pageId: undefined, policy: manifest.editorCompletionPolicy };
  }
  try { task = await read(await editorPath(runDir, 'journal.json')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
  if (task.executionStrategy !== 'native44-css-handoff') return undefined;
  return { taskId: task.taskId, runId: task.runId, targetOrigin: new URL(task.targetUrl).origin, pageId: task.pageId, policy: task.editorCompletionPolicy ? editorCompletionPolicySchema.parse(task.editorCompletionPolicy) : undefined };
}

export async function resolveEditorTask(root: string, runDir: string) {
  let manifest: any;
  try { manifest = await read(await editorPath(runDir, 'manifest.json')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (manifest?.kind === 'clonewp-full-replica') {
    const m = validateFullReplicaManifest(manifest), s = await read(await editorPath(runDir, 'state.json')), bound = s.checkpoints?.published ?? s.checkpoints?.bound;
    if (s.taskId !== m.taskId || s.runId !== m.runId || s.manifestHash !== fullReplicaHash(m) || s.pending || !bound) throw Error('editor_completion_task_not_saved');
    return { scope: { taskId: m.taskId, runId: m.runId, pageId: bound.pageId, targetOrigin: m.targetOrigin, documentHash: fullReplicaFingerprint(bound) } as EditorScope, bodyHash: bound.bodyHash, bodyDocumentHash: bound.documentHash };
  }
  const j = await read(await editorPath(runDir, 'journal.json'));
  if (j.executionStrategy !== 'native44-css-handoff' || !j.pageId || !j.documentHash || j.mutations?.some((m: any) => m.status !== 'confirmed')) throw Error('editor_completion_task_not_saved');
  const current = await readNative44CurrentState(root, runDir), publication = current ? await readNative44Publication(root, current) : undefined;
  const documentHash = publication?.documentHash ?? current?.documentHash ?? j.documentHash;
  return { scope: { taskId: j.taskId, runId: j.runId, pageId: j.pageId, targetOrigin: new URL(j.targetUrl).origin, documentHash } as EditorScope, bodyDocumentHash: documentHash };
}

import path from 'node:path';
import { lstat, mkdir, readFile, realpath, rename, statfs, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { assertEditorReopen, checkEditorObservation, editorAligned, editorCanAlign, editorDocumentSchema, editorHash, editorScopeSchema, type EditorDocument, type EditorIntent, type EditorObservation, type EditorScope, type EditorState } from './contract.js';

export interface EditorDriver { inspect(scope: EditorScope, expected: EditorDocument, previous: EditorDocument[]): Promise<EditorObservation>; align(intent: EditorIntent, intentHash: string): Promise<EditorObservation> }
const bytesHash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export async function editorPath(base: string, input: string, missing = false): Promise<string> {
  const root = await realpath(base), p = path.resolve(root, input), rel = path.relative(root, p);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error('editor_completion_path_escape');
  let cursor = root;
  const parts = rel.split(path.sep);
  for (let i = 0; i < parts.length; i++) { cursor = path.join(cursor, parts[i]); try { const s = await lstat(cursor); if (s.isSymbolicLink() || path.resolve(await realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) throw Error('editor_completion_path_alias'); } catch (e) { if (missing && i === parts.length - 1 && (e as NodeJS.ErrnoException).code === 'ENOENT') return p; throw e; } }
  return p;
}
async function readJson(file: string) { const s = await lstat(file); if (!s.isFile() || s.size > 32 * 1024 * 1024) throw Error('editor_completion_file_size'); return JSON.parse(await readFile(file, 'utf8')); }
async function save(dir: string, name: string, value: unknown, immutable = false) {
  const p = await editorPath(dir, name, true), free = await statfs(dir); if (free.bavail * free.bsize < 512 * 1024 * 1024) throw Error('editor_completion_evidence_space');
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (immutable) { await writeFile(p, bytes, { flag: 'wx' }); return; }
  const temp = await editorPath(dir, `.editor-${randomUUID()}.tmp`, true); await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, p);
}
export function editorCompletionDirectory(runDir: string, documentHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(documentHash)) throw Error('editor_completion_document_hash');
  return path.join(runDir, 'editor-completion', documentHash);
}
async function makeChild(parent: string, name: string) {
  const child = await editorPath(parent, name, true);
  try { await mkdir(child); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  return editorPath(parent, child);
}
export async function requireEditorCompletion(runDir: string, taskId: string, runId: string, documentHash: string) {
  const base = await makeChild(runDir, 'editor-completion');
  const marker = { version: 1, taskId, runId, documentHash, mode: 'align-and-reopen' };
  const file = path.join(base, `required-${documentHash}.json`);
  try { await save(base, path.basename(file), marker, true); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || editorHash(await readJson(await editorPath(base, file))) !== editorHash(marker)) throw e; }
}
export async function prepareEditorCompletion(runDir: string, scopeInput: EditorScope, expectedInput: EditorDocument, previousInputs: EditorDocument[], driver: EditorDriver): Promise<EditorState> {
  const scope = editorScopeSchema.parse(scopeInput), expected = editorDocumentSchema.parse(expectedInput), previous = previousInputs.map(v => editorDocumentSchema.parse(v));
  if (previous.length > 20) throw Error('editor_completion_previous_limit');
  const base = await makeChild(runDir, 'editor-completion'), dir = await makeChild(base, scope.documentHash);
  const before = checkEditorObservation(await driver.inspect(scope, expected, previous), scope);
  const intent: EditorIntent = { version: 1, scope, expected, previous, before, operationId: randomUUID(), createdAt: new Date().toISOString() };
  await save(dir, 'intent.json', intent, true);
  const state: EditorState = { version: 1, intentHash: editorHash(intent), status: !editorCanAlign(before) ? 'conflict' : editorAligned(before) ? 'aligned' : 'prepared', ...(editorAligned(before) ? { alignedAt: new Date().toISOString(), readback: before } : {}) };
  await save(dir, 'state.json', state); return state;
}
async function load(runDir: string, documentHash: string) {
  const dir = await editorPath(runDir, editorCompletionDirectory(runDir, documentHash)), intent = await readJson(await editorPath(dir, 'intent.json')) as EditorIntent, state = await readJson(await editorPath(dir, 'state.json')) as EditorState;
  editorScopeSchema.parse(intent.scope); editorDocumentSchema.parse(intent.expected); intent.previous.forEach(v => editorDocumentSchema.parse(v)); checkEditorObservation(intent.before, intent.scope);
  if (intent.version !== 1 || state.version !== 1 || intent.scope.documentHash !== documentHash || state.intentHash !== editorHash(intent)) throw Error('editor_completion_intent_changed');
  return { dir, intent, state };
}
export async function alignEditorCompletion(runDir: string, documentHash: string, driver: EditorDriver, reconcile = false) {
  const { dir, intent, state } = await load(runDir, documentHash);
  const observed = checkEditorObservation(await driver.inspect(intent.scope, intent.expected, intent.previous), intent.scope, intent.before.mainHash);
  let writes = 0;
  if (editorAligned(observed)) { if (state.status === 'complete') return { state, writes }; const next: EditorState = { ...state, status: 'aligned', alignedAt: new Date().toISOString(), readback: observed }; delete next.reopen; await save(dir, 'state.json', next); return { state: next, writes }; }
  if (!editorCanAlign(observed) || editorHash(observed) !== editorHash(intent.before)) { await save(dir, 'state.json', { ...state, status: 'conflict', readback: observed }); throw Error('editor_completion_autosave_conflict'); }
  if (reconcile) { const next: EditorState = { ...state, status: 'retryable', readback: observed }; await save(dir, 'state.json', next); return { state: next, writes }; }
  if (!['prepared', 'retryable'].includes(state.status)) throw Error('editor_completion_reconcile_required');
  await save(dir, 'state.json', { ...state, status: 'unknown' });
  try {
    writes++; const after = checkEditorObservation(await driver.align(intent, state.intentHash), intent.scope, intent.before.mainHash);
    if (!editorAligned(after)) throw Error('editor_completion_alignment_unconfirmed');
    const next: EditorState = { ...state, status: 'aligned', alignedAt: new Date().toISOString(), readback: after }; await save(dir, 'state.json', next); return { state: next, writes };
  } catch { return { state: { ...state, status: 'unknown' as const }, writes, nextAction: 'reconcile' }; }
}
export async function verifyEditorCompletion(runDir: string, documentHash: string, evidencePath: string, driver: EditorDriver) {
  const { dir, intent, state } = await load(runDir, documentHash);
  if (state.status !== 'aligned' || !state.alignedAt || !state.readback) throw Error('editor_completion_alignment_required');
  const file = await editorPath(runDir, evidencePath), bytes = await readFile(file), evidence = assertEditorReopen(JSON.parse(bytes.toString('utf8')), intent, state.alignedAt);
  const picture = await editorPath(runDir, evidence.screenshot.path), shot = await readFile(picture), meta = await sharp(shot).metadata();
  if (bytesHash(shot) !== evidence.screenshot.sha256 || !['png', 'jpeg', 'webp'].includes(meta.format ?? '') || !meta.width || !meta.height) throw Error('editor_completion_screenshot_changed');
  const fresh = checkEditorObservation(await driver.inspect(intent.scope, intent.expected, intent.previous), intent.scope, intent.before.mainHash);
  if (!editorAligned(fresh)) throw Error('editor_completion_autosave_became_stale');
  // Validate the actual reopened editor model, including native controls, against
  // the saved page using registered defaults. Matching IDs/CSS alone is insufficient.
  const loaded = checkEditorObservation(await driver.inspect(intent.scope, evidence.document, []), intent.scope, intent.before.mainHash);
  if (!editorAligned(loaded)) throw Error('editor_completion_reopened_model_stale');
  const next: EditorState = { ...state, status: 'complete', readback: fresh, reopen: { evidence: { path: file, sha256: bytesHash(bytes) }, screenshot: { path: picture, sha256: bytesHash(shot) } } };
  await save(dir, 'state.json', next); return next;
}
/** A local delivery gate, never a substitute for a fresh remote/browser check. */
export async function editorCompletionGate(runDir: string, identity: { taskId: string; runId: string; pageId: number; documentHash: string }, required: boolean) {
  const marker = path.join(runDir, 'editor-completion', `required-${identity.documentHash}.json`);
  try { const m = await readJson(await editorPath(runDir, marker)); if (m.taskId !== identity.taskId || m.runId !== identity.runId || m.documentHash !== identity.documentHash) throw Error('editor_completion_marker_identity'); required = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (!required) return { required: false, complete: true, status: 'historical-contract' };
  try {
    const { intent, state } = await load(runDir, identity.documentHash);
    if (Object.entries(identity).some(([k, v]) => intent.scope[k as keyof EditorScope] !== v)) throw Error('editor_completion_delivery_identity');
    if (state.status !== 'complete' || !state.reopen || !state.alignedAt || !state.readback || !editorAligned(checkEditorObservation(state.readback, intent.scope, intent.before.mainHash))) return { required: true, complete: false, status: state.status };
    const file = await editorPath(runDir, state.reopen.evidence.path), bytes = await readFile(file);
    if (bytesHash(bytes) !== state.reopen.evidence.sha256) throw Error('editor_completion_reopen_changed');
    const e = assertEditorReopen(JSON.parse(bytes.toString('utf8')), intent, state.alignedAt), shot = await readFile(await editorPath(runDir, e.screenshot.path));
    if (bytesHash(shot) !== e.screenshot.sha256 || editorHash({ ...e.screenshot, path: await editorPath(runDir, e.screenshot.path) }) !== editorHash(state.reopen.screenshot)) throw Error('editor_completion_screenshot_changed');
    return { required: true, complete: true, status: 'complete' };
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return { required: true, complete: false, status: 'awaiting-editor-alignment-and-reopen' }; }
}

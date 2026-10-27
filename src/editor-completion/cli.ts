import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { acquireLock } from '../core/files.js';
import { loadConfig, redactor } from '../core/config.js';
import { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { documentHashV2 } from '../replica-v2/journal.js';
import { editorDocumentSchema, editorHash, type EditorScope } from './contract.js';
import { alignEditorCompletion, editorCompletionDirectory, editorCompletionGate, editorPath, prepareEditorCompletion, requireEditorCompletion, verifyEditorCompletion, type EditorDriver } from './store.js';
import { WordPressEditorCompletion } from './wordpress.js';
import { nextEditorRecoveryAction } from './recovery.js';
import { advanceEditorRecovery } from './recovery-store.js';
import { resolveEditorTask } from './task.js';
export { resolveEditorTask } from './task.js';

const read = async (p: string) => { if ((await stat(p)).size > 32 * 1024 * 1024) throw Error('editor_completion_file_size'); return JSON.parse(await readFile(p, 'utf8')); };
export async function runEditorCompletionCLI(args: string[], rootInput = 'D:/cloneWP', injected?: EditorDriver, recoveryInput?: unknown) {
  if (args[0] === 'recover') {
    if (args.length !== 4 || args[1] !== '--run-dir' || args[3] !== '--stdin') throw Error('editor_completion_arguments');
    const root = await realpath(rootInput), dir = await editorPath(root, args[2]), task = await resolveEditorTask(root, dir);
    let packet: any = recoveryInput;
    if (packet === undefined) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 256 * 1024) throw Error('editor_recovery_input_size'); chunks.push(bytes); }
      packet = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    if (editorHash(packet?.scope) !== editorHash(task.scope)) throw Error('editor_recovery_task_changed');
    // Both browser adapters use the same task-scoped durable protocol. The legacy
    // in-memory packet remains available for explicitly frozen old contracts.
    return packet?.version === 2 ? advanceEditorRecovery(dir, packet) : nextEditorRecoveryAction(packet);
  }
  const [command, ...rest] = args, specs: Record<string, string[]> = { prepare: ['run-dir', 'saved', 'previous'], align: ['run-dir'], reconcile: ['run-dir'], verify: ['run-dir', 'evidence'], status: ['run-dir'] };
  if (!specs[command]) throw Error('editor_completion_command');
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) { const k = rest[i]?.replace(/^--/, ''); if (!rest[i]?.startsWith('--') || !specs[command].includes(k) || flags[k] || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Error('editor_completion_arguments'); flags[k] = rest[i + 1]; }
  if (specs[command].some(k => !flags[k])) throw Error('editor_completion_arguments');
  const root = await realpath(rootInput), dir = await editorPath(root, flags['run-dir']), task = await resolveEditorTask(root, dir), scope = task.scope;
  if (command === 'status') return editorCompletionGate(dir, scope, true);
  const unlock = await acquireLock(root); let transport: WoodMartHeaderTransport | undefined;
  try {
    // Resolve local task, file identities and input sizes before credentials.
    let expected: ReturnType<typeof editorDocumentSchema.parse> | undefined, previous: ReturnType<typeof editorDocumentSchema.parse>[] = [];
    if (command === 'prepare') {
      const saved = await read(await editorPath(dir, flags.saved));
      const extract = (s: any) => s.value?.currentSnapshot?.page ?? s.fullSnapshot?.page ?? s.snapshot?.page ?? s.page ?? s;
      const p = extract(saved);
      if (p.pageId !== scope.pageId || p.runId !== scope.runId || task.bodyHash && p.bodyHash !== task.bodyHash || !task.bodyHash && p.hash !== task.bodyDocumentHash) throw Error('editor_completion_saved_checkpoint');
      expected = editorDocumentSchema.parse({ elements: p.elements, settings: p.settings });
      // A published document may expose the status control as publish instead of draft.
      if (task.bodyHash && documentHashV2(p.elements, p.settings) !== task.bodyDocumentHash && !(p.settings.post_status === 'publish' && documentHashV2(p.elements, { ...p.settings, post_status: 'draft' }) === task.bodyDocumentHash)) throw Error('editor_completion_saved_checkpoint');
      const refs = await read(await editorPath(dir, flags.previous));
      if (!Array.isArray(refs) || refs.length > 20) throw Error('editor_completion_previous_limit');
      for (const ref of refs) {
        if (!ref || Object.keys(ref).sort().join(',') !== 'path,sha256' || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('editor_completion_previous_reference');
        const file = await editorPath(dir, ref.path); if ((await stat(file)).size > 32 * 1024 * 1024) throw Error('editor_completion_file_size'); const b = await readFile(file);
        if (createHash('sha256').update(b).digest('hex') !== ref.sha256) throw Error('editor_completion_previous_changed');
        const old = extract(JSON.parse(b.toString('utf8')));
        if (old.pageId !== scope.pageId || old.runId !== scope.runId) throw Error('editor_completion_previous_owner');
        previous.push(editorDocumentSchema.parse({ elements: old.elements, settings: old.settings }));
      }
    } else {
      const intent = await read(await editorPath(dir, path.join(editorCompletionDirectory(dir, scope.documentHash), 'intent.json')));
      if (editorHash(intent.scope) !== editorHash(scope)) throw Error('editor_completion_task_changed');
      if (command === 'verify') await read(await editorPath(dir, flags.evidence));
    }
    let driver = injected;
    if (!driver) { const { config, credentials } = await loadConfig(root); if (new URL(config.targetUrl).origin !== scope.targetOrigin) throw Error('editor_completion_target_changed'); transport = new WoodMartHeaderTransport({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute }); driver = new WordPressEditorCompletion(transport); }
    if (command === 'prepare') { await requireEditorCompletion(dir, scope.taskId, scope.runId, scope.documentHash); return prepareEditorCompletion(dir, scope, expected!, previous, driver); }
    if (command === 'verify') return verifyEditorCompletion(dir, scope.documentHash, flags.evidence, driver);
    // Each operation directory owns a durable intent. Unknown saves only reconcile.
    return alignEditorCompletion(dir, scope.documentHash, driver, command === 'reconcile');
  } finally { try { await transport?.close(); } finally { await unlock(); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runEditorCompletionCLI(process.argv.slice(2)).then(v => console.log(JSON.stringify(v, null, 2))).catch(e => { console.error(redactor()(e)); process.exitCode = 1; });

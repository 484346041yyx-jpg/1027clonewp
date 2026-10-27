import path from 'node:path';
import { assertReplicaSourceSlug } from '../core/replica-url.js';
import { assertWorkspaceAccess } from '../workspace/service.js';
import {readUnwrittenBodyStyleRequest,loadBodyStyleAmendment,installBodyStyleAmendment,type BodyStyleAmendment} from './unwritten-body-style-amendment.js';
import { lstat, mkdir, open, readFile, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../core/files.js';
import { canonicalFullReplicaJson, FULL_REPLICA_JSON_LIMITS } from './json.js';
import { fullReplicaHash, validateFullReplicaManifest } from './contract.js';
import { defaultNativeImagePolicy } from './native-image-policy.js';
import { rebaseFullReplicaCurrentDraft, reconcileFullReplica, reviseFullReplicaHeaderStyle, reviseFullReplicaLayout, reviseFullReplicaNativeMotion, reviseFullReplicaNavigationReturn, reviseFullReplicaStyle, runFullReplica } from './coordinator.js';
import { containerTreePlanSchema } from './container-tree.js';
import { fullReplicaDelivery } from './delivery.js';
import type { FullReplicaDependencies, FullReplicaManifest, FullReplicaRunState } from './types.js';
import { createPreparationTiming, wrapFullReplicaDependencies, type PreparationTimingStatus } from '../replica-preparation/timing.js';
import { defaultEditorCompletionPolicy } from '../editor-completion/contract.js';
import { editorCompletionGate } from '../editor-completion/store.js';
import { fullReplicaFingerprint } from './contract.js';
import { fullReplicaUserProgress, type PreparationProgress } from './user-progress.js';
import { isPublicReplica } from './public-contract.js';
import { runPublicReplica } from './public-scope.js';

const ROOT = 'D:/cloneWP';
export const FULL_REPLICA_HELP = `Full replica: parallel local header/body preparation, serial remote writes
  run --manifest FILE --run-dir DIR
  resume --run-dir DIR
  inspect-inquiry --run-dir DIR --element-id HEX --test-marker MARKER
  review --run-dir DIR --evidence FILE
  publish --run-dir DIR
  reconcile --run-dir DIR
  rebase-current-draft --run-dir DIR --expected-fingerprint SHA256 --current-body-hash SHA256 --current-document-hash SHA256
  amend-unwritten-body-style --run-dir DIR --request FILE
  recover-style --run-dir DIR
  revise-style --run-dir DIR --css FILE --expected-fingerprint SHA256
  revise-header-style --run-dir DIR --css FILE --expected-fingerprint SHA256
  revise-native-motion --run-dir DIR --expected-fingerprint SHA256
  revise-layout --run-dir DIR --plan FILE --expected-fingerprint SHA256
  revise-navigation-return --run-dir DIR --expected-fingerprint SHA256
  status --run-dir DIR
Remote phases: owned Full Width draft -> header resources -> body -> bind -> actual whole-page review -> publish.
Unknown remote outcomes preserve pending intent and require reconciliation; never blindly rerun.
Retired component manifests are rejected before target authentication.
Public scopes in version 5: header-only, footer-only, header-footer; independent resources and an owned preview draft, with no global binding.
`;
const specs: Record<string, string[]> = { 'inspect-inquiry':['run-dir','element-id','test-marker'], run: ['manifest', 'run-dir'], resume: ['run-dir'], review: ['run-dir', 'evidence'], publish: ['run-dir'], reconcile: ['run-dir'], 'rebase-current-draft': ['run-dir', 'expected-fingerprint', 'current-body-hash', 'current-document-hash'], 'recover-style':['run-dir'], 'amend-unwritten-body-style':['run-dir','request'], 'revise-style': ['run-dir', 'css', 'expected-fingerprint'], 'revise-header-style': ['run-dir', 'css', 'expected-fingerprint'], 'revise-native-motion': ['run-dir', 'expected-fingerprint'], 'revise-layout': ['run-dir', 'plan', 'expected-fingerprint'], 'revise-navigation-return': ['run-dir', 'expected-fingerprint'], status: ['run-dir'] };
export function parseFullReplicaArguments(args: string[]) {
  if (!args.length || args.includes('--help')) return { command: 'help', flags: {} as Record<string, string> };
  const command = args[0]; if (!Object.hasOwn(specs, command)) throw Error('replica_full_cli_unknown_command');
  const flags: Record<string, string> = Object.create(null);
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, ''), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !specs[command].includes(key) || Object.hasOwn(flags, key) || !value || value.startsWith('--')) throw Error('replica_full_cli_arguments_invalid');
    flags[key] = value;
  }
  if (specs[command].some(key => !Object.hasOwn(flags, key))) throw Error('replica_full_cli_required_argument');
  if (['expected-fingerprint', 'current-body-hash', 'current-document-hash'].some(key => flags[key] && !/^[a-f0-9]{64}$/.test(flags[key]))) throw Error('replica_full_cli_fingerprint_invalid');
  if (command === 'inspect-inquiry' && (!/^[a-f0-9]{7}$/.test(flags['element-id']) || !/^clonewp-inquiry-test-[a-f0-9]{32}$/.test(flags['test-marker']))) throw Error('replica_full_cli_inquiry_identity_invalid');
  return { command, flags };
}
async function checkedPath(input: string, allowMissingFinal = false): Promise<string> {
  const root = await realpath(ROOT), target = path.resolve(input), relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('replica_full_cli_path_escape');
  let current = root; const parts = relative.split(path.sep);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let info; try { info = await lstat(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissingFinal && index === parts.length - 1) return target; throw error; }
    if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('replica_full_cli_reparse');
  }
  return target;
}
async function jsonFile(filename: string): Promise<unknown> {
  const file = await checkedPath(filename), info = await lstat(file);
  if (!info.isFile() || info.size > FULL_REPLICA_JSON_LIMITS.bytes) throw Error('replica_full_cli_input_invalid');
  const input: unknown = JSON.parse(await readFile(file, 'utf8')); canonicalFullReplicaJson(input); return input;
}
async function newFile(filename: string, value: unknown): Promise<void> {
  const bytes = canonicalFullReplicaJson(value), handle = await open(filename, 'wx');
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}
async function writeState(directory: string, state: FullReplicaRunState): Promise<void> {
  await checkedPath(directory);
  const free = await statfs(directory); if (free.bavail * free.bsize < 512 * 1024 * 1024) throw Error('replica_full_cli_evidence_space');
  const destination = path.join(directory, 'state.json');
  try { await checkedPath(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temp = path.join(directory, `.state-${randomUUID()}.tmp`); await newFile(temp, state); await rename(temp, destination);
}
async function manifestAt(filename: string): Promise<FullReplicaManifest> {
  const absolute = await checkedPath(filename), parent = path.dirname(absolute), initial = validateFullReplicaManifest(await jsonFile(absolute));
  const resolve = (input: string) => path.resolve(parent, input);
  const manifest = { ...initial, ...(initial.responsive ? { responsive: { ...initial.responsive, source: { ...initial.responsive.source, path: resolve(initial.responsive.source.path) } } } : {}), sourceEvidence: { ...initial.sourceEvidence, path: resolve(initial.sourceEvidence.path) }, body: {
    ...initial.body,
    program: { ...initial.body.program, path: resolve(initial.body.program.path) }, css: { ...initial.body.css, path: resolve(initial.body.css.path) }, sourceUnits: { ...initial.body.sourceUnits, path: resolve(initial.body.sourceUnits.path) },
    ...(initial.body.navigationForms ? { navigationForms: initial.body.navigationForms.map(form => ({ ...form, sourceEvidence: { ...form.sourceEvidence, path: resolve(form.sourceEvidence.path) } })) } : {}),
  }, ...(initial.header ? { header: { ...initial.header, bundleDirectory: resolve(initial.header.bundleDirectory), assets: { ...initial.header.assets, path: resolve(initial.header.assets.path) } } } : {}) };
  if (manifest.sourcePartition.selection) manifest.sourcePartition = { ...manifest.sourcePartition, selection: { ...manifest.sourcePartition.selection, evidence: { ...manifest.sourcePartition.selection.evidence, path: resolve(manifest.sourcePartition.selection.evidence.path) } } };
  for (const ref of [manifest.sourceEvidence, manifest.body.program, manifest.body.css, manifest.body.sourceUnits, ...(manifest.body.navigationForms ?? []).map(form => form.sourceEvidence), ...(manifest.header ? [manifest.header.assets] : [])]) {
    const file = await checkedPath(ref.path), info = await lstat(file);
    if (!info.isFile() || info.size > 32 * 1024 * 1024 || createHash('sha256').update(await readFile(file)).digest('hex') !== ref.sha256) throw Error('replica_full_cli_input_identity_changed');
  }
  return validateFullReplicaManifest(manifest);
}
export interface FullReplicaCLIServices {
  /** Test hosts may isolate a real filesystem lock; production always uses the project target lock. */
  acquireRemoteLock?(): Promise<() => Promise<void>>;
  createDependencies(options: { bodyStyleAmendment?: BodyStyleAmendment; root: string; manifestPath: string; runDirectory: string; manifest: FullReplicaManifest; recoverInterruptedStyle?: boolean }): Promise<Omit<FullReplicaDependencies, 'writeState'>>;
}
const realServices: FullReplicaCLIServices = {
  async createDependencies(options) {
    const adapter = await import('./body.js');
    return adapter.createFullReplicaDependencies(options);
  },
};
function serializeRemote(deps: FullReplicaDependencies, acquireRemoteLock: () => Promise<() => Promise<void>> = () => acquireLock(ROOT)): FullReplicaDependencies {
  const one = <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) => async (...args: Args): Promise<Result> => {
    const release = await acquireRemoteLock(); try { return await fn(...args); } finally { await release(); }
  };
  if (deps.bindReusedHeader) deps = { ...deps, bindReusedHeader: one(deps.bindReusedHeader.bind(deps)) };
  return { ...deps, ...(deps.inspectUnwrittenBodyStyle ? { inspectUnwrittenBodyStyle: one(deps.inspectUnwrittenBodyStyle.bind(deps)) } : {}), provisionHeader: one(deps.provisionHeader.bind(deps)), createPage: one(deps.createPage.bind(deps)), saveBody: one(deps.saveBody.bind(deps)), bindHeader: one(deps.bindHeader.bind(deps)), publishPage: one(deps.publishPage.bind(deps)), ...(deps.publishWithoutReview ? { publishWithoutReview: one(deps.publishWithoutReview.bind(deps)) } : {}), ...(deps.reviseStyle ? { reviseStyle: one(deps.reviseStyle.bind(deps)) } : {}), ...(deps.reviseHeaderStyle ? { reviseHeaderStyle: one(deps.reviseHeaderStyle.bind(deps)) } : {}), ...(deps.reviseNativeMotion ? { reviseNativeMotion: one(deps.reviseNativeMotion.bind(deps)) } : {}), ...(deps.reviseLayout ? { reviseLayout: one(deps.reviseLayout.bind(deps)) } : {}), ...(deps.rebaseCurrentDraft ? { rebaseCurrentDraft: one(deps.rebaseCurrentDraft.bind(deps)) } : {}), ...(deps.reviseNavigationReturn ? { reviseNavigationReturn: one(deps.reviseNavigationReturn.bind(deps)) } : {}) };
}
/** Read-only: the sibling preparation state only labels stages, it never
 * authorizes a write and a missing or malformed file simply yields no label. */
async function readPreparationProgress(directory: string): Promise<PreparationProgress | null> {
  try {
    const value = JSON.parse(await readFile(path.join(`${directory}-preparation`, 'state.json'), 'utf8')) as { merged?: unknown; jobs?: unknown };
    if (!Array.isArray(value.jobs)) return null;
    return {
      merged: !!value.merged,
      jobs: value.jobs.map((row: { job?: { jobId?: unknown }; status?: unknown; startedAt?: unknown; leaseUntil?: unknown }) => ({
        jobId: String(row?.job?.jobId ?? ''), status: String(row?.status ?? ''),
        ...(typeof row?.startedAt === 'string' ? { startedAt: row.startedAt } : {}), ...(typeof row?.leaseUntil === 'string' ? { leaseUntil: row.leaseUntil } : {}),
      })),
    };
  } catch { return null; }
}
export async function runFullReplicaCLI(args: string[], services: FullReplicaCLIServices = realServices): Promise<unknown> {
  const { command, flags } = parseFullReplicaArguments(args);
  if (command === 'help') return { help: FULL_REPLICA_HELP, remoteWrites: 0 };
  if (['run','resume','status','reconcile'].includes(command)) {
    const filename=command==='run'?flags.manifest:path.join(flags['run-dir'],'manifest.json');
    const input=await jsonFile(filename);
    if(isPublicReplica(input))return runPublicReplica(input,{manifestPath:filename,runDirectory:flags['run-dir'],command:command as 'run'|'resume'|'status'|'reconcile'});
  }
  if (command !== 'status') await assertWorkspaceAccess(ROOT);
  let manifest: FullReplicaManifest, state: FullReplicaRunState | undefined;
  const directory = await checkedPath(flags['run-dir'], command === 'run');
  if (command === 'run') {
    manifest = await manifestAt(flags.manifest);
    assertReplicaSourceSlug(manifest);
    const newProgramBytes=await readFile(await checkedPath(manifest.body.program.path));
    if(createHash('sha256').update(newProgramBytes).digest('hex')!==manifest.body.program.sha256)throw Error('replica_full_cli_program_hash_mismatch');
    const newProgram=JSON.parse(newProgramBytes.toString('utf8'));
    if(Array.isArray(newProgram.blocks)&&!newProgram.inquiryPolicy)throw Error('replica_full_cli_new_inquiry_policy_required_use_preparation');
  if (manifest.headerProvider === 'component') throw Error('replica_full_retired_entry');
    manifest = validateFullReplicaManifest({ ...manifest, nativeImagePolicy: manifest.nativeImagePolicy ?? defaultNativeImagePolicy(), editorCompletionPolicy: manifest.editorCompletionPolicy ?? defaultEditorCompletionPolicy() });
    await mkdir(directory); await newFile(path.join(directory, 'manifest.json'), manifest);
    state = { version: 1, kind: 'clonewp-full-replica-run', taskId: manifest.taskId, runId: manifest.runId, manifestHash: fullReplicaHash(manifest), status: 'preparing', revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pending: null, checkpoints: {}, review: null };
    await writeState(directory, state);
  } else {
    manifest = await manifestAt(path.join(directory, 'manifest.json'));
    state = await jsonFile(path.join(directory, 'state.json')) as FullReplicaRunState;
    if (state.manifestHash !== fullReplicaHash(manifest) || state.taskId !== manifest.taskId || state.runId !== manifest.runId) throw Error('replica_full_cli_run_identity_conflict');
    if (command === 'status') return { ...await deliverState(state), authority: 'local-confirmed-checkpoints', remoteWrites: 0, userProgress: fullReplicaUserProgress(state, await readPreparationProgress(directory)) };
    if(command==='recover-style'&&(!state.pending||state.pending.phase!=='body'||state.checkpoints.body||state.checkpoints.bound))throw Error('replica_full_style_recovery_pending_body_required');
    if (state.pending && !['reconcile','recover-style','rebase-current-draft'].includes(command)) throw Error('replica_full_reconciliation_required');
    if (!state.pending && command === 'reconcile') throw Error('replica_full_reconciliation_not_pending');
    if (command === 'publish' && (!state.checkpoints.bound || !manifest.reviewSkipPolicy && state.review?.decision !== 'approved')) throw Error('replica_full_review_required');
  }
  async function deliverState(s: FullReplicaRunState) {
    const bound = s.checkpoints.published ?? s.checkpoints.bound;
    if (!bound) return fullReplicaDelivery(s, manifest);
    const identity = { taskId: s.taskId, runId: s.runId, pageId: bound.pageId, documentHash: fullReplicaFingerprint(bound) };
    const editor = manifest.reviewSkipPolicy ? { required: false, complete: false, status: 'skipped-by-current-user-for-this-task' } : await editorCompletionGate(directory, identity, !!manifest.editorCompletionPolicy);
    return fullReplicaDelivery(s, manifest, editor);
  }
  // Timing construction can reject before the command owns a lock. Keep it
  // before acquisition so an initialization failure cannot orphan that lock.
  const timing = createPreparationTiming({ runDirectory: directory, command });
  const lock = path.join(directory, '.lock'), lockId = randomUUID(); await newFile(lock, { lockId });
  let raw: Omit<FullReplicaDependencies, 'writeState'> | undefined;
  let outcome: PreparationTimingStatus = 'failed';
  const delivered = <T>(result: T): T => { outcome = result && typeof result === 'object' && 'status' in result && result.status === 'write-unknown' ? 'failed' : 'succeeded'; return result; };
  try {
    const amendment = command === 'amend-unwritten-body-style' ? await readUnwrittenBodyStyleRequest(flags.request, manifest, state!, directory) : state?.bodyStyleAmendment ? await loadBodyStyleAmendment(directory, state.bodyStyleAmendment, manifest) : undefined;
    raw = await services.createDependencies({ ...(amendment ? { bodyStyleAmendment: amendment } : {}), root: ROOT, manifestPath: path.join(directory, 'manifest.json'), runDirectory: directory, manifest, ...(command==='recover-style'?{recoverInterruptedStyle:true}:{}) });
    const deps = serializeRemote({ ...wrapFullReplicaDependencies(raw, timing), writeState: next => writeState(directory, next) }, services.acquireRemoteLock);
    if (command === 'inspect-inquiry') { const bound=state?.checkpoints.bound;if(!bound || !deps.inspectInquirySubmission)throw Error('replica_full_cli_inquiry_bound_required');return delivered({status:'observed',authority:'fresh-owned-native-submission',remoteWrites:0,value:await deps.inspectInquirySubmission(bound,flags['element-id'],flags['test-marker'])}); }
    if (command === 'amend-unwritten-body-style') return delivered(await installBodyStyleAmendment({ directory, lockId, manifest, state: state!, amendment: amendment!, dependencies: deps, writeState: next => writeState(directory, next) }));
    if (['reconcile','recover-style'].includes(command)) return delivered(await deliverState(await reconcileFullReplica(manifest, deps, state!)));
    if (command === 'rebase-current-draft') return delivered(await deliverState(await rebaseFullReplicaCurrentDraft(manifest, deps, state!, flags['expected-fingerprint'], flags['current-body-hash'], flags['current-document-hash'])));
    if (command === 'revise-native-motion') return delivered(await deliverState(await reviseFullReplicaNativeMotion(manifest, deps, state!, flags['expected-fingerprint'])));
    if (command === 'revise-layout') { const file = await checkedPath(flags.plan), info = await lstat(file); if (!info.isFile() || info.size > 64 * 1024) throw Error('replica_full_cli_layout_invalid'); containerTreePlanSchema.parse(await jsonFile(file)); const plan = { path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }; return delivered(await deliverState(await reviseFullReplicaLayout(manifest, deps, state!, plan, flags['expected-fingerprint']))); }
    if (command === 'revise-navigation-return') return delivered(await deliverState(await reviseFullReplicaNavigationReturn(manifest, deps, state!, flags['expected-fingerprint'])));
    if (['revise-style', 'revise-header-style'].includes(command)) { const file = await checkedPath(flags.css), info = await lstat(file); if (!info.isFile() || info.size > 1024 * 1024) throw Error('replica_full_cli_css_invalid'); const css = { path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }, revise = command === 'revise-header-style' ? reviseFullReplicaHeaderStyle : reviseFullReplicaStyle; return delivered(await deliverState(await revise(manifest, deps, state!, css, flags['expected-fingerprint']))); }
    const reviewInput = command === 'review' ? await jsonFile(flags.evidence) : undefined;
    const result = await runFullReplica(manifest, deps, { ...(state ? { state } : {}), ...(reviewInput === undefined ? {} : { reviewInput }), publish: command === 'publish' });
    return delivered('kind' in result && result.kind === 'clonewp-full-replica-run' ? await deliverState(result) : result);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') outcome = 'cancelled';
    throw error;
  } finally {
    try { await raw?.close?.(); }
    catch (error) { outcome = 'failed'; throw error; }
    finally {
      try { await timing.finish(outcome); }
      finally { const current = await jsonFile(lock) as { lockId: string }; if (current.lockId !== lockId) throw Error('replica_full_cli_lock_changed'); await unlink(lock); }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2), result = await runFullReplicaCLI(args); console.log(JSON.stringify(result, null, 2));
    const status = result && typeof result === 'object' && 'status' in result ? result.status : undefined;
    if (args[0] !== 'status' && status === 'write-unknown') process.exitCode = 2;
    else if (args[0] !== 'status' && ['awaiting-review', 'review-changes-required'].includes(String(status))) process.exitCode = 3;
  }
  catch (error) { const message = error instanceof Error ? error.message : ''; console.error(JSON.stringify({ error: /^(?:replica_full|woodmart_header|workspace)_[A-Za-z0-9_-]+$/.test(message) ? message : 'replica_full_cli_failed' })); process.exitCode = 1; }
}

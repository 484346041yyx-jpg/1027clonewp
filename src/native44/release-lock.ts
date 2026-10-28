import { productExtensionWidgetTypes } from './product-extension.js';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { activeVerifiedEvidenceReader } from '../core/verified-evidence.js';
import { z } from 'zod';
import { acquireLock, writeJson } from '../core/files.js';
import { canonicalV2, hashV2 } from '../replica-v2/journal.js';
import type { FileRef } from '../replica-v2/types.js';
import type { SystemRelease } from '../system/contracts.js';
import { readCurrentRelease, readLearningReleases } from '../components/registry.js';
import { NATIVE44_CATALOG_HASH } from './catalog.js';
import { assertProductExtensionReference, readProductExtension } from './product-extension.js';
import { DESKTOP_BROWSER_PROFILE } from './profile.js';
import type { Native44Program } from './types.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/), ref = z.object({ path: z.string().min(1), sha256: hash }).strict();
const releaseSchema = z.object({
  componentExtension: ref.optional(),
  version: z.literal(1), executorId: z.literal('native44'),
  componentSet: z.object({ id: z.string().min(1), catalog: ref, types: z.array(z.string()).min(44).max(57) }).strict(),
  knowledge: z.object({ id: z.string().min(1), index: ref, fingerprint: hash, learningRelease: ref.optional() }).strict(),
  selectionRules: z.object({ id: z.string().min(1), sha256: hash, files: z.array(ref).min(1) }).strict(),
  adapters: z.object({ id: z.string().min(1), sha256: hash, files: z.array(ref).min(1) }).strict(),
}).strict();
const inputs = z.object({ componentExtension: ref.optional(),componentCatalog: ref, knowledge: ref.extend({ fingerprint: hash }), sourceFacts: ref, componentPlan: ref, assetsManifest: ref }).strict();
const lockSchema = z.object({ version: z.literal(1), kind: z.literal('native44-release-lock'), phase: z.enum(['draft', 'final']), taskId: z.string().min(1), replicationProfile: z.literal(DESKTOP_BROWSER_PROFILE), createdAt: z.iso.datetime(), release: releaseSchema, program: ref.optional(), inputs: inputs.optional() }).strict();
export type Native44ReleaseLock = z.infer<typeof lockSchema>;
export interface Native44ReleaseProgram { filename: string; sha256: string; program: Native44Program }

async function verified(root: string, reference: FileRef, base = root): Promise<Buffer> {
  const actualRoot = await realpath(root), filename = await realpath(path.resolve(base, reference.path)), relative = path.relative(actualRoot, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('native44_release_reference_escaped_project');
  const info = await stat(filename); if (!info.isFile() || info.size > 64 * 1024 * 1024) throw Error('native44_release_reference_not_bounded_file');
  const reader = activeVerifiedEvidenceReader(actualRoot); if (reader) return reader.read({ path: filename, sha256: reference.sha256 }, 64 * 1024 * 1024);
  const bytes = await readFile(filename); if (hashV2(bytes) !== reference.sha256) throw Error(`native44_release_reference_changed: ${reference.path}`); return bytes;
}
function absoluteRef(base: string, reference: FileRef): FileRef { return { ...reference, path: path.resolve(base, reference.path) }; }
function inputRefs(program: Native44Program, base: string, root:string) {
  return { ...(program.componentExtension?{componentExtension:absoluteRef(root,program.componentExtension)}:{}),componentCatalog: absoluteRef(base, program.componentCatalog), knowledge: { ...absoluteRef(base, program.knowledge), fingerprint: program.knowledge.fingerprint }, sourceFacts: absoluteRef(base, program.sourceFacts), componentPlan: absoluteRef(base, program.componentPlan), assetsManifest: absoluteRef(base, program.assetsManifest) };
}
/** Append-only learning changes which knowledge is selected for a new task;
 * they do not change the production writer's executable contracts. */
export function native44ExecutableReleaseIdentity(release: SystemRelease): SystemRelease {
  const { learningRelease: _learningRelease, ...knowledge } = release.knowledge;
  return { ...release, knowledge };
}
/** Reads immutable local bytes only. A lock cannot add component permissions.
 * Drift fails explicitly; it never updates an old lock to the current release. */
export async function readNative44ReleaseLock(root: string, reference: FileRef, expected: { taskId?: string; program?: Native44ReleaseProgram } = {}): Promise<Native44ReleaseLock> {
  const lock = lockSchema.parse(JSON.parse((await verified(root, reference)).toString('utf8')));
  if (expected.taskId && lock.taskId !== expected.taskId || lock.phase === 'draft' && (lock.program || lock.inputs) || lock.phase === 'final' && (!lock.program || !lock.inputs)) throw Error('native44_release_lock_identity_invalid');
  if(lock.release.componentExtension){assertProductExtensionReference(lock.release.componentExtension);await readProductExtension(lock.release.componentExtension,root);}
  if (lock.release.componentSet.catalog.sha256 !== NATIVE44_CATALOG_HASH || canonicalV2(lock.release.componentSet.types) !== canonicalV2(productExtensionWidgetTypes(lock.release.componentExtension))) throw Error('native44_release_cannot_expand_enabled_components');
  // Validate both identity and actual executable/source bytes. Self-authored
  // JSON cannot substitute an invented adapter or omit part of its contract.
  for (const file of [lock.release.componentSet.catalog, lock.release.knowledge.index, ...lock.release.selectionRules.files, ...lock.release.adapters.files]) await verified(root, file);
  const current = await readCurrentRelease(root, { learningRelease: null,componentExtension:lock.release.componentExtension??null });
  if (canonicalV2(native44ExecutableReleaseIdentity(lock.release)) !== canonicalV2(native44ExecutableReleaseIdentity(current))) throw Error('native44_release_locked_contract_drift: restore the exact frozen contracts; no automatic migration');
  await readLearningReleases(root, lock.release.knowledge.fingerprint, { release: lock.release.knowledge.learningRelease ?? null, verifyEvidence: true });
  if (lock.phase === 'final') {
    await verified(root, lock.program!);
    for (const reference of Object.values(lock.inputs!)) await verified(root, reference);
    const program = JSON.parse((await verified(root, lock.program!)).toString('utf8')) as Native44Program;
    if (program.taskId !== lock.taskId || program.replicationProfile !== lock.replicationProfile || program.selectionRulesHash !== lock.release.selectionRules.sha256 || program.knowledge.fingerprint !== lock.release.knowledge.fingerprint || program.knowledge.sha256 !== lock.release.knowledge.index.sha256 || program.componentCatalog.sha256 !== lock.release.componentSet.catalog.sha256 || canonicalV2(inputRefs(program, path.dirname(lock.program!.path),root)) !== canonicalV2(lock.inputs)) throw Error('native44_release_program_contracts_disagree');
  }
  if (expected.program && lock.phase === 'final' && (path.resolve(lock.program!.path) !== path.resolve(expected.program.filename) || lock.program!.sha256 !== expected.program.sha256 || canonicalV2(inputRefs(expected.program.program, path.dirname(expected.program.filename),root)) !== canonicalV2(lock.inputs))) throw Error('native44_release_program_changed');
  return lock;
}

/** Historical evidence for an already saved, owned revision. This does not
 * qualify the old executable adapters for any new write. The original lock,
 * program and every source input must still have their exact stored bytes;
 * current source-code files are intentionally not substituted for old code. */
export async function readNative44HistoricalReleaseEvidence(root: string, reference: FileRef, expected: { taskId: string; programHash: string }): Promise<Native44ReleaseLock> {
  const actualRoot = await realpath(root), taskDir = path.join(actualRoot, 'references', expected.taskId);
  if (!/^[a-zA-Z\d][a-zA-Z\d_-]{0,159}$/.test(expected.taskId) || path.resolve(actualRoot, reference.path) !== path.join(taskDir, 'release-lock.json')) throw Error('native44_release_historical_owner_invalid');
  const lock = lockSchema.parse(JSON.parse((await verified(actualRoot, reference)).toString('utf8')));
  if (lock.phase !== 'final' || lock.taskId !== expected.taskId || !lock.program || !lock.inputs || lock.program.sha256 !== expected.programHash || path.resolve(actualRoot, lock.program.path) !== path.join(taskDir, 'program.json')) throw Error('native44_release_historical_identity_invalid');
  if (lock.release.componentSet.catalog.sha256 !== NATIVE44_CATALOG_HASH || canonicalV2(lock.release.componentSet.types) !== canonicalV2(productExtensionWidgetTypes(lock.release.componentExtension))) throw Error('native44_release_cannot_expand_enabled_components');
  if(lock.release.componentExtension)await readProductExtension(lock.release.componentExtension,actualRoot);
  // Validate source-reference ownership before reading any input, including
  // aliases. Historical metadata cannot redirect this reader to configuration.
  const sourceNames = { sourceFacts: ['source-facts.json'], componentPlan: ['component-plan.json'], assetsManifest: ['assets-manifest.json', 'asset-manifest.json'] } as const;
  for (const [kind, names] of Object.entries(sourceNames)) if (!names.some(name => path.resolve(actualRoot, lock.inputs![kind as keyof typeof sourceNames].path) === path.join(taskDir, name))) throw Error('native44_release_historical_input_owner_invalid');
  if (path.resolve(actualRoot, lock.inputs.componentCatalog.path) !== path.join(actualRoot, 'config', 'native44-component-set.json') || path.resolve(actualRoot, lock.inputs.knowledge.path) !== path.join(actualRoot, 'data', 'native44', 'index.json')) throw Error('native44_release_historical_input_owner_invalid');
  const program = JSON.parse((await verified(actualRoot, lock.program)).toString('utf8')) as Native44Program;
  for (const input of Object.values(lock.inputs)) await verified(actualRoot, input);
  if (program.taskId !== lock.taskId || program.replicationProfile !== lock.replicationProfile || program.selectionRulesHash !== lock.release.selectionRules.sha256 || program.knowledge.fingerprint !== lock.release.knowledge.fingerprint || program.knowledge.sha256 !== lock.release.knowledge.index.sha256 || program.componentCatalog.sha256 !== lock.release.componentSet.catalog.sha256 || canonicalV2(inputRefs(program, taskDir,actualRoot)) !== canonicalV2(lock.inputs)) throw Error('native44_release_program_contracts_disagree');
  return lock;
}
export async function createNative44ReleaseDraft(root: string, jobDir: string, taskId: string): Promise<FileRef> {
  const filename = path.join(jobDir, 'release-draft.json'), release: SystemRelease = await readCurrentRelease(root);
  const actualRoot = await realpath(root), actualJob = await realpath(jobDir), relative = path.relative(path.join(actualRoot, 'references'), actualJob);
  if (relative !== taskId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(taskId)) throw Error('native44_release_requires_owned_task_directory');
  const unlock = await acquireLock(jobDir);
  try {
    try { const previous = await readFile(filename), reference = { path: filename, sha256: hashV2(previous) }; await readNative44ReleaseLock(root, reference, { taskId }); return reference; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const lock: Native44ReleaseLock = { version: 1, kind: 'native44-release-lock', phase: 'draft', taskId, replicationProfile: DESKTOP_BROWSER_PROFILE, createdAt: new Date().toISOString(), release };
    await writeJson(filename, lock); return { path: filename, sha256: hashV2(await readFile(filename)) };
  } finally { await unlock(); }
}
export async function readNative44JobReleaseLock(root: string, jobDir: string, binding: Native44ReleaseProgram): Promise<FileRef | undefined> {
  const job = JSON.parse(await readFile(path.join(jobDir, 'job.json'), 'utf8')) as { releaseLock?: FileRef };
  if (!job.releaseLock) { await assertNoOrphanedNative44Release(jobDir); return undefined; }
  await readNative44ReleaseLock(root, job.releaseLock, { taskId: binding.program.taskId, program: binding });
  return job.releaseLock;
}
async function assertNoOrphanedNative44Release(jobDir: string): Promise<void> {
  for (const name of ['release-draft.json', 'release-lock.json']) {
    try { await stat(path.join(jobDir, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw Error('native44_release_ref_missing_with_existing_lock; task cannot downgrade to a historical path');
  }
}
/** The job's marker carries the optional reference. Historical jobs have none
 * and are never rewritten just because a new default exists. */
export async function prepareNative44ReleaseLock(root: string, jobDir: string, binding: Native44ReleaseProgram): Promise<FileRef | undefined> {
  const jobFile = path.join(jobDir, 'job.json'), candidate = JSON.parse(await readFile(jobFile, 'utf8')) as { releaseLock?: FileRef };
  if (!candidate.releaseLock) { await assertNoOrphanedNative44Release(jobDir); return undefined; }
  const actualRoot = await realpath(root), actualJob = await realpath(jobDir);
  if (path.relative(path.join(actualRoot, 'references'), actualJob) !== binding.program.taskId) throw Error('native44_release_requires_owned_task_directory');
  // Separate from the remote-operation lock: finalization happens before
  // credentials. Cooperative parallel generators cannot freeze two programs.
  const unlock = await acquireLock(jobDir);
  try {
  const before = await readFile(jobFile), job = JSON.parse(before.toString('utf8')) as { taskId: string; releaseLock?: FileRef; [key: string]: unknown };
  if (!job.releaseLock) throw Error('native44_release_job_changed_before_freeze');
  const existing = await readNative44ReleaseLock(root, job.releaseLock, { taskId: binding.program.taskId, program: binding });
  if (existing.phase === 'final') return job.releaseLock;
  if (binding.program.replicationProfile !== DESKTOP_BROWSER_PROFILE || binding.program.selectionRulesHash !== existing.release.selectionRules.sha256 || binding.program.componentCatalog.sha256 !== existing.release.componentSet.catalog.sha256 || binding.program.knowledge.sha256 !== existing.release.knowledge.index.sha256 || binding.program.knowledge.fingerprint !== existing.release.knowledge.fingerprint) throw Error('native44_release_draft_does_not_match_program');
  if (hashV2(await readFile(binding.filename)) !== binding.sha256) throw Error('native44_release_program_changed_before_freeze');
  const lock: Native44ReleaseLock = { ...existing, phase: 'final', program: { path: path.resolve(binding.filename), sha256: binding.sha256 }, inputs: inputRefs(binding.program, jobDir,root) };
  for (const reference of Object.values(lock.inputs!)) await verified(root, reference);
  const filename = path.join(jobDir, 'release-lock.json');
  try { const previous = await readFile(filename); if (canonicalV2(JSON.parse(previous.toString('utf8'))) !== canonicalV2(lock)) throw Error('native44_release_final_already_exists_with_other_program'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeJson(filename, lock); }
  const reference = { path: filename, sha256: hashV2(await readFile(filename)) };
  if (!(await readFile(jobFile)).equals(before)) throw Error('native44_release_job_changed_during_freeze');
  await writeJson(jobFile, { ...job, releaseLock: reference });
  return reference;
  } finally { await unlock(); }
}
export function assertNative44ReleaseIdentity(...references: Array<FileRef | undefined>): void {
  if (references.some(reference => canonicalV2(reference ?? null) !== canonicalV2(references[0] ?? null))) throw Error('native44_release_identity_differs; existing task preserved');
}

import path from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { writeJson } from '../core/files.js';
import { documentHashV2, ensureDiskSpaceV2, newMutationIntentV2, reconcileMutationV2, retryReadV2, writeSnapshotRefV2, type MutationIntentV2 } from '../replica-v2/journal.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import type { DraftSnapshot, LegacySchema } from '../wordpress/types.js';
import type { Native44Compiled, Native44Program } from './types.js';
import type { WordPressClient } from '../wordpress/client.js';
import { assertNative44ProfileIdentity } from './profile.js';
import { assertNative44Compilation } from './compiler.js';
import type { FileRef } from '../replica-v2/types.js';
import { assertNative44ReleaseIdentity } from './release-lock.js';
import { assertNative44OriginalRunWritable } from './current-state.js';
import type { FinalDeliveryPolicy } from '../core/delivery-policy.js';

export interface Native44Journal {
  editorCompletionPolicy?: { version: 1; mode: 'align-and-reopen'; runtime?: 'shared-owned-editor-v1' };
  articleListPolicy?: 'target-posts-v1';
  reviewWorkflow?: 'whole-page-after-css-v1';
  version: 2; workflow: 'block-replication'; executionStrategy: 'native44-css-handoff'; taskId: string; runId: string; runDir: string; targetUrl: string;
  programHash: string; sourceFactsHash: string; componentPlanHash: string; assetsManifestHash: string;
  componentCatalog: Native44Program['componentCatalog']; knowledge: Native44Program['knowledge']; targetEnvironment: Native44Program['targetEnvironment'];
  replicationProfile?: Native44Program['replicationProfile']; selectionRulesHash?: string;
  goalProfile?: Native44Program['goalProfile'];
  finalDeliveryPolicy?: FinalDeliveryPolicy;
  releaseLock?: FileRef;
  environmentPolicy?:'component-contract';actualVersions?:Record<string,string>;environmentContractHash?:string;schemaContractHash?:string;sourceContractHash?:string;
  status: 'running' | 'failed' | 'write-unknown' | 'conflict' | 'draft-saved' | 'awaiting-comparison' | 'delivered';
  pageId?: number; editUrl?: string; previewUrl?: string; documentHash?: string; createdAt: string; updatedAt: string;
  mutations: MutationIntentV2[]; deliveryComplete: boolean; visualVerification: 'pending-comparison' | 'pending-css-application' | 'applied-verified';
  metrics: Record<string, number>; error?: string;
}
export async function saveNative44Journal(journal: Native44Journal): Promise<void> {
  await ensureDiskSpaceV2(path.resolve(journal.runDir, '..', '..'));
  journal.updatedAt = new Date().toISOString();
  await writeJson(path.join(journal.runDir, 'journal.json'), journal);
}
export function assertNative44Resume(journal: Native44Journal, program: Native44Program, programHash: string, targetUrl: string, releaseLock?: FileRef): void {
  if (journal.articleListPolicy !== program.articleListPolicy) throw Error('native44 resume article list policy changed; existing draft is preserved');
  if (journal.reviewWorkflow !== program.reviewWorkflow) throw Error('native44 resume review workflow changed; existing draft is preserved');
  assertNative44ReleaseIdentity(journal.releaseLock, releaseLock);
  assertNative44ProfileIdentity(journal.replicationProfile, program.replicationProfile);
  if (journal.goalProfile !== program.goalProfile) throw Error('native44 resume goal profile changed; existing draft is preserved');
  if (journal.selectionRulesHash !== program.selectionRulesHash) throw Error('native44 resume selection rules changed; existing draft is preserved');
  if (journal.executionStrategy !== 'native44-css-handoff' || journal.taskId !== program.taskId || journal.programHash !== programHash || journal.targetUrl !== targetUrl || JSON.stringify(journal.componentCatalog) !== JSON.stringify(program.componentCatalog) || JSON.stringify(journal.knowledge) !== JSON.stringify(program.knowledge) || JSON.stringify(journal.targetEnvironment) !== JSON.stringify(program.targetEnvironment)) throw Error('native44 resume identity changed; existing draft is preserved');
}
/** A normal run has one successful full-body commit. Response loss is reconciled, never blindly retried. */
export async function saveNative44Body(options: { client: Pick<WordPressClient, 'snapshotDraft' | 'buildDraft'>; journal: Native44Journal; baseline: DraftSnapshot; compiled: Native44Compiled; schemas: Record<string, LegacySchema> }): Promise<DraftSnapshot> {
  const { client, journal, compiled, schemas } = options;
  await assertNative44OriginalRunWritable(path.resolve(journal.runDir, '..', '..'), journal.runDir);
  assertNative44Compilation(compiled, compiled.composition);
  assertNative44ProfileIdentity(journal.replicationProfile, compiled.replicationProfile);
  if (journal.selectionRulesHash !== compiled.selectionRulesHash) throw Error('Body journal and compiled selection rules identity differ');
  if (journal.articleListPolicy !== compiled.articleListPolicy) throw Error('Body journal and compiled article list policy identity differ');
  if (journal.deliveryComplete || journal.status === 'delivered') throw Error('CSS handoff freezes automatic draft writes');
  if (journal.status === 'conflict' || journal.mutations.some(item=>['conflict','restore-pending'].includes(item.status))) throw Error('An unresolved document conflict or restoration blocks automatic writes');
  if (options.baseline.runId!==journal.runId||options.baseline.pageId!==journal.pageId||options.baseline.status!=='draft'||documentHashV2(options.baseline.elements,options.baseline.settings)!==options.baseline.hash) throw Error('Invalid complete-body baseline identity or hash');
  const current = await retryReadV2(() => client.snapshotDraft(options.baseline.pageId));
  if (current.runId !== journal.runId || current.pageId !== journal.pageId || current.status !== 'draft' || documentHashV2(current.elements,current.settings)!==current.hash) throw Error('Draft ownership or snapshot hash changed');
  const pendings = journal.mutations.filter(item => ['intent', 'write-unknown', 'retryable'].includes(item.status));
  if (pendings.length>1||journal.mutations.filter(item=>item.status==='confirmed').length>1)throw Error('A complete-body run cannot contain multiple successful or unresolved body commits');
  const pending=pendings[0];
  if (pending) {
    const decision = reconcileMutationV2(pending, current); await saveNative44Journal(journal);
    if (decision === 'confirmed') { journal.documentHash = current.hash; journal.status = 'draft-saved'; await saveNative44Journal(journal); return current; }
    if (decision === 'conflict') { journal.status = 'conflict'; await saveNative44Journal(journal); throw Error('Concurrent document content differs from before/after; preserved'); }
  }
  if (journal.mutations.some(item => item.status === 'confirmed')) {
    if (current.hash !== journal.documentHash) throw Error('Saved draft changed after generation; no second body commit');
    return current;
  }
  if (!pending&&current.elements.length)throw Error('Owned draft contains existing content before its first body intent; preserved');
  if (current.hash !== options.baseline.hash) throw Error('Draft changed before the complete-body commit');
  const elements = compileEditorElements(compiled.composition.elements, schemas, { executionStrategy: 'native44-css-handoff' });
  const settings = { ...current.settings, ...compiled.composition.pageSettings }, afterHash = documentHashV2(elements, settings);
  if (pending && pending.expectedAfterHash !== afterHash) throw Error('Resume compiler output differs from the durable write intent');
  const intent = pending ?? newMutationIntentV2({ kind: 'document-save', checkpoint: 'complete-body', pageId: current.pageId, runId: current.runId, beforeHash: current.hash, expectedAfterHash: afterHash, affectedBlockKeys: compiled.sections.map(item => item.key) });
  await ensureDiskSpaceV2(await realpath(path.resolve(journal.runDir, '..', '..')));
  await mkdir(path.join(journal.runDir, 'mutations'), { recursive: true });
  await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${intent.id}-before.json`), current);
  await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${intent.id}-expected.json`), { ...current, elements, settings, hash: afterHash });
  if (!pending) journal.mutations.push(intent);
  intent.status='intent';
  journal.metrics.bodyWriteAttempts=(journal.metrics.bodyWriteAttempts??0)+1;
  await saveNative44Journal(journal);
  try {
    await client.buildDraft(current.pageId, compiled.composition, undefined, { expectedCurrent: current, htmlProofs: compiled.htmlProofs, preserveUnknownWrite: true, native44Proof: compiled });
    const actual = await retryReadV2(() => client.snapshotDraft(current.pageId));
    if (reconcileMutationV2(intent, actual) !== 'confirmed') throw Error('Complete-body readback differs from expected output');
    journal.documentHash = actual.hash; journal.status = 'draft-saved'; await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'target', 'accepted-snapshot.json'), actual); await saveNative44Journal(journal); return actual;
  } catch (error) {
    intent.status = 'write-unknown'; journal.status = 'write-unknown'; await saveNative44Journal(journal);
    const actual = await retryReadV2(() => client.snapshotDraft(current.pageId)).catch(() => undefined);
    if (actual) {
      const decision = reconcileMutationV2(intent, actual);
      if (decision === 'confirmed') { journal.documentHash = actual.hash; journal.status = 'draft-saved'; await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'target', 'accepted-snapshot.json'), actual); await saveNative44Journal(journal); return actual; }
      if (decision === 'conflict') { journal.status = 'conflict'; await saveNative44Journal(journal); throw Error('Concurrent document content differs from before/after; preserved',{cause:error}); }
      await saveNative44Journal(journal);
    }
    throw error;
  }
}

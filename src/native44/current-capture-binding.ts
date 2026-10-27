import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { assertKnownNativeWidget as assertAllowedWidget } from './catalog.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareManifest } from './compare.js';
import { readNative44CurrentState, type Native44CurrentState } from './current-state.js';
import { assertNative44ReleaseIdentity, readNative44HistoricalReleaseEvidence } from './release-lock.js';
import { canonicalV2, documentHashV2, hashV2 } from '../replica-v2/journal.js';
import type { DraftSnapshot, ElementorElement } from '../wordpress/types.js';

const fingerprintKeys = ['documentHash', 'structureHash', 'resourceHash', 'queryHash', 'pageCss'] as const;
export const sameNative44CurrentFingerprint = (left: ReturnType<typeof fingerprintNative44Snapshot>, right: ReturnType<typeof fingerprintNative44Snapshot>) => fingerprintKeys.every(key => left[key] === right[key]);

export async function readNative44CurrentCompareInput(root: string, state: Native44CurrentState) {
  const bytes = await readFile(state.currentSnapshot.path);
  if (hashV2(bytes) !== state.currentSnapshot.sha256) throw Error('native44_current_snapshot_changed_during_compare');
  const snapshot = JSON.parse(bytes.toString('utf8')) as DraftSnapshot;
  if (snapshot.pageId !== state.pageId || snapshot.runId !== state.runId || snapshot.status !== 'draft' || snapshot.hash !== state.documentHash || documentHashV2(snapshot.elements, snapshot.settings) !== snapshot.hash) throw Error('native44_current_snapshot_identity_changed_during_compare');
  const journal = JSON.parse(await readFile(path.join(root, 'runs', state.runId, 'journal.json'), 'utf8'));
  const lock = journal.releaseLock ? await readNative44HistoricalReleaseEvidence(root, journal.releaseLock, { taskId: state.taskId, programHash: journal.programHash }) : undefined;
  if (!lock || journal.taskId !== state.taskId || journal.runId !== state.runId || journal.pageId !== state.pageId || journal.documentHash !== state.originalDocumentHash) throw Error('native44_current_historical_release_binding_missing');
  const widgetTypes = new Set<string>();
  const walk = (nodes: ElementorElement[]) => nodes.forEach(node => { if (node.elType === 'container') widgetTypes.add('container'); if (node.widgetType) widgetTypes.add(node.widgetType); if (node.elements) walk(node.elements); }); walk(snapshot.elements);
  for (const type of widgetTypes) assertAllowedWidget(type);
  let manifest: Native44CompareManifest | undefined;
  if (state.currentManifest) { const bytes = await readFile(state.currentManifest.path); if (hashV2(bytes) !== state.currentManifest.sha256) throw Error('native44_current_manifest_changed_during_compare'); manifest = JSON.parse(bytes.toString('utf8')); }
  return { snapshot, journal, lock, widgetTypes: [...widgetTypes], fingerprint: fingerprintNative44Snapshot(snapshot), manifest };
}

/** Validate frozen read-only evidence before credentials. This grants no new
 * component capability, task goal, generation or delivery authority. */
export async function bindNative44CurrentCompareManifest(root: string, manifest: Native44CompareManifest) {
  if (!/^[A-Za-z\d_-]{4,100}$/.test(manifest.runId)) throw Error('Invalid native44 comparison run identity');
  const state = await readNative44CurrentState(root, path.join(root, 'runs', manifest.runId), { taskId: manifest.taskId, runId: manifest.runId, pageId: manifest.pageId });
  if (!state) return undefined;
  const input = await readNative44CurrentCompareInput(root, state);
  if (input.manifest && canonicalV2(input.manifest) !== canonicalV2(manifest)) throw Error('native44_current_manifest_not_bound_to_revision');
  assertNative44ReleaseIdentity(input.journal.releaseLock, manifest.releaseLock);
  if (!sameNative44CurrentFingerprint(input.fingerprint, manifest)) throw Error('native44_current_manifest_not_current: complete current snapshot fingerprint and CSS are required; original manifest is historical.');
  if (manifest.selectionRulesHash !== input.lock.release.selectionRules.sha256 || manifest.replicationProfile !== input.lock.replicationProfile || new URL(manifest.targetUrl).origin !== new URL(input.journal.targetUrl).origin) throw Error('native44_current_manifest_contract_conflict');
  const program = JSON.parse(await readFile(path.resolve(root, input.lock.program!.path), 'utf8'));
  if (manifest.sourceUrl !== program.sourceUrl || [...input.widgetTypes].sort().join(',') !== [...manifest.widgetTypes].sort().join(',')) throw Error('native44_current_manifest_source_or_widget_conflict');
  validateNative44CompareManifest(manifest, input.lock.release.selectionRules.sha256);
  const factsRef = input.lock.inputs!.sourceFacts, factsBytes = await readFile(path.resolve(root, factsRef.path));
  if (hashV2(factsBytes) !== factsRef.sha256) throw Error('native44_current_source_facts_changed_during_compare');
  const facts = JSON.parse(factsBytes.toString('utf8'));
  if (facts.sourceUrl !== manifest.sourceUrl || !Array.isArray(facts.snapshots) || facts.snapshots.length !== 2 || manifest.sourceCaptures?.sourceFacts.sha256 !== factsRef.sha256 || manifest.sourceCaptures?.componentPlan.sha256 !== input.lock.inputs!.componentPlan.sha256) throw Error('native44_current_source_identity_conflict');
  const sourceViewports = facts.snapshots.map((item: any) => item.viewport as { width: number; height: number; clientWidth: number; scrollbarWidth: number });
  for (const view of sourceViewports) if (![view.width, view.clientWidth, view.scrollbarWidth].every(Number.isFinite) || view.clientWidth <= 0 || view.scrollbarWidth < 0 || Math.abs(view.width - view.clientWidth - view.scrollbarWidth) > 1) throw Error('Source scrollbar configuration is not an actual consistent viewport observation');
  if (!sourceViewports.every((view: { width: number; height: number }) => manifest.viewports?.some(required => required.width === view.width && required.height === view.height))) throw Error('native44_current_source_viewports_conflict');
  return { state, ...input, sourceViewports };
}

/** Explicit current capture may inspect a frozen v1 task only when that run
 * already contains a manifest for the exact complete current snapshot. Keep its
 * raw bytes to freeze into the new review directory; never repair it in place. */
export async function readNative44CurrentCaptureManifest(root: string, runDir: string, state: Native44CurrentState) {
  if (state.runId !== path.basename(runDir) || path.resolve(runDir) !== path.resolve(root, 'runs', state.runId)) throw Error('native44_current_capture_run_identity_conflict');
  const manifestPath = state.currentManifest?.path ?? path.join(runDir, 'compare-manifest.json');
  if (await realpath(manifestPath) !== path.resolve(manifestPath)) throw Error('native44_current_capture_manifest_alias');
  const manifestBytes = await readFile(manifestPath), manifestRef = { path: manifestPath, sha256: hashV2(manifestBytes) };
  if (state.currentManifest && manifestRef.sha256 !== state.currentManifest.sha256) throw Error('native44_current_manifest_changed_during_capture');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Native44CompareManifest;
  const binding = await bindNative44CurrentCompareManifest(root, manifest);
  if (!binding || binding.state.taskId !== state.taskId || binding.state.runId !== state.runId || binding.state.pageId !== state.pageId || binding.state.documentHash !== state.documentHash || binding.state.currentSnapshot.sha256 !== state.currentSnapshot.sha256 || binding.state.currentCSS.sha256 !== state.currentCSS.sha256) throw Error('native44_current_capture_manifest_identity_conflict');
  return { manifest, manifestBytes, manifestRef, binding, legacy: !state.axes };
}

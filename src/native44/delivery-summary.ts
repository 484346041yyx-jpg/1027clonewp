import { runResources } from '../workspace/operation-resources.js';
import path from 'node:path';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { acquireLock } from '../core/files.js';
import { canonicalV2, hashV2, readSnapshotRefV2 } from '../replica-v2/journal.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareManifest } from './compare.js';
import { readNative44HistoricalReleaseEvidence } from './release-lock.js';
import { canonicalNative44CSS, native44CSSHash } from './css-handoff.js';
import { normalizeNative44CurrentReviewReport, readNative44CurrentState, reuseNative44CurrentStateForDelivery, type Native44CurrentRef, type Native44CurrentState } from './current-state.js';
import { Native44RequirementContractSchema, Native44AcceptanceObservationSchema, type Native44RequirementContract, type Native44AcceptanceObservation } from './requirements.js';
import type { Native44CurrentReviewNotes } from './current-review-contract.js';
import { readNative44Publication, type Native44PublicationState } from './publication.js';
import { editorCompletionGate } from '../editor-completion/store.js';

export interface Native44DeliveryEntry {
  region: string; issue: string; impact: string; nextAction: string; evidence: Native44CurrentRef[];
  requirementId?: string; checkId?: string; componentKeys?: string[]; severity?: string;
}
export interface Native44DeliveryRemoteObservation {
  taskId: string; runId: string; pageId: number; documentHash?: string;
  status: 'owned-draft-current' | 'owned-published-current' | 'changed' | 'ineligible'; observedAt: string; readOnly: true;
}
export interface Native44DeliverySummary {
  version: 1; kind: 'native44-delivery-summary'; taskId: string; runId: string; pageId: number;
  documentHash: string; cssHash: string; generatedAt: string; goalProfile: string;
  deliveryComplete: boolean; requirementsComplete: boolean | null; status: string;
  draftReady?: boolean; deliveryReady?: boolean;
  publication?: Native44PublicationState;
  evidenceScope: 'verified-local-current-revision'; remote: Native44DeliveryRemoteObservation | { status: 'not-freshly-observed'; basis: 'local-snapshot-only' };
  axes: { saved: string; css: string; review: string; qualityFloor: string; requirements: string; delivery: string };
  sections: { completedAndVerified: Native44DeliveryEntry[]; unfinished: Native44DeliveryEntry[]; minorIssues: Native44DeliveryEntry[]; unverified: Native44DeliveryEntry[]; productContentReplacement: Native44DeliveryEntry[]; componentExceptions: Native44DeliveryEntry[] };
  identityEvidence: Native44CurrentRef[];
}
const fail = (code: string): never => { throw Error(`native44_delivery_${code}`); };
const refs = (items: Array<Native44CurrentRef | undefined>): Native44CurrentRef[] => [...new Map(items.filter((item): item is Native44CurrentRef => Boolean(item)).map(item => [`${item.path}:${item.sha256}`, { ...item }])).values()];
const inside = (base: string, filename: string) => { const relative = path.relative(base, filename); if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) fail('path_escape'); };

/** Pure presentation of already validated evidence. No business behavior or
 * actual frontend verification is inferred from a locally saved document. */
export function buildNative44DeliverySummary(state: Native44CurrentState, input: { contract?: Native44RequirementContract; observation?: Native44AcceptanceObservation; generatedAt: string; remoteObservation?: Native44DeliveryRemoteObservation }): Native44DeliverySummary {
  const currentCapture = state.currentCaptureReview, requirements = state.axes?.requirements, findings = requirements?.findings ?? [], currentReview = state.axes?.review.status === 'reviewed' || currentCapture?.review === 'reviewed' || !state.axes && state.visualVerification === 'applied-verified';
  if (!Number.isFinite(Date.parse(input.generatedAt))) fail('time_invalid');
  const remote = input.remoteObservation;
  if (remote && (remote.taskId !== state.taskId || remote.runId !== state.runId || remote.pageId !== state.pageId || remote.readOnly !== true || !Number.isFinite(Date.parse(remote.observedAt)) || remote.status === 'owned-draft-current' && remote.documentHash !== state.documentHash)) fail('remote_identity_conflict');
  const summary: Native44DeliverySummary = {
    version: 1, kind: 'native44-delivery-summary', taskId: state.taskId, runId: state.runId, pageId: state.pageId, documentHash: state.documentHash, cssHash: state.axes?.css.canonicalHash ?? state.currentCSS.sha256,
    generatedAt: input.generatedAt, goalProfile: input.contract?.goalProfile ?? currentCapture?.reviewGoal ?? 'historical-strict', deliveryComplete: state.deliveryComplete, requirementsComplete: currentCapture ? false : requirements?.requirementsComplete ?? null, status: state.status, ...(currentCapture ? { draftReady: currentCapture.draftReady, deliveryReady: currentCapture.deliveryReady } : {}),
    evidenceScope: 'verified-local-current-revision', remote: remote ?? { status: 'not-freshly-observed', basis: 'local-snapshot-only' },
    axes: { saved: state.axes?.write.status ?? 'confirmed-local-history', css: state.axes?.css.status ?? 'applied-local-history', review: state.axes?.review.status ?? currentCapture?.review ?? state.visualVerification, qualityFloor: requirements?.qualityFloor.status ?? currentCapture?.qualityFloor.status ?? (state.deliveryComplete ? 'historical-strict-accepted' : 'unverified'), requirements: requirements?.status ?? (currentCapture ? 'historical-frozen-contract-preserved' : 'historical-contract'), delivery: state.axes?.delivery.status ?? (currentCapture ? currentCapture.deliveryReady ? 'draft-ready-with-open-items' : 'not-ready' : state.status) },
    sections: { completedAndVerified: [], unfinished: [], minorIssues: [], unverified: [], productContentReplacement: [], componentExceptions: [] }, identityEvidence: refs([state.currentSnapshot, state.currentCSS, state.currentManifest, state.cssModel, state.verification, state.visualReview, currentCapture?.record]),
  };
  const entry = (region: string, issue: string, impact: string, nextAction: string, evidence: Array<Native44CurrentRef | undefined>): Native44DeliveryEntry => ({ region, issue, impact, nextAction, evidence: refs(evidence) });
  summary.sections.completedAndVerified.push(entry('page', 'Owned draft save and complete CSS are confirmed by the bound local write/readback chain.', 'The complete editable document and stylesheet have a verified saved identity.', 'Preserve this document/CSS identity before further revisions; a local record is not a fresh live-site inspection.', [state.currentSnapshot, state.currentCSS]));
  if (currentReview) summary.sections.completedAndVerified.push(entry('desktop-review', 'Both required desktop screenshot pairs were inspected for this saved revision.', 'Visual review exists; named findings below still determine delivery and requirement completeness.', 'Reuse this review while document, CSS and evidence remain current.', [state.verification, state.visualReview]));
  else summary.sections.unverified.push(entry('desktop-review', 'The required desktop review is missing or stale.', 'Current rendering and interactions cannot be declared verified from local save evidence.', 'Capture and inspect the current saved revision, then bind its report and acceptance observation.', [state.verification, state.visualReview, state.currentSnapshot]));
  if (!remote) summary.sections.unverified.push(entry('live-site', 'This summary did not perform a fresh remote ownership/document/frontend observation.', 'Local historical evidence cannot establish the present live site state.', 'Run a read-only current verification or fresh capture when a current live assessment is needed.', [state.currentSnapshot]));
  else if (!['owned-draft-current', 'owned-published-current'].includes(remote.status)) { summary.deliveryComplete = false; summary.status = 'not-current'; summary.axes.delivery = 'pending'; summary.sections.unverified.push(entry('live-site', `The fresh read-only observation is ${remote.status}.`, 'The saved local revision is not confirmed as the current owned page.', 'Preserve remote changes and resolve the named ownership/document difference before any write or delivery claim.', [state.currentSnapshot])); }
  const contract = input.contract, observationCurrent = currentReview && input.observation?.documentHash === state.documentHash && input.observation?.cssHash === state.axes?.css.canonicalHash;
  for (const finding of findings) {
    const item: Native44DeliveryEntry = { ...entry([finding.sourceKey, finding.location.viewport, finding.location.state, finding.location.scope, finding.location.metric].filter(Boolean).join(' / '), finding.impact, finding.impact, finding.nextAction, [...finding.evidence, state.verification]), requirementId: finding.requirementId, ...(finding.checkId ? { checkId: finding.checkId } : {}), componentKeys: finding.componentKeys, severity: finding.severity };
    if (finding.domain === 'product-substitution') summary.sections.productContentReplacement.push(item);
    else if (finding.domain === 'component-exception') summary.sections.componentExceptions.push(item);
    else if (finding.category === 'unverified') summary.sections.unverified.push(item);
    else if (finding.category === 'minor') summary.sections.minorIssues.push(item);
    else summary.sections.unfinished.push(item);
  }
  for (const deviation of requirements?.deviations ?? []) if (!summary.sections.minorIssues.some(item => item.requirementId === deviation.requirementId && item.checkId === deviation.checkId)) {
    const requirement = input.contract?.requirements.find(item => item.id === deviation.requirementId), check = requirement?.checks.find(item => item.id === deviation.checkId), observed = input.observation?.checks.find(item => item.requirementId === deviation.requirementId && item.checkId === deviation.checkId);
    summary.sections.minorIssues.push({ ...entry([requirement?.sourceKey ?? deviation.requirementId, check?.viewport, check?.scope, check?.metric].filter(Boolean).join(' / '), deviation.reason, `The named difference is recorded under ${deviation.basis}; no absent measurement is assumed.`, 'Retain the accepted difference and editable native component; revisit only if the relevant requirement changes.', [...(observed?.evidence ?? []), state.verification, state.visualReview]), requirementId: deviation.requirementId, ...(deviation.checkId ? { checkId: deviation.checkId } : {}), componentKeys: requirement?.fulfillment.componentKeys ?? [], severity: 'minor' });
  }
  for (const requirement of contract?.requirements ?? []) {
    const fulfillment = requirement.fulfillment, evidence = refs([...requirement.checks.flatMap(check => check.sourceEvidence), ...(fulfillment.route === 'gap' ? [] : [fulfillment.proof]), state.verification, state.visualReview]);
    const base = { requirementId: requirement.id, componentKeys: fulfillment.componentKeys ?? [] };
    if (requirement.disposition === 'target-product-data' && !summary.sections.productContentReplacement.some(item => item.requirementId === requirement.id)) summary.sections.productContentReplacement.push({ ...entry(requirement.sourceKey, 'The native product component uses actual target WooCommerce product content.', 'Specific product names, images and catalog selection may differ; native layout, styles, queries and interactions remain required.', 'Replace concrete target products as desired without removing the source product area or bypassing its native component.', evidence), ...base });
    if (fulfillment.route === 'explicit-adaptation' && !summary.sections.componentExceptions.some(item => item.requirementId === requirement.id)) summary.sections.componentExceptions.push({ ...entry(requirement.sourceKey, fulfillment.reason, 'This named component responsibility uses the explicitly evidenced adaptation.', 'Keep its capability proof and named limits visible when editing or importing.', evidence), ...base });
    if (observationCurrent && fulfillment.route !== 'gap' && !findings.some((finding: any) => finding.requirementId === requirement.id && !['product-substitution', 'component-exception'].includes(finding.domain)) && requirement.checks.every(check => input.observation!.checks.some(item => item.requirementId === requirement.id && item.checkId === check.id && item.outcome === 'pass'))) summary.sections.completedAndVerified.push({ ...entry(requirement.sourceKey, `${requirement.capability}: current required checks passed.`, `The ${requirement.dimension} responsibility has current observed evidence and a bound capability proof.`, 'Preserve its editable native owner and recheck after relevant changes.', evidence), ...base });
  }
  if (!findings.length) for (const issue of requirements?.issues ?? []) summary.sections.unfinished.push({ ...entry(issue.requirementId, issue.message, 'This named requirement has not satisfied the current acceptance contract.', 'Resolve the named requirement or provide its missing current evidence; do not hide or remove the check.', [state.verification]), requirementId: issue.requirementId, ...(issue.checkId ? { checkId: issue.checkId } : {}) });
  if (!state.axes) summary.sections.unverified.push(entry('requirements', 'This historical record has no independent versioned requirement-completeness axis.', 'A strict historical delivery is preserved; it is not automatically migrated to the new delivery goal.', 'Keep its frozen contract or prepare an explicitly authorized versioned revision.', [state.currentSnapshot]));
  if (currentCapture) {
    for (const section of Object.keys(currentCapture.notes) as Array<keyof Native44CurrentReviewNotes>) summary.sections[section].push(...currentCapture.notes[section].map(item => ({ region: item.region, issue: item.issue, impact: item.impact, nextAction: item.nextAction, evidence: refs([...item.evidence, currentCapture.record]) })));
    for (const issue of currentCapture.qualityFloor.issues) {
      const named = summary.sections.unfinished.find(item => `${item.region}: ${item.issue}` === issue);
      if (named) named.evidence = refs([...named.evidence, currentCapture.record, state.verification, state.visualReview]);
      else summary.sections.unfinished.push(entry('quality-floor', issue, 'A current visual, native interaction, product query or capture-evidence failure still blocks draft readiness.', 'Fix the named defect and capture/review the changed revision. Supporting integration notes cannot waive this failure.', [currentCapture.record, state.verification, state.visualReview]));
    }
    const historical = summary.sections.unverified.find(item => item.region === 'requirements');
    if (historical) { historical.issue = 'The current frontend capture was reviewed while the original v1 component plan and capability contract were preserved.'; historical.impact = 'Draft readiness is assessed from current pixels and actual checks. Complete versioned source-requirement/capability coverage is not claimed, and requirementsComplete remains false.'; historical.nextAction = 'Keep the named frontend findings visible. Adopt a versioned current-component contract only through an explicit planning revision when complete capability coverage is needed.'; }
  }
  return summary;
}

export function renderNative44DeliverySummary(summary: Native44DeliverySummary): string {
  const labels: Record<keyof Native44DeliverySummary['sections'], string> = { completedAndVerified: '已完成并验证', unfinished: '未完成 / 待配置', minorIssues: '小问题', unverified: '未验证', productContentReplacement: '商品内容替换', componentExceptions: '组件例外' };
  let markdown = `# Page delivery\n\n- Task / run / page: ${summary.taskId} / ${summary.runId} / ${summary.pageId}\n- Goal: ${summary.goalProfile}\n- Delivery: ${summary.status}; all complete: ${summary.deliveryComplete}${summary.draftReady === undefined ? '' : `; reviewed draft ready: ${summary.draftReady}; review delivery ready: ${summary.deliveryReady}`}\n${summary.publication ? `- Published page: ${summary.publication.publicUrl}\n- Historical reviewed draft: ${summary.publication.draftDocumentHash}; public document: ${summary.publication.documentHash}\n- Publication changes only status; previous visual review remains bound to the historical draft.\n` : ''}- All requirements complete: ${summary.requirementsComplete === null ? 'unknown (historical contract)' : summary.requirementsComplete}\n- Document: ${summary.documentHash}\n- CSS: ${summary.cssHash}\n- Saved / CSS / review / quality / requirements: ${Object.values(summary.axes).join(' / ')}\n- Evidence: verified local revision; remote: ${summary.remote.status}\n- Generated: ${summary.generatedAt}\n`;
  for (const [key, label] of Object.entries(labels)) { markdown += `\n## ${label}\n\n`; const entries = summary.sections[key as keyof typeof labels]; markdown += entries.length ? entries.map(item => `- **${item.region}** — ${item.issue}\n  - 影响：${item.impact}\n  - 后续：${item.nextAction}\n  - 证据：${item.evidence.length ? item.evidence.map(reference => `${reference.path} (sha256 ${reference.sha256})`).join('; ') : '无独立证据；仅为具名未验证项。'}`).join('\n') + '\n' : '无。\n'; }
  return markdown;
}

async function immutable(filename: string, bytes: Buffer): Promise<void> { try { await writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await readFile(filename)).equals(bytes)) fail('immutable_conflict'); } }
async function optional(filename: string): Promise<Buffer | undefined> { try { const info = await stat(filename); if (!info.isFile() || info.size > 64 * 1024 * 1024) fail('artifact_invalid'); return await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }

async function pendingSummary(root: string, runDir: string, generatedAt: string): Promise<{ summary: Native44DeliverySummary; guardPath: string; guardBytes: Buffer }> {
  const read = async (filename: string) => { inside(runDir, filename); if (await realpath(filename) !== filename) fail('reference_alias'); const bytes = await optional(filename); if (!bytes) return fail('pending_evidence_missing'); return { bytes, value: JSON.parse(bytes.toString('utf8')), ref: { path: filename, sha256: hashV2(bytes) } }; };
  const guardPath = path.join(runDir, 'journal.json'), journalFile = await read(guardPath), journal = journalFile.value, manifestFile = await read(path.join(runDir, 'compare-manifest.json')), manifest = manifestFile.value as Native44CompareManifest;
  if (journal.executionStrategy !== 'native44-css-handoff' || journal.runId !== path.basename(runDir) || journal.taskId !== manifest.taskId || journal.runId !== manifest.runId || journal.pageId !== manifest.pageId || !['draft-saved', 'awaiting-comparison', 'delivered'].includes(journal.status) || canonicalV2(journal.releaseLock) !== canonicalV2(manifest.releaseLock) || !Array.isArray(journal.mutations) || !journal.mutations.length || journal.mutations.some((mutation: any) => mutation.status !== 'confirmed') || !journal.mutations.some((mutation: any) => mutation.pageId === journal.pageId && mutation.runId === journal.runId && mutation.expectedAfterHash === journal.documentHash && mutation.observedHash === journal.documentHash)) fail('pending_identity_conflict');
  const lock = journal.releaseLock ? await readNative44HistoricalReleaseEvidence(root, journal.releaseLock, { taskId: journal.taskId, programHash: journal.programHash }) : undefined;
  validateNative44CompareManifest(manifest, lock?.release.selectionRules.sha256);
  const acceptedFile = await read(path.join(runDir, 'target', 'accepted-snapshot.json')), snapshot = await readSnapshotRefV2(runDir, acceptedFile.ref.path);
  if (snapshot.status !== 'draft' || snapshot.pageId !== journal.pageId || snapshot.runId !== journal.runId || snapshot.hash !== journal.documentHash || Object.entries(fingerprintNative44Snapshot(snapshot)).some(([key, value]) => manifest[key as keyof Native44CompareManifest] !== value)) fail('pending_snapshot_conflict');
  let goalProfile = 'historical-strict'; if (lock?.program) { const bytes = await readFile(path.resolve(root, lock.program.path)); if (hashV2(bytes) !== lock.program.sha256) fail('pending_program_changed'); goalProfile = JSON.parse(bytes.toString('utf8')).goalProfile ?? goalProfile; }
  const item = (region: string, issue: string, impact: string, nextAction: string): Native44DeliveryEntry => ({ region, issue, impact, nextAction, evidence: [journalFile.ref, acceptedFile.ref, manifestFile.ref] });
  return { guardPath, guardBytes: journalFile.bytes, summary: { version: 1, kind: 'native44-delivery-summary', taskId: journal.taskId, runId: journal.runId, pageId: journal.pageId, documentHash: snapshot.hash, cssHash: native44CSSHash(canonicalNative44CSS(manifest.pageCss)), generatedAt, goalProfile, deliveryComplete: false, requirementsComplete: false, status: 'pending-review', evidenceScope: 'verified-local-current-revision', remote: { status: 'not-freshly-observed', basis: 'local-snapshot-only' }, axes: { saved: 'confirmed', css: manifest.pageCss ? 'saved-with-document' : 'not-applied', review: 'not-run', qualityFloor: 'unverified', requirements: 'pending', delivery: 'pending' }, sections: {
    completedAndVerified: [item('page', 'The owned native draft save is confirmed by its complete accepted snapshot and write/readback journal.', 'The editable native document is saved; this does not establish current frontend quality.', 'Preserve this complete document identity before applying the full CSS and performing review.')],
    unfinished: manifest.pageCss ? [] : [item('page-css', 'No page custom CSS was applied in this saved snapshot.', 'Source layout and presentation are still awaiting the complete CSS handoff.', 'Prepare and apply the complete current CSS model through the guarded revision flow.')], minorIssues: [],
    unverified: [item('desktop-review', 'The saved draft has no current versioned visual/interaction review.', 'The quality floor and source requirements cannot yet be declared satisfied.', 'Capture both required desktop views, inspect the actual pixels and native behavior, then bind an acceptance observation.'), item('live-site', 'No fresh remote observation was performed for this local summary.', 'Historical local save evidence cannot establish the present live site state.', 'Perform a read-only owned draft/status check or current capture when needed.')], productContentReplacement: [], componentExceptions: [],
  }, identityEvidence: [journalFile.ref, acceptedFile.ref, manifestFile.ref] } };
}

/** Writes only derived local delivery artifacts. Callers already holding the
 * serial root mutation lock must explicitly pass lockHeld:true. Failure is fatal
 * to a completion call; stdout alone is never a delivery artifact. */
export async function emitNative44DeliverySummary(rootInput: string, runId: string, options: { expectedState?: Pick<Native44CurrentState, 'taskId' | 'runId' | 'pageId' | 'documentHash'>; remoteObservation?: Native44DeliveryRemoteObservation; pendingReviewCapture?: Native44CurrentRef; lockHeld?: true } = {}) {
  const root = await realpath(rootInput); if (!/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/.test(runId) || runId.includes('..')) fail('run_invalid');
  const unlock = options.lockHeld ? undefined : await acquireLock(root, await runResources(root, runId));
  try {
    const originalRun = path.join(root, 'runs', runId), initial = await reuseNative44CurrentStateForDelivery(root, runId, options.expectedState) ?? await readNative44CurrentState(root, originalRun), runDir = path.join(root, 'runs', initial?.runId ?? runId); if (await realpath(runDir) !== runDir) fail('run_alias');
    const pending = !initial ? await pendingSummary(root, runDir, new Date().toISOString()) : undefined;
    if (options.expectedState && ['taskId', 'runId', 'pageId', 'documentHash'].some(key => options.expectedState![key as keyof typeof options.expectedState] !== (initial ?? pending!.summary)[key as keyof typeof options.expectedState])) fail('current_identity_conflict');
    const pointerFile = path.join(runDir, 'current-user-amendment.json'), guardPath = initial ? pointerFile : pending!.guardPath, guardBytes = initial ? await readFile(pointerFile) : pending!.guardBytes, pointerEvidence = initial?.evidence.find(item => item.path === pointerFile);
    if (initial && (!pointerEvidence || hashV2(guardBytes) !== pointerEvidence.sha256)) fail('current_changed'); const pointer = initial ? JSON.parse(guardBytes.toString('utf8')) : undefined;
    const readBound = async (reference: Native44CurrentRef) => { const filename = path.resolve(root, reference.path); inside(runDir, filename); if (await realpath(filename) !== filename) fail('reference_alias'); const bytes = await readFile(filename); if (hashV2(bytes) !== reference.sha256) fail('reference_changed'); return JSON.parse(bytes.toString('utf8')); };
    const contract = pointer?.version === 2 ? Native44RequirementContractSchema.parse(await readBound(pointer.requirementsRef)) : undefined, observation = pointer?.version === 2 && pointer.acceptanceObservationRef ? Native44AcceptanceObservationSchema.parse(await readBound(pointer.acceptanceObservationRef)) : undefined;
    const summary = initial ? buildNative44DeliverySummary(initial, { contract, observation, generatedAt: new Date().toISOString(), remoteObservation: options.remoteObservation }) : pending!.summary;
    const publication = initial ? await readNative44Publication(root, initial) : undefined;
    if (publication) {
      summary.publication = publication; summary.documentHash = publication.documentHash;
      if (!options.remoteObservation || options.remoteObservation.status === 'owned-published-current' && options.remoteObservation.documentHash === publication.documentHash) { summary.status = publication.status; summary.axes.delivery = publication.status; }
      else { summary.status = 'not-current'; summary.axes.delivery = 'pending'; }
      summary.identityEvidence = refs([...summary.identityEvidence, ...publication.evidence]);
      summary.sections.completedAndVerified.push({ region: 'publication', issue: 'The current task-owned page was published by an exact status-only transaction.', impact: 'The historical draft, CSS and reviewed pixels are preserved; publishing does not claim unfinished functionality is implemented.', nextAction: 'Read-only verify the public page; retain all named omissions and integration limits.', evidence: publication.evidence });
      for (const omission of publication.acceptedOmissions) summary.sections.componentExceptions.push({ region: 'publication-scope', issue: omission.reason, impact: 'This explicit delivery omission permits publication while the original missing capability remains visible in the unfinished list.', nextAction: 'Revisit only if the user requests the omitted capability.', evidence: [publication.receipt] });
    } else if (options.remoteObservation?.status === 'owned-published-current') fail('publication_receipt_missing');
    if (options.pendingReviewCapture) {
      if (!initial?.currentManifest) return fail('capture_current_manifest_missing');
      const reference = options.pendingReviewCapture, filename = path.resolve(root, reference.path); inside(path.join(root, 'runs'), filename); if (await realpath(filename) !== filename) fail('capture_alias'); const bytes = await optional(filename); if (!bytes || hashV2(bytes) !== reference.sha256) return fail('capture_changed');
      const manifest = await readBound(initial.currentManifest), raw = JSON.parse(bytes.toString('utf8')); normalizeNative44CurrentReviewReport(raw, manifest);
      if (raw.taskId !== initial.taskId || raw.runId !== initial.runId || raw.pageId !== initial.pageId || raw.metrics?.documentWrites !== 0 || raw.metrics?.editorSessions !== 0) fail('capture_identity_conflict');
      summary.sections.unverified.push({ region: 'new-desktop-capture', issue: 'A fresh read-only capture exists and has not yet been inspected and bound as the current review.', impact: `Delivery axes still refer to the previously bound review from ${initial.reviewedAt ?? initial.observedAt}; the new capture is not declared passed and does not replace that evidence.`, nextAction: 'Inspect the new source/target pixels and actual checks, then update the existing bound visual-review/acceptance record. Do not use the summary to override saved state.', evidence: [reference, ...(initial.verification ? [initial.verification] : []), ...(initial.visualReview ? [initial.visualReview] : [])], });
      summary.identityEvidence.push(reference);
    }
    const deliveryJournal = JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8'));
    const editor = await editorCompletionGate(runDir, { taskId: summary.taskId, runId: summary.runId, pageId: summary.pageId, documentHash: summary.documentHash }, deliveryJournal.editorCompletionPolicy?.mode === 'align-and-reopen');
    if (!editor.complete) {
      summary.deliveryComplete = false; summary.deliveryReady = false; summary.status = 'editor-completion-pending'; summary.axes.delivery = editor.status;
      summary.sections.unverified.push({ region: 'editor-and-autosave', issue: 'Current task editor/autosave alignment and a normal editable reopen have not both been confirmed for this exact saved document.', impact: 'A stale autosave may otherwise become the next editing baseline; saved/frontend checks remain separately recorded.', nextAction: 'Automatically run editor:complete prepare, align/reconcile, reopen only this owned page in the normal editor; if loading use recover --stdin to wait and safely refresh once before requesting help. Capture actual evidence, then verify. Preserve unknown human edits and other pages.', evidence: summary.identityEvidence });
    }
    const jsonBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`), markdownBytes = Buffer.from(renderNative44DeliverySummary(summary));
    const history = path.join(runDir, 'deliveries'); await mkdir(history, { recursive: true }); if (await realpath(history) !== history) fail('history_alias');
    const versionDir = path.join(history, hashV2(jsonBytes)); await mkdir(versionDir, { recursive: true }); if (await realpath(versionDir) !== versionDir) fail('history_alias');
    await immutable(path.join(versionDir, 'delivery-summary.json'), jsonBytes); await immutable(path.join(versionDir, 'DELIVERY.md'), markdownBytes);
    for (const basename of ['delivery-summary.json', 'DELIVERY.md']) { const filename = path.join(runDir, basename), previous = await optional(filename); if (previous) { if (await realpath(filename) !== filename) fail('artifact_alias'); const oldDir = path.join(history, `previous-${hashV2(previous)}`); await mkdir(oldDir, { recursive: true }); if (await realpath(oldDir) !== oldDir) fail('history_alias'); await immutable(path.join(oldDir, basename), previous); } }
    if (!(await readFile(guardPath)).equals(guardBytes) || !initial && await optional(pointerFile)) fail('current_changed');
    if (publication) for (const ref of publication.evidence) if (hashV2(await readFile(ref.path)) !== ref.sha256) fail('publication_changed');
    for (const [basename, bytes] of [['delivery-summary.json', jsonBytes], ['DELIVERY.md', markdownBytes]] as const) { const temporary = path.join(runDir, `${basename}.${randomUUID()}.tmp`); await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path.join(runDir, basename)); }
    return { summary, summaryRef: { path: path.join(runDir, 'delivery-summary.json'), sha256: hashV2(jsonBytes) }, markdownRef: { path: path.join(runDir, 'DELIVERY.md'), sha256: hashV2(markdownBytes) } };
  } finally { await unlock?.(); }
}

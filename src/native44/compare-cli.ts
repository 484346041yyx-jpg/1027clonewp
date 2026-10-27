import {assertProgramNativeWidget} from './product-extension.js';
import {currentProductSelectionSchema} from './current-product.js';
import {createHash} from 'node:crypto';
import path from 'node:path';
import { readFile, realpath, statfs } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Route, type LaunchOptions } from 'playwright';
import { loadConfig, redactor } from '../core/config.js';
import { acquireLock, writeJson } from '../core/files.js';
import { previewCookies } from '../wordpress/preview-session.js';
import { openReadOnlyPage } from '../verification/page-opening.js';
import { WordPressClient } from '../wordpress/client.js';
import type { OwnedReviewStatus } from '../wordpress/client.js';
import { assertAllowedWidget, NATIVE44_ALL_TYPES } from './catalog.js';
import { assertNative44Environment, checkNative44Environment } from './environment.js';
import { compareNative44Run, fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareDependencies, type Native44CompareManifest, type Native44VisualReview } from './compare.js';
import { loadNative44SourceCaptures } from './source-captures.js';
import { assertNative44ProfileIdentity } from './profile.js';
import { assertNative44ReleaseIdentity, readNative44ReleaseLock } from './release-lock.js';
import { syncNative44ContextIndex } from './context-bookkeeping.js';
import { assertNative44OriginalRunWritable, readNative44CurrentState, type Native44CurrentState } from './current-state.js';
import { documentHashV2, hashV2 } from '../replica-v2/journal.js';
import { verifyNative44AppliedCSS } from './css-handoff.js';
import type { DraftSnapshot, PublishedSnapshot } from '../wordpress/types.js';
import { readNative44Publication, assertNative44PublicationContent } from './publication.js';
import { emitNative44DeliverySummary, type Native44DeliveryRemoteObservation } from './delivery-summary.js';
import { bindNative44CurrentCompareManifest, readNative44CurrentCaptureManifest, readNative44CurrentCompareInput as currentRevisionInput, sameNative44CurrentFingerprint as sameFingerprint } from './current-capture-binding.js';
import { assertNative44WholePageModuleCoverage, assertNative44WholePageReviewReady } from './review-workflow.js';
export { bindNative44CurrentCompareManifest } from './current-capture-binding.js';

export function native44ReviewStatusProblem(status: OwnedReviewStatus,nativeProduct=false): string | undefined {
  if (!status.exists) return 'native44_current_page_missing';
  if (status.postType !== (nativeProduct?'woodmart_layout':'page')) return 'native44_current_record_not_page';
  if (status.status === 'publish') return 'native44_current_page_published';
  if (status.status !== 'draft') return 'native44_current_page_not_draft';
  if (!status.ownerMatches) return 'native44_current_page_not_owned';
  if (!status.canEdit) return 'native44_current_page_not_editable';
  if (!status.uniqueRunPage) return 'native44_current_run_pages_ambiguous';
  if (!status.documentExists) return 'native44_current_document_missing';
  if (!status.builtWithElementor) return 'native44_current_document_not_elementor';
  return undefined;
}
/** Preserve the source browser's real layout scrollbar. Chromium's headless
 * default --hide-scrollbars otherwise increases clientWidth by 15px on Windows. */
export function native44CompareBrowserOptions(viewports: ReadonlyArray<{ width: number; clientWidth: number; scrollbarWidth: number }> = []): LaunchOptions {
  for (const view of viewports) if (![view.width, view.clientWidth, view.scrollbarWidth].every(Number.isFinite) || view.clientWidth <= 0 || view.scrollbarWidth < 0 || Math.abs(view.width - view.clientWidth - view.scrollbarWidth) > 1) throw Error('Source scrollbar configuration is not an actual consistent viewport observation');
  return { headless: true, ...(viewports.some(view => view.scrollbarWidth > 0) ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) };
}

/** Authentication and owned-page checks only. This factory exposes no draft or
 * media writer, and opens no Elementor editor. Cookies remain in memory. */
export async function createNative44CompareDependencies(root: string, manifest: Native44CompareManifest): Promise<Native44CompareDependencies> {
  const revision = await bindNative44CurrentCompareManifest(root, manifest);
  let workflowJournal = revision?.journal;
  if (!workflowJournal) {
    try { workflowJournal = JSON.parse(await readFile(path.join(root, 'runs', manifest.runId, 'journal.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  assertNative44WholePageReviewReady({ manifest, journal: workflowJournal, current: revision?.state, snapshot: revision?.snapshot });
  if (!revision) {
    validateNative44CompareManifest(manifest);
    if (manifest.releaseLock) { const lock = await readNative44ReleaseLock(root, manifest.releaseLock, { taskId: manifest.taskId }); if (lock.phase !== 'final') throw Error('Comparison needs a final program-bound release lock'); }
  }
  // Historical source facts retain their original policy identity. For saved
  // revisions their immutable bytes and actual scrollbar viewports are already
  // checked above; no current-policy source recollection is attempted.
  const preparedSource = manifest.sourceCaptures ? await loadNative44SourceCaptures(manifest.sourceCaptures, { taskId: manifest.taskId, sourceUrl: manifest.sourceUrl, replicationProfile: manifest.replicationProfile, ...(revision ? { expectedSelectionRulesHash: revision.lock.release.selectionRules.sha256 } : {}) }) : undefined;
  if (preparedSource) assertNative44WholePageModuleCoverage(manifest, preparedSource.plan.components.filter(component => component.parentId === null).map(component => component.id));
  const frozen=manifest.releaseLock?await readNative44ReleaseLock(root,manifest.releaseLock,{taskId:manifest.taskId}):undefined;
  let selection:ReturnType<typeof currentProductSelectionSchema.parse>|undefined;
  if(frozen?.program){const bytes=await readFile(path.resolve(root,frozen.program.path));if(createHash('sha256').update(bytes).digest('hex')!==frozen.program.sha256)throw Error('native_product_preview_program_changed');const program=JSON.parse(bytes.toString('utf8'));if(program.currentRecord)selection=currentProductSelectionSchema.parse(program.currentRecord);}
  for (const type of manifest.widgetTypes) assertProgramNativeWidget(type,frozen?.release.componentExtension);
  const loaded = await loadConfig(root);
  if (new URL(manifest.targetUrl).origin !== new URL(loaded.config.targetUrl).origin) throw Error('Comparison target must match the configured test site');
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', ...(frozen?.release.componentExtension?{componentExtension:frozen.release.componentExtension}:{allowedWidgetTypes:NATIVE44_ALL_TYPES}) });
  let browser: Browser | undefined, source: BrowserContext | undefined, target: BrowserContext | undefined;
  try {
    if(selection)await client.readCurrentProductRuntime(manifest.pageId,manifest.runId,selection.productId,selection.contextKey);
    const status = await client.probeOwnedReviewStatus(manifest.pageId, manifest.runId), statusProblem = native44ReviewStatusProblem(status,!!selection);
    if (statusProblem) throw Error(`${statusProblem}: not-current; pageId=${status.pageId}; postType=${status.postType ?? 'missing'}; status=${status.status ?? 'missing'}; the existing record is preserved.`);
    const preflight = await client.preflight(), parentThemeProof = await client.discoverCapabilities(['container']);
    assertNative44Environment(checkNative44Environment(preflight, parentThemeProof));
    const initial = await client.readOwnedReviewCheckpoint(manifest.pageId, manifest.runId, manifest.widgetTypes);
    if (initial.snapshot.status !== 'draft') throw Error('Comparison is restricted to the current run owned draft');
    if (revision && (initial.snapshot.pageId !== manifest.pageId || initial.snapshot.runId !== manifest.runId || documentHashV2(initial.snapshot.elements, initial.snapshot.settings) !== initial.snapshot.hash || !sameFingerprint(revision.fingerprint, fingerprintNative44Snapshot(initial.snapshot)))) throw Error('native44_current_remote_not_current: owned draft differs from the complete current revision fingerprint.');
    const access = await client.getPreviewAccess(manifest.pageId);
    if (new URL(access.previewUrl).origin !== client.origin) throw Error('Owned preview escaped the configured test origin');
    const nativePreview=selection?await client.readCurrentProductPreview(manifest.pageId,manifest.runId,selection):undefined;
    const cookies = nativePreview?[]:await previewCookies(access.adminAccessUrl, client.targetUrl);
    browser = await chromium.launch(native44CompareBrowserOptions(revision?.sourceViewports ?? preparedSource?.facts.snapshots.map(snapshot => snapshot.viewport)));
    target = await browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1 });
    await target.addCookies(cookies);
    const readOnly = async (route: Route) => {
      const request = route.request();
      if(nativePreview&&request.isNavigationRequest()&&request.url()===access.previewUrl)return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:nativePreview.html});
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort('blockedbyclient');
      // No nonce-bearing credential resources are written to diagnostics.
      const url = new URL(request.url());
      if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame() && request.frame().page().context() === target && url.origin !== client.origin) return route.abort('blockedbyclient');
      return route.continue();
    };
    await target.route('**/*', readOnly);
    return {
      sourceCaptures: preparedSource,
      readSnapshot: async () => fingerprintNative44Snapshot(await client.snapshotDraft(manifest.pageId)),
      openPage: async (url, role) => {
        if (role === 'source' && (preparedSource || revision)) throw Error('Validated user-browser source captures must be reused; source browser navigation is disabled');
        if (role === 'source' && !source) { source = await browser!.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1 }); await source.route('**/*', readOnly); }
        const context = role === 'source' ? source! : target!;
        const { page } = await openReadOnlyPage(context, role === 'target' ? access.previewUrl : url);
        return page;
      },
      close: async () => { await browser?.close(); await client.close(); },
    };
  } catch (error) { await browser?.close().catch(() => undefined); await client.close().catch(() => undefined); throw error; }
}

export interface Native44CurrentCheckpointReader {
  probeOwnedReviewStatus(pageId: number, runId: string): Promise<OwnedReviewStatus>;
  readOwnedReviewCheckpoint(pageId: number, runId: string, widgetTypes: string[]): Promise<{ snapshot: DraftSnapshot }>;
  readOwnedPublishedCheckpoint?(pageId: number, runId: string, widgetTypes: string[]): Promise<{ snapshot: PublishedSnapshot; publicUrl: string }>;
  close?(): Promise<void>;
}
/** Reuse the bound visual evidence only after a fresh owned-page read. This
 * reports its exact scope: it does not manufacture new pixels, regenerate CSS,
 * mark a pending review complete, or modify the historical comparison report. */
export async function verifyNative44CurrentRevision(root: string, runDir: string, injected?: Native44CurrentCheckpointReader) {
  const state = await readNative44CurrentState(root, runDir);
  if (!state) throw Error('native44_current_revision_missing');
  const input = await currentRevisionInput(root, state);
  const publication = await readNative44Publication(root, state);
  let reader = injected;
  if (!reader) {
    const loaded = await loadConfig(root);
    if (new URL(loaded.config.targetUrl).origin !== new URL(input.journal.targetUrl).origin) throw Error('native44_current_target_origin_conflict');
    reader = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES });
  }
  try {
    if (publication) {
      const remoteStatus = await reader.probeOwnedReviewStatus(state.pageId, state.runId);
      const eligible = remoteStatus.exists && remoteStatus.postType === 'page' && remoteStatus.status === 'publish' && remoteStatus.ownerMatches && remoteStatus.canEdit && remoteStatus.uniqueRunPage && remoteStatus.documentExists && remoteStatus.builtWithElementor;
      if (!eligible) return { kind: 'native44-publication-read-only-verification', status: 'not-current', visualVerification: 'stale', inspectionComplete: false, remoteStatus, documentHash: publication.documentHash, observedAt: new Date().toISOString(), metrics: { statusProbes: 1, ownedCheckpointReads: 0, documentWrites: 0, editorSessions: 0 } };
      if (!reader.readOwnedPublishedCheckpoint) throw Error('native44_publication_reader_missing');
      const actual = await reader.readOwnedPublishedCheckpoint(state.pageId, state.runId, input.widgetTypes), before = JSON.parse(await readFile(state.currentSnapshot.path, 'utf8')) as DraftSnapshot;
      let contentEquivalent = true; try { assertNative44PublicationContent(before, actual.snapshot); } catch { contentEquivalent = false; }
      const latest = await readNative44CurrentState(root, runDir), latestPublication = latest ? await readNative44Publication(root, latest) : undefined;
      const current = contentEquivalent && actual.snapshot.hash === publication.documentHash && actual.publicUrl === publication.publicUrl && latestPublication?.receipt.sha256 === publication.receipt.sha256;
      return { version: 1, kind: 'native44-publication-read-only-verification', status: current ? publication.status : 'not-current', visualVerification: current ? state.visualVerification : 'stale', inspectionComplete: current, runId: state.runId, taskId: state.taskId, pageId: state.pageId, publicUrl: publication.publicUrl, unpublished: false, documentHash: actual.snapshot.hash, expectedDocumentHash: publication.documentHash, historicalReviewedDocumentHash: state.documentHash, contentEquivalent, fullFingerprintMatches: current, historicalReviewPreserved: true, requirementsComplete: publication.requirementsComplete, deliveryComplete: state.deliveryComplete, publication, remoteStatus, verification: state.verification, visualReview: state.visualReview, scope: 'Fresh owned published checkpoint and complete content/CSS equality checked against the separate publication receipt. Historical draft pixels retain their original identity; no new public pixels or business-flow checks are claimed.', observedAt: new Date().toISOString(), metrics: { statusProbes: 1, ownedCheckpointReads: 1, documentWrites: 0, editorSessions: 0, comparisonReportWrites: 0 } };
    }
    const remoteStatus = await reader.probeOwnedReviewStatus(state.pageId, state.runId), reason = native44ReviewStatusProblem(remoteStatus);
    if (reason) return { version: 1, kind: 'native44-current-revision-read-only-verification', runId: state.runId, taskId: state.taskId, pageId: state.pageId, status: 'not-current', reason, deliveryComplete: false, visualVerification: 'stale', ...(state.axes ? { inspectionComplete: false, axes: { ...state.axes, remote: { status: 'ineligible', reason, observedAt: new Date().toISOString() }, delivery: { status: 'pending', complete: false } } } : state.currentCaptureReview ? { inspectionComplete: false, requirementsComplete: false, draftReady: false } : {}), expectedDocumentHash: state.documentHash, remoteStatus, fullFingerprintMatches: false, verification: undefined, visualReview: undefined, scope: 'Read-only ownership/status probe; an ineligible page was preserved without reading or authorizing a draft checkpoint.', limitations: ['The historical unpublished local snapshot and review remain preserved; this probe grants no write or publish-state change permission.'], metrics: { statusProbes: 1, ownedCheckpointReads: 0, documentWrites: 0, editorSessions: 0, comparisonReportWrites: 0 }, observedAt: new Date().toISOString() };
    const checkpoint = await reader.readOwnedReviewCheckpoint(state.pageId, state.runId, input.widgetTypes), actual = checkpoint.snapshot;
    const owned = actual.pageId === state.pageId && actual.runId === state.runId && actual.status === 'draft' && documentHashV2(actual.elements, actual.settings) === actual.hash;
    const fingerprint = fingerprintNative44Snapshot(actual), matches = owned && sameFingerprint(input.fingerprint, fingerprint);
    const latest = await readNative44CurrentState(root, runDir);
    const indexHash = (value: Native44CurrentState) => value.evidence.find(item => path.basename(item.path) === 'current-user-amendment.json' && path.basename(path.dirname(item.path)) === value.runId)?.sha256;
    const indexUnchanged = latest?.documentHash === state.documentHash && latest.currentSnapshot.sha256 === state.currentSnapshot.sha256 && latest.currentCSS.sha256 === state.currentCSS.sha256 && indexHash(latest) === indexHash(state);
    const css = verifyNative44AppliedCSS(input.fingerprint.pageCss, fingerprint.pageCss);
    const current = matches && indexUnchanged && css.applied, verified = current && latest!.deliveryComplete;
    const reviewed = current && (latest?.axes?.review.status === 'reviewed' || latest?.currentCaptureReview?.review === 'reviewed');
    const captureInspection = !state.axes && state.currentCaptureReview ? { inspectionComplete: current, requirementsComplete: false, draftReady: current && latest?.currentCaptureReview?.draftReady === true, ...(current ? { currentCaptureReview: latest!.currentCaptureReview } : {}) } : {};
    return { version: 1, kind: 'native44-current-revision-read-only-verification', runId: state.runId, taskId: state.taskId, pageId: state.pageId, status: !current ? 'not-current' : verified ? latest!.status === 'delivered-with-open-items' ? 'delivered-with-open-items' : 'verified' : reviewed ? latest!.status : 'pending-review', deliveryComplete: verified, visualVerification: current ? latest!.visualVerification : 'stale', ...(state.axes ? { inspectionComplete: current, goalProfile: latest!.goalProfile, requirementsComplete: latest!.requirementsComplete, draftReady: latest!.draftReady, axes: { ...latest!.axes, remote: { status: current ? 'owned-draft-current' : 'changed', observedAt: new Date().toISOString(), documentHash: actual.hash } } } : captureInspection), documentHash: actual.hash, expectedDocumentHash: state.documentHash, remoteStatus, fullFingerprintMatches: matches, currentIndexUnchanged: indexUnchanged, css, ...(verified || reviewed ? { verification: latest!.verification, visualReview: latest!.visualReview } : {}), scope: 'Fresh owned draft and full document/CSS fingerprints checked against the existing hash-bound desktop review; no new browser screenshots or visual judgment were produced.', limitations: ['Theme, external fonts, media bytes and frontend runtime may change without changing the Elementor document; fresh screenshot capture is required to assess those changes.'], metrics: { statusProbes: 1, ownedCheckpointReads: 1, documentWrites: 0, editorSessions: 0, comparisonReportWrites: 0 }, observedAt: new Date().toISOString() };
  } finally { await reader.close?.(); }
}

export async function runCompareNative44Cli(argv: string[], root = process.cwd(), injected?: Native44CompareDependencies, currentReader?: Native44CurrentCheckpointReader): Promise<number> {
  if (!argv.length || argv.length > 2 || argv[0].startsWith('--') || argv[1] !== undefined && !['--verify-applied', '--capture-current'].includes(argv[1])) throw Error('Usage: npm run compare:replica -- <RUN_DIR> [--verify-applied|--capture-current]');
  const runDir = await realpath(path.resolve(root, argv[0])), runs = path.resolve(root, 'runs');
  if (!runDir.startsWith(`${runs}${path.sep}`)) throw Error('Comparison run must remain within this project runs directory');
  const revision = await readNative44CurrentState(root, runDir);
  if (revision) {
    if (argv[1] === '--capture-current') {
      if (await readNative44Publication(root, revision)) throw Error('native44_published_capture_requires_public_scope: use --verify-applied for the owned published checkpoint; the historical draft capture manifest is preserved and cannot be relabeled as public pixels.');
      const free = await statfs(runDir); if (Number(free.bavail) * Number(free.bsize) < 512 * 1024 * 1024) throw Error('Comparison requires at least 512 MiB free for evidence');
      const actualRun = path.join(root, 'runs', revision.runId), input = await readNative44CurrentCaptureManifest(root, actualRun, revision);
      assertNative44WholePageReviewReady({ manifest: input.manifest, journal: input.binding.journal, current: revision, snapshot: input.binding.snapshot });
      const rawDependencies = injected ?? await createNative44CompareDependencies(root, input.manifest); let closed = false;
      const dependencies: Native44CompareDependencies = { ...rawDependencies, close: async () => { if (!closed) { closed = true; await rawDependencies.close?.(); } } };
      let result: Awaited<ReturnType<typeof compareNative44Run>>;
      try { result = await compareNative44Run(actualRun, dependencies, { captureCurrent: true }); } finally { await dependencies.close?.(); }
      const unchanged = result.documentHash === revision.documentHash && result.finalReadHash === revision.documentHash && !result.gaps.some(gap => gap.category === 'conflict');
      const captureReport = path.join(result.reviewOutputDir!, 'report.json'), reportRef = { path: captureReport, sha256: hashV2(await readFile(captureReport)) };
      const deliverySummary = await emitNative44DeliverySummary(root, revision.runId, { expectedState: revision, ...(!input.legacy ? { pendingReviewCapture: reportRef } : {}) });
      console.log(JSON.stringify({ kind: 'native44-current-capture', runId: revision.runId, pageId: revision.pageId, documentHash: result.documentHash, fullFingerprintUnchanged: unchanged, reviewOutputDir: result.reviewOutputDir, report: reportRef, currentManifest: result.currentManifest, comparisonReview: result.comparisonReview, deliveryComplete: false, ...(input.legacy ? { legacyCapture: true, reviewStatus: 'fresh-capture-pending-review', scope: 'Fresh read-only evidence only; the frozen v1 contract, current pointer and historical acceptance are preserved. The new capture has not been visually reviewed.' } : {}), deliverySummary: deliverySummary.summaryRef, delivery: deliverySummary.markdownRef, gaps: result.gaps, metrics: result.metrics }, null, 2));
      return unchanged && result.captures.length === input.manifest.viewports?.length ? 0 : 1;
    }
    const result = await verifyNative44CurrentRevision(root, runDir, currentReader);
    const remoteObservation: Native44DeliveryRemoteObservation = { taskId: revision.taskId, runId: revision.runId, pageId: revision.pageId, ...('documentHash' in result ? { documentHash: result.documentHash } : {}), status: result.status === 'not-current' ? 'ineligible' : result.kind === 'native44-publication-read-only-verification' ? 'owned-published-current' : 'owned-draft-current', observedAt: result.observedAt, readOnly: true };
    const deliverySummary = await emitNative44DeliverySummary(root, revision.runId, { expectedState: revision, remoteObservation });
    console.log(JSON.stringify({ ...result, deliverySummary: deliverySummary.summaryRef, delivery: deliverySummary.markdownRef }, null, 2));
    // The v2 inspection command reports whether the read-only inspection ran
    // successfully; delivery acceptance is an independent field. Legacy exit
    // semantics remain unchanged for frozen v1 tasks.
    return 'inspectionComplete' in result ? result.inspectionComplete ? 0 : 1 : result.status === 'verified' ? 0 : 1;
  }
  if (argv[1] === '--capture-current') throw Error('native44_current_revision_missing');
  const free = await statfs(runDir); if (Number(free.bavail) * Number(free.bsize) < 512 * 1024 * 1024) throw Error('Comparison requires at least 512 MiB free for evidence');
  const manifest = JSON.parse(await readFile(path.join(runDir, 'compare-manifest.json'), 'utf8')) as Native44CompareManifest;
  validateNative44CompareManifest(manifest);
  let journal: any;
  try { journal = JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8')); assertNative44ReleaseIdentity(journal.releaseLock, manifest.releaseLock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  assertNative44WholePageReviewReady({ manifest, journal });
  let reviews: Native44VisualReview[] | undefined;
  try { reviews = JSON.parse(await readFile(path.join(runDir, argv[1] ? 'visual-reviews-applied.json' : 'visual-reviews.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const dependencies = injected ?? await createNative44CompareDependencies(root, manifest);
  const result = await compareNative44Run(runDir, dependencies, { verifyApplied: argv[1] === '--verify-applied', reviews });
  await integrateNative44ComparisonResult(root, runDir, manifest, result);
  const deliverySummary = await emitNative44DeliverySummary(root, manifest.runId);
  console.log(JSON.stringify({ deliveryComplete: result.deliveryComplete, visualVerification: result.visualVerification, comparisonReview: result.comparisonReview, css: result.css, gaps: result.gaps, metrics: result.metrics, deliverySummary: deliverySummary.summaryRef, delivery: deliverySummary.markdownRef }, null, 2));
  return result.deliveryComplete ? 0 : 1;
}

/** Local delivery bookkeeping only; preserves failed/unknown write facts and
 * cannot authorize another site write after the stylesheet has been handed off. */
export async function integrateNative44ComparisonResult(root: string, runDir: string, manifest: Native44CompareManifest, comparison: Awaited<ReturnType<typeof compareNative44Run>>): Promise<boolean> {
  if (!comparison.deliveryComplete) return false;
  await assertNative44OriginalRunWritable(root, runDir);
  const journalFile = path.join(runDir, 'journal.json'), resultFile = path.join(runDir, 'result.json');
  let exists: string;
  try { exists = await readFile(journalFile, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  const release = await acquireLock(root);
  try {
    const current = await readFile(journalFile, 'utf8'), journal = JSON.parse(current);
    if (current !== exists) throw Error('Comparison journal changed before local delivery bookkeeping; preserved');
    if (journal.executionStrategy !== 'native44-css-handoff') return false;
    assertNative44ProfileIdentity(journal.replicationProfile, manifest.replicationProfile, comparison.replicationProfile);
    assertNative44ReleaseIdentity(journal.releaseLock, manifest.releaseLock, comparison.releaseLock);
    if (journal.selectionRulesHash !== manifest.selectionRulesHash || comparison.selectionRulesHash !== manifest.selectionRulesHash) throw Error('Comparison selection rules identity differs; preserved');
    if (journal.runId !== manifest.runId || journal.taskId !== manifest.taskId || journal.pageId !== manifest.pageId || path.resolve(journal.runDir) !== path.resolve(runDir) || comparison.runId !== manifest.runId || comparison.documentHash !== comparison.finalReadHash || comparison.baselineDocumentHash !== manifest.documentHash) throw Error('Comparison delivery identity or final document hash differs');
    if (!['draft-saved', 'awaiting-comparison', 'delivered'].includes(journal.status) || journal.mutations?.some((mutation: { status: string }) => mutation.status !== 'confirmed')) throw Error('Unresolved or failed write state cannot be marked delivered');
    if (journal.documentHash !== manifest.documentHash && journal.documentHash !== comparison.documentHash) throw Error('Journal document hash differs from the frozen or verified document');
    let result: Record<string, any> = {};
    try { result = JSON.parse(await readFile(resultFile, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (Object.keys(result).length && (result.executionStrategy !== 'native44-css-handoff' || result.runId !== manifest.runId || result.taskId !== manifest.taskId || result.pageId !== manifest.pageId)) throw Error('Existing result identity differs; preserved');
    assertNative44ProfileIdentity(journal.replicationProfile, Object.keys(result).length ? result.replicationProfile : journal.replicationProfile);
    if (Object.keys(result).length) assertNative44ReleaseIdentity(journal.releaseLock, result.releaseLock);
    if (Object.keys(result).length && result.selectionRulesHash !== journal.selectionRulesHash) throw Error('Existing result selection rules identity differs; preserved');
    const visualVerification = comparison.visualVerification === 'applied-verified' ? 'applied-verified' : comparison.visualVerification === 'applied-unverified' ? 'applied-unverified' : 'pending-css-application';
    const updated = { ...journal, deliveryComplete: true, status: 'delivered', visualVerification, documentHash: comparison.documentHash, updatedAt: new Date().toISOString(), css: comparison.css, comparisonReport: path.join(runDir, comparison.visualVerification.startsWith('applied-') ? 'comparison-applied' : 'comparison', 'report.json') };
    const delivered = { ...result, ...updated, completed: visualVerification === 'applied-verified', wholeTaskComplete: visualVerification === 'applied-verified', editingEvidence: comparison.editingEvidence, comparisonReview: comparison.comparisonReview, comparisonMetrics: comparison.metrics };
    if (await readFile(journalFile, 'utf8') !== current) throw Error('Journal changed during local delivery bookkeeping; preserved');
    await writeJson(journalFile, updated); await writeJson(resultFile, delivered);
    await syncNative44ContextIndex(root, runDir);
    return true;
  } finally { await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCompareNative44Cli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(redactor()(error)); process.exitCode = 1; });
}

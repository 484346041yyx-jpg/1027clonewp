import path from 'node:path';
import { copyFile, readFile, realpath } from 'node:fs/promises';
import { writeJson } from '../core/files.js';
import { freezeNewTaskFinalDeliveryPolicy } from '../core/delivery-policy.js';
import { prepareObservedReferenceV2, type PrepareReferenceV2Options, type PreparedReplicaJobV2 } from '../replica-v2/source.js';
import { native44KnowledgeIdentity } from './knowledge.js';
import { NATIVE44_STRATEGY, NATIVE44_NATIVE_EDITOR_NAMING, NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW, NATIVE44_ARTICLE_LIST_POLICY } from './types.js';
import { assertPublicUrl, isPublicAddress } from '../capture/url-safety.js';
import { isIP } from 'node:net';
import { DESKTOP_BROWSER_PROFILE, native44ProfileViewports, type Native44ReplicationProfile } from './profile.js';
import { readObservationDirectoryV2, sha256, validateObservationPacketV2, type ObservationPacketV2, type ValidatedObservationV2 } from '../replica-v2/observation.js';
import { assertExpandedCaptureEquivalent } from './capture-equivalence.js';
import { native44BodyCaptureScopeSchema, native44BodyCaptureScopeHash, validateNative44BodyCaptureScope, type Native44BodyCaptureScope } from './capture-scope.js';
import { normalizeViewportRaster } from './viewport-raster.js';
import { z } from 'zod';
import sharp from 'sharp';
import { NATIVE44_SELECTION_RULES_HASH } from './selection-rules.js';
import type { Native44SourceRenderEvidence } from './source-captures.js';
import { createNative44ReleaseDraft } from './release-lock.js';
import { syncNative44ContextIndex } from './context-bookkeeping.js';
import { SOURCE_OBSERVER_TOOLS, sourceObserverProvenanceAllowed, type SourceObserverTool } from '../replica-v2/observers.js';
import { BrowserCaptureTransactionSchema, inspectBrowserCaptureRaster, validateBrowserCaptureTransaction, type CaptureTransactionReport, type CaptureTransactionState } from '../replica-v2/capture-transaction.js';

export const NATIVE44_BROWSER_OBSERVATION_FILE = 'native44-browser-observation.json';
const finite = z.number().finite(), positive = finite.positive(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const geometry = z.object({ url: z.url(), viewport: z.object({ width: positive, height: positive, clientWidth: positive, scrollbarWidth: finite.nonnegative(), devicePixelRatio: positive }).strict(), scrollX: finite, scrollY: finite, pageHeight: positive, geometryHash: hash }).strict();
const segment = z.object({ screenshot: z.object({ path: z.string().min(1), sha256: hash }).strict(), documentTop: finite.nonnegative(), documentHeight: positive, cropTop: finite.nonnegative(), screenshotTop: finite.nonnegative().optional(), before: geometry, after: geometry }).strict();
const fileRef = z.object({ path: z.string().min(1), sha256: hash }).strict();
const expandedFrame = z.object({ screenshot:fileRef, before:geometry, after:geometry, contentHeight:positive, documentTop:finite.nonnegative(), documentHeight:positive, cropTop:finite.nonnegative(), packets:z.array(fileRef).min(1) }).strict();
const browserV2Schema = z.object({ version: z.literal(2), replicationProfile: z.literal(DESKTOP_BROWSER_PROFILE), renderEvidenceBySnapshot: z.record(z.string(), fileRef), browserObservation: z.object({ method: z.literal('user-opened-browser'), tool: z.literal('cua_repl'), browserId: z.string().min(1), tabId: z.string().min(1), requestedUrl: z.url(), actualUrl: z.url(), observedAt: z.iso.datetime(), captures: z.array(z.object({ snapshotId: z.string().min(1), packetHashes: z.array(hash).min(1), screenshotHash: hash, captureMode: z.enum(['full-page-stable', 'viewport-segments', 'equivalent-expanded-viewport']), before: geometry, after: geometry, segments: z.array(segment).min(1).max(100).optional(), expandedCapture: z.object({ before: geometry, after: geometry, packets: z.array(fileRef).min(1), frames:z.array(expandedFrame).min(1).max(100).optional() }).strict().optional() }).strict()).length(2) }).strict() }).strict();
const captureDocument = z.object({ key: z.string().min(1).max(240), revision: z.string().min(1).max(240), styleHash: hash }).strict();
const transactionBinding = z.object({ receipt: fileRef, document: captureDocument, fullPageCoverage: fileRef.optional() }).strict();
const browserV3Schema = browserV2Schema.extend({ version: z.literal(3), captureScope: native44BodyCaptureScopeSchema.optional(), browserObservation: browserV2Schema.shape.browserObservation.extend({ method: z.enum(['user-opened-browser', 'agent-opened-browser']), tool: z.enum(SOURCE_OBSERVER_TOOLS), frameId: z.string().min(1).max(240), captures: z.array(browserV2Schema.shape.browserObservation.shape.captures.element.extend({ captureTransaction: transactionBinding }).strict()).length(2) }).strict() }).strict();
const browserSchema = z.discriminatedUnion('version', [browserV2Schema, browserV3Schema]);
export type Native44TransactionalBrowserObservation = z.infer<typeof browserV3Schema>;
/** Shared readable surface keeps historical callers able to append v2 captures;
 * version-specific mandatory fields are enforced by the discriminated schema. */
type HistoricalBrowserObservation = z.infer<typeof browserV2Schema>;
export type Native44BrowserObservation = Omit<HistoricalBrowserObservation, 'version' | 'browserObservation'> & { version: 2 | 3; captureScope?: Native44BodyCaptureScope; browserObservation: Omit<HistoricalBrowserObservation['browserObservation'], 'method' | 'tool' | 'captures'> & { tool: SourceObserverTool; method: 'user-opened-browser' | 'agent-opened-browser'; frameId?: string; captures: Array<HistoricalBrowserObservation['browserObservation']['captures'][number] & { captureTransaction?: z.infer<typeof transactionBinding> }> } };
const normalizedURL = (value: string) => { const url = new URL(value); url.hash = ''; return url.href; };
/** Sampling scripts must hash the same node geometry before and after capture.
 * Sorting removes transport chunk/object order from this layout identity. */
export function native44ObservedGeometryHash(packets: ObservationPacketV2[], snapshotId: string, bodyRegionIds?: readonly string[]): string {
  const rows = new Map<string, unknown>();
  for (const packet of packets.filter(packet => packet.snapshot.id === snapshotId)) for (const node of Object.values(packet.nodes)) {
    if (bodyRegionIds && !bodyRegionIds.includes(node.regionId)) continue;
    const layout = packet.layouts[node.layoutId], rect = layout.captureGeometry?.rect ?? layout.rect, content = layout.captureGeometry?.contentRect ?? layout.contentRect;
    rows.set(node.id, [node.id, rect.x, rect.y, rect.width, rect.height, content.x, content.y, content.width, content.height, layout.display, layout.position]);
  }
  return sha256(JSON.stringify([...rows].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)));
}

function assertUnobstructedNative44BrowserPage(observation: ValidatedObservationV2): void {
  const challenge = /press\s*(?:and|&)\s*hold|verify\s+(?:that\s+)?you\s+are\s+human|checking\s+your\s+browser|complete\s+(?:the\s+)?captcha|access\s+denied|just\s+a\s+moment/i;
  const age = /are\s+you\s+(?:(?:at\s+least|over)\s+)?(?:18|21)(?:\s+years)?|confirm\s+(?:that\s+)?you\s+are\s+(?:over|at\s+least)\s+(?:18|21)|verify\s+your\s+age|age\s+verification|(?:enter|select|confirm)\s+(?:your\s+)?(?:date\s+of\s+birth|birth\s*date)/i;
  for (const snapshotId of new Set(observation.packets.map(packet => packet.snapshot.id))) {
    const rows = observation.packets.filter(packet => packet.snapshot.id === snapshotId), visible: string[] = [];
    for (const packet of rows) {
      if (packet.gaps.some(gap => /challenge|captcha|age[-_ ](?:verification|gate)|obstructed|verification[-_ ](?:required|overlay)/i.test(gap.code))) throw Error(`User browser page is obstructed by verification: ${snapshotId}; the user must complete it in the same tab`);
      for (const text of Object.values(packet.texts)) {
        const node = packet.nodes[text.nodeId]; if (!node?.visible) continue;
        let owner: typeof node | undefined = node, dialog = false, hidden = false; const seen = new Set<string>();
        while (owner && !seen.has(owner.id)) {
          seen.add(owner.id); const style = packet.styles[owner.styleId];
          if (!owner.visible || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') hidden = true;
          if (owner.attributes.role === 'dialog' || owner.attributes['aria-modal'] === 'true' || /(?:^|[\s_-])(?:age[-_ ]?(?:gate|verification)|captcha|challenge)(?:$|[\s_-])/i.test(`${owner.attributes.id ?? ''} ${owner.attributes.class ?? ''}`)) dialog = true;
          owner = owner.parentId ? packet.nodes[owner.parentId] : undefined;
        }
        if (hidden) continue;
        visible.push(text.text);
        if (dialog && (challenge.test(text.text) || age.test(text.text))) throw Error(`User browser verification overlay remains visible: ${snapshotId}; the user must complete it in the same tab`);
      }
    }
    const body = visible.join(' ').replace(/\s+/g, ' ').trim();
    if (challenge.test(body) || body.length < 600 && age.test(body)) throw Error(`User browser shows verification instead of normal page content: ${snapshotId}; the user must complete it in the same tab`);
  }
}

/** Binds actual packet and pixel evidence to one connected source tab. A provenance
 * label alone is never sufficient. */
export function validateNative44BrowserObservation(value: unknown, observation: ValidatedObservationV2, sourceUrl: string): Native44BrowserObservation {
  const parsed = browserSchema.safeParse(value);
  if (!parsed.success) throw Error(`Invalid native44 browser observation: ${parsed.error.message}`);
  const result = parsed.data, browser = result.browserObservation;
  const captureScope = result.version === 3 && result.captureScope ? validateNative44BodyCaptureScope(result.captureScope, observation.packets, sourceUrl) : undefined;
  assertUnobstructedNative44BrowserPage(observation);
  if (observation.manifest.provenance.method !== browser.method || observation.manifest.provenance.observer !== browser.tool || !sourceObserverProvenanceAllowed(browser.method, browser.tool, observation.manifest.provenance.browser) || normalizedURL(browser.requestedUrl) !== normalizedURL(sourceUrl) || normalizedURL(browser.actualUrl) !== normalizedURL(observation.manifest.sourceUrl)) throw Error('Browser tab URL/provenance differs from the actual source observation');
  const snapshots = [...new Map(observation.packets.map(packet => [packet.snapshot.id, packet.snapshot])).values()], required = native44ProfileViewports(result.replicationProfile);
  if (snapshots.length !== required.length || new Set(browser.captures.map(capture => capture.snapshotId)).size !== required.length) throw Error('Browser observation requires exactly the two desktop snapshots');
  for (const view of required) {
    const snapshot = snapshots.find(item => item.viewport.width === view.width && item.viewport.height === view.height), capture = browser.captures.find(item => item.snapshotId === snapshot?.id);
    if (!snapshot || !capture || snapshot.viewport.name !== (view.width === 1920 ? 'desktop' : 'desktop-narrow') || capture.screenshotHash !== snapshot.screenshot.sha256 || ![view.width, snapshot.viewport.clientWidth].includes(snapshot.screenshot.width) || snapshot.screenshot.height < snapshot.pageHeight - 1) throw Error('Browser screenshot is not the actual complete desktop viewport');
    const packetHashes = observation.manifest.packets.filter(packet => packet.snapshotId === snapshot.id).map(packet => packet.sha256).sort();
    if (JSON.stringify([...capture.packetHashes].sort()) !== JSON.stringify(packetHashes)) throw Error('Browser observation packet/entity hashes differ from the actual packets');
    for (const frame of [capture.before, capture.after]) {
      if (normalizedURL(frame.url) !== normalizedURL(browser.actualUrl) || ['width', 'height', 'clientWidth', 'scrollbarWidth', 'devicePixelRatio'].some(key => frame.viewport[key as keyof typeof frame.viewport] !== snapshot.viewport[key as keyof typeof snapshot.viewport]) || frame.pageHeight !== snapshot.pageHeight) throw Error('Browser screenshot geometry differs from its actual packet viewport');
    }
    if (JSON.stringify(capture.before) !== JSON.stringify(capture.after)) throw Error('Browser screenshot changed viewport, scroll or layout during capture; use stable viewport coverage');
    if (capture.before.geometryHash !== native44ObservedGeometryHash(observation.packets, snapshot.id, captureScope?.snapshots.find(row => row.snapshotId === snapshot.id)?.bodyRegionIds)) throw Error('Browser screenshot geometry hash is not bound to the actual observed node layouts');
    if (capture.captureMode === 'equivalent-expanded-viewport') {
      const proof = capture.expandedCapture;
      if (!proof || capture.segments || JSON.stringify(proof.before) !== JSON.stringify(proof.after) || normalizedURL(proof.before.url) !== normalizedURL(browser.actualUrl) || proof.before.viewport.clientWidth !== snapshot.viewport.clientWidth || !captureScope && proof.before.pageHeight !== snapshot.pageHeight || proof.before.viewport.devicePixelRatio !== snapshot.viewport.devicePixelRatio || proof.before.scrollX !== 0 || proof.before.scrollY !== 0 || snapshot.screenshot.width !== snapshot.viewport.clientWidth || !captureScope && snapshot.screenshot.height !== snapshot.pageHeight) throw Error('Expanded capture lacks an exact stable auxiliary viewport proof');
      if (proof.frames) {
        if(proof.before.viewport.width!==snapshot.viewport.width||proof.before.viewport.height<snapshot.viewport.height||proof.before.viewport.scrollbarWidth!==snapshot.viewport.scrollbarWidth)throw Error('Tall auxiliary capture changed the desktop width or scrollbar');
        let cursor=0;
        for(const frame of proof.frames){
          if(JSON.stringify(frame.before)!==JSON.stringify(frame.after)||JSON.stringify(frame.before.viewport)!==JSON.stringify(proof.before.viewport)||normalizedURL(frame.before.url)!==normalizedURL(browser.actualUrl)||frame.before.pageHeight!==snapshot.pageHeight||frame.before.scrollX!==0||frame.documentTop!==cursor||frame.before.scrollY+frame.cropTop!==frame.documentTop||frame.cropTop+frame.documentHeight>frame.contentHeight||frame.contentHeight>frame.before.viewport.height||![frame.cropTop,frame.documentTop,frame.documentHeight,frame.contentHeight].every(Number.isInteger))throw Error('Tall viewport frames changed geometry or have incomplete pixel coverage');
          cursor+=frame.documentHeight;
        }
        if(cursor!==snapshot.pageHeight)throw Error('Tall viewport frames do not cover the complete source page');
      } else {
        const direct = proof.before.viewport.width === snapshot.viewport.clientWidth && proof.before.viewport.height === snapshot.pageHeight && proof.before.viewport.scrollbarWidth === 0;
        const scopedTall = !!captureScope && proof.before.viewport.width === snapshot.viewport.width && proof.before.viewport.height >= snapshot.pageHeight && proof.before.viewport.scrollbarWidth === snapshot.viewport.scrollbarWidth && snapshot.screenshot.height === proof.before.viewport.height;
        if (!direct && !scopedTall) throw Error('Expanded capture lacks an exact stable auxiliary viewport proof');
      }
    } else if (capture.expandedCapture) throw Error('Expanded evidence cannot be attached to a historical capture mode');
    if (capture.captureMode === 'full-page-stable' && capture.segments || capture.captureMode === 'viewport-segments' && !capture.segments?.length) throw Error('Browser capture mode does not match its actual segment evidence');
    let cursor = 0;
    for (const frame of capture.segments ?? []) {
      const screenshotTop = frame.screenshotTop ?? frame.before.scrollY;
      if (JSON.stringify(frame.before) !== JSON.stringify(frame.after) || frame.before.geometryHash !== capture.before.geometryHash || JSON.stringify(frame.before.viewport) !== JSON.stringify(capture.before.viewport) || frame.before.pageHeight !== snapshot.pageHeight || normalizedURL(frame.before.url) !== normalizedURL(browser.actualUrl) || frame.documentTop !== cursor || screenshotTop + frame.cropTop !== frame.documentTop || screenshotTop < frame.before.scrollY || frame.documentTop + frame.documentHeight > frame.before.scrollY + snapshot.viewport.height || frame.before.scrollX !== 0) throw Error('Viewport screenshot segments have changed geometry or incomplete actual coverage');
      cursor += frame.documentHeight;
    }
    if (capture.segments && cursor !== snapshot.pageHeight) throw Error('Viewport screenshot segments do not cover the complete page');
    if (Date.parse(snapshot.capturedAt) < Date.parse(browser.observedAt)) throw Error('Browser snapshot predates the bound user-tab observation');
  }
  if (Object.keys(result.renderEvidenceBySnapshot).length !== snapshots.length || snapshots.some(snapshot => !result.renderEvidenceBySnapshot[snapshot.id])) throw Error('Browser observation requires actual render evidence for both source snapshots');
  return result;
}

async function readBrowserEvidenceFile(directory: string, reference: { path: string; sha256: string }): Promise<Buffer> {
  const root = await realpath(directory), filename = path.resolve(root, reference.path), relative = path.relative(root, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || (await realpath(filename)).toLowerCase() !== filename.toLowerCase()) throw Error('Browser evidence escaped the observation directory');
  const bytes = await readFile(filename); if (bytes.length > 50_000_000 || sha256(bytes) !== reference.sha256) throw Error('Browser render evidence hash changed'); return bytes;
}
function assertBrowserEvidenceData(value: unknown, at = '$'): void {
  if (typeof value === 'string' && value.includes('[MaxDepth]') || typeof value === 'number' && !Number.isFinite(value)) throw Error(`Truncated browser render evidence: ${at}`);
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (/^(?:cookies?|set-cookie|authorization|storageState|localStorage|sessionStorage|accessToken|consumer_secret|wp_app_password)$/i.test(key)) throw Error(`Browser rendering cannot export authentication/session data: ${at}.${key}`);
    assertBrowserEvidenceData(item, `${at}.${key}`);
  }
}

/** Resource identities come from actual hash-bound read-only target evidence.
 * A local scope declaration alone cannot waive source header rendering. */
export async function readNative44BodyCaptureScopeEvidence(binding: Native44BrowserObservation, directory: string): Promise<void> {
  if (!binding.captureScope) return;
  if (binding.version !== 3) throw Error('native44_body_capture_scope_requires_v3');
  const fields = ['headerId', 'sharedHash', 'headerHash', 'menuHash', 'styleHash'] as const;
  let matched = false;
  if (binding.captureScope.selection) {
    const selection = binding.captureScope.selection;
    const value = JSON.parse((await readBrowserEvidenceFile(directory, selection.evidence)).toString('utf8'));
    if (value?.version !== 1 || value.kind !== 'clonewp-body-selection-request' || value.taskId !== binding.captureScope.taskId || value.sourceUrl !== binding.captureScope.sourceUrl || value.userInstruction !== selection.userInstruction || value.targetSlug !== selection.targetSlug) throw Error('native44_body_capture_scope_selection_request_identity');
  }
  for (const reference of binding.captureScope.evidence) {
    const value = JSON.parse((await readBrowserEvidenceFile(directory, reference)).toString('utf8'));
    assertBrowserEvidenceData(value);
    const identity = value?.reusedHeader ?? value;
    if (!fields.every(field => Object.hasOwn(identity ?? {}, field))) continue;
    if (fields.some(field => identity[field] !== binding.captureScope!.reusedHeader[field])) throw Error('native44_body_capture_scope_header_evidence_mismatch');
    matched = true;
  }
  if (!matched) throw Error('native44_body_capture_scope_header_evidence_missing');
}
/** Initial rendering is task-neutral. Its identity comes from actual browser
 * snapshot/pixels; the importer adds only the newly allocated job identity. */
export async function readNative44BrowserRendering(binding: Native44BrowserObservation, directory: string, observation: ValidatedObservationV2): Promise<Map<string, { reference: { path: string; sha256: string }; value: Native44SourceRenderEvidence }>> {
  const result = new Map<string, { reference: { path: string; sha256: string }; value: Native44SourceRenderEvidence }>();
  for (const [snapshotId, reference] of Object.entries(binding.renderEvidenceBySnapshot)) {
    const value = JSON.parse((await readBrowserEvidenceFile(directory, reference)).toString('utf8')) as Native44SourceRenderEvidence;
    assertBrowserEvidenceData(value);
    const snapshot = observation.packets.find(packet => packet.snapshot.id === snapshotId)?.snapshot;
    const capture = binding.browserObservation.captures.find(item => item.snapshotId === snapshotId);
    const auxiliaryViewport = binding.version === 3 && binding.captureScope?.selection && capture?.captureMode === 'equivalent-expanded-viewport' ? capture.expandedCapture?.before.viewport : undefined;
    const viewportMatches = [snapshot?.viewport, auxiliaryViewport].some(viewport => viewport && ['width', 'height', 'clientWidth', 'devicePixelRatio'].every(key => value.viewport?.[key as keyof typeof value.viewport] === viewport[key as keyof typeof viewport]));
    if (!snapshot || value.version !== 1 || value.snapshotId !== snapshot.id || value.sourceUrl !== observation.manifest.sourceUrl || value.screenshotHash !== snapshot.screenshot.sha256 || !Number.isFinite(Date.parse(value.capturedAt)) || Date.parse(value.capturedAt) < Date.parse(binding.browserObservation.observedAt) || !viewportMatches || value.fontsReady !== true || !Array.isArray(value.media) || !Array.isArray(value.states)) throw Error('Browser render evidence lacks actual snapshot, font readiness, media or state identity');
    if (binding.version === 3) {
      const capture = binding.browserObservation.captures.find(item => item.snapshotId === snapshotId)!;
      const actualDocument = captureDocument.safeParse((value as Native44SourceRenderEvidence & { document?: unknown }).document);
      if (!actualDocument.success || JSON.stringify(actualDocument.data) !== JSON.stringify(capture.captureTransaction?.document)) throw Error('Transactional browser render document identity differs from its capture');
    }
    result.set(snapshotId, { reference, value });
  }
  return result;
}

/** New sidecar v3 is an explicit protocol. Replaying frozen receipts uses their
 * capture-period clock, never today's date. This establishes capture consistency
 * only and cannot mark a source/target visual comparison as passed. */
export async function verifyNative44BrowserCaptureTransactions(binding: Native44BrowserObservation, directory: string, observation: ValidatedObservationV2): Promise<Array<{ snapshotId: string; report: CaptureTransactionReport }>> {
  if (binding.version !== 3) return [];
  validateNative44BrowserObservation(binding, observation, observation.manifest.sourceUrl);
  await readNative44BodyCaptureScopeEvidence(binding, directory);
  const modern = browserV3Schema.parse(binding);
  const rendering = await readNative44BrowserRendering(binding, directory, observation), reports: Array<{ snapshotId: string; report: CaptureTransactionReport }> = [];
  for (const capture of modern.browserObservation.captures) {
    const snapshot = observation.packets.find(packet => packet.snapshot.id === capture.snapshotId)!.snapshot;
    const bytes = await readBrowserEvidenceFile(directory, capture.captureTransaction.receipt), transaction = BrowserCaptureTransactionSchema.parse(JSON.parse(bytes.toString('utf8')));
    assertBrowserEvidenceData(transaction);
    const last = transaction.attempts.at(-1), completedAt = last && Date.parse(last.finishedAt), startedAt = Date.parse(transaction.startedAt);
    if (!completedAt || startedAt < Date.parse(binding.browserObservation.observedAt) || [snapshot.capturedAt, rendering.get(snapshot.id)!.value.capturedAt].some(value => Date.parse(value) < startedAt || Date.parse(value) > completedAt)) throw Error('Browser transaction and source packet/render evidence are from different capture periods');
    const expected = transaction.expected;
    if (transaction.binding.browserId !== modern.browserObservation.browserId || transaction.binding.tabId !== modern.browserObservation.tabId || transaction.binding.frameId !== modern.browserObservation.frameId || normalizedURL(expected.url) !== normalizedURL(modern.browserObservation.actualUrl) || JSON.stringify(expected.document) !== JSON.stringify(capture.captureTransaction.document)) throw Error('Browser transaction tab/frame/URL/document identity differs from its source capture');
    const viewportKeys = ['width', 'height', 'clientWidth', 'devicePixelRatio'] as const;
    const sourceViewportMatches = viewportKeys.every(key => expected.viewport[key] === snapshot.viewport[key]);
    // A selected-section physical raster may be captured in an independently
    // verified equivalent viewport. Its transaction records that actual viewport,
    // while the source packets retain the requested desktop dimensions.
    const auxiliary = modern.captureScope?.selection && capture.captureMode === 'equivalent-expanded-viewport' ? capture.expandedCapture?.before.viewport : undefined;
    if (!sourceViewportMatches && !(auxiliary && viewportKeys.every(key => expected.viewport[key] === auxiliary[key]))) throw Error('Browser transaction viewport differs from its source snapshot');
    const screenshot = [...transaction.attempts].reverse().find(item => item.stage === 'screenshot' && item.outcome === 'ok');
    if (!screenshot || screenshot.stage !== 'screenshot' || screenshot.outcome !== 'ok') throw Error('Browser transaction lacks its actual screenshot stage');
    const captured = screenshot.data as { before: CaptureTransactionState; after: CaptureTransactionState; artifact: { sha256: string; width: number; height: number; mode: 'viewport' | 'full-page'; fullPageReceipt?: { sha256: string; complete: boolean; seamless: boolean; layoutPreserved: boolean } } };
    for (const [state, geometry] of [[captured.before, capture.before], [captured.after, capture.after]] as const) if (state.geometryHash !== geometry.geometryHash || state.scroll.x !== geometry.scrollX || state.scroll.y !== geometry.scrollY) throw Error('Browser transaction screenshot geometry/scroll differs from actual source packets');
    if (captured.artifact.sha256 !== snapshot.screenshot.sha256 || captured.artifact.width !== snapshot.screenshot.width || captured.artifact.height !== snapshot.screenshot.height) throw Error('Browser transaction screenshot differs from the source raster identity');
    if (captured.artifact.mode === 'full-page') {
      const reference = capture.captureTransaction.fullPageCoverage;
      if (!reference || captured.artifact.fullPageReceipt?.sha256 !== reference.sha256) throw Error('Browser full-page transaction requires its actual bound coverage receipt');
      const coverage = z.object({ version: z.literal(1), kind: z.literal('native44-capture-coverage'), snapshotId: z.string(), screenshotHash: hash, captureMode: z.enum(['full-page-stable', 'viewport-segments', 'equivalent-expanded-viewport']), geometryHash: hash, pageHeight: positive, complete: z.literal(true), seamless: z.literal(true), layoutPreserved: z.literal(true), captureScopeHash: hash.optional() }).strict().parse(JSON.parse((await readBrowserEvidenceFile(directory, reference)).toString('utf8')));
      if (coverage.snapshotId !== capture.snapshotId || coverage.screenshotHash !== snapshot.screenshot.sha256 || coverage.captureMode !== capture.captureMode || coverage.geometryHash !== capture.before.geometryHash || coverage.pageHeight !== snapshot.pageHeight) throw Error('Browser transaction coverage receipt differs from the actual source capture');
      if (binding.captureScope ? coverage.captureScopeHash !== native44BodyCaptureScopeHash(binding.captureScope) : coverage.captureScopeHash !== undefined) throw Error('native44_body_capture_scope_coverage_mismatch');
    } else if (capture.captureTransaction.fullPageCoverage) throw Error('Viewport transaction cannot acquire a full-page coverage receipt');
    const raster = await inspectBrowserCaptureRaster(await readBrowserEvidenceFile(directory, snapshot.screenshot));
    const report = validateBrowserCaptureTransaction(transaction, { nowMs: completedAt, raster });
    if (report.status !== 'verified') throw Error(`native44_browser_capture_transaction_${report.code}: ${capture.snapshotId}`);
    reports.push({ snapshotId: capture.snapshotId, report });
  }
  return reports;
}

/** Verify that the diagnostic composition really consists of the supplied
 * viewport pixels, rather than trusting a hand-written coverage declaration. */
export async function verifyNative44BrowserSegmentPixels(binding: Native44BrowserObservation, directory: string, observation: ValidatedObservationV2): Promise<void> {
  const root = await realpath(directory);
  await verifyNative44BrowserCaptureTransactions(binding, root, observation);
  for (const capture of binding.browserObservation.captures) {
    const bodyRegionIds = binding.captureScope?.snapshots.find(row => row.snapshotId === capture.snapshotId)?.bodyRegionIds;
    if (capture.captureMode === 'equivalent-expanded-viewport') {
      const proof = capture.expandedCapture!, snapshot = observation.packets.find(packet => packet.snapshot.id === capture.snapshotId)!.snapshot;
      const packets: ObservationPacketV2[] = [];
      for (const reference of proof.packets) packets.push(validateObservationPacketV2(JSON.parse((await readBrowserEvidenceFile(directory, reference)).toString('utf8'))));
      if(packets.some(packet=>['width','height','clientWidth','scrollbarWidth','devicePixelRatio'].some(key=>packet.snapshot.viewport[key as keyof typeof packet.snapshot.viewport]!==proof.before.viewport[key as keyof typeof proof.before.viewport])||packet.snapshot.pageHeight!==proof.before.pageHeight||Date.parse(packet.snapshot.capturedAt)<Date.parse(binding.browserObservation.observedAt)))throw Error('Expanded packets differ from the actual auxiliary capture viewport/time');
      if (new Set(packets.map(packet => packet.snapshot.id)).size !== 1 || packets.some(packet => packet.snapshot.screenshot.sha256 !== snapshot.screenshot.sha256 || packet.snapshot.screenshot.width !== snapshot.screenshot.width || packet.snapshot.screenshot.height !== snapshot.screenshot.height)) throw Error('Expanded packets do not bind the actual source pixels');
      if (native44ObservedGeometryHash(packets, packets[0].snapshot.id, bodyRegionIds) !== proof.before.geometryHash) throw Error('Expanded geometry hash differs from its observed auxiliary packets');
      assertExpandedCaptureEquivalent(observation.packets.filter(packet => packet.snapshot.id === capture.snapshotId), packets, { bodyScope: binding.captureScope });
      const bytes = await readBrowserEvidenceFile(directory, snapshot.screenshot), metadata = await sharp(bytes).metadata();
      if(proof.frames){
        const pieces=[];
        for(const frame of proof.frames){
          const framePackets:ObservationPacketV2[]=[];
          for(const ref of frame.packets)framePackets.push(validateObservationPacketV2(JSON.parse((await readBrowserEvidenceFile(directory,ref)).toString('utf8'))));
          if(new Set(framePackets.map(packet=>packet.snapshot.id)).size!==1||native44ObservedGeometryHash(framePackets,framePackets[0].snapshot.id,bodyRegionIds)!==frame.before.geometryHash||framePackets.some(packet=>packet.snapshot.screenshot.sha256!==snapshot.screenshot.sha256||packet.snapshot.pageHeight!==frame.before.pageHeight||['width','height','clientWidth','scrollbarWidth','devicePixelRatio'].some(key=>packet.snapshot.viewport[key as keyof typeof packet.snapshot.viewport]!==frame.before.viewport[key as keyof typeof frame.before.viewport])||Date.parse(packet.snapshot.capturedAt)<Date.parse(binding.browserObservation.observedAt)))throw Error('Tall viewport frame lacks its own bound source geometry');
          assertExpandedCaptureEquivalent(observation.packets.filter(packet=>packet.snapshot.id===capture.snapshotId),framePackets,{clip:{top:frame.documentTop,height:frame.documentHeight},bodyScope:binding.captureScope});
          const normalized=await normalizeViewportRaster(await readBrowserEvidenceFile(directory,frame.screenshot),frame.before.viewport,frame.contentHeight);
          pieces.push({input:await sharp(normalized).extract({left:0,top:frame.cropTop,width:snapshot.screenshot.width,height:frame.documentHeight}).png().toBuffer(),left:0,top:frame.documentTop});
        }
        const expected=await sharp({create:{width:snapshot.screenshot.width,height:snapshot.screenshot.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(pieces).raw().toBuffer();
        if(metadata.width!==snapshot.screenshot.width||metadata.height!==snapshot.screenshot.height||!expected.equals(await sharp(bytes).ensureAlpha().raw().toBuffer()))throw Error('Tall source composition differs from the declared viewport pixels');
      } else if (metadata.width !== proof.before.viewport.width || metadata.height !== proof.before.viewport.height) throw Error('Expanded screenshot is not the actual unscaled auxiliary viewport raster');
    }
    if (!capture.segments) continue;
    const snapshot = observation.packets.find(packet => packet.snapshot.id === capture.snapshotId)!.snapshot, pieces = [];
    for (const frame of capture.segments) {
      const filename = path.resolve(root, frame.screenshot.path), relative = path.relative(root, filename);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || (await realpath(filename)).toLowerCase() !== filename.toLowerCase()) throw Error('Browser segment escaped the observation directory');
      const bytes = await readFile(filename); if (bytes.length > 30_000_000 || sha256(bytes) !== frame.screenshot.sha256) throw Error('Browser viewport segment screenshot hash changed');
      const metadata = await sharp(bytes).metadata();
      if (![snapshot.viewport.width, snapshot.viewport.clientWidth].includes(metadata.width ?? -1) || (metadata.width ?? 0) < snapshot.screenshot.width || !metadata.height || metadata.height > snapshot.viewport.height || frame.cropTop + frame.documentHeight > metadata.height || !Number.isInteger(frame.cropTop) || !Number.isInteger(frame.documentHeight) || !Number.isInteger(frame.documentTop) || frame.screenshotTop !== undefined && !Number.isInteger(frame.screenshotTop)) throw Error('Browser segment pixels are not the actual viewport raster');
      pieces.push({ input: await sharp(bytes).extract({ left: 0, top: frame.cropTop, width: snapshot.screenshot.width, height: frame.documentHeight }).png().toBuffer(), left: 0, top: frame.documentTop });
    }
    const combined = await sharp({ create: { width: snapshot.screenshot.width, height: snapshot.screenshot.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(pieces).raw().toBuffer(), actual = await sharp(path.resolve(root, snapshot.screenshot.path)).ensureAlpha().raw().toBuffer();
    if (!combined.equals(actual)) throw Error('Source composition differs from its actual viewport segment pixels');
  }
}

export async function readNative44BrowserObservation(directory: string, sourceUrl: string): Promise<Native44BrowserObservation | undefined> {
  let bytes: string;
  try { bytes = await readFile(path.join(directory, NATIVE44_BROWSER_OBSERVATION_FILE), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const observation = await readObservationDirectoryV2(directory, sourceUrl);
  const binding = validateNative44BrowserObservation(JSON.parse(bytes), observation, sourceUrl);
  await verifyNative44BrowserSegmentPixels(binding, directory, observation); await readNative44BrowserRendering(binding, directory, observation); return binding;
}
/** Historical source APIs retain their marker; only the default new intake adds the strategy. */
async function identify(job: PreparedReplicaJobV2, root: string, replicationProfile?: Native44ReplicationProfile, binding?: Native44BrowserObservation, observedDirectory?: string) {
  const identity = await native44KnowledgeIdentity(root);
  let sourceCollection;
  let sourceRenderEvidenceBySnapshot: Record<string, { path: string; sha256: string }> | undefined;
  if (binding) {
    // Relocation legitimately changes packet paths and hashes; rebind to the
    // relocated actual bytes while retaining the immutable browser geometry.
    const relocated = await readObservationDirectoryV2(path.dirname(job.observationPath), job.url);
    const original = await readObservationDirectoryV2(observedDirectory!, job.url), rawRendering = await readNative44BrowserRendering(binding, observedDirectory!, original);
    sourceRenderEvidenceBySnapshot = {};
    for (const [index, [snapshotId, rendering]] of [...rawRendering].entries()) {
      const rawName = `browser-render-original-${index}.json`, derivedName = `browser-render-${index}.json`, destination = path.join(path.dirname(job.observationPath), rawName);
      await copyFile(path.resolve(observedDirectory!, rendering.reference.path), destination);
      const hostDecodedAssets = [];
      for (const [assetIndex, asset] of (rendering.value.hostDecodedAssets ?? []).entries()) {
        const assetBytes = await readBrowserEvidenceFile(observedDirectory!, asset.asset), assetName = `browser-decoded-${index}-${assetIndex}.bin`, assetPath = path.join(path.dirname(job.observationPath), assetName);
        await copyFile(path.resolve(observedDirectory!, asset.asset.path), assetPath);
        hostDecodedAssets.push({ ...asset, taskId: job.jobId, asset: { path: assetPath, sha256: sha256(assetBytes) } });
      }
      const sourceViewport = original.packets.find(packet => packet.snapshot.id === snapshotId)!.snapshot.viewport;
      const projected = binding.version === 3 && binding.captureScope?.selection && ['width','height','clientWidth','devicePixelRatio'].some(key => rendering.value.viewport[key as keyof typeof rendering.value.viewport] !== sourceViewport[key as keyof typeof sourceViewport]);
      const record = { ...rendering.value, ...(projected ? { captureViewport: rendering.value.viewport, viewport: { width: sourceViewport.width, height: sourceViewport.height, clientWidth: sourceViewport.clientWidth, devicePixelRatio: sourceViewport.devicePixelRatio }, viewportProjection: { kind: 'verified-selected-body-equivalent-viewport', captureScopeHash: native44BodyCaptureScopeHash(binding.captureScope!) } } : {}), ...(rendering.value.hostDecodedAssets ? { hostDecodedAssets } : {}), taskId: job.jobId, originalEvidence: { path: rawName, sha256: rendering.reference.sha256 } };
      const filename = path.join(path.dirname(job.observationPath), derivedName); await writeJson(filename, record);
      sourceRenderEvidenceBySnapshot[snapshotId] = { path: filename, sha256: sha256(await readFile(filename)) };
    }
    const captures = structuredClone(binding.browserObservation.captures);
    const captureScope = binding.captureScope && structuredClone(binding.captureScope);
    if (captureScope) for (const [index, reference] of captureScope.evidence.entries()) {
      const filename = `browser-scope-evidence-${index}.json`;
      await copyFile(path.resolve(observedDirectory!, reference.path), path.join(path.dirname(job.observationPath), filename));
      reference.path = filename;
    }
    if (captureScope?.selection) {
      const reference = captureScope.selection.evidence, filename = 'browser-body-selection.json';
      await copyFile(path.resolve(observedDirectory!, reference.path), path.join(path.dirname(job.observationPath), filename));
      reference.path = filename;
    }
    if (binding.version === 3) for (const [index, capture] of (captures as Native44TransactionalBrowserObservation['browserObservation']['captures']).entries()) {
      for (const [kind, reference] of Object.entries({ transaction: capture.captureTransaction.receipt, coverage: capture.captureTransaction.fullPageCoverage })) if (reference) {
        const filename = `browser-${kind}-${index}.json`;
        await copyFile(path.resolve(observedDirectory!, reference.path), path.join(path.dirname(job.observationPath), filename)); reference.path = filename;
      }
    }
    for (const [captureIndex, capture] of captures.entries()) for (const [index, reference] of (capture.expandedCapture?.packets ?? []).entries()) {
      const filename = `browser-expanded-${captureIndex}-${index}.json`;
      await copyFile(path.resolve(observedDirectory!, reference.path), path.join(path.dirname(job.observationPath), filename));
      reference.path = filename;
    }
    for(const [captureIndex,capture]of captures.entries())for(const [frameIndex,frame]of(capture.expandedCapture?.frames??[]).entries()){
      const pixelName=`browser-tall-${captureIndex}-${frameIndex}${path.extname(frame.screenshot.path)||'.bin'}`;
      await copyFile(path.resolve(observedDirectory!,frame.screenshot.path),path.join(path.dirname(job.observationPath),pixelName));frame.screenshot.path=pixelName;
      for(const [index,reference]of frame.packets.entries()){
        const filename=`browser-tall-packet-${captureIndex}-${frameIndex}-${index}.json`;
        await copyFile(path.resolve(observedDirectory!,reference.path),path.join(path.dirname(job.observationPath),filename));reference.path=filename;
      }
    }
    for (const [captureIndex, capture] of captures.entries()) for (const [index, frame] of (capture.segments ?? []).entries()) {
      const filename = `browser-viewport-${captureIndex}-${index}.png`;
      await copyFile(path.resolve(observedDirectory!, frame.screenshot.path), path.join(path.dirname(job.observationPath), filename));
      frame.screenshot.path = filename;
    }
    const record = { ...binding, ...(captureScope ? { captureScope } : {}), renderEvidenceBySnapshot: Object.fromEntries(Object.entries(sourceRenderEvidenceBySnapshot).map(([id, ref]) => [id, { ...ref, path: path.relative(path.dirname(job.observationPath), ref.path) }])), selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: job.jobId, sourceUrl: job.url, collectionStartedAt: binding.browserObservation.observedAt, browserObservation: { ...binding.browserObservation, captures: captures.map(capture => ({ ...capture, packetHashes: relocated.manifest.packets.filter(packet => packet.snapshotId === capture.snapshotId).map(packet => packet.sha256) })) } };
    const filename = path.join(job.jobDir, NATIVE44_BROWSER_OBSERVATION_FILE); await writeJson(filename, record);
    sourceCollection = { path: filename, sha256: sha256(await readFile(filename)) };
  }
  const releaseLock = replicationProfile ? await createNative44ReleaseDraft(root, job.jobDir, job.jobId) : undefined;
  const result = { ...job, taskId: job.jobId, executionStrategy: NATIVE44_STRATEGY, ...identity, ...(replicationProfile ? { replicationProfile, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, editorNaming: NATIVE44_NATIVE_EDITOR_NAMING, reviewWorkflow: NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW, visualAuditVersion: 2, articleListPolicy: NATIVE44_ARTICLE_LIST_POLICY } : {}), ...(sourceCollection ? { sourceCollection, sourceRenderEvidenceBySnapshot } : {}), ...(releaseLock ? { releaseLock } : {}) };
  await writeJson(path.join(job.jobDir, 'job.json'), result); await syncNative44ContextIndex(root, job.jobDir); return result;
}
export async function prepareNative44Reference(url: string, options: PrepareReferenceV2Options = {}) {
  // Deliberately no DNS lookup, HTTP request, browser launch or credentials.
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || [...parsed.searchParams.keys()].some(key => /token|nonce|password|authorization|secret/i.test(key))) throw Error('Credentials or non-HTTP(S) source URL are forbidden');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || ['localhost', 'metadata.google.internal'].includes(hostname) || /\.(?:local|internal)$/.test(hostname) || isIP(hostname) && !isPublicAddress(hostname)) throw Error('Private, reserved, or internal source URL is forbidden');
  const root = path.resolve(options.root ?? process.cwd());
  const identity = await native44KnowledgeIdentity(root);
  return { version: 2 as const, workflow: 'block-replication' as const, mode: 'replica' as const, executionStrategy: NATIVE44_STRATEGY, replicationProfile: DESKTOP_BROWSER_PROFILE, editorNaming: NATIVE44_NATIVE_EDITOR_NAMING, reviewWorkflow: NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW, visualAuditVersion: 2 as const, articleListPolicy: NATIVE44_ARTICLE_LIST_POLICY, goalProfile: 'component-reference-v1' as const, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, url, status: 'awaiting-browser-observation' as const, ...identity, requiredViewports: native44ProfileViewports(DESKTOP_BROWSER_PROFILE), observationFile: NATIVE44_BROWSER_OBSERVATION_FILE, requiredBrowserSidecarVersion: 3 as const, captureValidationScope: 'capture-consistency-only' as const, nextAction: 'Agent first reuses the exact connected source tab, then runs browser:preflight --recover with autoOpen:true when needed. Sidecar version 3 records the actual user-opened-browser or agent-opened-browser provenance and hashed capture transactions for both desktop snapshots. Import with --observed. This preparation step made no source or target request.' };
}
export async function prepareObservedNative44Reference(url: string, directory: string, options: { root?: string; jobId?: string } = {}) {
  await assertPublicUrl(url);
  const root = path.resolve(options.root ?? process.cwd());
  await native44KnowledgeIdentity(root);
  const binding = await readNative44BrowserObservation(directory, url);
  const finalDeliveryPolicy = await freezeNewTaskFinalDeliveryPolicy(root);
  return identify(await prepareObservedReferenceV2(url, directory, { ...options, finalDeliveryPolicy }), root, binding?.replicationProfile, binding, directory);
}

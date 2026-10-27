import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { BROWSER_REQUEST_BUDGET_BYTES, classifyBrowserReadFailure } from './browser-diagnostics.js';

export const CAPTURE_RESPONSE_BUDGET_BYTES = 256 * 1024;
export const CAPTURE_MAX_RESPONSE_BUDGET_BYTES = 16 * 1024 * 1024;
export const CAPTURE_TRANSACTION_RETRY_LIMIT = 1;
export const CAPTURE_TRANSACTION_STAGES = ['url', 'dom', 'baseline', 'layout', 'screenshot', 'restore'] as const;
export type CaptureTransactionStage = typeof CAPTURE_TRANSACTION_STAGES[number];
const id = z.string().min(1).max(240), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime();
const positive = z.number().finite().positive(), nonnegative = z.number().finite().nonnegative();
const publicUrl = z.string().url().refine(value => {
  const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
});
const binding = z.object({ browserId: id, tabId: id, frameId: id }).strict();
const documentIdentity = z.object({ key: id, revision: id, styleHash: hash }).strict();
const viewport = z.object({
  width: positive, height: positive, clientWidth: positive, devicePixelRatio: positive,
  visualWidth: positive, visualHeight: positive, visualScale: positive,
}).strict();
const carousel = z.object({
  owner: id, initialized: z.boolean(), logicalIndex: z.number().int().nonnegative(),
  visibleIds: z.array(id).min(1).max(100), counter: z.string().max(240), transform: z.string().max(1000),
  animating: z.boolean(), autoplayRunning: z.boolean(), autoplayPaused: z.boolean(),
}).strict();
const state = z.object({
  observedAt: time, document: documentIdentity, viewport,
  geometryHash: hash, interactionHash: hash, overlayHash: hash,
  fonts: z.object({ ready: z.boolean(), failed: z.number().int().nonnegative(), fingerprint: hash, glyphProof: z.enum(['observed', 'unavailable']) }).strict(),
  media: z.object({ ready: z.boolean(), failed: z.number().int().nonnegative(), fingerprint: hash }).strict(),
  carousels: z.array(carousel).max(100), runningAnimations: z.number().int().nonnegative(),
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  coverage: z.object({ geometry: z.boolean(), visibleMedia: z.boolean(), carouselInventory: z.boolean() }).strict(),
}).strict();
export type CaptureTransactionState = z.infer<typeof state>;
const artifact = z.object({
  sha256: hash, width: positive.int(), height: positive.int(), mode: z.enum(['viewport', 'full-page']),
  // A full-page capture needs the existing collector's coverage/seamlessness receipt.
  fullPageReceipt: z.object({ sha256: hash, complete: z.boolean(), seamless: z.boolean(), layoutPreserved: z.boolean() }).strict().optional(),
}).strict();
const envelope = z.object({
  startedAt: time, finishedAt: time, binding,
  requestBytes: z.number().int().nonnegative(), responseBytes: z.number().int().nonnegative(),
}).strict();
const stageData = {
  url: z.object({ actualUrl: publicUrl }).strict(),
  dom: z.object({ actualUrl: publicUrl, document: documentIdentity, readyState: z.enum(['loading', 'interactive', 'complete']), bodyPresent: z.boolean() }).strict(),
  baseline: z.object({ state }).strict(),
  layout: z.object({ state }).strict(),
  screenshot: z.object({ before: state, after: state, artifact }).strict(),
  restore: z.object({ state }).strict(),
};
const attempt = z.union([
  ...CAPTURE_TRANSACTION_STAGES.map(stage => envelope.extend({ stage: z.literal(stage), outcome: z.literal('ok'), data: stageData[stage] }).strict()),
  envelope.extend({ stage: z.enum(CAPTURE_TRANSACTION_STAGES), outcome: z.literal('error'), error: z.string().min(1).max(8192) }).strict(),
]);
export const BrowserCaptureTransactionSchema = z.object({
  version: z.literal(2), kind: z.literal('browser-capture-transaction'),
  startedAt: time,
  binding,
  expected: z.object({
    url: publicUrl, document: documentIdentity, viewport,
    carouselOwners: z.array(id).max(100),
    fontProof: z.enum(['loaded-css', 'actual-glyphs']).default('loaded-css'),
  }).strict(),
  policy: z.object({
    maxAgeMs: positive.int().max(600_000).default(120_000),
    maxCaptureSpanMs: positive.int().max(60_000).default(30_000),
    requestBudgetBytes: positive.int().max(BROWSER_REQUEST_BUDGET_BYTES).default(BROWSER_REQUEST_BUDGET_BYTES),
    responseBudgetBytes: positive.int().max(CAPTURE_MAX_RESPONSE_BUDGET_BYTES).default(CAPTURE_RESPONSE_BUDGET_BYTES),
  }).strict().default({ maxAgeMs: 120_000, maxCaptureSpanMs: 30_000, requestBudgetBytes: BROWSER_REQUEST_BUDGET_BYTES, responseBudgetBytes: CAPTURE_RESPONSE_BUDGET_BYTES }),
  attempts: z.array(attempt).max(12),
}).strict();
export type BrowserCaptureTransaction = z.input<typeof BrowserCaptureTransactionSchema>;
type ParsedTransaction = z.infer<typeof BrowserCaptureTransactionSchema>;
type Attempt = ParsedTransaction['attempts'][number];
export interface InspectedCaptureRaster { sha256: string; width: number; height: number; format: string }
export interface CaptureTransactionIssue { code: string; stage: CaptureTransactionStage | 'transaction'; }
export interface CaptureTransactionReport {
  version: 2; kind: 'browser-capture-transaction-report';
  status: 'verified' | 'action-required' | 'blocked'; code: string; stage: CaptureTransactionStage | 'transaction';
  checked: CaptureTransactionStage[]; issues: CaptureTransactionIssue[];
  retry: { allowed: boolean; remaining: number; stage?: CaptureTransactionStage };
  restoration: { required: boolean; observed: boolean; consistent: boolean };
  evidence: { inputSha256: string; suppliedToolReceiptsOnly: true; rasterBytesVerified: boolean };
  budgets: { requestBytes: number; responseBytes: number; retriesPerTransaction: 1 };
  scope: 'capture-consistency-only'; limitations: string[]; nextActions: string[];
  remoteWrites: 0;
}

/** Canonicalizes actual observed facts locally. Never use expected facts to fill a missing observation. */
export function hashBrowserCaptureFacts(value: unknown): string {
  const seen = new Set<object>();
  const canonical = (child: unknown, depth = 0): unknown => {
    if (depth > 100 || child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint' || typeof child === 'number' && !Number.isFinite(child)) throw Error('browser_capture_facts_invalid');
    if (!child || typeof child !== 'object') return child;
    if (!Array.isArray(child) && ![Object.prototype, null].includes(Object.getPrototypeOf(child))) throw Error('browser_capture_facts_invalid');
    if (seen.has(child)) throw Error('browser_capture_facts_invalid');
    seen.add(child);
    const result = Array.isArray(child) ? child.map(item => canonical(item, depth + 1)) : Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, depth + 1)]));
    seen.delete(child); return result;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
/** Verifies real local screenshot bytes, not metadata asserted by a JSON input. No browser or network is used. */
export async function inspectBrowserCaptureRaster(bytes: Uint8Array): Promise<InspectedCaptureRaster> {
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw Error('browser_capture_raster_size_invalid');
  try {
    const image = sharp(bytes, { limitInputPixels: 120_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw Error();
    // Metadata alone does not establish that the full raster decodes.
    await image.stats();
    return { sha256: createHash('sha256').update(bytes).digest('hex'), width: metadata.width, height: metadata.height, format: metadata.format! };
  } catch { throw Error('browser_capture_raster_invalid'); }
}
const equal = (left: unknown, right: unknown) => hashBrowserCaptureFacts(left) === hashBrowserCaptureFacts(right);
const sameUrl = (left: string, right: string) => { const a = new URL(left), b = new URL(right); a.hash = ''; b.hash = ''; return a.href === b.href; };
function documentCode(actual: CaptureTransactionState['document'], expected: CaptureTransactionState['document']): string | undefined {
  if (actual.key !== expected.key) return 'document_identity_changed';
  if (actual.revision !== expected.revision) return 'document_revision_stale';
  if (actual.styleHash !== expected.styleHash) return 'document_style_revision_stale';
}
function validViewport(actual: CaptureTransactionState['viewport']): boolean {
  return actual.clientWidth <= actual.width && actual.devicePixelRatio <= 4 && actual.visualScale <= 4 && actual.visualWidth <= actual.width * 4 && actual.visualHeight <= actual.height * 4;
}
function readyStateCode(actual: CaptureTransactionState, expected: ParsedTransaction['expected'], allowOriginalMotion = false): string | undefined {
  if (!validViewport(actual.viewport)) return 'actual_viewport_invalid';
  if (!actual.coverage.geometry || !actual.coverage.visibleMedia || !actual.coverage.carouselInventory) return 'capture_observation_incomplete';
  if (!actual.fonts.ready || actual.fonts.failed) return 'fonts_not_ready';
  if (expected.fontProof === 'actual-glyphs' && actual.fonts.glyphProof !== 'observed') return 'actual_glyph_font_proof_missing';
  if (!actual.media.ready || actual.media.failed) return 'media_not_ready';
  if (!allowOriginalMotion && actual.runningAnimations) return 'capture_animation_unsettled';
  const owners = actual.carousels.map(item => item.owner);
  if (new Set(owners).size !== owners.length || !equal([...owners].sort(), [...expected.carouselOwners].sort())) return 'carousel_inventory_mismatch';
  if (actual.carousels.some(item => !item.initialized || !allowOriginalMotion && (item.animating || item.autoplayRunning && !item.autoplayPaused))) return 'carousel_not_stable';
}
function stateDifference(before: CaptureTransactionState, after: CaptureTransactionState): string | undefined {
  const changed = documentCode(after.document, before.document); if (changed) return changed;
  if (!equal(before.viewport, after.viewport)) return 'capture_viewport_changed';
  if (!equal(before.fonts, after.fonts)) return 'capture_fonts_changed';
  if (!equal(before.media, after.media)) return 'capture_media_changed';
  // Runtime inventory order is irrelevant; each owner's actual window is not.
  const ordered = (value: CaptureTransactionState) => [...value.carousels].sort((a, b) => a.owner.localeCompare(b.owner));
  if (!equal(ordered(before), ordered(after))) return 'capture_carousel_state_changed';
  if (before.geometryHash !== after.geometryHash) return 'capture_geometry_changed';
  if (before.interactionHash !== after.interactionHash) return 'capture_interaction_changed';
  if (before.overlayHash !== after.overlayHash) return 'capture_overlays_changed';
  if (before.runningAnimations !== after.runningAnimations) return 'capture_animation_state_changed';
  if (!equal(before.scroll, after.scroll)) return 'capture_scroll_changed';
}

/**
 * Validates a capture transaction assembled from supported CUA tool receipts.
 * It never controls a browser or grants source HTTP/headless access. Input
 * facts are not independently attested; only actual raster bytes are decoded.
 * Callers must carry the whole transaction forward, including failed attempts.
 */
export function validateBrowserCaptureTransaction(value: unknown, options: { nowMs?: number; raster?: InspectedCaptureRaster } = {}): CaptureTransactionReport {
  const parsed = BrowserCaptureTransactionSchema.safeParse(value);
  if (!parsed.success) throw Error('browser_capture_transaction_input_invalid');
  const input = parsed.data, now = options.nowMs ?? Date.now(), start = Date.parse(input.startedAt);
  if (!Number.isFinite(now)) throw Error('browser_capture_clock_invalid');
  const checked: CaptureTransactionStage[] = [], issues: CaptureTransactionIssue[] = [];
  const restoration = { required: false, observed: false, consistent: false };
  let retryUsed = 0, awaitingRetry: CaptureTransactionStage | undefined, next = 0, previousEnd = start;
  let baseline: CaptureTransactionState | undefined, layout: CaptureTransactionState | undefined;
  let rasterVerified = false, terminal = false, hasUnprovedGlyphs = false;
  const add = (code: string, stage: CaptureTransactionIssue['stage']) => { if (!issues.some(issue => issue.code === code && issue.stage === stage)) issues.push({ code, stage }); };
  const invalidTime = (begin: number, end: number) => begin < start || end < begin || end > now + 1000 || now - end > input.policy.maxAgeMs;
  if (start > now + 1000 || now - start > input.policy.maxAgeMs) { add('capture_transaction_stale', 'transaction'); terminal = true; }
  if (!validViewport(input.expected.viewport) || new Set(input.expected.carouselOwners).size !== input.expected.carouselOwners.length) { add('capture_expectation_invalid', 'transaction'); terminal = true; }
  for (const item of input.attempts) {
    const begin = Date.parse(item.startedAt), end = Date.parse(item.finishedAt);
    if (invalidTime(begin, end) || begin < previousEnd) { add('capture_observation_time_invalid', item.stage); terminal = true; }
    previousEnd = end;
    if (!equal(item.binding, input.binding)) { add('capture_binding_changed', item.stage); terminal = true; }
    if (item.requestBytes > input.policy.requestBudgetBytes) { add('capture_request_budget_exceeded', item.stage); terminal = true; }
    if (item.responseBytes > input.policy.responseBudgetBytes) { add('capture_response_budget_exceeded', item.stage); terminal = true; }
    // An aborted transaction may still provide its restoration receipt.
    const abortRestore = item.stage === 'restore' && baseline && (issues.length > 0 || next < CAPTURE_TRANSACTION_STAGES.indexOf('screenshot'));
    if (terminal && !abortRestore) continue;
    if (!abortRestore && item.stage !== CAPTURE_TRANSACTION_STAGES[next]) { add('capture_stage_order_invalid', item.stage); terminal = true; continue; }
    if (item.outcome === 'error') {
      const failure = classifyBrowserReadFailure(item.error);
      if (item.stage === 'restore') { restoration.observed = true; add('capture_restore_failed', item.stage); terminal = true; continue; }
      if (failure === 'cdp_timeout' && retryUsed < CAPTURE_TRANSACTION_RETRY_LIMIT && !awaitingRetry) {
        retryUsed++; awaitingRetry = item.stage; add('capture_cdp_timeout', item.stage); continue;
      }
      if (awaitingRetry === item.stage) {
        for (let index = issues.length - 1; index >= 0; index--) if (issues[index].code === 'capture_cdp_timeout' && issues[index].stage === item.stage) issues.splice(index, 1);
        awaitingRetry = undefined;
      }
      add(failure === 'cdp_timeout' ? 'capture_retry_exhausted' : failure, item.stage); terminal = true; continue;
    }
    if (awaitingRetry && !abortRestore) {
      if (awaitingRetry !== item.stage) { add('capture_retry_stage_changed', item.stage); terminal = true; continue; }
      for (let index = issues.length - 1; index >= 0; index--) if (issues[index].code === 'capture_cdp_timeout' && issues[index].stage === item.stage) issues.splice(index, 1);
      awaitingRetry = undefined;
    }
    const fail = (code: string | undefined) => { if (code) { add(code, item.stage); terminal = true; return true; } return false; };
    if (item.stage === 'url') {
      const data = item.data as z.infer<typeof stageData.url>;
      if (fail(sameUrl(data.actualUrl, input.expected.url) ? undefined : 'source_url_changed')) continue;
    } else if (item.stage === 'dom') {
      const data = item.data as z.infer<typeof stageData.dom>;
      if (fail(sameUrl(data.actualUrl, input.expected.url) ? documentCode(data.document, input.expected.document) : 'source_url_changed')) continue;
      if (fail(!data.bodyPresent || data.readyState === 'loading' ? 'source_document_not_ready' : undefined)) continue;
    } else {
      if (item.stage === 'restore') restoration.observed = true;
      const states = item.stage === 'screenshot' ? [(item.data as z.infer<typeof stageData.screenshot>).before, (item.data as z.infer<typeof stageData.screenshot>).after] : [(item.data as z.infer<typeof stageData.layout>).state];
      let bad = false;
      for (const observed of states) {
        const observedAt = Date.parse(observed.observedAt);
        if (fail(observedAt < begin || observedAt > end ? 'capture_state_time_invalid' : documentCode(observed.document, input.expected.document) ?? readyStateCode(observed, input.expected, item.stage === 'baseline' || item.stage === 'restore'))) { bad = true; break; }
        if (observed.fonts.glyphProof === 'unavailable') hasUnprovedGlyphs = true;
      }
      if (bad) continue;
      if (item.stage === 'baseline') { baseline = states[0]; restoration.required = true; }
      if (item.stage === 'layout') {
        if (fail(equal(states[0].viewport, input.expected.viewport) ? undefined : 'requested_viewport_not_applied')) continue;
        layout = states[0];
      }
      if (item.stage === 'screenshot') {
        const data = item.data as z.infer<typeof stageData.screenshot>;
        if (fail(!layout ? 'capture_layout_receipt_missing' : stateDifference(layout, data.before) ?? stateDifference(data.before, data.after))) continue;
        if (fail(Date.parse(data.after.observedAt) < Date.parse(data.before.observedAt) || Date.parse(data.after.observedAt) - Date.parse(data.before.observedAt) > input.policy.maxCaptureSpanMs ? 'capture_span_invalid' : undefined)) continue;
        if (fail(!options.raster ? 'capture_raster_evidence_required' : options.raster.sha256 !== data.artifact.sha256 || options.raster.width !== data.artifact.width || options.raster.height !== data.artifact.height ? 'capture_raster_bytes_mismatch' : undefined)) continue;
        rasterVerified = true;
        const { width, height, mode, fullPageReceipt } = data.artifact, actual = data.before.viewport;
        const scale = width / actual.width;
        if (fail(scale <= 0 || scale > 4 || (mode === 'viewport' ? Math.abs(height - actual.height * scale) > 1 : height < actual.height * scale) ? 'capture_raster_geometry_mismatch' : undefined)) continue;
        if (fail(mode === 'full-page' && (!fullPageReceipt?.complete || !fullPageReceipt.seamless || !fullPageReceipt.layoutPreserved) ? 'capture_full_page_unverified' : undefined)) continue;
      }
      if (item.stage === 'restore') {
        const difference = baseline ? stateDifference(baseline, states[0]) : 'capture_baseline_missing';
        restoration.consistent = !difference;
        if (fail(difference ? 'capture_restore_state_mismatch' : undefined)) continue;
        if (abortRestore && !issues.length) { add('capture_transaction_aborted', item.stage); terminal = true; }
      }
    }
    checked.push(item.stage);
    if (!abortRestore) next++;
  }
  if (restoration.observed) awaitingRetry = undefined;
  const waitingStage = CAPTURE_TRANSACTION_STAGES[next];
  const complete = next === CAPTURE_TRANSACTION_STAGES.length && !issues.length && restoration.consistent && rasterVerified;
  const retryAllowed = Boolean(awaitingRetry) && !terminal && !restoration.observed;
  const status = complete ? 'verified' : retryAllowed || !issues.length ? 'action-required' : 'blocked';
  const primary = issues[0], code = complete ? 'capture_transaction_verified' : primary?.code ?? `capture_${waitingStage ?? 'restore'}_required`;
  const nextActions = complete ? ['采集事务内部一致性已验证；继续独立的来源/目标视觉及交互验收。'] : retryAllowed
    ? ['仅对当前失败阶段、同一绑定重试一次受支持的小型只读操作；保留完整失败历史后重新验证。']
    : issues.length ? ['停止当前失败阶段；按具名分类核对身份、版本或渲染证据，不推断为整个浏览器离线。'] : [`通过受支持浏览器工具取得 ${waitingStage} 阶段的真实收据后重新验证。`];
  if (restoration.required && !restoration.consistent) nextActions.push('在 finally 中恢复并读回初始视口、滚动及交互状态；恢复未确认不能交付已完成采集。');
  return {
    version: 2, kind: 'browser-capture-transaction-report', status, code, stage: primary?.stage ?? waitingStage ?? 'transaction', checked, issues,
    retry: { allowed: retryAllowed, remaining: retryAllowed ? 1 : Math.max(0, CAPTURE_TRANSACTION_RETRY_LIMIT - retryUsed), ...(retryAllowed ? { stage: awaitingRetry } : {}) },
    restoration,
    evidence: { inputSha256: hashBrowserCaptureFacts(input), suppliedToolReceiptsOnly: true, rasterBytesVerified: rasterVerified },
    budgets: { requestBytes: input.policy.requestBudgetBytes, responseBytes: input.policy.responseBudgetBytes, retriesPerTransaction: 1 },
    scope: 'capture-consistency-only',
    limitations: ['仅验证代理提供的受支持工具收据；本验证器没有连接、操作或独立见证浏览器。', '采集内部一致性不等于来源与目标的视觉、业务功能或像素一致。', ...(hasUnprovedGlyphs ? ['字体就绪与CSS证据可用，但实际字形字体尚未证明。'] : [])],
    nextActions, remoteWrites: 0,
  };
}

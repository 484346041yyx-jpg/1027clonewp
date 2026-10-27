import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { browserPreflightMain } from '../src/replica-v2/browser-preflight-cli.js';
import { hashBrowserCaptureFacts, inspectBrowserCaptureRaster, validateBrowserCaptureTransaction, type BrowserCaptureTransaction } from '../src/replica-v2/capture-transaction.js';
import { browserCaptureTransactionFixture } from './fixtures/browser-capture-transaction-v2.js';

const nowMs = Date.parse('2026-10-17T06:00:00.000Z');
const bytes = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ffffff' } }).png().toBuffer();
const raster = await inspectBrowserCaptureRaster(bytes);
function fixture(time = nowMs): any { return browserCaptureTransactionFixture(time, raster); }
function validate(value: unknown) { return validateBrowserCaptureTransaction(value, { nowMs, raster }); }
function errorAttempt(value: any, index: number, error: string) {
  const attempt = value.attempts[index];
  value.attempts[index] = { ...attempt, outcome: 'error', error }; delete value.attempts[index].data;
}
function addRetry(value: any, index: number) {
  const retry = structuredClone(value.attempts[index]);
  retry.startedAt = new Date(Date.parse(retry.startedAt) + 600).toISOString();
  retry.finishedAt = new Date(Date.parse(retry.finishedAt) + 400).toISOString();
  if (retry.data?.state) retry.data.state.observedAt = new Date(Date.parse(retry.startedAt) + 100).toISOString();
  value.attempts.splice(index + 1, 0, retry);
  return retry;
}
async function runCli(args: string[], input: unknown, root = process.cwd()) {
  let output = '';
  const stdin = (async function* () { yield JSON.stringify(input); })();
  const exitCode = await browserPreflightMain(args, root, { stdin, write: value => { output += value; } });
  return { exitCode, output, report: JSON.parse(output) };
}

test('complete version 2 transaction verifies actual raster and restoration without claiming live attestation or fidelity', () => {
  const report = validate(fixture());
  assert.equal(report.status, 'verified'); assert.equal(report.code, 'capture_transaction_verified');
  assert.equal(report.scope, 'capture-consistency-only'); assert.equal(report.evidence.suppliedToolReceiptsOnly, true);
  assert.equal(report.evidence.rasterBytesVerified, true); assert.equal(report.remoteWrites, 0);
  assert.deepEqual(report.checked, ['url', 'dom', 'baseline', 'layout', 'screenshot', 'restore']);
  assert.deepEqual(report.restoration, { required: true, observed: true, consistent: true });
});

test('requested viewport is enforced even when screenshot before and after agree at the old size', () => {
  const input = fixture(); input.expected.viewport.width = 1440;
  const report = validate(input); assert.equal(report.code, 'requested_viewport_not_applied');
  assert.equal(report.stage, 'layout'); assert.equal(report.status, 'blocked');
});

test('same URL does not authorize stale document, CSS revision or another frame', () => {
  const input = fixture(); input.attempts[1].data.document.revision = 'previous-save';
  assert.equal(validate(input).code, 'document_revision_stale');
  const css = fixture(); css.attempts[1].data.document.styleHash = 'a'.repeat(64);
  assert.equal(validate(css).code, 'document_style_revision_stale');
  const frame = fixture(); frame.attempts[3].binding.frameId = 'other-frame';
  assert.equal(validate(frame).code, 'capture_binding_changed');
});

test('stale, future, out of order and state timestamps cannot establish a fresh capture', () => {
  assert.equal(validate(fixture(nowMs - 180_000)).code, 'capture_transaction_stale');
  assert.equal(validate(fixture(nowMs + 20_000)).code, 'capture_transaction_stale');
  const order = fixture(); order.attempts[1].startedAt = order.attempts[0].startedAt;
  assert.equal(validate(order).code, 'capture_observation_time_invalid');
  const state = fixture(); state.attempts[3].data.state.observedAt = state.attempts[1].finishedAt;
  assert.equal(validate(state).code, 'capture_state_time_invalid');
});

test('independent request and response budgets block before oversized evidence can count as a passed stage', () => {
  const input = fixture(); input.attempts[0].requestBytes = 3_441_908;
  assert.equal(validate(input).code, 'capture_request_budget_exceeded');
  const response = fixture(); response.attempts[0].responseBytes = 300_000;
  assert.equal(validate(response).code, 'capture_response_budget_exceeded');
  const reduced = fixture(); reduced.policy = { responseBudgetBytes: 1023 };
  assert.equal(validate(reduced).code, 'capture_response_budget_exceeded');
});

test('screenshot timeout remains a screenshot fault with DOM success intact, not browser offline', () => {
  const input = fixture(); input.attempts = input.attempts.slice(0, 5);
  errorAttempt(input, 4, 'CDP Page.captureScreenshot timed out');
  const report = validate(input);
  assert.equal(report.code, 'capture_cdp_timeout'); assert.equal(report.stage, 'screenshot');
  assert.equal(report.status, 'action-required'); assert.equal(report.checked.includes('dom'), true);
  assert.deepEqual(report.retry, { allowed: true, remaining: 1, stage: 'screenshot' });
  assert.equal(report.restoration.required, true); assert.equal(report.restoration.observed, false);
});

test('one retry is shared across all phases and cannot reset on the next stage', () => {
  const recovered = fixture(); addRetry(recovered, 0); errorAttempt(recovered, 0, 'CDP Page.getFrameTree timed out');
  assert.equal(validate(recovered).status, 'verified');
  const exhausted = structuredClone(recovered); errorAttempt(exhausted, 5, 'CDP Page.captureScreenshot timed out');
  const report = validate(exhausted);
  assert.equal(report.code, 'capture_retry_exhausted'); assert.equal(report.retry.allowed, false);
  const twice = fixture(); addRetry(twice, 0); errorAttempt(twice, 0, 'CDP Page.getFrameTree timed out'); errorAttempt(twice, 1, 'CDP Page.getFrameTree timed out');
  assert.equal(validate(twice).code, 'capture_retry_exhausted');
});

test('non-transient probe failures do not grant read retries or become offline claims', () => {
  for (const [error, expected] of [['Debugger not attached to tab', 'tab_debugger_not_attached'], ['native message size exceeded', 'message_too_large'], ['Browser transport disconnected', 'browser_transport_disconnected']]) {
    const input = fixture(); errorAttempt(input, 1, error);
    const report = validate(input); assert.equal(report.code, expected); assert.equal(report.status, 'blocked'); assert.equal(report.retry.allowed, false);
  }
});

test('fonts, media, carousel windows, geometry, hover and overlays must remain consistent across screenshot', () => {
  for (const [mutate, expected] of [
    [(state: any) => { state.fonts.fingerprint = 'a'.repeat(64); }, 'capture_fonts_changed'],
    [(state: any) => { state.media.fingerprint = 'a'.repeat(64); }, 'capture_media_changed'],
    [(state: any) => { state.carousels[0].logicalIndex = 1; }, 'capture_carousel_state_changed'],
    [(state: any) => { state.geometryHash = 'a'.repeat(64); }, 'capture_geometry_changed'],
    [(state: any) => { state.interactionHash = 'a'.repeat(64); }, 'capture_interaction_changed'],
    [(state: any) => { state.overlayHash = 'a'.repeat(64); }, 'capture_overlays_changed'],
    [(state: any) => { state.viewport.clientWidth -= 15; }, 'capture_viewport_changed'],
  ] as const) {
    const input = fixture(); mutate(input.attempts[4].data.after);
    assert.equal(validate(input).code, expected);
  }
});

test('not ready resources, missing carousel coverage and unpaused autoplay block capture', () => {
  for (const [mutate, expected] of [
    [(s: any) => { s.fonts.ready = false; }, 'fonts_not_ready'],
    [(s: any) => { s.media.failed = 1; }, 'media_not_ready'],
    [(s: any) => { s.coverage.carouselInventory = false; }, 'capture_observation_incomplete'],
    [(s: any) => { s.carousels = []; }, 'carousel_inventory_mismatch'],
    [(s: any) => { s.carousels[0].autoplayRunning = true; }, 'carousel_not_stable'],
    [(s: any) => { s.runningAnimations = 1; }, 'capture_animation_unsettled'],
  ] as const) { const input = fixture(); mutate(input.attempts[3].data.state); assert.equal(validate(input).code, expected); }
  const glyphs = fixture(); glyphs.attempts[3].data.state.fonts.glyphProof = 'unavailable';
  assert.equal(validate(glyphs).code, 'actual_glyph_font_proof_missing');
});

test('restoration is required on success and observed even after a screenshot failure', () => {
  const missing = fixture(); missing.attempts.pop();
  assert.equal(validate(missing).code, 'capture_restore_required'); assert.equal(validate(missing).status, 'action-required');
  const mismatch = fixture(); mismatch.attempts[5].data.state.scroll.y = 200;
  assert.equal(validate(mismatch).code, 'capture_restore_state_mismatch'); assert.equal(validate(mismatch).restoration.observed, true);
  const aborted = fixture(); errorAttempt(aborted, 4, 'CDP Page.captureScreenshot timed out');
  const report = validate(aborted);
  assert.equal(report.code, 'capture_cdp_timeout'); assert.equal(report.status, 'blocked');
  assert.equal(report.restoration.consistent, true); assert.equal(report.retry.allowed, false);
  const motion = fixture();
  for (const index of [2, 5]) { motion.attempts[index].data.state.carousels[0].autoplayRunning = true; motion.attempts[index].data.state.runningAnimations = 1; }
  assert.equal(validate(motion).status, 'verified', 'original autoplay may be recorded then paused for capture and actually restored');
});

test('raster bytes, uniform scale and full-page seamless receipt are separate gates', async () => {
  const input = fixture();
  assert.equal(validateBrowserCaptureTransaction(input, { nowMs }).code, 'capture_raster_evidence_required');
  input.attempts[4].data.artifact.sha256 = 'b'.repeat(64);
  assert.equal(validate(input).code, 'capture_raster_bytes_mismatch');
  const ratio = fixture(); ratio.expected.viewport.height = 120; ratio.expected.viewport.visualHeight = 120;
  for (const a of ratio.attempts) if (a.outcome === 'ok') for (const s of [a.data.state, a.data.before, a.data.after].filter(Boolean)) { s.viewport.height = 120; s.viewport.visualHeight = 120; }
  assert.equal(validate(ratio).code, 'capture_raster_geometry_mismatch');
  const full = fixture(); full.attempts[4].data.artifact.mode = 'full-page';
  assert.equal(validate(full).code, 'capture_full_page_unverified');
  full.attempts[4].data.artifact.fullPageReceipt = { sha256: 'a'.repeat(64), complete: true, seamless: false, layoutPreserved: true };
  assert.equal(validate(full).code, 'capture_full_page_unverified');
  await assert.rejects(inspectBrowserCaptureRaster(Buffer.from('not an image')), /browser_capture_raster_invalid/);
});

test('partial stage results are actionable, stage skipping and unknown fields fail closed', () => {
  const partial = fixture(); partial.attempts = partial.attempts.slice(0, 2);
  assert.equal(validate(partial).code, 'capture_baseline_required');
  const skip = fixture(); skip.attempts.splice(2, 1);
  assert.equal(validate(skip).code, 'capture_stage_order_invalid');
  assert.throws(() => validate({ ...fixture(), cookies: 'forbidden' }), /browser_capture_transaction_input_invalid/);
  assert.equal(hashBrowserCaptureFacts({ b: 2, a: 1 }), hashBrowserCaptureFacts({ a: 1, b: 2 }));
});

test('CLI version 2 executes real local raster fixture while default remains version 1', async () => {
  const root = process.cwd(), temporary = await mkdtemp(path.join(root, 'tests', '.capture-transaction-'));
  try {
    const filename = path.join(temporary, 'capture.png'); await writeFile(filename, bytes);
    const input = fixture(Date.now());
    const result = await runCli(['--version', '2', '--stdin', '--raster', filename], input, root);
    assert.equal(result.exitCode, 0); assert.equal(result.report.status, 'verified'); assert.equal(result.report.version, 2);
    assert.equal(result.output.includes('fixture-instance'), false); assert.equal(result.output.includes('example.com'), false);
    const implicit = await runCli(['--stdin'], input, root);
    assert.equal(implicit.exitCode, 1); assert.equal(implicit.report.code, 'browser_preflight_input_invalid');
    const wrong = await runCli(['--version', '2', '--stdin', '--request', filename], input, root);
    assert.equal(wrong.report.code, 'browser_capture_request_override_forbidden');
    const broken = { ...input, attempts: input.attempts.slice(0, 5) } as BrowserCaptureTransaction;
    const partial = await runCli(['--version', '2', '--stdin', '--raster', filename], broken, root);
    assert.equal(partial.exitCode, 2); assert.equal(partial.report.code, 'capture_restore_required');
    assert.deepEqual(await readFile(filename), bytes);
  } finally {
    const relative = path.relative(root, temporary);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(temporary, { recursive: true, force: true });
  }
});

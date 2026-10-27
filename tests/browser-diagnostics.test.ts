import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { BROWSER_REQUEST_BUDGET_BYTES, browserCallBudgetValid, browserRequestUtf8Bytes, classifyBrowserReadFailure, diagnoseBrowserPreflight, type BrowserDiagnosticInput } from '../src/replica-v2/browser-diagnostics.js';
import { browserPreflightMain } from '../src/replica-v2/browser-preflight-cli.js';

function evidence(): BrowserDiagnosticInput {
  return {
    version: 1, sourceUrl: 'https://example.com/shop/',
    inventory: { browsers: [{ browserId: 'current-instance', tabs: [{ tabId: 'current-source', url: 'https://example.com/shop/' }] }] },
    request: { utf8Bytes: 3113 },
    probes: [{ stage: 'url', outcome: 'ok', actualUrl: 'https://example.com/shop/' }, { stage: 'dom', outcome: 'ok', actualUrl: 'https://example.com/shop/', readyState: 'complete', bodyPresent: true }],
  };
}
function failure(error: string, count = 1): BrowserDiagnosticInput {
  const value = evidence();
  value.probes = Array.from({ length: count }, () => ({ stage: 'url', outcome: 'error', error }));
  return value;
}
async function cli(args: string[], root: string, input: string) {
  let output = '';
  const stdin = (async function* () { yield input; })();
  const exitCode = await browserPreflightMain(args, root, { stdin, write: value => { output += value; } });
  return { exitCode, result: JSON.parse(output), output };
}

test('inventory distinguishes offline, missing source, duplicate URL and stale session IDs', () => {
  const input = evidence(); delete input.inventory;
  assert.equal(diagnoseBrowserPreflight(input).code, 'inventory_required');
  input.inventory = { browsers: [] };
  assert.equal(diagnoseBrowserPreflight(input).code, 'browser_offline');
  input.inventory = { browsers: [{ browserId: 'other', tabs: [{ tabId: 'tab', url: 'about:blank' }] }] };
  assert.equal(diagnoseBrowserPreflight(input).code, 'source_tab_missing');
  input.inventory = evidence().inventory;
  input.inventory!.browsers[0].tabs.push({ tabId: 'second', url: input.sourceUrl });
  assert.equal(diagnoseBrowserPreflight(input).code, 'source_tab_ambiguous');
  input.selected = { browserId: 'previous-session', tabId: 'current-source' };
  assert.equal(diagnoseBrowserPreflight(input).code, 'stale_binding');
  input.selected = { browserId: 'current-instance', tabId: 'second' };
  assert.equal(diagnoseBrowserPreflight(input).code, 'ready');
});

test('complete UTF-8 requests are measured before any page probe and 3.44 MB regression is blocked', () => {
  assert.equal(browserRequestUtf8Bytes({ text: '中文' }), Buffer.byteLength(JSON.stringify({ text: '中文' }), 'utf8'));
  assert.throws(() => browserRequestUtf8Bytes({ evaluate: () => 'silently omitted' }), /browser_request_not_serializable/);
  assert.throws(() => browserRequestUtf8Bytes({ missing: undefined }), /browser_request_not_serializable/);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  assert.throws(() => browserRequestUtf8Bytes(cyclic), /browser_request_not_serializable/);
  const input = failure('debugger not attached'); input.request = { utf8Bytes: 3_441_908 };
  const blocked = diagnoseBrowserPreflight(input);
  assert.equal(blocked.code, 'request_too_large'); assert.equal(blocked.retry.allowed, false);
  assert.equal(blocked.requestBudgetBytes, BROWSER_REQUEST_BUDGET_BYTES);
  input.request.utf8Bytes = BROWSER_REQUEST_BUDGET_BYTES;
  assert.equal(diagnoseBrowserPreflight(input).code, 'tab_debugger_not_attached');
  delete input.request; assert.equal(diagnoseBrowserPreflight(input).code, 'request_size_required');
});

test('URL probe precedes DOM collection and actual source URL must agree', () => {
  const input = evidence(); input.probes = [];
  assert.equal(diagnoseBrowserPreflight(input).code, 'url_probe_required');
  input.probes = [{ stage: 'url', outcome: 'ok', actualUrl: input.sourceUrl }];
  assert.equal(diagnoseBrowserPreflight(input).code, 'dom_probe_required');
  input.probes.push({ stage: 'dom', outcome: 'ok', actualUrl: 'https://example.com/login/', readyState: 'complete', bodyPresent: true });
  assert.equal(diagnoseBrowserPreflight(input).code, 'source_url_changed');
  input.probes[1] = { stage: 'dom', outcome: 'ok', actualUrl: input.sourceUrl, readyState: 'loading', bodyPresent: false };
  assert.equal(diagnoseBrowserPreflight(input).code, 'source_document_not_ready');
});

test('attached-tab failure and message overflow do not trigger browser restart or read retry', () => {
  for (const [message, code] of [
    ['Debugger is not attached to tab', 'tab_debugger_not_attached'],
    ['Specified native messaging message length exceeds maximum allowed', 'message_too_large'],
    ['message too big', 'message_too_large'],
    ['Browser transport disconnected', 'browser_transport_disconnected'],
    ['Internal unknown implementation fault', 'unknown_probe_failure'],
  ] as const) {
    const result = diagnoseBrowserPreflight(failure(message));
    assert.equal(result.code, code); assert.equal(result.retry.allowed, false);
    assert.equal(result.retry.maxAdditionalAttempts, 0);
  }
});

test('one CDP timeout permits exactly one same-binding read retry, then stops', () => {
  const message = 'Timed out after 3000ms waiting CDP Page.getFrameTree';
  const once = diagnoseBrowserPreflight(failure(message));
  assert.equal(once.code, 'cdp_timeout_retry');
  assert.deepEqual(once.retry, { allowed: true, maxAdditionalAttempts: 1, stage: 'url' });
  const twice = diagnoseBrowserPreflight(failure(message, 2));
  assert.equal(twice.code, 'cdp_timeout_exhausted'); assert.equal(twice.retry.allowed, false);
  assert.equal(diagnoseBrowserPreflight(failure(message, 3)).code, 'read_only_retry_exhausted');
  const recovered = evidence();
  recovered.probes!.unshift({ stage: 'url', outcome: 'error', error: message });
  assert.equal(diagnoseBrowserPreflight(recovered).code, 'ready');
});

test('outer tool interruption and local deadlines cannot be reported as CDP or transport faults', () => {
  for (const [error, code] of [
    ['js execution timed out; kernel reset, rerun your request', 'tool_execution_timeout'],
    ['js execution timed out while Runtime.evaluate was pending', 'tool_execution_timeout'],
    ['browser_recovery_operation_deadline:bind', 'operation_deadline'],
    ['browser_recovery_operation_deadline:dom', 'operation_deadline'],
  ] as const) {
    assert.equal(classifyBrowserReadFailure(error), code);
    const result = diagnoseBrowserPreflight(failure(error));
    assert.equal(result.code, code); assert.equal(result.retry.allowed, false);
    assert.equal(result.nextActions.some(action => action.includes('不') && /重启|断线/.test(action)), true);
  }
  assert.equal(classifyBrowserReadFailure('CDP Runtime.evaluate timed out'), 'cdp_timeout');
  assert.equal(classifyBrowserReadFailure('browser transport disconnected'), 'browser_transport_disconnected');
  assert.equal(browserCallBudgetValid(55_000, 60_000, 5000), true);
  assert.equal(browserCallBudgetValid(55_000, 15_000, 5000), false);
  assert.equal(browserCallBudgetValid(Number.NaN, 60_000, 5000), false);
});

test('raw screenshot scaling and scrollbar layout changes are separate from connection failure', () => {
  const input = evidence();
  const viewport = { width: 1920, height: 1080, clientWidth: 1905 };
  input.capture = { mode: 'viewport', rasterWidth: 1920, rasterHeight: 1080, before: viewport, after: { ...viewport }, layoutStable: true };
  const good = diagnoseBrowserPreflight(input);
  assert.equal(good.code, 'ready'); assert.equal(good.scope, 'connection-and-screenshot-geometry');
  input.capture.after.clientWidth = 1920;
  assert.equal(diagnoseBrowserPreflight(input).code, 'screenshot_layout_changed');
  input.capture.after.clientWidth = 1905; input.capture.rasterWidth = 1536;
  assert.equal(diagnoseBrowserPreflight(input).code, 'screenshot_geometry_mismatch');
  input.capture.rasterWidth = 1920; input.capture.rasterHeight = 500;
  assert.equal(diagnoseBrowserPreflight(input).code, 'screenshot_geometry_mismatch');
  input.capture.rasterHeight = 6000; input.capture.mode = 'full-page';
  assert.equal(diagnoseBrowserPreflight(input).code, 'ready');
});

test('local CLI receives agent supplied tool results on stdin and never echoes raw errors or source query', async () => {
  const input = failure('unknown fault Authorization: Bearer secret-once');
  input.sourceUrl += '?one_time_token=do-not-copy';
  input.inventory!.browsers[0].tabs[0].url = input.sourceUrl;
  const result = await cli(['--stdin'], process.cwd(), JSON.stringify(input));
  assert.equal(result.exitCode, 1); assert.equal(result.result.code, 'unknown_probe_failure');
  assert.equal(result.output.includes('secret-once'), false); assert.equal(result.output.includes('do-not-copy'), false);
  const ready = await cli(['--stdin'], process.cwd(), JSON.stringify(evidence()));
  assert.equal(ready.exitCode, 0);
  const retry = await cli(['--stdin'], process.cwd(), JSON.stringify(failure('CDP Page.getFrameTree timed out')));
  assert.equal(retry.exitCode, 2); assert.equal(retry.result.retry.maxAdditionalAttempts, 1);
});

test('CLI measures actual request file bytes and fails closed on invalid or oversized input', async () => {
  const root = process.cwd(), temporary = await mkdtemp(path.join(root, 'tests', '.browser-diagnostics-'));
  try {
    const request = path.join(temporary, 'request.json');
    await writeFile(request, JSON.stringify({ selectors: '长'.repeat(20000) }));
    const result = await cli(['--stdin', '--request', request], root, JSON.stringify(evidence()));
    assert.equal(result.result.code, 'request_too_large');
    const args = await cli(['--stdin', '--input', request], root, '{}');
    assert.equal(args.result.code, 'browser_preflight_arguments_invalid');
    const invalid = await cli(['--stdin'], root, '{bad');
    assert.equal(invalid.result.code, 'browser_preflight_json_invalid');
    const oversized = await cli(['--stdin'], root, ' '.repeat(1024 * 1024 + 1));
    assert.equal(oversized.result.code, 'browser_preflight_input_too_large');
    const schema = await cli(['--stdin'], root, JSON.stringify({ ...evidence(), cookies: 'private' }));
    assert.equal(schema.result.code, 'browser_preflight_input_invalid'); assert.equal(schema.output.includes('private'), false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

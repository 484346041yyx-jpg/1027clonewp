import test from 'node:test';
import assert from 'node:assert/strict';
import { WoodMartHeaderTransport, WoodMartHeaderTransportError, type HeaderPHPWriteIntent } from '../src/woodmart-header/transport.js';

const credentials = { targetUrl: 'https://header-fixture.example/', username: 'fixture', applicationPassword: 'fixture-secret' };
const operation = { name: 'whb.read-installed-source', code: "return ['version'=>'fixture'];", trustedLocalCode: true as const };
const intent: HeaderPHPWriteIntent = { runId: 'header-fixture', operationId: 'create-test-menu', resource: 'wordpress-menu/test', expectedSnapshotSha256: 'a'.repeat(64), persistedIntentSha256: 'b'.repeat(64) };

function fixture(options: { redirect?: boolean; networkFailure?: boolean; missingAbility?: boolean; changedSchema?: boolean; rejectedPHP?: boolean; gatewayRejected?: boolean; holdExecution?: boolean } = {}) {
  const requests: Array<{ path: string; method: string }> = [];
  let executions = 0;
  let release!: () => void;
  const executionHold = new Promise<void>(resolve => { release = resolve; });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push({ path: url.href, method: init?.method ?? 'GET' });
    assert.equal(url.href, 'https://header-fixture.example/wp-json/mcp/novamira');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('fixture:fixture-secret').toString('base64')}`);
    assert.equal(init?.redirect, 'manual');
    assert.ok(init?.signal);
    if (options.redirect) return new Response('', { status: 302, headers: { Location: 'https://other.example/secret?token=fixture-secret' } });
    if (options.networkFailure) throw Error('fixture-secret https://other.example/?token=private');
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    const rpc = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string; params?: Record<string, unknown> };
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    const result = (value: unknown) => json({ jsonrpc: '2.0', id: rpc.id, result: value });
    const output = (value: unknown) => result({ structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] });
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    if (rpc.method === 'initialize') return result({ protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Fixture', version: '1' } });
    if (rpc.method === 'tools/list') return result({ tools: ['discover-abilities', 'get-ability-info', 'execute-ability'].map(name => ({ name: `mcp-adapter-${name}`, inputSchema: { type: 'object', additionalProperties: true } })) });
    const call = rpc.params as { name: string; arguments: Record<string, unknown> };
    if (call.name.endsWith('discover-abilities')) return output({ abilities: options.missingAbility ? [] : [{ name: 'novamira/execute-php' }] });
    if (call.name.endsWith('get-ability-info')) return output({ input_schema: { type: 'object', properties: { code: { type: options.changedSchema ? 'number' : 'string' } } } });
    if (call.name.endsWith('execute-ability')) {
      executions++;
      if (options.holdExecution) await executionHold;
      if (options.gatewayRejected) return output({ success: false, data: { error: 'fixture-secret token=private' } });
      return output({ success: true, data: options.rejectedPHP ? { success: false, error_message: 'fixture-secret token=private' } : { success: true, return_value: { version: 'fixture' } } });
    }
    throw Error('Unexpected fixture method');
  };
  return { transport: new WoodMartHeaderTransport({ ...credentials, fetch }), requests, get executions() { return executions; }, release };
}

test('independent WHB transport discovers a supported PHP ability and records only named aggregate evidence', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.transport.readPHP(operation), { version: 'fixture' });
    assert.deepEqual(await f.transport.readPHP({ ...operation, name: 'whb.read-reference-audit' }), { version: 'fixture' });
    const diagnostics = f.transport.diagnostics();
    assert.equal(diagnostics.counts.phpReads, 2);
    assert.equal(diagnostics.counts.phpMutations, 0);
    assert.equal(diagnostics.operations.length, 2);
    assert.ok(diagnostics.operations.every(entry => entry.state === 'succeeded' && entry.codeSha256.length === 64));
    assert.doesNotMatch(JSON.stringify(diagnostics), /fixture-secret|return \[|Authorization|token=/);
    diagnostics.operations[0].state = 'unconfirmed';
    assert.equal(f.transport.diagnostics().operations[0].state, 'succeeded');
    assert.equal(f.executions, 2);
  } finally { await f.transport.close(); }
});

test('invalid targets, credentials, timeouts and unnamed helpers fail before a request', async () => {
  for (const targetUrl of ['http://localhost/', 'http://site.example/', 'https://u:p@site.example/', 'https://site.example/?token=secret', 'https://site.example/#fragment', 'invalid']) {
    assert.throws(() => new WoodMartHeaderTransport({ ...credentials, targetUrl }), WoodMartHeaderTransportError);
  }
  assert.throws(() => new WoodMartHeaderTransport({ ...credentials, applicationPassword: '' }), WoodMartHeaderTransportError);
  assert.throws(() => new WoodMartHeaderTransport({ ...credentials, timeoutMs: 120001 }), WoodMartHeaderTransportError);
  const f = fixture();
  await assert.rejects(f.transport.readPHP({ ...operation, name: 'invalid helper\nsecret' }), /named, bounded/);
  await assert.rejects(f.transport.readPHP({ ...operation, trustedLocalCode: false as true }), /named, bounded/);
  await assert.rejects(f.transport.readPHP({ ...operation, code: 'x'.repeat(2 * 1024 * 1024 + 1) }), /named, bounded/);
  assert.equal(f.requests.length, 0);
});

test('redirects and remote network error text cannot leak secrets or trigger retries', async () => {
  for (const options of [{ redirect: true }, { networkFailure: true }]) {
    const f = fixture(options);
    await assert.rejects(f.transport.readPHP(operation), (error: unknown) => {
      assert.ok(error instanceof WoodMartHeaderTransportError);
      assert.doesNotMatch(String(error), /fixture-secret|other\.example|token=private/);
      return true;
    });
    assert.equal(f.executions, 0);
    assert.equal(f.transport.diagnostics().operations[0].state, 'unconfirmed');
    assert.equal(f.requests.length, 1);
  }
});

test('missing ability and changed schema prevent PHP execution', async () => {
  for (const options of [{ missingAbility: true }, { changedSchema: true }]) {
    const f = fixture(options);
    try {
      await assert.rejects(f.transport.readPHP(operation), WoodMartHeaderTransportError);
      assert.equal(f.executions, 0);
    } finally { await f.transport.close(); }
  }
});

test('mutations require intent evidence and serialize without retrying rejected operations', async () => {
  const f = fixture({ holdExecution: true });
  try {
    await assert.rejects(f.transport.executePHP({ ...operation, intent: { ...intent, persistedIntentSha256: '' } }), /persisted intent/);
    assert.equal(f.requests.length, 0);
    const first = f.transport.executePHP({ ...operation, name: 'whb.create-test-menu', intent });
    await assert.rejects(f.transport.executePHP({ ...operation, intent }), /serially/);
    f.release();
    assert.deepEqual(await first, { version: 'fixture' });
    assert.equal(f.transport.diagnostics().counts.phpMutations, 1);
    assert.equal(f.executions, 1);
  } finally { await f.transport.close(); }
  const rejected = fixture({ rejectedPHP: true });
  try {
    await assert.rejects(rejected.transport.executePHP({ ...operation, intent }), (error: unknown) => {
      assert.ok(error instanceof WoodMartHeaderTransportError);
      assert.doesNotMatch(String(error), /fixture-secret|token=/);
      return true;
    });
    assert.equal(rejected.executions, 1);
    assert.equal(rejected.transport.diagnostics().operations[0].state, 'unconfirmed');
  } finally { await rejected.transport.close(); }
});

test('safe local gateway failure codes retain the failing phase without exposing remote response text', async () => {
  const f = fixture({ gatewayRejected: true });
  try {
    await assert.rejects(f.transport.readPHP(operation), (error: unknown) => {
      assert.ok(error instanceof WoodMartHeaderTransportError);
      assert.equal(error.code, 'gateway_ability_execution_failed');
      assert.match(error.message, /php-execution/);
      assert.doesNotMatch(String(error), /fixture-secret|token=/);
      return true;
    });
    assert.equal(f.transport.diagnostics().operations[0].failureCode, 'gateway_ability_execution_failed');
    assert.equal(f.executions, 1);
  } finally { await f.transport.close(); }
});

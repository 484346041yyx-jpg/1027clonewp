import test from 'node:test';
import assert from 'node:assert/strict';
import { WordPressClient, WordPressError } from '../src/wordpress/client.js';

const credentials = { targetUrl: 'https://preflight-fixture.example/', username: 'fixture', applicationPassword: 'fixture-password' };
function fixture(options: { invalidIndex?: boolean; deniedUser?: boolean; missingCapabilities?: boolean; missingCapability?: 'edit_pages' | 'upload_files'; inactivePlugins?: boolean; noEnvironment?: boolean; failedRequired?: { role: 'user' | 'plugins'; kind: 'json' | 'network' } } = {}) {
  const namespaces = ['wp/v2', 'wp-abilities/v1', 'mcp', ...Array.from({ length: 32 }, (_, index) => `fixture-namespace-${index}/v1`)];
  const capabilities: Record<string, boolean> = options.missingCapabilities ? {} : { edit_pages: true, upload_files: true, edit_posts: true, read_private_pages: false, fixture_extra_capability: true };
  if (options.missingCapability) capabilities[options.missingCapability] = false;
  const plugins = [{ plugin: 'novamira/novamira', name: 'Novamira', version: 'fixture', status: options.inactivePlugins ? 'inactive' : 'active' }, { plugin: 'elementor/elementor', name: 'Elementor', version: 'fixture', status: options.inactivePlugins ? 'inactive' : 'active' }, ...Array.from({ length: 18 }, (_, index) => ({ plugin: `fixture-${index}/plugin`, name: `Fixture plugin ${index}`, version: `1.${index}.0`, status: index % 2 ? 'active' : 'inactive' }))];
  const requests: Array<{ path: string; method: string }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, new URL(credentials.targetUrl).origin);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('fixture:fixture-password').toString('base64')}`);
    assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    const request = { path: url.pathname + url.search, method: init?.method ?? 'GET' }; requests.push(request);
    assert.equal(request.method, 'GET');
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (request.path === '/wp-json/?_fields=namespaces') return options.invalidIndex ? new Response('invalid filtered index', { status: 200 }) : json({ namespaces });
    const role = request.path === '/wp-json/wp/v2/users/me?context=edit&_fields=id,capabilities' ? 'user' : request.path === '/wp-json/wp/v2/plugins?_fields=plugin,name,version,status' ? 'plugins' : undefined;
    if (role && options.failedRequired?.role === role) { if (options.failedRequired.kind === 'network') throw Error('Fixture network failure'); return new Response('invalid projected response', { status: 200 }); }
    if (role === 'user') return options.deniedUser ? json({ code: 'rest_not_logged_in' }, 401) : json({ id: 9, capabilities });
    if (role === 'plugins') return json(plugins);
    if (request.path === '/wp-json/wp/v2/themes?status=active') return json([{ stylesheet: 'fixture-theme', version: 'fixture', status: 'active' }]);
    if (request.path === '/wp-json/wp-abilities/v1/abilities/core/get-environment-info/run') return options.noEnvironment ? json({ code: 'rest_no_route' }, 404) : json({ wp_version: 'fixture-wp', php_version: 'fixture-php', environment: 'test' });
    throw Error(`Unexpected preflight request: ${request.path}`);
  };
  return { namespaces, capabilities, plugins, requests, client: new WordPressClient({ ...credentials, fetch }) };
}

test('preflight projects only required fields and preserves complete namespaces, capabilities and plugin inventory', async () => {
  const f = fixture(), report = await f.client.preflight();
  assert.equal(report.namespaces.length, 35); assert.deepEqual(report.namespaces, f.namespaces);
  assert.equal(report.authenticated, true); assert.equal(report.userId, 9);
  assert.equal(report.novamiraInstalled, true); assert.equal(report.novamiraActive, true); assert.deepEqual(report.blockers, []);
  assert.deepEqual(f.capabilities, { edit_pages: true, upload_files: true, edit_posts: true, read_private_pages: false, fixture_extra_capability: true });
  assert.equal(report.plugins.length, 20); assert.deepEqual(report.plugins, f.plugins);
  assert.ok(report.plugins.every(plugin => Object.keys(plugin).sort().join(',') === 'name,plugin,status,version'));
  assert.deepEqual(report.themes, [{ stylesheet: 'fixture-theme', version: 'fixture', status: 'active' }]);
  assert.equal(report.wordpressVersion, 'fixture-wp'); assert.equal(report.phpVersion, 'fixture-php');
  assert.deepEqual(f.requests.map(request => request.path).sort(), ['/wp-json/?_fields=namespaces', '/wp-json/wp/v2/users/me?context=edit&_fields=id,capabilities', '/wp-json/wp/v2/plugins?_fields=plugin,name,version,status', '/wp-json/wp/v2/themes?status=active', '/wp-json/wp-abilities/v1/abilities/core/get-environment-info/run'].sort());
  assert.equal(f.client.diagnostics().documentSaves, 0); assert.equal(f.client.diagnostics().httpAttempts, 5);
});

test('required field projections keep authentication failures, capability/plugin blockers and optional environment behavior intact', async () => {
  const denied = fixture({ deniedUser: true });
  await assert.rejects(denied.client.preflight(), (error: unknown) => error instanceof WordPressError && error.code === 'rest_not_logged_in');
  assert.equal(denied.requests.filter(request => request.path.includes('users/me')).length, 1);
  const blocked = fixture({ missingCapabilities: true, inactivePlugins: true, noEnvironment: true }), report = await blocked.client.preflight();
  assert.deepEqual(report.namespaces, blocked.namespaces);
  assert.deepEqual(report.blockers, ['Novamira is inactive.', 'Elementor Core is not active.', 'The authenticated user needs edit_pages and upload_files.']);
  assert.equal(report.wordpressVersion, undefined); assert.equal(report.phpVersion, undefined);
  assert.equal(blocked.requests.length, 5); assert.ok(blocked.requests.every(request => request.method === 'GET'));
  for (const missingCapability of ['edit_pages', 'upload_files'] as const) {
    const f = fixture({ missingCapability }), report = await f.client.preflight();
    assert.deepEqual(report.blockers, ['The authenticated user needs edit_pages and upload_files.']);
    assert.equal(report.authenticated, true); assert.equal(report.userId, 9); assert.deepEqual(report.plugins, f.plugins);
  }
});

test('invalid filtered index JSON still fails without an unfiltered fallback, retry or cleanup', async () => {
  const f = fixture({ invalidIndex: true });
  await assert.rejects(f.client.preflight(), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_rest_response');
  assert.equal(f.requests.filter(request => request.path === '/wp-json/?_fields=namespaces').length, 1);
  assert.equal(f.requests.some(request => request.path === '/wp-json/'), false);
  assert.equal(f.requests.some(request => request.path.includes('get-environment-info')), false);
  assert.equal(f.requests.length, 4);
});

for (const role of ['user', 'plugins'] as const) for (const kind of ['json', 'network'] as const) {
  test(`projected ${role} ${kind} failure rejects without an unfiltered fallback or retry`, async () => {
    const f = fixture({ failedRequired: { role, kind } });
    await assert.rejects(f.client.preflight(), (error: unknown) => error instanceof WordPressError && error.code === (kind === 'json' ? 'invalid_rest_response' : 'network_error'));
    const expected = role === 'user' ? '/wp-json/wp/v2/users/me?context=edit&_fields=id,capabilities' : '/wp-json/wp/v2/plugins?_fields=plugin,name,version,status';
    assert.equal(f.requests.filter(request => request.path === expected).length, 1);
    assert.equal(f.requests.some(request => request.path === '/wp-json/wp/v2/users/me?context=edit' || request.path === '/wp-json/wp/v2/plugins'), false);
    assert.equal(f.requests.some(request => request.path.includes('get-environment-info')), false);
    assert.equal(f.requests.length, 4); assert.ok(f.requests.every(request => request.method === 'GET'));
    assert.equal(f.client.diagnostics().documentSaves, 0);
    assert.equal(f.client.diagnostics().httpFailed, kind === 'network' ? 1 : 0);
  });
}

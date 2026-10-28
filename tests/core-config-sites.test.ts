import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { loadConfig, loadProjectConfig } from '../src/core/config.js';

test('site profiles preserve the test default and isolate explicitly selected production', async t => {
  const root = await mkdtemp(path.join(process.cwd(), '.config-sites-test-'));
  t.after(async () => {
    if (!root.startsWith(path.resolve(process.cwd()) + path.sep)) throw Error('test_cleanup_outside_workspace');
    await rm(root, { recursive: true, force: true });
  });
  const keys = ['CLONEWP_SITE', 'CLONEWP_WP_SITE', 'CLONEWP_WP_USER', 'CLONEWP_WP_APP_PASSWORD'];
  const saved = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }));
  await mkdir(path.join(root, 'config/sites'), { recursive: true });
  const testConfig = JSON.parse(await readFile(path.join(process.cwd(), 'config/project.json'), 'utf8'));
  testConfig.siteKey = 'test'; testConfig.targetUrl = 'https://test.example/'; testConfig.credentialsFile = 'config/test-secret.json';
  const prodConfig = { ...testConfig, siteKey: 'production', targetUrl: 'https://production.example/', credentialsFile: 'config/prod-secret.json' };
  const registry = { version: 1, defaultSite: 'test', sites: {
    test: { configFile: 'config/project.json', targetOrigin: 'https://test.example', role: 'test' },
    production: { configFile: 'config/sites/production.json', targetOrigin: 'https://production.example', role: 'production' },
  } };
  const save = (file: string, value: unknown) => writeFile(path.join(root, file), JSON.stringify(value));
  await save('config/project.json', testConfig);
  // Existing single-site projects retain the same loader behavior.
  assert.equal((await loadProjectConfig(root)).config.siteKey, 'test');
  await assert.rejects(loadProjectConfig(root, 'production'), /site_selection_unknown/);
  await save('config/sites.json', registry); await save('config/sites/production.json', prodConfig);
  await save('config/test-secret.json', { wp_user: 'test-user', wp_app_password: 'test-only' });
  assert.equal((await loadConfig(root)).config.siteKey, 'test');
  assert.equal((await loadProjectConfig(root, 'production')).config.targetUrl, prodConfig.targetUrl);
  for (const selection of ['unknown', '../production', '', 'constructor']) await assert.rejects(loadProjectConfig(root, selection));
  process.env.CLONEWP_SITE = 'production';
  await assert.rejects(loadConfig(root), /ENOENT/); // Never falls back to test credentials.
  process.env.CLONEWP_WP_USER = 'prod-user'; process.env.CLONEWP_WP_APP_PASSWORD = 'memory-only';
  await assert.rejects(loadConfig(root), /require_site_binding/);
  process.env.CLONEWP_WP_SITE = 'production';
  assert.equal((await loadConfig(root)).credentials.wp_user, 'prod-user');
  await save('config/sites/production.json', { ...prodConfig, targetUrl: testConfig.targetUrl });
  await assert.rejects(loadProjectConfig(root, 'production'), /identity_conflict/);
  await save('config/sites/production.json', { ...prodConfig, credentialsFile: testConfig.credentialsFile });
  await assert.rejects(loadProjectConfig(root, 'production'), /credentials_must_be_separate/);
  await save('config/sites/production.json', prodConfig);
  await save('config/sites.json', { ...registry, defaultSite: 'production' });
  await assert.rejects(loadProjectConfig(root), /default_must_be_test/);
  await save('config/sites.json', { ...registry, sites: { ...registry.sites, production: { ...registry.sites.production, configFile: 'config/../../outside.json' } } });
  await assert.rejects(loadProjectConfig(root, 'production'), /outside_project/);
  await save('config/sites.json', registry);
  delete process.env.CLONEWP_SITE;
  assert.equal((await loadProjectConfig(root)).config.siteKey, 'test');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'config/project.json'), 'utf8')), testConfig);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/core/config.js';

test('WordPress credentials can stay in process memory when the configured file is absent', async t => {
  const root = await mkdtemp(path.join(process.cwd(), '.config-env-test-'));
  t.after(async () => {
    if (!root.startsWith(path.resolve(process.cwd()) + path.sep)) throw Error('test_cleanup_outside_workspace');
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config', 'project.json'), JSON.stringify({
    siteKey: 'test', targetUrl: 'https://target.example/', credentialsFile: 'config/missing-secret.json',
    viewports: [{ name: 'desktop', width: 1440, height: 900 }], maxCorrectionRounds: 0,
    maxSourceSections: 1, maxSourceElements: 1, maxElements: 1, maxAssets: 1,
    maxAssetBytes: 1, maxPageHeight: 1000, pageStatus: 'draft', pageTemplate: 'elementor_canvas',
    agentTimeoutMs: 1000, maxTotalMs: 1000,
  }));
  const beforeUser = process.env.CLONEWP_WP_USER;
  const beforePassword = process.env.CLONEWP_WP_APP_PASSWORD;
  t.after(() => {
    if (beforeUser === undefined) delete process.env.CLONEWP_WP_USER;
    else process.env.CLONEWP_WP_USER = beforeUser;
    if (beforePassword === undefined) delete process.env.CLONEWP_WP_APP_PASSWORD;
    else process.env.CLONEWP_WP_APP_PASSWORD = beforePassword;
  });
  process.env.CLONEWP_WP_USER = 'test-user';
  process.env.CLONEWP_WP_APP_PASSWORD = 'memory-only-test-value';
  assert.deepEqual((await loadConfig(root)).credentials, { wp_user: 'test-user', wp_app_password: 'memory-only-test-value' });
  delete process.env.CLONEWP_WP_APP_PASSWORD;
  await assert.rejects(loadConfig(root));
});

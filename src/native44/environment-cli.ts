import path from 'node:path';
import { loadConfig, redactor } from '../core/config.js';
import { writeJson } from '../core/files.js';
import { WordPressClient } from '../wordpress/client.js';
import { checkNative44Environment } from './environment.js';

const root = path.resolve(process.cwd());
try {
  const loaded = await loadConfig(root);
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute });
  try {
    const report = await client.preflight(), check = checkNative44Environment(report);
    const evidence = { ...check, targetUrl: loaded.config.targetUrl, access: 'read-only', writes: 0, metrics: client.diagnostics() };
    await writeJson(path.join(root, 'reports', 'native44', 'target-environment.json'), evidence);
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = check.matched ? 0 : 3;
  } finally { await client.close(); }
} catch (error) { console.error(redactor()(error)); process.exitCode = 1; }

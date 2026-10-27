import path from 'node:path';
import { loadConfig, redactor } from './core/config.js';
import { writeJson } from './core/files.js';
import { WordPressClient } from './wordpress/client.js';

const { root, config, credentials } = await loadConfig();
const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute });
try {
  const environment = await client.preflight();
  const capabilities = environment.blockers.length ? undefined : await client.discoverCapabilities();
  const report = { checkedAt: new Date().toISOString(), environment, capabilities };
  await writeJson(path.join(root, '.cache/doctor.json'), report);
  console.log(JSON.stringify({ target: config.targetUrl, authenticated: environment.authenticated, wordpress: environment.wordpressVersion, php: environment.phpVersion, novamiraActive: environment.novamiraActive, mode: capabilities?.mode, versions: capabilities?.versions, widgetTypes: Object.keys(capabilities?.legacySchemas ?? {}), blockers: environment.blockers, reportFile: path.join(root, '.cache/doctor.json') }, null, 2));
  if (environment.blockers.length || capabilities?.mode === 'unavailable') process.exitCode = 1;
} catch (error) { console.error(redactor(credentials)(error)); process.exitCode = 1; }
finally { await client.close(); }

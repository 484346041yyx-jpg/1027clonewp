import { access } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectConfig } from './config.js';

try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error('Usage: npm run site:config -- [siteKey]');
  const selected = await loadProjectConfig(process.cwd(), args[0] ?? process.env.CLONEWP_SITE);
  let credentialFilePresent = false;
  try { await access(path.resolve(selected.root, selected.config.credentialsFile)); credentialFilePresent = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  console.log(JSON.stringify({ siteKey: selected.config.siteKey, targetUrl: selected.config.targetUrl, role: selected.role,
    configFile: selected.configFile, credentialFilePresent, authentication: 'not-checked', remoteWrites: 0 }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'site_configuration_failed'); process.exitCode = 1; }

import path from 'node:path';
import { loadConfig, readJson, redactor } from '../core/config.js';
import { writeJson } from '../core/files.js';
import { WordPressClient } from '../wordpress/client.js';
import { NATIVE44_ALL_TYPES } from './catalog.js';
import { checkNative44Environment } from './environment.js';
import { analyzeNative44Compatibility } from './compatibility.js';
import { loadNative44Knowledge } from './knowledge.js';
const root = path.resolve(process.cwd());
try {
  const loaded = await loadConfig(root), client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES });
  try {
    const preflight = await client.preflight();
    let capabilities: Awaited<ReturnType<WordPressClient['discoverCapabilities']>> | undefined;
    const schemas: NonNullable<typeof capabilities>['legacySchemas'] = {};
    let start = 0;
    if (process.argv.includes('--resume')) {
      const previous = await readJson<NonNullable<typeof capabilities> & {requestedThrough: number}>(path.join(root, 'reports', 'native44', 'target-capabilities-partial.json'));
      capabilities = previous; Object.assign(schemas, previous.legacySchemas); start = previous.requestedThrough;
    }
    const readErrors: Record<string, unknown> = {};
    const batchSize = process.argv.includes('--single') ? 1 : 4;
    for (let offset = start; offset < NATIVE44_ALL_TYPES.length; offset += batchSize) {
      let batch: NonNullable<typeof capabilities>;
      try { batch = await client.discoverCapabilities(NATIVE44_ALL_TYPES.slice(offset, offset + batchSize)); }
      catch { for (const type of NATIVE44_ALL_TYPES.slice(offset, offset + batchSize)) readErrors[type] = { code: 'registry-read-unverified' }; continue; }
      if (capabilities && JSON.stringify(batch.versions) !== JSON.stringify(capabilities.versions)) throw Error('Target versions changed during compatibility observation');
      capabilities = batch; Object.assign(schemas, batch.legacySchemas);
      await writeJson(path.join(root, 'reports', 'native44', 'target-capabilities-partial.json'), { ...batch, legacySchemas: schemas, requestedThrough: offset + batchSize });
      console.error(`Read-only contracts ${Math.min(offset + batchSize, 44)}/44`);
    }
    if (!capabilities) throw Error('Empty fixed catalog');
    capabilities = { ...capabilities, legacySchemas: schemas };
    const check = checkNative44Environment(preflight, capabilities);
    const errors = { ...(capabilities.sourceProof?.schemaErrors ?? {}), ...readErrors } as Record<string, unknown>;
    capabilities = { ...capabilities, sourceProof: { ...capabilities.sourceProof, schemaErrors: errors } };
    const missing = NATIVE44_ALL_TYPES.filter(type => !capabilities.legacySchemas[type] && !errors[type]);
    await writeJson(path.join(root, 'reports', 'native44', 'target-capabilities.json'), { ...capabilities, requestedTypes: [...NATIVE44_ALL_TYPES], registrationComplete: !Object.keys(errors).length, missingTypes: missing });
    const analysis = analyzeNative44Compatibility(await loadNative44Knowledge(), { ...capabilities, requestedTypes: [...NATIVE44_ALL_TYPES], registrationComplete: !Object.keys(errors).length, missingTypes: missing });
    await writeJson(path.join(root, 'reports', 'native44', 'compatibility-analysis.json'), analysis);
    const evidence = { ...check, access: 'read-only', writes: 0, targetUrl: loaded.config.targetUrl, registered: NATIVE44_ALL_TYPES.filter(type => capabilities.legacySchemas[type]), missing, unverified: Object.keys(errors), versions: capabilities.versions, metrics: client.diagnostics() };
    await writeJson(path.join(root, 'reports', 'native44', 'target-environment.json'), evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await client.close(); }
} catch (error) { console.error(redactor()(error)); process.exitCode = 1; }

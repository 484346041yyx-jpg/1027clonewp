/** Task-local, read-only registry probe. Execute only in the root writer's
 * serialized slot. Credentials and authorization data never enter the result. */
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, realpath, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { native44RegisteredSchemaEvidence } from '../../../src/native44/selection.js';
import { NATIVE44_ALL_TYPES } from '../../../src/native44/catalog.js';
import { WordPressClient } from '../../../src/wordpress/client.js';
import type { CapabilityReport, WordPressCredentials } from '../../../src/wordpress/types.js';

const ROOT = 'D:/cloneWP';
const OBS = path.join(ROOT, 'references/furryskitchen-20261017-observation');
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export interface PendingFormRegistryReader { discoverCapabilities(types: string[]): Promise<CapabilityReport> }
/** Keep the installed fixed 44 set; the discovery call below selects only the
 * two relevant registrations. Construction itself performs no remote action. */
export function createPendingFormRegistryReader(credentials: Pick<WordPressCredentials, 'targetUrl' | 'username' | 'applicationPassword' | 'fetch'>): WordPressClient {
  return new WordPressClient({ ...credentials, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES });
}
/** Dependency-injected for tests; the sole remote call is this exact registry
 * discovery. The result explicitly retains frontend output as unverified. */
export async function probePendingFormCapabilities(reader: PendingFormRegistryReader) {
  const discovered = await reader.discoverCapabilities(['container', 'form']);
  const legacySchemas = Object.fromEntries(['container', 'form'].flatMap(type => discovered.legacySchemas[type] ? [[type, structuredClone(discovered.legacySchemas[type])]] : []));
  const errors = discovered.sourceProof?.schemaErrors as Record<string, unknown> | undefined;
  const capabilities = { mode: discovered.mode, legacySchemas, versions: structuredClone(discovered.versions), sourceProof: { schemaErrors: Object.fromEntries(['container', 'form'].flatMap(type => errors?.[type] !== undefined ? [[type, errors[type]]] : [])) } };
  const schemaHashes = Object.fromEntries(Object.entries(legacySchemas).map(([type, schema]) => { const evidence = native44RegisteredSchemaEvidence(schema); return [type, { sha256: evidence.sha256, rawSha256: evidence.rawSha256, class: schema.class, controlCount: Object.keys(schema.controls).length }]; }));
  return { capabilities, schemaHashes, registeredFormObserved: !!legacySchemas.form, frontendInert: 'unverified' as const, businessStatus: 'pending' as const };
}
async function main(args: string[]) {
  if (args.length !== 2 || args[0] !== '--run' || !/^[A-Za-z0-9_-]{4,100}$/.test(args[1])) throw Error('Usage: --run EXACT_CURRENT_RUN_ID');
  const runId = args[1], runDir = await realpath(path.join(ROOT, 'runs', runId));
  if (path.dirname(runDir).toLowerCase() !== path.join(ROOT, 'runs').toLowerCase()) throw Error('Run path escape');
  const pointerFile = path.join(runDir, 'current-user-amendment.json'), pointerBytes = await readFile(pointerFile), pointer = JSON.parse(pointerBytes.toString('utf8'));
  if (pointer.version !== 2 || pointer.runId !== runId || pointer.pageId !== 15769 || pointer.taskId !== 'reference-v2-2026-10-17T17-56-16-135Z-furryskitchen-sg-63ba56dc') throw Error('Exact current owned Furry draft pointer is required');
  const free = await statfs(ROOT); if (Number(free.bavail) * Number(free.bsize) < 512 * 1024 * 1024) throw Error('Registry evidence requires at least 512 MiB free');
  const { loadConfig, redactor } = await import('../../../src/core/config.js');
  const { config, credentials } = await loadConfig(ROOT), redact = redactor(credentials);
  const reader = createPendingFormRegistryReader({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password });
  const observedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof probePendingFormCapabilities>>;
  try { result = await probePendingFormCapabilities(reader); }
  catch (error) { throw Error(redact(error instanceof Error ? error.message : 'Registry discovery failed').replace(/https?:\/\/[^\s"'<>]+/gi, '[URL REDACTED]')); }
  const bytes = JSON.stringify(result.capabilities, null, 2) + '\n';
  // Refuse any accidental credential/token output rather than alter a schema's
  // hash-bound scalar values by redaction.
  if (redact(bytes) !== bytes || /[?&](?:token|nonce|_wpnonce|key|password|secret)=/i.test(bytes)) throw Error('Registry evidence contains sensitive output');
  if (!Buffer.from(await readFile(pointerFile)).equals(pointerBytes)) throw Error('Current pointer changed during registry observation');
  const output = path.join(OBS, `pending-form-capabilities-${observedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(output, { recursive: false });
  const capabilityPath = path.join(output, 'capabilities.json'); await writeFile(capabilityPath, bytes, { flag: 'wx' });
  const report = { version: 1, kind: 'native44-pending-form-registry-observation', observedAt, taskId: pointer.taskId, runId, pageId: pointer.pageId, currentPointer: { path: pointerFile, sha256: sha(pointerBytes) }, capabilities: { path: capabilityPath, sha256: sha(bytes) }, schemaHashes: result.schemaHashes, registeredFormObserved: result.registeredFormObserved, frontendInert: result.frontendInert, businessStatus: result.businessStatus, actions: ['discoverCapabilities(container,form)'], documentWrites: 0, limitation: 'Registered controls do not prove emitted wrapper inert, disabled keyboard/pointer behavior, or delivery. Actual current frontend verification remains required.' };
  const reportPath = path.join(output, 'report.json'); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ reportPath, capabilities: report.capabilities, frontendInert: 'unverified' }) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { process.stderr.write((error instanceof Error ? error.message : 'Pending form registry probe failed') + '\n'); process.exitCode = 1; });

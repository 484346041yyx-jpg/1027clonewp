import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig, redactor } from '../src/core/config.js';
import { previewCookies } from '../src/wordpress/preview-session.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { checkFidelityFrontend } from '../src/verification/carousel-runtime.js';

const root = 'D:/cloneWP';
const runId = '2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75';
const pageId = 14866;
const runDir = path.join(root, 'runs', runId);
const jobDir = path.join(root, 'references', 'reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb');
const json = async <T>(name: string): Promise<T> => JSON.parse(await readFile(path.join(runDir, name), 'utf8')) as T;
const { config, credentials } = await loadConfig(root);
const redact = redactor(credentials);
const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password });
try {
  const owned = await client.inspectOwnedDraft(pageId, runId);
  if (!owned.exists || !owned.markerMatches || owned.status !== 'draft') throw new Error('The review draft ownership changed.');
  await client.createDraft(runId, 'Pet Supermarket reference review', { requireExistingPageId: pageId });
  const snapshot = await client.snapshotDraft(pageId);
  if (snapshot.hash !== '21adba9e999d9c09707b2f85ba335f0470d4b6ee24b9aea1199f77ffea7b3632') throw new Error('The owned draft changed since the saved checkpoint.');
  const program = await json<any>('native-program.json');
  const contract = await json<any>('source-block-contract.json');
  contract.referenceReport.path = path.resolve(jobDir, contract.referenceReport.path);
  const compiled = await json<any>('native-plan.json');
  const capabilities = await json<any>('target/capabilities.json');
  const assets = await json<any>('assets/imported.json');
  const catalog = await json<any>('target/catalog.json');
  process.stderr.write('[read-only verify] request preview access\n');
  const access = await client.getPreviewAccess(pageId);
  process.stderr.write('[read-only verify] acquire scoped preview session\n');
  const cookies = await previewCookies(access.adminAccessUrl, config.targetUrl);
  process.stderr.write('[read-only verify] capture frontend\n');
  const checked = await checkFidelityFrontend({ program, contract, compiled, client, snapshot, schemas: capabilities.legacySchemas, assets, catalog, previewUrl: access.previewUrl, cookies, runDir, onProgress: stage => process.stderr.write(`[read-only verify] ${stage}\n`) });
  process.stdout.write(JSON.stringify({ status: checked.report.status, passed: checked.passed, hash: checked.snapshot.hash, verificationPath: checked.verificationPath, completion: checked.report.completion }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ verificationFailed: true, error: redact(error), stack: error instanceof Error ? error.stack?.split('\n').slice(0, 7).map(line => line.replace(/https?:\/\/\S+/g, '[url]')) : undefined }) + '\n');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}

import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/core/config.js';
import { WordPressClient } from '../src/wordpress/client.js';

const root = 'D:/cloneWP';
const runId = '2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75';
const pageId = 14866;
const baselinePath = `${root}/runs/${runId}/revisions/2026-10-15T02-34-58-296Z-1fa42b86/target/revision-block-11.json`;
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const { config, credentials } = await loadConfig(root);
const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password });
const changes: Array<{path: string; before: unknown; after: unknown}> = [];
function compare(a: unknown, b: unknown, path: string): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a), bk = Object.keys(b);
    for (const key of new Set([...ak, ...bk])) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    return;
  }
  changes.push({ path, before: a, after: b });
}
try {
  await client.createDraft(runId, 'Pet Supermarket reference review', { requireExistingPageId: pageId });
  const current = await client.snapshotDraft(pageId);
  compare(baseline.elements, current.elements, 'elements');
  compare(baseline.settings, current.settings, 'settings');
  process.stdout.write(JSON.stringify({ baselineHash: baseline.hash, currentHash: current.hash, status: current.status, changes: changes.slice(0, 30), changeCount: changes.length }) + '\n');
} finally { await client.close().catch(() => undefined); }

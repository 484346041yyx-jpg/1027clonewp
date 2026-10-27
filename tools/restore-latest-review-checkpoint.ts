import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../src/core/config.js';
import { WordPressClient } from '../src/wordpress/client.js';

const root = 'D:/cloneWP';
const runId = '2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75';
const pageId = 14866;
const baseline = JSON.parse(await readFile(`${root}/runs/${runId}/revisions/2026-10-15T02-34-58-296Z-1fa42b86/target/revision-block-11.json`, 'utf8'));
const { config, credentials } = await loadConfig(root);
const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password });
try {
  await client.createDraft(runId, 'Pet Supermarket reference review', { requireExistingPageId: pageId });
  const current = await client.snapshotDraft(pageId);
  if (baseline.hash !== 'b551992f3eb001b99f14cfd2959f157b3cb185cc088b671e025ec44922eea903' || current.hash !== '6ae13219226b38f9d3b34e911520b5a3d7db4e815df6dcfce8ad6ccf94fee166') throw new Error('Checkpoint or current draft changed; refusing restoration.');
  const expected = structuredClone(baseline);
  expected.elements[0].elements[0].elements[16].settings.slides_to_show = '2';
  if (!isDeepStrictEqual(expected.elements, current.elements) || !isDeepStrictEqual(expected.settings, current.settings)) throw new Error('Current draft contains changes beyond the authorized carousel test; refusing restoration.');
  const restored = await client.restoreDraft(pageId, baseline, { expectedCurrent: current });
  process.stdout.write(JSON.stringify({ restored: true, finalHash: restored.hash, status: restored.status }) + '\n');
} finally { await client.close().catch(() => undefined); }

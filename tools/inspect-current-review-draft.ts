import { loadConfig, redactor } from '../src/core/config.js';
import { WordPressClient } from '../src/wordpress/client.js';

const root = 'D:/cloneWP';
const runId = '2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75';
const pageId = 14866;
const { config, credentials } = await loadConfig(root);
const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password });
try {
  const owned = await client.inspectOwnedDraft(pageId, runId);
  if (!owned.exists || !owned.markerMatches || owned.status !== 'draft') throw new Error('The saved review draft is not the expected owned draft.');
  await client.createDraft(runId, 'Pet Supermarket reference review', { requireExistingPageId: pageId });
  const snapshot = await client.snapshotDraft(pageId);
  const editable = await client.verifyEditable(pageId);
  process.stdout.write(JSON.stringify({ owned: true, status: snapshot.status, hash: snapshot.hash, blocks: snapshot.elements.length, editable }) + '\n');
  try {
    const access = await client.getPreviewAccess(pageId);
    process.stdout.write(JSON.stringify({ previewAccess: true, previewUrl: access.previewUrl, editUrl: access.editUrl, oneTimeAccessAvailable: Boolean(access.adminAccessUrl) }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ previewAccess: false, error: redactor(error) }) + '\n');
  }
} finally {
  await client.close().catch(() => undefined);
}

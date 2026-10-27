import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { loadConfig, redactor } from './core/config.js';
import { WordPressClient, type LegacyComposition } from './wordpress/client.js';
import { captureTarget, verifyNativeEditor } from './verification/index.js';
import { assertAuthorizedEditorChanges } from './core/draft-guards.js';

/** One fresh owned draft, registered fixtures, real save/readback, native UI edits and restoration. */
async function main() {
  const { root, config, credentials } = await loadConfig();
  const redact = redactor(credentials);
  const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute });
  const runId = process.env.CLONEWP_SMOKE_RUN_ID ?? `smoke-${Date.now()}-${randomBytes(3).toString('hex')}`;
  if (!/^smoke-[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid owned smoke run identifier.');
  const runDir = path.join(root, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  let pageId: number | undefined;
  let built = false;
  try {
    const preflight = await client.preflight();
    await writeFile(path.join(runDir, 'preflight.json'), JSON.stringify(preflight, null, 2));
    if (preflight.blockers.length) throw new Error(preflight.blockers.join(' '));
    const capabilities = await client.discoverCapabilities();
    await writeFile(path.join(runDir, 'capabilities.json'), JSON.stringify(capabilities, null, 2));
    if (capabilities.mode !== 'legacy-verified') throw new Error('This live smoke explicitly exercises the verified legacy adapter on the existing test-site stack.');
    const draft = await client.createDraft(runId, `cloneWP live verification ${runId}`);
    pageId = draft.pageId;
    const colors = ['#174ea6', '#ef6c00'];
    const images = [];
    for (const [index, background] of colors.entries()) {
      const bytes = await sharp({ create: { width: 320, height: 180, channels: 3, background } }).png().toBuffer();
      const file = path.join(runDir, `native-image-${index + 1}.png`);
      await writeFile(file, bytes);
      images.push(await client.importAsset(file, { runId, pageId, sourceUrl: `data:image/png;base64,${bytes.toString('base64')}`, mimeType: 'image/png', alt: `Owned cloneWP verification fixture ${index + 1}` }));
    }
    const composition: LegacyComposition = { elements: [{
      id: 'aa11001', elType: 'container', isInner: false,
      settings: { container_type: 'flex', content_width: 'full', flex_direction: 'column', flex_gap: { column: '24', row: '24', isLinked: true, unit: 'px' }, padding: { top: '48', right: '48', bottom: '48', left: '48', unit: 'px', isLinked: true } },
      elements: [
        { id: 'aa11002', elType: 'widget', widgetType: 'heading', settings: { title: 'cloneWP native Elementor verification', header_size: 'h1', title_color: '#174ea6' }, elements: [] },
        { id: 'aa11003', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>This draft verifies a native nested container, text, media, button and Elementor editing controls.</p>' }, elements: [] },
        { id: 'aa11004', elType: 'container', isInner: true, settings: { container_type: 'flex', content_width: 'full', flex_direction: 'column' }, elements: [
          { id: 'aa11005', elType: 'widget', widgetType: 'image', settings: { image: { id: images[0].attachmentId, url: images[0].url }, image_size: 'full' }, elements: [] },
          { id: 'aa11006', elType: 'widget', widgetType: 'button', settings: { text: 'Native editable button', link: { url: 'https://example.com/', is_external: 'on' }, background_color: '#174ea6' }, elements: [] },
        ] },
      ],
    }] };
    const snapshot = await client.buildDraft(pageId, composition);
    built = true;
    await writeFile(path.join(runDir, 'document-snapshot.json'), JSON.stringify(snapshot, null, 2));
    const access = await client.getPreviewAccess(pageId);
    if (!access.adminAccessUrl) throw new Error('Novamira did not provide the one-time authenticated browser exchange.');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const login = await context.newPage();
      await login.goto(access.adminAccessUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (new URL(login.url()).origin !== client.origin || /wp-login\.php/.test(login.url())) throw new Error('One-time browser authentication did not reach the owned site editor.');
      const cookies = await context.cookies([client.origin, `${client.origin}/wp-admin/`]);
      await context.close();
      const mappings = [
        { sourceId: 'heading', targetId: 'aa11002', kind: 'heading' },
        { sourceId: 'image', targetId: 'aa11005', kind: 'image' },
        { sourceId: 'button', targetId: 'aa11006', kind: 'button' },
      ];
      const measurements = await captureTarget({ previewUrl: access.previewUrl, runDir, viewports: config.viewports, elementMap: mappings, auth: { cookies }, browser });
      const editor = await verifyNativeEditor({ editorUrl: access.editUrl, previewUrl: access.previewUrl, pageId, runDir, cookies, widgetMap: mappings, browser, imageReplacement: { attachmentId: images[1].attachmentId, url: images[1].url }, restore: async edits => {
        const current = await client.snapshotDraft(pageId!);
        assertAuthorizedEditorChanges(snapshot, current, edits, capabilities.legacySchemas);
        return (await client.restoreDraft(pageId!, snapshot, { expectedCurrent: current })).hash === snapshot.hash;
      } });
      const editable = await client.verifyEditable(pageId);
      const after = await client.readDraft(pageId);
      const passed = editor.status === 'verified' && editable.editable && after.hash === snapshot.hash && measurements.every(view => view.responseStatus === 200 && view.elements.every(item => item.found && item.nativeElement) && !view.imageFailures.length);
      const receipt = { runId, pageId, status: after.status, passed, editUrl: access.editUrl, previewUrl: access.previewUrl, capabilities: { mode: capabilities.mode, versions: capabilities.versions }, editability: editor, editable, restored: after.hash === snapshot.hash, screenshots: measurements.map(view => ({ viewport: view.name, path: view.screenshotPath })) };
      await writeFile(path.join(runDir, 'live-smoke-receipt.json'), JSON.stringify(receipt, null, 2));
      console.log(JSON.stringify({ runId, pageId, passed, status: after.status, restored: receipt.restored, editorStatus: editor.status, verifiedFields: editor.verifiedFields, runDir }));
      if (!passed) process.exitCode = 1;
    } finally { await browser.close(); }
  } catch (error) {
    if (pageId && !built) await client.deleteOwnedDraft(pageId).catch(() => undefined);
    const message = redact(error);
    await writeFile(path.join(runDir, 'failure.json'), JSON.stringify({ runId, pageId, message, status: 'failed' }, null, 2));
    console.error(message); process.exitCode = 1;
  } finally { await client.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Live smoke failed.'); process.exitCode = 1; });

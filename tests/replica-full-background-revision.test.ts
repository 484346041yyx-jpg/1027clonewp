import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expectedBackgroundPage, assertBackgroundReadback, validateBackgroundPatch, WordPressBackgroundRevision, type BackgroundPatch } from '../src/replica-full/background-revision/index.js';
import type { FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';
const clone = <T>(value: T): T => structuredClone(value);
const patch: BackgroundPatch = { authorization: 'current-user-background-repair', pageId: 42, nodes: [{ id: 'catalog', settings: { background_background: 'classic', background_image: { id: 14, url: 'https://example.com/a.jpg' } } }], css: '.page .catalog{background-size:cover}' };
const before = {
  hash: 'a'.repeat(64), receipts: { old: { state: 'complete' } },
  page: { pageId: 42, runId: 'run', status: 'publish', template: 'elementor_header_footer', title: 'Original', slug: 'original', headerId: 'header_test',
    elements: [{ id: 'catalog', elType: 'container', settings: { content_width: 'full' }, elements: [{ id: 'title', elType: 'widget', widgetType: 'heading', settings: { title: 'Preserve' }, elements: [] }] }, { id: 'other', elType: 'container', settings: { content_width: 'full' }, elements: [] }],
    settings: { custom_css: '.page .catalog{background-image:url(old.jpg)}', hide_title: 'yes' }, bodyHash: 'b'.repeat(64), built: true, publicUrl: 'https://example.com/original', flags: {} },
  header: { hash: 'c'.repeat(64), contract: { targetOrigin: 'https://example.com' }, resources: {}, snapshot: { globalHash: 'd'.repeat(64), defaultHeaderId: 'header_old', presetReferences: [], otherReferences: [], module: { identity: {}, header: {}, menus: { primary: { name: 'Original menu' } }, pages: { '42': { bodyHash: 'b'.repeat(64), snapshotHash: 'e'.repeat(64), pageId: 42, status: 'publish' } }, receipts: {} } } },
} as unknown as FullReplicaRemoteSnapshot;
function after(): FullReplicaRemoteSnapshot { const a = clone(before); a.page = expectedBackgroundPage(before, patch); a.page.bodyHash = 'f'.repeat(64); a.hash = '1'.repeat(64); a.header.hash = '2'.repeat(64); a.header.snapshot.module!.pages['42'].bodyHash = a.page.bodyHash; a.header.snapshot.module!.pages['42'].snapshotHash = '3'.repeat(64); return a; }
test('published background amendment changes only exact native container fields and CSS', () => {
  const original = clone(before), result = expectedBackgroundPage(before, patch);
  assert.deepEqual(before, original); assert.equal(result.status, 'publish');
  assert.equal(result.elements[0].settings.background_background, 'classic');
  assert.deepEqual(result.elements[0].elements, before.page!.elements[0].elements);
  assert.deepEqual(result.elements[1], before.page!.elements[1]);
  assert.doesNotThrow(() => assertBackgroundReadback(before, after(), patch));
});
test('patch rejects scope expansion and non-container targets', () => {
  assert.throws(() => validateBackgroundPatch({ ...patch, unexpected: true } as BackgroundPatch), /patch_invalid/);
  assert.throws(() => validateBackgroundPatch({ ...patch, authorization: 'old-task' } as unknown as BackgroundPatch), /patch_invalid/);
  assert.throws(() => validateBackgroundPatch({ ...patch, nodes: [{ id: 'catalog', settings: { title: 'replace' } }] }), /node_invalid/);
  assert.throws(() => expectedBackgroundPage(before, { ...patch, nodes: [{ id: 'title', settings: { background_color: '#fff' } }] }), /container_required/);
  assert.throws(() => expectedBackgroundPage(before, { ...patch, nodes: [{ id: 'missing', settings: { background_color: '#fff' } }] }), /node_missing/);
  assert.throws(() => validateBackgroundPatch({ ...patch, nodes: [patch.nodes[0], patch.nodes[0]] }), /patch_invalid/);
  assert.throws(() => validateBackgroundPatch({ ...patch, nodes: [{ id: 'catalog', settings: { background_image: { id: 0, url: 'https://example.com/a' } } }] }), /media_invalid/);
});
test('readback rejects changed page, other node, menu, global guard, status, and old receipts', () => {
  for (const change of [
    (a: FullReplicaRemoteSnapshot) => { a.page!.status = 'draft'; },
    (a: FullReplicaRemoteSnapshot) => { a.page!.elements[1].settings.content_width = 'boxed'; },
    (a: FullReplicaRemoteSnapshot) => { a.page!.elements[0].elements![0].settings.title = 'Changed'; },
    (a: FullReplicaRemoteSnapshot) => { a.page!.settings.hide_title = 'no'; },
    (a: FullReplicaRemoteSnapshot) => { a.header.snapshot.globalHash = '9'.repeat(64); },
    (a: FullReplicaRemoteSnapshot) => { a.header.snapshot.module!.menus.primary.name = 'Changed'; },
    (a: FullReplicaRemoteSnapshot) => { a.receipts = {}; },
  ]) { const a = after(); change(a); assert.throws(() => assertBackgroundReadback(before, a, patch), /changed/); }
});
test('independent helper retains draft-only old adapter and serial CAS/receipts', async () => {
  const fixed = await readFile(new URL('../src/replica-full/background-revision/wordpress.php', import.meta.url), 'utf8');
  const original = await readFile(new URL('../src/replica-full/wordpress-full.php', import.meta.url), 'utf8');
  assert.match(original, /\$p\['status'\]!==\'draft\'/);
  for (const guard of ['background_edit_lock', 'background_snapshot', 'background_media', 'background_protected_changed']) {
    if (guard === 'background_snapshot') assert.match(fixed, /\$before\['hash'\]!==/); else assert.ok(fixed.includes(guard));
  }
  assert.ok(fixed.includes("add_option($lock,$lockValue"));
  assert.ok(fixed.includes("$receipt=['state'=>'started'"));
  assert.ok(fixed.includes("$receipt['state']='complete'"));
  assert.ok(!fixed.includes("delete_post_meta($id,'_edit_lock'"));
  assert.ok(fixed.includes("$plugin->elements_manager->create_element_instance"));
  assert.ok(fixed.includes("array_merge($stack['controls']??[],$stack['style_controls']??[])"));
  assert.ok(!fixed.includes('new \\Elementor\\Element_Container'));
});
test('read-only controls and observation encode source data without executing source PHP', async () => {
  const operations: Array<{ name: string; code: string }> = [];
  const driver = new WordPressBackgroundRevision({ origin: 'https://example.com', readPHP: async <T>(operation: { name: string; code: string }) => { operations.push(operation); return { ok: true, value: { snapshot: before, editorLock: { activeUserId: false, currentUserId: 1, tokenHash: 'a'.repeat(64) }, receipt: null } } as T; }, executePHP: async () => { throw Error('write not expected'); } });
  const identity = { moduleKey: 'test', owner: { ownerId: 'test', runId: 'run' }, targetOrigin: 'https://example.com', headerId: 'header_test' };
  assert.equal((await driver.inspect(identity)).snapshot.page?.status, 'publish');
  await driver.controls(identity);
  assert.deepEqual(operations.map(x => x.name), ['full-background.inspect', 'full-background.controls']);
  assert.ok(operations.every(x => x.code.includes('$fullRead=static function($input)')));
});

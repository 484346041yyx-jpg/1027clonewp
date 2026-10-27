import test from 'node:test';
import assert from 'node:assert/strict';
import { WordPressClient, WordPressError } from '../src/wordpress/client.js';
import type { DraftSnapshot, ElementorElement, OwnedPublicationIntentProof } from '../src/wordpress/types.js';
import { canonicalV2, documentHashV2 } from '../src/replica-v2/journal.js';
import { assertOwnedPublishedSnapshot } from '../src/wordpress/publication-contract.js';

const elements: ElementorElement[] = [{ id: 'aa00001', elType: 'container', settings: { content_width: 'full' }, elements: [{ id: 'aa00002', elType: 'widget', widgetType: 'heading', settings: { title: 'Editable fixture' }, elements: [] }] }];
const widgetTypes = ['container', 'heading'];
const proof = { version: 1 as const, sha256: 'a'.repeat(64), types: widgetTypes };
function fixture() {
  const client = new WordPressClient({ targetUrl: 'https://fixture.example/', username: 'fixture', applicationPassword: 'secret', executionStrategy: 'native44-css-handoff' });
  const state = { pageId: 101, runId: 'publication-run', title: 'Native page', status: 'draft', elements: structuredClone(elements), settings: { post_status: 'draft', post_title: 'Native page', custom_css: '.elementor-101{color:blue}' } as Record<string, unknown>, canEdit: true, canPublish: true, unique: true, locked: false, built: true, owner: true, postType: 'page', retainSettings: false, loseReply: false, mutateAtCAS: false, afterOverride: undefined as unknown, publicUrl: 'https://fixture.example/native-page/', calls: [] as string[], writes: 0 };
  const error = (code: string): never => { throw new WordPressError('php_execution_failed', code); };
  const guard = (status: string) => { if (state.status !== status || state.postType !== 'page' || !state.owner || !state.canEdit) error('owned_guard'); if (!state.unique) error('ambiguous_run_pages'); if (!state.built) error('document_missing'); };
  const snapshot = () => structuredClone({ pageId: state.pageId, runId: state.runId, title: state.title, status: state.status, elements: state.elements, settings: state.settings });
  (client as unknown as { php(code: string): Promise<unknown> }).php = async code => {
    state.calls.push(code);
    if (code.includes('$publishOwnedDraft=true')) {
      guard('draft'); if (!state.canPublish) error('owned_publish_permission_guard'); if (state.locked) error('another_user_editing');
      if (state.mutateAtCAS) { state.mutateAtCAS = false; state.settings.externalChange = 'preserved'; }
      const encoded = code.match(/\$expectedCurrent=json_decode\(base64_decode\('([^']+)'\)/)![1];
      const expected = JSON.parse(Buffer.from(encoded, 'base64').toString());
      if (canonicalV2(expected) !== canonicalV2({ elements: state.elements, settings: state.settings })) error('concurrent_document_change');
      state.writes++; state.status = 'publish'; if (!state.retainSettings) state.settings.post_status = 'publish';
      if (state.loseReply) { state.loseReply = false; error('network_error'); }
      return { published: true, pageId: state.pageId, runId: state.runId };
    }
    if (code.includes('$ownedPublicationCheckpoint=true')) { guard('publish'); return state.afterOverride ?? { snapshot: snapshot(), proof, publicUrl: state.publicUrl }; }
    guard('draft');
    if (code.includes("return ['snapshot'")) return { snapshot: snapshot(), proof };
    return snapshot();
  };
  const baseline = async () => (await client.readOwnedReviewCheckpoint(101, state.runId, widgetTypes)).snapshot;
  const intent = (before: DraftSnapshot): OwnedPublicationIntentProof => ({ version: 1, kind: 'owned-page-publication-intent', operationId: 'publish-fixture', intentSha256: 'b'.repeat(64), beforeHash: before.hash, durableIntentConfirmed: true, freeBytes: 1024 * 1024 * 1024 });
  return { client, state, baseline, intent, snapshot };
}

test('protected publication only changes status, checks full CAS and reads a fresh published checkpoint', async () => {
  const f = fixture(), before = await f.baseline();
  const result = await f.client.publishOwnedDraft(before, f.intent(before));
  assert.equal(result.snapshot.status, 'publish'); assert.equal(result.snapshot.settings.post_status, 'publish'); assert.equal(result.settingsStatus, 'published'); assert.equal(result.publicUrl, f.state.publicUrl);
  assert.deepEqual(result.snapshot.elements, before.elements); assert.equal(result.snapshot.hash, documentHashV2(before.elements, { ...before.settings, post_status: 'publish' })); assert.notEqual(result.snapshot.hash, before.hash);
  assert.equal(f.state.writes, 1); assert.equal(f.client.diagnostics().pagePublications, 1); assert.equal(f.client.diagnostics().documentSaves, 0); assert.equal(f.client.diagnostics().documentRestores, 0);
  const code = f.state.calls.find(value => value.includes('$publishOwnedDraft=true'))!;
  for (const pattern of [/get_post_type\(\$id\)!=='page'/, /get_post_status\(\$id\)!=='draft'/, /_clonewp_run_id/, /current_user_can\('edit_post',\$id\)/, /current_user_can\('publish_pages'\)/, /wp_check_post_lock\(\$id\)/, /ambiguous_run_pages/, /is_built_with_elementor/, /\$expectedCurrent=/, /get_the_title\(\$id\)!==/, /wp_update_post\(\['ID'=>\$id,'post_status'=>'publish'\],true\)/]) assert.match(code, pattern);
  assert.equal((code.match(/wp_update_post\(/g) ?? []).length, 1); assert.doesNotMatch(code, /\$doc->save\(|wp_delete_post|wp_insert_post|update_post_meta/);
  const publishedRead = f.state.calls.at(-1)!; assert.match(publishedRead, /ownedPublicationCheckpoint/); assert.doesNotMatch(publishedRead, /wp_update_post|->save\(/);
  await assert.rejects(f.client.snapshotDraft(101), /owned_guard/);
});

test('publication explicitly accepts unchanged saved post_status without rewriting settings', async () => {
  const f = fixture(); f.state.retainSettings = true; const before = await f.baseline();
  const result = await f.client.publishOwnedDraft(before, f.intent(before));
  assert.equal(result.settingsStatus, 'retained'); assert.equal(result.snapshot.hash, before.hash); assert.deepEqual(result.snapshot.settings, before.settings); assert.equal(f.state.writes, 1);
});

test('publication requires attestation, durable intent and disk proof before any publish request', async () => {
  const fresh = fixture(); const before = { ...fresh.snapshot(), status: 'draft', hash: documentHashV2(fresh.state.elements, fresh.state.settings) } as DraftSnapshot;
  await assert.rejects(fresh.client.publishOwnedDraft(before, fresh.intent(before)), /fresh server-read/); assert.equal(fresh.state.calls.length, 0);
  const f = fixture(), attested = await f.baseline();
  for (const patch of [{ freeBytes: 512 * 1024 * 1024 - 1 }, { durableIntentConfirmed: false }, { beforeHash: 'c'.repeat(64) }, { intentSha256: 'invalid' }, { operationId: '../escape' }]) await assert.rejects(f.client.publishOwnedDraft(attested, { ...f.intent(attested), ...patch } as OwnedPublicationIntentProof), /persisted intent/);
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.writes, 0);
});

test('publication preserves a concurrent content edit and cannot retry an attempted transition', async () => {
  const f = fixture(), before = await f.baseline(); f.state.mutateAtCAS = true;
  await assert.rejects(f.client.publishOwnedDraft(before, f.intent(before)), /concurrent_document_change/);
  assert.equal(f.state.writes, 0); assert.equal(f.state.status, 'draft'); assert.equal(f.state.settings.externalChange, 'preserved');
  await assert.rejects(f.client.publishOwnedDraft(before, f.intent(before)), /already attempted/); assert.equal(f.state.writes, 0);
});

test('publish permission and active editor lock are enforced at the server mutation boundary', async () => {
  for (const flag of ['canPublish', 'locked'] as const) {
    const f = fixture(), before = await f.baseline(); f.state[flag] = flag === 'locked';
    await assert.rejects(f.client.publishOwnedDraft(before, f.intent(before)), flag === 'locked' ? /another_user_editing/ : /publish_permission_guard/);
    assert.equal(f.state.writes, 0); assert.equal(f.state.status, 'draft');
  }
});

test('unknown publish response is never repeated and read-only checkpoint reconciles the published page', async () => {
  const f = fixture(), before = await f.baseline(); f.state.loseReply = true;
  await assert.rejects(f.client.publishOwnedDraft(before, f.intent(before)), /network_error/); assert.equal(f.state.writes, 1);
  await assert.rejects(f.client.publishOwnedDraft(before, f.intent(before)), /already attempted/); assert.equal(f.state.writes, 1);
  const current = await f.client.readOwnedPublishedCheckpoint(101, f.state.runId, widgetTypes);
  assert.equal(current.snapshot.status, 'publish'); assert.equal(f.state.writes, 1); assert.equal(f.client.diagnostics().documentRestores, 0);
});

test('published readback rejects non-status changes and leaves the server result untouched', async () => {
  for (const changed of ['elements', 'settings', 'title'] as const) {
    const f = fixture(), before = await f.baseline();
    const actual = { ...f.snapshot(), status: 'publish' };
    if (changed === 'elements') actual.elements[0].settings.content_width = 'boxed';
    if (changed === 'settings') actual.settings.custom_css = 'external edit';
    if (changed === 'title') actual.title = 'Other title';
    f.state.afterOverride = { snapshot: actual, proof, publicUrl: f.state.publicUrl };
    await assert.rejects(f.client.publishOwnedDraft(before, f.intent(before)), /changed more than page status|exact owned draft/); assert.equal(f.state.status, 'publish'); assert.equal(f.state.writes, 1); assert.equal(f.client.diagnostics().documentRestores, 0);
  }
});

test('pure publication equivalence validates complete identities and hashes without client authority', async () => {
  const f = fixture(), before = await f.baseline();
  const after = { ...structuredClone(before), status: 'publish' as const, settings: { ...before.settings, post_status: 'publish' } as Record<string, unknown> }; after.hash = documentHashV2(after.elements, after.settings);
  assert.equal(assertOwnedPublishedSnapshot(before, after), 'published');
  for (const patch of [{ pageId: 102 }, { runId: 'other-run' }, { title: 'Other title' }, { hash: 'f'.repeat(64) }, { status: 'draft' }]) assert.throws(() => assertOwnedPublishedSnapshot(before, { ...after, ...patch } as typeof after), /complete valid hashes/);
  const changed = structuredClone(after); changed.settings.post_title = 'Changed native title'; changed.hash = documentHashV2(changed.elements, changed.settings);
  assert.throws(() => assertOwnedPublishedSnapshot(before, changed), /changed more than page status/);
  const settings = { custom_css: '' }, absent = { ...before, settings, hash: documentHashV2(before.elements, settings) };
  assert.equal(assertOwnedPublishedSnapshot(absent, { ...absent, status: 'publish' }), 'retained');
  const added = { ...after, settings: { ...settings, post_status: 'publish' } }; added.hash = documentHashV2(added.elements, added.settings);
  assert.throws(() => assertOwnedPublishedSnapshot(absent, added), /changed more than page status/);
});

test('published checkpoints reject foreign or credential-bearing permalinks without granting draft authority', async () => {
  for (const publicUrl of ['https://other.example/page/', 'https://fixture.example/page/?token=secret', 'https://u:p@fixture.example/page/', 'https://fixture.example/page/#secret', 'https://fixture.example/wp-admin/', 'https://fixture.example/?page_id=102', 'https://fixture.example/?page_id=101&page_id=101']) {
    const f = fixture(); f.state.status = 'publish'; f.state.publicUrl = publicUrl;
    await assert.rejects(f.client.readOwnedPublishedCheckpoint(101, f.state.runId, widgetTypes), /permalink/); assert.equal(f.state.writes, 0);
  }
  const f = fixture(); f.state.status = 'publish'; f.state.publicUrl = 'https://fixture.example/?page_id=101';
  const current = await f.client.readOwnedPublishedCheckpoint(101, f.state.runId, widgetTypes);
  assert.equal(current.publicUrl, f.state.publicUrl);
  const forged = { ...current.snapshot, status: 'draft' } as DraftSnapshot;
  await assert.rejects(f.client.publishOwnedDraft(forged, f.intent(forged)), /fresh server-read/); assert.equal(f.state.writes, 0);
});

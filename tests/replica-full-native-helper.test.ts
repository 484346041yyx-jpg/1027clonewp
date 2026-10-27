import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeFullReplicaHeaderHelper, loadFullReplicaHeaderHelper } from '../src/replica-full/native-helper.js';
import { FullReplicaHeaderModuleDriver } from '../src/replica-full/native-header.js';
import { WordPressFullReplicaDriver } from '../src/replica-full/driver.js';
import type { HeaderModuleIdentity } from '../src/woodmart-header/generic/wordpress.js';
import type { HeaderPHPReadOperation, HeaderPHPMutationOperation } from '../src/woodmart-header/transport.js';

const originalClosure = '$pageObservation=static function($pid)use($digest){', normalizedClosure = '$pageObservation=static function($pid)use($digest,$ownerToken,$owner){';
const added = "\n    if(get_post_meta($pid,'_clonewp_header_module_owner',true)===$ownerToken&&get_post_meta($pid,'_clonewp_run_id',true)===($owner['runId']??null))foreach(['_elementor_controls_usage'] as $key)unset($meta[$key]);";
const exclusion = "foreach(['_edit_lock','_edit_last','_elementor_element_cache','_elementor_css','_elementor_page_assets','wd_page_css_files','wd_page_css_files_mobile'] as $key)unset($meta[$key]);";
const identity: HeaderModuleIdentity = { moduleKey: 'alder-native-helper', owner: { ownerId: 'clonewp', runId: 'alder-native-run' }, targetOrigin: 'https://target.example', headerId: 'header_12345' }, hash = 'a'.repeat(64);

test('full helper normalization changes only owned-page derived caches, preserving all protected resources and guards exactly', async () => {
  const filename = 'D:/cloneWP/src/woodmart-header/generic/wordpress.php', original = await readFile(filename, 'utf8'), normalized = await loadFullReplicaHeaderHelper();
  assert.equal(normalized.split(added).length, 2); assert.equal(normalized.replace(normalizedClosure, originalClosure).replace(added, ''), original); assert.equal(await readFile(filename, 'utf8'), original);
  assert.equal(normalized.slice(normalized.indexOf('$snapshot=static function()')), original.slice(original.indexOf('$snapshot=static function()')));
  assert.match(normalized, /_clonewp_header_module_owner',true\)===\$ownerToken&&get_post_meta\(\$pid,'_clonewp_run_id'/);
});

test('missing, duplicated, moved or previously normalized helper contracts fail closed', async () => {
  const original = await readFile('D:/cloneWP/src/woodmart-header/generic/wordpress.php', 'utf8');
  assert.throws(() => normalizeFullReplicaHeaderHelper(original.replace(exclusion, '')), /contract_changed/);
  assert.throws(() => normalizeFullReplicaHeaderHelper(original + exclusion), /contract_changed/);
  assert.throws(() => normalizeFullReplicaHeaderHelper(original.replace(exclusion, '') + exclusion), /scope_changed/);
  assert.throws(() => normalizeFullReplicaHeaderHelper(normalizeFullReplicaHeaderHelper(original)), /contract_changed/);
});

test('new native and full drivers execute exactly the same normalized helper and retain encoded input and original intent', async () => {
  const native: string[] = [], full: string[] = [], expected = await loadFullReplicaHeaderHelper(), inspection = { contract: { targetOrigin: identity.targetOrigin }, resources: { targetOrigin: identity.targetOrigin }, snapshot: { module: null, globalHash: hash, defaultHeaderId: 'default_header', presetReferences: [], otherReferences: [] }, hash }, snapshot = { hash, header: inspection, page: null, receipts: {} };
  const driver = new FullReplicaHeaderModuleDriver({ origin: identity.targetOrigin, async readPHP<T>(operation: HeaderPHPReadOperation) { native.push(operation.code); return { ok: true, value: inspection } as T; }, async executePHP<T>(operation: HeaderPHPMutationOperation) { native.push(operation.code); assert.equal(operation.intent.operationId, 'bind-1'); return { ok: true, value: { hash, snapshot: inspection.snapshot } } as T; } });
  await driver.inspect(identity); await driver.mutate(identity, { operationId: 'bind-1', action: 'bind', expectedHash: hash, payload: { pageId: 99, expectedBodyHash: hash } }, { operationId: 'bind-1', runId: identity.owner.runId, resource: `header-module/${identity.moduleKey}`, expectedSnapshotSha256: hash, persistedIntentSha256: hash });
  const fullDriver = new WordPressFullReplicaDriver({ origin: identity.targetOrigin, async readPHP<T>(operation: HeaderPHPReadOperation) { full.push(operation.code); return { ok: true, value: snapshot } as T; }, async executePHP<T>(): Promise<T> { throw Error('No full mutation expected'); } }); await fullDriver.inspect(identity);
  for (const code of [...native, ...full]) assert.ok(code.includes(expected));
  assert.match(native[1], /\$input=json_decode\(base64_decode\('/); assert.match(full[0], /\$headerRead=static function\(\$input\)/); assert.equal(native.length, 2); assert.equal(full.length, 1);
});

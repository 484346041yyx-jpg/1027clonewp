import test from 'node:test';
import assert from 'node:assert/strict';
import { bindReusedHeader, inspectReusedHeader, reusedHeaderPHP, type ReusedHeaderSnapshot } from '../src/replica-full/reused-header.js';

const identity = { pageId: 555, runId: 'new-body-run', headerId: 'header_123' };
const before: ReusedHeaderSnapshot = { ...identity, hash: 'a'.repeat(64), sharedHash: 'b'.repeat(64), documentHash: 'c'.repeat(64), bound: false, template: 'elementor_canvas' };
const after = { ...before, hash: 'd'.repeat(64), bound: true, template: 'elementor_header_footer' };

test('reused header rejects invalid identity before invoking PHP', () => {
  assert.throws(() => reusedHeaderPHP({ ...identity, pageId: -1 }));
  assert.throws(() => reusedHeaderPHP({ ...identity, headerId: "header_1';delete" }));
  assert.throws(() => reusedHeaderPHP(identity, { ...before, runId: 'other-run' }));
});

test('reused header persists exact intent before binding and receipt after readback', async () => {
  const events: string[] = [];
  const transport = { async php(code: string) { events.push('php'); const encoded = code.match(/base64_decode\('([^']+)'\)/)![1]; const input = JSON.parse(Buffer.from(encoded, 'base64').toString()); assert.deepEqual(input, { ...identity, expected: before.hash }); return after; } };
  const result = await bindReusedHeader({ transport, identity, before, operationId: 'bind-once', async persistIntent(intent) { events.push('intent'); assert.equal(intent.sharedHash, before.sharedHash); }, async persistReadback(receipt) { events.push('readback'); assert.deepEqual(receipt.after, after); } });
  assert.deepEqual(events, ['intent', 'php', 'readback']);
  assert.equal(result.after.bound, true);
});

test('unconfirmed response is not retried and never persisted as success', async () => {
  let calls = 0, receipts = 0;
  await assert.rejects(bindReusedHeader({ transport: { async php() { calls++; throw Error('timeout'); } }, identity, before, operationId: 'bind-once', async persistIntent() {}, async persistReadback() { receipts++; } }), /timeout/);
  assert.equal(calls, 1); assert.equal(receipts, 0);
});

test('changed shared resources invalidate binding response', async () => {
  await assert.rejects(bindReusedHeader({ transport: { async php() { return { ...after, sharedHash: 'e'.repeat(64) }; } }, identity, before, operationId: 'bind-once', async persistIntent() {}, async persistReadback() { assert.fail('must not persist approval'); } }), /readback_unknown/);
});

test('inspection is read only and fixed helper guards page ownership and shared resources', async () => {
  const result = await inspectReusedHeader({ async php(code) { const encoded = code.match(/base64_decode\('([^']+)'\)/)![1]; assert.equal(JSON.parse(Buffer.from(encoded, 'base64').toString()).expected, null); return before; } }, identity);
  assert.deepEqual(result, before);
  const code = reusedHeaderPHP(identity, before);
  assert.match(code, /wp_check_post_lock/);
  assert.match(code, /snapshot_changed/);
  assert.match(code, /get_post_meta\(\$block->ID\)/);
  assert.match(code, /get_post_meta\(\$item->ID\)/);
  assert.doesNotMatch(code, /update_option\(|wp_update_nav_menu|wp_insert_post|wp_update_post/);
});

test('server digest recursively sorts associative settings while preserving field and element order', () => {
  const code=reusedHeaderPHP(identity,before);
  assert.match(code,/\$list=array_is_list\(\$value\)/);
  assert.match(code,/foreach\(\$value as \$key=>\$child\)\$value\[\$key\]=\$normalize\(\$child\)/);
  assert.match(code,/if\(!\$list\)ksort\(\$value,SORT_STRING\)/);
  assert.match(code,/hash\('sha256',serialize\(\$normalize\(\$value\)\)\)/);
  assert.match(code,/\$documentDigest\(\$doc->get_settings\(\)\)!==\$documentDigest\(\$settings\)/);
});

test('document readback compares normalized JSON while shared resources retain serialize digest',()=>{
  const code=reusedHeaderPHP(identity,before);
  assert.match(code,/\$documentDigest=static function\(\$value\)use\(\$normalize\)/);
  assert.match(code,/json_encode\(\$normalize\(\$value\),JSON_UNESCAPED_UNICODE\|JSON_UNESCAPED_SLASHES\)/);
  assert.doesNotMatch(code,/JSON_PRESERVE_ZERO_FRACTION|JSON_NUMERIC_CHECK/);
  assert.match(code,/\$sharedHash=\$digest\(\[\$raw,\$menus,\$blocks/);
  assert.match(code,/\$documentDigest\(\$doc->get_elements_data\(\)\)!==\$documentDigest\(\$elements\)/);
  assert.notEqual(JSON.stringify([1,2]),JSON.stringify([2,1]));
  assert.notEqual(JSON.stringify({size:1}),JSON.stringify({size:'1'}));
  assert.equal(JSON.stringify({size:1.0}),JSON.stringify({size:1}));
});

test('owned shell sets registered document overrides and verifies effective theme values', () => {
  const code=reusedHeaderPHP(identity,before);
  for(const key of ['wd__woodmart_title_off','wd__woodmart_footer_off','wd__woodmart_prefooter_off','wd__woodmart_copyrights_off'])assert.ok(code.includes(`'${key}'`));
  assert.match(code,/\$control\['return_value'\]\?\?\$switcher->get_settings\('return_value'\)/);
  assert.match(code,/\$shellSettings\['wd__woodmart_main_layout'\]='full-width'/);
  assert.match(code,/\$settings=array_merge\(\$settings,\$shellSettings\)/);
  assert.match(code,/woodmart_get_post_meta_value\(\$id,substr\(\$key,3\)\)!==\$value/);
  assert.match(code,/reused_header_effective_shell_unknown/);
});

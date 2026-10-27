import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { native44RegisteredSchemaEvidence, native44RegisteredSchemaHash, NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS } from '../src/native44/selection.js';
import { fingerprintNative44Contracts } from '../src/native44/environment.js';
import { nativeCheckpointPHP } from '../src/wordpress/checkpoint.js';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';
import type { LegacySchema } from '../src/wordpress/types.js';

// Exact class/condition and values from the two real 2026-10-17 registrations.
const schema = (value = 'wd_6ad3ad27b46b3'): LegacySchema => ({ type: 'wd_testimonials', class: 'XTS\\Elementor\\Testimonials', controls: {
  layout: { type: 'select', default: 'slider', options: { slider: 'Carousel', grid: 'Grid' } },
  carousel_sync: { type: 'select', default: '', options: { '': 'Disabled', parent: 'As parent', child: 'As child' }, condition: { layout: 'slider' } },
  sync_parent_id: { type: 'text', label: 'ID', default: value, condition: { layout: 'slider', carousel_sync: ['parent'] } },
} });
const rawHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('exact observed generated defaults share a marked schema identity without modifying raw registrations', () => {
  const first = schema(), second = schema('wd_6ad3b122a8a48'), before = structuredClone(first), a = native44RegisteredSchemaEvidence(first), b = native44RegisteredSchemaEvidence(second);
  assert.equal(a.requestGeneratedDefaultNormalized, true); assert.equal(b.requestGeneratedDefaultNormalized, true);
  assert.equal(a.sha256, b.sha256); assert.notEqual(a.rawSha256, b.rawSha256);
  assert.equal(a.rawSha256, rawHash(first)); assert.deepEqual(first, before);
  assert.equal(Object.hasOwn(a.value.controls.sync_parent_id, 'default'), false);
  const absent = schema(); delete absent.controls.sync_parent_id.default;
  assert.equal(native44RegisteredSchemaEvidence(absent).requestGeneratedDefaultNormalized, false);
  assert.notEqual(native44RegisteredSchemaHash(absent), a.sha256, 'Missing default must not impersonate proved normalization');
  const reordered = schema(); reordered.controls.sync_parent_id.condition = { carousel_sync: ['parent'], layout: 'slider' };
  assert.equal(native44RegisteredSchemaHash(reordered), a.sha256, 'Associative condition key order is not a change of key/value/type semantics');
});

test('unknown classes, types, predicates and values are never normalized; unrelated drift remains bound', () => {
  const original = native44RegisteredSchemaHash(schema());
  const invalid: Array<(value: LegacySchema) => void> = [
    value => { value.class = 'Other\\Testimonials'; },
    value => { value.type = 'wd_products'; },
    value => { value.controls.sync_parent_id.type = 'hidden'; },
    value => { value.controls.sync_parent_id.default = 'fixed-parent-id'; },
    value => { value.controls.sync_parent_id.default = 'wd_6AD3AD27B46B3'; },
    value => { value.controls.sync_parent_id.condition = { layout: 'grid', carousel_sync: ['parent'] }; },
    value => { value.controls.sync_parent_id.condition = { layout: 'slider', carousel_sync: ['parent'], extra: 'yes' }; },
    value => { value.controls.sync_parent_id.condition = { layout: 'slider', carousel_sync: 'parent' }; },
    value => { value.controls.sync_parent_id.conditions = {}; },
  ];
  for (const edit of invalid) { const value = schema(); edit(value); const identity = native44RegisteredSchemaEvidence(value); assert.equal(identity.requestGeneratedDefaultNormalized, false); assert.notEqual(identity.sha256, original); }
  for (const edit of [(value: LegacySchema) => { value.controls.layout.default = 'grid'; }, (value: LegacySchema) => { value.controls.sync_parent_id.label = 'Changed ID'; }, (value: LegacySchema) => { value.controls.carousel_sync.options!.parent = 'Changed'; }]) {
    const value = schema(); edit(value); assert.notEqual(native44RegisteredSchemaHash(value), original);
  }
});

test('environment and selection use the same schema identity, including generated versus missing default', () => {
  const first = { versions: {}, legacySchemas: { wd_testimonials: schema() } }, second = { versions: {}, legacySchemas: { wd_testimonials: schema('wd_6ad3b122a8a48') } };
  assert.equal(fingerprintNative44Contracts(first, ['wd_testimonials']).schemaContractHash, fingerprintNative44Contracts(second, ['wd_testimonials']).schemaContractHash);
  delete second.legacySchemas.wd_testimonials.controls.sync_parent_id.default;
  assert.notEqual(fingerprintNative44Contracts(first, ['wd_testimonials']).schemaContractHash, fingerprintNative44Contracts(second, ['wd_testimonials']).schemaContractHash);
});

test('checkpoint PHP embeds the same exact descriptor and marks normalization separately from control omission', () => {
  const php = nativeCheckpointPHP("['wd_testimonials']");
  const encoded = /\$knownSyncContracts=json_decode\(base64_decode\('([^']+)'\),true\)/.exec(php)![1];
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS);
  assert.ok(php.includes("get_class($obj)===$syncContract['class']"));
  assert.ok(php.includes("($sync['type']??'')==='text'"));
  assert.ok(php.includes("is_string($sync['default']??null)"));
  assert.ok(php.includes("preg_match('/^wd_[a-f0-9]{13}$/',$sync['default'])"));
  assert.ok(php.includes("count($sync['condition'])===count($syncContract['condition'])"));
  assert.ok(php.includes("!array_key_exists($key,$sync['condition'])||$sync['condition'][$key]!==$expectedValue"));
  assert.ok(php.includes('&&$exactSyncCondition&&'));
  assert.equal(/(?<![!=])==(?!=)/.test(php), false, 'PHP uses strict comparisons only');
  assert.ok(php.includes("!array_key_exists('conditions',$sync)"));
  assert.ok(php.includes("'requestGeneratedSyncDefaultNormalized'=>$generatedSyncDefaultNormalized"));
  assert.ok(NATIVE44_ADAPTER_SOURCE_PATHS.includes('src/native44/environment.ts'));
  assert.ok(NATIVE44_ADAPTER_SOURCE_PATHS.includes('src/wordpress/checkpoint.ts'));
});

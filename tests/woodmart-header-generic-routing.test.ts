import test from 'node:test';
import assert from 'node:assert/strict';
import {
  routeReplicaHeaderChoice,
  validateReplicaHeaderChoice,
  validateOwnedDraftHeaderBinding,
} from '../src/woodmart-header/generic/routing.js';

const choice = (provider: 'component' | 'woodmart-header-builder' = 'woodmart-header-builder') => ({
  version: 1,
  kind: 'clonewp-replica-header-choice',
  provider,
  sourcePartition: { allUnits: ['wide/header', 'wide/hero', 'narrow/header'], headerUnits: ['wide/header', 'narrow/header'], bodyUnits: ['wide/hero'] },
});
const page = () => ({ pageId: 123, postType: 'page', status: 'draft', template: 'elementor_header_footer', runId: 'new-run', bodyHash: 'a'.repeat(64), headerId: null, snapshotHash: 'b'.repeat(64) });
const expected = { pageId: 123, runId: 'new-run' };

test('retired component route cannot suggest a removed writer',()=>{assert.throws(()=>routeReplicaHeaderChoice(choice('component')),/retired_component/);});

test('WHB route uses an independent module entry with separate body coverage', () => {
  const input = choice(), before = structuredClone(input), route = routeReplicaHeaderChoice(input);
  assert.equal(route.entryPoint, 'src/woodmart-header/generic/cli.ts');
  assert.equal(route.pagePipelineScope, 'separate-body-plan');
  assert.equal(route.pageTemplate, 'elementor_header_footer');
  assert.equal(route.independentlyEditableHeader, true);
  assert.equal(route.executes, false);
  assert.equal(route.remoteWrites, 0);
  route.sourcePartition.bodyUnits.push('caller-change');
  assert.deepEqual(input, before);
});

test('new routing records default omitted provider to WHB without altering legacy explicit choice', () => {
  const input = choice();
  const { provider: _provider, ...withoutProvider } = input;
  const route = routeReplicaHeaderChoice(withoutProvider);
  assert.equal(route.provider, 'woodmart-header-builder');
  assert.equal(route.entryPoint, 'src/woodmart-header/generic/cli.ts');
  assert.equal(Object.hasOwn(withoutProvider, 'provider'), false);
  assert.throws(()=>routeReplicaHeaderChoice(choice('component')),/retired_component/);
});

test('source inventory, header and body partition must be exact and disjoint', () => {
  const overlap = choice(); overlap.sourcePartition.bodyUnits.push('wide/header');
  assert.throws(() => validateReplicaHeaderChoice(overlap), /header_body_overlap/);
  const missing = choice(); missing.sourcePartition.bodyUnits = [];
  assert.throws(() => validateReplicaHeaderChoice(missing), /missing_source_coverage/);
  const outside = choice(); outside.sourcePartition.bodyUnits.push('wide/not-observed');
  assert.throws(() => validateReplicaHeaderChoice(outside), /unit_outside_inventory/);
  for (const key of ['allUnits', 'headerUnits', 'bodyUnits'] as const) {
    const duplicate = choice(); duplicate.sourcePartition[key].push(duplicate.sourcePartition[key][0]);
    assert.throws(() => validateReplicaHeaderChoice(duplicate), new RegExp(`duplicate_${key}`));
  }
});

test('header-only inventory is valid, but source-less and unknown providers fail', () => {
  const headerOnly = choice(); headerOnly.sourcePartition = { allUnits: ['header'], headerUnits: ['header'], bodyUnits: [] };
  assert.equal(routeReplicaHeaderChoice(headerOnly).pagePipelineScope, 'separate-body-plan');
  assert.throws(() => routeReplicaHeaderChoice({ ...choice(), provider: 'auto' }));
  assert.throws(() => routeReplicaHeaderChoice({ ...choice(), sourcePartition: undefined }));
  assert.throws(() => routeReplicaHeaderChoice({ ...choice(), fallbackToComponent: true }));
});

test('binding semantic preflight accepts only the precise owned Full Width draft', () => {
  assert.deepEqual(validateOwnedDraftHeaderBinding(page(), expected), page());
  for (const [patch, error] of [
    [{ pageId: 124 }, /binding_page_identity/],
    [{ runId: 'old-run' }, /binding_ownership/],
    [{ postType: 'elementor_library' }, /binding_page_type/],
    [{ status: 'publish' }, /binding_requires_draft/],
    [{ template: 'elementor_canvas' }, /binding_requires_full_width/],
    [{ headerId: 'header_193941' }, /binding_existing_header/],
  ] as const) assert.throws(() => validateOwnedDraftHeaderBinding({ ...page(), ...patch }, expected), error);
  assert.throws(() => validateOwnedDraftHeaderBinding({ ...page(), snapshotHash: '' }, expected));
});

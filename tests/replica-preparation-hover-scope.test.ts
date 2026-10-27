import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationHoverSource } from '../src/replica-preparation/hover-scope.js';
import type { PreparationPlan } from '../src/replica-preparation/types.js';
import type { BodySourceUnits } from '../src/replica-full/body-prepare.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';

const facts = { facts: { header: { kind: 'interaction' }, body: { kind: 'interaction' }, bodyText: { kind: 'text' } }, snapshots: [{ id: 'snapshot' }] } as unknown as SourceFactsV2;
const units = { units: [{ id: 'header-unit', sourceFactIds: ['header'] }, { id: 'body-unit', sourceFactIds: ['body', 'bodyText'] }] } as unknown as BodySourceUnits;
const plan = { version: 8, reusedHeader: { headerId: 'owned-elsewhere' }, sourcePartition: { bodyUnits: ['body-unit'] } } as unknown as PreparationPlan;

test('readonly reused header hover scope retains all body facts and the original snapshot identity without mutating source', () => {
  const scoped = preparationHoverSource(plan, facts, units);
  assert.deepEqual(Object.keys(scoped.facts), ['body', 'bodyText']);
  assert.equal(scoped.snapshots, facts.snapshots);
  assert.deepEqual(Object.keys(facts.facts), ['header', 'body', 'bodyText']);
});

test('owned headers and historical tasks retain the complete source hover obligation', () => {
  assert.equal(preparationHoverSource({ ...plan, reusedHeader: undefined }, facts, units), facts);
  assert.equal(preparationHoverSource({ ...plan, version: 7, reusedHeader: undefined }, facts, units), facts);
  assert.throws(() => preparationHoverSource({ ...plan, version: 7 }, facts, units), /hover_scope_version/);
});

test('readonly header scope rejects missing body units or facts rather than silently dropping them', () => {
  assert.throws(() => preparationHoverSource({ ...plan, sourcePartition: { ...plan.sourcePartition, bodyUnits: ['missing'] } }, facts, units), /hover_scope_units/);
  assert.throws(() => preparationHoverSource(plan, { ...facts, facts: {} }, units), /hover_scope_facts/);
});

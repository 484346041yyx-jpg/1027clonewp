import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPageScope, sourceFooterNodes, sourcePartitionSchema, assertBodySelectionRequest, assertBodySelectionUnits } from '../src/replica-full/page-scope.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';

test('body scope partitions every source unit without overlap, legacy tasks stay opt-in', () => {
  const p = { allUnits: ['h', 'b', 'f'], headerUnits: ['h'], bodyUnits: ['b'], footerUnits: ['f'] };
  const scope = { version: 4, pageScope: 'body-only' as const, headerProvider: 'reused-woodmart-header', reusedHeader: {}, sourcePartition: p };
  assert.doesNotThrow(() => assertPageScope(scope, 4));
  assert.throws(() => assertPageScope({ ...scope, reusedHeader: undefined }, 4), /reuse_required/);
  assert.throws(() => assertPageScope({ ...scope, version: 3 }, 4), /reuse_required/);
  for (const bad of [
    { ...p, bodyUnits: ['b', 'f'] }, { ...p, footerUnits: [] }, { ...p, allUnits: ['h', 'b', 'f', 'lost'] },
    { ...p, footerUnits: ['f', 'f'] },
  ]) assert.throws(() => assertPageScope({ ...scope, sourcePartition: bad }, 4), /partition/);
  assert.throws(() => assertPageScope({ ...scope, pageScope: undefined }, 4), /footer_requires_body_only/);
  // Old contracts remain validated by their original partition validators.
  assert.doesNotThrow(() => assertPageScope({ version: 1, sourcePartition: { allUnits: ['h', 'b'], headerUnits: ['h'], bodyUnits: ['b'] } }, 4));
});

test('footer exclusion retains article footers and body CTA; a mislabeled main cannot be dropped', () => {
  const defs = [
    ['root', null, 'BODY', {}], ['main', 'root', 'MAIN', {}], ['card-footer', 'main', 'FOOTER', {}],
    ['cta', 'main', 'SECTION', {}], ['footer', 'root', 'FOOTER', {}], ['copyright', 'footer', 'P', {}],
    ['div-footer', 'root', 'DIV', { class: 'site-footer' }], ['links', 'div-footer', 'DIV', {}],
  ] as const;
  const packet = { nodes: Object.fromEntries(defs.map(([id, parentId, tag, attributes]) => [id, { id, parentId, tag, attributes }])),
    regions: [{ id: 'site-footer', nodeId: 'div-footer', role: 'footer' }, { id: 'fake-footer', nodeId: 'main', role: 'footer' }] } as unknown as ObservationPacketV2;
  assert.deepEqual([...sourceFooterNodes(packet)].sort(), ['copyright', 'div-footer', 'footer', 'links']);
});

test('explicit selected body scope preserves every unit and rejects missing, overlapping or implicit omissions', () => {
  const p = { allUnits: ['h', 'b', 'other', 'f'], headerUnits: ['h'], bodyUnits: ['b'], footerUnits: ['f'], unselectedBodyUnits: ['other'], selection: { version: 1 as const, userInstruction: 'Only reproduce the quote section from my screenshot.', evidence: { path: 'request.json', sha256: 'a'.repeat(64) } } };
  const scope = { version: 4, pageScope: 'body-only' as const, headerProvider: 'reused-woodmart-header', reusedHeader: {}, sourcePartition: p };
  assert.doesNotThrow(() => assertPageScope(scope, 4));
  assert.throws(() => assertPageScope({ ...scope, version: 3 }, 4), /selection_contract/);
  assert.throws(() => assertPageScope({ ...scope, sourcePartition: { ...p, selection: undefined } }, 4), /selection_contract/);
  assert.throws(() => assertPageScope({ ...scope, sourcePartition: { ...p, unselectedBodyUnits: ['other', 'b'] } }, 4), /partition/);
  assert.throws(() => assertPageScope({ ...scope, sourcePartition: { ...p, allUnits: ['h', 'b', 'f'] } }, 4), /partition/);
  assert.throws(() => sourcePartitionSchema.parse({ ...p, selection: { ...p.selection, evidence: undefined } }));
  const request = { version: 1, kind: 'clonewp-body-selection-request', taskId: 'task', sourceUrl: 'https://source.example/', userInstruction: p.selection.userInstruction };
  assert.doesNotThrow(() => assertBodySelectionRequest(p, request, request));
  assert.throws(() => assertBodySelectionRequest(p, { ...request, userInstruction: 'different' }, request), /request_identity/);
  const units = p.allUnits.map(id => ({ id, snapshotId: 'desktop', nodeIds: [id], componentKeys: id === 'b' ? ['quote'] : [] }));
  assert.doesNotThrow(() => assertBodySelectionUnits(p, units));
  assert.throws(() => assertBodySelectionUnits(p, units.map(u => u.id === 'other' ? { ...u, componentKeys: ['leak'] } : u)), /unselected_component/);
  assert.throws(() => assertBodySelectionUnits(p, units.map(u => u.id === 'other' ? { ...u, nodeIds: ['b'] } : u)), /node_overlap/);
  assert.throws(() => assertBodySelectionUnits(p, units.map(u => u.id === 'b' ? { ...u, snapshotId: 'narrow' } : u)), /snapshot_missing/);
});

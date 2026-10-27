import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { sha256, type ObservationPacketV2, type ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import type { Native44SourceUnit } from '../src/native44/selection-types.js';
import { createNative44RequirementContract, deriveNative44SourceObligations, verifyNative44SourceScopes, validateNative44Requirements, evaluateNative44Acceptance, native44RequirementsHash, type Native44SourceScopeEvidenceSchema, type Native44AcceptanceObservation, type Native44AcceptancePolicy, type Native44VerifiedSourceScopes } from '../src/native44/requirements.js';
import type { z } from 'zod';

function fixture() {
  const files = new Map<string, Buffer>(), store = (name: string, value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)), path = `D:/cloneWP/.cache/scope-fixture/${name}.json`; files.set(path, bytes); return { path, sha256: sha256(bytes) }; };
  const packets: ObservationPacketV2[] = [1920, 1440].map((width, index) => {
    const id = index === 0 ? 'wide' : 'narrow', height = index === 0 ? 1080 : 1000, zero = { x: 0, y: 0, width: 0, height: 0 }, rect = { x: 0, y: 0, width, height };
    const layout = (id: string, bounds: typeof rect): ObservationPacketV2['layouts'][string] => ({ id, rect: bounds, contentRect: bounds, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: id === 'mobile' ? 'none' : 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 });
    return { version: 2, kind: 'observation-packet', snapshot: { id, url: 'https://source.example/', title: 'Normal source scope fixture', capturedAt: '2026-10-16T00:00:00.000Z', viewport: { name: index === 0 ? 'desktop' : 'desktop-narrow', width, height, clientWidth: width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: height, screenshot: { path: `${id}.png`, sha256: 'a'.repeat(64), width, height } }, nodes: { root: { id: 'root', parentId: null, regionId: 'header', tag: 'header', selector: '#header', attributes: {}, childIds: ['mobile', 'trigger'], styleId: 'shown', layoutId: 'root', visible: true }, mobile: { id: 'mobile', parentId: 'root', regionId: 'header', tag: 'input', selector: '#mobile-search', attributes: { type: 'search' }, childIds: [], styleId: 'hidden', layoutId: 'mobile', visible: false }, trigger: { id: 'trigger', parentId: 'root', regionId: 'header', tag: 'button', selector: '#desktop-menu', attributes: {}, childIds: [], styleId: 'shown', layoutId: 'trigger', visible: true } }, regions: [{ id: 'header', nodeId: 'root', contentNodeId: 'root', role: 'header', order: 0, gapBefore: 0 }], texts: { title: { id: 'title', nodeId: 'root', regionId: 'header', text: 'Header with an inactive mobile search and reachable desktop menu.', kind: 'body' } }, styles: { shown: { display: 'block', visibility: 'visible', opacity: '1' }, hidden: { display: 'none', visibility: 'visible', opacity: '1' } }, layouts: { root: layout('root', rect), mobile: layout('mobile', zero), trigger: layout('trigger', { x: 10, y: 10, width: 40, height: 40 }) }, resources: {}, usages: {}, interactions: { mobile: { id: 'mobile', nodeId: 'mobile', regionId: 'header', kind: 'control', status: 'unobserved', details: { type: 'search' } }, trigger: { id: 'trigger', nodeId: 'trigger', regionId: 'header', kind: 'control', status: 'unobserved', details: { label: 'Expand menu' } } }, gaps: [] };
  });
  const packetFiles = packets.map(packet => ({ ...store(packet.snapshot.id, packet), snapshotId: packet.snapshot.id }));
  const observation: ValidatedObservationV2 = { manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'https://source.example/', provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, manifestPath: 'D:/cloneWP/.cache/scope-fixture/manifest.json', manifestSha256: 'b'.repeat(64), packets, packetFiles };
  const source = buildSourceFactsV2(observation), sourceRef = store('facts', source);
  const units: Native44SourceUnit[] = packets.map(packet => ({ id: packet.snapshot.id, snapshotId: packet.snapshot.id, ownerNodeId: 'root', regionId: 'header', role: 'information-card', sourceFactIds: Object.values(source.facts).filter(fact => fact.snapshotId === packet.snapshot.id).map(fact => fact.id), evidence: { factIds: Object.values(source.facts).filter(fact => fact.snapshotId === packet.snapshot.id).map(fact => fact.id), screenshots: [{ snapshotId: packet.snapshot.id, screenshot: { path: packet.snapshot.screenshot.path, sha256: packet.snapshot.screenshot.sha256 } }], rationale: 'Independently captured all source facts including inactive mobile controls.' }, slots: [] }));
  const contract = createNative44RequirementContract(source, units, sourceRef, 'scope-task');
  for (const requirement of contract.requirements) if (requirement.capability !== 'search-input') requirement.fulfillment = { route: 'verified-native', componentKeys: ['native-control'], capability: requirement.capability, proof: sourceRef };
  const proof: z.infer<typeof Native44SourceScopeEvidenceSchema> = { version: 1, kind: 'native44-source-scope-evidence', classification: 'outside-desktop', sourceFacts: sourceRef, targetSelector: '#mobile-search', baselines: packets.map((packet, index) => ({ snapshotId: packet.snapshot.id, nodeId: 'mobile', packet: { path: packetFiles[index].path, sha256: packetFiles[index].sha256 }, states: ['activated', 'hovered'].map(action => {
    const state = structuredClone(packet); state.snapshot.id += `-${action}`; state.snapshot.capturedAt = '2026-10-16T00:00:10.000Z'; state.interactions.trigger.status = 'observed'; state.interactions.trigger.details = { scopeProbeTargetSelector: '#mobile-search', scopeProbeAction: action, scopeProbeResult: 'still-hidden' };
    return { triggerNodeId: 'trigger', action: action as 'activated' | 'hovered', packet: store(`${packet.snapshot.id}-${action}`, state) };
  }) })), review: { reviewer: 'codex', reviewedAt: '2026-10-16T00:00:20.000Z', judgment: 'Both desktop captures and all visible regional control states retain this zero-area responsive input inside its hidden subtree.' } };
  const scopeKeys = deriveNative44SourceObligations(source, units).filter(item => item.capability === 'search-input').map(item => item.sourceKey);
  const refresh = () => { const evidence = store('scope-proof', proof); contract.sourceScopes = scopeKeys.map(sourceKey => ({ sourceKey, classification: 'outside-desktop', evidence, reason: 'Mobile search remains inactive in both desktops and every observed reachable regional control state.' })); };
  refresh();
  const read = async (ref: { path: string; sha256: string }) => { const bytes = files.get(ref.path); assert.ok(bytes, `Actual evidence bytes ${ref.path}`); return bytes; };
  const current = { documentHash: 'c'.repeat(64), cssHash: 'd'.repeat(64) };
  const review = (): Native44AcceptanceObservation => ({ version: 1, kind: 'native44-acceptance-observation', requirementsHash: native44RequirementsHash(contract), ...current, review: { verification: sourceRef, visualReview: sourceRef }, checks: contract.requirements.filter(requirement => requirement.capability !== 'search-input').flatMap(requirement => requirement.checks.map(check => ({ requirementId: requirement.id, checkId: check.id, outcome: 'pass', evidence: [sourceRef] }))) });
  const policy = (): Native44AcceptancePolicy => ({ version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] });
  return { files, store, source, units, contract, proof, refresh, read, current, review, policy };
}

test('hidden/unobserved controls stay required without verified explicit desktop scope', async () => {
  const f = fixture();
  assert.equal(validateNative44Requirements(f.contract, { source: f.source, sourceUnits: f.units }).coverage.ready, false);
  assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), f.review(), f.current).verdict, 'needs-work');
  const fake: Native44VerifiedSourceScopes = { requirementsHash: native44RequirementsHash(f.contract), outsideSourceKeys: f.contract.sourceScopes!.map(item => item.sourceKey), unresolved: [] };
  assert.equal(validateNative44Requirements(f.contract, { source: f.source, sourceUnits: f.units, sourceScopes: fake }).coverage.ready, false);
});

test('raw two-desktop baselines and every reachable state can scope out behavior while retaining facts and requirements', async () => {
  const f = fixture(), before = native44RequirementsHash({ source: f.source, requirements: f.contract.requirements }), token = await verifyNative44SourceScopes(f.contract, f.source, f.read);
  assert.equal(token.outsideSourceKeys.length, 2); assert.equal(token.unresolved.length, 0);
  const checked = validateNative44Requirements(f.contract, { source: f.source, sourceUnits: f.units, sourceScopes: token });
  assert.equal(checked.coverage.ready, true); assert.equal(checked.coverage.gaps.length, 2); assert.ok(checked.coverage.gaps.every(gap => gap.outsideDesktop));
  const result = evaluateNative44Acceptance(f.contract, f.policy(), f.review(), { ...f.current, sourceScopes: token }); assert.equal(result.verdict, 'pass'); assert.equal(result.scopedOut.length, 2);
  assert.equal(native44RequirementsHash({ source: f.source, requirements: f.contract.requirements }), before);
  const missingPresence = f.review(); missingPresence.checks = missingPresence.checks.filter(item => item.checkId !== f.contract.requirements.find(item => item.dimension === 'presence')!.checks[0].id);
  assert.equal(evaluateNative44Acceptance(f.contract, f.policy(), missingPresence, { ...f.current, sourceScopes: token }).verdict, 'needs-work');
});

test('one viewport or missing reachable-state evidence remains an unresolved gap', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.proof.baselines.pop(); }, (f: ReturnType<typeof fixture>) => { f.proof.baselines[0].states.pop(); }]) {
    const f = fixture(); change(f); f.refresh(); const token = await verifyNative44SourceScopes(f.contract, f.source, f.read);
    assert.equal(token.outsideSourceKeys.length, 0); assert.equal(token.unresolved.length, 2);
    assert.equal(validateNative44Requirements(f.contract, { source: f.source, sourceUnits: f.units, sourceScopes: token }).coverage.ready, false);
  }
});

test('reachable controls cannot be relabelled outside desktop and source-scope proof hashes are verified', async () => {
  const f = fixture(), state = f.proof.baselines[0].states[0], raw = JSON.parse(Buffer.from(await f.read(state.packet)).toString('utf8')) as ObservationPacketV2;
  raw.nodes.mobile.visible = true; raw.styles.hidden.display = 'block'; raw.layouts.mobile.rect.width = 100; raw.layouts.mobile.rect.height = 30;
  state.packet = f.store('revealed', raw); f.refresh();
  assert.equal((await verifyNative44SourceScopes(f.contract, f.source, f.read)).outsideSourceKeys.length, 0);
  const corrupt = fixture(); corrupt.files.set(corrupt.contract.sourceScopes![0].evidence.path, Buffer.from('{}'));
  await assert.rejects(verifyNative44SourceScopes(corrupt.contract, corrupt.source, corrupt.read), /hash_changed/);
});

test('scope evidence cannot target static content or survive changed requirement identities', async () => {
  const f = fixture(), token = await verifyNative44SourceScopes(f.contract, f.source, f.read);
  f.contract.taskId = 'different-task';
  assert.equal(validateNative44Requirements(f.contract, { source: f.source, sourceUnits: f.units, sourceScopes: token }).coverage.ready, false);
  const staticScope = fixture(); staticScope.contract.sourceScopes![0].sourceKey = staticScope.contract.requirements.find(item => item.dimension === 'presence')!.sourceKey;
  await assert.rejects(verifyNative44SourceScopes(staticScope.contract, staticScope.source, staticScope.read), /not_a_source_behavior/);
});

test('a partial historical region shard cannot hide controllers held in another frozen packet', async () => {
  const f = fixture(), baseline = f.proof.baselines[0], original = JSON.parse(Buffer.from(await f.read(baseline.packet)).toString('utf8')) as ObservationPacketV2;
  const partial = structuredClone(original), remainder = structuredClone(original); delete partial.interactions.trigger; delete remainder.interactions.mobile;
  const partialRef = f.store('partial-region', partial), remainderRef = f.store('remainder-region', remainder), snapshot = f.source.snapshots.find(item => item.id === baseline.snapshotId)!;
  snapshot.evidence = [partialRef, remainderRef];
  for (const fact of Object.values(f.source.facts).filter(item => item.snapshotId === snapshot.id)) fact.evidence = fact.kind === 'interaction' && fact.nodeId === 'trigger' ? remainderRef : partialRef;
  baseline.packet = partialRef; baseline.states = [];
  const sourceRef = f.store('sharded-facts', f.source); f.contract.sourceFacts = sourceRef; f.proof.sourceFacts = sourceRef; f.refresh();
  const token = await verifyNative44SourceScopes(f.contract, f.source, f.read);
  assert.equal(token.outsideSourceKeys.length, 0); assert.equal(token.unresolved.length, 2);
});

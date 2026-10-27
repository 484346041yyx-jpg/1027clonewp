import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { native44BodyCaptureScopeSchema, native44BodyCaptureScopeHash, validateNative44BodyCaptureScope, type Native44BodyCaptureScope } from '../src/native44/capture-scope.js';
import { assertExpandedCaptureEquivalent } from '../src/native44/capture-equivalence.js';
import { native44ObservedGeometryHash, readNative44BodyCaptureScopeEvidence } from '../src/native44/source.js';
import { sha256, validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';

function fixture() {
  const style = { display: 'block', position: 'static', visibility: 'visible', opacity: '1', 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none', 'box-shadow': 'none', 'border-width': '0px', 'border-radius': '0px', transform: 'none', color: 'rgb(0, 0, 0)', 'font-size': '18px' };
  const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: 'desktop', url: 'https://example.com/', title: 'Actual protocol fixture content', capturedAt: '2026-10-24T00:00:00.000Z', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1920, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 1300, screenshot: { path: 'fixture.png', sha256: '1'.repeat(64), width: 1920, height: 1300 } }, nodes: {}, regions: [], texts: {}, styles: {}, layouts: {}, resources: {}, usages: {}, interactions: {}, gaps: [] };
  for (const [index, [id, tag, role, y, height]] of ([['header', 'header', 'header', 0, 100], ['body', 'main', 'region', 100, 1200]] as const).entries()) {
    packet.nodes[id] = { id, parentId: null, regionId: id, tag, selector: `#${id}`, attributes: { id }, childIds: [], styleId: `s-${id}`, layoutId: `l-${id}`, visible: true };
    packet.styles[`s-${id}`] = { ...style };
    const rect = { x: 0, y, width: 1920, height };
    packet.layouts[`l-${id}`] = { id: `l-${id}`, rect, contentRect: { ...rect }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: index };
    packet.regions.push({ id, nodeId: id, contentNodeId: id, role, order: index, gapBefore: 0 });
    packet.texts[id] = { id, nodeId: id, regionId: id, text: id === 'header' ? 'Shared navigation' : 'Complete visible body content', kind: 'body' };
  }
  const scope: Native44BodyCaptureScope = { version: 1, kind: 'native44-reused-header-body-capture-scope', taskId: 'body-scope-fixture', sourceUrl: packet.snapshot.url, requestRef: 'user-current-request', reason: 'The user explicitly reuses the existing read-only header.', reusedHeader: { headerId: 'header_1234', sharedHash: 'a'.repeat(64), headerHash: 'b'.repeat(64), menuHash: 'c'.repeat(64), styleHash: 'd'.repeat(64) }, evidence: [{ path: 'header.json', sha256: 'e'.repeat(64) }], snapshots: [{ snapshotId: 'desktop', bodyRegionIds: ['body'], excludedRegions: [{ regionId: 'header', reason: 'reused-header' }] }] };
  const expanded = structuredClone(packet);
  expanded.snapshot.id = 'expanded'; expanded.snapshot.viewport.height = 1500; expanded.snapshot.pageHeight = 1510;
  expanded.snapshot.screenshot.height = 1500;
  expanded.layouts['l-header'].rect.height = 200; expanded.layouts['l-header'].contentRect.height = 200;
  expanded.styles['s-header']['background-color'] = 'rgb(100, 100, 100)';
  validateObservationPacketV2(packet); validateObservationPacketV2(expanded);
  return { packet, expanded, scope };
}

test('body scope requires an explicit read-only header and complete region partition', () => {
  const { packet, scope } = fixture();
  assert.doesNotThrow(() => validateNative44BodyCaptureScope(scope, [packet], packet.snapshot.url));
  for (const mutate of [
    (s: any) => { s.snapshots[0].bodyRegionIds = []; },
    (s: any) => { s.snapshots[0].bodyRegionIds.push('header'); },
    (s: any) => { s.snapshots[0].excludedRegions.push({ regionId: 'body', reason: 'reused-header' }); s.snapshots[0].bodyRegionIds = ['unknown']; },
    (s: any) => { s.reusedHeader.sharedHash = 'unbound'; },
    (s: any) => { s.sourceUrl = 'https://different.example/'; },
    (s: any) => { s.snapshots[0].snapshotId = 'different'; },
  ]) { const changed = structuredClone(scope); mutate(changed); assert.throws(() => validateNative44BodyCaptureScope(changed, [packet], packet.snapshot.url)); }
  assert.throws(() => native44BodyCaptureScopeSchema.parse({ ...scope, ignoredNodeIds: ['body'] }));
});

test('only bound header rendering is waived; default capture remains whole-page', () => {
  const { packet, expanded, scope } = fixture(), originalBytes = JSON.stringify(packet), expandedBytes = JSON.stringify(expanded);
  assert.throws(() => assertExpandedCaptureEquivalent([packet], [expanded]));
  assert.doesNotThrow(() => assertExpandedCaptureEquivalent([packet], [expanded], { bodyScope: scope }));
  assert.equal(JSON.stringify(packet), originalBytes); assert.equal(JSON.stringify(expanded), expandedBytes);
  for (const mutate of [
    (p: ObservationPacketV2) => { p.layouts['l-body'].rect.x++; },
    (p: ObservationPacketV2) => { p.styles['s-body']['font-size'] = '19px'; },
    (p: ObservationPacketV2) => { p.texts.body.text = 'Changed body content'; },
    (p: ObservationPacketV2) => { p.nodes.body.attributes.id = 'changed-body'; },
    (p: ObservationPacketV2) => { p.resources.photo = { id: 'photo', url: 'https://example.com/a.jpg', kind: 'image' }; p.usages.photo = { id: 'photo', nodeId: 'body', regionId: 'body', resourceId: 'photo', kind: 'img', visible: true }; },
    (p: ObservationPacketV2) => { p.snapshot.viewport.height = 1200; },
  ]) { const changed = structuredClone(expanded); mutate(changed); assert.throws(() => assertExpandedCaptureEquivalent([packet], [changed], { bodyScope: scope })); }
  for (const mutate of [
    (p: ObservationPacketV2) => { p.texts.header.text = 'Changed retained header text'; },
    (p: ObservationPacketV2) => { p.nodes.header.selector = '#unrelated'; },
  ]) { const changed = structuredClone(expanded); mutate(changed); assert.throws(() => assertExpandedCaptureEquivalent([packet], [changed], { bodyScope: scope })); }
});

test('a scope cannot exclude ordinary content as an overlay or silently omit a footer', () => {
  const { packet, scope } = fixture();
  const extra = structuredClone(packet.nodes.body); extra.id = 'extra'; extra.regionId = 'extra'; extra.styleId = 's-extra'; extra.layoutId = 'l-extra'; extra.selector = '#extra';
  packet.nodes.extra = extra; packet.styles['s-extra'] = { ...packet.styles['s-body'] }; packet.layouts['l-extra'] = { ...structuredClone(packet.layouts['l-body']), id: 'l-extra' }; packet.regions.push({ id: 'extra', nodeId: 'extra', contentNodeId: 'extra', role: 'footer', order: 2, gapBefore: 0 });
  assert.throws(() => validateNative44BodyCaptureScope(scope, [packet]), /region_partition/);
  scope.snapshots[0].excludedRegions.push({ regionId: 'extra', reason: 'fixed-overlay', requestRef: 'explicit-body-request', reasonDetail: 'The user excludes this independent fixed utility from the body capture.' });
  assert.throws(() => validateNative44BodyCaptureScope(scope, [packet]), /overlay_unproven/);
  packet.layouts['l-extra'].position = 'fixed'; packet.styles['s-extra'].position = 'fixed';
  assert.doesNotThrow(() => validateNative44BodyCaptureScope(scope, [packet]));
  delete scope.snapshots[0].excludedRegions[1].requestRef;
  assert.throws(() => validateNative44BodyCaptureScope(scope, [packet]), /overlay_unproven/);
});

test('body geometry hash ignores only the supplied body region partition and detects body drift', () => {
  const { packet } = fixture(), changed = structuredClone(packet);
  changed.layouts['l-header'].rect.y++;
  assert.notEqual(native44ObservedGeometryHash([packet], 'desktop'), native44ObservedGeometryHash([changed], 'desktop'));
  assert.equal(native44ObservedGeometryHash([packet], 'desktop', ['body']), native44ObservedGeometryHash([changed], 'desktop', ['body']));
  changed.layouts['l-body'].rect.y++;
  assert.notEqual(native44ObservedGeometryHash([packet], 'desktop', ['body']), native44ObservedGeometryHash([changed], 'desktop', ['body']));
});

test('selected-section capture retains unselected source regions and requires an explicit bound request', () => {
  const { packet, scope } = fixture();
  packet.nodes.other = { ...packet.nodes.body, id: 'other', tag: 'div', regionId: 'other', selector: '#other', styleId: 's-other', layoutId: 'l-other' };
  packet.styles['s-other'] = { ...packet.styles['s-body'] };
  packet.layouts['l-other'] = { ...packet.layouts['l-body'], id: 'l-other' };
  packet.regions.push({ id: 'other', nodeId: 'other', contentNodeId: 'other', role: 'region', order: 2, gapBefore: 0 });
  scope.snapshots[0].excludedRegions.push({ regionId: 'other', reason: 'user-unselected-body', requestRef: scope.requestRef, reasonDetail: 'The user selected only the quote section for this new page.' });
  assert.throws(() => validateNative44BodyCaptureScope(scope, [packet]), /selection_unproven/);
  scope.selection = { version: 1, userInstruction: 'Only reproduce the quote section in my screenshot.', evidence: { path: 'selection.json', sha256: 'f'.repeat(64) } };
  assert.doesNotThrow(() => validateNative44BodyCaptureScope(scope, [packet]));
  assert.ok(packet.nodes.other);
  const originalHash = native44BodyCaptureScopeHash(scope), relocated = structuredClone(scope);
  relocated.selection!.evidence.path = 'moved/request.json';
  assert.equal(native44BodyCaptureScopeHash(relocated), originalHash);
  scope.snapshots[0].excludedRegions[0] = { regionId: 'header', reason: 'user-unselected-body', requestRef: scope.requestRef, reasonDetail: 'A header must never be relabelled as unselected body content.' };
  assert.throws(() => validateNative44BodyCaptureScope(scope, [packet]), /header_missing/);
});

test('selected-section equivalence keeps original evidence and ignores live states only outside the selected output', () => {
  const { packet, expanded, scope } = fixture();
  for (const p of [packet, expanded]) {
    p.nodes.other = { ...p.nodes.body, id: 'other', tag: 'div', regionId: 'other', selector: '#other', styleId: 's-other', layoutId: 'l-other' };
    p.styles['s-other'] = { ...p.styles['s-body'] };
    p.layouts['l-other'] = { ...structuredClone(p.layouts['l-body']), id: 'l-other' };
    p.regions.push({ id: 'other', nodeId: 'other', contentNodeId: 'other', role: 'region', order: 2, gapBefore: 0 });
    p.texts.other = { id: 'other', nodeId: 'other', regionId: 'other', kind: 'body', text: p === packet ? '45000' : '0' };
  }
  scope.selection = { version: 1, userInstruction: 'Only reproduce the quote section in my screenshot.', evidence: { path: 'request.json', sha256: 'f'.repeat(64) } };
  scope.snapshots[0].excludedRegions.push({ regionId: 'other', reason: 'user-unselected-body', requestRef: scope.requestRef, reasonDetail: 'The unrelated company counter is outside the user-selected output.' });
  const originalBytes = JSON.stringify(packet), expandedBytes = JSON.stringify(expanded);
  assert.doesNotThrow(() => assertExpandedCaptureEquivalent([packet], [expanded], { bodyScope: scope }));
  assert.equal(JSON.stringify(packet), originalBytes); assert.equal(JSON.stringify(expanded), expandedBytes);
  const changed = structuredClone(expanded); changed.texts.body.text = 'Different selected content';
  assert.throws(() => assertExpandedCaptureEquivalent([packet], [changed], { bodyScope: scope }), /changed copy/);
  changed.texts.body.text = packet.texts.body.text; changed.layouts['l-body'].rect.width--;
  assert.throws(() => assertExpandedCaptureEquivalent([packet], [changed], { bodyScope: scope }));
});

test('scope evidence requires actual matching bytes and all five shared resource identities', async () => {
  const { scope } = fixture();
  const parent = path.resolve('D:/cloneWP/tests'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, '.body-capture-scope-'));
  try {
    const file = path.join(directory, 'header.json'), bytes = JSON.stringify({ reusedHeader: scope.reusedHeader });
    await writeFile(file, bytes); scope.evidence[0].sha256 = sha256(bytes);
    const binding = { version: 3 as const, captureScope: scope };
    await assert.doesNotReject(readNative44BodyCaptureScopeEvidence(binding as any, directory));
    const hash = native44BodyCaptureScopeHash(scope), relocated = structuredClone(scope); relocated.evidence[0].path = 'relocated.json';
    assert.equal(hash, native44BodyCaptureScopeHash(relocated));
    scope.reusedHeader.sharedHash = 'f'.repeat(64);
    assert.notEqual(hash, native44BodyCaptureScopeHash(scope));
    await assert.rejects(readNative44BodyCaptureScopeEvidence(binding as any, directory), /header_evidence_mismatch/);
    await writeFile(file, 'changed');
    await assert.rejects(readNative44BodyCaptureScopeEvidence(binding as any, directory), /hash changed/);
    assert.equal((await readFile(file, 'utf8')), 'changed');
  } finally {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    await rm(resolved, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNative44NoninteractiveSourceLayout } from '../src/native44/current-review-source.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { hashV2 } from '../src/replica-v2/journal.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';

function fixture(options: { visibleControl?: boolean; clippedItem?: boolean; hiddenItem?: boolean; omittedController?: boolean } = {}) {
  const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: 'wide', url: 'https://source.example/', title: 'Synthetic native layout fixture', capturedAt: '2026-10-17T00:00:00.000Z', viewport: { name: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1905, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: 1080, screenshot: { path: 'source.png', sha256: 'a'.repeat(64), width: 1920, height: 1080 } }, nodes: {}, regions: [{ id: 'region', nodeId: 'owner', contentNodeId: 'track', role: 'cards', order: 0, gapBefore: 0 }], texts: {}, styles: {}, layouts: {}, resources: {}, usages: {}, interactions: { carousel: { id: 'carousel', nodeId: 'owner', regionId: 'region', kind: 'carousel', status: 'declared', trackNodeId: 'track', itemNodeIds: ['a', 'b'], cloneNodeIds: [], controlNodeIds: ['next'], details: { behaviorVerified: false } } }, gaps: [] };
  for (const [id, tag, parentId, children, x, width] of [['owner', 'section', null, ['track', 'next'], 0, 200], ['track', 'div', 'owner', ['a', 'b'], 0, 200], ['a', 'article', 'track', [], 0, 100], ['b', 'article', 'track', [], options.clippedItem ? 180 : 100, 100], ['next', 'button', 'owner', [], 0, options.visibleControl ? 20 : 0]] as const) {
    const visible = id !== 'next' || !!options.visibleControl;
    packet.nodes[id] = { id, tag, parentId, childIds: [...children], attributes: { 'aria-hidden': id === 'b' && options.hiddenItem ? 'true' : 'false' }, selector: `#${id}`, regionId: 'region', layoutId: `l-${id}`, styleId: `s-${id}`, visible };
    packet.styles[`s-${id}`] = { display: visible ? 'block' : 'none', visibility: 'visible', opacity: '1' };
    packet.layouts[`l-${id}`] = { id: `l-${id}`, rect: { x, y: 0, width, height: visible ? 100 : 0 }, contentRect: { x, y: 0, width, height: visible ? 100 : 0 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: visible ? 'block' : 'none', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: 0 };
  }
  validateObservationPacketV2(packet);
  packet.snapshot.viewport.name = 'desktop';
  const bytes = Buffer.from(JSON.stringify(packet)), reference = { path: 'D:/cloneWP/references/fixture/packet.json', sha256: hashV2(bytes) };
  const source = buildSourceFactsV2({ manifestPath: 'fixture-manifest.json', manifestSha256: 'b'.repeat(64), manifest: { version: 2, kind: 'observation-manifest', sourceUrl: packet.snapshot.url, provenance: { method: 'user-opened-browser', browser: 'chrome', observer: 'cua_repl' }, packets: [], screenshots: [] }, packets: [packet], packetFiles: [{ ...reference, snapshotId: 'wide' }] });
  if (options.omittedController) source.facts['wide:interaction:omitted'] = { id: 'wide:interaction:omitted', snapshotId: 'wide', regionId: 'region', nodeId: 'next', kind: 'interaction', value: { id: 'omitted-control', kind: 'control' }, evidence: reference };
  return { source, read: async () => bytes };
}

test('noninteractive source layout requires hidden real controls and every original item fully visible in its owner', async () => {
  const good = fixture(); await assertNative44NoninteractiveSourceLayout(good.source, 'wide', ['owner'], good.read);
  for (const options of [{ visibleControl: true }, { clippedItem: true }, { hiddenItem: true }, { omittedController: true }]) {
    const bad = fixture(options); await assert.rejects(assertNative44NoninteractiveSourceLayout(bad.source, 'wide', ['owner'], bad.read), /source_is_interactive_or_unproved/);
  }
});

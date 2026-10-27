import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHeaderContentWidthMapped } from '../src/replica-full/header-visual-width.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';

const packet = (width: number, x: number, maxWidth: string): ObservationPacketV2 => ({
  snapshot: { viewport: { width: 1920, height: 1080, clientWidth: 1905, devicePixelRatio: 1 } },
  regions: [{ id: 'header-region', role: 'header', nodeId: 'header' }],
  nodes: { header: { id: 'header', parentId: null, regionId: 'header-region', styleId: 'style', layoutId: 'layout', visible: true } },
  styles: { style: { 'max-width': maxWidth } },
  layouts: { layout: { rect: { x, y: 0, width, height: 120 } } },
} as unknown as ObservationPacketV2);

test('new full replica header width preflight retains a measured centered content bound', () => {
  const source = packet(1600, 152.5, '1600px');
  assert.throws(() => assertHeaderContentWidthMapped([source], ':header .whb-general-header>.container{width:100%;max-width:none;padding:0 18px}'), /content_width_unmapped:1600px/);
  assert.doesNotThrow(() => assertHeaderContentWidthMapped([source], ':header .whb-general-header>.container{width:100%;max-width:1600px;padding:0 24px;margin:auto}'));
  assert.doesNotThrow(() => assertHeaderContentWidthMapped([source], ':header .whb-general-header .whb-flex-row{width:min(1600px,100%);margin:auto}'));
  assert.throws(() => assertHeaderContentWidthMapped([source], ':header .whb-general-header>.container{max-width:1600px}:header .whb-general-header>.container{max-width:none}'), /content_width_unmapped/);
  assert.doesNotThrow(() => assertHeaderContentWidthMapped([packet(1905, 0, 'none')], ':header .whb-general-header>.container{max-width:none}'));
});

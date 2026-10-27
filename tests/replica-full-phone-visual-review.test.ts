import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFullReplicaPhoneVisualReview } from '../src/replica-full/visual-review.js';
import { fullReplicaFingerprint } from '../src/replica-full/contract.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import type { FullReplicaBoundCheckpoint, FullReplicaManifest, FullReplicaReview } from '../src/replica-full/types.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';

const hash = 'a'.repeat(64);
test('v4 phone visual gate uses frozen source node and rejects a one-line heading', async () => {
  const bound: FullReplicaBoundCheckpoint = { pageId: 99, runId: 'run', headerId: 'header', editUrl: '', previewUrl: '', bodyHash: hash, cssHash: hash, documentHash: hash, headerHash: hash, menuHash: hash, styleHash: hash };
  const fingerprint = fullReplicaFingerprint(bound), observedAt = new Date().toISOString();
  const manifest = { version: 4, taskId: 'task', runId: 'run', sourceUrl: 'https://source.example/', responsive: { sections: [{ key: 'why', mode: 'shared', evidence: [{ snapshotId: 'phone-390', nodeId: 'root' }] }] } } as unknown as FullReplicaManifest;
  const review = { decision: 'approved', observedAt } as FullReplicaReview;
  const packet = { snapshot: { id: 'phone-390', viewport: { width: 390, height: 844, clientWidth: 375 } }, nodes: { root: { id: 'root', tag: 'section', attributes: {}, parentId: null, childIds: ['heading'], styleId: 'clear', layoutId: 'r', visible: true }, heading: { id: 'heading', tag: 'h2', attributes: {}, parentId: 'root', childIds: [], styleId: 'title', layoutId: 'h', visible: true } }, styles: { clear: { display: 'block', visibility: 'visible', opacity: '1', 'background-color': 'rgba(0, 0, 0, 0)', 'border-width': '0px', 'border-style': 'none', 'box-shadow': 'none' }, title: { display: 'block', visibility: 'visible', opacity: '1', color: 'rgb(18, 18, 18)', 'font-size': '32px', 'line-height': '41px', 'white-space': 'normal', 'background-color': 'rgba(0, 0, 0, 0)', 'border-width': '0px', 'border-style': 'none', 'box-shadow': 'none' } }, layouts: { r: { rect: { x: 0, y: 1700, width: 375, height: 150 } }, h: { rect: { x: 24, y: 1720, width: 327, height: 82 } } }, texts: { title: { nodeId: 'heading', text: 'Why Shop Wigs.com?' } } } as unknown as ObservationPacketV2;
  const visual = { solidBackground: null, texts: [{ text: 'Why Shop Wigs.com?', color: 'rgb(18, 18, 18)', fontSize: '32px', lineHeight: '41px', x: 24, width: 327, height: 41, lineCount: 1, whiteSpace: 'nowrap' }], progress: [], arrows: [], mediaGeometry: [], paintLayers: [] };
  const report = { version: 2, kind: 'clonewp-full-replica-visual-audit', pageId: 99, fingerprint, width: 390, height: 844, clientWidth: 375, screenshotSha256: hash, observedAt, modules: [{ sectionKey: 'why', targetSelector: `.elementor-99 .${native44ModuleClass('why')}`, visual }] };
  const input = () => ({ manifest, bound, review, width: 390, height: 844, clientWidth: 375, screenshotSha256: hash, reference: { path: 'phone.json', sha256: hash }, reviewDirectory: 'D:/cloneWP', targetHtml: `<div class="elementor-99"><section class="${native44ModuleClass('why')}"></section></div>`, packets: [packet], read: async () => ({ filename: 'D:/cloneWP/phone.json', bytes: Buffer.from(JSON.stringify(report)) }) });
  await assert.rejects(verifyFullReplicaPhoneVisualReview(input()), /rendered lines 2 -> 1/);
  visual.texts[0] = { ...visual.texts[0], height: 82, lineCount: 2, whiteSpace: 'normal' };
  await assert.doesNotReject(verifyFullReplicaPhoneVisualReview(input()));
  report.clientWidth = 390;
  await assert.rejects(verifyFullReplicaPhoneVisualReview(input()), /phone_identity/);
});

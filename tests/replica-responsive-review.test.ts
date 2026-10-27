import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { verifyResponsiveReview } from '../src/replica-responsive/review.js';
import { native44Id } from '../src/native44/adapters.js';
import type { ResponsivePlan } from '../src/replica-responsive/contract.js';

test('unified acceptance binds phone/desktop sections to actual DOM, rejects double presentations and tablet drift', async () => {
  const identity = { taskId: 'responsive-qa', runId: 'qa-run', pageId: 91, fingerprint: 'a'.repeat(64), headerId: 'header_qa', observedAt: new Date().toISOString() };
  const section: any = { key: 'hero', mode: 'duplicate', reason: 'Phone source has a different static order.', settings: [], childOrders: [], css: '', evidence: [{ snapshotId: 'phone-a', nodeId: 'hero' }, { snapshotId: 'phone-b', nodeId: 'hero' }] };
  const plan: ResponsivePlan = { version: 1, tablet: 'desktop', mobileMaxWidth: 768, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }], source: { path: 'source', sha256: identity.fingerprint }, sections: [section] };
  const box = (id: string, visible: boolean) => ({ id, display: visible ? 'flex' : 'none', width: visible ? 100 : 0, height: visible ? 100 : 0 });
  const row = (width: number, height: number) => ({ width, height, clientWidth: width, scrollWidth: width, observedAt: identity.observedAt,
    sections: [{ key: 'hero', desktop: box(native44Id(identity.taskId, 'hero'), width > 768), mobile: box(native44Id(identity.taskId, 'hero_phone'), width <= 768) }],
    header: { id: identity.headerId, desktop: [box('column8', width > 768)], mobile: [box('column_mobile2', width <= 768)] } });
  const html = `<header class="whb-${identity.headerId}"></header><main class="elementor-91"><section data-id="${native44Id(identity.taskId, 'hero')}"></section><section data-id="${native44Id(identity.taskId, 'hero_phone')}"></section></main>`;
  const files = new Map<string, Buffer>();
  const put = (name: string, value: Buffer | object) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); files.set(name, bytes); return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const screenshot = put('tablet.png', await sharp({ create: { width: 900, height: 900, channels: 3, background: '#abc' } }).png().toBuffer());
  const dom = put('tablet-dom.json', { pageId: 91, viewport: { width: 900, height: 900 }, html });
  const views = [[1920, 1080], [1440, 1000], [390, 844], [430, 932]].map(([w, h]) => row(w, h));
  const proof = { version: 1, kind: 'clonewp-responsive-review', ...identity, views, tablet: { ...row(900, 900), screenshot, dom } }; delete (proof as any).headerId; delete (proof as any).observedAt;
  const read = async (r: any) => ({ filename: r.path, bytes: files.get(r.path)! });
  const doms = new Map(views.map(v => [`${v.width}x${v.height}`, html]));
  await verifyResponsiveReview(proof, plan, identity, read, '.', doms);
  const boundaryPlan = { ...plan, mobileMaxWidth: 900 };
  const boundaryProof = structuredClone(proof);
  boundaryProof.tablet = { ...row(901, 900), screenshot: put('tablet-boundary.png', await sharp({ create: { width: 901, height: 900, channels: 3, background: '#abc' } }).png().toBuffer()), dom: put('tablet-boundary-dom.json', { pageId: 91, viewport: { width: 901, height: 900 }, html }) };
  await verifyResponsiveReview(boundaryProof, boundaryPlan, identity, read, '.', doms);
  boundaryProof.tablet.screenshot = put('tablet-overwide.png', await sharp({ create: { width: 902, height: 900, channels: 3, background: '#abc' } }).png().toBuffer());
  await assert.rejects(verifyResponsiveReview(boundaryProof, boundaryPlan, identity, read, '.', doms), /tablet_screenshot/);
  for (const mutate of [
    (p: any) => { p.views[2].scrollWidth += 30; },
    (p: any) => { p.views[2].sections[0].desktop = box(native44Id(identity.taskId, 'hero'), true); },
    (p: any) => { p.tablet.header.mobile[0] = box('column_mobile2', true); },
    (p: any) => { p.views[3].sections = []; },
    (p: any) => { p.views[2].observedAt = '2020-01-01T00:00:00.000Z'; },
  ]) { const changed = structuredClone(proof); mutate(changed); await assert.rejects(verifyResponsiveReview(changed, plan, identity, read, '.', doms)); }
  const missing = new Map(doms); missing.set('390x844', '<main>wrong page</main>');
  await assert.rejects(verifyResponsiveReview(proof, plan, identity, read, '.', missing), /dom_identity/);
});

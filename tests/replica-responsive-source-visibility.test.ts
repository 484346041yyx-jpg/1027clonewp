import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { verifyResponsiveReview } from '../src/replica-responsive/review.js';
import { native44Id } from '../src/native44/adapters.js';
import type { ResponsivePlan } from '../src/replica-responsive/contract.js';

test('v4 shared visibility follows hash-bound source owners across desktop, phone and inherited tablet without changing legacy checks', async () => {
  const fixtureData = await preparationIOFixture();
  try {
    const desktopRefs: Array<{ path: string; sha256: string }> = [];
    for (const packet of fixtureData.packets) { packet.nodes.hero.visible = false; packet.nodes.faq.visible = false; desktopRefs.push(await fixtureData.put(`visibility-${packet.snapshot.id}.json`, packet)); }
    const sourceEvidence = await fixtureData.put('visibility-evidence.json', { version: 1, kind: 'native44-body-source-evidence', taskId: fixtureData.plan.taskId, sourceUrl: fixtureData.plan.sourceUrl, snapshots: fixtureData.packets.map((packet, index) => ({ id: packet.snapshot.id, viewport: packet.snapshot.viewport, packets: [desktopRefs[index]] })) });
    const units = JSON.parse(await readFile(fixtureData.plan.sourceUnits.path, 'utf8')); units.units.forEach((unit: any) => { unit.componentKeys = [unit.ownerNodeId]; });
    const sourceUnits = await fixtureData.put('visibility-units.json', units), viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }], phoneRefs = [];
    for (const viewport of viewports) {
      const packet = structuredClone(fixtureData.packets[0]); packet.snapshot.id = `phone-${viewport.width}`; packet.snapshot.viewport = { ...packet.snapshot.viewport, ...viewport, clientWidth: viewport.width }; packet.snapshot.pageHeight = viewport.height;
      const image = await fixtureData.put(`visibility-phone-${viewport.width}.png`, await sharp({ create: { ...viewport, channels: 3, background: '#abc' } }).png().toBuffer()); packet.snapshot.screenshot = { ...image, ...viewport }; packet.nodes.faq.visible = true;
      phoneRefs.push(await fixtureData.put(`visibility-phone-${viewport.width}.json`, packet));
    }
    const source = await fixtureData.put('visibility-phones.json', { version: 1, kind: 'clonewp-responsive-source', taskId: fixtureData.plan.taskId, sourceUrl: fixtureData.plan.sourceUrl, packets: phoneRefs });
    const plan: ResponsivePlan = { version: 1, tablet: 'desktop', mobileMaxWidth: 768, viewports, source, sections: ['hero', 'faq'].map(key => ({ key, mode: 'shared', reason: 'The same native instance preserves source default visibility.', settings: [], childOrders: [], css: '', evidence: viewports.map(viewport => ({ snapshotId: `phone-${viewport.width}`, nodeId: key })) })) };
    const identity = { version: 4, taskId: fixtureData.plan.taskId, runId: fixtureData.plan.runId, pageId: 91, fingerprint: 'a'.repeat(64), headerId: 'header_qa', observedAt: new Date().toISOString(), sourceUrl: fixtureData.plan.sourceUrl, sourceEvidence, sourcePartition: fixtureData.plan.sourcePartition, body: { sourceUnits } };
    const box = (id: string, visible: boolean) => ({ id, display: visible ? 'flex' : 'none', width: visible ? 100 : 0, height: visible ? 100 : 0 });
    const row = (width: number, height: number) => ({ width, height, clientWidth: width, scrollWidth: width, observedAt: identity.observedAt, sections: ['hero', 'faq'].map(key => ({ key, desktop: box(native44Id(identity.taskId, key), key === 'faq' && width <= 768) })), header: { id: identity.headerId, desktop: [box('desktop', width > 768)], mobile: [box('mobile', width <= 768)] } });
    const html = `<header class="whb-${identity.headerId}"></header><main class="elementor-91">${['hero', 'faq'].map(key => `<section data-id="${native44Id(identity.taskId, key)}"></section>`).join('')}</main>`;
    const views = [[1920, 1080], [1440, 1000], [390, 844], [430, 932]].map(([width, height]) => row(width, height)), doms = new Map(views.map(view => [`${view.width}x${view.height}`, html]));
    const screenshot = await fixtureData.put('visibility-tablet.png', await sharp({ create: { width: 900, height: 900, channels: 3, background: '#abc' } }).png().toBuffer()), dom = await fixtureData.put('visibility-tablet.json', { pageId: 91, viewport: { width: 900, height: 900 }, html });
    const proof = { version: 1, kind: 'clonewp-responsive-review', taskId: identity.taskId, runId: identity.runId, pageId: 91, fingerprint: identity.fingerprint, views, tablet: { ...row(900, 900), screenshot, dom } };
    const read = async (reference: { path: string }) => ({ filename: reference.path, bytes: await readFile(reference.path) });
    await verifyResponsiveReview(proof, plan, identity, read, '.', doms);
    const changed = structuredClone(proof); changed.views[0].sections[0].desktop = box(native44Id(identity.taskId, 'hero'), true);
    await assert.rejects(verifyResponsiveReview(changed, plan, identity, read, '.', doms), /shared_section/);
    changed.views[0] = structuredClone(proof.views[0]); changed.views[2].sections[1].desktop = box(native44Id(identity.taskId, 'faq'), false);
    await assert.rejects(verifyResponsiveReview(changed, plan, identity, read, '.', doms), /shared_section/);
    await assert.rejects(verifyResponsiveReview(proof, plan, { ...identity, version: 3 }, read, '.', doms), /shared_section/);
    await assert.rejects(verifyResponsiveReview(proof, plan, { ...identity, body: { sourceUnits: { ...sourceUnits, sha256: '0'.repeat(64) } } }, read, '.', doms), /source_visibility_hash/);
    const { sourceEvidence: _source, ...missing } = identity;
    await assert.rejects(verifyResponsiveReview(proof, plan, missing, read, '.', doms), /source_visibility_context/);
  } finally { await fixtureData.cleanup(); }
});

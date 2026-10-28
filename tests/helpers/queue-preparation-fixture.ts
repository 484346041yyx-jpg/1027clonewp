import sharp from 'sharp';
import { preparationIOFixture } from './preparation-io-fixture.js';
import { buildSourceFactsV2 } from '../../src/replica-v2/source.js';
import { BODY_FIDELITY_KINDS } from '../../src/replica-preparation/types.js';
import { defaultPreparationExecutionPolicy } from '../../src/replica-preparation/execution-policy.js';

/** Synthetic source packets qualify local queue integrity, never a real page or visual approval. */
export async function queuePreparationFixture() {
  const f = await preparationIOFixture();
  for (const packet of f.packets) packet.styles.style.color = '#123456';
  const refs = await Promise.all(f.packets.map(packet => f.put(`${packet.snapshot.id}-packet.json`, packet)));
  const evidence = await f.put('source-evidence.json', { version: 1, kind: 'native44-body-source-evidence', taskId: f.plan.taskId, sourceUrl: f.plan.sourceUrl, snapshots: f.packets.map((packet, i) => ({ id: packet.snapshot.id, viewport: packet.snapshot.viewport, packets: [refs[i]] })) });
  const facts = buildSourceFactsV2({ manifestPath: evidence.path, manifestSha256: evidence.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: f.plan.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets: f.packets, packetFiles: refs.map((ref, i) => ({ ...ref, snapshotId: f.packets[i].snapshot.id })) });
  f.plan.sourceEvidence = evidence; f.plan.sourceFacts = f.plan.bodyBase.sourceFacts = await f.put('source-facts.json', facts);
  for (const row of [...f.plan.shared.decisions, ...f.plan.shared.compatibility]) row.evidence = [f.plan.sourceFacts];
  f.plan.version = 8; f.plan.bodyBase.visualAuditVersion = 3; f.plan.bodyBase.styleResolutionVersion = 2;
  for (const section of f.plan.sections) {
    section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: 'required', sourceFactIds: section.sourceFactIds, expected: 'Synthetic source ownership is inspected before model work.', evidence: [evidence] }));
    section.visualTargets = facts.snapshots.flatMap(snapshot => {
      const fact = Object.values(facts.facts).find(row => row.snapshotId === snapshot.id && row.nodeId === section.key && row.kind === 'layout')!;
      const evidence = { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 };
      return [{ kind: 'geometry' as const, sourceFactId: fact.id, rect: fact.value.rect as { x: number; y: number; width: number; height: number }, evidence }, { kind: 'paint' as const, sourceFactId: fact.id, property: 'color' as const, value: '#123456', evidence }];
    });
  }
  const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }], phoneRefs = [];
  for (const view of views) {
    const packet = structuredClone(f.packets[0]);
    packet.snapshot.id = 'phone-' + view.width;
    packet.snapshot.viewport = { name: 'mobile', ...view, clientWidth: view.width, scrollbarWidth: 0, devicePixelRatio: 1 };
    packet.snapshot.pageHeight = view.height;
    packet.snapshot.screenshot = { ...await f.put(`phone-${view.width}.png`, await sharp({ create: { ...view, channels: 3, background: '#abc' } }).png().toBuffer()), ...view };
    packet.interactions.scroll = { id: 'scroll', nodeId: 'header', regionId: 'header', kind: 'navigation', status: 'observed', details: { scrollPolicy: 'fixed', offset: 0, headerFlow: 'reserve-space', contentTop: 100, downScrollY: 1200, upScrollY: 900, topY: 0, downY: 0, upY: 0, menuOpenY: 0 } };
    phoneRefs.push(await f.put(`phone-${view.width}.json`, packet));
  }
  f.plan.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: await f.put('phones.json', { version: 1, kind: 'clonewp-responsive-source', taskId: f.plan.taskId, sourceUrl: f.plan.sourceUrl, packets: phoneRefs }), decisions: { version: 1, layouts: [], carousels: [], header: { implementation: 'scoped-css', flow: 'reserve-space', views: views.map(view => ({ ...view, snapshotId: 'phone-' + view.width, nodeId: 'header', interactionId: 'scroll', policy: 'fixed', offset: 0 })) } } };
  f.plan.executionPolicy = { ...defaultPreparationExecutionPolicy(f.plan), maxWorkers: 2 };
  return f;
}

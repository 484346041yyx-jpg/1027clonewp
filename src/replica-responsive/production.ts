import path from 'node:path';
import { walkNative44, type Native44Program } from '../native44/types.js';
import { buildSourceFactsV2, type SourceFactsV2 } from '../replica-v2/source.js';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import type { PreparationSection } from '../replica-preparation/types.js';
import { createProductionGuide } from '../replica-preparation/production-guide.js';
import { diagnoseSectionRelationships, diagnosePresentationAssignments } from '../replica-preparation/build-diagnostics.js';
import { mobileComponentKey, prepareResponsiveBody } from './body.js';
import { responsiveFail, type ResponsivePlan, type ResponsiveSource } from './contract.js';

type PacketRef = { path: string; sha256: string; snapshotId: string };

export function projectPhoneProductionFacts(desktop: SourceFactsV2, packets: ObservationPacketV2[], refs: PacketRef[], phones: { packets: ObservationPacketV2[]; packetFiles: PacketRef[] }): SourceFactsV2 {
  if (phones.packets.length !== phones.packetFiles.length || phones.packets.some((packet, index) => packet.snapshot.url !== desktop.sourceUrl || phones.packetFiles[index].snapshotId !== packet.snapshot.id)) responsiveFail('production_snapshot_identity');
  const seen = new Set(desktop.snapshots.map(snapshot => snapshot.id));
  for (const packet of phones.packets) {
    if (seen.has(packet.snapshot.id)) {
      const previous = phones.packets.find(candidate => candidate !== packet && candidate.snapshot.id === packet.snapshot.id);
      if (!previous || JSON.stringify(previous.snapshot) !== JSON.stringify(packet.snapshot)) responsiveFail('production_snapshot_identity');
    }
    seen.add(packet.snapshot.id);
  }
  const normalized = phones.packets.map((packet, index) => ({ ...packet, snapshot: { ...packet.snapshot, screenshot: { ...packet.snapshot.screenshot, path: path.resolve(path.dirname(phones.packetFiles[index].path), packet.snapshot.screenshot.path) } } }));
  const projected = buildSourceFactsV2({
    manifestPath: desktop.observation.path, manifestSha256: desktop.observation.sha256,
    manifest: { version: 2, kind: 'observation-manifest', sourceUrl: desktop.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] },
    packets: [...packets, ...normalized], packetFiles: [...refs, ...phones.packetFiles],
  });
  return { ...projected, gaps: [...desktop.gaps, ...projected.gaps.filter(gap => !desktop.snapshots.some(snapshot => snapshot.id === gap.snapshotId))] };
}

function beneath(source: SourceFactsV2, snapshotId: string, nodeId: string, ownerId: string) {
  const snapshot = source.snapshots.find(item => item.id === snapshotId), seen = new Set<string>();
  let current: string | null = nodeId;
  while (current && !seen.has(current)) {
    if (current === ownerId) return true;
    seen.add(current);
    current = snapshot?.nodes[current]?.parentId ?? null;
  }
  return false;
}

export function verifyPhoneSectionOwners(source: SourceFactsV2, sections: PreparationSection[], policy: ResponsiveSource) {
  const claims: Array<{ sectionKey: string; snapshotId: string; nodeId: string }> = [];
  for (const section of sections) for (const owner of section.phoneSourceOwners ?? []) {
    const snapshot = source.snapshots.find(item => item.id === owner.snapshotId), node = snapshot?.nodes[owner.nodeId];
    if (!snapshot || !node || !policy.viewports.some(view => view.width === snapshot.viewport.width && view.height === snapshot.viewport.height)) responsiveFail('production_section_owner');
    const headerNodes = new Set(Object.values(source.facts).filter(fact => fact.snapshotId === snapshot.id && fact.kind === 'region' && (/^(header|banner|site-header|desktop-header|mobile-header)$/i.test(String(fact.value.role)) || snapshot.nodes[fact.nodeId]?.tag.toLowerCase() === 'header')).map(fact => fact.nodeId));
    const header = [...headerNodes].some(nodeId => beneath(source, snapshot.id, owner.nodeId, nodeId) || beneath(source, snapshot.id, nodeId, owner.nodeId));
    if (header) responsiveFail('production_body_contains_header');
    if (claims.some(claim => claim.snapshotId === owner.snapshotId && (beneath(source, owner.snapshotId, owner.nodeId, claim.nodeId) || beneath(source, owner.snapshotId, claim.nodeId, owner.nodeId)))) responsiveFail('production_section_overlap');
    claims.push({ sectionKey: section.key, ...owner });
  }
  return claims;
}

export function createPhoneProductionGuide(source: SourceFactsV2, sections: PreparationSection[], policy: ResponsiveSource, authored?: { plan: ResponsivePlan; program: Native44Program; css: string }, packets: ObservationPacketV2[] = []) {
  const claims = verifyPhoneSectionOwners(source, sections, policy);
  const snapshots = source.snapshots.filter(snapshot => policy.viewports.some(view => view.width === snapshot.viewport.width && view.height === snapshot.viewport.height));
  const prepared = authored ? prepareResponsiveBody(authored.program, authored.plan, authored.css) : undefined;
  const issues: Array<{ sectionKey: string; snapshotId: string; code: string }> = [];
  const guides = sections.map(section => {
    const declarations = claims.filter(claim => claim.sectionKey === section.key);
    const result = authored?.plan.sections.find(item => item.key === section.key);
    const selected = Object.values(source.facts).filter(fact => declarations.some(owner => owner.snapshotId === fact.snapshotId && beneath(source, fact.snapshotId, fact.nodeId, owner.nodeId)));
    for (const snapshot of snapshots) {
      if (!declarations.some(owner => owner.snapshotId === snapshot.id)) issues.push({ sectionKey: section.key, snapshotId: snapshot.id, code: 'phone-section-owner-unresolved' });
      if (result && declarations.some(owner => owner.snapshotId === snapshot.id)) {
        const expected = declarations.filter(owner => owner.snapshotId === snapshot.id).map(owner => owner.nodeId).sort();
        const actual = result.evidence.filter(owner => owner.snapshotId === snapshot.id).map(owner => owner.nodeId).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) issues.push({ sectionKey: section.key, snapshotId: snapshot.id, code: 'phone-authored-owner-differs' });
      }
    }
    const phoneSource = { ...source, snapshots, facts: Object.fromEntries(selected.map(fact => [fact.id, fact])) };
    const phoneSection = { ...section, sourceFactIds: selected.map(fact => fact.id) };
    const targetKey = result?.mode === 'duplicate' ? mobileComponentKey(section.key) : section.key;
    const root = prepared?.program.blocks.find(block => block.key === targetKey);
    const targets = root ? walkNative44([root]) : [];
    for (const binding of result?.contentBindings ?? []) {
      const key = result!.mode === 'duplicate' ? mobileComponentKey(binding.componentKey) : binding.componentKey;
      const target = targets.find(component => component.key === key);
      if (!target || !declarations.some(owner => owner.snapshotId === binding.snapshotId && beneath(source, owner.snapshotId, binding.nodeId, owner.nodeId))) responsiveFail('production_content_binding_scope');
      const ids = selected.filter(fact => fact.snapshotId === binding.snapshotId && beneath(source, binding.snapshotId, fact.nodeId, binding.nodeId)).map(fact => fact.id);
      target.sourceFactIds = [...new Set([...(target.sourceFactIds ?? []), ...ids])];
    }
    const blocks = root ? [root] : undefined;
    const analysisSection = { ...phoneSection, key: targetKey };
    const guide = createProductionGuide(phoneSource, [analysisSection], blocks);
    const mappedIds = new Set(targets.filter(component => component.kind !== 'composite').flatMap(component => component.sourceFactIds ?? []));
    return {
      ...guide.sections[0], key: section.key, targetRootComponentKey: root?.key ?? null, mode: result?.mode ?? 'undecided', sourceFacts: phoneSource.facts,
      sourceNodeDetails: packets.flatMap(packet => Object.values(packet.nodes).filter(node => declarations.some(owner => owner.snapshotId === packet.snapshot.id && beneath(source, owner.snapshotId, node.id, owner.nodeId))).map(node => ({ snapshotId: packet.snapshot.id, nodeId: node.id, parentNodeId: node.parentId, tag: node.tag, visible: node.visible, geometry: packet.layouts[node.layoutId], paint: packet.styles[node.styleId] }))),
      declaredOwners: declarations, implementation: result ? { settings: result.settings, childOrders: result.childOrders, visibility: result.visibility ?? [], touch: result.touch ?? [], css: result.css } : null,
      contentCoverage: selected.filter(fact => ['text', 'media', 'interaction'].includes(fact.kind)).map(fact => ({ sourceFactId: fact.id, visible: fact.value.visible ?? null, assignment: authored ? mappedIds.has(fact.id) ? 'assigned-not-render-verified' : 'unmapped' : 'awaiting-authoring' })),
      diagnostics: prepared && blocks ? [...diagnoseSectionRelationships(phoneSource, [analysisSection], { ...prepared.program, blocks }, { mobileSnapshotIds: snapshots.map(snapshot => snapshot.id) }), ...diagnosePresentationAssignments(phoneSource, [analysisSection], { ...prepared.program, blocks }, { mobileSnapshotIds: snapshots.map(snapshot => snapshot.id) })] : [],
    };
  });
  const claimed = (snapshotId: string, nodeId: string) => claims.some(owner => owner.snapshotId === snapshotId && beneath(source, snapshotId, nodeId, owner.nodeId));
  return {
    version: 1, kind: 'phone-production-guide', provenance: { desktopObservation: source.observation, phoneSource: policy.source, purpose: 'planning-projection-not-compiler-source-or-visual-proof' },
    instructions: 'Use each actual phone viewport independently, not scaled desktop geometry. Preserve full visible and hidden phone content. Decide principal containers, stacking/order, widths, alignment, gaps, wrapping, image fitting, carousel counts and tap/disclosure states before leaf styling. Bind actual phone source nodes to owned components through contentBindings. Use registered _mobile fields and existing touch treatments; no new components, no global breakpoints, no desktop hover assumed on touch. Inspect representative actual frontend output during authoring and confirm both phone widths later. Unresolved ownership or unmapped content remains advisory unfinished work, never completion.',
    issues, sections: guides,
    snapshots: snapshots.map(snapshot => ({ snapshotId: snapshot.id, viewport: snapshot.viewport, screenshot: snapshot.screenshot,
      availableRegions: Object.values(source.facts).filter(fact => fact.snapshotId === snapshot.id && fact.kind === 'region').map(fact => ({ nodeId: fact.nodeId, role: fact.value.role, order: fact.value.order })),
      unassignedFactIds: Object.values(source.facts).filter(fact => fact.snapshotId === snapshot.id && !claimed(snapshot.id, fact.nodeId)).map(fact => fact.id),
    })), rendered: 'not-verified',
  };
}

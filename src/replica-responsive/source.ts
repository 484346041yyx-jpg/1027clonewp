import path from 'node:path';
import { z } from 'zod';
import sharp from 'sharp';
import { validateObservationPacketV2 } from '../replica-v2/observation.js';
import { responsiveSourceSchema, responsiveFail as fail, type ResponsiveSource, type ResponsivePlan } from './contract.js';

import { verifyDecisionSources, verifyReadonlyHeaderDecisionEvidence, type ResponsiveDecisionContext } from './decisions.js';

type Ref = { path: string; sha256: string };
type Read = (ref: Ref, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const sourceSchema = z.object({ version: z.literal(1), kind: z.literal('clonewp-responsive-source'), taskId: z.string().min(1), sourceUrl: z.url(), packets: z.array(ref).min(2).max(100) }).strict();
export async function readResponsiveSource(input: ResponsiveSource, identity: { taskId: string; sourceUrl: string } & ResponsiveDecisionContext, read: Read) {
  const policy = responsiveSourceSchema.parse(input), file = await read(policy.source), source = sourceSchema.parse(JSON.parse(file.bytes.toString('utf8')));
  if (policy.decisions) await verifyReadonlyHeaderDecisionEvidence(policy.decisions.header, identity, read);
  if (source.taskId !== identity.taskId || source.sourceUrl !== identity.sourceUrl) fail('source_identity');
  const packets: ReturnType<typeof validateObservationPacketV2>[] = [];
  const packetFiles: Array<Ref & { snapshotId: string }> = [];
  for (const ref of source.packets) {
    const filePacket = await read(ref, path.dirname(file.filename)), packet = validateObservationPacketV2(JSON.parse(filePacket.bytes.toString('utf8')));
    if (packet.snapshot.url !== identity.sourceUrl || !policy.viewports.some(v => v.width === packet.snapshot.viewport.width && v.height === packet.snapshot.viewport.height)) fail('source_viewport');
    const image = await read(packet.snapshot.screenshot, path.dirname(filePacket.filename)), meta = await sharp(image.bytes).metadata();
    if (meta.width !== packet.snapshot.screenshot.width || meta.height !== packet.snapshot.screenshot.height) fail('source_screenshot');
    packets.push(packet);
    packetFiles.push({ path: filePacket.filename, sha256: ref.sha256, snapshotId: packet.snapshot.id });
  }
  if (policy.viewports.some(v => !packets.some(p => p.snapshot.viewport.width === v.width && p.snapshot.viewport.height === v.height))) fail('source_missing_phone_width');
  if (policy.decisions) verifyDecisionSources(policy.decisions, packets, identity);
  return { packets, packetFiles };
}
export async function verifyResponsiveSource(input: ResponsiveSource, identity: { taskId: string; sourceUrl: string } & ResponsiveDecisionContext, read: Read) {
  return (await readResponsiveSource(input, identity, read)).packets;
}
export async function verifyResponsiveSections(plan: ResponsivePlan, identity: { taskId: string; sourceUrl: string } & ResponsiveDecisionContext, read: Read, retain?: (source: Awaited<ReturnType<typeof readResponsiveSource>>) => void) {
  const { sections: _, ...policy } = plan, source = await readResponsiveSource(policy, identity, read), packets = source.packets;
  retain?.(source);
  for (const section of plan.sections) {
    for (const view of plan.viewports) {
      const evidence = section.evidence.filter(e => packets.some(p => p.snapshot.id === e.snapshotId && p.snapshot.viewport.width === view.width && p.snapshot.viewport.height === view.height && p.nodes[e.nodeId]));
      if (!evidence.length) fail('section_source_missing');
    }
    for (const e of section.evidence) {
      const packet = packets.find(p => p.snapshot.id === e.snapshotId && p.nodes[e.nodeId]); if (!packet) fail('section_source_owner');
      if (section.mode === 'desktop-only' && packet.nodes[e.nodeId].visible) fail('source_does_not_hide_section');
      if (section.mode === 'phone-only' && !packet.nodes[e.nodeId].visible) fail('source_does_not_show_phone_section');
      let node = packet.nodes[e.nodeId]; const seen = new Set<string>();
      while (node) {
        if (seen.has(node.id)) fail('source_parent_cycle'); seen.add(node.id);
        if (node.tag.toLowerCase() === 'header' || node.attributes.role === 'banner') fail('body_source_contains_header');
        if (!node.parentId) break; node = packet.nodes[node.parentId];
      }
    }
    for (const treatment of section.touch ?? []) for (const view of plan.viewports) {
      const matches = treatment.sourceOwners.filter(owner => packets.some(packet => packet.snapshot.id === owner.snapshotId && packet.snapshot.viewport.width === view.width && packet.snapshot.viewport.height === view.height && packet.nodes[owner.nodeId]));
      if (matches.length !== 1) fail('touch_source_phone_owner');
      const selected = matches[0], packet = packets.find(item => item.snapshot.id === selected.snapshotId && item.nodes[selected.nodeId]);
      if (!packet) fail('touch_source_phone_owner');
      const sectionOwners = new Set(section.evidence.filter(item => item.snapshotId === selected.snapshotId).map(item => item.nodeId));
      let node = packet.nodes[selected.nodeId]; const seen = new Set<string>(); let contained = false;
      while (node) {
        if (sectionOwners.has(node.id)) { contained = true; break; }
        if (seen.has(node.id)) fail('touch_source_parent_cycle');
        seen.add(node.id);
        if (!node.parentId) break;
        node = packet.nodes[node.parentId];
      }
      if (!contained) fail('touch_source_section_owner');
    }
    for (const binding of section.contentBindings ?? []) {
      const packet = packets.find(item => item.snapshot.id === binding.snapshotId && item.nodes[binding.nodeId]);
      if (!packet) fail('production_content_binding_scope');
      const owners = new Set(section.evidence.filter(item => item.snapshotId === binding.snapshotId).map(item => item.nodeId));
      const visited = new Set<string>();
      let current: string | null = binding.nodeId;
      while (current && !visited.has(current) && !owners.has(current)) {
        visited.add(current);
        current = packet.nodes[current]?.parentId ?? null;
      }
      if (!current || !owners.has(current)) fail('production_content_binding_scope');
    }
  }
  return packets;
}

import { validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { Native44CurrentRef } from './current-state.js';

/** A state-index difference is minor only when the frozen raw observation
 * itself proves that all real items fit and every carousel control is hidden.
 * Missing control declarations in a target manifest are not such evidence. */
export async function assertNative44NoninteractiveSourceLayout(source: SourceFactsV2, snapshotId: string, ownerNodeIds: string[], read: (reference: Native44CurrentRef) => Promise<Uint8Array>): Promise<void> {
  const fail = (): never => { throw Error('native44_current_capture_review_source_is_interactive_or_unproved'); };
  const snapshot = source.snapshots.find(snapshot => snapshot.id === snapshotId); if (!snapshot || !ownerNodeIds.length || ownerNodeIds.some(id => !snapshot.nodes[id])) return fail();
  const underneath = (id: string) => { const seen = new Set<string>(); let nodeId: string | null = id; while (nodeId && !seen.has(nodeId)) { if (ownerNodeIds.includes(nodeId)) return true; seen.add(nodeId); nodeId = snapshot.nodes[nodeId]?.parentId ?? null; } return false; };
  const facts = Object.values(source.facts).filter(fact => fact.snapshotId === snapshotId && underneath(fact.nodeId) && fact.kind === 'interaction'), carousels = facts.filter(fact => fact.value.kind === 'carousel');
  if (!carousels.length) return fail();
  const packets = new Map<string, ObservationPacketV2>();
  const visible = (packet: ObservationPacketV2, id: string) => {
    const node = packet.nodes[id], rect = node && packet.layouts[node.layoutId]?.rect; if (!node || !rect || rect.width <= 0 || rect.height <= 0) return false;
    const seen = new Set<string>(); let current: typeof node | undefined = node;
    while (current && !seen.has(current.id)) { seen.add(current.id); const style = packet.styles[current.styleId]; if (!current.visible || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false; current = current.parentId ? packet.nodes[current.parentId] : undefined; }
    return true;
  };
  for (const fact of carousels) {
    const key = `${fact.evidence.path}:${fact.evidence.sha256}`;
    let packet = packets.get(key); if (!packet) { packet = validateObservationPacketV2(JSON.parse(Buffer.from(await read(fact.evidence)).toString('utf8'))); packets.set(key, packet); }
    if (packet.snapshot.id !== snapshot.id || packet.snapshot.url !== source.sourceUrl || packet.snapshot.viewport.width !== snapshot.viewport.width || packet.snapshot.viewport.height !== snapshot.viewport.height) return fail();
    const carousel = Object.values(packet.interactions).find(item => item.id === fact.value.id && item.nodeId === fact.nodeId && item.kind === 'carousel');
    if (!carousel?.itemNodeIds?.length || !carousel.controlNodeIds?.length || !ownerNodeIds.every(id => packet!.nodes[id])) return fail();
    // Partial historical shards cannot establish that another shard lacks a
    // visible controller. Preserve the unresolved runtime difference instead.
    if (facts.some(other => !Object.values(packet!.interactions).some(item => item.id === other.value.id && item.nodeId === other.nodeId))) return fail();
    const controls = new Set([...carousel.controlNodeIds, ...Object.values(packet.nodes).filter(node => underneath(node.id) && /^(?:button|input|select|textarea|form)$/i.test(node.tag)).map(node => node.id)]);
    if ([...controls].some(id => !packet!.nodes[id] || visible(packet!, id))) return fail();
    const owners = ownerNodeIds.map(id => packet!.layouts[packet!.nodes[id].layoutId]?.rect);
    for (const id of carousel.itemNodeIds) {
      const node = packet.nodes[id], rect = node && packet.layouts[node.layoutId]?.rect;
      if (!node || !rect || !visible(packet, id) || node.attributes['aria-hidden'] === 'true' || !owners.some(owner => owner && rect.x >= owner.x - 1 && rect.y >= owner.y - 1 && rect.x + rect.width <= owner.x + owner.width + 1 && rect.y + rect.height <= owner.y + owner.height + 1)) return fail();
    }
  }
}

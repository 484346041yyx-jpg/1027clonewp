import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import { bodySelectionSchema, sourceFooterNodes } from '../replica-full/page-scope.js';

const id = z.string().min(1).max(240), hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({ path: z.string().min(1).max(4096), sha256: hash }).strict();
export const native44BodyCaptureScopeSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-reused-header-body-capture-scope'),
  taskId: id, sourceUrl: z.url(), requestRef: z.string().trim().min(1).max(4096), reason: z.string().trim().min(15).max(4096),
  reusedHeader: z.object({ headerId: z.string().regex(/^header_[1-9]\d{0,17}$/), sharedHash: hash, headerHash: hash, menuHash: hash, styleHash: hash }).strict(),
  evidence: z.array(ref).min(1).max(20),
  selection: bodySelectionSchema.optional(),
  snapshots: z.array(z.object({
    snapshotId: id, bodyRegionIds: z.array(id).min(1).max(500),
    excludedRegions: z.array(z.object({ regionId: id, reason: z.enum(['reused-header', 'reused-footer', 'fixed-overlay', 'user-unselected-body']), requestRef: z.string().trim().min(1).max(4096).optional(), reasonDetail: z.string().trim().min(15).max(4096).optional() }).strict()).min(1).max(500),
  }).strict()).min(1).max(8),
}).strict();
export type Native44BodyCaptureScope = z.infer<typeof native44BodyCaptureScopeSchema>;
/** Evidence paths may be relocated during normal source import; the actual
 * bytes remain bound by their hashes. Scope identity does not depend on a path. */
export const native44BodyCaptureScopeHash = (input: Native44BodyCaptureScope) => {
  const scope = native44BodyCaptureScopeSchema.parse(input);
  return createHash('sha256').update(JSON.stringify({ ...scope, ...(scope.selection ? { selection: { ...scope.selection, evidence: { sha256: scope.selection.evidence.sha256 } } } : {}), evidence: scope.evidence.map(reference => ({ sha256: reference.sha256 })) })).digest('hex');
};

const fail = (code: string): never => { throw Error(`native44_body_capture_scope_${code}`); };
const sameURL = (a: string, b: string) => { const left = new URL(a), right = new URL(b); left.hash = ''; right.hash = ''; return left.href === right.href; };
const headerRegion = (packet: ObservationPacketV2, region: ObservationPacketV2['regions'][number]) => {
  const node = packet.nodes[region.nodeId];
  return /^(?:header|banner|site-header|main-header)$/i.test(region.role.trim()) && (
    /(?:^|[-_])(?:header|banner|nav)(?:$|[-_])/i.test(region.id) || node.tag === 'header' || node.attributes.role === 'banner' || /(?:^|[-_])(?:header|banner)(?:$|[-_])/i.test(node.attributes.class ?? '')
  );
};

/** Scope is an explicit opt-in for one read-only reused header. It partitions
 * whole observed regions, never arbitrary nodes, and cannot omit flow content.
 * The caller additionally verifies the bound resource evidence bytes. */
export function native44BodyCaptureScopeForSnapshot(input: Native44BodyCaptureScope, packets: ObservationPacketV2[], snapshotId: string) {
  const scope = native44BodyCaptureScopeSchema.parse(input), row = scope.snapshots.find(item => item.snapshotId === snapshotId);
  const selected = packets.filter(packet => packet.snapshot.id === snapshotId);
  if (!row || !selected.length || selected.some(packet => !sameURL(packet.snapshot.url, scope.sourceUrl))) return fail('snapshot_identity');
  const nodes = Object.assign({}, ...selected.map(packet => packet.nodes)) as ObservationPacketV2['nodes'];
  const regions = [...new Map(selected.flatMap(packet => packet.regions).map(region => [region.id, region])).values()];
  const partition = [...row.bodyRegionIds, ...row.excludedRegions.map(item => item.regionId)];
  if (new Set(partition).size !== partition.length || partition.length !== regions.length || regions.some(region => !partition.includes(region.id))) return fail('region_partition');
  if (!row.excludedRegions.some(item => item.reason === 'reused-header')) return fail('header_missing');
  for (const region of regions) {
    const packet = selected.find(packet => packet.regions.some(item => item.id === region.id))!;
    const excluded = row.excludedRegions.find(item => item.regionId === region.id);
    if (!excluded) {
      if (headerRegion(packet, region)) return fail('header_in_body');
      continue;
    }
    if (excluded.reason === 'reused-header') {
      if (!headerRegion(packet, region)) return fail('header_unproven');
    } else if (excluded.reason === 'reused-footer') {
      if (!sourceFooterNodes(packet).has(region.nodeId)) return fail('footer_unproven');
    } else if (excluded.reason === 'user-unselected-body') {
      if (!scope.selection || headerRegion(packet, region) || sourceFooterNodes(packet).has(region.nodeId) || excluded.requestRef !== scope.requestRef || !excluded.reasonDetail) return fail('selection_unproven');
    } else {
      const root = packet.nodes[region.nodeId], layout = packet.layouts[root.layoutId];
      if (headerRegion(packet, region) || layout.position !== 'fixed' || !excluded.requestRef || !excluded.reasonDetail) return fail('overlay_unproven');
    }
  }
  const body = new Set(row.bodyRegionIds);
  return { includedNodeIds: new Set(Object.values(nodes).filter(node => body.has(node.regionId)).map(node => node.id)), excludedNodeIds: new Set(Object.values(nodes).filter(node => !body.has(node.regionId)).map(node => node.id)) };
}

export function validateNative44BodyCaptureScope(input: unknown, packets: ObservationPacketV2[], sourceUrl?: string): Native44BodyCaptureScope {
  const scope = native44BodyCaptureScopeSchema.parse(input);
  const snapshots = [...new Set(packets.map(packet => packet.snapshot.id))];
  if (sourceUrl && !sameURL(scope.sourceUrl, sourceUrl) || new Set(scope.snapshots.map(row => row.snapshotId)).size !== scope.snapshots.length || scope.snapshots.length !== snapshots.length || snapshots.some(id => !scope.snapshots.some(row => row.snapshotId === id))) return fail('identity');
  for (const id of snapshots) native44BodyCaptureScopeForSnapshot(scope, packets, id);
  return scope;
}

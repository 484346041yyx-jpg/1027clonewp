import { z } from 'zod';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';

/** Human commands select a scope, not a separate generation system. */
export function replicaInstructionScope(command:string):'body-only'|'header-only'|'footer-only'|'header-footer' {
  const value=command.trim();
  if(value==='复刻页眉页脚')return 'header-footer';
  if(value==='复刻页眉')return 'header-only';
  if(value==='复刻页脚')return 'footer-only';
  if(value==='复刻网页'||value==='复刻正文')return 'body-only';
  throw Error('replica_page_scope_unknown_instruction');
}

/** Opt-in only: absent on frozen tasks, whose page shell stays unchanged. */
export const pageScopeSchema = z.literal('body-only');
const unit = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/);
export const bodySelectionSchema = z.object({
  version: z.literal(1),
  userInstruction: z.string().trim().min(10).max(4096),
  targetSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/).optional(),
  evidence: z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict();
export const sourcePartitionSchema = z.object({
  allUnits: z.array(unit).min(1).max(10_000),
  headerUnits: z.array(unit).min(1).max(10_000),
  bodyUnits: z.array(unit).min(1).max(10_000),
  footerUnits: z.array(unit).max(10_000).optional(),
  unselectedBodyUnits: z.array(unit).min(1).max(10_000).optional(),
  selection: bodySelectionSchema.optional(),
}).strict();

export function assertBodySelectionRequest(partition: z.infer<typeof sourcePartitionSchema>, request: unknown, identity: { taskId: string; sourceUrl: string }): void {
  if (!partition.selection) return;
  const parsed = z.object({ version: z.literal(1), kind: z.literal('clonewp-body-selection-request'), taskId: z.string(), sourceUrl: z.string(), userInstruction: z.string(), targetSlug: z.string().optional() }).strict().parse(request);
  if (parsed.taskId !== identity.taskId || parsed.sourceUrl !== identity.sourceUrl || parsed.userInstruction !== partition.selection.userInstruction || parsed.targetSlug !== partition.selection.targetSlug) throw Error('replica_page_scope_selection_request_identity');
}

/** Unselected content stays in the complete source inventory, without output mappings. */
export function assertBodySelectionUnits(partition: z.infer<typeof sourcePartitionSchema>, units: Array<{ id: string; snapshotId: string; nodeIds: string[]; componentKeys: string[] }>): void {
  if (!partition.selection) return;
  const excluded = new Set(partition.unselectedBodyUnits), selected = new Set(partition.bodyUnits);
  if (units.length !== partition.allUnits.length || new Set(units.map(u => u.id)).size !== units.length || units.some(u => !partition.allUnits.includes(u.id))) throw Error('replica_page_scope_selection_units');
  const owners = new Map<string, string>();
  for (const unit of units) {
    if (excluded.has(unit.id) && unit.componentKeys.length) throw Error('replica_page_scope_unselected_component');
    for (const id of unit.nodeIds) {
      const key = `${unit.snapshotId}/${id}`;
      if (owners.has(key)) throw Error('replica_page_scope_selection_node_overlap');
      owners.set(key, unit.id);
    }
  }
  for (const snapshot of new Set(units.map(u => u.snapshotId))) if (!units.some(u => u.snapshotId === snapshot && selected.has(u.id))) throw Error('replica_page_scope_selection_snapshot_missing');
}

export function assertPageScope(input: {
  pageScope?: 'body-only'; version: number; headerProvider?: string;
  reusedHeader?: unknown; sourcePartition: z.infer<typeof sourcePartitionSchema>;
}, version: 4 | 8): void {
  const p = input.sourcePartition, footer = p.footerUnits ?? [], unselected = p.unselectedBodyUnits ?? [];
  if (p.selection || p.unselectedBodyUnits) {
    if (!p.selection || !p.unselectedBodyUnits || input.pageScope !== 'body-only' || input.version !== version) throw Error('replica_page_scope_selection_contract');
    bodySelectionSchema.parse(p.selection);
  }
  if (input.pageScope === undefined && p.footerUnits === undefined) return;
  if (input.pageScope !== undefined && (input.version !== version || !input.reusedHeader ||
    version === 4 && input.headerProvider !== 'reused-woodmart-header')) throw Error('replica_page_scope_reuse_required');
  if (p.footerUnits !== undefined && input.pageScope !== 'body-only') throw Error('replica_page_scope_footer_requires_body_only');
  const parts = [...p.headerUnits, ...p.bodyUnits, ...footer, ...unselected];
  if (new Set(p.allUnits).size !== p.allUnits.length || new Set(parts).size !== parts.length ||
    parts.length !== p.allUnits.length || parts.some(id => !p.allUnits.includes(id))) throw Error('replica_page_scope_partition');
}

/** Page footer only; article/card footers remain part of the body. */
export function sourceFooterNodes(packet: ObservationPacketV2): Set<string> {
  const underContent = (id: string) => {
    const seen = new Set<string>(); let cursor = packet.nodes[id]?.parentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor); const node = packet.nodes[cursor]; if (!node) break;
      if (['main', 'article', 'header'].includes(node.tag.toLowerCase()) || ['main', 'banner'].includes(node.attributes.role?.toLowerCase() ?? '')) return true;
      cursor = node.parentId;
    }
    return false;
  };
  const roots = new Set(Object.values(packet.nodes).filter(node => !underContent(node.id) &&
    !['main', 'article', 'header'].includes(node.tag.toLowerCase()) &&
    (node.tag.toLowerCase() === 'footer' || node.attributes.role?.toLowerCase() === 'contentinfo')).map(node => node.id));
  // Explicit observed footer regions also support sites built from divs.
  for (const region of packet.regions) {
    const node = packet.nodes[region.nodeId];
    if (/^(footer|site-footer|contentinfo)$/i.test(region.role.trim()) && node && !underContent(node.id) &&
      !['main', 'article', 'header'].includes(node.tag.toLowerCase()) &&
      /(?:^|[\s_-])(?:footer|contentinfo)(?:$|[\s_-])/i.test(`${region.id} ${node.attributes.class ?? ''} ${node.attributes.id ?? ''}`)) roots.add(node.id);
  }
  const result = new Set<string>();
  for (const node of Object.values(packet.nodes)) {
    const seen = new Set<string>(); let cursor: string | null = node.id;
    while (cursor && !seen.has(cursor)) { if (roots.has(cursor)) { result.add(node.id); break; } seen.add(cursor); cursor = packet.nodes[cursor]?.parentId ?? null; }
  }
  return result;
}

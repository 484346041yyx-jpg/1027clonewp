import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict();
export const SceneInventoryV2Schema = z.object({
  version: z.literal(2), kind: z.literal('scene-inventory'), snapshotId: z.string().min(1), sourceUrl: z.url(), capturedAt: z.iso.datetime(),
  viewport: z.object({ name: z.string().min(1), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict(),
  regions: z.array(z.object({ id: z.string().min(1), selector: z.string().min(1) }).strict()),
  content: z.object({ entries: z.array(z.object({ selector: z.string(), ownerRegionId: z.string().nullable(), kind: z.enum(['text', 'link', 'media', 'decoration', 'control']), text: z.string().optional(), href: z.string().optional(), resource: z.string().optional(), paint: z.record(z.string(), z.string()).optional(), visible: z.boolean() }).strict()), gaps: z.array(z.object({ selector: z.string(), code: z.string(), message: z.string() }).strict()) }).strict().optional(),
  entries: z.record(z.string(), z.object({ id: z.string().min(1), selector: z.string().min(1), ownerRegionId: z.string().min(1).nullable(), kind: z.enum(['text', 'media', 'control']), label: z.string().optional(), utility: z.object({ kind: z.literal('source-vendor'), marker: z.string().min(1) }).strict().optional(), rect }).strict()),
  counts: z.object({ total: z.number().int().nonnegative(), text: z.number().int().nonnegative(), media: z.number().int().nonnegative(), control: z.number().int().nonnegative(), assigned: z.number().int().nonnegative(), unassigned: z.number().int().nonnegative(), vendorUtilities: z.number().int().nonnegative() }).strict(),
}).strict();
export type SceneInventoryV2 = z.infer<typeof SceneInventoryV2Schema>;
export interface SceneInventoryRefV2 { path: string; sha256: string; snapshotId: string }
export const SceneInventoryRefV2Schema = z.object({ path: z.string().min(1), sha256: hash, snapshotId: z.string().min(1) }).strict();
export function validateSceneInventoryV2(value: unknown): SceneInventoryV2 {
  const result = SceneInventoryV2Schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid SceneInventoryV2: ${result.error.message}`);
  const inventory = result.data, regions = new Set(inventory.regions.map(region => region.id));
  if (regions.size !== inventory.regions.length) throw new Error('Scene inventory contains duplicate region identities');
  const entries = Object.values(inventory.entries), counted = { total: entries.length, text: entries.filter(entry => entry.kind === 'text').length, media: entries.filter(entry => entry.kind === 'media').length, control: entries.filter(entry => entry.kind === 'control').length, assigned: entries.filter(entry => entry.ownerRegionId !== null).length, unassigned: entries.filter(entry => entry.ownerRegionId === null && !entry.utility).length, vendorUtilities: entries.filter(entry => entry.utility).length };
  for (const [key, count] of Object.entries(counted)) if (inventory.counts[key as keyof typeof counted] !== count) throw new Error(`Scene inventory count mismatch: ${key}`);
  for (const [id, entry] of Object.entries(inventory.entries)) {
    if (id !== entry.id || entry.selector.includes('[MaxDepth]')) throw new Error(`Scene inventory entry identity is invalid: ${id}`);
    if (entry.ownerRegionId && !regions.has(entry.ownerRegionId)) throw new Error(`Scene inventory entry has an unknown region owner: ${id}`);
    if (entry.ownerRegionId && entry.utility) throw new Error(`Scene inventory entry cannot be both region-owned and an external utility: ${id}`);
    if (entry.utility) {
      const marker = entry.utility.marker;
      const knownFeedbackOrChat = /feedback|chat|messenger|intercom|zendesk|liveperson|salesforce|genesys|olark|tawk|drift|gorgias|tidio/i.test(marker);
      const knownLoyaltyProvider = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*smile\.io(?::[0-9]+)?(?:\/|$)/i.test(marker);
      if (!knownFeedbackOrChat && !knownLoyaltyProvider) throw new Error(`Scene utility must identify a real feedback/chat/loyalty vendor marker: ${id}`);
    }
  }
  return inventory;
}

/** Reconstruct full DOM identities from the independently captured parent tree.
 * A region ID alone never proves that its meaningful node was actually captured. */
export function bindSceneInventoryNodesV2(inventory: SceneInventoryV2, nodes: Record<string, { parentId: string | null; regionId: string; tag: string; selector: string; childIds: string[] }>, regionRoots: Record<string, { nodeId: string; selector: string }>): Record<string, string> {
  const normalize = (selector: string) => selector.replace(/:nth-of-type\(1\)/g, '').replace(/\s*>\s*/g, ' > ').replace(/^html\s*>\s*/, '').trim();
  const cache = new Map<string, string>(), building = new Set<string>(), index = new Map<string, string[]>();
  const fullPath = (id: string): string => {
    if (cache.has(id)) return cache.get(id)!;
    if (building.has(id)) throw new Error('Independent inventory found cyclic source node ancestry'); building.add(id);
    const node = nodes[id]; if (!node) throw new Error('Independent inventory found dangling source node ancestry');
    let result: string;
    if (!node.parentId) { const root = regionRoots[node.regionId]; if (!root || root.nodeId !== id) throw new Error('Independent inventory source node has no actual region root'); result = root.selector; }
    else { const parent = nodes[node.parentId], siblings = parent?.childIds.filter(child => nodes[child]?.tag === node.tag); if (!siblings?.includes(id)) throw new Error('Independent inventory found invalid source sibling ownership'); result = `${fullPath(node.parentId)} > ${node.tag}:nth-of-type(${siblings.indexOf(id) + 1})`; }
    building.delete(id); cache.set(id, result); return result;
  };
  for (const [id, node] of Object.entries(nodes)) {
    for (const selector of new Set([fullPath(id), ...(/^#[A-Za-z][A-Za-z0-9_-]*$/.test(node.selector) ? [node.selector] : [])])) {
      const key = `${node.regionId}\u0000${normalize(selector)}`, list = index.get(key) ?? []; if (!list.includes(id)) list.push(id); index.set(key, list);
    }
  }
  const bound: Record<string, string> = {};
  for (const entry of Object.values(inventory.entries)) {
    if (!entry.ownerRegionId) continue;
    const matches = index.get(`${entry.ownerRegionId}\u0000${normalize(entry.selector)}`) ?? [];
    if (matches.length !== 1) throw new Error(`Independent scene entry is absent or ambiguous in its actual source region: ${entry.id}`);
    bound[entry.id] = matches[0];
  }
  return bound;
}

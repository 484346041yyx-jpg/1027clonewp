import { z } from 'zod';
import type { ElementorElement } from '../wordpress/types.js';

const elementId = z.string().regex(/^[A-Za-z0-9_-]{4,12}$/);
const layoutControl = z.enum([
  'container_type', 'content_width', 'boxed_width', 'width', 'width_mobile',
  'flex_direction', 'flex_direction_mobile', 'flex_justify_content', 'flex_justify_content_mobile',
  'flex_align_items', 'flex_align_items_mobile', 'flex_wrap', 'flex_wrap_mobile',
  'flex_gap', 'flex_gap_mobile', 'padding', 'padding_mobile', 'margin', 'margin_mobile',
  'overflow',
]);
const controls = z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 18 && Object.keys(value).every(key => layoutControl.safeParse(key).success));
const group = z.object({ kind: z.literal('group-siblings'), parentId: elementId.nullable(), memberIds: z.array(elementId).min(2).max(20), groupId: elementId, controls }).strict();
const setting = z.object({ kind: z.literal('set-controls'), elementId, controls }).strict();
export const containerTreePlanSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-container-tree-plan'),
  operations: z.array(z.discriminatedUnion('kind', [group, setting])).min(1).max(80),
}).strict();
export type ContainerTreePlan = z.infer<typeof containerTreePlanSchema>;

function fail(code: string): never { throw Error(`replica_full_container_tree_${code}`); }
function walk(nodes: ElementorElement[], found = new Map<string, ElementorElement>()): Map<string, ElementorElement> {
  for (const node of nodes) {
    if (found.has(node.id)) fail('duplicate_identity');
    found.set(node.id, node);
    walk(node.elements ?? [], found);
  }
  return found;
}
function checkControls(input: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      if (!/^[A-Za-z0-9_ %-]{0,100}$/.test(value)) fail('control_value_invalid');
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const fields = Object.keys(value);
      if (fields.some(field => !['unit', 'size', 'sizes', 'column', 'row', 'isLinked', 'top', 'right', 'bottom', 'left'].includes(field))) fail('control_value_invalid');
      for (const item of Object.values(value)) if (item !== '' && item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean' && (!Array.isArray(item) || item.length)) fail('control_value_invalid');
    } else fail('control_value_invalid');
    if (key === 'container_type' && value !== 'flex' || key === 'content_width' && !['boxed', 'full'].includes(String(value)) || key === 'overflow' && !['', 'hidden', 'auto'].includes(String(value))) fail('control_value_invalid');
  }
}

/** A typed, local layout transformation. Widgets and existing container content are never reconstructed. */
export function applyContainerTreePlan(input: ElementorElement[], raw: unknown): ElementorElement[] {
  const plan = containerTreePlanSchema.parse(raw), elements = structuredClone(input), touched = new Set<string>();
  const all = walk(elements);
  for (const operation of plan.operations) {
    checkControls(operation.controls);
    if (operation.kind === 'set-controls') {
      const node = all.get(operation.elementId);
      if (!node || node.elType !== 'container' || touched.has(operation.elementId)) fail('container_owner_invalid');
      node.settings = { ...node.settings, ...structuredClone(operation.controls) };
      touched.add(operation.elementId);
      continue;
    }
    const parent = operation.parentId === null ? null : all.get(operation.parentId);
    if (operation.parentId !== null && (!parent || parent.elType !== 'container')) fail('group_parent_invalid');
    if (all.has(operation.groupId) || new Set(operation.memberIds).size !== operation.memberIds.length) fail('group_identity_invalid');
    const siblings = parent ? parent.elements : elements, first = siblings.findIndex(node => node.id === operation.memberIds[0]);
    if (first < 0 || operation.memberIds.some((id, index) => siblings[first + index]?.id !== id)) fail('group_members_invalid');
    const members = siblings.splice(first, operation.memberIds.length);
    for (const member of members) if (member.elType === 'container') member.isInner = true;
    const grouped: ElementorElement = { id: operation.groupId, elType: 'container', isInner: parent !== null, settings: structuredClone(operation.controls), elements: members };
    siblings.splice(first, 0, grouped);
    all.set(grouped.id, grouped);
  }
  walk(elements);
  return elements;
}

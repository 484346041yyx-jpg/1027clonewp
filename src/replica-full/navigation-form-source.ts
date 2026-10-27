import { z } from 'zod';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import { walkNative44, type Native44Component } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { BodySourceUnits } from './body-prepare.js';
import type { NavigationFormSpec } from './navigation-form/index.js';
import { canonicalV2 } from '../replica-v2/journal.js';

const text = z.string().min(1).max(2000);
const option = z.object({ label: text, value: z.string().max(2000) }).strict();
const field = z.object({ label: text, name: text, options: z.array(option).min(1).max(100) }).strict();
export const NavigationFormSourceSchema = z.object({ version: z.literal(1), kind: z.literal('clonewp-navigation-form-source'), sourceUrl: z.url(), observedAt: z.string().refine(value => Number.isFinite(Date.parse(value))), forms: z.array(z.object({ snapshotId: text, formSelector: text, formAction: z.url(), method: z.literal('GET'), fields: z.array(field).min(1).max(8), submitLabel: text }).strict()).min(2).max(8) }).strict();
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
function fail(code: string): never { throw Error(`replica_full_navigation_form_source_${code}`); }
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();

/** method/name/value come only from separately hashed real DOM evidence, never inferred from packet gaps. */
export function assertNavigationFormSource(spec: NavigationFormSpec, input: unknown, sourceUrl: string, snapshots: Map<string, ObservationPacketV2>, sourceUnits: BodySourceUnits, components: Native44Component[], sourceFacts: SourceFactsV2): void {
  const evidence = NavigationFormSourceSchema.parse(input);
  if (evidence.sourceUrl !== sourceUrl || evidence.forms.length !== snapshots.size) fail('identity');
  const slot = components.find(node => node.key === spec.slotComponentKey);
  if (!slot || slot.kind !== 'composite' || !slot.children.length || !spec.sourceFactIds.every(id => slot.sourceFactIds?.includes(id))) fail('owned_content_slot_required');
  const hasFormMarkup = (value: unknown): boolean => typeof value === 'string' ? /<\s*form(?:\s|>)/i.test(value) : !!value && typeof value === 'object' && Object.values(value).some(hasFormMarkup);
  if (walkNative44([slot]).some(node => 'widgetType' in node && ['form', 'wd_contact_form_7'].includes(node.widgetType) || hasFormMarkup(node))) fail('slot_contains_form');
  const units = spec.sourceUnitIds.map(id => sourceUnits.units.find(unit => unit.id === id));
  if (units.some(unit => !unit || !unit.componentKeys.includes(spec.slotComponentKey)) || spec.sourceFactIds.some(id => !units.some(unit => unit!.sourceFactIds.includes(id)))) fail('unit_mapping');
  const seen = new Set<string>();
  for (const row of evidence.forms) {
    const packet = snapshots.get(row.snapshotId); if (!packet || seen.has(row.snapshotId)) fail('snapshot'); seen.add(row.snapshotId);
    if (row.formAction !== spec.action || row.method.toLowerCase() !== spec.method || !same(row.fields, spec.fields) || row.submitLabel !== spec.submitLabel) fail('typed_spec_changed');
    const forms = Object.values(packet.nodes).filter(node => node.tag.toLowerCase() === 'form' && node.selector === row.formSelector);
    if (forms.length !== 1 || !units.some(unit => unit!.snapshotId === row.snapshotId && unit!.nodeIds.includes(forms[0].id))) fail('packet_owner');
    const form = forms[0]; let action: string; try { action = new URL(form.attributes.action, sourceUrl).href; } catch { return fail('packet_action'); }
    if (action !== row.formAction) fail('packet_action');
    const within = (id: string): boolean => { let cursor: string | null = id; const visited = new Set<string>(); while (cursor && !visited.has(cursor)) { if (cursor === form.id) return true; visited.add(cursor); cursor = packet.nodes[cursor]?.parentId ?? null; } return false; };
    if (!spec.sourceFactIds.some(id => { const fact = sourceFacts.facts[id]; return fact?.snapshotId === row.snapshotId && within(fact.nodeId); })) fail('form_fact_mapping');
    const labels = Object.values(packet.texts).filter(item => within(item.nodeId)).map(item => normalized(item.text));
    // Packet selectors and visible labels cross-bind the supplemental field values to the observed form.
    for (const item of row.fields) for (const label of [item.label, ...item.options.map(option => option.label)]) if (!labels.some(text => text === normalized(label) || text.includes(normalized(label)))) fail('packet_label');
    if (!labels.some(text => text.includes(normalized(row.submitLabel)))) fail('packet_submit');
    const selects = Object.values(packet.nodes).filter(node => node.tag.toLowerCase() === 'select' && within(node.id));
    if (selects.length !== row.fields.length) fail('packet_fields');
  }
}

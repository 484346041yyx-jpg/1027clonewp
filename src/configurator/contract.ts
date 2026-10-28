import { z } from 'zod';

export const COMPONENT = 'clonewp_bottle_configurator';
export const VERSION = 1;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const label = z.string().trim().min(1).max(160);
const url = z.string().url().refine(v => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; }, 'https_asset_required');
const asset = z.object({ id: z.number().int().positive(), url }).strict();
const rectangle = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100), width: z.number().positive().max(100), height: z.number().positive().max(100) }).strict().refine(v => v.x + v.width <= 100 && v.y + v.height <= 100, 'layer_outside_preview');
const option = z.object({
  id, label, image: asset, preview: asset, position: rectangle,
  attributes: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), label),
  // Explicit compatibility, never infer physical fit from the picture or name.
  fit: z.array(id).min(1).max(100),
}).strict();
const filterGroup = z.object({
  defaultValue: id.optional(),
  choices: z.array(z.object({ value: id, label, matches: z.array(label).min(1).max(100) }).strict()).min(1).max(100),
}).strict();
const filterGroups = z.object({
  bottles: z.record(id, filterGroup).optional(), pumps: z.record(id, filterGroup).optional(), caps: z.record(id, filterGroup).optional(),
}).strict();
export const catalogSchema = z.object({
  version: z.literal(VERSION), title: label,
  bottles: z.array(option).min(1).max(500), pumps: z.array(option).min(1).max(500), caps: z.array(option).min(1).max(500),
  decorations: z.array(z.object({ id, label, image: asset, category: label, finish: label,
    // A sample image is not a bottle coating. Preview only authored overlays.
    overlays: z.array(z.object({ bottleId: id, image: asset }).strict()).max(500),
  }).strict()).max(500),
  fonts: z.array(z.object({ id, label, family: label }).strict()).min(1).max(20),
  // Optional authored choices allow a display label to map to the same underlying inventory.
  // Catalog v1 instances without this field retain attribute-derived All/value controls.
  filterGroups: filterGroups.optional(),
  logoColors: z.array(z.object({ label, value: z.string().regex(/^#[a-fA-F0-9]{6}$/) }).strict()).min(1).max(100).optional(),
  placeholders: z.object({ bottles: z.object({ image: asset, position: rectangle }).strict(), pumps: z.object({ image: asset, position: rectangle }).strict(), caps: z.object({ image: asset, position: rectangle }).strict() }).strict().optional(),
  logoArea: rectangle,
  previewLayout: z.object({ mode: z.literal('natural-stack'), width: z.number().positive().max(1000), minHeight: z.number().positive().max(1000), outerPaddingTop: z.number().min(0).max(1000), bottleOffsetY: z.number().min(-500).max(500), capAndPumpAnchor: z.literal('bottom:100%'), mobile: z.object({ breakpoint: z.number().int().min(320).max(1200), minHeight: z.number().positive().max(1000), outerPaddingTop: z.number().min(0).max(1000), bottleOffsetY: z.number().min(-500).max(500), previewLabel: label }).strict().optional() }).strict().optional(),
  form: z.object({ widgetId: id, summaryField: id, uploadField: id }).strict(),
}).strict().superRefine((c, ctx) => {
  for (const key of ['bottles', 'pumps', 'caps', 'decorations', 'fonts'] as const) {
    const ids = c[key].map(o => o.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [key], message: 'duplicate_option_id' });
  }
  const bottleIds = new Set(c.bottles.map(b => b.id));
  for (const d of c.decorations) {
    if (new Set(d.overlays.map(o => o.bottleId)).size !== d.overlays.length || d.overlays.some(o => !bottleIds.has(o.bottleId))) ctx.addIssue({ code: 'custom', path: ['decorations'], message: 'invalid_decoration_bottle' });
  }
  for (const part of ['bottles', 'pumps', 'caps'] as const) for (const [attribute, group] of Object.entries(c.filterGroups?.[part] ?? {})) {
    const actual = new Set(c[part].map(item => item.attributes[attribute]).filter(Boolean));
    const values = group.choices.map(choice => choice.value);
    if (!actual.size || new Set(values).size !== values.length || group.defaultValue && !values.includes(group.defaultValue) ||
      group.choices.some(choice => choice.matches.some(match => !actual.has(match))))
      ctx.addIssue({ code: 'custom', path: ['filterGroups', part, attribute], message: 'invalid_filter_group' });
  }
});
export type Catalog = z.infer<typeof catalogSchema>;
export type Part = 'bottles' | 'pumps' | 'caps';
export type Option = Catalog[Part][number];
export function filterCatalogOptions(c: Catalog, part: Part, filters: Record<string, string>): Option[] {
  return c[part].filter(item => Object.entries(filters).every(([attribute, value]) => {
    if (!value) return true;
    const group = c.filterGroups?.[part]?.[attribute];
    if (!group) return item.attributes[attribute] === value;
    return !!group.choices.find(choice => choice.value === value)?.matches.includes(item.attributes[attribute]);
  }));
}
export const selectionSchema = z.object({ version: z.literal(VERSION), bottle: id.nullable(), pump: id.nullable(), cap: id.nullable(),
  decoration: id.nullable(), text: z.string().max(160), font: id, color: z.string().regex(/^#[a-fA-F0-9]{6}$/), pantone: z.string().max(80).optional(),
  logo: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100), scale: z.number().min(.1).max(1), rotation: z.number().min(-180).max(180).optional(), mode: z.enum(['image', 'text', 'none']) }).strict(),
}).strict();
export type Selection = z.infer<typeof selectionSchema>;
export function compatible(...parts: Option[]) { return parts.length > 0 && parts[0].fit.some(f => parts.every(p => p.fit.includes(f))); }
export function validateDraftSelection(catalog: Catalog, input: unknown): Selection {
  const s = selectionSchema.parse(input);
  const b = catalog.bottles.find(o => o.id === s.bottle), p = catalog.pumps.find(o => o.id === s.pump), cap = catalog.caps.find(o => o.id === s.cap);
  if (s.bottle && !b || s.pump && !p || s.cap && !cap) throw Error('configurator_unknown_option');
  const selected = [b, p, cap].filter((o): o is Option => !!o);
  if (selected.length && !compatible(...selected)) throw Error('configurator_incompatible_selection');
  if (!catalog.fonts.some(f => f.id === s.font)) throw Error('configurator_unknown_font');
  if (s.decoration && !catalog.decorations.some(d => d.id === s.decoration)) throw Error('configurator_unknown_decoration');
  if (s.logo.mode === 'text' && !s.text.trim()) throw Error('configurator_empty_text');
  return s;
}
export function validateSelection(catalog: Catalog, input: unknown): Selection {
  const s = validateDraftSelection(catalog, input);
  if (!s.bottle || !s.pump || !s.cap) throw Error('configurator_incomplete_selection');
  return s;
}
export function quoteSummary(c: Catalog, input: unknown) {
  const s = validateSelection(c, input);
  return { version: VERSION, bottle: c.bottles.find(o => o.id === s.bottle)!.label, pump: c.pumps.find(o => o.id === s.pump)!.label,
    cap: c.caps.find(o => o.id === s.cap)!.label, decoration: c.decorations.find(o => o.id === s.decoration)?.label ?? 'None',
    text: s.logo.mode === 'text' ? s.text : '', font: c.fonts.find(f => f.id === s.font)!.label, color: s.color, pantone: s.pantone ?? '', logo: s.logo,
    selection: s, notice: 'Non-contractual visual; physical compatibility and decoration must be confirmed.' };
}

import { createHash } from 'node:crypto';
import { catalogSchema, COMPONENT, type Catalog } from './contract.js';
import type { ElementorElement } from '../wordpress/types.js';

const hash = /^[a-f0-9]{64}$/;
const nativeId = /^[a-f0-9]{7}$/;

export interface ConfiguratorRegistration {
  version: 1; widgetType: typeof COMPONENT; targetOrigin: string; packageSha256: string;
  registered: boolean; controlsVerified?: boolean; packageFilesVerified?: boolean;
}
export interface ConfiguratorQualification extends ConfiguratorRegistration {
  saved: boolean; rendered: boolean; nativeEditable: boolean; interactions: boolean; formBound: boolean;
}
/** Registration and file proof permit a first save; live page evidence is assessed afterwards. */
export function assertConfiguratorRegistered(q: ConfiguratorRegistration, origin: string, packageSha256: string) {
  if (q.version !== 1 || q.widgetType !== COMPONENT || q.targetOrigin !== new URL(origin).origin ||
    q.packageSha256 !== packageSha256 || !hash.test(packageSha256) || !q.registered ||
    !q.controlsVerified || !q.packageFilesVerified) throw Error('configurator_extension_not_registered');
}
export function assertConfiguratorQualified(q: ConfiguratorQualification, origin: string, packageSha256: string) {
  assertConfiguratorRegistered(q, origin, packageSha256);
  if (!q.saved || !q.rendered || !q.nativeEditable || !q.interactions || !q.formBound)
    throw Error('configurator_extension_not_qualified');
}

function rowId(namespace: string, identity: string): string {
  return createHash('sha256').update(`${namespace}\u0000${identity}`).digest('hex').slice(0, 7);
}
function assertUniqueRowIds(rows: { _id: string }[]) {
  if (new Set(rows.map(row => row._id)).size !== rows.length) throw Error('configurator_repeater_id_collision');
}
export function widgetSettings(input: Catalog) {
  const c = catalogSchema.parse(input);
  const options = (['bottles', 'pumps', 'caps'] as const).flatMap(part => c[part].map(o => ({
    _id: rowId(`option:${part}`, o.id), option_id: o.id, part, label: o.label,
    image: o.image, preview: o.preview, ...o.position, attributes: JSON.stringify(o.attributes), fit: o.fit.join(','),
  })));
  const decorations = c.decorations.map(d => ({ _id: rowId('decoration', d.id), option_id: d.id,
    label: d.label, image: d.image, category: d.category, finish: d.finish }));
  const overlays = c.decorations.flatMap(d => d.overlays.map(o => ({ _id: rowId(`overlay:${d.id}`, o.bottleId),
    decoration_id: d.id, bottle_id: o.bottleId, image: o.image })));
  const fonts = c.fonts.map(f => ({ _id: rowId('font', f.id), option_id: f.id, label: f.label, family: f.family }));
  const logoColors = (c.logoColors ?? []).map(color => ({ _id: rowId('logo-color', color.value.toLowerCase()), label: color.label, value: color.value }));
  for (const rows of [options, decorations, overlays, fonts, logoColors]) assertUniqueRowIds(rows);
  return { title: c.title, form_widget: c.form.widgetId, summary_field: c.form.summaryField, upload_field: c.form.uploadField,
    options, decorations, overlays, fonts, filter_groups_json: JSON.stringify(c.filterGroups ?? {}), logo_colors: logoColors,
    ...Object.fromEntries(Object.entries(c.placeholders ?? {}).flatMap(([part, value]) => [[`placeholder_${part}`, value.image],
      ...Object.entries(value.position).map(([key, number]) => [`placeholder_${part}_${key}`, number])])),
    ...Object.fromEntries(Object.entries(c.logoArea).map(([key, value]) => [`logo_${key}`, value])),
    ...(c.previewLayout ? { preview_layout_mode: c.previewLayout.mode,
      preview_layout_width: c.previewLayout.width, preview_layout_min_height: c.previewLayout.minHeight,
      preview_layout_padding_top: c.previewLayout.outerPaddingTop, preview_layout_bottle_offset_y: c.previewLayout.bottleOffsetY,
      ...(c.previewLayout.mobile ? { preview_mobile_breakpoint: c.previewLayout.mobile.breakpoint,
        preview_mobile_min_height: c.previewLayout.mobile.minHeight,
        preview_mobile_padding_top: c.previewLayout.mobile.outerPaddingTop,
        preview_mobile_bottle_offset_y: c.previewLayout.mobile.bottleOffsetY,
        preview_mobile_label: c.previewLayout.mobile.previewLabel } : {}) } : {}),
  };
}

export interface ConfiguratorPatch {
  elements: ElementorElement[]; widgetId: string; slotId: string; formWidgetId: string;
  summaryFieldId: string; uploadFieldId: string;
}
/** The ordinary native composite and form are saved first. This typed patch adds exactly two fields and one widget. */
export function compileConfiguratorPatch(input: ElementorElement[], catalog: Catalog, slotId: string, widgetId: string): ConfiguratorPatch {
  const c = catalogSchema.parse(catalog), elements = structuredClone(input);
  const nodes = new Map<string, ElementorElement>();
  const walk = (items: ElementorElement[]) => { for (const node of items) {
    if (nodes.has(node.id)) throw Error('configurator_duplicate_node');
    nodes.set(node.id, node); walk(node.elements);
  } }; walk(elements);
  if (![slotId, widgetId, c.form.widgetId].every(id => nativeId.test(id))) throw Error('configurator_native_identity');
  const slot = nodes.get(slotId), form = nodes.get(c.form.widgetId);
  if (!slot || slot.elType !== 'container' || !slot.elements.length || nodes.has(widgetId) ||
    slot.elements.some(child => !nativeId.test(child.id) || !['container', 'widget'].includes(child.elType) ||
      child.elType === 'widget' && !child.widgetType)) throw Error('configurator_owned_composite_required');
  if ([...nodes.values()].some(node => node.widgetType === COMPONENT)) throw Error('configurator_already_present');
  if (!form || form.elType !== 'widget' || form.widgetType !== 'form') throw Error('configurator_native_form_missing');
  if (c.form.summaryField === c.form.uploadField) throw Error('configurator_field_identity');
  const fields = form.settings.form_fields;
  if (!Array.isArray(fields) || !fields.length || fields.some(f => !f || typeof f !== 'object' || Array.isArray(f)))
    throw Error('configurator_native_form_fields');
  const ids = fields.map((f: Record<string, unknown>) => f.custom_id);
  if (ids.some(id => id === c.form.summaryField || id === c.form.uploadField) || new Set(ids).size !== ids.length)
    throw Error('configurator_native_form_fields');
  const actions = form.settings.submit_actions;
  if (!Array.isArray(actions) || actions.length !== 2 || actions[0] !== 'save-to-database' || actions[1] !== 'email')
    throw Error('configurator_native_form_actions');
  const used = new Set(fields.map((f: Record<string, unknown>) => String(f._id ?? '')));
  const fieldId = (type: string) => {
    const id = rowId('native-form-field', `${c.form.widgetId}:${type}`);
    if (used.has(id)) throw Error('configurator_native_field_id_collision');
    used.add(id); return id;
  };
  const summaryFieldId = fieldId(c.form.summaryField), uploadFieldId = fieldId(c.form.uploadField);
  (fields as Array<Record<string, unknown>>).push(
    { _id: summaryFieldId, custom_id: c.form.summaryField, field_type: 'hidden', field_label: 'Bottle configuration', required: '', width: '100' },
    { _id: uploadFieldId, custom_id: c.form.uploadField, field_type: 'upload', field_label: 'Logo', required: '', width: '100',
      file_types: 'png,jpg,jpeg,webp', file_sizes: 5, allow_multiple_upload: '', attachment_type: 'link' },
  );
  slot.elements.push({ id: widgetId, elType: 'widget', widgetType: COMPONENT, settings: widgetSettings(c), elements: [] });
  return { elements, widgetId, slotId, formWidgetId: c.form.widgetId, summaryFieldId, uploadFieldId };
}

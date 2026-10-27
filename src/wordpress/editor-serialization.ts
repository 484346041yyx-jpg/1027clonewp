import type { ElementorElement, LegacySchema } from './types.js';

/** Source study for the explicit native44 branch; this is not a target runtime receipt. */
export const native44EditorSerializationSource = Object.freeze({
  elementor: '3.35.4', entry: 'elementor/assets/js/editor-modules.js',
  sha256: '642b8a4f4307dffddf4701f7dd6259413068793d83986d57f0140840d8f0ed8e',
  method: 'BaseSettingsModel.removeDataDefaults',
});

const canonical = (value: unknown): string => JSON.stringify(Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))])) : value);

function compileSettings(input: Record<string, unknown>, controls: LegacySchema['controls'], native44 = false): Record<string, unknown> {
  const settings = structuredClone(input);
  for (const [key, control] of Object.entries(controls)) {
    // Repeater identities are structural, never defaults to synthesize or discard.
    if (key === '_id') continue;
    const text = ['text', 'textarea'].includes(control.type), hasDefault = Object.hasOwn(control, 'default');
    if (!Object.hasOwn(settings, key) && hasDefault && text && control.default) settings[key] = structuredClone(control.default);
    if (control.save_default || (text && settings[key])) continue;
    const repeater = ['repeater', 'nested-elements-repeater', ...(native44 ? ['form-fields-repeater', 'fields_map'] : [])].includes(control.type) || native44 && control.is_repeater === true;
    if (repeater && Array.isArray(settings[key]) && control.fields && typeof control.fields === 'object') {
      const fields: LegacySchema['controls'] = {};
      for (const [fieldKey, value] of Object.entries(control.fields)) {
        if (!value || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string') continue;
        const field = value as LegacySchema['controls'][string] & { name?: string };
        const fieldName = typeof field.name === 'string' && field.name ? field.name : !Array.isArray(control.fields) ? fieldKey : undefined;
        if (fieldName) fields[fieldName] = field;
      }
      // BaseSettingsModel.removeDataDefaults recurses through registered repeater fields.
      // It preserves the collection itself, even when it equals the repeater's default.
      settings[key] = (settings[key] as unknown[]).map(row => row && typeof row === 'object' && !Array.isArray(row) ? compileSettings(row as Record<string, unknown>, fields, native44) : row);
      continue;
    }
    if (hasDefault && Object.hasOwn(settings, key) && canonical(settings[key]) === canonical(control.default)) delete settings[key];
  }
  return settings;
}

/**
 * Native editor serialization, proven against Elementor 3.33.2 BaseSettingsModel
 * initialize/removeDataDefaults and ContainerView.onRender. This changes actual
 * render-significant isInner flags before acceptance; browser checks still apply.
 * It never changes identities, order, ownership or nondefault settings.
 */
export function compileEditorElements(elements: ElementorElement[], schemas: Record<string, LegacySchema>, options?: { executionStrategy: 'native44-css-handoff' }): ElementorElement[] {
  const walk = (nodes: ElementorElement[], depth: number): ElementorElement[] => nodes.map(node => {
    const type = node.elType === 'widget' ? node.widgetType : node.elType;
    const controls = type ? schemas[type]?.controls : undefined;
    if (!controls) throw new Error('Native editor compilation requires the actual registered control schema');
    const settings = compileSettings(node.settings, controls, options?.executionStrategy === 'native44-css-handoff');
    return { ...structuredClone(node), settings, ...(node.elType === 'container' && (depth > 0 || node.isInner !== undefined) ? { isInner: depth > 0 } : {}), elements: walk(node.elements ?? [], depth + 1) };
  });
  return walk(elements, 0);
}

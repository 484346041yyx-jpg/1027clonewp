import { validateDraftSelection, type Catalog, type Option, type Part, type Selection } from './contract.js';

export function filterOptions(options: Option[], filters: Record<string, string>) {
  return options.filter(o => Object.entries(filters).every(([key, value]) => !value || o.attributes[key] === value));
}
export function initialSelection(c: Catalog): Selection {
  const pumpFits = new Set(c.pumps.flatMap(o => o.fit)), capFits = new Set(c.caps.flatMap(o => o.fit));
  if (!c.bottles.some(b => b.fit.some(fit => pumpFits.has(fit) && capFits.has(fit)))) throw Error('configurator_no_compatible_combination');
  return { version: 1, bottle: null, pump: null, cap: null, decoration: null,
    text: '', font: c.fonts[0].id, color: '#000000', pantone: '', logo: { x: 50, y: 50, scale: .5, rotation: 0, mode: 'none' } };
}
export function selectPart(c: Catalog, selection: Selection, part: Part, id: string): Selection {
  const next = { ...selection, [{ bottles: 'bottle', pumps: 'pump', caps: 'cap' }[part]]: id };
  // Keep the customer's other choices. An incompatible choice must be disabled or rejected.
  return validateDraftSelection(c, next);
}
export function previewLayers(c: Catalog, selection: Selection) {
  const s = validateDraftSelection(c, selection), b = c.bottles.find(o => o.id === s.bottle);
  const layers: Array<{ id: string; part: Part | 'decorations'; image: Option['image']; position: Option['position']; z: number }> = [];
  const keys = { bottles: 'bottle', pumps: 'pump', caps: 'cap' } as const;
  (['bottles', 'pumps', 'caps'] as const).forEach((part, index) => {
    const option = c[part].find(o => o.id === s[keys[part]]), placeholder = c.placeholders?.[part];
    if (option) layers.push({ id: option.id, part, image: option.preview, position: option.position, z: index });
    else if (placeholder) layers.push({ id: `placeholder-${part}`, part, ...placeholder, z: index });
  });
  const d = c.decorations.find(o => o.id === s.decoration), overlay = d?.overlays.find(o => o.bottleId === b?.id);
  if (overlay && b) layers.push({ id: d!.id, part: 'decorations', image: overlay.image, position: b.position, z: 3 });
  return { layers, decorationPreviewAvailable: !d || !!overlay, logoArea: c.logoArea };
}

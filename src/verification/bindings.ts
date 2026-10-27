import type { ElementBinding, ElementMap } from './types.js';

export function normalizeBindings(input: ElementMap): Array<ElementBinding & { sourceId: string }> {
  const entries = Array.isArray(input)
    ? input
    : Object.entries(input).map(([sourceId, value]) => typeof value === 'string'
      ? { sourceId, targetId: value }
      : { ...value, sourceId });
  const seen = new Set<string>();
  return entries.map(binding => {
    if (!binding.sourceId || seen.has(binding.sourceId)) throw new Error('Element map contains an empty or repeated source ID.');
    if (!binding.targetId && !binding.selector) throw new Error(`Element map has no target for ${binding.sourceId}.`);
    seen.add(binding.sourceId);
    return binding;
  });
}

export function targetSelector(binding: ElementBinding): string {
  if (binding.selector) return binding.selector;
  const id = binding.targetId!;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid Elementor element ID.');
  return `[data-id="${id}"], .elementor-element-${id}, .e-${id}`;
}

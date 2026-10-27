import { parseFragment } from 'parse5';
import type { ComponentPlanV2 } from '../replica-v2/component-plan.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import { assertNative44SelectedContentBindings } from './selection.js';
import { walkNative44, type Native44Component, type Native44Program } from './types.js';
const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
function text(value: string): string {
  if (!/<[a-z][^>]*>/i.test(value)) return normalize(value);
  const parts: string[] = [];
  const visit = (node: any): void => { if (node.nodeName === '#text') parts.push(node.value); node.childNodes?.forEach(visit); };
  visit(parseFragment(value)); return normalize(parts.join(' '));
}
/** A source requirement must occur inside its planned owner, rather than anywhere on the page. */
export function assertNative44SourceBindings(program: Native44Program, plan: ComponentPlanV2, facts?: SourceFactsV2): void {
  if (program.replicationProfile || plan.replicationProfile) {
    if (program.replicationProfile !== 'desktop-browser-v1' || plan.replicationProfile !== 'desktop-browser-v1') throw Error('Program and source binding profiles differ');
    if (!facts) throw Error('Desktop source bindings require their exact source facts');
    assertNative44SelectedContentBindings(program, plan, facts); return;
  }
  const nodes = new Map(walkNative44(program.blocks).map(node => [node.key, node]));
  for (const requirement of plan.requirements) {
    const node = nodes.get(requirement.componentId); if (!node) throw Error(`Missing source requirement owner ${requirement.id}`);
    const values: string[] = [], assets = new Set<string>();
    const inspect = (value: unknown): void => {
      if (typeof value === 'string') values.push(value);
      else if (value && typeof value === 'object') { const object = value as Record<string, unknown>; if (typeof object.$asset === 'string') assets.add(object.$asset); if (typeof object.assetKey === 'string') assets.add(object.assetKey); Object.values(object).forEach(inspect); }
    };
    for (const owned of walkNative44([node])) {
      inspect(owned.settings); if ('widgetSettings' in owned) inspect(owned.widgetSettings);
      if (owned.kind === 'html-static') inspect(owned.slots);
    }
    const expected = requirement.verification.expected;
    if (requirement.disposition === 'preserve' && requirement.verification.kind === 'text') {
      const wording = typeof expected === 'string' ? expected : expected && typeof expected === 'object' && !Array.isArray(expected) ? (expected as {text?: unknown}).text : undefined;
      if (typeof wording !== 'string' || !values.some(value => text(value) === normalize(wording))) throw Error(`Preserved text is absent from its native/HTML content owner: ${requirement.id}`);
    }
    if (requirement.disposition === 'preserve' && requirement.verification.kind === 'media' && expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const key = (expected as {assetKey?: unknown}).assetKey;
      if (typeof key === 'string' && !assets.has(key)) throw Error(`Preserved media is absent from its component owner: ${requirement.id}`);
    }
    if (requirement.disposition === 'external' && !values.includes(String(expected))) throw Error(`External entrance is absent from its actual component owner: ${requirement.id}`);
  }
}

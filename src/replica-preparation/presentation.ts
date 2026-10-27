import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { Native44Component } from '../native44/types.js';
import { relationshipRect } from './section-relationships.js';

export const PRESENTATION_PROPERTIES = {
  typography: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'text-indent', 'text-align', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'text-decoration', 'text-overflow'],
  layout: ['display', 'position', 'top', 'right', 'bottom', 'left', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'justify-content', 'align-items', 'align-self', 'align-content', 'justify-self', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'row-gap', 'column-gap'],
  media: ['object-fit', 'object-position', 'aspect-ratio', 'background-size', 'background-position', 'background-repeat', 'background-clip', 'background-origin'],
  decoration: ['color', 'background-color', 'background-image', 'border-radius', 'box-shadow', 'opacity', 'text-shadow', 'filter', 'outline-width', 'outline-style', 'outline-color', 'outline-offset', ...['top', 'right', 'bottom', 'left'].flatMap(side => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`])],
  pseudoDecorations: ['before', 'after'].flatMap(pseudo => ['content', 'display', 'position', 'visibility', 'transform', 'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-width', 'border-style', 'background-color', 'background-image', 'color', 'font-family', 'font-size', 'opacity'].map(property => `${pseudo}:${property}`)),
  clippingAndScroll: ['overflow', 'overflow-x', 'overflow-y', 'z-index', 'position'],
  motion: ['transform', 'transition-property', 'transition-duration', 'transition-timing-function', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-iteration-count'],
} as const;

type Fact = SourceFactsV2['facts'][string];
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export function sourcePresentation(source: SourceFactsV2, fact: Fact, targets: Native44Component[], layouts?: Map<string, Fact>) {
  const snapshot = source.snapshots.find(item => item.id === fact.snapshotId), node = snapshot?.nodes[fact.nodeId];
  const style = object(fact.value.style), layout = object(fact.kind === 'layout' ? fact.value : fact.value.layout);
  const parentFact = layouts ? layouts.get(`${fact.snapshotId}:${node?.parentId}`) : Object.values(source.facts).find(candidate => candidate.snapshotId === fact.snapshotId && candidate.nodeId === node?.parentId && candidate.kind === 'layout');
  const parentLayout = object(parentFact?.value), rect = relationshipRect(fact.value), parentRect = parentLayout.contentRect ?? relationshipRect(parentLayout);
  const attributes = node?.attributes ?? {}, details = object(fact.value.details);
  const type = String(details.type ?? attributes.role ?? node?.tag ?? '');
  const interaction = fact.kind === 'interaction';
  const states = new Set<string>(interaction ? ['default'] : []);
  if (interaction && (fact.value.kind === 'hover' || ['a', 'button', 'link', 'tab'].includes(type))) { states.add('hover'); states.add('focus'); states.add('pressed'); }
  if (interaction && (type === 'tab' || attributes['aria-selected'] !== undefined)) { states.add('selected'); states.add('previous-selection-restored'); }
  if (interaction && (['select', 'combobox'].includes(type) || attributes['aria-haspopup'])) { states.add('open'); states.add('option-selected'); states.add('closed'); }
  if (interaction && (['summary', 'disclosure', 'accordion'].includes(type) || attributes['aria-expanded'] !== undefined)) { states.add('expanded'); states.add('collapsed'); }
  if (interaction && ['text', 'email', 'tel', 'number', 'search', 'input', 'textarea', 'select', 'combobox'].includes(type)) { states.add('focus'); states.add('filled'); states.add('invalid'); states.add('disabled'); }
  if (interaction && ['checkbox', 'radio', 'switch'].includes(type)) { states.add('checked'); states.add('unchecked'); states.add('focus'); states.add('disabled'); }
  if (interaction && fact.value.kind === 'carousel') { states.add('initial-slide'); states.add('next-slide'); states.add('boundary-slide'); states.add('autoplay-or-paused'); }
  if (interaction && type === 'counter') { states.add('before-trigger'); states.add('animating'); states.add('settled'); }
  const textLayout = object(fact.value.textLayout);
  return {
    sourceFactId: fact.id, snapshotId: fact.snapshotId, sourceNodeId: fact.nodeId,
    properties: Object.fromEntries(Object.entries(PRESENTATION_PROPERTIES).map(([key, properties]) => [key, Object.fromEntries(properties.filter(property => style[property] !== undefined).map(property => [property, style[property]]))])),
    spacing: { padding: layout.padding ?? null, margin: layout.margin ?? null, gap: layout.gap ?? null, parentNodeId: node?.parentId ?? null,
      parentContentOffsets: rect && parentRect ? { top: rect.y - parentRect.y, right: parentRect.x + parentRect.width - rect.x - rect.width, bottom: parentRect.y + parentRect.height - rect.y - rect.height, left: rect.x - parentRect.x } : null,
      ownership: 'Measure parent and child together; assign each effect once to a real container/control, never add all measured margins and offsets again.' },
    text: fact.kind === 'text' ? { content: fact.value.text, lineCount: fact.value.lineCount ?? null, lineMeasurement: textLayout.status ?? 'unavailable', lines: textLayout.lines ?? [], hardBreaks: textLayout.hardBreaks ?? null, fontStatus: textLayout.fontStatus ?? 'unknown', fontVerification: 'loading-status-only-verify-actual-font-resource-separately', scope: textLayout.scope ?? 'unknown', rule: 'Match actual font and usable width before spacing; compare line words, not only line count. Direct-node measurements do not prove complete inline paragraph wrapping. Never invent hard breaks from a screenshot.' } : null,
    statePlan: interaction ? { type, currentAttributes: Object.fromEntries(['aria-expanded', 'aria-selected', 'aria-current', 'aria-disabled', 'aria-haspopup', 'open', 'disabled', 'readonly', 'required', 'placeholder', 'maxlength', 'multiple'].filter(key => attributes[key] !== undefined).map(key => [key, attributes[key]])), statesToInvestigate: [...states], controlledNodeIds: fact.value.itemNodeIds ?? [], controlNodeIds: fact.value.controlNodeIds ?? [],
      behaviorVerified: false, rule: 'These are investigation candidates, not claims the source implements every state. Observe relevant states and dismiss non-applicable ones with reasons. Keep focus, hover and persistent selection distinct; bind changed content, open panel geometry, clipping, dismissal and touch equivalent.' } : null,
    effects: { scrollStates: ['fixed', 'sticky'].includes(style.position) ? ['top', 'scroll-down', 'scroll-up'] : [], internalScroll: ['overflow', 'overflow-x', 'overflow-y'].some(key => /^(auto|scroll)$/.test(style[key] ?? '')), mediaReadiness: fact.kind === 'media' ? 'Verify current resource loaded and actual crop before comparison; hidden lazy panels are not missing media.' : null, stateCombinations: interaction ? 'Check selected+hover/focus and open+focus where applicable; a state candidate is not evidence of a working transition.' : null },
    owners: targets.map(target => ({ componentKey: target.key, responsibility: 'assigned-not-render-verified', nativeSettings: target.kind === 'composite' ? target.settings ?? {} : 'widgetSettings' in target ? target.widgetSettings : {} })),
    workItems: [...(fact.kind === 'text' && fact.value.visible === true && textLayout.status !== 'measured' ? ['text-line-words-unmeasured'] : []), ...(fact.kind === 'text' && textLayout.fontStatus !== 'loaded' ? ['actual-font-needs-confirmation'] : []), ...(interaction ? ['source-state-cycle-needs-observation'] : [])],
  };
}

export interface PresentationBinding { sourceFactId: string; targetFactId: string; sourceState: string; targetState: string; sourceAnchorFactId?: string; targetAnchorFactId?: string }
export interface PresentationFinding { sourceFactId: string; targetFactId?: string; code: string; field: string; expected?: unknown; actual?: unknown }

export function comparePresentationFacts(source: SourceFactsV2, target: SourceFactsV2, sourceFactIds: string[], bindings: PresentationBinding[]) {
  const findings: PresentationFinding[] = [], seen = new Set<string>();
  for (const binding of bindings) {
    if (seen.has(binding.sourceFactId) || !sourceFactIds.includes(binding.sourceFactId)) throw Error('replica_preparation_presentation_binding');
    seen.add(binding.sourceFactId);
    const expected = source.facts[binding.sourceFactId], actual = target.facts[binding.targetFactId];
    if (!expected || !actual || expected.kind !== actual.kind) throw Error('replica_preparation_presentation_fact');
    const sourceView = source.snapshots.find(view => view.id === expected.snapshotId), targetView = target.snapshots.find(view => view.id === actual.snapshotId);
    const push = (code: string, field: string, expectedValue?: unknown, actualValue?: unknown) => findings.push({ sourceFactId: expected.id, targetFactId: actual.id, code, field, ...(expectedValue === undefined ? {} : { expected: expectedValue }), ...(actualValue === undefined ? {} : { actual: actualValue }) });
    if (!sourceView || !targetView || ['width', 'height', 'clientWidth', 'devicePixelRatio'].some(key => sourceView.viewport[key as keyof typeof sourceView.viewport] !== targetView.viewport[key as keyof typeof targetView.viewport]) || !binding.sourceState || binding.sourceState !== binding.targetState) { push('incomparable', 'viewport-or-state'); continue; }
    if (expected.value.visible === false && actual.value.visible === false) continue;
    if (expected.value.visible !== actual.value.visible && expected.kind !== 'layout') push('different', 'visible', expected.value.visible, actual.value.visible);
    if (expected.kind === 'text') {
      if (expected.value.text !== actual.value.text) push('different', 'text', expected.value.text, actual.value.text);
      const before = object(expected.value.textLayout), after = object(actual.value.textLayout);
      if (before.status !== 'measured' || after.status !== 'measured' || before.fontStatus !== 'loaded' || after.fontStatus !== 'loaded') push('unverified', 'line-words-or-font');
      else {
        const words = (value: Record<string, any>) => value.lines.map((line: { text: string }) => line.text);
        if (JSON.stringify(words(before)) !== JSON.stringify(words(after))) push('different', 'line-words', words(before), words(after));
      }
    }
    const beforeLayout = object(expected.kind === 'layout' ? expected.value : expected.value.layout), afterLayout = object(actual.kind === 'layout' ? actual.value : actual.value.layout);
    if (!!binding.sourceAnchorFactId !== !!binding.targetAnchorFactId) throw Error('replica_preparation_presentation_anchor');
    if (binding.sourceAnchorFactId && binding.targetAnchorFactId) {
      const sourceAnchor = source.facts[binding.sourceAnchorFactId], targetAnchor = target.facts[binding.targetAnchorFactId];
      if (!sourceAnchor || !targetAnchor || sourceAnchor.kind !== 'layout' || targetAnchor.kind !== 'layout' || sourceAnchor.snapshotId !== expected.snapshotId || targetAnchor.snapshotId !== actual.snapshotId) throw Error('replica_preparation_presentation_anchor');
      const contains = (nodes: SourceFactsV2['snapshots'][number]['nodes'], nodeId: string, ownerId: string) => {
        const visited = new Set<string>(); let current: string | null = nodeId;
        while (current && !visited.has(current)) { if (current === ownerId) return true; visited.add(current); current = nodes[current]?.parentId ?? null; }
        return false;
      };
      if (!contains(sourceView.nodes, expected.nodeId, sourceAnchor.nodeId) || !contains(targetView.nodes, actual.nodeId, targetAnchor.nodeId)) throw Error('replica_preparation_presentation_anchor');
      const beforeRect = relationshipRect(expected.value), afterRect = relationshipRect(actual.value), beforeAnchor = relationshipRect(sourceAnchor.value), afterAnchor = relationshipRect(targetAnchor.value);
      if (!beforeRect || !afterRect || !beforeAnchor || !afterAnchor) push('unverified', 'logical-owner-offset');
      else for (const axis of ['x', 'y'] as const) if (Math.abs((beforeRect[axis] - beforeAnchor[axis]) - (afterRect[axis] - afterAnchor[axis])) > 4) push('different', `owner-offset-${axis}`, beforeRect[axis] - beforeAnchor[axis], afterRect[axis] - afterAnchor[axis]);
    } else if (relationshipRect(expected.value)) push('unverified', 'logical-owner-offset');
    for (const key of ['padding', 'margin', 'gap']) {
      if (beforeLayout[key] === undefined) continue;
      if (afterLayout[key] === undefined) push('unverified', key);
      else if (JSON.stringify(beforeLayout[key]) !== JSON.stringify(afterLayout[key])) push('different', key, beforeLayout[key], afterLayout[key]);
    }
    for (const key of ['width', 'height'] as const) {
      const before = relationshipRect(expected.value)?.[key], after = relationshipRect(actual.value)?.[key];
      if (before === undefined) continue;
      if (after === undefined) push('unverified', key);
      else if (Math.abs(before - after) > 2) push('different', key, before, after);
    }
    const beforeStyle = object(expected.value.style), afterStyle = object(actual.value.style);
    for (const property of new Set(Object.values(PRESENTATION_PROPERTIES).flat())) {
      if (beforeStyle[property] === undefined) continue;
      if (afterStyle[property] === undefined) push('unverified', property);
      else if (property.endsWith('background-image') && /url\(/i.test(beforeStyle[property]) && beforeStyle[property] !== afterStyle[property]) push('unverified', 'resource-binding');
      else if (beforeStyle[property] !== afterStyle[property]) push('different', property, beforeStyle[property], afterStyle[property]);
    }
    const beforeAttributes = sourceView.nodes[expected.nodeId]?.attributes ?? {}, afterAttributes = targetView.nodes[actual.nodeId]?.attributes ?? {};
    for (const key of ['aria-selected', 'aria-expanded', 'aria-disabled', 'open', 'disabled', 'required', 'placeholder']) if (beforeAttributes[key] !== afterAttributes[key]) push('different', key, beforeAttributes[key] ?? null, afterAttributes[key] ?? null);
  }
  for (const id of sourceFactIds) if (!seen.has(id)) findings.push({ sourceFactId: id, code: 'unverified', field: 'unmapped-target' });
  return { version: 1, kind: 'production-presentation-comparison', findings, compared: seen.size, status: findings.length ? 'open-items' : 'no-measured-differences', evidenceScope: 'observed-snapshots-only', visualVerification: 'requires-human-review', interactionsVerified: false, deliveryComplete: false, remoteWrites: 0 };
}

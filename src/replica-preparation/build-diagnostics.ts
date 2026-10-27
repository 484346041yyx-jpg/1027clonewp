import { native44Children, walkNative44, type Native44Component, type Native44Program } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import { createSectionRelationships } from './section-relationships.js';
import type { PreparationSection } from './types.js';
import { sourcePresentation } from './presentation.js';

export interface PreparationBuildDiagnostic {
  sectionKey: string;
  code: 'horizontal-source-without-native-row' | 'source-form-without-native-form' | 'section-relationship-unmapped' | 'section-arrangement-needs-decision' | 'section-alignment-needs-decision' | 'source-content-substitution' | 'presentation-text-measurement-unavailable' | 'presentation-state-cycle-unverified' | 'presentation-native-spacing-differs';
  componentKey: string;
  sourceFactIds: string[];
  message: string;
  snapshotId?: string;
  sourceNodeId?: string;
}

type Rect = { x: number; y: number; width: number; height: number };
const rectOf = (value: Record<string, unknown>): Rect | undefined => {
  const layout = value.layout as Record<string, unknown> | undefined;
  const rect = (layout?.rect ?? value.rect) as Rect | undefined;
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? rect : undefined;
};
const union = (rects: Rect[]): Rect | undefined => {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
};
const overlap = (startA: number, sizeA: number, startB: number, sizeB: number) => Math.max(0, Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB));

/** Advisory checks before the first remote write; CSS claims never count as rendered proof. */
export function diagnosePreparationBuild(source: SourceFactsV2, program: Native44Program): PreparationBuildDiagnostic[] {
  const desktop = source.snapshots.find(snapshot => snapshot.viewport.name === 'desktop');
  if (!desktop) return [];
  const diagnostics: PreparationBuildDiagnostic[] = [];
  const facts = Object.values(source.facts).filter(fact => fact.snapshotId === desktop.id);
  const descendants = (node: Native44Component): Native44Component[] => [node, ...native44Children(node).flatMap(descendants)];
  const nodeFacts = (node: Native44Component) => [...new Set(descendants(node).flatMap(child => child.sourceFactIds ?? []))];
  const bounds = (node: Native44Component) => union(nodeFacts(node).map(id => source.facts[id]).filter(fact => fact?.snapshotId === desktop.id && (fact.kind === 'text' || fact.kind === 'media')).map(fact => rectOf(fact.value)).filter((rect): rect is Rect => !!rect));
  const insideForm = (nodeId: string) => {
    let current: string | null = nodeId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const node: SourceFactsV2['snapshots'][number]['nodes'][string] | undefined = desktop.nodes[current];
      if (!node) break;
      if (node.tag.toLowerCase() === 'form') return true;
      current = node.parentId;
    }
    return false;
  };
  for (const section of program.blocks) {
    for (const container of descendants(section).filter(node => node.kind === 'composite')) {
      if (container.settings?.flex_direction === 'row' || container.settings?.flex_direction === 'row-reverse' || container.settings?.container_type === 'grid' || container.settings?.display === 'grid') continue;
      const children = native44Children(container).filter(child => child.kind === 'composite').map(child => ({ child, rect: bounds(child) })).filter((entry): entry is { child: Extract<Native44Component, { kind: 'composite' }>; rect: Rect } => !!entry.rect);
      const sideBySide = children.some((first, index) => children.slice(index + 1).some(second =>
        overlap(first.rect.y, first.rect.height, second.rect.y, second.rect.height) >= Math.min(first.rect.height, second.rect.height) * 0.45 &&
        overlap(first.rect.x, first.rect.width, second.rect.x, second.rect.width) <= Math.min(first.rect.width, second.rect.width) * 0.1));
      if (sideBySide) diagnostics.push({ sectionKey: section.key, code: 'horizontal-source-without-native-row', componentKey: container.key, sourceFactIds: nodeFacts(container).filter(id => source.facts[id]?.snapshotId === desktop.id), message: 'Source child groups appear side by side, but the native container has no row direction. Check the Elementor inner container before relying on CSS.' });
    }
    const sourceIds = new Set(nodeFacts(section));
    const controls = facts.filter(fact => sourceIds.has(fact.id) && fact.kind === 'interaction' && ['input', 'select', 'textarea'].includes(desktop.nodes[fact.nodeId]?.tag.toLowerCase() ?? '') && (fact.value.details as Record<string, unknown> | undefined)?.type !== 'hidden' && insideForm(fact.nodeId));
    const hasForm = walkNative44([section]).some(node => node.kind === 'native' && ['form', 'wd_contact_form_7'].includes(node.widgetType));
    if (controls.length && !hasForm) diagnostics.push({ sectionKey: section.key, code: 'source-form-without-native-form', componentKey: section.key, sourceFactIds: controls.map(fact => fact.id), message: 'The source contains editable form controls, but this section has no native form widget. Static text and buttons do not reproduce submission.' });
  }
  return diagnostics;
}

export function diagnoseSectionRelationships(source: SourceFactsV2, sections: PreparationSection[], program: Native44Program, options?: { mobileSnapshotIds: string[] }): PreparationBuildDiagnostic[] {
  const diagnostics: PreparationBuildDiagnostic[] = [];
  for (const section of sections) {
    const relationships = createSectionRelationships(source, section, program.blocks);
    const components = walkNative44(program.blocks.filter(block => block.key === section.key));
    for (const viewport of relationships.viewports) for (const group of viewport.groups) {
      const target = components.find(component => component.key === group.targetContainerKey);
      const context = { sectionKey: section.key, componentKey: target?.key ?? section.key, snapshotId: viewport.snapshotId, sourceNodeId: group.nodeId, sourceFactIds: group.sourceFactIds };
      if (!target) {
        diagnostics.push({ ...context, code: 'section-relationship-unmapped', message: 'A visible source group has no native container covering its actual content mappings. Preserve the group and record a local implementation decision; attaching all facts to an outer wrapper is not proof.' });
        continue;
      }
      const settings = target.settings ?? {};
      const phone = options ? options.mobileSnapshotIds.includes(viewport.snapshotId) : /^(mobile|phone)/.test(viewport.viewport.name);
      const direction = phone ? settings.flex_direction_mobile ?? settings.flex_direction : settings.flex_direction;
      const grid = settings.container_type === 'grid' || settings.display === 'grid';
      if (!grid && (group.arrangement === 'row' && !['row', 'row-reverse'].includes(String(direction)) || group.arrangement === 'column' && ['row', 'row-reverse'].includes(String(direction)))) diagnostics.push({ ...context, code: 'section-arrangement-needs-decision', message: `Source content suggests a ${group.arrangement} group at this width, but its mapped container direction differs or is undeclared. Decide the actual native group before leaf styling; do not blindly copy source DOM wrappers or rely on a late CSS override.` });
      if (group.arrangement !== 'row' || group.crossAxisAlignmentCandidates.length !== 1) continue;
      const expected = { start: 'flex-start', center: 'center', end: 'flex-end' }[group.crossAxisAlignmentCandidates[0]];
      const alignment = phone ? settings.align_items_mobile ?? settings.align_items : settings.align_items;
      if (alignment !== expected) diagnostics.push({ ...context, code: 'section-alignment-needs-decision', message: `Source sibling geometry suggests ${group.crossAxisAlignmentCandidates[0]} cross-axis alignment, while the mapped container does not declare ${expected}. Confirm the actual group, native row/grid layout and state; this is advisory, not an automatic setting or rendered failure.` });
    }
    for (const component of components.filter(component => component.kind === 'native-posts' || component.kind === 'native-products')) diagnostics.push({ sectionKey: section.key, componentKey: component.key, sourceFactIds: component.sourceFactIds ?? [], code: 'source-content-substitution', message: 'A live target query replaces source content. Confirm the explicit task content policy before authoring, preserve the independent source inventory and disclose the substitution; query defaults do not establish source fidelity.' });
  }
  return diagnostics;
}

export function diagnosePresentationAssignments(source: SourceFactsV2, sections: PreparationSection[], program: Native44Program, options?: { mobileSnapshotIds: string[] }): PreparationBuildDiagnostic[] {
  const diagnostics: PreparationBuildDiagnostic[] = [];
  const layouts = new Map(Object.values(source.facts).filter(fact => fact.kind === 'layout').map(fact => [`${fact.snapshotId}:${fact.nodeId}`, fact]));
  for (const section of sections) {
    const components = walkNative44(program.blocks.filter(block => block.key === section.key));
    for (const id of section.sourceFactIds) {
      const fact = source.facts[id]; if (!fact) continue;
      const targets = components.filter(component => component.sourceFactIds?.includes(id) && (fact.kind === 'layout' || component.kind !== 'composite'));
      const presentation = sourcePresentation(source, fact, targets, layouts);
      const base = { sectionKey: section.key, componentKey: targets[0]?.key ?? section.key, snapshotId: fact.snapshotId, sourceNodeId: fact.nodeId, sourceFactIds: [id] };
      if (presentation.workItems.includes('text-line-words-unmeasured')) diagnostics.push({ ...base, code: 'presentation-text-measurement-unavailable', message: 'Line count alone does not establish the same breaking words. Measure actual source lines and font/usable width; retain this local work item without blocking unrelated sections.' });
      if (presentation.statePlan) diagnostics.push({ ...base, code: 'presentation-state-cycle-unverified', message: 'Investigate the applicable source state cycle and changed content before native active/hover/open styling; assigned settings and a static snapshot do not prove the behavior.' });
      if (fact.kind !== 'layout') continue;
      const phone = options?.mobileSnapshotIds.includes(fact.snapshotId) ?? /^(mobile|phone)/.test(source.snapshots.find(snapshot => snapshot.id === fact.snapshotId)?.viewport.name ?? '');
      for (const target of targets) for (const property of ['padding', 'margin'] as const) {
        const settings = target.kind === 'composite' ? target.settings ?? {} : 'widgetSettings' in target ? target.widgetSettings : {};
        const key = `${target.kind === 'composite' ? '' : '_'}${property}`;
        const value = (phone ? settings[`${key}_mobile`] ?? settings[key] : settings[key]) as { unit?: string; top?: string; right?: string; bottom?: string; left?: string } | undefined;
        const expected = presentation.spacing[property] as number[] | null;
        if (!value || value.unit !== 'px' || !expected || !['top', 'right', 'bottom', 'left'].every(side => value[side as keyof typeof value] !== '' && Number.isFinite(Number(value[side as keyof typeof value])))) continue;
        if (['top', 'right', 'bottom', 'left'].some((side, index) => Math.abs(Number(value[side as keyof typeof value]) - expected[index]) > 4)) diagnostics.push({ ...base, componentKey: target.key, code: 'presentation-native-spacing-differs', message: `Declared native ${key}${phone ? '_mobile' : ''} differs from source ${property}. Check the logical owner and intentional structural adaptation; do not compensate by blindly adding parent offsets or a second CSS spacing rule.` });
      }
    }
  }
  return diagnostics;
}

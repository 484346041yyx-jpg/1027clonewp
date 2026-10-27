import { native44Children, type Native44Component } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { PreparationSection } from './types.js';

export type RelationshipRect = { x: number; y: number; width: number; height: number };
type Snapshot = SourceFactsV2['snapshots'][number];
type Fact = SourceFactsV2['facts'][string];

export function relationshipRect(value: Record<string, unknown>): RelationshipRect | undefined {
  const layout = value.layout as Record<string, unknown> | undefined;
  const rect = (layout?.rect ?? value.rect) as RelationshipRect | undefined;
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? rect : undefined;
}

function bounds(rects: RelationshipRect[]): RelationshipRect | undefined {
  if (!rects.length) return undefined;
  const left = Math.min(...rects.map(rect => rect.x)), top = Math.min(...rects.map(rect => rect.y));
  return { x: left, y: top, width: Math.max(...rects.map(rect => rect.x + rect.width)) - left, height: Math.max(...rects.map(rect => rect.y + rect.height)) - top };
}

export function measureRelationships(rects: RelationshipRect[]) {
  const overlap = (start: number, size: number, otherStart: number, otherSize: number) => Math.max(0, Math.min(start + size, otherStart + otherSize) - Math.max(start, otherStart));
  const pairs = rects.flatMap((first, index) => rects.slice(index + 1).map(second => ({ first, second })));
  const row = pairs.length > 0 && pairs.every(({ first, second }) => overlap(first.x, first.width, second.x, second.width) <= 2 && overlap(first.y, first.height, second.y, second.height) >= Math.min(first.height, second.height) * 0.45);
  const column = pairs.length > 0 && pairs.every(({ first, second }) => overlap(first.y, first.height, second.y, second.height) <= 2 && overlap(first.x, first.width, second.x, second.width) >= Math.min(first.width, second.width) * 0.45);
  const arrangement = row ? 'row' : column ? 'column' : 'mixed-or-overlapping';
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const alignment = row || column ? (['start', 'center', 'end'] as const).filter(edge => spread(rects.map(rect => {
    const start = row ? rect.y : rect.x, size = row ? rect.height : rect.width;
    return start + (edge === 'start' ? 0 : edge === 'center' ? size / 2 : size);
  })) <= 2) : [];
  const ordered = [...rects].sort((first, second) => row ? first.x - second.x : first.y - second.y);
  const gaps = row || column ? ordered.slice(1).map((rect, index) => row ? rect.x - ordered[index].x - ordered[index].width : rect.y - ordered[index].y - ordered[index].height) : [];
  return { arrangement, crossAxisAlignmentCandidates: alignment, gapsPx: gaps, inference: 'geometry-candidate-not-authoring-decision' as const };
}

function sourceGroups(snapshot: Snapshot, facts: Fact[]) {
  const visible = facts.filter(fact => ['text', 'media'].includes(fact.kind) && fact.value.visible === true && relationshipRect(fact.value));
  const ancestry = new Map<string, Set<string>>();
  const ancestorsOf = (nodeId: string) => {
    if (ancestry.has(nodeId)) return ancestry.get(nodeId)!;
    const ancestors = new Set<string>();
    let current: string | null = nodeId;
    while (current && snapshot.nodes[current] && !ancestors.has(current)) {
      ancestors.add(current);
      current = snapshot.nodes[current].parentId;
    }
    ancestry.set(nodeId, ancestors);
    return ancestors;
  };
  const owned = new Map<string, Fact[]>();
  for (const fact of visible) for (const nodeId of ancestorsOf(fact.nodeId)) {
    if (!owned.has(nodeId)) owned.set(nodeId, []);
    owned.get(nodeId)!.push(fact);
  }
  const layouts = new Map(facts.filter(fact => fact.kind === 'layout').map(fact => [fact.nodeId, fact]));
  const rectFor = (nodeId: string) => {
    const layout = layouts.get(nodeId);
    return layout && relationshipRect(layout.value) || bounds((owned.get(nodeId) ?? []).map(fact => relationshipRect(fact.value)!));
  };
  const groups = [...owned.keys()].flatMap(nodeId => {
    const node = snapshot.nodes[nodeId];
    const children = (node.childIds ?? []).filter(childId => owned.has(childId)).map(childId => ({ nodeId: childId, rect: rectFor(childId), sourceFactIds: (owned.get(childId) ?? []).map(fact => fact.id) })).filter(child => !!child.rect);
    if (children.length < 2) return [];
    const rect = rectFor(nodeId)!;
    return [{
      nodeId, selector: node.selector, parentNodeId: node.parentId, rect,
      sourceFactIds: (owned.get(nodeId) ?? []).map(fact => fact.id),
      ...measureRelationships(children.map(child => child.rect!)),
      children: children.map(child => ({ ...child, rect: child.rect!, offsetPx: { x: child.rect!.x - rect.x, y: child.rect!.y - rect.y }, measuredWidthShare: child.rect!.width / rect.width })),
    }];
  });
  const groupIds = new Set(groups.map(group => group.nodeId));
  return groups.map(group => {
    let parent = group.parentNodeId;
    const visited = new Set([group.nodeId]);
    while (parent && !visited.has(parent) && !groupIds.has(parent)) {
      visited.add(parent);
      parent = snapshot.nodes[parent]?.parentId ?? null;
    }
    return { ...group, parentGroupNodeId: parent && !visited.has(parent) ? parent : null };
  });
}

function nativeGroups(root: Native44Component | undefined) {
  const rows: Array<{ component: Native44Component; parentComponentKey: string | null; depth: number; contentFacts: Set<string> }> = [];
  const visit = (component: Native44Component, parentComponentKey: string | null, depth: number): Set<string> => {
    const contentFacts = new Set(component.kind === 'composite' ? [] : component.sourceFactIds ?? []);
    for (const child of native44Children(component)) for (const fact of visit(child, component.key, depth + 1)) contentFacts.add(fact);
    rows.push({ component, parentComponentKey, depth, contentFacts });
    return contentFacts;
  };
  if (root) visit(root, null, 0);
  return rows;
}

export function createSectionRelationships(source: SourceFactsV2, section: PreparationSection, blocks?: Native44Component[]) {
  const root = blocks?.find(block => block.key === section.key), targets = nativeGroups(root);
  return {
    sectionKey: section.key,
    rootComponentKey: root?.key ?? null,
    rootIsContainer: root ? root.kind === 'composite' : null,
    nativeTree: targets.filter(row => row.component.kind === 'composite').map(row => ({
      componentKey: row.component.key, parentComponentKey: row.parentComponentKey, settings: row.component.settings ?? {}, childComponentKeys: native44Children(row.component).map(child => child.key),
    })),
    viewports: source.snapshots.map(snapshot => {
      const facts = section.sourceFactIds.map(id => source.facts[id]).filter(fact => fact?.snapshotId === snapshot.id);
      return {
        snapshotId: snapshot.id, viewport: snapshot.viewport, screenshot: snapshot.screenshot,
        outerAndContent: facts.filter(fact => fact.kind === 'layout').map(fact => ({ sourceFactId: fact.id, nodeId: fact.nodeId, purpose: fact.value.purpose, geometry: fact.value })),
        gaps: source.gaps.filter(gap => gap.snapshotId === snapshot.id && (!gap.nodeId || facts.some(fact => fact.nodeId === gap.nodeId))),
        groups: sourceGroups(snapshot, facts).map(group => {
          const candidates = targets.filter(row => row.component.kind === 'composite' && group.sourceFactIds.every(id => row.contentFacts.has(id))).sort((first, second) => second.depth - first.depth);
          return { ...group, targetContainerKey: candidates[0]?.component.key ?? null, mappingStatus: blocks === undefined ? 'awaiting-authoring' : candidates.length ? 'assigned-not-render-verified' : 'unmapped' };
        }),
        states: facts.filter(fact => fact.kind === 'interaction').map(fact => ({ sourceFactId: fact.id, nodeId: fact.nodeId, kind: fact.value.kind, status: fact.value.status, details: fact.value.details, trackNodeId: fact.value.trackNodeId ?? null, itemNodeIds: fact.value.itemNodeIds ?? [], controlNodeIds: fact.value.controlNodeIds ?? [] })),
        hiddenContentFactIds: facts.filter(fact => ['text', 'media'].includes(fact.kind) && fact.value.visible === false).map(fact => fact.id),
      };
    }),
    rendered: 'not-verified',
  };
}

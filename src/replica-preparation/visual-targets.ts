import type { SourceFactsV2 } from '../replica-v2/source.js';
import { preparationFail } from './contract.js';
import type { PreparationPlan } from './types.js';

const close = (left: number, right: number): boolean => Math.abs(left - right) <= 0.5;

export function verifyPreparationVisualTargets(plan: PreparationPlan, source: SourceFactsV2): void {
  if (plan.version < 6) return;
  const snapshots = new Map(source.snapshots.map(snapshot => [snapshot.id, snapshot]));
  for (const section of plan.sections) {
    const targets = section.visualTargets ?? [];
    for (const target of targets) {
      const ids = target.kind === 'item-count' ? target.sourceFactIds : [target.sourceFactId];
      const facts = ids.map(id => source.facts[id]);
      if (facts.some(fact => !fact) || new Set(facts.map(fact => fact.snapshotId)).size !== 1) preparationFail('body_visual_target_source');
      const snapshot = snapshots.get(facts[0].snapshotId);
      if (!snapshot || target.evidence.path !== snapshot.screenshot.path || target.evidence.sha256 !== snapshot.screenshot.sha256) preparationFail('body_visual_target_evidence');
      if (target.kind === 'text-wrap') {
        const fact = facts[0], layout = fact.value.layout as { contentRect?: { width?: number } } | undefined;
        if (fact.kind !== 'text' || fact.value.visible !== true || fact.value.lineCount !== target.lineCount || !close(layout?.contentRect?.width ?? NaN, target.widthPx)) preparationFail('body_visual_target_text');
      } else if (target.kind === 'item-count') {
        const visible = section.sourceFactIds.map(id => source.facts[id]).filter(fact => fact?.snapshotId === snapshot.id && fact.kind === 'media' && fact.value.visible === true);
        if (!visible.length || new Set(ids).size !== ids.length || visible.some(fact => !ids.includes(fact.id)) || ids.some(id => !visible.some(fact => fact.id === id)) || new Set(visible.map(fact => fact.nodeId)).size !== target.count) preparationFail('body_visual_target_items');
      } else if (target.kind === 'geometry') {
        const fact = facts[0], rect = fact.value.rect as Record<string, number> | undefined;
        if (fact.kind !== 'layout' || !rect || Object.entries(target.rect).some(([dimension, value]) => !close(rect[dimension], value))) preparationFail('body_visual_target_geometry');
      } else {
        const fact = facts[0], style = fact.value.style as Record<string, string> | undefined;
        if (!['layout', 'text'].includes(fact.kind) || !style || style[target.property] !== target.value) preparationFail('body_visual_target_paint');
      }
    }
    for (const snapshot of source.snapshots.filter(item => item.viewport.name.startsWith('desktop'))) {
      const owned = section.sourceFactIds.map(id => source.facts[id]).filter(fact => fact?.snapshotId === snapshot.id);
      if (!owned.length) continue;
      const inSnapshot = targets.filter(target => source.facts[target.kind === 'item-count' ? target.sourceFactIds[0] : target.sourceFactId]?.snapshotId === snapshot.id);
      if (!inSnapshot.some(target => target.kind === 'geometry') || !inSnapshot.some(target => target.kind === 'paint')) preparationFail('body_visual_target_desktop_missing');
      if (owned.some(fact => fact.kind === 'text' && fact.value.visible === true && Number(fact.value.lineCount) > 0) && !inSnapshot.some(target => target.kind === 'text-wrap')) preparationFail('body_visual_target_text_missing');
      if (owned.some(fact => fact.kind === 'media' && fact.value.visible === true) && !inSnapshot.some(target => target.kind === 'item-count')) preparationFail('body_visual_target_items_missing');
    }
  }
}

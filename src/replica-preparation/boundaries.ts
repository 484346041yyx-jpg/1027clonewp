import { z } from 'zod';
import * as cssTree from 'css-tree';
import { native44ModuleClass } from '../native44/adapters.js';
import type { PreparationPlan, PreparationSectionResult } from './types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';

/** Coordinator-owned evidence and decisions; never a substitute for rendered review. */
const id = z.string().min(1).max(240);
const contributor = z.object({ id, role: z.enum(['internal-padding', 'external-spacing']), owner: id, sourceFactIds: z.array(id).min(1), effectId: id }).strict();
export const boundaryTableSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-section-boundaries'),
  taskId: id, runId: id, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  styles: z.array(z.object({ sectionKey: id, property: z.enum(['margin-top','margin-bottom']), valuePx: z.number().finite(), minWidth: z.number().int().nonnegative(), maxWidth: z.number().int().nonnegative(), sourceFactIds: z.array(id).min(1) }).strict()).default([]),
  boundaries: z.array(z.object({
    before: id, after: id, snapshotId: id, clientWidth: z.number().int().positive(),
    gapPx: z.number().finite(), evidenceFactIds: z.array(id).min(1),
    backgroundDecision: z.string().trim().min(1), contributors: z.array(contributor),
  }).strict()),
}).strict();
export type BoundaryTable = z.infer<typeof boundaryTableSchema>;

/** Checks declared ownership only. Geometry, CSS effects and visual fidelity require separate evidence. */
export function validateBoundaryTable(input: unknown, expected: { taskId: string; runId: string; sourceHash: string; sectionKeys: string[]; snapshots: Array<{ id: string; clientWidth: number }>; factSnapshot: Record<string,string> }): BoundaryTable {
  const table = boundaryTableSchema.parse(input);
  if (table.taskId !== expected.taskId || table.runId !== expected.runId || table.sourceHash !== expected.sourceHash) throw Error('replica_preparation_boundary_identity');
  const seen = new Set<string>();
  for (const row of table.boundaries) {
    const index = expected.sectionKeys.indexOf(row.before);
    if (index < 0 || expected.sectionKeys[index + 1] !== row.after || !expected.snapshots.some(s => s.id === row.snapshotId && s.clientWidth === row.clientWidth)) throw Error('replica_preparation_boundary_scope');
    const key = JSON.stringify([row.before,row.after,row.snapshotId]);
    if (seen.has(key)) throw Error('replica_preparation_boundary_duplicate');
    seen.add(key);
    if ([...row.evidenceFactIds, ...row.contributors.flatMap(c => c.sourceFactIds)].some(f => expected.factSnapshot[f] !== row.snapshotId)) throw Error('replica_preparation_boundary_evidence');
    const effects = new Set<string>();
    for (const c of row.contributors) {
      if (effects.has(c.effectId)) throw Error('replica_preparation_boundary_effect_duplicate');
      effects.add(c.effectId);
      if (c.role === 'external-spacing' && c.owner !== 'coordinator') throw Error('replica_preparation_boundary_owner');
      if (c.role === 'internal-padding' && c.owner !== row.before && c.owner !== row.after) throw Error('replica_preparation_boundary_owner');
    }
  }
  for (let i = 0; i + 1 < expected.sectionKeys.length; i++) for (const s of expected.snapshots) if (!seen.has(JSON.stringify([expected.sectionKeys[i],expected.sectionKeys[i+1],s.id]))) throw Error('replica_preparation_boundary_missing');
  for(const style of table.styles) {
    if(!expected.sectionKeys.includes(style.sectionKey) || style.minWidth>style.maxWidth || style.sourceFactIds.some(f=>!expected.factSnapshot[f])) throw Error('replica_preparation_boundary_style_scope');
    const key=JSON.stringify([style.sectionKey,style.property]);
    for(const other of table.styles) if(other!==style && other.sectionKey===style.sectionKey && other.property===style.property && Math.max(other.minWidth,style.minWidth)<=Math.min(other.maxWidth,style.maxWidth)) throw Error('replica_preparation_boundary_style_overlap');
  }
  return table;
}

/** Source-bound table validation runs both before dispatch and again before merge. */
export function assertPreparationBoundaries(plan: PreparationPlan, facts: SourceFactsV2): void {
  if (!plan.boundaryTable) return;
  validateBoundaryTable(plan.boundaryTable, {taskId:plan.taskId,runId:plan.runId,sourceHash:plan.sourceFacts.sha256,sectionKeys:plan.sections.map(s=>s.key),snapshots:facts.snapshots.map(s=>({id:s.id,clientWidth:s.viewport.width})),factSnapshot:Object.fromEntries(Object.entries(facts.facts).map(([id,f])=>[id,f.snapshotId]))});
}

/** Root external offsets belong to the coordinator. Internal padding and descendant spacing are preserved. */
export function assertBoundaryFragment(fragment: PreparationSectionResult): void {
  const external = /^(?:_?margin(?:_|$)|margin-|top$|bottom$|inset|translate|transform$|position$)/i;
  const checkSettings = (settings: Record<string,unknown> | undefined) => {
    if (Object.keys(settings ?? {}).some(k=>external.test(k))) throw Error('replica_preparation_boundary_native_conflict');
  };
  const root=fragment.blocks[0];
  checkSettings(root?.settings);
  for (const setting of root?.nativeStyleSettings ?? []) if(external.test(setting.controlId)) throw Error('replica_preparation_boundary_native_conflict');
  for (const binding of root?.styleBindings ?? []) if (binding.selector === '' || binding.selector === '&' || binding.selector === ':scope') {
    if(binding.properties.some(k=>external.test(k))) throw Error('replica_preparation_boundary_binding_conflict');
  }
  for (const entry of fragment.responsive?.nativeStyleSettings ?? []) if(entry.componentKey===fragment.key && external.test(entry.setting.controlId)) throw Error('replica_preparation_boundary_native_conflict');
  for (const entry of fragment.responsive?.settings ?? []) if(entry.componentKey===fragment.key) checkSettings(entry.values);
  for (const entry of fragment.responsive?.styleBindings ?? []) if(entry.componentKey===fragment.key && entry.binding.properties.some(k=>external.test(k))) throw Error('replica_preparation_boundary_binding_conflict');
  const rootSelector=':page .'+native44ModuleClass(fragment.key);
  for (const css of [fragment.css,fragment.responsive?.css ?? '']) {
    const ast=cssTree.parse(css);
    cssTree.walk(ast,node=>{
      if(node.type!=='Rule') return;
      const selector=cssTree.generate(node.prelude);
      // Any selector that can address the root is reserved for external spacing.
      let rootRule=false;
      if(node.prelude.type==='SelectorList') node.prelude.children.forEach(s=>{
        if(s.type!=='Selector') return;
        const parts=s.children.toArray(), index=parts.findIndex(p=>p.type==='ClassSelector' && p.name===native44ModuleClass(fragment.key));
        if(index>=0 && !parts.slice(index+1).some(p=>p.type==='Combinator')) rootRule=true;
        if(index<0 && selector.includes(native44ModuleClass(fragment.key))) rootRule=true;
      });
      if(rootRule) cssTree.walk(node.block,child=>{if(child.type==='Declaration' && external.test(child.property)) throw Error('replica_preparation_boundary_css_conflict');});
    });
  }
}

export function boundaryCSS(plan: PreparationPlan): string {
  return (plan.boundaryTable?.styles ?? []).map(s=>'@media (min-width:'+s.minWidth+'px) and (max-width:'+s.maxWidth+'px){:page .'+native44ModuleClass(s.sectionKey)+'{'+s.property+':'+s.valuePx+'px;}}').join('\n');
}

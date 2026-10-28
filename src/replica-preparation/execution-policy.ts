import { z } from 'zod';
import type { PreparationPlan, PreparationSection } from './types.js';

export const preparationExecutionPolicySchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-coordinator-queue'),
  maxWorkers: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  targetSectionsPerJob: z.number().int().min(1).max(12),
  browserMode: z.literal('two-window-single-controller'),
  reviewMode: z.literal('whole-page-batched'),
  remoteWrites: z.literal('serial'), reuse: z.literal('task-hash-bound'),
}).strict();
export type PreparationExecutionPolicy = z.infer<typeof preparationExecutionPolicySchema>;
export type PreparationJobId = 'header' | `body-${number}`;

export function isPreparationJobId(value: unknown): value is PreparationJobId {
  if (value === 'header') return true;
  if (typeof value !== 'string' || !/^body-[1-9][0-9]{0,3}$/.test(value)) return false;
  return Number(value.slice(5)) <= 2000;
}

/** All layout and control dependencies form indivisible preparation responsibilities. */
export function preparationSectionComponents(sections: PreparationSection[]): number[][] {
  const indexes = new Map(sections.map((section, index) => [section.key, index]));
  const neighbors = sections.map(() => new Set<number>());
  for (const [index, section] of sections.entries()) for (const key of section.dependsOn) {
    const dependency = indexes.get(key);
    if (dependency === undefined || dependency === index) throw Error('replica_preparation_dependency_unknown');
    neighbors[index].add(dependency); neighbors[dependency].add(index);
  }
  const seen = new Set<number>(), groups: number[][] = [];
  for (let index = 0; index < sections.length; index++) {
    if (seen.has(index)) continue;
    const queue = [index], group: number[] = []; seen.add(index);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]; group.push(current);
      for (const neighbor of neighbors[current]) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
    }
    groups.push(group.sort((a, b) => a - b));
  }
  return groups;
}

/** Called only for a newly initialized v8 task; validation and resume never add defaults. */
export function defaultPreparationExecutionPolicy(plan: Pick<PreparationPlan, 'sections' | 'reusedHeader'>): PreparationExecutionPolicy {
  // Effort is relative planning work, not elapsed minutes: a simple static region is 1.
  // Two interactive/heavy regions are not a minimal page merely because the count is low.
  const minimal = plan.sections.length <= 2
    && plan.sections.reduce((sum, section) => sum + section.estimatedEffort, 0) <= 3
    && plan.sections.every(section => section.family === 'content'
      && !section.fidelity?.some(check => check.status === 'required' && ['interaction', 'motion'].includes(check.kind)));
  const desired = minimal ? 1 : 3;
  const available = preparationSectionComponents(plan.sections).length + (plan.reusedHeader ? 0 : 1);
  return {
    version: 1, kind: 'clonewp-coordinator-queue', maxWorkers: Math.max(1, Math.min(desired, available)) as 1 | 2 | 3,
    targetSectionsPerJob: 3, browserMode: 'two-window-single-controller', reviewMode: 'whole-page-batched',
    remoteWrites: 'serial', reuse: 'task-hash-bound',
  };
}

/** Stable work packets, independent from runtime worker assignment and final document order. */
export function preparationExecutionGroups(plan: Pick<PreparationPlan, 'sections' | 'executionPolicy'>): number[][] {
  if (!plan.executionPolicy) throw Error('replica_preparation_execution_policy_required');
  const policy = preparationExecutionPolicySchema.parse(plan.executionPolicy);
  const components = preparationSectionComponents(plan.sections);
  if (policy.maxWorkers === 1) return components.length ? [components.flat().sort((a, b) => a - b)] : [];
  const effort = (indexes: number[]) => indexes.reduce((sum, index) => sum + plan.sections[index].estimatedEffort, 0);
  const targetEffort = plan.sections.reduce((sum, section) => sum + section.estimatedEffort, 0) / policy.maxWorkers;
  const groups: number[][] = []; let current: number[] = [];
  const flush = () => { if (current.length) groups.push(current.sort((a, b) => a - b)); current = []; };
  for (const component of components) {
    const complex = component.length >= policy.targetSectionsPerJob || effort(component) >= targetEffort;
    if (current.length && (complex || current.length + component.length > policy.targetSectionsPerJob || effort(current) + effort(component) > targetEffort)) flush();
    current.push(...component);
    if (complex || current.length >= policy.targetSectionsPerJob || effort(current) >= targetEffort) flush();
  }
  flush();
  return groups;
}

/** Total active preparation slots, including an owned header job; never extra remote writers. */
export function preparationConcurrency(plan: Pick<PreparationPlan, 'sections' | 'reusedHeader' | 'executionPolicy'>): number {
  const header = plan.reusedHeader ? 0 : 1;
  if (!plan.executionPolicy) return Math.min(2, preparationSectionComponents(plan.sections).length) + header;
  return Math.min(plan.executionPolicy.maxWorkers, preparationExecutionGroups(plan).length + header);
}

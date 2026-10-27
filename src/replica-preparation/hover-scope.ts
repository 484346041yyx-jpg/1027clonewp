import type { PreparationPlan } from './types.js';
import type { BodySourceUnits } from '../replica-full/body-prepare.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';

export function preparationHoverSource(plan: PreparationPlan, facts: SourceFactsV2, units: BodySourceUnits): SourceFactsV2 {
  if (!plan.reusedHeader) return facts;
  if (plan.version !== 8) throw Error('replica_preparation_readonly_header_hover_scope_version');
  const bodyUnits = new Set(plan.sourcePartition.bodyUnits);
  const selected = units.units.filter(unit => bodyUnits.has(unit.id));
  if (selected.length !== bodyUnits.size) throw Error('replica_preparation_readonly_header_hover_scope_units');
  const bodyFacts = new Set(selected.flatMap(unit => unit.sourceFactIds));
  if ([...bodyFacts].some(id => !facts.facts[id])) throw Error('replica_preparation_readonly_header_hover_scope_facts');
  return { ...facts, facts: Object.fromEntries(Object.entries(facts.facts).filter(([id]) => bodyFacts.has(id))) };
}

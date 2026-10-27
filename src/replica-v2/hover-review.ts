import { z } from 'zod';
import type { SourceFactsV2 } from './source.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({ path: z.string().min(1), sha256: hash }).strict();
const state = z.object({
  version: z.literal(1), kind: z.literal('source-hover-state'), sourceUrl: z.url(),
  stage: z.enum(['default', 'hover', 'restored']), observedAt: z.iso.datetime(),
  screenshotHash: hash, triggerSelector: z.string().min(1), hovered: z.boolean(),
  affected: z.array(z.object({ selector: z.string().min(1), tag: z.string(), text: z.string(),
    rect: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() }).strict(),
    currentSrc: z.string().nullable(), styles: z.record(z.string(), z.record(z.string(), z.string())) }).strict()).min(1).max(31),
}).strict();
const unreachableProbe = z.object({
  version: z.literal(1), kind: z.literal('source-hover-unreachable'), sourceUrl: z.url(), observedAt: z.iso.datetime(),
  screenshotHash: hash, triggerSelector: z.string().min(1),
  triggerRect: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict(),
  pointerEvents: z.string(), hits: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), hitSelector: z.string().nullable(), targetOrDescendant: z.boolean() }).strict()).length(9),
}).strict();
const rowIdentity = { snapshotId: z.string().min(1), triggerNodeId: z.string().min(1) };
const capture = z.object({ state, screenshot: ref }).strict();
export const SourceHoverReviewSchema = z.object({
  version: z.literal(1), kind: z.literal('source-hover-review'), sourceUrl: z.url(),
  rows: z.array(z.union([
    z.object({ ...rowIdentity, captures: z.tuple([capture, capture, capture]) }).strict(),
    z.object({ ...rowIdentity, unreachable: z.object({ probe: unreachableProbe, screenshot: ref, activation: z.object({ kind: z.enum(['carousel-tab', 'other']), label: z.string().min(1) }).strict() }).strict() }).strict(),
  ])).max(1500),
}).strict();
export type SourceHoverReview = z.infer<typeof SourceHoverReviewSchema>;

/** CSS candidates are obligations, not proof. Verify a representative pointer
 * cycle for each distinct declared hover rule. */
export function verifySourceHoverReview(facts: SourceFactsV2, input: unknown): SourceHoverReview {
  const review = SourceHoverReviewSchema.parse(input);
  if (review.sourceUrl !== facts.sourceUrl) throw Error('source_hover_url_conflict');
  const required = Object.values(facts.facts).filter(fact => fact.kind === 'interaction' && fact.value.kind === 'hover' && (fact.value.details as any)?.source === 'css-hover-selector');
  const expected = new Map(required.map(fact => [`${fact.snapshotId}\0${fact.nodeId}`, fact]));
  const requiredRules = new Set(required.map(fact => String((fact.value.details as any).selector)));
  const seen = new Set<string>();
  const coveredRules = new Set<string>();
  for (const row of review.rows) {
    const key = `${row.snapshotId}\0${row.triggerNodeId}`, fact = expected.get(key), snapshot = facts.snapshots.find(item => item.id === row.snapshotId);
    if (!fact || !snapshot || seen.has(key)) throw Error('source_hover_identity_conflict'); seen.add(key);
    coveredRules.add(String((fact.value.details as any).selector));
    const selector = snapshot.nodes[row.triggerNodeId]?.selector;
    if ('unreachable' in row) {
      const { probe, screenshot } = row.unreachable;
      if (probe.sourceUrl !== facts.sourceUrl || probe.triggerSelector !== selector || probe.screenshotHash !== screenshot.sha256 || probe.hits.some(hit => hit.targetOrDescendant) || !probe.hits.some(hit => hit.hitSelector)) throw Error('source_hover_unreachable_proof_invalid');
      continue;
    }
    const states = row.captures.map(item => item.state);
    if (states.map(item => item.stage).join(',') !== 'default,hover,restored' || states.some(item => item.sourceUrl !== facts.sourceUrl || item.triggerSelector !== selector) || states.map(item => item.hovered).join(',') !== 'false,true,false') throw Error('source_hover_pointer_cycle_invalid');
    if (states.some((item, index) => item.screenshotHash !== row.captures[index].screenshot.sha256 || item.affected[0]?.selector !== selector || item.affected.map(effect => effect.selector).join('\0') !== states[0].affected.map(effect => effect.selector).join('\0'))) throw Error('source_hover_capture_identity_conflict');
    if (!(Date.parse(states[0].observedAt) <= Date.parse(states[1].observedAt) && Date.parse(states[1].observedAt) <= Date.parse(states[2].observedAt))) throw Error('source_hover_order_invalid');
  }
  if ([...requiredRules].some(rule => !coveredRules.has(rule))) throw Error('source_hover_coverage_missing');
  return review;
}

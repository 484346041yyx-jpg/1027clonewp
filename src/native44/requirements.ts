import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SourceFactsV2, SourceFactV2 } from '../replica-v2/source.js';
import { SourceUnitSchema, type Native44SourceUnit } from './selection-types.js';
import { walkNative44, type Native44Component } from './types.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';

/** Explicit opt-in. Historical programs without this profile retain their frozen semantics. */
export const NATIVE44_REQUIREMENT_PROFILE = 'source-requirements-v1' as const;
export const NATIVE44_COMPONENT_REFERENCE_GOAL = 'component-reference-v1' as const;
export type Native44GoalProfile = typeof NATIVE44_COMPONENT_REFERENCE_GOAL;
const id = z.string().trim().min(1).max(500);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Native44RequirementRefSchema = z.object({ path: z.string().min(1), sha256: hash }).strict();
export const Native44RequirementProfileSchema = z.discriminatedUnion('version', [z.object({ version: z.literal(1), kind: z.literal('native44-requirement-profile'), profile: z.literal(NATIVE44_REQUIREMENT_PROFILE) }).strict(), z.object({ version: z.literal(2), kind: z.literal('native44-requirement-profile'), profile: z.literal(NATIVE44_REQUIREMENT_PROFILE), goalProfile: z.literal(NATIVE44_COMPONENT_REFERENCE_GOAL) }).strict()]);
export const Native44CapabilitySchema = z.enum(['render-content', 'editable-native', 'render-layout', 'render-presentation', 'target-product-data', 'authentic-business', 'navigate', 'search-input', 'cart-state', 'carousel-next-previous', 'carousel-pagination', 'carousel-autoplay', 'carousel-playback-toggle', 'form-submit', 'third-party-service', 'accordion-toggle', 'hover', 'input-control', 'unknown-control']);
export type Native44Capability = z.infer<typeof Native44CapabilitySchema>;
const dimension = z.enum(['presence', 'editability', 'layout', 'presentation', 'behavior', 'data', 'authenticity']);
const severity = z.enum(['critical', 'blocking', 'minor', 'cosmetic']);
const scope = z.enum(['module', 'content', 'item', 'control']);
const check = z.object({ id, viewport: id, state: id, scope, metric: id, sourceEvidence: z.array(Native44RequirementRefSchema).min(1) }).strict();
const resolved = { componentKeys: z.array(id).min(1), capability: Native44CapabilitySchema, proof: Native44RequirementRefSchema };
const fulfillment = z.discriminatedUnion('route', [
  z.object({ route: z.literal('verified-native'), ...resolved }).strict(),
  z.object({ route: z.literal('native-composition'), ...resolved }).strict(),
  z.object({ route: z.literal('explicit-adaptation'), ...resolved, reason: z.string().trim().min(20), sourceEvidence: z.array(Native44RequirementRefSchema).min(1) }).strict(),
  z.object({ route: z.literal('gap'), gapId: id, reason: z.string().trim().min(20), state: z.enum(['unfinished', 'pending-configuration', 'unverified']).optional(), componentKeys: z.array(id).min(1).optional() }).strict(),
]);
const sourceScopeClassification = z.enum(['visible', 'reachable-desktop', 'unresolved', 'outside-desktop']);
export const Native44SourceScopeSchema = z.object({ sourceKey: id, classification: sourceScopeClassification, evidence: Native44RequirementRefSchema, reason: z.string().trim().min(40) }).strict();
export const Native44RequirementContractSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-requirements'), profile: z.literal(NATIVE44_REQUIREMENT_PROFILE),
  taskId: id,
  goalProfile: z.literal(NATIVE44_COMPONENT_REFERENCE_GOAL).optional(),
  sourceFacts: Native44RequirementRefSchema, sourceUnitsHash: hash,
  sourceScopes: z.array(Native44SourceScopeSchema).min(1).optional(),
  requirements: z.array(z.object({ id, sourceKey: id, dimension, severity, capability: Native44CapabilitySchema, disposition: z.enum(['preserve', 'target-product-data']), checks: z.array(check).min(1), fulfillment }).strict()).min(1),
}).strict();
export type Native44RequirementContract = z.infer<typeof Native44RequirementContractSchema>;
export type Native44Requirement = Native44RequirementContract['requirements'][number];

/** Proof bytes are loaded and hash-checked by the caller. A widget identity alone is not a behavior proof. */
export const Native44CapabilityProofSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-capability-proof'), capability: Native44CapabilitySchema,
  method: z.enum(['registered-contract', 'interaction-probe', 'composition-probe']),
  components: z.array(z.object({ key: id, widgetType: id, settingsHash: hash }).strict()).min(1),
  observations: z.record(z.string(), z.boolean()), evidence: z.array(Native44RequirementRefSchema).min(1),
}).strict();
export type Native44CapabilityProof = z.infer<typeof Native44CapabilityProofSchema>;
export const Native44AcceptancePolicySchema = z.object({
  version: z.literal(1), kind: z.literal('native44-acceptance-policy'), requirementsHash: hash,
  tolerances: z.array(z.object({ checkId: id, maxDelta: z.number().finite().nonnegative(), unit: id, reason: z.string().trim().min(10) }).strict()),
  acceptedDeviations: z.array(z.object({ requirementId: id, checkIds: z.array(id).min(1), reason: z.string().trim().min(20), acceptedBy: z.enum(['user', 'policy']), evidence: z.array(Native44RequirementRefSchema).min(1) }).strict()),
}).strict();
export type Native44AcceptancePolicy = z.infer<typeof Native44AcceptancePolicySchema>;
const issueCategory = z.enum(['structure', 'overflow', 'fake-business', 'editability', 'behavior', 'capability', 'geometry', 'presentation', 'data', 'native-decoration', 'unfinished']);
export const Native44AcceptanceObservationSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-acceptance-observation'), requirementsHash: hash, documentHash: hash, cssHash: hash,
  review: z.object({ verification: Native44RequirementRefSchema, visualReview: Native44RequirementRefSchema }).strict(),
  checks: z.array(z.object({ requirementId: id, checkId: id, outcome: z.enum(['pass', 'fail', 'unverified']), evidence: z.array(Native44RequirementRefSchema).min(1), issue: z.object({ category: issueCategory, severity: severity.optional(), message: z.string().trim().min(1), delta: z.number().finite().nonnegative().optional(), unit: id.optional(), property: id.optional(), nativeDifference: z.literal('decoration').optional() }).strict().optional() }).strict()),
}).strict();
export type Native44AcceptanceObservation = z.infer<typeof Native44AcceptanceObservationSchema>;

// Keep hashing independent of task journals, credentials and runtime I/O.
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))])) : value) ?? 'null';
export const native44RequirementsHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');

export interface Native44SourceObligation { sourceKey: string; dimension: Native44Requirement['dimension']; capability: Native44Capability; minimumSeverity: Native44Requirement['severity']; viewport: string; requiredScopes: Array<z.infer<typeof scope>>; evidence: Array<z.infer<typeof Native44RequirementRefSchema>>; product: boolean; snapshotId?: string; sourceNodeId?: string; }
const isProduct = (unit: Native44SourceUnit) => ['query', 'deferred-query'].includes(unit.role);
const dimensions = ['presence', 'editability', 'layout', 'presentation'] as const;
const severityRank = { critical: 3, blocking: 2, minor: 1, cosmetic: 0 };
function interactionCapabilities(fact: SourceFactV2, source: SourceFactsV2, goalProfile?: Native44GoalProfile): Native44Capability[] {
  const value = fact.value, details = value.details && typeof value.details === 'object' ? value.details as Record<string, unknown> : {};
  const strings = [value.selector, ...Object.entries(details).flatMap(([key, value]) => value === false || value === null ? [] : [key, String(value)]), ...Object.values(source.facts).filter(other => other.snapshotId === fact.snapshotId && other.nodeId === fact.nodeId && other.kind === 'text').map(other => other.value.text)].join(' ').toLowerCase();
  const snapshot = source.snapshots.find(item => item.id === fact.snapshotId);
  const buttonControl = value.kind === 'control' && snapshot?.nodes[fact.nodeId]?.tag.toLowerCase() === 'button';
  const controlClasses = typeof details.nodeClass === 'string' ? details.nodeClass.toLowerCase().split(/\s+/) : [];
  const controlLabel = typeof details.label === 'string' ? details.label.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  const positiveSlideNumber = (value: string | undefined) => value !== undefined && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
  const indexedSlideLabel = positiveSlideNumber(/^go to slide ([1-9]\d*)$/.exec(controlLabel)?.[1]);
  const paginationClass = controlClasses.some(token => /(?:^|[-_])(?:pagination|dots?)(?:$|[-_])/.test(token));
  const explicitSlideIndex = ['slideIndex', 'slide-index', 'data-slide-index', 'data-slick-index', 'data-swiper-slide-index'].some(key => {
    const index = details[key]; return (typeof index === 'number' || typeof index === 'string' && /^\d+$/.test(index)) && Number.isSafeInteger(Number(index)) && Number(index) >= 0;
  });
  // These declarations identify a required behavior; they never prove that the
  // source or selected native component actually performs it.
  const declaredPagination = buttonControl && (indexedSlideLabel || paginationClass && (positiveSlideNumber(/^(?:slide )?([1-9]\d*)$/.exec(controlLabel)?.[1]) || explicitSlideIndex));
  const declaredDisclosure = buttonControl && controlClasses.some(token => /(?:^|[-_])(?:benefits?|faqs?|disclosure)(?:[-_](?:item|control))?[-_](?:header|trigger|toggle)$/.test(token));
  const beneath = (id: string) => { const seen = new Set<string>(); let current: string | null = id; while (current && !seen.has(current)) { if (current === fact.nodeId) return true; seen.add(current); current = snapshot?.nodes[current]?.parentId ?? null; } return false; };
  const cartText = Object.values(source.facts).filter(other => other.snapshotId === fact.snapshotId && other.kind === 'text' && beneath(other.nodeId)).map(other => String(other.value.text)).join(' ');
  if (/cart/i.test(`${value.selector} ${value.href ?? ''}`) && /\b\d+\b/.test(cartText)) return typeof value.href === 'string' ? ['navigate', 'cart-state'] : ['cart-state'];
  if (/\b(?:search|searchbox)\b/.test(strings)) return ['search-input'];
  if (/\b(?:cart[-_ ]?(?:count|state|items)|dynamic[-_ ]?cart)\b/.test(strings)) return ['cart-state'];
  if (value.kind === 'carousel') {
    const result: Native44Capability[] = ['carousel-next-previous'];
    if (/pagination|dots|slide[-_ ]?index/.test(strings)) result.push('carousel-pagination');
    if (/autoplay|auto[-_ ]?play/.test(strings)) result.push('carousel-autoplay');
    if (/pause|playback|play[-_ ]?(?:pause|toggle)/.test(strings)) result.push('carousel-playback-toggle');
    return result;
  }
  if (/pause|playback|play[-_ ]?(?:pause|toggle)/.test(strings)) return ['carousel-playback-toggle'];
  if (/\b(?:previous|prev|next)(?:[-_ ]slide)?\b/.test(strings)) return ['carousel-next-previous'];
  if (declaredPagination) return ['carousel-pagination'];
  if (/accordion|expand|collapse/.test(strings) || declaredDisclosure) return ['accordion-toggle'];
  if (/submit/.test(strings) || source.snapshots.find(item => item.id === fact.snapshotId)?.nodes[fact.nodeId]?.tag.toLowerCase() === 'form') return ['form-submit'];
  if (goalProfile === NATIVE44_COMPONENT_REFERENCE_GOAL && /\b(?:chat|chatbot|feedback|live[-_ ]?chat|third[-_ ]?party[-_ ]?service)\b/.test(strings)) return ['third-party-service'];
  if (value.kind === 'hover') return ['hover'];
  if (typeof value.href === 'string' && value.href.trim() || value.kind === 'navigation') return ['navigate'];
  return ['unknown-control'];
}

/** Source inventory is independent of the implemented list. Missing controls stay required. */
export function deriveNative44SourceObligations(source: SourceFactsV2, sourceUnits: Native44SourceUnit[], goalProfile?: Native44GoalProfile): Native44SourceObligation[] {
  const result: Native44SourceObligation[] = [], known = new Set<string>();
  const add = (row: Native44SourceObligation) => { const key = `${row.sourceKey}\0${row.dimension}`; if (!known.has(key)) { known.add(key); result.push(row); } };
  for (const unit of sourceUnits) {
    const snapshot = source.snapshots.find(item => item.id === unit.snapshotId);
    if (!snapshot || !snapshot.nodes[unit.ownerNodeId] || unit.sourceFactIds.some(id => !source.facts[id] || source.facts[id].snapshotId !== unit.snapshotId)) throw Error(`Requirement source unit has unknown ownership: ${unit.id}`);
    const product = isProduct(unit), repeated = product || !!unit.repeatedItems?.length;
    for (const dim of dimensions) add({ sourceKey: `unit:${unit.id}`, dimension: dim, capability: dim === 'presence' ? 'render-content' : dim === 'editability' ? 'editable-native' : dim === 'layout' ? 'render-layout' : 'render-presentation', minimumSeverity: dim === 'presentation' ? 'cosmetic' : dim === 'layout' ? 'minor' : 'blocking', viewport: snapshot.viewport.name, requiredScopes: dim === 'layout' ? repeated ? ['module', 'content', 'item'] : ['module', 'content'] : dim === 'presentation' && repeated ? ['content', 'item'] : ['content'], evidence: unit.sourceFactIds.map(id => source.facts[id].evidence), product });
    if (product) for (const dim of ['data', 'authenticity'] as const) add({ sourceKey: `unit:${unit.id}`, dimension: dim, capability: dim === 'data' ? 'target-product-data' : 'authentic-business', minimumSeverity: dim === 'data' ? 'minor' : 'blocking', viewport: snapshot.viewport.name, requiredScopes: ['item'], evidence: unit.sourceFactIds.map(id => source.facts[id].evidence), product });
  }
  for (const fact of Object.values(source.facts).filter(item => item.kind === 'interaction')) {
    const viewport = source.snapshots.find(item => item.id === fact.snapshotId)!.viewport.name;
    for (const capability of interactionCapabilities(fact, source, goalProfile)) add({ sourceKey: `interaction:${fact.id}:${capability}`, dimension: 'behavior', capability, minimumSeverity: capability === 'search-input' || capability === 'cart-state' ? 'critical' : 'blocking', viewport, requiredScopes: ['control'], evidence: [fact.evidence], product: false, snapshotId: fact.snapshotId, sourceNodeId: fact.nodeId });
    // An aggregate carousel record must not consume its child pause/search/other controls.
    for (const nodeId of Array.isArray(fact.value.controlNodeIds) ? fact.value.controlNodeIds as string[] : []) {
      const snapshot = source.snapshots.find(item => item.id === fact.snapshotId)!;
      if (snapshot.nodes[nodeId] && !Object.values(source.facts).some(other => other.kind === 'interaction' && other.snapshotId === snapshot.id && other.nodeId === nodeId)) add({ sourceKey: `node:${snapshot.id}:${nodeId}`, dimension: 'behavior', capability: 'unknown-control', minimumSeverity: 'blocking', viewport, requiredScopes: ['control'], evidence: [fact.evidence], product: false, snapshotId: snapshot.id, sourceNodeId: nodeId });
    }
  }
  for (const snapshot of source.snapshots) for (const [nodeId, node] of Object.entries(snapshot.nodes)) {
    if (!/^(?:input|textarea|select|form|button|a)$/i.test(node.tag) || Object.values(source.facts).some(fact => fact.kind === 'interaction' && fact.snapshotId === snapshot.id && fact.nodeId === nodeId)) continue;
    const capability: Native44Capability = /search/i.test(node.selector) && /^(?:input|textarea)$/i.test(node.tag) ? 'search-input' : node.tag.toLowerCase() === 'form' ? 'form-submit' : 'unknown-control';
    add({ sourceKey: `node:${snapshot.id}:${nodeId}`, dimension: 'behavior', capability, minimumSeverity: capability === 'search-input' ? 'critical' : 'blocking', viewport: snapshot.viewport.name, requiredScopes: ['control'], evidence: snapshot.evidence, product: false, snapshotId: snapshot.id, sourceNodeId: nodeId });
  }
  return result;
}

export const Native44SourceScopeEvidenceSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-source-scope-evidence'), classification: sourceScopeClassification, sourceFacts: Native44RequirementRefSchema, targetSelector: id,
  baselines: z.array(z.object({ snapshotId: id, nodeId: id, packet: Native44RequirementRefSchema, states: z.array(z.object({ triggerNodeId: id, action: z.enum(['activated', 'hovered']), packet: Native44RequirementRefSchema }).strict()).max(2000) }).strict()).max(2),
  review: z.object({ reviewer: z.literal('codex'), reviewedAt: z.iso.datetime(), judgment: z.string().trim().min(60) }).strict(),
}).strict();
export interface Native44VerifiedSourceScopes { readonly requirementsHash: string; readonly outsideSourceKeys: readonly string[]; readonly unresolved: readonly string[]; }
const verifiedSourceScopeTokens = new WeakSet<object>();
const scopeToken = (contract: Native44RequirementContract, token?: Native44VerifiedSourceScopes): readonly string[] => token && verifiedSourceScopeTokens.has(token) && token.requirementsHash === native44RequirementsHash(contract) ? token.outsideSourceKeys : [];
/** Hash-bound raw baselines and post-interaction packets are required. A hidden
 * mobile node, a false `observed` flag, or an authored label alone is insufficient. */
export async function verifyNative44SourceScopes(contractInput: unknown, source: SourceFactsV2, readEvidenceRef: (reference: z.infer<typeof Native44RequirementRefSchema>) => Promise<Uint8Array>): Promise<Native44VerifiedSourceScopes> {
  const contract = Native44RequirementContractSchema.parse(contractInput), outsideSourceKeys: string[] = [], unresolved: string[] = [], seen = new Set<string>();
  const read = async (reference: z.infer<typeof Native44RequirementRefSchema>): Promise<unknown> => { const bytes = await readEvidenceRef(reference); if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw Error('native44_source_scope_evidence_hash_changed'); return JSON.parse(Buffer.from(bytes).toString('utf8')); };
  const sameRef = (a: z.infer<typeof Native44RequirementRefSchema>, b: z.infer<typeof Native44RequirementRefSchema>) => a.path === b.path && a.sha256 === b.sha256;
  const nodeVisible = (packet: ObservationPacketV2, nodeId: string) => {
    const node = packet.nodes[nodeId], rect = node && packet.layouts[node.layoutId]?.rect;
    if (!node?.visible || !rect || rect.width <= 0 || rect.height <= 0) return false;
    const seen = new Set<string>(); let owner: typeof node | undefined = node;
    while (owner && !seen.has(owner.id)) { seen.add(owner.id); const css = packet.styles[owner.styleId]; if (!owner.visible || css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || css.opacity === '0') return false; owner = owner.parentId ? packet.nodes[owner.parentId] : undefined; }
    return true;
  };
  const outside = (packet: ObservationPacketV2, nodeId: string) => {
    const node = packet.nodes[nodeId], rect = node && packet.layouts[node.layoutId]?.rect;
    if (!node || node.visible || !rect || rect.width * rect.height !== 0) return false;
    const seen = new Set<string>(); let owner: typeof node | undefined = node;
    while (owner && !seen.has(owner.id)) { seen.add(owner.id); const css = packet.styles[owner.styleId]; if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility)) return true; owner = owner.parentId ? packet.nodes[owner.parentId] : undefined; }
    return false;
  };
  const obligations = deriveNative44SourceObligations(source, [], contract.goalProfile);
  for (const entry of contract.sourceScopes ?? []) {
    if (seen.has(entry.sourceKey)) throw Error('native44_source_scope_duplicate'); seen.add(entry.sourceKey);
    const obligation = obligations.find(row => row.sourceKey === entry.sourceKey && row.dimension === 'behavior');
    if (!obligation || !contract.requirements.some(row => row.sourceKey === entry.sourceKey && row.dimension === 'behavior')) throw Error('native44_source_scope_not_a_source_behavior');
    const proof = Native44SourceScopeEvidenceSchema.parse(await read(entry.evidence));
    if (proof.classification !== entry.classification || !sameRef(proof.sourceFacts, contract.sourceFacts)) throw Error('native44_source_scope_identity_conflict');
    if (entry.classification !== 'outside-desktop') { if (entry.classification === 'unresolved') unresolved.push(entry.sourceKey); continue; }
    let sufficient = proof.baselines.length === 2;
    const widths = new Set<number>(), baselineIds = new Set<string>();
    for (const baseline of proof.baselines) {
      const snapshot = source.snapshots.find(item => item.id === baseline.snapshotId);
      if (!snapshot || !snapshot.evidence.some(ref => sameRef(ref, baseline.packet)) || !snapshot.nodes[baseline.nodeId] || snapshot.nodes[baseline.nodeId].selector !== proof.targetSelector || baselineIds.has(baseline.snapshotId)) throw Error('native44_source_scope_baseline_unbound');
      baselineIds.add(baseline.snapshotId);
      const packet = validateObservationPacketV2(await read(baseline.packet));
      if (packet.snapshot.id !== snapshot.id || packet.snapshot.url !== source.sourceUrl || !packet.nodes[baseline.nodeId] || packet.nodes[baseline.nodeId].selector !== proof.targetSelector || Object.values(packet.nodes).filter(node => node.selector === proof.targetSelector).length !== 1 || packet.snapshot.viewport.width !== snapshot.viewport.width || packet.snapshot.viewport.height !== snapshot.viewport.height) throw Error('native44_source_scope_raw_packet_conflict');
      if (![1920, 1440].includes(snapshot.viewport.width) || snapshot.viewport.height !== (snapshot.viewport.width === 1920 ? 1080 : 1000)) sufficient = false;
      widths.add(snapshot.viewport.width); if (!outside(packet, baseline.nodeId)) sufficient = false;
      // A historical region may have been manually sharded. A partial packet
      // cannot prove that another shard has no desktop controller; keep the gap.
      const regionId = packet.nodes[baseline.nodeId].regionId;
      if (Object.values(source.facts).some(fact => fact.snapshotId === snapshot.id && fact.regionId === regionId && fact.kind === 'interaction' && !Object.values(packet.interactions).some(interaction => interaction.id === fact.value.id && interaction.nodeId === fact.nodeId))) sufficient = false;
      // Include links for their hover states: an unopened desktop menu is not
      // proof that its descendants are mobile-only. No visible control is ignored.
      const controllers = [...new Map(Object.values(packet.interactions).filter(interaction => interaction.regionId === packet.nodes[baseline.nodeId].regionId && nodeVisible(packet, interaction.nodeId)).map(interaction => [interaction.nodeId, interaction])).values()];
      const expected = controllers.flatMap(interaction => (['link', 'navigation'].includes(interaction.kind) ? ['hovered'] : ['activated', 'hovered']).map(action => `${interaction.nodeId}\0${action}`));
      const observed = new Set<string>();
      for (const state of baseline.states) {
        const stateKey = `${state.triggerNodeId}\0${state.action}`;
        if (!expected.includes(stateKey) || observed.has(stateKey)) throw Error('native44_source_scope_state_inventory_conflict'); observed.add(stateKey);
        const raw = validateObservationPacketV2(await read(state.packet));
        const matches = Object.values(raw.nodes).filter(node => node.selector === proof.targetSelector), trigger = packet.nodes[state.triggerNodeId];
        const probe = Object.values(raw.interactions).find(interaction => raw.nodes[interaction.nodeId]?.selector === trigger.selector && interaction.status === 'observed' && interaction.details.scopeProbeTargetSelector === proof.targetSelector && interaction.details.scopeProbeAction === state.action && interaction.details.scopeProbeResult === 'still-hidden');
        if (raw.snapshot.url !== source.sourceUrl || ['width', 'height', 'clientWidth', 'devicePixelRatio'].some(key => raw.snapshot.viewport[key as keyof typeof raw.snapshot.viewport] !== packet.snapshot.viewport[key as keyof typeof packet.snapshot.viewport]) || Date.parse(raw.snapshot.capturedAt) < Date.parse(packet.snapshot.capturedAt) || Date.parse(raw.snapshot.capturedAt) > Date.parse(proof.review.reviewedAt) || matches.length !== 1 || !outside(raw, matches[0].id) || !probe) sufficient = false;
      }
      if (expected.some(key => !observed.has(key))) sufficient = false;
    }
    if (widths.size !== 2 || !baselineIds.has(obligation.snapshotId!)) sufficient = false;
    const own = proof.baselines.find(item => item.snapshotId === obligation.snapshotId);
    if (!own || own.nodeId !== obligation.sourceNodeId) sufficient = false;
    (sufficient ? outsideSourceKeys : unresolved).push(entry.sourceKey);
  }
  const token: Native44VerifiedSourceScopes = Object.freeze({ requirementsHash: native44RequirementsHash(contract), outsideSourceKeys: Object.freeze(outsideSourceKeys), unresolved: Object.freeze(unresolved) }); verifiedSourceScopeTokens.add(token); return token;
}

const behaviorStates: Partial<Record<Native44Capability, string[]>> = { 'search-input': ['query-entered', 'query-submitted'], 'cart-state': ['initial', 'cart-changed'], 'carousel-next-previous': ['next', 'previous'], 'carousel-pagination': ['selected'], 'carousel-autoplay': ['advancing'], 'carousel-playback-toggle': ['paused', 'resumed'], 'form-submit': ['edited', 'submitted'], 'accordion-toggle': ['expanded', 'collapsed'], hover: ['default', 'hovered'] };
function requiredChecks(row: Native44SourceObligation): Array<{ scope: z.infer<typeof scope>; metric: string; state: string }> {
  if (row.dimension === 'behavior') return (behaviorStates[row.capability] ?? ['default']).map(state => ({ scope: 'control', metric: row.capability, state }));
  return row.requiredScopes.flatMap(scope => {
    const metrics = row.dimension === 'layout' ? scope === 'module' ? ['bounds', 'order'] : ['bounds', 'inset', 'gap', 'content-flow'] : row.dimension === 'presentation' ? ['typography', 'color', 'decoration'] : [row.dimension];
    return metrics.map(metric => ({ scope, metric, state: 'default' }));
  });
}

const integrationCapabilities = new Set<Native44Capability>(['search-input', 'cart-state', 'form-submit', 'third-party-service', 'carousel-playback-toggle']);
export const NATIVE44_COMPONENT_REFERENCE_DEFAULT_POLICY = Object.freeze({ version: 1, goalProfile: NATIVE44_COMPONENT_REFERENCE_GOAL, geometryPixels: Object.freeze({ bounds: 2, inset: 4, gap: 4 }), typographyPixels: Object.freeze({ 'font-size': 1, 'line-height': 2 }), nativeDecorationDifference: true, deferredCapabilities: Object.freeze([...integrationCapabilities]) });
const permitsOpenIntegration = (contract: Native44RequirementContract, requirement: Native44Requirement): boolean => contract.goalProfile === NATIVE44_COMPONENT_REFERENCE_GOAL && requirement.dimension === 'behavior' && integrationCapabilities.has(requirement.capability) && (requirement.capability !== 'carousel-playback-toggle' || requirement.fulfillment.route === 'gap');
function requirementDraftReady(contract: Native44RequirementContract, scopedOut: readonly string[]): boolean {
  return contract.requirements.every(requirement => requirement.fulfillment.route !== 'gap' || requirement.dimension === 'behavior' && scopedOut.includes(requirement.sourceKey) || permitsOpenIntegration(contract, requirement) || severityRank[requirement.severity] < 2);
}
export interface Native44RequirementCoverage { profile: typeof NATIVE44_REQUIREMENT_PROFILE; goalProfile?: Native44GoalProfile; requirementsHash: string; required: number; mapped: number; gaps: Array<{ requirementId: string; sourceKey: string; gapId: string; severity: Native44Requirement['severity']; reason: string; outsideDesktop?: true; blockingForDraft: boolean; state: 'unfinished' | 'pending-configuration' | 'unverified' }>; scopedOut: string[]; ready: boolean; draftReady: boolean; requirementsComplete: false; }
/** Validation permits named gaps for planning, but never marks them implemented. */
export function validateNative44Requirements(value: unknown, context: { source: SourceFactsV2; sourceUnits: Native44SourceUnit[]; components?: Native44Component[]; sourceFactsHash?: string; sourceScopes?: Native44VerifiedSourceScopes }): { contract: Native44RequirementContract; coverage: Native44RequirementCoverage } {
  const contract = Native44RequirementContractSchema.parse(value);
  if (context.sourceFactsHash && contract.sourceFacts.sha256 !== context.sourceFactsHash) throw Error('Requirement contract identifies different source facts');
  if (contract.sourceUnitsHash !== native44RequirementsHash(context.sourceUnits)) throw Error('Requirement source-unit inventory hash changed');
  const assigned = new Set<string>(), unitIds = new Set<string>();
  for (const input of context.sourceUnits) {
    const unit = SourceUnitSchema.parse(input), snapshot = context.source.snapshots.find(item => item.id === unit.snapshotId);
    if (unitIds.has(unit.id)) throw Error('Requirement inventory contains duplicate source units');
    unitIds.add(unit.id);
    const underneath = (nodeId: string) => { const seen = new Set<string>(); let current: string | null = nodeId; while (current && !seen.has(current)) { if (current === unit.ownerNodeId) return true; seen.add(current); current = snapshot?.nodes[current]?.parentId ?? null; } return false; };
    for (const id of unit.sourceFactIds) {
      const fact = context.source.facts[id];
      if (!fact || fact.snapshotId !== unit.snapshotId || fact.regionId !== unit.regionId || !underneath(fact.nodeId) || assigned.has(id)) throw Error(`Requirement inventory has duplicate, unknown or wrong-owner source facts: ${id}`);
      assigned.add(id);
    }
  }
  const uncoveredFacts = Object.values(context.source.facts).filter(fact => !assigned.has(fact.id));
  if (uncoveredFacts.length) throw Error(`Source inventory omits captured responsibilities: ${uncoveredFacts.map(fact => fact.id).join(', ')}`);
  for (const record of context.source.sourceCommerce ?? []) for (const group of record.groups.filter(group => group.status === 'catalog')) if (!context.sourceUnits.some(unit => unit.snapshotId === record.snapshotId && unit.ownerNodeId === group.ownerNodeId && isProduct(unit))) throw Error(`Actual catalog owner lacks product requirements: ${record.snapshotId}/${group.id}`);
  const obligations = deriveNative44SourceObligations(context.source, context.sourceUnits, contract.goalProfile), required = new Map(obligations.map(row => [`${row.sourceKey}\0${row.dimension}`, row]));
  const seen = new Set<string>(), ids = new Set<string>(), checks = new Set<string>();
  const components = context.components ? new Map(walkNative44(context.components).map(component => [component.key, component])) : undefined;
  for (const requirement of contract.requirements) {
    const key = `${requirement.sourceKey}\0${requirement.dimension}`, obligation = required.get(key);
    if (!obligation || seen.has(key) || ids.has(requirement.id)) throw Error(`Requirement has unknown/duplicate source obligation: ${requirement.id}`);
    seen.add(key); ids.add(requirement.id);
    if (requirement.capability !== obligation.capability || severityRank[requirement.severity] < severityRank[obligation.minimumSeverity]) throw Error(`Requirement weakens a source capability or severity: ${requirement.id}`);
    if (requirement.disposition === 'target-product-data' && (requirement.dimension !== 'data' || !obligation.product)) throw Error('Product substitution exempts only specific product data; presence, native editing, layout, behavior and authenticity remain required');
    for (const item of requirement.checks) {
      if (checks.has(item.id) || item.viewport !== obligation.viewport || item.sourceEvidence.some(ref => !obligation.evidence.some(source => source.path === ref.path && source.sha256 === ref.sha256))) throw Error(`Requirement check has duplicate identity or unbound source evidence/viewport: ${item.id}`);
      checks.add(item.id);
    }
    if (requiredChecks(obligation).some(expected => !requirement.checks.some(item => item.scope === expected.scope && item.metric === expected.metric && item.state === expected.state))) throw Error(`Requirement omits inner content/item/control or interaction-state acceptance coverage: ${requirement.id}`);
    const mapping = requirement.fulfillment;
    if (mapping.route === 'gap' && mapping.componentKeys && (new Set(mapping.componentKeys).size !== mapping.componentKeys.length || components && mapping.componentKeys.some(key => !components.has(key)))) throw Error(`Named gap has duplicate/unknown component ownership: ${requirement.id}`);
    if (mapping.route !== 'gap') {
      if (mapping.capability !== requirement.capability || mapping.capability === 'unknown-control') throw Error(`Capability substitution cannot satisfy the source responsibility: ${requirement.id}`);
      if (new Set(mapping.componentKeys).size !== mapping.componentKeys.length || components && mapping.componentKeys.some(key => !components.has(key))) throw Error(`Requirement mapping refers to duplicate/unknown components: ${requirement.id}`);
      if (mapping.route === 'verified-native' && mapping.componentKeys.length !== 1 || mapping.route === 'native-composition' && mapping.componentKeys.length < 2) throw Error(`Requirement mapping route differs from its native composition: ${requirement.id}`);
      if (components && requirement.dimension === 'editability' && mapping.componentKeys.some(key => components.get(key)?.kind === 'html-static')) throw Error(`Native editability cannot be supplied by static HTML: ${requirement.id}`);
      if (components && obligation.product && ['data', 'authenticity'].includes(requirement.dimension) && !mapping.componentKeys.some(key => components.get(key)?.kind === 'native-products')) throw Error(`Product data/authenticity requires a real native product query: ${requirement.id}`);
      if (components && requirement.capability === 'search-input' && mapping.componentKeys.every(key => ['button', 'link', 'icon'].includes(components.get(key)?.role ?? ''))) throw Error('A button or link is not an editable search input');
    }
  }
  const missing = [...required].filter(([key]) => !seen.has(key)).map(([, row]) => `${row.sourceKey}/${row.dimension}`);
  if (missing.length) throw Error(`Source requirements missing from coverage: ${missing.join(', ')}`);
  const scopedOut = [...scopeToken(contract, context.sourceScopes)], gaps = contract.requirements.flatMap(requirement => requirement.fulfillment.route === 'gap' ? [{ requirementId: requirement.id, sourceKey: requirement.sourceKey, gapId: requirement.fulfillment.gapId, severity: requirement.severity, reason: requirement.fulfillment.reason, state: requirement.fulfillment.state ?? 'unfinished' as const, blockingForDraft: severityRank[requirement.severity] >= 2 && !permitsOpenIntegration(contract, requirement) && !(requirement.dimension === 'behavior' && scopedOut.includes(requirement.sourceKey)), ...(requirement.dimension === 'behavior' && scopedOut.includes(requirement.sourceKey) ? { outsideDesktop: true as const } : {}) }] : []);
  const draftReady = requirementDraftReady(contract, scopedOut);
  return { contract, coverage: { profile: NATIVE44_REQUIREMENT_PROFILE, ...(contract.goalProfile ? { goalProfile: contract.goalProfile } : {}), requirementsHash: native44RequirementsHash(contract), required: required.size, mapped: contract.requirements.length - gaps.length, gaps, scopedOut, ready: draftReady, draftReady, requirementsComplete: false } };
}

const proofAssertions: Record<Native44Capability, readonly string[]> = {
  'render-content': ['contentPresent'], 'editable-native': ['nativeControlsEditable'], 'render-layout': ['layoutControlsAvailable'], 'render-presentation': ['presentationControlsAvailable'], 'target-product-data': ['realTargetProductQuery'], 'authentic-business': ['businessFactsVerified'], navigate: ['actualHref'],
  'search-input': ['editableInput', 'acceptsQuery', 'submitsQuery'], 'cart-state': ['dynamicCount', 'countChangesAfterCartChange'], 'carousel-next-previous': ['nextMovesItems', 'previousMovesItems'], 'carousel-pagination': ['paginationSelectsSlide'], 'carousel-autoplay': ['advancesWithoutUserAction'], 'carousel-playback-toggle': ['userCanPause', 'userCanResume', 'pausedStateStopsAdvancing'], 'form-submit': ['editableFields', 'realSubmission'], 'third-party-service': ['serviceConnected', 'serviceResponds'], 'accordion-toggle': ['expands', 'collapses'], hover: ['hoverStateChanges'], 'input-control': ['editableInput', 'valueChanges'], 'unknown-control': [],
};
export function assertNative44CapabilityProof(requirement: Native44Requirement, input: unknown, components: Native44Component[]): Native44CapabilityProof {
  const proof = Native44CapabilityProofSchema.parse(input), mapping = requirement.fulfillment;
  if (mapping.route === 'gap' || proof.capability !== requirement.capability || proof.capability === 'unknown-control') throw Error(`Capability proof does not prove the required source behavior: ${requirement.id}`);
  const nodes = new Map(walkNative44(components).map(node => [node.key, node]));
  if (proof.components.length !== mapping.componentKeys.length || new Set(proof.components.map(item => item.key)).size !== proof.components.length || proof.components.some(item => {
    const node = nodes.get(item.key); return !mapping.componentKeys.includes(item.key) || !node || item.widgetType !== ('widgetType' in node ? node.widgetType : node.kind === 'composite' ? 'container' : 'html') || item.settingsHash !== native44CapabilitySettingsHash(node);
  })) throw Error(`Capability proof is stale or identifies different native components: ${requirement.id}`);
  if (proofAssertions[proof.capability].some(name => proof.observations[name] !== true)) throw Error(`Capability proof lacks actual semantic observations: ${requirement.id}`);
  if (requirement.dimension === 'behavior' && !['interaction-probe', 'composition-probe'].includes(proof.method)) throw Error(`A registered setting alone is not a verified interaction: ${requirement.id}`);
  return proof;
}
export const native44CapabilitySettingsHash = (node: Native44Component): string => native44RequirementsHash({ settings: node.settings ?? {}, widgetSettings: 'widgetSettings' in node ? node.widgetSettings : {}, ...(node.kind === 'native-products' ? { query: node.query, tabs: node.tabs } : node.kind === 'native-posts' || node.kind === 'native-categories' || node.kind === 'native-related-products' ? { query: node.query } : {}) });

export function createNative44RequirementContract(source: SourceFactsV2, sourceUnits: Native44SourceUnit[], sourceFacts: z.infer<typeof Native44RequirementRefSchema>, taskId: string, options: { goalProfile?: Native44GoalProfile } = {}): Native44RequirementContract {
  const requirements = deriveNative44SourceObligations(source, sourceUnits, options.goalProfile).map((row, index): Native44Requirement => ({
    id: `requirement-${index + 1}`, sourceKey: row.sourceKey, dimension: row.dimension, capability: row.capability, severity: row.minimumSeverity,
    disposition: row.product && row.dimension === 'data' ? 'target-product-data' : 'preserve',
    checks: requiredChecks(row).map((specification, checkIndex) => ({ id: `requirement-${index + 1}-check-${checkIndex + 1}`, viewport: row.viewport, ...specification, sourceEvidence: [row.evidence[0]] })),
    fulfillment: { route: 'gap', gapId: `unmapped-${index + 1}`, reason: 'Source responsibility has not yet been mapped to a verified native capability.', ...(options.goalProfile ? { state: 'unfinished' as const } : {}) },
  }));
  return Native44RequirementContractSchema.parse({ version: 1, kind: 'native44-requirements', profile: NATIVE44_REQUIREMENT_PROFILE, ...(options.goalProfile ? { goalProfile: options.goalProfile } : {}), taskId, sourceFacts, sourceUnitsHash: native44RequirementsHash(sourceUnits), requirements });
}

export interface Native44RequirementFinding {
  severity: Native44Requirement['severity']; requirementId: string; checkId?: string; sourceKey: string; componentKeys: string[];
  location: { viewport?: string; state?: string; scope?: z.infer<typeof scope>; metric?: string };
  category: 'unfinished' | 'minor' | 'unverified' | 'blocking'; domain: 'quality' | 'requirement' | 'product-substitution' | 'component-exception';
  impact: string; nextAction: string; evidence: Array<z.infer<typeof Native44RequirementRefSchema>>; delta?: { value: number; unit: string; property?: string };
}
export interface Native44AcceptanceResult {
  status: 'satisfied' | 'satisfied-with-deviations' | 'satisfied-with-open-items' | 'blocked' | 'pending' | 'stale'; verdict: 'pass' | 'pass-with-deviations' | 'pass-with-open-items' | 'needs-work'; delivery: 'delivered' | 'delivered-with-deviations' | 'delivered-with-open-items' | 'pending';
  issues: Array<{ requirementId: string; checkId?: string; code: string; message: string }>; deviations: Array<{ requirementId: string; checkId?: string; reason: string; basis: 'tolerance' | 'accepted-deviation' | 'component-reference-default' }>;
  scopedOut: string[]; draftReady: boolean; requirementsComplete: boolean;
  qualityFloor: { status: 'passed' | 'blocked' | 'unverified' | 'stale'; issues: Native44RequirementFinding[] };
  findings: Native44RequirementFinding[];
  productSubstitutions: Native44RequirementFinding[]; componentExceptions: Native44RequirementFinding[];
}
const requirementComponents = (requirement?: Native44Requirement): string[] => requirement?.fulfillment.componentKeys ?? [];
function finding(contract: Native44RequirementContract, issue: Native44AcceptanceResult['issues'][number], observation?: Native44AcceptanceObservation, category: Native44RequirementFinding['category'] = issue.code === 'unverified' ? 'unverified' : 'blocking', domain: Native44RequirementFinding['domain'] = 'quality'): Native44RequirementFinding {
  const requirement = contract.requirements.find(item => item.id === issue.requirementId), check = requirement?.checks.find(item => item.id === issue.checkId), observed = observation?.checks.find(item => item.requirementId === issue.requirementId && item.checkId === issue.checkId);
  return { requirementId: issue.requirementId, ...(issue.checkId ? { checkId: issue.checkId } : {}), sourceKey: requirement?.sourceKey ?? '*', componentKeys: requirementComponents(requirement), severity: observed?.issue?.severity ?? (category === 'minor' ? 'minor' : requirement?.severity ?? 'blocking'), location: check ? { viewport: check.viewport, state: check.state, scope: check.scope, metric: check.metric } : {}, category, domain, impact: issue.message, nextAction: category === 'minor' ? 'Recorded under the frozen acceptance policy; keep the native component editable.' : category === 'unverified' ? 'Observe this exact source responsibility on the current document and attach the result.' : category === 'unfinished' ? 'Configure or connect the named feature, then verify it without claiming it is already complete.' : 'Repair the named quality or native capability failure and verify it again.', evidence: observed?.evidence ?? [], ...(observed?.issue?.delta !== undefined && observed.issue.unit ? { delta: { value: observed.issue.delta, unit: observed.issue.unit, ...(observed.issue.property ? { property: observed.issue.property } : {}) } } : {}) };
}
function summaries(contract: Native44RequirementContract, observation?: Native44AcceptanceObservation): Pick<Native44AcceptanceResult, 'productSubstitutions' | 'componentExceptions'> {
  const rows = (predicate: (requirement: Native44Requirement) => boolean, domain: Native44RequirementFinding['domain']) => contract.requirements.filter(predicate).map(requirement => ({ ...finding(contract, { requirementId: requirement.id, checkId: requirement.checks[0].id, code: 'policy-record', message: domain === 'product-substitution' ? 'Specific product data may use real target WooCommerce products; card layout and behavior remain required.' : requirement.fulfillment.route === 'explicit-adaptation' ? requirement.fulfillment.reason : 'Native component adaptation.' }, observation, 'minor', domain), evidence: observation?.checks.filter(item => item.requirementId === requirement.id).flatMap(item => item.evidence) ?? [] }));
  return { productSubstitutions: rows(requirement => requirement.disposition === 'target-product-data', 'product-substitution'), componentExceptions: rows(requirement => requirement.fulfillment.route === 'explicit-adaptation', 'component-exception') };
}
/** A current review stays a current review even when this independent delivery decision is blocked. */
function evaluateStrictNative44Acceptance(contractInput: unknown, policyInput: unknown, observationInput: unknown | undefined, current: { documentHash: string; cssHash: string; sourceScopes?: Native44VerifiedSourceScopes }): Native44AcceptanceResult {
  const contract = Native44RequirementContractSchema.parse(contractInput), policy = Native44AcceptancePolicySchema.parse(policyInput), requirementsHash = native44RequirementsHash(contract);
  hash.parse(current.documentHash); hash.parse(current.cssHash);
  const issues: Native44AcceptanceResult['issues'] = [], deviations: Native44AcceptanceResult['deviations'] = [];
  const scopedOut = [...scopeToken(contract, current.sourceScopes)];
  const done = (status: Native44AcceptanceResult['status']): Native44AcceptanceResult => {
    const observed = observationInput === undefined ? undefined : Native44AcceptanceObservationSchema.parse(observationInput), findings = issues.map(issue => finding(contract, issue, observed));
    const qualityStatus = status === 'stale' ? 'stale' : status === 'pending' || findings.length > 0 && findings.every(item => item.category === 'unverified') ? 'unverified' : issues.length ? 'blocked' : 'passed';
    return { status, verdict: status === 'satisfied' ? 'pass' : status === 'satisfied-with-deviations' ? 'pass-with-deviations' : 'needs-work', delivery: status === 'satisfied' ? 'delivered' : status === 'satisfied-with-deviations' ? 'delivered-with-deviations' : 'pending', issues, deviations, scopedOut, draftReady: requirementDraftReady(contract, scopedOut), requirementsComplete: status === 'satisfied' || status === 'satisfied-with-deviations', qualityFloor: { status: qualityStatus, issues: findings }, findings, ...summaries(contract, observed) };
  };
  if (policy.requirementsHash !== requirementsHash) { issues.push({ requirementId: '*', code: 'policy-stale', message: 'Acceptance policy identifies different requirements' }); return done('stale'); }
  const requirements = new Map(contract.requirements.map(item => [item.id, item])), expected = new Map(contract.requirements.flatMap(requirement => requirement.checks.map(check => [check.id, { requirement, check }] as const)));
  if (requirements.size !== contract.requirements.length || expected.size !== contract.requirements.reduce((count, item) => count + item.checks.length, 0)) throw Error('Acceptance contract contains duplicate identities');
  const toleranceIds = new Set<string>(), acceptedIds = new Set<string>();
  for (const tolerance of policy.tolerances) {
    const row = expected.get(tolerance.checkId);
    if (!row || toleranceIds.has(tolerance.checkId) || severityRank[row.requirement.severity] >= 2 || !['layout', 'presentation'].includes(row.requirement.dimension)) throw Error('Only unique minor geometry/presentation checks may have numeric tolerance');
    toleranceIds.add(tolerance.checkId);
  }
  for (const deviation of policy.acceptedDeviations) {
    const requirement = requirements.get(deviation.requirementId);
    if (!requirement || severityRank[requirement.severity] >= 2 || !['layout', 'presentation', 'data'].includes(requirement.dimension)) throw Error('Critical, structural, native editing and business requirements cannot be waived by an accepted deviation');
    for (const id of deviation.checkIds) {
      if (!requirement.checks.some(check => check.id === id) || acceptedIds.has(id)) throw Error('Accepted deviation has an unknown/duplicate check or wrong requirement');
      acceptedIds.add(id);
    }
  }
  if (observationInput === undefined) return done('pending');
  const observation = Native44AcceptanceObservationSchema.parse(observationInput);
  if (observation.requirementsHash !== requirementsHash || observation.documentHash !== current.documentHash || observation.cssHash !== current.cssHash) { issues.push({ requirementId: '*', code: 'observation-stale', message: 'Review does not identify the current document, CSS and requirements' }); return done('stale'); }
  const observed = new Map<string, Native44AcceptanceObservation['checks'][number]>();
  for (const item of observation.checks) {
    const row = expected.get(item.checkId);
    if (!row || row.requirement.id !== item.requirementId || observed.has(item.checkId)) throw Error('Acceptance observation has unknown, wrong-owner or duplicate checks');
    if (item.outcome === 'pass' && item.issue || item.outcome === 'fail' && !item.issue) throw Error('Acceptance outcome and issue disagree');
    observed.set(item.checkId, item);
  }
  for (const requirement of contract.requirements) {
    if (requirement.dimension === 'behavior' && scopedOut.includes(requirement.sourceKey)) continue;
    if (requirement.fulfillment.route === 'gap') issues.push({ requirementId: requirement.id, code: 'capability-gap', message: `${requirement.fulfillment.gapId}: ${requirement.fulfillment.reason}` });
    for (const check of requirement.checks) {
      const item = observed.get(check.id);
      if (!item || item.outcome === 'unverified') { issues.push({ requirementId: requirement.id, checkId: check.id, code: 'unverified', message: 'Required source check lacks current observed evidence' }); continue; }
      if (item.outcome === 'pass') continue;
      const issue = item.issue!, hard = severityRank[requirement.severity] >= 2 || issue.severity !== undefined && severityRank[issue.severity] >= 2 || ['structure', 'overflow', 'fake-business', 'editability', 'behavior', 'capability'].includes(issue.category) || ['order', 'content-flow'].includes(check.metric) || !['layout', 'presentation', 'data'].includes(requirement.dimension);
      const accepted = policy.acceptedDeviations.find(deviation => deviation.requirementId === requirement.id && deviation.checkIds.includes(check.id));
      const tolerance = policy.tolerances.find(tolerance => tolerance.checkId === check.id);
      if (!hard && accepted) deviations.push({ requirementId: requirement.id, checkId: check.id, reason: accepted.reason, basis: 'accepted-deviation' });
      else if (!hard && ['geometry', 'presentation'].includes(issue.category) && tolerance && issue.delta !== undefined && issue.unit === tolerance.unit && issue.delta <= tolerance.maxDelta) deviations.push({ requirementId: requirement.id, checkId: check.id, reason: tolerance.reason, basis: 'tolerance' });
      else issues.push({ requirementId: requirement.id, checkId: check.id, code: issue.category, message: issue.message });
    }
  }
  return done(issues.length ? 'blocked' : deviations.length ? 'satisfied-with-deviations' : 'satisfied');
}

function isRequiredQualityCheck(requirement: Native44Requirement, check?: Native44Requirement['checks'][number]): boolean {
  if (['presence', 'editability', 'data', 'authenticity'].includes(requirement.dimension)) return true;
  if (requirement.dimension === 'behavior') return !integrationCapabilities.has(requirement.capability) || requirement.capability === 'carousel-playback-toggle' && requirement.fulfillment.route !== 'gap';
  if (requirement.dimension === 'layout') return !check || ['bounds', 'order', 'content-flow'].includes(check.metric);
  return !check || check.metric === 'typography';
}
function defaultMinor(contract: Native44RequirementContract, requirement: Native44Requirement, check: Native44Requirement['checks'][number] | undefined, item: Native44AcceptanceObservation['checks'][number] | undefined): boolean {
  if (!check || !item?.issue || requirement.fulfillment.route === 'gap' || severityRank[requirement.severity] >= 2 || item.issue.severity !== undefined && severityRank[item.issue.severity] >= 2) return false;
  const issue = item.issue;
  if (requirement.dimension === 'layout' && issue.category === 'geometry' && issue.unit === 'px' && issue.delta !== undefined) {
    const tolerance = NATIVE44_COMPONENT_REFERENCE_DEFAULT_POLICY.geometryPixels[check.metric as keyof typeof NATIVE44_COMPONENT_REFERENCE_DEFAULT_POLICY.geometryPixels];
    return tolerance !== undefined && issue.delta <= tolerance;
  }
  if (requirement.dimension === 'presentation' && check.metric === 'typography' && ['presentation', 'geometry'].includes(issue.category) && issue.unit === 'px' && issue.delta !== undefined && issue.property) {
    const tolerance = NATIVE44_COMPONENT_REFERENCE_DEFAULT_POLICY.typographyPixels[issue.property as keyof typeof NATIVE44_COMPONENT_REFERENCE_DEFAULT_POLICY.typographyPixels];
    return tolerance !== undefined && issue.delta <= tolerance;
  }
  return contract.goalProfile === NATIVE44_COMPONENT_REFERENCE_GOAL && requirement.dimension === 'presentation' && check.metric === 'decoration' && (issue.category === 'native-decoration' || issue.category === 'presentation' && issue.nativeDifference === 'decoration');
}
function finishComponentReference(result: Native44AcceptanceResult): Native44AcceptanceResult {
  if (result.status === 'stale' || result.status === 'pending') return result;
  const quality = result.findings.filter(item => item.domain === 'quality' && ['blocking', 'unverified'].includes(item.category));
  result.qualityFloor = { status: quality.some(item => item.category === 'blocking') ? 'blocked' : quality.length ? 'unverified' : 'passed', issues: quality };
  const open = result.findings.some(item => ['unfinished', 'unverified'].includes(item.category));
  result.requirementsComplete = !open && !quality.length;
  if (quality.length) { result.status = 'blocked'; result.verdict = 'needs-work'; result.delivery = 'pending'; }
  else if (open) { result.status = 'satisfied-with-open-items'; result.verdict = 'pass-with-open-items'; result.delivery = 'delivered-with-open-items'; }
  else if (result.deviations.length) { result.status = 'satisfied-with-deviations'; result.verdict = 'pass-with-deviations'; result.delivery = 'delivered-with-deviations'; }
  else { result.status = 'satisfied'; result.verdict = 'pass'; result.delivery = 'delivered'; }
  return result;
}

/** Explicit component-reference policy retains the full source list, while
 * separating an editable draft, the quality floor and business integration work. */
export function evaluateNative44Acceptance(contractInput: unknown, policyInput: unknown, observationInput: unknown | undefined, current: { documentHash: string; cssHash: string; sourceScopes?: Native44VerifiedSourceScopes }): Native44AcceptanceResult {
  const contract = Native44RequirementContractSchema.parse(contractInput), base = evaluateStrictNative44Acceptance(contract, policyInput, observationInput, current);
  if (contract.goalProfile !== NATIVE44_COMPONENT_REFERENCE_GOAL || base.status === 'stale') return base;
  const observation = observationInput === undefined ? undefined : Native44AcceptanceObservationSchema.parse(observationInput), findings: Native44RequirementFinding[] = [], issues: Native44AcceptanceResult['issues'] = [];
  const candidates: Native44AcceptanceResult['issues'] = base.status === 'pending' ? contract.requirements.filter(requirement => !(requirement.dimension === 'behavior' && base.scopedOut.includes(requirement.sourceKey))).flatMap(requirement => [ ...(requirement.fulfillment.route === 'gap' ? [{ requirementId: requirement.id, code: 'capability-gap', message: `${requirement.fulfillment.gapId}: ${requirement.fulfillment.reason}` }] : []), ...requirement.checks.map(check => ({ requirementId: requirement.id, checkId: check.id, code: 'unverified', message: 'Required source check has not been observed on the current draft.' })) ]) : base.issues;
  for (const issue of candidates) {
    const requirement = contract.requirements.find(item => item.id === issue.requirementId), check = requirement?.checks.find(item => item.id === issue.checkId), observed = observation?.checks.find(item => item.requirementId === issue.requirementId && item.checkId === issue.checkId);
    const fatal = ['structure', 'overflow', 'fake-business', 'editability'].includes(issue.code) || observed?.issue?.severity !== undefined && severityRank[observed.issue.severity] >= 2;
    if (requirement && !fatal && permitsOpenIntegration(contract, requirement)) {
      const unverified = issue.code === 'unverified' || requirement.fulfillment.route === 'gap' && requirement.fulfillment.state === 'unverified';
      findings.push(finding(contract, issue, observation, unverified ? 'unverified' : 'unfinished', 'requirement'));
    } else if (requirement && issue.code === 'unverified' && !isRequiredQualityCheck(requirement, check)) findings.push(finding(contract, issue, observation, 'unverified', 'requirement'));
    else if (requirement && defaultMinor(contract, requirement, check, observed)) {
      base.deviations.push({ requirementId: requirement.id, checkId: issue.checkId, reason: issue.message, basis: 'component-reference-default' });
      findings.push(finding(contract, issue, observation, 'minor', 'quality'));
    } else { issues.push(issue); findings.push(finding(contract, issue, observation)); }
  }
  for (const deviation of base.deviations.filter(item => item.basis !== 'component-reference-default')) findings.push(finding(contract, { requirementId: deviation.requirementId, checkId: deviation.checkId, code: deviation.basis, message: deviation.reason }, observation, 'minor', 'quality'));
  const result: Native44AcceptanceResult = { ...base, findings, issues, qualityFloor: { status: base.status === 'pending' ? 'unverified' : 'passed', issues: [] }, requirementsComplete: false };
  if (result.status === 'pending') result.qualityFloor.issues = findings.filter(item => item.domain === 'quality');
  return finishComponentReference(result);
}

export interface Native44ActualCheckResult {
  kind: 'product-query' | 'post-query' | 'interaction'; requirementId?: string; componentKey?: string; widgetType?: string; selector?: string; collectionPath?: string; viewport: string;
  status: 'passed' | 'failed' | 'blocked' | 'unverified' | 'skipped' | 'missing'; problems: string[]; evidence?: Array<z.infer<typeof Native44RequirementRefSchema>>;
  category?: 'structure' | 'overflow' | 'fake-business' | 'editability';
}
/** Shared owner-aware policy for actual current report checks. Unknown owners
 * stay blocking; product query failures are never downgraded to configuration. */
export function applyNative44ActualCheckResults(contractInput: unknown, policyInput: unknown, acceptance: Native44AcceptanceResult, checks: Native44ActualCheckResult[]): Native44AcceptanceResult {
  const contract = Native44RequirementContractSchema.parse(contractInput), policy = Native44AcceptancePolicySchema.parse(policyInput);
  if (policy.requirementsHash !== native44RequirementsHash(contract)) throw Error('Actual check policy is stale');
  const result = structuredClone(acceptance), componentReference = contract.goalProfile === NATIVE44_COMPONENT_REFERENCE_GOAL;
  for (const actual of checks.filter(item => item.status !== 'passed')) {
    const candidates = contract.requirements.filter(requirement => actual.requirementId ? requirement.id === actual.requirementId && (!actual.componentKey || requirementComponents(requirement).includes(actual.componentKey)) : !!actual.componentKey && requirementComponents(requirement).includes(actual.componentKey));
    const requirement = candidates.find(item => actual.kind !== 'interaction' ? ['data', 'authenticity'].includes(item.dimension) : item.dimension === 'behavior');
    const issue = { requirementId: requirement?.id ?? '*', code: `actual-${actual.kind}-${actual.status}`, message: actual.problems.join('; ') || `Actual ${actual.kind} check is ${actual.status}` };
    const pending = componentReference && actual.kind === 'interaction' && !!requirement && permitsOpenIntegration(contract, requirement) && !actual.category;
    const category = pending ? ['unverified', 'skipped', 'missing'].includes(actual.status) ? 'unverified' as const : 'unfinished' as const : ['unverified', 'skipped', 'missing'].includes(actual.status) ? 'unverified' as const : 'blocking' as const;
    const item = finding(contract, issue, undefined, category, pending ? 'requirement' : 'quality'); item.location.viewport = actual.viewport; item.evidence = actual.evidence ?? []; if (actual.componentKey && !item.componentKeys.length) item.componentKeys = [actual.componentKey];
    result.findings.push(item); if (!pending) result.issues.push(issue);
    result.requirementsComplete = false;
    if (!pending && (actual.kind !== 'interaction' || requirement?.dimension === 'behavior')) result.draftReady = false;
  }
  if (componentReference) return finishComponentReference(result);
  const failures = result.findings.filter(item => item.domain === 'quality' && ['blocking', 'unverified'].includes(item.category));
  if (failures.length && result.status !== 'stale' && result.status !== 'pending') { result.status = 'blocked'; result.verdict = 'needs-work'; result.delivery = 'pending'; result.qualityFloor = { status: failures.some(item => item.category === 'blocking') ? 'blocked' : 'unverified', issues: failures }; }
  return result;
}

/** Advisory only. A revision budget never turns a blocking result into a pass. */
export function adviseNative44Convergence(history: Array<{ documentHash: string; blockingIssueIds: string[]; weightedError: number }>): { recommendation: 'continue' | 'revisit-model'; reason: string; rounds: number } {
  for (const item of history) { hash.parse(item.documentHash); if (!Number.isFinite(item.weightedError) || item.weightedError < 0) throw Error('Convergence history requires finite nonnegative measured error'); }
  const recent = history.slice(-3), unchanged = recent.length === 3 && recent.every(item => canonical([...new Set(item.blockingIssueIds)].sort()) === canonical([...new Set(recent[0].blockingIssueIds)].sort())) && recent[0].blockingIssueIds.length > 0;
  const noGain = recent.length === 3 && recent[2].weightedError >= recent[0].weightedError * .98;
  return { recommendation: unchanged || noGain ? 'revisit-model' : 'continue', reason: unchanged ? 'The same blocking responsibilities survived three revisions; revisit capability, structure or source ownership before adding overrides.' : noGain ? 'Three revisions produced less than 2% measured improvement; revisit the model before another patch.' : 'Continue with evidence-bound corrections; delivery still depends on acceptance.', rounds: history.length };
}

export const native44RequirementsJsonSchemas = () => ({ requirements: z.toJSONSchema(Native44RequirementContractSchema), capabilityProof: z.toJSONSchema(Native44CapabilityProofSchema), sourceScope: z.toJSONSchema(Native44SourceScopeEvidenceSchema), policy: z.toJSONSchema(Native44AcceptancePolicySchema), observation: z.toJSONSchema(Native44AcceptanceObservationSchema), profile: z.toJSONSchema(Native44RequirementProfileSchema) });

import { z } from 'zod';
import { validateSourceFactsV2, type SourceFactsV2 } from './source.js';
import { bindSceneInventoryNodesV2, validateSceneInventoryV2, type SceneInventoryV2 } from './scene-inventory.js';
import { DesktopSelectionFields } from '../native44/selection-types.js';
import { Native44RequirementContractSchema, validateNative44Requirements } from '../native44/requirements.js';

const id = z.string().min(1).max(240);
const fileRef = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]));
export const ComponentPlanV2Schema = z.object({
  version: z.literal(2), kind: z.literal('component-plan'), sourceFacts: fileRef, desktopSnapshotId: id,
  ...DesktopSelectionFields,
  requirementContract: Native44RequirementContractSchema.optional(),
  components: z.array(z.object({ id, parentId: id.nullable(), role: z.string().min(1), renderer: z.enum(['native', 'html', 'carousel', 'products', 'composite']), editability: z.enum(['controls', 'code', 'woocommerce', 'mixed']), sourceRegionIds: z.array(id).min(1), sourceNodeIds: z.array(id).optional(), itemSlots: z.array(z.object({ id, nodeIds: z.array(id).min(1) }).strict()).optional(), variants: z.array(z.object({ snapshotId: id, nodeIds: z.array(id).min(1), visible: z.boolean() }).strict()).min(1), firstFold: z.boolean().optional() }).strict()).min(1),
  requirements: z.array(z.object({ id, factIds: z.array(id).min(1), componentId: id, disposition: z.enum(['preserve', 'adapt', 'external']), rule: z.string().min(1), verification: z.object({ kind: z.enum(['text', 'media', 'layout', 'interaction', 'external', 'presence']), selector: z.string().min(1), property: z.string().optional(), expected: jsonValue.optional(), tolerance: z.number().finite().nonnegative().optional(), snapshotId: id.optional(), viewport: z.string().min(1).optional() }).strict() }).strict()).min(1),
  // Optional for historical decoding only. Current desktop selection requires
  // an explicit whole-area instruction, rather than later item configuration.
  catalogDeferrals: z.array(z.object({ snapshotId: id, groupId: id, componentId: id, reason: z.string().min(20), scope: fileRef, userRequestedOmission: z.enum(['leave-product-area-empty', 'remove-product-area']).optional() }).strict()).optional(),
  gapResolutions: z.array(z.object({ snapshotId: id, code: z.string().min(1), nodeId: id.optional(), componentId: id, rule: z.string().min(1), requirementId: id }).strict()).optional(),
  inventoryResolutions: z.array(z.object({ snapshotId: id, entryIds: z.array(id).min(1), componentId: id, rule: z.string().min(1), requirementId: id }).strict()).optional(),
}).strict().superRefine((plan, context) => {
  const fields = ['selectionRulesHash', 'sourceUnits', 'selectionDecisions', 'selectionReview'] as const;
  if (!plan.replicationProfile && fields.some(field => plan[field] !== undefined)) context.addIssue({ code: 'custom', message: 'Selection fields require the explicit desktop-browser-v1 profile; historical plans are not upgraded' });
  if (plan.replicationProfile) for (const field of fields) if (plan[field] === undefined) context.addIssue({ code: 'custom', path: [field], message: 'Desktop browser plans require the complete selection contract' });
  if (plan.requirementContract && (!plan.replicationProfile || !plan.sourceUnits)) context.addIssue({ code: 'custom', path: ['requirementContract'], message: 'Source requirements require explicit desktop source units; historical plans are not upgraded' });
});
export type ComponentPlanV2 = z.infer<typeof ComponentPlanV2Schema>;
export type ComponentV2 = ComponentPlanV2['components'][number];
export type RequirementV2 = ComponentPlanV2['requirements'][number];

/** Privacy omission records an intentionally unexported destination, not a
 * repaired capture or evidence that the destination works. */
export const TRANSIENT_PRIVATE_LINK_OMISSION_RULE = 'User privacy rule: the actual source transient private destination is omitted and is not rendered; destination behavior remains unverified.';

/** Codex authors renderer decisions; independently inferred commerce facts and
 * actual source ownership constrain which decisions are valid. */
export function validateComponentPlanV2(value: unknown, sourceInput: SourceFactsV2, options: { stage?: 'desktop' | 'responsive' | 'final'; sceneInventories?: SceneInventoryV2[]; replicationProfile?: 'desktop-browser-v1' } = {}): ComponentPlanV2 {
  const source = validateSourceFactsV2(sourceInput), result = ComponentPlanV2Schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid ComponentPlanV2: ${result.error.message}`);
  const plan = result.data, components = new Map(plan.components.map(component => [component.id, component])), snapshots = new Map(source.snapshots.map(snapshot => [snapshot.id, snapshot]));
  if (plan.requirementContract) validateNative44Requirements(plan.requirementContract, { source, sourceUnits: plan.sourceUnits!, sourceFactsHash: plan.sourceFacts.sha256 });
  const deferred = new Map<string, NonNullable<ComponentPlanV2['catalogDeferrals']>[number]>();
  for (const item of plan.catalogDeferrals ?? []) {
    const identity = `${item.snapshotId}:${item.groupId}`;
    const group = source.sourceCommerce?.filter(record => record.snapshotId === item.snapshotId).flatMap(record => record.groups).find(group => group.id === item.groupId && group.status === 'catalog');
    const component = components.get(item.componentId);
    if (plan.replicationProfile !== 'desktop-browser-v1' || !group || !component || component.renderer !== 'composite' || !component.variants.some(variant => variant.snapshotId === item.snapshotId && variant.nodeIds.includes(group.ownerNodeId)) || deferred.has(identity)) throw Error('Catalog deferral requires a unique actual catalog owner and an explicit native placeholder');
    deferred.set(identity, item);
  }
  if (plan.replicationProfile !== options.replicationProfile) throw new Error('Component plan profile must match the explicitly selected execution path');
  if (components.size !== plan.components.length) throw new Error('Duplicate component ID');
  if (new Set(plan.requirements.map(requirement => requirement.id)).size !== plan.requirements.length) throw new Error('Duplicate requirement ID');
  const desktop = snapshots.get(plan.desktopSnapshotId);
  if (!desktop || desktop.viewport.name !== 'desktop' && !(plan.replicationProfile === 'desktop-browser-v1' && desktop.viewport.name === 'desktop-wide')) throw new Error('Component plan must identify the real desktop snapshot');
  const regions = new Set(Object.values(source.facts).filter(fact => fact.kind === 'region').map(fact => fact.regionId));
  const nodes = new Map(source.snapshots.map(snapshot => [snapshot.id, new Set(Object.keys(snapshot.nodes))]));
  const owners = (component: ComponentV2): Set<string> => { const owned = new Set(component.sourceRegionIds), seen = new Set<string>([component.id]); let parentId = component.parentId; while (parentId) { if (seen.has(parentId)) throw new Error(`Cyclic component ancestry: ${component.id}`); seen.add(parentId); const parent = components.get(parentId); if (!parent) throw new Error(`Component ${component.id}: unknown parent ${parentId}`); parent.sourceRegionIds.forEach(region => owned.add(region)); parentId = parent.parentId; } return owned; };
  for (const component of plan.components) {
    const owned = owners(component);
    if (component.sourceRegionIds.some(region => !regions.has(region))) throw new Error(`Component ${component.id}: unknown source region`);
    if (component.renderer === 'html' && component.editability !== 'code') throw new Error(`HTML component ${component.id} must declare code editing`);
    if (component.renderer === 'products' && component.editability !== 'woocommerce') throw new Error(`Product component ${component.id} must declare WooCommerce editing`);
    if (new Set(component.variants.map(variant => variant.snapshotId)).size !== component.variants.length) throw new Error(`Component ${component.id}: duplicate responsive variant`);
    if (!component.variants.some(variant => variant.snapshotId === desktop.id)) throw new Error(`Component ${component.id}: missing desktop identity`);
    for (const variant of component.variants) {
      if (!snapshots.has(variant.snapshotId)) throw new Error(`Component ${component.id}: unknown variant snapshot`);
      for (const nodeId of variant.nodeIds) {
        if (!nodes.get(variant.snapshotId)?.has(nodeId)) throw new Error(`Component ${component.id}: unproven variant node ${nodeId}`);
        if (!owned.has(snapshots.get(variant.snapshotId)!.nodes[nodeId].regionId)) throw new Error(`Component ${component.id}: variant node ${nodeId} belongs to a different region`);
      }
    }
    const slotNodes = new Set<string>();
    for (const slot of component.itemSlots ?? []) for (const nodeId of slot.nodeIds) {
      if (!source.snapshots.some(snapshot => snapshot.nodes[nodeId] && owned.has(snapshot.nodes[nodeId].regionId))) throw new Error(`Component ${component.id} item ${slot.id}: unknown/wrong-owner source node ${nodeId}`);
      if (slotNodes.has(nodeId)) throw new Error(`Component ${component.id}: repeated node ${nodeId} assigned to multiple items`);
      slotNodes.add(nodeId);
    }
    if (new Set((component.itemSlots ?? []).map(slot => slot.id)).size !== (component.itemSlots ?? []).length) throw new Error(`Component ${component.id}: duplicate repeated item slot`);
  }
  const dispositions = new Map<string, string>();
  for (const requirement of plan.requirements) {
    const component = components.get(requirement.componentId); if (!component) throw new Error(`Requirement ${requirement.id}: unknown component`);
    if (requirement.disposition === 'external' && requirement.verification.kind !== 'external') throw new Error(`Requirement ${requirement.id}: external entrance requires external verification`);
    if (requirement.verification.kind === 'external' && (typeof requirement.verification.expected !== 'string' || !/^https?:\/\//.test(requirement.verification.expected))) throw new Error(`Requirement ${requirement.id}: external entrance needs its actual absolute href`);
    if (requirement.verification.snapshotId && !snapshots.has(requirement.verification.snapshotId)) throw new Error(`Requirement ${requirement.id}: unknown verification snapshot`);
    if (requirement.verification.viewport && !source.snapshots.some(snapshot => snapshot.viewport.name === requirement.verification.viewport)) throw new Error(`Requirement ${requirement.id}: unobserved verification viewport`);
    const owned = owners(component);
    const boundFacts = requirement.factIds.map(id => source.facts[id]).filter(Boolean);
    if (requirement.disposition === 'preserve' && boundFacts.some(fact => fact.kind === 'text')) {
      if (boundFacts.some(fact => fact.kind !== 'text') || requirement.verification.kind !== 'text') throw new Error(`Requirement ${requirement.id}: preserved text requires its own actual text verification`);
      const specification = requirement.verification.expected && typeof requirement.verification.expected === 'object' && !Array.isArray(requirement.verification.expected) ? requirement.verification.expected as { text?: unknown; visible?: unknown } : { text: requirement.verification.expected, visible: true };
      const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();
      if (typeof specification.text !== 'string' || boundFacts.some(fact => normalize(String(fact.value.text)) !== normalize(specification.text as string))) throw new Error(`Requirement ${requirement.id}: preserved text expectation must equal the actual normalized source wording`);
      const visible = specification.visible === undefined ? true : specification.visible;
      if (typeof visible !== 'boolean' || boundFacts.some(fact => fact.value.visible !== visible)) throw new Error(`Requirement ${requirement.id}: preserved text expectation must retain actual responsive visibility`);
    }
    if (requirement.disposition === 'preserve' && boundFacts.some(fact => fact.kind === 'media')) {
      const expected = requirement.verification.expected, identity = typeof expected === 'string' ? expected : expected && typeof expected === 'object' && !Array.isArray(expected) ? (expected as { assetKey?: unknown; url?: unknown }).assetKey || (expected as { url?: unknown }).url : undefined;
      if (boundFacts.some(fact => fact.kind !== 'media') || requirement.verification.kind !== 'media' || typeof identity !== 'string' || !identity.trim()) throw new Error(`Requirement ${requirement.id}: preserved media requires actual media verification and its registered asset identity`);
    }
    for (const factId of requirement.factIds) {
      const fact = source.facts[factId]; if (!fact) throw new Error(`Requirement ${requirement.id}: unknown source fact ${factId}`);
      if (requirement.disposition === 'external' && fact.kind === 'interaction' && typeof fact.value.href === 'string' && fact.value.href !== requirement.verification.expected) throw new Error(`Requirement ${requirement.id}: external href differs from the actual source destination`);
      if (!owned.has(fact.regionId)) throw new Error(`Requirement ${requirement.id}: wrong component/source ownership`);
      if (dispositions.has(factId)) throw new Error(`Source fact ${factId} has multiple dispositions`);
      if (requirement.verification.snapshotId && requirement.verification.snapshotId !== fact.snapshotId) throw new Error(`Requirement ${requirement.id}: source and verification snapshot differ`);
      if (requirement.verification.viewport && snapshots.get(fact.snapshotId)?.viewport.name !== requirement.verification.viewport) throw new Error(`Requirement ${requirement.id}: source and verification viewport differ`);
      dispositions.set(factId, requirement.id);
    }
  }
  const required = Object.values(source.facts).filter(fact => options.stage === 'desktop' || !options.stage ? fact.snapshotId === desktop.id : true);
  for (const fact of required) if (!dispositions.has(fact.id)) throw new Error(`Source fact ${fact.id} has no preserve/adapt/external requirement`);
  for (const record of source.sourceCommerce ?? []) {
    if ((options.stage === 'desktop' || !options.stage) && record.snapshotId !== desktop.id) continue;
    const snapshot = snapshots.get(record.snapshotId)!;
    const underneath = (id: string, owner: string) => { const seen = new Set<string>(); let current: string | null = id; while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = snapshot.nodes[current]?.parentId ?? null; } return false; };
    // sourceNodeIds identify the frozen desktop tree. An equal ID in another
    // packet says nothing about that node's owner or component responsibility.
    const bindings = (component: ComponentV2) => [...new Set([...(component.variants.find(variant => variant.snapshotId === record.snapshotId)?.nodeIds ?? []), ...(record.snapshotId === desktop.id ? (component.sourceNodeIds ?? []).filter(id => !!snapshot.nodes[id]) : [])])];
    for (const group of record.groups.filter(group => group.status === 'catalog')) {
      const deferral = deferred.get(`${record.snapshotId}:${group.id}`);
      if (deferral) {
        const descendants = (componentId: string): string[] => [...components.values()].filter(component => component.parentId === componentId).flatMap(component => [component.id, ...descendants(component.id)]);
        const allowed = new Set([deferral.componentId, ...descendants(deferral.componentId)]);
        if ([...allowed].some(id => components.get(id)?.renderer === 'products' || components.get(id)?.renderer === 'html')) throw Error('Deferred catalog placeholder cannot contain queries or static HTML');
        for (const fact of Object.values(source.facts).filter(fact => fact.snapshotId === record.snapshotId && ['text', 'media', 'interaction'].includes(fact.kind) && group.cardNodeIds.some(card => underneath(fact.nodeId, card)))) {
          const requirement = plan.requirements.find(item => item.id === dispositions.get(fact.id));
          const expected = requirement?.verification.expected as { visible?: unknown; deferredCatalog?: unknown } | undefined;
          if (!requirement || requirement.disposition !== 'adapt' || !allowed.has(requirement.componentId) || expected?.visible !== false || expected?.deferredCatalog !== group.id) throw Error(`Deferred product fact ${fact.id} must remain explicit, omitted, and bound to its placeholder`);
        }
        continue;
      }
      const nativeOwners = plan.components.filter(component => component.renderer === 'products' && component.variants.some(variant => variant.snapshotId === record.snapshotId) && (bindings(component).includes(group.ownerNodeId) || group.cardNodeIds.every(id => bindings(component).includes(id))));
      if (nativeOwners.length !== 1) throw new Error(`Source catalog ${record.snapshotId}:${group.id} requires one native-products component bound to its actual repeated product subtree`);
      const nativeOwner = nativeOwners[0];
      for (const component of plan.components.filter(component => component.renderer === 'html')) if (bindings(component).some(nodeId => group.cardNodeIds.some(card => underneath(nodeId, card) || underneath(card, nodeId)))) throw new Error(`Static HTML component ${component.id} overlaps the actual source catalog subtree ${group.id}; a marketing role cannot replace native-products`);
      for (const fact of Object.values(source.facts).filter(fact => fact.snapshotId === record.snapshotId && ['text', 'media', 'interaction'].includes(fact.kind) && group.cardNodeIds.some(card => underneath(fact.nodeId, card)))) {
        const requirement = plan.requirements.find(requirement => requirement.id === dispositions.get(fact.id));
        if (!requirement || requirement.componentId !== nativeOwner.id) throw new Error(`Source product fact ${fact.id} must belong to its actual native-products query, not a static or manually relabelled component`);
      }
    }
  }
  const gapKey = (gap: { snapshotId: string; code: string; nodeId?: string }) => `${gap.snapshotId}\u0000${gap.code}\u0000${gap.nodeId ?? ''}`;
  const resolutions = new Map<string, NonNullable<ComponentPlanV2['gapResolutions']>[number]>();
  for (const resolution of plan.gapResolutions ?? []) {
    const key = gapKey(resolution);
    if (resolutions.has(key)) throw new Error(`Source gap ${resolution.code} has duplicate resolutions`);
    const gap = source.gaps.find(candidate => gapKey(candidate) === key);
    if (!gap) throw new Error(`Resolution refers to an unknown source gap: ${resolution.code}`);
    // Capture integrity and unknown ownership require new evidence, never an adaptation.
    const privateDestinationOmitted = gap.code === 'transient-private-link-omitted';
    if (!privateDestinationOmitted && !/^(?:unsupported-icon|font-icon-asset-unresolved|decorative-(?:asset|icon)-unavailable|non-core-decoration-unavailable)$/.test(gap.code)) throw new Error(`Source evidence gap ${gap.code} cannot be adapted; capture or ownership must be repaired`);
    const requirement = plan.requirements.find(candidate => candidate.id === resolution.requirementId), component = components.get(resolution.componentId);
    if (!requirement || !component || requirement.componentId !== component.id || requirement.disposition !== 'adapt' || requirement.verification.expected === undefined) throw new Error(`Source gap ${gap.code} requires an explicit adaptation bound to an actual target verification`);
    const node = gap.nodeId ? snapshots.get(gap.snapshotId)?.nodes[gap.nodeId] : undefined;
    const facts = requirement.factIds.map(id => source.facts[id]);
    if (privateDestinationOmitted) {
      const expected = requirement.verification.expected;
      const flags = expected && typeof expected === 'object' && !Array.isArray(expected) ? expected as Record<string, unknown> : {};
      const bound = !!gap.nodeId && (component.variants.some(variant => variant.snapshotId === gap.snapshotId && variant.nodeIds.includes(gap.nodeId!)) || gap.snapshotId === desktop.id && !!component.sourceNodeIds?.includes(gap.nodeId));
      if (plan.replicationProfile !== 'desktop-browser-v1' || plan.requirementContract?.goalProfile !== 'component-reference-v1' || !node || !bound || !facts.length || facts.some(fact => {
        const details = fact?.value.details;
        return fact?.kind !== 'interaction' || fact.snapshotId !== gap.snapshotId || fact.nodeId !== gap.nodeId || !details || typeof details !== 'object' || Array.isArray(details) || (details as Record<string, unknown>).privateHrefOmitted !== true || Object.hasOwn(fact.value, 'href') || !plan.requirementContract!.requirements.some(item => item.sourceKey === `interaction:${fact.id}:unknown-control` && item.dimension === 'behavior' && item.capability === 'unknown-control');
      }) || requirement.verification.kind !== 'interaction' || flags.privateDestinationOmitted !== true || flags.destinationBehaviorVerified !== false || requirement.rule !== TRANSIENT_PRIVATE_LINK_OMISSION_RULE || resolution.rule !== TRANSIENT_PRIVATE_LINK_OMISSION_RULE) throw new Error('Transient private-link omission requires the explicit desktop component-reference privacy rule, exact redacted interaction and component binding, and unverified destination behavior');
      // The independent requirement contract was validated above. In particular,
      // this omission never supplies a capability proof for an unknown control.
    }
    const actualNode = !!node && (facts.some(fact => fact?.snapshotId === gap.snapshotId && fact.nodeId === gap.nodeId) || component.sourceNodeIds?.includes(gap.nodeId!) || component.variants.some(variant => variant.snapshotId === gap.snapshotId && variant.nodeIds.includes(gap.nodeId!)));
    if (gap.nodeId && !actualNode || !facts.some(fact => fact?.snapshotId === gap.snapshotId && (!node || fact.regionId === node.regionId))) throw new Error(`Source gap ${gap.code} resolution lacks its actual source node binding`);
    if (requirement.verification.snapshotId && requirement.verification.snapshotId !== gap.snapshotId || requirement.verification.viewport && requirement.verification.viewport !== snapshots.get(gap.snapshotId)?.viewport.name) throw new Error(`Source gap ${gap.code} resolution verifies a different viewport`);
    resolutions.set(key, resolution);
  }
  const requiredGaps = source.gaps.filter(gap => options.stage === 'desktop' || !options.stage ? gap.snapshotId === desktop.id : true);
  for (const gap of requiredGaps) if (!resolutions.has(gapKey(gap))) throw new Error(`Source gap ${gap.code} remains unresolved at ${options.stage ?? 'desktop'} stage`);
  if (source.sceneInventories?.length) {
    const inventories = (options.sceneInventories ?? []).map(validateSceneInventoryV2);
    for (const snapshot of source.snapshots.filter(snapshot => options.stage === 'desktop' || !options.stage ? snapshot.id === desktop.id : true)) {
      const ref = source.sceneInventories.find(item => item.snapshotId === snapshot.id), inventory = inventories.find(item => item.snapshotId === snapshot.id);
      if (!ref || !inventory) throw new Error(`Independent whole-page inventory is required and must be loaded from actual bytes: ${snapshot.id}`);
      if (inventory.sourceUrl !== source.sourceUrl || inventory.viewport.name !== snapshot.viewport.name || inventory.viewport.width !== snapshot.viewport.width || inventory.viewport.height !== snapshot.viewport.height) throw new Error('Independent inventory identity differs from the actual source snapshot');
      const sourceRegions = new Set(Object.values(source.facts).filter(fact => fact.snapshotId === snapshot.id && fact.kind === 'region').map(fact => fact.regionId));
      if (inventory.regions.length !== sourceRegions.size || inventory.regions.some(region => !sourceRegions.has(region.id))) throw new Error('Independent inventory has missing or changed region owners');
      const nodeBindings = bindSceneInventoryNodesV2(inventory, snapshot.nodes, Object.fromEntries(Object.values(source.facts).filter(fact => fact.snapshotId === snapshot.id && fact.kind === 'region').map(fact => [fact.regionId, { nodeId: fact.nodeId, selector: String(fact.value.selector) }])));
      const resolved = new Set<string>();
      for (const resolution of (plan.inventoryResolutions ?? []).filter(item => item.snapshotId === snapshot.id)) {
        const requirement = plan.requirements.find(item => item.id === resolution.requirementId), component = components.get(resolution.componentId);
        if (!component || !requirement || requirement.componentId !== component.id || requirement.disposition !== 'adapt' || requirement.verification.expected === undefined || !requirement.factIds.some(id => source.facts[id]?.snapshotId === snapshot.id)) throw new Error('Source vendor utility adaptation requires an actual same-snapshot target verification');
        if (requirement.verification.snapshotId && requirement.verification.snapshotId !== snapshot.id || requirement.verification.viewport && requirement.verification.viewport !== snapshot.viewport.name) throw new Error('Source vendor utility resolution verifies the wrong viewport');
        for (const entryId of resolution.entryIds) {
          const entry = inventory.entries[entryId];
          if (!entry || entry.ownerRegionId || !entry.utility || resolved.has(entryId)) throw new Error(`Only an independently marked source-vendor utility can be explicitly adapted: ${entryId}`);
          resolved.add(entryId);
        }
      }
      for (const entry of Object.values(inventory.entries)) {
        if (entry.ownerRegionId && entry.kind === 'text') {
          const actual = Object.values(source.facts).find(fact => fact.snapshotId === snapshot.id && fact.kind === 'text' && fact.nodeId === nodeBindings[entry.id]), wording = actual ? String(actual.value.text).normalize('NFC').replace(/\s+/g, ' ').trim() : '', label = (entry.label ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
          if (!actual) throw new Error(`Independent visible text is missing from the actual source facts: ${entry.id}`);
          if (wording !== label) {
            const before = /^(\d+)\s*\/\s*(\d+)$/.exec(wording), after = /^(\d+)\s*\/\s*(\d+)$/.exec(label);
            const verifiedDynamicCounter = before && after && before[2] === after[2] && plan.requirements.some(requirement => requirement.factIds.includes(actual.id) && requirement.disposition === 'adapt' && requirement.verification.kind === 'interaction' && requirement.verification.property === 'carousel');
            if (!verifiedDynamicCounter) throw new Error(`Independent visible text differs from the actual source facts without a verified dynamic-counter adaptation: ${entry.id}`);
          }
        }
        if (entry.ownerRegionId && !plan.components.some(component => component.sourceRegionIds.includes(entry.ownerRegionId!) && component.variants.some(variant => variant.snapshotId === snapshot.id))) throw new Error(`Independent scene entry has no authored component owner: ${entry.id}`);
        if (!entry.ownerRegionId && (!entry.utility || !resolved.has(entry.id))) throw new Error(`Independent scene entry remains unassigned or an unverified vendor utility: ${entry.id}`);
      }
    }
    for (const resolution of plan.inventoryResolutions ?? []) if (!source.sceneInventories.some(ref => ref.snapshotId === resolution.snapshotId)) throw new Error('Inventory resolution refers to an unobserved snapshot');
  } else if (plan.inventoryResolutions?.length) throw new Error('Inventory resolutions require independent source inventory evidence');
  if (options.stage && options.stage !== 'desktop' && !plan.replicationProfile) for (const name of ['tablet', 'mobile']) if (!source.snapshots.some(snapshot => snapshot.viewport.name === name)) throw new Error(`Responsive stage requires actual ${name} source evidence`);
  return plan;
}

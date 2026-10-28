import path from 'node:path';
import * as css from 'css-tree';
import { z } from 'zod';
import { canonicalV2, documentHashV2, hashV2 } from '../replica-v2/journal.js';
import { native44Id, native44ModuleClass } from './adapters.js';
import { assertNative44Compilation } from './compiler.js';
import { assembleNative44CurrentNativeSnapshot, native44SubtreeHash, type Native44CurrentNativeReplacement } from './current-native-patch.js';
import { updateNative44CSSModel, compileNative44CSSModel, native44CSSModelRuleHash, type Native44CSSModel, type Native44CSSModelChange, type Native44CSSModelRule } from './css-model.js';
import { Native44RequirementContractSchema, Native44AcceptancePolicySchema, native44RequirementsHash, validateNative44Requirements } from './requirements.js';
import { native44SnapshotNodes } from './revision-snapshot.js';
import { walkNative44, type Native44Compiled, type Native44Program } from './types.js';
import type { DraftSnapshot, LegacySchema } from '../wordpress/types.js';
import type { Native44SourceUnit } from './selection-types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { Native44CompareManifest } from './compare.js';

const id = z.string().regex(/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/).refine(value => !value.includes('..')), hash = z.string().regex(/^[a-f\d]{64}$/), ref = z.object({ path: z.string().min(1).max(4096), sha256: hash }).strict();
type Ref = z.infer<typeof ref>;
const leaf = z.object({ selector: z.string().min(1), tag: z.enum(['input', 'button']), typeAttribute: z.enum(['email', 'submit']), expectedName: z.string().optional(), expectedId: z.string().optional(), geometryOwner: z.literal('native-control-leaf'), basis: z.literal('registered-pending-form-renderer-candidate'), runtimeInspection: z.literal('required') }).strict();
/** A renderer-derived locator, never a claim that the current target has
 * rendered it. Both forms may emit the same input id, so ownership is scoped
 * to the exact page and compiled widget instead of a global #form-field-email. */
export function native44CurrentPendingFormLeaf(pageId: number, elementId: string, role: 'email' | 'submit'): z.infer<typeof leaf> {
  if (!Number.isSafeInteger(pageId) || pageId < 1 || !/^[a-zA-Z\d]{4,12}$/.test(elementId)) fail('pending_form_leaf_identity_invalid');
  z.enum(['email', 'submit']).parse(role);
  const owner = `.elementor-${pageId} [data-id="${elementId}"] .elementor-form`;
  return leaf.parse(role === 'email' ? { selector: `${owner} input.elementor-field[type="email"][name="form_fields[email]"]`, tag: 'input', typeAttribute: 'email', expectedName: 'form_fields[email]', expectedId: 'form-field-email', geometryOwner: 'native-control-leaf', basis: 'registered-pending-form-renderer-candidate', runtimeInspection: 'required' } : { selector: `${owner} button.elementor-button[type="submit"]`, tag: 'button', typeAttribute: 'submit', geometryOwner: 'native-control-leaf', basis: 'registered-pending-form-renderer-candidate', runtimeInspection: 'required' });
}
const descendantBinding = z.object({ originalComponentKey: id, replacementComponentKey: id, sourceUnitIds: z.array(id).max(100), reason: z.string().trim().min(20).max(3000), evidence: z.array(ref).min(1).max(100) }).strict();
export const Native44CurrentNativeSourceBindingSchema = z.object({ elementId: id, originalComponentKey: id, replacementComponentKey: id, sourceUnitIds: z.array(id).min(2).max(100), reason: z.string().trim().min(20).max(3000), evidence: z.array(ref).min(1).max(100), replacementRootComponentKey: id.optional(), descendantBindings: z.array(descendantBinding).min(1).max(100).optional() }).strict();
export type Native44CurrentNativeSourceBinding = z.infer<typeof Native44CurrentNativeSourceBindingSchema>;
const logicalMapping = z.object({ originalComponentKey: id, replacementComponentKey: id, oldElementId: id, newRootId: id, beforeSubtreeHash: hash, afterSubtreeHash: hash, sourceUnitIds: z.array(id), sourceFactIds: z.array(z.string().min(1)), requirementIds: z.array(id), reason: z.string().min(20), evidence: z.array(ref).min(1) }).strict();
const recordOwner = z.object({
  originalComponentKey: id, replacementComponentKey: id, oldElementId: id, newRootId: id, beforeSubtreeHash: hash, afterSubtreeHash: hash,
  sourceUnitIds: z.array(id).min(2), sourceFactIds: z.array(z.string().min(1)).min(1),
  sourceFactBindings: z.array(z.object({ factId: z.string().min(1), snapshotId: id, originalUnitId: id, role: z.enum(['source-unit-fact', 'email', 'submit']), requirementIds: z.array(id), currentElementIds: z.array(id).min(1), nativeControlIds: z.array(z.string().min(1)).min(1), currentLeaf: leaf.optional(), originalUnitOwnershipChanged: z.literal(false) }).strict()).min(1),
  requirements: z.array(z.object({ requirementId: id, sourceKey: z.string().min(1), dimension: z.string().min(1), capability: z.string().min(1), checkIds: z.array(id).min(1), frozenFulfillmentRoute: z.string().min(1), currentComponentKeys: z.array(id).min(1), currentElementIds: z.array(id).min(1), currentLeafSelectors: z.array(z.string().min(1)), currentInspection: z.literal('required'), behavioralAcceptanceChanged: z.literal(false) }).strict()).min(1),
  nativeControls: z.array(z.object({ componentKey: id, elementId: id, widgetType: id, schemaClass: z.string().min(1), settingsHash: hash, controlIds: z.array(z.string().min(1)).min(1), editability: z.literal('registered-native-controls-current-inspection-required') }).strict()).min(1),
  replacementRootId: id.optional(), originalSourceUnitIds: z.array(id).optional(), descendantMappings: z.array(logicalMapping).min(1).max(100).optional(),
  reason: z.string().min(20), evidence: z.array(ref).min(1),
}).strict();
export const Native44CurrentNativeModelRecordSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-current-native-model-replacement'), taskId: id, runId: id, pageId: z.number().int().positive(), beforeHash: hash, afterHash: hash,
  frozenProgram: ref, sourceFacts: ref, componentPlan: ref, requirements: ref, acceptancePolicy: ref, sourceUnits: ref, baselineSnapshot: ref, baselineManifest: ref, baselineModel: ref, fragmentProgram: ref, registeredSchemas: ref, proposedModel: ref,
  baselineModelHash: hash, currentModelHash: hash, changesHash: hash, owners: z.array(recordOwner).min(1).max(20),
  removedRules: z.array(z.object({ id, sha256: hash }).strict()), addedOrReboundRules: z.array(z.object({ id, sha256: hash }).strict()),
  frozenInputsChanged: z.literal(false), currentNativeMapping: z.literal('explicit-compiled-subtree-replacement'), currentVisualInspection: z.literal('required'), businessAcceptanceChanged: z.literal(false),
}).strict();
export type Native44CurrentNativeModelRecord = z.infer<typeof Native44CurrentNativeModelRecordSchema>;
function fail(reason: string): never { throw Error(`native44_current_native_model_${reason}`); }
const equal = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
const derivedReceipts = new WeakMap<object, { compiled: Native44Compiled; replacements: Native44CurrentNativeReplacement[]; before: DraftSnapshot; derived: string }>();
const modelWrites = new WeakMap<object, { compiled: Native44Compiled; allowed: WeakSet<object>; before: string; expected: string; model: string; replacements: string }>();
const classes = (node: { settings: Record<string, unknown> }) => [...new Set(['css_classes', '_css_classes'].flatMap(key => typeof node.settings[key] === 'string' ? (node.settings[key] as string).split(/\s+/).filter(Boolean) : []))];
const exactKeys = (value: any, expected: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected.sort().join(',');
/** Request changes have an exact envelope. The established model updater still
 * validates every rule, physical effect, native value and immutable history. */
export function validateNative44CurrentNativeModelChanges(input: unknown): Native44CSSModelChange[] {
  if (!Array.isArray(input) || !input.length || input.length > 10000) fail('changes_invalid');
  const allowed = new Set(['id', 'moduleKey', 'slot', 'selector', 'media', 'property', 'responsibility', 'reason', 'evidence', 'value', 'fallback', 'native', 'observedDecoration', 'optionalPresentation', 'optionalPresentationEvidence', 'nativeStructure']);
  for (const row of input) {
    const keys = row?.kind === 'add' ? ['kind', 'rule'] : row?.kind === 'replace' ? ['kind', 'id', 'expectedHash', 'rule'] : row?.kind === 'remove' ? ['kind', 'id', 'expectedHash', 'reason', 'evidence'] : [];
    if (!keys.length || !exactKeys(row, keys) || row.kind !== 'remove' && (!row.rule || typeof row.rule !== 'object' || Array.isArray(row.rule) || Object.keys(row.rule).some(key => !allowed.has(key)))) fail('change_envelope_invalid');
  }
  return structuredClone(input) as Native44CSSModelChange[];
}
export interface Native44CurrentNativeModelInputs {
  root: string; before: DraftSnapshot; baselineModel: Native44CSSModel; proposedModel: Native44CSSModel; compiled: Native44Compiled; fragment: Native44Program;
  replacements: Native44CurrentNativeReplacement[]; changes: unknown; sourceBindings: unknown[]; frozenProgram: Native44Program; source: SourceFactsV2; sourcePlan: any; sourceUnits: Native44SourceUnit[]; contract: unknown; policy: unknown; schemas: Record<string, LegacySchema>;
  references: Record<'frozenProgram' | 'sourceFacts' | 'componentPlan' | 'requirements' | 'acceptancePolicy' | 'sourceUnits' | 'baselineSnapshot' | 'baselineManifest' | 'baselineModel' | 'fragmentProgram' | 'registeredSchemas' | 'proposedModel', Ref>;
  priorRecords?: Native44CurrentNativeModelRecord[];
}
function selectorOwns(rule: Native44CSSModelRule, ids: Set<string>, names: Set<string>) {
  if (rule.native && ids.has(rule.native.elementId)) return true;
  if (rule.nativeStructure && Object.entries(rule.nativeStructure).some(([key, value]) => /(?:elementId|ElementId)$/.test(key) && typeof value === 'string' && ids.has(value))) return true;
  if (!rule.selector) return false;
  const selector = css.parse(rule.selector, { context: 'selector' }); let owned = false;
  if (selector.type !== 'Selector') return false;
  // Only a positive top-level anchor qualifies. :not(.new-owner), or an
  // escaping sibling after .new-owner, cannot style retained page content.
  for (const node of selector.children) {
    if (owned && node.type === 'Combinator' && ['+', '~'].includes(node.name)) return false;
    if (node.type === 'ClassSelector' && names.has(node.name) || node.type === 'IdSelector' && ids.has(node.name)) owned = true;
  }
  return owned;
}
/** A fresh compiled Woodmart renderer may replace an Elementor carousel only
 * with an explicit, complete one-to-one mapping of its original logical tree.
 * Associated frozen units may be shared; their facts are assigned exactly once. */
function expandedCarouselOwner(input: Native44CurrentNativeModelInputs, binding: Native44CurrentNativeSourceBinding, logicalOwners: Map<string, string>, contract: z.infer<typeof Native44RequirementContractSchema>): z.infer<typeof recordOwner> {
  if (!binding.replacementRootComponentKey || !binding.descendantBindings?.length) fail('descendant_mapping_requires_explicit_shell');
  const frozen = new Map(walkNative44(input.frozenProgram.blocks).map(node => [node.key, node])), fragment = new Map(walkNative44(input.fragment.blocks).map(node => [node.key, node]));
  const existing = native44SnapshotNodes(input.before.elements), compiled = native44SnapshotNodes(input.compiled.composition.elements);
  const replacement = input.replacements.find(row => row.elementId === binding.elementId && row.componentKey === binding.replacementRootComponentKey);
  const old = existing.get(binding.elementId)?.node, shellId = input.compiled.elementMap[binding.replacementRootComponentKey], shell = compiled.get(shellId)?.node;
  const nextId = input.compiled.elementMap[binding.replacementComponentKey], next = compiled.get(nextId)?.node;
  if (!replacement || !old || old.widgetType !== 'nested-carousel' || !next || next.widgetType !== 'wd_nested_carousel' || !shell || shell.elType !== 'container' || !input.fragment.blocks.some(node => node.key === binding.replacementRootComponentKey) || shell.elements?.length !== 1 || shell.elements[0].id !== nextId || logicalOwners.get(binding.originalComponentKey) !== old.id) fail('carousel_shell_or_renderer_scope_conflict');
  const oldTree = native44SnapshotNodes([old]), nextTree = native44SnapshotNodes([next]);
  const associated = (key: string) => [...new Set((input.sourcePlan.selectionDecisions ?? []).filter((row: any) => row.componentKeys.includes(key)).map((row: any) => row.unitId as string))].sort();
  const rows = [{ originalComponentKey: binding.originalComponentKey, replacementComponentKey: binding.replacementComponentKey, sourceUnitIds: binding.sourceUnitIds, reason: binding.reason, evidence: binding.evidence }, ...binding.descendantBindings];
  if (new Set(rows.map(row => row.originalComponentKey)).size !== rows.length || new Set(rows.map(row => row.replacementComponentKey)).size !== rows.length) fail('descendant_mapping_ambiguous');
  const affected = [...frozen.keys()].filter(key => oldTree.has(logicalOwners.get(key) ?? '') && associated(key).length).sort();
  if (!equal(rows.map(row => row.originalComponentKey).sort(), affected)) fail('descendant_mapping_inventory_incomplete');
  const mapped = rows.map(row => {
    const original = frozen.get(row.originalComponentKey), replacementNode = fragment.get(row.replacementComponentKey), oldId = logicalOwners.get(row.originalComponentKey), newId = input.compiled.elementMap[row.replacementComponentKey];
    const before = oldId && oldTree.get(oldId)?.node, after = nextTree.get(newId)?.node;
    if (!original || !replacementNode || !before || !after || !equal([...new Set(row.sourceUnitIds)].sort(), associated(row.originalComponentKey)) || row.sourceUnitIds.length !== associated(row.originalComponentKey).length || oldId === newId) fail('descendant_mapping_owner_or_unit_conflict');
    if (row.originalComponentKey !== binding.originalComponentKey) {
      if (original.kind !== replacementNode.kind || original.role !== replacementNode.role || before.elType !== after.elType || before.widgetType !== after.widgetType) fail('descendant_mapping_content_kind_changed');
      const oldSettings = original.kind === 'composite' ? original.settings ?? {} : 'widgetSettings' in original ? original.widgetSettings : {}, newSettings = replacementNode.kind === 'composite' ? replacementNode.settings ?? {} : 'widgetSettings' in replacementNode ? replacementNode.widgetSettings : {};
      for (const [key, value] of Object.entries(oldSettings)) if (!equal(newSettings[key], value)) fail('descendant_mapping_source_content_changed');
    }
    return { ...row, oldId: oldId!, newId, before, after };
  });
  // Every removed source-owned descendant is represented, with no additional
  // compiled widget/card concealed inside the newly declared renderer.
  if (mapped.length !== oldTree.size || mapped.length !== nextTree.size || old.elements?.length !== next.elements?.length) fail('descendant_mapping_tree_inventory_conflict');
  const byOldId = new Map(mapped.map(row => [row.oldId, row]));
  for (const row of mapped.slice(1)) {
    const oldParent = oldTree.get(row.oldId)!.parent, newParent = nextTree.get(row.newId)!.parent, expectedParent = oldParent && byOldId.get(oldParent)?.newId;
    if (!expectedParent || newParent !== expectedParent) fail('descendant_mapping_parent_conflict');
    const previousSiblings = oldTree.get(oldParent!)!.node.elements ?? [], newSiblings = nextTree.get(newParent!)!.node.elements ?? [];
    if (previousSiblings.findIndex(node => node.id === row.oldId) !== newSiblings.findIndex(node => node.id === row.newId)) fail('descendant_mapping_order_conflict');
  }
  const oldRows = old.settings.carousel_items, newRows = next.settings.slides;
  if (!Array.isArray(oldRows) || !Array.isArray(newRows) || oldRows.length !== old.elements!.length || newRows.length !== next.elements!.length || oldRows.some((row, index) => !equal(row.slide_title, newRows[index]?.slide_title))) fail('descendant_mapping_repeater_slot_conflict');
  const allUnitIds = [...new Set(mapped.flatMap(row => row.sourceUnitIds))].sort(), units = allUnitIds.map(unitId => input.sourceUnits.find(unit => unit.id === unitId));
  const widths = new Set(units.map(unit => input.source.snapshots.find(snapshot => snapshot.id === unit?.snapshotId)?.viewport.width));
  if (units.some(unit => !unit?.sourceFactIds.length) || !widths.has(1920) || !widths.has(1440)) fail('two_desktop_source_units_required');
  const unitOwner = new Map<string, typeof mapped[number]>();
  for (const unitId of allUnitIds) {
    const candidates = mapped.filter(row => row.sourceUnitIds.includes(unitId)), owner = candidates.find(row => row.originalComponentKey === binding.originalComponentKey) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!owner) fail('shared_descendant_unit_owner_ambiguous'); unitOwner.set(unitId, owner!);
  }
  const nativeControls = [...nextTree.values()].filter(({ node }) => node.elType === 'widget').map(({ node }) => {
    const key = Object.entries(input.compiled.elementMap).find(([, value]) => value === node.id)?.[0], schema = node.widgetType ? input.schemas[node.widgetType] : undefined, controls = Object.keys(node.settings).filter(control => control !== '_title');
    if (!key || !schema?.class || schema.type !== node.widgetType || !controls.length || controls.some(control => !schema.controls[control])) fail('compiled_editability_owner_invalid');
    return { componentKey: key!, elementId: node.id, widgetType: node.widgetType!, schemaClass: schema!.class!, settingsHash: hashV2(canonicalV2(node.settings)), controlIds: controls.sort(), editability: 'registered-native-controls-current-inspection-required' as const };
  });
  const factIds = [...new Set(units.flatMap(unit => unit!.sourceFactIds))].sort();
  const selectedRequirements = contract.requirements.filter(requirement => requirement.fulfillment.componentKeys?.some(key => mapped.some(row => row.originalComponentKey === key)) || allUnitIds.some(unitId => requirement.sourceKey === `unit:${unitId}`));
  const requirementOwner = (requirement: typeof selectedRequirements[number]) => {
    const unitId = requirement.sourceKey.startsWith('unit:') ? requirement.sourceKey.slice(5) : undefined;
    if (unitId && unitOwner.has(unitId)) return unitOwner.get(unitId)!;
    const fact = factIds.find(factId => requirement.sourceKey.startsWith(`interaction:${factId}:`) || requirement.sourceKey === `node:${input.source.facts[factId].snapshotId}:${input.source.facts[factId].nodeId}`);
    if (fact) { const owners = units.filter(unit => unit!.sourceFactIds.includes(fact)); if (owners.length !== 1) fail('source_fact_original_unit_ambiguous'); return unitOwner.get(owners[0]!.id)!; }
    const candidates = mapped.filter(row => requirement.fulfillment.componentKeys?.includes(row.originalComponentKey)); return candidates.find(row => row.originalComponentKey === binding.originalComponentKey) ?? candidates[0] ?? mapped[0];
  };
  const currentControls = (row: typeof mapped[number]) => row.after.elType === 'widget' ? nativeControls.filter(control => control.elementId === row.newId) : nativeControls.filter(control => native44SnapshotNodes([row.after]).has(control.elementId));
  const sourceFactBindings = factIds.map(factId => {
    const owned = input.sourceUnits.filter(unit => unit.sourceFactIds.includes(factId)), fact = input.source.facts[factId];
    if (owned.length !== 1 || !fact || !unitOwner.has(owned[0].id)) fail('source_fact_original_unit_ambiguous');
    const row = unitOwner.get(owned[0].id)!, controls = currentControls(row), requirements = selectedRequirements.filter(requirement => requirementOwner(requirement) === row && (requirement.sourceKey === `unit:${owned[0].id}` || requirement.sourceKey.startsWith(`interaction:${factId}:`) || requirement.sourceKey === `node:${fact.snapshotId}:${fact.nodeId}`));
    if (!controls.length) fail('descendant_mapping_editability_missing');
    return { factId, snapshotId: fact.snapshotId, originalUnitId: owned[0].id, role: 'source-unit-fact' as const, requirementIds: requirements.map(requirement => requirement.id), currentElementIds: controls.map(control => control.elementId), nativeControlIds: [...new Set(controls.flatMap(control => control.controlIds))], originalUnitOwnershipChanged: false as const };
  });
  for (const unit of units) for (const dimension of ['presence', 'editability', 'layout', 'presentation']) if (!selectedRequirements.some(requirement => requirement.sourceKey === `unit:${unit!.id}` && requirement.dimension === dimension)) fail('static_requirement_inventory_incomplete');
  const requirements = selectedRequirements.map(requirement => { const controls = currentControls(requirementOwner(requirement)); return { requirementId: requirement.id, sourceKey: requirement.sourceKey, dimension: requirement.dimension, capability: requirement.capability, checkIds: requirement.checks.map(check => check.id), frozenFulfillmentRoute: requirement.fulfillment.route, currentComponentKeys: controls.map(control => control.componentKey), currentElementIds: controls.map(control => control.elementId), currentLeafSelectors: [], currentInspection: 'required' as const, behavioralAcceptanceChanged: false as const }; });
  const descendantMappings = mapped.slice(1).map(row => ({ originalComponentKey: row.originalComponentKey, replacementComponentKey: row.replacementComponentKey, oldElementId: row.oldId, newRootId: row.newId, beforeSubtreeHash: native44SubtreeHash(row.before), afterSubtreeHash: native44SubtreeHash(row.after), sourceUnitIds: row.sourceUnitIds, sourceFactIds: factIds.filter(factId => { const unit = units.find(unit => unit!.sourceFactIds.includes(factId)); return unitOwner.get(unit!.id) === row; }), requirementIds: selectedRequirements.filter(requirement => requirementOwner(requirement) === row).map(requirement => requirement.id), reason: row.reason, evidence: row.evidence }));
  return { originalComponentKey: binding.originalComponentKey, replacementComponentKey: binding.replacementComponentKey, oldElementId: old.id, newRootId: nextId, replacementRootId: shellId, beforeSubtreeHash: replacement.beforeSubtreeHash, afterSubtreeHash: native44SubtreeHash(next), sourceUnitIds: allUnitIds, originalSourceUnitIds: binding.sourceUnitIds, sourceFactIds: factIds, sourceFactBindings, requirements, nativeControls, descendantMappings, reason: binding.reason, evidence: [...binding.evidence, ...binding.descendantBindings.flatMap(row => row.evidence)].filter((item, index, values) => values.findIndex(other => other.path === item.path && other.sha256 === item.sha256) === index) };
}
/** Produces only the new native tree/model and explicit correspondence. It
 * does not qualify caption opacity, compile CSS, accept requirements or write. */
export function deriveNative44CurrentNativeModel(input: Native44CurrentNativeModelInputs) {
  const { before, baselineModel, compiled, fragment, references } = input;
  assertNative44Compilation(compiled, compiled.composition);
  for (const value of Object.values(references)) ref.parse(value);
  const sameRef = (a: Ref | undefined, b: Ref) => a?.sha256 === b.sha256 && path.resolve(input.root, a?.path ?? '') === path.resolve(input.root, b.path);
  const contract = Native44RequirementContractSchema.parse(input.contract), policy = Native44AcceptancePolicySchema.parse(input.policy);
  if (baselineModel.taskId !== input.frozenProgram.taskId || fragment.taskId !== baselineModel.taskId || contract.taskId !== baselineModel.taskId || before.runId !== baselineModel.runId || before.pageId !== baselineModel.pageId || before.hash !== documentHashV2(before.elements, before.settings) || !sameRef(input.frozenProgram.sourceFacts, references.sourceFacts) || !sameRef(input.frozenProgram.componentPlan, references.componentPlan) || !sameRef(contract.sourceFacts, references.sourceFacts) || !sameRef(input.sourcePlan.sourceFacts, references.sourceFacts) || !equal(input.sourcePlan.sourceUnits, input.sourceUnits) || contract.sourceUnitsHash !== native44RequirementsHash(input.sourceUnits) || policy.requirementsHash !== native44RequirementsHash(contract)) fail('frozen_contract_identity_conflict');
  try { validateNative44Requirements(contract, { source: input.source, sourceUnits: input.sourceUnits, components: input.frozenProgram.blocks, sourceFactsHash: references.sourceFacts.sha256 }); } catch { fail('frozen_requirement_inventory_invalid'); }
  if (compiled.htmlProofs.length || compiled.queryReceipts.length || compiled.postQueryReceipts?.length || compiled.categoryQueryReceipts?.length || compiled.relatedProductBindings?.length || input.replacements.length !== input.sourceBindings.length) fail('compiled_scope_invalid');
  const changes = validateNative44CurrentNativeModelChanges(input.changes), sourceBindings = input.sourceBindings.map(value => Native44CurrentNativeSourceBindingSchema.parse(value));
  if (new Set(sourceBindings.map(value => value.elementId)).size !== sourceBindings.length || new Set(sourceBindings.map(value => value.originalComponentKey)).size !== sourceBindings.length || new Set(sourceBindings.map(value => value.replacementComponentKey)).size !== sourceBindings.length) fail('source_binding_ambiguous');
  const frozen = new Map(walkNative44(input.frozenProgram.blocks).map(node => [node.key, node])), fragmentNodes = new Map(walkNative44(fragment.blocks).map(node => [node.key, node])), existing = native44SnapshotNodes(before.elements), compiledNodes = native44SnapshotNodes(compiled.composition.elements);
  const logicalOwners = new Map([...frozen].map(([key]) => [key, native44Id(input.frozenProgram.taskId, key)]));
  const priorOwners = new Map<string, z.infer<typeof recordOwner>>();
  for (const raw of input.priorRecords ?? []) { const record = Native44CurrentNativeModelRecordSchema.parse(raw); if (record.taskId !== baselineModel.taskId || record.runId !== before.runId || record.pageId !== before.pageId || !sameRef(record.frozenProgram, references.frozenProgram) || !sameRef(record.sourceFacts, references.sourceFacts) || !sameRef(record.componentPlan, references.componentPlan)) fail('prior_replacement_identity_conflict'); for (const owner of record.owners) { if (logicalOwners.get(owner.originalComponentKey) !== owner.oldElementId) fail('prior_replacement_owner_discontinuity'); logicalOwners.set(owner.originalComponentKey, owner.newRootId); priorOwners.set(owner.originalComponentKey, owner); for (const mapping of owner.descendantMappings ?? []) { if (logicalOwners.get(mapping.originalComponentKey) !== mapping.oldElementId) fail('prior_replacement_owner_discontinuity'); logicalOwners.set(mapping.originalComponentKey, mapping.newRootId); } } }
  // Replacing only part of a recorded owner would leave its other recorded
  // controls/facts pointing at removed descendants. Until an explicit history
  // supersession contract exists, reject both ancestry directions locally.
  const contains = (ancestor: string, child: string) => { for (let current: string | null | undefined = child; current; current = existing.get(current)?.parent) if (current === ancestor) return true; return false; };
  for (const binding of sourceBindings) for (const owner of priorOwners.values()) {
    if (binding.originalComponentKey === owner.originalComponentKey && binding.elementId === owner.newRootId) { if (owner.descendantMappings && !binding.descendantBindings) fail('prior_replacement_descendant_inventory_required'); continue; }
    if (contains(owner.newRootId, binding.elementId) || contains(binding.elementId, owner.newRootId)) fail('prior_replacement_partial_scope_overlap');
  }
  const base = assembleNative44CurrentNativeSnapshot(before, compiled, input.replacements, baselineModel.modules, []), next = native44SnapshotNodes(base.elements), oldIds = new Set<string>(), oldClasses = new Set<string>(), newIds = new Set<string>(), newClasses = new Set<string>();
  const owners = sourceBindings.map((binding): z.infer<typeof recordOwner> => {
    if (binding.descendantBindings) {
      const owner = expandedCarouselOwner(input, binding, logicalOwners, contract);
      const old = existing.get(binding.elementId)!.node, replacementRoot = next.get(owner.replacementRootId!)!.node;
      for (const { node } of native44SnapshotNodes([old]).values()) { oldIds.add(node.id); classes(node).forEach(name => oldClasses.add(name)); }
      for (const { node } of native44SnapshotNodes([replacementRoot]).values()) { newIds.add(node.id); classes(node).forEach(name => newClasses.add(name)); }
      return owner;
    }
    const replacementKey = binding.replacementRootComponentKey ?? binding.replacementComponentKey;
    const replacement = input.replacements.find(row => row.elementId === binding.elementId && row.componentKey === replacementKey), old = existing.get(binding.elementId)?.node, original = frozen.get(binding.originalComponentKey), newRootId = compiled.elementMap[binding.replacementComponentKey], root = next.get(newRootId)?.node, replacementRootId = compiled.elementMap[replacementKey], replacementRoot = next.get(replacementRootId)?.node;
    if (!replacement || !old || !original || !root || !replacementRoot || original.kind === 'html-static' || original.kind === 'native-products' || original.kind === 'native-posts' || original.kind === 'native-categories' || original.kind === 'native-related-products' || logicalOwners.get(original.key) !== old.id || !fragment.blocks.some(node => node.key === replacementKey) || input.replacements.some(row => row !== replacement && row.componentKey === replacementKey)) fail('logical_owner_conflict');
    // A composite program root is required by the normal compiler. Its sole
    // widget child may own the original logical unit, but the shell may not
    // conceal additional content or silently change the native renderer.
    if (binding.replacementRootComponentKey && (replacementRoot.elType !== 'container' || replacementRoot.elements?.length !== 1 || replacementRoot.elements[0].id !== root.id || old.elType !== 'widget' || root.elType !== 'widget' || old.widgetType !== root.widgetType || old.elements?.length || root.elements?.length)) fail('contained_native_owner_scope_conflict');
    if (!(input.priorRecords ?? []).some(record => record.owners.some(owner => owner.originalComponentKey === original.key)) && !classes(old).includes(native44ModuleClass(original.key))) fail('original_native_class_conflict');
    for (const { node } of native44SnapshotNodes([old]).values()) { oldIds.add(node.id); classes(node).forEach(name => oldClasses.add(name)); }
    const subtree = native44SnapshotNodes([root]); for (const { node } of native44SnapshotNodes([replacementRoot]).values()) { newIds.add(node.id); classes(node).forEach(name => newClasses.add(name)); }
    const decisions = input.sourcePlan.selectionDecisions?.filter((decision: any) => decision.componentKeys.includes(original.key)) ?? [], expectedUnits = [...new Set<string>(decisions.map((decision: any) => decision.unitId as string))].sort();
    if (!expectedUnits.length || !equal([...new Set(binding.sourceUnitIds)].sort(), expectedUnits) || binding.sourceUnitIds.length !== expectedUnits.length) fail('source_unit_inventory_conflict');
    const units = expectedUnits.map(unitId => input.sourceUnits.find(unit => unit.id === unitId)), widths = new Set(units.map(unit => input.source.snapshots.find(snapshot => snapshot.id === unit?.snapshotId)?.viewport.width));
    if (units.some(unit => !unit || !unit.sourceFactIds.length) || !widths.has(1920) || !widths.has(1440)) fail('two_desktop_source_units_required');
    const primaryFactIds = [...new Set(units.flatMap(unit => unit!.sourceFactIds))].sort(); if (primaryFactIds.some(factId => !input.source.facts[factId])) fail('source_fact_inventory_conflict');
    const nativeControls = [...subtree.values()].filter(({ node }) => node.elType === 'widget').map(({ node }) => {
      const key = Object.entries(compiled.elementMap).find(([, value]) => value === node.id)?.[0], schema = node.widgetType && input.schemas[node.widgetType], controls = Object.keys(node.settings).filter(control => control !== '_title');
      if (!key || !fragmentNodes.has(key) || !schema || schema.type !== node.widgetType || !schema.class || !controls.length || controls.some(control => !schema.controls[control])) fail('compiled_editability_owner_invalid');
      return { componentKey: key, elementId: node.id, widgetType: node.widgetType!, schemaClass: schema.class, settingsHash: hashV2(canonicalV2(node.settings)), controlIds: controls.sort(), editability: 'registered-native-controls-current-inspection-required' as const };
    });
    if (!nativeControls.length) fail('compiled_editability_missing');
    const controls = new Map<string, { role: 'email' | 'submit'; elementId: string; controlIds: string[] }>();
    for (const owner of nativeControls) {
      const node = fragmentNodes.get(owner.componentKey) as any, declaration = node?.pendingForm;
      if (!declaration) continue;
      if (declaration.kind === 'native44-pending-form-v2') {
        if (owner.widgetType !== 'form' || declaration.version !== 2 || !Array.isArray(declaration.sourceControls) || declaration.sourceControls.length !== 2 || new Set(declaration.sourceControls.map((row: any) => row.snapshotId)).size !== 2) fail('pending_form_source_correspondence_invalid');
        const inventory: string[] = [];
        for (const row of declaration.sourceControls) {
          if (!Array.isArray(row.fieldFactIds) || row.fieldFactIds.length !== node.widgetSettings.form_fields.length) fail('pending_form_source_control_conflict');
          const facts = [...row.fieldFactIds,row.submitFactId].map((factId: string) => input.source.facts[factId]);
          let formId: string | undefined;
          for (const [index,fact] of facts.entries()) {
            if (!fact || fact.kind !== 'interaction' || fact.snapshotId !== row.snapshotId || !node.sourceFactIds.includes(fact.id) || index < row.fieldFactIds.length && !primaryFactIds.includes(fact.id)) fail('pending_form_source_control_conflict');
            let form: any;
            if ((fact.value.details as any)?.form) { try { form = JSON.parse(String((fact.value.details as any).form)); } catch { fail('pending_form_source_ancestry_invalid'); } }
            else {
              const nodes = input.source.snapshots.find(snapshot => snapshot.id === row.snapshotId)?.nodes as Record<string,any> | undefined;
              const seen = new Set<string>(); let current = nodes?.[fact.nodeId];
              while (current && !seen.has(current.id)) { if (current.tag === 'form') { form = {nodeId:current.id,submitControlNodeId:facts.at(-1)?.nodeId}; break; } seen.add(current.id); current = nodes?.[current.parentId]; }
            }
            if (!form?.nodeId || formId && formId !== form.nodeId || form.submitControlNodeId !== facts.at(-1)?.nodeId) fail('pending_form_source_ancestry_invalid');
            formId = form.nodeId; inventory.push(fact.id);
          }
          const submit = facts.at(-1)!, controlIds = owner.controlIds.filter(control => control === 'button_text');
          for(const presentation of row.presentations??[]){const fact=input.source.facts[presentation.presentationFactId];if(!row.fieldFactIds.includes(presentation.fieldFactId)||!fact||fact.snapshotId!==row.snapshotId||!primaryFactIds.includes(fact.id))fail('pending_form_source_control_conflict');inventory.push(fact.id);}
          if (controls.has(submit.id) || !controlIds.length) fail('pending_form_native_control_conflict');
          controls.set(submit.id, { role: 'submit', elementId: owner.elementId, controlIds });
        }
        if (!equal([...new Set(node.sourceFactIds)].sort(),inventory.sort())) fail('pending_form_source_fact_inventory_invalid');
        continue;
      }
      if (owner.widgetType !== 'form' || declaration.kind !== 'native44-pending-form-v1' || !Array.isArray(declaration.sourceControls) || declaration.sourceControls.length !== 2 || new Set(declaration.sourceControls.map((row: any) => row.snapshotId)).size !== 2) fail('pending_form_source_correspondence_invalid');
      for (const row of declaration.sourceControls) {
        const email = input.source.facts[row.emailFactId], submit = input.source.facts[row.submitFactId];
        let emailForm: any, submitForm: any; try { emailForm = JSON.parse(String(email?.value.details && (email.value.details as any).form)); submitForm = JSON.parse(String(submit?.value.details && (submit.value.details as any).form)); } catch { fail('pending_form_source_ancestry_invalid'); }
        if (!email || !submit || email.snapshotId !== row.snapshotId || submit.snapshotId !== row.snapshotId || !primaryFactIds.includes(email.id) || (email.value.details as any)?.nodeType !== 'email' || (submit.value.details as any)?.nodeType !== 'submit' || !emailForm?.nodeId || emailForm.nodeId !== submitForm?.nodeId || !Array.isArray(node.sourceFactIds) || !node.sourceFactIds.includes(email.id) || !node.sourceFactIds.includes(submit.id)) fail('pending_form_source_control_conflict');
        for (const [factId, role, controlIds] of [[email.id, 'email', ['form_fields']], [submit.id, 'submit', owner.controlIds.filter(control => ['button_text', 'selected_button_icon'].includes(control))]] as const) { if (controls.has(factId) || !controlIds.length || controlIds.some(control => !owner.controlIds.includes(control))) fail('pending_form_native_control_conflict'); controls.set(factId, { role, elementId: owner.elementId, controlIds: [...controlIds] }); }
      }
      if (!equal([...new Set(node.sourceFactIds)].sort(), declaration.sourceControls.flatMap((row: any) => [row.emailFactId, row.submitFactId]).sort())) fail('pending_form_source_fact_inventory_invalid');
    }
    const factIds = [...new Set([...primaryFactIds, ...controls.keys()])].sort(), extraFactIds = factIds.filter(factId => !primaryFactIds.includes(factId));
    const matchesFact = (sourceKey: string, factId: string) => sourceKey.startsWith(`interaction:${factId}:`) || sourceKey === `node:${input.source.facts[factId].snapshotId}:${input.source.facts[factId].nodeId}`;
    const mapped = contract.requirements.filter(requirement => requirement.fulfillment.componentKeys?.includes(original.key) || expectedUnits.some(unitId => requirement.sourceKey === `unit:${unitId}`) || extraFactIds.some(factId => matchesFact(requirement.sourceKey, factId)));
    if (!mapped.length || units.some(unit => ['presence', 'editability', 'layout', 'presentation'].some(dimension => !mapped.some(requirement => requirement.sourceKey === `unit:${unit!.id}` && requirement.dimension === dimension)))) fail('static_requirement_inventory_incomplete');
    const sourceFactBindings = factIds.map(factId => {
      const ownedUnits = input.sourceUnits.filter(unit => unit.sourceFactIds.includes(factId)), control = controls.get(factId), fact = input.source.facts[factId];
      if (ownedUnits.length !== 1 || !fact) fail('source_fact_original_unit_ambiguous');
      const requirements = mapped.filter(requirement => matchesFact(requirement.sourceKey, factId) || primaryFactIds.includes(factId) && requirement.sourceKey === `unit:${ownedUnits[0].id}`);
      if (!primaryFactIds.includes(factId) && (!control || control.role !== 'submit' || !requirements.length || requirements.some(requirement => requirement.capability !== 'form-submit' || requirement.dimension !== 'behavior' || requirement.fulfillment.route !== 'gap'))) fail('cross_unit_submit_obligations_not_pending');
      return { factId, snapshotId: fact.snapshotId, originalUnitId: ownedUnits[0].id, role: control?.role ?? 'source-unit-fact' as const, requirementIds: requirements.map(requirement => requirement.id), currentElementIds: control ? [control.elementId] : nativeControls.map(node => node.elementId), nativeControlIds: control?.controlIds ?? [...new Set(nativeControls.flatMap(node => node.controlIds))], ...(control ? { currentLeaf: native44CurrentPendingFormLeaf(before.pageId, control.elementId, control.role) } : {}), originalUnitOwnershipChanged: false as const };
    });
    return { originalComponentKey: original.key, replacementComponentKey: binding.replacementComponentKey, oldElementId: old.id, newRootId, ...(binding.replacementRootComponentKey ? { replacementRootId } : {}), beforeSubtreeHash: replacement.beforeSubtreeHash, afterSubtreeHash: native44SubtreeHash(root), sourceUnitIds: expectedUnits, sourceFactIds: factIds, sourceFactBindings, requirements: mapped.map(requirement => ({ requirementId: requirement.id, sourceKey: requirement.sourceKey, dimension: requirement.dimension, capability: requirement.capability, checkIds: requirement.checks.map(check => check.id), frozenFulfillmentRoute: requirement.fulfillment.route, currentComponentKeys: nativeControls.map(node => node.componentKey), currentElementIds: nativeControls.map(node => node.elementId), currentLeafSelectors: sourceFactBindings.flatMap(binding => binding.requirementIds.includes(requirement.id) && binding.currentLeaf ? [binding.currentLeaf.selector] : []), currentInspection: 'required' as const, behavioralAcceptanceChanged: false as const })), nativeControls, reason: binding.reason, evidence: binding.evidence };
  });
  if ([...newIds].some(id => oldIds.has(id))) fail('replacement_must_have_new_compiled_ids');
  const logicalKeys = owners.flatMap(owner => [owner.originalComponentKey, ...('descendantMappings' in owner ? owner.descendantMappings!.map(row => row.originalComponentKey) : [])]);
  if (new Set(logicalKeys).size !== logicalKeys.length) fail('descendant_mapping_cross_replacement_conflict');
  const bindingEvidence = new Set(sourceBindings.flatMap(binding => [...binding.evidence, ...binding.descendantBindings?.flatMap(row => row.evidence) ?? []].map(item => path.resolve(input.root, item.path))));
  for (const change of changes) {
    const old = change.kind === 'add' ? undefined : baselineModel.rules.find(rule => rule.id === change.id), current = change.kind === 'remove' ? undefined : change.rule;
    if (change.kind !== 'add' && (!old || !selectorOwns(old, oldIds, oldClasses)) || current && (!selectorOwns(current, newIds, newClasses) || selectorOwns(current, oldIds, oldClasses)) || (change.kind === 'remove' ? change.evidence : change.rule.evidence).some(value => !bindingEvidence.has(path.resolve(input.root, value)))) fail('css_change_outside_replacement_scope');
  }
  // Descendant presentation is a relocation, not a redesign. Only the new
  // renderer/shell may introduce new renderer-specific responsibilities.
  for (const owner of owners) if ('descendantMappings' in owner && owner.descendantMappings) {
    const mappings = owner.descendantMappings, oldChildIds = new Set(mappings.map(row => row.oldElementId)), newChildIds = new Set(mappings.map(row => row.newRootId));
    const oldNames = new Set(mappings.map(row => native44ModuleClass(row.originalComponentKey))), newNames = new Set(mappings.map(row => native44ModuleClass(row.replacementComponentKey)));
    const classMap = new Map(mappings.map(row => [native44ModuleClass(row.originalComponentKey), native44ModuleClass(row.replacementComponentKey)])), idMap = new Map(mappings.map(row => [row.oldElementId, row.newRootId]));
    const shape = (rule: Native44CSSModelRule, relocate = false) => {
      const value = structuredClone(rule) as any; delete value.id; delete value.reason; delete value.evidence;
      if (relocate && value.selector) { const selector = css.parse(value.selector, { context: 'selector' }); css.walk(selector, node => { if (node.type === 'ClassSelector' && classMap.has(node.name)) node.name = classMap.get(node.name)!; if (node.type === 'IdSelector' && idMap.has(node.name)) node.name = idMap.get(node.name)!; }); value.selector = css.generate(selector); }
      else if (value.selector) value.selector = css.generate(css.parse(value.selector, { context: 'selector' }));
      if (relocate && value.native && idMap.has(value.native.elementId)) value.native.elementId = idMap.get(value.native.elementId);
      return canonicalV2(value);
    };
    const oldRules = baselineModel.rules.filter(rule => selectorOwns(rule, oldChildIds, oldNames)), additions = changes.filter((change): change is Extract<Native44CSSModelChange, { kind: 'add' }> => change.kind === 'add' && selectorOwns(change.rule, newChildIds, newNames));
    if (oldRules.length !== additions.length || oldRules.some(rule => !changes.some(change => change.kind === 'remove' && change.id === rule.id) || additions.filter(change => shape(change.rule) === shape(rule, true)).length !== 1)) fail('descendant_presentation_not_exact_relocation');
  }
  const model = updateNative44CSSModel(baselineModel, changes);
  if (!equal(model, input.proposedModel) || !equal(model.modules, baselineModel.modules) || model.rules.some(rule => selectorOwns(rule, oldIds, oldClasses))) fail('css_model_not_exact_derived_or_old_owner_remains');
  // The updater has already validated unique rule IDs. Index only the lookup;
  // retained rule contents still require the same complete canonical equality.
  const currentRules = new Map(model.rules.map(rule => [rule.id, rule]));
  for (const rule of baselineModel.rules.filter(rule => !selectorOwns(rule, oldIds, oldClasses))) if (!equal(currentRules.get(rule.id), rule)) fail('retained_rule_changed');
  for (const owner of owners) if (!model.rules.some(rule => rule.responsibility === 'css' && selectorOwns(rule, new Set(owner.nativeControls.map(node => node.elementId).concat(owner.newRootId)), new Set([...native44SnapshotNodes([next.get(owner.newRootId)!.node]).values()].flatMap(({ node }) => classes(node)))))) fail('new_native_presentation_unmapped');
  const derived = { model, elements: base.elements, before: input.before, references, taskId: baselineModel.taskId, baselineModelHash: hashV2(canonicalV2(baselineModel)), changesHash: hashV2(canonicalV2(changes)), owners, removedRules: changes.filter(change => change.kind !== 'add').map(change => ({ id: change.id, sha256: native44CSSModelRuleHash(baselineModel.rules.find(rule => rule.id === change.id)!) })), addedOrReboundRules: changes.filter(change => change.kind !== 'remove').map(change => ({ id: change.rule.id, sha256: native44CSSModelRuleHash(change.rule) })) };
  derivedReceipts.set(derived, { compiled, replacements: structuredClone(input.replacements), before: structuredClone(before), derived: canonicalV2(derived) }); return derived;
}
/** CSS qualification/compilation and full expected hash are supplied by the
 * protected caller after the source proof graph has been reverified. */
export function finalizeNative44CurrentNativeModelRecord(derived: ReturnType<typeof deriveNative44CurrentNativeModel>, expected: DraftSnapshot): Native44CurrentNativeModelRecord {
  const receipt = derivedReceipts.get(derived); if (!receipt || receipt.derived !== canonicalV2(derived)) fail('derived_current_process_identity_required');
  const compiled = compileNative44CSSModel(derived.model, { elements: expected.elements });
  if (expected.pageId !== derived.before.pageId || expected.runId !== derived.before.runId || expected.status !== 'draft' || !equal(expected.elements, derived.elements) || expected.hash !== documentHashV2(expected.elements, expected.settings) || expected.settings.custom_css !== compiled.css || !equal({ ...expected.settings, custom_css: undefined }, { ...derived.before.settings, custom_css: undefined }) || expected.title !== derived.before.title) fail('record_expected_snapshot_conflict');
  const record = Native44CurrentNativeModelRecordSchema.parse({ version: 1, kind: 'native44-current-native-model-replacement', taskId: derived.taskId, runId: expected.runId, pageId: expected.pageId, beforeHash: derived.before.hash, afterHash: expected.hash, ...derived.references, baselineModelHash: derived.baselineModelHash, currentModelHash: hashV2(canonicalV2(derived.model)), changesHash: derived.changesHash, owners: derived.owners, removedRules: derived.removedRules, addedOrReboundRules: derived.addedOrReboundRules, frozenInputsChanged: false, currentNativeMapping: 'explicit-compiled-subtree-replacement', currentVisualInspection: 'required', businessAcceptanceChanged: false });
  modelWrites.set(derived.model, { compiled: receipt.compiled, allowed: new WeakSet([receipt.compiled]), before: canonicalV2(receipt.before), expected: canonicalV2(expected), model: canonicalV2(derived.model), replacements: canonicalV2(receipt.replacements) }); return record;
}

/** A newly live-compiled fragment may share this exact derived write only
 * after its process identity and entire sealed output match the original. */
export function bindNative44CurrentNativeModelCompilation(model: Native44CSSModel, compiled: Native44Compiled): void {
  const receipt = modelWrites.get(model); if (!receipt || canonicalV2(model) !== receipt.model) fail('model_write_current_process_identity_required');
  assertNative44Compilation(compiled, compiled.composition); if (!equal(compiled, receipt.compiled)) fail('live_compiled_model_binding_changed'); receipt.allowed.add(compiled);
}
/** The writer cannot use an arbitrary safe stylesheet as a seventh argument.
 * It requires the model object qualified by complete source/model derivation. */
export function assertNative44CurrentNativeModelDelta(before: DraftSnapshot, expected: DraftSnapshot, compiled: Native44Compiled, replacements: Native44CurrentNativeReplacement[], modules: Native44CSSModel['modules'], model: Native44CSSModel): void {
  const receipt = modelWrites.get(model);
  if (!receipt || !receipt.allowed.has(compiled) || canonicalV2(model) !== receipt.model || canonicalV2(before) !== receipt.before || canonicalV2(expected) !== receipt.expected || canonicalV2(replacements) !== receipt.replacements || !equal(modules, model.modules)) fail('model_write_current_process_identity_required');
  assertNative44Compilation(compiled, compiled.composition);
  const assembled = assembleNative44CurrentNativeSnapshot(before, compiled, replacements, modules, []), css = compileNative44CSSModel(model, { elements: assembled.elements }); assembled.settings.custom_css = css.css; assembled.hash = documentHashV2(assembled.elements, assembled.settings);
  if (!equal(assembled, expected)) fail('unexpected_model_document_delta');
}

/** Project only independently reverified record history onto the current
 * snapshot. A normal CSS revision cannot silently enable a pending form by
 * changing its wrapper/actions. Native leaves remain candidates until DOM
 * inspection; this function never measures a widget as its input/submit. */
export function projectNative44CurrentNativeModelRecords(recordsInput: Native44CurrentNativeModelRecord[], snapshot: DraftSnapshot) {
  const records = recordsInput.map(record => Native44CurrentNativeModelRecordSchema.parse(record)), latest = new Map<string, Native44CurrentNativeModelRecord['owners'][number]>();
  for (const record of records) {
    if (record.runId !== snapshot.runId || record.pageId !== snapshot.pageId || records[0]?.taskId !== record.taskId) fail('current_record_identity_conflict');
    for (const owner of record.owners) { const previous = latest.get(owner.originalComponentKey); if (previous && previous.newRootId !== owner.oldElementId) fail('current_record_owner_discontinuity'); latest.set(owner.originalComponentKey, owner); }
  }
  const nodes = native44SnapshotNodes(snapshot.elements), facts = new Set<string>();
  for (const owner of latest.values()) {
    const root = nodes.get(owner.newRootId)?.node; if (!root) fail('current_replacement_root_missing');
    if (owner.replacementRootId) { const shell = nodes.get(owner.replacementRootId)?.node; if (shell?.elType !== 'container' || shell.elements?.length !== 1 || shell.elements[0].id !== root.id) fail('current_replacement_shell_changed'); }
    const subtree = native44SnapshotNodes([root]);
    if (owner.descendantMappings) {
      if (!owner.originalSourceUnitIds || new Set(owner.descendantMappings.map(row => row.originalComponentKey)).size !== owner.descendantMappings.length || new Set(owner.descendantMappings.map(row => row.newRootId)).size !== owner.descendantMappings.length) fail('current_descendant_mapping_ambiguous');
      const mappedFacts = owner.descendantMappings.flatMap(row => row.sourceFactIds), mappedRequirements = owner.descendantMappings.flatMap(row => row.requirementIds);
      if (new Set(mappedFacts).size !== mappedFacts.length || mappedFacts.some(factId => !owner.sourceFactIds.includes(factId)) || new Set(mappedRequirements).size !== mappedRequirements.length || mappedRequirements.some(requirementId => !owner.requirements.some(row => row.requirementId === requirementId)) || owner.descendantMappings.some(row => row.newRootId === root.id || !subtree.has(row.newRootId))) fail('current_descendant_mapping_scope_conflict');
    }
    for (const control of owner.nativeControls) {
      const native = subtree.get(control.elementId)?.node;
      if (!native || native.elType !== 'widget' || native.widgetType !== control.widgetType || control.widgetType === 'form' && hashV2(canonicalV2(native.settings)) !== control.settingsHash) fail('current_replacement_control_changed');
    }
    for (const binding of owner.sourceFactBindings) {
      if (facts.has(binding.factId) || binding.currentElementIds.some(elementId => !owner.nativeControls.some(control => control.elementId === elementId))) fail('current_replacement_fact_owner_conflict'); facts.add(binding.factId);
      if (binding.role !== 'source-unit-fact') { if (binding.currentElementIds.length !== 1 || !equal(binding.currentLeaf, native44CurrentPendingFormLeaf(snapshot.pageId, binding.currentElementIds[0], binding.role))) fail('current_replacement_leaf_conflict'); }
      else if (binding.currentLeaf) fail('current_replacement_unproved_leaf');
    }
  }
  return [...latest.values()].flatMap(owner => {
    if (!owner.descendantMappings) return [owner];
    const assignedFacts = new Set(owner.descendantMappings.flatMap(row => row.sourceFactIds)), assignedRequirements = new Set(owner.descendantMappings.flatMap(row => row.requirementIds));
    const root = { ...owner, sourceUnitIds: owner.originalSourceUnitIds!, sourceFactIds: owner.sourceFactIds.filter(id => !assignedFacts.has(id)), sourceFactBindings: owner.sourceFactBindings.filter(row => !assignedFacts.has(row.factId)), requirements: owner.requirements.filter(row => !assignedRequirements.has(row.requirementId)) };
    const descendants = owner.descendantMappings.map(mapping => {
      const subtree = native44SnapshotNodes([nodes.get(mapping.newRootId)!.node]);
      return { ...owner, ...mapping, sourceFactBindings: owner.sourceFactBindings.filter(row => mapping.sourceFactIds.includes(row.factId)), requirements: owner.requirements.filter(row => mapping.requirementIds.includes(row.requirementId)), nativeControls: owner.nativeControls.filter(row => subtree.has(row.elementId)), replacementRootId: undefined, originalSourceUnitIds: undefined, descendantMappings: undefined };
    });
    return [root, ...descendants];
  });
}

/** Renderer presets are candidate locators. They preserve original source
 * interaction identities/alignment and still require fresh control captures. */
export function rebindNative44CurrentNativeManifest(manifest: Native44CompareManifest, record: Native44CurrentNativeModelRecord): Native44CompareManifest {
  const next = structuredClone(manifest);
  for (const owner of record.owners) {
    const widget = owner.nativeControls.find(control => control.elementId === owner.newRootId);
    if (!owner.replacementRootId || !widget) continue;
    const originalSelector = `.elementor-${record.pageId} [data-id="${owner.oldElementId}"]`, selector = `.elementor-${record.pageId} [data-id="${owner.newRootId}"]`;
    next.interactionChecks = next.interactionChecks?.map(check => {
      if (check.componentKey !== owner.originalComponentKey) return check;
      if (check.selector !== originalSelector) fail('manifest_original_interaction_owner_conflict');
      if (check.widgetType === widget.widgetType) return { ...check, selector };
      if (check.widgetType !== 'nested-carousel' || widget.widgetType !== 'wd_nested_carousel' || !owner.descendantMappings) fail('manifest_renderer_rebind_unsupported');
      return { ...check, selector, widgetType: widget.widgetType, nextSelector: '.wd-nav-arrows .wd-next', previousSelector: '.wd-nav-arrows .wd-prev', paginationSelector: '.wd-nav-pagin-item' };
    });
  }
  return next;
}

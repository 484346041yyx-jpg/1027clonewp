import { createHash } from 'node:crypto';
import { parseFragment } from 'parse5';
import { validateComponentPlanV2, type ComponentPlanV2 } from '../replica-v2/component-plan.js';
import { validateSourceFactsV2, type SourceFactsV2, type SourceFactV2 } from '../replica-v2/source.js';
import type { SceneInventoryV2 } from '../replica-v2/scene-inventory.js';
import type { LegacySchema } from '../wordpress/types.js';
import type { Native44Knowledge } from './knowledge.js';
import { assertNative44RegisteredSettings } from './settings.js';
import { normalizeRepeaterFields } from './adapters.js';
import { assertAllowedWidget } from './catalog.js';
import { assertProgramNativeWidget } from './product-extension.js';
import { walkNative44, type Native44Component, type Native44Program } from './types.js';
import type { Native44SourceUnit, Native44SelectionDecision } from './selection-types.js';
import { NATIVE44_SELECTION_RULES, NATIVE44_SELECTION_RULES_HASH, native44SelectionHash } from './selection-rules.js';

type FileRef = { path: string; sha256: string };
export interface Native44SelectionOptions {
  schemas?: Record<string, LegacySchema>;
  knowledge?: Native44Knowledge;
  /** Current-run files containing the actual installed schema observations. */
  contractEvidence?: Record<string, FileRef>;
}

const profile = 'desktop-browser-v1';
const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const sameRef = (a: FileRef, b: FileRef) => a.path === b.path && a.sha256 === b.sha256;
const widgetType = (node: Native44Component) => node.kind === 'composite' ? 'container' : node.kind === 'html-static' ? 'html' : node.widgetType;
const contentKinds = new Set(['text', 'media', 'interaction']);
const isPostQueryBinding=(node:Native44Component,path:string)=>node.kind==='native-posts'&&path==='query';
/** Only the repeated article body can substitute target post data. Headings,
 * adjacent copy and controls remain ordinary exact source bindings. */
function assertPostQuerySlot(program:Native44Program,unit:Native44SourceUnit,slot:Native44SourceUnit['slots'][number],plan:ComponentPlanV2):void{
  if(program.articleListPolicy!=='target-posts-v1'||unit.role!=='data-query'||!unit.repeatedItems?.length||slot.kind==='interaction')throw Error(`Source unit ${unit.id}/${slot.id}: target post substitution requires an explicit repeated article-list query`);
  for(const item of unit.repeatedItems){
    const slots=item.slotIds.map(id=>unit.slots.find(slot=>slot.id===id));
    if(!slots.some(slot=>slot?.kind==='text')||!slots.some(slot=>slot?.kind==='link'))throw Error(`Source unit ${unit.id}: article items require their actual title and article link`);
  }
  if(!unit.repeatedItems.some(item=>item.slotIds.includes(slot.id))||slot.factIds.some(id=>plan.requirements.find(requirement=>requirement.factIds.includes(id))?.disposition!=='adapt'))throw Error(`Source unit ${unit.id}/${slot.id}: target post data needs a scoped explicit article adaptation`);
}
const rawSchemaHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalSchema = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonicalSchema(item))) : Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, JSON.parse(canonicalSchema(item))])) : value);
export const NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS = Object.freeze({
  wd_products: { class: 'XTS\\Elementor\\Products', condition: { layout: 'carousel', carousel_sync: ['parent'] } },
  wd_testimonials: { class: 'XTS\\Elementor\\Testimonials', condition: { layout: 'slider', carousel_sync: ['parent'] } },
});
/** Source/actual registrations prove these exact Woodmart controls call uniqid().
 * This is schema identity only: authored settings and raw observations stay intact.
 * Every other default, class, condition and control field remains hash-bound. */
export function native44RegisteredSchemaEvidence(schema: LegacySchema): { value: LegacySchema; sha256: string; rawSha256: string; requestGeneratedDefaultNormalized: boolean } {
  const value = structuredClone(schema), sync = value.controls.sync_parent_id;
  const expected = NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS[value.type as keyof typeof NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS];
  const normalized = !!expected && value.class === expected.class && sync?.type === 'text' && typeof sync.default === 'string' && /^wd_[a-f0-9]{13}$/.test(sync.default) && canonicalSchema(sync.condition) === canonicalSchema(expected.condition) && !Object.hasOwn(sync, 'conditions');
  if (normalized && sync) delete sync.default;
  // The marker distinguishes a proved generated default from an absent default.
  // Merely deleting the field from an unrecognized registry must never acquire
  // the same identity as this exact source-proved normalization.
  const identity = { version: 1, kind: 'native44-registered-schema-identity', requestGeneratedDefaultNormalized: normalized, schema: value };
  return { value, sha256: createHash('sha256').update(canonicalSchema(identity)).digest('hex'), rawSha256: rawSchemaHash(schema), requestGeneratedDefaultNormalized: normalized };
}
export const native44RegisteredSchemaHash = (schema: LegacySchema): string => native44RegisteredSchemaEvidence(schema).sha256;
export function native44RegisteredSchemaHashMatches(schema: LegacySchema, declared: string): boolean {
  const identity = native44RegisteredSchemaEvidence(schema);
  return declared === identity.sha256 || declared === identity.rawSha256;
}
function underneath(source: SourceFactsV2, snapshotId: string, nodeId: string, owner: string): boolean {
  const nodes = source.snapshots.find(snapshot => snapshot.id === snapshotId)!.nodes, seen = new Set<string>();
  let current: string | null = nodeId;
  while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = nodes[current]?.parentId ?? null; }
  return false;
}
function screenshotMatches(source: SourceFactsV2, ref: { snapshotId: string; screenshot: FileRef }): boolean {
  const snapshot = source.snapshots.find(item => item.id === ref.snapshotId);
  return !!snapshot && sameRef(snapshot.screenshot, ref.screenshot);
}
function unique(values: string[], message: string): void { if (new Set(values).size !== values.length) throw Error(message); }
function assertSourceUnits(plan: ComponentPlanV2, source: SourceFactsV2): void {
  const units = plan.sourceUnits!, assigned = new Map<string, string>();
  unique(units.map(unit => unit.id), 'Duplicate source unit identity');
  for (const unit of units) {
    const snapshot = source.snapshots.find(item => item.id === unit.snapshotId);
    if (!snapshot || !snapshot.nodes[unit.ownerNodeId] || snapshot.nodes[unit.ownerNodeId].regionId !== unit.regionId) throw Error(`Source unit ${unit.id}: unknown snapshot or owner`);
    if (unit.role === 'deferred-query' && !(plan.catalogDeferrals ?? []).some(item => item.snapshotId === unit.snapshotId && source.sourceCommerce?.filter(record => record.snapshotId === unit.snapshotId).flatMap(record => record.groups).some(group => group.id === item.groupId && group.ownerNodeId === unit.ownerNodeId))) throw Error(`Source unit ${unit.id}: deferred query needs its explicit catalog deferral`);
    unique(unit.sourceFactIds, `Source unit ${unit.id}: duplicate source fact`);
    unique(unit.slots.map(slot => slot.id), `Source unit ${unit.id}: duplicate slot`);
    const facts = unit.sourceFactIds.map(id => source.facts[id]);
    if (facts.some(fact => !fact || fact.snapshotId !== unit.snapshotId || fact.regionId !== unit.regionId || !underneath(source, unit.snapshotId, fact.nodeId, unit.ownerNodeId))) throw Error(`Source unit ${unit.id}: fact outside its actual common owner`);
    if (unit.role === 'layout' && facts.some(fact => contentKinds.has(fact.kind))) throw Error(`Source unit ${unit.id}: layout cannot absorb ordinary content responsibilities`);
    if (unit.role === 'carousel' && !facts.some(fact => fact.kind === 'interaction' && fact.value.kind === 'carousel' && fact.nodeId === unit.ownerNodeId)) throw Error(`Source unit ${unit.id}: carousel role requires its actual controller ownership`);
    if (unit.evidence.factIds.some(id => !unit.sourceFactIds.includes(id)) || !unit.evidence.factIds.length) throw Error(`Source unit ${unit.id}: role evidence must reference its actual source facts`);
    if (unit.evidence.screenshots.some(ref => ref.snapshotId !== unit.snapshotId || !screenshotMatches(source, ref))) throw Error(`Source unit ${unit.id}: role evidence screenshot changed or belongs to another snapshot`);
    const slotted = new Set<string>();
    for (const slot of unit.slots) {
      unique(slot.factIds, `Source unit ${unit.id}/${slot.id}: duplicate fact`);
      for (const id of slot.factIds) {
        const fact = source.facts[id];
        if (!unit.sourceFactIds.includes(id) || !fact) throw Error(`Source unit ${unit.id}/${slot.id}: slot fact is outside its unit`);
        const expected = slot.kind === 'link' || slot.kind === 'interaction' ? 'interaction' : slot.kind;
        if (fact.kind !== expected || slot.kind === 'link' && typeof fact.value.href !== 'string') throw Error(`Source unit ${unit.id}/${slot.id}: slot kind differs from actual source fact`);
        if (slotted.has(id)) throw Error(`Source unit ${unit.id}: a source fact belongs to multiple slots`);
        slotted.add(id);
      }
    }
    for (const fact of facts) {
      if (contentKinds.has(fact.kind) && !slotted.has(fact.id)) throw Error(`Source unit ${unit.id}: required content fact has no slot ${fact.id}`);
      if (assigned.has(fact.id)) throw Error(`Source fact ${fact.id} assigned to multiple source units`);
      assigned.set(fact.id, unit.id);
    }
    unique((unit.repeatedItems ?? []).map(item => item.id), `Source unit ${unit.id}: duplicate repeated item`);
    const repeatedSlots = new Set<string>();
    for (const item of unit.repeatedItems ?? []) {
      if (!snapshot.nodes[item.ownerNodeId] || !underneath(source, unit.snapshotId, item.ownerNodeId, unit.ownerNodeId)) throw Error(`Source unit ${unit.id}: repeated item outside common owner`);
      for (const slotId of item.slotIds) {
        const slot = unit.slots.find(candidate => candidate.id === slotId);
        if (!slot || repeatedSlots.has(slotId) || slot.factIds.some(id => !underneath(source, unit.snapshotId, source.facts[id].nodeId, item.ownerNodeId))) throw Error(`Source unit ${unit.id}: repeated item slot ownership is invalid`);
        repeatedSlots.add(slotId);
      }
    }
    // DOM ownership prevents an author from relabelling list links as CTAs.
    const listOwnedLinks = facts.filter(fact => fact.kind === 'interaction' && typeof fact.value.href === 'string' && (fact.value.kind === 'navigation' || Object.entries(snapshot.nodes).some(([id, node]) => /^(?:UL|OL|NAV)$/i.test(node.tag) && underneath(source, unit.snapshotId, fact.nodeId, id))));
    if (/^(?:UL|OL|NAV)$/i.test(snapshot.nodes[unit.ownerNodeId].tag) && listOwnedLinks.length && !facts.some(fact => fact.kind === 'media' || fact.kind === 'interaction' && fact.value.kind === 'carousel') && !['navigation-list', 'breadcrumb', 'social-links', 'query', 'deferred-query', 'data-query'].includes(unit.role)) throw Error(`Source unit ${unit.id}: observed navigation-list ownership cannot be relabelled as ${unit.role}`);
    if (listOwnedLinks.length && !['navigation-list', 'image-card', 'information-card', 'marketing-card', 'query', 'deferred-query', 'data-query', 'social-links', 'breadcrumb', 'carousel'].includes(unit.role)) throw Error(`Source unit ${unit.id}: observed navigation-list ownership cannot be relabelled as ${unit.role}`);
    if (unit.role === 'navigation-list' && unit.slots.filter(slot => slot.kind === 'link').length > 1 && !(unit.repeatedItems?.length)) throw Error(`Source unit ${unit.id}: navigation list requires its actual repeated item boundaries`);
    if (unit.role === 'navigation-list' && unit.slots.filter(slot => slot.kind === 'link').length > 1 && unit.slots.some(slot => slot.kind === 'link' && !repeatedSlots.has(slot.id))) throw Error(`Source unit ${unit.id}: navigation link lacks its repeated item owner`);
    if (unit.role === 'heading' && facts.some(fact => fact.kind === 'text' && (fact.value.kind === 'body' || /^(?:P|SMALL)$/i.test(snapshot.nodes[fact.nodeId].tag)))) throw Error(`Source unit ${unit.id}: source description/body cannot be relabelled as heading`);
    if (unit.role === 'query' && !(source.sourceCommerce ?? []).some(record => record.snapshotId === unit.snapshotId && record.groups.some(group => group.status === 'catalog' && group.ownerNodeId === unit.ownerNodeId))) throw Error(`Source unit ${unit.id}: query role requires independently observed catalog ownership`);
  }
  for (const fact of Object.values(source.facts)) if (!assigned.has(fact.id)) throw Error(`Source fact ${fact.id} has no independently authored source unit`);
}

/** The new profile keeps full source/requirement/inventory validation while the
 * historical final-stage tablet/mobile requirement remains on old plans. */
export function validateDesktopComponentPlan(value: unknown, facts: SourceFactsV2, options: { sceneInventories?: SceneInventoryV2[] } = {}): ComponentPlanV2 {
  const plan = validateComponentPlanV2(value, facts, { stage: 'final', sceneInventories: options.sceneInventories, replicationProfile: profile });
  if (plan.replicationProfile !== profile) throw Error('Desktop selection validation requires desktop-browser-v1');
  if (plan.selectionRulesHash !== NATIVE44_SELECTION_RULES_HASH) throw Error('Selection rules hash changed or is unknown');
  for (const item of plan.catalogDeferrals ?? []) if (!item.userRequestedOmission) throw Error('Catalog deferral requires an explicit instruction to leave empty or remove the whole product area; unspecified product items keep native product components');
  const source = validateSourceFactsV2(facts);
  assertSourceUnits(plan, source);
  assertReview(plan, source);
  return plan;
}
function assertReview(plan: ComponentPlanV2, source: SourceFactsV2): void {
  const review = plan.selectionReview!;
  if (!sameRef(review.sourceFacts, plan.sourceFacts) || review.selectionRulesHash !== plan.selectionRulesHash) throw Error('Selection review is not bound to the current facts and rules');
  if (review.decisionsSha256 !== native44SelectionHash({ sourceUnits: plan.sourceUnits, selectionDecisions: plan.selectionDecisions })) throw Error('Selection decisions changed after the whole-page review');
  unique(review.reviewedUnitIds, 'Selection review repeats a source unit');
  if (review.reviewedUnitIds.length !== plan.sourceUnits!.length || plan.sourceUnits!.some(unit => !review.reviewedUnitIds.includes(unit.id))) throw Error('Selection review does not cover the complete page');
  unique(review.screenshots.map(ref => ref.snapshotId), 'Selection review repeats a screenshot');
  if (review.screenshots.length !== source.snapshots.length || source.snapshots.some(snapshot => !review.screenshots.some(ref => ref.snapshotId === snapshot.id && screenshotMatches(source, ref)))) throw Error('Selection review requires the actual screenshot for every source snapshot');
}

function readPath(node: Native44Component, path: string): unknown {
  let value: unknown = node;
  for (const part of path.split('.')) {
    if (['__proto__', 'constructor', 'prototype'].includes(part) || !value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
/** Inline links remain editable in the registered native rich-text field. The
 * exact observed href must occur on a real anchor, never in plain text or an
 * unrelated setting. This identifies content only, not destination behavior. */
function inlineLinkMatches(node: Native44Component, settingPath: string, value: unknown, href: unknown): boolean {
  if (node.kind !== 'native' || node.widgetType !== 'text-editor' || settingPath !== 'widgetSettings.editor' || typeof value !== 'string' || typeof href !== 'string') return false;
  let matched = false;
  const visit = (entry: any): void => {
    if (entry.tagName === 'a' && entry.attrs?.some((attribute: any) => attribute.name === 'href' && attribute.value === href)) matched = true;
    entry.childNodes?.forEach(visit);
  };
  visit(parseFragment(value)); return matched;
}
export function native44SelectedPlainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const fragment = parseFragment(value); let text = '';
  const blocks = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul']);
  const visit = (node: unknown): void => {
    const n = node as { nodeName?: string; value?: string; childNodes?: unknown[] };
    if (blocks.has(n.nodeName ?? '')) text += ' ';
    if (n.nodeName === '#text') text += n.value ?? '';
    n.childNodes?.forEach(visit);
    if (blocks.has(n.nodeName ?? '')) text += ' ';
  };
  visit(fragment); return normalize(text);
}

interface SelectedTextGroup { snapshotId: string; componentKey: string; settingPath: string; facts: Map<string, SourceFactV2>; unitIds: Set<string> }
/** Aggregate one actual field only. DOM child order supplies paragraph order;
 * global fact/slot arrays cannot move copy between cards or source owners. */
export function assertNative44SelectedContentBindings(program: Native44Program, plan: ComponentPlanV2, source: SourceFactsV2): void {
  const components = new Map(walkNative44(program.blocks).map(node => [node.key, node]));
  const units = new Map((plan.sourceUnits ?? []).map(unit => [unit.id, unit]));
  const groups = new Map<string, SelectedTextGroup>();
  const parentKeys = new Map<string, string | null>();
  const collectParents = (nodes: Native44Component[], parent: string | null): void => { for (const node of nodes) { parentKeys.set(node.key, parent); if (node.kind === 'composite' || node.kind === 'native') collectParents(node.children ?? [], node.key); if (node.kind === 'native-carousel') collectParents(node.slides ?? [], node.key); } };
  collectParents(program.blocks, null);
  const withinTargetOwner = (key: string, owner: string) => { let current: string | null = key; const seen = new Set<string>(); while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = parentKeys.get(current) ?? null; } return false; };
  const requirementByFact = new Map(plan.requirements.flatMap(requirement => requirement.factIds.map(id => [id, requirement] as const)));
  const covered = new Set<string>();
  for (const decision of plan.selectionDecisions ?? []) {
    const unit = units.get(decision.unitId); if (!unit) throw Error(`Unknown selection source unit: ${decision.unitId}`);
    for (const binding of decision.slotBindings) {
      const slot = unit.slots.find(candidate => candidate.id === binding.slotId), node = components.get(binding.componentKey);
      if (!slot || !node || !decision.componentKeys.includes(node.key)) throw Error(`Source unit ${unit.id}: slot binding refers outside its actual selection`);
      const value = readPath(node, binding.settingPath);
      if (value === undefined) throw Error(`Source unit ${unit.id}/${slot.id}: setting path does not exist`);
      for (const id of slot.factIds) {
        const fact = source.facts[id], requirement = requirementByFact.get(id);
        if (!fact || !requirement || fact.snapshotId !== unit.snapshotId || !unit.sourceFactIds.includes(id) || !underneath(source, unit.snapshotId, fact.nodeId, unit.ownerNodeId)) throw Error(`Source unit ${unit.id}/${slot.id}: unproven source slot owner`);
        if (!withinTargetOwner(node.key, requirement.componentId)) throw Error(`Source unit ${unit.id}/${slot.id}: setting is outside its required component owner`);
        const postQuery=isPostQueryBinding(node,binding.settingPath);
        if(postQuery)assertPostQuerySlot(program,unit,slot,plan);
        const query = postQuery||node.kind === 'native-products' && /^(?:query|tabs\.\d+\.query)$/.test(binding.settingPath);
        if (query) { covered.add(id); continue; }
        if (slot.kind === 'text' && requirement.disposition === 'preserve') {
          const key = JSON.stringify([unit.snapshotId, node.key, binding.settingPath]);
          const group = groups.get(key) ?? { snapshotId: unit.snapshotId, componentKey: node.key, settingPath: binding.settingPath, facts: new Map(), unitIds: new Set() };
          group.facts.set(id, fact); group.unitIds.add(unit.id); groups.set(key, group); covered.add(id);
        }
        if (slot.kind === 'media' && requirement.disposition === 'preserve') {
          const expected = requirement.verification.expected;
          const expectedKey = typeof expected === 'string' ? expected : expected && typeof expected === 'object' && !Array.isArray(expected) ? (expected as { assetKey?: unknown }).assetKey : undefined;
          const actualKey = value && typeof value === 'object' ? (value as { $asset?: unknown; assetKey?: unknown }).$asset ?? (value as { assetKey?: unknown }).assetKey : undefined;
          if (typeof expectedKey !== 'string' || actualKey !== expectedKey) throw Error(`Source unit ${unit.id}/${slot.id}: preserved media asset differs from its exact source binding`);
          covered.add(id);
        }
        if (slot.kind === 'link' && (requirement.disposition === 'external' || requirement.disposition === 'preserve')) {
          const href = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { url?: unknown }).url : undefined;
          const expected = requirement.disposition === 'external' ? requirement.verification.expected : fact.value.href;
          if (href !== expected && !inlineLinkMatches(node, binding.settingPath, value, expected)) throw Error(`Source unit ${unit.id}/${slot.id}: external entrance is absent from its exact component field`);
          covered.add(id);
        }
      }
    }
  }
  for (const group of groups.values()) {
    const snapshot = source.snapshots.find(snapshot => snapshot.id === group.snapshotId)!;
    const facts = [...group.facts.values()], regions = new Set(facts.map(fact => fact.regionId));
    if (regions.size !== 1) throw Error(`Selected text field ${group.componentKey}/${group.settingPath}: copy crosses source regions`);
    const cardBoundaries = new Set<string>([
      ...plan.components.flatMap(component => (component.itemSlots ?? []).flatMap(slot => slot.nodeIds)),
      ...[...units.values()].filter(unit => unit.snapshotId === group.snapshotId && ['image-card', 'information-card', 'marketing-card', 'image-advertisement'].includes(unit.role)).map(unit => unit.ownerNodeId),
      ...[...units.values()].filter(unit => unit.snapshotId === group.snapshotId).flatMap(unit => (unit.repeatedItems ?? []).map(item => item.ownerNodeId)),
      ...(source.sourceCommerce ?? []).filter(record => record.snapshotId === group.snapshotId).flatMap(record => record.groups.flatMap(item => item.cardNodeIds)),
    ]);
    const boundary = (nodeId: string) => {
      let current: string | null = nodeId; const seen = new Set<string>();
      while (current && !seen.has(current)) { seen.add(current); const node: SourceFactsV2['snapshots'][number]['nodes'][string] = snapshot.nodes[current]; if (cardBoundaries.has(current) || /^(?:ARTICLE|FIGURE|LI|SECTION|NAV)$/i.test(node.tag)) return current; current = node.parentId; }
      return null;
    };
    if (new Set(facts.map(fact => boundary(fact.nodeId))).size > 1) throw Error(`Selected text field ${group.componentKey}/${group.settingPath}: copy crosses independent card or section owners`);
    const ancestors = (id: string): string[] => { const result: string[] = [], seen = new Set<string>(); let current: string | null = id; while (current && !seen.has(current)) { result.push(current); seen.add(current); current = snapshot.nodes[current]?.parentId ?? null; } return result; };
    const commonOwner = ancestors(facts[0].nodeId).find(id => facts.every(fact => underneath(source, group.snapshotId, fact.nodeId, id)));
    if (!commonOwner) throw Error(`Selected text field ${group.componentKey}/${group.settingPath}: source text has no common natural-flow owner`);
    const order = new Map<string, number>(); let index = 0;
    const visit = (id: string) => { if (order.has(id)) return; order.set(id, index++); snapshot.nodes[id].childIds.forEach(visit); }; visit(commonOwner);
    if (facts.some(fact => !order.has(fact.nodeId)) || new Set(facts.map(fact => fact.nodeId)).size !== facts.length) throw Error(`Selected text field ${group.componentKey}/${group.settingPath}: source text order is ambiguous`);
    facts.sort((a, b) => order.get(a.nodeId)! - order.get(b.nodeId)!);
    const expected = normalize(facts.map(fact => String(fact.value.text)).join(' '));
    const actual = native44SelectedPlainText(readPath(components.get(group.componentKey)!, group.settingPath));
    if (actual !== expected) throw Error(`Selected text field ${group.componentKey}/${group.settingPath}: preserved text binding differs from source natural flow`);
  }
  for (const requirement of plan.requirements) if (requirement.disposition === 'preserve' && ['text', 'media'].includes(requirement.verification.kind) || requirement.disposition === 'external') for (const id of requirement.factIds) if (!covered.has(id)) throw Error(`Source requirement ${requirement.id}: exact selected content binding is absent`);
}
function settingControl(schema: LegacySchema, path: string): { type: string } | undefined {
  const parts = path.split('.'), owner = parts.shift();
  if (owner !== 'widgetSettings' && !(owner === 'settings' && schema.type === 'container')) return undefined;
  let fields = schema.controls, control: LegacySchema['controls'][string] | undefined;
  while (parts.length) {
    const name = parts.shift()!; control = fields[name]; if (!control) return undefined;
    if (parts.length && /^\d+$/.test(parts[0])) { parts.shift(); fields = normalizeRepeaterFields(control); continue; }
    if (parts.length) { if (control.type === 'url' && parts.join('.') === 'url') return control; return undefined; }
  }
  return control;
}
function semanticDecision(unit: Native44SourceUnit, decision: Native44SelectionDecision, nodes: Native44Component[]): void {
  const types = nodes.map(widgetType), content = types.filter(type => type !== 'container');
  if (['navigation-list', 'link', 'description', 'body', 'heading'].includes(unit.role) && content.some(type => type === 'button' || type === 'wd_button')) throw Error(`Source unit ${unit.id}: ordinary navigation/text cannot use a button`);
  if (['description', 'body'].includes(unit.role) && content.some(type => NATIVE44_SELECTION_RULES.headings.includes(type as 'heading'))) throw Error(`Source unit ${unit.id}: description/body cannot use a heading`);
  if (['description', 'body'].includes(unit.role) && !content.some(type => NATIVE44_SELECTION_RULES.body.includes(type as 'text-editor'))) throw Error(`Source unit ${unit.id}: body content requires a native text component`);
  if (unit.role === 'heading' && !content.some(type => NATIVE44_SELECTION_RULES.headings.includes(type as 'heading'))) throw Error(`Source unit ${unit.id}: heading requires its native heading component`);
  if (unit.role === 'image' && !content.some(type => type === 'wd_image_or_svg')) throw Error(`Source unit ${unit.id}: a plain image requires its native image component`);
  if (['marketing-card', 'image-card', 'image-advertisement', 'information-card', 'image'].includes(unit.role) && content.some(type => NATIVE44_SELECTION_RULES.staticMarketingForbiddenQueries.includes(type as 'wd_products'))) throw Error(`Source unit ${unit.id}: static marketing cannot use a target catalog query`);
  if (unit.role === 'query' && !nodes.some(node => node.kind === 'native-products')) throw Error(`Source unit ${unit.id}: actual catalog requires a native-products query`);
  if (unit.role === 'data-query' && !nodes.some(node => node.kind === 'native-posts'||node.kind === 'native' && node.resources?.length)) throw Error(`Source unit ${unit.id}: data query requires an explicit existing target resource binding`);
  if(nodes.some(node=>node.kind==='native-posts')&&unit.role!=='data-query')throw Error(`Source unit ${unit.id}: native posts require an article data-query source responsibility`);
  const posts=nodes.filter(node=>node.kind==='native-posts');
  if(posts.length){
    if(posts.length!==1||!unit.repeatedItems?.length)throw Error(`Source unit ${unit.id}: one article-list body requires one native blog query`);
    for(const slotId of unit.repeatedItems.flatMap(item=>item.slotIds))if(!decision.slotBindings.some(binding=>binding.slotId===slotId&&binding.componentKey===posts[0].key&&binding.settingPath==='query'))throw Error(`Source unit ${unit.id}: article items must use the native blog query rather than manually copied cards`);
  }
  if (unit.role === 'navigation-list' && !content.some(type => NATIVE44_SELECTION_RULES.navigation.includes(type as 'wd_list'))) throw Error(`Source unit ${unit.id}: navigation list requires a list or semantic rich-text component`);
  const preferred = unit.role === 'image-card' ? 'image-box' : unit.role === 'information-card' ? 'wd_infobox' : undefined;
  if (preferred && !content.includes(preferred)) {
    if (!decision.compositionReason || !decision.candidates.some(candidate => candidate.conclusion === 'unsuitable' && candidate.widgetTypes.includes(preferred))) throw Error(`Source unit ${unit.id}: native combination must explain why the complete ${preferred} card is unsuitable`);
  }
  if (decision.compositionReason && /(?:font|colou?r|spacing|margin|padding|尺寸|字体|间距|颜色)/i.test(decision.compositionReason.detail) && !/(?:multiple links|content order|missing fields|多个链接|内容顺序|缺少字段)/i.test(decision.compositionReason.detail)) throw Error(`Source unit ${unit.id}: styling alone cannot justify splitting a complete card`);
  if (['image-card', 'information-card'].includes(unit.role) && content.every(type => type === 'button' || type === 'wd_button')) throw Error(`Source unit ${unit.id}: a complete image card cannot be represented by a button`);
}

/** Local planning runs without schemas. After read-only target discovery, the
 * same contract is rechecked against researched and registered settings. */
export function validateNative44Selection(program: Native44Program, plan: ComponentPlanV2, facts: SourceFactsV2, options: Native44SelectionOptions = {}): void {
  const programProfile = (program as Native44Program & { replicationProfile?: string; selectionRulesHash?: string }).replicationProfile;
  if (!programProfile && !plan.replicationProfile) return;
  if (programProfile !== profile || plan.replicationProfile !== profile) throw Error('Program and component plan replication profiles differ');
  if ((program as Native44Program & { selectionRulesHash?: string }).selectionRulesHash !== NATIVE44_SELECTION_RULES_HASH || plan.selectionRulesHash !== NATIVE44_SELECTION_RULES_HASH) throw Error('Program/plan selection rules identity differs');
  for (const item of plan.catalogDeferrals ?? []) if (!item.userRequestedOmission) throw Error('Catalog deferral requires an explicit instruction to leave empty or remove the whole product area; unspecified product items keep native product components');
  if (!sameRef(program.sourceFacts, plan.sourceFacts)) throw Error('Selection plan source identity differs from program');
  const source = validateSourceFactsV2(facts); assertSourceUnits(plan, source); assertReview(plan, source);
  for (const item of plan.catalogDeferrals ?? []) {
    const nodes = walkNative44(program.blocks), placeholder = nodes.find(node => node.key === item.componentId);
    if (!placeholder || placeholder.kind !== 'composite' || walkNative44([placeholder]).some(node => node.kind === 'native-products' || node.kind === 'native-posts' || node.kind === 'html-static' || node.kind === 'native' && !['text-editor', 'heading', 'divider'].includes(node.widgetType))) throw Error('Deferred catalog can only render an editable structural placeholder, never product cards');
  }
  const units = new Map(plan.sourceUnits!.map(unit => [unit.id, unit])), components = new Map(walkNative44(program.blocks).map(node => [node.key, node]));
  const covered = new Set<string>(), decisions = plan.selectionDecisions!;
  unique(decisions.map(decision => decision.unitId), 'Source unit has multiple selection decisions');
  if (decisions.length !== units.size) throw Error('Every source unit needs one selection decision');
  for (const decision of decisions) {
    const unit = units.get(decision.unitId); if (!unit) throw Error(`Unknown selection source unit: ${decision.unitId}`);
    unique(decision.componentKeys, `Source unit ${unit.id}: duplicate selected component`);
    const nodes = decision.componentKeys.map(key => components.get(key));
    if (nodes.some(node => !node)) throw Error(`Source unit ${unit.id}: selection references an unknown component`);
    const actualNodes = nodes as Native44Component[];
    for (const node of actualNodes) covered.add(node.key);
    for (const candidate of decision.candidates) candidate.widgetTypes.forEach(type => assertProgramNativeWidget(type, program.componentExtension));
    const types = [...new Set(actualNodes.map(widgetType))].sort();
    if (!decision.candidates.some(candidate => candidate.conclusion === 'selected' && JSON.stringify([...new Set(candidate.widgetTypes)].sort()) === JSON.stringify(types))) throw Error(`Source unit ${unit.id}: selected candidate differs from the actual component types`);
    semanticDecision(unit, decision, actualNodes);
    unique(decision.slotBindings.map(binding => binding.slotId), `Source unit ${unit.id}: duplicate slot binding`);
    for (const slot of unit.slots) if (!decision.slotBindings.some(binding => binding.slotId === slot.id)) {
      const omittedWithExplicitAdaptation = !slot.required && slot.factIds.every(id => plan.requirements.some(requirement => requirement.factIds.includes(id) && requirement.disposition === 'adapt' && requirement.verification.expected && typeof requirement.verification.expected === 'object' && !Array.isArray(requirement.verification.expected) && (requirement.verification.expected as { visible?: unknown }).visible === false));
      if (!omittedWithExplicitAdaptation) throw Error(`Source unit ${unit.id}: required slot ${slot.id} is unbound`);
    }
    for (const binding of decision.slotBindings) {
      const slot = unit.slots.find(item => item.id === binding.slotId), node = components.get(binding.componentKey);
      if (!slot || !node || !decision.componentKeys.includes(node.key)) throw Error(`Source unit ${unit.id}: slot binding refers outside its actual selection`);
      const value = readPath(node, binding.settingPath);
      if (value === undefined) throw Error(`Source unit ${unit.id}/${slot.id}: setting path does not exist`);
      const actualFacts = slot.factIds.map(id => source.facts[id]);
      const dispositions = actualFacts.map(fact => plan.requirements.find(requirement => requirement.factIds.includes(fact.id))?.disposition);
      if (dispositions.some(value => !value)) throw Error(`Source unit ${unit.id}/${slot.id}: missing source requirement`);
      const postQuery=isPostQueryBinding(node,binding.settingPath);
      if(postQuery)assertPostQuerySlot(program,unit,slot,plan);
      const query = postQuery||node.kind === 'native-products' && /^(?:query|tabs\.\d+\.query)$/.test(binding.settingPath);
      if (query && unit.role !== (postQuery?'data-query':'query')) throw Error(`Source unit ${unit.id}/${slot.id}: static content cannot bind to a query`);
      if (!query && dispositions.every(value => value === 'preserve')) {
        if (slot.kind === 'link') { const href = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { url?: unknown }).url : undefined; if (actualFacts.some(fact => href !== fact.value.href && !inlineLinkMatches(node, binding.settingPath, value, fact.value.href))) throw Error(`Source unit ${unit.id}/${slot.id}: link binding differs from source`); }
        if (slot.kind === 'media' && !(value && typeof value === 'object' && (typeof (value as { $asset?: unknown }).$asset === 'string' || typeof (value as { assetKey?: unknown }).assetKey === 'string'))) throw Error(`Source unit ${unit.id}/${slot.id}: media must bind a task asset slot`);
      }
      if (options.schemas && !query && node.kind !== 'html-static') {
        const schema = options.schemas[widgetType(node)];
        if (!schema) throw Error(`Source unit ${unit.id}: target contract is unverified for ${widgetType(node)}`);
        const control = settingControl(schema, binding.settingPath);
        const compatible = control && (slot.kind === 'text' ? ['text', 'textarea', 'wysiwyg', 'code', 'hidden'].includes(control.type) : slot.kind === 'media' ? ['media', 'gallery'].includes(control.type) : slot.kind === 'link' ? ['url', 'text'].includes(control.type) || control.type === 'wysiwyg' && actualFacts.every(fact => inlineLinkMatches(node, binding.settingPath, value, fact.value.href)) : true);
        if (!compatible) throw Error(`Source unit ${unit.id}/${slot.id}: slot type differs from registered setting contract`);
      }
    }
    for (const type of types) {
      if (!decision.contractRefs.some(ref => ref.widgetType === type && ref.scope === 'local-source')) throw Error(`Source unit ${unit.id}: missing researched contract for ${type}`);
      if (options.knowledge && !decision.contractRefs.some(ref => ref.widgetType === type && ref.scope === 'local-source' && ref.schemaSha256 === options.knowledge!.index.components[type]?.sha256)) throw Error(`Source unit ${unit.id}: researched contract identity changed for ${type}`);
      if (options.schemas) {
        const schema = options.schemas[type], researched = options.knowledge?.components[type];
        if (!schema || !researched) throw Error(`Source unit ${unit.id}: local/target contract is unverified for ${type}`);
        // Historical raw hashes remain valid only for this exact observed raw
        // schema. A prior random default never becomes a normalized new identity.
        const contract = decision.contractRefs.find(ref => ref.widgetType === type && ref.scope === 'target-registered' && native44RegisteredSchemaHashMatches(schema, ref.schemaSha256));
        if (!contract || options.contractEvidence?.[type] && !sameRef(contract.evidence, options.contractEvidence[type])) throw Error(`Source unit ${unit.id}: target contract evidence changed for ${type}`);
        for (const node of actualNodes.filter(node => widgetType(node) === type)) {
          const settings = node.kind === 'composite' ? node.settings ?? {} : node.kind === 'html-static' ? {} : node.widgetSettings;
          assertNative44RegisteredSettings(researched, settings, schema.controls);
        }
      }
    }
  }
  for (const [key, node] of components) {
    if (!covered.has(key)) throw Error(`Component ${key} has no content selection decision`);
    const unitFacts = new Set(decisions.filter(decision => decision.componentKeys.includes(key)).flatMap(decision => units.get(decision.unitId)!.sourceFactIds));
    if (node.sourceFactIds?.some(id => !unitFacts.has(id))) throw Error(`Component ${key}: source facts belong to another content unit`);
  }
  assertNative44SelectedContentBindings(program, plan, source);
}

export { NATIVE44_SELECTION_RULES, NATIVE44_SELECTION_RULES_HASH, native44SelectionHash } from './selection-rules.js';

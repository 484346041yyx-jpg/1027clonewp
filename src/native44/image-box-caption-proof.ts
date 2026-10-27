import path from 'node:path';
import { z } from 'zod';
import { canonicalV2, documentHashV2, hashV2 } from '../replica-v2/journal.js';
import { validateObservationPacketV2 } from '../replica-v2/observation.js';
import type { ElementorElement } from '../wordpress/types.js';
import type { Native44CSSModel } from './css-model.js';

const digest = z.string().regex(/^[a-f\d]{64}$/), name = z.string().min(1).max(500);
const ref = z.object({ path: z.string().min(1).max(4096), sha256: digest }).strict();
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict();
export const Native44SourceImageBoxCaptionObservationSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-source-image-box-caption-observation'), sourceUrl: z.string().url(), observedAt: z.iso.datetime(), stage: z.enum(['default', 'hover', 'restored']),
  input: z.object({ method: z.enum(['readonly-dom', 'cua-drag-pointer']), selectionMayChange: z.boolean() }).strict(),
  viewport: z.object({ width: z.number().int(), height: z.number().int(), clientWidth: z.number().int().positive(), devicePixelRatio: z.literal(1) }).strict(),
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(), limitations: z.array(z.string()).optional(), rawEvidence: ref.optional(),
  cards: z.array(z.object({
    componentKey: name, selector: name, hovered: z.boolean(), active: z.boolean(), rect, href: z.string().url(),
    title: z.object({ selector: name, text: name, opacity: z.string() }).strict(),
    caption: z.object({ selector: name, opacity: z.string(), display: z.string(), visibility: z.string(), rect }).strict(),
    image: z.object({ selector: name, src: z.string(), currentSrc: z.string(), opacity: z.string(), display: z.string(), visibility: z.string(), rect }).strict(),
  }).strict()).min(1).max(100),
}).strict();
export const Native44ImageBoxCaptionRevealProofSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-image-box-caption-reveal-proof'), taskId: name, sourceUrl: z.string().url(), program: ref, sourceFacts: ref, componentPlan: ref, targetSnapshot: ref,
  targetDOM: z.array(z.object({ viewport: z.enum(['desktop-wide', 'desktop-narrow']), evidence: ref }).strict()).length(2),
  cards: z.array(z.object({ componentKey: name, elementId: name, cardClass: name, baselines: z.array(z.object({ snapshotId: name, titleFactId: name, cardNodeId: name, captionNodeId: name, titleNodeId: name, packet: ref, defaultObservation: ref, hoverObservation: ref, restoredObservation: ref }).strict()).length(2) }).strict()).min(1).max(100),
}).strict();

export interface VerifiedImageBoxCaptionReveals { readonly kind: 'verified-image-box-caption-reveals' }
type Qualification = VerifiedImageBoxCaptionReveals & { modelHash: string; elementsHash: string; permissions: ReadonlySet<string> };
const qualifiedModels = new WeakMap<object, Qualification>(), qualifiedTokens = new WeakSet<object>();
const normalize = (value: unknown) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
const equal = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
function fail(reason: string): never { throw Error(`native44_image_box_caption_${reason}`); }
const captionRules = (model: Native44CSSModel) => model.rules.filter(rule => rule.nativeStructure?.kind === 'image-box-caption-reveal');
const permission = (moduleKey: string, selector: string | undefined, media: string | undefined, binding: unknown, value: string) => canonicalV2([moduleKey, selector ?? '', media ?? '', binding, 'opacity', value]);

/** Only a successful complete async source graph check registers this object.
 * JSON, a copied model, or subsequent model/tree mutation cannot carry it. */
export function verifiedImageBoxCaptionReveals(model: Native44CSSModel, elements?: ElementorElement[]): VerifiedImageBoxCaptionReveals | undefined {
  if (!captionRules(model).length) return undefined;
  const token = qualifiedModels.get(model);
  if (!token || !elements || token.modelHash !== hashV2(canonicalV2(model)) || token.elementsHash !== hashV2(canonicalV2(elements))) fail('source_proof_not_verified_for_model_and_tree');
  return token;
}
export function imageBoxCaptionOpacityAuthorized(token: VerifiedImageBoxCaptionReveals | undefined, rule: { moduleKey: string; selector?: string; media?: string; nativeStructure?: unknown; declarations: Record<string, string> }): boolean {
  return !!token && qualifiedTokens.has(token) && Object.keys(rule.declarations).join(',') === 'opacity' && (token as Qualification).permissions.has(permission(rule.moduleKey, rule.selector, rule.media, rule.nativeStructure, rule.declarations.opacity));
}

export async function verifyNative44ImageBoxCaptionReveals(input: { root: string; model: Native44CSSModel; elements: ElementorElement[]; program: z.infer<typeof ref>; sourceFacts: z.infer<typeof ref>; componentPlan: z.infer<typeof ref>; read: (reference: z.infer<typeof ref>) => Promise<Uint8Array> }): Promise<void> {
  const rules = captionRules(input.model); if (!rules.length) return;
  qualifiedModels.delete(input.model);
  const cache = new Map<string, any>(), absolute = (filename: string) => path.resolve(input.root, filename), sameRef = (a: any, b: any) => a?.sha256 === b?.sha256 && absolute(a?.path ?? '') === absolute(b?.path ?? '');
  const read = async (reference: z.infer<typeof ref>) => {
    ref.parse(reference); const filename = absolute(reference.path), family = ['references', 'runs'].some(name => { const relative = path.relative(path.join(input.root, name), filename); return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative); });
    if (!family || !filename.endsWith('.json') || /[?\r\n]|^[a-z]+:\/\//i.test(reference.path)) fail('evidence_owner_invalid');
    const key = canonicalV2(reference); if (!cache.has(key)) { const bytes = await input.read(reference); if (hashV2(Buffer.from(bytes)) !== reference.sha256) fail('evidence_hash_changed'); cache.set(key, JSON.parse(Buffer.from(bytes).toString('utf8'))); } return cache.get(key);
  };
  const [program, source, plan] = await Promise.all([read(input.program), read(input.sourceFacts), read(input.componentPlan)]);
  if (program.taskId !== input.model.taskId || source.sourceUrl !== program.sourceUrl || !sameRef(program.sourceFacts, input.sourceFacts) || !sameRef(program.componentPlan, input.componentPlan) || !sameRef(plan.sourceFacts, input.sourceFacts)) fail('frozen_source_identity_invalid');
  const original = new Map<string, any>(); const walkOriginal = (nodes: any[]) => nodes.forEach(node => { if (original.has(node.key)) fail('original_component_ambiguous'); original.set(node.key, node); walkOriginal(node.children ?? []); }); walkOriginal(program.blocks);
  const tree = new Map<string, ElementorElement>(), parents = new Map<string, string>(), classes = new Map<string, string[]>();
  const walk = (nodes: ElementorElement[], parent?: string) => nodes.forEach(node => { if (tree.has(node.id)) fail('native_owner_ambiguous'); tree.set(node.id, node); if (parent) parents.set(node.id, parent); for (const field of ['css_classes', '_css_classes']) if (typeof node.settings[field] === 'string') for (const value of (node.settings[field] as string).split(/\s+/).filter(Boolean)) classes.set(value, [...classes.get(value) ?? [], node.id]); walk(node.elements ?? [], node.id); }); walk(input.elements);
  const underneath = (nodes: Record<string, any>, id: string, owner: string) => { const seen = new Set<string>(); let at: string | null = id; while (at && !seen.has(at)) { if (at === owner) return true; seen.add(at); at = nodes[at]?.parentId ?? null; } return false; };
  const inside = (id: string, owner: string) => { const seen = new Set<string>(); let at: string | undefined = id; while (at && !seen.has(at)) { if (at === owner) return true; seen.add(at); at = parents.get(at); } return false; };
  const visible = (value: any) => Number(value.opacity) === 1 && value.display !== 'none' && !['hidden', 'collapse'].includes(value.visibility);
  const sameSize = (a: any, b: any) => a && b && Math.abs(a.width - b.width) <= 0.01 && Math.abs(a.height - b.height) <= 0.01;
  const permissions = new Set<string>();
  for (const rule of rules) {
    const binding = rule.nativeStructure!; if (binding.kind !== 'image-box-caption-reveal') fail('binding_invalid');
    const proof = Native44ImageBoxCaptionRevealProofSchema.parse(await read(binding.proof));
    if (proof.taskId !== input.model.taskId || proof.sourceUrl !== program.sourceUrl || !sameRef(proof.program, input.program) || !sameRef(proof.sourceFacts, input.sourceFacts) || !sameRef(proof.componentPlan, input.componentPlan) || new Set(proof.cards.map(card => card.componentKey)).size !== proof.cards.length || new Set(proof.cards.map(card => card.elementId)).size !== proof.cards.length) fail('proof_identity_invalid');
    const matches = proof.cards.filter(card => card.componentKey === binding.componentKey && card.elementId === binding.elementId && card.cardClass === binding.cardClass);
    if (matches.length !== 1) fail('card_binding_missing'); const card = matches[0], native = tree.get(card.elementId), frozen = original.get(card.componentKey), module = input.model.modules.find(module => module.key === rule.moduleKey), moduleIds = module && classes.get(module.className);
    if (!native || native.elType !== 'widget' || native.widgetType !== 'image-box' || frozen?.kind !== 'native' || frozen.widgetType !== 'image-box' || !normalize(native.settings.title_text) || normalize(native.settings.description_text) || normalize(frozen.widgetSettings.description_text) || native.settings.title_text !== frozen.widgetSettings.title_text || !equal(native.settings.link, frozen.widgetSettings.link) || classes.get(card.cardClass)?.length !== 1 || classes.get(card.cardClass)?.[0] !== native.id || moduleIds?.length !== 1 || !inside(native.id, moduleIds[0])) fail('native_title_owner_invalid');
    const target = await read(proof.targetSnapshot), targetNodes = new Map<string, any>(); const targetWalk = (nodes: any[]) => nodes.forEach(node => { if (targetNodes.has(node.id)) fail('target_snapshot_ambiguous'); targetNodes.set(node.id, node); targetWalk(node.elements ?? []); }); targetWalk(target.elements ?? []);
    const old = targetNodes.get(native.id);
    if (target.pageId !== input.model.pageId || target.runId !== input.model.runId || target.status !== 'draft' || documentHashV2(target.elements, target.settings) !== target.hash || old?.widgetType !== 'image-box' || !['title_text', 'description_text', 'image', 'link', 'css_classes', '_css_classes'].every(key => equal(old.settings[key], native.settings[key]))) fail('target_snapshot_binding_invalid');
    const widths = new Set<number>();
    for (const baseline of card.baselines) {
      const snapshot = source.snapshots.find((row: any) => row.id === baseline.snapshotId), fact = source.facts[baseline.titleFactId], units = plan.sourceUnits?.filter((unit: any) => unit.snapshotId === baseline.snapshotId && unit.ownerNodeId === baseline.cardNodeId && unit.sourceFactIds.includes(baseline.titleFactId));
      if (!snapshot || !fact || fact.kind !== 'text' || fact.snapshotId !== baseline.snapshotId || fact.nodeId !== baseline.titleNodeId || !sameRef(fact.evidence, baseline.packet) || !snapshot.evidence.some((reference: any) => sameRef(reference, baseline.packet)) || units?.length !== 1 || normalize(fact.value.text) !== normalize(native.settings.title_text)) fail('source_title_fact_invalid');
      const unit = units[0], decisions = plan.selectionDecisions?.filter((decision: any) => decision.unitId === unit.id && decision.componentKeys.includes(card.componentKey));
      if (decisions?.length !== 1 || decisions[0].slotBindings.filter((row: any) => row.componentKey === card.componentKey && row.settingPath === 'widgetSettings.title_text' && unit.slots.some((slot: any) => slot.id === row.slotId && slot.factIds.includes(fact.id))).length !== 1) fail('source_title_slot_invalid');
      const packet = validateObservationPacketV2(await read(baseline.packet)), title = packet.nodes[baseline.titleNodeId], caption = packet.nodes[baseline.captionNodeId], sourceCard = packet.nodes[baseline.cardNodeId];
      if (!title || !caption || !sourceCard || packet.snapshot.id !== baseline.snapshotId || packet.snapshot.url !== program.sourceUrl || !underneath(packet.nodes, title.id, caption.id) || !underneath(packet.nodes, caption.id, sourceCard.id) || title.id === caption.id || caption.id === sourceCard.id || packet.styles[title.styleId].opacity !== '1' || Number(packet.styles[caption.styleId].opacity) !== 0 || packet.styles[caption.styleId].display === 'none' || ['hidden', 'collapse'].includes(packet.styles[caption.styleId].visibility) || packet.layouts[caption.layoutId].rect.width <= 0 || packet.layouts[caption.layoutId].rect.height <= 0) fail('source_caption_ancestor_invalid');
      if (normalize(Object.values(packet.texts).filter(text => underneath(packet.nodes, text.nodeId, caption.id)).map(text => text.text).join(' ')) !== normalize(fact.value.text)) fail('source_caption_contains_other_text');
      let ancestor: typeof title | undefined = title;
      while (ancestor) { if (ancestor.id !== caption.id && !visible(packet.styles[ancestor.styleId])) fail('source_caption_other_hidden_ancestor'); ancestor = ancestor.parentId ? packet.nodes[ancestor.parentId] : undefined; }
      const width = packet.snapshot.viewport.width, height = packet.snapshot.viewport.height; if (![1920, 1440].includes(width) || height !== (width === 1920 ? 1080 : 1000) || widths.has(width)) fail('source_viewports_invalid'); widths.add(width);
      const rows: any[] = [], times: number[] = [];
      for (const [stage, reference] of [['default', baseline.defaultObservation], ['hover', baseline.hoverObservation], ['restored', baseline.restoredObservation]] as const) {
        const observation = Native44SourceImageBoxCaptionObservationSchema.parse(await read(reference)); if (observation.rawEvidence) await read(observation.rawEvidence);
        const found = observation.cards.filter(row => row.componentKey === card.componentKey), row = found[0];
        if (found.length !== 1 || observation.sourceUrl !== program.sourceUrl || observation.stage !== stage || observation.viewport.width !== width || observation.viewport.height !== height || observation.viewport.clientWidth !== packet.snapshot.viewport.clientWidth || observation.viewport.devicePixelRatio !== packet.snapshot.viewport.devicePixelRatio || Date.parse(observation.observedAt) < Date.parse(packet.snapshot.capturedAt) || stage === 'hover' && observation.input.method !== 'cua-drag-pointer' || row.selector !== sourceCard.selector || row.caption.selector !== caption.selector || row.title.selector !== title.selector || normalize(row.title.text) !== normalize(fact.value.text) || Number(row.title.opacity) !== 1 || row.hovered !== (stage === 'hover') || row.active || Number(row.caption.opacity) !== (stage === 'hover' ? 1 : 0) || row.caption.display === 'none' || ['hidden', 'collapse'].includes(row.caption.visibility) || !visible(row.image) || !sameSize(row.caption.rect, packet.layouts[caption.layoutId].rect) || row.href !== (native.settings.link as any)?.url || !Object.values(packet.nodes).some(node => node.tag.toLowerCase() === 'img' && node.selector === row.image.selector && underneath(packet.nodes, node.id, sourceCard.id))) fail('actual_source_state_invalid');
        rows.push(row); times.push(Date.parse(observation.observedAt));
      }
      if (times[0] > times[1] || times[1] > times[2] || rows.some(row => row.title.text !== rows[0].title.text || row.href !== rows[0].href || row.image.src !== rows[0].image.src || row.image.currentSrc !== rows[0].image.currentSrc || !sameSize(row.image.rect, rows[0].image.rect) || !sameSize(row.caption.rect, rows[0].caption.rect) || !sameSize(row.rect, rows[0].rect))) fail('source_restoration_or_identity_invalid');
    }
    if (widths.size !== 2 || new Set(proof.targetDOM.map(row => row.viewport)).size !== 2) fail('two_desktops_required');
    for (const reference of proof.targetDOM) {
      const census = await read(reference.evidence), width = reference.viewport === 'desktop-wide' ? 1920 : 1440;
      if (census.kind !== 'actual-owned-native-dom-wrapper-diagnostic' || census.taskId !== input.model.taskId || census.pageId !== input.model.pageId || census.runId !== input.model.runId || census.documentHash !== target.hash || census.viewport?.width !== width || census.viewport.height !== (width === 1920 ? 1080 : 1000) || census.viewport.devicePixelRatio !== 1 || !equal(census.freshBefore, census.freshAfter) || census.freshBefore?.documentHash !== target.hash || !Array.isArray(census.nodes)) fail('target_dom_identity_invalid');
      const owned = census.nodes.filter((row: any) => row.nativeID === native.id), captions = owned.filter((row: any) => row.class?.split(/\s+/).includes('elementor-image-box-content')), titles = owned.filter((row: any) => row.class?.split(/\s+/).includes('elementor-image-box-title'));
      if (owned.filter((row: any) => row.isNativeRoot).length !== 1 || captions.length !== 1 || titles.length !== 1 || !titles[0].domPath.startsWith(captions[0].domPath + ' > ') || normalize(owned.filter((row: any) => row.recordId === titles[0].recordId || row.domPath.startsWith(titles[0].domPath + ' > ')).map((row: any) => row.directText).join(' ')) !== normalize(native.settings.title_text) || !owned.some((row: any) => row.image && row.rect.width > 0 && row.rect.height > 0)) fail('target_caption_title_invalid');
      if (normalize(owned.filter((row: any) => row.recordId === captions[0].recordId || row.domPath.startsWith(captions[0].domPath + ' > ')).map((row: any) => row.directText).join(' ')) !== normalize(native.settings.title_text)) fail('target_caption_contains_other_text');
    }
    permissions.add(permission(rule.moduleKey, rule.selector, rule.media, binding, rule.value!));
  }
  const token: Qualification = Object.freeze({ kind: 'verified-image-box-caption-reveals', modelHash: hashV2(canonicalV2(input.model)), elementsHash: hashV2(canonicalV2(input.elements)), permissions }); qualifiedTokens.add(token); qualifiedModels.set(input.model, token);
}

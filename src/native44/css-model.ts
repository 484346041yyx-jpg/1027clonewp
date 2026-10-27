import * as css from 'css-tree';
import { canonicalV2, hashV2, isHashV2 } from '../replica-v2/journal.js';
import { prepareNative44PageCSS, canonicalNative44CSS, assertNative44ImageBoxCaptionRuleGroups, type Native44CSSModule, type Native44CSSRule } from './css-handoff.js';
import { verifiedImageBoxCaptionReveals, type VerifiedImageBoxCaptionReveals } from './image-box-caption-proof.js';
import { assertNative44CSSModuleOwners, consolidateNative44CSS } from './consolidate-css.js';
import type { Native44ReplicationProfile } from './profile.js';
import type { ElementorElement } from '../wordpress/types.js';
import { isIP } from 'node:net';
import { isPublicAddress } from '../capture/url-safety.js';

export interface Native44CSSModelRule {
  id: string; moduleKey: string; slot: string; selector?: string; media?: string; property: string;
  responsibility: 'css' | 'native'; reason: string; evidence: string[];
  value?: string;
  /** Deliberate compatibility fallbacks are one current rule, not old patches. */
  fallback?: { id: string; values: string[] };
  native?: { elementId: string; controlId: string; expectedValue: unknown };
  observedDecoration?: boolean;
  optionalPresentation?: Native44CSSRule['optionalPresentation'];
  optionalPresentationEvidence?: Native44CSSRule['optionalPresentationEvidence'];
  nativeStructure?: Native44CSSRule['nativeStructure'];
}
export interface Native44CSSModel {
  version: 1; kind: 'native44-current-css-model'; taskId: string; runId: string; pageId: number;
  revision: number; replicationProfile?: Native44ReplicationProfile; modules: Native44CSSModule[];
  /** Only the narrowly validated page/Canvas isolation exceptions. Never a prior stylesheet. */
  canvasCSS: string;
  /** Explicitly adopted, immutable non-style at-rules (currently font faces).
   * These cannot contain an old stylesheet or subsequent correction rules. */
  sealedAtRules?: Array<{ id: string; css: string; sha256: string; reason: string; evidence: string[] }>;
  rules: Native44CSSModelRule[];
  history: Array<{ rule: Native44CSSModelRule; sha256: string; action: 'replaced' | 'removed'; reason: string; evidence: string[] }>;
}
export type Native44CSSModelChange =
  | { kind: 'add'; rule: Native44CSSModelRule }
  | { kind: 'replace'; id: string; expectedHash: string; rule: Native44CSSModelRule }
  | { kind: 'remove'; id: string; expectedHash: string; reason: string; evidence: string[] };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z\d][a-zA-Z\d_.-]{0,159}$/.test(value) && !value.includes('..');
function fail(code: string): never { throw Error(`native44_css_model_${code}`); }
const evidence = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(item => typeof item === 'string' && !!item.trim() && item.length <= 4096) && new Set(value).size === value.length;
const reason = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 4096;
export const native44CSSModelRuleHash = (rule: Native44CSSModelRule): string => hashV2(canonicalV2(rule));

function normalizedSelector(selector?: string): string {
  if (selector === undefined || selector === '') return '';
  if (typeof selector !== 'string' || selector.length > 1024) fail('selector_invalid');
  // The handoff builder additionally enforces stable, module-contained selectors.
  try { return css.generate(css.parse(selector, { context: 'selector' })); } catch { return fail('selector_invalid'); }
}
function normalizedMedia(media?: string): string {
  if (media === undefined || media === '') return '';
  if (typeof media !== 'string' || media.length > 1024) fail('media_invalid');
  try { const ast = css.parse(`@media ${media}{}`) as css.StyleSheet; const first = ast.children.first; if (ast.children.size !== 1 || first?.type !== 'Atrule' || !first.prelude || !first.block || first.block.children.size) fail('media_invalid'); return css.generate(first.prelude); } catch { return fail('media_invalid'); }
}
function physicalKey(rule: Native44CSSModelRule): string { return canonicalV2([rule.moduleKey, normalizedSelector(rule.selector), normalizedMedia(rule.media), rule.property]); }
export const native44CSSModelEffectKey = physicalKey;
function validateRule(rule: Native44CSSModelRule): void {
  if (!rule || !identifier(rule.id) || !identifier(rule.moduleKey) || !identifier(rule.slot) || !/^(?:--[a-z][a-z\d-]*|[a-z][a-z\d-]*)$/.test(rule.property) || !reason(rule.reason) || !evidence(rule.evidence)) fail('rule_invalid');
  normalizedSelector(rule.selector); normalizedMedia(rule.media);
  if (rule.responsibility === 'native') {
    if (rule.value !== undefined || rule.fallback !== undefined || !rule.native || !identifier(rule.native.elementId) || !identifier(rule.native.controlId) || rule.native.expectedValue === undefined || rule.observedDecoration || rule.optionalPresentation || rule.optionalPresentationEvidence || rule.nativeStructure) fail('native_responsibility_invalid');
    try { const serialized = JSON.stringify(rule.native.expectedValue); if (!serialized || serialized.length > 64 * 1024 || serialized !== JSON.stringify(JSON.parse(serialized))) fail('native_value_invalid'); } catch { fail('native_value_invalid'); }
  } else if (rule.responsibility === 'css') {
    if (rule.native !== undefined || (rule.value === undefined) === (rule.fallback === undefined)) fail('css_responsibility_invalid');
    if (rule.value !== undefined && (typeof rule.value !== 'string' || !rule.value.trim() || rule.value.length > 4096)) fail('value_invalid');
    if (rule.fallback && (!identifier(rule.fallback.id) || !Array.isArray(rule.fallback.values) || rule.fallback.values.length < 2 || rule.fallback.values.length > 20 || new Set(rule.fallback.values).size !== rule.fallback.values.length || rule.fallback.values.some(value => typeof value !== 'string' || !value.trim() || value.length > 4096))) fail('fallback_invalid');
  } else fail('responsibility_invalid');
}

/** Validate a whole current model. Duplicate physical effects are rejected even
 * when callers give them different slots/IDs; replacement must be explicit. */
function prepareModel(value: unknown, options: { validationOnly?: boolean; captionRevealProofs?: VerifiedImageBoxCaptionReveals } = {}) {
  const model = value as Native44CSSModel;
  if (!model || model.version !== 1 || model.kind !== 'native44-current-css-model' || !identifier(model.taskId) || !identifier(model.runId) || !Number.isSafeInteger(model.pageId) || model.pageId < 1 || !Number.isSafeInteger(model.revision) || model.revision < 0 || typeof model.canvasCSS !== 'string' || !Array.isArray(model.modules) || !Array.isArray(model.rules) || model.rules.length > 10000 || !Array.isArray(model.history) || model.history.length > 10000) fail('identity_invalid');
  const ids = new Set<string>(), keys = new Set<string>(), modules = new Set(model.modules.map(module => module.key));
  for (const rule of model.rules) { validateRule(rule); const key = physicalKey(rule); if (!modules.has(rule.moduleKey) || ids.has(rule.id) || keys.has(key)) fail('current_rule_conflict'); ids.add(rule.id); keys.add(key); }
  for (const item of model.history) { validateRule(item.rule); if (!isHashV2(item.sha256) || native44CSSModelRuleHash(item.rule) !== item.sha256 || !['replaced', 'removed'].includes(item.action) || !reason(item.reason) || !evidence(item.evidence)) fail('history_invalid'); }
  if (model.sealedAtRules !== undefined && (!Array.isArray(model.sealedAtRules) || model.sealedAtRules.length > 1000)) fail('sealed_invalid');
  const sealedIds = new Set<string>();
  for (const sealed of model.sealedAtRules ?? []) {
    if (!identifier(sealed.id) || sealedIds.has(sealed.id) || typeof sealed.css !== 'string' || sealed.css.length > 128 * 1024 || !isHashV2(sealed.sha256) || hashV2(sealed.css) !== sealed.sha256 || !reason(sealed.reason) || !evidence(sealed.evidence)) fail('sealed_invalid'); sealedIds.add(sealed.id);
    const ast = css.parse(sealed.css) as css.StyleSheet;
    if (ast.children.size !== 1 || ast.children.first?.type !== 'Atrule' || ast.children.first.name !== 'font-face' || !ast.children.first.block || ast.children.first.block.children.some(node => node.type !== 'Declaration')) fail('sealed_not_font_face');
    css.walk(ast, node => { if (node.type === 'Raw') fail('sealed_active_or_unknown'); if (node.type === 'Url') { let url: URL; try { url = new URL(node.value); } catch { return fail('sealed_url_invalid'); } if (url.protocol !== 'https:' || url.username || url.password) fail('sealed_url_invalid'); } });
  }
  // Reuse existing protection against hiding content, global selectors, mobile
  // branches, declaration injection and fabricated facts. Native-owned values
  // are not emitted, but their selectors/media still have to be safe.
  const emitted: boolean[] = [true];
  const rules = model.rules.flatMap(rule => {
    const mapped: Native44CSSRule[] = rule.responsibility === 'css' ? toHandoffRules(rule) : [{ moduleKey: rule.moduleKey, selector: rule.selector, media: rule.media, declarations: { color: 'inherit' }, reason: rule.reason, evidence: rule.evidence }];
    emitted.push(...mapped.map(() => rule.responsibility === 'css')); return mapped;
  });
  const handoff = { pageId: model.pageId, modules: model.modules, canvasCss: model.canvasCSS, replicationProfile: model.replicationProfile, rules, captionRevealProofs: options.captionRevealProofs };
  assertNative44ImageBoxCaptionRuleGroups(handoff);
  // Shape validation does not authorize or emit zero opacity. Only the async
  // verifier can qualify the exact model/tree used by an actual compilation.
  const prepared = prepareNative44PageCSS(options.validationOnly ? { ...handoff, rules: rules.map(rule => rule.nativeStructure?.kind === 'image-box-caption-reveal' ? { ...rule, nativeStructure: undefined, declarations: { opacity: '1' } } : rule) } : handoff);
  return { prepared, emitted };
}
export function validateNative44CSSModel(value: unknown): asserts value is Native44CSSModel { prepareModel(value, { validationOnly: true }); }
function toHandoffRules(rule: Native44CSSModelRule): Native44CSSRule[] {
  return (rule.fallback?.values ?? [rule.value!]).map(value => ({ moduleKey: rule.moduleKey, selector: rule.selector, media: rule.media, declarations: { [rule.property]: value }, reason: rule.reason, evidence: [...rule.evidence], ...(rule.observedDecoration ? { observedDecoration: true } : {}), ...(rule.optionalPresentation ? { optionalPresentation: rule.optionalPresentation, optionalPresentationEvidence: rule.optionalPresentationEvidence } : {}), ...(rule.nativeStructure ? { nativeStructure: structuredClone(rule.nativeStructure) } : {}) }));
}
export function createNative44CSSModel(input: Omit<Native44CSSModel, 'version' | 'kind' | 'revision' | 'history' | 'canvasCSS' | 'rules'> & { canvasCSS?: string; rules?: Native44CSSModelRule[] }): Native44CSSModel {
  const model: Native44CSSModel = { ...structuredClone(input), version: 1, kind: 'native44-current-css-model', revision: 0, canvasCSS: input.canvasCSS ?? '', rules: structuredClone(input.rules ?? []), history: [] };
  validateNative44CSSModel(model); return model;
}
export function updateNative44CSSModel(input: Native44CSSModel, changes: readonly Native44CSSModelChange[]): Native44CSSModel {
  validateNative44CSSModel(input); if (!changes.length || changes.length > 10000) fail('changes_invalid');
  const model = structuredClone(input), touched = new Set<string>();
  for (const change of changes) {
    const id = change.kind === 'add' ? change.rule.id : change.id;
    if (!identifier(id) || touched.has(id)) fail('change_conflict'); touched.add(id);
    const index = model.rules.findIndex(rule => rule.id === id);
    if (change.kind === 'add') { if (index >= 0) fail('add_exists'); validateRule(change.rule); model.rules.push(structuredClone(change.rule)); continue; }
    if (index < 0 || !isHashV2(change.expectedHash) || native44CSSModelRuleHash(model.rules[index]) !== change.expectedHash) fail('expected_rule_changed');
    const previous = model.rules[index];
    if (change.kind === 'replace') {
      validateRule(change.rule); if (change.rule.id !== id || physicalKey(previous) !== physicalKey(change.rule) || previous.slot !== change.rule.slot) fail('replacement_identity_changed');
      model.history.push({ rule: previous, sha256: change.expectedHash, action: 'replaced', reason: change.rule.reason, evidence: [...change.rule.evidence] }); model.rules[index] = structuredClone(change.rule);
    } else if (change.kind === 'remove') {
      if (!reason(change.reason) || !evidence(change.evidence)) fail('removal_evidence_missing'); model.history.push({ rule: previous, sha256: change.expectedHash, action: 'removed', reason: change.reason, evidence: [...change.evidence] }); model.rules.splice(index, 1);
    } else fail('change_invalid');
  }
  model.revision++; validateNative44CSSModel(model); return model;
}

/** Compile only the model's current rules. History never enters the stylesheet;
 * no prior CSS string/fragment parameter exists on this API. */
export function compileNative44CSSModel(model: Native44CSSModel, options: { elements?: ElementorElement[] } = {}) {
  const captionRevealProofs = verifiedImageBoxCaptionReveals(model, options.elements);
  const { prepared, emitted } = prepareModel(model, { captionRevealProofs });
  if (options.elements && model.rules.some(rule => rule.nativeStructure)) assertNativeStructures(model, options.elements);
  const nativeBindings = model.rules.filter(rule => rule.responsibility === 'native');
  if (options.elements && nativeBindings.length) {
    const elements = new Map<string, ElementorElement>(); const walk = (nodes: ElementorElement[]) => { for (const node of nodes) { if (elements.has(node.id)) fail('native_element_ambiguous'); elements.set(node.id, node); walk(node.elements ?? []); } }; walk(options.elements);
    for (const rule of nativeBindings) { const element = elements.get(rule.native!.elementId); if (!element || canonicalV2(element.settings[rule.native!.controlId]) !== canonicalV2(rule.native!.expectedValue)) fail('native_control_mismatch'); }
  }
  const input = [...(model.sealedAtRules ?? []).map(item => item.css), ...prepared.chunks.filter((_, index) => emitted[index])].filter(Boolean).join('\n');
  // Element observations qualify owners, but must not change serialized output
  // between prepare, save and subsequent read-only validation.
  if (options.elements) assertNative44CSSModuleOwners({ modules: model.modules, elements: options.elements });
  const consolidated = consolidateNative44CSS(input), stylesheet = consolidated.css;
  return { css: stylesheet, sha256: hashV2(stylesheet), canonicalSha256: hashV2(canonicalNative44CSS(stylesheet)), modelHash: hashV2(canonicalV2(model)), revision: model.revision, selectorMap: prepared.selectorMap.filter((_, index) => emitted[index + 1]), nativeBindings: structuredClone(nativeBindings), counts: { currentRules: model.rules.length, supersededRules: model.history.length, emittedRules: model.rules.filter(rule => rule.responsibility === 'css').length, nativeBindings: nativeBindings.length }, work: { validationPasses: 1, consolidationPasses: 1 }, consolidation: { before: consolidated.before, after: consolidated.after } };
}

/** Optional structural selectors are qualified against the actual compiled
 * target, never a widget-name claim or the existence of a source selector. */
function assertNativeStructures(model: Native44CSSModel, roots: ElementorElement[]): void {
  const elements = new Map<string, ElementorElement>(), parents = new Map<string, string>(), classes = new Map<string, string[]>();
  const tokens = (element: ElementorElement) => [...new Set(['css_classes', '_css_classes'].flatMap(key => typeof element.settings[key] === 'string' ? (element.settings[key] as string).split(/\s+/).filter(Boolean) : []))];
  const visit = (nodes: ElementorElement[], parentId?: string) => {
    for (const element of nodes) {
      if (elements.has(element.id)) fail('native_element_ambiguous');
      elements.set(element.id, element); if (parentId) parents.set(element.id, parentId);
      for (const name of tokens(element)) classes.set(name, [...(classes.get(name) ?? []), element.id]);
      visit(element.elements ?? [], element.id);
    }
  };
  visit(roots);
  const beneath = (id: string, owner: string): boolean => { const seen = new Set<string>(); let current: string | undefined = id; while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = parents.get(current); } return false; };
  const descendants = (element: ElementorElement): ElementorElement[] => [element, ...(element.elements ?? []).flatMap(descendants)];
  const publicLink = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { url?: unknown }).url !== 'string') return false;
    let url: URL; try { url = new URL((value as { url: string }).url); } catch { return false; }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || host === 'localhost' || /\.(?:local|internal)$/i.test(host) || isIP(host) && !isPublicAddress(host)) return false;
    const decode = (value: string) => { let result = value; for (let index = 0; index < 4; index++) { try { const next = decodeURIComponent(result); if (next === result) break; result = next; } catch { break; } } return result; };
    return ![...url.searchParams].some(([key, value]) => /buyer[_-]?flags|token|signature|hmac|nonce|password|authorization|secret|session|auth|(?:^|[_-])key(?:$|[_-])/i.test(decode(key)) || /[?&#](?:buyer[_-]?flags|token|signature|hmac|nonce|password|authorization|secret|session|auth|key)=/i.test(decode(value)));
  };
  const publicList = (element: ElementorElement): boolean => element.elType === 'widget' && element.widgetType === 'wd_list' && Array.isArray(element.settings.list_items) && element.settings.list_items.length > 0 && element.settings.list_items.every(row => !!row && typeof row === 'object' && !Array.isArray(row) && typeof (row as Record<string, unknown>).list_content === 'string' && !!((row as Record<string, unknown>).list_content as string).replace(/<[^>]*>/g, '').trim() && publicLink((row as Record<string, unknown>).link));
  const itemIds = [...elements.values()].flatMap(element => [
    ...['css_id', '_element_id', 'element_id', 'element_css_id'].map(key => element.settings[key]).filter(value => typeof value === 'string'),
    ...(Array.isArray(element.settings.items) ? element.settings.items.flatMap(row => row && typeof row === 'object' && !Array.isArray(row) && typeof (row as Record<string, unknown>).element_css_id === 'string' ? [(row as Record<string, unknown>).element_css_id] : []) : []),
  ]);
  for (const rule of model.rules.filter(rule => rule.nativeStructure)) {
    const binding = rule.nativeStructure!, module = model.modules.find(item => item.key === rule.moduleKey), ownerIds = module ? classes.get(module.className) : undefined;
    if (!ownerIds || ownerIds.length !== 1) fail('native_structure_module_mismatch');
    const owner = ownerIds[0];
    if (binding.kind === 'accordion-item') {
      const element = elements.get(binding.elementId), rows = element?.settings.items;
      if (!element || element.elType !== 'widget' || element.widgetType !== binding.widgetType || !beneath(element.id, owner) || !Array.isArray(rows) || rows.filter(row => row && typeof row === 'object' && !Array.isArray(row) && (row as Record<string, unknown>).element_css_id === binding.itemId).length !== 1 || itemIds.filter(id => id === binding.itemId).length !== 1) fail('native_accordion_item_mismatch');
    } else if (binding.kind === 'image-box-caption-reveal') {
      const element = elements.get(binding.elementId);
      if (!element || element.elType !== 'widget' || element.widgetType !== 'image-box' || !beneath(element.id, owner) || classes.get(binding.cardClass)?.length !== 1 || classes.get(binding.cardClass)?.[0] !== element.id || typeof element.settings.title_text !== 'string' || !element.settings.title_text.trim() || element.settings.description_text !== undefined && element.settings.description_text !== '' || !publicLink(element.settings.link)) fail('native_image_box_caption_mismatch');
    } else {
      const parent = elements.get(binding.parentElementId), submenu = elements.get(binding.submenuElementId);
      if (!parent || !submenu || parent.elType !== 'container' || submenu.elType !== 'container' || parent.id === owner || !beneath(parent.id, owner) || parents.get(submenu.id) !== parent.id || classes.get(binding.parentClass)?.length !== 1 || classes.get(binding.parentClass)?.[0] !== parent.id || classes.get(binding.submenuClass)?.length !== 1 || classes.get(binding.submenuClass)?.[0] !== submenu.id) fail('native_navigation_container_mismatch');
      const children = descendants(submenu), widgets = children.filter(element => element.elType !== 'container');
      if (!widgets.length || widgets.some(element => !publicList(element)) || children.some(element => element.elType === 'container' && !(element.elements ?? []).length) || !descendants(parent).filter(element => !beneath(element.id, submenu.id)).some(publicList)) fail('native_navigation_links_mismatch');
    }
  }
}

export interface Native44LegacyCSSAdoption {
  css: string; sha256: string; reason: string; evidence: string[];
  /** Different values cannot be guessed to mean fallback vs replaced patch. */
  duplicateDecisions?: Record<string, { kind: 'fallback'; id: string; reason: string; evidence: string[] } | { kind: 'current-value'; value: string; reason: string; evidence: string[] }>;
}
/** An explicit opt-in, complete import. Unsupported constructs fail without
 * returning a partial model. No legacy file/pointer is changed or migrated. */
export function importLegacyNative44CSSModel(identity: Omit<Parameters<typeof createNative44CSSModel>[0], 'rules' | 'canvasCSS' | 'sealedAtRules'>, input: Native44LegacyCSSAdoption): Native44CSSModel {
  if (!isHashV2(input.sha256) || hashV2(input.css) !== input.sha256 || !reason(input.reason) || !evidence(input.evidence)) fail('legacy_source_invalid');
  const model = createNative44CSSModel(identity), candidates = new Map<string, { rule: Native44CSSModelRule; values: string[]; positions: Array<{ value: string; position: number }>; position: number }>(), canvas: string[] = [];
  const root = `.elementor-${identity.pageId}`; let sequence = 0;
  const append = (node: css.CssNode, media?: string) => {
    if (node.type === 'Comment') return;
    if (node.type === 'Atrule' && node.name === 'media' && node.prelude && node.block && !media) { const condition = css.generate(node.prelude); node.block.children.forEach(child => append(child, condition)); return; }
    if (node.type === 'Atrule' && node.name === 'font-face' && !media) { const value = css.generate(node); (model.sealedAtRules ??= []).push({ id: `legacy-font-${sequence++}`, css: value, sha256: hashV2(value), reason: input.reason, evidence: [...input.evidence] }); return; }
    if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList' || node.block.children.some(child => child.type !== 'Declaration')) fail('legacy_unsupported_construct');
    const selector = css.generate(node.prelude);
    if ([root, `body.page-id-${identity.pageId} .wd-toolbar`, `body.page-id-${identity.pageId}.sticky-toolbar-on`].includes(selector)) { const value = css.generate(node); canvas.push(media ? `@media ${media}{${value}}` : value); return; }
    let moduleKey: string | undefined, suffix: string | undefined;
    for (const module of identity.modules) { const prefix = `${root} .${module.className}`; if (selector === prefix || selector.startsWith(prefix + ' ')) { moduleKey = module.key; suffix = selector.slice(prefix.length).trim(); break; } }
    if (!moduleKey) fail('legacy_selector_unowned');
    node.block.children.forEach(declaration => {
      if (declaration.type !== 'Declaration') fail('legacy_unsupported_construct');
      const position = sequence++, value = css.generate(declaration.value) + (declaration.important ? '!important' : ''), rule: Native44CSSModelRule = { id: `legacy-rule-${position}`, moduleKey: moduleKey!, slot: 'legacy-adopted', selector: suffix, ...(media ? { media } : {}), property: declaration.property, responsibility: 'css', value, reason: input.reason, evidence: [...input.evidence] }, key = physicalKey(rule), previous = candidates.get(key);
      if (previous) { if (!previous.values.includes(value)) previous.values.push(value); previous.positions.push({ value, position }); previous.position = position; } else candidates.set(key, { rule, values: [value], positions: [{ value, position }], position });
    });
  };
  const ast = css.parse(input.css, { parseValue: true, parseCustomProperty: true }) as css.StyleSheet; ast.children.forEach(node => append(node));
  for (const [key, item] of candidates) {
    if (item.values.length > 1) {
      const decision = input.duplicateDecisions?.[key]; if (!decision || !reason(decision.reason) || !evidence(decision.evidence)) fail('legacy_duplicate_decision_required');
      item.rule.reason = decision.reason; item.rule.evidence = [...decision.evidence];
      if (decision.kind === 'fallback') { if (item.positions.some((value, index) => index > 0 && value.position !== item.positions[index - 1].position + 1)) fail('legacy_fallback_order_ambiguous'); delete item.rule.value; item.rule.fallback = { id: decision.id, values: item.values }; }
      else if (decision.kind === 'current-value' && item.values.includes(decision.value)) { item.rule.value = decision.value; item.position = item.positions.filter(value => value.value === decision.value).at(-1)!.position; }
      else fail('legacy_duplicate_decision_invalid');
    }
  }
  model.rules = [...candidates.values()].sort((a, b) => a.position - b.position).map(item => item.rule);
  model.canvasCSS = canvas.join('\n'); validateNative44CSSModel(model); return model;
}

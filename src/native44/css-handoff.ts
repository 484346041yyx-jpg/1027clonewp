import { createHash } from 'node:crypto';
import * as css from 'css-tree';
import { isDesktopBrowserProfile, type Native44ReplicationProfile } from './profile.js';
import { consolidateNative44CSS } from './consolidate-css.js';
import { imageBoxCaptionOpacityAuthorized, type VerifiedImageBoxCaptionReveals } from './image-box-caption-proof.js';

export type Native44CSSNativeStructure =
  | { kind: 'accordion-item'; elementId: string; widgetType: 'nested-accordion'; itemId: string; sourceEvidence: string }
  | { kind: 'navigation-dropdown'; parentElementId: string; submenuElementId: string; parentClass: string; submenuClass: string; state: 'closed' | 'hover' | 'focus-within'; sourceEvidence: string }
  | { kind: 'image-box-caption-reveal'; componentKey: string; elementId: string; cardClass: string; state: 'default' | 'hover' | 'focus-within'; proof: { path: string; sha256: string }; sourceEvidence: string };
export interface Native44CSSRule {
  moduleKey: string;
  /** Selector is relative to the module root. Empty selects the module itself. */
  selector?: string;
  declarations: Record<string, string>;
  media?: string;
  reason: string;
  evidence: string[];
  /** Local observed decoration is the only accepted absolute-position case. */
  observedDecoration?: boolean;
  /** An observed extra rating decoration may be omitted when absent at source.
   * This never authorizes hiding product names, images, prices or controls. */
  optionalPresentation?: 'product-rating';
  /** Exact, distinct references already listed in evidence. Their observations
   * establish source absence and the target's optional native rating wrapper. */
  optionalPresentationEvidence?: { sourceAbsence: string; targetOptionality: string };
  /** Static authored native structure, checked against actual compiled elements
   * by the CSS model. This never qualifies target runtime behavior. */
  nativeStructure?: Native44CSSNativeStructure;
}
export interface Native44CSSModule { key: string; className: string }
export interface Native44CSSHandoffInput {
  replicationProfile?: Native44ReplicationProfile;
  pageId: number;
  modules: Native44CSSModule[];
  rules: Native44CSSRule[];
  canvasCss: string;
  /** In-memory qualification from the complete async source evidence graph. */
  captionRevealProofs?: VerifiedImageBoxCaptionReveals;
}
export const native44CSSHash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function canonicalNative44CSS(input: string): string {
  return css.generate(css.parse(input, { parseValue: true, parseCustomProperty: true }));
}

/** A desktop handoff may narrow between desktop widths, but it cannot sneak
 * back in phone/tablet branches or device-specific media conditions. */
export function assertNative44DesktopCSS(input: string, replicationProfile?: unknown): void {
  if (!isDesktopBrowserProfile(replicationProfile)) return;
  const ast = css.parse(input, { parseValue: true, parseCustomProperty: true });
  css.walk(ast, node => {
    if (node.type !== 'Atrule' || node.name.toLowerCase() !== 'media') return;
    const condition = node.prelude ? css.generate(node.prelude) : '';
    if (/(?:device-width|device-height|orientation|pointer\s*:|hover\s*:)/i.test(condition)) throw Error('Desktop CSS cannot contain mobile/tablet device conditions');
    const normalized = condition.replace(/\s+/g, '').toLowerCase();
    for (const match of normalized.matchAll(/(?:min-|max-)?width[:<>=]+([\d.]+)(px|em|rem)|([\d.]+)(px|em|rem)[<>=]+width/g)) {
      const value = Number(match[1] ?? match[3]) * ((match[2] ?? match[4]) === 'px' ? 1 : 16);
      if (value > 0 && value <= 1024) throw Error('Desktop CSS cannot contain mobile/tablet width corrections');
    }
    if (/(?:min-|max-)?width/.test(normalized) && /calc\(|var\(/.test(normalized)) throw Error('Desktop CSS width conditions require explicit verified desktop dimensions');
  });
}

/** Deliberately narrower than a general CSS editor: page corrections cannot hide
 * missing content, create facts or move a broken layout with absolute offsets. */
export function prepareNative44PageCSS(input: Native44CSSHandoffInput) {
  isDesktopBrowserProfile(input.replicationProfile);
  assertNative44DesktopCSS(input.canvasCss, input.replicationProfile);
  if (!Number.isSafeInteger(input.pageId) || input.pageId < 1) throw Error('CSS handoff requires the actual draft page ID');
  const root = `.elementor-${input.pageId}`, modules = new Map<string, string>();
  for (const item of input.modules) {
    if (!item.key || modules.has(item.key) || !/^cwp-[a-zA-Z0-9_-]+$/.test(item.className) || [...modules.values()].includes(item.className)) throw Error('CSS modules require unique stable cwp- classes');
    modules.set(item.key, item.className);
  }
  // Canvas isolation is a small known exception to the .elementor-ID root: the
  // theme toolbar and body padding are outside Elementor's content root.
  validateCanvasCSS(input.canvasCss, input.pageId);
  const selectorMap: Array<{ moduleKey: string; selector: string; reason: string; evidence: string[] }> = [];
  const chunks = [input.canvasCss.trim()];
  for (const rule of input.rules) {
    const className = modules.get(rule.moduleKey);
    if (!className || !rule.reason?.trim() || !Array.isArray(rule.evidence) || !rule.evidence.length || rule.evidence.some(item => typeof item !== 'string' || !item.trim())) throw Error(`Unbound or unevidenced CSS correction: ${rule.moduleKey}`);
    const suffix = rule.selector?.trim() ?? '';
    const optionalRating = assertOptionalProductRating(rule, suffix);
    const structural = assertNativeStructure(rule, suffix, input);
    if (suffix.startsWith('+') || suffix.startsWith('~')) throw Error('CSS correction cannot escape its module');
    const selector = `${root} .${className}${suffix ? ` ${suffix}` : ''}`;
    const selectorAST = css.parse(selector, { context: 'selector' });
    let depth = 0, idCount = 0;
    css.walk(selectorAST, node => {
      if (node.type === 'Combinator') depth++;
      if (node.type === 'SelectorList' || node.type === 'Raw' || node.type === 'AttributeSelector') throw Error('CSS corrections require short stable class selectors');
      if (node.type === 'IdSelector') {
        if (!structural.itemId) throw Error('CSS corrections require short stable class selectors');
        if (++idCount > 1 || node.name !== structural.itemId) throw Error('CSS IDs require one exact authored native accordion item');
      }
      if (node.type === 'ClassSelector' && /(?:^|[-_])(?:clone|duplicate)(?:$|[-_])|swiper-slide-(?:duplicate|active)/i.test(node.name)) throw Error('CSS cannot target runtime carousel clones or state indexes');
      if (node.type === 'TypeSelector' && /^(?:html|body|selector)$/i.test(node.name)) throw Error('CSS cannot use global selectors');
      if (node.type === 'PseudoClassSelector' && /^(?:nth-|global|root|has)/i.test(node.name)) throw Error('CSS cannot depend on indexed or global selectors');
      if (node.type === 'PseudoElementSelector' && !['before', 'after'].includes(node.name)) throw Error('Unsupported CSS pseudo-element');
      if (structural.itemId && node.type === 'PseudoClassSelector' && node.children) css.walk(node, part => { if (part.type === 'IdSelector') throw Error('Native accordion identity cannot be negated or mixed inside a functional pseudo-class'); });
    });
    if (structural.itemId && idCount !== 1) throw Error('Native accordion item metadata requires its exact static ID selector');
    if (structural.itemId) {
      let itemSeen = false;
      css.walk(selectorAST, node => { if (node.type === 'IdSelector') itemSeen = true; if (itemSeen && node.type === 'Combinator' && ['+', '~'].includes(node.name)) throw Error('Native accordion identity cannot style a different sibling item'); });
    }
    if (depth > 5) throw Error('CSS selector is an unstable long DOM path');
    const declarations: string[] = [];
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (!/^(?:--[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)$/.test(property) || typeof value !== 'string' || !value.trim()) throw Error('Invalid CSS declaration');
      const declaration = css.parse(`${property}:${value}`, { context: 'declaration', parseValue: true, parseCustomProperty: true });
      if (declaration.type !== 'Declaration' || declaration.property !== property || /[{};]/.test(value)) throw Error('CSS values cannot inject declarations');
      css.walk(declaration, node => {
        if (node.type === 'Raw' || node.type === 'Url' || node.type === 'Function' && /^(?:expression|url|image-set|-webkit-image-set)$/i.test(node.name)) throw Error('CSS corrections cannot inject unbound assets or active content');
      });
      if (['content', 'behavior', '-moz-binding', 'counter-reset', 'counter-increment', 'clip', 'clip-path', '-webkit-line-clamp', 'line-clamp', 'text-indent'].includes(property) || property === 'text-overflow' && /ellipsis/i.test(value)) throw Error(`CSS cannot replace or truncate content: ${property}`);
      if (property === 'position' && /\b(?:absolute|fixed)\b/i.test(value) && !rule.observedDecoration && !(structural.closedDropdown && /^absolute(?:\s*!important)?$/i.test(value.trim()))) throw Error('Absolute correction requires observed local decoration evidence');
      if (property === 'position' && /\bfixed\b/i.test(value)) throw Error('CSS correction cannot create viewport overlays');
      const literal = value.replace(/\s*!important\s*$/i, '').trim();
      if (property === 'display' && /\bnone\b|var\(/i.test(value) && !optionalRating && !(structural.closedDropdown && /^none(?:\s*!important)?$/i.test(value.trim())) || property === 'visibility' && /\b(?:hidden|collapse)\b|var\(/i.test(value) || property === 'opacity' && (/^[-+]?0*(?:\.0+)?%?$/.test(literal) || /var\(/i.test(value)) && !structural.captionOpacity) throw Error('CSS correction cannot hide required content');
      if (!rule.observedDecoration && (/^(?:font-size|line-height|width|height|max-width|max-height)$/.test(property) && /^[-+]?0*(?:\.0+)?(?:px|em|rem|%|vw|vh)?$/i.test(literal) || property === 'transform' && /scale(?:X|Y)?\(\s*0(?:[,.\s)]|$)/i.test(value) || property === 'color' && /\btransparent\b/i.test(value))) throw Error('CSS correction cannot collapse required content');
      if (/\b(?:NaN|Infinity)\b/.test(value)) throw Error('CSS rejects non-finite values');
      declarations.push(`${property}:${value}`);
    }
    if (!declarations.length) throw Error('Empty CSS correction');
    let output = `${selector}{${declarations.join(';')}}`;
    if (rule.media) {
      assertNative44DesktopCSS(`@media ${rule.media}{}`, input.replicationProfile);
      const media = css.parse(`@media ${rule.media}{}`);
      if (media.type !== 'StyleSheet' || media.children.size !== 1 || media.children.first?.type !== 'Atrule' || media.children.first.name !== 'media' || !media.children.first.block || media.children.first.block.children.size !== 0 || !media.children.first.prelude) throw Error('Invalid CSS media condition');
      output = `@media ${css.generate(media.children.first.prelude)}{${output}}`;
    }
    chunks.push(output); selectorMap.push({ moduleKey: rule.moduleKey, selector, reason: rule.reason, evidence: [...rule.evidence] });
  }
  return { chunks, selectorMap };
}

const structureId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value);
const structureClass = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_-]{0,159}$/.test(value);
function structureShape(value: Native44CSSNativeStructure): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid native CSS structure metadata');
  if (value.kind === 'accordion-item') {
    if (Object.keys(value).sort().join(',') !== 'elementId,itemId,kind,sourceEvidence,widgetType' || !structureId(value.elementId) || !structureClass(value.itemId) || value.widgetType !== 'nested-accordion') throw Error('Native accordion CSS requires exact static item metadata');
  } else if (value.kind === 'navigation-dropdown') {
    if (Object.keys(value).sort().join(',') !== 'kind,parentClass,parentElementId,sourceEvidence,state,submenuClass,submenuElementId' || !structureId(value.parentElementId) || !structureId(value.submenuElementId) || value.parentElementId === value.submenuElementId || !structureClass(value.parentClass) || !structureClass(value.submenuClass) || value.parentClass === value.submenuClass || !['closed', 'hover', 'focus-within'].includes(value.state)) throw Error('Native navigation CSS requires exact container/state metadata');
  } else if (value.kind === 'image-box-caption-reveal') {
    if (Object.keys(value).sort().join(',') !== 'cardClass,componentKey,elementId,kind,proof,sourceEvidence,state' || !structureId(value.elementId) || !structureClass(value.cardClass) || !/^cwp-/.test(value.cardClass) || !structureClass(value.componentKey) || !['default', 'hover', 'focus-within'].includes(value.state) || !value.proof || Object.keys(value.proof).sort().join(',') !== 'path,sha256' || typeof value.proof.path !== 'string' || !/^[a-f\d]{64}$/.test(value.proof.sha256) || value.sourceEvidence !== value.proof.path) throw Error('Native caption reveal needs exact field owner/state and proof reference');
  } else throw Error('Unsupported native CSS structure metadata');
  if (typeof value.sourceEvidence !== 'string' || !value.sourceEvidence.trim()) throw Error('Native CSS structure requires a named source observation');
}
function dropdownSelector(value: Extract<Native44CSSNativeStructure, { kind: 'navigation-dropdown' }>): string { return `.${value.parentClass}${value.state === 'closed' ? '' : `:${value.state}`} > .${value.submenuClass}`; }
function selectorKey(value = ''): string { return css.generate(css.parse(value, { context: 'selector' })); }
function mediaKey(value?: string): string { if (!value) return ''; const ast = css.parse(`@media ${value}{}`) as css.StyleSheet; const first = ast.children.first; return first?.type === 'Atrule' && first.prelude ? css.generate(first.prelude) : ''; }
export function assertNative44ImageBoxCaptionRuleGroups(input: Native44CSSHandoffInput): void {
  for (const rule of input.rules.filter(rule => rule.nativeStructure?.kind === 'image-box-caption-reveal')) {
    const binding = rule.nativeStructure!; if (binding.kind !== 'image-box-caption-reveal') continue; structureShape(binding);
    const selector = `.${binding.cardClass}${binding.state === 'default' ? '' : `:${binding.state}`} .elementor-image-box-content`;
    if (input.replicationProfile !== 'desktop-browser-v1' || rule.optionalPresentation || rule.optionalPresentationEvidence || rule.observedDecoration || !rule.evidence.includes(binding.proof.path) || selectorKey(rule.selector) !== selectorKey(selector) || Object.keys(rule.declarations).join(',') !== 'opacity' || rule.declarations.opacity !== (binding.state === 'default' ? '0' : '1')) throw Error('Caption reveal permits only its exact caption selector and literal state opacity');
    const group = input.rules.filter(other => { const candidate = other.nativeStructure; return candidate?.kind === 'image-box-caption-reveal' && other.moduleKey === rule.moduleKey && mediaKey(other.media) === mediaKey(rule.media) && candidate.componentKey === binding.componentKey && candidate.elementId === binding.elementId && candidate.cardClass === binding.cardClass && candidate.proof.path === binding.proof.path && candidate.proof.sha256 === binding.proof.sha256; });
    if (group.length !== 3 || ['default', 'hover', 'focus-within'].some(state => group.filter(other => other.nativeStructure?.kind === 'image-box-caption-reveal' && other.nativeStructure.state === state).length !== 1)) throw Error('Caption reveal requires one matching default, hover and keyboard-focus rule');
  }
}
function assertNativeStructure(rule: Native44CSSRule, suffix: string, input: Native44CSSHandoffInput): { itemId?: string; closedDropdown?: boolean; captionOpacity?: boolean } {
  const binding = rule.nativeStructure;
  if (binding === undefined) return {};
  structureShape(binding);
  if (input.replicationProfile !== 'desktop-browser-v1' || !rule.evidence.includes(binding.sourceEvidence) || rule.optionalPresentation || rule.optionalPresentationEvidence || /\\/.test(suffix)) throw Error('Native CSS structure requires explicit desktop scope and its actual source evidence');
  if (binding.kind === 'accordion-item') return { itemId: binding.itemId };
  if (binding.kind === 'image-box-caption-reveal') {
    assertNative44ImageBoxCaptionRuleGroups(input);
    if (!imageBoxCaptionOpacityAuthorized(input.captionRevealProofs, rule)) throw Error('Caption opacity requires an actual verified source proof graph');
    return { captionOpacity: true };
  }
  if (selectorKey(suffix) !== selectorKey(dropdownSelector(binding))) throw Error('Native navigation CSS must use its exact parent and submenu state selector');
  const same = (other: Native44CSSRule) => {
    const candidate = other.nativeStructure;
    if (!candidate || candidate.kind !== 'navigation-dropdown') return false;
    structureShape(candidate);
    return other.moduleKey === rule.moduleKey && candidate.parentElementId === binding.parentElementId && candidate.submenuElementId === binding.submenuElementId && candidate.parentClass === binding.parentClass && candidate.submenuClass === binding.submenuClass && candidate.sourceEvidence === binding.sourceEvidence && other.evidence.includes(candidate.sourceEvidence) && mediaKey(other.media) === mediaKey(rule.media) && selectorKey(other.selector) === selectorKey(dropdownSelector(candidate));
  };
  const group = input.rules.filter(same);
  const closed = group.some(other => other.nativeStructure?.kind === 'navigation-dropdown' && other.nativeStructure.state === 'closed' && /^none(?:\s*!important)?$/i.test(other.declarations.display?.trim() ?? ''));
  const revealed = (state: 'hover' | 'focus-within') => group.some(other => other.nativeStructure?.kind === 'navigation-dropdown' && other.nativeStructure.state === state && /^(?:block|flex|grid)(?:\s*!important)?$/i.test(other.declarations.display?.trim() ?? ''));
  if (!closed || !revealed('hover') || !revealed('focus-within') || group.some(other => other.declarations.display !== undefined && !(other.nativeStructure?.kind === 'navigation-dropdown' && other.nativeStructure.state === 'closed' ? /^none(?:\s*!important)?$/i : /^(?:block|flex|grid)(?:\s*!important)?$/i).test(other.declarations.display.trim()))) throw Error('Native navigation disclosure requires matching closed, hover and focus-within display rules');
  return { closedDropdown: binding.state === 'closed' };
}

export function buildNative44PageCSS(input: Native44CSSHandoffInput): { css: string; sha256: string; canonicalSha256: string; selectorMap: Array<{ moduleKey: string; selector: string; reason: string; evidence: string[] }> } {
  const prepared = prepareNative44PageCSS(input);
  const output = `/* cloneWP page ${input.pageId}; complete current stylesheet for Elementor Page Settings > Advanced > Custom CSS. */\n${consolidateNative44CSS(prepared.chunks.filter(Boolean).join('\n')).css}`;
  const selectorMap = prepared.selectorMap;
  return { css: output, sha256: native44CSSHash(output), canonicalSha256: native44CSSHash(canonicalNative44CSS(output)), selectorMap };
}

/** A named, single-element exception rather than a generic allow-hide switch.
 * The caller must retain the actual source/target observations; the pure CSS
 * builder binds their references and cannot create those observations itself. */
function assertOptionalProductRating(rule: Native44CSSRule, suffix: string): boolean {
  if (rule.optionalPresentation === undefined) {
    if (rule.optionalPresentationEvidence !== undefined) throw Error('Optional presentation evidence requires its explicit product-rating declaration');
    return false;
  }
  if (rule.optionalPresentation !== 'product-rating') throw Error('Unsupported optional CSS presentation');
  const proof = rule.optionalPresentationEvidence;
  if (suffix !== '.star-rating' || rule.observedDecoration || !proof || Object.keys(proof).sort().join(',') !== 'sourceAbsence,targetOptionality' || typeof proof.sourceAbsence !== 'string' || typeof proof.targetOptionality !== 'string' || !proof.sourceAbsence.trim() || !proof.targetOptionality.trim() || proof.sourceAbsence === proof.targetOptionality || !rule.evidence.includes(proof.sourceAbsence) || !rule.evidence.includes(proof.targetOptionality)) throw Error('Optional product-rating omission requires the exact .star-rating selector and distinct bound source-absence/target-optionality evidence');
  const declarations = Object.entries(rule.declarations);
  if (declarations.length !== 1 || declarations[0][0] !== 'display' || typeof declarations[0][1] !== 'string' || !/^none(?:\s*!important)?$/i.test(declarations[0][1].trim())) throw Error('Optional product-rating presentation only permits display:none; other hiding or layout declarations remain forbidden');
  return true;
}

function validateCanvasCSS(input: string, pageId: number): void {
  if (!input.trim()) return;
  const ast = css.parse(input, { parseValue: true, parseCustomProperty: true });
  css.walk(ast, node => {
    if (node.type === 'Atrule' && node.name !== 'media' || node.type === 'Raw' || node.type === 'Url') throw Error('Unsupported Canvas base CSS');
    if (node.type === 'Rule') {
      if (node.prelude?.type !== 'SelectorList') throw Error('Invalid Canvas CSS selector');
      const selectors: string[] = [];
      node.prelude.children.forEach(selector => {
        const value = css.generate(selector);
        if (![`.elementor-${pageId}`, `body.page-id-${pageId} .wd-toolbar`, `body.page-id-${pageId}.sticky-toolbar-on`].includes(value)) throw Error('Canvas base CSS must belong to the actual page');
        selectors.push(value);
      });
      node.block.children.forEach(item => {
        if (item.type !== 'Declaration' || !['display', 'padding-bottom', 'margin', 'padding', 'width', 'max-width', 'box-sizing', 'background', 'background-color'].includes(item.property)) throw Error('Unsupported Canvas base declaration');
        if (item.property === 'display' && css.generate(item.value) !== 'none') throw Error('Unsupported Canvas toolbar display');
        if (item.property === 'display' && selectors.some(selector => selector !== `body.page-id-${pageId} .wd-toolbar`)) throw Error('Canvas CSS cannot hide page content');
        if (selectors.some(selector => selector === `body.page-id-${pageId}.sticky-toolbar-on`) && (item.property !== 'padding-bottom' || css.generate(item.value) !== '0')) throw Error('Canvas body correction is limited to documented toolbar padding');
        css.walk(item, part => { if (part.type === 'Url' || part.type === 'Raw') throw Error('Unbound Canvas CSS asset'); });
      });
    }
  });
}

export function verifyNative44AppliedCSS(expected: string, actual: string, replicationProfile?: Native44ReplicationProfile): { applied: boolean; expectedHash: string; actualHash: string } {
  assertNative44DesktopCSS(expected, replicationProfile);
  const expectedHash = native44CSSHash(canonicalNative44CSS(expected)), actualHash = native44CSSHash(canonicalNative44CSS(actual));
  return { applied: expectedHash === actualHash, expectedHash, actualHash };
}

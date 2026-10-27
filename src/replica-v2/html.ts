import { createHash } from 'node:crypto';
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import * as css from 'css-tree';
import type { BindingV2, GeneratedHtmlProof, HtmlStaticComponentV2, ImportedAssetV2, ReplicaStage } from './types.js';

type HtmlNode = { nodeName: string; tagName?: string; value?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: HtmlNode[]; parentNode?: HtmlNode; namespaceURI?: string };
const issued = new WeakSet<object>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tags = new Set('div section article nav header footer main aside span p strong em b i small h1 h2 h3 h4 h5 h6 ul ol li a picture source img br hr figure figcaption details summary'.split(' '));
const attrName = /^(?:class|id|alt|title|role|width|height|loading|decoding|open|aria-[a-z0-9_-]+|data-[a-z0-9_-]+)$/;
const markerNames = new Set(['data-cwp-text', 'data-cwp-media', 'data-cwp-background', 'data-cwp-link']);
function safeURL(value: string, label: string): string {
  if (/[\u0000-\u0020\u007f<>"\\]/.test(value) || !/^(?:https?:\/\/|mailto:|tel:|#|\/)/i.test(value) || value.startsWith('//')) throw new Error(`Unsafe ${label} URL`);
  if (/^https?:/i.test(value)) { const url = new URL(value); if (url.username || url.password) throw new Error(`Credentials in ${label} URL`); }
  return value;
}
function mediaCondition(value: string): string {
  const ast = css.parse(`@media ${value}{}`);
  if (ast.type !== 'StyleSheet' || ast.children.size !== 1) throw new Error('Invalid responsive media condition');
  const rule = ast.children.first;
  if (!rule || rule.type !== 'Atrule' || rule.name !== 'media' || !rule.prelude || !rule.block || rule.block.children.size) throw new Error('Invalid responsive media condition');
  return css.generate(rule.prelude);
}
/** CSS is parsed and scoped structurally; no regex-only selector rewriting. */
export function scopeStaticCSS(input: string, scopeId: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]+$/.test(scopeId) || /<\/style/i.test(input)) throw new Error('Invalid static CSS scope');
  const ast = css.parse(input, { positions: false, parseValue: true, parseCustomProperty: true });
  css.walk(ast, node => {
    if (node.type === 'Raw') throw new Error('Unparsed static CSS is not accepted');
    if (node.type === 'Url') throw new Error('CSS URLs require a typed background media slot');
    if (node.type === 'Function' && /^(?:expression|url|image-set|-webkit-image-set)$/i.test(css.ident.decode(node.name))) throw new Error('Active or unbound CSS function');
    if (node.type === 'Declaration' && /^(?:behavior|-moz-binding)$/i.test(css.ident.decode(node.property))) throw new Error('Active CSS property');
    if (node.type === 'Declaration' && /\b(?:NaN|Infinity)(?:px|rem|em|vw|vh|deg|ms|s)?\b/i.test(css.generate(node.value))) throw new Error('Static CSS rejects non-finite style values');
    if (node.type === 'Atrule' && !['media', 'supports', 'container', 'layer'].includes(css.ident.decode(node.name).toLowerCase())) throw new Error(`Unsupported static CSS at-rule: ${node.name}`);
    if (node.type === 'TypeSelector' && /^(?:html|body)$/i.test(css.ident.decode(node.name)) || node.type === 'PseudoClassSelector' && css.ident.decode(node.name) === 'root') throw new Error('Global document selectors are forbidden');
  });
  css.walk(ast, { visit: 'Rule', enter(rule) {
    if (!rule.prelude || rule.prelude.type !== 'SelectorList') throw new Error('Static CSS rules require selectors');
    rule.prelude.children.forEach(selector => {
      if (selector.type !== 'Selector') throw new Error('Invalid static CSS selector list');
      const first = selector.children.first;
      const rootAtStart = first?.type === 'PseudoClassSelector' && first.name === 'scope';
      if (rootAtStart) {
        let withinRoot = false;
        selector.children.forEach(part => {
          if (part.type === 'Combinator' && [' ', '>'].includes(part.name)) withinRoot = true;
          if (!withinRoot && part.type === 'Combinator' && ['+', '~', '||'].includes(part.name)) throw new Error('Static CSS cannot select siblings outside its root');
        });
      }
      css.walk(selector, { visit: 'PseudoClassSelector', enter(node, item, list) {
        if (node.name === 'scope') { if (!item || !list) throw new Error('Invalid CSS scope node'); list.replace(item, list.createItem({ type: 'IdSelector', name: scopeId })); }
      } });
      if (!rootAtStart) {
        const scoped = css.parse(`#${scopeId} ${css.generate(selector)}`, { context: 'selector' });
        if (scoped.type !== 'Selector') throw new Error('Invalid scoped selector');
        selector.children = scoped.children;
      }
    });
  } });
  return css.generate(ast);
}

/** V2 native code remains attached to its owning Elementor element. Unlike the
 * legacy visual grammar, AST declarations can retain !important to override
 * actual theme leaf rules. This does not grant a document/global stylesheet. */
export function validateNativeCSSV2(input: string, key: string): string {
  if (typeof input !== 'string' || input.length > 100_000 || !key) throw new Error('Invalid v2 native CSS');
  if (!input.trim()) return '';
  const ast = css.parse(input, { positions: false, parseValue: true, parseCustomProperty: true });
  css.walk(ast, node => { if (node.type === 'PseudoClassSelector' && css.ident.decode(node.name).toLowerCase() === 'global') throw new Error('V2 native CSS cannot declare global selectors'); });
  css.walk(ast, { visit: 'Rule', enter(rule) {
    if (!rule.prelude || rule.prelude.type !== 'SelectorList') throw new Error('V2 native CSS requires owned selectors');
    rule.prelude.children.forEach(selector => {
      if (selector.type !== 'Selector' || selector.children.first?.type !== 'TypeSelector' || css.ident.decode(selector.children.first.name) !== 'selector') throw new Error('V2 native CSS selectors must begin with their owning selector token');
      let owners = 0;
      css.walk(selector, { visit: 'TypeSelector', enter(node, item, list) {
        if (css.ident.decode(node.name) === 'selector') { owners++; if (!item || !list) throw new Error('Invalid owned CSS token'); list.replace(item, list.createItem({ type: 'PseudoClassSelector', name: 'scope', children: null })); }
      } });
      if (owners !== 1) throw new Error('V2 native CSS requires exactly one owning selector token per rule');
    });
  } });
  css.walk(ast, { visit: 'Declaration', enter(declaration) {
    const property = css.ident.decode(declaration.property).toLowerCase(), value = css.generate(declaration.value);
    if (/\b(?:NaN|Infinity)(?:px|rem|em|vw|vh|deg|ms|s)?\b/i.test(value)) throw new Error('V2 native CSS rejects non-finite style values');
    if (property === 'position' && /^(?:fixed|sticky)$/i.test(value)) throw new Error('V2 native CSS cannot create viewport overlays');
    if (property === 'content' && !['none', 'normal', '""', 'counter(clonewp-page-current) " / " counter(clonewp-page-total)', 'counter(clonewp-page-current)" / "counter(clonewp-page-total)'].includes(value)) throw new Error('V2 native generated content must use actual live-pagination counters');
    if (property === 'counter-reset' && value !== 'clonewp-page-current clonewp-page-total') throw new Error('V2 native counters cannot hardcode pagination values');
    if (property === 'counter-increment' && !['clonewp-page-total', 'clonewp-page-total clonewp-page-current'].includes(value)) throw new Error('V2 native counters must track actual live pagination items');
  } });
  const scopeId = `cwp-native-${hash(key).slice(0, 12)}`;
  const scoped = css.parse(scopeStaticCSS(css.generate(ast), scopeId), { positions: false });
  css.walk(scoped, { visit: 'IdSelector', enter(node, item, list) {
    if (node.name === scopeId) { if (!item || !list) throw new Error('Invalid native CSS scope proof'); list.replace(item, list.createItem({ type: 'TypeSelector', name: 'selector' })); }
  } });
  return css.generate(scoped);
}

export function renderStaticHTML(component: HtmlStaticComponentV2, taskId: string, elementId: string, assets: ImportedAssetV2[], stage: ReplicaStage): GeneratedHtmlProof {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(component.key) || !/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(taskId) || !/^[a-f0-9]{7}$/.test(elementId)) throw new Error('Invalid static HTML compiler identity');
  const scopeId = `cwp-${elementId}`;
  if (/<\s*\/?\s*(?:html|head|body|doctype)\b|<!doctype/i.test(component.template)) throw new Error('Whole-document HTML is forbidden');
  const fragment = parseFragment(component.template) as unknown as HtmlNode;
  const assetMap = new Map(assets.map(asset => [asset.key, asset]));
  const bindings: BindingV2[] = [], responsiveBackgrounds: string[] = [], used = { text: new Set<string>(), media: new Set<string>(), links: new Set<string>() };
  const use = (kind: keyof typeof used, slot: string) => { if (!Object.hasOwn(component.slots[kind], slot) || used[kind].has(slot)) throw new Error(`Missing or repeated ${kind} slot: ${component.key}/${slot}`); used[kind].add(slot); };
  const attr = (node: HtmlNode, name: string, value: string) => { node.attrs ??= []; const existing = node.attrs.find(item => item.name === name); if (existing) existing.value = value; else node.attrs.push({ name, value }); };
  const assetFor = (key: string) => { const asset = assetMap.get(key); if (!asset || !Number.isInteger(asset.attachmentId) || asset.attachmentId < 1 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`Unresolved current-job HTML asset: ${component.key}/${key}`); safeURL(asset.url, 'media'); return asset; };
  const visit = (node: HtmlNode, depth: number): void => {
    if (depth > 30) throw new Error('Static HTML nesting exceeds the limit');
    if (node.nodeName === '#text') { if (node.value?.trim()) throw new Error('Static copy must use a typed text slot'); return; }
    if (node.nodeName === '#comment') throw new Error('HTML comments are not part of static templates');
    if (node.tagName) {
      if (!tags.has(node.tagName) || node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw new Error(`Unsupported static tag: ${node.tagName}`);
      for (const { name, value } of node.attrs ?? []) {
        if (!attrName.test(name) || /^(?:on|src|href|style|srcset|form)/i.test(name)) throw new Error(`Unbound or active HTML attribute: ${name}`);
        if (name === 'open' && (node.tagName !== 'details' || !['', 'open'].includes(value.toLowerCase()))) throw new Error('The open boolean attribute belongs only to a details disclosure');
        if (name === 'id' && value !== scopeId && !value.startsWith(`${scopeId}-`)) throw new Error('HTML IDs must belong to their component scope');
        if (name.startsWith('data-cwp-') && !markerNames.has(name)) throw new Error(`Unknown template marker: ${name}`);
      }
      if (node.tagName === 'summary' && node.parentNode?.tagName !== 'details') throw new Error('A disclosure summary must belong directly to details');
      if (node.tagName === 'details') {
        const children = (node.childNodes ?? []).filter(child => child.tagName);
        if (children[0]?.tagName !== 'summary' || children.filter(child => child.tagName === 'summary').length !== 1) throw new Error('A details disclosure requires exactly one first summary child');
      }
      const markers = Object.fromEntries((node.attrs ?? []).filter(item => markerNames.has(item.name)).map(item => [item.name, item.value]));
      if (markers['data-cwp-text']) {
        if (['img', 'source', 'br', 'hr'].includes(node.tagName)) throw new Error('Text slots require a non-void element that can actually render text');
        const slot = markers['data-cwp-text']; use('text', slot);
        if (node.childNodes?.some(child => child.nodeName !== '#text' || child.value?.trim())) throw new Error('Text slots cannot discard child content');
        node.childNodes = [{ nodeName: '#text', value: component.slots.text[slot], parentNode: node }];
        bindings.push({ componentKey: component.key, elementId, kind: 'text', slot, value: component.slots.text[slot] });
      } else (node.childNodes ?? []).forEach(child => visit(child, depth + 1));
      for (const marker of ['data-cwp-media', 'data-cwp-background']) if (markers[marker]) {
        const slot = markers[marker]; use('media', slot); const media = component.slots.media[slot], asset = assetFor(media.assetKey);
        if (marker === 'data-cwp-media') {
          if (node.tagName !== 'img') throw new Error('Image media slots must own an img element');
          attr(node, 'src', asset.url); attr(node, 'alt', media.alt ?? ''); attr(node, 'data-cwp-asset', media.assetKey);
          if (stage !== 'desktop' && media.responsive?.length) {
            const parent = node.parentNode;
            if (!parent?.childNodes) throw new Error('Responsive image requires a parent');
            const picture: HtmlNode = { nodeName: 'picture', tagName: 'picture', namespaceURI: 'http://www.w3.org/1999/xhtml', attrs: [], childNodes: [], parentNode: parent };
            picture.childNodes = media.responsive.map(source => {
              const condition = mediaCondition(source.media);
              const responsive = assetFor(source.assetKey); bindings.push({ componentKey: component.key, elementId, kind: 'media', slot, assetKey: source.assetKey, value: responsive.url });
              return { nodeName: 'source', tagName: 'source', namespaceURI: 'http://www.w3.org/1999/xhtml', attrs: [{ name: 'media', value: condition }, { name: 'srcset', value: responsive.url }], childNodes: [], parentNode: picture };
            });
            picture.childNodes.push(node); parent.childNodes.splice(parent.childNodes.indexOf(node), 1, picture); node.parentNode = picture;
          }
        } else {
          attr(node, 'data-cwp-asset', media.assetKey);
          responsiveBackgrounds.push(`#${scopeId} [data-cwp-background="${slot}"]{background-image:url("${asset.url}")}`);
          if (stage !== 'desktop') for (const source of media.responsive ?? []) {
            const responsive = assetFor(source.assetKey), condition = mediaCondition(source.media);
            responsiveBackgrounds.push(`@media ${condition}{#${scopeId} [data-cwp-background="${slot}"]{background-image:url("${responsive.url}")}}`);
            bindings.push({ componentKey: component.key, elementId, kind: 'media', slot, assetKey: source.assetKey, value: responsive.url });
          }
        }
        bindings.push({ componentKey: component.key, elementId, kind: 'media', slot, assetKey: media.assetKey, value: asset.url });
      }
      if (node.tagName === 'img' && !markers['data-cwp-media']) throw new Error('Every static image requires a current-job media slot');
      if (node.tagName === 'source') throw new Error('Responsive source elements are generated from media slots');
      if (markers['data-cwp-link']) {
        if (node.tagName !== 'a') throw new Error('Link slots must own an anchor');
        const slot = markers['data-cwp-link']; use('links', slot); const link = component.slots.links[slot];
        attr(node, 'href', safeURL(link.url, 'link')); if (link.isExternal) { attr(node, 'target', '_blank'); attr(node, 'rel', 'noopener noreferrer'); } if (link.title) attr(node, 'title', link.title);
        bindings.push({ componentKey: component.key, elementId, kind: 'link', slot, value: link.url });
      }
      if (node.tagName === 'a' && !markers['data-cwp-link']) throw new Error('Every static anchor requires a typed link slot');
    } else (node.childNodes ?? []).forEach(child => visit(child, depth + 1));
  };
  visit(fragment, 0);
  for (const kind of ['text', 'media', 'links'] as const) for (const slot of Object.keys(component.slots[kind])) if (!used[kind].has(slot)) throw new Error(`Unused ${kind} slot: ${component.key}/${slot}`);
  const authoredCSS = component.css + (stage === 'desktop' ? '' : component.responsiveCss ?? '');
  css.walk(css.parse(authoredCSS, { parseValue: true, parseCustomProperty: true }), { visit: 'Declaration', enter(node) {
    if (css.ident.decode(node.property).toLowerCase() === 'content' && !['none', 'normal', '""', "''"].includes(css.generate(node.value))) throw new Error('Static CSS text must use typed text nodes, not generated content');
  } });
  const scopedCSS = scopeStaticCSS(authoredCSS, scopeId);
  const body = serialize(fragment as unknown as DefaultTreeAdapterMap['parentNode']);
  const html = `<style>${scopedCSS}${responsiveBackgrounds.join('')}</style><div id="${scopeId}" data-cwp-component="${component.key}">${body}</div>`;
  const proof: GeneratedHtmlProof = { version: 2, taskId, componentKey: component.key, elementId, scopeId, html, sha256: hash(html), bindings };
  proof.bindings.forEach(binding => Object.freeze(binding)); Object.freeze(proof.bindings); Object.freeze(proof); issued.add(proof); return proof;
}

export function assertGeneratedHtmlProof(proof: GeneratedHtmlProof, elementId: string, html: unknown): void {
  if (!proof || !issued.has(proof) || proof.version !== 2 || proof.elementId !== elementId || typeof html !== 'string' || proof.html !== html || proof.sha256 !== hash(html)) throw new Error('HTML requires an exact current-process v2 compiler proof');
}
export function findGeneratedHtmlProof(proofs: readonly GeneratedHtmlProof[] | undefined, elementId: string, html: unknown): GeneratedHtmlProof {
  const proof = proofs?.find(candidate => candidate.elementId === elementId);
  if (!proof) throw new Error(`Missing exact HTML proof: ${elementId}`);
  assertGeneratedHtmlProof(proof, elementId, html); return proof;
}

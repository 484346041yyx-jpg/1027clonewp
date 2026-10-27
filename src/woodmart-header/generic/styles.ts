import { createHash } from 'node:crypto';
import * as csstree from 'css-tree';

/** A font is opt-in module data. No source-site font or asset is a default. */
export interface HeaderModuleFont {
  key: string;
  url: string;
  weight: number;
  style: 'normal' | 'italic';
}

export interface HeaderModuleStyleInput {
  css: string;
  fonts: HeaderModuleFont[];
}

export interface HeaderModuleStyleIdentity {
  moduleKey: string;
  headerId: string;
}

export interface CompiledHeaderModuleStyles {
  css: string;
  styleHash: string;
  fontFamilies: Record<string, string>;
}

const MAX_CSS_BYTES = 256 * 1024;
const MAX_RULES = 2_000;
const MAX_NODES = 50_000;
const MAX_AT_RULE_DEPTH = 8;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FONT_KEY = /^[a-z][a-z0-9-]{0,31}$/;
const FORBIDDEN_PROPERTIES = new Set(['behavior', '-ms-behavior', '-moz-binding']);

function fail(message: string): never {
  throw new Error(`Header module CSS: ${message}`);
}

function decodedIdentifier(value: string): string {
  const result = csstree.ident.decode(value).toLowerCase();
  if (CONTROL.test(result)) fail('control characters are forbidden');
  return result;
}

function safeURL(value: string): string {
  if (typeof value !== 'string' || value.length > 8_192 || CONTROL.test(value) || /[<>\s]/.test(value)) fail('invalid asset URL');
  let url: URL;
  try { url = new URL(value); } catch { return fail('asset URLs must be absolute HTTPS URLs'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail('asset URLs must use HTTPS without credentials');
  return url.href;
}

function validateIdentity(identity: HeaderModuleStyleIdentity): string {
  if (!identity || !/^[a-z][a-z0-9_-]{0,63}$/.test(identity.moduleKey)) fail('invalid module key');
  if (!/^(?:header_[A-Za-z0-9_-]+|default_header)$/.test(identity.headerId) || identity.headerId.length > 96) fail('invalid native header ID');
  return `whb-${identity.headerId}`;
}

function validateFonts(fonts: HeaderModuleFont[], identity: HeaderModuleStyleIdentity): Record<string, string> {
  if (!Array.isArray(fonts) || fonts.length > 24) fail('fonts must be a bounded array');
  const families: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const font of fonts) {
    if (!font || !FONT_KEY.test(font.key) || Object.hasOwn(families, font.key)) fail('font keys must be unique lowercase identifiers');
    if (!Number.isSafeInteger(font.weight) || font.weight < 1 || font.weight > 1_000 || !['normal', 'italic'].includes(font.style)) fail('invalid font weight or style');
    safeURL(font.url);
    const suffix = createHash('sha256').update(JSON.stringify([identity.moduleKey, identity.headerId, font.key, font.url, font.weight, font.style])).digest('hex').slice(0, 20);
    families[font.key] = `CloneWPHeader-${suffix}`;
  }
  return families;
}

function validateDeclaration(node: csstree.Declaration, knownFonts: ReadonlySet<string>, allowEmptyPseudoContent = false): void {
  const property = decodedIdentifier(node.property);
  if (property === 'content' && (!allowEmptyPseudoContent || csstree.generate(node.value) !== '""')) fail('property content is forbidden');
  if (FORBIDDEN_PROPERTIES.has(property) || (property !== 'content' && /^(?:-\w+-)?content$/.test(property))) fail(`property ${property} is forbidden`);
  if (property.startsWith('--header-font-')) fail('generated font variables cannot be overridden');
  if (node.value.type !== 'Value') fail('unparsed declaration values are forbidden');
  csstree.walk(node.value, child => {
    if (child.type === 'Function' && decodedIdentifier(child.name) === 'var') {
      const first = child.children.first;
      if (first?.type === 'Identifier') {
        const name = decodedIdentifier(first.name);
        if (name.startsWith('--header-font-') && !knownFonts.has(name.slice('--header-font-'.length))) fail('unknown module font variable');
      }
    }
  });
}

function scopeSelector(selector: csstree.CssNode, rootClass: string): void {
  if (selector.type !== 'Selector' || selector.children.isEmpty) fail('invalid selector');
  const first = selector.children.first;
  if (first?.type !== 'PseudoClassSelector' || decodedIdentifier(first.name) !== 'header' || first.children !== null) fail('every selector must begin with :header');
  let enteredDescendant = false;
  const rootStates = new Set<csstree.CssNode>();
  selector.children.forEach((node, item, list) => {
    if (node.type === 'Combinator') {
      if (![' ', '>', '+', '~'].includes(node.name)) fail('unsupported selector combinator');
      if (!enteredDescendant && (node.name === '+' || node.name === '~')) fail('a sibling selector cannot escape the header root');
      if (node.name === ' ' || node.name === '>') enteredDescendant = true;
    }
    if (!enteredDescendant && node.type === 'PseudoClassSelector' && decodedIdentifier(node.name) === 'has') {
      const listNode = node.children?.first;
      const condition = listNode?.type === 'SelectorList' && listNode.children.size === 1 ? listNode.children.first : null;
      if (node.children?.size !== 1 || condition?.type !== 'Selector' || condition.children.isEmpty || condition.children.size > 8 || condition.children.toArray().some(n => n.type !== 'ClassSelector')) fail('root state requires one class-only descendant selector');
      rootStates.add(node);
    }
    if (node === first) list.replace(item, list.createItem({ type: 'ClassSelector', name: rootClass }));
  });
  csstree.walk(selector, node => {
    if (node.type === 'NestingSelector' || node.type === 'Raw') fail('nested or unparsed selectors are forbidden');
    if (node.type === 'TypeSelector' && /^(?:.*\|)?(?:body|html)$/i.test(csstree.ident.decode(node.name))) fail('global document selectors are forbidden');
    if (node.type === 'PseudoClassSelector') {
      const name = decodedIdentifier(node.name);
      if (['header', 'root', 'global', 'has', 'host', 'host-context'].includes(name) && !(name === 'has' && rootStates.has(node))) fail(`pseudo-class :${name} is forbidden inside a header selector`);
    }
    if (node.type === 'PseudoElementSelector' && ['slotted', 'part'].includes(decodedIdentifier(node.name))) fail('cross-root pseudo-elements are forbidden');
  });
}

/**
 * Compile a complete, independently editable native WHB stylesheet.
 * Callers author :header; no page selector or previous implementation is read.
 * Input is parsed before scoping; malformed rules never fall back to raw CSS.
 */
export function compileHeaderModuleStyles(input: HeaderModuleStyleInput, identity: HeaderModuleStyleIdentity): CompiledHeaderModuleStyles {
  const rootClass = validateIdentity(identity);
  if (!input || typeof input.css !== 'string' || Buffer.byteLength(input.css, 'utf8') > MAX_CSS_BYTES) fail('stylesheet exceeds the input limit');
  if (CONTROL.test(input.css) || input.css.includes('<')) fail('HTML delimiters and control characters are forbidden');
  const fontFamilies = validateFonts(input.fonts, identity);
  const knownFonts = new Set(Object.keys(fontFamilies));
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(input.css, {
      context: 'stylesheet', parseCustomProperty: true,
      onParseError(error) { throw error; },
    });
  } catch { return fail('stylesheet must be fully parsed CSS'); }
  if (ast.type !== 'StyleSheet') fail('a complete stylesheet is required');
  let nodeCount = 0;
  csstree.walk(ast, node => {
    if (++nodeCount > MAX_NODES) fail('stylesheet exceeds the node limit');
    if (['Raw', 'CDO', 'CDC', 'NestingSelector'].includes(node.type)) fail('unparsed or nested CSS is forbidden');
    if (node.type === 'Function') {
      const name = decodedIdentifier(node.name);
      if (['expression', 'url', '-moz-binding'].includes(name)) fail('unsafe CSS function');
      if (['image-set', '-webkit-image-set', 'image', 'src'].includes(name)) {
        node.children.forEach(child => {
          if (child.type === 'String') safeURL(child.value);
          // A variable could hide a relative or credential-bearing string URL.
          if (child.type === 'Function' && decodedIdentifier(child.name) === 'var') fail('asset functions must contain explicit HTTPS URLs');
        });
      }
    }
    if (node.type === 'Url') safeURL(node.value);
    if (node.type === 'String') {
      if (CONTROL.test(node.value) || node.value.includes('<')) fail('unsafe CSS string');
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(node.value)) safeURL(node.value);
    }
    if (node.type === 'Identifier') decodedIdentifier(node.name);
  });
  let ruleCount = 0;
  function compileNodes(nodes: csstree.List<csstree.CssNode>, depth: number): void {
    if (depth > MAX_AT_RULE_DEPTH) fail('conditional rules are nested too deeply');
    nodes.forEach(node => {
      if (node.type === 'Comment') return;
      if (++ruleCount > MAX_RULES) fail('stylesheet exceeds the rule limit');
      if (node.type === 'Atrule') {
        const name = decodedIdentifier(node.name);
        if (!['media', 'supports'].includes(name) || node.prelude?.type !== 'AtrulePrelude' || !node.block) fail('only parsed @media and @supports blocks are allowed');
        const allowed = name === 'media'
          ? new Set(['AtrulePrelude', 'MediaQueryList', 'MediaQuery', 'Condition', 'Feature', 'FeatureRange', 'Comparison', 'Dimension', 'Number', 'Ratio', 'Identifier', 'Operator'])
          : new Set(['AtrulePrelude', 'Condition', 'SupportsDeclaration', 'Declaration', 'Value', 'Identifier', 'Dimension', 'Number', 'Percentage', 'Operator', 'Function', 'Hash', 'String']);
        csstree.walk(node.prelude, child => {
          if (!allowed.has(child.type)) fail(`unsupported @${name} condition`);
          if (child.type === 'Declaration') validateDeclaration(child, knownFonts);
          if (child.type === 'Function' && !['calc', 'min', 'max', 'clamp', 'var', 'rgb', 'rgba', 'hsl', 'hsla'].includes(decodedIdentifier(child.name))) fail('unsupported supports function');
        });
        compileNodes(node.block.children, depth + 1);
        return;
      }
      if (node.type !== 'Rule' || node.prelude?.type !== 'SelectorList') fail('only header style rules are allowed');
      const selectors = node.prelude.children.toArray();
      const emptyPseudoContent = selectors.every(selector => {
        if (selector.type !== 'Selector') return false;
        const last = selector.children.last;
        return last?.type === 'PseudoElementSelector' && ['before', 'after'].includes(decodedIdentifier(last.name));
      });
      node.prelude.children.forEach(selector => scopeSelector(selector, rootClass));
      node.block.children.forEach(child => {
        if (child.type !== 'Declaration') fail('nested rules and at-rules are forbidden within style rules');
        validateDeclaration(child, knownFonts, emptyPseudoContent);
      });
    });
  }
  compileNodes(ast.children, 0);
  const faces = input.fonts.map(font => `@font-face{font-family:${csstree.string.encode(fontFamilies[font.key])};src:url(${csstree.string.encode(safeURL(font.url))});font-weight:${font.weight};font-style:${font.style};font-display:swap}`).join('');
  const variables = input.fonts.length ? `.${rootClass}{${input.fonts.map(font => `--header-font-${font.key}:${csstree.string.encode(fontFamilies[font.key])}`).join(';')}}` : '';
  const css = faces + variables + csstree.generate(ast);
  if (css.includes('<') || CONTROL.test(css)) fail('unsafe compiled stylesheet');
  return { css, styleHash: createHash('sha256').update(css).digest('hex'), fontFamilies };
}

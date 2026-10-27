import * as css from 'css-tree';

interface Entry {
  selector: string;
  declarations: css.Declaration[];
}

/** Shorthand/longhand families are ordering barriers. Unknown properties remain
 * barriers too; this is a cascade-preserving cleanup, not a CSS minifier. */
function family(property: string): string {
  if (property.startsWith('--')) return property;
  if (property === 'all') return '*';
  if (/^(?:margin|padding|border|background|font|animation|transition|flex|grid|overflow|list-style|outline|text-decoration)(?:-|$)/.test(property)) return property.split('-')[0];
  if (/^(?:inset(?:-|$)|top$|right$|bottom$|left$)/.test(property)) return 'inset';
  if (/^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio)$/.test(property)) return 'dimensions';
  if (/^(?:gap|row-gap|column-gap|columns|column-width|column-count|column-rule(?:-|$))/.test(property)) return 'columns-and-gaps';
  if (/^(?:align|justify|place)-/.test(property)) return 'alignment';
  if (property === 'line-height') return 'font';
  if (/^(?:white-space|text-wrap|text-wrap-mode|text-wrap-style)$/.test(property)) return 'white-space';
  // Unknown properties and aliases must block motion, rather than being assumed
  // independent (logical dimensions and vendor aliases can affect physical ones).
  if (!['color', 'display', 'position', 'box-sizing', 'opacity', 'z-index', 'order', 'transform', 'transform-origin', 'visibility', 'cursor', 'box-shadow', 'text-shadow', 'text-align', 'vertical-align', 'object-fit', 'object-position'].includes(property)) return '*';
  return property;
}

function specificity(selector: string): string | undefined {
  const ast = css.parse(selector, { context: 'selectorList' });
  if (ast.type !== 'SelectorList' || ast.children.size !== 1) return;
  const score = [0, 0, 0]; let unknown = false;
  css.walk(ast, node => {
    if (node.type === 'IdSelector') score[0]++;
    if (node.type === 'ClassSelector' || node.type === 'AttributeSelector') score[1]++;
    if (node.type === 'TypeSelector' && node.name !== '*') score[2]++;
    if (node.type === 'PseudoClassSelector' || node.type === 'PseudoElementSelector' || node.type === 'Raw') unknown = true;
  });
  return unknown ? undefined : score.join(',');
}

function conflicts(a: css.Declaration, b: css.Declaration): boolean {
  if (Boolean(a.important) !== Boolean(b.important)) return false;
  const af = family(a.property), bf = family(b.property);
  return af === '*' || bf === '*' || af === bf;
}

function clean(entries: Entry[], supported: ReadonlySet<string>): Entry[] {
  const positions = new WeakMap<css.Declaration, number>(); let position = 0;
  for (const entry of entries) for (const declaration of entry.declarations) positions.set(declaration, position++);
  const later = new Map<string, Map<string, css.Declaration>>();
  const replaces = (old: css.Declaration, next: css.Declaration) => old.property === next.property && (!old.important || next.important)
    && (css.generate(old.value) === css.generate(next.value) || supported.has(`${next.property}:${css.generate(next.value)}`));
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i], seen = later.get(entry.selector) ?? new Map<string, css.Declaration>();
    entry.declarations = entry.declarations.filter((declaration, index, all) => {
      // Traverse a rule backwards too, preserving deliberate value fallbacks.
      for (let j = all.length - 1; j > index; j--) {
        const next = all[j];
        if (replaces(declaration, next)) return false;
      }
      const next = seen.get(declaration.property);
      return !(next && replaces(declaration, next));
    });
    for (const declaration of entry.declarations) {
      const next = seen.get(declaration.property);
      if (!next || declaration.important && !next.important) seen.set(declaration.property, declaration);
    }
    later.set(entry.selector, seen);
  }
  const nonempty = entries.filter(entry => entry.declarations.length);
  // Move declarations to the last identical selector only when no intervening
  // rule can compete for the same property family at the same priority.
  for (let i = 0; i < nonempty.length; i++) {
    const entry = nonempty[i];
    let last = -1;
    for (let j = i + 1; j < nonempty.length; j++) if (nonempty[j].selector === entry.selector) last = j;
    if (last < 0) continue;
    const movable: css.Declaration[] = [];
    entry.declarations = entry.declarations.filter(declaration => {
      const ownSpecificity = specificity(entry.selector);
      const barrier = nonempty.slice(i + 1, last).some(other => {
        if (other.selector === entry.selector) return false;
        const otherSpecificity = specificity(other.selector);
        if (ownSpecificity && otherSpecificity && ownSpecificity !== otherSpecificity) return false;
        return other.declarations.some(next => conflicts(declaration, next));
      });
      if (barrier) return true;
      movable.push(declaration); return false;
    });
    nonempty[last].declarations = [...movable, ...nonempty[last].declarations].sort((a, b) => positions.get(a)! - positions.get(b)!);
  }
  return nonempty.filter(entry => entry.declarations.length);
}

export interface ConsolidatedCSS {
  css: string;
  before: { rules: number; declarations: number; important: number; characters: number };
  after: { rules: number; declarations: number; important: number; characters: number };
}

export interface CSSModuleTree {
  settings?: { css_classes?: unknown };
  elements?: CSSModuleTree[];
}

export interface ConsolidateCSSOptions {
  modules?: ReadonlyArray<{ key: string; className: string }>;
  elements?: CSSModuleTree[];
  /** Actual CSS.supports results from the verified target browser. Without
   * this evidence different-value fallbacks are retained, even if grammar-valid. */
  browserSupportedDeclarations?: readonly string[];
}

function verifyIndependentOwners(options?: { modules: ReadonlyArray<{ key: string; className: string }>; elements: CSSModuleTree[] }): Map<string, string> | undefined {
  if (!options) return;
  const owners = new Map(options.modules.map(module => [module.className, module.key])), counts = new Map<string, number>();
  if (owners.size !== options.modules.length) throw Error('Independent CSS owners must be unique');
  const visit = (nodes: CSSModuleTree[], parentOwner?: string) => {
    for (const node of nodes) {
      const classes = typeof node.settings?.css_classes === 'string' ? node.settings.css_classes.split(/\s+/) : [];
      const matches = classes.filter(name => owners.has(name));
      if (matches.length > 1 || matches.length && parentOwner) throw Error('CSS module owners overlap in the actual element tree');
      for (const name of matches) counts.set(name, (counts.get(name) ?? 0) + 1);
      visit(node.elements ?? [], matches[0] ?? parentOwner);
    }
  };
  visit(options.elements);
  for (const name of owners.keys()) if (counts.get(name) !== 1) throw Error('CSS owner is missing or duplicated in the actual element tree');
  return owners;
}

/** Qualify the actual owners without reparsing or regrouping a stylesheet. */
export function assertNative44CSSModuleOwners(options: { modules: ReadonlyArray<{ key: string; className: string }>; elements: CSSModuleTree[] }): void {
  verifyIndependentOwners(options);
}

/** Adjacent identical @media groups can be folded without changing cascade.
 * Other at-rules are retained as order barriers. No selector or asset is added. */
export function consolidateNative44CSS(input: string, options?: ConsolidateCSSOptions): ConsolidatedCSS {
  const ast = css.parse(input, { parseValue: true, parseCustomProperty: true }) as css.StyleSheet;
  if (Boolean(options?.modules) !== Boolean(options?.elements)) throw Error('CSS grouping requires actual module owners and saved elements together');
  const owners = options?.modules && options.elements ? verifyIndependentOwners({ modules: options.modules, elements: options.elements }) : undefined;
  const supported = new Set(options?.browserSupportedDeclarations ?? []);
  const count = (value: string) => {
    const result = { rules: 0, declarations: 0, important: 0, characters: value.length };
    css.walk(css.parse(value), node => {
      if (node.type === 'Rule') result.rules++;
      if (node.type === 'Declaration') { result.declarations++; if (node.important) result.important++; }
    });
    return result;
  };
  const output: string[] = [];
  let condition: string | undefined, entries: Entry[] = [];
  const flush = () => {
    if (!entries.length) return;
    const render = (items: Entry[]) => clean(items, supported).map(entry => `${entry.selector} {\n${entry.declarations.map(declaration => `  ${css.generate(declaration)};`).join('\n')}\n}`).join('\n\n');
    const sections: string[] = [], groups = new Map<string, Entry[]>();
    const flushGroups = () => {
      for (const [owner, items] of groups) sections.push(`/* ${owners?.get(owner)} */\n${render(items)}`);
      groups.clear();
    };
    if (owners) {
      for (const entry of entries) {
        // Only plain descendant selectors contained in one actual independent
        // module can move to that module's section. Everything else is a barrier.
        const match = /^\.elementor-\d+\s+\.(cwp-[a-zA-Z0-9_-]+)(?=\s|>|$)/.exec(entry.selector);
        const owner = match?.[1];
        if (!owner || !owners.has(owner) || /[,~+]/.test(entry.selector)) { flushGroups(); sections.push(render([entry])); continue; }
        const group = groups.get(owner) ?? []; group.push(entry); groups.set(owner, group);
      }
      flushGroups();
    } else sections.push(render(entries));
    const rules = sections.filter(Boolean).join('\n\n');
    if (rules) output.push(condition ? `@media ${condition} {\n${rules.split('\n').map(line => line ? `  ${line}` : line).join('\n')}\n}` : rules);
    entries = [];
  };
  const append = (rule: css.Rule) => {
    if (rule.prelude.type !== 'SelectorList' || rule.block.children.some(node => node.type !== 'Declaration')) throw Error('CSS consolidation requires plain rules; nested CSS must be reviewed separately');
    entries.push({ selector: css.generate(rule.prelude), declarations: rule.block.children.toArray() as css.Declaration[] });
  };
  ast.children.forEach(node => {
    if (node.type === 'Comment') return;
    if (node.type === 'Rule') {
      if (condition !== undefined) { flush(); condition = undefined; }
      append(node); return;
    }
    if (node.type === 'Atrule' && node.name === 'media' && node.prelude && node.block && !node.block.children.some(child => child.type !== 'Rule')) {
      const next = css.generate(node.prelude);
      if (condition !== next) { flush(); condition = next; }
      node.block.children.forEach(child => append(child as css.Rule)); return;
    }
    flush(); condition = undefined; output.push(css.generate(node));
  });
  flush();
  const value = `${output.join('\n\n')}\n`;
  return { css: value, before: count(input), after: count(value) };
}

import * as css from 'css-tree';

export function compactAdjacentNativeStyleCSS(input: string): string {
  const ast = css.parse(input, { parseCustomProperty: true });
  const preludes = new WeakMap<object, string>();
  const prelude = (node: css.Rule | css.Atrule): string | undefined => {
    if (!node.prelude) return undefined;
    if (!preludes.has(node)) preludes.set(node, css.generate(node.prelude));
    return preludes.get(node);
  };
  const declarationsOnly = (node: css.Rule) => node.prelude.type === 'SelectorList' && node.block.children.toArray().every(child => child.type === 'Declaration');
  const append = (children: css.List<css.CssNode>, node: css.CssNode): void => {
    const previous = children.last;
    if (previous?.type === 'Atrule' && node.type === 'Atrule' && previous.name === 'media' && node.name === 'media' && previous.block && node.block && previous.prelude && node.prelude && prelude(previous) === prelude(node)) {
      node.block.children.forEach(child => append(previous.block!.children, child));
      return;
    }
    if (previous?.type === 'Rule' && node.type === 'Rule' && declarationsOnly(previous) && declarationsOnly(node) && prelude(previous) === prelude(node)) {
      node.block.children.forEach(child => previous.block.children.appendData(child));
      return;
    }
    children.appendData(node);
  };
  const compact = (children: css.List<css.CssNode>): css.List<css.CssNode> => {
    const result = new css.List<css.CssNode>();
    children.forEach(node => {
      if (node.type === 'Atrule' && node.name === 'media' && node.block) node.block.children = compact(node.block.children);
      append(result, node);
    });
    return result;
  };
  if (ast.type !== 'StyleSheet') throw Error('native44_css_stylesheet_required');
  ast.children = compact(ast.children);
  return css.generate(ast);
}

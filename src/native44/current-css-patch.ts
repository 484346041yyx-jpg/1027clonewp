import * as css from 'css-tree';
import { z } from 'zod';
import { canonicalV2, documentHashV2 } from '../replica-v2/journal.js';
import { prepareNative44PageCSS, type Native44CSSModule } from './css-handoff.js';
import { assertNative44CSSModuleOwners, consolidateNative44CSS } from './consolidate-css.js';
import { assertNative44RevisionSnapshot } from './revision-snapshot.js';
import type { DraftSnapshot } from '../wordpress/types.js';

const reference = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f\d]{64}$/) }).strict();
export const native44CurrentCSSCorrectionSchema = z.object({
  moduleKey: z.string().min(1).max(100), selector: z.string().max(500).optional(), media: z.string().min(1).max(200).optional(),
  declarations: z.record(z.string(), z.string()).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 24),
  reason: z.string().trim().min(1).max(3000), evidence: z.array(reference).min(1).max(12),
}).strict();
export type Native44CurrentCSSCorrection = z.infer<typeof native44CurrentCSSCorrectionSchema>;
const fail = (code: string): never => { throw Error(`native44_current_css_${code}`); };
/** A narrow legacy correction editor. Existing CSS is digest-bound elsewhere;
 * only the named physical effects are replaced, never re-authorized wholesale. */
export function applyNative44CurrentCSSCorrections(before: DraftSnapshot, modules: Native44CSSModule[], input: unknown[]): string {
  assertNative44RevisionSnapshot(before);
  if (typeof before.settings.custom_css !== 'string' || before.settings.custom_css.length > 4 * 1024 * 1024 || !Array.isArray(input) || !input.length || input.length > 100) fail('input_invalid');
  assertNative44CSSModuleOwners({ modules, elements: before.elements });
  const ast = css.parse(before.settings.custom_css as string, { parseValue: true, parseCustomProperty: true }) as css.StyleSheet;
  const occupied = new Set<string>();
  for (const value of input) {
    const correction = native44CurrentCSSCorrectionSchema.parse(value), declarations = { ...correction.declarations };
    const prepared = prepareNative44PageCSS({ replicationProfile: 'desktop-browser-v1', pageId: before.pageId, modules, canvasCss: '', rules: [{ ...correction, declarations, evidence: correction.evidence.map(ref => ref.path) }] });
    const checked = css.parse(prepared.chunks.filter(Boolean).join('\n'), { parseValue: true, parseCustomProperty: true }) as css.StyleSheet;
    let rule: css.Rule | undefined, media = '';
    checked.children.forEach(node => { if (node.type === 'Rule') rule = node; else if (node.type === 'Atrule' && node.name === 'media' && node.block) { media = css.generate(node.prelude!); node.block.children.forEach(child => { if (child.type === 'Rule') rule = child; }); } });
    if (!rule) throw Error('native44_current_css_correction_rule_invalid');
    const selector = css.generate(rule.prelude!), properties = new Set(Object.keys(correction.declarations));
    for (const property of properties) { const key = `${media}\0${selector}\0${property}`; if (occupied.has(key)) fail('duplicate_correction'); occupied.add(key); }
    const prune = (nodes: css.List<css.CssNode>, condition: string) => { nodes.forEach(node => { if (node.type === 'Atrule' && node.name === 'media' && node.prelude && node.block) prune(node.block.children, css.generate(node.prelude)); else if (node.type === 'Rule' && condition === media && css.generate(node.prelude!) === selector) node.block.children.forEach((declaration, item) => { if (declaration.type === 'Declaration' && properties.has(declaration.property)) node.block.children.remove(item); }); }); };
    prune(ast.children, ''); checked.children.forEach(node => ast.children.appendData(node));
  }
  return `/* cloneWP page ${before.pageId}; complete current CSS-only revision. */\n${consolidateNative44CSS(css.generate(ast)).css}`;
}

export function assertNative44CurrentCSSDelta(before: DraftSnapshot, expected: DraftSnapshot, modules: Native44CSSModule[], corrections: unknown[]): void {
  assertNative44RevisionSnapshot(before); assertNative44RevisionSnapshot(expected);
  if (before.pageId !== expected.pageId || before.runId !== expected.runId || before.title !== expected.title || canonicalV2(before.elements) !== canonicalV2(expected.elements) || canonicalV2({ ...before.settings, custom_css: '' }) !== canonicalV2({ ...expected.settings, custom_css: '' }) || expected.settings.custom_css !== applyNative44CurrentCSSCorrections(before, modules, corrections) || expected.hash !== documentHashV2(expected.elements, expected.settings)) fail('non_css_change_rejected');
}

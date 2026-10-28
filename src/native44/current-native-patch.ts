import { z } from 'zod';
import { canonicalV2, documentHashV2, hashV2 } from '../replica-v2/journal.js';
import { assertNative44Compilation } from './compiler.js';
import { assertNative44RevisionSnapshot, native44SnapshotNodes } from './revision-snapshot.js';
import { applyNative44CurrentCSSCorrections, type Native44CurrentCSSCorrection } from './current-css-patch.js';
import { NATIVE44_PRODUCT_WIDGETS } from './catalog-check.js';
import type { Native44Compiled, Native44Program } from './types.js';
import { walkNative44 } from './types.js';
import type { Native44CSSModule } from './css-handoff.js';
import type { DraftSnapshot, ElementorElement } from '../wordpress/types.js';
import { assertNative44CurrentNativeModelDelta } from './current-native-model.js';
import type { Native44CSSModel } from './css-model.js';

const elementId = z.string().regex(/^[a-zA-Z\d]{4,12}$/);
export const Native44CurrentNativeReplacementSchema = z.object({
  kind: z.literal('replace-subtree'), elementId, beforeSubtreeHash: z.string().regex(/^[a-f\d]{64}$/),
  componentKey: z.string().regex(/^[A-Za-z][A-Za-z\d_-]{0,100}$/),
  reason: z.string().trim().min(1).max(3000),
}).strict();
export type Native44CurrentNativeReplacement = z.infer<typeof Native44CurrentNativeReplacementSchema>;
const fail = (code: string): never => { throw Error(`native44_current_native_${code}`); };
export const native44SubtreeHash = (node: ElementorElement) => hashV2(canonicalV2(node));

/** New content is compiled from the enabled component contracts. Revisions do
 * not become an alternate route for HTML, product queries or shared resources. */
export function assertNative44CurrentNativeProgram(program: Native44Program): void {
  for (const node of walkNative44(program.blocks)) {
    if (node.kind === 'html-static' || node.kind === 'native-products' || node.kind === 'native-posts' || node.kind === 'native-categories' || node.kind === 'native-related-products' || 'widgetType' in node && (node.widgetType === 'html' || (NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(node.widgetType))) fail('fragment_content_rejected');
    if (node.kind === 'native' && node.resources?.length) fail('fragment_resource_rejected');
  }
}
function mediaBindings(elements: ElementorElement[]): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      if (Number.isInteger(item.id) && Number(item.id) > 0 && typeof item.url === 'string' && /^https?:\/\//.test(item.url)) found.push(canonicalV2(item));
      Object.values(item).forEach(visit);
    }
  }; elements.forEach(node => visit(node.settings));
  for (const node of elements) found.push(...mediaBindings(node.elements ?? []));
  return found;
}

/** Pure historical verifier. Only exact compiled roots can replace explicitly
 * hash-bound subtrees; the surrounding tree and all products/media survive. */
export function assembleNative44CurrentNativeSnapshot(before: DraftSnapshot, compiled: Pick<Native44Compiled, 'composition' | 'elementMap'>, input: unknown[], modules: Native44CSSModule[], corrections: Native44CurrentCSSCorrection[]): DraftSnapshot {
  assertNative44RevisionSnapshot(before);
  if (!Array.isArray(input) || !input.length || input.length > 20) fail('replacement_input_invalid');
  const replacements = input.map(value => Native44CurrentNativeReplacementSchema.parse(value));
  const roots = new Map(compiled.composition.elements.map(node => [node.id, node]));
  const existing = native44SnapshotNodes(before.elements), selected = new Set<string>(), usedRoots = new Set<string>();
  for (const replacement of replacements) {
    const old = existing.get(replacement.elementId), nextId = compiled.elementMap[replacement.componentKey], next = roots.get(nextId);
    if (!old || selected.has(replacement.elementId) || !next || usedRoots.has(nextId) || native44SubtreeHash(old.node) !== replacement.beforeSubtreeHash) fail('replacement_owner_conflict');
    selected.add(replacement.elementId); usedRoots.add(nextId);
    if ([...native44SnapshotNodes([old!.node]).values()].some(({ node }) => (NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(node.widgetType ?? ''))) fail('product_owner_replacement_rejected');
  }
  if (usedRoots.size !== roots.size) fail('unowned_compiled_root');
  for (const id of selected) { for (let parent = existing.get(id)?.parent; parent; parent = existing.get(parent)?.parent) if (selected.has(parent)) fail('overlapping_replacements'); }
  // A compiled fragment starts as a document block. Its placement determines
  // only the root Container's editor metadata; content and controls stay sealed.
  const byId = new Map(replacements.map(value => { const node = structuredClone(roots.get(compiled.elementMap[value.componentKey])!); if (node.elType === 'container') node.isInner = existing.get(value.elementId)!.parent !== null; return [value.elementId, node] as const; }));
  const visit = (nodes: ElementorElement[]): ElementorElement[] => nodes.map(node => byId.has(node.id) ? structuredClone(byId.get(node.id)!) : { ...structuredClone(node), elements: visit(node.elements ?? []) });
  const elements = visit(before.elements); native44SnapshotNodes(elements); // catches collisions with retained IDs
  const productNodes = (nodes: ElementorElement[]) => [...native44SnapshotNodes(nodes).values()].filter(({ node }) => (NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(node.widgetType ?? '')).map(({ node, parent }) => ({ node, parent }));
  if (canonicalV2(productNodes(before.elements)) !== canonicalV2(productNodes(elements))) fail('existing_products_changed');
  const oldMedia = mediaBindings(before.elements), newMedia = mediaBindings(elements);
  for (const item of oldMedia) if (!newMedia.includes(item)) fail('existing_media_binding_removed');
  if (newMedia.some(item => !oldMedia.includes(item))) fail('new_media_requires_import_pipeline');
  let result: DraftSnapshot = { ...structuredClone(before), elements, hash: documentHashV2(elements, before.settings) };
  if (corrections.length) { const stylesheet = applyNative44CurrentCSSCorrections(result, modules, corrections); result.settings.custom_css = stylesheet; result.hash = documentHashV2(elements, result.settings); }
  assertNative44RevisionSnapshot(result); return result;
}

/** The remote writer requires process-local compiler identity as well as the
 * deterministic full-document delta. Serialized output alone grants no write. */
export function assertNative44CurrentNativeDelta(before: DraftSnapshot, expected: DraftSnapshot, compiled: Native44Compiled, replacements: Native44CurrentNativeReplacement[], modules: Native44CSSModule[], corrections: Native44CurrentCSSCorrection[], model?: Native44CSSModel): void {
  if (model !== undefined) { if (corrections.length) fail('model_and_raw_corrections_conflict'); assertNative44CurrentNativeModelDelta(before, expected, compiled, replacements, modules, model); return; }
  assertNative44Compilation(compiled, compiled.composition);
  if (compiled.htmlProofs.length || compiled.queryReceipts.length || compiled.postQueryReceipts?.length || compiled.categoryQueryReceipts?.length || compiled.relatedProductBindings?.length) fail('fragment_content_rejected');
  const assembled = assembleNative44CurrentNativeSnapshot(before, compiled, replacements, modules, corrections);
  if (canonicalV2(assembled) !== canonicalV2(expected)) fail('unexpected_document_delta');
}

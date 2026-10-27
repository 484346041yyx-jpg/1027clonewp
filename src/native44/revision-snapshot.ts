import { z } from 'zod';
import { canonicalV2, documentHashV2, isHashV2 } from '../replica-v2/journal.js';
import { assertKnownNativeWidget as assertAllowedWidget } from './catalog.js';
import type { DraftSnapshot, ElementorElement, LegacySchema } from '../wordpress/types.js';
import { validateRegisteredSettings } from '../planning/plan.js';

const elementId = z.string().regex(/^[a-zA-Z\d]{4,12}$/);
const evidence = z.array(z.string().trim().min(1).max(4096)).min(1).max(100);
export const native44RevisionPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set-controls'), elementId, controls: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z\d_]*$/), z.unknown()), reason: z.string().trim().min(1).max(4096), evidence }).strict(),
  z.object({ kind: z.literal('reorder-children'), parentId: elementId.nullable(), childIds: z.array(elementId).min(1).max(2500), reason: z.string().trim().min(1).max(4096), evidence }).strict(),
]);
export type Native44RevisionPatch = z.infer<typeof native44RevisionPatchSchema>;
function fail(code: string): never { throw Error(`native44_revision_${code}`); }
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function safeValue(value: unknown, depth = 0): void {
  if (depth > 16 || value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') fail('control_value_invalid');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('control_value_invalid');
  if (typeof value === 'string' && (value.length > 128 * 1024 || /<\s*\/?[a-z][^>]*>|\bon\w+\s*=|(?:javascript|vbscript)\s*:/i.test(value))) fail('active_content_rejected');
  if (Array.isArray(value)) value.forEach(v => safeValue(v, depth + 1));
  else if (plain(value)) for (const [key, v] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('control_value_invalid'); safeValue(v, depth + 1); }
}
export function native44SnapshotNodes(elements: ElementorElement[]): Map<string, { node: ElementorElement; parent: string | null }> {
  const map = new Map<string, { node: ElementorElement; parent: string | null }>();
  const visit = (nodes: ElementorElement[], parent: string | null, depth: number) => {
    if (!Array.isArray(nodes) || depth > 16) fail('tree_invalid');
    for (const node of nodes) {
      if (!node || !elementId.safeParse(node.id).success || map.has(node.id) || map.size >= 2500 || !plain(node.settings) || !['widget', 'container'].includes(node.elType)) fail('tree_invalid');
      assertAllowedWidget(node.elType === 'container' ? 'container' : node.widgetType!);
      map.set(node.id, { node, parent }); visit(node.elements ?? [], node.id, depth + 1);
    }
  }; visit(elements, null, 0); return map;
}
export function assertNative44RevisionSnapshot(snapshot: DraftSnapshot): void {
  if (!snapshot || snapshot.status !== 'draft' || !Number.isSafeInteger(snapshot.pageId) || snapshot.pageId < 1 || !/^[a-zA-Z\d_-]{4,100}$/.test(snapshot.runId) || !plain(snapshot.settings) || !isHashV2(snapshot.hash) || documentHashV2(snapshot.elements, snapshot.settings) !== snapshot.hash) fail('snapshot_invalid');
  native44SnapshotNodes(snapshot.elements);
}

/** Corrections keep the accepted native tree and business data editable. Adding
 * or replacing a widget still requires the normal native compilation path. */
export function prepareNative44RevisionSnapshot(before: DraftSnapshot, input: unknown[], stylesheet: string): DraftSnapshot {
  assertNative44RevisionSnapshot(before);
  if (!Array.isArray(input) || input.length > 2500 || typeof stylesheet !== 'string' || stylesheet.length > 4 * 1024 * 1024) fail('patch_input_invalid');
  const patches = input.map(patch => native44RevisionPatchSchema.parse(patch)), result = structuredClone(before), map = native44SnapshotNodes(result.elements), touched = new Set<string>();
  for (const patch of patches) {
    if (patch.kind === 'set-controls') {
      const entry = map.get(patch.elementId); if (!entry || entry.node.widgetType === 'html' || !Object.keys(patch.controls).length) fail('patch_owner_invalid');
      for (const [key, value] of Object.entries(patch.controls)) {
        const identity = `${patch.elementId}:${key}`; if (touched.has(identity) || ['_title', 'html', '__proto__', 'constructor', 'prototype'].includes(key) || /(?:nonce|password|authorization|cookie|secret|custom_css)/i.test(key)) fail('patch_control_invalid');
        safeValue(value); touched.add(identity); entry.node.settings[key] = structuredClone(value);
      }
    } else {
      const identity = `order:${patch.parentId ?? 'document'}`; if (touched.has(identity)) fail('patch_control_invalid'); touched.add(identity);
      const children = patch.parentId === null ? result.elements : map.get(patch.parentId)?.node.elements;
      if (!children || children.length !== patch.childIds.length || new Set(patch.childIds).size !== children.length || children.some(node => !patch.childIds.includes(node.id))) fail('reorder_members_changed');
      const current = new Map(children.map(node => [node.id, node])); children.splice(0, children.length, ...patch.childIds.map(id => current.get(id)!));
    }
  }
  result.settings.custom_css = stylesheet; result.hash = documentHashV2(result.elements, result.settings); assertNative44RevisionDelta(before, result); return result;
}

/** Used again at the remote adapter boundary; persisted expected JSON is never
 * sufficient authority to alter metadata, topology, HTML or unknown controls. */
export function assertNative44RevisionDelta(before: DraftSnapshot, expected: DraftSnapshot, schemas?: Record<string, LegacySchema>): void {
  assertNative44RevisionSnapshot(before); assertNative44RevisionSnapshot(expected);
  if (before.pageId !== expected.pageId || before.runId !== expected.runId || before.title !== expected.title || canonicalV2({ ...before.settings, custom_css: '' }) !== canonicalV2({ ...expected.settings, custom_css: '' }) || typeof expected.settings.custom_css !== 'string') fail('page_metadata_changed');
  const old = native44SnapshotNodes(before.elements), next = native44SnapshotNodes(expected.elements);
  if (old.size !== next.size) fail('structural_change_requires_compilation');
  for (const [id, a] of old) {
    const b = next.get(id); if (!b || a.parent !== b.parent || a.node.elType !== b.node.elType || a.node.widgetType !== b.node.widgetType || canonicalV2({ ...a.node, settings: {}, elements: [] }) !== canonicalV2({ ...b.node, settings: {}, elements: [] })) fail('structural_change_requires_compilation');
    if (a.node.widgetType === 'html' && canonicalV2(a.node.settings) !== canonicalV2(b.node.settings)) fail('html_change_requires_compilation');
    if (Object.keys(a.node.settings).some(key => !(key in b.node.settings))) fail('control_removal_not_supported');
    const changed = new Set<string>();
    for (const [key, value] of Object.entries(b.node.settings)) {
      if (key in a.node.settings && canonicalV2(a.node.settings[key]) === canonicalV2(value)) continue;
      if (['_title', 'html', '__proto__', 'constructor', 'prototype'].includes(key) || /(?:nonce|password|authorization|cookie|secret|custom_css)/i.test(key)) fail('patch_control_invalid'); safeValue(value);
      if (/(?:query|^include$|^exclude$|posts_ids|product_ids|items_per_page|^tabs$|^(?:post_type|product_id|menu|menu_id|nav_menu|form_id|form_fields|actions|submit_actions|email_to|email_from|email_from_name|email_reply_to|email_subject|email_content|email_content_type|email_to_cc|email_to_bcc|submissions_metadata|form_metadata|custom_messages|success_message|error_message|recipient|webhook|template_id|sidebar|sidebar_id|taxonomy|category_ids|term_ids)$)/i.test(key)) fail('business_binding_change_requires_compilation');
      changed.add(key);
      if (schemas) {
        const type = b.node.elType === 'container' ? 'container' : b.node.widgetType!, registered = schemas[type]?.controls, control = registered && Object.hasOwn(registered, key) ? registered[key] : undefined;
        if (!control) fail('unregistered_control');
        if (['code', 'html', 'raw_html'].includes(control.type)) fail('code_control_requires_compilation');
        if (['select', 'choose'].includes(control.type) && control.options && (typeof value !== 'string' || value !== '' && !(value in control.options))) fail('invalid_control_option');
      }
    }
    if (schemas && changed.size) { const type = b.node.elType === 'container' ? 'container' : b.node.widgetType!; validateRegisteredSettings(type, b.node.settings, schemas[type], { onlyControls: changed, allowedMedia: [] }); }
  }
}

import type { DraftSnapshot, LegacySchema } from '../wordpress/types.js';
import type { AuthorizedEditorEdit } from '../verification/editability.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';

export class ConcurrentDraftChangeError extends Error {
  constructor() { super('The owned draft changed during continuation; concurrent edits must not be overwritten'); this.name = 'ConcurrentDraftChangeError'; }
}
export function assertDraftHash(actual: string, expected: string): void {
  if (actual !== expected) throw new ConcurrentDraftChangeError();
}
export function mayRecoverDraft(error: unknown, actualHash: string, expectedHashes: string[]): boolean {
  return !isConcurrentDraftError(error) && expectedHashes.includes(actualHash);
}
function isConcurrentDraftError(error: unknown): boolean { return error instanceof ConcurrentDraftChangeError || (!!error && typeof error === 'object' && 'code' in error && error.code === 'concurrent_document_change'); }
const canonicalDocument = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(child => JSON.parse(canonicalDocument(child))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, JSON.parse(canonicalDocument(child))])) : value);
function editorTree(nodes: DraftSnapshot['elements']): unknown {
  return nodes.map(node => { const copy = { ...node, elements: editorTree(node.elements ?? []) }; if (!copy.isInner) delete copy.isInner; return copy; });
}
function colorIdentity(value: unknown): string {
  if (typeof value !== 'string') return '';
  const hex = /^#([a-f0-9]{6})$/i.exec(value.trim());
  if (hex) return [...[0, 2, 4].map(index => parseInt(hex[1].slice(index, index + 2), 16)), 1].join(',');
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i.exec(value.trim());
  return rgb ? [...rgb.slice(1, 4).map(Number), Number(rgb[4] ?? 1)].join(',') : value.toLowerCase();
}
/** Verify exact UI-generated edits before restoring; unrelated changes are never discarded. */
export function assertAuthorizedEditorChanges(before: DraftSnapshot, current: DraftSnapshot, edits: AuthorizedEditorEdit[] = [], schemas?: Record<string, LegacySchema>): void {
  if (before.pageId !== current.pageId || before.runId !== current.runId || before.status !== current.status || before.title !== current.title) throw new ConcurrentDraftChangeError();
  const patched = structuredClone(before.elements);
  const find = (nodes: DraftSnapshot['elements'], id: string): DraftSnapshot['elements'][number] | undefined => { for (const node of nodes) { if (node.id === id) return node; const child = find(node.elements ?? [], id); if (child) return child; } };
  for (const edit of edits) {
    const original = find(patched, edit.targetId), actual = find(current.elements, edit.targetId);
    if (!original || !actual || !['title', 'editor', 'image', 'title_color', 'text_color', 'background_color'].includes(edit.setting)) throw new ConcurrentDraftChangeError();
    const value = actual.settings[edit.setting];
    let matches = canonicalDocument(value ?? null) === canonicalDocument(edit.value ?? null);
    if (edit.setting === 'image') {
      const expected = edit.value as { id?: unknown; url?: unknown }, image = value as { id?: unknown; url?: unknown } | undefined;
      matches = !!image && image.id === expected.id && image.url === expected.url;
    } else if (edit.setting.endsWith('_color')) matches = colorIdentity(value) === colorIdentity(edit.value);
    if (!matches) throw new ConcurrentDraftChangeError();
    original.settings[edit.setting] = value;
  }
  let expected = patched;
  if (schemas) {
    expected = compileEditorElements(patched, schemas);
    // Current flags must already match actual structural nesting. Never mask a human flag change.
    const check = (nodes: DraftSnapshot['elements'], depth: number) => { for (const node of nodes) { if (node.elType === 'container' && Boolean(node.isInner) !== (depth > 0)) throw new ConcurrentDraftChangeError(); check(node.elements ?? [], depth + 1); } };
    check(current.elements, 0);
  }
  if (canonicalDocument(editorTree(expected)) !== canonicalDocument(editorTree(current.elements)) || canonicalDocument(before.settings) !== canonicalDocument(current.settings)) throw new ConcurrentDraftChangeError();
}


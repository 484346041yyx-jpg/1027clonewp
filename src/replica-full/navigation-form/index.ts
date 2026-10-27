import { z } from 'zod';
import { native44Id } from '../../native44/adapters.js';
import { canonicalV2 } from '../../replica-v2/journal.js';
import type { ElementorElement } from '../../wordpress/types.js';
import type { FullReplicaRemoteSnapshot } from '../driver.js';
export { navigationFormPhpHelpers } from './php.js';

function fail(code: string): never { throw Error(`replica_full_navigation_form_${code}`); }
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
const sourceRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/);
const text = z.string().min(1).max(300).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value));
const secret = /(?:password|passwd|secret|token|nonce|authorization|cookie|credential|api_?key|access_?key|session)/i;
const value = z.string().max(300).refine(value => !/[\u0000-\u001f\u007f]/u.test(value) && !/(?:bearer\s|(?:secret|token|password|authorization)\s*[:=])/i.test(value));
export const navigationFormSpecSchema = z.object({
  key, slotComponentKey: key,
  sourceUnitIds: z.array(sourceRef).min(1).max(100), sourceFactIds: z.array(sourceRef).min(1).max(100),
  sourceEvidence: z.object({ path: z.string().min(1).max(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  method: z.literal('get'), action: z.string().min(1).max(2048),
  fields: z.array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(name => !secret.test(name)), label: text, options: z.array(z.object({ label: text, value }).strict()).min(1).max(100) }).strict()).min(1).max(8),
  submitLabel: text,
}).strict();
export type NavigationFormSpec = z.infer<typeof navigationFormSpecSchema>;
export interface NavigationFormPatch { elements: ElementorElement[]; widgetIds: string[]; slotIds: string[] }

/** Deliberately restricted to public HTTPS source navigation, without URL parameters or credentials. */
function publicUrl(input: string): URL {
  let url: URL; try { url = new URL(input); } catch { return fail('url_invalid'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host) || /[\u0000-\u0020\u007f\\]/u.test(input)) fail('public_url_required');
  if (url.href !== input) fail('url_not_canonical');
  return url;
}
export function parseNavigationForms(input: unknown, sourceUrl: string): NavigationFormSpec[] {
  const specs = z.array(navigationFormSpecSchema).min(1).max(4).parse(input), source = publicUrl(sourceUrl);
  const keys = new Set<string>(), slots = new Set<string>();
  for (const spec of specs) {
    if (publicUrl(spec.action).origin !== source.origin) fail('action_origin');
    if (keys.has(spec.key) || slots.has(spec.slotComponentKey)) fail('duplicate_form'); keys.add(spec.key); slots.add(spec.slotComponentKey);
    if (new Set(spec.sourceUnitIds).size !== spec.sourceUnitIds.length || new Set(spec.sourceFactIds).size !== spec.sourceFactIds.length) fail('duplicate_source_ref');
    const names = new Set<string>();
    for (const field of spec.fields) { if (names.has(field.name)) fail('duplicate_field'); names.add(field.name); if (new Set(field.options.map(option => option.value)).size !== field.options.length) fail('duplicate_option'); }
  }
  return specs;
}
const escape = (input: string) => input.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export function navigationFormWidgetId(taskId: string, spec: NavigationFormSpec): string { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(taskId)) fail('task_id'); return native44Id(taskId, `navigation-form:${spec.key}`); }
export function compileNavigationFormHtml(input: NavigationFormSpec, sourceUrl: string, taskId: string): string {
  const [spec] = parseNavigationForms([input], sourceUrl), id = navigationFormWidgetId(taskId, spec), formId = `clonewp-nav-${id}`;
  const fields = spec.fields.map((field, index) => { const fieldId = `${formId}-${index}`; return `<label for="${fieldId}">${escape(field.label)}</label><select id="${fieldId}" name="${escape(field.name)}">${field.options.map(option => `<option value="${escape(option.value)}">${escape(option.label)}</option>`).join('')}</select>`; }).join('');
  return `<form id="${formId}" class="clonewp-navigation-form" method="get" action="${escape(spec.action)}">${fields}<button type="submit">${escape(spec.submitLabel)}</button></form>`;
}
const hasFormContent = (value: unknown): boolean => typeof value === 'string' ? /<\s*form\b/i.test(value) : Array.isArray(value) ? value.some(hasFormContent) : !!value && typeof value === 'object' && Object.values(value).some(hasFormContent);
const hasFormNode = (node: ElementorElement): boolean => node.elType === 'widget' && /form|cf7/i.test(node.widgetType ?? '') || hasFormContent(node.settings) || Array.isArray(node.elements) && node.elements.some(hasFormNode);
/** Appends one compiled HTML widget to each uniquely owned native container, preserving every existing child and setting. */
export function compileNavigationFormPatch(input: ElementorElement[], forms: NavigationFormSpec[], sourceUrl: string, taskId: string): NavigationFormPatch {
  const specs = parseNavigationForms(forms, sourceUrl), elements = structuredClone(input), widgetIds = specs.map(spec => navigationFormWidgetId(taskId, spec)), slotIds = specs.map(spec => native44Id(taskId, spec.slotComponentKey));
  if (new Set([...widgetIds, ...slotIds]).size !== widgetIds.length + slotIds.length) fail('identity_collision');
  const slots = new Map<string, ElementorElement>(), ids = new Set<string>();
  const visit = (nodes: ElementorElement[]): void => { if (!Array.isArray(nodes)) fail('tree_invalid'); for (const node of nodes) { if (!node || typeof node !== 'object' || !/^[A-Za-z0-9_-]{1,100}$/.test(node.id) || ids.has(node.id) || !node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings) || !Array.isArray(node.elements)) fail('tree_invalid'); ids.add(node.id); if (slotIds.includes(node.id)) { if (node.elType !== 'container' || node.widgetType) fail('slot_not_container'); if (hasFormNode(node)) fail('slot_form_exists'); slots.set(node.id, node); } visit(node.elements); } };
  visit(elements); if (slots.size !== slotIds.length || widgetIds.some(id => ids.has(id))) fail('slot_missing_or_widget_exists');
  specs.forEach((spec, index) => slots.get(slotIds[index])!.elements.push({ id: widgetIds[index], elType: 'widget', widgetType: 'html', settings: { html: compileNavigationFormHtml(spec, sourceUrl, taskId) }, elements: [] }));
  return { elements, widgetIds, slotIds };
}
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
export function assertNavigationFormBoundary(before: FullReplicaRemoteSnapshot, after: FullReplicaRemoteSnapshot, patch: NavigationFormPatch, forms: NavigationFormSpec[], sourceUrl: string, taskId: string): void {
  const a = before.page, b = after.page; if (!a || !b || a.status !== 'draft' || b.status !== 'draft') fail('draft_required');
  const { elements: _a, bodyHash: _b, ...pageA } = a, { elements: _c, bodyHash: _d, ...pageB } = b;
  if (!same(pageA, pageB) || !same(b.elements, patch.elements) || !same(compileNavigationFormPatch(a.elements, forms, sourceUrl, taskId), patch)) fail('page_boundary_changed');
  if (!same(before.header.contract, after.header.contract) || !same(before.header.resources, after.header.resources)) fail('header_boundary_changed');
  const prior = structuredClone(before.header.snapshot), next = structuredClone(after.header.snapshot), priorPage = prior.module?.pages[String(a.pageId)], nextPage = next.module?.pages[String(a.pageId)];
  if (!priorPage || !nextPage) fail('native_page_missing'); priorPage.bodyHash = nextPage.bodyHash; priorPage.snapshotHash = nextPage.snapshotHash;
  if (!same(prior, next)) fail('header_boundary_changed');
}

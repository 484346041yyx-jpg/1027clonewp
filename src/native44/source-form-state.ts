import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import sharp from 'sharp';
import { parseFragment } from 'parse5';
import { NATIVE_VIEWPORT_CAPTURE, nativeViewportRasterMapping } from '../core/native-viewport-raster.js';

const reference = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict();
const styles = z.object({ display: z.string(), visibility: z.string(), opacity: z.string() }).strict();
const control = z.object({
  selector: z.string().min(1), tag: z.enum(['input', 'select', 'textarea', 'button']), type: z.string().nullable(), name: z.string().nullable(), placeholder: z.string().nullable(),
  required: z.boolean(), label: z.string(), text: z.string(), attributes: z.record(z.string(), z.string()),
  options: z.array(z.object({ text: z.string(), value: z.string() }).strict()).max(1000).optional(),
  rect, styles, visible: z.boolean(), presentationSelector: z.string().min(1).nullable().optional(),
}).strict();
export const sourceFormLiveStateSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-source-form-live-state'), sourceUrl: z.url(), snapshotId: z.string().min(1), observedAt: z.string().datetime(),
  browser: z.object({ name: z.literal('chrome'), browserId: z.string().min(1), tabId: z.string().min(1) }).strict(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), clientWidth: z.number().int().positive(), devicePixelRatio: z.number().finite().positive() }).strict(),
  formSelector: z.string().min(1), formHTML: z.string().min(1).max(2 * 1024 * 1024), formRect: rect, formStyles: styles, formVisible: z.boolean(),
  controls: z.array(control).min(1).max(1000), screenshot: reference.extend({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  captureMode: z.literal(NATIVE_VIEWPORT_CAPTURE).optional(),
}).strict();
type Reference = z.infer<typeof reference>;
type Control = z.infer<typeof control>;
const fail = (reason: string): never => { throw Error(`native44_pending_form_live_state_${reason}`); };
const canonical = (value: unknown): string => JSON.stringify(value);
const semanticAttributes = ['id', 'type', 'name', 'placeholder', 'required', 'multiple', 'disabled', 'readonly', 'min', 'max', 'minlength', 'maxlength', 'pattern', 'autocomplete'];
const text = (node: any): string => node.nodeName === '#text' ? node.value : ['script', 'style'].includes(node.tagName) ? '' : (node.childNodes ?? []).map(text).join('');
const attrs = (node: any): Record<string, string> => Object.fromEntries((node.attrs ?? []).map((attribute: any) => [attribute.name, attribute.value]));
const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim();
function htmlForm(value: string) {
  const root = parseFragment(value) as any, forms: any[] = [], controls: any[] = [], links: any[] = [], labels: any[] = [], nodes: any[] = [];
  const visit = (node: any) => { nodes.push(node); if (node.tagName === 'form') forms.push(node); if (node.tagName === 'label') labels.push(node); if (['input', 'button', 'select', 'textarea'].includes(node.tagName)) controls.push(node); if (node.tagName === 'a') links.push([attrs(node).href ?? null, normalized(text(node))]); for (const child of node.childNodes ?? []) visit(child); }; visit(root);
  if (forms.length !== 1) return fail('form_html');
  const formNodes = new Set<any>(); const contained = (node: any) => { formNodes.add(node); for (const child of node.childNodes ?? []) contained(child); }; contained(forms[0]);
  if (controls.some(node => !formNodes.has(node))) fail('form_html_ownership');
  const options = (node: any) => { const rows: Array<{ text: string; value: string }> = []; const collect = (item: any) => { if (item.tagName === 'option') rows.push({ text: text(item).trim(), value: attrs(item).value ?? text(item).trim() }); for (const child of item.childNodes ?? []) collect(child); }; collect(node); return rows; };
  const semantic = controls.map(node => ({ tag: node.tagName, attributes: Object.fromEntries(semanticAttributes.map(key => [key, attrs(node)[key] ?? null])), ...(node.tagName === 'select' ? { options: options(node) } : {}), ...(node.tagName === 'button' || attrs(node).type === 'submit' ? { text: normalized(text(node)), value: attrs(node).value ?? null } : {}) }));
  const label = (node: any) => {
    const matching = labels.filter(candidate => attrs(node).id && attrs(candidate).for === attrs(node).id); if (matching.length) return matching.map(text).join(' ').trim();
    const labelled = String(attrs(node)['aria-labelledby'] ?? '').split(/\s+/).filter(Boolean).map(id => nodes.find(candidate => attrs(candidate).id === id)); if (labelled.length && labelled.every(Boolean)) return labelled.map(text).join(' ').trim();
    let parent = node.parentNode;
    while (parent && parent !== forms[0]) {
      if (parent.tagName === 'label') return text(parent).trim();
      const candidates: any[] = []; const collect = (candidate: any) => { if (candidate === node || ['input', 'button', 'select', 'textarea'].includes(candidate.tagName)) return; if (candidate.tagName === 'label' || /(?:^|[\s_-])label(?:[\s_-]|$)/i.test(attrs(candidate).class ?? '')) { candidates.push(candidate); return; } for (const child of candidate.childNodes ?? []) collect(child); }; collect(parent);
      if (candidates.length) return candidates.length === 1 ? text(candidates[0]).trim() : '';
      parent = parent.parentNode;
    }
    return '';
  };
  return { form: forms[0], controls, options, label, semantic: { action: attrs(forms[0]).action ?? '', method: attrs(forms[0]).method ?? '', controls: semantic, links, text: normalized(text(forms[0])) } };
}
async function bound(root: string, item: Reference, base = root) {
  reference.parse({ path: item.path, sha256: item.sha256 }); const actualRoot = await realpath(root), filename = await realpath(path.resolve(base, item.path)), relative = path.relative(actualRoot, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('path_escape');
  const bytes = await readFile(filename); if (bytes.length > 16 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== item.sha256) fail('hash'); return { filename, bytes };
}
function painted(value: { visible: boolean; rect: z.infer<typeof rect>; styles: z.infer<typeof styles> }): boolean {
  return value.visible && value.rect.width > 0 && value.rect.height > 0 && value.styles.display !== 'none' && !['hidden', 'collapse'].includes(value.styles.visibility) && Number.isFinite(Number(value.styles.opacity)) && Number(value.styles.opacity) > 0;
}
export async function verifySourceFormLiveState(root: string, item: Reference, expected: { sourceUrl: string; snapshotId: string; viewport: { width: number; height: number }; packet: any; formNodeId: string; factNodeIds: string[]; presentations: Array<{ fieldNodeId: string; presentationNodeId: string }>; details: any }) {
  const file = await bound(root, item), state = sourceFormLiveStateSchema.parse(JSON.parse(file.bytes.toString('utf8'))), packet = expected.packet, form = packet.nodes[expected.formNodeId];
  if (state.sourceUrl !== expected.sourceUrl || state.snapshotId !== expected.snapshotId || state.viewport.width !== expected.viewport.width || state.viewport.height !== expected.viewport.height || state.viewport.clientWidth > state.viewport.width || state.viewport.width - state.viewport.clientWidth > 24 || !form || state.formSelector !== form.selector || Date.parse(state.observedAt) > Date.now() + 60000) fail('identity');
  if (!expected.details || typeof expected.details.formHTML !== 'string') fail('details_required');
  const baselineHTML = htmlForm(expected.details.formHTML), liveHTML = htmlForm(state.formHTML);
  if (canonical(baselineHTML.semantic) !== canonical(liveHTML.semantic)) fail('content_changed');
  if (!painted({ visible: state.formVisible, rect: state.formRect, styles: state.formStyles })) fail('form_footprint');
  if (new Set(state.controls.map(row => row.selector)).size !== state.controls.length || liveHTML.controls.length !== state.controls.length) fail('control_inventory');
  for (const [index, row] of state.controls.entries()) {
    const html = liveHTML.controls[index], htmlAttrs = attrs(html);
    if (row.tag !== html.tagName || canonical(Object.entries(row.attributes).sort()) !== canonical(Object.entries(htmlAttrs).sort()) || row.type !== (htmlAttrs.type ?? null) || row.name !== (htmlAttrs.name ?? null) || row.placeholder !== (htmlAttrs.placeholder ?? null) || row.required !== Object.hasOwn(htmlAttrs, 'required') || row.label !== liveHTML.label(html) || normalized(row.text) !== normalized(text(html)) || row.tag === 'select' && canonical(row.options) !== canonical(liveHTML.options(html)) || row.tag !== 'select' && (row.options !== undefined || row.presentationSelector != null)) fail('control_html');
  }
  const bySelector = new Map(state.controls.map(row => [row.selector, row])), footprints = new Map<string, Control>(), expectedVisible = new Set<string>(), order: number[] = [];
  const sourceOrder: string[] = [], seen = new Set<string>();
  const visitSource = (nodeId: string) => { if (seen.has(nodeId)) return fail('source_tree'); seen.add(nodeId); const raw = packet.nodes[nodeId]; if (!raw) return fail('source_tree'); if (expected.factNodeIds.includes(nodeId)) sourceOrder.push(nodeId); for (const childId of raw.childIds ?? Object.values(packet.nodes).filter((child: any) => child.parentId === nodeId).map((child: any) => child.id)) visitSource(childId); }; visitSource(expected.formNodeId);
  if (canonical(sourceOrder) !== canonical(expected.factNodeIds)) fail('source_control_order');
  for (const nodeId of expected.factNodeIds) {
    const raw = packet.nodes[nodeId], row = raw && bySelector.get(raw.selector);
    if (!raw || !row || row.tag !== raw.tag || semanticAttributes.some(key => (raw.attributes?.[key] ?? null) !== (row.attributes[key] ?? null))) fail('control_binding');
    if (raw.attributes?.type === 'submit' && (raw.attributes?.value ?? null) !== (row.attributes.value ?? null)) fail('submit_changed');
    order.push(state.controls.indexOf(row));
    const presentation = expected.presentations.find(binding => binding.fieldNodeId === nodeId), proxy = presentation && packet.nodes[presentation.presentationNodeId];
    const footprint = proxy && bySelector.get(proxy.selector) || row;
    if (presentation && (!proxy || raw.tag !== 'select' || row.presentationSelector !== proxy.selector || proxy.tag !== 'button' || proxy.attributes?.role !== 'combobox' || proxy.parentId !== raw.parentId || footprint.tag !== 'button' || footprint.attributes.role !== 'combobox' || semanticAttributes.some(key => (proxy.attributes?.[key] ?? null) !== (footprint.attributes[key] ?? null)))) fail('select_proxy');
    if (!presentation && row.presentationSelector != null || !painted(footprint)) fail('control_footprint');
    const outer = state.formRect, inner = footprint.rect;
    if (inner.x < outer.x - 2 || inner.y < outer.y - 2 || inner.x + inner.width > outer.x + outer.width + 2 || inner.y + inner.height > outer.y + outer.height + 2 || inner.x < 0 || inner.y < 0 || inner.x + inner.width > state.viewport.clientWidth || inner.y + inner.height > state.viewport.height) fail('control_outside_raster');
    if (row.visible) expectedVisible.add(row.selector); expectedVisible.add(footprint.selector);
    footprints.set(nodeId, footprint);
  }
  if (order.some((value, index) => index > 0 && value <= order[index - 1])) fail('control_order');
  if (state.controls.some(row => row.visible && !expectedVisible.has(row.selector))) fail('extra_visible_controls');
  const raster = await bound(root, state.screenshot, path.dirname(file.filename)), metadata = await sharp(raster.bytes).metadata();
  const mapping = nativeViewportRasterMapping(metadata, state.viewport, state.captureMode);
  if (metadata.width !== state.screenshot.width || metadata.height !== state.screenshot.height || !mapping) return fail('screenshot');
  const left = Math.max(0, Math.floor(state.formRect.x * mapping.x)), top = Math.max(0, Math.floor(state.formRect.y * mapping.y)), width = Math.min(metadata.width! - left, Math.floor(state.formRect.width * mapping.x)), height = Math.min(metadata.height! - top, Math.floor(state.formRect.height * mapping.y));
  if (width < 2 || height < 2) fail('screenshot_footprint');
  const statistics = await sharp(raster.bytes).extract({ left, top, width, height }).removeAlpha().stats(); if (statistics.channels.every(channel => channel.stdev < 2)) fail('screenshot_unpainted');
  return { state, footprints, screenshot: { path: raster.filename, sha256: state.screenshot.sha256 } };
}

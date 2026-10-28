import { z } from 'zod';
import { headerJsonHash } from '../contract.js';
import type { HeaderModulePlan } from './contract.js';
import type { NativeHeaderContract, ResolvedHeaderResources } from './compiler.js';
import type { WhbRawHeader, WhbLayoutNode } from '../layout.js';

export const menuBindingPolicySchema = z.object({ version: z.literal(1), editorReview: z.literal('desktop-and-mobile-reopen') }).strict();
export type MenuBindingPolicy = z.infer<typeof menuBindingPolicySchema>;
export const defaultMenuBindingPolicy = (): MenuBindingPolicy => ({ version: 1, editorReview: 'desktop-and-mobile-reopen' });
function fail(code: string): never { throw Error('woodmart_header_menu_' + code); }

export function plannedHeaderMenus(plan: HeaderModulePlan) {
  return ([['desktop', plan.layout.rows], ['mobile', plan.layout.mobile?.rows ?? []]] as const).flatMap(([device, rows]) => rows.flatMap(row => Object.values(row.columns).flat().filter(e => e.type === 'mainmenu' || e.type === 'menu').map(e => ({ device, key: e.key, type: e.type, menuKey: e.menuKey! }))));
}

export function assertHeaderMenuParameterShape(raw: WhbRawHeader) {
  const visit = (node: WhbLayoutNode) => {
    const param = node.params?.menu_id;
    if (['mainmenu', 'menu'].includes(node.type.toLowerCase()) && !param) fail('binding_missing');
    if (param && (param.id !== 'menu_id' || param.type !== 'select' || typeof param.value !== 'string' || !param.value)) fail('native_select_required');
    node.content?.forEach(visit);
  };
  visit(raw.structure);
}

/** A frontend accepting a term ID is not proof that the native editor can select it. */
export function assertNativeHeaderMenuBindings(plan: HeaderModulePlan, raw: WhbRawHeader, contract: NativeHeaderContract, resources: ResolvedHeaderResources, elementId: (key: string) => string) {
  if (!plan.menuBindingPolicy) return;
  assertHeaderMenuParameterShape(raw);
  if (contract.menuBindingVersion !== 1) fail('native_contract_required');
  const nodes = new Map<string, WhbLayoutNode>();
  const visit = (node: WhbLayoutNode) => { if (nodes.has(node.id)) fail('duplicate_element'); nodes.set(node.id, node); node.content?.forEach(visit); }; visit(raw.structure);
  const planned = plannedHeaderMenus(plan), expectedIds = new Set(planned.map(e => elementId(e.key)));
  for (const node of nodes.values()) if (node.params?.menu_id && !expectedIds.has(node.id)) fail('unplanned_binding');
  for (const slot of planned) {
    const node = nodes.get(elementId(slot.key)), field = contract.elements[slot.type]?.schema.menu_id, menu = resources.menus[slot.menuKey], param = node?.params?.menu_id;
    if (!field || field.type !== 'select' || field.valueType !== 'string' || field.resource !== 'menu') fail('native_select_required');
    if (!menu || node?.type !== contract.elements[slot.type]?.type || param?.id !== 'menu_id' || param.type !== field.type || param.value !== menu.slug) fail('binding_mismatch');
    if (field.options && !field.options.includes(menu.slug)) fail('option_missing');
  }
}

const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const selection = z.object({ tag: z.literal('SELECT'), id: z.literal('select-menu_id'), value: z.string().min(1), options: z.array(z.object({ value: z.string(), label: z.string(), selected: z.boolean() }).strict()).min(2).max(1001) }).strict();
export const menuEditorObservationSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-header-menu-editor-observation'), taskId: z.string(), runId: z.string(),
  headerId: z.string(), fingerprint: z.string(), device: z.enum(['desktop', 'mobile']), elementKey: z.string(), elementId: z.string(),
  editorUrl: z.url(), observedAt: z.iso.datetime(), openedAt: z.iso.datetime(), savedHeaderHash: z.string().regex(/^[a-f0-9]{64}$/),
  selection, screenshot: ref,
}).strict();
export type MenuEditorObservation = z.infer<typeof menuEditorObservationSchema>;

export interface HeaderMenuEditorBrowser {
  reopen(url: string): Promise<void>;
  openMenu(device: 'desktop' | 'mobile', elementId: string): Promise<void>;
  readPanel(): Promise<{ editorUrl: string; device: 'desktop' | 'mobile'; elementId: string; selection: MenuEditorObservation['selection'] }>;
  screenshot(): Promise<{ path: string; sha256: string }>;
}

/** The browser adapter navigates/opens native panels only. It must never change a selection or save. */
export async function captureHeaderMenuEditorObservation(
  identity: Pick<MenuEditorObservation, 'taskId' | 'runId' | 'headerId' | 'fingerprint' | 'device' | 'elementKey' | 'elementId' | 'savedHeaderHash'> & { editorUrl: string },
  browser: HeaderMenuEditorBrowser,
): Promise<MenuEditorObservation> {
  const openedAt = new Date().toISOString();
  await browser.reopen(identity.editorUrl);
  await browser.openMenu(identity.device, identity.elementId);
  const before = await browser.readPanel(), screenshot = await browser.screenshot(), after = await browser.readPanel();
  if (headerJsonHash(before) !== headerJsonHash(after) || before.editorUrl !== identity.editorUrl || before.device !== identity.device || before.elementId !== identity.elementId) fail('editor_capture_changed');
  return menuEditorObservationSchema.parse({ ...identity, version: 1, kind: 'clonewp-header-menu-editor-observation', openedAt, observedAt: new Date().toISOString(), selection: before.selection, screenshot });
}

/** Paste into the supported browser's read-only DOM evaluator after opening the exact native panel. */
export const HEADER_MENU_SELECT_READER = `(() => {
  const el = document.getElementById('select-menu_id');
  if (!el || el.tagName !== 'SELECT') throw Error('native_menu_select_missing');
  return { tag: el.tagName, id: el.id, value: el.value,
    options: Array.from(el.options, o => ({ value: o.value, label: o.text, selected: o.selected })) };
})()`;

/** Each file records a reopened actual native panel, rather than a pass boolean. */
export async function verifyHeaderMenuEditorEvidence(input: {
  plan: HeaderModulePlan; headerId: string; taskId: string; runId: string; fingerprint: string; headerHash: string; observedAt: string;
  references: unknown; base: string; saved: { raw: WhbRawHeader; contract: NativeHeaderContract; resources: ResolvedHeaderResources };
  read(ref: { path: string; sha256: string }, base?: string): Promise<{ bytes: Buffer; filename: string }>;
}) {
  if (!input.plan.menuBindingPolicy) return;
  if (!input.plan.layout.mobile) fail('editor_mobile_plan_required');
  const reviewTime = Date.parse(input.observedAt);
  if (!Number.isFinite(reviewTime) || Math.abs(Date.now() - reviewTime) > 3600000) fail('editor_review_not_current');
  const { headerModuleElementId } = await import('./compiler.js');
  if (headerJsonHash(input.saved.raw) !== input.headerHash) fail('editor_saved_header_changed');
  assertNativeHeaderMenuBindings(input.plan, input.saved.raw, input.saved.contract, input.saved.resources, key => headerModuleElementId(input.plan.moduleKey, key));
  const refs = z.array(ref).max(200).parse(input.references ?? []), slots = plannedHeaderMenus(input.plan);
  if (refs.length !== slots.length) fail('editor_coverage_incomplete');
  const seen = new Set<string>();
  for (const reference of refs) {
    const file = await input.read(reference, input.base), row = menuEditorObservationSchema.parse(JSON.parse(file.bytes.toString('utf8')));
    const slot = slots.find(s => s.key === row.elementKey && s.device === row.device), identity = row.device + '/' + row.elementKey;
    const url = new URL(row.editorUrl), age = Date.parse(input.observedAt) - Date.parse(row.observedAt);
    if (!slot || seen.has(identity) || row.taskId !== input.taskId || row.runId !== input.runId || row.headerId !== input.headerId || row.fingerprint !== input.fingerprint || row.savedHeaderHash !== input.headerHash) fail('editor_identity');
    if (row.elementId !== headerModuleElementId(input.plan.moduleKey, slot.key)) fail('editor_identity');
    if (url.origin !== input.plan.targetOrigin || url.pathname !== '/wp-admin/admin.php' || url.search !== '?page=xts_header_builder' || url.hash !== '#/builder/' + input.headerId || age < 0 || age > 3600000 || Date.parse(row.openedAt) > Date.parse(row.observedAt) || Date.parse(row.openedAt) < Date.parse(row.observedAt) - 3600000) fail('editor_scope_or_time');
    const selected = row.selection.options.filter(o => o.selected), menu = input.plan.menus.find(m => m.key === slot.menuKey)!;
    if (selected.length !== 1 || selected[0].value !== row.selection.value || row.selection.value !== input.saved.resources.menus[slot.menuKey]?.slug || selected[0].label !== menu.name || !row.selection.value || new Set(row.selection.options.map(o => o.value)).size !== row.selection.options.length) fail('editor_selection');
    const image = await input.read(row.screenshot, file.filename.replace(/[^\\/]+$/, ''));
    const sharp = (await import('sharp')).default, metadata = await sharp(image.bytes).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 200 || metadata.height < 100) fail('editor_screenshot');
    seen.add(identity);
  }
}

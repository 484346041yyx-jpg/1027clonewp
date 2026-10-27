import { z } from 'zod';
import * as cssTree from 'css-tree';
import sharp from 'sharp';
import { native44Id, native44ModuleClass } from '../native44/adapters.js';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { FullReplicaFileRef } from './types.js';

const ref = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const nativeImagePolicySchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), mode: z.literal('native-first'),
  cssExceptions: z.array(z.object({ componentKey: z.string().min(1).max(80), reason: z.literal('native-control-unavailable'), summary: z.string().trim().min(20).max(2000), evidence: z.array(ref).min(1).max(20) }).strict()).max(100).optional(),
  directImageSlots: z.array(z.object({ componentKey: z.string().min(1).max(80), assetKey: z.string().min(1).max(200) }).strict()).max(2000).optional(),
}).strict();
export type NativeImagePolicy = z.infer<typeof nativeImagePolicySchema>;
/** Only creation boundaries call this. Validation/resume never adds fields. */
export const defaultNativeImagePolicy = (): NativeImagePolicy => ({ version: 2, mode: 'native-first' });
function fail(code: string): never { throw Error(`replica_full_native_image_${code}`); }
export interface NativeImageSlot { componentKey: string; elementId: string; settingPath: string; assetKey: string }

/** Native media references remain registered controls; the existing compiler resolves attachment IDs. */
export function nativeImageSlots(program: Native44Program): NativeImageSlot[] {
  const slots: NativeImageSlot[] = [];
  for (const node of walkNative44(program.blocks)) {
    const scan = (value: unknown, path: string, elementId: string): void => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.$asset === 'string' && Object.keys(record).length === 1) {
        // Logos/icons and other media use the same control contract and must remain replaceable too.
        slots.push({ componentKey: node.key, elementId, settingPath: path, assetKey: record.$asset }); return;
      }
      for (const [key, child] of Object.entries(record)) scan(child, path ? `${path}.${key}` : key, elementId);
    };
    scan(node.settings, '', native44Id(program.taskId, node.key));
    if ('widgetSettings' in node) scan(node.widgetSettings, '', native44Id(program.taskId, program.replicationProfile === 'desktop-browser-v1' ? node.key : `${node.key}-native`));
  }
  return slots;
}

/** Reject CSS photos rather than hiding them outside Elementor's native media controls. */
export function assertNativeImageCSS(policy: NativeImagePolicy | undefined, program: Native44Program, source: string): void {
  if (!policy) return;
  const parsed = nativeImagePolicySchema.parse(policy), nodes = walkNative44(program.blocks), classes = new Map(nodes.map(node => [native44ModuleClass(node.key), node.key]));
  const exceptions = parsed.cssExceptions ?? [];
  if (new Set(exceptions.map(row => row.componentKey)).size !== exceptions.length || exceptions.some(row => !nodes.some(node => node.key === row.componentKey))) fail('exception_scope');
  const nativeOwners = new Set(nativeImageSlots(program).filter(slot => /(?:^|\.)background(?:_overlay)?_image(?:_|$)/.test(slot.settingPath)).map(slot => native44ModuleClass(slot.componentKey)));
  const sources = [source, ...nodes.flatMap(node => [...(node.kind === 'html-static' ? [node.css, node.responsiveCss ?? ''] : []), ...[node.settings, 'widgetSettings' in node ? node.widgetSettings : undefined].flatMap(settings => typeof settings?.custom_css === 'string' ? [settings.custom_css] : [])])];
  for (const css of sources) {
    let ast: cssTree.CssNode;
    try { ast = cssTree.parse(css, { parseCustomProperty: true, onParseError() { fail('css_syntax'); } }); } catch { return fail('css_syntax'); }
    cssTree.walk(ast, node => {
    if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
    const selectors = node.prelude.children.toArray().map(selector => {
      const owned: string[] = [], native: string[] = []; let pseudo = false;
      cssTree.walk(selector, child => { if (child.type === 'ClassSelector') { const key = classes.get(child.name); if (key) owned.push(key); } });
      if (selector.type === 'Selector') {
        const children = selector.children.toArray(), lastCombinator = children.reduce((last, child, index) => child.type === 'Combinator' ? index : last, -1);
        for (const child of children.slice(lastCombinator + 1)) cssTree.walk(child, part => { if (part.type === 'ClassSelector' && nativeOwners.has(part.name)) native.push(part.name); if (part.type === 'PseudoElementSelector') pseudo = true; });
      }
      return { owned, native, pseudo };
    });
    cssTree.walk(node.block, declaration => {
      if (declaration.type !== 'Declaration') return;
      const property = declaration.property.toLowerCase();
      if (!['background', 'background-image', 'content', 'list-style-image', 'mask-image', '-webkit-mask-image'].includes(property) && !property.startsWith('--')) return;
      let photo = false;
      cssTree.walk(declaration.value, value => { if (value.type === 'Url' || value.type === 'Function' && /^(?:-webkit-)?image-set$/i.test(value.name)) photo = true; });
      const exception = selectors.every(selector => selector.owned.some(key => exceptions.some(row => row.componentKey === key)));
      if (photo && !exception) fail('css_photo_requires_native_control');
      // Even `background:none` or a gradient on the photo owner masks its registered image.
      if (!exception && ['background', 'background-image'].includes(property) && selectors.some(selector => selector.native.length && !selector.pseudo)) fail('css_masks_native_control');
    });
    });
  }
}

export const nativeImageCheckSchema = z.object({
  componentKey: z.string().min(1).max(80), elementId: z.string().regex(/^[a-f0-9]{7}$/), settingPath: z.string().min(1).max(500),
  before: ref, replacement: ref, restored: ref,
}).strict();
// Elementor may retain native size metadata alongside id/url. Only these two fields identify media.
const media = z.object({ id: z.number().int().nonnegative(), url: z.url() });
const observation = z.object({
  version: z.literal(1), kind: z.literal('clonewp-native-image-observation'), pageId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  elementId: z.string().regex(/^[a-f0-9]{7}$/), settingPath: z.string().min(1), observedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  panelMedia: media, renderedImageUrl: z.url(), screenshot: ref,
}).strict();
export type NativeImageCheck = z.infer<typeof nativeImageCheckSchema>;

/** Browser observations, hashed screenshot files, actual target IDs and reversible replacement are required. */
export async function verifyNativeImageChecks(input: {
  policy?: NativeImagePolicy; program: Native44Program; checks?: NativeImageCheck[];
  pageId: number; fingerprint: string; observedAt: string; targetOrigin: string; base: string;
  currentElements?: unknown[];
  read: (ref: FullReplicaFileRef, base: string) => Promise<{ filename: string; bytes: Buffer }>;
}): Promise<void> {
  if (!input.policy) return;
  const slots = nativeImageSlots(input.program), checks = z.array(nativeImageCheckSchema).max(2000).parse(input.checks ?? []);
  const identity = (row: { elementId: string; settingPath: string }) => `${row.elementId}:${row.settingPath}`;
  const components = new Map(walkNative44(input.program.blocks).map(node => [node.key, node]));
  const direct = new Map((input.policy.directImageSlots ?? []).map(row => [row.componentKey, row.assetKey]));
  const family = (slot: NativeImageSlot): string => {
    const node = components.get(slot.componentKey)!;
    return `${node.kind === 'composite' ? 'container' : 'widgetType' in node ? node.widgetType : node.kind}:${slot.settingPath.replace(/\.\d+(?=\.|$)/g, '.[]')}`;
  };
  const families = new Set(slots.map(family));
  if (new Set(checks.map(identity)).size !== checks.length || checks.some(check => !slots.some(slot => identity(slot) === identity(check) && slot.componentKey === check.componentKey)) || [...families].some(required => !checks.some(check => family(slots.find(slot => identity(slot) === identity(check))!) === required))) fail('checks_incomplete');
  // Every slot must exist in the saved native document, while one representative swap per implementation suffices.
  const saved = new Map<string, z.infer<typeof media>>();
  for (const slot of slots) {
    let currentMedia: unknown;
    const find = (rows: unknown[]): void => { for (const entry of rows) { const node = entry as { id?: string; settings?: unknown; elements?: unknown[] }; if (node.id === slot.elementId) { currentMedia = slot.settingPath.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, node.settings); } if (Array.isArray(node.elements)) find(node.elements); } };
    find(input.currentElements ?? []);
    const actual = media.safeParse(currentMedia); if (!actual.success || (actual.data.id === 0) !== (direct.get(slot.componentKey) === slot.assetKey)) fail('current_control_missing');
    saved.set(identity(slot), actual.data);
  }
  for (const check of checks) {
    const actual = saved.get(identity(check))!;
    const states = [];
    for (const ref of [check.before, check.replacement, check.restored]) {
      const file = await input.read(ref, input.base), state = observation.parse(JSON.parse(file.bytes.toString('utf8'))), time = Date.parse(state.observedAt);
      if (state.pageId !== input.pageId || state.fingerprint !== input.fingerprint || state.elementId !== check.elementId || state.settingPath !== check.settingPath || time > Date.parse(input.observedAt) || Date.parse(input.observedAt) - time > 60 * 60 * 1000) fail('observation_identity');
      if (state.panelMedia.id === 0 && direct.get(check.componentKey) !== slots.find(slot => identity(slot) === identity(check))?.assetKey) fail('observation_direct_media_scope');
      for (const url of [state.panelMedia.url, state.renderedImageUrl]) { const parsed = new URL(url); if (parsed.origin !== input.targetOrigin || parsed.username || parsed.password || /(?:token|nonce|password|secret|authorization)=/i.test(parsed.search)) fail('observation_url'); }
      const originalSize = (value: string) => value.replace(/-\d+x\d+(?=\.[a-zA-Z0-9]+(?:\?|$))/, '');
      if (originalSize(state.panelMedia.url) !== originalSize(state.renderedImageUrl)) fail('replacement_not_rendered');
      const screenshot = await input.read(state.screenshot, input.base), metadata = await sharp(screenshot.bytes).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 300 || metadata.height < 150) fail('observation_screenshot');
      states.push(state);
    }
    const [before, replacement, restored] = states;
    if (before.panelMedia.id !== actual.id || before.panelMedia.url !== actual.url) fail('current_control_changed');
    if (replacement.panelMedia.id === before.panelMedia.id || replacement.panelMedia.url === before.panelMedia.url || restored.panelMedia.id !== before.panelMedia.id || restored.panelMedia.url !== before.panelMedia.url || Date.parse(replacement.observedAt) < Date.parse(before.observedAt) || Date.parse(restored.observedAt) < Date.parse(replacement.observedAt)) fail('swap_or_restore_missing');
  }
}

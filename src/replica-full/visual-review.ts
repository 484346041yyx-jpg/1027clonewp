import path from 'node:path';
import { z } from 'zod';
import { parse } from 'parse5';
import { native44ModuleClass } from '../native44/adapters.js';
import type { Native44VisualModule } from '../native44/contracts.js';
import { compareNative44VisualModules, opaqueSolidBackground, visiblePaint, visualBackgroundImageKind } from '../native44/visual-audit.js';
import { native44Children, type Native44Component, type Native44Program } from '../native44/types.js';
import { validateNative44Program } from '../native44/validate.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { BodySourceEvidenceSchema, BodySourceUnitsSchema } from './body-prepare.js';
import type { FullReplicaBoundCheckpoint, FullReplicaFileRef, FullReplicaManifest, FullReplicaReview } from './types.js';
import { fullReplicaFingerprint } from './contract.js';
import { mobileComponentKey } from '../replica-responsive/body.js';
import { verifyResponsiveSource } from '../replica-responsive/source.js';

const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const control = z.object({ width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), background: z.string(), color: z.string(), borderBottomWidth: z.string(), beforeContent: z.string(), afterContent: z.string() }).strict();
const paintLayer = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), background: z.string(), backgroundImage: z.enum(['none', 'gradient', 'image']), borderWidth: z.string(), borderColor: z.string(), borderRadius: z.string(), boxShadow: z.string(), opacity: z.string() }).strict();
const visual = z.object({ solidBackground: z.string().nullable(), texts: z.array(z.object({ text: z.string().min(1).max(240), color: z.string(), fontSize: z.string(), lineHeight: z.string(), x: z.number().finite().optional(), width: z.number().finite().nonnegative().optional(), height: z.number().finite().nonnegative().optional(), lineCount: z.number().int().positive().optional(), whiteSpace: z.string().optional(), control: control.optional() }).strict()).max(400), progress: z.array(z.object({ x: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), background: z.string(), fillFraction: z.number().finite().min(0).max(1).nullable() }).strict()).max(30).optional(), arrows: z.array(z.object({ side: z.enum(['prev', 'next']), x: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), background: z.string(), color: z.string(), borderRadius: z.string(), iconWidth: z.number().finite().nonnegative().nullable(), iconHeight: z.number().finite().nonnegative().nullable() }).strict()).max(30).optional(), mediaGeometry: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict()).max(100).optional(), paintLayers: z.array(paintLayer).max(2000).optional() }).strict();
const reportIdentity = { kind: z.literal('clonewp-full-replica-visual-audit'), pageId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(), screenshotSha256: z.string().regex(/^[a-f0-9]{64}$/), observedAt: z.string() };
const reportSchema = z.union([
  z.object({ version: z.literal(1), ...reportIdentity, modules: z.array(z.object({ sourceUnitId: z.string().min(1), targetSelector: z.string().min(1), visual }).strict()).max(2000) }).strict(),
  z.object({ version: z.literal(2), ...reportIdentity, clientWidth: z.number().int().positive(), modules: z.array(z.object({ sectionKey: z.string().min(1), targetSelector: z.string().min(1), visual }).strict()).max(2000) }).strict(),
]);
type Read = (reference: FullReplicaFileRef, base?: string) => Promise<{ filename: string; bytes: Buffer }>;

function fail(reason: string): never { throw Error(`replica_full_visual_${reason}`); }

export function sourceVisual(packet: ObservationPacketV2, ownerId: string, nodeIds: string[]): Native44VisualModule {
  const nodes = packet.nodes, styles = packet.styles, layouts = packet.layouts, included = new Set(nodeIds), owner = nodes[ownerId];
  const rootRect = owner && layouts[owner.layoutId]?.rect;
  if (!owner || !rootRect) fail('source_owner_missing');
  const clipped = (id: string) => {
    const node = nodes[id], rect = node && layouts[node.layoutId]?.rect;
    if (!node?.visible || !rect || rect.width <= 0 || rect.height <= 0) return null;
    let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
    const seen = new Set<string>();
    for (let cursor: string | null = id; cursor; cursor = nodes[cursor]?.parentId ?? null) {
      if (seen.has(cursor)) return null; seen.add(cursor);
      const ancestor = nodes[cursor], style = ancestor && styles[ancestor.styleId];
      if (!style || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return null;
      const box = layouts[ancestor.layoutId]?.rect;
      if (cursor !== id && box) {
        const shorthand = String(style.overflow ?? 'visible').split(/\s+/), clipX = /^(hidden|clip|scroll|auto)$/.test(style['overflow-x'] ?? shorthand[0]), clipY = /^(hidden|clip|scroll|auto)$/.test(style['overflow-y'] ?? shorthand[1] ?? shorthand[0]);
        if (clipX) { left = Math.max(left, box.x); right = Math.min(right, box.x + box.width); }
        if (clipY) { top = Math.max(top, box.y); bottom = Math.min(bottom, box.y + box.height); }
      }
    }
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  };
  const visible = (id: string): boolean => clipped(id) !== null;
  let solidBackground: string | null = null;
  for (let cursor: string | null = ownerId; cursor; cursor = nodes[cursor]?.parentId ?? null) {
    const node = nodes[cursor], layer = node && opaqueSolidBackground(styles[node.styleId]);
    if (layer !== undefined) { solidBackground = layer; break; }
  }
  const sourceControl = (id: string) => {
    for (let cursor: string | null = id; cursor; cursor = nodes[cursor]?.parentId ?? null) {
      const node = nodes[cursor]; if (!node) return undefined;
      if (['a', 'button'].includes(node.tag.toLowerCase()) || ['tab', 'button', 'link'].includes(node.attributes.role ?? '')) {
        const style = styles[node.styleId], rect = layouts[node.layoutId]?.rect;
        return rect ? { width: rect.width, height: rect.height, background: style['background-color'] ?? '', color: style.color ?? '', borderBottomWidth: style['border-bottom-width'] ?? style['border-width'] ?? '0px', beforeContent: style['before:content'] ?? 'none', afterContent: style['after:content'] ?? 'none' } : undefined;
      }
      if (cursor === ownerId) break;
    }
    return undefined;
  };
  const texts = Object.values(packet.texts).filter(row => included.has(row.nodeId) && visible(row.nodeId) && row.text.trim().length >= 3 && row.text.trim().length <= 240).flatMap(row => {
    const node = nodes[row.nodeId], style = styles[node.styleId];
    let rect = layouts[node.layoutId]?.rect, soleButtonLabel = false;
    if (!rect) return [];
    for (let cursor: string | null = row.nodeId; cursor; cursor = nodes[cursor]?.parentId ?? null) {
      if (nodes[cursor]?.tag.toLowerCase() === 'button') {
        const buttonId = cursor;
        const label = Object.values(packet.texts).filter(text => {
          if (!visible(text.nodeId)) return false;
          for (let id: string | null = text.nodeId; id; id = nodes[id]?.parentId ?? null) if (id === buttonId) return true;
          return false;
        }).map(text => text.text).join(' ').replace(/\s+/g, ' ').trim();
        if (label === row.text.replace(/\s+/g, ' ').trim()) { rect = layouts[nodes[buttonId].layoutId].rect; soleButtonLabel = true; }
        break;
      }
      if (cursor === ownerId) break;
    }
    const control = sourceControl(row.nodeId);
    const lineHeight = Number.parseFloat(style['line-height'] ?? ''), lineCount = soleButtonLabel && row.lineCount ? row.lineCount : Number.isFinite(lineHeight) && lineHeight > 0 ? Math.max(1, Math.round(rect.height / lineHeight)) : undefined;
    return [{ text: row.text, color: style.color ?? '', fontSize: style['font-size'] ?? '', lineHeight: style['line-height'] ?? '', x: rect.x - rootRect.x, width: rect.width, height: rect.height, ...(lineCount ? { lineCount } : {}), whiteSpace: style['white-space'] ?? '', ...(control ? { control } : {}) }];
  }).slice(0, 400);
  const progress = Object.values(nodes).filter(node => included.has(node.id) && visible(node.id) && /(?:^|\s)(?:splide-carousel-progress|swiper-pagination-progressbar|wd-[\w-]*progress)(?:\s|$)/.test(node.attributes.class ?? '') && !/(?:progress-bar|progressbar-fill)/.test(node.attributes.class ?? '')).flatMap(node => {
    const rect = layouts[node.layoutId]?.rect; if (!rect) return [];
    const fill = node.childIds.map(id => nodes[id]).find(child => child && /(?:progress-bar|progressbar-fill)/.test(child.attributes.class ?? ''));
    const fillRect = fill && layouts[fill.layoutId]?.rect;
    return [{ x: rect.x - rootRect.x, width: rect.width, height: rect.height, background: styles[node.styleId]['background-color'] ?? '', fillFraction: fillRect ? fillRect.width / rect.width : null }];
  });
  const arrows = Object.values(nodes).filter(node => included.has(node.id) && ['button', 'a'].includes(node.tag.toLowerCase())).flatMap(node => {
    const name = `${node.attributes.class ?? ''} ${node.attributes['aria-label'] ?? ''}`;
    const side = /(?:^|[\s_-])prev(?:ious)?(?:[\s_-]|$)/i.test(name) ? 'prev' as const : /(?:^|[\s_-])next(?:[\s_-]|$)/i.test(name) ? 'next' as const : null;
    if (!side || !/(?:arrow|swiper-button|slider-button|carousel-button|splide)/i.test(name) || !visible(node.id)) return [];
    const style = styles[node.styleId], rect = layouts[node.layoutId]?.rect, icon = node.childIds.map(id => nodes[id]).find(child => child && ['svg', 'i'].includes(child.tag.toLowerCase()));
    if (!rect) return [];
    const iconStyle = icon && styles[icon.styleId], iconRect = icon && layouts[icon.layoutId]?.rect;
    const pseudo = !iconStyle && (style['before:content'] && !['none', 'normal'].includes(style['before:content']) ? 'before' : style['after:content'] && !['none', 'normal'].includes(style['after:content']) ? 'after' : null);
    const size = (value: string | undefined, fallback: number) => /^\d+(?:\.\d+)?px$/.test(value ?? '') ? Number.parseFloat(value!) : fallback;
    return [{ side, x: rect.x - rootRect.x, width: size(style.width, rect.width), height: size(style.height, rect.height), background: style['background-color'] ?? '', color: style.color ?? '', borderRadius: style['border-radius'] ?? '', iconWidth: iconStyle ? size(iconStyle.width, iconRect?.width ?? 0) : pseudo ? size(style[`${pseudo}:width`], size(style[`${pseudo}:font-size`], 0)) : null, iconHeight: iconStyle ? size(iconStyle.height, iconRect?.height ?? 0) : pseudo ? size(style[`${pseudo}:height`], size(style[`${pseudo}:font-size`], 0)) : null }];
  });
  const mediaGeometry = Object.values(nodes).filter(node => included.has(node.id) && ['img', 'svg'].includes(node.tag.toLowerCase()) && visible(node.id)).slice(0, 100).map(node => {
    const rect = clipped(node.id)!;
    return { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height };
  });
  const paintLayers = Object.values(nodes).filter(node => included.has(node.id) && visible(node.id)).flatMap(node => {
    const rect = clipped(node.id), style = styles[node.styleId];
    if (!rect || !visiblePaint(style)) return [];
    return [{ x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height,
      background: style['background-color'] ?? '', backgroundImage: visualBackgroundImageKind(style['background-image'] ?? ''),
      borderWidth: style['border-width'] ?? '0px', borderColor: style['border-color'] ?? '', borderRadius: style['border-radius'] ?? '0px',
      boxShadow: style['box-shadow'] ?? 'none', opacity: style.opacity ?? '1' }];
  });
  return { solidBackground, texts, progress, arrows, mediaGeometry, paintLayers };
}

function owningTopLevel(program: Native44Program, keys: string[]): string | undefined {
  const contains = (node: Native44Component): boolean => keys.includes(node.key) || native44Children(node).some(contains);
  return program.blocks.find(contains)?.key;
}

/** Browser-side sampler for one rendered Elementor module. Call it in the
 * same settled viewport and page state as the review screenshot. */
export function sampleFullReplicaVisualModule(root: Element): Native44VisualModule {
  const rootRect = root.getBoundingClientRect();
  const opaque = (style: CSSStyleDeclaration): string | null | undefined => {
    if (style.backgroundImage && style.backgroundImage !== 'none') return null;
    const color = style.backgroundColor, alpha = /rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+))?\s*\)/i.exec(color)?.[1];
    if (!color || color === 'transparent' || alpha !== undefined && Number(alpha) === 0) return undefined;
    return alpha === undefined || Number(alpha) === 1 ? color : null;
  };
  const paint = (node: Element) => {
    const style = getComputedStyle(node);
    return opaque(style);
  };
  let solidBackground: string | null = null;
  for (let node: Element | null = root; node; node = node.parentElement) {
    const layer = paint(node);
    if (layer !== undefined) { solidBackground = layer; break; }
  }
  const clipped = (node: Element) => {
    const rect = node.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return null;
    let left = rect.x, top = rect.y, right = rect.right, bottom = rect.bottom;
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor); if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return null;
      if (ancestor !== node) {
        const box = ancestor.getBoundingClientRect();
        if (/^(hidden|clip|scroll|auto)$/.test(style.overflowX)) { left = Math.max(left, box.x); right = Math.min(right, box.right); }
        if (/^(hidden|clip|scroll|auto)$/.test(style.overflowY)) { top = Math.max(top, box.y); bottom = Math.min(bottom, box.bottom); }
      }
    }
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  };
  const visible = (node: Element) => clipped(node) !== null;
  // Keep this browser sampler self-contained: callers may serialize it into page.evaluate.
  const painted = (css: CSSStyleDeclaration) => {
    const alpha = /rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+))?\s*\)/i.exec(css.backgroundColor)?.[1];
    const background = alpha === undefined ? css.backgroundColor !== 'transparent' : Number(alpha) > 0;
    return background || css.backgroundImage !== 'none' || (css.borderWidth.match(/\d+(?:\.\d+)?px/g) ?? []).some(width => Number.parseFloat(width) > 0) && css.borderStyle !== 'none' || css.boxShadow !== 'none';
  };
  const texts: Native44VisualModule['texts'] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && texts.length < 400; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '', element = node.parentElement;
    if (!element || !text || text.length < 3 || text.length > 240 || !visible(element)) continue;
    const style = getComputedStyle(element);
    let rect = element.getBoundingClientRect();
    const controlElement = element.closest('a,button,[role="tab"],[role="button"],[role="link"]');
    const controlStyle = controlElement ? getComputedStyle(controlElement) : null, controlRect = controlElement?.getBoundingClientRect();
    const soleButtonLabel = controlElement?.tagName.toLowerCase() === 'button' && controlElement.textContent?.replace(/\s+/g, ' ').trim() === text;
    // Native widgets may wrap a sole button label in spans. Measure the same
    // semantic control boundary on both sides, but count actual glyph lines so
    // button padding is never mistaken for a second line.
    let glyphLines: number | undefined;
    if (soleButtonLabel && controlRect) {
      rect = controlRect;
      const range = document.createRange(); range.selectNodeContents(node);
      const tops: number[] = [];
      for (const box of range.getClientRects()) if (box.width > 0 && box.height > 0 && !tops.some(top => Math.abs(top - box.top) < 1)) tops.push(box.top);
      if (tops.length) glyphLines = tops.length;
      range.detach();
    }
    const numericLineHeight = Number.parseFloat(style.lineHeight), lineCount = glyphLines ?? (Number.isFinite(numericLineHeight) && numericLineHeight > 0 ? Math.max(1, Math.round(rect.height / numericLineHeight)) : undefined);
    texts.push({ text, color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight, x: rect.x - rootRect.x, width: rect.width, height: rect.height, ...(lineCount ? { lineCount } : {}), whiteSpace: style.whiteSpace,
      ...(controlStyle && controlRect ? { control: { width: controlRect.width, height: controlRect.height, background: controlStyle.backgroundColor, color: controlStyle.color, borderBottomWidth: controlStyle.borderBottomWidth, beforeContent: getComputedStyle(controlElement!, '::before').content, afterContent: getComputedStyle(controlElement!, '::after').content } } : {}) });
  }
  const progress = [...root.querySelectorAll('[class*="progress"]')].filter(element => /(?:^|\s)(?:splide-carousel-progress|swiper-pagination-progressbar|wd-[\w-]*progress)(?:\s|$)/.test(element.getAttribute('class') ?? '') && !/(?:progress-bar|progressbar-fill)/.test(element.getAttribute('class') ?? '') && visible(element)).slice(0, 30).map(element => {
    const rect = element.getBoundingClientRect(), fill = element.querySelector('[class*="progress-bar"],[class*="progressbar-fill"]'), fillRect = fill?.getBoundingClientRect();
    return { x: rect.x - rootRect.x, width: rect.width, height: rect.height, background: getComputedStyle(element).backgroundColor, fillFraction: fillRect && rect.width > 0 ? fillRect.width / rect.width : null };
  });
  const arrows = [...root.querySelectorAll('button,a')].flatMap(element => {
    const name = `${element.getAttribute('class') ?? ''} ${element.getAttribute('aria-label') ?? ''}`;
    const side = /(?:^|[\s_-])prev(?:ious)?(?:[\s_-]|$)/i.test(name) ? 'prev' as const : /(?:^|[\s_-])next(?:[\s_-]|$)/i.test(name) ? 'next' as const : null;
    if (!side || !/(?:arrow|swiper-button|slider-button|carousel-button|splide)/i.test(name) || !visible(element)) return [];
    const style = getComputedStyle(element), rect = element.getBoundingClientRect(), icon = element.querySelector('svg,i'), iconStyle = icon && getComputedStyle(icon), iconRect = icon?.getBoundingClientRect();
    const before = !iconStyle && getComputedStyle(element, '::before'), after = !iconStyle && getComputedStyle(element, '::after');
    const pseudo = before && !['none', 'normal'].includes(before.content) ? before : after && !['none', 'normal'].includes(after.content) ? after : null;
    const size = (value: string | undefined, fallback: number) => /^\d+(?:\.\d+)?px$/.test(value ?? '') ? Number.parseFloat(value!) : fallback;
    return [{ side, x: rect.x - rootRect.x, width: size(style.width, rect.width), height: size(style.height, rect.height), background: style.backgroundColor, color: style.color, borderRadius: style.borderRadius, iconWidth: iconStyle ? size(iconStyle.width, iconRect?.width ?? 0) : pseudo ? size(pseudo.width, size(pseudo.fontSize, 0)) : null, iconHeight: iconStyle ? size(iconStyle.height, iconRect?.height ?? 0) : pseudo ? size(pseudo.height, size(pseudo.fontSize, 0)) : null }];
  });
  const mediaGeometry = [...root.querySelectorAll('img,svg')].filter(element => visible(element)).slice(0, 100).map(element => {
    const rect = clipped(element)!;
    return { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height };
  });
  const paintLayers = [root, ...root.querySelectorAll('*')].filter(element => visible(element)).flatMap(element => {
    const style = getComputedStyle(element), rect = clipped(element)!;
    if (!painted(style)) return [];
    return [{ x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height,
      background: style.backgroundColor, backgroundImage: style.backgroundImage === 'none' ? 'none' as const : /gradient\(/i.test(style.backgroundImage) ? 'gradient' as const : 'image' as const,
      borderWidth: style.borderWidth, borderColor: style.borderColor, borderRadius: style.borderRadius,
      boxShadow: style.boxShadow, opacity: style.opacity }];
  });
  return { solidBackground, texts, progress, arrows, mediaGeometry, paintLayers };
}

/** The reviewer captures target computed styles per source unit in the same
 * browser session as the screenshot. Source values are re-derived from frozen
 * packet bytes, never accepted from the reviewer report. */
export async function verifyFullReplicaVisualReview(input: { manifest: FullReplicaManifest; bound: FullReplicaBoundCheckpoint; review: FullReplicaReview; width: number; height: number; screenshotSha256: string; reference: FullReplicaFileRef; reviewDirectory: string; targetHtml: string; read: Read }): Promise<void> {
  const { manifest, bound, review, read } = input;
  const reportFile = await read(ref.parse(input.reference), input.reviewDirectory), report = reportSchema.parse(JSON.parse(reportFile.bytes.toString('utf8')));
  if (report.version !== 1) fail('desktop_report_version');
  if (report.pageId !== bound.pageId || report.fingerprint !== fullReplicaFingerprint(bound) || report.width !== input.width || report.height !== input.height || report.screenshotSha256 !== input.screenshotSha256 || !Number.isFinite(Date.parse(report.observedAt)) || Date.parse(report.observedAt) > Date.parse(review.observedAt) || Date.parse(review.observedAt) - Date.parse(report.observedAt) > 60 * 60 * 1000) fail('identity');
  const [programFile, unitsFile, evidenceFile] = await Promise.all([read(manifest.body.program), read(manifest.body.sourceUnits), read(manifest.sourceEvidence)]);
  const program = validateNative44Program(JSON.parse(programFile.bytes.toString('utf8'))), units = BodySourceUnitsSchema.parse(JSON.parse(unitsFile.bytes.toString('utf8'))), evidence = BodySourceEvidenceSchema.parse(JSON.parse(evidenceFile.bytes.toString('utf8')));
  if (![1, 2, 3].includes(program.visualAuditVersion ?? 0) || program.taskId !== manifest.taskId || units.taskId !== manifest.taskId || evidence.taskId !== manifest.taskId) fail('source_identity');
  const visualVersion = program.visualAuditVersion!;
  const snapshot = evidence.snapshots.find(row => row.viewport.width === input.width && row.viewport.height === input.height);
  if (!snapshot) fail('source_viewport_missing');
  const packets = await Promise.all(snapshot.packets.map(async reference => validateObservationPacketV2(JSON.parse((await read(reference, path.dirname(evidenceFile.filename))).bytes.toString('utf8')))));
  const packet = structuredClone(packets[0]);
  for (const next of packets.slice(1)) for (const table of ['nodes', 'texts', 'styles', 'layouts'] as const) Object.assign(packet[table], next[table]);
  if (packet.snapshot.id !== snapshot.id) fail('packet_snapshot');
  const required = units.units.filter(unit => unit.snapshotId === snapshot.id && manifest.sourcePartition.bodyUnits.includes(unit.id) && packet.nodes[unit.ownerNodeId]?.visible);
  if (report.modules.length !== required.length || new Set(report.modules.map(row => row.sourceUnitId)).size !== required.length) fail('module_coverage');
  const classCounts = new Map<string, number>();
  const walk = (node: { attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] }, inPage = false): void => {
    const classes = (node.attrs?.find(attribute => attribute.name === 'class')?.value ?? '').split(/\s+/).filter(Boolean);
    const owned = inPage || classes.includes(`elementor-${bound.pageId}`);
    if (owned) for (const name of classes) classCounts.set(name, (classCounts.get(name) ?? 0) + 1);
    for (const child of node.childNodes ?? []) walk(child as typeof node, owned);
  };
  walk(parse(input.targetHtml));
  for (const unit of required) {
    const row = report.modules.find(item => item.sourceUnitId === unit.id), topLevel = owningTopLevel(program, unit.componentKeys);
    if (!row || !topLevel || row.targetSelector !== `.elementor-${bound.pageId} .${native44ModuleClass(topLevel)}`) fail('module_binding');
    if (classCounts.get(native44ModuleClass(topLevel)) !== 1) fail(`module_dom_identity:${unit.id}`);
    if (visualVersion >= 2 && !row.visual.paintLayers) fail(`paint_coverage:${unit.id}`);
    const differences = compareNative44VisualModules(sourceVisual(packet, unit.ownerNodeId, unit.nodeIds), row.visual, visualVersion >= 2, visualVersion >= 3);
    if (differences.length) fail(`mismatch:${unit.id}:${differences.slice(0, 5).map(difference => `${difference.text ?? 'section'} ${difference.detail}`).join(' | ')}`);
  }
}

/** v4 phone review uses the frozen responsive section owners. Desktop source
 * units cannot identify phone-specific branches, so each section is bound to
 * its own source node and the corresponding generated top-level component. */
export async function verifyFullReplicaPhoneVisualReview(input: { manifest: FullReplicaManifest; bound: FullReplicaBoundCheckpoint; review: FullReplicaReview; width: number; height: number; clientWidth: number; screenshotSha256: string; reference: FullReplicaFileRef; reviewDirectory: string; targetHtml: string; read: Read; packets?: ObservationPacketV2[] }): Promise<void> {
  const { manifest, bound, review, read } = input;
  if (manifest.version !== 4 || !manifest.responsive) fail('phone_contract');
  const reportFile = await read(ref.parse(input.reference), input.reviewDirectory), report = reportSchema.parse(JSON.parse(reportFile.bytes.toString('utf8')));
  if (report.version !== 2 || report.pageId !== bound.pageId || report.fingerprint !== fullReplicaFingerprint(bound) || report.width !== input.width || report.height !== input.height || report.clientWidth !== input.clientWidth || report.screenshotSha256 !== input.screenshotSha256 || !Number.isFinite(Date.parse(report.observedAt)) || Date.parse(report.observedAt) > Date.parse(review.observedAt) || Date.parse(review.observedAt) - Date.parse(report.observedAt) > 60 * 60 * 1000) fail('phone_identity');
  const packets = input.packets ?? await verifyResponsiveSource(manifest.responsive, manifest, read);
  const sections = manifest.responsive.sections.flatMap(section => {
    const owners = section.evidence.flatMap(e => packets.filter(p => p.snapshot.id === e.snapshotId && p.snapshot.viewport.width === input.width && p.snapshot.viewport.height === input.height && p.nodes[e.nodeId]).map(packet => ({ packet, ownerId: e.nodeId })));
    if (owners.length !== 1) fail(`phone_source_owner:${section.key}`);
    const { packet, ownerId } = owners[0];
    if (packet.snapshot.viewport.clientWidth !== input.clientWidth) fail(`phone_client_width:${section.key}`);
    return packet.nodes[ownerId].visible ? [{ section, packet, ownerId }] : [];
  });
  if (report.modules.length !== sections.length || new Set(report.modules.map(row => row.sectionKey)).size !== sections.length) fail('phone_module_coverage');
  const classCounts = new Map<string, number>();
  const walkDOM = (node: { attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] }, inPage = false): void => {
    const classes = (node.attrs?.find(a => a.name === 'class')?.value ?? '').split(/\s+/).filter(Boolean), owned = inPage || classes.includes(`elementor-${bound.pageId}`);
    if (owned) for (const name of classes) classCounts.set(name, (classCounts.get(name) ?? 0) + 1);
    for (const child of node.childNodes ?? []) walkDOM(child as typeof node, owned);
  };
  walkDOM(parse(input.targetHtml));
  for (const { section, packet, ownerId } of sections) {
    const row = report.modules.find(item => item.sectionKey === section.key), targetKey = section.mode === 'duplicate' ? mobileComponentKey(section.key) : section.key;
    const cls = native44ModuleClass(targetKey), expectedSelector = `.elementor-${bound.pageId} .${cls}`;
    if (!row || row.targetSelector !== expectedSelector || classCounts.get(cls) !== 1 || !row.visual.paintLayers) fail(`phone_module_binding:${section.key}`);
    const included = new Set<string>(), visit = (id: string): void => {
      if (included.has(id)) return;
      const node = packet.nodes[id]; if (!node) fail(`phone_source_node:${section.key}`);
      included.add(id); for (const child of node.childIds) visit(child);
    };
    visit(ownerId);
    const differences = compareNative44VisualModules(sourceVisual(packet, ownerId, [...included]), row.visual, true, true);
    if (differences.length) fail(`phone_mismatch:${section.key}:${differences.slice(0, 5).map(d => `${d.text ?? 'section'} ${d.detail}`).join(' | ')}`);
  }
}

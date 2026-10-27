import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import type { ResponsivePlan } from './contract.js';

const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const frame = z.object({ viewportWidth: z.number().finite().positive(), activeIndex: z.number().int().min(0), items: z.array(z.object({ index: z.number().int().min(0), x: z.number().finite(), width: z.number().finite().positive() }).strict()).min(2).max(40) }).strict();
const motion = z.object({ version: z.literal(1), kind: z.literal('clonewp-responsive-carousel-motion-source'), taskId: z.string().min(1), sourceUrl: z.url(), rows: z.array(z.object({ componentKey: z.string().min(1), sectionKey: z.string().min(1), snapshotId: z.string().min(1), sourceNodeId: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(), clientWidth: z.number().int().positive(), observedAt: z.string().datetime(), before: frame, after: frame, beforeScreenshot: ref, afterScreenshot: ref }).strict()).max(2000) }).strict();
export const carouselMotionFrameSchema = frame;
export type CarouselMotionFrame = z.infer<typeof frame>;
type Ref = z.infer<typeof ref>;
type Read = (reference: Ref, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
function fail(reason: string): never { throw Error(`replica_responsive_motion_${reason}`); }

/** Browser-side geometry sampler, independent of Swiper/WoodMart internals.
 * The caller identifies the actual viewport, logical items and active index
 * after the browser has settled. Coordinates are relative to the viewport. */
export function sampleCarouselMotionFrame(viewport: Element, items: ReadonlyArray<{ index: number; element: Element }>, activeIndex: number): CarouselMotionFrame {
  const origin = viewport.getBoundingClientRect();
  const result = { viewportWidth: origin.width, activeIndex, items: items.map(item => {
    const rect = item.element.getBoundingClientRect();
    return { index: item.index, x: rect.x - origin.x, width: rect.width };
  }) };
  return frame.parse(result);
}

/** Native carousel widgets and source-observed dynamic product carousels both
 * need a swipe-state check. Grid products are intentionally excluded. */
export function requiredPhoneCarousels(program: Native44Program, plan: ResponsivePlan): Array<{ componentKey: string; sectionKey: string }> {
  const entries = new Map<string, { componentKey: string; sectionKey: string }>();
  for (const section of plan.sections) {
    if (section.mode === 'desktop-only') continue;
    const root = program.blocks.find(block => block.key === section.key);
    if (!root) fail(`section_program_missing:${section.key}`);
    for (const node of walkNative44([root])) if (node.kind === 'native-carousel') entries.set(node.key, { componentKey: node.key, sectionKey: section.key });
  }
  for (const row of plan.decisions?.carousels ?? []) {
    if (row.presentation === 'grid' || plan.sections.find(section => section.key === row.sectionKey)?.mode === 'desktop-only') continue;
    entries.set(row.componentKey, { componentKey: row.componentKey, sectionKey: row.sectionKey });
  }
  return [...entries.values()];
}

export async function verifyPhoneMotionSource(input: { taskId: string; sourceUrl: string; plan: ResponsivePlan; program: Native44Program; packets: ObservationPacketV2[]; read: Read }): Promise<z.infer<typeof motion>['rows']> {
  const { taskId, sourceUrl, plan, program, packets, read } = input, required = requiredPhoneCarousels(program, plan);
  if (!required.length) {
    if (plan.carouselMotionSource) fail('unexpected_source');
    return [];
  }
  if (!plan.carouselMotionSource) fail('source_missing');
  const file = await read(plan.carouselMotionSource), source = motion.parse(JSON.parse(file.bytes.toString('utf8')));
  if (source.taskId !== taskId || source.sourceUrl !== sourceUrl || source.rows.length !== required.length * plan.viewports.length) fail('source_identity');
  const keys = new Set<string>();
  for (const row of source.rows) {
    const key = `${row.componentKey}:${row.width}x${row.height}`;
    if (keys.has(key)) fail('duplicate'); keys.add(key);
    if (!required.some(item => item.componentKey === row.componentKey && item.sectionKey === row.sectionKey) || !plan.viewports.some(view => view.width === row.width && view.height === row.height)) fail('component_identity');
    const section = plan.sections.find(item => item.key === row.sectionKey)!;
    const packet = packets.find(item => item.snapshot.id === row.snapshotId && item.nodes[row.sourceNodeId] && item.snapshot.viewport.width === row.width && item.snapshot.viewport.height === row.height);
    if (!packet || packet.snapshot.viewport.clientWidth !== row.clientWidth) fail('source_viewport');
    const owners = section.evidence.filter(item => item.snapshotId === row.snapshotId).map(item => item.nodeId);
    let cursor: string | null = row.sourceNodeId, owned = false;
    while (cursor) { if (owners.includes(cursor)) { owned = true; break; } cursor = packet.nodes[cursor]?.parentId ?? null; }
    if (!owned) fail('source_section_owner');
    const moved = row.before.items.some(item => {
      const after = row.after.items.find(other => other.index === item.index);
      return after && Math.abs(after.x - item.x) > 2;
    });
    if (row.before.activeIndex === row.after.activeIndex || !moved || row.before.viewportWidth < 1 || row.after.viewportWidth < 1 || row.before.items.some(item => row.before.items.filter(other => other.index === item.index).length !== 1) || row.after.items.some(item => row.after.items.filter(other => other.index === item.index).length !== 1)) fail('source_motion_geometry');
    for (const shot of [row.beforeScreenshot, row.afterScreenshot]) {
      const image = await read(shot, path.dirname(file.filename)), metadata = await sharp(image.bytes).metadata();
      if (!metadata.width || !metadata.height || metadata.width < row.clientWidth || metadata.width > row.clientWidth * 4 || metadata.height < row.height || metadata.height > row.height * 4) fail('source_motion_screenshot');
    }
  }
  for (const item of required) for (const view of plan.viewports) if (!keys.has(`${item.componentKey}:${view.width}x${view.height}`)) fail('coverage');
  return source.rows;
}

export function compareCarouselMotion(sourceBefore: CarouselMotionFrame, sourceAfter: CarouselMotionFrame, targetBefore: CarouselMotionFrame, targetAfter: CarouselMotionFrame): string[] {
  const errors: string[] = [];
  if (targetAfter.activeIndex - targetBefore.activeIndex !== sourceAfter.activeIndex - sourceBefore.activeIndex) errors.push('slide step');
  for (const [label, source, target] of [['before', sourceBefore, targetBefore], ['after', sourceAfter, targetAfter]] as const) {
    if (Math.abs(source.viewportWidth - target.viewportWidth) > 4) errors.push(`${label} viewport width`);
    for (const item of source.items) {
      const other = target.items.find(candidate => candidate.index === item.index);
      if (!other || Math.abs(item.x - other.x) > 6 || Math.abs(item.width - other.width) > 4) errors.push(`${label} item ${item.index} geometry`);
    }
  }
  return errors;
}

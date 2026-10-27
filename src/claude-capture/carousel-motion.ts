import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { carouselMotionFrameSchema } from '../replica-responsive/motion-review.js';
import { settlePage, waitForPage } from './observe.js';
import { openClaudeBrowser } from './session.js';

export interface CarouselMotionSpec { componentKey: string; sectionKey: string; rootSelector: string }
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Real touch swipes on each phone carousel; frames use the logical (non-cloned) items relative to the clipping viewport. */
export async function observeCarouselMotionWithClaudeBrowser(options: { url: string; directory: string; taskId: string; specs: CarouselMotionSpec[]; headless?: boolean; log?: (message: string) => void }) {
  const log = options.log ?? (() => {}), source = JSON.parse(await readFile(path.join(options.directory, 'responsive-source.json'), 'utf8')) as { packets: Array<{ path: string }> };
  const packets: ObservationPacketV2[] = [];
  for (const ref of source.packets) packets.push(validateObservationPacketV2(JSON.parse(await readFile(path.join(options.directory, ref.path), 'utf8'))));
  const views = [...new Map(packets.map(packet => [packet.snapshot.id, packet.snapshot.viewport])).entries()];
  await mkdir(path.join(options.directory, 'phone-motion'), { recursive: true });
  const rows = [];
  for (const [snapshotId, view] of views) {
    const session = await openClaudeBrowser({ viewport: { width: view.width, height: view.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, headless: options.headless });
    try {
      const { page } = session, regions = [...new Map(packets.filter(packet => packet.snapshot.id === snapshotId).flatMap(packet => packet.regions.map(region => [region.id, { id: region.id, selector: packet.nodes[region.nodeId].selector }]))).values()];
      await waitForPage(page, options.url, log); await page.evaluate('claudeCaptureWarmupV2()'); await settlePage(page, regions, { width: view.width, height: view.height }, log);
      const cdp = await session.context.newCDPSession(page);
      for (const spec of options.specs) {
        await page.evaluate(`document.querySelector(${JSON.stringify(spec.rootSelector)}).scrollIntoView({ block: 'center', behavior: 'instant' })`); await page.waitForTimeout(1200);
        const sample = () => page.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(spec.rootSelector)}), outer = root.querySelector('.owl-stage-outer') || root, items = [...root.querySelectorAll('.owl-item:not(.cloned)')], origin = outer.getBoundingClientRect(); const active = items.findIndex(item => item.classList.contains('active')); return { selector: sceneSelectorV2(root), box: outer.getBoundingClientRect().toJSON(), frame: { viewportWidth: origin.width, activeIndex: Math.max(0, active), items: items.map((item, index) => { const r = item.getBoundingClientRect(); return { index, x: r.x - origin.x, width: r.width }; }).filter(item => item.width > 0) } }; })()`) as Promise<{ selector: string; box: { x: number; y: number; width: number; height: number }; frame: unknown }>;
        const before = await sample(), beforeShot = await page.screenshot({ type: 'png' });
        const y = before.box.y + before.box.height / 2, from = Math.min(view.width - 20, before.box.x + before.box.width * 0.85), to = Math.max(20, before.box.x + before.box.width * 0.15);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
        for (let step = 1; step <= 12; step++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * step / 12, y }] }); await page.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(1500);
        const after = await sample(), afterShot = await page.screenshot({ type: 'png' });
        const node = packets.filter(packet => packet.snapshot.id === snapshotId).flatMap(packet => Object.values(packet.nodes)).find(item => item.selector === before.selector);
        if (!node) throw Error('claude_carousel_source_node_missing:' + spec.componentKey);
        const names = [`phone-motion/${snapshotId}-${spec.componentKey}-before.png`, `phone-motion/${snapshotId}-${spec.componentKey}-after.png`];
        await writeFile(path.join(options.directory, names[0]), beforeShot); await writeFile(path.join(options.directory, names[1]), afterShot);
        rows.push({ componentKey: spec.componentKey, sectionKey: spec.sectionKey, snapshotId, sourceNodeId: node.id, width: view.width, height: view.height, clientWidth: view.clientWidth, observedAt: new Date().toISOString(), before: carouselMotionFrameSchema.parse(before.frame), after: carouselMotionFrameSchema.parse(after.frame), beforeScreenshot: { path: names[0], sha256: sha(beforeShot) }, afterScreenshot: { path: names[1], sha256: sha(afterShot) } });
        log(`[${snapshotId}] ${spec.componentKey} active ${(before.frame as { activeIndex: number }).activeIndex} -> ${(after.frame as { activeIndex: number }).activeIndex}`);
      }
    } finally { await session.close(); }
  }
  const file = { version: 1, kind: 'clonewp-responsive-carousel-motion-source', taskId: options.taskId, sourceUrl: options.url, rows };
  await writeFile(path.join(options.directory, 'carousel-motion-source.json'), JSON.stringify(file, null, 2) + '\n');
  return rows;
}

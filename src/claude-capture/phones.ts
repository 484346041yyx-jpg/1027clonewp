import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sha256, validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { cleanId, scrollAttachedIds, settlePage, waitForPage, geometryHashFromRows, type ClaudeRegionSpec, type Rows } from './observe.js';
import { measureHeaderScroll, type HeaderScrollSpec } from './header-scroll.js';
import { openClaudeBrowser, type ClaudeBrowserOptions } from './session.js';

export const DEFAULT_PHONE_VIEWPORTS = [{ width: 390, height: 844 }, { width: 430, height: 932 }] as const;
export interface ClaudePhoneOptions {
  url: string; outDir: string; prefix: string; taskId: string; regions: ClaudeRegionSpec[];
  viewports?: ReadonlyArray<{ width: number; height: number }>; headless?: boolean; routes?: ClaudeBrowserOptions['routes']; header?: Omit<HeaderScrollSpec, 'selector'>; log?: (message: string) => void;
}

/** Real touch-emulated phone observations in the clonewp-responsive-source shape; no desktop proof is borrowed. */
export async function observePhonesWithClaudeBrowser(options: ClaudePhoneOptions): Promise<{ sourcePath: string; snapshots: Array<{ snapshotId: string; width: number; height: number; screenshot: string; pageHeight: number; mode: 'viewport-segments' | 'tall-viewport' }> }> {
  const log = options.log ?? (() => {}), views = options.viewports ?? DEFAULT_PHONE_VIEWPORTS;
  await mkdir(options.outDir, { recursive: true });
  const write = async (name: string, value: string | Buffer) => { await writeFile(path.join(options.outDir, name), value); return { path: name, sha256: sha256(typeof value === 'string' ? value : new Uint8Array(value)) }; };
  const refs: Array<{ path: string; sha256: string }> = [], snapshots = [];
  const regionArg = options.regions.map(({ id, selector }) => ({ id, selector }));
  for (const view of views) {
    const session = await openClaudeBrowser({ viewport: view, isMobile: true, hasTouch: true, deviceScaleFactor: 1, headless: options.headless, routes: options.routes });
    const snapshotId = `${cleanId(options.prefix)}-${view.width}`, viewportName = `mobile-${view.width}`;
    try {
      const { page } = session;
      log(`[${snapshotId}] phone viewport ${view.width}x${view.height}`);
      await page.clock.install();
      await waitForPage(page, options.url, log);
      await page.evaluate('claudeCaptureWarmupV2()');
      await settlePage(page, regionArg, view, log);
      await page.clock.pauseAt(await page.evaluate('Date.now()') as number + 1500);
      await page.evaluate('claudeCaptureDocumentV2(); window.__claudeCapture.frozenTimers = true; claudeCaptureFreezeAnimationsV2()');
      await page.waitForTimeout(500);
      const capturedAt = new Date().toISOString(), packets: ObservationPacketV2[] = [];
      for (const [order, region] of options.regions.entries()) {
        const transport = JSON.parse(await page.evaluate('collectObservationV2(' + JSON.stringify({ snapshotId, viewportName, capturedAt, idPrefix: region.id, regions: [{ id: region.id, selector: region.selector, role: region.role, order, previousSelector: region.previousSelector }] }) + ')') as string) as { chunks: Array<{ json: string }> };
        for (const chunk of transport.chunks) packets.push(JSON.parse(chunk.json) as ObservationPacketV2);
      }
      const attached = scrollAttachedIds(packets), rowsAt = async () => { const live = await page.evaluate('claudeCaptureGeometryV2(' + JSON.stringify(regionArg) + ')') as { rows: Rows; pageHeight: number }; return { ...live, stable: new Map(live.rows.filter(row => !attached.has(String(row[0]))).map(row => [String(row[0]), JSON.stringify(row)])) }; };
      const base = await rowsAt(), pageHeight = base.pageHeight, imageWidth = await page.evaluate('document.documentElement.clientWidth') as number;
      let raster: Buffer, mode: 'viewport-segments' | 'tall-viewport' = 'viewport-segments';
      try {
        const frames: Array<{ bytes: Buffer; top: number; height: number; crop: number }> = [];
        for (let cursor = 0; cursor < pageHeight;) {
          const target = Math.min(cursor, Math.max(0, pageHeight - view.height));
          await page.evaluate('scrollTo(0, ' + target + ')'); await page.waitForTimeout(250);
          const live = await rowsAt();
          if (live.pageHeight !== pageHeight || live.stable.size !== base.stable.size || [...base.stable].some(([id, row]) => live.stable.get(id) !== row)) throw Error('scroll-dependent layout');
          const height = Math.min(view.height, pageHeight - cursor);
          frames.push({ bytes: await page.screenshot({ type: 'png', animations: 'allow' }), top: cursor, height, crop: cursor - target });
          cursor += height;
        }
        raster = await sharp({ create: { width: imageWidth, height: pageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(await Promise.all(frames.map(async frame => ({ input: await sharp(frame.bytes).extract({ left: 0, top: frame.crop, width: imageWidth, height: frame.height }).png().toBuffer(), left: 0, top: frame.top })))).png().toBuffer();
      } catch (error) {
        if (!/scroll-dependent layout/.test(String(error))) throw error;
        log(`[${snapshotId}] scroll-dependent layout; using one tall viewport raster`);
        await page.evaluate('scrollTo(0, 0)'); await page.waitForTimeout(400);
        await page.setViewportSize({ width: view.width, height: Math.min(pageHeight, 16000) }); await page.waitForTimeout(1200);
        raster = await page.screenshot({ type: 'png', animations: 'allow' }); mode = 'tall-viewport';
        await page.setViewportSize(view);
      }
      const info = await sharp(raster).metadata(), shot = await write(`${snapshotId}.png`, raster);
      if (!info.width || !info.height || info.height < pageHeight - 1) throw Error(`claude_phone_incomplete_page: ${info.width}x${info.height} < ${pageHeight}`);
      const screenshot = { path: shot.path, sha256: shot.sha256, width: info.width, height: info.height };
      if (options.header) {
        const spec = options.regions.find(region => region.id === options.header!.regionId);
        if (!spec) throw Error('claude_header_scroll_region_unknown');
        const experiment = await openClaudeBrowser({ viewport: view, isMobile: true, hasTouch: true, deviceScaleFactor: 1, headless: options.headless, routes: options.routes });
        try {
          const details = await measureHeaderScroll(experiment.page, { ...options.header, selector: spec.selector }, view, options.url, log);
          const packet = packets.find(item => item.regions[0].id === spec.id)!, nodeId = packet.regions[0].nodeId, interactionId = spec.id + '-iscroll';
          packet.interactions[interactionId] = { id: interactionId, nodeId, regionId: spec.id, kind: 'navigation', status: 'observed', details };
          log('[' + snapshotId + '] header scroll ' + JSON.stringify(details));
        } finally { await experiment.close(); }
      }
      for (const packet of packets) {
        packet.snapshot.screenshot = screenshot;
        const valid = validateObservationPacketV2(packet);
        refs.push(await write(`${snapshotId}-${valid.regions[0].id}.json`, JSON.stringify(valid) + '\n'));
      }
      snapshots.push({ snapshotId, width: view.width, height: view.height, screenshot: shot.path, pageHeight, mode });
      log(`[${snapshotId}] ${packets.length} region packets, ${mode}, page ${pageHeight}px`);
    } finally { await session.close(); }
  }
  const source = await write('responsive-source.json', JSON.stringify({ version: 1, kind: 'clonewp-responsive-source', taskId: options.taskId, sourceUrl: options.url, packets: refs }, null, 2) + '\n');
  void geometryHashFromRows;
  return { sourcePath: path.join(options.outDir, source.path), snapshots };
}

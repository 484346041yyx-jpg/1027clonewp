import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { BROWSER_REQUEST_BUDGET_BYTES } from '../replica-v2/browser-diagnostics.js';
import { hashBrowserCaptureFacts, type BrowserCaptureTransaction, type CaptureTransactionState } from '../replica-v2/capture-transaction.js';
import { observationCountsV2, sha256, validateObservationPacketV2, type ObservationManifestV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { validateSceneInventoryV2 } from '../replica-v2/scene-inventory.js';
import { DESKTOP_BROWSER_PROFILE, native44ProfileViewports } from '../native44/profile.js';
import { NATIVE44_BROWSER_OBSERVATION_FILE, native44ObservedGeometryHash, type Native44TransactionalBrowserObservation } from '../native44/source.js';
import { openClaudeBrowser, type ClaudeBrowserOptions, type ClaudeBrowserSession } from './session.js';

export interface ClaudeRegionSpec { id: string; selector: string; role?: 'header' | 'footer' | 'region'; previousSelector?: string }
export interface ClaudeObserveOptions {
  url: string; outDir: string; prefix: string; regions: ClaudeRegionSpec[]; vendorUtilities?: Array<{ selector: string; marker: string }>;
  headless?: boolean; routes?: ClaudeBrowserOptions['routes']; autoplayWatchMs?: number; log?: (message: string) => void;
}
export type Rows = Array<Array<string | number>>;
const bytes = (value: unknown) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
export const cleanId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');

/** Same formula as native44ObservedGeometryHash, applied to live measurement rows. */
export function geometryHashFromRows(rows: Rows): string {
  const unique = new Map<string, unknown>(rows.map(row => [String(row[0]), row]));
  return sha256(JSON.stringify([...unique].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)));
}

interface RawState {
  observedAt: string; document: { key: string; revision: string; styleHash: string };
  viewport: CaptureTransactionState['viewport']; geometry: { rows: Rows; pageHeight: number };
  interaction: unknown; overlays: unknown; fonts: { ready: boolean; failed: number; rows: unknown };
  media: { ready: boolean; failed: number; rows: unknown }; carousels: CaptureTransactionState['carousels']; runningAnimations: number; scroll: { x: number; y: number };
}
function toState(raw: RawState, observedAt: string): CaptureTransactionState {
  return {
    observedAt, document: raw.document, viewport: raw.viewport, geometryHash: geometryHashFromRows(raw.geometry.rows),
    interactionHash: hashBrowserCaptureFacts(raw.interaction), overlayHash: hashBrowserCaptureFacts(raw.overlays),
    fonts: { ready: raw.fonts.ready, failed: raw.fonts.failed, fingerprint: hashBrowserCaptureFacts(raw.fonts.rows), glyphProof: 'unavailable' },
    media: { ready: raw.media.ready, failed: raw.media.failed, fingerprint: hashBrowserCaptureFacts(raw.media.rows) },
    carousels: raw.carousels, runningAnimations: raw.runningAnimations, scroll: raw.scroll,
    coverage: { geometry: raw.geometry.rows.length > 0, visibleMedia: true, carouselInventory: true },
  };
}
export const geometryOf = (url: string, state: CaptureTransactionState, pageHeight: number, hash: string) => {
  const { visualWidth: _w, visualHeight: _h, visualScale: _s, ...viewport } = state.viewport;
  return { url, viewport: { ...viewport, scrollbarWidth: viewport.width - viewport.clientWidth }, scrollX: state.scroll.x, scrollY: state.scroll.y, pageHeight, geometryHash: hash };
};

/** Nodes inside fixed or sticky chains legitimately move with scroll and are excluded from cross-frame stability. */
export function scrollAttachedIds(packets: ObservationPacketV2[]): Set<string> {
  const result = new Set<string>();
  for (const packet of packets) {
    const moves = (id: string, seen = new Set<string>()): boolean => { if (result.has(id)) return true; if (seen.has(id)) return false; seen.add(id); const node = packet.nodes[id]; if (!node) return false; if (['fixed', 'sticky'].includes(packet.layouts[node.layoutId].position)) return true; return node.parentId ? moves(node.parentId, seen) : false; };
    for (const id of Object.keys(packet.nodes)) if (moves(id)) result.add(id);
  }
  return result;
}


/** Lazy loaders and carousels often finish only after a very tall or resized viewport; settle before any evidence is taken. */
export async function settlePage(page: Page, regions: Array<{ id: string; selector: string }>, viewport: { width: number; height: number }, log: (message: string) => void): Promise<void> {
  const height = await page.evaluate('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)') as number;
  await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(height, viewport.height), 16000) }); await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.setViewportSize(viewport); await page.waitForTimeout(800);
  await page.evaluate('claudeCaptureWarmupV2()');
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  let previous = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const hash = geometryHashFromRows(await page.evaluate('claudeCaptureGeometryV2(' + JSON.stringify(regions) + ').rows') as Rows);
    if (hash === previous) return;
    previous = hash; await page.waitForTimeout(900);
  }
  log('page geometry kept changing after settling; continuing so the capture transaction can report it');
}


/** The expanded proof resizes the page; make sure that excursion returns to exactly the same geometry before baseline. */
export async function settleExpandCycles(page: Page, regions: Array<{ id: string; selector: string }>, viewport: { width: number; height: number }, log: (message: string) => void): Promise<void> {
  const rowsHash = async () => geometryHashFromRows(await page.evaluate('claudeCaptureGeometryV2(' + JSON.stringify(regions) + ').rows') as Rows);
  for (let cycle = 0; cycle < 5; cycle++) {
    await page.evaluate('scrollTo(0, 0)'); await page.waitForTimeout(300);
    const before = await rowsHash(), sizes = await page.evaluate('({ clientWidth: document.documentElement.clientWidth, height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) })') as { clientWidth: number; height: number };
    await page.setViewportSize({ width: sizes.clientWidth, height: Math.min(Math.max(sizes.height, viewport.height), 16000) }); await page.waitForTimeout(1200);
    await page.evaluate('claudeCaptureFreezeAnimationsV2()');
    await page.setViewportSize(viewport); await page.waitForTimeout(1200);
    await page.evaluate('claudeCaptureFreezeAnimationsV2(); scrollTo(0, 0)'); await page.waitForTimeout(300);
    if (await rowsHash() === before) { if (cycle) log('geometry stable after ' + (cycle + 1) + ' resize cycles'); return; }
  }
  log('geometry did not return to its baseline after resize cycles; the capture transaction will report the difference');
}

export interface DesktopSnapshotResult { snapshotId: string; viewportName: string; packetFiles: Array<{ path: string; sha256: string; regionIds: string[]; counts: ReturnType<typeof observationCountsV2> }>; screenshotPath: string; screenshotSha256: string }

export async function waitForPage(page: Page, url: string, log: (message: string) => void): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => log('load event not reached before timeout; continuing with actual DOM'));
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => log('network did not become idle; continuing after bounded wait'));
  await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');
}

export async function observeWithClaudeBrowser(options: ClaudeObserveOptions): Promise<{ directory: string; snapshots: DesktopSnapshotResult[]; sidecar: string }> {
  const log = options.log ?? (() => {}), views = native44ProfileViewports(DESKTOP_BROWSER_PROFILE);
  await mkdir(options.outDir, { recursive: true });
  const session: ClaudeBrowserSession = await openClaudeBrowser({ viewport: { width: views[0].width, height: views[0].height }, headless: options.headless, routes: options.routes });
  const manifest: ObservationManifestV2 = { version: 2, kind: 'observation-manifest', sourceUrl: options.url, provenance: { method: 'agent-opened-browser', observer: 'claude_browser', browser: session.browserKind }, packets: [], screenshots: [], sceneInventories: [] };
  const binding: Native44TransactionalBrowserObservation = { version: 3, replicationProfile: DESKTOP_BROWSER_PROFILE, renderEvidenceBySnapshot: {}, browserObservation: { method: 'agent-opened-browser', tool: 'claude_browser', browserId: session.binding.browserId, tabId: session.binding.tabId, frameId: session.binding.frameId, requestedUrl: options.url, actualUrl: options.url, observedAt: session.openedAt, captures: [] } };
  const write = async (name: string, value: string | Buffer) => { await writeFile(path.join(options.outDir, name), value); return { path: name, sha256: sha256(typeof value === 'string' ? value : new Uint8Array(value)) }; };
  const snapshots: DesktopSnapshotResult[] = [];
  try {
    const { page } = session;
    await page.clock.install();
    for (const view of views) {
      const snapshotId = `${cleanId(options.prefix)}-${view.width}`, viewportName = view.width === 1920 ? 'desktop' : 'desktop-narrow';
      log(`[${snapshotId}] viewport ${view.width}x${view.height}`);
      await page.setViewportSize({ width: view.width, height: view.height });
      await waitForPage(page, options.url, log);
      await page.evaluate('claudeCaptureWarmupV2()');
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await settlePage(page, options.regions.map(({ id, selector }) => ({ id, selector })), { width: view.width, height: view.height }, log);
      const owners = await page.evaluate('claudeCaptureCarouselOwnersV2()') as Array<{ id: string; engine: string; selector: string }>;
      // Observe real autoplay before the observer freezes page timers; the freeze is disclosed in the capture notes.
      const watchMs = options.autoplayWatchMs ?? 7000, autoplay: Record<string, boolean> = {};
      if (owners.length && watchMs > 0) {
        const snapshot = async () => page.evaluate(`JSON.stringify(${JSON.stringify(owners)}.map(owner => { const state = claudeCaptureCarouselStateV2(owner); return [owner.id, state.logicalIndex, state.transform]; }))`) as Promise<string>;
        const first = JSON.parse(await snapshot()) as Array<[string, number, string]>; const changed = new Set<string>();
        for (let waited = 0; waited < watchMs; waited += 700) { await page.waitForTimeout(700); for (const [id, index, transform] of JSON.parse(await snapshot()) as Array<[string, number, string]>) { const before = first.find(row => row[0] === id)!; if (before[1] !== index || before[2] !== transform) changed.add(id); } }
        for (const owner of owners) autoplay[owner.id] = changed.has(owner.id);
      }
      const nowFake = await page.evaluate('Date.now()') as number;
      await page.clock.pauseAt(nowFake + 1500);
      await page.evaluate(`claudeCaptureDocumentV2(); window.__claudeCapture.frozenTimers = true; window.__claudeCapture.autoplayObserved = ${JSON.stringify(autoplay)}; claudeCaptureFreezeAnimationsV2()`).then(value => log(`[${snapshotId}] animations settled ${JSON.stringify(value)}`));
      await page.waitForTimeout(500);
      await settleExpandCycles(page, options.regions.map(({ id, selector }) => ({ id, selector })), { width: view.width, height: view.height }, log);
      const startedAt = new Date(), attempts: BrowserCaptureTransaction['attempts'] = [];
      const stageBinding = session.binding;
      const regionArg = options.regions.map(({ id, selector }) => ({ id, selector }));
      const probe = async (): Promise<{ state: CaptureTransactionState; rows: Rows; pageHeight: number; request: number; response: number; startedAt: string; finishedAt: string }> => {
        const begin = new Date().toISOString(), expression = `claudeCaptureStateV2(${JSON.stringify({ regions: regionArg, carouselOwners: owners })})`;
        const raw = await page.evaluate(expression) as RawState, end = new Date().toISOString();
        return { state: toState(raw, end), rows: raw.geometry.rows, pageHeight: raw.geometry.pageHeight, request: bytes(expression), response: bytes(raw), startedAt: begin, finishedAt: end };
      };
      const envelope = (begin: string, end: string, request: number, response: number) => ({ startedAt: begin, finishedAt: end, binding: stageBinding, requestBytes: request, responseBytes: response });

      // url
      let begin = new Date().toISOString(); const urlExpression = 'location.href'; const actualUrl = await page.evaluate(urlExpression) as string;
      attempts.push({ ...envelope(begin, new Date().toISOString(), bytes(urlExpression), bytes(actualUrl)), stage: 'url', outcome: 'ok', data: { actualUrl } });
      // dom
      begin = new Date().toISOString(); const domExpression = '({ href: location.href, readyState: document.readyState, bodyPresent: !!document.body })';
      const dom = await page.evaluate(domExpression) as { href: string; readyState: 'loading' | 'interactive' | 'complete'; bodyPresent: boolean };
      const baseline = await probe();
      attempts.push({ ...envelope(begin, new Date().toISOString(), bytes(domExpression), bytes(dom)), stage: 'dom', outcome: 'ok', data: { actualUrl: dom.href, document: baseline.state.document, readyState: dom.readyState, bodyPresent: dom.bodyPresent } });
      // baseline
      const baselineProbe = await probe();
      attempts.push({ ...envelope(baselineProbe.startedAt, baselineProbe.finishedAt, baselineProbe.request, baselineProbe.response), stage: 'baseline', outcome: 'ok', data: { state: baselineProbe.state } });
      // layout
      const layoutProbe = await probe();
      attempts.push({ ...envelope(layoutProbe.startedAt, layoutProbe.finishedAt, layoutProbe.request, layoutProbe.response), stage: 'layout', outcome: 'ok', data: { state: layoutProbe.state } });
      const expectedDocument = { ...layoutProbe.state.document }, expectedViewport = { ...layoutProbe.state.viewport };

      // collector: one call per region, ids prefixed by region id exactly like the Codex-captured packets
      const capturedAt = new Date().toISOString(), packets: ObservationPacketV2[] = [];
      for (const [order, region] of options.regions.entries()) {
        const transport = JSON.parse(await page.evaluate(`collectObservationV2(${JSON.stringify({ snapshotId, viewportName, capturedAt, idPrefix: region.id, regions: [{ id: region.id, selector: region.selector, role: region.role, order, previousSelector: region.previousSelector }] })})`) as string) as { chunks: Array<{ json: string }> };
        for (const chunk of transport.chunks) packets.push(JSON.parse(chunk.json) as ObservationPacketV2);
      }
      const inventory = validateSceneInventoryV2(JSON.parse(await page.evaluate(`collectObservationV2(${JSON.stringify({ inventoryOnly: true, snapshotId, viewportName, capturedAt, inventoryRegions: regionArg, ...(options.vendorUtilities ? { vendorUtilities: options.vendorUtilities } : {}) })})`) as string));
      const packetGeometryHash = native44ObservedGeometryHash(packets, snapshotId);
      if (packetGeometryHash !== layoutProbe.state.geometryHash) { const live = new Map(layoutProbe.rows.map(row => [String(row[0]), JSON.stringify(row)])), differing: string[] = []; for (const packet of packets) for (const node of Object.values(packet.nodes)) { const layout = packet.layouts[node.layoutId], rect = layout.captureGeometry?.rect ?? layout.rect, content = layout.captureGeometry?.contentRect ?? layout.contentRect, row = JSON.stringify([node.id, rect.x, rect.y, rect.width, rect.height, content.x, content.y, content.width, content.height, layout.display, layout.position]); if (live.get(node.id) !== row && differing.length < 4) differing.push(row + ' <> ' + live.get(node.id)); } throw Error(`claude_capture_geometry_mismatch: live probe and observed packets disagree for ${snapshotId}: ${differing.join(' | ')}`); }

      // screenshot: normal viewport rasters composed in scroll order; pages whose layout depends on scroll (JS-fixed headers)
      // use the contract's equivalent-expanded-viewport proof instead of pretending scrolled frames share one layout.
      const attached = scrollAttachedIds(packets), stable = (rows: Rows) => new Map(rows.filter(row => !attached.has(String(row[0]))).map(row => [String(row[0]), JSON.stringify(row)]));
      const baselineRows = stable(layoutProbe.rows), viewportHeight = expectedViewport.height, imageWidth = expectedViewport.clientWidth;
      const sharp = (await import('sharp')).default;
      const sides = async (shotBegin: Awaited<ReturnType<typeof probe>>) => {
        if (shotBegin.state.geometryHash !== packetGeometryHash || shotBegin.state.scroll.y !== 0) throw Error('claude_capture_layout_changed: geometry moved before the screenshot for ' + snapshotId);
      };
      const finish = async (shotBegin: Awaited<ReturnType<typeof probe>>) => {
        await page.evaluate('scrollTo(0, 0)'); await page.waitForTimeout(400);
        const shotAfter = await probe();
        for (const [label, side] of [['before', shotBegin], ['after', shotAfter]] as const) if (side.state.geometryHash !== packetGeometryHash || side.state.scroll.y !== 0 || side.state.overlayHash !== layoutProbe.state.overlayHash || side.state.viewport.width !== expectedViewport.width) { const was = new Map(layoutProbe.rows.map(row => [String(row[0]), JSON.stringify(row)])), moved = side.rows.map(row => [String(row[0]), JSON.stringify(row)] as const).filter(([id, row]) => was.get(id) !== row).slice(0, 3).map(([id, row]) => was.get(id) + ' => ' + row); throw Error('claude_capture_layout_changed: differ ' + label + ' the screenshot for ' + snapshotId + ' (geometry ' + (side.state.geometryHash === packetGeometryHash) + ', scrollY ' + side.state.scroll.y + ', overlays ' + (side.state.overlayHash === layoutProbe.state.overlayHash) + ', width ' + side.state.viewport.width + '/' + expectedViewport.width + '): ' + moved.join(' | ')); }
        return shotAfter;
      };
      const segmented = async () => {
        const shotBegin = await probe(); await sides(shotBegin);
        const pageHeight = shotBegin.pageHeight, frames: Array<{ file: { path: string; sha256: string }; bytes: Buffer; documentTop: number; documentHeight: number; cropTop: number; screenshotTop: number; scrollY: number }> = [];
        for (let cursor = 0, index = 0; cursor < pageHeight; index++) {
          const target = Math.min(cursor, Math.max(0, pageHeight - viewportHeight));
          await page.evaluate('scrollTo(0, ' + target + ')'); await page.waitForTimeout(250);
          const before = await probe(), raster = await page.screenshot({ type: 'png', animations: 'allow' }), after = await probe();
          for (const [label, side] of [['before', before], ['after', after]] as const) {
            if (side.state.scroll.y !== target || side.pageHeight !== pageHeight || side.state.scroll.x !== 0) throw Error('claude_capture_scroll_unstable: ' + snapshotId + ' frame ' + index + ' scroll ' + side.state.scroll.x + ',' + side.state.scroll.y + ' (wanted 0,' + target + ') pageHeight ' + side.pageHeight + ' (was ' + pageHeight + ')');
            const now = stable(side.rows); if (now.size !== baselineRows.size) throw Error('claude_capture_layout_changed: node inventory changed while scrolling ' + snapshotId);
            for (const [id, row] of baselineRows) if (now.get(id) !== row) throw Error('claude_capture_layout_changed: ' + id + ' moved ' + label + ' frame ' + index + ' of ' + snapshotId + ': ' + row + ' => ' + now.get(id));
          }
          const documentHeight = Math.min(viewportHeight, pageHeight - cursor), file = await write(snapshotId + '-viewport-' + index + '.png', raster);
          frames.push({ file, bytes: raster, documentTop: cursor, documentHeight, cropTop: cursor - target, screenshotTop: target, scrollY: target });
          cursor += documentHeight;
        }
        const shotAfter = await finish(shotBegin);
        const composite = await sharp({ create: { width: imageWidth, height: pageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(await Promise.all(frames.map(async frame => ({ input: await sharp(frame.bytes).extract({ left: 0, top: frame.cropTop, width: imageWidth, height: frame.documentHeight }).png().toBuffer(), left: 0, top: frame.documentTop })))).png().toBuffer();
        const geometry = geometryOf(options.url, layoutProbe.state, pageHeight, packetGeometryHash);
        const segments = frames.map(frame => ({ screenshot: frame.file, documentTop: frame.documentTop, documentHeight: frame.documentHeight, cropTop: frame.cropTop, screenshotTop: frame.screenshotTop, before: { ...geometry, scrollY: frame.scrollY }, after: { ...geometry, scrollY: frame.scrollY } }));
        return { mode: 'viewport-segments' as const, shotBegin, shotAfter, pageHeight, raster: composite, segments, expandedCapture: undefined };
      };
      const expanded = async () => {
        await page.evaluate('scrollTo(0, 0)'); await page.waitForTimeout(500);
        const shotBegin = await probe(); await sides(shotBegin);
        const pageHeight = shotBegin.pageHeight;
        await page.setViewportSize({ width: imageWidth, height: pageHeight }); await page.waitForTimeout(1200);
        await page.evaluate('claudeCaptureDocumentV2(); window.__claudeCapture.frozenTimers = true; claudeCaptureFreezeAnimationsV2()'); await page.evaluate('scrollTo(0, 0)'); await page.waitForTimeout(300);
        const auxAt = new Date().toISOString(), auxPackets: ObservationPacketV2[] = [];
        for (const [order, region] of options.regions.entries()) {
          const transport = JSON.parse(await page.evaluate('collectObservationV2(' + JSON.stringify({ snapshotId, viewportName, capturedAt: auxAt, idPrefix: region.id, regions: [{ id: region.id, selector: region.selector, role: region.role, order, previousSelector: region.previousSelector }] }) + ')') as string) as { chunks: Array<{ json: string }> };
          for (const chunk of transport.chunks) auxPackets.push(JSON.parse(chunk.json) as ObservationPacketV2);
        }
        const raster = await page.screenshot({ type: 'png', animations: 'allow' }), tallState = await page.evaluate('({ width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, devicePixelRatio, pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), scrollX, scrollY })') as { width: number; height: number; clientWidth: number; devicePixelRatio: number; pageHeight: number; scrollX: number; scrollY: number };
        await page.setViewportSize({ width: expectedViewport.width, height: expectedViewport.height }); await page.waitForTimeout(1200);
        const shotAfter = await finish(shotBegin);
        if (tallState.pageHeight !== pageHeight || tallState.scrollY !== 0) throw Error('claude_capture_expanded_height_mismatch: expanded page ' + tallState.pageHeight + ' vs ' + pageHeight);
        const auxHash = native44ObservedGeometryHash(auxPackets, snapshotId), tallGeometry = { url: options.url, viewport: { width: tallState.width, height: tallState.height, clientWidth: tallState.clientWidth, scrollbarWidth: tallState.width - tallState.clientWidth, devicePixelRatio: tallState.devicePixelRatio }, scrollX: 0, scrollY: 0, pageHeight, geometryHash: auxHash };
        return { mode: 'equivalent-expanded-viewport' as const, shotBegin, shotAfter, pageHeight, raster, segments: undefined, expandedCapture: { tallGeometry, auxPackets } };
      };
      let outcome: Awaited<ReturnType<typeof segmented>> | Awaited<ReturnType<typeof expanded>>;
      try { outcome = await segmented(); }
      catch (error) {
        if (!/claude_capture_(scroll_unstable|layout_changed)/.test(String(error))) throw error;
        log('[' + snapshotId + '] scroll-dependent layout detected, using expanded viewport proof: ' + String(error).slice(0, 220));
        outcome = await expanded();
      }
      const { shotBegin, shotAfter, pageHeight, segments, expandedCapture } = outcome;
      const info = await sharp(outcome.raster).metadata(), screenshotFile = await write(snapshotId + '.png', outcome.raster);
      if (info.width !== imageWidth || info.height !== pageHeight) throw Error('claude_capture_incomplete_page: screenshot ' + info.width + 'x' + info.height + ' does not cover ' + imageWidth + 'x' + pageHeight);
      const geometry = geometryOf(options.url, layoutProbe.state, pageHeight, packetGeometryHash);
      const coverage = await write(snapshotId + '-coverage.json', JSON.stringify({ version: 1, kind: 'native44-capture-coverage', snapshotId, screenshotHash: screenshotFile.sha256, captureMode: outcome.mode, geometryHash: packetGeometryHash, pageHeight, complete: true, seamless: true, layoutPreserved: true }));
      attempts.push({ ...envelope(shotBegin.startedAt, shotAfter.finishedAt, shotBegin.request + shotAfter.request, shotBegin.response + shotAfter.response), stage: 'screenshot', outcome: 'ok', data: { before: shotBegin.state, after: shotAfter.state, artifact: { sha256: screenshotFile.sha256, width: info.width, height: info.height, mode: 'full-page', fullPageReceipt: { sha256: coverage.sha256, complete: true, seamless: true, layoutPreserved: true } } } });

      // packets bound to the actual screenshot
      const screenshot = { path: screenshotFile.path, sha256: screenshotFile.sha256, width: info.width, height: info.height };
      const packetRows: DesktopSnapshotResult['packetFiles'] = [];
      const expandedFiles: Array<{ path: string; sha256: string }> = [];
      for (const packet of expandedCapture?.auxPackets ?? []) { packet.snapshot.screenshot = screenshot; const valid = validateObservationPacketV2(packet); expandedFiles.push(await write(snapshotId + '-expanded-' + valid.regions[0].id + '.json', JSON.stringify(valid) + '\n')); }
      for (const packet of packets) {
        packet.snapshot.screenshot = screenshot;
        const valid = validateObservationPacketV2(packet), name = `${snapshotId}-${valid.regions[0].id}.json`, json = JSON.stringify(valid) + '\n', ref = await write(name, json);
        manifest.packets.push({ path: ref.path, sha256: ref.sha256, snapshotId, regionIds: valid.regions.map(region => region.id), counts: observationCountsV2(valid), dependencies: [] });
        packetRows.push({ path: ref.path, sha256: ref.sha256, regionIds: valid.regions.map(region => region.id), counts: observationCountsV2(valid) });
      }
      const sceneRef = await write(`${snapshotId}-scene.json`, JSON.stringify(inventory) + '\n');
      manifest.sceneInventories!.push({ path: sceneRef.path, sha256: sceneRef.sha256, snapshotId });
      manifest.screenshots.push({ path: screenshot.path, sha256: screenshot.sha256, snapshotId });

      // render evidence (bound to the screenshot hash), then restore
      const nodeIds = new Set<string>(), nodes: Array<{ id: string; selector: string }> = [], usages: Array<{ nodeId: string; kind: string; attribute?: string; resourceUrl: string }> = [], interactions: Array<{ nodeId: string }> = [];
      for (const packet of packets) {
        for (const usage of Object.values(packet.usages)) { const resource = packet.resources[usage.resourceId]; nodeIds.add(usage.nodeId); usages.push({ nodeId: usage.nodeId, kind: usage.kind, attribute: usage.attribute, resourceUrl: resource.url }); }
        for (const interaction of Object.values(packet.interactions)) if (interaction.kind === 'carousel') { nodeIds.add(interaction.nodeId); interactions.push({ nodeId: interaction.nodeId }); }
        for (const id of nodeIds) if (packet.nodes[id] && !nodes.some(node => node.id === id)) nodes.push({ id, selector: packet.nodes[id].selector });
      }
      const renderRaw = JSON.parse(await page.evaluate(`collectSourceRenderEvidenceV2(${JSON.stringify({ taskId: options.prefix, snapshotId, sourceUrl: options.url, screenshotHash: screenshot.sha256, nodes, usages, interactions })})`) as string) as Record<string, unknown> & { gaps: unknown[] };
      const renderAt = new Date().toISOString();
      const render = { ...renderRaw, capturedAt: renderAt, document: expectedDocument, observerNotes: { timersFrozenByObserver: true, autoplayObserved: autoplay } };
      const renderRef = await write(`${snapshotId}-render.json`, JSON.stringify(render));
      binding.renderEvidenceBySnapshot[snapshotId] = renderRef;
      await page.evaluate('scrollTo(0, 0)');
      const restore = await probe();
      attempts.push({ ...envelope(restore.startedAt, restore.finishedAt, restore.request, restore.response), stage: 'restore', outcome: 'ok', data: { state: restore.state } });

      const transaction: BrowserCaptureTransaction = {
        version: 2, kind: 'browser-capture-transaction', startedAt: startedAt.toISOString(), binding: stageBinding,
        expected: { url: options.url, document: expectedDocument, viewport: expectedViewport, carouselOwners: owners.map(owner => owner.id), fontProof: 'loaded-css' },
        policy: { maxAgeMs: 600_000, maxCaptureSpanMs: 60_000, requestBudgetBytes: BROWSER_REQUEST_BUDGET_BYTES, responseBudgetBytes: 12 * 1024 * 1024 },
        attempts,
      };
      const receipt = await write(`${snapshotId}-transaction.json`, JSON.stringify(transaction));
      binding.browserObservation.captures.push({ snapshotId, packetHashes: packetRows.map(row => row.sha256), screenshotHash: screenshot.sha256, captureMode: outcome.mode, before: geometry, after: structuredClone(geometry), ...(segments ? { segments } : {}), ...(expandedCapture ? { expandedCapture: { before: expandedCapture.tallGeometry, after: structuredClone(expandedCapture.tallGeometry), packets: expandedFiles } } : {}), captureTransaction: { receipt, document: expectedDocument, fullPageCoverage: coverage } });
      snapshots.push({ snapshotId, viewportName, packetFiles: packetRows, screenshotPath: screenshot.path, screenshotSha256: screenshot.sha256 });
      await page.clock.resume();
      await page.evaluate('window.__claudeCapture.frozenTimers = false');
    }
    await write('observation-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    await write(NATIVE44_BROWSER_OBSERVATION_FILE, JSON.stringify(binding, null, 2) + '\n');
    await write('claude-session.json', JSON.stringify({ version: 1, kind: 'claude-browser-session', openedAt: session.openedAt, browser: session.browserKind, browserVersion: session.browserVersion, userAgent: session.userAgent, headless: options.headless ?? process.env.CLONEWP_CLAUDE_HEADED !== '1', notes: ['Observer froze page timers and animations after warm-up; endless animations were paused, finite ones finished.', 'Source facts and pixels come from this agent-opened browser, not a user-opened tab.'] }, null, 2) + '\n');
    return { directory: options.outDir, snapshots, sidecar: path.join(options.outDir, NATIVE44_BROWSER_OBSERVATION_FILE) };
  } finally { await session.close(); }
}

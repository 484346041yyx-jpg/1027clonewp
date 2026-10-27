import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readObservationDirectoryV2, sha256, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { SourceHoverReviewSchema, type SourceHoverReview } from '../replica-v2/hover-review.js';
import { scrollAttachedIds, settlePage, waitForPage } from './observe.js';
import { openClaudeBrowser } from './session.js';

export interface ClaudeHoverOptions {
  url: string; observedDir: string; outDir?: string; snapshotId?: string; perRule?: number;
  extraTriggers?: Array<{ snapshotId: string; triggerNodeId: string; affectedSelectors?: string[] }>; headless?: boolean; log?: (message: string) => void;
}

/** Real pointer cycles (default, hover, restored) for one representative of every declared CSS hover rule. */
export async function observeHoverWithClaudeBrowser(options: ClaudeHoverOptions): Promise<{ reviewPath: string; rows: number; skipped: string[] }> {
  const log = options.log ?? (() => {}), observation = await readObservationDirectoryV2(options.observedDir, options.url), outDir = options.outDir ?? options.observedDir;
  await mkdir(outDir, { recursive: true });
  const snapshots = [...new Map(observation.packets.map(packet => [packet.snapshot.id, packet.snapshot])).values()].sort((a, b) => b.viewport.width - a.viewport.width);
  const snapshot = snapshots.find(item => item.id === options.snapshotId) ?? snapshots[0];
  const packets = observation.packets.filter(packet => packet.snapshot.id === snapshot.id), attached = scrollAttachedIds(packets);
  const nodeOf = new Map<string, { packet: ObservationPacketV2; id: string }>();
  for (const packet of packets) for (const id of Object.keys(packet.nodes)) nodeOf.set(id, { packet, id });
  const byRule = new Map<string, Array<{ id: string; area: number }>>();
  for (const packet of packets.filter(item => item.regions.every(region => region.role !== 'header'))) for (const interaction of Object.values(packet.interactions)) {
    if (interaction.kind !== 'hover' || interaction.details.source !== 'css-hover-selector') continue;
    const node = packet.nodes[interaction.nodeId], layout = packet.layouts[node.layoutId], rule = String(interaction.details.selector);
    if (!node.visible || attached.has(node.id) || layout.rect.width < 12 || layout.rect.height < 8) continue;
    const list = byRule.get(rule) ?? []; list.push({ id: node.id, area: layout.rect.width * layout.rect.height }); byRule.set(rule, list);
  }
  const picks: Array<{ snapshotId: string; id: string; rule?: string; affected: string[] }> = [];
  for (const [rule, list] of byRule) for (const item of list.sort((a, b) => b.area - a.area).slice(0, Math.max(1, options.perRule ?? 14))) picks.push({ snapshotId: snapshot.id, id: item.id, rule, affected: [] });
  for (const extra of options.extraTriggers ?? []) picks.push({ snapshotId: extra.snapshotId, id: extra.triggerNodeId, affected: extra.affectedSelectors ?? [] });
  const regions = [...new Map(packets.flatMap(packet => packet.regions.map(region => [region.id, { id: region.id, selector: packet.nodes[region.nodeId].selector }]))).values()];
  const session = await openClaudeBrowser({ viewport: { width: snapshot.viewport.width, height: snapshot.viewport.height }, headless: options.headless });
  const rows: SourceHoverReview['rows'] = [], skipped: string[] = [], covered = new Set<string>();
  try {
    const { page } = session;
    await waitForPage(page, options.url, log);
    await page.evaluate('claudeCaptureWarmupV2()');
    await settlePage(page, regions, { width: snapshot.viewport.width, height: snapshot.viewport.height }, log);
    const write = async (name: string, value: string | Buffer) => { await writeFile(path.join(outDir, name), value); return { path: name, sha256: sha256(typeof value === 'string' ? value : new Uint8Array(value)) }; };
    for (const [index, pick] of picks.entries()) {
      if (pick.rule && covered.has(pick.rule)) continue;
      const source = nodeOf.get(pick.id), selector = source?.packet.nodes[pick.id].selector;
      if (!selector) { skipped.push(`${pick.id}: unknown node`); continue; }
      const locate = () => page.evaluate(`(() => { const found = document.querySelectorAll(${JSON.stringify(selector)}); if (found.length !== 1) return { unique: found.length }; found[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); const box = found[0].getBoundingClientRect(); const points = []; for (const fy of [0.5, 0.3, 0.7]) for (const fx of [0.5, 0.3, 0.7]) { const x = box.left + box.width * fx, y = box.top + box.height * fy; const hit = document.elementFromPoint(x, y); if (hit && (hit === found[0] || found[0].contains(hit))) points.push([x, y]); } return { unique: 1, points, inView: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= document.documentElement.clientWidth }; })()`) as Promise<{ unique: number; points?: number[][]; inView?: boolean }>;
      await locate(); await page.waitForTimeout(600);
      const probe = await locate();
      if (probe.unique !== 1 || !probe.points?.length || !probe.inView) { skipped.push(`${pick.id}: ${probe.unique !== 1 ? 'selector not unique' : 'no reachable pointer point'}`); continue; }
      const [x, y] = probe.points[0], neutral = [2, snapshot.viewport.height - 2] as const, name = `hover-${cleanName(snapshot.id)}-${index}`;
      const list: unknown[] = [];
      let failed = '';
      for (const stage of ['default', 'hover', 'restored'] as const) {
        if (stage === 'hover') await page.mouse.move(x, y, { steps: 6 }); else await page.mouse.move(neutral[0], neutral[1], { steps: 6 });
        await page.waitForTimeout(650);
        const raster = await page.screenshot({ type: 'png', animations: 'allow' }), file = await write(`${name}-${stage}.png`, raster);
        let state: unknown; try { state = await page.evaluate(`collectHoverStateV2(${JSON.stringify({ sourceUrl: options.url, triggerSelector: selector, affectedSelectors: pick.affected, stage, screenshotHash: file.sha256 })})`); } catch (error) { failed = stage + ': ' + String(error).split(String.fromCharCode(10))[0].slice(0, 120); break; }
        list.push({ state, screenshot: file });
      }
      if (failed) { skipped.push(pick.id + ': ' + failed); continue; }
      rows.push({ snapshotId: pick.snapshotId, triggerNodeId: pick.id, captures: list as never });
      if (pick.rule) covered.add(pick.rule);
      log(`[hover] ${pick.rule ?? 'extra'} -> ${pick.id}`);
    }
  } finally { await session.close(); }
  const review = SourceHoverReviewSchema.parse({ version: 1, kind: 'source-hover-review', sourceUrl: options.url, rows });
  const reviewFile = path.join(outDir, 'hover-review.json');
  await writeFile(reviewFile, JSON.stringify(review, null, 2) + '\n');
  return { reviewPath: reviewFile, rows: rows.length, skipped };
}
const cleanName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');

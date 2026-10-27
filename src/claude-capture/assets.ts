import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { assertPublicUrl } from '../capture/url-safety.js';
import { validateObservationPacketV2 } from '../replica-v2/observation.js';
import { openClaudeBrowser } from './session.js';

export interface ClaudeAssetOptions { url: string; directory: string; packetFiles: string[]; headless?: boolean; log?: (message: string) => void }

/** Downloads every packet-referenced image through the browser context that observed the page. */
export async function exportSourceAssetsWithClaudeBrowser(options: ClaudeAssetOptions): Promise<{ assets: number; missing: Array<{ sourceUrl: string; reason: string }> }> {
  const log = options.log ?? (() => {}), urls = new Map<string, Set<string>>();
  for (const file of options.packetFiles) {
    const packet = validateObservationPacketV2(JSON.parse(await readFile(path.resolve(options.directory, file), 'utf8')));
    for (const resource of Object.values(packet.resources)) {
      if (resource.inline || !/^https?:/i.test(resource.url) || !['image', 'background', 'icon'].includes(resource.kind)) continue;
      urls.set(resource.url, (urls.get(resource.url) ?? new Set()).add(packet.snapshot.id));
    }
  }
  await mkdir(path.join(options.directory, 'assets'), { recursive: true });
  const session = await openClaudeBrowser({ viewport: { width: 1920, height: 1080 }, headless: options.headless });
  const assets: Array<{ key: string; localPath: string; sourceUrl: string; sha256: string; mediaType: string }> = [], inventory: Array<Record<string, unknown>> = [], missing: Array<{ sourceUrl: string; reason: string }> = [];
  try {
    await session.page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    for (const [url, snapshots] of urls) {
      try {
        await assertPublicUrl(url);
        const response = await session.context.request.get(url, { headers: { referer: options.url }, timeout: 45_000 });
        if (!response.ok()) throw Error(`HTTP ${response.status()}`);
        const bytes = Buffer.from(await response.body());
        if (!bytes.length || bytes.length > 25_000_000) throw Error('asset size');
        const metadata = await sharp(bytes, { limitInputPixels: 200_000_000, animated: false }).metadata();
        if (!metadata.format || !metadata.width || !metadata.height) throw Error('undecodable image');
        const sha256 = createHash('sha256').update(bytes).digest('hex'), id = sha256.slice(0, 16), extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
        const localPath = `assets/${id}.${extension}`, mediaType = metadata.format === 'svg' ? 'image/svg+xml' : `image/${metadata.format}`;
        await writeFile(path.join(options.directory, localPath), bytes);
        if (!assets.some(asset => asset.sha256 === sha256 && asset.sourceUrl === url)) assets.push({ key: `asset_${id}`, localPath, sourceUrl: url, sha256, mediaType });
        inventory.push({ sourceUrl: url, localPath, sha256, mediaType, width: metadata.width, height: metadata.height, bytes: bytes.length, snapshots: [...snapshots] });
      } catch (error) { missing.push({ sourceUrl: url, reason: String(error instanceof Error ? error.message : error).slice(0, 160) }); }
    }
    log(`[assets] ${assets.length} saved, ${missing.length} missing of ${urls.size}`);
  } finally { await session.close(); }
  await writeFile(path.join(options.directory, 'body-assets.json'), JSON.stringify(assets, null, 2) + '\n');
  await writeFile(path.join(options.directory, 'local-asset-inventory.json'), JSON.stringify({ version: 1, kind: 'claude-browser-asset-inventory', sourceUrl: options.url, assets: inventory, missing }, null, 2) + '\n');
  return { assets: assets.length, missing };
}

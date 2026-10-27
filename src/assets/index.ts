import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { assertPublicUrl } from '../capture/url-safety.js';
import type { SourceAsset } from '../capture/types.js';

export interface AssetEntry extends SourceAsset {
  sourceUrl: string;
  finalUrl?: string;
  status: 'downloaded' | 'duplicate' | 'failed';
  path?: string;
  sha256?: string;
  originalSha256?: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
  converted?: string;
  error?: string;
}
export interface AssetManifest {
  version: 1;
  entries: AssetEntry[];
  totalBytes: number;
  downloaded: number;
  failed: number;
  warnings: string[];
  artifactPath: string;
}
export interface DownloadOptions {
  assets: SourceAsset[];
  runDir: string;
  maxBytes?: number;
  maxTotalBytes?: number;
  maxAssets?: number;
  timeoutMs?: number;
  allowLocalForTests?: boolean;
  deadlineAt?: number;
}

interface Resource { bytes: Buffer; url: string; contentType: string }
async function fetchResource(url: string, options: DownloadOptions, redirects = 0): Promise<Resource> {
  if (options.deadlineAt && Date.now() >= options.deadlineAt) throw new Error('Task deadline exhausted during resource download');
  const maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
  if (url.startsWith('data:')) {
    const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i.exec(url);
    if (!match) throw new Error('Only inline image data URLs are supported');
    if (match[3].length > maxBytes * 1.5) throw new Error('Inline image exceeds byte limit');
    const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Inline image is empty or exceeds byte limit');
    return { bytes, url: 'inline-image', contentType: match[1].toLowerCase() };
  }
  const safe = await assertPublicUrl(url, options);
  if (redirects > 5) throw new Error('Resource exceeds redirect limit');
  return new Promise<Resource>((resolve, reject) => {
    const transport = safe.url.protocol === 'https:' ? https : http;
    const address = safe.addresses.find(item => item.family === 4) ?? safe.addresses[0];
    // Pin the validated address at connection time, so DNS rebinding cannot reach private hosts.
    const request = transport.request(safe.url, { method: 'GET', headers: { 'User-Agent': 'cloneWP/0.1 (source asset verification)', Accept: '*/*' }, lookup: ((_hostname: string, lookupOptions: any, callback: (...args: any[]) => void) => lookupOptions.all ? callback(null, [address]) : callback(null, address.address, address.family)) as any }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const destination = new URL(response.headers.location, safe.url).href;
        fetchResource(destination, options, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`Resource returned HTTP ${status}`)); return; }
      const declaredLength = Number(response.headers['content-length'] ?? 0);
      if (declaredLength > maxBytes) { response.destroy(); reject(new Error(`Resource exceeds ${maxBytes} byte limit`)); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); request.destroy(); reject(new Error(`Resource exceeds ${maxBytes} byte limit`)); }
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (!size) reject(new Error('Resource is empty'));
        else resolve({ bytes: Buffer.concat(chunks), url: safe.url.href, contentType: String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() });
      });
      response.on('error', reject);
    });
    const timeLimit = Math.min(options.timeoutMs ?? 30000, options.deadlineAt ? Math.max(1, options.deadlineAt - Date.now()) : Infinity);
    const totalTimer = setTimeout(() => request.destroy(new Error('Resource download deadline exceeded')), timeLimit);
    totalTimer.unref();
    request.on('close', () => clearTimeout(totalTimer));
    request.setTimeout(timeLimit, () => request.destroy(new Error('Resource download timeout')));
    request.on('error', reject);
    request.end();
  });
}

function fontType(bytes: Buffer): { mime: string; extension: string } | undefined {
  const head = bytes.subarray(0, 4).toString('latin1');
  if (head === 'wOFF') return { mime: 'font/woff', extension: 'woff' };
  if (head === 'wOF2') return { mime: 'font/woff2', extension: 'woff2' };
  if (head === 'OTTO') return { mime: 'font/otf', extension: 'otf' };
  if (bytes.readUInt32BE(0) === 0x00010000 || head === 'true') return { mime: 'font/ttf', extension: 'ttf' };
  return undefined;
}

export async function downloadAssets(options: DownloadOptions): Promise<AssetManifest> {
  const outputDir = path.resolve(options.runDir, 'assets');
  await mkdir(outputDir, { recursive: true });
  const entries: AssetEntry[] = [];
  const warnings: string[] = [];
  const byHash = new Map<string, AssetEntry>();
  let totalBytes = 0;
  const maxAssets = options.maxAssets ?? 180;
  for (const [index, asset] of options.assets.entries()) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt) throw new Error('Task deadline exhausted during asset processing');
    const entry: AssetEntry = { ...asset, sourceNodeIds: [...asset.sourceNodeIds], viewports: [...asset.viewports], sourceUrl: asset.url, status: 'failed' };
    try {
      if (index >= maxAssets) throw new Error(`Asset count exceeds limit ${maxAssets}`);
      const downloaded = await fetchResource(asset.url, options);
      entry.finalUrl = downloaded.url;
      entry.originalSha256 = createHash('sha256').update(downloaded.bytes).digest('hex');
      let bytes = downloaded.bytes;
      let extension: string;
      if (asset.kind === 'font') {
        if (bytes.length < 12) throw new Error('Font file is too small');
        const info = fontType(bytes);
        if (!info) throw new Error('Resource bytes do not identify a supported font');
        entry.mime = info.mime; extension = info.extension;
        warnings.push('Downloaded fonts are evidence; target font registration is a separate capability check');
      } else {
        const textHead = bytes.toString('utf8');
        const looksSvg = /<svg\b/i.test(textHead);
        if (looksSvg && (/<(?:script|foreignObject)\b|\bon\w+\s*=|<!ENTITY|<!DOCTYPE|(?:href|src)\s*=\s*["'](?!#)|@import\b|url\(\s*(?:["'](?!#)|[^"'\s#])/i.test(textHead))) throw new Error('SVG has executable or external references and is unsafe for import');
        const image = sharp(bytes, { limitInputPixels: 100_000_000 });
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height || !metadata.format) throw new Error('Resource has no valid image dimensions');
        entry.width = metadata.width; entry.height = metadata.height; entry.format = metadata.format;
        const mimeByFormat: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
        if (!mimeByFormat[metadata.format]) {
          bytes = await image.png().toBuffer();
          extension = 'png'; entry.mime = 'image/png'; entry.converted = `${metadata.format} rasterized to PNG for safe WordPress media import`;
        } else { entry.mime = mimeByFormat[metadata.format]; extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format; }
        if (downloaded.contentType && !downloaded.contentType.startsWith('image/') && !['application/octet-stream', 'binary/octet-stream'].includes(downloaded.contentType)) throw new Error(`Resource content type ${downloaded.contentType} is inconsistent with image import`);
      }
      if (bytes.length > (options.maxBytes ?? 15 * 1024 * 1024)) throw new Error('Converted resource exceeds byte limit');
      entry.sha256 = createHash('sha256').update(bytes).digest('hex'); entry.bytes = bytes.length;
      const duplicate = byHash.get(entry.sha256);
      if (duplicate) { entry.status = 'duplicate'; entry.path = duplicate.path; }
      else {
        if (totalBytes + bytes.length > (options.maxTotalBytes ?? 150 * 1024 * 1024)) throw new Error('Asset download exceeds run total byte limit');
        entry.path = path.join(outputDir, `${entry.sha256}.${extension}`);
        await writeFile(entry.path, bytes);
        totalBytes += bytes.length;
        entry.status = 'downloaded';
        byHash.set(entry.sha256, entry);
      }
    } catch (error) { entry.status = 'failed'; entry.error = error instanceof Error ? error.message : String(error); }
    entries.push(entry);
  }
  const artifactPath = path.join(outputDir, 'manifest.json');
  const manifest: AssetManifest = { version: 1, entries, totalBytes, downloaded: entries.filter(entry => entry.status === 'downloaded').length, failed: entries.filter(entry => entry.status === 'failed').length, warnings: [...new Set(warnings)], artifactPath };
  await writeFile(artifactPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

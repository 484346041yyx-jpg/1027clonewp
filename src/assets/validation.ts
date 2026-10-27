import sharp from 'sharp';

export function assertSafeSVGBytesV2(bytes: Buffer): void {
  const text = bytes.toString('utf8'); if (!/<svg\b/i.test(text)) return;
  if (/<(?:script|foreignObject)\b|\bon\w+\s*=|<!ENTITY|<!DOCTYPE|(?:href|src)\s*=\s*["'](?!#)|@import\b|url\(\s*(?:["'](?!#)|[^"'\s#])/i.test(text)) throw Error('Source SVG has executable or external references');
}
export async function validateAssetBytesV2(bytes: Buffer, declaredMime: string): Promise<{ width: number; height: number; mimeType: string }> {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error('Current-job image exceeds the 1 byte to 20 MiB media limit');
  assertSafeSVGBytesV2(bytes);
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata(), format = metadata.format;
  if (format === 'svg') throw Error('Safe SVG must be rasterized to a verified PNG before native media import');
  const mimeByFormat: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ...(format === 'heif' && metadata.compression === 'av1' ? { heif: 'image/avif' } : {}) };
  const mimeType = format ? mimeByFormat[format] : undefined;
  if (!mimeType || mimeType !== declaredMime || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw Error('Current-job media MIME, dimensions or static-image bytes do not match the manifest');
  return { width: metadata.width, height: metadata.height, mimeType };
}

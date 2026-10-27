import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForPage } from './observe.js';
import { openClaudeBrowser } from './session.js';

/** Font bytes exactly as the page's own network requests received them (fresh browser, empty cache). */
export async function exportSourceFontsWithClaudeBrowser(options: { url: string; directory: string; headless?: boolean; log?: (message: string) => void }) {
  const log = options.log ?? (() => {}), session = await openClaudeBrowser({ viewport: { width: 1920, height: 1080 }, headless: options.headless });
  const pending: Array<Promise<{ url: string; status: number; mimeType: string; bytes: Buffer } | undefined>> = [];
  try {
    session.page.on('response', response => {
      const url = response.url(), type = (response.headers()['content-type'] ?? '').split(';')[0].trim();
      if (!/\.(woff2?|ttf|otf)(\?|$)/i.test(url) && !/^(font\/|application\/(font|x-font))/i.test(type)) return;
      pending.push(response.body().then(bytes => ({ url, status: response.status(), mimeType: type || 'application/octet-stream', bytes })).catch(() => undefined));
    });
    await waitForPage(session.page, options.url, log);
    await session.page.evaluate('claudeCaptureWarmupV2()');
    const loaded = await session.page.evaluate('[...document.fonts].filter(face => face.status === "loaded").map(face => face.family.replace(/^["\']|["\']$/g, ""))') as string[];
    const results = (await Promise.all(pending)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    await mkdir(path.join(options.directory, 'fonts'), { recursive: true });
    const fonts = [];
    for (const font of results) {
      const sha256 = createHash('sha256').update(font.bytes).digest('hex'), extension = (/\.(woff2|woff|ttf|otf)(?:\?|$)/i.exec(font.url)?.[1] ?? 'bin').toLowerCase();
      const file = `fonts/${sha256.slice(0, 16)}.${extension}`;
      await writeFile(path.join(options.directory, file), font.bytes);
      fonts.push({ file, url: font.url.split('?')[0], mimeType: font.mimeType, sha256, bytes: font.bytes.length, status: font.status });
    }
    const receipt = { version: 1, kind: 'browser-font-network-material', observer: 'claude_browser', sourceUrl: options.url, cacheOverrideRestored: true, loadedFamilies: loaded, fonts };
    await writeFile(path.join(options.directory, 'source-font-material-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } finally { await session.close(); }
}

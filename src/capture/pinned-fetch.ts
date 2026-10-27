import http from 'node:http';
import https from 'node:https';
import { assertPublicUrl } from './url-safety.js';

export interface PinnedResponse { status: number; headers: Record<string, string>; body: Buffer }

/** Fetch exactly one HTTP hop with a validated, pinned address. The browser follows redirects through the same guard. */
export async function fetchPinnedBrowserResource(options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
  allowLocalForTests?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<PinnedResponse> {
  const safe = await assertPublicUrl(options.url, options);
  const address = safe.addresses.find(item => item.family === 4) ?? safe.addresses[0];
  const headers: Record<string, string> = { ...options.headers };
  // This capture never uses target-site credentials; HTTP credentials are stripped even if source JS tries to set them.
  for (const key of Object.keys(headers)) if (['authorization', 'proxy-authorization', 'connection', 'host', 'content-length'].includes(key.toLowerCase())) delete headers[key];
  if (options.body) headers['content-length'] = String(options.body.length);
  const maxBytes = options.maxBytes ?? 30 * 1024 * 1024;
  return new Promise<PinnedResponse>((resolve, reject) => {
    const transport = safe.url.protocol === 'https:' ? https : http;
    const request = transport.request(safe.url, {
      method: options.method,
      headers,
      lookup: ((_hostname: string, lookupOptions: any, callback: (...args: any[]) => void) => lookupOptions.all ? callback(null, [address]) : callback(null, address.address, address.family)) as any,
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('error', reject);
      if (Number(response.headers['content-length'] ?? 0) > maxBytes) { response.destroy(); request.destroy(); reject(new Error('Browser resource exceeds capture byte limit')); return; }
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(); request.destroy(); reject(new Error('Browser resource exceeds capture byte limit')); }
        else chunks.push(chunk);
      });
      response.on('end', () => {
        const resultHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined && !['connection', 'keep-alive', 'transfer-encoding'].includes(key)) resultHeaders[key] = Array.isArray(value) ? value.join('\n') : value;
        }
        resolve({ status: response.statusCode ?? 502, headers: resultHeaders, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(options.timeoutMs ?? 30000, () => request.destroy(new Error('Browser resource timeout')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

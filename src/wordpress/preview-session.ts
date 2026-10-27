import { chromium, type Cookie } from 'playwright';
import { handleScopedRoute } from '../verification/capture-target.js';

export async function previewCookies(adminAccessUrl: string | undefined, targetUrl: string): Promise<Cookie[]> {
  if (!adminAccessUrl) throw new Error('The target did not expose one-time authenticated preview access; draft browser verification is unavailable');
  const target = new URL(targetUrl), access = new URL(adminAccessUrl);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || access.origin !== target.origin || access.username || access.password) throw new Error('Preview authentication must remain on the credential-free configured target origin');
  const browser = await chromium.launch({ headless: true });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    context = await browser.newContext({ serviceWorkers: 'block' });
    // The shared route policy catches request errors without serializing cookie-bearing call logs,
    // stops authenticated navigation redirects at this origin, and strips external resource credentials.
    await context.route('**/*', route => handleScopedRoute(route, target));
    const page = await context.newPage();
    await page.goto(access.href, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { throw new Error('One-time owned preview login navigation failed; authentication details omitted'); });
    if (new URL(page.url()).origin !== target.origin) throw new Error('One-time preview login did not remain on the configured target origin');
    const cookies = (await context.cookies()).filter(cookie => cookie.name.startsWith('wordpress_') && cookie.domain.replace(/^\./, '') === target.hostname);
    if (!cookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_'))) throw new Error('One-time preview login did not establish a WordPress session');
    return cookies.map(cookie => ({ ...cookie, domain: target.hostname }));
  } finally { await context?.close().catch(() => undefined); await browser.close().catch(() => undefined); }
}


import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = ['../replica-v2/collect.browser.js', '../replica-v2/measure-geometry.browser.js', './state.browser.js'];
export async function claudePageScript(): Promise<string> {
  const source = (await Promise.all(scripts.map(name => readFile(path.resolve(here, name), 'utf8')))).join('\n;\n');
  // Playwright wraps init scripts in a function scope, so declarations must be published explicitly.
  const names = [...source.matchAll(/^(?:async )?function (\w+)/gm)].map(match => match[1]);
  return `${source}\n;${names.map(name => `window.${name} = ${name};`).join('')}`;
}

export interface ClaudeBrowserSession {
  browser: Browser; context: BrowserContext; page: Page; binding: { browserId: string; tabId: string; frameId: string };
  browserKind: 'chrome' | 'chromium'; browserVersion: string; userAgent: string; openedAt: string; close(): Promise<void>;
}
export interface ClaudeBrowserOptions {
  viewport: { width: number; height: number }; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean;
  headless?: boolean; kind?: 'chrome' | 'chromium'; routes?: (context: BrowserContext) => Promise<void>;
}

/** The Claude front end opens and drives its own real browser; it never claims a user's tab. */
export async function openClaudeBrowser(options: ClaudeBrowserOptions): Promise<ClaudeBrowserSession> {
  const headless = options.headless ?? process.env.CLONEWP_CLAUDE_HEADED !== '1', wanted = options.kind ?? (process.env.CLONEWP_CLAUDE_BROWSER === 'chromium' ? 'chromium' : 'chrome');
  const launch = (channel?: 'chrome') => chromium.launch({ headless, ...(channel ? { channel } : {}), ignoreDefaultArgs: ['--hide-scrollbars'] });
  let browser: Browser, browserKind: 'chrome' | 'chromium';
  if (wanted === 'chrome') { try { browser = await launch('chrome'); browserKind = 'chrome'; } catch { browser = await launch(); browserKind = 'chromium'; } }
  else { browser = await launch(); browserKind = 'chromium'; }
  const browserVersion = browser.version(), userAgent = `Mozilla/5.0 ${options.isMobile ? '(Linux; Android 14; Pixel 8) ' : '(Windows NT 10.0; Win64; x64) '}AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion.split('.')[0]}.0.0.0 ${options.isMobile ? 'Mobile ' : ''}Safari/537.36`;
  const context = await browser.newContext({
    viewport: options.viewport, deviceScaleFactor: options.deviceScaleFactor ?? 1, isMobile: options.isMobile ?? false, hasTouch: options.hasTouch ?? false,
    userAgent, locale: 'en-US', serviceWorkers: 'block',
  });
  await options.routes?.(context);
  await context.addInitScript({ content: await claudePageScript() });
  const page = await context.newPage(), tab = `tab-${randomUUID()}`;
  return {
    browser, context, page, browserKind, browserVersion, userAgent, openedAt: new Date().toISOString(),
    binding: { browserId: `claude-${browserKind}-${browserVersion}-${randomUUID().slice(0, 8)}`, tabId: tab, frameId: `main-${tab}` },
    close: async () => { await browser.close(); },
  };
}

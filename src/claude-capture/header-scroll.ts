import type { Page } from 'playwright';
import { waitForPage } from './observe.js';

export interface HeaderScrollSpec { regionId: string; selector: string; menuToggle?: string; logoSelector?: string; firstBodySelector: string }
export type HeaderScrollDetails = Record<string, string | number | boolean | null>;

/** Measures the header at the top, after scrolling down, after scrolling back up and with the menu open, using real scrolling and taps. */
export async function measureHeaderScroll(page: Page, spec: HeaderScrollSpec, viewport: { width: number; height: number }, url: string, log: (message: string) => void): Promise<HeaderScrollDetails> {
  await waitForPage(page, url, log);
  await page.evaluate('claudeCaptureWarmupV2()');
  await page.evaluate('scrollTo(0, 0)'); await page.waitForTimeout(900);
  const rectOf = (selector: string) => page.evaluate('(() => { const e = document.querySelector(' + JSON.stringify(selector) + '); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top * 100) / 100, height: Math.round(b.height * 100) / 100 }; })()') as Promise<{ top: number; height: number } | null>;
  const header = await rectOf(spec.selector), body = await rectOf(spec.firstBodySelector);
  if (!header || !body || header.height <= 0) throw Error('claude_header_scroll_region_not_visible: ' + spec.regionId);
  const scrollTo = async (from: number, to: number) => { const step = to > from ? 120 : -120; for (let y = from; step > 0 ? y < to : y > to; y += step) { await page.evaluate('scrollTo(0, ' + y + ')'); await page.waitForTimeout(35); } await page.evaluate('scrollTo(0, ' + to + ')'); await page.waitForTimeout(900); };
  const downScrollY = viewport.height + 400, upScrollY = downScrollY - 300;
  await scrollTo(0, downScrollY); const down = await rectOf(spec.selector);
  await scrollTo(downScrollY, upScrollY); const up = await rectOf(spec.selector);
  await scrollTo(upScrollY, 0);
  let menuOpen: { top: number; height: number } | null = header, logoVisible: boolean | null = null;
  if (spec.menuToggle) {
    await page.locator(spec.menuToggle).first().tap({ timeout: 8000 }).catch(() => page.locator(spec.menuToggle!).first().click({ timeout: 8000 }));
    await page.waitForTimeout(1000);
    menuOpen = await rectOf(spec.selector);
    if (spec.logoSelector) logoVisible = await page.evaluate('(() => { const e = document.querySelector(' + JSON.stringify(spec.logoSelector) + '); if (!e) return false; const b = e.getBoundingClientRect(), c = getComputedStyle(e); return b.width > 0 && b.height > 0 && c.visibility !== "hidden" && Number(c.opacity) > 0 && b.bottom > 0 && b.top < innerHeight; })()') as boolean;
  }
  if (!down || !up || !menuOpen) throw Error('claude_header_scroll_region_lost: ' + spec.regionId);
  const topY = header.top, downY = down.top, upY = up.top, menuOpenY = menuOpen.top, near = (left: number, right: number) => Math.abs(left - right) <= 2;
  const policy = near(downY, topY) && near(upY, topY) ? 'fixed' : downY < 0 && !near(upY, downY) && upY >= -2 ? 'reveal-on-up' : 'static';
  const offset = policy === 'static' ? Math.max(0, topY) : policy === 'fixed' ? topY : Math.max(0, upY);
  return {
    source: 'claude-browser-scroll-experiment', behaviorVerified: true, scrollPolicy: policy, offset: Math.round(offset * 100) / 100,
    headerFlow: body.top >= offset + header.height - 2 ? 'reserve-space' : 'overlay', contentTop: body.top,
    downScrollY, upScrollY, topY, downY, upY, menuOpenY, menuOpenHeight: menuOpen.height, ...(logoVisible === null ? {} : { menuOpenLogoVisible: logoVisible }),
  };
}

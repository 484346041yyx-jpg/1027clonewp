import type { JSHandle, Page } from 'playwright';
import type { Native44MeasuredModule } from './contracts.js';

export interface Native44CaptureMediaMetrics {
  inventories: number; visitedNodes: number; displayedUses: number; decodeAttempts: number;
  decodeCacheHits: number; cacheInvalidations: number; maximumConcurrentDecodes: number; elapsedMs: number;
}
interface ImageSample { owner: string; hasSource: boolean; ready: boolean; failed: boolean; resourceChanged: boolean }
interface MediaUse {
  url: string; drawable: boolean; kind: string; owner: string; moduleKey: string;
  box: { x: number; y: number; width: number; height: number };
  clip: { left: number; right: number; top: number; bottom: number };
}
interface BrowserMediaSession {
  viewport(): Promise<ImageSample[]>;
  modules(input: Array<{ key: string; selector: string }>): Promise<Array<Native44MeasuredModule & { media?: MediaUse[] }>>;
  metrics(): Native44CaptureMediaMetrics;
  dispose(): void;
}

/** A process-local, document-bound observation session. Resource decoding is
 * shared, while each displayed use keeps its own owner, box and clipping facts.
 * Nothing is injected into the DOM or persistent browser globals. */
export async function createNative44CaptureMediaSession(page: Page, concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Invalid bounded capture media concurrency');
  const browserFactory = ({ concurrency }: { concurrency: number }): BrowserMediaSession => {
    const capturedDocument = document, started = performance.now();
    const metrics: Native44CaptureMediaMetrics = { inventories: 0, visitedNodes: 0, displayedUses: 0, decodeAttempts: 0, decodeCacheHits: 0, cacheInvalidations: 0, maximumConcurrentDecodes: 0, elapsedMs: 0 };
    const decoded = new Map<string, Promise<boolean>>(), sources = new WeakMap<HTMLImageElement, string>(), readySources = new WeakMap<HTMLImageElement, string>();
    let dirty = false, active = 0;
    const observer = new MutationObserver(() => { dirty = true; });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const begin = () => {
      if (document !== capturedDocument || !capturedDocument.documentElement.isConnected) throw Error('Capture media document identity changed');
      if (dirty || observer.takeRecords().length) { decoded.clear(); metrics.cacheInvalidations++; dirty = false; }
      metrics.inventories++;
    };
    const mapBounded = async <T, U>(items: T[], task: (item: T) => Promise<U>): Promise<U[]> => {
      const result: U[] = new Array(items.length); let index = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) { const next = index++; result[next] = await task(items[next]); }
      })); return result;
    };
    const decode = (url: string, image?: HTMLImageElement): Promise<boolean> => {
      if (!url) return Promise.resolve(false);
      const known = decoded.get(url); if (known) { metrics.decodeCacheHits++; return known; }
      const task = (async () => {
        metrics.decodeAttempts++; active++; metrics.maximumConcurrentDecodes = Math.max(active, metrics.maximumConcurrentDecodes);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const candidate = image ?? new Image(); if (!image) candidate.src = url;
          await Promise.race([candidate.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('decode timeout')), 5000); })]);
          return candidate.complete && candidate.naturalWidth > 0 && candidate.naturalHeight > 0 && (!image || image.currentSrc === url);
        } catch { return false; } finally { if (timer) clearTimeout(timer); active--; }
      })(); decoded.set(url, task); return task;
    };
    const imageSource = (image: HTMLImageElement) => {
      const source = image.currentSrc, previous = sources.get(image);
      if (previous !== undefined && previous !== source) { decoded.delete(previous); decoded.delete(source); metrics.cacheInvalidations++; }
      sources.set(image, source); return source;
    };
    const inventory = (nodes: Element[], viewport: boolean) => {
      const styles = new Map<Element, CSSStyleDeclaration>(), boxes = new Map<Element, DOMRect>();
      const css = (node: Element) => { let value = styles.get(node); if (!value) { value = getComputedStyle(node); styles.set(node, value); } return value; };
      const bounds = (node: Element) => { let value = boxes.get(node); if (!value) { value = node.getBoundingClientRect(); boxes.set(node, value); } return value; };
      return nodes.flatMap(node => {
        metrics.visitedNodes++; const box = bounds(node);
        let left = viewport ? Math.max(0, box.left) : box.left, right = viewport ? Math.min(innerWidth, box.right) : box.right;
        let top = viewport ? Math.max(0, box.top) : box.top, bottom = viewport ? Math.min(innerHeight, box.bottom) : box.bottom;
        if (box.width <= 0 || box.height <= 0) return [];
        for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
          const style = css(ancestor), clip = bounds(ancestor);
          if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return [];
          if (ancestor !== node && /^(hidden|clip|auto|scroll)$/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
          if (ancestor !== node && /^(hidden|clip|auto|scroll)$/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
        }
        if (right - left <= (viewport ? 1 : 0) || bottom - top <= (viewport ? 1 : 0)) return [];
        return [{ node, style: css(node), box: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }, clip: { left: left + scrollX, right: right + scrollX, top: top + scrollY, bottom: bottom + scrollY }, owner: node.closest('[data-id]')?.getAttribute('data-id') ?? node.id ?? 'unmapped-image' }];
      });
    };
    return {
      async viewport() {
        begin(); const visible = inventory(Array.from(document.images), true);
        const result = await mapBounded(visible, async ({ node, owner }) => {
          const image = node as HTMLImageElement, source = imageSource(image), hasSource = Boolean(source || image.getAttribute('src')?.trim());
          const ready = source && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 ? await decode(source, image) : false;
          // Each actual node is checked even when another use decoded this URL.
          const actualReady = Boolean(ready && source === image.currentSrc && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), resourceChanged = actualReady && readySources.get(image) !== source;
          if (actualReady) readySources.set(image, source);
          return { owner, hasSource, ready: actualReady, resourceChanged, failed: Boolean(image.complete && hasSource && source === image.currentSrc && (image.naturalWidth === 0 || image.naturalWidth > 0 && !ready)) };
        }); metrics.displayedUses += result.length; return result;
      },
      async modules(input) {
        begin();
        const owners = input.map(module => ({ ...module, nodes: Array.from(document.querySelectorAll(module.selector)) }));
        // One shared geometry/style/visibility sweep, including nested module
        // ownership. A use may belong to several ancestors and is not deduped.
        const candidates = inventory(Array.from(document.body.querySelectorAll('*')).filter(node => owners.some(owner => owner.nodes[0]?.contains(node))), false);
        const jobs = candidates.flatMap(candidate => {
          const rows: Array<{ candidate: typeof candidate; url: string; kind: string; image?: HTMLImageElement }> = [];
          if (candidate.node instanceof HTMLImageElement) rows.push({ candidate, url: imageSource(candidate.node) || candidate.node.src, kind: 'image', image: candidate.node });
          for (const match of candidate.style.backgroundImage.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) rows.push({ candidate, url: new URL((match[1] ?? match[2] ?? match[3]).trim(), document.baseURI).href, kind: 'background' });
          return rows;
        });
        const uses = await mapBounded(jobs, async job => {
          const drawable = await decode(job.url, job.image);
          return { ...job, drawable: Boolean(drawable && (!job.image || job.image.complete && job.image.naturalWidth > 0 && job.image.naturalHeight > 0 && job.image.currentSrc === job.url)) };
        });
        return owners.map(module => {
          const element = module.nodes[0], result: Native44MeasuredModule & { media?: MediaUse[] } = { key: module.key, count: module.nodes.length, visible: false };
          if (element) {
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            result.visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            result.box = { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
            result.css = Object.fromEntries(['display', 'max-width', 'padding', 'margin', 'gap', 'font-family', 'font-size', 'line-height', 'color', 'background-color', 'background-image', 'grid-template-columns'].map(key => [key, style.getPropertyValue(key)]));
            const solidBackground = (() => {
              for (let node: Element | null = element; node; node = node.parentElement) {
                const css = getComputedStyle(node);
                if (css.backgroundImage !== 'none') return null;
                const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(css.backgroundColor);
                if (!match) return null;
                const alpha = match[4] === undefined ? 1 : Number(match[4]);
                if (alpha === 1) return css.backgroundColor;
                if (alpha !== 0) return null;
              }
              return null;
            })();
            const texts: Array<{ text: string; color: string; fontSize: string; lineHeight: string; x: number; width: number; height: number; lineCount?: number; whiteSpace: string; control?: { width: number; height: number; background: string; color: string; borderBottomWidth: string; beforeContent: string; afterContent: string } }> = [];
            const textWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            for (let textNode = textWalker.nextNode(); textNode && texts.length < 400; textNode = textWalker.nextNode()) {
              const node = textNode.parentElement, value = textNode.textContent?.replace(/\s+/g, ' ').trim() ?? '';
              if (!node || value.length < 3 || value.length > 240) continue;
              const box = node.getBoundingClientRect(), css = getComputedStyle(node);
              if (box.width <= 0 || box.height <= 0 || css.display === 'none' || css.visibility !== 'visible') continue;
              const host = node.closest('a,button,[role="tab"],[role="button"],[role="link"]');
              const control = host ? (() => { const visual = getComputedStyle(host), bounds = host.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, background: visual.backgroundColor, color: visual.color, borderBottomWidth: visual.borderBottomWidth, beforeContent: getComputedStyle(host, '::before').content, afterContent: getComputedStyle(host, '::after').content }; })() : undefined;
              const numericLineHeight = Number.parseFloat(css.lineHeight), lineCount = Number.isFinite(numericLineHeight) && numericLineHeight > 0 ? Math.max(1, Math.round(box.height / numericLineHeight)) : undefined;
              texts.push({ text: value, color: css.color, fontSize: css.fontSize, lineHeight: css.lineHeight, x: box.x - rect.x, width: box.width, height: box.height, ...(lineCount ? { lineCount } : {}), whiteSpace: css.whiteSpace, ...(control ? { control } : {}) });
            }
            const progress = Array.from(element.querySelectorAll('*')).filter(node => /(?:^|\s)(?:splide-carousel-progress|swiper-pagination-progressbar|wd-[\w-]*progress)(?:\s|$)/.test(node.getAttribute('class') ?? '')).flatMap(node => {
              const box = node.getBoundingClientRect(); if (box.width <= 0 || box.height <= 0) return [];
              const fill = node.querySelector('[class*="progress-bar"],[class*="progressbar-fill"]'), fillBox = fill?.getBoundingClientRect();
              return [{ x: box.x - rect.x, width: box.width, height: box.height, background: getComputedStyle(node).backgroundColor, fillFraction: fillBox ? fillBox.width / box.width : null }];
            });
            const arrows = Array.from(element.querySelectorAll('button,a')).flatMap(node => {
              const name = `${node.getAttribute('class') ?? ''} ${node.getAttribute('aria-label') ?? ''}`;
              const side = /(?:^|[\s_-])prev(?:ious)?(?:[\s_-]|$)/i.test(name) ? 'prev' as const : /(?:^|[\s_-])next(?:[\s_-]|$)/i.test(name) ? 'next' as const : null;
              if (!side || !/(?:arrow|swiper-button|slider-button|carousel-button|splide)/i.test(name)) return [];
              const visual = getComputedStyle(node), box = node.getBoundingClientRect(), icon = node.querySelector('svg,i'), iconBox = icon?.getBoundingClientRect(), iconStyle = icon && getComputedStyle(icon);
              const before = !iconStyle && getComputedStyle(node, '::before'), after = !iconStyle && getComputedStyle(node, '::after');
              const pseudo = before && !['none', 'normal'].includes(before.content) ? before : after && !['none', 'normal'].includes(after.content) ? after : null;
              const size = (value: string, fallback: number) => /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : fallback;
              return [{ side, x: box.x - rect.x, width: size(visual.width, box.width), height: size(visual.height, box.height), background: visual.backgroundColor, color: visual.color, borderRadius: visual.borderRadius, iconWidth: iconStyle ? size(iconStyle.width, iconBox?.width ?? 0) : pseudo ? size(pseudo.width, size(pseudo.fontSize, 0)) : null, iconHeight: iconStyle ? size(iconStyle.height, iconBox?.height ?? 0) : pseudo ? size(pseudo.height, size(pseudo.fontSize, 0)) : null }];
            });
            const paintLayers = [element, ...Array.from(element.querySelectorAll('*'))].flatMap(node => {
              const box = node.getBoundingClientRect(), css = getComputedStyle(node);
              if (box.width <= 0 || box.height <= 0 || css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) return [];
              const backgroundImage = css.backgroundImage === 'none' ? 'none' as const : /gradient\(/i.test(css.backgroundImage) ? 'gradient' as const : 'image' as const;
              const backgroundAlpha = /rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+))?\s*\)/i.exec(css.backgroundColor)?.[1];
              const hasBackground = backgroundAlpha === undefined ? css.backgroundColor !== 'transparent' : Number(backgroundAlpha) > 0;
              if (!hasBackground && backgroundImage === 'none' && (Number.parseFloat(css.borderWidth) <= 0 || css.borderStyle === 'none') && css.boxShadow === 'none') return [];
              return [{ x: box.x - rect.x, y: box.y - rect.y, width: box.width, height: box.height,
                background: css.backgroundColor, backgroundImage, borderWidth: css.borderWidth, borderColor: css.borderColor,
                borderRadius: css.borderRadius, boxShadow: css.boxShadow, opacity: css.opacity }];
            });
            const mediaGeometry = Array.from(element.querySelectorAll('img,svg')).filter(node => {
              const box = node.getBoundingClientRect(), visual = getComputedStyle(node);
              return box.width > 0 && box.height > 0 && visual.display !== 'none' && visual.visibility === 'visible';
            }).slice(0, 100).map(node => { const box = node.getBoundingClientRect(); return { x: box.x - rect.x, y: box.y - rect.y, width: box.width, height: box.height }; });
            result.visual = { solidBackground, texts, progress, arrows, mediaGeometry, paintLayers };
            result.media = uses.filter(use => element.contains(use.candidate.node)).map(use => ({ url: use.url, kind: use.kind, drawable: use.drawable, owner: use.candidate.owner, moduleKey: module.key, box: use.candidate.box, clip: use.candidate.clip }));
            metrics.displayedUses += result.media.length;
            result.state = { ...(element.hasAttribute('aria-expanded') ? { expanded: element.getAttribute('aria-expanded') === 'true' } : {}), hover: element.matches(':hover') };
          } return result;
        });
      },
      metrics() { return { ...metrics, elapsedMs: Math.round(performance.now() - started) }; },
      dispose() { observer.disconnect(); decoded.clear(); },
    };
  };
  // tsx's local name annotations need a lexical helper when serialized. Keep
  // it inside this trusted function's scope, never in the inspected globals.
  const handle = await page.evaluateHandle(`(() => { const __name = (target) => target; return (${browserFactory.toString()})(${JSON.stringify({ concurrency })}); })()`) as JSHandle<BrowserMediaSession>;
  return {
    viewport: () => handle.evaluate(session => session.viewport()),
    modules: (modules: Array<{ key: string; selector: string }>) => handle.evaluate((session, modules) => session.modules(modules), modules),
    metrics: () => handle.evaluate(session => session.metrics()),
    dispose: async () => { await handle.evaluate(session => session.dispose()).catch(() => undefined); await handle.dispose(); },
  };
}
export type Native44CaptureMediaSession = Awaited<ReturnType<typeof createNative44CaptureMediaSession>>;

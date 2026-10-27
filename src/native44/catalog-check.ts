import type { Page } from 'playwright';
import { collectNativeCatalogRender, nativeCatalogOriginalWidgetSelector } from '../verification/catalog-browser.js';
import type { CatalogProductEvidence, TargetCatalogEvidence } from '../wordpress/catalog-contract.js';

/** tsx may name nested functions with its module-only __name helper. Supply
 * that pure identity helper lexically inside our own serialized observers;
 * never add globals or alter the frontend DOM to make a test pass. */
function selfContainedCatalogPage(page: Page): Page {
  return new Proxy(page, { get(target, property) {
    if (property === 'locator') return (selector: string, options?: Parameters<Page['locator']>[1]) => {
      const locator = target.locator(selector, options);
      return new Proxy(locator, { get(actual, key) {
        if (key === 'evaluate') return (observer: unknown, argument?: unknown, settings?: { timeout?: number }) => {
          if (typeof observer !== 'function') throw Error('Catalog observers require a trusted serialized function');
          const selfContained = new Function('element', 'argument', `const __name=value=>value;return (${observer.toString()})(element,argument);`) as (element: Element, argument: unknown) => unknown;
          return actual.evaluate(selfContained, argument, settings);
        };
        const value = Reflect.get(actual, key, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export const NATIVE44_PRODUCT_WIDGETS = ['wd_products', 'woocommerce-products', 'wd_products_tabs'] as const;
export interface Native44ProductCheck {
  componentKey: string; selector: string; widgetType: typeof NATIVE44_PRODUCT_WIDGETS[number];
  collectionPath?: string; expectedProductIds: number[]; catalog: TargetCatalogEvidence; carouselExpected?: boolean;
}
export interface Native44ProductCheckEvidence {
  componentKey: string; widgetType: Native44ProductCheck['widgetType']; collectionPath?: string; selector: string;
  viewport: string; status: 'passed' | 'failed' | 'unverified'; problems: string[];
  products: CatalogProductEvidence[]; expectedProductIds: number[];
  nativeWidgetCount: number; actualWidgetType?: string;
  elementId?: string; logicalOrder?: Array<{ id: number; index: number | null }>;
  textMeasurements?: Native44CatalogTextMeasurement[];
}
export interface Native44CatalogTextMeasurement {
  id: number; role: 'name' | 'price'; lineCount: number; fullLineCount: number;
  cardVisibleFraction: number; textPainted: boolean;
  excludedSemanticTextNodes: number; rootClipOrigin: 'viewport';
  viewport: { width: number; height: number; scrollX: number; scrollY: number; htmlRectTop: number };
  legacyLineCount?: number; legacyFullLineCount?: number;
  legacyCardVisibleFraction?: number; legacyTextPainted?: boolean; legacySlotVisible?: boolean;
}

/** Native44-only correction for the scrolling HTML root coordinate system.
 * All other overflow ancestors retain their actual local clipping boxes. */
export async function observeNative44CatalogTextLines(page: Page, selector: string): Promise<Native44CatalogTextMeasurement[]> {
  return selfContainedCatalogPage(page).locator(selector).evaluate(root => {
    const viewport = { width: document.compatMode === 'CSS1Compat' ? document.documentElement.clientWidth : innerWidth, height: document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : innerHeight, scrollX, scrollY, htmlRectTop: document.documentElement.getBoundingClientRect().top };
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect(); if (box.width <= 1 || box.height <= 1 || element.closest('.screen-reader-text,[hidden]')) return false;
      for (let owner: Element | null = element; owner; owner = owner.parentElement) { const css = getComputedStyle(owner); if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0) return false; }
      return true;
    };
    const custom = [root, ...root.querySelectorAll('*')].map(element => (element as any).swiper).filter(runtime => runtime?.initialized).map(runtime => runtime.params?.slideDuplicateClass).filter(name => typeof name === 'string' && /^[\w-]+$/.test(name));
    const clones = ['.swiper-slide-duplicate', '.slick-cloned', ...custom.map(name => `.${name}`)].join(','), rows: Native44CatalogTextMeasurement[] = [];
    for (const card of Array.from(root.querySelectorAll('.product-grid-item.product[data-id]')).filter(card => card.closest('[data-widget_type]') === root && !card.closest(clones))) {
      const surfaces = card.querySelectorAll('.product-wrapper'), surface = surfaces.length === 1 ? surfaces[0] : card, surfaceBox = surface.getBoundingClientRect();
      let cardLeft = surfaceBox.left, cardRight = surfaceBox.right, cardTop = surfaceBox.top, cardBottom = surfaceBox.bottom;
      for (let ancestor = card.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect(), isRoot = ancestor === document.documentElement;
        const left = isRoot ? 0 : box.left + ancestor.clientLeft, top = isRoot ? 0 : box.top + ancestor.clientTop;
        if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { cardLeft = Math.max(cardLeft, left); cardRight = Math.min(cardRight, isRoot ? viewport.width : left + ancestor.clientWidth); }
        if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { cardTop = Math.max(cardTop, top); cardBottom = Math.min(cardBottom, isRoot ? viewport.height : top + ancestor.clientHeight); }
      }
      const cardVisibleFraction = visible(card) && surfaceBox.width > 0 && surfaceBox.height > 0 ? Math.max(0, cardRight - cardLeft) * Math.max(0, cardBottom - cardTop) / (surfaceBox.width * surfaceBox.height) : 0;
      const anchors = Array.from(card.querySelectorAll('a[href]')), heading = card.querySelector('h3.wd-entities-title a[href],.wd-entities-title a[href]') ?? anchors.find(anchor => anchor.closest('h1,h2,h3,h4,h5,h6')) ?? anchors.find(anchor => anchor.textContent?.trim());
      const slots = [{ role: 'name' as const, element: heading?.closest('.wd-entities-title') ?? heading }, { role: 'price' as const, element: card.querySelector('.price') }];
      for (const slot of slots) {
        if (!slot.element) continue;
        const full: number[] = [], painted: number[] = [], walker = document.createTreeWalker(slot.element, NodeFilter.SHOW_TEXT), range = document.createRange(); let excludedSemanticTextNodes = 0;
        const add = (lines: number[], top: number) => { if (!lines.some(line => Math.abs(line - top) <= 2)) lines.push(top); };
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || !node.parentElement) continue;
          if (node.parentElement.closest('.screen-reader-text')) { excludedSemanticTextNodes++; continue; }
          if (!visible(node.parentElement)) continue;
          range.selectNodeContents(node);
          for (const rect of Array.from(range.getClientRects()).filter(rect => rect.width > .1 && rect.height > .1)) {
            add(full, rect.top); let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
            for (let ancestor: Element | null = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
              const css = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect(), isRoot = ancestor === document.documentElement;
              const clipLeft = isRoot ? 0 : box.left + ancestor.clientLeft, clipTop = isRoot ? 0 : box.top + ancestor.clientTop, clipRight = isRoot ? viewport.width : clipLeft + ancestor.clientWidth, clipBottom = isRoot ? viewport.height : clipTop + ancestor.clientHeight;
              if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clipLeft); right = Math.min(right, clipRight); }
              if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clipTop); bottom = Math.min(bottom, clipBottom); }
            }
            // As in the original observer, partially exposed glyphs count;
            // local hidden/clipped extra lines still produce full > painted.
            if (right - left > .1 && bottom - top > .1) add(painted, rect.top);
          }
        }
        rows.push({ id: Number(card.getAttribute('data-id')), role: slot.role, lineCount: painted.length, fullLineCount: full.length, cardVisibleFraction, textPainted: painted.length > 0, excludedSemanticTextNodes, rootClipOrigin: 'viewport', viewport });
      }
    }
    return rows;
  });
}
const text = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').normalize('NFC').replace(/\s+/g, ' ').trim();
function publicURL(value: string): URL | undefined { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; } catch { return undefined; } }

export function native44ObservedProductProblems(check: Native44ProductCheck, observed: CatalogProductEvidence[]): string[] {
  const problems: string[] = [], expected = new Map(check.catalog.products.map(product => [product.id, product]));
  if (new Set(check.expectedProductIds).size !== check.expectedProductIds.length || !check.expectedProductIds.length) problems.push('Frozen target product IDs are missing or repeated');
  if (observed.length !== check.expectedProductIds.length || observed.some((product, index) => product.id !== check.expectedProductIds[index])) problems.push('Actual non-clone product identities or logical order differ from the frozen query');
  for (const product of observed) {
    const record = expected.get(product.id);
    if (!record || !check.expectedProductIds.includes(product.id)) { problems.push(`Unproven target product identity: ${product.id}`); continue; }
    if (!publicURL(record.permalink) || publicURL(record.permalink)?.origin !== check.catalog.targetOrigin || publicURL(product.permalink)?.origin !== check.catalog.targetOrigin || product.permalink !== record.permalink) problems.push(`Product ${product.id} permalink differs from the real target record`);
    if (!text(product.name) || text(product.name) !== text(record.name)) problems.push(`Product ${product.id} name differs from the real target record`);
    if (!publicURL(product.imageUrl) || ![record.imageUrl, ...(record.imageVariants ?? [])].includes(product.imageUrl)) problems.push(`Product ${product.id} actual image is not a target catalog image variant`);
    if (typeof record.priceText !== 'string' || !text(record.priceText) || text(product.priceText ?? '') !== text(record.priceText)) problems.push(`Product ${product.id} full price text differs from the real target record`);
    if (typeof record.onSale === 'boolean' && product.onSale !== record.onSale) problems.push(`Product ${product.id} sale state differs from the real target record`);
    if ((product.cardLayout?.visibleFraction ?? 0) > 0) {
      if (!product.namePaint?.visible || !product.pricePaint?.visible) problems.push(`Product ${product.id} has a visible card but its name or current price is not painted`);
      for (const slot of product.cardLayout?.slots.filter(slot => slot.role === 'name' || slot.role === 'price') ?? []) if (slot.visible && slot.fullLineCount !== undefined && slot.lineCount !== undefined && slot.fullLineCount > slot.lineCount) problems.push(`Product ${product.id} ${slot.role} is clipped instead of displaying the complete fact`);
    }
  }
  return problems;
}

/** Exact owned native DOM only. Expected records never fill missing DOM fields. */
export async function collectNative44ProductChecks(page: Page, checks: Native44ProductCheck[], viewport: string): Promise<Native44ProductCheckEvidence[]> {
  const results: Native44ProductCheckEvidence[] = [];
  const savedScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  try {
  for (const check of checks) {
    const row: Native44ProductCheckEvidence = { componentKey: check.componentKey, widgetType: check.widgetType, collectionPath: check.collectionPath, selector: check.selector, viewport, status: 'unverified', problems: [], products: [], expectedProductIds: [...check.expectedProductIds], nativeWidgetCount: 0 };
    results.push(row);
    try {
      if (!check.catalog?.evidence?.length || new URL(page.url()).origin !== check.catalog.targetOrigin) throw Error('Target catalog provenance or current frontend origin is missing');
      const originalSelector = await nativeCatalogOriginalWidgetSelector(selfContainedCatalogPage(page), check.selector);
      const widget = page.locator(originalSelector); row.nativeWidgetCount = await widget.count();
      if (row.nativeWidgetCount !== 1) throw Error('Product check requires one actual owned widget');
      row.actualWidgetType = await widget.getAttribute('data-widget_type') ?? undefined;
      if (row.actualWidgetType !== `${check.widgetType}.default`) throw Error('Actual product widget type differs from its query receipt');
      if (check.widgetType !== 'wd_products' || check.collectionPath) { row.problems.push(`${check.widgetType}${check.collectionPath ? ` / ${check.collectionPath}` : ''}: a dedicated frontend collection adapter has not been qualified; query hash is not render evidence`); continue; }
      const elementId = await widget.getAttribute('data-id');
      if (!elementId || !/^[a-f0-9]{7}$/.test(elementId)) throw Error('Actual product widget has no stable native Elementor identity');
      row.elementId = elementId;
      // The shared text observer measures actual viewport clipping as well as
      // local overflow. Naturally expose this widget before collecting facts;
      // a below-fold card at scrollTop=0 is not a CSS truncation defect.
      if (await widget.isVisible()) await widget.scrollIntoViewIfNeeded();
      const rendered = await collectNativeCatalogRender({ page: selfContainedCatalogPage(page), blockId: check.componentKey, widgetKey: check.componentKey, elementId, widgetSelector: originalSelector, viewport, catalog: check.catalog, carouselExpected: check.carouselExpected });
      row.products = rendered.products;
      row.textMeasurements = await observeNative44CatalogTextLines(page, originalSelector);
      for (const product of row.products) {
        const legacyCardVisibleFraction = product.cardLayout?.visibleFraction;
        for (const slot of product.cardLayout?.slots.filter(slot => slot.role === 'name' || slot.role === 'price') ?? []) {
        const actual = row.textMeasurements.filter(item => item.id === product.id && item.role === slot.role);
        if (actual.length !== 1) throw Error(`Product ${product.id} ${slot.role} lacks one actual text measurement`);
        actual[0].legacyLineCount = slot.lineCount; actual[0].legacyFullLineCount = slot.fullLineCount;
        actual[0].legacyCardVisibleFraction = legacyCardVisibleFraction;
        const paint = slot.role === 'name' ? product.namePaint : product.pricePaint;
        if (paint) { actual[0].legacyTextPainted = paint.visible; paint.visible = actual[0].textPainted; }
        product.cardLayout!.visibleFraction = actual[0].cardVisibleFraction;
        actual[0].legacySlotVisible = slot.visible; slot.visible = actual[0].textPainted;
        slot.lineCount = actual[0].lineCount; slot.fullLineCount = actual[0].fullLineCount;
        }
      }
      row.logicalOrder = await widget.evaluate(root => {
        const custom = [root, ...root.querySelectorAll('*')].map(element => (element as any).swiper).filter(runtime => runtime?.initialized).map(runtime => runtime.params?.slideDuplicateClass).filter(name => typeof name === 'string' && /^[\w-]+$/.test(name));
        const clones = ['.swiper-slide-duplicate', '.slick-cloned', ...custom.map(name => `.${name}`)].join(',');
        return Array.from(root.querySelectorAll('.product-grid-item.product[data-id]')).filter(card => card.closest('[data-widget_type]') === root && !card.closest(clones)).map(card => { const raw = card.getAttribute('data-swiper-slide-index') ?? card.closest('.swiper-slide')?.getAttribute('data-swiper-slide-index'); return { id: Number(card.getAttribute('data-id')), index: raw === null || raw === undefined ? null : Number(raw) }; });
      });
      if (row.logicalOrder.some(item => item.index !== null)) {
        const indexes = row.logicalOrder.map(item => item.index);
        if (indexes.some(index => !Number.isInteger(index)) || new Set(indexes).size !== row.products.length) row.problems.push('Actual carousel logical indexes are incomplete or ambiguous');
        else row.products.sort((left, right) => row.logicalOrder!.find(item => item.id === left.id)!.index! - row.logicalOrder!.find(item => item.id === right.id)!.index!);
      }
      row.problems.push(...native44ObservedProductProblems(check, row.products));
      if (check.carouselExpected && !rendered.runtime.initialized) row.problems.push('Product carousel runtime is not initialized and stable');
      row.status = row.problems.length ? 'failed' : 'passed';
    } catch (error) { row.status = 'failed'; row.problems.push(error instanceof Error ? error.message : 'Target product DOM observation failed'); }
  }
  } finally { await page.evaluate(point => scrollTo({ left: point.x, top: point.y, behavior: 'instant' }), savedScroll); }
  return results;
}

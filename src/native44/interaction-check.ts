import type { Page } from 'playwright';

export const NATIVE44_CAROUSEL_WIDGETS = ['nested-carousel', 'wd_nested_carousel', 'slides', 'wd_banner_carousel', 'wd_infobox_carousel', 'wd_testimonials'] as const;
export interface Native44InteractionCheck {
  componentKey: string; selector: string; widgetType: string;
  viewports?: string[];
  /** Relative, explicitly observed controls. Missing controls mean unverified. */
  nextSelector?: string; previousSelector?: string; paginationSelector?: string;
  sourceComponentKey?: string; expectedLogicalIndex?: number; requireSourceAlignment?: boolean;
}
export interface Native44InteractionState {
  initialized: boolean; logicalIndex?: number; logicalPageIndex?: number; paginationIndex?: number; logicalCount: number; animating: boolean;
  paginationKind?: 'bullets' | 'fraction'; fractionCurrent?: number; fractionTotal?: number; paginationOwned?: boolean; nativeSnapIndex?: number; loop?: boolean;
}
export interface Native44InteractionEvidence {
  componentKey: string; viewport: string; selector: string; widgetType: string;
  status: 'passed' | 'failed' | 'unverified'; problems: string[]; clickedNext: boolean; clickedPrevious: boolean;
  before?: Native44InteractionState; after?: Native44InteractionState; restored?: Native44InteractionState;
  elementId?: string;
  normalizedFrom?: number; expectedLogicalIndex?: number; normalizationClicks?: number;
  normalizationActions?: Array<'next' | 'previous'>; probeDirection?: 'next' | 'previous';
}
/** Runtime state is observed only. Movement uses real scoped control clicks;
 * no Swiper API, setting changes, editor sessions or business links are used. */
export async function collectNative44InteractionChecks(page: Page, checks: Native44InteractionCheck[], viewport: string): Promise<Native44InteractionEvidence[]> {
  const evidence: Native44InteractionEvidence[] = [];
  const savedScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  try {
    for (const check of checks.filter(item => !item.viewports || item.viewports.includes(viewport))) {
      const row: Native44InteractionEvidence = { componentKey: check.componentKey, viewport, selector: check.selector, widgetType: check.widgetType, status: 'unverified', problems: [], clickedNext: false, clickedPrevious: false }; evidence.push(row);
      if (!check.nextSelector || !check.previousSelector || !check.paginationSelector) { row.problems.push('Actual next/previous and synchronized pagination controls have not been mapped; initial index and library registration are insufficient'); continue; }
      if (check.requireSourceAlignment && !Number.isInteger(check.expectedLogicalIndex)) { row.problems.push('The bound source screenshot has no observed logical item; target controls cannot be compared from an arbitrary initial slide'); continue; }
      const root = page.locator(check.selector);
      const state = async (): Promise<Native44InteractionState> => root.evaluate((element, paginationSelector) => {
        const runtimes = [element, ...element.querySelectorAll('*')].filter(node => node.closest('[data-widget_type]') === element).map(node => (node as any).swiper).filter(runtime => runtime?.initialized === true && runtime.destroyed !== true);
        const unique = [...new Set(runtimes)], runtime = unique.length === 1 ? unique[0] : undefined;
        const bullets = Array.from(element.querySelectorAll(paginationSelector)).filter(node => node.closest('[data-widget_type]') === element), active = bullets.filter(bullet => bullet.matches('.swiper-pagination-bullet-active,.wd-active,[aria-current="true"],[aria-selected="true"]'));
        const selected = active.length === 1 ? active[0] : undefined;
        const indexes = bullets.map(bullet => bullet.getAttribute('data-bullet-index') ?? bullet.getAttribute('data-swiper-slide-index') ?? bullet.getAttribute('data-index'));
        let paginationIndex = selected ? indexes[bullets.indexOf(selected)] !== null ? Number(indexes[bullets.indexOf(selected)]) : bullets.indexOf(selected) : undefined;
        const custom = runtime?.params?.slideDuplicateClass, cloneSelector = '.swiper-slide-duplicate,.slick-cloned' + (typeof custom === 'string' && /^[\w-]+$/.test(custom) ? `,.${custom}` : '');
        const originals = runtime?.slides ? Array.from(runtime.slides as Element[]).filter(slide => !slide.closest(cloneSelector)) : [];
        const paginationKind = runtime?.params?.pagination?.type === 'fraction' ? 'fraction' : 'bullets';
        let fractionCurrent: number | undefined, fractionTotal: number | undefined, paginationOwned: boolean | undefined;
        if (paginationKind === 'fraction') {
          // Native Swiper fraction has no active bullet. Read its actual owned
          // current/total text and require those glyphs to be drawn and synced.
          const nativePagers = Array.isArray(runtime.pagination?.el) ? runtime.pagination.el : [runtime.pagination?.el], pager = nativePagers.length === 1 ? nativePagers[0] as Element | undefined : undefined;
          const currentClass = runtime.params.pagination.currentClass, totalClass = runtime.params.pagination.totalClass;
          paginationOwned = Boolean(pager && typeof pager.querySelectorAll === 'function' && element.contains(pager) && pager.closest('[data-widget_type]') === element && bullets.length === 1 && (pager === bullets[0] || pager.contains(bullets[0])));
          const current = paginationOwned && typeof currentClass === 'string' && /^[\w-]+$/.test(currentClass) ? pager!.querySelectorAll(`.${currentClass}`) : [], total = paginationOwned && typeof totalClass === 'string' && /^[\w-]+$/.test(totalClass) ? pager!.querySelectorAll(`.${totalClass}`) : [];
          const drawnNumbers = [current, total].map(nodes => {
            if (nodes.length !== 1) return undefined;
            const node = nodes[0] as HTMLElement, text = node.innerText?.trim(), rect = node.getBoundingClientRect();
            if (!text || !/^\d+$/.test(text) || rect.width <= 0 || rect.height <= 0 || Number.parseFloat(getComputedStyle(node).fontSize) <= 0) return undefined;
            for (let owner: Element | null = node; owner; owner = owner.parentElement) { const css = getComputedStyle(owner); if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0) return undefined; }
            const css = getComputedStyle(node); if (css.color === 'transparent' || /rgba\([^)]*,\s*0\s*\)$/.test(css.color) || css.webkitTextFillColor === 'transparent') return undefined;
            return Number(text);
          });
          [fractionCurrent, fractionTotal] = drawnNumbers;
          const group = Number(runtime.params.slidesPerGroup ?? 1), nativeTotal = runtime.params.loop === true ? Number.isInteger(group) && group > 0 ? Math.ceil(originals.length / group) : undefined : Array.isArray(runtime.snapGrid) ? runtime.snapGrid.length : undefined;
          paginationIndex = paginationOwned && fractionCurrent !== undefined && fractionTotal !== undefined && fractionCurrent >= 1 && fractionCurrent <= fractionTotal && fractionTotal === nativeTotal ? fractionCurrent - 1 : undefined;
        }
        // Actual Elementor's legacy loop contains cloned snap offsets (the
        // observed header is realIndex=0/snapIndex=1; brand rows have offset6).
        // The logical page follows realIndex and the actual runtime group;
        // non-loop Woodmart retains its real snapGrid page index.
        const loop = runtime?.params?.loop === true, group = Number(runtime?.params?.slidesPerGroup ?? 1), logicalPageIndex = loop ? Number.isInteger(runtime?.realIndex) && Number.isInteger(group) && group > 0 ? Math.floor(runtime.realIndex / group) : undefined : Number.isInteger(runtime?.snapIndex) ? runtime.snapIndex : undefined;
        return { initialized: Boolean(runtime), logicalIndex: Number.isInteger(runtime?.realIndex) ? runtime.realIndex : undefined, logicalPageIndex, paginationIndex: Number.isInteger(paginationIndex) ? paginationIndex : undefined, logicalCount: originals.length, animating: runtime?.animating === true, paginationKind, ...(paginationKind === 'fraction' ? { fractionCurrent, fractionTotal, paginationOwned } : {}), nativeSnapIndex: Number.isInteger(runtime?.snapIndex) ? runtime.snapIndex : undefined, loop };
      }, check.paginationSelector!);
      const wait = async (differentFrom?: number) => { const deadline = Date.now() + 3000; let last = await state(), signature = '', stable = 0; while (Date.now() < deadline) { const now = JSON.stringify(last); stable = last.initialized && !last.animating && last.logicalIndex !== undefined && (last.logicalPageIndex ?? last.logicalIndex) === last.paginationIndex && (differentFrom === undefined || last.logicalIndex !== differentFrom) ? now === signature ? stable + 1 : 1 : 0; if (stable >= 2) return last; signature = now; await page.waitForTimeout(80); last = await state(); } throw Error('Carousel did not establish a stable actual logical index and matching pagination'); };
      let probeDirection: 'next' | 'previous' | undefined;
      try {
        if (await root.count() !== 1 || await root.getAttribute('data-widget_type') !== `${check.widgetType}.default`) throw Error('Interaction requires one exact native widget owner');
        row.elementId = await root.getAttribute('data-id') ?? undefined;
        if (!await root.isVisible()) { row.problems.push('Required carousel is not visible at this viewport'); continue; }
        await root.scrollIntoViewIfNeeded();
        // Woodmart reveals its native arrows on a real owner hover. Preserve
        // normal hit testing: clipping/overlays must still fail actual clicks.
        await root.hover({ timeout: 3000 });
        const next = root.locator(check.nextSelector), previous = root.locator(check.previousSelector);
        for (const control of [next, previous]) if (await control.count() !== 1 || !await control.evaluate(element => { const anchor = element.closest('a[href]'); return !element.closest('form') && !(element instanceof HTMLButtonElement && element.type === 'submit') && (!anchor || anchor.getAttribute('href') === '#'); })) throw Error('Carousel control is ambiguous or could activate a business/form link');
        const available = async (direction: 'next' | 'previous') => { const control = direction === 'next' ? next : previous; return await control.isVisible() && await control.isEnabled() && await control.evaluate(element => !element.matches(':disabled,[aria-disabled="true"],.swiper-button-disabled,.wd-disabled,.disabled') && getComputedStyle(element).pointerEvents !== 'none'); };
        let aligned = await wait();
        if (check.expectedLogicalIndex !== undefined) {
          if (!Number.isInteger(check.expectedLogicalIndex) || check.expectedLogicalIndex < 0 || check.expectedLogicalIndex >= aligned.logicalCount) throw Error('Observed source logical index is outside the actual target item set');
          row.normalizedFrom = aligned.logicalIndex; row.expectedLogicalIndex = check.expectedLogicalIndex; row.normalizationClicks = 0; row.normalizationActions = [];
          while (aligned.logicalIndex !== check.expectedLogicalIndex && row.normalizationClicks < aligned.logicalCount) {
            const index = aligned.logicalIndex!, direction = check.expectedLogicalIndex < index ? 'previous' : 'next';
            if (!await available(direction)) throw Error(`Required actual ${direction} control cannot align the source logical item`);
            await (direction === 'next' ? next : previous).click({ timeout: 3000 }); row.normalizationClicks++; row.normalizationActions.push(direction); aligned = await wait(index);
          }
          if (aligned.logicalIndex !== check.expectedLogicalIndex) throw Error('Actual target controls could not align the source screenshot logical item');
        }
        row.before = aligned;
        if (row.before.logicalCount < 2) throw Error('Actual multi-item carousel behavior cannot be proved with fewer than two logical items');
        probeDirection = await available('next') ? 'next' : await available('previous') ? 'previous' : undefined;
        if (!probeDirection) throw Error('Neither actual carousel direction can move from the source-aligned item');
        row.probeDirection = probeDirection;
        await (probeDirection === 'next' ? next : previous).click({ timeout: 3000 });
        if (probeDirection === 'next') row.clickedNext = true; else row.clickedPrevious = true;
        row.after = await wait(row.before.logicalIndex);
      } catch (error) { row.problems.push(error instanceof Error ? error.message : 'Actual carousel control observation failed'); }
      finally {
        if ((row.clickedNext || row.clickedPrevious) && row.before && probeDirection) {
          try {
            const restorationDirection = probeDirection === 'next' ? 'previous' : 'next';
            await root.locator(restorationDirection === 'next' ? check.nextSelector! : check.previousSelector!).click({ timeout: 3000 });
            if (restorationDirection === 'next') row.clickedNext = true; else row.clickedPrevious = true;
            row.restored = await wait(); if (row.restored.logicalIndex !== row.before.logicalIndex || row.restored.paginationIndex !== row.before.paginationIndex) throw Error('Original carousel logical position was not restored');
          }
          catch (error) { row.problems.push(error instanceof Error ? error.message : 'Carousel restoration failed'); }
        }
      }
      if (!row.problems.length && row.clickedNext && row.clickedPrevious && row.before && row.after && row.restored) row.status = 'passed';
      else if (row.clickedNext || row.problems.length) row.status = 'failed';
    }
  } finally { await page.evaluate(point => scrollTo({ left: point.x, top: point.y, behavior: 'instant' }), savedScroll); }
  return evidence;
}

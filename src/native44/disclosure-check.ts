import type { Page } from 'playwright';

/** Separate from carousel checks so historical manifests keep their original
 * meaning. A declaration binds one real native details/summary owner. */
export interface Native44DisclosureCheck {
  componentKey: string; selector: string; widgetType: 'nested-accordion';
  detailsSelector: string; triggerSelector: string; panelSelector: string;
  viewports?: string[];
}
export interface Native44DisclosureState {
  expanded: boolean; ariaExpanded: boolean; controlsId: string;
  controlsTarget: 'details' | 'panel'; panelVisible: boolean;
  triggerFocused: boolean;
}
export interface Native44DisclosureEvidence {
  componentKey: string; viewport: string; selector: string; widgetType: string;
  elementId?: string; status: 'passed' | 'failed' | 'unverified'; problems: string[];
  actions: Array<{ input: 'click' | 'Enter' | 'Space'; expanded: boolean }>;
  before?: Native44DisclosureState; restored?: Native44DisclosureState;
}

export function validateNative44DisclosureChecks(checks: Native44DisclosureCheck[], viewports?: string[]): void {
  if (new Set(checks.map(check => check.componentKey)).size !== checks.length) throw Error('Disclosure checks require unique component identities');
  for (const check of checks) {
    if (!check.componentKey?.trim() || !check.selector?.trim() || check.widgetType !== 'nested-accordion' || !check.detailsSelector?.trim() || !check.triggerSelector?.trim() || !check.panelSelector?.trim()) throw Error('Disclosure check requires an exact native details/summary owner and explicit panel mapping');
    if (check.viewports && (!check.viewports.length || new Set(check.viewports).size !== check.viewports.length || check.viewports.some(name => !name?.trim() || viewports && !viewports.includes(name)))) throw Error('Disclosure check has invalid viewport coverage');
  }
}

export function native44DisclosureEvidencePassed(row: Native44DisclosureEvidence, check: Native44DisclosureCheck): boolean {
  const before = row.before, restored = row.restored;
  if (row.status !== 'passed' || row.problems.length || !row.elementId || row.componentKey !== check.componentKey || row.selector !== check.selector || row.widgetType !== check.widgetType || !before || !restored || before.expanded !== before.ariaExpanded || before.expanded !== before.panelVisible || restored.expanded !== before.expanded || restored.ariaExpanded !== before.ariaExpanded || restored.panelVisible !== before.panelVisible || restored.controlsId !== before.controlsId || restored.controlsTarget !== before.controlsTarget || row.actions.length !== 6) return false;
  return row.actions.every((action, index) => action.input === (['click', 'Enter', 'Space'] as const)[Math.floor(index / 2)] && action.expanded === (index % 2 === 0 ? !before.expanded : before.expanded));
}

export async function readNative44DisclosureState(page: Page, check: Native44DisclosureCheck): Promise<Native44DisclosureState> {
  return page.locator(check.selector).evaluate((element, selectors) => {
        const [details, triggers, panels] = [selectors.detailsSelector, selectors.triggerSelector, selectors.panelSelector].map(selector => Array.from(element.querySelectorAll(selector)).filter(node => node.closest('[data-widget_type]') === element));
        if (details.length !== 1 || triggers.length !== 1 || panels.length !== 1 || !(details[0] instanceof HTMLDetailsElement) || !(triggers[0] instanceof HTMLElement) || triggers[0].tagName !== 'SUMMARY') throw Error('Disclosure mapping is ambiguous or escapes its exact native owner');
        const detail = details[0] as HTMLDetailsElement, summary = triggers[0], panel = panels[0];
        if (summary.parentElement !== detail || Array.from(detail.children).find(child => child.tagName === 'SUMMARY') !== summary || !detail.contains(panel) || summary.contains(panel) || summary.closest('form') || summary.querySelector('a[href],button,input,select,textarea')) throw Error('Disclosure trigger/panel is not a safe native summary relationship');
        const aria = summary.getAttribute('aria-expanded'), controls = summary.getAttribute('aria-controls')?.trim();
        if (!['true', 'false'].includes(aria ?? '') || !controls || /\s/.test(controls)) throw Error('Disclosure requires synchronized aria-expanded and one aria-controls relationship');
        const controlled = Array.from(document.querySelectorAll('[id]')).filter(node => node.id === controls);
        if (controlled.length !== 1 || controlled[0] !== detail && controlled[0] !== panel) throw Error('Disclosure aria-controls does not uniquely identify its own details or panel');
        const box = panel.getBoundingClientRect();
        let visible = box.width > 0 && box.height > 0 && Boolean(panel.getClientRects().length);
        for (let node: Element | null = panel; node; node = node.parentElement) {
          const css = getComputedStyle(node);
          if (css.display === 'none' || css.contentVisibility === 'hidden' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0 || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') visible = false;
          if (node instanceof HTMLDetailsElement && !node.open) visible = false;
        }
        return { expanded: detail.open, ariaExpanded: aria === 'true', controlsId: controls, controlsTarget: controlled[0] === detail ? 'details' : 'panel', panelVisible: visible, triggerFocused: document.activeElement === summary };
      }, check);
}

/** Only trusted user input changes disclosure state. The checker never sets
 * open/ARIA/style or invokes a widget runtime to manufacture a passing state. */
export async function collectNative44DisclosureChecks(page: Page, checks: Native44DisclosureCheck[], viewport: string): Promise<Native44DisclosureEvidence[]> {
  validateNative44DisclosureChecks(checks);
  const savedScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY })), evidence: Native44DisclosureEvidence[] = [];
  try {
    for (const check of checks.filter(item => !item.viewports || item.viewports.includes(viewport))) {
      const row: Native44DisclosureEvidence = { componentKey: check.componentKey, viewport, selector: check.selector, widgetType: check.widgetType, status: 'unverified', problems: [], actions: [] }; evidence.push(row);
      const root = page.locator(check.selector), trigger = root.locator(check.triggerSelector);
      let foreignBefore: string | undefined;
      const foreignState = () => root.evaluate(element => JSON.stringify(Array.from(document.querySelectorAll('details')).filter(details => details.closest('[data-widget_type]') !== element).map(details => ({ owner: details.closest('[data-widget_type]')?.getAttribute('data-id'), id: details.id, open: details.open }))));
      const state = () => readNative44DisclosureState(page, check);
      const wait = async (expected?: boolean): Promise<Native44DisclosureState> => {
        const deadline = Date.now() + 2500; let signature = '', stable = 0, last: Native44DisclosureState | undefined;
        while (Date.now() < deadline) {
          last = await state();
          if (last.expanded === last.ariaExpanded && last.expanded === last.panelVisible && (expected === undefined || last.expanded === expected)) { const next = JSON.stringify(last); stable = next === signature ? stable + 1 : 1; signature = next; if (stable >= 2) return last; } else stable = 0;
          await page.waitForTimeout(60);
        }
        throw Error(`Disclosure did not establish synchronized open, ARIA and visible panel state${expected === undefined ? '' : ` (${expected ? 'expanded' : 'collapsed'})`}`);
      };
      try {
        if (await root.count() !== 1 || await root.getAttribute('data-widget_type') !== `${check.widgetType}.default`) throw Error('Disclosure requires one exact registered native widget owner');
        row.elementId = await root.getAttribute('data-id') ?? undefined;
        if (!row.elementId || !await root.isVisible() || await trigger.count() !== 1 || !await trigger.isVisible()) throw Error('Native disclosure owner/summary is not uniquely visible at this viewport');
        await trigger.scrollIntoViewIfNeeded();
        row.before = await wait(); foreignBefore = await foreignState();
        for (const input of ['click', 'Enter', 'Space'] as const) {
          for (const expected of [!row.before.expanded, row.before.expanded]) {
            if (input === 'click') await trigger.click({ timeout: 3000 });
            else { await trigger.focus(); if (!await trigger.evaluate(element => document.activeElement === element)) throw Error('Disclosure keyboard trigger cannot receive focus'); await trigger.press(input, { timeout: 3000 }); }
            const observed = await wait(expected); row.actions.push({ input, expanded: observed.expanded });
            if (input !== 'click' && !observed.triggerFocused) throw Error('Disclosure lost keyboard focus after activation');
            if (await foreignState() !== foreignBefore) throw Error('Disclosure activation changed another native owner');
          }
        }
        row.restored = await wait(row.before.expanded); row.status = 'passed';
      } catch (error) { row.status = 'failed'; row.problems.push(error instanceof Error ? error.message : 'Native disclosure interaction failed'); }
      finally {
        if (row.before && row.status !== 'passed') {
          try { const current = await state(); if (current.expanded !== row.before.expanded) await trigger.click({ timeout: 3000 }); row.restored = await wait(row.before.expanded); if (foreignBefore !== undefined && await foreignState() !== foreignBefore) throw Error('Another native disclosure owner was not preserved'); }
          catch (error) { row.problems.push(`Disclosure restoration failed: ${error instanceof Error ? error.message : 'unknown state'}`); }
        }
      }
    }
  } finally { await page.evaluate(point => scrollTo({ left: point.x, top: point.y, behavior: 'instant' }), savedScroll); }
  return evidence;
}

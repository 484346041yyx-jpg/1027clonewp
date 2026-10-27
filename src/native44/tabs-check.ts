import type { Page } from 'playwright';
import { readNative44DisclosureState, type Native44DisclosureCheck } from './disclosure-check.js';

export type Native44TabsItem = { key: string } & ({ label: string; tabSelector?: never; panelSelector?: never } | { label?: never; tabSelector: string; panelSelector: string });
export interface Native44TabsCheck {
  componentKey: string; selector: string; widgetType: 'nested-tabs'; tablistSelector: string;
  items: Native44TabsItem[];
  viewports?: string[];
  /** A separately declared exact disclosure may reveal nested tabs for testing. */
  revealDisclosureKey?: string;
}
export interface Native44TabsBinding { key: string; tabId: string; panelId: string; label: string; panelRole: string; ariaLabelledby: string; labelledByIds: string[]; compoundARIA: boolean }
export interface Native44TabsState { selectedKey: string; visiblePanelKeys: string[]; focusedKey?: string; orientation: 'horizontal' | 'vertical'; bindings: Native44TabsBinding[]; disclosureContext?: { componentKey: string; controlsId: string; summaryId?: string } }
export interface Native44TabsEvidence {
  componentKey: string; viewport: string; selector: string; widgetType: string; elementId?: string;
  status: 'passed' | 'failed' | 'unverified'; problems: string[];
  actions: Array<{ input: 'click' | 'Home' | 'End' | 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Space'; key: string; focused: boolean }>;
  before?: Native44TabsState; restored?: Native44TabsState;
  reveal?: { componentKey: string; expandedBefore: boolean; restored: boolean };
  /** Relationship and behavior observations do not establish spoken semantics. */
  screenReaderVerification: 'unverified';
}

export function validateNative44TabsChecks(checks: Native44TabsCheck[], disclosures: Native44DisclosureCheck[] = [], viewports?: string[]): void {
  if (new Set(checks.map(check => check.componentKey)).size !== checks.length) throw Error('Tabs checks require unique component identities');
  for (const check of checks) {
    if (!check.componentKey?.trim() || !check.selector?.trim() || check.widgetType !== 'nested-tabs' || !check.tablistSelector?.trim() || !Array.isArray(check.items) || check.items.length < 2 || check.items.some(item => !item.key?.trim() || (item.label !== undefined ? !item.label.trim() || item.tabSelector !== undefined || item.panelSelector !== undefined : !item.tabSelector?.trim() || !item.panelSelector?.trim())) || new Set(check.items.map(item=>item.key)).size !== check.items.length || new Set(check.items.map(item=>item.label !== undefined ? `label:${item.label.replace(/\s+/g,' ').trim()}` : `selector:${item.tabSelector}`)).size !== check.items.length || new Set(check.items.filter(item=>item.panelSelector !== undefined).map(item=>item.panelSelector)).size !== check.items.filter(item=>item.panelSelector !== undefined).length) throw Error('Tabs check requires one exact native owner and unique explicit tab/panel or label mappings');
    if (check.viewports && (!check.viewports.length || new Set(check.viewports).size !== check.viewports.length || check.viewports.some(name => !name?.trim() || viewports && !viewports.includes(name)))) throw Error('Tabs check has invalid viewport coverage');
    if (check.revealDisclosureKey && !disclosures.some(disclosure => disclosure.componentKey === check.revealDisclosureKey && (!disclosure.viewports || (check.viewports ?? viewports ?? []).every(viewport => disclosure.viewports!.includes(viewport))))) throw Error('Tabs reveal disclosure has no exact declared owner/viewport binding');
  }
}

export function native44TabsEvidencePassed(row: Native44TabsEvidence, check: Native44TabsCheck): boolean {
  if (row.status !== 'passed' || row.problems.length || !row.elementId || row.componentKey !== check.componentKey || row.selector !== check.selector || row.widgetType !== check.widgetType || !row.before || !row.restored || row.before.selectedKey !== row.restored.selectedKey || row.before.orientation !== row.restored.orientation || row.before.visiblePanelKeys.length !== 1 || row.before.visiblePanelKeys[0] !== row.before.selectedKey || row.restored.visiblePanelKeys.length !== 1 || row.restored.visiblePanelKeys[0] !== row.restored.selectedKey || !check.items.some(item => item.key === row.before!.selectedKey) || check.revealDisclosureKey && (row.reveal?.componentKey !== check.revealDisclosureKey || row.reveal.restored !== true)) return false;
  const bindings=row.before.bindings;
  if (!Array.isArray(bindings) || bindings.length !== check.items.length || new Set(bindings.map(item=>item.tabId)).size !== bindings.length || new Set(bindings.map(item=>item.panelId)).size !== bindings.length || JSON.stringify(bindings) !== JSON.stringify(row.restored.bindings) || check.items.some((item,index)=>bindings[index].key !== item.key || !/^[A-Za-z0-9_-]+$/.test(bindings[index].tabId) || !bindings[index].panelId || item.label !== undefined && bindings[index].label !== item.label.replace(/\s+/g,' ').trim())) return false;
  const context=row.before.disclosureContext;
  if (row.screenReaderVerification !== 'unverified' || JSON.stringify(context) !== JSON.stringify(row.restored.disclosureContext) || check.revealDisclosureKey && (!context || context.componentKey !== check.revealDisclosureKey || !context.controlsId || /\s/.test(context.controlsId) || context.summaryId !== undefined && (!context.summaryId || /\s/.test(context.summaryId) || context.summaryId === context.controlsId)) || !check.revealDisclosureKey && context) return false;
  for (const binding of bindings) {
    if (typeof binding.panelRole !== 'string' || typeof binding.ariaLabelledby !== 'string' || !Array.isArray(binding.labelledByIds)) return false;
    const roles=binding.panelRole.trim().split(/\s+/), labelled=binding.ariaLabelledby.trim().split(/\s+/), compound=roles.length>1 || labelled.length>1;
    if (!roles.includes('tabpanel') || new Set(roles).size !== roles.length || roles.some(role=>role!=='tabpanel'&&role!=='region') || compound && !context || new Set(labelled).size !== labelled.length || !labelled.includes(binding.tabId) || JSON.stringify(labelled)!==JSON.stringify(binding.labelledByIds) || labelled.some(id=>!id || id!==binding.tabId && id!==context?.controlsId && id!==context?.summaryId) || binding.compoundARIA!==compound) return false;
  }
  const forward = row.before.orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight', previous = row.before.orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const expected = [...check.items.map(item => ({ input: 'click', key: item.key })), { input: 'Home', key: check.items[0].key }, { input: forward, key: check.items[1].key }, { input: previous, key: check.items[0].key }, { input: 'End', key: check.items[check.items.length - 1].key }, { input: 'Enter', key: check.items[0].key }, { input: 'Space', key: check.items[check.items.length - 1].key }];
  return row.actions.length === expected.length && expected.every((action, index) => row.actions[index].input === action.input && row.actions[index].key === action.key && (action.input === 'click' || row.actions[index].focused));
}

/** Native tab activation uses scoped real buttons and keyboard input. Panels
 * must follow the owned ARIA relationship and actual rendered visibility. */
export async function collectNative44TabsChecks(page: Page, checks: Native44TabsCheck[], viewport: string, disclosures: Native44DisclosureCheck[] = []): Promise<Native44TabsEvidence[]> {
  validateNative44TabsChecks(checks, disclosures);
  const savedScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY })), evidence: Native44TabsEvidence[] = [];
  try {
    for (const check of checks.filter(item => !item.viewports || item.viewports.includes(viewport))) {
      const row: Native44TabsEvidence = { componentKey: check.componentKey, viewport, selector: check.selector, widgetType: check.widgetType, status: 'unverified', problems: [], actions: [], screenReaderVerification: 'unverified' }; evidence.push(row);
      const root = page.locator(check.selector), reveal = check.revealDisclosureKey ? disclosures.find(item => item.componentKey === check.revealDisclosureKey)! : undefined;
      let foreignBefore: string | undefined;
      const foreignState = () => root.evaluate(element => JSON.stringify({ tabs: Array.from(document.querySelectorAll('[role="tab"]')).filter(tab => tab.closest('[data-widget_type]') !== element).map(tab => ({ id: tab.id, selected: tab.getAttribute('aria-selected') })), details: Array.from(document.querySelectorAll('details')).map(detail => ({ id: detail.id, open: detail.open })) }));
      const revealState = async (expanded: boolean) => { const deadline = Date.now() + 2500; while (Date.now() < deadline) { const state = await readNative44DisclosureState(page, reveal!); if (state.expanded === expanded && state.ariaExpanded === expanded && state.panelVisible === expanded) return; await page.waitForTimeout(60); } throw Error('Tabs reveal disclosure failed to establish its synchronized state'); };
      const state = (): Promise<Native44TabsState> => root.evaluate((element, args) => {
        const spec=args.spec;
        let disclosureContext: Native44TabsState['disclosureContext'];
        if (args.reveal) {
          const owners=Array.from(document.querySelectorAll(args.reveal.selector));
          if (owners.length!==1 || owners[0].getAttribute('data-widget_type')!==`${args.reveal.widgetType}.default`) throw Error('Native tabs have an ambiguous disclosure context');
          const [details,summaries,panels]=[args.reveal.detailsSelector,args.reveal.triggerSelector,args.reveal.panelSelector].map(selector=>Array.from(owners[0].querySelectorAll(selector)).filter(node=>node.closest('[data-widget_type]')===owners[0]));
          if(details.length!==1 || summaries.length!==1 || panels.length!==1 || !(details[0] instanceof HTMLDetailsElement) || summaries[0].tagName!=='SUMMARY' || summaries[0].parentElement!==details[0] || !details[0].contains(panels[0]) || !panels[0].contains(element)) throw Error('Native tabs are outside their exact declared disclosure panel context');
          const controls=summaries[0].getAttribute('aria-controls'), controlled=Array.from(document.querySelectorAll('[id]')).filter(node=>node.id===controls), summaryId=summaries[0].id;
          if(!controls || /\s/.test(controls) || controlled.length!==1 || controlled[0]!==details[0] && controlled[0]!==panels[0] || summaryId && (/\s/.test(summaryId) || Array.from(document.querySelectorAll('[id]')).filter(node=>node.id===summaryId).length!==1)) throw Error('Native tabs disclosure context has an invalid controls/summary ID relationship');
          disclosureContext={componentKey:args.reveal.componentKey,controlsId:controls,...(summaryId?{summaryId}:{})};
        }
        const lists = Array.from(element.querySelectorAll(spec.tablistSelector)).filter(node => node.closest('[data-widget_type]') === element);
        if (lists.length !== 1 || lists[0].getAttribute('role') !== 'tablist') throw Error('Tabs require one owned native tablist');
        const ownedTabs = Array.from(element.querySelectorAll('[role="tab"]')).filter(node => node.closest('[data-widget_type]') === element);
        if (ownedTabs.length !== spec.items.length) throw Error('Native tab inventory differs from its explicit mappings');
        const states = spec.items.map(item => {
          const tabs = item.label !== undefined ? ownedTabs.filter(tab => tab.textContent?.replace(/\s+/g, ' ').trim() === item.label.replace(/\s+/g, ' ').trim()) : Array.from(element.querySelectorAll(item.tabSelector!)).filter(node => node.closest('[data-widget_type]') === element);
          const controlsId = tabs.length === 1 ? tabs[0].getAttribute('aria-controls') : undefined;
          const panels = item.label !== undefined ? Array.from(element.querySelectorAll('[id]')).filter(node => node.id === controlsId && node.closest('[data-widget_type]') === element) : Array.from(element.querySelectorAll(item.panelSelector!)).filter(node => node.closest('[data-widget_type]') === element);
          if (tabs.length !== 1 || panels.length !== 1 || !(tabs[0] instanceof HTMLButtonElement) || tabs[0].getAttribute('role') !== 'tab' || !lists[0].contains(tabs[0]) || tabs[0].closest('form') || tabs[0].form !== null || ['form', 'formaction', 'formmethod', 'formtarget', 'formenctype', 'formnovalidate'].some(attribute => tabs[0].hasAttribute(attribute)) || tabs[0].hasAttribute('type') && tabs[0].getAttribute('type')!.toLowerCase() !== 'button') throw Error('Tabs mapping escapes its exact owner, has duplicate labels or is not a safe native tab/panel relationship');
          const tab = tabs[0], panel = panels[0], controls = tab.getAttribute('aria-controls'), labelled = panel.getAttribute('aria-labelledby'), selected = tab.getAttribute('aria-selected');
          const panelRole=panel.getAttribute('role')??'', roles=panelRole.trim().split(/\s+/), labelledByIds=(labelled??'').trim().split(/\s+/), compoundARIA=roles.length>1 || labelledByIds.length>1;
          if (!controls || controls !== panel.id || !labelled || !roles.includes('tabpanel') || new Set(roles).size!==roles.length || roles.some(role=>role!=='tabpanel'&&role!=='region') || compoundARIA && !disclosureContext || !labelledByIds.includes(tab.id) || new Set(labelledByIds).size!==labelledByIds.length || labelledByIds.some(id=>!id || id!==tab.id && id!==disclosureContext?.controlsId && id!==disclosureContext?.summaryId || Array.from(document.querySelectorAll('[id]')).filter(node=>node.id===id).length!==1) || !/^[A-Za-z0-9_-]+$/.test(tab.id) || !['true', 'false'].includes(selected ?? '') || [tab.id, panel.id].some(id => Array.from(document.querySelectorAll('[id]')).filter(node => node.id === id).length !== 1)) throw Error('Native tabs lack unique synchronized ARIA ownership or precise declared disclosure context');
          const box = panel.getBoundingClientRect(); let visible = box.width > 0 && box.height > 0 && Boolean(panel.getClientRects().length);
          for (let node: Element | null = panel; node; node = node.parentElement) { const css = getComputedStyle(node); if (css.display === 'none' || css.contentVisibility === 'hidden' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0 || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || node instanceof HTMLDetailsElement && !node.open) visible = false; }
          return { key: item.key, selected: selected === 'true', visible, focused: document.activeElement === tab, tabId: tab.id, panelId: panel.id, label: tab.textContent?.replace(/\s+/g, ' ').trim() ?? '', panelRole, ariaLabelledby:labelled, labelledByIds, compoundARIA };
        });
        const selected = states.filter(item => item.selected), visible = states.filter(item => item.visible), focused = states.filter(item => item.focused);
        if (selected.length !== 1 || visible.length !== 1 || selected[0].key !== visible[0].key) throw Error('Native tabs did not establish one selected tab and its actual visible panel');
        const orientation = lists[0].getAttribute('aria-orientation'); if (orientation !== null && !['horizontal', 'vertical'].includes(orientation)) throw Error('Native tablist has invalid orientation');
        return { selectedKey: selected[0].key, visiblePanelKeys: visible.map(item => item.key), ...(focused.length === 1 ? { focusedKey: focused[0].key } : {}), orientation: orientation === 'vertical' ? 'vertical' : 'horizontal', bindings: states.map(item=>({key:item.key,tabId:item.tabId,panelId:item.panelId,label:item.label,panelRole:item.panelRole,ariaLabelledby:item.ariaLabelledby!,labelledByIds:item.labelledByIds,compoundARIA:item.compoundARIA})), ...(disclosureContext?{disclosureContext}:{}) };
      }, {spec:check,reveal:reveal??null});
      const wait = async (key?: string, focused?: boolean): Promise<Native44TabsState> => { const deadline = Date.now() + 2500; let lastError: unknown, signature = '', stable = 0; while (Date.now() < deadline) { try { const observed = await state(), next = JSON.stringify(observed); if (row.before && (JSON.stringify(observed.bindings) !== JSON.stringify(row.before.bindings) || JSON.stringify(observed.disclosureContext)!==JSON.stringify(row.before.disclosureContext))) throw Error('Native tab/panel identity or disclosure context changed during interaction'); if ((key === undefined || observed.selectedKey === key) && (!focused || observed.focusedKey === key)) { stable = next === signature ? stable + 1 : 1; signature = next; if (stable >= 2) return observed; } else stable=0; } catch (error) { lastError = error; stable=0; } await page.waitForTimeout(60); } throw Error(`Native tabs activation/visibility/focus did not stabilize${lastError instanceof Error ? `: ${lastError.message}` : ''}`); };
      const tabFor = (key: string) => { const actual=row.before?.bindings.find(binding=>binding.key===key); if(!actual)throw Error('Native tab has no observed owner/ARIA binding');return root.locator(`[role="tab"][id="${actual.tabId}"]`); };
      try {
        if (await root.count() !== 1 || await root.getAttribute('data-widget_type') !== `${check.widgetType}.default`) throw Error('Tabs require one exact registered native widget owner');
        row.elementId = await root.getAttribute('data-id') ?? undefined;
        if (!row.elementId) throw Error('Native tabs owner has no stable element identity');
        if (reveal) {
          const disclosure = page.locator(reveal.selector);
          if (await disclosure.count() !== 1 || await disclosure.getAttribute('data-widget_type') !== `${reveal.widgetType}.default` || !await root.evaluate((element, ownerSelector) => Boolean(element.closest(ownerSelector)), reveal.selector)) throw Error('Tabs reveal declaration is not its exact native ancestor owner');
          const before = await readNative44DisclosureState(page, reveal); row.reveal = { componentKey: reveal.componentKey, expandedBefore: before.expanded, restored: false };
          if (!before.expanded) await disclosure.locator(reveal.triggerSelector).click({ timeout: 3000 }); await revealState(true);
        }
        if (!await root.isVisible()) throw Error('Required native tabs are not visible at this viewport');
        row.before = await wait(); foreignBefore = await foreignState();
        for (const item of check.items) { await tabFor(item.key).click({ timeout: 3000 }); const observed = await wait(item.key); row.actions.push({ input: 'click', key: item.key, focused: observed.focusedKey === item.key }); if (await foreignState() !== foreignBefore) throw Error('Tabs activation changed another native owner'); }
        const first = check.items[0], last = check.items[check.items.length - 1], forward = row.before.orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight', backward = row.before.orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
        for (const [input, expected] of [['Home', first], [forward, check.items[1]], [backward, first], ['End', last], ['Enter', first], ['Space', last]] as const) {
          const current = await wait(), focused = check.items.find(item => item.key === current.focusedKey) ?? check.items.find(item => item.key === current.selectedKey)!;
          const control = tabFor(input === 'Enter' || input === 'Space' ? expected.key : focused.key); await control.focus(); await control.press(input, { timeout: 3000 });
          if (input !== 'Enter' && input !== 'Space') { const deadline = Date.now() + 1500; while (Date.now() < deadline && !await tabFor(expected.key).evaluate(element => element === document.activeElement)) await page.waitForTimeout(50); if (!await tabFor(expected.key).evaluate(element => element === document.activeElement)) throw Error(`Native tabs ${input} did not move keyboard focus`); const observed = await state(); if (observed.selectedKey !== expected.key) await tabFor(expected.key).press('Enter', { timeout: 3000 }); }
          await wait(expected.key, true); row.actions.push({ input, key: expected.key, focused: true }); if (await foreignState() !== foreignBefore) throw Error('Tabs keyboard activation changed another native owner');
        }
      } catch (error) { row.problems.push(error instanceof Error ? error.message : 'Native tabs interaction failed'); }
      finally {
        if (row.before) { try { const initial = check.items.find(item => item.key === row.before!.selectedKey)!; await tabFor(initial.key).click({ timeout: 3000 }); row.restored = await wait(initial.key); if (foreignBefore !== undefined && await foreignState() !== foreignBefore) throw Error('Another native owner was not preserved'); } catch (error) { row.problems.push(`Tabs restoration failed: ${error instanceof Error ? error.message : 'unknown state'}`); } }
        if (reveal && row.reveal) { try { const current = await readNative44DisclosureState(page, reveal); if (current.expanded !== row.reveal.expandedBefore) await page.locator(reveal.selector).locator(reveal.triggerSelector).click({ timeout: 3000 }); await revealState(row.reveal.expandedBefore); row.reveal.restored = true; } catch (error) { row.problems.push(`Tabs reveal restoration failed: ${error instanceof Error ? error.message : 'unknown state'}`); } }
      }
      row.status = row.problems.length ? 'failed' : 'passed';
      if (row.status === 'passed' && !native44TabsEvidencePassed(row, check)) { row.status = 'failed'; row.problems.push('Native tabs activation proof is incomplete'); }
    }
  } finally { await page.evaluate(point => scrollTo({ left: point.x, top: point.y, behavior: 'instant' }), savedScroll); }
  return evidence;
}

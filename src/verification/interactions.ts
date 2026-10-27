import type { Locator, Page } from 'playwright';
import { normalizeBindings, targetSelector } from './bindings.js';
import type { ElementMap, SourceInteractionEvidence, TargetInteractionEvidence, ToggleState } from './types.js';

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
function sameState(a: ToggleState, b: ToggleState): boolean {
  return a.expanded === b.expanded && a.detailsOpen === b.detailsOpen && a.contentVisible === b.contentVisible;
}
function changedState(a: ToggleState, b: ToggleState): boolean {
  const changedToggle = (a.expanded !== null && b.expanded !== null && a.expanded !== b.expanded) || (a.detailsOpen !== null && b.detailsOpen !== null && a.detailsOpen !== b.detailsOpen);
  return changedToggle && a.contentVisible !== null && b.contentVisible !== null && a.contentVisible !== b.contentVisible;
}
async function state(control: Locator, content: Locator): Promise<ToggleState> {
  const toggle = await control.evaluate(element => ({ expanded: element.getAttribute('aria-expanded'), detailsOpen: element.closest('details')?.open ?? null }));
  const contentVisible = await content.count() ? await content.first().evaluate(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }) : null;
  return { ...toggle, contentVisible };
}
async function controlledContent(control: Locator, root: Locator, isMenu: boolean): Promise<Locator> {
  const controls = (await control.getAttribute('aria-controls'))?.split(/\s+/).filter(id => /^[\w:-]+$/.test(id));
  let content = controls?.length ? control.page().locator(controls.map(id => `[id="${id}"]`).join(',')).first() : root.locator(':scope > .never-a-real-element');
  if (!await content.count()) {
    if (await control.evaluate(element => element.matches('summary'))) content = control.locator('..').locator(':scope > :not(summary)').first();
    else if (isMenu) content = root.locator('.elementor-nav-menu--dropdown').first();
    else content = control.locator('..').locator('.elementor-tab-content').first();
  }
  return content;
}

/** Clicks only evidenced native FAQ/details/menu toggles; never submits forms or activates action/commerce buttons. */
export async function verifySafeToggles(page: Page, elementMap: ElementMap, interactions: SourceInteractionEvidence[]): Promise<TargetInteractionEvidence[]> {
  const bindings = new Map(normalizeBindings(elementMap).map(binding => [binding.sourceId,binding]));
  const reports: TargetInteractionEvidence[] = [];
  for (const interaction of interactions.filter(item => !item.disabled && (item.expanded !== undefined || item.controls || item.tag === 'summary')).slice(0, 20)) {
    const binding = bindings.get(interaction.sourceNodeId);
    const report: TargetInteractionEvidence = { sourceNodeId: interaction.sourceNodeId, targetId: binding?.targetId, kind: 'toggle', status: 'unverified', clicked: false, restored: false };
    reports.push(report);
    if (!binding) { report.error = 'No native target mapping exists for this toggle.'; continue; }
    const root = page.locator(targetSelector(binding)).first();
    if (!await root.isVisible()) { report.error = 'The mapped toggle is not visible at this viewport.'; continue; }
    const widgetType = await root.evaluate(element => element.closest('[data-widget_type]')?.getAttribute('data-widget_type')?.split('.')[0] ?? '');
    const nativeScope = await root.evaluate(element => !!element.closest('.elementor, [data-elementor-type]') && !!element.closest('[data-id], .elementor-element'));
    const isAccordion = ['accordion','toggle','nested-accordion'].includes(widgetType) || await root.locator('.elementor-accordion,.elementor-toggle,.e-n-accordion').count() > 0;
    const isMenu = widgetType === 'nav-menu' || await root.locator('.elementor-menu-toggle').count() > 0;
    const hasDetails = interaction.tag === 'summary' && (await root.locator('details summary').count() > 0 || await root.evaluate(element => element.matches('summary') && !!element.closest('details')));
    if (!nativeScope || widgetType === 'html' || (!isAccordion && !isMenu && !hasDetails)) { report.status = 'unsupported'; report.error = 'Only evidenced native accordion, details and menu toggles can be clicked automatically.'; continue; }
    // Menu item links are deliberately excluded: the menu opener has no navigation or submission action.
    const selector = isMenu ? '.elementor-menu-toggle' : '.elementor-tab-title,.e-n-accordion-item-title,summary';
    let candidates = root.locator(selector);
    if (await root.evaluate((element, candidateSelector) => element.matches(candidateSelector), selector)) candidates = root;
    const matches: Locator[] = [];
    for (let index = 0; index < await candidates.count(); index++) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible()) continue;
      const text = normalize(await candidate.innerText());
      if ((interaction.text && text && (text.includes(normalize(interaction.text)) || normalize(interaction.text).includes(text))) || (!interaction.text && await candidates.count() === 1)) matches.push(candidate);
    }
    if (matches.length !== 1) { report.error = 'The source text does not uniquely identify a safe native toggle.'; continue; }
    const control = matches[0];
    const controlWidgetType = await control.evaluate(element => element.closest('[data-widget_type]')?.getAttribute('data-widget_type')?.split('.')[0] ?? '');
    if (!hasDetails && ((isMenu && controlWidgetType !== 'nav-menu') || (!isMenu && !['accordion','toggle','nested-accordion'].includes(controlWidgetType)))) { report.status = 'unsupported'; report.error = 'The candidate does not belong to a registered native accordion or menu widget.'; continue; }
    const href = await control.getAttribute('href');
    const tag = await control.evaluate(element => element.tagName.toLowerCase());
    if (['input','form'].includes(tag) || (tag === 'button' && (await control.getAttribute('type')) === 'submit') || (href && href !== '#' && !href.startsWith('#'))) { report.status = 'unsupported'; report.error = 'The candidate is a navigation, submit or action control rather than a safe local toggle.'; continue; }
    const content = await controlledContent(control,root,isMenu);
    const before = await state(control,content);
    report.before = before;
    if(before.contentVisible) report.controlledContentText=normalize(await content.innerText());
    if ((before.expanded !== 'true' && before.expanded !== 'false' && before.detailsOpen === null) || before.contentVisible === null) { report.error = 'The toggle state and its controlled content visibility cannot both be measured.'; continue; }
    const related: Array<{ control: Locator; content: Locator; before: ToggleState; text: string }> = [];
    if (isAccordion || hasDetails) {
      // Exclusive accordions may close another initially open item when the tested item opens.
      for (let index=0; index<Math.min(await candidates.count(),50); index++) {
        const sibling = candidates.nth(index);
        if (!await sibling.isVisible()) continue;
        const siblingContent = await controlledContent(sibling,root,false);
        const siblingState = await state(sibling,siblingContent);
        if (siblingState.contentVisible !== null && (['true','false'].includes(siblingState.expanded ?? '') || siblingState.detailsOpen !== null)) related.push({ control:sibling,content:siblingContent,before:siblingState,text:normalize(await sibling.innerText()) });
      }
    }
    const originalUrl = page.url();
    try {
      await control.click({ timeout: 5_000 });
      report.clicked = true;
      let after = await state(control,content);
      for (let attempt=0; attempt<10 && !changedState(before,after); attempt++) { await page.waitForTimeout(100); after = await state(control,content); }
      report.after = after;
      if(after.contentVisible) report.controlledContentText=normalize(await content.innerText());
      if (page.url() !== originalUrl) throw new Error('A supposed native toggle changed the page URL.');
      if (!changedState(before,after)) throw new Error('Clicking the native toggle did not change both its expanded/open state and controlled content visibility.');
      report.status = 'verified';
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (report.clicked) {
        try {
          let current = await state(control,content);
          if (!sameState(before,current)) {
            await control.click({ timeout: 5_000 });
            current = await state(control,content);
            for (let attempt=0; attempt<10 && !sameState(before,current); attempt++) { await page.waitForTimeout(100); current = await state(control,content); }
          }
          for (let pass=0; pass<2; pass++) for (const sibling of related) {
            let siblingState = await state(sibling.control,sibling.content);
            if (!sameState(sibling.before,siblingState)) {
              await sibling.control.click({timeout:5_000});
              for (let attempt=0; attempt<10; attempt++) {
                siblingState=await state(sibling.control,sibling.content);
                if (sameState(sibling.before,siblingState)) break;
                await page.waitForTimeout(100);
              }
            }
          }
          report.scopeRestoration=[];
          let scopeRestored=true;
          for (const sibling of related) {
            const after=await state(sibling.control,sibling.content);
            report.scopeRestoration.push({text:sibling.text,before:sibling.before,after});
            if (!sameState(sibling.before,after)) scopeRestored=false;
          }
          current=await state(control,content);
          report.restoration = current;
          report.restored = sameState(before,current) && scopeRestored && page.url() === originalUrl;
          if (!report.restored) { report.status = 'failed'; report.error = 'The native toggle did not restore its original state and content visibility.'; }
        } catch (error) { report.status = 'failed'; report.error = `Toggle restoration failed: ${error instanceof Error ? error.message : String(error)}`; }
      }
    }
  }
  await page.evaluate(() => window.scrollTo(0,0));
  return reports;
}

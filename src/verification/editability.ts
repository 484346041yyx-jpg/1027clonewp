import { leaseVerificationEditor } from '../editor-completion/session.js';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Cookie, type Locator, type Page } from 'playwright';
import { normalizeBindings, targetSelector } from './bindings.js';
import { createScopedContext } from './capture-target.js';
import type { ElementMap, NativeEditabilityReport } from './types.js';
import { attachEditorStartupNetwork, awaitNativeEditorReady } from './editor-readiness.js';

export interface EditorVerificationOptions {
  editorUrl: string;
  previewUrl: string;
  pageId: number;
  runDir: string;
  cookies?: Cookie[];
  widgetMap: ElementMap;
  browser?: Browser;
  imageReplacement?: { attachmentId: number; url: string };
  /** Defaults to title + native style, and image when a mapped image is present. */
  requiredFields?: Array<'title' | 'content' | 'style' | 'image'>;
  /** Caller restores its owned WordPress + Elementor snapshot and returns whether the read-back hash matches. */
  restore?: (edits:AuthorizedEditorEdit[]) => Promise<boolean>;
}
export interface AuthorizedEditorEdit {targetId:string;setting:string;value:unknown}

export function unverifiedEditability(reason = 'Native editor modification, save, frontend confirmation and snapshot restoration have not been exercised.'): NativeEditabilityReport {
  return { status: 'unverified', requiredFields: ['title','style'], verifiedFields: [], checks: [], issues: [{ code: 'editor-editability-unverified', status: 'unverified', severity: 'error', message: reason }], screenshots: [] };
}

export async function saveDraftThroughUI(page: Page, beforeClick?: () => void): Promise<void> {
  // Save Draft is used deliberately: the primary Publish button must never be clicked on a new draft.
  const draftName=/^(Save Draft|保存草稿|儲存草稿)$/;
  const modernDraft=page.locator('[role="menuitem"]:visible').filter({hasText:draftName}).first();
  const classicDraft=page.locator('#elementor-panel-saver-menu-save-draft:visible').or(page.getByRole('button',{name:draftName})).first();
  if (!await modernDraft.isVisible() && !await classicDraft.isVisible()) {
    const menu = page.locator('#elementor-panel-saver-button-save-options, [aria-label="Save Options"], [aria-label="Save options"], [aria-label="保存选项"], [aria-label="儲存選項"]').first();
    if (await menu.isVisible()) await menu.click();
  }
  // React Save Draft stays aria-disabled while the control change is debouncing; click waits for enabled.
    if (await modernDraft.isVisible()) { beforeClick?.(); await modernDraft.click({timeout:15_000}); return; }
    if (await classicDraft.isVisible()) { beforeClick?.(); await classicDraft.click({timeout:15_000}); return; }
  const safeSave = page.getByRole('button', { name: /^(Update|Save Changes|Save Draft|更新|保存更改|保存修改|保存草稿|儲存變更|儲存草稿)$/i }).first();
    if (await safeSave.isVisible()) { beforeClick?.(); await safeSave.click(); return; }
  throw new Error('A safe Save Draft/Update control is not available; the Publish button was not used.');
}

async function waitForNavigatorAnimation(page: Page): Promise<void> {
  // Installed Elementor 3.33.2 uses jQuery slideDown/slideUp(300) in Navigator.toggleList.
  // Reading its animation state avoids treating a collapsing row as selectable.
  await page.waitForFunction(() => {
    const jquery = (window as unknown as { jQuery?: (selector: string) => { is: (selector: string) => boolean } }).jQuery;
    return !jquery || !jquery('#elementor-navigator .elementor-navigator__elements').is(':animated');
  }, undefined, { timeout: 5_000 });
}

export async function selectNativeWidget(widget: Locator, page: Page): Promise<void> {
  const id = await widget.getAttribute('data-id');
  if (id && /^[\w-]+$/.test(id) && await page.locator('#elementor-navigator').isVisible()) {
    const node = page.locator(`#elementor-navigator .elementor-navigator__element[data-id="${id}"]`).first();
    if (await node.count()) {
      await waitForNavigatorAnimation(page);
      // The actual editor updates toggle-all state through jQuery.data(), leaving its HTML
      // data-elementor-action attribute stale. Expand only this row's observed ancestor carets.
      const ancestorIds = await node.evaluate(element => {
        const ids: string[] = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (parent.id === 'elementor-navigator') break;
          const parentId = parent.getAttribute('data-id');
          if (parent.classList.contains('elementor-navigator__element') && parentId && /^[\w-]+$/.test(parentId)) ids.push(parentId);
        }
        return ids.reverse();
      });
      for (const ancestorId of ancestorIds) {
        const ancestor = page.locator(`#elementor-navigator .elementor-navigator__element[data-id="${ancestorId}"]`).first();
        const item = ancestor.locator(':scope > .elementor-navigator__item');
        const ancestorVisible = await item.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
        if (!ancestorVisible) break;
        if (!await item.evaluate(element => element.classList.contains('elementor-active'))) {
          const caret = item.locator(':scope > .elementor-navigator__element__list-toggle');
          if (!await caret.isVisible()) break;
          await caret.click({ timeout: 5_000 });
          await page.waitForFunction(parentId => document.querySelector(`#elementor-navigator .elementor-navigator__element[data-id="${parentId}"] > .elementor-navigator__item`)?.classList.contains('elementor-active') === true, ancestorId, { timeout: 5_000 });
          await waitForNavigatorAnimation(page);
        }
      }
      const item = node.locator(':scope > .elementor-navigator__item');
      // A flat older/fixture Navigator may expose only Expand All. Consult its current
      // runtime state, never the stale attribute when jQuery is present, and never toggle
      // already-visible target rows.
      if (!await item.isVisible() && !ancestorIds.length) {
        const expandAll = page.locator('#elementor-navigator__toggle-all');
        const action = await expandAll.count() ? await expandAll.evaluate(element => {
          const jquery = (window as unknown as { jQuery?: (element: Element) => { data: (key: string) => unknown } }).jQuery;
          return jquery ? jquery(element).data('elementor-action') : element.getAttribute('data-elementor-action');
        }) : undefined;
        if (action === 'expand' && await expandAll.isVisible()) {
          await expandAll.click({ timeout: 5_000 });
          await waitForNavigatorAnimation(page);
        }
      }
      const visible = await item.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
      if (visible) {
        await item.click({ timeout: 5_000 });
        return;
      }
    }
  }
  await widget.hover();
  const pencil = widget.locator('.elementor-editor-element-edit').first();
  if (await pencil.isVisible()) { await pencil.click(); return; }
  const content = widget.locator('.elementor-heading-title,.elementor-button,img,h1,h2,h3,h4,h5,h6').first();
  if (await content.isVisible()) { await content.dblclick(); return; }
  await widget.dblclick();
}

/**
 * Exercises native content, image and style controls through the classic Elementor editor UI.
 * Unknown editor modes remain explicitly unverified; DOM structure is not substituted for an editing test.
 */
export async function verifyNativeEditor(options: EditorVerificationOptions): Promise<NativeEditabilityReport> {
  if (!options.restore) return unverifiedEditability('A verified owned-page snapshot restoration callback is required before temporary editor changes.');
  const editor = new URL(options.editorUrl), preview = new URL(options.previewUrl);
  if (editor.origin !== preview.origin || editor.searchParams.get('post') !== String(options.pageId) || editor.searchParams.get('action') !== 'elementor') throw new Error('The editor URL must identify the owned page on the preview origin.');
  const bindings = normalizeBindings(options.widgetMap);
  if (!bindings.length) return unverifiedEditability('No mapped native widget is available for an editor modification test.');
  const requiredFields = options.requiredFields ?? ['title','style', ...(bindings.some(binding => binding.kind === 'image') ? ['image' as const] : [])];
  if (!requiredFields.length) return unverifiedEditability('At least one applicable editor field test is required.');
  const ownedBrowser = !options.browser;
  const browser = options.browser ?? await chromium.launch({ headless: true });
  const lease = await leaseVerificationEditor(browser, options.editorUrl, { cookies: options.cookies }).catch(async error => { if (ownedBrowser) await browser.close(); throw error; });
  const context = lease.context;
  const report: NativeEditabilityReport = { status: 'unverified', requiredFields, verifiedFields: [], checks: [], issues: [], screenshots: [] };
  const directory = path.join(options.runDir, 'verification', 'editor');
  await mkdir(directory, { recursive: true });
  let mutated = false, restored = false;
  const marker = `cloneWP edit check ${Date.now()}`;
  let original = '';
  const restorationProbes: Array<{ selector: string; property?: string; value: string }> = [];
  const authorizedEdits:AuthorizedEditorEdit[]=[];
  try {
    const page = lease.page;
    const startupResponses = attachEditorStartupNetwork(page);
    await lease.navigate();
    if (new URL(page.url()).origin !== editor.origin || /wp-login\.php/.test(page.url())) throw new Error('The authenticated browser did not reach the owned Elementor editor.');
    const frame = page.frameLocator('#elementor-preview-iframe');
    await awaitNativeEditorReady({ page, editorUrl: options.editorUrl, rootIds: [bindings[0].targetId!], runDir: options.runDir, label: 'fields', responses: startupResponses });
    const widgetSelectors = bindings.flatMap(binding => targetSelector(binding).split(',').map(selector => `${selector.trim()}:visible`)).join(',');
    // Elementor shows its iframe during a loading splash before widgets become selectable.
    await frame.locator(widgetSelectors).first().waitFor({ state: 'visible', timeout: 10_000 });
    let selected: typeof bindings[number] | undefined;
    let fallbackHeading: typeof bindings[number] | undefined;
    let textEditor: typeof bindings[number] | undefined;
    for (const binding of bindings) {
      const widget = frame.locator(targetSelector(binding)).first();
      if (!await widget.isVisible()) continue;
      const widgetType = (await widget.getAttribute('data-widget_type'))?.split('.')[0];
      if (!binding.kind && ['image','button','heading','text-editor'].includes(widgetType ?? '')) binding.kind = widgetType;
      if (!textEditor && (widgetType==='text-editor' || binding.kind==='text-editor')) textEditor=binding;
      if (!selected && (widgetType === 'heading' || binding.kind === 'heading')) selected = binding;
      else if (!fallbackHeading && !widgetType && await widget.locator('h1,h2,h3,h4,h5,h6,.elementor-heading-title').count()) fallbackHeading = binding;
    }
    selected ??= fallbackHeading;
    const contentField: 'title'|'content'=selected ? 'title' : 'content';
    selected ??= textEditor;
    if (!options.requiredFields && contentField==='content') requiredFields.splice(requiredFields.indexOf('title'),1,'content');
    if (!options.requiredFields && bindings.some(binding => binding.kind === 'image') && !requiredFields.includes('image')) requiredFields.push('image');
    if (!selected) throw new Error('No mapped native heading or text-editor widget can be selected in the editor preview.');
    await selectNativeWidget(frame.locator(targetSelector(selected)).first(),page);
    const frontend = await context.newPage();
    const saveAndConfirm = async (check: NativeEditabilityReport['checks'][number], predicate: () => Promise<boolean>, file: string) => {
      await saveDraftThroughUI(page);
      let confirmed = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        await frontend.goto(options.previewUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (await predicate()) { confirmed = true; break; }
        await page.waitForTimeout(750);
      }
      check.saved = confirmed;
      check.frontendConfirmed = confirmed;
      const screenshot = path.join(directory, file);
      await frontend.screenshot({ path: screenshot, fullPage: true });
      report.screenshots.push(screenshot);
      if (!confirmed) throw new Error(`Native ${check.field} modification did not appear in the saved frontend within the bounded verification window.`);
    };
    if (requiredFields.includes('title') || requiredFields.includes('content')) {
      if (requiredFields.includes('title') && contentField!=='title') throw new Error('A heading title test was requested, but this page has no mapped native heading.');
      const check = { sourceId: selected.sourceId, field: contentField, selected: true, changed: false, saved: false, frontendConfirmed: false, restored: false };
      report.checks.push(check);
      if (contentField==='content') {
        const htmlTab=page.locator('#elementor-panel .wp-switch-editor.switch-html').first();
        if (await htmlTab.isVisible()) await htmlTab.click();
      }
      const field = contentField==='title' ? page.locator('#elementor-panel textarea[data-setting="title"], #elementor-panel input[data-setting="title"], textarea[data-setting="title"]').first() : page.locator('#elementor-panel textarea[data-setting="editor"], #elementor-panel textarea.elementor-wp-editor').first();
      await field.waitFor({ state: 'visible', timeout: 10_000 });
      original = await field.inputValue();
      mutated = true;
      authorizedEdits.push({targetId:selected.targetId!,setting:contentField==='content'?'editor':'title',value:marker});
      await field.fill(marker);
      await field.press('Tab');
      check.changed = true;
      await saveAndConfirm(check, async () => (await frontend.locator('body').innerText()).includes(marker), `${contentField}-modification.png`);
    }
    if (requiredFields.includes('image')) {
      const imageBinding = bindings.find(binding => binding.kind === 'image');
      if (!imageBinding || !options.imageReplacement) throw new Error('Image editing is required, but a mapped image and registered replacement attachment were not supplied.');
      const widget = frame.locator(targetSelector(imageBinding)).first();
      const image = widget.locator('img').first();
      const before = await image.getAttribute('src');
      const canonical = (url: string) => new URL(url, options.previewUrl).pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, '');
      if (before && canonical(before) === canonical(options.imageReplacement.url)) throw new Error('Image editing requires a distinct replacement attachment, not the currently displayed source image.');
      restorationProbes.push({ selector: `${targetSelector(imageBinding).split(',')[0]} img`, property: 'src', value: before ?? '' });
      await selectNativeWidget(widget,page);
      const check = { sourceId: imageBinding.sourceId, field: 'image', selected: true, changed: false, saved: false, frontendConfirmed: false, restored: false };
      report.checks.push(check);
      const mediaControl = page.locator('#elementor-panel .elementor-control-image .elementor-control-media__preview, #elementor-panel .elementor-control-image .elementor-control-media-area').first();
      await mediaControl.waitFor({ state: 'visible', timeout: 10_000 });
      await mediaControl.click();
      const library = page.getByRole('tab', { name: /^(Media Library|媒体库|媒體庫)$/ });
      if (await library.isVisible()) await library.click();
      const attachment = page.locator(`.media-modal .attachment[data-id="${options.imageReplacement.attachmentId}"]`).first();
      await attachment.waitFor({ state: 'visible', timeout: 15_000 });
      await attachment.click();
      const insert = page.locator('.media-modal .media-button-select').first();
      mutated = true;
      authorizedEdits.push({targetId:imageBinding.targetId!,setting:'image',value:{id:options.imageReplacement.attachmentId,url:options.imageReplacement.url}});
      await insert.click();
      check.changed = true;
      const replacement = options.imageReplacement.url;
      await saveAndConfirm(check, async () => {
        const rendered = frontend.locator(targetSelector(imageBinding)).first().locator('img').first();
        const current = await rendered.getAttribute('src');
        return !!current && canonical(current) === canonical(replacement);
      }, 'image-modification.png');
    }
    if (requiredFields.includes('style')) {
      let styledBinding = bindings.find(binding => binding.kind === 'button');
      const isButton = !!styledBinding;
      styledBinding ??= selected;
      const widget = frame.locator(targetSelector(styledBinding)).first();
      const contentSelector = isButton ? '.elementor-button,button,a' : contentField==='content' ? '.elementor-widget-container,p' : '.elementor-heading-title,h1,h2,h3,h4,h5,h6';
      const content = widget.locator(contentSelector).first();
      const property = isButton ? 'background-color' : 'color';
      const before = await content.evaluate((element, cssProperty) => getComputedStyle(element).getPropertyValue(cssProperty), property);
      const testColor = before === 'rgb(18, 171, 125)' ? '#ab127d' : '#12ab7d';
      const expectedColor = testColor === '#ab127d' ? 'rgb(171, 18, 125)' : 'rgb(18, 171, 125)';
      restorationProbes.push({ selector: `${targetSelector(styledBinding).split(',')[0]} ${isButton ? '.elementor-button' : contentField==='content' ? '.elementor-widget-container' : '.elementor-heading-title'}`, property, value: before });
      await selectNativeWidget(widget,page);
      const styleTab = page.locator('#elementor-panel [data-tab="style"], #elementor-panel .elementor-tab-control-style').first();
      await styleTab.waitFor({ state: 'visible', timeout: 10_000 });
      await styleTab.click();
      const setting = isButton ? 'background_color' : contentField==='content' ? 'text_color' : 'title_color';
      const picker = page.locator(`#elementor-panel .elementor-control-${setting} .pcr-button`).first();
      await picker.waitFor({ state: 'visible', timeout: 10_000 });
      await picker.click();
      const input = page.locator('.pcr-app.visible .pcr-result, .pcr-app .pcr-result:visible').first();
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      mutated = true;
      const colorEdit:AuthorizedEditorEdit={targetId:styledBinding.targetId!,setting,value:testColor};
      authorizedEdits.push(colorEdit);
      await input.fill(testColor);
      await input.press('Enter');
      const savedColor=page.locator(`#elementor-panel .elementor-control-${setting} input[data-setting="${setting}"]`).first();
      if(await savedColor.count()) colorEdit.value=await savedColor.inputValue();
      await styleTab.click();
      const check = { sourceId: styledBinding.sourceId, field: 'style', selected: true, changed: true, saved: false, frontendConfirmed: false, restored: false };
      report.checks.push(check);
      await saveAndConfirm(check, async () => {
        const actual = await frontend.locator(targetSelector(styledBinding!)).first().locator(contentSelector).first().evaluate((element, cssProperty) => getComputedStyle(element).getPropertyValue(cssProperty), property);
        return actual === expectedColor;
      }, 'style-modification.png');
    }
    await frontend.close();
  } catch (error) {
    report.status = mutated ? 'failed' : 'unverified';
    report.issues.push({ code: mutated ? 'editor-editability-failed' : 'editor-editability-unverified', status: mutated ? 'mismatch' : 'unverified', severity: 'error', message: error instanceof Error ? error.message : String(error) });
    const editorPage = context.pages().find(page => page.url().startsWith(editor.origin) && page.url().includes('wp-admin'));
    if (editorPage) {
      const screenshot = path.join(directory, 'editor-check-failure.png');
      try {
        await editorPage.screenshot({ path: screenshot, fullPage: true });
        report.screenshots.push(screenshot);
        const controls = await editorPage.evaluate(() => Array.from(document.querySelectorAll('#elementor-panel input, #elementor-panel textarea, #elementor-panel button, #elementor-panel [data-tab], .media-modal button, .pcr-app input')).map(element => ({ tag: element.tagName.toLowerCase(), setting: element.getAttribute('data-setting'), tab: element.getAttribute('data-tab'), classes: Array.from(element.classList), label: element.getAttribute('aria-label'), text: element.tagName === 'BUTTON' ? element.textContent?.trim().slice(0,120) : undefined, visible: !!(element as HTMLElement).offsetParent }))); 
        await writeFile(path.join(directory, 'editor-controls.json'), JSON.stringify(controls, null, 2));
      } catch { /* A failed/closed editor still remains explicitly unverified. */ }
    }
  } finally {
    if (mutated) {
      try {
        // Close editor pages before restoring so pending autosave cannot overwrite the restored snapshot.
        await Promise.all(context.pages().map(page => page.close()));
        restored = await options.restore(authorizedEdits);
        if (restored) {
          const frontend = await context.newPage();
          await frontend.goto(options.previewUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          const text = await frontend.locator('body').innerText();
          const originalText=original ? await frontend.evaluate(html=>new DOMParser().parseFromString(html.replace(/<\/(?:p|div|li|h[1-6])>/gi,' '),'text/html').body.textContent?.replace(/\s+/g,' ').trim() ?? '',original) : '';
          restored = !text.includes(marker) && (!originalText || text.replace(/\s+/g,' ').includes(originalText));
          for (const probe of restorationProbes) {
            const element = frontend.locator(probe.selector).first();
            if (!await element.count()) { restored = false; continue; }
            const actual = probe.property === 'src' ? await element.getAttribute('src') : await element.evaluate((node, property) => getComputedStyle(node).getPropertyValue(property!), probe.property);
            if (actual !== probe.value) restored = false;
          }
          const screenshot = path.join(directory, 'restored.png');
          await frontend.screenshot({ path: screenshot, fullPage: true });
          report.screenshots.push(screenshot);
          await frontend.close();
        }
        for (const check of report.checks) check.restored = restored;
        if (!restored) throw new Error('Owned page restoration did not match its snapshot or restored frontend.');
      } catch (error) {
        report.status = 'failed';
        report.issues.push({ code: 'editor-restoration-failed', status: 'mismatch', severity: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    }
    await lease.release();
    if (ownedBrowser) await browser.close();
  }
  report.verifiedFields = report.checks.filter(check => check.selected && check.changed && check.saved && check.frontendConfirmed && check.restored).map(check => check.field);
  if (requiredFields.every(field => report.verifiedFields!.includes(field)) && !report.issues.length) report.status = 'verified';
  return report;
}

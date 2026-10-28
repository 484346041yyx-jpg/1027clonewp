import { catalogSchema, filterCatalogOptions, quoteSummary, validateSelection, type Catalog, type Part, type Selection } from './contract.js';
import { initialSelection, previewLayers, selectPart } from './state.js';

const parts: Part[] = ['bottles', 'pumps', 'caps'];
const titles = ['Select Your Bottle', 'Select Your Pump And Collar', 'Select Your Cap', 'Add Your Logo', 'Select Your Decoration'];
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e;
}
interface ConfiguratorInstance {
  config: string; ui: HTMLElement; destroy(): void; targets(node: Node): boolean;
  beforeSubmit(): void; nativeUpload(input: HTMLInputElement): void; error(message: string): void;
}
interface ConfiguratorRuntime {
  instances: Map<HTMLElement, ConfiguratorInstance>; started: boolean; scheduled: boolean;
}
// Elementor may execute a widget bundle more than once in the same preview document.
// Keep one registry and one pair of delegated listeners for that document.
const registryKey = Symbol.for('clonewp.bottle-configurator.runtime.v1');
function runtime(doc: Document): ConfiguratorRuntime {
  const store = doc as unknown as Record<symbol, ConfiguratorRuntime | undefined>;
  return store[registryKey] ??= { instances: new Map(), started: false, scheduled: false };
}
function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message === 'configurator_incomplete_selection' ? 'Select a bottle, pump and cap before requesting a quote.' : message || 'Please review your bottle configuration.';
}
export function mountConfigurator(root: HTMLElement) {
  const manager = runtime(root.ownerDocument);
  const config = root.querySelector('script[type="application/json"]')?.textContent;
  if (!config) throw Error('configurator_catalog_missing');
  const previous = manager.instances.get(root);
  if (previous?.config === config && previous.ui.parentElement === root) return previous.destroy;
  previous?.destroy();
  // A cloned Elementor widget can carry generated DOM but no live runtime instance.
  root.querySelectorAll(':scope > .cwp-config-ui,:scope > [data-cwp-error]').forEach(node => node.remove());
  const c: Catalog = catalogSchema.parse(JSON.parse(config));
  const sourceMode = c.previewLayout?.mode === 'natural-stack';
  let state: Selection = initialSelection(c), logoUrl = '', file: File | undefined, ownedNativeFile: File | undefined, uploadTicket = 0, uploadPending = false, syncingUpload = false, disposed = false, lastSummary = '';
  root.dataset.mounted = 'true';
  const ui = element('div', '', 'cwp-config-ui');
  if (sourceMode) ui.classList.add('cwp-config-source');
  const title = element('h2', c.title), layout = element('div', '', 'cwp-config-layout');
  const choices = element('div', '', 'cwp-config-choices'), preview = element('aside', '', 'cwp-config-preview');
  const stage = element('div', '', 'cwp-config-stage'); stage.setAttribute('aria-label', 'Bottle design preview');
  if (c.previewLayout?.mode === 'natural-stack') {
    stage.classList.add('cwp-config-natural');
    stage.style.setProperty('--cwp-preview-width', `${c.previewLayout.width}px`);
    stage.style.setProperty('--cwp-preview-min-height', `${c.previewLayout.minHeight}px`);
    stage.style.setProperty('--cwp-preview-padding-top', `${c.previewLayout.outerPaddingTop}px`);
    stage.style.setProperty('--cwp-preview-bottle-offset-y', `${c.previewLayout.bottleOffsetY}px`);
  }
  const notice = element('p', 'Non-contractual visual', 'cwp-config-notice');
  const status = element('p', '', 'cwp-config-status'); status.setAttribute('role', 'status');
  const quote = element('button', 'Request A Quote'); quote.type = 'button';
  quote.className = 'cwp-config-request-quote';
  const reset = element('button', 'Reset design'); reset.type = 'button';
  reset.className = 'cwp-config-reset';
  if (c.previewLayout?.mode === 'natural-stack') { preview.classList.add('cwp-config-source-preview'); preview.append(stage, status, quote, notice, reset); }
  else preview.append(stage, notice, status, quote, reset);
  layout.append(choices, preview); if (sourceMode) { choices.append(title); ui.append(layout); } else ui.append(title, layout); root.append(ui);
  const sections: HTMLDetailsElement[] = [];
  titles.forEach((t, index) => { const d = element('details'); d.open = true; d.append(element('summary', `Step ${index + 1}: ${t}`)); choices.append(d); sections.push(d); });
  const selectedRows = sourceMode ? sections.map(section => { const row = element('div', '', 'cwp-config-selected'); section.append(row); return row; }) : [];
  const nav = element('nav', '', 'cwp-config-step-nav'); nav.setAttribute('aria-label', 'Bottle customization steps');
  const navButtons = sourceMode ? ['Bottle', 'Pump And Collar', 'Cap', 'Logo', 'Decoration'].map((name, index) => {
    const button = element('button'); button.type = 'button'; button.setAttribute('aria-label', `Step ${index + 1}: ${name}`);
    button.append(element('span', String(index + 1)), element('span', name));
    button.onclick = () => { sections[index].open = true; sections[index].scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); sections[index].querySelector('summary')?.focus({ preventScroll: true }); navButtons.forEach((b, i) => b.setAttribute('aria-current', String(i === index))); };
    button.setAttribute('aria-current', String(index === 0)); nav.append(button); return button;
  }) : [];
  if (sourceMode) ui.append(nav);
  const stepObserver = sourceMode && typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
    const entry = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (entry) navButtons.forEach((b, i) => b.setAttribute('aria-current', String(sections[i] === entry.target)));
  }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 }) : undefined;
  sections.forEach(section => stepObserver?.observe(section));
  const live = element('p'); live.setAttribute('aria-live', 'polite'); ui.append(live);
  const defaultFilters = (part: Part) => Object.fromEntries(Object.entries(c.filterGroups?.[part] ?? {}).map(([attribute, group]) => [attribute, group.defaultValue ?? '']));
  const filters: Record<Part, Record<string, string>> = { bottles: defaultFilters('bottles'), pumps: defaultFilters('pumps'), caps: defaultFilters('caps') };
  const lists: HTMLElement[] = [], counts: HTMLElement[] = [];
  let updateSourceControls = () => {};
  const redraw = () => {
    const layers = previewLayers(c, state); stage.replaceChildren();
    const canvas = c.previewLayout?.mode === 'natural-stack' ? element('div', '', 'cwp-config-natural-canvas') : stage;
    if (canvas !== stage) stage.append(canvas);
    for (const l of layers.layers) { const img = element('img'); img.src = l.image.url; img.alt = ''; img.draggable = false;
      if (canvas === stage) { Object.assign(img.style, { left: `${l.position.x}%`, top: `${l.position.y}%`, width: `${l.position.width}%`, height: `${l.position.height}%`, zIndex: String(l.z) }); stage.append(img); }
      else { const layer = element('div', '', `cwp-config-natural-part cwp-config-part-${l.part}`); layer.dataset.layerId = l.id; layer.append(img); canvas.append(layer); }
    }
    const area = element('div', '', 'cwp-config-logo-area');
    Object.assign(area.style, { left: `${c.logoArea.x}%`, top: `${c.logoArea.y}%`, width: `${c.logoArea.width}%`, height: `${c.logoArea.height}%` });
    const mark = state.logo.mode === 'image' && logoUrl ? element('img') : element('span', state.logo.mode === 'text' ? state.text : '');
    if (mark instanceof HTMLImageElement) { mark.src = logoUrl; mark.alt = 'Your logo'; }
    Object.assign(mark.style, { position: 'absolute', left: `${state.logo.x}%`, top: `${state.logo.y}%`, width: `${state.logo.scale * 100}%`, height: 'auto', transform: `translate(-50%,-50%) rotate(${state.logo.rotation ?? 0}deg)`, color: state.color, fontFamily: c.fonts.find(f => f.id === state.font)!.family });
    area.append(mark); stage.append(area);
    notice.textContent = sourceMode || layers.decorationPreviewAvailable ? 'Non-contractual visual' : 'Selected finish is shown as a sample below. This bottle has no authored finish overlay.';
    if (state.decoration && !sourceMode) { const d = c.decorations.find(d => d.id === state.decoration)!; const sample = element('img'); sample.src = d.image.url; sample.alt = d.label; sample.className = 'cwp-config-finish-sample'; stage.append(sample); }
    parts.forEach((part, i) => {
      if (!lists[i]) return;
      const options = filterCatalogOptions(c, part, filters[part]), scrollTop = lists[i].scrollTop; counts[i].textContent = sourceMode ? `There is ${options.length} corresponding ${part === 'pumps' ? 'pump and collar' : part.slice(0, -1)}(s)` : `${options.length} corresponding ${part}`; lists[i].replaceChildren();
      options.forEach(o => { const button = element('button', '', 'cwp-config-option'); button.type = 'button';
        button.setAttribute('aria-label', o.label); button.setAttribute('aria-pressed', String(state[({ bottles: 'bottle', pumps: 'pump', caps: 'cap' } as const)[part]] === o.id));
        button.dataset.optionId = o.id;
        try { selectPart(c, state, part, o.id); } catch { button.disabled = true; button.title = 'Not compatible with the current combination'; }
        const img = element('img'); img.src = o.image.url; img.alt = ''; img.loading = 'lazy'; button.append(img, element('span', o.label));
        button.onclick = () => { state = selectPart(c, state, part, o.id); status.textContent = ''; redraw(); lists[i].querySelector<HTMLButtonElement>(`[data-option-id="${CSS.escape(o.id)}"]`)?.focus({ preventScroll: true }); }; lists[i].append(button); });
      lists[i].scrollTop = scrollTop;
    });
    updateSourceControls();
    try { validateSelection(c, state); quote.disabled = uploadPending || state.logo.mode === 'image' && !file; syncForm(false); } catch { quote.disabled = true; try { const summary = summaryInput(); if (summary) summary.value = ''; } catch { /* No other Form may be changed when its binding is ambiguous. */ } }
  };
  const formOwner = () => {
    const owners = root.ownerDocument.querySelectorAll<HTMLElement>(`.elementor-element-${CSS.escape(c.form.widgetId)}`);
    const claimants = [...manager.instances].filter(([node]) => node.isConnected).filter(([, instance]) => instance.targets(owners[0] ?? root));
    if (owners.length > 1 || claimants.length > 1) throw Error('This quote form is linked to more than one configurator. Please contact us.');
    return owners[0];
  };
  const summaryInput = () => formOwner()?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="form_fields[${CSS.escape(c.form.summaryField)}]"]`);
  const uploadInput = () => formOwner()?.querySelector<HTMLInputElement>(`input[type="file"][name="form_fields[${CSS.escape(c.form.uploadField)}][]"],input[type="file"][name="form_fields[${CSS.escape(c.form.uploadField)}]"]`);
  const clearOwnedAttachment = () => {
    try {
      const native = uploadInput();
      if (native && ownedNativeFile && native.files?.[0] === ownedNativeFile) {
        syncingUpload = true; try { native.value = ''; native.dispatchEvent(new Event('change', { bubbles: true })); } finally { syncingUpload = false; }
      }
      ownedNativeFile = undefined;
    } catch { /* A newer or ambiguous Form binding must remain untouched. */ }
  };
  const editorMode = () => {
    const view = root.ownerDocument.defaultView as (Window & { elementorFrontend?: { isEditMode?: () => boolean } }) | null;
    return root.ownerDocument.body.classList.contains('elementor-editor-active') || root.ownerDocument.body.classList.contains('elementor-edit-mode') || !!view?.elementorFrontend?.isEditMode?.();
  };
  const dialog = element('dialog', '', 'cwp-config-quote'); dialog.setAttribute('aria-label', 'Request A Quote');
  const closeQuote = element('button', 'Close quote form', 'cwp-config-quote-close'); closeQuote.type = 'button';
  const quoteTitle = element('h3', 'Request A Quote'), quoteDescription = element('p', '', 'cwp-config-quote-description');
  const thumbnail = element('button', '', 'cwp-config-design-thumbnail'); thumbnail.type = 'button'; thumbnail.setAttribute('aria-label', 'Enlarge bottle design');
  const zoom = element('dialog', '', 'cwp-config-design-zoom'); zoom.setAttribute('aria-label', 'Bottle design enlarged');
  const closeZoom = element('button', 'Close enlarged design', 'cwp-config-quote-close'); closeZoom.type = 'button'; const zoomContent = element('div');
  zoom.append(closeZoom, zoomContent, element('p', 'Non-contractual visual', 'cwp-config-notice'));
  dialog.append(closeQuote, quoteTitle, thumbnail, quoteDescription); ui.append(dialog, zoom);
  // Clone the rendered layers, including the customer's text/image transforms.
  // This keeps local logo bytes local and avoids cross-origin canvas capture.
  const composeDesign = (target: HTMLElement, width: number) => {
    const box = stage.getBoundingClientRect(); target.replaceChildren();
    if (!box.width || !box.height) return;
    const scale = Math.min(1, width / box.width), composition = element('div', '', 'cwp-config-design-composition');
    Object.assign(composition.style, { width: `${box.width * scale}px`, height: `${box.height * scale}px`, position: 'relative', overflow: 'hidden', pointerEvents: 'none' });
    const copy = stage.cloneNode(true) as HTMLElement; copy.removeAttribute('aria-label'); copy.setAttribute('aria-hidden', 'true');
    Object.assign(copy.style, { width: `${box.width}px`, maxWidth: 'none', maxHeight: 'none', margin: '0', position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', transform: `scale(${scale})` });
    composition.append(copy); target.append(composition);
  };
  thumbnail.onclick = () => { composeDesign(zoomContent, Math.max(1, Math.min(stage.getBoundingClientRect().width, innerWidth - 80))); if (!zoom.open) zoom.showModal(); closeZoom.focus(); };
  closeZoom.onclick = () => zoom.close();
  zoom.addEventListener('close', () => { zoomContent.replaceChildren(); if (!disposed && dialog.open) thumbnail.focus({ preventScroll: true }); });
  zoom.addEventListener('click', event => { const box = zoom.getBoundingClientRect(); if (event.target === zoom && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) zoom.close(); });
  let portal: { node: HTMLElement; anchor: Comment; hidden: HTMLElement['hidden']; hadClass: boolean } | undefined;
  const restorePortal = (destroy = false) => {
    if (!portal) return;
    const saved = portal; portal = undefined;
    const others = [...root.ownerDocument.querySelectorAll<HTMLElement>(`.elementor-element-${CSS.escape(c.form.widgetId)}`)].filter(node => node !== saved.node);
    if (saved.anchor.isConnected && !others.length) {
      saved.anchor.replaceWith(saved.node); saved.node.hidden = destroy ? saved.hidden : true;
      if (destroy && !saved.hadClass) saved.node.classList.remove('cwp-config-quote-native');
    } else { saved.anchor.remove(); saved.node.remove(); }
    if (!destroy && !editorMode()) prepareClosedForm();
  };
  const prepareClosedForm = () => {
    if (editorMode()) return;
    const node = formOwner(); if (!node || portal) return;
    // Remember original visibility once, independently of later open/close cycles.
    if (!closedForm || closedForm.node !== node) closedForm = { node, hidden: node.hidden, hadClass: node.classList.contains('cwp-config-quote-native') };
    node.classList.add('cwp-config-quote-native'); node.hidden = true;
  };
  let closedForm: { node: HTMLElement; hidden: HTMLElement['hidden']; hadClass: boolean } | undefined;
  const openQuote = () => {
    const node = formOwner(); if (!node) throw Error('The quote form is unavailable.');
    if (editorMode()) { node.hidden = false; node.scrollIntoView({ block: 'center' }); node.querySelector<HTMLInputElement>('input:not([type="hidden"]):not([type="file"])')?.focus({ preventScroll: true }); return; }
    if (typeof dialog.showModal !== 'function') throw Error('Your browser cannot open the quote form. Please contact us.');
    prepareClosedForm();
    if (!portal) {
      const anchor = root.ownerDocument.createComment('clonewp-configurator-native-form'); node.before(anchor);
      portal = { node, anchor, hidden: closedForm?.node === node ? closedForm.hidden : node.hidden, hadClass: closedForm?.node === node ? closedForm.hadClass : node.classList.contains('cwp-config-quote-native') };
      dialog.append(node);
    }
    node.hidden = false; const summary = quoteSummary(c, state); quoteDescription.textContent = `${summary.bottle} / ${summary.pump} / ${summary.cap}`;
    composeDesign(thumbnail, 150);
    if (!dialog.open) dialog.showModal(); node.querySelector<HTMLInputElement>('input:not([type="hidden"]):not([type="file"])')?.focus({ preventScroll: true });
  };
  closeQuote.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (zoom.open) zoom.close(); thumbnail.replaceChildren(); if (!disposed) { restorePortal(); quote.focus({ preventScroll: true }); } });
  dialog.addEventListener('click', event => { const box = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close(); });
  const mobilePreview = c.previewLayout?.mobile;
  const mobileMedia = mobilePreview ? matchMedia(`(max-width:${mobilePreview.breakpoint}px)`) : undefined;
  const previewDialog = element('dialog', '', 'cwp-config-preview-dialog'); previewDialog.setAttribute('aria-label', mobilePreview?.previewLabel ?? 'View Renderings');
  const previewPanel = element('div', '', 'cwp-config-preview-panel'), previewClose = element('button', '', 'cwp-config-preview-close'); previewClose.type = 'button'; previewClose.setAttribute('aria-label', 'Close renderings');
  previewPanel.append(previewClose); previewDialog.append(previewPanel);
  const previewTrigger = element('button', mobilePreview?.previewLabel ?? 'View Renderings', 'cwp-config-preview-trigger'); previewTrigger.type = 'button'; previewTrigger.hidden = true;
  const previewAnchor = root.ownerDocument.createComment('clonewp-configurator-preview'); preview.before(previewAnchor);
  ui.append(previewTrigger, previewDialog);
  const updatePreviewMode = () => {
    const mobile = !!mobileMedia?.matches; root.classList.toggle('cwp-config-mobile-active', mobile); previewTrigger.hidden = !mobile;
    if (mobile) { if (preview.parentElement !== previewPanel) previewPanel.append(preview); }
    else { if (previewDialog.open) previewDialog.close(); if (previewAnchor.isConnected && preview.previousSibling !== previewAnchor) previewAnchor.after(preview); }
    const settings = mobile && mobilePreview ? mobilePreview : c.previewLayout;
    if (settings) { stage.style.setProperty('--cwp-preview-min-height', `${settings.minHeight}px`); stage.style.setProperty('--cwp-preview-padding-top', `${settings.outerPaddingTop}px`); stage.style.setProperty('--cwp-preview-bottle-offset-y', `${settings.bottleOffsetY}px`); }
  };
  mobileMedia?.addEventListener('change', updatePreviewMode);
  previewTrigger.onclick = () => { if (mobileMedia?.matches && typeof previewDialog.showModal === 'function') { previewDialog.showModal(); previewClose.focus(); } };
  previewClose.onclick = () => previewDialog.close();
  previewDialog.addEventListener('close', () => { if (!disposed && mobileMedia?.matches) previewTrigger.focus({ preventScroll: true }); });
  previewDialog.addEventListener('click', event => { if (event.target === previewDialog) previewDialog.close(); });
  function syncForm(requireFile: boolean) {
    if (disposed) throw Error('This configurator has been replaced.');
    if (uploadPending) { if (requireFile) throw Error('Please wait while your logo is checked.'); return; }
    const summary = summaryInput(), upload = uploadInput();
    if (!summary) { if (requireFile) throw Error('The quote form is unavailable.'); return; }
    const nextSummary = JSON.stringify(quoteSummary(c, state));
    if (state.logo.mode === 'image') {
      if (!file || !upload) { if (requireFile) throw Error('The quote form cannot attach your logo.'); return; }
      if (upload.files?.[0] !== file) { const transfer = new DataTransfer(); transfer.items.add(file); syncingUpload = true; try { upload.files = transfer.files; upload.dispatchEvent(new Event('change', { bubbles: true })); } finally { syncingUpload = false; } }
      ownedNativeFile = file;
    } else if (upload && upload.files?.length) { syncingUpload = true; try { upload.value = ''; ownedNativeFile = undefined; upload.dispatchEvent(new Event('change', { bubbles: true })); } finally { syncingUpload = false; } }
    summary.value = nextSummary;
    lastSummary = nextSummary;
  }
  parts.forEach((part, i) => {
    const panel = element('div', '', 'cwp-config-panel'); sections[i].append(panel);
    const attributes = [...new Set(c[part].flatMap(o => Object.keys(o.attributes)))];
    if (sourceMode) attributes.sort((a, b) => (a === 'types' ? -1 : b === 'types' ? 1 : 0));
    for (const attr of attributes) { const row = element('div', '', 'cwp-config-filter'); row.append(element('span', attr));
      const group = element('div'); const configured = c.filterGroups?.[part]?.[attr];
      const values = configured?.choices ?? ['', ...new Set(c[part].map(o => o.attributes[attr]).filter(Boolean))].map(value => ({ value, label: value || 'All' }));
      group.dataset.filterAttribute = attr; group.dataset.filterPart = part;
      values.forEach(choice => { const b = element('button', choice.label); b.type = 'button'; b.dataset.filterValue = choice.value; b.setAttribute('aria-pressed', String((filters[part][attr] || '') === choice.value)); b.onclick = () => { filters[part][attr] = choice.value; lists[i].scrollTop = 0; for (const sibling of group.children) sibling.setAttribute('aria-pressed', String(sibling === b)); redraw(); }; group.append(b); }); row.append(group); panel.append(row); }
    const count = element('p', '', 'cwp-config-count'), list = element('div', '', 'cwp-config-options'); counts.push(count); lists.push(list); panel.append(count, list);
  });
  const logoPanel = element('div', '', 'cwp-config-panel'); sections[3].append(logoPanel);
  const mode = element('select'); mode.setAttribute('aria-label', 'Logo mode');
  for (const [value, text] of [['none', 'No logo'], ['image', 'Add Images'], ['text', 'Add Text']]) { const o = element('option', text); o.value = value; mode.append(o); }
  const upload = element('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.setAttribute('aria-label', 'Upload logo');
  const text = element('textarea'); text.placeholder = 'Please enter your text here'; text.maxLength = 160; text.setAttribute('aria-label', 'Logo text');
  const font = element('select'); font.setAttribute('aria-label', 'Change Your Font'); c.fonts.forEach(f => { const o = element('option', f.label); o.value = f.id; font.append(o); });
  const color = element('input'); color.type = 'color'; color.value = state.color; color.setAttribute('aria-label', 'Text color');
  let logoTab: 'image' | 'text' = 'image';
  const tabs = element('div', '', 'cwp-config-logo-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Logo content');
  const imagePanel = element('div', '', 'cwp-config-logo-image'), textPanel = element('div', '', 'cwp-config-logo-text');
  const fontLabel = element('label', 'Change Your Font'), colorLabel = element('label', 'Choose Your Color'); fontLabel.append(font); colorLabel.append(color);
  const uploadLabel = element('label', '', 'cwp-config-logo-upload'), uploadThumb = element('img'); uploadThumb.alt = 'Uploaded logo'; uploadThumb.hidden = true; uploadLabel.append(uploadThumb, upload);
  imagePanel.append(element('p', 'Please upload your logo or images'), uploadLabel); textPanel.append(text);
  const typography = element('div', '', 'cwp-config-typography'); typography.append(fontLabel, colorLabel);
  const colorExtras = element('div', '', 'cwp-config-color-extras'), palette = element('div', '', 'cwp-config-color-palette'); palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', 'Text colors');
  const swatches = (c.logoColors ?? []).map(item => { const button = element('button', '', 'cwp-config-color-swatch'); button.type = 'button'; button.style.backgroundColor = item.value; button.setAttribute('aria-label', item.label); button.dataset.color = item.value.toLowerCase(); button.onclick = () => { state = { ...state, color: item.value }; color.value = item.value; redraw(); }; palette.append(button); return button; });
  const pantone = element('input'); pantone.type = 'text'; pantone.maxLength = 80; pantone.value = state.pantone ?? ''; pantone.setAttribute('aria-label', 'Pantone number');
  const pantoneLabel = element('label', 'If you have other color requests, please enter Pantone Num:', 'cwp-config-pantone'); pantoneLabel.append(pantone);
  if (swatches.length) colorExtras.append(palette); colorExtras.append(pantoneLabel); typography.append(colorExtras);
  const tabButtons: HTMLButtonElement[] = [];
  if (sourceMode) {
    mode.hidden = true; imagePanel.setAttribute('role', 'tabpanel'); imagePanel.setAttribute('aria-label', 'Add Images'); textPanel.setAttribute('role', 'tabpanel'); textPanel.setAttribute('aria-label', 'Add Text');
    for (const [value, label] of [['image', 'Add Images'], ['text', 'Add Text']] as const) {
      const button = element('button', label); button.type = 'button'; button.setAttribute('role', 'tab'); button.dataset.logoTab = value;
      button.onclick = () => { logoTab = value; mode.value = value; mode.dispatchEvent(new Event('change')); };
      button.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const target = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - tabButtons.indexOf(button); tabButtons[target].click(); tabButtons[target].focus(); } };
      tabs.append(button); tabButtons.push(button);
    }
    logoPanel.classList.add('cwp-config-resource'); logoPanel.append(mode, tabs, imagePanel, textPanel, typography);
  } else logoPanel.append(mode, upload, text, font, color, colorExtras);
  const cancelPendingUpload = () => { if (uploadPending) { uploadTicket++; uploadPending = false; upload.value = ''; status.textContent = ''; } };
  mode.onchange = () => { cancelPendingUpload(); const next = mode.value === 'text' && !state.text.trim() || mode.value === 'image' && !file ? 'none' : mode.value as Selection['logo']['mode']; state = { ...state, logo: { ...state.logo, mode: next } }; redraw(); };
  const releaseLogo = () => { if (logoUrl) URL.revokeObjectURL(logoUrl); logoUrl = ''; file = undefined; };
  const checkLogo = async (candidate: File | undefined) => {
    const ticket = ++uploadTicket; uploadPending = !!candidate; releaseLogo();
    state = { ...state, logo: { ...state.logo, mode: 'none' } }; mode.value = 'none';
    if (!candidate) { upload.value = ''; status.textContent = ''; redraw(); return; }
    status.textContent = 'Checking your logo…'; redraw();
    try { if (!['image/png', 'image/jpeg', 'image/webp'].includes(candidate.type) || candidate.size > 5 * 1024 * 1024) throw Error('Use a PNG, JPEG or WebP logo up to 5 MB.');
      const bitmap = await createImageBitmap(candidate); const width = bitmap.width, height = bitmap.height; bitmap.close();
      if (!width || !height || width * height > 20000000) throw Error('Logo dimensions are too large.');
      if (disposed || ticket !== uploadTicket) return;
      uploadPending = false; logoUrl = URL.createObjectURL(candidate); file = candidate;
      if (upload.files?.[0] !== candidate) { const transfer = new DataTransfer(); transfer.items.add(candidate); upload.files = transfer.files; }
      state = { ...state, logo: { ...state.logo, mode: 'image' } }; logoTab = 'image'; mode.value = 'image'; status.textContent = ''; redraw();
    } catch (e) { if (disposed || ticket !== uploadTicket) return; uploadPending = false; upload.value = ''; status.textContent = friendlyError(e); redraw(); }
  };
  upload.onchange = () => { void checkLogo(upload.files?.[0]); };
  text.oninput = () => { cancelPendingUpload(); logoTab = 'text'; state = { ...state, text: text.value, logo: { ...state.logo, mode: text.value.trim() ? 'text' : 'none' } }; mode.value = state.logo.mode; redraw(); };
  font.onchange = () => { state = { ...state, font: font.value }; redraw(); };
  color.oninput = () => { state = { ...state, color: color.value }; redraw(); };
  pantone.oninput = () => { state = { ...state, pantone: pantone.value }; redraw(); };
  const positionControls: Array<{ key: 'x' | 'y' | 'scale' | 'rotation'; control: HTMLInputElement }> = [];
  const adjust = element('details', '', 'cwp-config-logo-adjust'); adjust.append(element('summary', 'Adjust logo')); if (sourceMode) logoPanel.append(adjust);
  for (const [key, label, min, max, step] of [['x', 'Logo horizontal position', 0, 100, 1], ['y', 'Logo vertical position', 0, 100, 1], ['scale', 'Logo size', .1, 1, .01], ['rotation', 'Logo rotation', -180, 180, 1]] as const) {
    const control = element('input'); control.type = 'range'; control.min = String(min); control.max = String(max); control.step = String(step); control.value = String(state.logo[key] ?? 0); control.setAttribute('aria-label', label);
    control.oninput = () => { state = { ...state, logo: { ...state.logo, [key]: Number(control.value) } }; redraw(); }; (sourceMode ? adjust : logoPanel).append(element('label', label), control); positionControls.push({ key, control });
  }
  const finishes = element('div', '', 'cwp-config-panel'); sections[4].append(finishes);
  const finishFilter = element('select'); finishFilter.setAttribute('aria-label', 'Decoration category');
  for (const cat of ['', ...new Set(c.decorations.map(d => d.category))]) { const o = element('option', cat || 'All'); o.value = cat; finishFilter.append(o); }
  const finishList = element('div', '', 'cwp-config-options');
  const finishFilters: Record<string, string> = {};
  const renderFinishes = () => {
    finishList.replaceChildren();
    const appendSample = (d: Catalog['decorations'][number], target: HTMLElement) => { const b = element('button', '', 'cwp-config-option'); b.type = 'button'; b.setAttribute('aria-label', d.label); b.setAttribute('aria-pressed', String(d.id === state.decoration)); const img = element('img'); img.src = d.image.url; img.alt = ''; img.loading = 'lazy'; b.append(img, element('span', d.label)); b.onclick = () => { state = { ...state, decoration: d.id }; renderFinishes(); redraw(); }; target.append(b); };
    if (sourceMode) {
      for (const category of new Set(c.decorations.map(d => d.category))) {
        const group = element('div', '', 'cwp-config-finish-group'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', category);
        const row = element('div', '', 'cwp-config-filter'); row.append(element('span', category)); const chips = element('div');
        const options = c.decorations.filter(d => d.category === category);
        for (const finish of ['', ...new Set(options.map(d => d.finish))]) { const b = element('button', finish || 'All'); b.type = 'button'; b.setAttribute('aria-pressed', String((finishFilters[category] || '') === finish)); b.onclick = () => { finishFilters[category] = finish; renderFinishes(); redraw(); }; chips.append(b); }
        row.append(chips); const samples = element('div', '', 'cwp-config-options'); options.filter(d => !finishFilters[category] || d.finish === finishFilters[category]).forEach(d => appendSample(d, samples)); group.append(row, samples); finishList.append(group);
      }
    } else {
      const none = element('button', 'No decoration'); none.type = 'button'; none.onclick = () => { state = { ...state, decoration: null }; renderFinishes(); redraw(); }; finishList.append(none);
      c.decorations.filter(d => !finishFilter.value || d.category === finishFilter.value).forEach(d => appendSample(d, finishList));
    }
  };
  finishFilter.onchange = renderFinishes; finishes.append(finishFilter, finishList); renderFinishes();
  if (sourceMode) { finishFilter.hidden = true; finishList.className = 'cwp-config-finish-groups'; }
  updateSourceControls = () => {
    swatches.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === state.color.toLowerCase())));
    for (const group of choices.querySelectorAll<HTMLElement>('[data-filter-part]')) for (const button of group.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String((filters[group.dataset.filterPart as Part][group.dataset.filterAttribute!] || '') === button.dataset.filterValue));
    if (!sourceMode) return;
    tabButtons.forEach(button => { const active = button.dataset.logoTab === logoTab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    imagePanel.hidden = logoTab !== 'image'; textPanel.hidden = logoTab !== 'text'; typography.hidden = logoTab !== 'text'; adjust.hidden = state.logo.mode === 'none';
    uploadThumb.hidden = !logoUrl; if (logoUrl) uploadThumb.src = logoUrl; else uploadThumb.removeAttribute('src');
    selectedRows.forEach(row => row.replaceChildren());
    const chip = (index: number, label: string, remove: () => void, clear = false) => {
      const button = element('button', label, clear ? 'cwp-config-selected-clear' : 'cwp-config-selected-chip'); button.type = 'button';
      button.setAttribute('aria-label', clear ? `Clear ${['bottle', 'pump and collar', 'cap', 'logo', 'decoration'][index]} options` : `Remove ${label}`);
      if (!clear) button.append(element('span', '×')); button.onclick = remove; selectedRows[index].append(button);
    };
    parts.forEach((part, index) => {
      const key = ({ bottles: 'bottle', pumps: 'pump', caps: 'cap' } as const)[part];
      const chosen = c[part].find(o => o.id === state[key]);
      if (chosen) chip(index, chosen.label, () => { state = { ...state, [key]: null }; redraw(); });
      for (const [attr, value] of Object.entries(filters[part])) if (value && value !== c.filterGroups?.[part]?.[attr]?.defaultValue) {
        const name = c.filterGroups?.[part]?.[attr]?.choices.find(choice => choice.value === value)?.label ?? value;
        chip(index, name, () => { filters[part][attr] = c.filterGroups?.[part]?.[attr]?.defaultValue ?? ''; redraw(); });
      }
      if (selectedRows[index].childElementCount) chip(index, 'Clear Options', () => { state = { ...state, [key]: null }; filters[part] = defaultFilters(part); redraw(); }, true);
    });
    if (state.logo.mode !== 'none') chip(3, state.logo.mode === 'image' ? file?.name || 'Logo image' : state.text, () => { uploadTicket++; uploadPending = false; releaseLogo(); clearOwnedAttachment(); upload.value = ''; text.value = ''; state = { ...state, text: '', logo: { ...state.logo, mode: 'none' } }; mode.value = 'none'; redraw(); });
    const selectedFinish = c.decorations.find(d => d.id === state.decoration);
    if (selectedFinish) chip(4, selectedFinish.label, () => { state = { ...state, decoration: null }; renderFinishes(); redraw(); });
    for (const [category, finish] of Object.entries(finishFilters)) if (finish) chip(4, `${category}: ${finish}`, () => { finishFilters[category] = ''; renderFinishes(); redraw(); });
    if (selectedRows[4].childElementCount) chip(4, 'Clear Options', () => { state = { ...state, decoration: null }; for (const category of Object.keys(finishFilters)) delete finishFilters[category]; renderFinishes(); redraw(); }, true);
  };
  quote.onclick = () => { try { syncForm(true); openQuote(); } catch (e) { status.textContent = friendlyError(e); } };
  reset.onclick = () => { uploadTicket++; uploadPending = false; state = initialSelection(c); releaseLogo(); upload.value = ''; text.value = ''; mode.value = 'none'; logoTab = 'image'; color.value = state.color; pantone.value = state.pantone ?? ''; font.value = state.font; for (const { key, control } of positionControls) control.value = String(state.logo[key] ?? 0); status.textContent = ''; finishFilter.value = ''; for (const category of Object.keys(finishFilters)) delete finishFilters[category]; for (const part of parts) filters[part] = defaultFilters(part); lists.forEach(list => { list.scrollTop = 0; }); renderFinishes(); redraw(); try { const native = uploadInput(); if (native) native.value = ''; } catch { /* Ambiguous Form bindings must remain untouched. */ } };
  const instance: ConfiguratorInstance = {
    config, ui,
    targets(node) { return node instanceof Element && !!node.closest(`.elementor-element-${CSS.escape(c.form.widgetId)}`); },
    beforeSubmit() { syncForm(true); },
    nativeUpload(input) { if (!syncingUpload) { ownedNativeFile = input.files?.[0]; void checkLogo(ownedNativeFile); } },
    error(message) { status.textContent = message; },
    destroy() {
      if (disposed) return;
      try { const native = uploadInput(), summary = summaryInput(); if (native && ownedNativeFile && native.files?.[0] === ownedNativeFile) native.value = ''; if (summary && summary.value === lastSummary) summary.value = ''; } catch { /* A newer or ambiguous binding belongs to its current owner. */ }
      disposed = true; uploadTicket++; releaseLogo(); stepObserver?.disconnect(); mobileMedia?.removeEventListener('change', updatePreviewMode); if (zoom.open) zoom.close(); if (dialog.open) dialog.close(); if (previewDialog.open) previewDialog.close(); restorePortal(true);
      if (closedForm?.node.isConnected) { closedForm.node.hidden = closedForm.hidden; if (!closedForm.hadClass) closedForm.node.classList.remove('cwp-config-quote-native'); }
      ui.remove(); delete root.dataset.mounted;
      if (manager.instances.get(root) === instance) manager.instances.delete(root);
    },
  };
  manager.instances.set(root, instance);
  try { redraw(); prepareClosedForm(); updatePreviewMode(); } catch (error) { instance.destroy(); throw error; }
  return instance.destroy;
}
export function boot() {
  const manager = runtime(document);
  for (const [root, instance] of manager.instances) if (!root.isConnected) instance.destroy();
  document.querySelectorAll<HTMLElement>('.cwp-bottle-configurator').forEach(root => { try { mountConfigurator(root); } catch {
    if (!root.querySelector(':scope > [data-cwp-error]')) { const error = element('p', 'The configurator configuration is incomplete. Please contact us.'); error.dataset.cwpError = 'true'; error.setAttribute('role', 'status'); root.append(error); }
  } });
}
function start() {
  const manager = runtime(document); if (manager.started) { boot(); return; } manager.started = true;
  document.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement)) return;
    const candidates = [...manager.instances].filter(([root, instance]) => root.isConnected && instance.targets(event.target as Node));
    if (!candidates.length) return;
    try { if (candidates.length !== 1) throw Error('This quote form is linked to more than one configurator. Please contact us.'); candidates[0][1].beforeSubmit(); }
    catch (error) { event.preventDefault(); event.stopImmediatePropagation(); for (const [, instance] of candidates) instance.error(friendlyError(error)); }
  }, true);
  document.addEventListener('change', event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return;
    const input = event.target;
    const candidates = [...manager.instances].filter(([root, instance]) => root.isConnected && instance.targets(input));
    if (candidates.length === 1) candidates[0][1].nativeUpload(input);
  }, true);
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return target?.matches('.cwp-bottle-configurator,.cwp-bottle-configurator > script[type="application/json"]') || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('.cwp-bottle-configurator') || !!node.querySelector('.cwp-bottle-configurator')));
    });
    if (!relevant || manager.scheduled) return; manager.scheduled = true;
    queueMicrotask(() => { manager.scheduled = false; boot(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  boot();
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start(); }

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import sharp from 'sharp';
import { catalogSchema, filterCatalogOptions, quoteSummary, validateSelection, type Catalog } from '../src/configurator/contract.js';
import { filterOptions, initialSelection, previewLayers, selectPart } from '../src/configurator/state.js';
import { compileConfiguratorPatch, assertConfiguratorQualified, widgetSettings } from '../src/configurator/compile.js';
import { buildConfiguratorPackage } from '../src/configurator/package.js';

const asset = { id: 1, url: 'https://assets.example/part.png' };
const option = (id: string, attributes: Record<string, string>, fit = ['crimp']) => ({ id, label: id, attributes, fit, image: asset, preview: asset, position: { x: 10, y: 10, width: 80, height: 80 } });
function catalog(): Catalog { return catalogSchema.parse({ version: 1, title: 'Create your bottle',
  bottles: [option('square', { shape: 'Square', size: '100ml' }), option('round', { shape: 'Round', size: '50ml' })],
  pumps: [option('gold', { color: 'Gold' }), option('screw', { color: 'Silver' }, ['screw'])], caps: [option('cap', { material: 'Wood' })],
  decorations: [{ id: 'frosted', label: 'Frosted', category: 'Frosted', finish: 'Matte', image: asset, overlays: [{ bottleId: 'square', image: asset }] }],
  fonts: [{ id: 'arial', label: 'Arial', family: 'Arial' }], logoArea: { x: 20, y: 40, width: 60, height: 40 }, form: { widgetId: 'a1b2c3d', summaryField: 'configuration', uploadField: 'logo' } }); }
const selected = (c: Catalog) => ({ ...initialSelection(c), bottle: 'square', pump: 'gold', cap: 'cap' });

test('catalog rejects executable URLs, invalid placement and duplicate identities', () => {
  for (const modify of [(c: Catalog) => { c.bottles[0].image.url = 'javascript:alert(1)'; }, (c: Catalog) => { c.bottles[0].position.width = 100; }, (c: Catalog) => { c.bottles.push(c.bottles[0]); }, (c: Catalog) => { c.decorations[0].overlays[0].bottleId = 'missing'; }]) { const c = catalog(); modify(c); assert.throws(() => catalogSchema.parse(c)); }
});
test('filters combine attributes, preserve options, and support empty results', () => {
  const c = catalog(); assert.equal(filterOptions(c.bottles, { shape: 'Square', size: '100ml' }).length, 1);
  assert.equal(filterOptions(c.bottles, { shape: 'Square', size: '50ml' }).length, 0); assert.equal(c.bottles.length, 2);
});
test('authored filter choices can share one inventory and preserve a configurable default', () => {
  const c = catalog(); c.bottles = Array.from({ length: 46 }, (_, index) => option(`bottle-${index + 1}`, { types: 'Crimp Neck (Default)' })); c.decorations[0].overlays[0].bottleId = 'bottle-1';
  c.filterGroups = { bottles: { types: { defaultValue: 'crimp', choices: [
    { value: 'crimp', label: 'Crimp Neck (Default)', matches: ['Crimp Neck (Default)'] },
    { value: 'screw', label: 'Screw Neck', matches: ['Crimp Neck (Default)'] },
  ] } } };
  assert.equal(filterCatalogOptions(c, 'bottles', { types: 'crimp' }).length, 46);
  assert.equal(filterCatalogOptions(c, 'bottles', { types: 'screw' }).length, 46);
  assert.equal(filterCatalogOptions(c, 'bottles', { types: 'unknown' }).length, 0);
  assert.doesNotThrow(() => catalogSchema.parse(c));
  assert.equal(JSON.parse(widgetSettings(c).filter_groups_json).bottles.types.defaultValue, 'crimp');
  const badDefault = structuredClone(c); badDefault.filterGroups!.bottles!.types.defaultValue = 'missing'; assert.throws(() => catalogSchema.parse(badDefault), /invalid_filter_group/);
  const badMatch = structuredClone(c); badMatch.filterGroups!.bottles!.types.choices[1].matches = ['Unknown bottle type']; assert.throws(() => catalogSchema.parse(badMatch), /invalid_filter_group/);
  const legacy = catalog(); assert.equal(filterCatalogOptions(legacy, 'bottles', { shape: 'Square' }).length, 1);
  assert.equal(widgetSettings(legacy).filter_groups_json, '{}');
});
test('compatibility rejects a changed part without silently changing other selections', () => {
  const c = catalog(), s = selected(c); assert.throws(() => selectPart(c, s, 'pumps', 'screw'), /incompatible/);
  assert.equal(s.pump, 'gold'); assert.throws(() => validateSelection(c, { ...s, cap: 'unknown' }));
  assert.equal(selectPart(c, s, 'bottles', 'round').pump, 'gold');
});
test('initial selection stays empty and requires one fit group shared by all three part types', () => {
  const c = catalog(); assert.deepEqual([initialSelection(c).bottle, initialSelection(c).pump, initialSelection(c).cap], [null, null, null]);
  c.bottles[0].fit = ['crimp', 'screw']; c.bottles[1].fit = ['crimp', 'screw']; c.pumps = [option('p', {}, ['crimp'])]; c.caps = [option('c', {}, ['screw'])];
  assert.throws(() => initialSelection(c), /no_compatible_combination/);
});
test('authored finish overlays are specific to a bottle and quote names come from catalog', () => {
  const c = catalog(), s = { ...selected(c), decoration: 'frosted' };
  assert.equal(previewLayers(c, s).layers.length, 4);
  const round = selectPart(c, s, 'bottles', 'round'); assert.equal(previewLayers(c, round).decorationPreviewAvailable, false); assert.equal(previewLayers(c, round).layers.length, 3);
  assert.equal(quoteSummary(c, round).decoration, 'Frosted');
});
test('typed integration preserves the native form and refuses altered submission policy', () => {
  const c = catalog(), form: any = { id: 'a1b2c3d', elType: 'widget', widgetType: 'form', elements: [], settings: { submit_actions: ['save-to-database', 'email'], form_fields: [{ _id: '1122334', custom_id: 'name', field_type: 'text' }] } }, slot: any = { id: 'c1d2e3f', elType: 'container', elements: [{ id: 'e1f2a3b', elType: 'widget', widgetType: 'heading', elements: [], settings: { title: 'Configure your bottle' } }], settings: {} };
  const patch = compileConfiguratorPatch([slot, form], c, 'c1d2e3f', 'd1e2f3a'); assert.deepEqual((patch.elements[1].settings.form_fields as unknown[]).slice(0,1), form.settings.form_fields); assert.equal(form.settings.form_fields.length, 1); assert.equal(slot.elements.length, 1); assert.deepEqual(patch.elements[0].elements[0], slot.elements[0]);
  form.settings.submit_actions = ['email']; assert.throws(() => compileConfiguratorPatch([slot, form], c, 'c1d2e3f', 'd1e2f3a'), /actions/);
  assert.throws(() => assertConfiguratorQualified({ version: 1, widgetType: 'clonewp_bottle_configurator', targetOrigin: 'https://target.example', packageSha256: 'a'.repeat(64), registered: true, controlsVerified: true, packageFilesVerified: true, saved: false, rendered: true, nativeEditable: true, interactions: true, formBound: true }, 'https://target.example', 'a'.repeat(64)), /not_qualified/);
});
test('actual PHP canonicalizes posted IDs and rejects incompatible or malicious choices', () => {
  const c = catalog(), s = quoteSummary(c, selected(c));
  const php = `define('ABSPATH',true);function add_action(...$args){}function sanitize_textarea_field($s){return strip_tags($s);}require 'D:/cloneWP/src/configurator/widget.php';$c=json_decode($argv[1],true);$s=json_decode($argv[2],true);try{echo json_encode(cwp_bc_quote($c,$s));}catch(Throwable $e){echo json_encode(['error'=>$e->getMessage()]);}`;
  const call = (payload: unknown) => JSON.parse(execFileSync('D:/cloneWP/.cache/php-8.3/php.exe', ['-r', php, JSON.stringify(c), JSON.stringify(payload)], { cwd: 'D:/cloneWP', encoding: 'utf8' }));
  const result = call({ ...s, bottle: '<script>forged</script>', url: 'https://evil.example' }); assert.equal(result.bottle, 'square'); assert.equal(result.url, undefined);
  assert.match(call({ ...s, selection: { ...s.selection, pump: 'screw' } }).error, /incompatible/);
  assert.match(call({ ...s, selection: { ...s.selection, logo: { ...s.logo, scale: 10 } } }).error, /logo/);
  const rotated = call({ ...s, selection: { ...s.selection, pantone: 'PANTONE 185 C', logo: { ...s.logo, rotation: -35, forged: true } } });
  assert.equal(rotated.logo.rotation, -35); assert.equal(rotated.selection.logo.forged, undefined); assert.equal(rotated.pantone, 'PANTONE 185 C'); assert.equal(rotated.selection.pantone, 'PANTONE 185 C');
  assert.match(call({ ...s, selection: { ...s.selection, logo: { ...s.logo, rotation: 181 } } }).error, /logo/);
  assert.match(call({ ...s, selection: { ...s.selection, pantone: 'x'.repeat(81) } }).error, /pantone/);
});
test('palette values remain native editable controls and PHP normalizes replacements', () => {
  const c = catalog(); c.logoColors = [{ label: 'Brand blue', value: '#1122ff' }, { label: 'Brand red', value: '#dd2233' }];
  const rows = widgetSettings(c).logo_colors as Array<{ _id: string; label: string; value: string }>; assert.deepEqual(rows.map(({ label, value }) => ({ label, value })), c.logoColors); assert.ok(rows.every(row => /^[a-f0-9]{7}$/.test(row._id)));
  const php = `define('ABSPATH',true);function add_action(...$args){}function sanitize_text_field($s){return strip_tags($s);}function sanitize_key($s){return $s;}require 'D:/cloneWP/src/configurator/widget.php';try{echo json_encode(cwp_bc_normalize(json_decode($argv[1],true)));}catch(Throwable $e){echo json_encode(['error'=>$e->getMessage()]);}`;
  const call = (settings: unknown) => JSON.parse(execFileSync('D:/cloneWP/.cache/php-8.3/php.exe', ['-r', php, JSON.stringify(settings)], { cwd: 'D:/cloneWP', encoding: 'utf8' }));
  assert.deepEqual(call({ logo_colors: rows }).logoColors, c.logoColors);
  assert.equal(call({ logo_colors: [{ label: 'Unsafe', value: 'url(javascript:alert(1))' }] }).error, 'configurator_palette');
  const malicious = structuredClone(c); malicious.logoColors![0].value = 'red;display:none'; assert.throws(() => catalogSchema.parse(malicious));
});
test('PHP accepts authored filter aliases and rejects stale matches or defaults', () => {
  const c = catalog(); c.bottles.forEach(bottle => { bottle.attributes.types = 'Crimp Neck (Default)'; });
  c.filterGroups = { bottles: { types: { defaultValue: 'crimp', choices: [
    { value: 'crimp', label: 'Crimp Neck (Default)', matches: ['Crimp Neck (Default)'] },
    { value: 'screw', label: 'Screw Neck', matches: ['Crimp Neck (Default)'] },
  ] } } };
  const php = `define('ABSPATH',true);function add_action(...$args){}function sanitize_text_field($s){return strip_tags($s);}function sanitize_key($s){return $s;}function absint($x){return abs((int)$x);}function wp_get_attachment_url($id){return 'https://assets.example/part.png';}function get_post_mime_type($id){return 'image/png';}require 'D:/cloneWP/src/configurator/widget.php';try{echo json_encode(cwp_bc_normalize(json_decode($argv[1],true)));}catch(Throwable $e){echo json_encode(['error'=>$e->getMessage()]);}`;
  const call = (settings: unknown) => JSON.parse(execFileSync('D:/cloneWP/.cache/php-8.3/php.exe', ['-r', php, JSON.stringify(settings)], { cwd: 'D:/cloneWP', encoding: 'utf8' }));
  const settings = widgetSettings(c);
  assert.deepEqual(call(settings).filterGroups, c.filterGroups);
  const stale = { ...settings, filter_groups_json: JSON.stringify({ bottles: { types: { choices: [{ value: 'stale', label: 'Stale', matches: ['Unknown'] }] } } }) };
  assert.equal(call(stale).error, 'configurator_filter_groups');
  const invalidDefault = { ...settings, filter_groups_json: JSON.stringify({ bottles: { types: { defaultValue: 'missing', choices: [{ value: 'crimp', label: 'Crimp', matches: ['Crimp Neck (Default)'] }] } } }) };
  assert.equal(call(invalidDefault).error, 'configurator_filter_groups');
});
test('package builds trusted runtime separately from page HTML and never enables itself', async () => {
  const dir = await mkdtemp('D:/cloneWP/tests/.tmp-configurator-');
  try { const manifest = await buildConfiguratorPackage(dir); assert.equal(manifest.status, 'local-development-not-qualified'); assert.equal(manifest.files.length, 3); assert.ok((await readFile(`${dir}/runtime.js`)).length > 1000); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('real browser filters, previews, native quote payload, safe text and responsive layout', async () => {
  const bundle = await build({ entryPoints: ['D:/cloneWP/src/configurator/runtime.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.route('https://assets.example/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64') }));
    const c = catalog(); await page.setContent(`<style>${await readFile('D:/cloneWP/src/configurator/style.css', 'utf8')}</style><div class="cwp-bottle-configurator"><script type="application/json">${JSON.stringify(c)}</script></div><div class="elementor-element-a1b2c3d"><form><input name="name" aria-label="Name"><input type="hidden" name="form_fields[configuration]"><input type="file" name="form_fields[logo][]"></form></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    assert.equal(await page.getByRole('button', { name: 'Request A Quote', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Round', exact: true }).click(); assert.match(await page.locator('.cwp-config-count').first().textContent() ?? '', /^1 /);
    await page.getByRole('button', { name: 'round', exact: true }).click();
    await page.getByRole('button', { name: 'gold', exact: true }).click();
    await page.getByRole('button', { name: 'cap', exact: true }).click();
    await page.getByLabel('Logo text', { exact: true }).fill('<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.cwp-config-logo-area img').count(), 0);
    await page.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    const summary = JSON.parse(await page.locator('input[name="form_fields[configuration]"]').inputValue()); assert.equal(summary.bottle, 'round'); assert.equal(summary.text, '<img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Close quote form', exact: true }).click();
    await page.getByRole('button', { name: 'Reset design', exact: true }).click(); assert.match(await page.locator('.cwp-config-count').first().textContent() ?? '', /^2 /);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.cwp-config-preview').evaluate(e => getComputedStyle(e).position), 'relative');
  } finally { await browser.close(); }
});

const pixel = async () => sharp({ create: { width: 8, height: 8, channels: 4, background: '#336699' } }).png().toBuffer();
const markup = (c: Catalog, rootId = 'designer') => `<div id="${rootId}" class="cwp-bottle-configurator"><script type="application/json">${JSON.stringify(c)}</script></div><div class="elementor-element-${c.form.widgetId}"><form><input name="name" aria-label="Name"><input type="hidden" name="form_fields[${c.form.summaryField}]"><input type="file" name="form_fields[${c.form.uploadField}][]"></form></div>`;
async function localRuntime(catalogs = [catalog()]) {
  const bundle = await build({ entryPoints: ['D:/cloneWP/src/configurator/runtime.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  await page.route('https://assets.example/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64') }));
  await page.setContent(catalogs.map((c, index) => markup(c, `designer-${index}`)).join(''));
  await page.evaluate(() => {
    const metrics = { submitListeners: 0, created: [] as string[], revoked: [] as string[] }; (window as any).__cwpMetrics = metrics;
    const add = document.addEventListener.bind(document), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    document.addEventListener = ((type: string, ...args: any[]) => { if (type === 'submit') metrics.submitListeners++; return (add as any)(type, ...args); }) as typeof document.addEventListener;
    URL.createObjectURL = value => { const url = create(value); metrics.created.push(url); return url; };
    URL.revokeObjectURL = value => { metrics.revoked.push(value); revoke(value); };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return { browser, page, bundle: bundle.outputFiles[0].text };
}
async function selectThree(root: import('playwright').Locator) {
  await root.getByRole('button', { name: 'square', exact: true }).click();
  await root.getByRole('button', { name: 'gold', exact: true }).click();
  await root.getByRole('button', { name: 'cap', exact: true }).click();
}
test('valid logos bind to the native upload, invalid replacements clear it, and reset wins an upload race', async () => {
  const { browser, page } = await localRuntime();
  try {
    const root = page.locator('#designer-0'), native = page.locator('.elementor-element-a1b2c3d input[type=file]');
    await selectThree(root);
    const logo = { name: 'brand.png', mimeType: 'image/png', buffer: await pixel() };
    await root.getByLabel('Upload logo', { exact: true }).setInputFiles(logo);
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.elementor-element-a1b2c3d input[type=file]')?.files?.[0]?.name === 'brand.png');
    assert.equal(await root.locator('.cwp-config-logo-area img').count(), 1);
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).logo.mode, 'image');
    // Filtering changes the visible catalog, never the customer's already chosen bottle.
    await root.getByRole('button', { name: 'Round', exact: true }).click();
    await root.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).bottle, 'square');
    await page.getByRole('button', { name: 'Close quote form', exact: true }).click();
    await root.getByLabel('Upload logo', { exact: true }).setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await page.waitForFunction(() => document.querySelector('.cwp-config-status')?.textContent?.includes('PNG, JPEG or WebP'));
    assert.equal(await native.evaluate(e => (e as HTMLInputElement).files?.length), 0);
    assert.equal(await root.locator('.cwp-config-logo-area img').count(), 0);
    await native.setInputFiles({ ...logo, name: 'native-logo.png' });
    await page.waitForFunction(() => document.querySelector('.cwp-config-logo-area img')?.getAttribute('src')?.startsWith('blob:'));
    assert.equal(await root.getByLabel('Upload logo', { exact: true }).evaluate(e => (e as HTMLInputElement).files?.[0]?.name), 'native-logo.png');
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).logo.mode, 'image');
    await root.getByLabel('Logo horizontal position', { exact: true }).fill('90');
    await root.getByRole('button', { name: 'Reset design', exact: true }).click();
    assert.equal(await root.getByLabel('Logo horizontal position', { exact: true }).inputValue(), '50');
    assert.equal(await native.evaluate(e => (e as HTMLInputElement).files?.length), 0);
    await page.evaluate(() => {
      const decode = window.createImageBitmap.bind(window);
      window.createImageBitmap = ((...args: any[]) => new Promise(resolve => { (window as any).__finishLogo = async () => resolve(await (decode as any)(...args)); })) as typeof createImageBitmap;
    });
    await root.getByLabel('Upload logo', { exact: true }).setInputFiles(logo);
    await page.waitForFunction(() => !!(window as any).__finishLogo);
    await root.getByRole('button', { name: 'Reset design', exact: true }).click();
    await page.evaluate(() => (window as any).__finishLogo());
    assert.equal(await root.locator('.cwp-config-logo-area img').count(), 0);
    assert.equal(await root.getByRole('button', { name: 'Request A Quote', exact: true }).isDisabled(), true);
    assert.equal(await native.evaluate(e => (e as HTMLInputElement).files?.length), 0);
    const metrics = await page.evaluate(() => (window as any).__cwpMetrics); assert.equal(metrics.created.length, metrics.revoked.length);
  } finally { await browser.close(); }
});
test('Elementor rerenders and repeated bundles replace only their own UI and revoke old logo URLs', async () => {
  const { browser, page, bundle } = await localRuntime();
  try {
    let root = page.locator('#designer-0'); await selectThree(root);
    await root.getByLabel('Upload logo', { exact: true }).setInputFiles({ name: 'brand.png', mimeType: 'image/png', buffer: await pixel() });
    await page.waitForFunction(() => document.querySelector('.cwp-config-logo-area img'));
    await page.addScriptTag({ content: bundle });
    assert.equal(await root.locator('.cwp-config-ui').count(), 1);
    assert.equal(await root.getByRole('button', { name: 'square', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => (window as any).__cwpMetrics.submitListeners), 1);
    await root.locator('script[type="application/json"]').evaluate(e => { const c = JSON.parse(e.textContent!); c.title = 'Updated native settings'; e.textContent = JSON.stringify(c); });
    await page.getByRole('heading', { name: 'Updated native settings', exact: true }).waitFor();
    assert.equal(await root.locator('.cwp-config-ui').count(), 1);
    assert.equal(await root.locator('details[open]').count(), 5);
    assert.equal(await root.getByRole('button', { name: 'Request A Quote', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.elementor-element-a1b2c3d input[type=file]').evaluate(e => (e as HTMLInputElement).files?.length), 0);
    await selectThree(root);
    await root.getByLabel('Upload logo', { exact: true }).setInputFiles({ name: 'again.png', mimeType: 'image/png', buffer: await pixel() });
    await page.waitForFunction(() => document.querySelector('.cwp-config-logo-area img'));
    await root.evaluate(e => e.replaceWith(e.cloneNode(true)));
    root = page.locator('#designer-0');
    await page.waitForFunction(() => document.querySelector('.cwp-bottle-configurator button')?.getAttribute('aria-pressed') === 'true' && !(document.querySelector('.cwp-config-logo-area img')));
    assert.equal(await root.locator('.cwp-config-ui').count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Request A Quote', exact: true }).isDisabled(), true);
    const metrics = await page.evaluate(() => (window as any).__cwpMetrics); assert.equal(metrics.submitListeners, 1); assert.deepEqual(metrics.revoked.sort(), metrics.created.sort());
  } finally { await browser.close(); }
});
test('two configurators retain separate native Form payloads and block an incomplete local submit', async () => {
  const one = catalog(), two = catalog(); two.form.widgetId = 'b1c2d3e';
  const { browser, page } = await localRuntime([one, two]);
  try {
    const first = page.locator('#designer-0'), second = page.locator('#designer-1'); await selectThree(first);
    await first.getByLabel('Logo text', { exact: true }).fill('First brand');
    assert.equal(await second.getByRole('button', { name: 'Request A Quote', exact: true }).isDisabled(), true);
    const blocked = await page.locator('.elementor-element-b1c2d3e form').evaluate(e => e.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(blocked, false);
    assert.match(await second.locator('.cwp-config-status').textContent() ?? '', /Select a bottle/);
    await selectThree(second); await second.getByLabel('Logo text', { exact: true }).fill('Second brand');
    assert.equal(JSON.parse(await page.locator('.elementor-element-a1b2c3d input[type=hidden]').inputValue()).text, 'First brand');
    assert.equal(JSON.parse(await page.locator('.elementor-element-b1c2d3e input[type=hidden]').inputValue()).text, 'Second brand');
    assert.equal(await page.evaluate(() => (window as any).__cwpMetrics.submitListeners), 1);
  } finally { await browser.close(); }
});
test('natural source layers preserve image aspect, shared neck anchors and the measured phone preview panel', async () => {
  const c = catalog();
  c.previewLayout = { mode: 'natural-stack', width: 400, minHeight: 364, outerPaddingTop: 220, bottleOffsetY: -32, capAndPumpAnchor: 'bottom:100%', mobile: { breakpoint: 991, minHeight: 237, outerPaddingTop: 135, bottleOffsetY: -20, previewLabel: 'View Renderings' } };
  const image = (name: string) => ({ id: 1, url: `https://assets.example/${name}.png` });
  c.bottles[0].preview = image('bottle'); c.bottles[1].preview = image('tall'); c.pumps[0].preview = image('pump'); c.caps[0].preview = image('cap');
  c.placeholders = { bottles: { image: image('ghost'), position: c.bottles[0].position }, pumps: { image: image('pump'), position: c.pumps[0].position }, caps: { image: image('cap'), position: c.caps[0].position } };
  const { browser, page } = await localRuntime([c]);
  try {
    page.setDefaultTimeout(5000);
    const images = new Map<string, Buffer>();
    for (const [name, height] of [['bottle', 248], ['tall', 600], ['ghost', 394], ['pump', 80], ['cap', 250]] as const) images.set(`/` + name + '.png', await sharp({ create: { width: 400, height, channels: 4, background: '#336699' } }).png().toBuffer());
    await page.route('https://assets.example/**', r => { const buffer = images.get(new URL(r.request().url()).pathname); return buffer ? r.fulfill({ contentType: 'image/png', body: buffer }) : r.fallback(); });
    await page.addStyleTag({ content: await readFile('D:/cloneWP/src/configurator/style.css', 'utf8') });
    // Refresh after the deterministic local image routes have been installed.
    await page.locator('#designer-0 script[type="application/json"]').evaluate(e => { const c = JSON.parse(e.textContent!); c.title = 'Natural preview'; for (const part of ['bottles','pumps','caps']) for (const option of c[part]) option.preview.url += '?natural=1'; for (const item of Object.values(c.placeholders) as any[]) item.image.url += '?natural=1'; e.textContent = JSON.stringify(c); });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.cwp-config-natural-canvas img')].length === 3 && [...document.querySelectorAll<HTMLImageElement>('.cwp-config-natural-canvas img')].every(e => e.complete && e.naturalWidth === 400));
    const root = page.locator('#designer-0'); await root.getByRole('button', { name: 'square', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.cwp-config-part-bottles img')?.naturalHeight === 248);
    const geometry = await root.locator('.cwp-config-stage').evaluate(e => {
      const [canvas, bottle, cap, pump] = ['.cwp-config-natural-canvas','.cwp-config-part-bottles','.cwp-config-part-caps','.cwp-config-part-pumps'].map(selector => { const r = e.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      return { stage: e.getBoundingClientRect().toJSON(), canvas, bottle, cap, pump };
    });
    assert.equal(geometry.stage.width, 400); assert.equal(geometry.stage.height, 584); assert.equal(geometry.canvas.height, 364);
    assert.equal(geometry.bottle.y, geometry.canvas.y - 32); assert.equal(geometry.bottle.height, 248);
    assert.equal(geometry.cap.y + geometry.cap.height, geometry.canvas.y); assert.equal(geometry.pump.y + geometry.pump.height, geometry.canvas.y);
    await root.getByRole('button', { name: 'round', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.cwp-config-part-bottles img')?.naturalHeight === 600);
    assert.equal(await root.locator('.cwp-config-natural-canvas').evaluate(e => e.getBoundingClientRect().height), 600);
    await page.setViewportSize({ width: 390, height: 600 });
    await root.locator('script[type="application/json"]').evaluate(e => { const c = JSON.parse(e.textContent!); c.title = 'Phone preview'; e.textContent = JSON.stringify(c); });
    await root.getByRole('button', { name: 'View Renderings', exact: true }).waitFor();
    await root.getByRole('button', { name: 'View Renderings', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.cwp-config-part-bottles img')?.naturalHeight === 394);
    const phone = await root.locator('.cwp-config-preview-panel').evaluate(e => ({ panel: e.getBoundingClientRect().toJSON(), stage: e.querySelector('.cwp-config-stage')!.getBoundingClientRect().toJSON(), canvas: e.querySelector('.cwp-config-natural-canvas')!.getBoundingClientRect().toJSON() }));
    assert.equal(phone.panel.width, 360); assert.equal(phone.panel.x, 15); assert.equal(phone.canvas.width, 252);
    assert.ok(Math.abs(phone.canvas.height - 248.22) < .05); assert.ok(Math.abs(phone.stage.height - 383.22) < .05);
    await page.getByRole('button', { name: 'Close renderings', exact: true }).click();
    await selectThree(root); await root.getByRole('button', { name: 'View Renderings', exact: true }).click();
    await root.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: 'Request A Quote', exact: true }).count(), 1);
    assert.equal(await page.locator('form').count(), 1);
    await page.getByRole('button', { name: 'Close quote form', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: 'View Renderings', exact: true }).count(), 1);
    await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'View Renderings', exact: true }).waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.querySelector('.cwp-config-preview')?.parentElement?.className === 'cwp-config-layout');
    assert.equal(await root.locator('.cwp-config-preview-trigger').isHidden(), true);
  } finally { await browser.close(); }
});
test('quote dialog retains the single native Form, restores it on close/rerender, and preserves a newer Form replacement', async () => {
  const { browser, page } = await localRuntime();
  try {
    const root = page.locator('#designer-0'); await selectThree(root);
    await page.locator('.elementor-element-a1b2c3d').evaluate(e => { (window as any).__nativeFormBefore = e; });
    await root.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator('.elementor-element-a1b2c3d').evaluate(e => e === (window as any).__nativeFormBefore), true);
    await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Request A Quote', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => { const e = document.querySelector<HTMLElement>('.elementor-element-a1b2c3d'); return e?.parentElement?.tagName !== 'DIALOG' && e?.hidden === true; });
    assert.equal(await page.locator('.elementor-element-a1b2c3d').evaluate(e => e.parentElement?.tagName !== 'DIALOG' && (e as HTMLElement).hidden === true), true);
    await root.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    await root.locator('script[type="application/json"]').evaluate(e => { const c = JSON.parse(e.textContent!); c.title = 'Editor rerender'; e.textContent = JSON.stringify(c); });
    await root.getByRole('heading', { name: 'Editor rerender', exact: true }).waitFor();
    assert.equal(await page.locator('form').count(), 1); assert.equal(await page.locator('dialog[open]').count(), 0);
    await selectThree(root); await root.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    await page.evaluate(() => {
      const replacement = document.createElement('div'); replacement.className = 'elementor-element-a1b2c3d';
      replacement.innerHTML = '<form><input name="name" aria-label="Name" value="Fresh native edit"><input type="hidden" name="form_fields[configuration]"><input type="file" name="form_fields[logo][]"></form>';
      document.body.append(replacement);
    });
    await page.getByRole('button', { name: 'Close quote form', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('form').length === 1);
    assert.equal(await page.locator('.elementor-element-a1b2c3d input[name=name]').inputValue(), 'Fresh native edit');
    await root.evaluate(e => e.remove());
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.elementor-element-a1b2c3d')?.hidden === false);
    assert.equal(await page.locator('.elementor-element-a1b2c3d').evaluate(e => e.classList.contains('cwp-config-quote-native')), false);
  } finally { await browser.close(); }
});
test('source bottle type controls keep the configured default and expose an alias', async () => {
  const c = catalog(); c.previewLayout = { mode: 'natural-stack', width: 400, minHeight: 364, outerPaddingTop: 220, bottleOffsetY: -32, capAndPumpAnchor: 'bottom:100%' };
  c.bottles.forEach(bottle => { bottle.attributes.types = 'Crimp Neck (Default)'; });
  c.filterGroups = { bottles: { types: { defaultValue: 'crimp', choices: [
    { value: 'crimp', label: 'Crimp Neck (Default)', matches: ['Crimp Neck (Default)'] },
    { value: 'screw', label: 'Screw Neck', matches: ['Crimp Neck (Default)'] },
  ] } } };
  const { browser, page } = await localRuntime([c]);
  try {
    const root = page.locator('#designer-0'), types = root.locator('[data-filter-part="bottles"][data-filter-attribute="types"]');
    const crimp = types.getByRole('button', { name: 'Crimp Neck (Default)', exact: true }), screw = types.getByRole('button', { name: 'Screw Neck', exact: true });
    assert.equal(await types.getByRole('button').count(), 2);
    assert.equal(await crimp.getAttribute('aria-pressed'), 'true');
    assert.equal(await root.locator('.cwp-config-count').first().textContent(), 'There is 2 corresponding bottle(s)');
    const first = await root.locator('details').first().locator('.cwp-config-option').allTextContents();
    await screw.click();
    assert.equal(await screw.getAttribute('aria-pressed'), 'true');
    assert.equal(await root.locator('.cwp-config-count').first().textContent(), 'There is 2 corresponding bottle(s)');
    assert.deepEqual(await root.locator('details').first().locator('.cwp-config-option').allTextContents(), first);
    await root.getByRole('button', { name: 'Clear bottle options', exact: true }).click();
    assert.equal(await crimp.getAttribute('aria-pressed'), 'true');
    assert.equal(await root.locator('.cwp-config-count').first().textContent(), 'There is 2 corresponding bottle(s)');
  } finally { await browser.close(); }
});
test('source controls preserve selections across grouped filters and tabs, and removable chips update the native payload', async () => {
  const c = catalog(); c.previewLayout = { mode: 'natural-stack', width: 400, minHeight: 364, outerPaddingTop: 220, bottleOffsetY: -32, capAndPumpAnchor: 'bottom:100%', mobile: { breakpoint: 991, minHeight: 237, outerPaddingTop: 135, bottleOffsetY: -20, previewLabel: 'View Renderings' } };
  c.decorations = [
    { id: 'gloss', label: 'Gloss sample', category: 'Color Coating', finish: 'Glossy', image: asset, overlays: [] },
    { id: 'matte', label: 'Matte sample', category: 'Color Coating', finish: 'Matte', image: asset, overlays: [] },
    { id: 'gold-finish', label: 'Gold sample', category: 'Metalizing', finish: 'Golden', image: asset, overlays: [] },
  ];
  const { browser, page } = await localRuntime([c]);
  try {
    await page.addStyleTag({ content: await readFile('D:/cloneWP/src/configurator/style.css', 'utf8') });
    const root = page.locator('#designer-0'); await selectThree(root);
    await root.locator('details').first().getByRole('button', { name: 'Round', exact: true }).click();
    assert.equal(await root.locator('.cwp-config-count').first().textContent(), 'There is 1 corresponding bottle(s)');
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).bottle, 'square');
    await root.getByRole('button', { name: 'Remove Round', exact: true }).click();
    assert.equal(await root.locator('.cwp-config-count').first().textContent(), 'There is 2 corresponding bottle(s)');
    const coating = root.getByRole('group', { name: 'Color Coating', exact: true }), metal = root.getByRole('group', { name: 'Metalizing', exact: true });
    await coating.getByRole('button', { name: 'Matte sample', exact: true }).click();
    await coating.getByRole('button', { name: 'Glossy', exact: true }).click();
    assert.equal(await coating.getByRole('button', { name: 'Matte sample', exact: true }).count(), 0);
    assert.equal(await coating.getByRole('button', { name: 'Gloss sample', exact: true }).count(), 1);
    assert.equal(await metal.getByRole('button', { name: 'Gold sample', exact: true }).count(), 1);
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).decoration, 'Matte sample');
    assert.equal(await root.locator('.cwp-config-part-decorations,.cwp-config-finish-sample').count(), 0);
    await root.getByRole('button', { name: 'Clear decoration options', exact: true }).click();
    assert.equal(await coating.getByRole('button', { name: 'Matte sample', exact: true }).count(), 1);
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).decoration, 'None');
    const imageTab = root.getByRole('tab', { name: 'Add Images', exact: true }), textTab = root.getByRole('tab', { name: 'Add Text', exact: true });
    assert.equal(await imageTab.getAttribute('aria-selected'), 'true');
    await imageTab.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await textTab.evaluate(e => e === document.activeElement), true);
    assert.equal(await textTab.getAttribute('aria-selected'), 'true');
    assert.equal(await root.getByRole('tabpanel', { name: 'Add Images', exact: true }).isHidden(), true);
    await root.getByLabel('Logo text', { exact: true }).fill('Saved text');
    await imageTab.click();
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).logo.mode, 'none');
    await root.getByLabel('Upload logo', { exact: true }).setInputFiles({ name: 'source-brand.png', mimeType: 'image/png', buffer: await pixel() });
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.elementor-element-a1b2c3d input[type=file]')?.files?.[0]?.name === 'source-brand.png');
    await textTab.click();
    assert.equal(await root.getByLabel('Logo text', { exact: true }).inputValue(), 'Saved text');
    assert.equal(JSON.parse(await page.locator('input[type=hidden]').inputValue()).text, 'Saved text');
    assert.equal(await page.locator('.elementor-element-a1b2c3d input[type=file]').evaluate(e => (e as HTMLInputElement).files?.length), 0);
    await imageTab.click();
    assert.equal(await page.locator('.elementor-element-a1b2c3d input[type=file]').evaluate(e => (e as HTMLInputElement).files?.[0]?.name), 'source-brand.png');
    await root.getByRole('button', { name: 'Clear bottle options', exact: true }).click();
    await root.getByRole('button', { name: 'Remove source-brand.png', exact: true }).click();
    assert.equal(await page.locator('.elementor-element-a1b2c3d input[type=file]').evaluate(e => (e as HTMLInputElement).files?.length), 0);
    assert.equal(await root.getByRole('button', { name: 'Request A Quote', exact: true }).isDisabled(), true);
    assert.equal(await root.getByRole('button', { name: 'gold', exact: true }).getAttribute('aria-pressed'), 'true');
    const metrics = await page.evaluate(() => (window as any).__cwpMetrics); assert.deepEqual(metrics.created, metrics.revoked);
  } finally { await browser.close(); }
});
test('source step navigation expands collapsed sections without losing state and hides on phones', async () => {
  const c = catalog(); c.previewLayout = { mode: 'natural-stack', width: 400, minHeight: 364, outerPaddingTop: 220, bottleOffsetY: -32, capAndPumpAnchor: 'bottom:100%', mobile: { breakpoint: 991, minHeight: 237, outerPaddingTop: 135, bottleOffsetY: -20, previewLabel: 'View Renderings' } };
  const { browser, page } = await localRuntime([c]);
  try {
    await page.addStyleTag({ content: await readFile('D:/cloneWP/src/configurator/style.css', 'utf8') });
    await page.emulateMedia({ reducedMotion: 'reduce' }); const root = page.locator('#designer-0');
    await root.getByRole('button', { name: 'square', exact: true }).click();
    const section = root.locator('.cwp-config-choices>details').first(); await section.locator('summary').click();
    assert.equal(await section.getAttribute('open'), null);
    const nav = root.getByRole('navigation', { name: 'Bottle customization steps', exact: true });
    await nav.getByRole('button', { name: 'Step 1: Bottle', exact: true }).click();
    assert.equal(await section.getAttribute('open'), ''); assert.equal(await section.locator('summary').evaluate(e => e === document.activeElement), true);
    assert.equal(await root.getByRole('button', { name: 'square', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await nav.isHidden(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await root.getByRole('tab', { name: 'Add Text', exact: true }).click(); await root.getByLabel('Logo text', { exact: true }).fill('Phone brand');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await root.getByLabel('Change Your Font', { exact: true }).isVisible(), true);
  } finally { await browser.close(); }
});
test('42 replaceable swatches, Pantone and rotation persist in the native quote and composed thumbnail/zoom', async () => {
  const c = catalog(); c.previewLayout = { mode: 'natural-stack', width: 400, minHeight: 364, outerPaddingTop: 220, bottleOffsetY: -32, capAndPumpAnchor: 'bottom:100%', mobile: { breakpoint: 991, minHeight: 237, outerPaddingTop: 135, bottleOffsetY: -20, previewLabel: 'View Renderings' } };
  c.logoColors = Array.from({ length: 42 }, (_, index) => ({ label: `Palette color ${index + 1}`, value: `#${(index * 1234).toString(16).padStart(6, '0')}` }));
  const { browser, page } = await localRuntime([c]);
  try {
    await page.addStyleTag({ content: await readFile('D:/cloneWP/src/configurator/style.css', 'utf8') });
    const root = page.locator('#designer-0'); await selectThree(root); await root.getByRole('tab', { name: 'Add Text', exact: true }).click();
    await root.getByLabel('Logo text', { exact: true }).fill('Rotated brand');
    const palette = root.getByRole('group', { name: 'Text colors', exact: true }); assert.equal(await palette.getByRole('button').count(), 42);
    await palette.getByRole('button', { name: 'Palette color 42', exact: true }).click();
    assert.equal(await root.getByLabel('Text color', { exact: true }).inputValue(), c.logoColors[41].value);
    assert.equal(await palette.getByRole('button', { name: 'Palette color 42', exact: true }).getAttribute('aria-pressed'), 'true');
    await root.getByLabel('Pantone number', { exact: true }).fill('PANTONE 185 C');
    await root.locator('.cwp-config-logo-adjust>summary').click(); await root.getByLabel('Logo rotation', { exact: true }).fill('45');
    const summary = JSON.parse(await page.locator('input[type=hidden]').inputValue()); assert.equal(summary.pantone, 'PANTONE 185 C'); assert.equal(summary.selection.logo.rotation, 45); assert.equal(summary.color, c.logoColors[41].value);
    assert.match(await root.locator('.cwp-config-stage:not([aria-hidden]) .cwp-config-logo-area span').getAttribute('style') ?? '', /rotate\(45deg\)/);
    await root.getByRole('button', { name: 'Request A Quote', exact: true }).click();
    const thumb = root.getByRole('button', { name: 'Enlarge bottle design', exact: true });
    assert.equal(await thumb.locator('.cwp-config-logo-area span').textContent(), 'Rotated brand');
    assert.match(await thumb.locator('.cwp-config-logo-area span').getAttribute('style') ?? '', /rotate\(45deg\)/);
    assert.equal(await thumb.locator('.cwp-config-design-composition').evaluate(e => e.getBoundingClientRect().width), 150);
    await thumb.click(); const zoom = page.getByRole('dialog', { name: 'Bottle design enlarged', exact: true }); await zoom.waitFor();
    assert.equal(await zoom.locator('.cwp-config-logo-area span').textContent(), 'Rotated brand');
    assert.equal(await page.locator('form').count(), 1);
    await page.keyboard.press('Escape'); await zoom.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.cwp-config-design-thumbnail') === document.activeElement);
    assert.equal(await page.getByRole('dialog', { name: 'Request A Quote', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Close quote form', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await root.getByRole('button', { name: 'View Renderings', exact: true }).click(); await root.getByRole('button', { name: 'Request A Quote', exact: true }).click(); await thumb.click();
    assert.equal(await zoom.isVisible(), true); assert.equal(await page.locator('form').count(), 1);
    await page.getByRole('button', { name: 'Close enlarged design', exact: true }).click(); await page.getByRole('button', { name: 'Close quote form', exact: true }).click(); await page.getByRole('button', { name: 'Close renderings', exact: true }).click();
    await root.locator('script[type="application/json"]').evaluate(e => { const c = JSON.parse(e.textContent!); c.title = 'Replaceable palette'; c.logoColors = [{ label: 'New brand color', value: '#aabbcc' }]; e.textContent = JSON.stringify(c); });
    await root.getByRole('heading', { name: 'Replaceable palette', exact: true }).waitFor();
    await root.getByRole('tab', { name: 'Add Text', exact: true }).click(); assert.equal(await root.getByRole('group', { name: 'Text colors', exact: true }).getByRole('button').count(), 1);
    assert.equal(await root.getByLabel('Pantone number', { exact: true }).inputValue(), '');
    await root.getByLabel('Logo text', { exact: true }).fill('Reset rotation'); await root.locator('.cwp-config-logo-adjust>summary').click(); assert.equal(await root.getByLabel('Logo rotation', { exact: true }).inputValue(), '0');
  } finally { await browser.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { spawnSync } from 'node:child_process';
import { native44Id } from '../src/native44/adapters.js';
import { parseNavigationForms, compileNavigationFormHtml, compileNavigationFormPatch, assertNavigationFormBoundary, navigationFormPhpHelpers, type NavigationFormSpec } from '../src/replica-full/navigation-form/index.js';
import type { ElementorElement } from '../src/wordpress/types.js';
import type { FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';

const source = 'https://hoshiichi.com/', task = 'hoshiichi-form-test';
function spec(): NavigationFormSpec { return { key: 'product-filter', slotComponentKey: 'filter-slot', sourceUnitIds: ['filter'], sourceFactIds: ['filter-form'], sourceEvidence: { path: 'source/form-source.json', sha256: 'a'.repeat(64) }, method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途', options: [{ label: 'すべて', value: '' }, { label: 'スキンケア', value: 'app_skincare' }, { label: 'ヘアケア', value: 'app_haircare' }] }, { name: 'p_vol_range', label: '容量', options: [{ label: 'すべて', value: '' }, { label: '~50ml', value: '~50' }, { label: '50~100ml', value: '50-100' }, { label: '100~200ml', value: '100-200' }, { label: '200~500ml', value: '200-500' }, { label: '500ml~', value: '500~' }] }], submitLabel: '検索' }; }
function elements(): ElementorElement[] { return [{ id: 'outer', elType: 'container', settings: { css_classes: 'unchanged' }, elements: [{ id: 'title', elType: 'widget', widgetType: 'heading', settings: { title: 'Unchanged' }, elements: [] }, { id: native44Id(task, 'filter-slot'), elType: 'container', settings: { padding: { top: '10' } }, elements: [{ id: 'filtertitle', elType: 'widget', widgetType: 'heading', settings: { title: 'PRODUCTS SEARCH' }, elements: [] }] }] }]; }
function snapshot(): FullReplicaRemoteSnapshot { const hash = 'a'.repeat(64), identity = { headerId: 'header_123', moduleKey: 'hoshiichi', owner: { ownerId: 'clonewp', runId: 'hoshiichi-run' }, targetOrigin: 'https://target.example' }; return { hash, receipts: {}, header: { hash, contract: {} as any, resources: {} as any, snapshot: { defaultHeaderId: 'default', presetReferences: [], otherReferences: [], globalHash: hash, module: { identity, name: 'HOSHIICHI', header: {} as any, style: { id: 1, css: 'original' }, menus: {}, pages: { 99: { pageId: 99, postType: 'page', status: 'draft', template: 'elementor_header_footer', runId: 'hoshiichi-run', bodyHash: hash, headerId: 'header_123', snapshotHash: hash } }, receipts: {} } } }, page: { pageId: 99, runId: 'hoshiichi-run', status: 'draft', template: 'elementor_header_footer', title: 'HOSHIICHI', slug: 'hoshiichi', headerId: 'header_123', elements: elements(), settings: { custom_css: 'unchanged' }, bodyHash: hash, built: true, flags: { footer: '1' }, publicUrl: 'https://target.example/hoshiichi/' } }; }

test('typed source GET form compiles exact native names/values with associated labels and one submit', () => {
  const referenced = spec(); referenced.sourceUnitIds = ['wide/interaction:form']; referenced.sourceFactIds = ['wide:interaction:form']; assert.equal(parseNavigationForms([referenced], source).length, 1);
  const html = compileNavigationFormHtml(spec(), source, task), fragment = parseFragment(html), form = fragment.childNodes[0] as any;
  assert.equal(form.tagName, 'form'); assert.equal(fragment.childNodes.length, 1);
  const attrs = (node: any) => Object.fromEntries(node.attrs.map((attr: any) => [attr.name, attr.value]));
  assert.equal(attrs(form).action, spec().action); assert.equal(attrs(form).method, 'get'); assert.equal(attrs(form).id, `clonewp-nav-${native44Id(task, 'navigation-form:product-filter')}`);
  const selects = form.childNodes.filter((node: any) => node.tagName === 'select'), labels = form.childNodes.filter((node: any) => node.tagName === 'label');
  assert.equal(selects.length, 2);
  for (const [index, select] of selects.entries()) { const field = spec().fields[index]; assert.equal(attrs(select).name, field.name); assert.equal(attrs(labels[index]).for, attrs(select).id); assert.equal(labels[index].childNodes[0].value, field.label); assert.deepEqual(select.childNodes.map((option: any) => ({ value: attrs(option).value, label: option.childNodes[0].value })), field.options); }
  assert.equal(form.childNodes.filter((node: any) => node.tagName === 'button').length, 1); assert.doesNotMatch(html, /script|onchange|hidden|inert|disabled/i);
  const submitted = new URL(spec().action); submitted.search = new URLSearchParams({ application: 'app_skincare', p_vol_range: '50-100' }).toString(); assert.equal(submitted.href, 'https://hoshiichi.com/all_product?application=app_skincare&p_vol_range=50-100');
});

test('only fixed attributes are emitted and hostile display text remains text', () => {
  const form = spec(); form.fields[0].label = '<img src=x onerror=alert(1)>'; form.fields[0].options[0] = { label: "'\"<script>&", value: "'\"<script>&" }; form.submitLabel = '<script>alert(1)</script>';
  const html = compileNavigationFormHtml(form, source, task), tags: string[] = []; const walk = (node: any) => { if (node.tagName) tags.push(node.tagName); for (const attr of node.attrs ?? []) assert.ok(!/^on/i.test(attr.name)); for (const child of node.childNodes ?? []) walk(child); }; walk(parseFragment(html));
  assert.ok(tags.every(tag => ['form', 'label', 'select', 'option', 'button'].includes(tag))); assert.match(html, /&lt;script&gt;/); assert.match(html, /&#39;&quot;/);
});

test('rejects POST, extra controls/HTML/events, hidden credentials, duplicate names/options and unsafe actions', () => {
  const mutations: Array<(form: any) => void> = [form => { form.method = 'post'; }, form => { form.html = '<form></form>'; }, form => { form.fields[0].type = 'hidden'; }, form => { form.fields[0].onchange = 'alert(1)'; }, form => { form.fields[0].name = 'access_token'; }, form => { form.fields[0].options[0].value = 'Bearer credential'; }, form => { form.fields[1].name = form.fields[0].name; }, form => { form.fields[0].options[1].value = ''; }, form => { form.sourceFactIds = []; }, form => { form.submitLabel = ''; }];
  for (const mutate of mutations) { const form: any = spec(); mutate(form); assert.throws(() => parseNavigationForms([form], source)); }
  for (const action of ['https://attacker.com/all_product', 'http://hoshiichi.com/all_product', '/all_product', 'javascript:alert(1)', 'https://user:pass@hoshiichi.com/all_product', 'https://hoshiichi.com/all_product?nonce=secret', 'https://hoshiichi.com/all_product#token', 'https://127.0.0.1/all_product', 'https://internal.local/all_product']) { const form = spec(); form.action = action; assert.throws(() => parseNavigationForms([form], source)); }
  for (const url of ['https://localhost/', 'https://192.168.0.1/', 'https://foo.internal/', 'https://hoshiichi.com:443/', 'https://hoshiichi.com/a/../']) assert.throws(() => parseNavigationForms([spec()], url));
  assert.throws(() => parseNavigationForms([spec(), spec()], source), /duplicate_form/);
});

test('patch appends one HTML widget to the owned nonempty container and preserves its original native children and settings', () => {
  const before = elements(), original = structuredClone(before), patch = compileNavigationFormPatch(before, [spec()], source, task), expected = structuredClone(before);
  expected[0].elements[1].elements.push({ id: patch.widgetIds[0], elType: 'widget', widgetType: 'html', settings: { html: compileNavigationFormHtml(spec(), source, task) }, elements: [] });
  assert.deepEqual(patch.elements, expected); assert.deepEqual(before, original); assert.deepEqual(patch.slotIds, [native44Id(task, 'filter-slot')]);
  assert.throws(() => compileNavigationFormPatch(patch.elements, [spec()], source, task), /slot_form_exists|widget_exists/);
  assert.throws(() => compileNavigationFormPatch([], [spec()], source, task), /slot_missing/);
  const duplicate = elements(); duplicate.push(structuredClone(duplicate[0].elements[1])); assert.throws(() => compileNavigationFormPatch(duplicate, [spec()], source, task), /tree_invalid/);
  const occupied = elements(); occupied[0].elements[1].elements.push({ id: 'intruder', elType: 'widget', widgetType: 'form', settings: {}, elements: [] }); assert.throws(() => compileNavigationFormPatch(occupied, [spec()], source, task), /slot_form_exists/);
  const htmlForm = elements(); htmlForm[0].elements[1].elements.push({ id: 'nested', elType: 'container', settings: {}, elements: [{ id: 'existing', elType: 'widget', widgetType: 'html', settings: { html: '<FORM method="get"></FORM>' }, elements: [] }] }); assert.throws(() => compileNavigationFormPatch(htmlForm, [spec()], source, task), /slot_form_exists/);
  const collision = elements(); collision[0].elements.push({ id: patch.widgetIds[0], elType: 'widget', widgetType: 'heading', settings: {}, elements: [] }); assert.throws(() => compileNavigationFormPatch(collision, [spec()], source, task), /widget_exists/);
  const wrong = elements(); wrong[0].elements[1].elType = 'widget'; assert.throws(() => compileNavigationFormPatch(wrong, [spec()], source, task), /slot_not_container/);
});

test('readback boundary rejects CSS, settings, title, unrelated subtree, form, owned header and global changes', () => {
  const before = snapshot(), patch = compileNavigationFormPatch(before.page!.elements, [spec()], source, task), after = structuredClone(before); after.page!.elements = patch.elements; after.page!.bodyHash = 'b'.repeat(64); after.header.snapshot.module!.pages['99'].bodyHash = after.page!.bodyHash; after.header.snapshot.module!.pages['99'].snapshotHash = 'c'.repeat(64);
  assertNavigationFormBoundary(before, after, patch, [spec()], source, task);
  const mutations: Array<(value: FullReplicaRemoteSnapshot) => void> = [v => { v.page!.settings.custom_css = 'changed'; }, v => { v.page!.title = 'changed'; }, v => { v.page!.elements[0].settings.css_classes = 'changed'; }, v => { v.page!.elements[0].elements[1].elements.at(-1)!.settings.html = '<form></form>'; }, v => { v.page!.elements[0].elements[1].elements[0].settings.title = 'changed native heading'; }, v => { v.header.snapshot.globalHash = 'd'.repeat(64); }, v => { v.header.snapshot.module!.style!.css = 'changed'; }, v => { v.header.snapshot.module!.pages['99'].headerId = null; }, v => { v.header.resources = { modified: true } as any; }, v => { v.page!.status = 'publish'; }];
  for (const mutate of mutations) { const changed = structuredClone(after); mutate(changed); assert.throws(() => assertNavigationFormBoundary(before, changed, patch, [spec()], source, task), /boundary_changed|draft_required/); }
  const forged = structuredClone(patch); forged.elements[0].settings.css_classes = 'changed'; const forgedAfter = structuredClone(after); forgedAfter.page!.elements = forged.elements; assert.throws(() => assertNavigationFormBoundary(before, forgedAfter, forged, [spec()], source, task), /boundary_changed/);
});

test('PHP helper is a pure compiler with no WordPress mutation and optional runtime parity', context => {
  assert.match(navigationFormPhpHelpers, /\$navigationFormPatch=static function\(\$elements,\$forms,\$sourceUrl,\$taskId\)/);
  assert.doesNotMatch(navigationFormPhpHelpers, /(?:update_option|update_post_meta|wp_insert|wp_remote|->save|eval\(|file_put_contents)/);
  const probe = spawnSync('php', ['-v'], { encoding: 'utf8' }); if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') { context.diagnostic('PHP executable unavailable; pure-compiler runtime parity requires target validation.'); return; }
  assert.equal(probe.status, 0, probe.stderr);
  const input = Buffer.from(JSON.stringify({ elements: elements(), forms: [spec()], sourceUrl: source, taskId: task })).toString('base64');
  const code = `${navigationFormPhpHelpers}\n$input=json_decode(base64_decode('${input}'),true);echo json_encode($navigationFormPatch($input['elements'],$input['forms'],$input['sourceUrl'],$input['taskId']),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);`;
  const result = spawnSync('php', ['-r', code], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), compileNavigationFormPatch(elements(), [spec()], source, task));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogSchema, type Catalog } from '../src/configurator/contract.js';
import { prepareConfiguratorPatch, prepareConfiguratorCatalogRevision } from '../src/configurator/flow.js';
import { configuratorDriverCode, WordPressConfiguratorDriver } from '../src/configurator/driver.js';
import { widgetSettings } from '../src/configurator/compile.js';
import type { ElementorElement } from '../src/wordpress/types.js';

const bytesSha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const origin = 'https://target.example';
const identity = { targetOrigin: origin, runId: 'configurator-test-run', pageId: 123, contractHash: 'f'.repeat(64) };
const media = { id: 101, url: `${origin}/wp-content/uploads/bottle.png` };
const part = (id: string) => ({ id, label: id, image: media, preview: media,
  position: { x: 0, y: 0, width: 100, height: 100 }, attributes: {}, fit: ['visual-only'] });
function catalog(): Catalog { return catalogSchema.parse({ version: 1, title: 'Bottle designer',
  bottles: [part('bottle-a')], pumps: [part('pump-a')], caps: [part('cap-a')], decorations: [],
  fonts: [{ id: 'arial', label: 'Arial', family: 'Arial' }],
  logoColors: [{ label: 'Copper', value: '#C97442' }],
  logoArea: { x: 20, y: 20, width: 60, height: 60 },
  form: { widgetId: 'bbbbbbb', summaryField: 'configuration', uploadField: 'logo' } }); }
function base(): ElementorElement[] { return [
  { id: 'aaaaaaa', elType: 'container', settings: { padding: 8 }, elements: [
    { id: 'ddddddd', elType: 'widget', widgetType: 'heading', settings: { title: 'Design your bottle' }, elements: [] },
  ] },
  { id: 'bbbbbbb', elType: 'widget', widgetType: 'form', settings: { submit_actions: ['save-to-database', 'email'],
    email_to: 'owner@target.example', form_fields: [{ _id: 'eeeeeee', custom_id: 'name', field_type: 'text', field_label: 'Name' }] }, elements: [] },
]; }

async function fixture() {
  const dir = await mkdtemp('D:/cloneWP/tests/.tmp-configurator-driver-');
  const plugin = path.join(dir, 'clonewp-bottle-configurator'); await mkdir(plugin);
  const packageDir = 'D:/cloneWP/references/aboland-configurator-jiangubottle-20261028/clonewp-bottle-configurator';
  const names = ['clonewp-bottle-configurator.php', 'runtime.js', 'style.css'];
  for (const name of names) await copyFile(path.join(packageDir, name), path.join(plugin, name));
  const image = path.join(dir, 'bottle.png'); const imageBytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  await writeFile(image, imageBytes);
  return { dir, plugin, image, imageSha: bytesSha(imageBytes) };
}

async function runPhp(source: string, f: Awaited<ReturnType<typeof fixture>>, state: { elements?: ElementorElement[]; run?: string; hash?: string; receipt?: unknown } = {}) {
  const code = path.join(f.dir, 'driver-code.php'); await writeFile(code, source);
  const initial = JSON.stringify(state.elements ?? base());
  const meta = { '_clonewp_run_id': state.run ?? identity.runId, '_clonewp_reused_header_contract': identity.contractHash,
    '_elementor_data': initial, '_elementor_page_settings': { template: 'elementor_header_footer' },
    '_clonewp_sha256': state.hash ?? f.imageSha };
  const prelude = `<?php
  define('ABSPATH','D:/cloneWP/');define('WP_PLUGIN_DIR',${JSON.stringify(f.dir)});
  $GLOBALS['meta']=json_decode('${JSON.stringify(meta).replaceAll("'", "\\'")}',true);$GLOBALS['options']=[];
  $GLOBALS['options']['clonewp_configurator_patch_${createHash('sha256').update(identity.runId).digest('hex')}']=json_decode('${JSON.stringify(state.receipt ?? null).replaceAll("'", "\\'")}',true);
  function home_url($x='/'){return 'https://target.example/';}
  function untrailingslashit($x){return rtrim($x,'/');}
  function current_user_can($cap,$id=null){return true;}
  function get_post($id){if($id===123)return (object)['ID'=>123,'post_type'=>'page','post_status'=>'draft'];if($id===101)return (object)['ID'=>101,'post_type'=>'attachment','post_parent'=>123];return null;}
  function get_posts($args){return [123];}
  function get_post_meta($id,$key,$single=true){if($id===101){if($key==='_clonewp_run_id')return 'configurator-test-run';if($key==='_clonewp_sha256')return $GLOBALS['meta']['_clonewp_sha256'];}return $GLOBALS['meta'][$key]??null;}
  function get_post_status($id){return 'draft';}
  function get_option($key,$fallback=null){return $GLOBALS['options'][$key]??$fallback;}
  function add_option($key,$value){if(isset($GLOBALS['options'][$key]))return false;$GLOBALS['options'][$key]=$value;return true;}
  function update_option($key,$value){$GLOBALS['options'][$key]=$value;return true;}
  function delete_option($key){unset($GLOBALS['options'][$key]);return true;}
  function wp_check_post_lock($id){return false;}
  function get_attached_file($id){return ${JSON.stringify(f.image)};}
  function wp_get_attachment_url($id){return ${JSON.stringify(media.url)};}
  function get_post_mime_type($id){return 'image/png';}
  class CloneWP_Bottle_Configurator {function get_controls(){return array_fill_keys(['title','form_widget','summary_field','upload_field','options','decorations','overlays','fonts','filter_groups_json','logo_colors','logo_x','logo_y','logo_width','logo_height','preview_layout_mode','preview_mobile_breakpoint'],['type'=>'text']);}}
  class CWPDoc {function is_editable_by_current_user(){return true;}function is_built_with_elementor(){return true;}function save($input){$GLOBALS['meta']['_elementor_data']=json_encode($input['elements'],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);$GLOBALS['meta']['_elementor_page_settings']=$input['settings'];return true;}}
  class CWPDocs {function get($id,$fresh=false){return new CWPDoc();}}
  class CWPWidgets {function get_widget_types($name){return new CloneWP_Bottle_Configurator();}}
  class CWPBreakpoints {function get_responsive_control_duplication_mode(){return 'on';}function set_responsive_control_duplication_mode($mode){}}
  class CWPControls {function clear_stack_cache(){}}
  eval('namespace Elementor; class Plugin {public static $instance;}');
  \\Elementor\\Plugin::$instance=(object)['widgets_manager'=>new CWPWidgets(),'documents'=>new CWPDocs(),'breakpoints'=>new CWPBreakpoints(),'controls_manager'=>new CWPControls()];
  $result=eval(file_get_contents($argv[1]));echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
  `;
  const runner = path.join(f.dir, 'runner.php'); await writeFile(runner, prelude);
  return JSON.parse(execFileSync('D:/cloneWP/.cache/php-8.3/php.exe', [runner, code], { cwd: 'D:/cloneWP', encoding: 'utf8' }));
}

test('server driver rejects a page with another run marker before any write', async () => {
  const f = await fixture(); try {
    const code = await configuratorDriverCode(identity, { action: 'inspect' });
    const result = await runPhp(code, f, { run: 'another-run' });
    assert.deepEqual(result, { ok: false, code: 'configurator_owner' });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('server driver verifies real package, controls, media, then derives the exact scoped patch', async () => {
  const f = await fixture(); try {
    const inspect = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f);
    assert.equal(inspect.ok, true);
    const registration = { version: 1 as const, widgetType: 'clonewp_bottle_configurator' as const, targetOrigin: origin,
      packageSha256: 'a'.repeat(64), registered: true, controlsVerified: true, packageFilesVerified: true };
    const prepared = prepareConfiguratorPatch({ taskId: identity.runId, pageId: identity.pageId, targetOrigin: origin,
      packageSha256: registration.packageSha256, registration, baseElements: base(), catalog: catalog(), slotId: 'aaaaaaa', widgetId: 'ccccccc' });
    const input = { action: 'apply', operationId: 'operation1', baseHash: prepared.intent.baseHash, patchedHash: prepared.intent.patchedHash,
      settingsHash: inspect.value.snapshot.settingsHash, slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb',
      packageFiles: inspect.value.snapshot.pluginFiles, controlsHash: inspect.value.snapshot.controlsHash,
      catalog: catalog(), assets: [{ ...media, sha256: f.imageSha }] };
    const result = await runPhp(await configuratorDriverCode(identity, input), f);
    assert.equal(result.ok, true, result.code);
    assert.equal(result.value.snapshot.elementsHash, prepared.intent.patchedHash);
    assert.deepEqual(result.value.snapshot.elements[0].elements[0], base()[0].elements[0]);
    assert.equal(result.value.snapshot.elements[0].elements[1].widgetType, 'clonewp_bottle_configurator');
    assert.deepEqual(result.value.snapshot.elements[0].elements[1].settings.logo_colors.map((row: Record<string, unknown>) =>
      ({ label: row.label, value: row.value })), [{ label: 'Copper', value: '#C97442' }]);
    assert.equal(result.value.receipt.state, 'complete');
    assert.deepEqual(result.value.snapshot.elements[1].settings.email_to, 'owner@target.example');
    assert.deepEqual(result.value.snapshot.elements[1].settings.form_fields.slice(-2).map((row: Record<string, unknown>) => row.field_type), ['hidden','upload']);
    const forged = await runPhp(await configuratorDriverCode(identity, { ...input, packageFiles: { ...input.packageFiles, 'runtime.js': '0'.repeat(64) } }), f);
    assert.deepEqual(forged, { ok: false, code: 'configurator_precondition' });
    const stale = await runPhp(await configuratorDriverCode(identity, { ...input, baseHash: '0'.repeat(64) }), f);
    assert.deepEqual(stale, { ok: false, code: 'configurator_precondition' });
    const foreignMedia = await runPhp(await configuratorDriverCode(identity, { ...input, assets: [{ ...media, sha256: '0'.repeat(64) }] }), f);
    assert.deepEqual(foreignMedia, { ok: false, code: 'configurator_asset_owner' });
    const occupied = base(); occupied[0].elements = [];
    const occupiedInspect = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f, { elements: occupied });
    const occupiedResult = await runPhp(await configuratorDriverCode(identity, { ...input, baseHash: occupiedInspect.value.snapshot.elementsHash }), f, { elements: occupied });
    assert.deepEqual(occupiedResult, { ok: false, code: 'configurator_slot' });
    const nonnative = base(); nonnative[0].elements[0].id = 'bad-id';
    const nonnativeInspect = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f, { elements: nonnative });
    const nonnativeResult = await runPhp(await configuratorDriverCode(identity, { ...input, baseHash: nonnativeInspect.value.snapshot.elementsHash }), f, { elements: nonnative });
    assert.deepEqual(nonnativeResult, { ok: false, code: 'configurator_slot' });
    const duplicate = base(); duplicate[0].elements.push({ id: '9999999', elType: 'widget', widgetType: 'clonewp_bottle_configurator', settings: {}, elements: [] });
    const duplicateInspect = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f, { elements: duplicate });
    const duplicateResult = await runPhp(await configuratorDriverCode(identity, { ...input, baseHash: duplicateInspect.value.snapshot.elementsHash }), f, { elements: duplicate });
    assert.deepEqual(duplicateResult, { ok: false, code: 'configurator_tree_boundary' });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('server settings match the full source choice catalog after media binding', async () => {
  const f = await fixture(); try {
    const template = JSON.parse(await readFile('D:/cloneWP/references/aboland-configurator-jiangubottle-20261028/materials/catalog-unbound.json', 'utf8'));
    const bind = (value: any): any => {
      if (Array.isArray(value)) return value.map(bind);
      if (value && typeof value === 'object') {
        if (typeof value.$asset === 'string') return media;
        if (value.$nativeFormBinding === true) return { widgetId: 'bbbbbbb', summaryField: 'configuration', uploadField: 'logo' };
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bind(item)]));
      }
      return value;
    };
    const c = catalogSchema.parse(bind(template));
    const inspected = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f);
    const registration = { version: 1 as const, widgetType: 'clonewp_bottle_configurator' as const, targetOrigin: origin,
      packageSha256: 'a'.repeat(64), registered: true, controlsVerified: true, packageFilesVerified: true };
    const prepared = prepareConfiguratorPatch({ taskId: identity.runId, pageId: identity.pageId, targetOrigin: origin,
      packageSha256: registration.packageSha256, registration, baseElements: base(), catalog: c, slotId: 'aaaaaaa', widgetId: 'ccccccc' });
    const input = { action: 'apply', operationId: 'operation2', baseHash: prepared.intent.baseHash, patchedHash: prepared.intent.patchedHash,
      settingsHash: inspected.value.snapshot.settingsHash, slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb',
      packageFiles: inspected.value.snapshot.pluginFiles, controlsHash: inspected.value.snapshot.controlsHash,
      catalog: c, assets: [{ ...media, sha256: f.imageSha }] };
    const result = await runPhp(await configuratorDriverCode(identity, input), f);
    assert.equal(result.ok, true, result.code);
    assert.equal(result.value.snapshot.elementsHash, prepared.intent.patchedHash);
    assert.equal(result.value.snapshot.elements[0].elements[1].settings.options.length, 143);
    assert.equal(result.value.snapshot.elements[0].elements[1].settings.decorations.length, 33);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('server catalog revision changes only owned widget settings with fresh CAS and prior receipt', async () => {
  const f = await fixture(); try {
    const oldCatalog = catalog();
    const registration = { version: 1 as const, widgetType: 'clonewp_bottle_configurator' as const, targetOrigin: origin,
      packageSha256: 'a'.repeat(64), registered: true, controlsVerified: true, packageFilesVerified: true };
    const initial = prepareConfiguratorPatch({ taskId: identity.runId, pageId: identity.pageId, targetOrigin: origin,
      packageSha256: registration.packageSha256, registration, baseElements: base(), catalog: oldCatalog,
      slotId: 'aaaaaaa', widgetId: 'ccccccc' });
    const oldElements = initial.patch.elements;
    const inspected = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f, { elements: oldElements });
    const oldReceipt = { pageId: identity.pageId, contractHash: identity.contractHash, operationId: 'operation1', state: 'complete',
      baseHash: initial.intent.baseHash, patchedHash: initial.intent.patchedHash, settingsHash: inspected.value.snapshot.settingsHash };
    const newCatalog = catalogSchema.parse({ ...oldCatalog, title: 'Configure your bottle',
      bottles: oldCatalog.bottles.map(row => ({ ...row, attributes: { types: 'Crimp Neck' } })),
      filterGroups: { bottles: { types: { defaultValue: 'crimp', choices: [
        { value: 'crimp', label: 'Crimp Neck', matches: ['Crimp Neck'] },
        { value: 'screw', label: 'Screw Neck', matches: ['Crimp Neck'] },
      ] } } } });
    const revision = prepareConfiguratorCatalogRevision({ taskId: identity.runId, pageId: identity.pageId, targetOrigin: origin,
      slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb', priorOperationId: 'operation1',
      settingsHash: inspected.value.snapshot.settingsHash, baseElements: oldElements, oldCatalog, newCatalog });
    const input = { action: 'revise-catalog', operationId: 'operation2', priorOperationId: 'operation1',
      baseHash: revision.intent.baseHash, patchedHash: revision.intent.patchedHash,
      settingsHash: revision.intent.settingsHash, slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb',
      oldWidgetHash: revision.intent.oldWidgetHash, newWidgetHash: revision.intent.newWidgetHash,
      expectedOldSettings: revision.oldWidgetSettings, expectedOldCanonicalSettings: widgetSettings(oldCatalog),
      packageFiles: inspected.value.snapshot.pluginFiles,
      controlsHash: inspected.value.snapshot.controlsHash, catalog: newCatalog, assets: [{ ...media, sha256: f.imageSha }] };
    const result = await runPhp(await configuratorDriverCode(identity, input), f, { elements: oldElements, receipt: oldReceipt });
    assert.equal(result.ok, true, result.code);
    assert.deepEqual(result.value.snapshot.elements, revision.elements);
    assert.equal(result.value.receipt.kind, 'catalog-revision');
    assert.equal(result.value.receipt.priorOperationId, 'operation1');
    assert.equal(result.value.receipt.state, 'complete');
    const persistedIntent = { runId: identity.runId, operationId: 'operation2',
      resource: `full-replica-configurator/${identity.runId}`,
      expectedSnapshotSha256: createHash('sha256').update(JSON.stringify(inspected.value.snapshot)).digest('hex'),
      persistedIntentSha256: 'a'.repeat(64) };
    const transport = { origin, readPHP: async () => ({ ok: true, value: inspected.value }),
      executePHP: async (request: { code: string }) => runPhp(request.code, f, { elements: oldElements, receipt: oldReceipt }) };
    const driver = new WordPressConfiguratorDriver(transport as any, identity);
    const applied = await driver.reviseCatalog({ before: { snapshot: inspected.value.snapshot, receipt: oldReceipt } as any,
      revision: revision.intent, oldCatalog, newCatalog, assets: [{ ...media, sha256: f.imageSha }],
      expectedPackageFiles: inspected.value.snapshot.pluginFiles, expectedControlsHash: inspected.value.snapshot.controlsHash,
      operationId: 'operation2', intent: persistedIntent });
    assert.deepEqual(applied.snapshot.elements, revision.elements);
    const stale = await runPhp(await configuratorDriverCode(identity, { ...input, baseHash: '0'.repeat(64) }), f,
      { elements: oldElements, receipt: oldReceipt });
    assert.deepEqual(stale, { ok: false, code: 'configurator_precondition' });
    const wrongPrior = await runPhp(await configuratorDriverCode(identity, { ...input, priorOperationId: 'other' }), f,
      { elements: oldElements, receipt: oldReceipt });
    assert.deepEqual(wrongPrior, { ok: false, code: 'configurator_revision_prior_receipt' });
    const drift = structuredClone(oldElements); drift[0].elements[0].settings.title = 'Concurrent change';
    const drifted = await runPhp(await configuratorDriverCode(identity, input), f, { elements: drift, receipt: oldReceipt });
    assert.deepEqual(drifted, { ok: false, code: 'configurator_precondition' });
    const legacyElements = structuredClone(oldElements);
    delete legacyElements[0].elements[1].settings.filter_groups_json;
    const legacyInspect = await runPhp(await configuratorDriverCode(identity, { action: 'inspect' }), f, { elements: legacyElements });
    const legacyReceipt = { ...oldReceipt, patchedHash: legacyInspect.value.snapshot.elementsHash };
    const legacy = prepareConfiguratorCatalogRevision({ taskId: identity.runId, pageId: identity.pageId, targetOrigin: origin,
      slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb', priorOperationId: 'operation1',
      settingsHash: legacyInspect.value.snapshot.settingsHash, baseElements: legacyElements, oldCatalog, newCatalog });
    assert.equal(legacy.oldWidgetSettings.filter_groups_json, undefined);
    const legacyInput = { ...input, baseHash: legacy.intent.baseHash, patchedHash: legacy.intent.patchedHash,
      oldWidgetHash: legacy.intent.oldWidgetHash, expectedOldSettings: legacy.oldWidgetSettings };
    const legacyResult = await runPhp(await configuratorDriverCode(identity, legacyInput), f,
      { elements: legacyElements, receipt: legacyReceipt });
    assert.equal(legacyResult.ok, true, legacyResult.code);
    assert.deepEqual(legacyResult.value.snapshot.elements, legacy.elements);
    const missingAnother = structuredClone(legacyElements);
    delete missingAnother[0].elements[1].settings.logo_colors;
    assert.throws(() => prepareConfiguratorCatalogRevision({ taskId: identity.runId, pageId: identity.pageId,
      targetOrigin: origin, slotId: 'aaaaaaa', widgetId: 'ccccccc', formWidgetId: 'bbbbbbb',
      priorOperationId: 'operation1', settingsHash: legacyInspect.value.snapshot.settingsHash,
      baseElements: missingAnother, oldCatalog, newCatalog }), /configurator_revision_tree/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

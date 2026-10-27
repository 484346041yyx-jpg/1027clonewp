import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WordPressHeaderModuleDriver, validateHeaderModuleIdentity, type HeaderModuleIdentity } from '../src/woodmart-header/generic/wordpress.js';
import { canonicalHeaderJson, headerJsonHash } from '../src/woodmart-header/contract.js';
import type { HeaderPHPReadOperation, HeaderPHPMutationOperation, HeaderPHPWriteIntent } from '../src/woodmart-header/transport.js';

const identity: HeaderModuleIdentity = { moduleKey: 'studio-moss', owner: { ownerId: 'clonewp', runId: 'moss-run' }, targetOrigin: 'https://target.example', headerId: 'header_cw_moss' };
const intent: HeaderPHPWriteIntent = { runId: 'moss-run', operationId: 'operation-one', resource: 'header-module/studio-moss', expectedSnapshotSha256: 'a'.repeat(64), persistedIntentSha256: 'b'.repeat(64) };
const snapshot = { module: null, globalHash: 'c'.repeat(64), defaultHeaderId: 'header_existing', presetReferences: [], otherReferences: [] };
function wire(envelope: unknown = { ok: true, value: { snapshot, hash: 'a'.repeat(64), contract: {}, resources: {} } }) {
  const calls: Array<{ kind: string; operation: HeaderPHPReadOperation | HeaderPHPMutationOperation }> = [];
  const transport = { origin: 'https://target.example', async readPHP<T>(operation: HeaderPHPReadOperation): Promise<T> { calls.push({ kind: 'read', operation }); return envelope as T; }, async executePHP<T>(operation: HeaderPHPMutationOperation): Promise<T> { calls.push({ kind: 'write', operation }); return envelope as T; } };
  return { driver: new WordPressHeaderModuleDriver(transport), calls };
}
function decode(operation: HeaderPHPReadOperation): any { const match = operation.code.match(/^\$input=json_decode\(base64_decode\('([A-Za-z0-9+/=]+)'\),true\);/); assert.ok(match); return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); }

test('identity rejects default/global targets, credentials and unrelated identities before transport', async () => {
  const { driver, calls } = wire();
  for (const value of [{ ...identity, headerId: 'default_header' }, { ...identity, moduleKey: 'Moss' }, { ...identity, targetOrigin: 'https://user:secret@target.example' }, { ...identity, owner: { ownerId: 'clonewp', runId: 'other/run' } }]) assert.throws(() => validateHeaderModuleIdentity(value));
  await assert.rejects(driver.inspect({ ...identity, targetOrigin: 'https://other.example' }), /target_mismatch/);
  assert.equal(calls.length, 0);
});
test('inspect sends only fixed read helper plus encoded data and keeps candidate/media inputs bounded', async () => {
  const { driver, calls } = wire(); await driver.inspect(identity, { logo: 77 }, 99);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'read'); assert.equal(calls[0].operation.trustedLocalCode, true);
  assert.deepEqual(decode(calls[0].operation), { identity, action: 'inspect', mediaIds: { logo: 77 }, pageId: 99 });
  await assert.rejects(driver.inspect(identity, { logo: 0 }), /inspect_resources_invalid/);
  assert.equal(calls.length, 1);
});
test('menu write preserves caller payload identity while sending parent-first absolute links and exact intent metadata', async () => {
  const { driver, calls } = wire();
  const payload = { key: 'main', name: 'Moss', items: [{ key: 'child', parentKey: 'shop', title: 'Care', url: '/care/' }, { key: 'shop', parentKey: null, title: 'Shop', url: '/shop/' }] };
  const before = structuredClone(payload);
  await driver.mutate(identity, { operationId: intent.operationId, expectedHash: intent.expectedSnapshotSha256, action: 'menu', payload }, intent);
  const request = decode(calls[0].operation); assert.equal(request.requestHash, headerJsonHash(payload));
  assert.deepEqual(request.payload.items.map((item: any) => item.key), ['shop', 'child']);
  assert.equal(request.payload.items[0].url, 'https://target.example/shop/');
  assert.deepEqual((calls[0].operation as HeaderPHPMutationOperation).intent, intent); assert.deepEqual(payload, before);
});
test('persisted mutation metadata must agree with operation, snapshot and owner before any request', async () => {
  const { driver, calls } = wire();
  const request = { operationId: intent.operationId, expectedHash: intent.expectedSnapshotSha256, action: 'reserve' as const, payload: { name: 'Moss' } };
  for (const bad of [{ ...intent, runId: 'other-run' }, { ...intent, operationId: 'other-operation' }, { ...intent, expectedSnapshotSha256: 'd'.repeat(64) }, { ...intent, resource: 'header-module/unrelated' }, { ...intent, persistedIntentSha256: '' }]) await assert.rejects(driver.mutate(identity, request, bad), /mutation_intent_invalid/);
  assert.equal(calls.length, 0);
});
test('PHP content never interpolates plan strings and safe server failures do not expose remote text', async () => {
  const { driver, calls } = wire({ ok: false, code: 'ownership_changed', message: 'secret https://private.example/?token=hidden' });
  await assert.rejects(driver.mutate(identity, { operationId: intent.operationId, expectedHash: intent.expectedSnapshotSha256, action: 'reserve', payload: { name: "'); throw new Error('injected');" } }, intent), error => error instanceof Error && error.message === 'woodmart_header_driver_ownership_changed');
  const code = calls[0].operation.code; assert.equal(code.includes("throw new Error('injected')"), false); assert.equal(decode(calls[0].operation).payload.name.includes('injected'), true);
  const malformed = wire({ ok: false, code: 'private token? secret' }); await assert.rejects(malformed.driver.inspect(identity), /server_operation_failed/);
});
test('transport failure is never automatically retried by this resource driver', async () => {
  let attempts = 0; const driver = new WordPressHeaderModuleDriver({ origin: identity.targetOrigin, async readPHP<T>(): Promise<T> { throw Error('read unavailable'); }, async executePHP<T>(): Promise<T> { attempts++; throw Error('unconfirmed'); } });
  await assert.rejects(driver.mutate(identity, { operationId: intent.operationId, expectedHash: intent.expectedSnapshotSha256, action: 'reserve', payload: { name: 'Moss' } }, intent), /unconfirmed/);
  assert.equal(attempts, 1);
});
test('fixed server source guards native ownership, default isolation, CAS, receipts and draft-only binding without old pipeline writes', async () => {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  for (const guard of ['add_option($lock', 'hmod_snapshot_changed', 'hmod_previous_operation_unconfirmed', "'payloadHash'=>$requestHash", "'state'=>'started'", "'state'=>'complete'", 'hmod_header_not_isolated', 'hmod_bound_page_not_draft', 'hmod_protected_resources_changed', "get_post_meta($pageId,'_clonewp_header_module_owner'", "'_clonewp_run_id'=>$owner['runId']", "'elementor_header_footer'", "current_user_can('unfiltered_html')", 'woodmart_get_html_block($styleId)', "woodmart_get_config('header-sceleton')", "woodmart_get_config('header-builder-settings')"]) assert.ok(php.includes(guard), guard);
  assert.equal(/update_option\(['"](?:whb_main_header|xts-woodmart-options|xts-options-presets)/.test(php), false);
  assert.equal(php.includes('set_theme_mod('), false); assert.equal(php.includes('_elementor_data\',\''), false);
  assert.equal(php.includes('15769'), false); assert.equal(php.includes('header_193941'), false); assert.equal(php.includes('furrys'), false);
  for (const guard of ["hash_update($pageHash,$serialized)", "'_edit_lock','_edit_last','_elementor_css'", "if($type===$styleType)", "'menu-location'", "$scan($definition[1],'header',$key)", "'widget-option'", "'shared-meta'", "wp_slash($content)", "$builder->list->add_header($headerId,$record['name'])"]) assert.ok(php.includes(guard), guard);
  assert.equal(php.includes('_clonewp_header_module_css'), false);
  assert.ok(php.indexOf("if(!isset($record['menus'][$key])&&wp_get_nav_menu_object($name))") < php.indexOf("$record['receipts'][$operationId]=['action'=>$action,'payloadHash'=>$requestHash,'state'=>'started']"));
});
test('actual search HTML-block select excludes live business defaults/options from the native contract', async () => {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  assert.ok(php.includes("($element==='search'&&$key==='search_extra_content')"));
  assert.ok(php.includes("if($htmlBlockSelect&&$type!=='select')"));
  assert.ok(php.includes("$htmlBlockSelect?'html-block':null"));
  assert.ok(php.includes("array_key_exists('value',$f)&&$resource===null"));
  assert.ok(php.includes("isset($f['options'])&&is_array($f['options'])&&$resource===null"));
  assert.equal(php.includes("$key==='search_extra_content_enabled'"), false);
});

test('inspect preserves separately archived conflict evidence and its opaque server snapshot hash', async () => {
  const originalReceipt = { action: 'style', payloadHash: 'd'.repeat(64), state: 'started' };
  const conflict = { originalReceipt, resolution: 'archived-by-authorized-recovery', protectedHistoryConfirmed: false };
  const archivedSnapshot = { ...snapshot, module: { identity, conflicts: { [intent.operationId]: conflict }, receipts: {} } };
  const serverHash = 'e'.repeat(64);
  const { driver, calls } = wire({ ok: true, value: { snapshot: archivedSnapshot, hash: serverHash, contract: {}, resources: {} } });
  const observed = await driver.inspect(identity);
  assert.deepEqual(observed.snapshot, archivedSnapshot);
  assert.equal(observed.hash, serverHash);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'read');
  assert.equal(originalReceipt.state, 'started');
});

test('the locked server rejects an archived operation before receipt replay and keeps unconfirmed receipts blocking', async () => {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  const lock = php.indexOf('if(!add_option($lock,$lockValue');
  const reload = php.indexOf('$record=get_option($moduleOption,null);if($record!==null)$assertRecord($record);', lock);
  const archiveGuard = php.indexOf("if(isset($record['conflicts'][$operationId]))throw new RuntimeException('hmod_operation_already_resolved');", reload);
  const prior = php.indexOf("$prior=$record['receipts'][$operationId]??null;", reload);
  const unfinished = php.indexOf("foreach($record['receipts']??[] as $receipt)if(($receipt['state']??'')!=='complete')throw new RuntimeException('hmod_previous_operation_unconfirmed');", prior);
  const firstWrite = php.indexOf("$record['receipts'][$operationId]=['action'=>$action,'payloadHash'=>$requestHash,'state'=>'started']", unfinished);
  assert.ok(lock >= 0 && reload > lock && archiveGuard > reload && prior > archiveGuard && unfinished > prior && firstWrite > unfinished);
  const conflictOutput = "if($module!==null&&!empty($r['conflicts']))$module['conflicts']=(object)$r['conflicts'];";
  assert.ok(php.includes(conflictOutput), 'Only nonempty archive history changes existing snapshot shapes');
  assert.ok(php.indexOf(conflictOutput) < php.indexOf("return ['module'=>$module,'globalHash'=>$global"));
  assert.ok(php.includes("if(($prior['state']??'')!=='complete')throw new RuntimeException('hmod_previous_operation_unconfirmed');"));
  assert.equal(php.includes("$record['conflicts'][$operationId]="), false, 'The normal mutation helper cannot archive or approve a conflict');
});

test('native header readback tolerates map-key order while wire data preserves lists, values and JSON types', async () => {
  const raw = { id: identity.headerId, name: 'Moss', settings: { sticky: { type: 'switcher', value: false } }, structure: { id: 'root', content: [{ id: 'menu', params: { width: { value: 24, type: 'slider' }, empty: {} } }, { id: 'logo', params: {} }] } };
  const native = { name: raw.name, id: raw.id, structure: { content: [{ params: { empty: {}, width: { type: 'slider', value: 24 } }, id: 'menu' }, { params: {}, id: 'logo' }], id: 'root' }, settings: { sticky: { value: false, type: 'switcher' } } };
  assert.equal(headerJsonHash(native), headerJsonHash(raw));
  const variants = [
    { ...native, structure: { ...native.structure, content: [...native.structure.content].reverse() } },
    { ...native, settings: { sticky: { value: 'false', type: 'switcher' } } },
    { ...native, structure: { ...native.structure, content: [{ ...native.structure.content[0], params: { empty: {}, width: { type: 'slider', value: '24' } } }, native.structure.content[1]] } },
    { ...native, name: 'Changed title' },
    { ...native, structure: { ...native.structure, content: [{ ...native.structure.content[0], params: { empty: [], width: { type: 'slider', value: 24 } } }, native.structure.content[1]] } },
  ];
  for (const value of variants) assert.notEqual(headerJsonHash(value), headerJsonHash(raw));
  const { driver, calls } = wire();
  await driver.mutate(identity, { action: 'header', operationId: intent.operationId, expectedHash: intent.expectedSnapshotSha256, payload: { raw } }, intent);
  const sent = decode(calls[0].operation).payload.raw;
  assert.deepEqual(Object.keys(sent), ['id', 'name', 'settings', 'structure']);
  assert.equal(canonicalHeaderJson(sent), canonicalHeaderJson(native));
});

test('only native header readback recursively sorts associative keys and object properties without normalizing primitive types', async () => {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  assert.ok(php.includes("$digest=static fn($value)=>hash('sha256',serialize($value));"), 'Global and snapshot fingerprints keep their existing representation');
  const start = php.indexOf('$headerReadbackValue=function($value)use(&$headerReadbackValue){');
  const end = php.indexOf("$result=['headerId'=>$headerId];", start);
  assert.ok(start >= 0 && end > start);
  const readback = php.slice(start, end);
  for (const guard of ['if(is_array($value))', 'if(!array_is_list($value))ksort($value,SORT_STRING)', '$value[$key]=$headerReadbackValue($child)', 'elseif(is_object($value))', 'ksort($properties,SORT_STRING)', '$sorted=clone $value', '$sorted->$key=$headerReadbackValue($child)', 'return $value;', "$digest($headerReadbackValue(get_option('whb_'.$headerId)))!==$digest($headerReadbackValue($raw))"]) assert.ok(readback.includes(guard), guard);
  assert.equal(/(?:\(string\)|\(int\)|\(float\)|\(bool\)|\bsort\(|array_values\(|json_decode\(|json_encode\()/.test(readback), false, 'Readback cannot coerce values, reindex lists or collapse empty objects into arrays');
  assert.equal((php.match(/\$headerReadbackValue\(/g) ?? []).length, 4, 'The comparison helper remains isolated to recursive header readback');
});

test('option reference audit excludes only exact caches generated for this native header', async () => {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  const start = php.indexOf('foreach($optionRows as $ref)');
  const filter = php.slice(start, php.indexOf('$oldMenus=[];', start));
  assert.ok(start >= 0);
  const ownCacheExpressions = [...filter.matchAll(/'xts-'\.\$headerId\.'(-(?:file|css)-data)'/g)];
  assert.deepEqual(ownCacheExpressions.map(match => match[1]).sort(), ['-css-data', '-file-data']);
  const exactCacheKeys = new Set(ownCacheExpressions.map(match => `xts-${identity.headerId}${match[1]}`));
  for (const key of [`xts-${identity.headerId}-file-data`, `xts-${identity.headerId}-css-data`]) assert.equal(exactCacheKeys.has(key), true, key);
  // Every fixture value is assumed to contain this header's ID, as required by
  // the existing SQL reference query; another header's cache is still external.
  for (const key of ['xts-header_other-file-data', 'xts-header_other-css-data', `xts-${identity.headerId}-file-data-backup`, `xts-${identity.headerId}-css-data-backup`, `xts-${identity.headerId}-file-data-extra`, 'shared-header-option']) assert.equal(exactCacheKeys.has(key), false, key);
  assert.ok(filter.includes("in_array($key,[$moduleOption,'whb_'.$headerId,'xts-'.$headerId.'-file-data','xts-'.$headerId.'-css-data','whb_saved_headers','whb_main_header','xts-woodmart-options','xts-options-presets'],true)"));
  assert.deepEqual([...filter.matchAll(/str_starts_with\(\$key,([^\)]+)\)/g)].map(match => match[1]), ["'_transient_'", "'_site_transient_'"], 'The native cache exemption cannot become a prefix exemption');
  assert.ok(filter.includes("$refs[]=['kind'=>'option','id'=>$key,'field'=>'option_value']"));
});

async function serverMetadataFilters(): Promise<Array<{ scope: string; excluded: Set<string> }>> {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  const filters = [...php.matchAll(/foreach\(\[([^\]]+)\] as \$key\)unset\(\$meta\[\$key\]\);/g)];
  assert.equal(filters.length, 3, 'Own page observations, protected pages and protected shared posts each need a literal metadata filter');
  return filters.map((match, index) => ({ scope: ['own page observation', 'protected page', 'protected shared post'][index], excluded: new Set([...match[1].matchAll(/'([^']+)'/g)].map(value => value[1])) }));
}

const protectedPostFixture = { post_title: 'Moss care', post_content: '<p>Original body</p>', post_excerpt: 'Care guide', post_status: 'draft', post_name: 'moss-care' };
const protectedMetadataFixture: Record<string, unknown> = {
  _elementor_data: ['[{"id":"body","settings":{"title":"Original title"}}]'],
  _elementor_page_settings: [{ background_color: '#f5f4ed' }],
  _woodmart_whb_header: ['header_cw_moss'],
  _wp_page_template: ['elementor_header_footer'],
  _clonewp_run_id: ['moss-run'],
  wd_business: ['original'],
  wd_page_css_files_custom: ['original'],
  _wd_page_css_files: ['original'],
};

// Hash the actual server filter's retained input. The assertion concerns which
// state participates in a fingerprint, without pretending JS implements PHP serialize.
function metadataInputHash(excluded: Set<string>, metadata: Record<string, unknown>, post = protectedPostFixture): string {
  return headerJsonHash([post, Object.fromEntries(Object.entries(metadata).filter(([key]) => !excluded.has(key)))]);
}

test('all actual server metadata filters tolerate WoodMart derived-cache creation, deletion and QA regeneration', async () => {
  const cacheStates = [
    {},
    { wd_page_css_files: [['header-base', 'menu-dropdown']] },
    { wd_page_css_files_mobile: [['mobile-menu']] },
    { wd_page_css_files: [['header-base']], wd_page_css_files_mobile: [['mobile-menu']] },
    { wd_page_css_files: [['header-base', 'account', 'cart']], wd_page_css_files_mobile: [['mobile-menu', 'cart']] },
    {},
  ];
  for (const { scope, excluded } of await serverMetadataFilters()) {
    assert.deepEqual([...excluded].filter(key => key.startsWith('wd_')).sort(), ['wd_page_css_files', 'wd_page_css_files_mobile'], scope);
    const baseline = metadataInputHash(excluded, protectedMetadataFixture);
    for (const state of cacheStates) assert.equal(metadataInputHash(excluded, { ...protectedMetadataFixture, ...state }), baseline, scope);
  }
});

test('own page observation ignores Elementor asset cache and decodes WordPress menu names', async () => {
  const php = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  const filters = await serverMetadataFilters();
  assert.equal(filters[0].excluded.has('_elementor_page_assets'), true);
  assert.equal(filters[1].excluded.has('_elementor_page_assets'), true);
  assert.equal(php.includes("'name'=>html_entity_decode($m->name,ENT_QUOTES|ENT_HTML5,'UTF-8')"), true);
});

test('the same filters continue detecting real body, page identity and similarly named business metadata edits', async () => {
  for (const { scope, excluded } of await serverMetadataFilters()) {
    const baseline = metadataInputHash(excluded, protectedMetadataFixture);
    for (const key of Object.keys(protectedMetadataFixture)) {
      assert.equal(excluded.has(key), false, `${scope}: ${key} remains protected`);
      assert.notEqual(metadataInputHash(excluded, { ...protectedMetadataFixture, [key]: ['changed'] }), baseline, `${scope}: ${key}`);
    }
    for (const key of Object.keys(protectedPostFixture) as Array<keyof typeof protectedPostFixture>) {
      assert.notEqual(metadataInputHash(excluded, protectedMetadataFixture, { ...protectedPostFixture, [key]: 'changed' }), baseline, `${scope}: ${key}`);
    }
  }
});

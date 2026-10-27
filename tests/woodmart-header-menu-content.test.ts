import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHeaderMenuContent, prepareHeaderMenuContentLocal, compileHeaderMenuContent,assertHeaderMenuRetirement } from '../src/woodmart-header/generic/menu-content.js';
import {compileHeaderDropdown} from '../src/woodmart-header/generic/dropdown.js';
import { WordPressHeaderModuleDriver } from '../src/woodmart-header/generic/wordpress.js';
import { contentFixture, contentClient } from './fixtures/header-menu-content.js';
import { headerJsonHash } from '../src/woodmart-header/contract.js';

const origin = 'https://target.example', menus = [{ key: 'main', name: 'Main', items: [{ key: 'catalog', parentKey: null, title: 'Catalog', url: '/shop/' }] }];
test('rich static mega menus compile through native widgets without manufacturing a product query',async()=>{
 const f=await contentFixture();try{
  const entry:import('../src/woodmart-header/generic/menu-content.js').HeaderMenuContent={...f.entry,version:2,dropdown:{design:'full-width',colorScheme:'default',event:'hover'},retireChildren:['old-card']};
  if(entry.program.blocks[0].kind==='composite')entry.program.blocks[0].children.splice(1);
  validateHeaderMenuContent([entry],menus,'service-run');
  const client=contentClient(origin);client.readTargetCatalog=async()=>{throw Error('Static content must not read products');};
  const [result]=await compileHeaderMenuContent([entry],client,origin,'a'.repeat(64),f.directory);
  assert.equal(result.payload.elements[0].elements[0].widgetType,'heading');assert.deepEqual(result.payload.queries,[]);
  assert.deepEqual(result.payload.media,[]);assert.equal(result.payload.dropdown!._menu_item_colorscheme,'');
  const bad=structuredClone(entry);if(bad.program.blocks[0].kind==='composite')(bad.program.blocks[0].children[0] as any).widgetType='html';
  assert.throws(()=>validateHeaderMenuContent([bad],menus,'service-run'),/HTML|unsupported_component/);
  const media=structuredClone(entry);if(media.program.blocks[0].kind==='composite')media.program.blocks[0].children[0]={kind:'native',key:'photo',widgetType:'wd_image_or_svg',widgetSettings:{image:{$asset:'photo'}}};
  assert.throws(()=>validateHeaderMenuContent([media],menus,'service-run'),/media_ledger_required/);
  media.assets=await f.put('imported.json',[]);await assert.rejects(prepareHeaderMenuContentLocal([media]),/media_ledger_incomplete/);
 }finally{await f.cleanup();}
});
test('full replica mega menu binds its native image to the page-owned imported header asset',async()=>{
 const f=await contentFixture();try{
  const entry:import('../src/woodmart-header/generic/menu-content.js').HeaderMenuContent={...f.entry,version:2,dropdown:{design:'full-width',colorScheme:'default',event:'hover'},assetSource:'header-assets'};
  if(entry.program.blocks[0].kind==='composite')entry.program.blocks[0].children.splice(1,1,{kind:'native',key:'photo',widgetType:'wd_image_or_svg',widgetSettings:{image:{$asset:'photo'}},sourceFactIds:(entry.program.blocks[0].children[0] as any).sourceFactIds});
  assert.doesNotThrow(()=>validateHeaderMenuContent([entry],menus,'service-run'));
  await prepareHeaderMenuContentLocal([entry]);
  const client=contentClient(origin);client.readTargetCatalog=async()=>{throw Error('Static content must not read products');};
  await assert.rejects(compileHeaderMenuContent([entry],client,origin,'a'.repeat(64),f.directory),/media_ledger_invalid/);
  const imported=[{key:'photo',attachmentId:111,url:origin+'/uploads/photo.jpg',sourceUrl:'https://header-source.example/photo.jpg',sha256:'a'.repeat(64),mimeType:'image/jpeg'}];
  const [prepared]=await compileHeaderMenuContent([entry],client,origin,'a'.repeat(64),f.directory,imported);
  assert.equal(prepared.payload.media?.[0].attachmentId,111);
  assert.equal((prepared.payload.elements[0].elements.find(node=>node.widgetType==='wd_image_or_svg')?.settings.image as any).id,111);
 }finally{await f.cleanup();}
});
test('native dropdown settings and exact branch retirement cannot expand their scope',()=>{
 assert.throws(()=>compileHeaderDropdown({design:'sized',colorScheme:'light',event:'hover'}),/requires width/);
 assert.throws(()=>compileHeaderDropdown({design:'full-width',width:800,colorScheme:'light',event:'hover'}),/Dimensions/);
 assert.throws(()=>compileHeaderDropdown({design:'default',colorScheme:'light',event:'mouseover'} as any));
 assert.equal(compileHeaderDropdown({design:'sized',width:900,height:300,colorScheme:'dark',event:'click'})._menu_item_width,'900');
 const branch=[{key:'catalog',parentKey:null},{key:'child',parentKey:'catalog'},{key:'grandchild',parentKey:'child'},{key:'gifts',parentKey:null}];
 assert.doesNotThrow(()=>assertHeaderMenuRetirement(branch,'catalog',['grandchild','child']));
 for(const keys of [['child'],['child','grandchild','gifts'],['child','grandchild','child'],['catalog','child','grandchild']])assert.throws(()=>assertHeaderMenuRetirement(branch,'catalog',keys),/exact_branch/);
});
test('native menu blocks require unique owned leaf bindings and typed query components', async () => {
  const f = await contentFixture(); try {
    assert.equal(validateHeaderMenuContent([f.entry], menus, 'service-run').length, 1);
    assert.throws(() => validateHeaderMenuContent([f.entry, f.entry], menus, 'service-run'), /leaf_binding_required/);
    assert.throws(() => validateHeaderMenuContent([f.entry], [{ ...menus[0], items: [...menus[0].items, { key: 'child', parentKey: 'catalog', title: 'Child', url: '/child/' }] }], 'service-run'), /leaf_binding_required/);
    assert.throws(() => validateHeaderMenuContent([f.entry], menus, 'other-run'), /program_scope_invalid/);
    const bad = structuredClone(f.entry); bad.program.blocks = [{ kind: 'composite', key: 'root', children: [{ kind: 'native', key: 'static', widgetType: 'heading', widgetSettings: { title: 'Fake product' } }] }];
    assert.throws(() => validateHeaderMenuContent([bad], menus, 'service-run'), /products_required/);
  } finally { await f.cleanup(); }
});
test('content preparation re-derives selected facts from bound packets and rejects local tampering', async () => {
  const f = await contentFixture(); try {
    await prepareHeaderMenuContentLocal([f.entry]);
    f.facts.facts['wide:region:rh'].value.role = 'invented';
    f.entry.program.sourceFacts = await f.put('facts.json', f.facts);
    await assert.rejects(prepareHeaderMenuContentLocal([f.entry]), /fact_not_packet_derived/);
    f.entry.program.sourceFacts.path = 'C:/Windows/win.ini';
    await assert.rejects(prepareHeaderMenuContentLocal([f.entry]), /path_escape/);
  } finally { await f.cleanup(); }
});
test('menu compilation uses actual catalog IDs and original native compiler proof', async () => {
  const f = await contentFixture(); try {
    const [prepared] = await compileHeaderMenuContent([f.entry], contentClient(origin), origin, 'a'.repeat(64), f.directory);
    const product = prepared.payload.elements[0].elements.find(node => node.widgetType === 'wd_products')!;
    assert.deepEqual(product.settings.include, [91, 90]); assert.equal(product.settings.items_per_page, 2);
    assert.deepEqual(prepared.payload.queries[0].productIds, [91, 90]); assert.equal(prepared.payload.programHash, headerJsonHash(f.entry.program));
    const evidence = prepared.payload.queries[0].evidence.find(value => value.includes('menu-content-catalog-'))!;
    assert.equal(JSON.parse(await readFile(evidence, 'utf8')).targetOrigin, origin);
    f.entry.program.blocks[0].kind === 'composite' && (f.entry.program.blocks[0].children[1] as any).query.ids.push(777);
    await assert.rejects(compileHeaderMenuContent([f.entry], contentClient(origin), origin, 'a'.repeat(64), f.directory), /Insufficient actual target/);
  } finally { await f.cleanup(); }
});
test('serialized menu compositions and altered requests cannot authorize native writes', async () => {
  let writes = 0;
  const driver = new WordPressHeaderModuleDriver({ origin, async readPHP<T>() { return { ok: true, value: { fingerprint: 'a'.repeat(64) } } as T; }, async executePHP<T>() { writes++; return {} as T; } });
  const identity = { moduleKey: 'sample', targetOrigin: origin, owner: { ownerId: 'clonewp', runId: 'service-run' }, headerId: 'header_123' };
  const intent = { runId: 'service-run', operationId: 'op', resource: 'header-module/sample', expectedSnapshotSha256: 'b'.repeat(64), persistedIntentSha256: 'c'.repeat(64) };
  await assert.rejects(driver.mutate(identity, { action: 'menu-content', operationId: 'op', expectedHash: intent.expectedSnapshotSha256, payload: { key: 'recommendations', elements: [], settings: {} } }, intent), /compiler_proof_required/);
  assert.equal(writes, 0);
});
test('server keeps native menu resources isolated, locked, query-bound and fully read back', async () => {
  const source = await readFile(new URL('../src/woodmart-header/generic/wordpress.php', import.meta.url), 'utf8');
  for (const guard of ['hmod_menu_content_contract_changed', 'hmod_menu_content_binding_changed', 'hmod_menu_content_leaf_required', 'hmod_menu_content_editor_locked', 'hmod_menu_content_product_changed', 'hmod_menu_content_readback_failed', 'hmod_menu_content_render_unconfirmed', 'hmod_menu_content_item_changed', "'menu-content-shortcode'", "'documentHash'=>$contentById[$block]", '$ownedPostIds[]=$ob[', 'documents->get($blockId,false)']) assert.ok(source.includes(guard), guard);
  assert.ok(source.indexOf("elseif($action==='menu-content')") < source.indexOf("'state'=>'started'"));
  assert.ok(source.indexOf('hmod_menu_content_create_failed') > source.indexOf("'state'=>'started'"));
  assert.ok(source.indexOf('hmod_menu_content_recoverable_trash_required') < source.indexOf("'state'=>'started'"));
  assert.ok(source.includes('wp_trash_post($retiredId)'));
});

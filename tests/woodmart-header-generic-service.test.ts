import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { headerJsonHash } from '../src/woodmart-header/contract.js';
import { createHeaderBundle, loadHeaderBundle } from '../src/woodmart-header/generic/bundle.js';
import type { HeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import type { NativeHeaderContract, ResolvedHeaderResources } from '../src/woodmart-header/generic/compiler.js';
import type { WhbLayoutNode, WhbRawHeader } from '../src/woodmart-header/layout.js';
import type { HeaderPHPWriteIntent } from '../src/woodmart-header/transport.js';
import type { HeaderModuleDriver, HeaderModuleIdentity, HeaderModuleInspection, HeaderMutationAction, HeaderMutationRequest, HeaderMutationResponse, HeaderRemoteModule, HeaderRemoteSnapshot } from '../src/woodmart-header/generic/wordpress.js';
import { bindHeaderModulePage, checkpointHeaderModule, createHeaderModulePage, inspectHeaderModule, provisionHeaderModule, reconcileHeaderModule, updateHeaderModule } from '../src/woodmart-header/generic/service.js';
import { contentFixture, contentClient } from './fixtures/header-menu-content.js';
import { compileHeaderMenuContent, type HeaderMenuContent } from '../src/woodmart-header/generic/menu-content.js';

const clone = <T>(value: T): T => structuredClone(value);
const origin = 'https://target.example';
function plan(): HeaderModulePlan {
  return { version: 1, kind: 'clonewp-header-module', moduleKey: 'cedar', targetOrigin: origin, owner: { ownerId: 'clonewp', runId: 'service-run' }, name: 'Cedar Header',
    menus: [{ key: 'main', name: 'Cedar menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }, { key: 'catalog', parentKey: null, title: 'Catalogue', url: '/shop' }, { key: 'new', parentKey: 'catalog', title: 'New arrivals', url: '/new' }] }],
    layout: { rows: [{ slot: 'general-header', params: { height: 90 }, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} },
    style: { css: ':header {color:#345}', fonts: [] } };
}
function native(): NativeHeaderContract {
  const slots = ['top-bar', 'general-header', 'header-bottom'] as const;
  const rows: WhbLayoutNode[] = slots.map(id => ({ id, type: 'row', params: {}, content: ['left', 'center', 'right'].map(position => ({ id: `${id}-${position}`, type: 'column', content: [] })) }));
  return { version: 1, kind: 'clonewp-whb-native-contract', targetOrigin: origin, fingerprint: headerJsonHash({ version: 'fixture-native' }), structure: { id: 'root', type: 'root', content: rows }, settings: {},
    rowColumns: Object.fromEntries(slots.map(slot => [slot, { left: `${slot}-left`, center: `${slot}-center`, right: `${slot}-right` }])) as NativeHeaderContract['rowColumns'],
    rowSchema: { height: { type: 'slider', valueType: 'number', min: 40, max: 200 }, hide_desktop: { type: 'switcher', valueType: 'boolean', default: false } }, settingsSchema: {},
    elements: { mainmenu: { type: 'mainmenu', schema: { menu_id: { type: 'select', valueType: 'string', resource: 'menu' } } }, logo: { type: 'logo', schema: { image: { type: 'image', valueType: 'image', resource: 'image' } } } },
    styleElement: { type: 'HTMLBlock', field: 'block_id', schema: { block_id: { type: 'select', valueType: 'string', resource: 'html-block' } } } };
}

/** Implements the real adapter boundary; it never contacts a site or browser. */
class FakeHeaderDriver implements HeaderModuleDriver {
  inspections=0;
  module: HeaderRemoteModule | null = null;
  globalHash = headerJsonHash({ unrelated: 'original site, old menu, old component page' });
  readonly defaultHeaderId = 'header_42';
  readonly writes: HeaderMutationRequest[] = [];
  readonly body = { elements: [{ id: 'body-native', widgetType: 'text-editor', settings: { editor: '<p>Unchanged independent Elementor body</p>' } }] };
  readonly bodyHash = headerJsonHash(this.body);
  nextId = 501;
  fault: null | { action: HeaderMutationAction; kind: 'lose-after' | 'partial-after' | 'throw-before' | 'global-after' | 'body-after' } = null;
  constructor(readonly directory: string) {}
  async prepareMenuContent(_identity: HeaderModuleIdentity, entries: HeaderMenuContent[], directory: string) { return (await compileHeaderMenuContent(entries, contentClient(origin), origin, 'a'.repeat(64), directory)).map(item => item.payload); }
  private snapshot(): HeaderRemoteSnapshot {
    return clone({ module: this.module, globalHash: this.globalHash, defaultHeaderId: this.defaultHeaderId, presetReferences: [], otherReferences: [] });
  }
  async inspect(_identity: HeaderModuleIdentity): Promise<HeaderModuleInspection> {
    this.inspections++;
    const snapshot = this.snapshot();
    const resources: ResolvedHeaderResources = { targetOrigin: origin, menus: Object.fromEntries(Object.entries(this.module?.menus ?? {}).map(([key, menu]) => [key, { id: menu.id, slug: menu.slug }])), media: {}, styleBlockId: this.module?.style?.id ?? 0 };
    return { contract: native(), resources, snapshot, hash: headerJsonHash(snapshot) };
  }
  async mutate(identity: HeaderModuleIdentity, request: HeaderMutationRequest, intent: HeaderPHPWriteIntent): Promise<HeaderMutationResponse> {
    const before = await this.inspect(identity);
    assert.equal(request.expectedHash, before.hash, 'the adapter receives a current CAS hash');
    assert.equal(intent.operationId, request.operationId);
    assert.equal(intent.expectedSnapshotSha256, before.hash);
    assert.equal(intent.runId, identity.owner.runId);
    const disk = JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8'));
    assert.equal(disk.pending.operationId, request.operationId, 'pending is durable before a remote write');
    const durable = await readFile(path.join(this.directory, `intent-${request.operationId}.json`));
    assert.equal(headerJsonHash(JSON.parse(durable.toString('utf8'))), headerJsonHash(disk.pending));
    this.writes.push(clone(request));
    const fault = this.fault?.action === request.action ? this.fault : null;
    if (fault) this.fault = null;
    if (fault?.kind === 'throw-before') throw new Error('fixture request failed before a mutation');
    const payload = request.payload as Record<string, any>;
    let result: unknown;
    if (request.action === 'reserve') this.module = { identity: clone(identity), name: payload.name, menus: {}, style: null, header: null, pages: {}, receipts: {}, ...(payload.menuContent ? { menuContent: {} } : {}) };
    else {
      assert.ok(this.module);
      switch (request.action) {
        case 'menu': {
          const prior = this.module.menus[payload.key];
          const menu = { id: prior?.id ?? this.nextId++, slug: prior?.slug ?? `${identity.moduleKey}-${payload.key}`, name: payload.name, items: [] as HeaderRemoteModule['menus'][string]['items'] };
          menu.items = payload.items.map((item: any, index: number) => ({ ...item, id: prior?.items.find(old => old.key === item.key)?.id ?? this.nextId++, order: index + 1, url: new URL(item.url, `${origin}/`).href }));
          if (this.module.menuContent) menu.items.forEach(item => item.content = prior?.items.find(old => old.key === item.key)?.content ?? { blockId: 0, documentHash: '', metaHash: headerJsonHash({}) });
          if (this.module.menuContent) menu.items.forEach(item => item.imageId = payload.images?.find((image: any) => image.itemKey === item.key)?.mediaId ?? prior?.items.find(old => old.key === item.key)?.imageId ?? 0);
          this.module.menus[payload.key] = menu; result = { menuId: menu.id }; break;
        }
        case 'menu-content': {
          const id = this.module.menuContent?.[payload.key]?.id ?? this.nextId++, documentHash = headerJsonHash([payload.elements, payload.settings]);
          this.module.menuContent![payload.key] = { id, name: payload.name, menuKey: payload.menuKey, itemKey: payload.itemKey, programHash: payload.programHash, elements: clone(payload.elements), settings: clone(payload.settings), documentHash };
          const item = this.module.menus[payload.menuKey].items.find(item => item.key === payload.itemKey)!;
          item.content = { blockId: id, documentHash, metaHash: headerJsonHash({ blockId: id }),...(payload.version===2?{dropdown:clone(payload.dropdown)}:{}) };
          if(payload.version===2)this.module.menus[payload.menuKey].items=this.module.menus[payload.menuKey].items.filter(item=>!payload.retireChildren?.includes(item.key)).map((item,i)=>({...item,order:i+1}));
          result = { contentBlockId: id, menuItemId: item.id }; break;
        }
        case 'style': this.module.style = { id: this.module.style?.id ?? this.nextId++, css: payload.css }; result = { styleBlockId: this.module.style.id }; break;
        case 'header': this.module.header = clone(payload.raw as WhbRawHeader); result = { headerId: identity.headerId }; break;
        case 'create-page': {
          const pageId = this.nextId++;
          this.module.pages[String(pageId)] = { pageId, postType: 'page', status: 'draft', template: 'elementor_header_footer', runId: identity.owner.runId, bodyHash: this.bodyHash, headerId: null, snapshotHash: headerJsonHash({ pageId, headerId: null, bodyHash: this.bodyHash }) };
          result = { pageId }; break;
        }
        case 'bind': {
          const page = this.module.pages[String(payload.pageId)];
          assert.ok(page); assert.equal(page.bodyHash, payload.expectedBodyHash);
          page.headerId = identity.headerId; page.snapshotHash = headerJsonHash(page);
          if (fault?.kind === 'body-after') page.bodyHash = headerJsonHash({ changed: 'unsafe adapter replaced page body' });
          result = { pageId: page.pageId }; break;
        }
      }
    }
    assert.ok(this.module);
    this.module.receipts[request.operationId] = { action: request.action, payloadHash: headerJsonHash(request.payload), state: fault?.kind === 'partial-after' ? 'started' : 'complete', ...(result === undefined ? {} : { result }) };
    if (fault?.kind === 'global-after') this.globalHash = headerJsonHash({ damaged: 'unrelated global option changed during operation' });
    if (fault?.kind === 'lose-after' || fault?.kind === 'partial-after') throw new Error('fixture response lost after mutation');
    const after = await this.inspect(identity);
    return { hash: after.hash, snapshot: after.snapshot, ...(result === undefined ? {} : { result }) };
  }
}

async function fixture(fn: (directory: string, driver: FakeHeaderDriver) => Promise<void>): Promise<void> {
  const root = await realpath('D:/cloneWP'), base = path.join(root, '.cache', `header-service-${randomUUID()}`), directory = path.join(base, 'module');
  await mkdir(base, { recursive: true });
  try { await createHeaderBundle(directory, plan()); await fn(directory, new FakeHeaderDriver(directory)); }
  finally {
    const actual = await realpath(base), relative = path.relative(root, actual);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(actual.toLowerCase(), base.toLowerCase());
    await rm(actual, { recursive: true, force: true });
  }
}

test('native menu content provisions once and a lost response reconciles without another block allocation', async () => {
  const content = await contentFixture();
  try { await fixture(async (directory, driver) => {
    const headerPath = path.join(directory, 'header.json'), header = JSON.parse(await readFile(headerPath, 'utf8'));
    const menusPath = path.join(directory, 'menus.json'), menus = JSON.parse(await readFile(menusPath, 'utf8'));
    menus[0].items = menus[0].items.filter((item: any) => item.key !== 'new');
    await writeFile(menusPath, JSON.stringify(menus)); header.menuContent = [content.entry]; header.menuItemMedia = [{ menuKey: 'main', itemKey: 'catalog', mediaKey: 'menuPic' }]; await writeFile(headerPath, JSON.stringify(header));
    await writeFile(path.join(directory, 'media.json'), JSON.stringify({ menuPic: 77 }));
    driver.fault = { action: 'menu-content', kind: 'lose-after' };
    const first = await provisionHeaderModule(directory, driver);
    assert.equal(first.at(-1)!.status, 'write-unknown'); assert.equal(first.at(-1)!.action, 'menu-content');
    const id = driver.module!.menuContent!.recommendations.id, writes = driver.writes.length;
    await assert.rejects(provisionHeaderModule(directory, driver), /reconciliation_required/);
    assert.equal((await reconcileHeaderModule(directory, driver)).status, 'confirmed'); assert.equal(driver.writes.length, writes);
    assert.ok((await provisionHeaderModule(directory, driver)).every(item => item.status === 'confirmed'));
    assert.equal(driver.module!.menuContent!.recommendations.id, id);
    assert.equal(driver.module!.menus.main.items.find(item => item.key === 'catalog')!.imageId, 77);
    assert.equal(driver.writes.filter(item => item.action === 'menu-content').length, 1);
    assert.deepEqual((await provisionHeaderModule(directory, driver)).map(item => item.status), ['unchanged']);
    driver.module!.menuContent!.recommendations.elements[0].settings.css_classes = 'external edit';
    await assert.rejects(updateHeaderModule(directory, driver, 'style'), /remote_module_changed/);
  }); } finally { await content.cleanup(); }
});

test('service provisions owned resources once with durable intents and reruns without duplicate allocation', async () => fixture(async (directory, driver) => {
  const first = await provisionHeaderModule(directory, driver);
  assert.deepEqual(first.map(item => [item.action, item.status]), [['reserve', 'confirmed'], ['menu', 'confirmed'], ['style', 'confirmed'], ['header', 'confirmed']]);
  assert.deepEqual(driver.writes.map(item => item.action), ['reserve', 'menu', 'style', 'header']);
  assert.equal(driver.inspections,9,'one initial observation plus the fixture server CAS/readback; no redundant client read after each confirmed write');
  const identity = (await loadHeaderBundle(directory)).state.identity;
  assert.equal(driver.module!.header!.id, identity.headerId);
  assert.equal(driver.module!.menus.main.items[2].parentKey, 'catalog');
  assert.equal(driver.module!.menus.main.items[0].url, `${origin}/`);
  assert.ok(driver.module!.style!.css.includes(`.whb-${identity.headerId}`));
  const saved = clone(driver.module);
  assert.deepEqual((await provisionHeaderModule(directory, driver)).map(item => item.status), ['unchanged']);
  assert.equal(driver.writes.length, 4); assert.deepEqual(driver.module, saved);
  assert.equal((await loadHeaderBundle(directory)).state.pending, null);
}));

test('authorized published header conversion preserves body and other menus and reconciles a lost response',async()=>{
 const f=await contentFixture();try{await fixture(async(directory,driver)=>{
  await provisionHeaderModule(directory,driver);const created=await createHeaderModulePage(directory,driver,{title:'Test',slug:'test'});const pageId=(created.result as any).pageId;await bindHeaderModulePage(directory,driver,pageId);
  driver.module!.pages[String(pageId)].status='publish';driver.module!.menuContent={};
  const identity=(await loadHeaderBundle(directory)).state.identity;await checkpointHeaderModule(directory,driver,(await driver.inspect(identity)).hash);
  const before=clone(driver.module!);const menus=JSON.parse(await readFile(path.join(directory,'menus.json'),'utf8'));menus[0].items=menus[0].items.filter((i:any)=>i.key!=='new');await writeFile(path.join(directory,'menus.json'),JSON.stringify(menus));
  if(f.entry.program.blocks[0].kind==='composite')f.entry.program.blocks[0].children.splice(1);
  const header=JSON.parse(await readFile(path.join(directory,'header.json'),'utf8'));header.menuContent=[{...f.entry,version:2,dropdown:{design:'full-width',padding:0,colorScheme:'default',event:'hover'},retireChildren:['new']}];await writeFile(path.join(directory,'header.json'),JSON.stringify(header));
  await assert.rejects(updateHeaderModule(directory,driver,'menu-content','recommendations',99999),/owned_bound_page/);
  driver.fault={action:'menu-content',kind:'lose-after'};
  assert.equal((await updateHeaderModule(directory,driver,'menu-content','recommendations',pageId)).status,'write-unknown');
  const writes=driver.writes.length;assert.equal((await reconcileHeaderModule(directory,driver)).status,'confirmed');assert.equal(driver.writes.length,writes);
  assert.deepEqual(driver.module!.pages,before.pages);assert.deepEqual(driver.module!.style,before.style);assert.deepEqual(driver.module!.header,before.header);
  assert.deepEqual(driver.writes.at(-1)!.publishedRevision,{pageId,bodyHash:before.pages[String(pageId)].bodyHash,snapshotHash:before.pages[String(pageId)].snapshotHash});
  assert.ok(!driver.module!.menus.main.items.some(i=>i.key==='new'));assert.equal(driver.module!.menus.main.items.find(i=>i.key==='catalog')!.content!.dropdown!._menu_item_padding,'0');
  assert.equal((await updateHeaderModule(directory,driver,'menu-content','recommendations',pageId)).status,'unchanged');
 });}finally{await f.cleanup();}
});

test('service creates and binds a new Full Width draft while preserving its independent body', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  const created = await createHeaderModulePage(directory, driver, { title: 'Cedar test', slug: 'cedar-header-test' });
  assert.equal(created.status, 'confirmed');
  const pageId = (created.result as { pageId: number }).pageId, beforeBody = clone(driver.body);
  assert.equal(driver.module!.pages[String(pageId)].headerId, null);
  assert.equal((await bindHeaderModulePage(directory, driver, pageId)).status, 'confirmed');
  const page = driver.module!.pages[String(pageId)];
  assert.equal(page.bodyHash, driver.bodyHash); assert.deepEqual(driver.body, beforeBody);
  assert.equal(page.headerId, driver.module!.identity.headerId); assert.equal(page.template, 'elementor_header_footer'); assert.equal(page.status, 'draft');
  const writes = driver.writes.length;
  assert.equal((await bindHeaderModulePage(directory, driver, pageId)).status, 'unchanged'); assert.equal(driver.writes.length, writes);
  await assert.rejects(bindHeaderModulePage(directory, driver, 123), /owned_full_width_draft_required/);
}));

test('independent CSS and menu edits update only their resource and leave header layout/page body intact', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  const created = await createHeaderModulePage(directory, driver, { title: 'Cedar test', slug: 'cedar-header-test' });
  await bindHeaderModulePage(directory, driver, (created.result as { pageId: number }).pageId);
  const before = clone(driver.module!);
  await writeFile(path.join(directory, 'header.css'), ':header {color:#abc;padding:12px}');
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'confirmed');
  assert.equal(driver.writes.at(-1)!.action, 'style');
  assert.notEqual(driver.module!.style!.css, before.style!.css);
  assert.deepEqual(driver.module!.menus, before.menus); assert.deepEqual(driver.module!.header, before.header); assert.deepEqual(driver.module!.pages, before.pages);
  const cssAfter = clone(driver.module!.style), menus = JSON.parse(await readFile(path.join(directory, 'menus.json'), 'utf8'));
  menus[0].items[1].title = 'Explore'; menus[0].items.push({ key: 'help', parentKey: null, title: 'Help', url: '/help' });
  await writeFile(path.join(directory, 'menus.json'), JSON.stringify(menus));
  assert.equal((await updateHeaderModule(directory, driver, 'menu', 'main')).status, 'confirmed');
  assert.equal(driver.module!.menus.main.items[1].title, 'Explore');
  assert.deepEqual(driver.module!.style, cssAfter); assert.deepEqual(driver.module!.header, before.header); assert.deepEqual(driver.module!.pages, before.pages);
  const writes = driver.writes.length; assert.equal((await updateHeaderModule(directory, driver, 'menu', 'main')).status, 'unchanged'); assert.equal(driver.writes.length, writes);
}));

test('lost write response blocks all mutation entrypoints until reconciliation confirms without replay', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  await writeFile(path.join(directory, 'header.css'), ':header {color:#def}');
  driver.fault = { action: 'style', kind: 'lose-after' };
  const lost = await updateHeaderModule(directory, driver, 'style'); assert.equal(lost.status, 'write-unknown');
  const writes = driver.writes.length, pending = (await loadHeaderBundle(directory)).state.pending;
  assert.equal(pending!.operationId, lost.operationId);
  await assert.rejects(updateHeaderModule(directory, driver, 'menu', 'main'), /reconciliation_required/);
  await assert.rejects(provisionHeaderModule(directory, driver), /reconciliation_required/);
  await assert.rejects(createHeaderModulePage(directory, driver, { title: 'Extra', slug: 'extra' }), /reconciliation_required/);
  await assert.rejects(bindHeaderModulePage(directory, driver, 123), /reconciliation_required/);
  await assert.rejects(checkpointHeaderModule(directory, driver, 'a'.repeat(64)), /reconciliation_required/);
  await inspectHeaderModule(directory, driver);
  assert.equal(driver.writes.length, writes);
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'confirmed');
  assert.equal(driver.writes.length, writes); assert.equal((await loadHeaderBundle(directory)).state.pending, null);
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'unchanged');
}));

test('a lost initial reserve response reconciles and resumes the remaining resources without another reserve', async () => fixture(async (directory, driver) => {
  driver.fault = { action: 'reserve', kind: 'lose-after' };
  assert.deepEqual((await provisionHeaderModule(directory, driver)).map(item => [item.action, item.status]), [['reserve', 'write-unknown']]);
  assert.ok(driver.module); assert.equal(driver.writes.length, 1);
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'confirmed');
  assert.equal(driver.writes.length, 1);
  assert.deepEqual((await provisionHeaderModule(directory, driver)).map(item => [item.action, item.status]), [['menu', 'confirmed'], ['style', 'confirmed'], ['header', 'confirmed']]);
  assert.deepEqual(driver.writes.map(item => item.action), ['reserve', 'menu', 'style', 'header']);
}));

test('partial started receipt remains a conflict even when its resource happens to match the request', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  await writeFile(path.join(directory, 'header.css'), ':header {color:#fed}');
  driver.fault = { action: 'style', kind: 'partial-after' };
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'write-unknown');
  const writes = driver.writes.length;
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'conflict');
  assert.ok((await loadHeaderBundle(directory)).state.pending);
  await assert.rejects(updateHeaderModule(directory, driver, 'style'), /reconciliation_required/); assert.equal(driver.writes.length, writes);
}));

test('a confirmed no-write failure clears pending without retrying the original operation', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  await writeFile(path.join(directory, 'header.css'), ':header {color:#bae}');
  driver.fault = { action: 'style', kind: 'throw-before' };
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'write-unknown');
  const writes = driver.writes.length;
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'unchanged');
  assert.equal(driver.writes.length, writes); assert.equal((await loadHeaderBundle(directory)).state.pending, null);
}));

test('external module edits require a reviewed exact-hash checkpoint before any new writes', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  driver.module!.menus.main.items[0].title = 'Manually reviewed Home';
  const observation = await inspectHeaderModule(directory, driver), writes = driver.writes.length;
  await assert.rejects(updateHeaderModule(directory, driver, 'style'), /remote_module_changed_checkpoint_required/);
  await assert.rejects(checkpointHeaderModule(directory, driver, 'a'.repeat(64)), /checkpoint_changed/);
  assert.deepEqual(await checkpointHeaderModule(directory, driver, observation.hash), { hash: observation.hash, remoteWrites: 0 });
  assert.equal(driver.writes.length, writes);
  await writeFile(path.join(directory, 'header.css'), ':header {color:#bcd}');
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'confirmed');
  assert.equal(driver.module!.menus.main.items[0].title, 'Manually reviewed Home');
}));

test('unrelated changes between operations are allowed but changes during an operation stay unresolved', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  driver.globalHash = headerJsonHash({ unrelated: 'legitimate other-site edit before operation' });
  await writeFile(path.join(directory, 'header.css'), ':header {color:#cde}');
  driver.fault = { action: 'style', kind: 'lose-after' };
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'write-unknown');
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'confirmed');
  await writeFile(path.join(directory, 'header.css'), ':header {color:#efb}');
  driver.fault = { action: 'style', kind: 'global-after' };
  assert.equal((await updateHeaderModule(directory, driver, 'style')).status, 'write-unknown');
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'conflict');
}));

test('the initial reserve also protects unrelated globals when the response is lost', async () => fixture(async (directory, driver) => {
  driver.fault = { action: 'reserve', kind: 'global-after' };
  assert.equal((await provisionHeaderModule(directory, driver))[0].status, 'write-unknown');
  const writes = driver.writes.length;
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'conflict');
  assert.equal(driver.writes.length, writes);
}));

test('an unsafe binding adapter that changes body data cannot confirm the binding', async () => fixture(async (directory, driver) => {
  await provisionHeaderModule(directory, driver);
  const created = await createHeaderModulePage(directory, driver, { title: 'Cedar test', slug: 'cedar-header-test' });
  driver.fault = { action: 'bind', kind: 'body-after' };
  assert.equal((await bindHeaderModulePage(directory, driver, (created.result as { pageId: number }).pageId)).status, 'write-unknown');
  assert.equal((await reconcileHeaderModule(directory, driver)).status, 'conflict');
}));

test('unsupported native parameters and missing logo media fail before allocating any remote resource', async () => {
  for (const mode of ['unknown-parameter', 'missing-logo-media']) await fixture(async (directory, driver) => {
    const filename = path.join(directory, 'header.json'), input = JSON.parse(await readFile(filename, 'utf8'));
    if (mode === 'unknown-parameter') input.layout.rows[0].params.unobserved_native_field = true;
    else input.layout.rows[0].columns.left.push({ key: 'brand', type: 'logo', params: {} });
    await writeFile(filename, JSON.stringify(input));
    await assert.rejects(provisionHeaderModule(directory, driver), /unknown_parameter|logo_media_missing/);
    assert.equal(driver.writes.length, 0); assert.equal(driver.module, null);
    assert.equal((await loadHeaderBundle(directory)).state.pending, null);
  });
});

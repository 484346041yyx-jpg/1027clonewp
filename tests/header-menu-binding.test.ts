import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { headerJsonHash } from '../src/woodmart-header/contract.js';
import { compileAdaptiveHeaderModule } from '../src/replica-responsive/header.js';
import { headerModuleElementId } from '../src/woodmart-header/generic/compiler.js';
import { validateHeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import { assertNativeHeaderMenuBindings, assertHeaderMenuParameterShape, plannedHeaderMenus, captureHeaderMenuEditorObservation, verifyHeaderMenuEditorEvidence, HEADER_MENU_SELECT_READER, type MenuEditorObservation } from '../src/woodmart-header/generic/menu-binding.js';
import { WordPressHeaderModuleDriver } from '../src/woodmart-header/generic/wordpress.js';
import { verifyFullReplicaReviewEvidence } from '../src/replica-full/body.js';
import { fullReplicaFingerprint } from '../src/replica-full/contract.js';
import { requiredReplicaViewports } from '../src/replica-responsive/contract.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { headerMenuFixture } from './fixtures/header-menu-binding.js';
import { createHeaderBundle, loadHeaderBundle } from '../src/woodmart-header/generic/bundle.js';
import type { WhbLayoutNode } from '../src/woodmart-header/layout.js';

const node = (root: WhbLayoutNode, id: string): WhbLayoutNode | undefined => root.id === id ? root : root.content?.map(child => node(child, id)).find(Boolean);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const php = path.join(process.cwd(), '.cache/php-8.3/php.exe');
test('actual PHP parser and server validator reject old numeric/options bindings and missing native selections', {skip:!existsSync(php)}, () => {
  assert.match(execFileSync(php,[path.join(process.cwd(),'tests/fixtures/header-menu-validation.php')],{cwd:process.cwd(),windowsHide:true,encoding:'utf8',timeout:10000}), /native menu server validation passed/);
});

test('Chinese menu slugs bind independent main and secondary menus on both native device layouts', () => {
  const { plan, contract, resources } = headerMenuFixture(), before = structuredClone({ plan, contract, resources });
  const raw = compileAdaptiveHeaderModule(validateHeaderModulePlan(plan), 'header_123', contract, resources);
  assert.equal(plannedHeaderMenus(plan).length, 4);
  for (const slot of plannedHeaderMenus(plan)) assert.deepEqual(node(raw.structure, headerModuleElementId(plan.moduleKey, slot.key))?.params?.menu_id, { id: 'menu_id', type: 'select', value: resources.menus[slot.menuKey].slug });
  assert.deepEqual({ plan, contract, resources }, before);
});

test('wrong native type, absent resources, swapped menus and corrupted mobile readback are rejected', () => {
  const { plan, contract, resources } = headerMenuFixture();
  const compile = () => compileAdaptiveHeaderModule(plan, 'header_123', contract, resources);
  contract.elements.menu!.schema.menu_id.type = 'options'; assert.throws(compile, /native_menu_select_required/);
  contract.elements.menu!.schema.menu_id.type = 'select';
  delete contract.elements.menu!.schema.menu_id.resource; assert.throws(compile, /menu_field_contract_invalid/); contract.elements.menu!.schema.menu_id.resource = 'menu';
  const raw = compile(), elementId = (key: string) => headerModuleElementId(plan.moduleKey, key);
  const check = () => assertNativeHeaderMenuBindings(plan, raw, contract, resources, elementId);
  const param = node(raw.structure, elementId('phone-languages'))!.params!.menu_id;
  param.value = '909'; assert.throws(check, /binding_mismatch/);
  param.value = resources.menus.main.slug; assert.throws(check, /binding_mismatch/);
  param.value = resources.menus.languages.slug; param.type = 'options'; assert.throws(check, /native_select_required/);
  param.type = 'select'; delete node(raw.structure, elementId('phone-languages'))!.params!.menu_id; assert.throws(check, /binding_missing/);
  const missing = structuredClone(plan); missing.layout.rows[0].columns.right[0].menuKey = 'missing'; assert.throws(() => validateHeaderModulePlan(missing), /menu_binding_missing/);
  const legacy = structuredClone(plan); delete legacy.menuBindingPolicy;
  assert.doesNotThrow(() => assertNativeHeaderMenuBindings(legacy, raw, contract, resources, elementId));
  const desktopOnly = structuredClone(plan); delete desktopOnly.layout.mobile;
  assert.throws(() => compileAdaptiveHeaderModule(desktopOnly, 'header_123', contract, resources), /mobile_plan_required/);
});

test('real native select reproduction: term IDs show blank, while the saved slug selects the correct label on desktop and mobile', async () => {
  const fixture = headerMenuFixture(), { plan, contract, resources } = fixture;
  const raw = compileAdaptiveHeaderModule(plan, 'header_123', contract, resources), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), files = new Map<string, Buffer>();
    const put = (name: string, bytes: Buffer) => { files.set(name, bytes); return { path: name, sha256: hash(bytes) }; };
    await page.route('https://target.example/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Native editor fixture</main>' }));
    const url = 'https://target.example/wp-admin/admin.php?page=xts_header_builder#/builder/header_123';
    let active = plannedHeaderMenus(plan)[0];
    const markup = (value: string) => `<h1>${active.device} / ${active.key}</h1><select id="select-menu_id"><option value="">选择</option>${plan.menus.map(m => `<option value="${resources.menus[m.key].slug}" ${resources.menus[m.key].slug === value ? 'selected' : ''}>${m.name}</option>`).join('')}</select>`;
    await page.setContent(markup('909'));
    assert.equal(await page.locator('select').inputValue(), '');
    const observations: MenuEditorObservation[] = [];
    for (const slot of plannedHeaderMenus(plan)) {
      const elementId = headerModuleElementId(plan.moduleKey, slot.key);
      observations.push(await captureHeaderMenuEditorObservation({ taskId: plan.owner.ownerId, runId: plan.owner.runId, headerId: 'header_123', fingerprint: 'b'.repeat(64), device: slot.device, elementKey: slot.key, elementId, savedHeaderHash: headerJsonHash(raw), editorUrl: url }, {
        async reopen(editorUrl) { await page.goto(editorUrl); },
        async openMenu(device, id) {
          active = plannedHeaderMenus(plan).find(s => s.device === device && headerModuleElementId(plan.moduleKey, s.key) === id)!;
          await page.setViewportSize({ width: device === 'mobile' ? 430 : 1280, height: 800 });
          await page.setContent(markup(node(raw.structure, id)!.params!.menu_id.value as string));
        },
        async readPanel() { return { editorUrl: page.url(), device: active.device, elementId, selection: await page.evaluate(HEADER_MENU_SELECT_READER) as MenuEditorObservation['selection'] }; },
        async screenshot() { return put(slot.key + '.png', await page.screenshot()); },
      }));
    }
    let refs = observations.map(row => put(row.elementKey + '.json', Buffer.from(JSON.stringify(row))));
    const read = async (ref: { path: string; sha256: string }) => { const bytes = files.get(ref.path)!; assert.equal(hash(bytes), ref.sha256); return { bytes, filename: ref.path }; };
    const verify = () => verifyHeaderMenuEditorEvidence({ plan, headerId: 'header_123', taskId: plan.owner.ownerId, runId: plan.owner.runId, fingerprint: 'b'.repeat(64), headerHash: headerJsonHash(raw), observedAt: new Date().toISOString(), references: refs, base: '.', read, saved: { raw, contract, resources } });
    await verify();
    const good = structuredClone(refs);
    refs = refs.slice(1); await assert.rejects(verify, /coverage_incomplete/);
    refs = [good[0], good[0], ...good.slice(2)]; await assert.rejects(verify, /editor_identity/);
    for (const mutate of [
      (row: MenuEditorObservation) => { row.selection.value = '909'; },
      (row: MenuEditorObservation) => { row.selection.options.filter(o => o.selected)[0].label = 'Wrong menu'; },
      (row: MenuEditorObservation) => { row.editorUrl = url.replace('target.example', 'other.example'); },
      (row: MenuEditorObservation) => { row.savedHeaderHash = 'c'.repeat(64); },
      (row: MenuEditorObservation) => { row.device = 'mobile'; },
      (row: MenuEditorObservation) => { row.openedAt = new Date(Date.parse(row.observedAt) + 1000).toISOString(); },
      (row: MenuEditorObservation) => { row.selection.value = ''; row.selection.options.forEach(o => {o.selected = o.value === '';}); },
    ]) {
      const broken = structuredClone(observations[0]); mutate(broken);
      refs = [put('broken.json', Buffer.from(JSON.stringify(broken))), ...good.slice(1)];
      await assert.rejects(verify);
    }
    refs = good; node(raw.structure, headerModuleElementId(plan.moduleKey, 'phone-languages'))!.params!.menu_id.type = 'options';
    await assert.rejects(verify, /native_select_required/);
  } finally { await browser.close(); }
});

test('a new policy survives bundle storage while a legacy bundle keeps its exact plan hash', async () => {
  const root = path.resolve(process.cwd()); await mkdir(path.join(root, '.cache'), { recursive: true });
  const dir = await mkdtemp(path.join(root, '.cache', 'header-menu-bundle-'));
  try {
    const { plan } = headerMenuFixture();
    const created = await createHeaderBundle(path.join(dir,'new'),plan);
    assert.deepEqual((await loadHeaderBundle(created.directory)).plan.menuBindingPolicy,plan.menuBindingPolicy);
    const legacy = structuredClone(plan);delete legacy.menuBindingPolicy;
    legacy.layout.rows[0].columns.right=[];legacy.layout.mobile!.rows[0].columns.center=[];
    const before=headerJsonHash(legacy), old=await createHeaderBundle(path.join(dir,'old'),legacy);
    assert.equal(Object.hasOwn(old.plan,'menuBindingPolicy'),false);assert.equal(headerJsonHash(old.plan),before);
  } finally {
    if (!dir.startsWith(path.join(root,'.cache')+path.sep))throw Error('test_cleanup_outside_workspace');
    await rm(dir,{recursive:true,force:true});
  }
});

test('capture rejects switching devices or panels while a screenshot is being recorded', async () => {
  const {plan}=headerMenuFixture();let reads=0;
  const identity={taskId:plan.owner.ownerId,runId:plan.owner.runId,headerId:'header_123',fingerprint:'b'.repeat(64),device:'desktop' as const,elementKey:'nav',elementId:headerModuleElementId(plan.moduleKey,'nav'),savedHeaderHash:'c'.repeat(64),editorUrl:plan.targetOrigin+'/wp-admin/admin.php?page=xts_header_builder#/builder/header_123'};
  await assert.rejects(captureHeaderMenuEditorObservation(identity,{
    async reopen(){},async openMenu(){},async screenshot(){return{path:'panel.png',sha256:'d'.repeat(64)};},
    async readPanel(){return{editorUrl:identity.editorUrl,device:++reads===1?'desktop':'mobile',elementId:identity.elementId,selection:{tag:'SELECT',id:'select-menu_id',value:'main-menu',options:[{value:'',label:'选择',selected:false},{value:'main-menu',label:'主导航',selected:true}]}};},
  }),/editor_capture_changed/);
});

test('strict driver rejects old options bindings before a mutation and transmits policy only for new-task adapters', async () => {
  const { plan, contract, resources } = headerMenuFixture(), raw = compileAdaptiveHeaderModule(plan, 'header_123', contract, resources);
  const calls: string[] = [], transport = { origin: plan.targetOrigin, async readPHP<T>(op: {code: string}) { calls.push(op.code); return { ok: true, value: {} } as T; }, async executePHP<T>() { throw Error('must not write'); } };
  const identity = { moduleKey: plan.moduleKey, owner: plan.owner, targetOrigin: plan.targetOrigin, headerId: raw.id };
  const strict = new WordPressHeaderModuleDriver(transport, undefined, 1), legacy = new WordPressHeaderModuleDriver(transport);
  await strict.inspect(identity); await legacy.inspect(identity);
  const decode = (code: string) => JSON.parse(Buffer.from(code.match(/base64_decode\('([^']+)'/u)![1], 'base64').toString());
  assert.equal(decode(calls[0]).menuBindingVersion, 1); assert.equal(Object.hasOwn(decode(calls[1]), 'menuBindingVersion'), false);
  node(raw.structure, headerModuleElementId(plan.moduleKey, 'languages'))!.params!.menu_id = { id: 'menu_id', type: 'options', value: '909' };
  assert.throws(() => assertHeaderMenuParameterShape(raw), /native_select_required/);
  const intent = { runId: plan.owner.runId, operationId: 'fixture-write', resource: 'header-module/' + plan.moduleKey, expectedSnapshotSha256: 'a'.repeat(64), persistedIntentSha256: 'b'.repeat(64) };
  await assert.rejects(strict.mutate(identity, { operationId: intent.operationId, action: 'header', expectedHash: intent.expectedSnapshotSha256, payload: {raw} }, intent), /native_select_required/);
  assert.equal(calls.length, 2);
});

test('whole-page approval requires fresh header readback and every native menu panel observation', async () => {
  const { plan, contract, resources } = headerMenuFixture(), raw = compileAdaptiveHeaderModule(plan, 'header_123', contract, resources);
  const root = path.resolve(process.cwd()); await mkdir(path.join(root, '.cache'), { recursive: true });
  const dir = await mkdtemp(path.join(root, '.cache', 'header-menu-gate-'));
  try {
    const bound: any = { pageId: 123, runId: plan.owner.runId, headerId: raw.id, bodyHash: 'a'.repeat(64), cssHash: 'b'.repeat(64), documentHash: 'c'.repeat(64), headerHash: headerJsonHash(raw), menuHash: 'd'.repeat(64), styleHash: 'e'.repeat(64) };
    const evidence = { version: 1, kind: 'clonewp-full-replica-review-evidence', taskId: plan.owner.ownerId, runId: plan.owner.runId, pageId: 123, fingerprint: fullReplicaFingerprint(bound), viewports: requiredReplicaViewports(undefined).map(() => ({})) };
    const bytes = Buffer.from(JSON.stringify(evidence)), filename = path.join(dir, 'review.json'); await writeFile(filename, bytes);
    const review: any = { ...evidence, kind: 'clonewp-full-replica-review', decision: 'approved', observedAt: new Date().toISOString(), reviewerEvidence: {path:filename,sha256:hash(bytes)} };
    const manifest: any = {taskId:plan.owner.ownerId,runId:plan.owner.runId,header:{plan},body:{}};
    await assert.rejects(verifyFullReplicaReviewEvidence(review,bound,manifest), /header_menu_readback_required/);
    await assert.rejects(verifyFullReplicaReviewEvidence(review,bound,manifest,undefined,undefined,{contract,resources,snapshot:{module:{header:raw}}} as any), /editor_coverage_incomplete/);
  } finally {
    if (!dir.startsWith(path.join(root, '.cache') + path.sep)) throw Error('test_cleanup_outside_workspace');
    await rm(dir, {recursive:true,force:true});
  }
});

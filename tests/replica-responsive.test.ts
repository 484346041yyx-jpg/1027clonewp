import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { prepareResponsiveBody, compileResponsiveBody } from '../src/replica-responsive/body.js';
import { compileAdaptiveHeaderModule, adaptiveHeaderCSS } from '../src/replica-responsive/header.js';
import { validateHeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import { compileHeaderModule, type NativeHeaderContract } from '../src/woodmart-header/generic/compiler.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { assertNative44Compilation } from '../src/native44/compiler.js';
import { validatePreparationPlan, buildPreparationJobs, preparationSharedHash } from '../src/replica-preparation/contract.js';
import { initializePreparation, startPreparationJob, completePreparationJob, mergePreparationDirectory } from '../src/replica-preparation/io.js';
import { prepareActualBody } from '../src/replica-full/body-prepare.js';
import { validateFullReplicaManifest, validateFullReplicaReview, fullReplicaFingerprint } from '../src/replica-full/contract.js';
import { assertResponsiveTarget } from '../src/replica-responsive/target.js';
import type { Native44Program } from '../src/native44/types.js';
import type { ResponsivePlan, ResponsiveSection } from '../src/replica-responsive/contract.js';

const ref = { path: 'mobile.json', sha256: 'a'.repeat(64) };
const source = { version: 1 as const, tablet: 'desktop' as const, mobileMaxWidth: 767 as const, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }], source: ref };
const section = (key: string, mode: 'shared' | 'duplicate' = 'shared'): ResponsiveSection => ({ key, mode, reason: 'Source phone screenshots prove this section layout.', evidence: [{ snapshotId: 'phone-390', nodeId: key }, { snapshotId: 'phone-430', nodeId: key }], settings: [{ componentKey: key, values: { flex_direction_mobile: 'column' } }], childOrders: [], css: '' });
async function bodyFixture() {
  const f = await preparationIOFixture();
  const program: Native44Program = { ...f.plan.bodyBase, blocks: f.results.flatMap(r => r.sections?.flatMap(s => s.blocks) ?? []) };
  return { ...f, program, responsive: { ...source, sections: program.blocks.map(b => section(b.key)) } as ResponsivePlan };
}
test('one workflow adds native phone settings without changing the desktop program or tablet values', async () => {
  const f = await bodyFixture(); try {
    const before = structuredClone(f.program), result = prepareResponsiveBody(f.program, f.responsive, ':page{color:black}');
    assert.deepEqual(f.program, before); assert.equal(result.program.blocks[0].settings?.flex_direction_mobile, 'column');
    assert.equal(result.program.blocks.length, before.blocks.length);
    assert.throws(() => prepareResponsiveBody(f.program, { ...f.responsive, sections: [] }, ''), /./);
    f.responsive.sections[0].settings[0].values = { padding_tablet: {} };
    assert.throws(() => prepareResponsiveBody(f.program, f.responsive, ''), /native_mobile_field/);
  } finally { await f.cleanup(); }
});
test('responsive body compiles explicit phone press feedback without changing legacy plans', async () => {
  const f = await bodyFixture(); try {
    const baseline = prepareResponsiveBody(f.program, f.responsive, ':page{color:black}').css;
    assert.equal(baseline.includes('pointer:coarse'), false);
    f.responsive.sections[0].touch = [{
      key: 'card', behavior: 'press-feedback', reason: 'The phone source shows a directly navigable card with temporary touch paint.',
      sourceOwners: [{ snapshotId: 'phone-390', nodeId: 'card-390' }, { snapshotId: 'phone-430', nodeId: 'card-430' }],
      press: { trigger: '.card', target: '.image img', property: 'transform', value: 'scale(1.09)' },
    }];
    const result = prepareResponsiveBody(f.program, f.responsive, ':page{color:black}');
    assert.match(result.css, /hover:none/);
    assert.match(result.css, new RegExp(native44ModuleClass(f.responsive.sections[0].key)));
    assert.equal(result.program.blocks.length, f.program.blocks.length);
  } finally { await f.cleanup(); }
});
test('whole-section variants keep content shared, use unique IDs, and show only one presentation', async () => {
  const f = await bodyFixture(); try {
    f.responsive.sections[0].mode = 'duplicate';
    const cls = native44ModuleClass(f.program.blocks[0].key), result = prepareResponsiveBody(f.program, f.responsive, `:page .${cls} h2{color:red}`);
    const original = result.program.blocks[0], mobile = result.program.blocks[1];
    assert.equal(original.settings?.hide_mobile, 'hidden-mobile'); assert.equal(mobile.settings?.hide_tablet, 'hidden-tablet');
    assert.equal(mobile.key, original.key + '_phone');
    assert.equal((mobile as any).children[0].widgetSettings.title, (original as any).children[0].widgetSettings.title);
    assert.ok(result.css.includes(native44ModuleClass(mobile.key)));
    const bad = structuredClone(f.program); (bad.blocks[0] as any).children[0] = { kind: 'native-products', key: 'hero_products', widgetType: 'wd_products', widgetSettings: {} };
    assert.throws(() => prepareResponsiveBody(bad, f.responsive, ''), /dynamic_duplicate_unsupported/);
    f.responsive.sections[0].css = `:page .${cls}{display:none}`;
    assert.throws(() => prepareResponsiveBody(f.program, f.responsive, ''), /native_control_conflict/);
  } finally { await f.cleanup(); }
});

test('source phone-only content uses managed native desktop and tablet visibility', async () => {
  const f = await bodyFixture(); try {
    f.responsive.sections[0].mode = 'phone-only';
    const result = prepareResponsiveBody(f.program, f.responsive, '');
    assert.equal(result.program.blocks[0].settings?.hide_desktop, 'hidden-desktop');
    assert.equal(result.program.blocks[0].settings?.hide_tablet, 'hidden-tablet');
    assert.equal(result.program.blocks[0].settings?.hide_mobile, undefined);
    assert.equal(f.program.blocks[0].settings?.hide_desktop, undefined);
  } finally { await f.cleanup(); }
});

test('managed static branches use native visibility without permitting duplicated queries or forms', async () => {
  const f = await bodyFixture(); try {
    const root = f.program.blocks[0] as any, child = root.children[0];
    root.children = [{ kind: 'composite', key: root.key+'_media', sourceFactIds: child.sourceFactIds, children: [child] }];
    f.responsive.sections[0].visibility = [{ componentKey: root.key+'_media', hideOn: ['mobile'] }];
    const result = prepareResponsiveBody(f.program, f.responsive, '');
    assert.equal((result.program.blocks[0] as any).children[0].settings.hide_mobile, 'hidden-mobile');
    root.children[0].children = [{ kind: 'native-products', key: root.key+'_query', widgetType: 'wd_products', widgetSettings: {}, query: { ids: [1], evidence: ['synthetic'] } }];
    assert.throws(() => prepareResponsiveBody(f.program, f.responsive, ''), /visibility_static_branch_required/);
    root.children[0].children = [child];
    f.responsive.sections[0].visibility![0].hideOn = ['desktop'];
    assert.throws(() => prepareResponsiveBody(f.program, f.responsive, ''), /visibility_static_branch_required/);
    f.responsive.sections[0].visibility![0] = { componentKey: root.key, hideOn: ['mobile'] };
    assert.throws(() => prepareResponsiveBody(f.program, f.responsive, ''), /visibility_static_branch_required/);
  } finally { await f.cleanup(); }
});
test('responsive compilation keeps the native compiler proof and rejects schema drift or CSS overriding native controls', async () => {
  const f = await bodyFixture(); try {
    f.responsive.sections[0].mode = 'duplicate';
    const result = prepareResponsiveBody(f.program, f.responsive, ''), loaded = await loadNative44Knowledge(['container', 'heading']);
    const schemas: any = {};
    for (const type of ['container', 'heading']) {
      const controls: any = {}; for (const c of loaded.components[type].controls) {
        controls[c.id] = { type: c.type, ...(c.defaultValue !== undefined ? { default: c.defaultValue } : {}) };
        if (c.responsive) for (const suffix of ['mobile', 'tablet']) controls[c.id + '_' + suffix] = { type: c.type, responsive: { max: suffix } };
      }
      schemas[type] = { type, class: 'Fixture', controls };
    }
    schemas.container.controls.flex_direction.responsive = { max: 'desktop' };
    for (const name of ['desktop', 'tablet', 'mobile']) schemas.container.controls['hide_' + name] = { type: 'switcher', return_value: 'hidden-' + name };
    const knowledge = toNative44CompilerKnowledge(loaded), options = { schemas, knowledge, assets: [] };
    const compiled = compileResponsiveBody(result.program, options); assertNative44Compilation(compiled, compiled.composition);
    assert.equal(new Set(Object.values(compiled.elementMap)).size, Object.keys(compiled.elementMap).length);
    const phoneOwner = result.program.blocks.find(node => node.settings?.flex_direction_mobile)!;
    const selector = `:page .${native44ModuleClass(phoneOwner.key)}`;
    schemas.container.controls.flex_direction_mobile.selectors = { '{{WRAPPER}}': 'flex-direction: {{VALUE}};' };
    assert.doesNotThrow(() => compileResponsiveBody(result.program, options, `${selector} .label{flex-direction:row}${selector}:hover{flex-direction:row}@media(min-width:769px){${selector}{flex-direction:row}}`));
    assert.doesNotThrow(() => compileResponsiveBody(result.program, options, `@media(max-width:768px){${selector}{flex-direction:${phoneOwner.settings!.flex_direction_mobile}}}`));
    assert.throws(() => compileResponsiveBody(result.program, options, `@media(max-width:768px){${selector}{flex-direction:row}}`), /css_overrides_native_mobile_value/);
    Object.assign(result.program.blocks[0].settings!, { background_background: 'video', background_video_link: 'https://source.example/video.mp4', background_play_on_mobile: 'yes' });
    const video = compileResponsiveBody(result.program, options); assert.equal(video.composition.elements[0].settings.background_play_on_mobile, 'yes');
    schemas.container.controls.background_play_on_mobile.responsive = { max: 'desktop' };
    assert.throws(() => compileResponsiveBody(result.program, options), /native_named_registration/); delete schemas.container.controls.background_play_on_mobile.responsive;
    schemas.container.controls.hide_mobile.return_value = 'yes';
    assert.throws(() => compileResponsiveBody(result.program, options), /visibility_registration/);
  } finally { await f.cleanup(); }
});
function headerFixture() {
  const slots = ['top-bar', 'general-header', 'header-bottom'] as const, rowColumns: any = {};
  const structure: any = { id: 'root', type: 'root', content: slots.map(slot => { rowColumns[slot] = { left: slot + '-l', center: slot + '-c', right: slot + '-r' }; return { id: slot, type: 'row', params: {}, content: [...Object.values(rowColumns[slot]).map(id => ({ id, type: 'column', desktop_only: true, content: [] })), ...['left', 'center', 'right'].map(p => ({ id: slot + '-m-' + p, type: 'column', mobile_only: true, class: 'whb-mobile-' + p, content: [] }))] }; }) };
  const contract: NativeHeaderContract = { kind: 'clonewp-whb-native-contract', version: 1, targetOrigin: 'https://target.example', fingerprint: 'a'.repeat(64), structure, settings: {}, rowColumns, settingsSchema: {}, rowSchema: { hide_desktop: { type: 'switcher', valueType: 'boolean' }, hide_mobile: { type: 'switcher', valueType: 'boolean' }, height: { type: 'slider', valueType: 'number' }, mobile_height: { type: 'slider', valueType: 'number', min: 40, max: 200 } }, elements: { logo: { type: 'logo', schema: { image: { type: 'image', valueType: 'image', resource: 'image' } } }, mainmenu: { type: 'mainmenu', schema: { menu_id: { type: 'select', valueType: 'string', resource: 'menu' }, full_screen: { type: 'switcher', valueType: 'boolean' }, style: { type: 'selector', valueType: 'string', options: ['text', 'icon'] } } } }, styleElement: { type: 'HTMLBlock', field: 'block_id', schema: { block_id: { type: 'select', valueType: 'string', resource: 'html-block' } } } };
  const base: any = { kind: 'clonewp-header-module', version: 1, moduleKey: 'phone', targetOrigin: contract.targetOrigin, owner: { ownerId: 'clonewp', runId: 'phone' }, name: 'Phone test header', menus: [{ key: 'primary', name: 'Phone test menu', items: [{ key: 'home', title: 'Home', url: '/', parentKey: null }] }], layout: { settings: {}, rows: [{ slot: 'general-header', params: { height: 96 }, columns: { left: [{ key: 'logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [], right: [{ key: 'nav', type: 'mainmenu', menuKey: 'primary', params: { style: 'text' } }] } }] }, style: { css: ':header{color:black}', fonts: [] } };
  const resources = { targetOrigin: contract.targetOrigin, menus: { primary: { id: 12, slug: 'phone-test-menu' } }, media: { logo: { id: 15, url: 'https://target.example/logo.png', width: 100, height: 40 } }, styleBlockId: 22 };
  return { base, contract, resources };
}
test('one WHB header has independent phone columns with an owned native icon menu; old headers are byte-identical', () => {
  const { base, contract, resources } = headerFixture();
  assert.deepEqual(compileAdaptiveHeaderModule(base, 'header_phone', contract, resources), compileHeaderModule(base, 'header_phone', contract, resources));
  const before = structuredClone({ base, contract, resources });
  base.layout.mobile = { version: 1, tablet: 'desktop', mobileMaxWidth: 767, css: ':header .site-logo{max-width:180px}', rows: [{ slot: 'general-header', params: { mobile_height: 72 }, columns: { left: [{ ...base.layout.rows[0].columns.left[0], key: 'phone-logo' }], center: [], right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'primary', params: { style: 'icon', full_screen: true } }] } }] };
  const plan = validateHeaderModulePlan(base), raw = compileAdaptiveHeaderModule(plan, 'header_phone', contract, resources);
  const mobile = raw.structure.content![1].content!.find(c => c.id === 'general-header-m-right')!;
  assert.equal(mobile.content![0].params!.menu_id.value, 'phone-test-menu'); assert.equal(raw.structure.content![1].params!.height.value, 96);
  assert.equal(raw.structure.content![1].params!.mobile_height.value, 72); assert.ok(adaptiveHeaderCSS(plan).includes('min-width:768px'));
  assert.deepEqual({ contract, resources }, { contract: before.contract, resources: before.resources });
  base.layout.mobile.rows[0].params.height = 140; assert.throws(() => validateHeaderModulePlan(base), /shared_row_setting/);
});
test('phone text utilities coexist with one native panel menu and cannot override its aggregation', () => {
  const { base, contract, resources } = headerFixture();
  base.menus.push({ key: 'utility', name: 'Region selector', items: [{ key: 'us', title: 'United States (US)', url: '/us/', parentKey: null }] });
  (resources.menus as any).utility = { id: 23, slug: 'region-selector' };
  const utility = { key: 'phone-region', type: 'mainmenu', menuKey: 'utility', params: { style: 'text', full_screen: false } };
  const panel = { key: 'phone-panel', type: 'mainmenu', menuKey: 'primary', params: { style: 'icon', full_screen: true } };
  base.layout.mobile = { version: 1, tablet: 'desktop', mobileMaxWidth: 767, css: '', rows: [{ slot: 'header-bottom', params: {}, columns: { left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [utility], right: [panel] } }] };
  assert.doesNotThrow(() => compileAdaptiveHeaderModule(validateHeaderModulePlan(base), 'header_phone', contract, resources));
  base.layout.mobile.rows[0].columns.center = [panel]; base.layout.mobile.rows[0].columns.right = [utility];
  assert.throws(() => compileAdaptiveHeaderModule(validateHeaderModulePlan(base), 'header_phone', contract, resources), /phone_menu_aggregation/);
  base.layout.mobile.rows[0].columns.right = [{ ...panel, key: 'second-panel' }];
  assert.throws(() => validateHeaderModulePlan(base), /one_phone_menu_required/);
});

test('target breakpoint drift is a read-only failure before creating resources', async () => {
  const transport = (mobile: number, woodmart = '8.3.4') => ({ readPHP: async () => ({ ok: true, mobile, tablet: 1024, woodmart, mobileOptimization: false, visibility: Object.fromEntries(['desktop','tablet','mobile'].map(k => ['hide_'+k,{type:'switcher',return_value:'hidden-'+k}])) }) }) as any;
  await assertResponsiveTarget(transport(768)); await assertResponsiveTarget(transport(768, '8.5.5'));
  await assert.rejects(assertResponsiveTarget(transport(880)), /unverified/);
  await assert.rejects(assertResponsiveTarget(transport(768, '9.0.0')), /unverified/);
});
test('existing preparation entry upgrades to version 2 and merges phone plans in the same job/result lifecycle', async () => {
  const f = await bodyFixture(); try {
    f.plan.version = 2;
    const refs = [];
    for (const view of source.viewports) {
      const packet = structuredClone(f.packets[0]); packet.snapshot.id = 'phone-' + view.width;
      Object.assign(packet.snapshot.viewport, { name: 'phone', ...view, clientWidth: view.width, scrollbarWidth: 0 }); packet.snapshot.pageHeight = view.height;
      const sharp = (await import('sharp')).default;
      const image = await f.put('phone-' + view.width + '.png', await sharp({ create: { ...view, channels: 3, background: '#fff' } }).png().toBuffer()); packet.snapshot.screenshot = { ...image, ...view };
      refs.push(await f.put('phone-' + view.width + '.json', packet));
    }
    f.plan.responsive = { ...source, source: await f.put('responsive-source.json', { version: 1, kind: 'clonewp-responsive-source', taskId: f.plan.taskId, sourceUrl: f.plan.sourceUrl, packets: refs }) };
    const validated = validatePreparationPlan(f.plan), jobs = buildPreparationJobs(validated), sharedHash = preparationSharedHash(validated);
    const header = structuredClone(f.plan.headerBase!); header.layout.rows[0].columns.left.push({ key: 'desktop-logo', type: 'logo', params: { image: { $media: 'logo' } } });
    header.layout.mobile = { version: 1, tablet: 'desktop', mobileMaxWidth: 767, css: '', rows: [{ slot: 'general-header', params: {}, columns: { left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [], right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'main', params: { style: 'icon', full_screen: true } }] } }] };
    await initializePreparation(validated, { finalRunDirectory: f.finalRunDirectory });
    for (const job of jobs) {
      await startPreparationJob(f.preparationDirectory, job.jobId);
      const result = structuredClone(f.results.find(r => r.jobId === job.jobId)!); result.contractHash = job.contractHash; result.sharedHash = sharedHash;
      if (result.header) result.header = header;
      for (const s of result.sections ?? []) s.responsive = section(s.key);
      await completePreparationJob(f.preparationDirectory, job.jobId, await f.writeResult(job.jobId, result));
    }
    const merged: any = await mergePreparationDirectory(f.preparationDirectory), manifest = validateFullReplicaManifest(JSON.parse(await readFile(merged.manifest.path, 'utf8')));
    assert.equal(manifest.version, 2); assert.equal(manifest.responsive!.sections.length, 2);
    const body: any = await prepareActualBody(manifest); assert.equal(body.payload.program.blocks[0].settings.flex_direction_mobile, 'column');
    assert.throws(() => validateFullReplicaManifest({ ...manifest, version: 1 }), /responsive_version_contract/);
    const bound: any = { pageId: 99, runId: manifest.runId, headerId: 'header_test', bodyHash: 'a', cssHash: 'a', documentHash: 'a', headerHash: 'a', menuHash: 'a', styleHash: 'a' };
    const review: any = { version: 1, kind: 'clonewp-full-replica-review', taskId: manifest.taskId, runId: manifest.runId, pageId: 99, fingerprint: fullReplicaFingerprint(bound), decision: 'approved', observedAt: new Date().toISOString(), reviewerEvidence: ref, viewports: [{ width: 1920, height: 1080 }, { width: 1440, height: 1000 }].map(v => ({ ...v, screenshot: ref, visual: 'passed', interactions: 'passed', headerCount: 1, bodyHeaderCount: 0 })) };
    assert.throws(() => validateFullReplicaReview(review, manifest, bound), /viewports_incomplete/);
  } finally { await f.cleanup(); }
});

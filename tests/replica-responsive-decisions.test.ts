import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { native44Id, native44ModuleClass } from '../src/native44/adapters.js';
import { responsiveSourceSchema, responsiveBodyPlanSchema } from '../src/replica-responsive/contract.js';
import { responsiveDecisionsSchema, verifyDecisionSources, assertDecisionProgram, assertStableContainerCSS, type ResponsiveDecisions, type ResponsiveDecisionPlan } from '../src/replica-responsive/decisions.js';
import { verifyResponsiveDecisionReview } from '../src/replica-responsive/decision-review.js';
import { adaptiveHeaderCSS, adaptiveHeaderEnvironmentCSS, responsiveHeaderPageCSS } from '../src/replica-responsive/header.js';
import { CURRENT_REPLICA_WORKFLOW_VERSION } from '../src/replica-responsive/defaults.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { validatePreparationPlan, preparationSharedHash } from '../src/replica-preparation/contract.js';

const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
const decisions = (): ResponsiveDecisions => ({ version: 1,
  layouts: [{ key: 'feature', sectionKey: 'hero', containerKey: 'hero_row', iconKey: 'hero_icon', textKey: 'hero_text', views: views.map(v => ({ ...v, snapshotId: 'phone-' + v.width, nodeId: 'feature', iconNodeId: 'icon', textNodeId: 'text', arrangement: 'row', gap: 20, iconVisible: true })) }],
  carousels: [{ componentKey: 'hero_products', sectionKey: 'hero', nativeField: 'slides_per_view_mobile', views: views.map(v => ({ ...v, snapshotId: 'phone-' + v.width, nodeId: 'products', interactionId: 'carousel', visibleItems: 2 })) }],
  header: { implementation: 'scoped-css', flow: 'reserve-space', views: views.map(v => ({ ...v, snapshotId: 'phone-' + v.width, nodeId: 'header', interactionId: 'scroll', policy: 'fixed', offset: 0 })) },
});
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
function sourcePackets() {
  return views.map(v => {
    const boxes = { feature: rect(0, 0, 300, 150), icon: rect(10, 10, 50, 50), text: rect(80, 10, 200, 100), products: rect(0, 150, 290, 140), item1: rect(0, 150, 140, 140), item2: rect(150, 150, 140, 140), item3: rect(300, 150, 140, 140), header: rect(0, 0, v.width, 80) };
    return { snapshot: { id: 'phone-' + v.width, viewport: v }, nodes: Object.fromEntries(Object.keys(boxes).map(id => [id, { id, layoutId: id, visible: true, parentId: ['icon', 'text'].includes(id) ? 'feature' : null }])), layouts: Object.fromEntries(Object.entries(boxes).map(([id, r]) => [id, { rect: r }])), usages: { icon: { nodeId: 'icon', visible: true } }, interactions: {
      carousel: { nodeId: 'products', kind: 'carousel', status: 'observed', itemNodeIds: ['item1', 'item2', 'item3'], details: { visibleItems: 2 } },
      scroll: { nodeId: 'header', kind: 'navigation', status: 'observed', details: { scrollPolicy: 'fixed', headerFlow: 'reserve-space', contentTop: 80, offset: 0, topY: 0, downY: 0, upY: 0, menuOpenY: 0, downScrollY: 1000, upScrollY: 900 } },
    } } as any;
  });
}
test('new default requires source-bound decisions before jobs; frozen v2 tasks retain responsive v1', async () => {
  assert.equal(CURRENT_REPLICA_WORKFLOW_VERSION, 4);
  const f = await preparationIOFixture(); try {
    const source: any = { version: 1, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: { path: 'phone.json', sha256: 'a'.repeat(64) } };
    assert.equal(validatePreparationPlan({ ...f.plan, version: 2, responsive: source }).responsive!.version, 1);
    assert.throws(() => validatePreparationPlan({ ...f.plan, version: 3, responsive: source }), /version_contract/);
    const d = decisions(); d.layouts[0].sectionKey = 'hero';
    const current = { ...f.plan, version: 3 as const, responsive: { ...source, version: 2 as const, decisions: d } };
    assert.equal(validatePreparationPlan(current).version, 3);
    const withoutVersion: any = { ...current }; delete withoutVersion.version;
    assert.throws(() => validatePreparationPlan(withoutVersion), /phone_visual_audit_required/);
    const next = { ...current, version: 4 as const, bodyBase: { ...current.bodyBase, visualAuditVersion: 3 as const }, responsive: { ...current.responsive, carouselMotionSource: source.source } };
    assert.equal(validatePreparationPlan(next).version, 4);
    const defaultNext: any = { ...next }; delete defaultNext.version;
    assert.throws(() => validatePreparationPlan(defaultNext), /body_fidelity_incomplete/);
    const missingMotion: any = structuredClone(next); delete missingMotion.responsive.carouselMotionSource;
    assert.throws(() => validatePreparationPlan(missingMotion), /phone_carousel_motion_source_required/);
    const before = preparationSharedHash(current); d.carousels[0].views[0].visibleItems = 3;
    assert.notEqual(preparationSharedHash(current), before);
    assert.throws(() => responsiveSourceSchema.parse({ ...source, version: 2 }), /version mismatch/);
    assert.throws(() => responsiveBodyPlanSchema.parse({ ...source, version: 1, decisions: decisions(), sections: [] }));
  } finally { await f.cleanup(); }
});
test('source expected values are recomputed from actual icon/text and item geometry, not copied planner counts', () => {
  verifyDecisionSources(decisions(), sourcePackets());
  for (const mutate of [
    (p: any[]) => { p[0].layouts.text.rect.y = 70; },
    (p: any[]) => { p[0].usages = {}; },
    (p: any[]) => { p[0].layouts.item2.rect.x = 400; },
    (p: any[]) => { p[0].interactions.carousel.details.visibleItems = 1; },
    (p: any[]) => { p[0].interactions.scroll.details.downY = -1000; },
  ]) { const p = sourcePackets(); mutate(p); assert.throws(() => verifyDecisionSources(decisions(), p)); }
  const loop = sourcePackets(); loop[0].interactions.carousel.itemNodeIds = ['item1', 'item3']; loop[0].interactions.carousel.cloneNodeIds = ['item2']; verifyDecisionSources(decisions(), loop);
  const override = decisions(); override.carousels[0].views.forEach(v => { v.override = { requestRef: 'user-request-17', reason: 'User explicitly requests a three-item phone row.', visibleItems: 3 }; });
  verifyDecisionSources(override, sourcePackets()); // override does not rewrite observed source fact
});
test('readonly header source decisions require matching explicit reuse scope while retaining all body decisions', () => {
  const resource = { headerId: 'header_123', sharedHash: 'a'.repeat(64), headerHash: 'b'.repeat(64), menuHash: 'c'.repeat(64), styleHash: 'd'.repeat(64) };
  const readonly: ResponsiveDecisionPlan = { ...decisions(), header: { mode: 'reuse-readonly', requestRef: 'user-body-only', reason: 'Reuse the existing shared header without modifying its source behavior.', headerId: resource.headerId, sharedHash: resource.sharedHash, evidence: [{ path: 'header.json', sha256: 'e'.repeat(64) }] } };
  const context = { version: 8, reusedHeader: resource }, packets = sourcePackets(); packets.forEach(packet => { delete packet.interactions.scroll; });
  assert.doesNotThrow(() => responsiveSourceSchema.parse({ version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: { path: 'phones.json', sha256: 'f'.repeat(64) }, decisions: readonly }));
  verifyDecisionSources(readonly, packets, context);
  assert.throws(() => verifyDecisionSources(readonly, packets), /readonly_header_scope/);
  assert.throws(() => verifyDecisionSources(readonly, packets, { ...context, version: 7 }), /readonly_header_scope/);
  assert.throws(() => verifyDecisionSources(readonly, packets, { ...context, reusedHeader: { ...resource, sharedHash: 'f'.repeat(64) } }), /readonly_header_scope/);
  assert.throws(() => verifyDecisionSources(decisions(), packets), /header_source_scroll_observation/);
  packets[0].layouts.text.rect.y = 70; assert.throws(() => verifyDecisionSources(readonly, packets, context), /layout_source_geometry/);
  packets[0].layouts.text.rect.y = 10; packets[0].interactions.carousel.details.visibleItems = 1;
  assert.throws(() => verifyDecisionSources(readonly, packets, context), /carousel_source_observation/);
});
function program() {
  return { blocks: [{ kind: 'composite', key: 'hero', children: [
    { kind: 'composite', key: 'hero_row', settings: { flex_direction_mobile: 'row' }, children: [
      { kind: 'native', widgetType: 'image', key: 'hero_icon', widgetSettings: {} }, { kind: 'native', widgetType: 'heading', key: 'hero_text', widgetSettings: {} },
    ] }, { kind: 'native-products', key: 'hero_products', widgetType: 'wd_products', widgetSettings: { slides_per_view_mobile: { size: 2, unit: 'px' } } },
  ] }] } as any;
}
test('generation rejects missing/wrong native counts and editor-fragile container rules inherited from base CSS', () => {
  const p = program(), d = decisions(), cls = native44ModuleClass('hero_row');
  assertDecisionProgram(p, d, 768, `:page .${cls}{gap:20px}`);
  p.blocks[0].children[1].widgetSettings.slides_per_view_mobile.size = 1;
  assert.throws(() => assertDecisionProgram(p, d, 768, ''), /count_plan_mismatch/);
  assert.throws(() => assertDecisionProgram(program(), { ...d, carousels: [] }, 768, ''), /count_decision_missing/);
  for (const rule of [`:page .${cls}>:first-child{width:50px}`, `:page .${cls}>:last-child{flex:1}`, `:page .e-con-inner>div:nth-child(2){width:80%}`, `:page .${cls}:is(:nth-of-type(2)){gap:20px}`]) assert.throws(() => assertDecisionProgram(program(), d, 768, rule), /unstable_container_selector/);
  assertStableContainerCSS(`@media(min-width:769px){.a>:first-child{color:red}}.a .icon-role{width:40px}`, new Set(['a']), 768);
  assert.throws(() => assertStableContainerCSS('@media(min-width:769px),(max-width:600px){.a>:first-child{color:red}}', new Set(['a']), 768), /unstable_container_selector/);
  const bad = program(); bad.blocks[0].children[0].settings.custom_css = 'selector>:last-child{width:80%}';
  assert.throws(() => assertDecisionProgram(bad, d, 768, ''), /unstable_container_selector/);
});
test('fixed is an explicit current decision, not a site-wide default; generation scopes the whole mobile header', () => {
  const mobile: any = { version: 2, mobileMaxWidth: 768, tablet: 'desktop', css: '', rows: [{ params: { mobile_height: 80 } }], scroll: decisions().header };
  const plan: any = { moduleKey: 'test', style: { fonts: [] }, layout: { mobile, rows: [] } };
  assert.match(adaptiveHeaderCSS(plan), /max-width:768px/); assert.match(adaptiveHeaderCSS(plan), /whb-main-header\{position:fixed/);
  assert.match(adaptiveHeaderCSS(plan), /height:80px/);
  assert.match(adaptiveHeaderEnvironmentCSS(plan, 'header_test'), /body.admin-bar:has\(#wpadminbar\):has\(\.whb-header_test\) #wpadminbar\{position:fixed/);
  mobile.scroll.views.forEach((v: any) => { v.policy = 'static'; });
  assert.match(adaptiveHeaderCSS(plan), /position:static/); assert.doesNotMatch(adaptiveHeaderCSS(plan), /position:fixed/);
});

test('native grids use observed columns and item geometry rather than an unused carousel field', () => {
  const d = decisions(), p = sourcePackets();
  d.carousels[0].presentation = 'grid'; d.carousels[0].nativeField = 'columns_mobile';
  d.carousels[0].views.forEach(v => { v.visibleItems = 4; v.columns = 2; });
  for (const packet of p) {
    packet.layouts.products.rect.height = 290;
    packet.layouts.item3.rect = rect(0, 300, 140, 140);
    packet.nodes.item4 = { id: 'item4', layoutId: 'item4', visible: true, parentId: 'products' };
    packet.layouts.item4 = { rect: rect(150, 300, 140, 140) };
    for (const id of ['item1', 'item2', 'item3']) packet.nodes[id].parentId = 'products';
    packet.interactions.carousel.kind = 'navigation'; packet.interactions.carousel.itemNodeIds.push('item4');
    packet.interactions.carousel.details = { presentation: 'grid', columns: 2, visibleItems: 4 };
  }
  verifyDecisionSources(d, p);
  const native = program(); native.blocks[0].children[1].widgetSettings = { layout: 'grid', columns_mobile: { unit: 'px', size: 2 } };
  assertDecisionProgram(native, d, 768, '');
  native.blocks[0].children[1].widgetSettings.columns_mobile.size = 1;
  assert.throws(() => assertDecisionProgram(native, d, 768, ''), /count_plan_mismatch/);
  p[0].layouts.item2.rect.y += 40;
  assert.throws(() => verifyDecisionSources(d, p), /grid_source_columns/);
});

test('conditional single-product disclosures require an actually hidden source owner and a native one-product query', () => {
  const d = decisions(), packets = sourcePackets();
  d.carousels[0].presentation = 'grid'; d.carousels[0].nativeField = 'columns_mobile'; d.carousels[0].conditional = true;
  d.carousels[0].views.forEach(v => { v.visibleItems = 0; v.columns = 1; });
  for (const p of packets) {
    p.nodes.products.visible = false; p.nodes.item1.visible = false; p.nodes.item1.parentId = 'products';
    p.interactions.carousel = { nodeId: 'products', kind: 'navigation', status: 'observed', itemNodeIds: ['item1'], details: { presentation: 'grid', columns: 1, visibleItems: 0 } };
  }
  verifyDecisionSources(d, packets);
  const native = program(); native.blocks[0].children[1].widgetSettings = { layout: 'grid', columns_mobile: { unit: 'px', size: 1 } }; native.blocks[0].children[1].query = { ids: [91] };
  assertDecisionProgram(native, d, 768, '');
  native.blocks[0].children[1].query.ids.push(90);
  assert.throws(() => assertDecisionProgram(native, d, 768, ''), /conditional_single_product/);
  packets[0].nodes.products.visible = true;
  assert.throws(() => verifyDecisionSources(d, packets), /hidden_contract/);
});
async function reviewFixture() {
  const identity = { taskId: 'decision-test', pageId: 91, headerId: 'header_qa', fingerprint: 'a'.repeat(64), observedAt: new Date().toISOString() };
  const files = new Map<string, Buffer>();
  const put = (name: string, value: any) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); files.set(name, bytes); return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const records: any[] = [];
  const role = (key: string, r: any) => ({ id: native44Id(identity.taskId, key), rect: r, display: 'flex', opacity: 1 });
  for (const v of views) for (const surface of ['frontend', 'editor']) {
    const image = await sharp({ create: { ...v, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg width="50" height="50"><rect width="50" height="50" fill="blue"/><path d="M10 25h30M25 10v30" stroke="white" stroke-width="4"/></svg>'), left: 10, top: 10 }]).png().toBuffer();
    const screenshot = put(`${v.width}-${surface}.png`, image);
    const header = rect(0, 0, v.width, 80), logo = rect(24, 7, 180, 60), menu = rect(v.width - 44, 24, 20, 20);
    const before = Date.parse(identity.observedAt) - 4000;
    records.push({ version: 1, kind: 'clonewp-responsive-decision-observation', ...v, clientWidth: v.width, pageId: identity.pageId, fingerprint: identity.fingerprint, observedAt: identity.observedAt, surface, screenshot,
      html: `<body class="${surface === 'editor' ? 'elementor-editor-active' : ''}"><header class="whb-${identity.headerId}"></header><main data-elementor-id="91" class="elementor-91"><div data-id="${native44Id(identity.taskId, 'hero_row')}"><div data-id="${native44Id(identity.taskId, 'hero_icon')}"><img src="icon.svg"></div><div data-id="${native44Id(identity.taskId, 'hero_text')}">Text</div></div><div data-id="${native44Id(identity.taskId, 'hero_products')}">${[0,1,2].map(i => `<div class="wd-carousel-item" data-id="repeated-product"><img src="${i}.png"></div>`).join('')}</div></main></body>`,
      layouts: [{ key: 'feature', scrollY: 0, screenshot, container: role('hero_row', rect(0, 0, 300, 150)), icon: role('hero_icon', rect(10, 10, 50, 50)), text: role('hero_text', rect(80, 10, 200, 100)) }],
      carousels: [{ componentKey: 'hero_products', scrollY: 0, screenshot, id: native44Id(identity.taskId, 'hero_products'), viewport: rect(0, 150, 290, 140), items: [0,1,2].map(index => ({ index, rect: rect(index * 150, 150, 140, 140), display: 'block', opacity: 1 })) }],
      header: { id: identity.headerId, contentTop: 80, states: ['top', 'down', 'up', 'menu-open'].map((state, i) => ({ state, scrollY: [0,1000,900,900][i], observedAt: new Date(before + i * 1000).toISOString(), browserOffset: 0, header, logo, menu, position: 'fixed', screenshot })) },
    });
  }
  const refs = () => records.map((r, i) => put(`record-${i}.json`, r));
  const read = async (r: any) => { const bytes = files.get(r.path)!; assert.equal(createHash('sha256').update(bytes).digest('hex'), r.sha256); return { filename: r.path, bytes }; };
  return { identity, records, refs, read, put };
}
test('readonly header review checks current identity, visible header and menu changes without claiming source scroll equivalence', async () => {
  const fixtureData = await reviewFixture(), resource = { headerId: 'header_123', sharedHash: 'a'.repeat(64), headerHash: 'b'.repeat(64), menuHash: 'c'.repeat(64), styleHash: 'd'.repeat(64) };
  const evidence = fixtureData.put('readonly-header.json', { reusedHeader: resource });
  const requestEvidence = fixtureData.put('readonly-request.json', { request: 'Reuse the existing header unchanged.' });
  const readonly: ResponsiveDecisionPlan = { ...decisions(), header: { mode: 'reuse-readonly', requestRef: 'user-body-only', reason: 'Keep this existing shared header untouched while reproducing the body.', headerId: resource.headerId, sharedHash: resource.sharedHash, evidence: [requestEvidence, evidence] } };
  const identity = { ...fixtureData.identity, headerId: resource.headerId, version: 4, headerProvider: 'reused-woodmart-header', reusedHeader: resource };
  for (const row of fixtureData.records) {
    row.html = row.html.replaceAll(fixtureData.identity.headerId, resource.headerId); row.header.id = resource.headerId;
    row.header.states = structuredClone(row.header.states);
    for (const state of row.header.states) {
      state.header = { ...state.header, y: state.state === 'top' ? 46 : 0 }; state.logo = { ...state.logo, y: state.header.y + 7 }; state.menu = { ...state.menu, y: state.header.y + 24 }; state.position = state.state === 'top' ? 'static' : 'fixed';
      if (state.state === 'menu-open') state.screenshot = fixtureData.put(`opened-${row.width}-${row.surface}.png`, await sharp({ create: { width: row.width, height: row.height, channels: 3, background: '#ddd' } }).png().toBuffer());
    }
  }
  const verify = () => verifyResponsiveDecisionReview(fixtureData.refs(), readonly, views, identity, fixtureData.read, '.');
  await verify();
  await assert.rejects(verifyResponsiveDecisionReview(fixtureData.refs(), readonly, views, { ...identity, headerId: 'header_456' }, fixtureData.read, '.'), /readonly_header_identity/);
  await assert.rejects(verifyResponsiveDecisionReview(fixtureData.refs(), readonly, views, fixtureData.identity, fixtureData.read, '.'), /readonly_header_scope/);
  fixtureData.records[0].layouts[0].text.rect.y = 80; await assert.rejects(verify(), /layout_roles|layout_geometry/); fixtureData.records[0].layouts[0].text.rect.y = 10;
  const opened = fixtureData.records[0].header.states[3].screenshot; fixtureData.records[0].header.states[3].screenshot = fixtureData.records[0].header.states[0].screenshot;
  await assert.rejects(verify(), /readonly_menu_change/); fixtureData.records[0].header.states[3].screenshot = opened;
  readonly.header = { mode: 'reuse-readonly', requestRef: 'user-body-only', reason: 'Keep this existing shared header untouched while reproducing the body.', headerId: resource.headerId, sharedHash: resource.sharedHash, evidence: [fixtureData.put('changed-header.json', { reusedHeader: { ...resource, menuHash: 'f'.repeat(64) } })] };
  await assert.rejects(verify(), /readonly_header_evidence/);
  readonly.header.evidence = [requestEvidence]; await assert.rejects(verify(), /readonly_header_evidence/);
});
test('acceptance derives both surfaces counts/spacing/paint and all header scroll states from bound current evidence', async () => {
  const f = await reviewFixture(), verify = () => verifyResponsiveDecisionReview(f.refs(), decisions(), views, f.identity, f.read, '.');
  await verify();
  f.records.forEach(r => { r.html = r.html.replaceAll('wd-carousel-item', 'swiper-slide'); }); await verify();
  for (const mutate of [
    (r: any[]) => { r[1].layouts[0].icon.opacity = 0; },
    (r: any[]) => { r[0].layouts[0].text.rect.y = 80; },
    (r: any[]) => { r[0].carousels[0].items[1].rect.x = 400; },
    (r: any[]) => { r[0].header.states[1].header.y = -1000; },
    (r: any[]) => { r[0].header.states[2].logo.y = 90; },
    (r: any[]) => { r[1].html = r[1].html.replace('elementor-editor-active', 'not-editor'); },
    (r: any[]) => { r[3].surface = 'frontend'; },
    (r: any[]) => { r[0].header.states[1].scrollY = 0; },
  ]) {
    const before = structuredClone(f.records); mutate(f.records); await assert.rejects(verify()); f.records.splice(0, f.records.length, ...before);
  }
  const beforeOffset = structuredClone(f.records);
  const editor = f.records[1]; editor.header.contentTop += 46;
  editor.header.states.forEach((state: any) => { state.browserOffset = 46; state.header = { ...state.header, y: 46 }; state.logo = { ...state.logo, y: state.logo.y + 46 }; state.menu = { ...state.menu, y: state.menu.y + 46 }; });
  await assert.rejects(verify(), /phantom_browser_offset/);
  f.records.splice(0, f.records.length, ...beforeOffset);
  const plain = await sharp({ create: { width: 390, height: 844, channels: 3, background: '#fff' } }).png().toBuffer();
  f.records[0].layouts[0].screenshot = f.put('invisible-icon.png', plain);
  await assert.rejects(verify(), /icon_not_painted/);
});

test('explicit native viewport scaling keeps original pixels and still rejects an unpainted icon',async()=>{
 const f=await reviewFixture();for(const r of f.records){const width=r.width-15,height=Math.round(r.height*width/r.width),old=await f.read(r.screenshot),scaled=await sharp(old.bytes).resize(width,height).jpeg().toBuffer(),screenshot=f.put(`native-${r.width}-${r.surface}.jpg`,scaled);r.clientWidth=width;r.captureMode='native-viewport-scaled';r.screenshot=screenshot;r.layouts.forEach((x:any)=>x.screenshot=screenshot);r.carousels.forEach((x:any)=>x.screenshot=screenshot);r.header.states.forEach((x:any)=>x.screenshot=screenshot);}
 const verify=()=>verifyResponsiveDecisionReview(f.refs(),decisions(),views,f.identity,f.read,'.');await verify();delete f.records[0].captureMode;await assert.rejects(verify(),/raster/);f.records[0].captureMode='native-viewport-scaled';const plain=await sharp({create:{width:375,height:812,channels:3,background:'#fff'}}).jpeg().toBuffer();f.records[0].layouts[0].screenshot=f.put('native-unpainted.jpg',plain);await assert.rejects(verify(),/icon_not_painted/);
});
test('native loop copies retain one logical model owner and cannot disguise unrelated duplicate IDs',async()=>{
 const f=await reviewFixture(),r=f.records[0],id=native44Id(f.identity.taskId,'hero_products'),content=`<div data-id="${id}" data-element_type="widget" data-widget_type="wd_products.default">${[0,1,2].map(i=>`<div class="wd-carousel-item"><img src="${i}.png"></div>`).join('')}</div>`;
 r.html=r.html.replace(new RegExp(`<div data-id="${id}">[\\s\\S]*</div></main>`),`<div data-widget_type="nested-carousel.default" data-settings='{"infinite":"yes"}'><div class="e-n-carousel swiper swiper-initialized"><div class="swiper-wrapper"><div class="swiper-slide" data-swiper-slide-index="0">${content}</div><div class="swiper-slide swiper-slide-duplicate" data-swiper-slide-index="0">${content}</div></div></div></div></main>`);
 const verify=()=>verifyResponsiveDecisionReview(f.refs(),decisions(),views,f.identity,f.read,'.');await verify();const good=r.html;r.html=good.replace('swiper-slide-duplicate" data-swiper-slide-index="0"','swiper-slide-duplicate" data-swiper-slide-index="1"');await assert.rejects(verify(),/duplicate_id/);r.html=good.replace('swiper-slide swiper-slide-duplicate','swiper-slide');await assert.rejects(verify(),/duplicate_id/);r.html=good.replace('"infinite":"yes"','"infinite":"no"');await assert.rejects(verify(),/duplicate_id/);
});
test('compact open-menu headers preserve source-hidden logo behavior only with explicit measured source evidence', async () => {
  const d = decisions(), packets = sourcePackets();
  d.header.views.forEach(v => { v.menuOpenLogo = 'hidden'; v.menuOpenHeight = 57; });
  packets.forEach(p => { p.interactions.scroll.details.menuOpenLogoVisible = false; p.interactions.scroll.details.menuOpenHeight = 57; });
  verifyDecisionSources(d, packets);
  delete packets[0].interactions.scroll.details.menuOpenLogoVisible;
  assert.throws(() => verifyDecisionSources(d, packets), /header_source_menu_layout/);
  const f = await reviewFixture();
  f.records.forEach(record => { const menu = record.header.states.find((s: any) => s.state === 'menu-open'); menu.logo = rect(0, 0, 0, 0); menu.header = rect(0, 0, record.width, 57); menu.menu = rect(record.width - 44, 20, 20, 20); });
  await verifyResponsiveDecisionReview(f.refs(), d, views, f.identity, f.read, '.');
  await assert.rejects(verifyResponsiveDecisionReview(f.refs(), decisions(), views, f.identity, f.read, '.'), /whole_header/);
});

test('grid acceptance checks real native item ownership, row counts and columns on both surfaces', async () => {
  const f = await reviewFixture(), d = decisions();
  d.carousels[0].presentation = 'grid'; d.carousels[0].nativeField = 'columns_mobile'; d.carousels[0].views.forEach(v => { v.columns = 2; v.visibleItems = 4; });
  for (const record of f.records) {
    record.html = record.html.replaceAll('wd-carousel-item', 'product-grid-item');
    const end = record.html.indexOf('</div></main>');
    record.html = record.html.slice(0, end) + '<div class="product-grid-item"><img src="four.png"></div>' + record.html.slice(end);
    record.carousels[0].viewport = rect(0, 150, 290, 290);
    record.carousels[0].items = [0, 1, 2, 3].map(index => ({ index, rect: rect((index % 2) * 150, 150 + Math.floor(index / 2) * 150, 140, 140), display: 'block', opacity: 1 }));
  }
  await verifyResponsiveDecisionReview(f.refs(), d, views, f.identity, f.read, '.');
  f.records[0].carousels[0].items[1].rect.y += 40;
  await assert.rejects(verifyResponsiveDecisionReview(f.refs(), d, views, f.identity, f.read, '.'), /grid_columns/);
});

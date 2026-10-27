import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { validateObservationPacketV2 } from '../src/replica-v2/observation.js';
import { buildPreparationJobs, preparationHash } from '../src/replica-preparation/contract.js';
import { assertPreparationSectionCSS, mergePreparationResults } from '../src/replica-preparation/merge.js';
import { BODY_FIDELITY_KINDS, PREPARATION_COMPATIBILITY_KEYS, PREPARATION_DECISION_KEYS, type PreparationPlan, type PreparationJobResult } from '../src/replica-preparation/types.js';
import { createProductionGuide } from '../src/replica-preparation/production-guide.js';
import type { BodySourceUnits } from '../src/replica-full/body-prepare.js';

const ref = (name: string) => ({ path: name, sha256: 'a'.repeat(64) });
function fixture() {
  const sourceUrl = 'https://source.example/', targetOrigin = 'https://target.example';
  const packets = [1920, 1440].map((width, i) => {
    const definitions = ['header', 'hero', 'faq'].flatMap((key, order) => [{ id: key, parentId: null, regionId: key, tag: key === 'header' ? 'HEADER' : 'SECTION', childIds: [key + '-text'], order }, { id: key + '-text', parentId: key, regionId: key, tag: 'H2', childIds: [], order }]);
    const layouts = Object.fromEntries(definitions.map((node, n) => [String(n), { id: String(n), rect: { x: 0, y: node.order * 100, width, height: 100 }, contentRect: { x: 0, y: node.order * 100, width, height: 100 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: n }]));
    return validateObservationPacketV2({ version: 2, kind: 'observation-packet', snapshot: { id: i === 0 ? 'wide' : 'narrow', url: sourceUrl, title: 'Fixture', capturedAt: '2026-10-19T00:00:00.000Z', viewport: { name: i === 0 ? 'desktop' : 'desktop-narrow', width, height: i === 0 ? 1080 : 1000, clientWidth: width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 2000, screenshot: { ...ref(i + '.png'), width, height: 2000 } }, nodes: Object.fromEntries(definitions.map(({ order: _order, ...node }, n) => [node.id, { ...node, selector: '#' + node.id, attributes: {}, styleId: 'style', layoutId: String(n), visible: true }])), regions: ['header', 'hero', 'faq'].map((id, order) => ({ id, nodeId: id, contentNodeId: id, role: id, order, gapBefore: 0 })), texts: Object.fromEntries(['header', 'hero', 'faq'].map(id => [id, { id, nodeId: id + '-text', regionId: id, text: id, kind: 'heading', level: 2, lineCount: 1 }])), styles: { style: { 'background-color': 'rgba(0, 0, 0, 0)' } }, layouts, resources: {}, usages: {}, interactions: {}, gaps: [] });
  });
  const sourceFacts = buildSourceFactsV2({ manifestPath: 'source.json', manifestSha256: 'a'.repeat(64), manifest: { version: 2, kind: 'observation-manifest', sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets, packetFiles: packets.map(packet => ({ ...ref(packet.snapshot.id + '.json'), snapshotId: packet.snapshot.id })) });
  const sourceUnits: BodySourceUnits = { version: 1, kind: 'native44-body-source-units', taskId: 'task', sourceUrl, units: packets.flatMap(packet => ['header', 'hero', 'faq'].map(key => ({ id: packet.snapshot.id + '/' + key, snapshotId: packet.snapshot.id, ownerNodeId: key, nodeIds: [key, key + '-text'], sourceFactIds: Object.values(sourceFacts.facts).filter(fact => fact.snapshotId === packet.snapshot.id && fact.regionId === key).map(fact => fact.id), componentKeys: [] }))) };
  const plan: PreparationPlan = { version: 1, kind: 'clonewp-replica-preparation', taskId: 'task', runId: 'run', title: 'Store', slug: 'store', sourceUrl, targetOrigin, sourceEvidence: ref('source.json'), sourceFacts: ref('facts.json'), sourceUnits: ref('units.json'), headerAssets: ref('header-assets.json'), bodyAssets: ref('assets.json'), bodyBase: { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'task', title: 'Store', sourceUrl, replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, editorNaming: 'native-translated-v1', reviewWorkflow: 'whole-page-after-css-v1', goalProfile: 'component-reference-v1', requirementProfile: 'source-requirements-v1', articleListPolicy: 'target-posts-v1', componentCatalog: { ...ref('catalog.json'), sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref('knowledge.json'), fingerprint: 'a'.repeat(64) }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: ref('facts.json'), componentPlan: ref('pending-plan.json'), assetsManifest: ref('assets.json'), viewports: native44ProfileViewports('desktop-browser-v1') }, headerBase: { version: 1, kind: 'clonewp-header-module', moduleKey: 'store', targetOrigin, owner: { ownerId: 'clonewp', runId: 'run' }, name: 'Store header', menus: [{ key: 'main', name: 'Store menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: ':header{color:#123}', fonts: [] } }, sourcePartition: { allUnits: sourceUnits.units.map(item => item.id), headerUnits: sourceUnits.units.filter(item => item.ownerNodeId === 'header').map(item => item.id), bodyUnits: sourceUnits.units.filter(item => item.ownerNodeId !== 'header').map(item => item.id) }, shared: { decisions: PREPARATION_DECISION_KEYS.map(key => ({ key, value: 'source-derived', evidence: [ref('source.png')] })), compatibility: PREPARATION_COMPATIBILITY_KEYS.map(key => ({ key, status: 'verified', reason: 'Current source and native contract checked.', evidence: [ref('contract.json')] })), css: ':page{color:#123}' }, sections: ['hero', 'faq'].map(key => ({ key, sourceUnitIds: sourceUnits.units.filter(unit => unit.ownerNodeId === key).map(unit => unit.id), sourceFactIds: sourceUnits.units.filter(unit => unit.ownerNodeId === key).flatMap(unit => unit.sourceFactIds), family: key === 'faq' ? 'interaction' : 'content', dependsOn: [], estimatedEffort: 5 })) };
  const jobs = buildPreparationJobs(plan), results: PreparationJobResult[] = jobs.map(job => ({ version: 1, kind: 'clonewp-preparation-result', taskId: 'task', runId: 'run', jobId: job.jobId, contractHash: job.contractHash, sharedHash: job.sharedHash, ...(job.responsibility === 'header' ? { header: structuredClone(plan.headerBase) } : { sections: job.sectionKeys.map(key => ({ key, blocks: [{ kind: 'composite', key, sourceFactIds: plan.sections.find(item => item.key === key)!.sourceFactIds, children: [{ kind: 'native', key: key + '_title', widgetType: 'heading', widgetSettings: { title: key }, sourceFactIds: packets.map(packet => packet.snapshot.id + ':text:' + key) }] }], css: ':page .' + native44ModuleClass(key) + ' h2{font-size:30px}' })) }) }));
  return { plan, jobs, results: structuredClone(results), sourceFacts, sourceUnits, merge() { return mergePreparationResults(this.plan, this.jobs, this.results, { sourceFacts: this.sourceFacts, sourceUnits: this.sourceUnits }); } };
}

test('merge orders out-of-order completions once and derives actual source mappings without changing inputs', () => {
  const f = fixture(), original = preparationHash({ plan: f.plan, sourceUnits: f.sourceUnits, results: f.results }); f.results.reverse();
  const merged = f.merge(); assert.deepEqual(merged.program.blocks.map(block => block.key), ['hero', 'faq']);
  const guide = createProductionGuide(f.sourceFacts, f.plan.sections, merged.program.blocks);
  assert.doesNotThrow(() => preparationHash(guide));
  assert.equal(guide.sections[0].relationships.rootComponentKey, 'hero');
  assert.deepEqual(merged.componentPlan.modules.map(module => module.key), ['hero', 'faq']);
  assert.ok(merged.sourceUnits.units.filter(unit => unit.ownerNodeId === 'header').every(unit => unit.componentKeys.length === 0));
  assert.deepEqual(merged.sourceUnits.units.find(unit => unit.id === 'wide/hero')?.componentKeys, ['hero', 'hero_title']);
  f.results.reverse(); assert.equal(preparationHash({ plan: f.plan, sourceUnits: f.sourceUnits, results: f.results }), original);
  assert.equal('selectionReview' in merged.componentPlan, false);
});
test('new body fidelity gate rejects partial source text coverage before any remote write', () => {
  const f = fixture(); f.plan.version = 5; f.plan.bodyBase.visualAuditVersion = 3;
  const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
  f.plan.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: ref('phones.json'), decisions: { version: 1, layouts: [], carousels: [], header: { implementation: 'native', flow: 'reserve-space', views: views.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'fixed' as const, offset: 0 })) } } };
  f.plan.sections.forEach(section => { section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: kind === 'text-layout' || kind === 'visual-boundaries' ? 'required' : 'not-applicable', sourceFactIds: [section.sourceFactIds[0]], expected: `Source ${kind} has been inspected for ${section.key}.`, evidence: [ref('source.png')] })); });
  f.jobs = buildPreparationJobs(f.plan); f.results.forEach(result => { result.contractHash = f.jobs[0].contractHash; result.sharedHash = f.jobs[0].sharedHash; });
  assert.throws(() => f.merge(), /body_fidelity_source_coverage/);
});
test('new body fidelity result must map every required check to its owned components', () => {
  const f = fixture(); f.plan.version = 5; f.plan.bodyBase.visualAuditVersion = 3;
  const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
  const headerDecision = { implementation: 'native' as const, flow: 'reserve-space' as const, views: views.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'fixed' as const, offset: 0 })) };
  f.plan.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: ref('phones.json'), decisions: { version: 1, layouts: [], carousels: [], header: headerDecision } };
  f.plan.headerBase!.layout.mobile = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, css: '', rows: [{ slot: 'general-header', params: { mobile_height: 80 }, columns: { left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [], right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'main', params: { style: 'icon', full_screen: true } }] } }], scroll: headerDecision };
  f.plan.sections.forEach(section => {
    section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: kind === 'text-layout' || kind === 'visual-boundaries' ? 'required' : 'not-applicable', sourceFactIds: section.sourceFactIds.filter(id => f.sourceFacts.facts[id]?.kind === (kind === 'text-layout' ? 'text' : 'layout')), expected: `Source ${kind} has been inspected for ${section.key}.`, evidence: [ref('source.png')] }));
    section.fidelity.forEach(check => { if (!check.sourceFactIds.length) check.sourceFactIds = [section.sourceFactIds[0]]; });
  });
  f.results[0].header = structuredClone(f.plan.headerBase);
  f.results.slice(1).forEach(result => result.sections?.forEach(section => {
    section.responsive = { key: section.key, mode: 'shared', reason: 'Same native section is used at both widths.', evidence: [{ snapshotId: 'wide', nodeId: section.key }, { snapshotId: 'narrow', nodeId: section.key }], settings: [], childOrders: [], css: '' };
    section.fidelity = f.plan.sections.find(item => item.key === section.key)!.fidelity!.filter(check => check.status === 'required').map(check => ({ kind: check.kind, componentKeys: [section.key], mechanism: 'native', implementation: `The owned ${section.key} component renders this source requirement.` }));
  }));
  f.jobs = buildPreparationJobs(f.plan); f.results.forEach(result => { result.contractHash = f.jobs[0].contractHash; result.sharedHash = f.jobs[0].sharedHash; });
  assert.deepEqual(f.merge().program.blocks.map(block => block.key), ['hero', 'faq']);
  f.results[1].sections![0].fidelity![0].componentKeys = ['foreign']; assert.throws(() => f.merge(), /body_fidelity_component_scope/);
});
test('new visual targets bind measured desktop text, geometry and paint to actual source facts', () => {
  const f = fixture(); f.plan.version = 6; f.plan.bodyBase.visualAuditVersion = 3;
  const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
  const headerDecision = { implementation: 'native' as const, flow: 'reserve-space' as const, views: views.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'fixed' as const, offset: 0 })) };
  f.plan.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: ref('phones.json'), decisions: { version: 1, layouts: [], carousels: [], header: headerDecision } };
  f.plan.headerBase!.layout.mobile = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, css: '', rows: [{ slot: 'general-header', params: { mobile_height: 80 }, columns: { left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [], right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'main', params: { style: 'icon', full_screen: true } }] } }], scroll: headerDecision };
  f.plan.sections.forEach(section => {
    section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: kind === 'text-layout' || kind === 'visual-boundaries' ? 'required' : 'not-applicable', sourceFactIds: section.sourceFactIds.filter(id => f.sourceFacts.facts[id]?.kind === (kind === 'text-layout' ? 'text' : 'layout')), expected: `Source ${kind} has been inspected for ${section.key}.`, evidence: [ref('source.png')] }));
    section.fidelity.forEach(check => { if (!check.sourceFactIds.length) check.sourceFactIds = [section.sourceFactIds[0]]; });
    section.visualTargets = f.sourceFacts.snapshots.flatMap(snapshot => {
      const facts = section.sourceFactIds.map(id => f.sourceFacts.facts[id]).filter(fact => fact.snapshotId === snapshot.id);
      const layout = facts.find(fact => fact.kind === 'layout')!, text = facts.find(fact => fact.kind === 'text')!;
      const evidence = { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 };
      return [
        { kind: 'geometry' as const, sourceFactId: layout.id, rect: layout.value.rect as { x: number; y: number; width: number; height: number }, evidence },
        { kind: 'paint' as const, sourceFactId: layout.id, property: 'background-color' as const, value: 'rgba(0, 0, 0, 0)', evidence },
        { kind: 'text-wrap' as const, sourceFactId: text.id, lineCount: 1, widthPx: (text.value.layout as { contentRect: { width: number } }).contentRect.width, evidence },
      ];
    });
  });
  f.results[0].header = structuredClone(f.plan.headerBase);
  f.results.slice(1).forEach(result => result.sections?.forEach(section => {
    section.responsive = { key: section.key, mode: 'shared', reason: 'Same native section is used at both widths.', evidence: [{ snapshotId: 'wide', nodeId: section.key }, { snapshotId: 'narrow', nodeId: section.key }], settings: [], childOrders: [], css: '' };
    section.fidelity = f.plan.sections.find(item => item.key === section.key)!.fidelity!.filter(check => check.status === 'required').map(check => ({ kind: check.kind, componentKeys: [section.key], mechanism: 'native', implementation: `The owned ${section.key} component renders this source requirement.` }));
  }));
  const refresh = () => { f.jobs = buildPreparationJobs(f.plan); f.results.forEach(result => { result.contractHash = f.jobs[0].contractHash; result.sharedHash = f.jobs[0].sharedHash; }); };
  refresh(); assert.deepEqual(f.merge().program.blocks.map(block => block.key), ['hero', 'faq']);
  const target = f.plan.sections[0].visualTargets!.find(item => item.kind === 'text-wrap')!;
  assert.equal(target.kind, 'text-wrap'); target.lineCount = 2; refresh(); assert.throws(() => f.merge(), /body_visual_target_text/);
  target.lineCount = 1;
  f.plan.sections[0].visualTargets!.splice(f.plan.sections[0].visualTargets!.findIndex(item => item.kind === 'geometry' && item.sourceFactId.startsWith('narrow:')), 1);
  refresh(); assert.throws(() => f.merge(), /body_visual_target_desktop_missing/);
});
test('merge carries a typed navigation addition separately while preserving the valid native content slot', () => {
  const f = fixture(); f.plan.sourceUrl = f.plan.bodyBase.sourceUrl = f.sourceFacts.sourceUrl = f.sourceUnits.sourceUrl = 'https://hoshiichi.com/';
  f.plan.navigationForms = [{ key: 'filter', slotComponentKey: 'hero', sourceUnitIds: f.plan.sections[0].sourceUnitIds, sourceFactIds: f.plan.sections[0].sourceFactIds, sourceEvidence: ref('form-source.json'), method: 'get', action: 'https://hoshiichi.com/all_product', fields: [{ name: 'application', label: '用途:', options: [{ label: 'すべて', value: '' }] }], submitLabel: '検索' }];
  const refresh = () => { f.jobs = buildPreparationJobs(f.plan); f.results.forEach(result => { result.contractHash = f.jobs[0].contractHash; result.sharedHash = f.jobs[0].sharedHash; }); }; refresh();
  const merged = f.merge(); assert.deepEqual(merged.navigationForms, f.plan.navigationForms); assert.equal(merged.program.blocks[0].kind, 'composite'); assert.ok(!JSON.stringify(merged.program).includes('<form'));
  f.plan.navigationForms[0].slotComponentKey = 'hero_title'; refresh(); assert.throws(() => f.merge(), /navigation_form_slot/);
});
test('missing/duplicate result, stale contract and changed scheduler ownership block assembly', () => {
  const missing = fixture(); missing.results.pop(); assert.throws(() => missing.merge(), /results_incomplete/);
  const duplicate = fixture(); duplicate.results[1] = duplicate.results[2]; assert.throws(() => duplicate.merge(), /results_incomplete/);
  const stale = fixture(); stale.results[1].sharedHash = 'b'.repeat(64); assert.throws(() => stale.merge(), /result_identity/);
  const jobs = fixture(); jobs.jobs[1].sectionKeys = ['faq']; assert.throws(() => jobs.merge(), /jobs_changed/);
});
test('body workers cannot exchange sections or insert arbitrary new component identities', () => {
  const f = fixture(); f.results[1].sections![0].key = 'faq'; assert.throws(() => f.merge(), /result_section_scope/);
  const key = fixture(); key.results[1].sections![0].blocks[0].key = 'other'; assert.throws(() => key.merge(), /section_root/);
  const child = fixture(); const root = child.results[1].sections![0].blocks[0]; assert.ok(root.kind === 'composite'); root.children[0].key = 'faq_stolen'; assert.throws(() => child.merge(), /component_key_scope/);
});
test('foreign/header facts and a missing owned fact fail exact source coverage', () => {
  const foreign = fixture(); const root = foreign.results[1].sections![0].blocks[0]; root.sourceFactIds!.push('wide:text:header'); assert.throws(() => foreign.merge(), /component_fact_scope/);
  const missing = fixture(); const own = missing.results[1].sections![0].blocks[0]; own.sourceFactIds = []; assert.throws(() => missing.merge(), /section_content_incomplete/);
  const labels = fixture(); labels.plan.sections[0].sourceFactIds.pop(); labels.jobs = buildPreparationJobs(labels.plan); labels.results.forEach(result => { result.contractHash = labels.jobs[0].contractHash; result.sharedHash = labels.jobs[0].sharedHash; }); assert.throws(() => labels.merge(), /section_facts_changed/);
});
test('header task may choose native layout/styles but cannot change allocated menu or owner identity', () => {
  const valid = fixture(); valid.results[0].header!.layout.rows[0].params = { height: 108 }; valid.results[0].header!.style.css = ':header{color:#f60}'; assert.equal(valid.merge().header!.layout.rows[0].params.height, 108);
  const invalid = fixture(); invalid.results[0].header!.menus[0].name = 'Old shared menu'; assert.throws(() => invalid.merge(), /header_identity_changed/);
  const owner = fixture(); owner.results[0].header!.owner.runId = 'old-run'; assert.throws(() => owner.merge(), /header_identity_changed/);
});
for (const settings of [{ html_tag: 'header' }, { role: 'banner' }, { css_classes: 'site-header' }, { custom_attributes: 'role|banner' }]) test('body semantic duplicate header is rejected: ' + JSON.stringify(settings), () => {
  const f = fixture(); f.results[1].sections![0].blocks[0].settings = settings; assert.throws(() => f.merge(), /embedded_header/);
});
test('header markup cannot be hidden in otherwise native content', () => {
  const f = fixture(), root = f.results[1].sections![0].blocks[0]; assert.ok(root.kind === 'composite'); const child = root.children[0]; assert.ok(child.kind === 'native'); child.widgetSettings.title = '<div role="banner">Duplicate</div>'; assert.throws(() => f.merge(), /embedded_header/);
});
test('CSS permits only the assigned module including its media overrides', () => {
  const root = native44ModuleClass('hero'); assert.doesNotThrow(() => assertPreparationSectionCSS(`@media(min-width:1400px){:page .${root} h2,:page .${root}>p{color:red}}`, 'hero'));
  for (const css of ['body{color:red}', ':page{color:red}', ':page .' + native44ModuleClass('faq') + '{color:red}', `:page .${root}~aside{color:red}`, '@import "https://source.example/style.css";', '@font-face{font-family:Hijack;src:url(https://source.example/font.woff)}']) assert.throws(() => assertPreparationSectionCSS(css, 'hero'), /replica_preparation_css_/);
});
test('partial CSS completion cannot bypass selector checks at merge', () => {
  const f = fixture(); f.results[1].sections![0].css = ':page{font-size:1px}'; assert.throws(() => f.merge(), /css_outside_section/);
  const shared = fixture(); shared.plan.shared.css = 'body{margin:0}'; shared.jobs = buildPreparationJobs(shared.plan); shared.results.forEach(result => { result.contractHash = shared.jobs[0].contractHash; result.sharedHash = shared.jobs[0].sharedHash; }); assert.throws(() => shared.merge(), /css_outside_scope/);
});
test('shared CSS cannot compete with a worker for ownership of its module selector', () => {
  const f = fixture(); f.plan.shared.css = ':page .' + native44ModuleClass('hero') + '{font-size:1px}';
  f.jobs = buildPreparationJobs(f.plan); f.results.forEach(result => { result.contractHash = f.jobs[0].contractHash; result.sharedHash = f.jobs[0].sharedHash; });
  assert.throws(() => f.merge(), /shared_css_section_conflict/);
});

function motionFixture(style: Record<string, string>, counter = false) {
  const f = fixture(); f.plan.version = 5; f.plan.bodyBase.visualAuditVersion = 3;
  const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
  const headerDecision = { implementation: 'native' as const, flow: 'reserve-space' as const, views: views.map(view => ({ ...view, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'fixed' as const, offset: 0 })) };
  f.plan.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: ref('phones.json'), decisions: { version: 1, layouts: [], carousels: [], header: headerDecision } };
  f.plan.headerBase!.layout.mobile = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, css: '', rows: [{ slot: 'general-header', params: { mobile_height: 80 }, columns: { left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [], right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'main', params: { style: 'icon', full_screen: true } }] } }], scroll: headerDecision };
  Object.assign(f.sourceFacts.facts['wide:text:hero'].value.style as Record<string, string>, style);
  if (counter) {
    const id = 'wide:interaction:counter', text = f.sourceFacts.facts['wide:text:hero'];
    f.sourceFacts.facts[id] = { ...text, id, kind: 'interaction', value: { id: 'counter', nodeId: text.nodeId, regionId: text.regionId, selector: text.value.selector, kind: 'control', status: 'observed', details: { type: 'counter' } } };
    f.sourceUnits.units.find(unit => unit.id === 'wide/hero')!.sourceFactIds.push(id);
    f.plan.sections.find(section => section.key === 'hero')!.sourceFactIds.push(id);
    f.results.find(result => result.sections?.some(section => section.key === 'hero'))!.sections!.find(section => section.key === 'hero')!.blocks[0].sourceFactIds!.push(id);
  }
  for (const section of f.plan.sections) {
    section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: kind === 'text-layout' || kind === 'visual-boundaries' || counter && kind === 'interaction' ? 'required' : 'not-applicable', sourceFactIds: section.sourceFactIds, expected: `Actual source ${kind} is retained for this owned section.`, evidence: [ref('source.png')] }));
  }
  f.results[0].header = structuredClone(f.plan.headerBase);
  for (const result of f.results) for (const section of result.sections ?? []) {
    section.responsive = { key: section.key, mode: 'shared', reason: 'Same native section is used at both widths.', evidence: [{ snapshotId: 'wide', nodeId: section.key }, { snapshotId: 'narrow', nodeId: section.key }], settings: [], childOrders: [], css: '' };
    section.fidelity = f.plan.sections.find(row => row.key === section.key)!.fidelity!.filter(check => check.status === 'required').map(check => ({ kind: check.kind, componentKeys: [section.key], mechanism: 'native', implementation: `The owned ${section.key} component renders this source requirement.` }));
  }
  f.jobs = buildPreparationJobs(f.plan); f.results.forEach(result => { result.contractHash = f.jobs[0].contractHash; result.sharedHash = f.jobs[0].sharedHash; });
  return f;
}

for (const [name, duration] of [
  ['fadeInUp', '0s'], ['fadeInUp', '0ms'], ['fadeInUp, slideIn', '0s, 0ms'],
  ['none, fadeInUp', '1s, 0s'], ['fadeInUp', '0s, 1s'],
  ['"fade,up", none', '0s, 1s'], ['none', '1s'], ['fadeInUp', ''],
  ['fadeInUp, none, slideIn', '0s, 1s'],
]) test(`zero or unused CSS animation durations do not require a motion implementation: ${name} / ${duration}`, () => {
  assert.doesNotThrow(() => motionFixture({ 'animation-name': name, 'animation-duration': duration }).merge());
});

for (const [name, duration] of [
  ['fadeInUp', '0.01s'], ['fadeInUp', '1ms'], ['fadeInUp, slideIn', '0s, 1s'],
  ['none, slideIn', '0s, 1s'], ['none, slideIn', '0.2s'],
  ['fadeInUp, none, slideIn', '1s, 0s'], ['none, none, slideIn', '1s, 0s'],
  ['"fade,up", slideIn', '0s, 1s'],
]) test(`actual nonzero CSS animation still rejects an omitted motion implementation: ${name} / ${duration}`, () => {
  assert.throws(() => motionFixture({ 'animation-name': name, 'animation-duration': duration }).merge(), /body_fidelity_motion_missing/);
});

test('an observed counter still requires motion even when text animations have zero duration', () => {
  assert.throws(() => motionFixture({ 'animation-name': 'fadeInUp', 'animation-duration': '0s' }, true).merge(), /body_fidelity_motion_missing/);
});

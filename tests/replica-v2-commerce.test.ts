import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { analyzeSourceCommerceV2 } from '../src/replica-v2/commerce.js';
import { validateObservationPacketV2, type ObservationPacketV2, type ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import { assertSourceFactsExtensionV2, buildSourceFactsV2, type SourceFactsV2 } from '../src/replica-v2/source.js';
import { validateComponentPlanV2, type ComponentPlanV2 } from '../src/replica-v2/component-plan.js';

function packet(snapshotId = 'desktop-scene', viewport = 'desktop'): ObservationPacketV2 {
  const nodes: ObservationPacketV2['nodes'] = {}, layouts: ObservationPacketV2['layouts'] = {}, styles: ObservationPacketV2['styles'] = {};
  for (const [id, parentId, tag, childIds, attributes] of [
    ['scene', null, 'section', ['campaign', 'list'], {}], ['campaign', 'scene', 'aside', [], {}], ['list', 'scene', 'div', ['one', 'two'], {}],
    ['one', 'list', 'article', ['link-one'], { class: 'product-tile-pd', 'data-pid': 'record-101' }], ['two', 'list', 'article', ['link-two'], { class: 'product-tile-pd', 'data-pid': 'record-202' }],
    ['link-one', 'one', 'a', [], { href: 'https://8.8.8.8/catalog/record-101' }], ['link-two', 'two', 'a', [], { href: 'https://8.8.8.8/catalog/record-202' }],
  ] as Array<[string, string | null, string, string[], Record<string, string>]>) {
    nodes[id] = { id, parentId, tag, childIds, attributes, regionId: 'random-owner-928', selector: `#${id}`, styleId: `s-${id}`, layoutId: `l-${id}`, visible: true };
    styles[`s-${id}`] = { display: 'block' }; layouts[`l-${id}`] = { id: `l-${id}`, rect: { x: 0, y: 0, width: 200, height: 100 }, contentRect: { x: 0, y: 0, width: 200, height: 100 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: 0 };
  }
  return { version: 2, kind: 'observation-packet', snapshot: { id: snapshotId, url: 'https://8.8.8.8/', title: 'An independently observed public storefront', capturedAt: '2026-10-15T00:00:00.000Z', viewport: { name: viewport, width: 1920, height: 1080, clientWidth: 1920, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 1080, screenshot: { path: `${snapshotId}.png`, sha256: 'a'.repeat(64), width: 1920, height: 1080 } }, nodes, regions: [{ id: 'random-owner-928', nodeId: 'scene', contentNodeId: 'list', role: 'region', order: 0, gapBefore: 20 }], texts: { campaign: { id: 'campaign', nodeId: 'campaign', regionId: 'random-owner-928', text: 'Save $10 on selected brand campaign purchases', kind: 'body' }, one: { id: 'one', nodeId: 'link-one', regionId: 'random-owner-928', text: 'First actual catalog record without any price', kind: 'body' }, two: { id: 'two', nodeId: 'link-two', regionId: 'random-owner-928', text: 'Second actual catalog record without any price', kind: 'body' } }, resources: {}, usages: {}, interactions: {}, styles, layouts, gaps: [], commerceEvidence: { version: 1, productUrls: [] } };
}
function source(packets = [packet()]): SourceFactsV2 {
  const observation: ValidatedObservationV2 = { manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'https://8.8.8.8/', provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, manifestPath: 'D:/cloneWP/references/commerce-test/observation-manifest.json', manifestSha256: 'b'.repeat(64), packets: packets.map(validateObservationPacketV2), packetFiles: packets.map((packet, index) => ({ path: `D:/cloneWP/references/commerce-test/packet-${index}.json`, sha256: 'c'.repeat(64), snapshotId: packet.snapshot.id })) };
  return buildSourceFactsV2(observation);
}
function plan(facts = source()): ComponentPlanV2 {
  const common = { sourceRegionIds: ['random-owner-928'], variants: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['scene'], visible: true })) };
  return { version: 2, kind: 'component-plan', sourceFacts: { path: 'D:/cloneWP/references/commerce-test/source-facts.json', sha256: 'd'.repeat(64) }, desktopSnapshotId: 'desktop-scene', components: [
    { ...common, id: 'scene', parentId: null, role: 'region', renderer: 'composite', editability: 'mixed' },
    { ...common, variants: common.variants.map(variant => ({ ...variant, nodeIds: ['list'] })), id: 'records', parentId: 'scene', role: 'catalog', renderer: 'products', editability: 'woocommerce' },
    { ...common, variants: common.variants.map(variant => ({ ...variant, nodeIds: ['campaign'] })), id: 'campaign', parentId: 'scene', role: 'campaign', renderer: 'html', editability: 'code' },
  ], requirements: Object.values(facts.facts).map((fact, index) => ({ id: `requirement-${index}`, factIds: [fact.id], componentId: fact.nodeId === 'campaign' ? 'campaign' : ['link-one', 'link-two'].includes(fact.nodeId) ? 'records' : 'scene', disposition: 'preserve', rule: 'Bind the actual source-owned responsibility', verification: { kind: fact.kind === 'text' ? 'text' : 'presence', selector: `#target-${fact.nodeId}`, snapshotId: fact.snapshotId, ...(fact.kind === 'text' ? { expected: { text: fact.value.text, visible: fact.value.visible } } : { expected: true }) } })) };
}

test('source commerce evidence identifies repeated catalog records without prices and keeps campaign ownership separate', () => {
  const facts = source(), groups = facts.sourceCommerce![0].groups;
  assert.equal(groups.length, 1); assert.equal(groups[0].status, 'catalog'); assert.equal(groups[0].ownerNodeId, 'list'); assert.deepEqual(groups[0].cardNodeIds, ['one', 'two']);
  assert.ok(groups[0].signals.some(signal => signal.kind === 'product-id')); assert.ok(groups[0].signals.some(signal => signal.kind === 'commerce-component')); assert.equal(facts.gaps.length, 0);
  assert.doesNotThrow(() => validateComponentPlanV2(plan(facts), facts, { stage: 'desktop' }));
  const renamed = packet(); renamed.regions[0].id = 'unrelated-layout-id'; Object.values(renamed.nodes).forEach(node => { node.regionId = renamed.regions[0].id; }); Object.values(renamed.texts).forEach(text => { text.regionId = renamed.regions[0].id; });
  assert.equal(analyzeSourceCommerceV2(renamed)[0].status, 'catalog');
});

test('a manually renamed marketing role cannot authorize static HTML or relabelled product facts', () => {
  const facts = source(), attempted = plan(facts); attempted.components[1].renderer = 'html'; attempted.components[1].editability = 'code'; attempted.components[1].role = 'marketing-campaign';
  assert.throws(() => validateComponentPlanV2(attempted, facts), /native-products/);
  const overlapping = plan(facts); overlapping.components[2].variants[0].nodeIds = ['scene']; assert.throws(() => validateComponentPlanV2(overlapping, facts), /Static HTML.*overlaps/);
  const relabelled = plan(facts); relabelled.requirements.find(requirement => requirement.factIds[0] === 'desktop-scene:text:one')!.componentId = 'campaign'; assert.throws(() => validateComponentPlanV2(relabelled, facts), /actual native-products query/);
  const unrelatedQuery = plan(facts); unrelatedQuery.components[1].variants[0].nodeIds = ['campaign']; assert.throws(() => validateComponentPlanV2(unrelatedQuery, facts), /actual repeated product subtree/);
});

test('responsive commerce uses explicit snapshot owners when the same desktop node number now contains the product branch', () => {
  const rename = (value: ObservationPacketV2, names: Record<string,string>) => {
    value.nodes = Object.fromEntries(Object.values(value.nodes).map(node => { const next = { ...node, id:names[node.id], parentId:node.parentId ? names[node.parentId] : null, childIds:node.childIds.map(id=>names[id]) }; return [next.id,next]; }));
    for(const region of value.regions){region.nodeId=names[region.nodeId];region.contentNodeId=names[region.contentNodeId];}
    for(const text of Object.values(value.texts))text.nodeId=names[text.nodeId];
    return value;
  };
  const desktopNames={scene:'n1',campaign:'n2',list:'n3',one:'n4',two:'n5','link-one':'n6','link-two':'n7'},tabletNames={scene:'n2',campaign:'n20',list:'n30',one:'n40',two:'n50','link-one':'n60','link-two':'n70'},mobileNames={scene:'n2',campaign:'n200',list:'n300',one:'n400',two:'n500','link-one':'n600','link-two':'n700'};
  const facts=source([rename(packet(),desktopNames),rename(packet('tablet-scene','tablet'),tabletNames),rename(packet('mobile-scene','mobile'),mobileNames)]),value=plan(facts),bySnapshot:Record<string,typeof desktopNames>={'desktop-scene':desktopNames,'tablet-scene':tabletNames,'mobile-scene':mobileNames};
  for(const component of value.components){const role=component.id==='scene'?'scene':component.id==='records'?'list':'campaign';component.sourceNodeIds=[desktopNames[role]];for(const variant of component.variants)variant.nodeIds=[bySnapshot[variant.snapshotId][role]];}
  for(const requirement of value.requirements){const fact=facts.facts[requirement.factIds[0]],names=bySnapshot[fact.snapshotId];requirement.componentId=fact.nodeId===names.campaign?'campaign':[names['link-one'],names['link-two']].includes(fact.nodeId)?'records':'scene';}
  assert.equal(facts.snapshots[1].nodes.n2.parentId,null);assert.deepEqual(value.components[2].sourceNodeIds,['n2']);assert.deepEqual(value.components[2].variants[1].nodeIds,['n20']);
  assert.doesNotThrow(()=>validateComponentPlanV2(value,facts,{stage:'responsive'}));assert.doesNotThrow(()=>validateComponentPlanV2(value,facts,{stage:'final'}));
  const actualOverlap=structuredClone(value);actualOverlap.components[2].variants[1].nodeIds=['n2'];assert.throws(()=>validateComponentPlanV2(actualOverlap,facts,{stage:'responsive'}),/Static HTML.*overlaps/);
});

test('coincident desktop product IDs cannot authorize an unrelated responsive variant or replace its explicit owner', () => {
  const facts=source([packet(),packet('tablet-scene','tablet'),packet('mobile-scene','mobile')]),value=plan(facts),products=value.components[1];products.sourceNodeIds=['list'];products.variants.find(variant=>variant.snapshotId==='tablet-scene')!.nodeIds=['campaign'];
  assert.doesNotThrow(()=>validateComponentPlanV2(value,facts,{stage:'desktop'}));
  assert.throws(()=>validateComponentPlanV2(value,facts,{stage:'responsive'}),/requires one native-products.*actual repeated product subtree/);
  products.variants.find(variant=>variant.snapshotId==='tablet-scene')!.nodeIds=['list'];assert.doesNotThrow(()=>validateComponentPlanV2(value,facts,{stage:'responsive'}));
  const historicalDesktop=structuredClone(value);historicalDesktop.components[1].variants.find(variant=>variant.snapshotId==='desktop-scene')!.nodeIds=['campaign'];assert.doesNotThrow(()=>validateComponentPlanV2(historicalDesktop,facts,{stage:'desktop'}));
});

test('priced marketing cards and a commerce carousel class do not establish catalog identity', () => {
  const value = packet(); value.nodes.scene.attributes.class = 'experience-commerce_layouts-productCarousel';
  for (const id of ['one', 'two']) value.nodes[id].attributes = {};
  value.texts.one.text = 'Save $20 when you shop Brand One'; value.texts.two.text = '$15 off your favorite Brand Two';
  assert.deepEqual(analyzeSourceCommerceV2(value), []); assert.equal(source([value]).gaps.length, 0);
  delete value.commerceEvidence; const historical = source([value]); assert.equal(Object.hasOwn(historical, 'sourceCommerce'), false);
});

test('typed Product URL relationships and repeated cards prove catalog ownership without visible prices or record IDs', () => {
  const value = packet(); for (const id of ['one', 'two']) delete value.nodes[id].attributes['data-pid'];
  value.commerceEvidence!.productUrls = ['https://8.8.8.8/catalog/record-101', 'https://8.8.8.8/catalog/record-202'];
  assert.equal(analyzeSourceCommerceV2(value)[0].status, 'catalog');
  const sameDestination = structuredClone(value); sameDestination.nodes['link-two'].attributes.href = sameDestination.nodes['link-one'].attributes.href; assert.equal(analyzeSourceCommerceV2(sameDestination)[0].status, 'uncertain');
  const duplicateRecord = packet(); duplicateRecord.nodes.two.attributes['data-pid'] = duplicateRecord.nodes.one.attributes['data-pid']; assert.equal(analyzeSourceCommerceV2(duplicateRecord)[0].status, 'uncertain');
  const schemas = packet(); for (const id of ['one', 'two']) schemas.nodes[id].attributes = { itemtype: 'https://schema.org/Product' }; assert.equal(analyzeSourceCommerceV2(schemas)[0].status, 'catalog');
  const cloned = packet(); cloned.nodes.clone = { ...cloned.nodes.one, id: 'clone', childIds: [], attributes: { ...cloned.nodes.one.attributes, class: 'product-tile-pd slick-cloned' } }; cloned.nodes.list.childIds.push('clone'); assert.deepEqual(analyzeSourceCommerceV2(cloned)[0].cardNodeIds, ['one', 'two']);
});

test('incomplete commerce identity remains a staged unadaptable evidence gap and immutable source fact', () => {
  const desktop = packet(), tablet = packet('tablet-scene', 'tablet'), mobile = packet('mobile-scene', 'mobile');
  for (const id of ['one', 'two']) delete mobile.nodes[id].attributes['data-pid'];
  const facts = source([desktop, tablet, mobile]), value = plan(facts); assert.equal(facts.sourceCommerce![2].groups[0].status, 'uncertain');
  assert.doesNotThrow(() => validateComponentPlanV2(value, facts, { stage: 'desktop' })); assert.throws(() => validateComponentPlanV2(value, facts, { stage: 'responsive' }), /source-commerce-role-unproven.*unresolved/);
  value.gapResolutions = [{ snapshotId: 'mobile-scene', code: 'source-commerce-role-unproven', nodeId: 'list', componentId: 'records', requirementId: value.requirements[0].id, rule: 'Pretend these are marketing cards' }]; assert.throws(() => validateComponentPlanV2(value, facts), /cannot be adapted/);
  const edited = structuredClone(facts); edited.sourceCommerce![0].groups[0].reason = 'Author reclassified these cards'; assert.throws(() => assertSourceFactsExtensionV2(facts, edited), /previously captured commerce evidence/);
});

test('actual collector retains safe commerce attributes and Product URLs while excluding form values and arbitrary JSON-LD', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent('<!doctype html><html><head><title>Public catalog test</title><script type="application/ld+json">{"@graph":[{"@type":"Product","url":"https://8.8.8.8/detail/one","secret":"never-export-jsonld"}]}</script></head><body><section id="region"><div class="list"><article class="product-tile-pd" data-pid="one"><a href="https://8.8.8.8/detail/one">Actual first catalog item without visible price</a><form action="https://8.8.8.8/Cart-AddProduct?nonce=never-export-query"><input value="never-export-value" name="nonce"></form></article><article class="product-tile-pd" data-pid="two"><a href="https://8.8.8.8/detail/two">Actual second catalog item without price</a></article></div></section></body></html>');
    const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8'); const raw = await page.evaluate(`${collector};collectObservationV2({snapshotId:'catalog-live',regions:[{id:'arbitrary-root',selector:'#region'}]})`) as string;
    assert.doesNotMatch(raw, /never-export/); const transport = JSON.parse(raw), actual = validateObservationPacketV2(JSON.parse(transport.chunks[0].json));
    assert.deepEqual(actual.commerceEvidence!.productUrls, ['https://8.8.8.8/detail/one']); assert.ok(Object.values(actual.nodes).some(node => node.attributes['data-pid'] === 'two'));
    const groups = analyzeSourceCommerceV2(actual); assert.equal(groups.length, 1); assert.equal(groups[0].status, 'catalog'); assert.equal(groups[0].cardNodeIds.length, 2);
  } finally { await browser.close(); }
});

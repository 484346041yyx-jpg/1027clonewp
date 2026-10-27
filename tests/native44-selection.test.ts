import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSourceFactsV2, type SourceFactsV2 } from '../src/replica-v2/source.js';
import type { ObservationPacketV2, ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import { ComponentPlanV2Schema, validateComponentPlanV2, type ComponentPlanV2 } from '../src/replica-v2/component-plan.js';
import { validateDesktopComponentPlan, validateNative44Selection, NATIVE44_SELECTION_RULES_HASH, native44SelectionHash, native44RegisteredSchemaHash } from '../src/native44/selection.js';
import type { Native44Program, Native44Component } from '../src/native44/types.js';
import type { Native44SourceUnit, Native44SelectionDecision } from '../src/native44/selection-types.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { loadNative44Knowledge } from '../src/native44/knowledge.js';
import { assertNative44SourceBindings } from '../src/native44/source-bindings.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import { assertNative44CatalogOmissionScope } from '../src/native44/selection-rules.js';

const ref = { path: 'D:/cloneWP/.cache/selection-fixture/source.json', sha256: 'a'.repeat(64) };
const schemaHash = (schema: unknown) => createHash('sha256').update(JSON.stringify(schema)).digest('hex');
function packet(snapshotId: string, width: number, height: number): ObservationPacketV2 {
  const layouts: ObservationPacketV2['layouts'] = {}, nodes: ObservationPacketV2['nodes'] = {};
  const descriptions: Array<[string, string, string | null, string[]]> = [['root', 'footer', null, ['body', 'nav']], ['body', 'p', 'root', []], ['nav', 'ul', 'root', ['item-a', 'item-b']], ['item-a', 'li', 'nav', ['a']], ['item-b', 'li', 'nav', ['b']], ['a', 'a', 'item-a', []], ['b', 'a', 'item-b', []]];
  for (const [id, tag, parentId, childIds] of descriptions) {
    nodes[id] = { id, tag, parentId, childIds, regionId: 'region', selector: `#${id}`, attributes: {}, styleId: 'style', layoutId: id, visible: true };
    layouts[id] = { id, rect: { x: 0, y: 0, width: 300, height: 30 }, contentRect: { x: 0, y: 0, width: 300, height: 30 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: '1440px', direction: 'row', flowIndex: 0 };
  }
  return { version: 2, kind: 'observation-packet', snapshot: { id: snapshotId, url: 'https://source.example/', title: 'Normal public page with independently observed desktop content', capturedAt: '2026-10-16T00:00:00.000Z', viewport: { name: snapshotId === 'wide' ? 'desktop' : 'desktop-narrow', width, height, clientWidth: width - 15, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: height, screenshot: { path: `D:/cloneWP/.cache/selection-fixture/${snapshotId}.png`, sha256: 'b'.repeat(64), width, height } }, nodes, layouts, styles: { style: {} }, regions: [{ id: 'region', nodeId: 'root', contentNodeId: 'root', role: 'footer', order: 0, gapBefore: 0 }], texts: { body: { id: 'body', nodeId: 'body', regionId: 'region', kind: 'body', text: 'Create an account for deals and more.' }, a: { id: 'a', nodeId: 'a', regionId: 'region', kind: 'label', text: 'Dog' }, b: { id: 'b', nodeId: 'b', regionId: 'region', kind: 'label', text: 'Cat' } }, resources: {}, usages: {}, interactions: { a: { id: 'a', nodeId: 'a', regionId: 'region', kind: 'link', status: 'observed', href: 'https://source.example/dog/', details: {} }, b: { id: 'b', nodeId: 'b', regionId: 'region', kind: 'link', status: 'observed', href: 'https://source.example/cat/', details: {} } }, gaps: [] };
}
function fixture(): { facts: SourceFactsV2; plan: ComponentPlanV2; program: Native44Program } {
  const packets = [packet('wide', 1920, 1080), packet('narrow', 1440, 1000)];
  const observation: ValidatedObservationV2 = { manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'https://source.example/', provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, manifestPath: ref.path, manifestSha256: ref.sha256, packets, packetFiles: packets.map(item => ({ ...ref, snapshotId: item.snapshot.id })) };
  const facts = buildSourceFactsV2(observation), units: Native44SourceUnit[] = [], decisions: Native44SelectionDecision[] = [];
  const localContracts = (types: string[]) => types.map(widgetType => ({ widgetType, scope: 'local-source' as const, schemaSha256: ref.sha256, evidence: ref }));
  for (const snapshot of facts.snapshots) {
    const screenshot = { snapshotId: snapshot.id, screenshot: { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 } };
    const scoped = Object.values(facts.facts).filter(fact => fact.snapshotId === snapshot.id);
    const unit = (id: string, ownerNodeId: string, role: Native44SourceUnit['role'], ids: string[], slots: Native44SourceUnit['slots'], repeatedItems?: Native44SourceUnit['repeatedItems']): Native44SourceUnit => ({ id: `${snapshot.id}-${id}`, snapshotId: snapshot.id, regionId: 'region', ownerNodeId, role, sourceFactIds: ids, slots, evidence: { factIds: ids, screenshots: [screenshot], rationale: 'Source pixels and DOM common ownership identify this content responsibility.' }, ...(repeatedItems ? { repeatedItems } : {}) });
    const root = unit('root', 'root', 'layout', scoped.filter(fact => ['region', 'layout'].includes(fact.kind)).map(fact => fact.id), []);
    const bodyId = `${snapshot.id}:text:body`, body = unit('body', 'body', 'description', [bodyId], [{ id: 'body', kind: 'text', factIds: [bodyId], required: true }]);
    const navFacts = scoped.filter(fact => ['text', 'interaction'].includes(fact.kind) && fact.nodeId !== 'body');
    const nav = unit('nav', 'nav', 'navigation-list', navFacts.map(fact => fact.id), navFacts.map(fact => ({ id: `${fact.kind}-${fact.nodeId}`, kind: fact.kind === 'text' ? 'text' : 'link', factIds: [fact.id], required: true })), ['a', 'b'].map(key => ({ id: key, ownerNodeId: `item-${key}`, slotIds: [`text-${key}`, `interaction-${key}`] })));
    units.push(root, body, nav);
    const decision = (unit: Native44SourceUnit, componentKey: string, type: string, bindings: Native44SelectionDecision['slotBindings']): Native44SelectionDecision => ({ unitId: unit.id, componentKeys: [componentKey], candidates: [{ widgetTypes: [type], conclusion: 'selected', reason: 'This native content model preserves the actual source content responsibility.', evidence: [ref] }], reason: 'The native component preserves independent editing and the source ownership.', slotBindings: bindings, contractRefs: localContracts([type]) });
    decisions.push(decision(root, 'root', 'container', []), decision(body, 'body', 'text-editor', [{ slotId: 'body', componentKey: 'body', settingPath: 'widgetSettings.editor' }]), decision(nav, 'nav', 'wd_list', ['a', 'b'].flatMap((key, index) => [{ slotId: `text-${key}`, componentKey: 'nav', settingPath: `widgetSettings.list_items.${index}.list_content` }, { slotId: `interaction-${key}`, componentKey: 'nav', settingPath: `widgetSettings.list_items.${index}.link` }])));
  }
  const plan: ComponentPlanV2 = { version: 2, kind: 'component-plan', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, sourceFacts: ref, desktopSnapshotId: 'wide', components: [{ id: 'root', parentId: null, role: 'footer', renderer: 'composite', editability: 'mixed', sourceRegionIds: ['region'], variants: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['root'], visible: true })) }], requirements: Object.values(facts.facts).map((fact, index) => ({ id: `req-${index}`, factIds: [fact.id], componentId: 'root', disposition: 'preserve', rule: 'Preserve actual source contents, owner and independently observed geometry.', verification: { kind: fact.kind === 'text' ? 'text' : 'presence', selector: '.source-module', snapshotId: fact.snapshotId, ...(fact.kind === 'text' ? { expected: { text: fact.value.text, visible: fact.value.visible } } : {}) } })), sourceUnits: units, selectionDecisions: decisions, selectionReview: { reviewer: 'codex', status: 'approved', reviewedAt: '2026-10-16T00:00:00.000Z', sourceFacts: ref, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, decisionsSha256: native44SelectionHash({ sourceUnits: units, selectionDecisions: decisions }), screenshots: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, screenshot: { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 } })), reviewedUnitIds: units.map(unit => unit.id), checks: { moduleOrder: true, contentOwnership: true, componentSuitability: true, editingGranularity: true }, judgment: 'The complete desktop page keeps module order and content ownership with appropriate native editing units.' } };
  const blocks: Native44Component[] = [{ kind: 'composite', key: 'root', children: [{ kind: 'native', key: 'body', widgetType: 'text-editor', widgetSettings: { editor: '<p>Create an account for deals and more.</p>' } }, { kind: 'native', key: 'nav', widgetType: 'wd_list', widgetSettings: { list_items: [{ _id: 'a', list_content: 'Dog', link: { url: 'https://source.example/dog/' } }, { _id: 'b', list_content: 'Cat', link: { url: 'https://source.example/cat/' } }] } }] }];
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: 'selection-fixture', title: 'Selection fixture', sourceUrl: facts.sourceUrl, componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: ref.sha256 }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' }, { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' }], blocks };
  return { facts, plan, program };
}
function reapprove(plan: ComponentPlanV2) { plan.selectionReview!.decisionsSha256 = native44SelectionHash({ sourceUnits: plan.sourceUnits, selectionDecisions: plan.selectionDecisions }); }
function replaceType(program: Native44Program, plan: ComponentPlanV2, key: string, type: string) {
  const node = (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children.find(node => node.key === key)! as Extract<Native44Component, { kind: 'native' }>;
  node.widgetType = type;
  for (const decision of plan.selectionDecisions!.filter(decision => decision.componentKeys.includes(key))) { decision.candidates[0].widgetTypes = [type]; decision.contractRefs[0].widgetType = type; }
  reapprove(plan);
}
function articleFixture(){
  const value=fixture(),{program,plan}=value;program.articleListPolicy='target-posts-v1';
  (program.blocks[0] as Extract<Native44Component,{kind:'composite'}>).children[1]={kind:'native-posts',key:'nav',widgetType:'wd_blog',widgetSettings:{},query:{itemsPerPage:2,orderby:'date',order:'desc',evidence:['article-list-policy.json']}};
  for(const unit of plan.sourceUnits!.filter(unit=>unit.role==='navigation-list')){
    unit.role='data-query';unit.evidence.rationale='The observed repeated article cards contain individual titles and article destinations.';
    const decision=plan.selectionDecisions!.find(item=>item.unitId===unit.id)!;decision.candidates[0].widgetTypes=['wd_blog'];decision.contractRefs[0].widgetType='wd_blog';decision.slotBindings.forEach(binding=>binding.settingPath='query');
    for(const requirement of plan.requirements.filter(item=>item.factIds.some(id=>unit.sourceFactIds.includes(id)))){requirement.disposition='adapt';requirement.rule='Use real latest published target articles only in the repeated article body.';}
  }
  reapprove(plan);return value;
}
test('article-list substitution maps repeated text and links to one dynamic native blog query while adjacent copy stays exact',()=>{
  const{program,plan,facts}=articleFixture();assert.doesNotThrow(()=>validateNative44Selection(program,plan,facts));
  const changed=structuredClone(program);((changed.blocks[0] as Extract<Native44Component,{kind:'composite'}>).children[0] as any).widgetSettings.editor='Changed adjacent copy';assert.throws(()=>validateNative44Selection(changed,plan,facts),/preserved text binding differs/);
});
test('a blog query cannot waive preserved source copy, the article policy, repeated ownership or static headings',()=>{
  for(const variant of ['preserve','policy','outside-item','static-role']as const){
    const{program,plan,facts}=articleFixture(),unit=plan.sourceUnits!.find(item=>item.role==='data-query')!;
    if(variant==='preserve')plan.requirements.find(item=>item.factIds.includes(unit.slots[0].factIds[0]))!.disposition='preserve';
    if(variant==='policy')delete program.articleListPolicy;
    if(variant==='outside-item')unit.repeatedItems!.forEach(item=>item.slotIds=item.slotIds.filter(id=>id!==unit.slots[0].id));
    if(variant==='static-role')unit.role='heading';
    reapprove(plan);assert.throws(()=>validateNative44Selection(program,plan,facts),/article|post|navigation-list/);
  }
});
function deferredFixture() {
  const value = fixture(), { facts, plan, program } = value;
  facts.sourceCommerce = facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, evidence: snapshot.evidence[0], groups: [{ id: 'catalog', regionId: 'region', ownerNodeId: 'nav', cardNodeIds: ['item-a','item-b'], status: 'catalog' as const, signals: [{nodeId:'a',kind:'product-destination' as const,value:'https://source.example/dog/'}], reason: 'Independently observed fixture catalog records with actual owners.' }] }));
  plan.catalogDeferrals = facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, groupId: 'catalog', componentId: 'nav', reason: 'User explicitly requested this entire product area be left empty.', userRequestedOmission: 'leave-product-area-empty' as const, scope: ref }));
  plan.components.push({ id:'nav', parentId:'root', role:'Deferred catalog placeholder', renderer:'composite', editability:'controls', sourceRegionIds:['region'], variants:facts.snapshots.map(snapshot=>({snapshotId:snapshot.id,nodeIds:['nav'],visible:true})) }, {id:'label',parentId:'nav',role:'Placeholder',renderer:'native',editability:'controls',sourceRegionIds:['region'],variants:facts.snapshots.map(snapshot=>({snapshotId:snapshot.id,nodeIds:['nav'],visible:true}))});
  (program.blocks[0] as Extract<Native44Component,{kind:'composite'}>).children[1]={kind:'composite',key:'nav',children:[{kind:'native',key:'label',widgetType:'text-editor',widgetSettings:{editor:'<p>Products configured by the user later.</p>'}}]};
  for(const unit of plan.sourceUnits!.filter(unit=>unit.role==='navigation-list')) {
    unit.role='deferred-query'; unit.slots.forEach(slot=>slot.required=false);
    const decision=plan.selectionDecisions!.find(item=>item.unitId===unit.id)!;
    decision.componentKeys=['nav','label']; decision.candidates[0].widgetTypes=['container','text-editor']; decision.slotBindings=[];
    decision.contractRefs=['container','text-editor'].map(widgetType=>({widgetType,scope:'local-source',schemaSha256:ref.sha256,evidence:ref}));
    for(const id of unit.sourceFactIds){const requirement=plan.requirements.find(item=>item.factIds.includes(id))!;requirement.componentId='nav';requirement.disposition='adapt';requirement.verification={kind:'presence',selector:'.placeholder',snapshotId:unit.snapshotId,expected:{visible:false,deferredCatalog:'catalog'}};}
  }
  reapprove(plan); return value;
}
test('explicit catalog deferral preserves facts and requires an actual structural placeholder rather than a fake query',()=>{
  const {facts,plan,program}=deferredFixture();
  assert.doesNotThrow(()=>validateDesktopComponentPlan(plan,facts));
  assert.doesNotThrow(()=>validateNative44Selection(program,plan,facts));
  const missing=structuredClone(plan);delete missing.catalogDeferrals;
  assert.throws(()=>validateDesktopComponentPlan(missing,facts),/requires one native-products/);
  const staticPrice=structuredClone(plan);const requirement=staticPrice.requirements.find(item=>item.componentId==='nav')!;requirement.verification.expected={visible:true,deferredCatalog:'catalog'};
  assert.throws(()=>validateDesktopComponentPlan(staticPrice,facts),/must remain explicit/);
  const wrong=structuredClone(plan);wrong.catalogDeferrals![0].componentId='root';assert.throws(()=>validateDesktopComponentPlan(wrong,facts),/actual catalog owner/);
  const fake=structuredClone(program);(fake.blocks[0] as Extract<Native44Component,{kind:'composite'}>).children[1]={kind:'composite',key:'nav',children:[{kind:'native',key:'label',widgetType:'image-box',widgetSettings:{title:'Fake product',description_text:'$19'}}]};
  assert.throws(()=>validateNative44Selection(fake,plan,facts),/structural placeholder/);
});
test('later product selection and category mismatch cannot authorize an empty native product area', () => {
  const { facts, plan, program } = deferredFixture();
  for (const item of plan.catalogDeferrals!) {
    delete item.userRequestedOmission;
    item.reason = '商品不用管，后面我自己弄；the target catalog contains a different category.';
  }
  // Decode the immutable old shape for historical inspection, without adding
  // a new omission decision or changing any old program/lock bytes.
  const decoded = ComponentPlanV2Schema.parse(plan);
  assert.equal(decoded.catalogDeferrals![0].userRequestedOmission, undefined);
  assert.throws(() => validateDesktopComponentPlan(decoded, facts), /whole product area/);
  assert.throws(() => validateNative44Selection(program, decoded, facts), /whole product area/);
});
test('catalog omission scope is bound to explicit whole-area user wording and the exact task and group', () => {
  const item = { snapshotId: 'wide', groupId: 'catalog', componentId: 'products', userRequestedOmission: 'leave-product-area-empty' as const };
  const omission = { ...item, action: item.userRequestedOmission, userInstruction: '请把这个商品区整个留空。' };
  const scope = { version: 2, kind: 'clonewp-task-scope', taskId: 'task', summary: 'User explicitly left this entire product area empty.', constraints: ['Owned draft only.'], catalogAreaOmissions: [omission] };
  assert.doesNotThrow(() => assertNative44CatalogOmissionScope(scope, 'task', item));
  const historical = { version: 1, kind: 'clonewp-task-scope', taskId: 'task', summary: '商品不用管，后面我自己弄', constraints: ['products-deferred-to-user'] };
  assert.throws(() => assertNative44CatalogOmissionScope(historical, 'task', item), /scope v2/);
  for (const changed of [
    { ...scope, taskId: 'other-task' },
    { ...scope, catalogAreaOmissions: [{ ...omission, groupId: 'different-catalog' }] },
    { ...scope, catalogAreaOmissions: [{ ...omission, action: 'configure-items-later' }] },
    { ...scope, catalogAreaOmissions: [{ ...omission, userInstruction: '' }] },
    { ...scope, catalogAreaOmissions: [omission, omission] },
  ]) assert.throws(() => assertNative44CatalogOmissionScope(changed, 'task', item), /Catalog deferral/);
});
function paragraphsFixture(separateUnits = false) {
  const value = fixture(), { facts, plan, program } = value, secondText = 'The second paragraph keeps its own source wording.';
  for (const snapshot of facts.snapshots) {
    snapshot.nodes['body-second'] = { ...snapshot.nodes.body, selector: '#body-second' };
    snapshot.nodes.root.childIds.splice(1, 0, 'body-second');
    const factId = `${snapshot.id}:text:body-second`, original = facts.facts[`${snapshot.id}:text:body`];
    facts.facts[factId] = { ...original, id: factId, nodeId: 'body-second', value: { ...original.value, id: 'body-second', nodeId: 'body-second', selector: '#body-second', text: secondText } };
    const requirement = plan.requirements.find(requirement => requirement.factIds.includes(original.id))!;
    requirement.componentId = 'body';
    plan.requirements.push({ ...requirement, id: `requirement-${snapshot.id}-second`, factIds: [factId], verification: { ...requirement.verification, expected: { text: secondText, visible: true } } });
    const unit = plan.sourceUnits!.find(unit => unit.id === `${snapshot.id}-body`)!, decision = plan.selectionDecisions!.find(decision => decision.unitId === unit.id)!;
    if (separateUnits) {
      const second = structuredClone(unit); second.id = `${unit.id}-second`; second.ownerNodeId = 'body-second'; second.sourceFactIds = [factId]; second.evidence.factIds = [factId]; second.slots = [{ id: 'second', kind: 'text', factIds: [factId], required: true }];
      plan.sourceUnits!.push(second);
      const secondDecision = structuredClone(decision); secondDecision.unitId = second.id; secondDecision.slotBindings = [{ slotId: 'second', componentKey: 'body', settingPath: 'widgetSettings.editor' }]; plan.selectionDecisions!.push(secondDecision);
    } else {
      unit.ownerNodeId = 'root'; unit.sourceFactIds = [...unit.sourceFactIds, factId]; unit.evidence.factIds = [...unit.evidence.factIds, factId]; unit.slots.push({ id: 'second', kind: 'text', factIds: [factId], required: true });
      decision.slotBindings.push({ slotId: 'second', componentKey: 'body', settingPath: 'widgetSettings.editor' });
    }
  }
  plan.components.push({ id: 'body', parentId: 'root', role: 'description', renderer: 'native', editability: 'controls', sourceRegionIds: ['region'], variants: facts.snapshots.map(snapshot => ({ snapshotId: snapshot.id, nodeIds: ['body', 'body-second'], visible: true })) });
  const body = (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children[0] as Extract<Native44Component, { kind: 'native' }>;
  body.widgetSettings.editor = `<p>Create an <strong>account</strong> for deals and more.</p><p>${secondText}</p>`;
  plan.selectionReview!.reviewedUnitIds = plan.sourceUnits!.map(unit => unit.id); reapprove(plan);
  return value;
}

test('desktop semantic plan covers both snapshots while historical final still requires tablet/mobile', () => {
  const { facts, plan, program } = fixture();
  assert.doesNotThrow(() => validateDesktopComponentPlan(plan, facts));
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts));
  assert.throws(() => validateComponentPlanV2(plan, facts, { stage: 'final' }), /explicitly selected execution path/);
  const old = structuredClone(plan); delete old.replicationProfile; delete old.selectionRulesHash; delete old.sourceUnits; delete old.selectionDecisions; delete old.selectionReview;
  assert.doesNotThrow(() => validateComponentPlanV2(old, facts, { stage: 'desktop' }));
  assert.throws(() => validateComponentPlanV2(old, facts, { stage: 'final' }), /actual tablet/);
  old.sourceUnits = plan.sourceUnits;
  assert.equal(ComponentPlanV2Schema.safeParse(old).success, false);
});
test('selection rejects missing narrow-desktop facts, wrong owners, and invented repeated slots', () => {
  let { facts, plan } = fixture(); plan.sourceUnits = plan.sourceUnits!.filter(unit => unit.snapshotId === 'wide'); reapprove(plan);
  assert.throws(() => validateDesktopComponentPlan(plan, facts), /no independently authored/);
  ({ facts, plan } = fixture()); plan.sourceUnits![2].ownerNodeId = 'body'; reapprove(plan);
  assert.throws(() => validateDesktopComponentPlan(plan, facts), /outside its actual common owner/);
  ({ facts, plan } = fixture()); plan.sourceUnits![2].repeatedItems![0].slotIds = ['text-b']; reapprove(plan);
  assert.throws(() => validateDesktopComponentPlan(plan, facts), /repeated item slot ownership/);
});
test('ordinary navigation and source paragraphs cannot be relabelled to justify buttons or headings', () => {
  let { facts, plan, program } = fixture(); replaceType(program, plan, 'nav', 'button');
  assert.throws(() => validateNative44Selection(program, plan, facts), /cannot use a button/);
  ({ facts, plan, program } = fixture()); plan.sourceUnits![2].role = 'cta'; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /navigation-list ownership cannot be relabelled/);
  ({ facts, plan, program } = fixture()); replaceType(program, plan, 'body', 'heading');
  assert.throws(() => validateNative44Selection(program, plan, facts), /description\/body cannot use a heading/);
  plan.sourceUnits![1].role = 'heading'; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /source description\/body cannot be relabelled/);
});
test('selection requires all actual widgets, required slots and frozen screenshot-bound whole-page judgment', () => {
  let { facts, plan, program } = fixture(); plan.selectionDecisions!.splice(1, 1); reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /Every source unit/);
  ({ facts, plan, program } = fixture()); plan.selectionDecisions![1].slotBindings = []; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /required slot body is unbound/);
  ({ facts, plan, program } = fixture()); plan.selectionDecisions![1].reason += ' changed';
  assert.throws(() => validateNative44Selection(program, plan, facts), /changed after the whole-page review/);
  ({ facts, plan } = fixture()); plan.selectionReview!.screenshots[1].screenshot.sha256 = 'c'.repeat(64);
  assert.throws(() => validateDesktopComponentPlan(plan, facts), /actual screenshot for every/);
});
test('selection validates rich-text wording and correct per-item source links rather than global text order', () => {
  let { facts, plan, program } = fixture(); const nav = (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children[1] as Extract<Native44Component, { kind: 'native' }>;
  const rows = nav.widgetSettings.list_items as Array<{ list_content: string; link: { url: string } }>;
  rows[0].list_content = 'Cat';
  assert.throws(() => validateNative44Selection(program, plan, facts), /preserved text binding differs/);
  rows[0].list_content = 'Dog'; rows[0].link.url = 'https://source.example/cat/';
  assert.throws(() => validateNative44Selection(program, plan, facts), /link binding differs/);
});
test('static marketing cannot become a catalog query and an alleged query needs independently observed catalog ownership', () => {
  let { facts, plan, program } = fixture();
  for (const snapshot of facts.snapshots) snapshot.nodes.nav.tag = 'article';
  for (const unit of plan.sourceUnits!.filter(unit => unit.role === 'navigation-list')) unit.role = 'marketing-card';
  replaceType(program, plan, 'nav', 'wd_products_brands');
  assert.throws(() => validateNative44Selection(program, plan, facts), /static marketing cannot use a target catalog query/);
  ({ facts, plan, program } = fixture());
  plan.sourceUnits![2].role = 'query'; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /independently observed catalog ownership/);
});
test('complete card components are preferred and styling does not justify arbitrary combinations', () => {
  const { facts, plan, program } = fixture();
  for (const snapshot of facts.snapshots) snapshot.nodes.nav.tag = 'article';
  for (const unit of plan.sourceUnits!.filter(unit => unit.role === 'navigation-list')) unit.role = 'information-card';
  reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /complete wd_infobox card is unsuitable/);
  for (const decision of plan.selectionDecisions!.filter(decision => decision.componentKeys.includes('nav'))) {
    decision.candidates.push({ widgetTypes: ['wd_infobox'], conclusion: 'unsuitable', reason: 'This card contains two independently linked destinations that need distinct fields.', evidence: [ref] });
    decision.compositionReason = { kind: 'multiple-links', detail: 'The source card exposes multiple links whose distinct destinations must remain editable.', evidence: [ref] };
  }
  reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts));
  plan.selectionDecisions![2].compositionReason!.detail = 'Spacing, font and margin differ from the source so the simple card is split.'; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /styling alone/);
});
test('optional-slot relabelling cannot silently drop mandatory source content', () => {
  const { facts, plan, program } = fixture();
  plan.sourceUnits![1].slots[0].required = false; plan.selectionDecisions![1].slotBindings = []; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /required slot body is unbound/);
});
test('layout and carousel labels cannot absorb ordinary footer facts to evade component selection', () => {
  let { facts, plan, program } = fixture(); plan.sourceUnits![2].role = 'layout'; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /layout cannot absorb ordinary/);
  ({ facts, plan, program } = fixture()); plan.sourceUnits![2].role = 'carousel'; reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts), /carousel role requires its actual controller/);
});
test('registered target contracts recheck actual repeater fields, values, conditions and source fingerprint', async () => {
  const { facts, plan, program } = fixture(), knowledge = await loadNative44Knowledge(['container', 'text-editor', 'wd_list']);
  const schemas: Record<string, LegacySchema> = { container: { type: 'container', class: 'Container', controls: {} }, 'text-editor': { type: 'text-editor', class: 'Text', controls: { editor: { type: 'wysiwyg' } } }, wd_list: { type: 'wd_list', class: 'List', controls: { list_items: { type: 'repeater', fields: [{ name: 'list_content', type: 'textarea' }, { name: 'link', type: 'url' }] } } } };
  for (const decision of plan.selectionDecisions!) {
    for (const contract of decision.contractRefs) contract.schemaSha256 = knowledge.index.components[contract.widgetType].sha256;
    decision.contractRefs.push(...decision.contractRefs.map(contract => ({ ...contract, scope: 'target-registered' as const, schemaSha256: schemaHash(schemas[contract.widgetType]) })));
  }
  reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }));
  schemas['text-editor'].controls.editor.condition = { absentDriver: 'yes' };
  for (const decision of plan.selectionDecisions!) for (const contract of decision.contractRefs.filter(ref => ref.scope === 'target-registered')) contract.schemaSha256 = schemaHash(schemas[contract.widgetType]); reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }), /condition driver is unverified/);
  delete schemas['text-editor'].controls.editor.condition; schemas['text-editor'].controls.editor.type = 'number';
  for (const decision of plan.selectionDecisions!) for (const contract of decision.contractRefs.filter(ref => ref.scope === 'target-registered')) contract.schemaSha256 = schemaHash(schemas[contract.widgetType]); reapprove(plan);
  assert.throws(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }), /slot type differs|type mismatch/);
});
test('new registered identities survive exact generated defaults while historical raw identities require exact raw equality', async () => {
  const { facts, plan, program } = fixture(), knowledge = await loadNative44Knowledge(['container', 'text-editor', 'wd_list', 'wd_testimonials']);
  const schemas: Record<string, LegacySchema> = {
    container: { type: 'container', class: 'Container', controls: {} },
    'text-editor': { type: 'text-editor', class: 'Text', controls: { editor: { type: 'wysiwyg' } } },
    wd_list: { type: 'wd_list', class: 'List', controls: { list_items: { type: 'repeater', fields: [{ name: 'list_content', type: 'textarea' }, { name: 'link', type: 'url' }] } } },
    wd_testimonials: { type: 'wd_testimonials', class: 'XTS\\Elementor\\Testimonials', controls: { layout: { type: 'select', default: 'slider', options: { slider: 'Carousel', grid: 'Grid' } }, carousel_sync: { type: 'select', default: '', options: { '': 'Disabled', parent: 'As parent', child: 'As child' }, condition: { layout: 'slider' } }, sync_parent_id: { type: 'text', default: 'wd_6ad3ad27b46b3', condition: { layout: 'slider', carousel_sync: ['parent'] } } } },
  };
  (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children.push({ kind: 'native', key: 'testimonials', widgetType: 'wd_testimonials', widgetSettings: { layout: 'grid' } });
  for (const decision of plan.selectionDecisions!) {
    if (decision.unitId.endsWith('-root')) { decision.componentKeys.push('testimonials'); decision.candidates[0].widgetTypes.push('wd_testimonials'); decision.contractRefs.push({ widgetType: 'wd_testimonials', scope: 'local-source', schemaSha256: ref.sha256, evidence: ref }); }
    for (const contract of decision.contractRefs) contract.schemaSha256 = knowledge.index.components[contract.widgetType].sha256;
    decision.contractRefs.push(...decision.contractRefs.map(contract => ({ ...contract, scope: 'target-registered' as const, schemaSha256: native44RegisteredSchemaHash(schemas[contract.widgetType]) })));
  }
  reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }));
  const second = structuredClone(schemas); second.wd_testimonials.controls.sync_parent_id.default = 'wd_6ad3b122a8a48';
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts, { schemas: second, knowledge }));
  for (const decision of plan.selectionDecisions!) for (const contract of decision.contractRefs.filter(contract => contract.widgetType === 'wd_testimonials' && contract.scope === 'target-registered')) contract.schemaSha256 = schemaHash(schemas.wd_testimonials);
  reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }));
  assert.throws(() => validateNative44Selection(program, plan, facts, { schemas: second, knowledge }), /target contract evidence changed/);
});
test('one native rich-text field preserves two source paragraphs in natural DOM order with inline and block boundaries', () => {
  const { facts, plan, program } = paragraphsFixture();
  assert.doesNotThrow(() => validateDesktopComponentPlan(plan, facts));
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts));
  assert.doesNotThrow(() => assertNative44SourceBindings(program, plan, facts));
  assert.throws(() => assertNative44SourceBindings(program, plan), /exact source facts/);
});

test('registered rich-text inline link keeps its observed anchor and rejects plain-text or changed destinations', async () => {
  const { facts, plan, program } = fixture();
  const body = (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children[0] as Extract<Native44Component, { kind: 'native' }>;
  const destination = 'https://source.example/account/';
  body.widgetSettings.editor = `<p>Create an <a href="${destination}">account</a> for deals and more.</p>`;
  for (const snapshot of facts.snapshots) {
    const original = facts.facts[`${snapshot.id}:text:body`], id = `${snapshot.id}:interaction:inline`;
    facts.facts[id] = { ...original, id, kind: 'interaction', value: { id: 'inline', nodeId: 'body', regionId: original.regionId, selector: '#body', kind: 'link', status: 'observed', href: destination, details: {} } };
    const unit = plan.sourceUnits!.find(item => item.id === `${snapshot.id}-body`)!;
    unit.sourceFactIds = [...unit.sourceFactIds, id]; unit.evidence.factIds = [...unit.evidence.factIds, id]; unit.slots.push({ id: 'inline', kind: 'link', factIds: [id], required: true });
    plan.selectionDecisions!.find(item => item.unitId === unit.id)!.slotBindings.push({ slotId: 'inline', componentKey: 'body', settingPath: 'widgetSettings.editor' });
    plan.requirements.push({ id: `req-${snapshot.id}-inline`, factIds: [id], componentId: 'root', disposition: 'preserve', rule: 'Preserve the actual inline anchor in its native paragraph.', verification: { kind: 'interaction', selector: '.inline', snapshotId: snapshot.id, expected: { href: destination } } });
  }
  const knowledge = await loadNative44Knowledge(['container', 'text-editor', 'wd_list']);
  const schemas: Record<string, LegacySchema> = { container: { type: 'container', class: 'Container', controls: {} }, 'text-editor': { type: 'text-editor', class: 'Text', controls: { editor: { type: 'wysiwyg' } } }, wd_list: { type: 'wd_list', class: 'List', controls: { list_items: { type: 'repeater', fields: [{ name: 'list_content', type: 'textarea' }, { name: 'link', type: 'url' }] } } } };
  for (const decision of plan.selectionDecisions!) {
    for (const contract of decision.contractRefs) contract.schemaSha256 = knowledge.index.components[contract.widgetType].sha256;
    decision.contractRefs.push(...decision.contractRefs.map(contract => ({ ...contract, scope: 'target-registered' as const, schemaSha256: schemaHash(schemas[contract.widgetType]) })));
  }
  reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }));
  body.widgetSettings.editor = '<p>Create an <a href="https://source.example/other/">account</a> for deals and more.</p>';
  assert.throws(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }), /link binding differs/);
  body.widgetSettings.editor = `<p>Create an account for deals and more. ${destination}</p>`;
  assert.throws(() => validateNative44Selection(program, plan, facts, { schemas, knowledge }), /link binding differs/);
});
test('different source units can share one exact rich-text field without depending on global fact or slot order', () => {
  const { facts, plan, program } = paragraphsFixture(true);
  facts.facts = Object.fromEntries(Object.entries(facts.facts).reverse()); plan.requirements.reverse(); plan.sourceUnits!.reverse(); plan.selectionDecisions!.reverse(); reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts));
  assert.doesNotThrow(() => assertNative44SourceBindings(program, plan, facts));
});
test('rich-text aggregation rejects reversed paragraphs, invented copy and foreign card copy', () => {
  for (const wrong of [
    '<p>The second paragraph keeps its own source wording.</p><p>Create an account for deals and more.</p>',
    '<p>Create an account for deals and more.</p><p>The second paragraph keeps its own source wording.</p><p>Invented offer.</p>',
    '<p>Create an account for deals and more.</p><p>The second paragraph keeps its own source wording.</p><p>Dog</p>',
  ]) {
    const { facts, plan, program } = paragraphsFixture();
    ((program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children[0] as Extract<Native44Component, { kind: 'native' }>).widgetSettings.editor = wrong;
    assert.throws(() => validateNative44Selection(program, plan, facts), /preserved text binding differs/);
  }
});
test('text aggregation cannot merge different source cards or bind into a sibling target field', () => {
  let { facts, plan, program } = paragraphsFixture(true);
  for (const snapshot of facts.snapshots) { snapshot.nodes.body.tag = 'article'; snapshot.nodes['body-second'].tag = 'article'; }
  assert.throws(() => assertNative44SourceBindings(program, plan, facts), /independent card or section owners/);
  ({ facts, plan, program } = paragraphsFixture());
  const root = program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>, extra = structuredClone(root.children[0]); extra.key = 'other-card'; root.children.push(extra);
  for (const decision of plan.selectionDecisions!.filter(decision => decision.componentKeys.includes('body'))) { decision.componentKeys = ['other-card']; decision.slotBindings.forEach(binding => binding.componentKey = 'other-card'); }
  reapprove(plan);
  assert.throws(() => assertNative44SourceBindings(program, plan, facts), /outside its required component owner/);
});
test('new profile external links are checked at their selected field even if the right URL exists elsewhere', () => {
  const { facts, plan, program } = fixture();
  const req = plan.requirements.find(requirement => requirement.factIds.includes('wide:interaction:a'))!;
  req.disposition = 'external'; req.verification = { kind: 'external', selector: '.dog-link', expected: 'https://source.example/dog/' };
  const nav = (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children[1] as Extract<Native44Component, { kind: 'native' }>;
  const rows = nav.widgetSettings.list_items as Array<{ list_content: string; link: { url: string } }>;
  rows[1].link.url = rows[0].link.url; rows[0].link.url = 'https://source.example/wrong/';
  assert.throws(() => assertNative44SourceBindings(program, plan, facts), /exact component field/);
});
test('new profile media binds the exact planned asset key rather than any asset under the module', async () => {
  const { facts, plan, program } = fixture();
  for (const snapshot of facts.snapshots) {
    snapshot.nodes.body.tag = 'article'; snapshot.nodes.body.childIds = ['photo'];
    snapshot.nodes.photo = { parentId: 'body', regionId: 'region', tag: 'img', selector: '#photo', childIds: [] };
    const id = `${snapshot.id}:media:photo`, original = facts.facts[`${snapshot.id}:text:body`];
    facts.facts[id] = { ...original, id, nodeId: 'photo', kind: 'media', value: { id: 'photo', nodeId: 'photo', regionId: 'region', resourceId: 'source-photo', kind: 'img', visible: true, resource: { id: 'source-photo', url: 'https://source.example/photo.png', kind: 'image' }, selector: '#photo', layout: original.value.layout } };
    const unit = plan.sourceUnits!.find(unit => unit.id === `${snapshot.id}-body`)!; unit.role = 'image-card'; unit.sourceFactIds = [...unit.sourceFactIds, id]; unit.evidence.factIds = [...unit.evidence.factIds, id]; unit.slots.push({ id: 'photo', kind: 'media', factIds: [id], required: true });
    const decision = plan.selectionDecisions!.find(decision => decision.unitId === unit.id)!; decision.slotBindings[0].settingPath = 'widgetSettings.title_text'; decision.slotBindings.push({ slotId: 'photo', componentKey: 'body', settingPath: 'widgetSettings.image' });
    plan.requirements.push({ id: `${snapshot.id}-photo`, factIds: [id], componentId: 'root', disposition: 'preserve', rule: 'Preserve the exact source photograph at this owned display position.', verification: { kind: 'media', selector: '.photo', expected: { assetKey: 'photo' }, snapshotId: snapshot.id } });
  }
  replaceType(program, plan, 'body', 'image-box');
  const image = (program.blocks[0] as Extract<Native44Component, { kind: 'composite' }>).children[0] as Extract<Native44Component, { kind: 'native' }>;
  image.widgetSettings = { title_text: 'Create an account for deals and more.', image: { $asset: 'photo' } };
  reapprove(plan);
  assert.doesNotThrow(() => validateNative44Selection(program, plan, facts));
  assert.doesNotThrow(() => assertNative44SourceBindings(program, plan, facts));
  // A background media slot belongs to the actual Container settings object,
  // not to a fictional widgetSettings property on a composite.
  const backgroundProgram=structuredClone(program),backgroundPlan=structuredClone(plan);
  backgroundProgram.blocks[0].settings={background_image:{$asset:'photo'}};
  for(const decision of backgroundPlan.selectionDecisions!.filter(item=>item.unitId.endsWith('-body'))){decision.componentKeys.push('root');decision.candidates[0].widgetTypes.push('container');decision.contractRefs.push({widgetType:'container',scope:'local-source',schemaSha256:ref.sha256,evidence:ref});decision.slotBindings.find(binding=>binding.slotId==='photo')!.componentKey='root';decision.slotBindings.find(binding=>binding.slotId==='photo')!.settingPath='settings.background_image';}
  const schemas:Record<string,LegacySchema>={container:{type:'container',class:'Container',controls:{background_image:{type:'media'}}},'image-box':{type:'image-box',class:'ImageBox',controls:{title_text:{type:'text'},image:{type:'media'}}},wd_list:{type:'wd_list',class:'List',controls:{list_items:{type:'repeater',fields:[{name:'list_content',type:'textarea'},{name:'link',type:'url'}]}}}};
  const knowledge=await loadNative44Knowledge(['container','image-box','wd_list']);
  for(const decision of backgroundPlan.selectionDecisions!){for(const contract of decision.contractRefs)contract.schemaSha256=knowledge.index.components[contract.widgetType].sha256;decision.contractRefs.push(...decision.contractRefs.map(contract=>({...contract,scope:'target-registered' as const,schemaSha256:schemaHash(schemas[contract.widgetType])})));}
  reapprove(backgroundPlan);
  assert.doesNotThrow(()=>validateNative44Selection(backgroundProgram,backgroundPlan,facts,{schemas,knowledge}));
  image.widgetSettings.image = { $asset: 'other-photo' }; image.widgetSettings.unrelatedImage = { $asset: 'photo' };
  assert.throws(() => assertNative44SourceBindings(program, plan, facts), /preserved media asset differs/);
});

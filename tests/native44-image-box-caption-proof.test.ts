import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createNative44CSSModel, compileNative44CSSModel, type Native44CSSModelRule } from '../src/native44/css-model.js';
import { buildNative44PageCSS } from '../src/native44/css-handoff.js';
import { verifyNative44ImageBoxCaptionReveals, type VerifiedImageBoxCaptionReveals } from '../src/native44/image-box-caption-proof.js';
import { documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import type { ElementorElement } from '../src/wordpress/types.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../src/components/capabilities.js';

type Changes = { packet?: (value: any, index: number) => void; observation?: (value: any, stage: string, index: number) => void; plan?: (value: any) => void; proof?: (value: any) => void; elements?: (value: ElementorElement[]) => void; census?: (value: any) => void };
function fixture(changes: Changes = {}) {
  const root = path.resolve('caption-proof-fixture'), files = new Map<string, Buffer>(), store = (name: string, value: unknown) => { const filename = path.join(root, 'references', `${name}.json`), bytes = Buffer.from(JSON.stringify(value)); files.set(filename, bytes); return { path: filename, sha256: hashV2(bytes) }; };
  const sourceUrl = 'https://source.example/', title = 'Freshly-Cooked Dog Food', href = 'https://source.example/dog', image = 'https://source.example/dog.jpg';
  const settings = { css_classes: 'cwp-dog', title_text: title, image: { url: image }, link: { url: href } }, elements: ElementorElement[] = [{ id: 'module', elType: 'container', settings: { css_classes: 'cwp-categories' }, elements: [{ id: 'dog', elType: 'widget', widgetType: 'image-box', settings: structuredClone(settings), elements: [] }] }];
  const original = { key: 'dog-category', kind: 'native', widgetType: 'image-box', widgetSettings: structuredClone(settings) }; changes.elements?.(elements);
  const snapshot = { pageId: 77, runId: 'run-one', status: 'draft', elements: structuredClone(elements), settings: {}, hash: documentHashV2(elements, {}) }, targetSnapshot = store('snapshot', snapshot);
  const source: any = { sourceUrl, snapshots: [], facts: {} }, plan: any = { sourceFacts: undefined, sourceUnits: [], selectionDecisions: [] }, baselines: any[] = [], targetDOM: any[] = [];
  const r = { x: 10, y: 30, width: 300, height: 32.391 }, layout = (id: string) => ({ id, rect: r, contentRect: r, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: 0 });
  [1920, 1440].forEach((width, index) => {
    const snapshotId = `desktop-${index}`, height = index ? 1000 : 1080, viewport = { width, height, clientWidth: width - 15, devicePixelRatio: 1 }, nodes: any = {}, layouts: any = {};
    for (const [id, tag, parentId, childIds] of [['card', 'div', null, ['caption', 'image']], ['caption', 'div', 'card', ['title']], ['title', 'a', 'caption', []], ['image', 'img', 'card', []]] as const) { nodes[id] = { id, tag, parentId, childIds: [...childIds], attributes: {}, regionId: 'category', selector: `#${id}`, styleId: id === 'caption' ? 'hidden' : 'shown', layoutId: id, visible: true }; layouts[id] = layout(id); }
    const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: snapshotId, url: sourceUrl, title: 'Public pet shop', capturedAt: '2026-10-17T00:00:00.000Z', viewport: { ...viewport, name: `desktop-${index}`, scrollbarWidth: 15 }, pageHeight: 4000, screenshot: { path: 'source.png', sha256: 'a'.repeat(64), width, height } }, nodes, regions: [{ id: 'category', nodeId: 'card', contentNodeId: 'card', role: 'category', order: 0, gapBefore: 0 }], texts: { title: { id: 'title', nodeId: 'title', regionId: 'category', text: title, kind: 'heading' } }, styles: { shown: { opacity: '1', display: 'block', visibility: 'visible' }, hidden: { opacity: '0', display: 'block', visibility: 'visible' } }, layouts, resources: { image: { id: 'image', url: image, kind: 'image' } }, usages: { image: { id: 'image', nodeId: 'image', regionId: 'category', resourceId: 'image', kind: 'img', visible: true } }, interactions: {}, gaps: [] };
    changes.packet?.(packet, index); const packetRef = store(`packet-${index}`, packet), factId = `title-${index}`;
    source.snapshots.push({ id: snapshotId, evidence: [packetRef] }); source.facts[factId] = { id: factId, snapshotId, kind: 'text', nodeId: 'title', evidence: packetRef, value: { text: title } };
    plan.sourceUnits.push({ id: snapshotId, snapshotId, ownerNodeId: 'card', sourceFactIds: [factId], slots: [{ id: 'caption', factIds: [factId] }] }); plan.selectionDecisions.push({ unitId: snapshotId, componentKeys: ['dog-category'], slotBindings: [{ componentKey: 'dog-category', settingPath: 'widgetSettings.title_text', slotId: 'caption' }] });
    const states: any = {};
    ['default', 'hover', 'restored'].forEach((stage, stageIndex) => {
      const observation = { version: 1, kind: 'native44-source-image-box-caption-observation', sourceUrl, observedAt: `2026-10-17T00:00:0${stageIndex + 1}.000Z`, stage, input: { method: stage === 'hover' ? 'cua-drag-pointer' : 'readonly-dom', selectionMayChange: stage === 'hover' }, viewport, scroll: { x: 0, y: stageIndex * 10 }, cards: [{ componentKey: 'dog-category', selector: '#card', hovered: stage === 'hover', active: false, rect: { ...r, y: r.y - stageIndex * 10 }, href, title: { selector: '#title', text: title, opacity: '1' }, caption: { selector: '#caption', opacity: stage === 'hover' ? '1' : '0', display: 'block', visibility: 'visible', rect: { ...r, height: 32.390625, y: r.y - stageIndex * 10 } }, image: { selector: '#image', src: image, currentSrc: image, opacity: '1', display: 'block', visibility: 'visible', rect: r } }] };
      changes.observation?.(observation, stage, index); states[`${stage === 'restored' ? 'restored' : stage}Observation`] = store(`state-${index}-${stage}`, observation);
    });
    baselines.push({ snapshotId, titleFactId: factId, cardNodeId: 'card', captionNodeId: 'caption', titleNodeId: 'title', packet: packetRef, ...states });
    const census = { kind: 'actual-owned-native-dom-wrapper-diagnostic', taskId: 'task-one', pageId: 77, runId: 'run-one', documentHash: snapshot.hash, viewport, freshBefore: { documentHash: snapshot.hash }, freshAfter: { documentHash: snapshot.hash }, nodes: [{ nativeID: 'dog', recordId: 'root', isNativeRoot: true, class: 'cwp-dog', domPath: '.root', directText: '' }, { nativeID: 'dog', recordId: 'caption', class: 'elementor-image-box-content', domPath: '.root > .caption', directText: '' }, { nativeID: 'dog', recordId: 'title', class: 'elementor-image-box-title', domPath: '.root > .caption > .title', directText: title }, { nativeID: 'dog', recordId: 'image', class: '', domPath: '.root > img', image: {}, rect: r, directText: '' }] };
    changes.census?.(census); targetDOM.push({ viewport: index ? 'desktop-narrow' : 'desktop-wide', evidence: store(`dom-${index}`, census) });
  });
  const sourceFacts = store('source', source); plan.sourceFacts = sourceFacts; changes.plan?.(plan); const componentPlan = store('plan', plan), program = store('program', { taskId: 'task-one', sourceUrl, sourceFacts, componentPlan, blocks: [original] });
  const proof = { version: 1, kind: 'native44-image-box-caption-reveal-proof', taskId: 'task-one', sourceUrl, program, sourceFacts, componentPlan, targetSnapshot, targetDOM, cards: [{ componentKey: 'dog-category', elementId: 'dog', cardClass: 'cwp-dog', baselines }] }; changes.proof?.(proof); const proofRef = store('proof', proof);
  const rules: Native44CSSModelRule[] = ['default', 'hover', 'focus-within'].map(state => ({ id: `caption-${state}`, moduleKey: 'categories', slot: 'caption', selector: `.cwp-dog${state === 'default' ? '' : `:${state}`} .elementor-image-box-content`, property: 'opacity', responsibility: 'css', value: state === 'default' ? '0' : '1', reason: 'Preserve observed caption layout and native link with hover and keyboard accessibility.', evidence: [proofRef.path], nativeStructure: { kind: 'image-box-caption-reveal', componentKey: 'dog-category', elementId: 'dog', cardClass: 'cwp-dog', state: state as any, proof: proofRef, sourceEvidence: proofRef.path } }));
  const model = createNative44CSSModel({ taskId: 'task-one', runId: 'run-one', pageId: 77, replicationProfile: 'desktop-browser-v1', modules: [{ key: 'categories', className: 'cwp-categories' }], rules }), read = async (reference: { path: string }) => { const bytes = files.get(reference.path); assert.ok(bytes); return bytes; };
  return { root, model, elements, program, sourceFacts, componentPlan, read, files, proofRef, verify() { return verifyNative44ImageBoxCaptionReveals(this); } };
}

test('two actual state graphs qualify only the unchanged native caption model and tree', async () => {
  const f = fixture(); assert.throws(() => compileNative44CSSModel(f.model, { elements: f.elements }), /not_verified/);
  const unchanged = JSON.stringify({ model: f.model, elements: f.elements }); await f.verify();
  const compiled = compileNative44CSSModel(f.model, { elements: f.elements }); assert.match(compiled.css, /opacity:0/); assert.match(compiled.css, /:hover/); assert.match(compiled.css, /:focus-within/);
  assert.equal(compileNative44CSSModel(f.model, { elements: f.elements }).sha256, compiled.sha256); assert.equal(JSON.stringify({ model: f.model, elements: f.elements }), unchanged);
  assert.throws(() => compileNative44CSSModel(structuredClone(f.model), { elements: f.elements }), /not_verified/);
  f.elements[0].elements![0].settings.title_text = 'Changed title'; assert.throws(() => compileNative44CSSModel(f.model, { elements: f.elements }), /not_verified/);
});
test('no generic hiding, metadata-only approval, fabricated token, fallback or partial state group can emit caption CSS', async () => {
  const f = fixture(), handoff = { pageId: 77, modules: f.model.modules, canvasCss: '', replicationProfile: 'desktop-browser-v1' as const, rules: f.model.rules.map(rule => ({ ...rule, declarations: { opacity: rule.value! } })) };
  assert.throws(() => buildNative44PageCSS({ ...handoff, captionRevealProofs: { kind: 'verified-image-box-caption-reveals' } as VerifiedImageBoxCaptionReveals }), /actual verified/);
  assert.throws(() => createNative44CSSModel({ ...f.model, rules: f.model.rules.slice(0, 2) }), /matching default/);
  for (const patch of [{ nativeStructure: undefined }, { property: 'visibility', value: 'hidden' }, { selector: '.cwp-dog' }, { value: '0!important' }, { observedDecoration: true }, { value: undefined, fallback: { id: 'opacity', values: ['0', '1'] } }]) assert.throws(() => createNative44CSSModel({ ...f.model, rules: f.model.rules.map((rule, index) => index ? rule : { ...rule, ...patch }) }));
  assert.ok(NATIVE44_ADAPTER_SOURCE_PATHS.includes('src/native44/image-box-caption-proof.ts'));
});
test('tampered bytes and one viewport cannot qualify an opacity exception', async () => {
  const f = fixture(); f.files.set(f.proofRef.path, Buffer.from('{}')); await assert.rejects(f.verify(), /hash_changed/);
  await assert.rejects(fixture({ proof: p => p.cards[0].baselines.pop() }).verify());
  await assert.rejects(fixture({ proof: p => { p.targetDOM[1] = p.targetDOM[0]; } }).verify(), /two_desktops/);
});
test('raw ancestor opacity, fact ownership, title slots and both exact native fields stay mandatory', async () => {
  for (const changes of [
    { packet: (p: any) => { p.styles.hidden.opacity = '1'; } },
    { packet: (p: any) => { p.nodes.title.parentId = 'card'; p.nodes.card.childIds = ['caption', 'image', 'title']; p.nodes.caption.childIds = []; } },
    { plan: (p: any) => { p.selectionDecisions[0].slotBindings[0].settingPath = 'widgetSettings.description_text'; } },
    { proof: (p: any) => { p.cards[0].baselines[0].titleNodeId = 'image'; } },
    { elements: (e: any) => { e[0].elements[0].settings.description_text = 'Another caption'; } },
    { elements: (e: any) => { e[0].elements[0].widgetType = 'heading'; } },
    { census: (c: any) => { c.nodes[2].directText = 'Unrelated title'; } },
  ]) await assert.rejects(fixture(changes).verify());
});
test('declared hover, active drag, failed restoration, identity and collapsed geometry do not authorize hiding', async () => {
  for (const mutate of [
    (o: any, s: string) => { if (s === 'hover') o.input.method = 'readonly-dom'; },
    (o: any, s: string) => { if (s === 'hover') o.cards[0].hovered = false; },
    (o: any, s: string) => { if (s === 'hover') o.cards[0].active = true; },
    (o: any, s: string) => { if (s === 'restored') o.cards[0].caption.opacity = '1'; },
    (o: any, s: string) => { if (s === 'hover') o.cards[0].href += '/other'; },
    (o: any, s: string) => { if (s === 'hover') o.cards[0].image.currentSrc += '?different'; },
    (o: any, s: string) => { if (s === 'hover') o.cards[0].caption.rect.height = 1; },
  ]) await assert.rejects(fixture({ observation: mutate }).verify());
});

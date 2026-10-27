import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { applyNative44Revision, prepareNative44Revision, recordNative44RevisionReview, type Native44RevisionDependencies, type Native44RevisionRequest } from '../../src/native44/revision.js';
import { readNative44CurrentState, type Native44CurrentRef } from '../../src/native44/current-state.js';
import { createNative44CSSModel, compileNative44CSSModel } from '../../src/native44/css-model.js';
import { createNative44RequirementContract, native44RequirementsHash, type Native44AcceptanceObservation, type Native44AcceptancePolicy, type Native44CapabilityProof } from '../../src/native44/requirements.js';
import { fingerprintNative44Snapshot, type Native44CompareManifest } from '../../src/native44/compare.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../../src/native44/catalog.js';
import { documentHashV2, hashV2 } from '../../src/replica-v2/journal.js';
import type { SourceFactsV2 } from '../../src/replica-v2/source.js';
import type { Native44SourceUnit } from '../../src/native44/selection-types.js';
import type { Native44Component } from '../../src/native44/types.js';
import type { DraftSnapshot } from '../../src/wordpress/types.js';

export const views = [{ name: 'desktop-wide', width: 1920, height: 1080 }, { name: 'desktop-narrow', width: 1440, height: 1000 }];
const assertions: Record<string, string> = { 'render-content': 'contentPresent', 'editable-native': 'nativeControlsEditable', 'render-layout': 'layoutControlsAvailable', 'render-presentation': 'presentationControlsAvailable', 'target-product-data': 'realTargetProductQuery', 'authentic-business': 'businessFactsVerified' };

/** All identities, pixels and frozen inputs belong to this local fixture. No
 * real site, user draft, credentials, browser or current release is consulted. */
export async function fixture(t: test.TestContext, layout: 'heading' | 'cards', criticalGap = false, componentReference = false, options: { evidencePaddingBytes?: number } = {}) {
  const temporary = await mkdtemp(path.resolve(import.meta.dirname, '..', 'fixtures', '.native44-revision-flow-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = await realpath(temporary), taskId = `task-${layout}`, runId = `run-${layout}`, pageId = layout === 'heading' ? 71 : 83;
  const taskDir = path.join(root, 'references', taskId), runDir = path.join(root, 'runs', runId), inputDir = path.join(runDir, 'inputs');
  const json = async (filename: string, value: unknown): Promise<Native44CurrentRef> => {
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value, null, 2) + '\n');
    return { path: filename, sha256: hashV2(await readFile(filename)) };
  };
  const png = async (filename: string, width: number, height: number, target = false): Promise<Native44CurrentRef> => {
    await mkdir(path.dirname(filename), { recursive: true });
    // Real decoded image data, with different heading/cards geometry and a
    // subpixel-equivalent one-pixel stripe in the target review fixture.
    const bands = `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/><rect x="40" y="30" width="${width - 80}" height="80" fill="#143d72"/>${layout === 'cards' ? '<rect x="40" y="150" width="240" height="280" fill="#f4ca72"/><rect x="310" y="150" width="240" height="280" fill="#d6e8ed"/>' : ''}${target ? '<rect x="40" y="109" width="100" height="1" fill="#153e73"/>' : ''}</svg>`;
    const bytes = await sharp(Buffer.from(bands)).png().toBuffer(); await writeFile(filename, bytes);
    const metadata = await sharp(bytes).metadata(); assert.equal(metadata.format, 'png'); assert.equal(metadata.width, width); assert.equal(metadata.height, height);
    return { path: filename, sha256: hashV2(bytes) };
  };
  const evidence = await json(path.join(taskDir, 'source-packet.json'), { layout, method: 'fixture-source-observation', ...(options.evidencePaddingBytes ? { padding: 'x'.repeat(options.evidencePaddingBytes) } : {}), responsibilities: ['inner geometry', 'editable content', ...(layout === 'cards' ? ['native product query', 'card styling'] : []), ...(criticalGap ? ['search query entry and submission'] : [])] });
  const sourceImages = await Promise.all(views.map(view => png(path.join(taskDir, `${view.name}.png`), view.width, view.height)));
  const nodes: SourceFactsV2['snapshots'][number]['nodes'] = {
    panel: { tag: 'section', parentId: null, regionId: 'panel', selector: '#panel', childIds: ['title', ...(layout === 'cards' ? ['cards'] : []), ...(criticalGap ? ['search'] : [])] },
    title: { tag: 'h2', parentId: 'panel', regionId: 'panel', selector: '#title', childIds: [] },
    ...(layout === 'cards' ? { cards: { tag: 'section', parentId: 'panel', regionId: 'cards', selector: '#cards', childIds: ['card'] }, card: { tag: 'div', parentId: 'cards', regionId: 'cards', selector: '#card', childIds: [] } } : {}),
    ...(criticalGap ? { search: { tag: 'input', parentId: 'panel', regionId: 'panel', selector: '#search', childIds: [] } } : {}),
  };
  const facts: SourceFactsV2['facts'] = {};
  const fact = (id: string, nodeId: string, kind: SourceFactsV2['facts'][string]['kind'], value: Record<string, unknown>) => {
    facts[id] = { id, snapshotId: 'wide', regionId: nodes[nodeId].regionId, nodeId, kind, value, evidence };
  };
  fact('wide:panel', 'panel', 'region', {}); fact('wide:title', 'title', 'text', { text: 'Seasonal highlights', visible: true });
  if (layout === 'cards') { fact('wide:cards', 'cards', 'region', {}); fact('wide:card', 'card', 'media', { visible: true }); }
  if (criticalGap) fact('wide:search', 'search', 'interaction', { kind: 'control', details: { action: 'search' } });
  const source: SourceFactsV2 = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', observation: evidence, snapshots: views.map((view, index) => ({ id: index ? 'narrow' : 'wide', viewport: { ...view, clientWidth: view.width - 15, scrollbarWidth: 15, devicePixelRatio: 1 }, screenshot: { ...sourceImages[index], width: view.width, height: view.height }, evidence: [evidence], nodes: index ? {} : nodes })), facts, gaps: [] };
  const units: Native44SourceUnit[] = ['panel', ...(layout === 'cards' ? ['cards'] : [])].map(id => {
    const factIds = Object.values(facts).filter(item => item.regionId === id).map(item => item.id);
    return { id, snapshotId: 'wide', ownerNodeId: id, regionId: id, role: id === 'cards' ? 'query' : 'layout', sourceFactIds: factIds, evidence: { factIds, screenshots: [{ snapshotId: 'wide', screenshot: sourceImages[0] }], rationale: 'Independent fixture source inventory preserves each module and its inner responsibilities.' }, slots: [] };
  });
  const sourceFacts = await json(path.join(taskDir, 'source-facts.json'), source), componentPlan = await json(path.join(taskDir, 'component-plan.json'), { sourceUnits: units }), assetsManifest = await json(path.join(taskDir, 'asset-manifest.json'), { assets: [] });
  const components: Native44Component[] = [{ kind: 'composite', key: 'panel', role: 'layout', settings: { css_classes: 'cwp-panel' }, children: [{ kind: 'native', key: 'title', role: 'heading', widgetType: 'heading', widgetSettings: { title: 'Seasonal highlights', header_size: 'h2' } }, ...(layout === 'cards' ? [{ kind: 'native-products' as const, key: 'cards', role: 'product' as const, widgetType: 'wd_products' as const, widgetSettings: { post_type: 'ids', include: [501, 502], items_per_page: 2 }, query: { ids: [501, 502], evidence: [evidence.path] } }] : [])] }];
  const children: DraftSnapshot['elements'] = [{ id: 'head123', elType: 'widget', widgetType: 'heading', settings: { title: 'Seasonal highlights', header_size: 'h2' }, elements: [] }, ...(layout === 'cards' ? [{ id: 'prod123', elType: 'widget' as const, widgetType: 'wd_products', settings: { post_type: 'ids', include: [501, 502], items_per_page: 2 }, elements: [] }] : [])];
  const elements: DraftSnapshot['elements'] = [{ id: 'root123', elType: 'container', settings: { css_classes: 'cwp-panel' }, elements: children }], settings = { custom_css: '', post_title: 'Owned fixture draft', post_status: 'draft' };
  const before: DraftSnapshot = { pageId, runId, title: settings.post_title, status: 'draft', elements, settings, hash: documentHashV2(elements, settings) };
  const beforeRef = await json(path.join(inputDir, 'baseline.json'), before);
  const model = createNative44CSSModel({ taskId, runId, pageId, replicationProfile: 'desktop-browser-v1', modules: [{ key: 'panel', className: 'cwp-panel' }], rules: [
    { id: 'heading-font', moduleKey: 'panel', slot: 'heading', selector: '.elementor-heading-title', property: 'font-size', responsibility: 'css', value: layout === 'cards' ? '30px' : '36px', reason: 'Match the observed source heading size.', evidence: [evidence.path] },
    ...(layout === 'cards' ? [{ id: 'product-card-radius', moduleKey: 'panel', slot: 'product-card', selector: '.product-grid-item', property: 'border-radius', responsibility: 'css' as const, value: '12px', reason: 'Preserve the observed card presentation independently of actual target products.', evidence: [evidence.path] }] : []),
    { id: 'heading-hierarchy', moduleKey: 'panel', slot: 'hierarchy', property: 'line-height', responsibility: 'native', native: { elementId: 'head123', controlId: 'header_size', expectedValue: 'h1' }, reason: 'Use the observed editable native heading hierarchy.', evidence: [evidence.path] },
  ] });
  const modelRef = await json(path.join(inputDir, 'model.json'), model), sourceUnits = await json(path.join(inputDir, 'units.json'), units);
  const contract = createNative44RequirementContract(source, units, sourceFacts, taskId, componentReference ? { goalProfile: 'component-reference-v1' } : {});
  const panel = components[0]; assert.equal(panel.kind, 'composite'); if (panel.kind !== 'composite') throw Error('Fixture panel must be a native composite');
  for (const row of contract.requirements) {
    if (row.capability === 'search-input') continue; // Explicitly unresolved critical behavior in the gap fixture.
    const component = row.sourceKey === 'unit:cards' ? panel.children[1] : panel;
    const proof: Native44CapabilityProof = { version: 1, kind: 'native44-capability-proof', capability: row.capability, method: 'registered-contract', components: [{ key: component.key, widgetType: component.kind === 'composite' ? 'container' : 'widgetType' in component ? component.widgetType : 'html', settingsHash: native44RequirementsHash({ settings: component.settings ?? {}, widgetSettings: 'widgetSettings' in component ? component.widgetSettings : {}, ...(component.kind === 'native-products' ? { query: component.query, tabs: component.tabs } : {}) }) }], observations: { [assertions[row.capability]]: true }, evidence: [evidence] };
    row.fulfillment = { route: 'verified-native', capability: row.capability, componentKeys: [component.key], proof: await json(path.join(taskDir, 'proofs', `${row.id}.json`), proof) };
  }
  const policy: Native44AcceptancePolicy = { version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] };
  const minor = contract.requirements.find(row => row.dimension === 'layout')!;
  if (!componentReference) policy.tolerances.push({ checkId: minor.checks[0].id, maxDelta: 0.5, unit: 'px', reason: 'Allow measured subpixel rounding at this exact geometry check.' });
  const requirements = await json(path.join(inputDir, 'requirements.json'), contract), acceptancePolicy = await json(path.join(inputDir, 'policy.json'), policy), rulesHash = 'a'.repeat(64), knowledgeHash = 'b'.repeat(64);
  await mkdir(path.join(root, 'config'), { recursive: true }); await writeFile(path.join(root, 'config', 'native44-component-set.json'), await readFile(path.resolve(import.meta.dirname, '../../config/native44-component-set.json')));
  const componentCatalog = { path: path.join(root, 'config', 'native44-component-set.json'), sha256: NATIVE44_CATALOG_HASH }, knowledgeRef = await json(path.join(root, 'data', 'native44', 'index.json'), { version: 1 }), knowledge = { ...knowledgeRef, fingerprint: knowledgeHash };
  const program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, sourceUrl: source.sourceUrl, componentCatalog, knowledge, sourceFacts, componentPlan, assetsManifest, blocks: components };
  const programRef = await json(path.join(taskDir, 'program.json'), program), historicalCode = await json(path.join(root, 'src', 'native44', 'historical-adapter.json'), { fixture: true });
  const release = { version: 1, executorId: 'native44', componentSet: { id: 'native44-v1', catalog: componentCatalog, types: [...NATIVE44_ALL_TYPES] }, knowledge: { id: 'knowledge-v1', index: knowledgeRef, fingerprint: knowledgeHash }, selectionRules: { id: 'desktop-browser-v1', sha256: rulesHash, files: [historicalCode] }, adapters: { id: 'native44-desktop-v1', sha256: 'c'.repeat(64), files: [historicalCode] } };
  const observedAt = new Date().toISOString(), releaseLock = await json(path.join(taskDir, 'release-lock.json'), { version: 1, kind: 'native44-release-lock', phase: 'final', taskId, replicationProfile: 'desktop-browser-v1', createdAt: observedAt, release, program: programRef, inputs: { componentCatalog, knowledge, sourceFacts, componentPlan, assetsManifest } });
  const journal = await json(path.join(runDir, 'journal.json'), { version: 2, workflow: 'block-replication', taskId, runId, runDir, executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, pageId, targetUrl: 'https://target.example/', programHash: programRef.sha256, releaseLock, documentHash: before.hash, status: 'awaiting-comparison', mutations: [{ status: 'confirmed', pageId, runId, expectedAfterHash: before.hash, observedHash: before.hash }] });
  const productChecks: NonNullable<Native44CompareManifest['productChecks']> = layout === 'cards' ? [{ componentKey: 'cards', selector: `.elementor-${pageId} [data-id="prod123"]`, widgetType: 'wd_products', expectedProductIds: [501, 502], catalog: { targetOrigin: 'https://target.example', evidence: [evidence.path], products: [501, 502].map(id => ({ id, name: `Target fixture product ${id}`, permalink: `https://target.example/product/${id}/`, imageUrl: `https://target.example/uploads/${id}.png`, priceText: '$12.00' })) } }] : [];
  const manifest: Native44CompareManifest = { version: 1, strategy: 'native44-css-handoff', taskId, runId, pageId, releaseLock, sourceUrl: source.sourceUrl, targetUrl: 'https://target.example/', replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, ...fingerprintNative44Snapshot(before), canvasCss: '', widgetTypes: layout === 'cards' ? ['container', 'heading', 'wd_products'] : ['container', 'heading'], modules: [{ key: 'panel', className: 'cwp-panel', sourceSelector: '#panel', targetSelector: `.elementor-${pageId} .cwp-panel`, required: true }], cssRules: [], productChecks, viewports: views, sourceCaptures: { version: 2, taskId, replicationProfile: 'desktop-browser-v1', selectionRulesHash: rulesHash, collectionStartedAt: observedAt, sourceFacts, componentPlan, viewports: [{ viewport: 'desktop-wide', snapshotId: 'wide' }, { viewport: 'desktop-narrow', snapshotId: 'narrow' }] } };
  const manifestRef = await json(path.join(inputDir, 'manifest.json'), manifest);
  const request: Native44RevisionRequest = { version: 1, kind: 'native44-revision-request', taskId, runId, operationId: 'revision-one', pageId, userInstruction: 'Apply the reviewed native heading and consolidated module style, then verify both desktop layouts.', expectedBeforeHash: before.hash, before: beforeRef, cssModel: modelRef, requirements, acceptancePolicy, sourceUnits, manifest: manifestRef, patches: [{ kind: 'set-controls', elementId: 'head123', controls: { header_size: 'h1' }, reason: 'Match the observed editable heading hierarchy.', evidence: [evidence.path] }] };
  const frozenRefs = [programRef, releaseLock, sourceFacts, componentPlan, assetsManifest, journal, beforeRef, modelRef, sourceUnits, requirements, acceptancePolicy, manifestRef];
  const frozen = new Map(await Promise.all(frozenRefs.map(async ref => [ref.path, await readFile(ref.path)] as const)));
  const assertHistoricalUnchanged = async (intentionallyChanged: ReadonlySet<string> = new Set()) => { for (const [filename, bytes] of frozen) if (!intentionallyChanged.has(filename)) assert.deepEqual(await readFile(filename), bytes, `Historical artifact changed: ${path.basename(filename)}`); };
  const expectedFile = path.join(runDir, 'amendments', request.operationId, 'expected.json');
  const expected = async (): Promise<DraftSnapshot> => JSON.parse(await readFile(expectedFile, 'utf8'));
  let reviewSequence = 0;
  const review = async (snapshot: DraftSnapshot, gap = false) => {
    const reviewDir = path.join(root, 'runs', `review-${layout}-${++reviewSequence}`), captures = [];
    for (const view of views) {
      const sourceScreenshot = await png(path.join(reviewDir, `${view.name}-source.png`), view.width, view.height), targetScreenshot = await png(path.join(reviewDir, `${view.name}-target.png`), view.width, view.height, true);
      captures.push({ viewport: view.name, sourceScreenshot, targetScreenshot, interactions: [{ viewport: view.name, status: gap ? 'blocked' : 'passed', problems: gap ? ['Known source search input is missing.'] : [] }], queries: productChecks.map(check => ({ componentKey: check.componentKey, selector: check.selector, widgetType: check.widgetType, expectedProductIds: check.expectedProductIds, products: check.catalog.products, nativeWidgetCount: 1, actualWidgetType: check.widgetType, elementId: 'prod123', viewport: view.name, status: 'passed', problems: [] })) });
    }
    const cssHash = compileNative44CSSModel(model).canonicalSha256;
    const reviewObservedAt = new Date().toISOString();
    const verification = await json(path.join(reviewDir, 'report.json'), { version: 1, kind: 'explicit-user-component-and-css-review', pageId, runId, documentHash: snapshot.hash, documentUnchanged: true, css: { applied: true, expectedHash: cssHash, actualHash: cssHash }, nativeProductSlots: layout === 'cards' ? 1 : 0, metrics: { documentWrites: 0, editorSessions: 0, viewports: 2 }, captures, observedAt: reviewObservedAt });
    const visualReview = await json(path.join(reviewDir, 'visual-reviews.json'), captures.map(capture => ({ viewport: capture.viewport, sourceScreenshotHash: capture.sourceScreenshot.sha256, targetScreenshotHash: capture.targetScreenshot.sha256, documentHash: snapshot.hash, verdict: 'reviewed', observedAt: reviewObservedAt })));
    const observation: Native44AcceptanceObservation = { version: 1, kind: 'native44-acceptance-observation', requirementsHash: native44RequirementsHash(contract), documentHash: snapshot.hash, cssHash, review: { verification, visualReview }, checks: contract.requirements.flatMap(row => row.checks.map(check => row.capability === 'search-input' ? { requirementId: row.id, checkId: check.id, outcome: 'fail' as const, evidence: [verification], issue: { category: 'behavior' as const, message: 'Known critical source search behavior is not implemented.' } } : check.id === minor.checks[0].id ? { requirementId: row.id, checkId: check.id, outcome: 'fail' as const, evidence: [verification], issue: { category: 'geometry' as const, message: 'Measured rounding difference is 0.4px.', delta: 0.4, unit: 'px' } } : { requirementId: row.id, checkId: check.id, outcome: 'pass' as const, evidence: [verification] })) };
    return { verification, visualReview, acceptanceObservation: await json(path.join(reviewDir, 'acceptance.json'), observation), captures };
  };
  return { root, taskId, runId, pageId, runDir, request, before, contract, policy, json, review, expected, assertHistoricalUnchanged };
}

export function fakeRemote(f: Awaited<ReturnType<typeof fixture>>, options: { lostReply?: boolean; failReadAfterSave?: boolean; ignoreSave?: boolean; ineligible?: boolean } = {}) {
  let snapshot = structuredClone(f.before), factories = 0, probes = 0, reads = 0, saves = 0, closes = 0;
  const deps: Native44RevisionDependencies = { remote: async manifest => {
    factories++; assert.equal(manifest.pageId, f.pageId); assert.equal(manifest.runId, f.runId);
    return {
      probeOwnedReviewStatus: async (pageId, runId) => { probes++; return { pageId, runId, exists: true, postType: 'page', status: options.ineligible ? 'publish' : 'draft', ownerMatches: true, canEdit: true, uniqueRunPage: true, documentExists: true, builtWithElementor: true }; },
      readOwnedReviewCheckpoint: async () => { reads++; if (options.failReadAfterSave && saves === 1 && reads === 2) throw Error('Readback transport timed out'); return { snapshot: structuredClone(snapshot), proof: { fixture: true } }; },
      saveOwnedRevision: async (before, expected) => { assert.equal(before.hash, snapshot.hash, 'Fake remote CAS must reject stale baseline'); saves++; if (!options.ignoreSave) snapshot = structuredClone(expected); if (options.lostReply) throw Error('Save reply was lost; outcome must be read back'); return structuredClone(snapshot); },
      close: async () => { closes++; },
    };
  } };
  return { deps, stats: () => ({ factories, probes, reads, saves, closes }), snapshot: () => structuredClone(snapshot), externalEdit: () => { snapshot.elements[0].settings.editor_note = 'Another editor owns this update'; snapshot.hash = documentHashV2(snapshot.elements, snapshot.settings); return structuredClone(snapshot); } };
}


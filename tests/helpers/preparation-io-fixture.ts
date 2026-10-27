import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { native44KnowledgeIdentity } from '../../src/native44/knowledge.js';
import { native44ProfileViewports } from '../../src/native44/profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../../src/native44/selection-rules.js';
import { native44ModuleClass } from '../../src/native44/adapters.js';
import { buildSourceFactsV2 } from '../../src/replica-v2/source.js';
import { validateObservationPacketV2 } from '../../src/replica-v2/observation.js';
import { buildPreparationJobs } from '../../src/replica-preparation/contract.js';
import { PREPARATION_COMPATIBILITY_KEYS, PREPARATION_DECISION_KEYS, type PreparationFileRef, type PreparationJobResult, type PreparationPlan } from '../../src/replica-preparation/types.js';
import type { BodySourceUnits } from '../../src/replica-full/body-prepare.js';
import { defaultNativeImagePolicy } from '../../src/replica-full/native-image-policy.js';

/** Synthetic browser evidence exercises local integrity gates; it is never a visual approval. */
export async function preparationIOFixture() {
  const cache = await realpath('D:/cloneWP/.cache');
  const directory = path.join(cache, `preparation-io-${randomUUID()}`);
  await mkdir(directory);
  const put = async (name: string, input: unknown): Promise<PreparationFileRef> => {
    const filename = path.resolve(directory, name), relative = path.relative(directory, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('fixture_path_escape');
    await mkdir(path.dirname(filename), { recursive: true });
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input));
    await writeFile(filename, bytes);
    return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const sourceUrl = 'https://source.example/synthetic-preparation-boundary', targetOrigin = 'https://target.example', taskId = 'preparation-io-task', runId = 'preparation-io-run';
  const definitions = ['header', 'hero', 'faq'].flatMap((key, order) => [
    { id: key, parentId: null, regionId: key, tag: key === 'header' ? 'HEADER' : 'SECTION', childIds: [key + '-text'], order },
    { id: key + '-text', parentId: key, regionId: key, tag: 'H2', childIds: [], order },
  ]);
  const packets: ReturnType<typeof validateObservationPacketV2>[] = [];
  for (const [index, [width, height]] of [[1920, 1080], [1440, 1000]].entries()) {
    const id = index ? 'narrow' : 'wide';
    const screenshot = await put(`${id}.png`, await sharp({ create: { width, height, channels: 3, background: '#abc' } }).png().toBuffer());
    const layouts = Object.fromEntries(definitions.map((node, n) => [String(n), { id: String(n), rect: { x: 0, y: node.order * 100, width, height: 100 }, contentRect: { x: 0, y: node.order * 100, width, height: 100 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: n }]));
    packets.push(validateObservationPacketV2({ version: 2, kind: 'observation-packet', snapshot: { id, url: sourceUrl, title: 'Synthetic local preparation boundary', capturedAt: '2026-10-19T00:00:00.000Z', viewport: { name: index ? 'desktop-narrow' : 'desktop', width, height, clientWidth: width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: height, screenshot: { ...screenshot, width, height } }, nodes: Object.fromEntries(definitions.map(({ order: _order, ...node }, n) => [node.id, { ...node, selector: '#' + node.id, attributes: {}, styleId: 'style', layoutId: String(n), visible: true }])), regions: ['header', 'hero', 'faq'].map((id, order) => ({ id, nodeId: id, contentNodeId: id, role: id, order, gapBefore: 0 })), texts: Object.fromEntries(['header', 'hero', 'faq'].map(id => [id, { id, nodeId: id + '-text', regionId: id, text: id, kind: 'heading', level: 2 }])), styles: { style: {} }, layouts, resources: {}, usages: {}, interactions: {}, gaps: [] }));
  }
  const packetRefs = await Promise.all(packets.map(packet => put(`${packet.snapshot.id}-packet.json`, packet)));
  const evidence = await put('source-evidence.json', { version: 1, kind: 'native44-body-source-evidence', taskId, sourceUrl, snapshots: packets.map((packet, index) => ({ id: packet.snapshot.id, viewport: packet.snapshot.viewport, packets: [packetRefs[index]] })) });
  const sourceFacts = buildSourceFactsV2({ manifestPath: evidence.path, manifestSha256: evidence.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets, packetFiles: packetRefs.map((ref, index) => ({ ...ref, snapshotId: packets[index].snapshot.id })) });
  const facts = await put('source-facts.json', sourceFacts);
  const sourceUnits: BodySourceUnits = { version: 1, kind: 'native44-body-source-units', taskId, sourceUrl, units: packets.flatMap(packet => ['header', 'hero', 'faq'].map(key => ({ id: packet.snapshot.id + '/' + key, snapshotId: packet.snapshot.id, ownerNodeId: key, nodeIds: [key, key + '-text'], sourceFactIds: Object.values(sourceFacts.facts).filter(fact => fact.snapshotId === packet.snapshot.id && fact.regionId === key).map(fact => fact.id), componentKeys: [] }))) };
  const units = await put('source-units.json', sourceUnits), headerAssets = await put('header-assets.json', { assets: [] }), bodyAssets = await put('body-assets.json', { assets: [] }), componentPlan = await put('pending-component-plan.json', { testOnly: true });
  const identity = await native44KnowledgeIdentity('D:/cloneWP');
  const plan: PreparationPlan = {
    version: 1, kind: 'clonewp-replica-preparation', taskId, runId, title: 'Synthetic preparation boundary', slug: 'synthetic-preparation-boundary', sourceUrl, targetOrigin,
    sourceEvidence: evidence, sourceFacts: facts, sourceUnits: units, headerAssets, bodyAssets, nativeImagePolicy: defaultNativeImagePolicy(),
    bodyBase: { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, title: 'Synthetic preparation boundary', sourceUrl, replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, editorNaming: 'native-translated-v1', reviewWorkflow: 'whole-page-after-css-v1', goalProfile: 'component-reference-v1', requirementProfile: 'source-requirements-v1', articleListPolicy: 'target-posts-v1', ...identity, sourceFacts: facts, componentPlan, assetsManifest: bodyAssets, viewports: native44ProfileViewports('desktop-browser-v1') },
    headerBase: { version: 1, kind: 'clonewp-header-module', moduleKey: 'synthetic-preparation', targetOrigin, owner: { ownerId: 'clonewp', runId }, name: 'Synthetic independently owned header', menus: [{ key: 'main', name: 'Synthetic independently owned menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: ':header{color:#123}', fonts: [] } },
    sourcePartition: { allUnits: sourceUnits.units.map(unit => unit.id), headerUnits: sourceUnits.units.filter(unit => unit.ownerNodeId === 'header').map(unit => unit.id), bodyUnits: sourceUnits.units.filter(unit => unit.ownerNodeId !== 'header').map(unit => unit.id) },
    shared: { decisions: PREPARATION_DECISION_KEYS.map(key => ({ key, value: 'synthetic-source-derived', evidence: [facts] })), compatibility: PREPARATION_COMPATIBILITY_KEYS.map(key => ({ key, status: 'verified', reason: 'Synthetic local evidence tests compatibility record integrity only.', evidence: [facts] })), css: ':page{color:#123}' },
    sections: ['hero', 'faq'].map(key => ({ key, sourceUnitIds: sourceUnits.units.filter(unit => unit.ownerNodeId === key).map(unit => unit.id), sourceFactIds: sourceUnits.units.filter(unit => unit.ownerNodeId === key).flatMap(unit => unit.sourceFactIds), family: key === 'faq' ? 'interaction' : 'content', dependsOn: [], estimatedEffort: 5 })),
  };
  const jobs = buildPreparationJobs(plan);
  const results: PreparationJobResult[] = jobs.map(job => ({ version: 1, kind: 'clonewp-preparation-result', taskId, runId, jobId: job.jobId, contractHash: job.contractHash, sharedHash: job.sharedHash, ...(job.responsibility === 'header' ? { header: structuredClone(plan.headerBase) } : { sections: job.sectionKeys.map(key => ({ key, blocks: [{ kind: 'composite', key, sourceFactIds: plan.sections.find(section => section.key === key)!.sourceFactIds, children: [{ kind: 'native', key: key + '_title', widgetType: 'heading', widgetSettings: { title: key }, sourceFactIds: packets.map(packet => packet.snapshot.id + ':text:' + key) }] }], css: `:page .${native44ModuleClass(key)} h2{font-size:30px}` })) }) }));
  const finalRunDirectory = path.join(directory, 'run'), preparationDirectory = finalRunDirectory + '-preparation';
  const cleanup = async () => {
    const resolved = await realpath(directory), relative = path.relative(cache, resolved), info = await lstat(resolved);
    if (!relative.startsWith('preparation-io-') || relative.includes(path.sep) || info.isSymbolicLink()) throw Error('fixture_cleanup_scope');
    await rm(resolved, { recursive: true, force: true });
  };
  return { directory, preparationDirectory, finalRunDirectory, plan, jobs, results, packets, packetRefs, facts, sourceFacts, put, cleanup,
    async writeResult(jobId: string, value: unknown = results.find(row => row.jobId === jobId)) {
      const filename = path.join(preparationDirectory, 'jobs', jobId, 'result.json');
      await writeFile(filename, JSON.stringify(value)); return filename;
    },
    async readState() { return JSON.parse(await readFile(path.join(preparationDirectory, 'state.json'), 'utf8')); },
  };
}

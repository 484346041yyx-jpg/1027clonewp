import path from 'node:path';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { makeRunId, writeJson } from '../core/files.js';
import { FinalDeliveryPolicySchema, type FinalDeliveryPolicy } from '../core/delivery-policy.js';
import { insideProject } from '../core/project-path.js';
import { assertPublicUrl } from '../capture/url-safety.js';
import { fetchPinnedBrowserResource } from '../capture/pinned-fetch.js';
import { captureLayoutStableScreenshot } from '../verification/layout-stable-screenshot.js';
import { openReadOnlyPage } from '../verification/page-opening.js';
import { SceneInventoryRefV2Schema, type SceneInventoryV2 } from './scene-inventory.js';
import { ObservationPacketV2Schema, observationCountsV2, readObservationDirectoryV2, sha256, validateObservationPacketV2, type ObservationManifestV2, type ValidatedObservationV2 } from './observation.js';
import { analyzeSourceCommerceV2, SourceCommerceGroupV2Schema } from './commerce.js';
import { assessSourceCompleteness } from './source-completeness.js';

const fileRef = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const SourceFactsV2Schema = z.object({
  version: z.literal(2), kind: z.literal('source-facts'), sourceUrl: z.url(), observation: fileRef,
  snapshots: z.array(z.object({ id: z.string().min(1), viewport: z.object({ name: z.string().min(1), width: z.number().finite().positive(), height: z.number().finite().positive(), clientWidth: z.number().finite().positive(), scrollbarWidth: z.number().finite().nonnegative(), devicePixelRatio: z.number().finite().positive() }).strict(), screenshot: fileRef.extend({ width: z.number().finite().positive(), height: z.number().finite().positive() }).strict(), evidence: z.array(fileRef).min(1), nodes: z.record(z.string(), z.object({ parentId: z.string().nullable(), regionId: z.string(), tag: z.string(), selector: z.string(), childIds: z.array(z.string()), attributes: z.record(z.string(), z.string()).optional() }).strict()) }).strict()).min(1),
  facts: z.record(z.string(), z.object({ id: z.string().min(1), snapshotId: z.string().min(1), regionId: z.string().min(1), nodeId: z.string().min(1), kind: z.enum(['region', 'text', 'media', 'layout', 'interaction']), evidence: fileRef, value: z.record(z.string(), z.unknown()) }).strict()),
  gaps: z.array(z.object({ snapshotId: z.string(), code: z.string(), message: z.string(), nodeId: z.string().optional() }).strict()),
  sceneInventories: z.array(SceneInventoryRefV2Schema).min(1).optional(),
  sourceCommerce: z.array(z.object({ snapshotId: z.string().min(1), evidence: fileRef, groups: z.array(SourceCommerceGroupV2Schema) }).strict()).optional(),
}).strict();
export type SourceFactsV2 = z.infer<typeof SourceFactsV2Schema>;
export type SourceFactV2 = SourceFactsV2['facts'][string];
const sourceFactValues = {
  region: ObservationPacketV2Schema.shape.regions.element.extend({ selector: z.string() }).strict(),
  layout: ObservationPacketV2Schema.shape.layouts.valueType.extend({ style: z.record(z.string(), z.string()), selector: z.string(), purpose: z.enum(['outer', 'content']) }).strict(),
  text: ObservationPacketV2Schema.shape.texts.valueType.extend({ visible: z.boolean(), selector: z.string(), style: z.record(z.string(), z.string()), layout: ObservationPacketV2Schema.shape.layouts.valueType }).strict(),
  media: ObservationPacketV2Schema.shape.usages.valueType.extend({ resource: ObservationPacketV2Schema.shape.resources.valueType, selector: z.string(), layout: ObservationPacketV2Schema.shape.layouts.valueType, style: z.record(z.string(), z.string()).optional() }).strict(),
  interaction: ObservationPacketV2Schema.shape.interactions.valueType.extend({ selector: z.string(), style: z.record(z.string(), z.string()).optional(), layout: ObservationPacketV2Schema.shape.layouts.valueType.optional() }).strict(),
};

export function validateSourceFactsV2(value: unknown): SourceFactsV2 {
  const result = SourceFactsV2Schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid SourceFactsV2: ${result.error.message}`);
  const facts = result.data, snapshots = new Map(facts.snapshots.map(snapshot => [snapshot.id, snapshot]));
  if (snapshots.size !== facts.snapshots.length) throw new Error('Duplicate source snapshot ID');
  if (!facts.snapshots.some(snapshot => snapshot.viewport.name === 'desktop')) throw new Error('Source facts require a desktop snapshot');
  for (const snapshot of facts.snapshots) for (const [nodeId, node] of Object.entries(snapshot.nodes)) {
    if (node.parentId && !snapshot.nodes[node.parentId]) throw new Error(`Source node ${snapshot.id}:${nodeId}: dangling parent`);
    if (node.childIds.some(child => !snapshot.nodes[child] || snapshot.nodes[child].parentId !== nodeId)) throw new Error(`Source node ${snapshot.id}:${nodeId}: dangling child`);
  }
  for (const [id, fact] of Object.entries(facts.facts)) {
    if (id !== fact.id || !id.startsWith(`${fact.snapshotId}:${fact.kind}:`)) throw new Error(`Source fact ID mismatch: ${id}`);
    const typedValue = sourceFactValues[fact.kind].safeParse(fact.value);
    if (!typedValue.success) throw new Error(`Source fact ${id}: invalid typed value ${typedValue.error.message}`);
    const snapshot = snapshots.get(fact.snapshotId);
    if (!snapshot || !snapshot.evidence.some(file => file.path === fact.evidence.path && file.sha256 === fact.evidence.sha256)) throw new Error(`Source fact ${id} is not bound to its snapshot evidence`);
    if (!snapshot.nodes[fact.nodeId] || snapshot.nodes[fact.nodeId].regionId !== fact.regionId) throw new Error(`Source fact ${id}: invalid node ownership`);
    if (JSON.stringify(fact.value).includes('[MaxDepth]')) throw new Error(`Source fact ${id}: truncated observation`);
    const region = facts.facts[`${fact.snapshotId}:region:${fact.regionId}`];
    if (!region) throw new Error(`Source fact ${id}: unknown source region`);
    if (fact.kind === 'region' && (fact.value.nodeId !== fact.nodeId || fact.value.id !== fact.regionId)) throw new Error(`Source region ${id}: wrong node ownership`);
    if (fact.kind === 'layout') for (const key of ['rect', 'contentRect']) { const rect = fact.value[key] as Record<string, unknown> | undefined; if (!rect || !['x', 'y', 'width', 'height'].every(field => typeof rect[field] === 'number' && Number.isFinite(rect[field]))) throw new Error(`Source fact ${id}: invalid ${key}`); }
  }
  for (const gap of facts.gaps) if (!snapshots.has(gap.snapshotId) || gap.nodeId && !snapshots.get(gap.snapshotId)!.nodes[gap.nodeId]) throw new Error(`Source gap ${gap.code}: dangling snapshot/node evidence`);
  if (facts.sceneInventories && (new Set(facts.sceneInventories.map(ref => ref.snapshotId)).size !== facts.sceneInventories.length || facts.sceneInventories.some(ref => !snapshots.has(ref.snapshotId)))) throw new Error('Independent scene inventory has a duplicate or unknown snapshot identity');
  const commerceIds = new Set<string>();
  for (const record of facts.sourceCommerce ?? []) {
    const snapshot = snapshots.get(record.snapshotId);
    if (!snapshot || !snapshot.evidence.some(ref => ref.path === record.evidence.path && ref.sha256 === record.evidence.sha256)) throw new Error('Source commerce evidence is not bound to its actual snapshot packet');
    const underneath = (id: string, owner: string) => { const seen = new Set<string>(); let current: string | null = id; while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = snapshot.nodes[current]?.parentId ?? null; } return false; };
    for (const group of record.groups) {
      const identity = `${snapshot.id}:${group.id}`;
      if (commerceIds.has(identity)) throw new Error(`Duplicate source commerce group ${identity}`); commerceIds.add(identity);
      if (!snapshot.nodes[group.ownerNodeId] || snapshot.nodes[group.ownerNodeId].regionId !== group.regionId || new Set(group.cardNodeIds).size !== group.cardNodeIds.length || group.cardNodeIds.some(id => !snapshot.nodes[id] || snapshot.nodes[id].regionId !== group.regionId || !underneath(id, group.ownerNodeId))) throw new Error(`Source commerce group ${identity}: invalid card ownership`);
      if (group.signals.some(signal => !snapshot.nodes[signal.nodeId] || !group.cardNodeIds.some(card => underneath(signal.nodeId, card)))) throw new Error(`Source commerce group ${identity}: signal outside its actual product subtree`);
      if (group.status === 'uncertain' && !facts.gaps.some(gap => gap.snapshotId === snapshot.id && gap.nodeId === group.ownerNodeId && gap.code === 'source-commerce-role-unproven')) throw new Error(`Uncertain source commerce group ${identity} requires a retained evidence gap`);
    }
  }
  return facts;
}

/** This projection never chooses target components or removes unclassified facts. */
export function buildSourceFactsV2(observation: ValidatedObservationV2): SourceFactsV2 {
  const snapshots = new Map<string, SourceFactsV2['snapshots'][number]>(), facts: SourceFactsV2['facts'] = {}, gaps: SourceFactsV2['gaps'] = [], sourceCommerce: NonNullable<SourceFactsV2['sourceCommerce']> = [];
  for (const [index, packet] of observation.packets.entries()) {
    const packetFile = observation.packetFiles[index], evidence = { path: packetFile.path, sha256: packetFile.sha256 };
    let snapshot = snapshots.get(packet.snapshot.id);
    if (!snapshot) { snapshot = { id: packet.snapshot.id, viewport: packet.snapshot.viewport, screenshot: { ...packet.snapshot.screenshot, path: path.resolve(path.dirname(observation.manifestPath), packet.snapshot.screenshot.path) }, evidence: [], nodes: {} }; snapshots.set(snapshot.id, snapshot); }
    if (!snapshot.evidence.some(file => file.path === evidence.path)) snapshot.evidence.push(evidence);
    for (const node of Object.values(packet.nodes)) snapshot.nodes[node.id] = { parentId: node.parentId, regionId: node.regionId, tag: node.tag, selector: node.selector, childIds: node.childIds, ...(packet.presentationVersion === 1 ? { attributes: node.attributes } : {}) };
    const add = (kind: SourceFactV2['kind'], entityId: string, regionId: string, nodeId: string, value: Record<string, unknown>) => {
      const id = `${packet.snapshot.id}:${kind}:${entityId}`, fact = { id, snapshotId: packet.snapshot.id, regionId, nodeId, kind, evidence, value };
      if (facts[id] && JSON.stringify(facts[id].value) !== JSON.stringify(value)) throw new Error(`Conflicting source fact ${id}`);
      facts[id] ??= fact;
    };
    for (const region of packet.regions) {
      add('region', region.id, region.id, region.nodeId, { ...region, selector: packet.nodes[region.nodeId].selector });
      for (const nodeId of new Set([region.nodeId, region.contentNodeId])) {
        const node = packet.nodes[nodeId];
        add('layout', node.layoutId, region.id, nodeId, { ...packet.layouts[node.layoutId], style: packet.styles[node.styleId], selector: node.selector, purpose: nodeId === region.nodeId ? 'outer' : 'content' });
      }
    }
    for (const text of Object.values(packet.texts)) add('text', text.id, text.regionId, text.nodeId, { ...text, visible: packet.nodes[text.nodeId].visible, selector: packet.nodes[text.nodeId].selector, style: packet.styles[packet.nodes[text.nodeId].styleId], layout: packet.layouts[packet.nodes[text.nodeId].layoutId] });
    for (const usage of Object.values(packet.usages)) add('media', usage.id, usage.regionId, usage.nodeId, { ...usage, resource: packet.resources[usage.resourceId], selector: packet.nodes[usage.nodeId].selector, layout: packet.layouts[packet.nodes[usage.nodeId].layoutId], ...(packet.presentationVersion === 1 ? { style: packet.styles[packet.nodes[usage.nodeId].styleId] } : {}) });
    for (const interaction of Object.values(packet.interactions)) add('interaction', interaction.id, interaction.regionId, interaction.nodeId, { ...interaction, selector: packet.nodes[interaction.nodeId].selector, ...(packet.presentationVersion === 1 ? { style: packet.styles[packet.nodes[interaction.nodeId].styleId], layout: packet.layouts[packet.nodes[interaction.nodeId].layoutId] } : {}) });
    for (const gap of packet.gaps) if (!gaps.some(old => old.snapshotId === packet.snapshot.id && old.code === gap.code && old.nodeId === gap.nodeId)) gaps.push({ snapshotId: packet.snapshot.id, ...gap });
    if (packet.commerceEvidence) {
      const groups = analyzeSourceCommerceV2(packet);
      sourceCommerce.push({ snapshotId: packet.snapshot.id, evidence, groups });
      for (const group of groups.filter(group => group.status === 'uncertain')) if (!gaps.some(gap => gap.snapshotId === packet.snapshot.id && gap.code === 'source-commerce-role-unproven' && gap.nodeId === group.ownerNodeId)) gaps.push({ snapshotId: packet.snapshot.id, code: 'source-commerce-role-unproven', nodeId: group.ownerNodeId, message: group.reason });
    }
  }
  for (const snapshot of assessSourceCompleteness(observation).snapshots) {
    if (!observation.sceneInventories?.find(item => item.inventory.snapshotId === snapshot.snapshotId)?.inventory.content) continue;
    const missing = snapshot.items.filter(item => item.status === 'missing');
    if (missing.length) gaps.push({ snapshotId: snapshot.snapshotId, code: 'source-content-incomplete', message: `${missing.length} independent content entries are not represented by captured text, links, media or styles; inspect source-completeness.json before component selection.` });
    for (const gap of snapshot.gaps.filter(gap => ['source-state-needs-observation', 'nested-content-needs-observation'].includes(gap.code))) if (!gaps.some(item => item.snapshotId === snapshot.snapshotId && item.code === gap.code)) gaps.push({ snapshotId: snapshot.snapshotId, code: gap.code, message: gap.message });
  }
  return validateSourceFactsV2({ version: 2, kind: 'source-facts', sourceUrl: observation.manifest.sourceUrl, observation: { path: observation.manifestPath, sha256: observation.manifestSha256 }, snapshots: [...snapshots.values()], facts, gaps, ...(observation.sceneInventories?.length ? { sceneInventories: observation.sceneInventories.map(item => item.ref) } : {}), ...(sourceCommerce.length ? { sourceCommerce } : {}) });
}

export interface PreparedReplicaJobV2 {
  version: 2; workflow: 'block-replication'; mode: 'replica'; jobId: string; url: string; jobDir: string;
  finalDeliveryPolicy?: FinalDeliveryPolicy;
  status: 'awaiting-component-plan' | 'blocked'; error?: string; observationPath: string; sourceFactsPath: string; sourceCompletenessPath?: string; componentPlanPath: string; assetsManifestPath: string; programPath: string;
}
/** Read-only source intake. The current desktop is sufficient; responsive evidence can be appended in a new facts revision later. */
export async function prepareObservedReferenceV2(url: string, observedDirectory: string, options: { root?: string; finalDeliveryPolicy?: FinalDeliveryPolicy } = {}): Promise<PreparedReplicaJobV2> {
  const finalDeliveryPolicy = options.finalDeliveryPolicy === undefined ? undefined : FinalDeliveryPolicySchema.parse(options.finalDeliveryPolicy);
  const root = await realpath(path.resolve(options.root ?? process.cwd())), observationDir = insideProject(root, observedDirectory);
  const validated = await readObservationDirectoryV2(observationDir, url);
  if (!validated.sceneInventories?.length || validated.packets.some(packet => !validated.sceneInventories!.some(item => item.ref.snapshotId === packet.snapshot.id))) throw new Error('New replica v2 jobs require an independently captured whole-page scene inventory for every source snapshot');
  if (validated.packets.some(packet => !packet.commerceEvidence)) throw new Error('New replica v2 jobs require source-commerce observation evidence for every captured packet; use the current collector before authoring renderer decisions');
  const jobId = `reference-v2-${makeRunId(url)}`, jobDir = path.join(root, 'references', jobId);
  await mkdir(path.join(root, 'references'), { recursive: true });
  if ((await realpath(path.join(root, 'references'))).toLowerCase() !== path.join(root, 'references').toLowerCase()) throw new Error('Reference jobs must stay in the real project directory');
  await mkdir(jobDir);
  await writeJson(path.join(jobDir, 'requirement-profile.json'), { version: 2, kind: 'native44-requirement-profile', profile: 'source-requirements-v1', goalProfile: 'component-reference-v1' });
  const referenceDir = path.join(jobDir, 'reference'); await mkdir(referenceDir);
  const relocatedManifest: ObservationManifestV2 = { ...validated.manifest, packets: [], screenshots: [] };
  const screenshots = new Map<string, string>();
  for (const [index, packet] of validated.packets.entries()) {
    let screenshotFile = screenshots.get(packet.snapshot.id);
    if (!screenshotFile) {
      screenshotFile = `screenshot-${screenshots.size + 1}${path.extname(packet.snapshot.screenshot.path) || '.png'}`;
      screenshots.set(packet.snapshot.id, screenshotFile);
      const screenshotBytes = await readFile(path.resolve(observationDir, packet.snapshot.screenshot.path));
      await writeFile(path.join(referenceDir, screenshotFile), screenshotBytes);
      relocatedManifest.screenshots.push({ path: screenshotFile, snapshotId: packet.snapshot.id, sha256: sha256(screenshotBytes) });
    }
    const filename = `packet-${index + 1}.json`, relocated = { ...packet, snapshot: { ...packet.snapshot, screenshot: { ...packet.snapshot.screenshot, path: screenshotFile } } }, bytes = JSON.stringify(relocated, null, 2) + '\n';
    await writeFile(path.join(referenceDir, filename), bytes);
    relocatedManifest.packets.push({ path: filename, sha256: sha256(bytes), snapshotId: packet.snapshot.id, regionIds: packet.regions.map(region => region.id), counts: observationCountsV2(packet), dependencies: [] });
  }
  relocatedManifest.sceneInventories = [];
  for (const [index, item] of validated.sceneInventories.entries()) {
    const filename = `scene-inventory-${index + 1}.json`, bytes = await readFile(item.ref.path); await writeFile(path.join(referenceDir, filename), bytes);
    relocatedManifest.sceneInventories.push({ path: filename, sha256: sha256(bytes), snapshotId: item.ref.snapshotId });
  }
  await writeJson(path.join(referenceDir, 'observation-manifest.json'), relocatedManifest);
  const relocated = await readObservationDirectoryV2(referenceDir, url), sourceFacts = buildSourceFactsV2(relocated);
  const sourceFactsPath = path.join(jobDir, 'source-facts.json'); await writeJson(sourceFactsPath, sourceFacts);
  await writeJson(path.join(jobDir, 'source-completeness.json'), assessSourceCompleteness(relocated));
  const job: PreparedReplicaJobV2 = { version: 2, workflow: 'block-replication', mode: 'replica', jobId, url, jobDir, ...(finalDeliveryPolicy ? { finalDeliveryPolicy } : {}), status: 'awaiting-component-plan', observationPath: relocated.manifestPath, sourceFactsPath, sourceCompletenessPath: path.join(jobDir, 'source-completeness.json'), componentPlanPath: path.join(jobDir, 'component-plan.json'), assetsManifestPath: path.join(jobDir, 'asset-manifest.json'), programPath: path.join(jobDir, 'program.json') };
  await writeJson(path.join(jobDir, 'job.json'), job);
  return job;
}

/** Verify that source-facts bytes still describe the actual validated packet files. */
export async function verifySourceFactsEvidenceV2(source: SourceFactsV2): Promise<SceneInventoryV2[]> {
  const bytes = await readFile(source.observation.path);
  if (sha256(bytes) !== source.observation.sha256) throw new Error('Source observation manifest hash changed');
  const observation = await readObservationDirectoryV2(path.dirname(source.observation.path), source.sourceUrl, { manifestName: path.basename(source.observation.path) });
  if (JSON.stringify(buildSourceFactsV2(observation)) !== JSON.stringify(source)) throw new Error('Source facts no longer equal the independently captured observations');
  return observation.sceneInventories?.map(item => item.inventory) ?? [];
}

/** A later immutable facts file may add viewports, never rewrite an already captured scene. */
export function assertSourceFactsExtensionV2(previousInput: SourceFactsV2, nextInput: SourceFactsV2): void {
  const previous = validateSourceFactsV2(previousInput), next = validateSourceFactsV2(nextInput);
  if (previous.sourceUrl !== next.sourceUrl) throw new Error('Source facts revision changed source URL');
  const orderedJson = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
  for (const snapshot of previous.snapshots) {
    const current = next.snapshots.find(candidate => candidate.id === snapshot.id);
    if (!current || orderedJson(snapshot.viewport) !== orderedJson(current.viewport) || snapshot.screenshot.sha256 !== current.screenshot.sha256 || snapshot.screenshot.width !== current.screenshot.width || snapshot.screenshot.height !== current.screenshot.height || orderedJson(snapshot.nodes) !== orderedJson(current.nodes)) throw new Error(`Source facts revision changed previously captured snapshot ${snapshot.id}`);
  }
  for (const fact of Object.values(previous.facts)) {
    const current = next.facts[fact.id];
    if (!current || current.snapshotId !== fact.snapshotId || current.regionId !== fact.regionId || current.nodeId !== fact.nodeId || current.kind !== fact.kind || current.evidence.sha256 !== fact.evidence.sha256 || orderedJson(current.value) !== orderedJson(fact.value)) throw new Error(`Source facts revision changed previously captured fact ${fact.id}`);
  }
  for (const gap of previous.gaps) if (!next.gaps.some(current => orderedJson(current) === orderedJson(gap))) throw new Error('Source facts revision removed an existing observation gap');
  for (const ref of previous.sceneInventories ?? []) if (!next.sceneInventories?.some(current => current.snapshotId === ref.snapshotId && current.sha256 === ref.sha256)) throw new Error('Source facts revision changed an independent scene inventory');
  for (const record of previous.sourceCommerce ?? []) if (!next.sourceCommerce?.some(current => current.snapshotId === record.snapshotId && current.evidence.sha256 === record.evidence.sha256 && orderedJson(current.groups) === orderedJson(record.groups))) throw new Error('Source facts revision changed previously captured commerce evidence');
}

export interface PrepareReferenceV2Options {
  root?: string; onProgress?: (message: string) => void | Promise<void>;
  /** Existing browser injection is for read-only source capture tests only. */
  browser?: Browser;
  /** Test seam supplies actual packet/screenshot files, never target data. */
  capture?: (url: string, directory: string) => Promise<void>;
}

/** Automatic v2 entrance: one public desktop capture, no target configuration or authentication. */
export async function prepareReferenceV2(url: string, options: PrepareReferenceV2Options = {}): Promise<PreparedReplicaJobV2> {
  await assertPublicUrl(url);
  const root = await realpath(path.resolve(options.root ?? process.cwd())), captureDirectory = path.join(root, '.cache', `reference-v2-capture-${makeRunId(url)}`);
  await mkdir(captureDirectory, { recursive: true });
  await options.onProgress?.('read-only-reference-v2-desktop-capture');
  try {
    await (options.capture ?? ((source, directory) => capturePublicDesktopV2(source, directory, options)))(url, captureDirectory);
    const job = await prepareObservedReferenceV2(url, captureDirectory, { root });
    await options.onProgress?.(job.status); return job;
  } catch (error) {
    // Capture diagnostics contain no request headers, cookies, session exports or target configuration.
    const jobId = `reference-v2-${makeRunId(url)}`, jobDir = path.join(root, 'references', jobId); await mkdir(jobDir, { recursive: true });
    const job: PreparedReplicaJobV2 = { version: 2, workflow: 'block-replication', mode: 'replica', jobId, url, jobDir, status: 'blocked', error: `Public desktop evidence unavailable: ${error instanceof Error ? error.message.replace(/https?:\/\/[^\s]+/g, '[public URL]') : 'capture failed'}. No target authentication or page write was performed.`, observationPath: path.join(captureDirectory, 'observation-manifest.json'), sourceFactsPath: path.join(jobDir, 'source-facts.json'), componentPlanPath: path.join(jobDir, 'component-plan.json'), assetsManifestPath: path.join(jobDir, 'asset-manifest.json'), programPath: path.join(jobDir, 'program.json') };
    await writeJson(path.join(jobDir, 'job.json'), job); await options.onProgress?.(job.status); return job;
  }
}

async function capturePublicDesktopV2(url: string, directory: string, options: PrepareReferenceV2Options): Promise<void> {
  const ownedBrowser = !options.browser, browser = options.browser ?? await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, serviceWorkers: 'block', locale: 'en-US', colorScheme: 'light' });
  let requests = 0, blockedMethods = 0, unavailableResources = 0;
  try {
    await context.routeWebSocket('**/*', socket => socket.close({ code: 1008, reason: 'Read-only public reference capture' }));
    await context.route('**/*', async route => {
      const request = route.request(), method = request.method();
      if (++requests > 4000 || !['GET', 'HEAD'].includes(method) || !/^https?:/.test(request.url())) { blockedMethods++; await route.abort('blockedbyclient'); return; }
      try { const response = await fetchPinnedBrowserResource({ url: request.url(), method, headers: await request.allHeaders(), body: null, timeoutMs: 15000, maxBytes: 20 * 1024 * 1024 }); await route.fulfill(response); }
      catch { unavailableResources++; await route.abort('blockedbyclient').catch(() => undefined); }
    });
    const { page } = await openReadOnlyPage(context, url);
    await assertPublicUrl(page.url());
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
    const title = await page.title(), body = await page.locator('body').innerText({ timeout: 3000 });
    if (/just a moment|checking your browser|access denied|verify (?:that )?you are human|captcha/i.test(`${title} ${body.slice(0, 700)}`) && body.length < 2500) throw new Error('Reference displays a challenge; the user must open a normal public page in their connected browser');
    for (let step = 0; step < 50; step++) {
      const current = await page.evaluate(() => ({ y: scrollY, height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), viewport: innerHeight }));
      if (current.height > 35000) throw new Error('Source exceeds the explicit 35000px page-height capture bound');
      if (current.y + current.viewport >= current.height - 2) break;
      await page.evaluate(y => scrollTo(0, y), current.y + 850); await page.waitForTimeout(60);
    }
    await page.evaluate(async () => { scrollTo(0, 0); await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]); });
    await options.onProgress?.('capturing-desktop-source-pixels');
    const screenshotPath = path.join(directory, 'desktop.png'), receipt = await captureLayoutStableScreenshot(page, { path: screenshotPath, maxPageHeight: 35000, timeoutMs: 30000 });
    const screenshot = await readFile(screenshotPath), metadata = await sharp(screenshot).metadata();
    let collector: string;
    try { collector = await readFile(new URL('./collect.browser.js', import.meta.url), 'utf8'); }
    catch { collector = await readFile(new URL('../../../src/replica-v2/collect.browser.js', import.meta.url), 'utf8'); }
    const screenshotInfo = { path: 'desktop.png', sha256: sha256(screenshot), width: metadata.width!, height: metadata.height! };
    const json = await page.evaluate(`(()=>{${collector}\nreturn collectObservationV2(${JSON.stringify({ snapshotId: 'desktop-initial', viewportName: 'desktop', screenshot: screenshotInfo, includeSceneInventory: true })});})()`);
    if (typeof json !== 'string') throw new Error('Browser collector did not serialize its observation before transport');
    const transport = JSON.parse(json) as { chunks: Array<{ path: string; json: string }>; sceneInventory?: SceneInventoryV2 };
    const manifest: ObservationManifestV2 = { version: 2, kind: 'observation-manifest', sourceUrl: url, provenance: { method: 'public-capture', observer: 'playwright', browser: 'chromium' }, packets: [], screenshots: [{ path: 'desktop.png', sha256: screenshotInfo.sha256, snapshotId: 'desktop-initial' }] };
    for (const [index, chunk] of transport.chunks.entries()) {
      const packet = validateObservationPacketV2(JSON.parse(chunk.json));
      for (const gap of receipt.gaps) packet.gaps.push({ code: gap.code, message: gap.message });
      if (blockedMethods) packet.gaps.push({ code: 'non-read-only-requests-blocked', message: `${blockedMethods} requests were blocked by read-only capture policy` });
      if (unavailableResources) packet.gaps.push({ code: 'resource-unavailable', message: `${unavailableResources} public resources were unavailable through the safe fetcher` });
      const filename = `desktop-region-${index + 1}.json`, bytes = JSON.stringify(packet, null, 2) + '\n'; await writeFile(path.join(directory, filename), bytes);
      manifest.packets.push({ path: filename, sha256: sha256(bytes), snapshotId: packet.snapshot.id, regionIds: packet.regions.map(region => region.id), counts: observationCountsV2(packet), dependencies: [] });
    }
    if (!transport.sceneInventory) throw new Error('Automatic public capture did not return its independent whole-page inventory');
    const sceneBytes = JSON.stringify(transport.sceneInventory, null, 2) + '\n'; await writeFile(path.join(directory, 'scene-inventory.json'), sceneBytes);
    manifest.sceneInventories = [{ path: 'scene-inventory.json', sha256: sha256(sceneBytes), snapshotId: 'desktop-initial' }];
    await writeJson(path.join(directory, 'observation-manifest.json'), manifest);
    await readObservationDirectoryV2(directory, url);
  } finally { await context.close(); if (ownedBrowser) await browser.close(); }
}

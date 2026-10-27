import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import sharp from 'sharp';
import { assertPublicUrl } from '../capture/url-safety.js';
import { SceneInventoryRefV2Schema, validateSceneInventoryV2, type SceneInventoryRefV2, type SceneInventoryV2 } from './scene-inventory.js';
import { CommerceObservationV2Schema } from './commerce.js';
import { sourceObserverProvenanceAllowed, type SourceObserverTool } from './observers.js';

const id = z.string().min(1).max(240);
const finite = z.number().finite();
const positive = finite.positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const rect = z.object({ x: finite, y: finite, width: finite.nonnegative(), height: finite.nonnegative() }).strict();
const inset = z.tuple([finite, finite, finite, finite]);
const strings = z.record(z.string(), z.string());
export const ObservationPacketV2Schema = z.object({
  version: z.literal(2), kind: z.literal('observation-packet'),
  presentationVersion: z.literal(1).optional(),
  snapshot: z.object({ id, url: z.url(), title: z.string().min(1), capturedAt: z.iso.datetime(), viewport: z.object({ name: id, width: positive, height: positive, clientWidth: positive, scrollbarWidth: finite.nonnegative(), devicePixelRatio: positive }).strict(), pageHeight: positive, screenshot: z.object({ path: z.string().min(1), sha256: hash, width: positive, height: positive }).strict() }).strict(),
  nodes: z.record(z.string(), z.object({ id, parentId: id.nullable(), regionId: id, tag: z.string().min(1), selector: z.string().min(1), attributes: strings, childIds: z.array(id), styleId: id, layoutId: id, visible: z.boolean() }).strict()),
  regions: z.array(z.object({ id, nodeId: id, role: z.string().min(1), order: finite.int().nonnegative(), contentNodeId: id, gapBefore: finite }).strict()).min(1),
  texts: z.record(z.string(), z.object({ id, nodeId: id, regionId: id, text: z.string().min(1), kind: z.enum(['heading', 'body', 'control', 'label']), level: finite.int().min(1).max(6).optional(), lineCount: finite.int().nonnegative().optional(), textLayout: z.object({ scope: z.literal('direct-text-nodes'), status: z.enum(['measured', 'unavailable']), reason: z.string().optional(), hardBreaks: z.boolean(), fontStatus: z.string(), lines: z.array(z.object({ text: z.string().min(1), rect }).strict()).max(16384) }).strict().superRefine((value, context) => { if (value.status === 'measured' ? !value.lines.length || !!value.reason : value.lines.length > 0 || !value.reason) context.addIssue({ code: 'custom', message: 'text line measurement status disagrees with evidence' }); }).optional() }).strict()),
  styles: z.record(z.string(), strings),
  layouts: z.record(z.string(), z.object({ id, rect, contentRect: rect, captureGeometry: z.object({ method: z.literal('css-animation-offset-layout'), rect, contentRect: rect }).strict().optional(), padding: inset, margin: inset, gap: z.object({ row: finite, column: finite }).strict(), display: z.string(), position: z.string(), maxWidth: z.string(), direction: z.string(), flowIndex: finite.int().nonnegative() }).strict()),
  resources: z.record(z.string(), z.object({ id, url: z.string().min(1), kind: z.enum(['image', 'background', 'svg', 'icon']), mime: z.string().optional(), inline: z.string().optional() }).strict()),
  usages: z.record(z.string(), z.object({ id, nodeId: id, regionId: id, resourceId: id, kind: z.enum(['img', 'picture', 'background', 'svg', 'icon']), attribute: z.string().optional(), media: z.string().optional(), visible: z.boolean() }).strict()),
  interactions: z.record(z.string(), z.object({ id, nodeId: id, regionId: id, kind: z.enum(['carousel', 'navigation', 'hover', 'link', 'control']), status: z.enum(['observed', 'declared', 'unobserved']), trackNodeId: id.optional(), itemNodeIds: z.array(id).optional(), cloneNodeIds: z.array(id).optional(), controlNodeIds: z.array(id).optional(), href: z.string().optional(), details: z.record(z.string(), z.union([z.string(), finite, z.boolean(), z.null()])) }).strict()),
  gaps: z.array(z.object({ code: z.string().min(1), message: z.string().min(1), nodeId: id.optional() }).strict()),
  commerceEvidence: CommerceObservationV2Schema.optional(),
}).strict();
export type ObservationPacketV2 = z.infer<typeof ObservationPacketV2Schema>;
export type ObservationCountsV2 = Record<'nodes' | 'regions' | 'texts' | 'styles' | 'layouts' | 'resources' | 'usages' | 'interactions', number>;
export interface ObservationManifestV2 {
  version: 2; kind: 'observation-manifest'; sourceUrl: string;
  provenance: { method: 'user-opened-browser' | 'agent-opened-browser' | 'public-capture'; observer: SourceObserverTool | 'playwright'; browser: 'chrome' | 'edge' | 'iab' | 'chromium' };
  packets: Array<{ path: string; sha256: string; snapshotId: string; regionIds: string[]; counts: ObservationCountsV2; dependencies: string[] }>;
  screenshots: Array<{ path: string; sha256: string; snapshotId: string }>;
  sceneInventories?: SceneInventoryRefV2[];
}
export interface ValidatedObservationV2 { manifest: ObservationManifestV2; manifestPath: string; manifestSha256: string; packets: ObservationPacketV2[]; packetFiles: Array<{ path: string; sha256: string; snapshotId: string }>; sceneInventories?: Array<{ ref: SceneInventoryRefV2; inventory: SceneInventoryV2 }> }
export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function observationCountsV2(packet: ObservationPacketV2): ObservationCountsV2 {
  return Object.fromEntries(['nodes', 'regions', 'texts', 'styles', 'layouts', 'resources', 'usages', 'interactions'].map(key => [key, Object.keys(packet[key as keyof ObservationCountsV2]).length])) as ObservationCountsV2;
}
/** Public-page facts are data. Credential/session exports and serialization truncation are rejected before target authentication. */
function assertUntruncated(value: unknown, location = '$'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${location}: non-finite number`);
  if (typeof value === 'string' && value.includes('[MaxDepth]')) throw new Error(`${location}: truncated [MaxDepth] observation`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(cookies?|set-cookie|authorization|storageState|localStorage|sessionStorage|accessToken|consumer_secret|wp_app_password)$/i.test(key)) throw new Error(`${location}.${key}: authentication/session exports are forbidden`);
    assertUntruncated(child, `${location}.${key}`);
  }
}
export function validateObservationPacketV2(value: unknown): ObservationPacketV2 {
  assertUntruncated(value);
  const result = ObservationPacketV2Schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid ObservationPacketV2: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const packet = result.data, regions = new Set(packet.regions.map(region => region.id));
  if (regions.size !== packet.regions.length) throw new Error('Duplicate region ID');
  const exists = (table: Record<string, unknown>, key: string | undefined, label: string) => { if (key !== undefined && !(key in table)) throw new Error(`${label}: dangling reference ${key}`); };
  for (const [key, node] of Object.entries(packet.nodes)) {
    if (key !== node.id) throw new Error(`nodes.${key}: key does not match ID`);
    if (!regions.has(node.regionId)) throw new Error(`nodes.${key}: unknown region ${node.regionId}`);
    exists(packet.nodes, node.parentId ?? undefined, `nodes.${key}.parentId`); exists(packet.styles, node.styleId, `nodes.${key}.styleId`); exists(packet.layouts, node.layoutId, `nodes.${key}.layoutId`);
    for (const child of node.childIds) { exists(packet.nodes, child, `nodes.${key}.childIds`); if (packet.nodes[child].parentId !== key) throw new Error(`nodes.${key}: child ${child} has a different parent`); }
    const ancestors = new Set<string>([key]); let parent = node.parentId;
    while (parent) { if (ancestors.has(parent)) throw new Error(`nodes.${key}: cyclic ancestry`); ancestors.add(parent); parent = packet.nodes[parent].parentId; }
    if (node.parentId && !packet.nodes[node.parentId].childIds.includes(key)) throw new Error(`nodes.${key}: parent is missing reciprocal child reference`);
  }
  for (const region of packet.regions) { exists(packet.nodes, region.nodeId, `regions.${region.id}.nodeId`); exists(packet.nodes, region.contentNodeId, `regions.${region.id}.contentNodeId`); if (packet.nodes[region.nodeId].regionId !== region.id || packet.nodes[region.contentNodeId].regionId !== region.id) throw new Error(`regions.${region.id}: wrong node ownership`); }
  for (const tableName of ['texts', 'usages', 'interactions'] as const) for (const [key, entity] of Object.entries(packet[tableName])) {
    if (entity.id !== key) throw new Error(`${tableName}.${key}: key does not match ID`);
    exists(packet.nodes, entity.nodeId, `${tableName}.${key}.nodeId`);
    if (!regions.has(entity.regionId) || packet.nodes[entity.nodeId].regionId !== entity.regionId) throw new Error(`${tableName}.${key}: wrong region ownership`);
  }
  for (const [key, usage] of Object.entries(packet.usages)) exists(packet.resources, usage.resourceId, `usages.${key}.resourceId`);
  for (const [key, interaction] of Object.entries(packet.interactions)) for (const nodeId of [interaction.trackNodeId, ...(interaction.itemNodeIds ?? []), ...(interaction.cloneNodeIds ?? []), ...(interaction.controlNodeIds ?? [])]) exists(packet.nodes, nodeId, `interactions.${key}`);
  for (const [key, layout] of Object.entries(packet.layouts)) if (key !== layout.id) throw new Error(`layouts.${key}: key does not match ID`);
  for (const node of Object.values(packet.nodes)) if (packet.layouts[node.layoutId].captureGeometry) {
    let current: typeof node | undefined = node, animated = false;
    while (current) {
      const style = packet.styles[current.styleId];
      if (style['animation-name'] && style['animation-name'] !== 'none' && (style['animation-duration'] ?? '').split(',').some(value => Number.parseFloat(value) > 0)) animated = true;
      current = current.parentId ? packet.nodes[current.parentId] : undefined;
    }
    if (!animated) throw new Error(`nodes.${node.id}: offset capture geometry requires an observed CSS animation owner`);
  }
  for (const [key, resource] of Object.entries(packet.resources)) if (key !== resource.id) throw new Error(`resources.${key}: key does not match ID`);
  const view = packet.snapshot.viewport;
  if (view.clientWidth > view.width || Math.abs(view.width - view.clientWidth - view.scrollbarWidth) > 1) throw new Error('snapshot.viewport: inconsistent clientWidth and scrollbarWidth');
  if (Math.abs(packet.snapshot.screenshot.width - view.width) > 24 || packet.snapshot.screenshot.height < view.height) throw new Error('snapshot.screenshot: dimensions do not cover the declared viewport');
  if (/access denied|verify (?:you are|your identity)|captcha|just a moment/i.test(packet.snapshot.title)) throw new Error('Challenge pages cannot become source facts');
  return packet;
}

/** Region chunks contain complete entity dependency closures, so every chunk is independently valid. */
export function chunkObservationPacketV2(input: ObservationPacketV2): ObservationPacketV2[] {
  const packet = validateObservationPacketV2(input);
  return packet.regions.map(region => {
    const nodes = Object.fromEntries(Object.entries(packet.nodes).filter(([, node]) => node.regionId === region.id).map(([key, node]) => [key, { ...node, parentId: node.parentId && packet.nodes[node.parentId].regionId === region.id ? node.parentId : null, childIds: node.childIds.filter(child => packet.nodes[child].regionId === region.id) }]));
    const scoped = <T extends { regionId: string }>(table: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(table).filter(([, entity]) => entity.regionId === region.id));
    const usages = scoped(packet.usages), interactions = scoped(packet.interactions);
    // Cross-region interaction controls are valid only in the complete packet; retain explicit dependencies in a single packet.
    if (Object.values(interactions).some(item => [item.trackNodeId, ...(item.itemNodeIds ?? []), ...(item.cloneNodeIds ?? []), ...(item.controlNodeIds ?? [])].some(key => key && !nodes[key]))) return packet;
    return validateObservationPacketV2({ ...packet, regions: [region], nodes, texts: scoped(packet.texts), usages, interactions, resources: Object.fromEntries(Object.entries(packet.resources).filter(([key]) => Object.values(usages).some(usage => usage.resourceId === key))), styles: Object.fromEntries(Object.entries(packet.styles).filter(([key]) => Object.values(nodes).some(node => node.styleId === key))), layouts: Object.fromEntries(Object.entries(packet.layouts).filter(([key]) => Object.values(nodes).some(node => node.layoutId === key))), gaps: packet.gaps.filter(gap => !gap.nodeId || nodes[gap.nodeId]) });
  }).filter((packet, index, all) => all.findIndex(other => sha256(JSON.stringify(other)) === sha256(JSON.stringify(packet))) === index);
}

export async function readObservationDirectoryV2(directory: string, expectedSourceUrl?: string, options: { manifestName?: string } = {}): Promise<ValidatedObservationV2> {
  const manifestName = options.manifestName ?? 'observation-manifest.json';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.json$/.test(manifestName) || /[\\/:]/.test(manifestName)) throw new Error('Observation manifestName must be a safe JSON filename within the observation directory');
  const root = await realpath(path.resolve(directory));
  const local = async (file: string, limit: number) => {
    const absolute = path.resolve(root, file), relative = path.relative(root, absolute);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || (await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error(`Observation evidence must stay within directory: ${file}`);
    const info = await stat(absolute); if (!info.isFile() || !info.size || info.size > limit) throw new Error(`Invalid observation file size: ${file}`);
    return { absolute, bytes: await readFile(absolute) };
  };
  const manifestFile = await local(manifestName, 4_000_000), value = JSON.parse(manifestFile.bytes.toString('utf8'));
  assertUntruncated(value);
  const countSchema = z.object(Object.fromEntries(['nodes', 'regions', 'texts', 'styles', 'layouts', 'resources', 'usages', 'interactions'].map(key => [key, finite.int().nonnegative()])) as Record<keyof ObservationCountsV2, z.ZodNumber>).strict();
  const parsed = z.object({ version: z.literal(2), kind: z.literal('observation-manifest'), sourceUrl: z.url(), provenance: z.object({ method: z.enum(['user-opened-browser', 'agent-opened-browser', 'public-capture']), observer: z.enum(['cua_repl', 'claude_browser', 'playwright']), browser: z.enum(['chrome', 'edge', 'iab', 'chromium']) }).strict(), packets: z.array(z.object({ path: z.string().min(1), sha256: hash, snapshotId: id, regionIds: z.array(id).min(1), counts: countSchema, dependencies: z.array(z.string()) }).strict()).min(1), screenshots: z.array(z.object({ path: z.string().min(1), sha256: hash, snapshotId: id }).strict()).min(1), sceneInventories: z.array(SceneInventoryRefV2Schema).min(1).optional() }).strict().safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ObservationManifestV2: ${parsed.error.message}`);
  const manifest = parsed.data as ObservationManifestV2;
  if (manifest.provenance.method !== 'public-capture' ? !sourceObserverProvenanceAllowed(manifest.provenance.method, manifest.provenance.observer, manifest.provenance.browser) : manifest.provenance.observer !== 'playwright' || manifest.provenance.browser !== 'chromium') throw new Error('Observation provenance method does not match its actual observer');
  await assertPublicUrl(manifest.sourceUrl);
  const normalized = (url: string) => { const parsed = new URL(url); parsed.hash = ''; return parsed.href; };
  if (expectedSourceUrl && normalized(expectedSourceUrl) !== normalized(manifest.sourceUrl)) throw new Error('Observation manifest does not identify the current source URL');
  const packets: ObservationPacketV2[] = [], packetFiles: ValidatedObservationV2['packetFiles'] = [];
  const knownFiles = new Set(manifest.packets.map(item => item.path));
  if (knownFiles.size !== manifest.packets.length) throw new Error('Duplicate observation packet paths');
  for (const record of manifest.packets) {
    if (record.dependencies.some(dependency => !knownFiles.has(dependency))) throw new Error(`Packet ${record.path}: dangling chunk dependency`);
    const file = await local(record.path, 50_000_000); if (sha256(file.bytes) !== record.sha256) throw new Error(`Packet hash mismatch: ${record.path}`);
    const packet = validateObservationPacketV2(JSON.parse(file.bytes.toString('utf8')));
    if (packet.snapshot.id !== record.snapshotId || normalized(packet.snapshot.url) !== normalized(manifest.sourceUrl)) throw new Error(`Packet identity mismatch: ${record.path}`);
    if (JSON.stringify(observationCountsV2(packet)) !== JSON.stringify(record.counts)) {
      const actual = observationCountsV2(packet); if (Object.keys(actual).some(key => actual[key as keyof ObservationCountsV2] !== record.counts[key as keyof ObservationCountsV2])) throw new Error(`Packet entity count mismatch: ${record.path}`);
    }
    if (JSON.stringify(packet.regions.map(region => region.id).sort()) !== JSON.stringify([...record.regionIds].sort())) throw new Error(`Packet region count mismatch: ${record.path}`);
    const screenshotRecord = manifest.screenshots.find(item => item.snapshotId === packet.snapshot.id);
    if (!screenshotRecord || screenshotRecord.path !== packet.snapshot.screenshot.path || screenshotRecord.sha256 !== packet.snapshot.screenshot.sha256) throw new Error(`Packet screenshot identity mismatch: ${record.path}`);
    const screenshot = await local(screenshotRecord.path, 30_000_000); if (sha256(screenshot.bytes) !== screenshotRecord.sha256) throw new Error(`Screenshot hash mismatch: ${screenshotRecord.path}`);
    const metadata = await sharp(screenshot.bytes, { limitInputPixels: 120_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || metadata.width !== packet.snapshot.screenshot.width || metadata.height !== packet.snapshot.screenshot.height || (metadata.pages ?? 1) !== 1) throw new Error(`Screenshot dimensions/format mismatch: ${screenshotRecord.path}`);
    packets.push(packet); packetFiles.push({ path: file.absolute, sha256: record.sha256, snapshotId: packet.snapshot.id });
  }
  if (!packets.some(packet => packet.snapshot.viewport.name === 'desktop')) throw new Error('Desktop source observation is required');
  // Chunks of a snapshot must agree on common metadata and overlapping facts.
  const seen = new Map<string, string>();
  for (const packet of packets) {
    const add = (key: string, entity: unknown) => { const bytes = JSON.stringify(entity); if (seen.has(key) && seen.get(key) !== bytes) throw new Error(`Conflicting observation chunks: ${key}`); seen.set(key, bytes); };
    add(`${packet.snapshot.id}:snapshot`, packet.snapshot);
    for (const table of ['nodes', 'texts', 'styles', 'layouts', 'resources', 'usages', 'interactions'] as const) for (const [key, entity] of Object.entries(packet[table])) add(`${packet.snapshot.id}:${table}:${key}`, entity);
  }
  for (const snapshotId of new Set(packets.map(packet => packet.snapshot.id))) {
    const text = packets.filter(packet => packet.snapshot.id === snapshotId).flatMap(packet => Object.values(packet.texts).map(item => item.text)).join(' ').replace(/\s+/g, ' ');
    if (text.length < 30 || /access denied|verify (?:that )?you are human|just a moment|checking your browser/i.test(text.slice(0, 1000))) throw new Error(`Snapshot ${snapshotId} does not show normal public page content`);
  }
  const sceneInventories: NonNullable<ValidatedObservationV2['sceneInventories']> = [];
  for (const ref of manifest.sceneInventories ?? []) {
    if (sceneInventories.some(item => item.ref.snapshotId === ref.snapshotId)) throw new Error('Duplicate independent scene inventory snapshot');
    const file = await local(ref.path, 30_000_000); if (sha256(file.bytes) !== ref.sha256) throw new Error('Independent scene inventory hash mismatch');
    const inventory = validateSceneInventoryV2(JSON.parse(file.bytes.toString('utf8'))), packet = packets.find(packet => packet.snapshot.id === ref.snapshotId);
    if (!packet || inventory.snapshotId !== ref.snapshotId || normalized(inventory.sourceUrl) !== normalized(manifest.sourceUrl) || inventory.viewport.name !== packet.snapshot.viewport.name || inventory.viewport.width !== packet.snapshot.viewport.width || inventory.viewport.height !== packet.snapshot.viewport.height) throw new Error('Independent scene inventory identifies a different loaded page');
    const observedRegionIds = new Set(packets.filter(item => item.snapshot.id === ref.snapshotId).flatMap(item => item.regions.map(region => region.id)));
    if (inventory.regions.some(region => !observedRegionIds.has(region.id)) || observedRegionIds.size !== inventory.regions.length) throw new Error('Independent scene inventory and captured region owners differ');
    sceneInventories.push({ ref: { ...ref, path: file.absolute }, inventory });
  }
  return { manifest, manifestPath: manifestFile.absolute, manifestSha256: sha256(manifestFile.bytes), packets, packetFiles, ...(sceneInventories.length ? { sceneInventories } : {}) };
}

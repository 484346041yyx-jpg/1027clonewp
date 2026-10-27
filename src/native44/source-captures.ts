import { createHash } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { validateSourceFactsV2, type SourceFactsV2 } from '../replica-v2/source.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import type { FileRef } from '../replica-v2/types.js';
import type { Native44CompareGap, Native44MeasuredModule } from './contracts.js';
import { opaqueSolidBackground, visiblePaint, visualBackgroundImageKind } from './visual-audit.js';
import { assertNative44ProfileIdentity, isDesktopBrowserProfile, native44ProfileViewports, type Native44ReplicationProfile } from './profile.js';
import { readNative44BrowserRendering, validateNative44BrowserObservation, verifyNative44BrowserSegmentPixels, type Native44BrowserObservation } from './source.js';
import { readObservationDirectoryV2 } from '../replica-v2/observation.js';
import { NATIVE44_SELECTION_RULES_HASH } from './selection-rules.js';
import { native44BodyCaptureScopeHash } from './capture-scope.js';

export interface Native44SourceCaptureSet {
  version: 1 | 2; replicationProfile?: Native44ReplicationProfile; taskId: string; collectionStartedAt: string; sourceFacts: FileRef; componentPlan: FileRef;
  selectionRulesHash?: string;
  viewports: Array<{ viewport: string; snapshotId: string; renderEvidence?: FileRef }>;
  collection?: FileRef;
  programBinding?: FileRef;
}
export interface Native44SourceRenderEvidence {
  version: 1; taskId: string; snapshotId: string; sourceUrl: string; capturedAt: string; screenshotHash: string;
  viewport: { width: number; height: number; clientWidth: number; devicePixelRatio: number };
  captureViewport?: { width: number; height: number; clientWidth: number; devicePixelRatio: number };
  viewportProjection?: { kind: 'verified-selected-body-equivalent-viewport'; captureScopeHash: string };
  fontsReady: boolean;
  observationMode?: 'readonlyDOM' | 'browser-decode';
  media: Array<{ nodeId: string; url: string; kind: 'image' | 'background' | 'svg' | 'icon'; decoded: boolean | null; drawable: boolean | null; naturalWidth: number; naturalHeight: number; currentSrc?: string; painted?: boolean; complete?: boolean; proof?: string }>;
  states: Array<{ nodeId: string; carouselIndex?: number; expanded?: boolean; hover?: boolean }>;
  hostDecodedAssets?: Native44ExportedAssetEvidence[];
  /** Added only to task-derived evidence; never rewrites the raw DOM states. */
  visualStateObservations?: Native44VisualStateObservation[];
  /** Populated only by this loader after decoding the referenced actual bytes. */
  verifiedAssetDecodes?: Array<{ url: string; sha256: string; decoder: 'sharp'; format: string; width: number; height: number }>;
  originalEvidence?: FileRef;
}
export interface Native44VisualStateObservation {
  method: 'codex-screenshot-review'; screenshotHash: string; nodeId: string; trackNodeId?: string;
  observedAt: string; index: number; notes: string; counterText?: string;
}
export interface Native44SourceStateEvidence {
  moduleKey: string; nodeId: string; trackNodeId: string; method: 'codex-screenshot-review';
  screenshotHash: string; observedAt: string; rawDOMIndex: number; screenshotIndex: number; notes: string; counterText?: string;
}
export interface Native44ExportedAssetEvidence {
  taskId: string; snapshotId: string; screenshotHash: string; url: string;
  exportedAt: string; provenance: 'current-browser-page-asset'; asset: FileRef;
}
interface Plan {
  replicationProfile?: Native44ReplicationProfile; selectionRulesHash?: string;
  sourceFacts: FileRef;
  components: Array<{ id: string; parentId?: string | null; variants: Array<{ snapshotId: string; nodeIds: string[]; visible: boolean }> }>;
  requirements?: Array<{ id: string; componentId: string; disposition: string; rule: string; verification: { kind: string; property?: string; snapshotId?: string; expected?: unknown } }>;
}
export interface LoadedNative44SourceCaptures { set: Native44SourceCaptureSet; facts: SourceFactsV2; plan: Plan; packets: Map<string, ObservationPacketV2[]>; renderEvidence: Map<string, Native44SourceRenderEvidence> }
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function timestamp(value: string, label: string): number { const result = Date.parse(value); if (!Number.isFinite(result)) throw Error(`Invalid ${label} timestamp`); return result; }
async function readRef<T>(reference: FileRef, base: string): Promise<T> { const filename = path.resolve(base, reference.path), bytes = await readFile(filename); if (digest(bytes) !== reference.sha256) throw Error(`Source capture evidence hash changed: ${filename}`); return JSON.parse(bytes.toString('utf8')) as T; }

/** Creates references only. The four observations must already have been made
 * in this task; no browser opens and no old source image is silently inherited. */
export async function prepareNative44SourceCaptures(options: { replicationProfile?: Native44ReplicationProfile; collection?: FileRef; taskId: string; sourceUrl: string; collectionStartedAt: string; sourceFacts: FileRef; componentPlan: FileRef; renderEvidenceBySnapshot?: Record<string, FileRef> }): Promise<Native44SourceCaptureSet> {
  const base = path.dirname(path.resolve(options.sourceFacts.path)), facts = validateSourceFactsV2(await readRef(options.sourceFacts, base));
  if (facts.sourceUrl !== options.sourceUrl) throw Error('Source capture URL differs from this task source URL');
  const desktop = isDesktopBrowserProfile(options.replicationProfile), standard = native44ProfileViewports(options.replicationProfile);
  if (desktop && facts.snapshots.length !== standard.length) throw Error('Desktop browser source requires exactly two snapshots');
  const viewports = standard.map(item => { const matches = facts.snapshots.filter(snapshot => snapshot.viewport.width === item.width && (!desktop || snapshot.viewport.height === item.height)); if (matches.length !== 1) throw Error(`Source comparison needs one actual ${item.width}px snapshot`); return { viewport: item.name, snapshotId: matches[0].id, ...(options.renderEvidenceBySnapshot?.[matches[0].id] ? { renderEvidence: options.renderEvidenceBySnapshot[matches[0].id] } : {}) }; });
  const set: Native44SourceCaptureSet = { version: desktop ? 2 : 1, ...(options.replicationProfile ? { replicationProfile: options.replicationProfile, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH } : {}), ...(options.collection ? { collection: options.collection } : {}), taskId: options.taskId, collectionStartedAt: options.collectionStartedAt, sourceFacts: { ...options.sourceFacts, path: path.resolve(options.sourceFacts.path) }, componentPlan: { ...options.componentPlan, path: path.resolve(options.componentPlan.path) }, viewports };
  await loadNative44SourceCaptures(set, { taskId: options.taskId, sourceUrl: options.sourceUrl, replicationProfile: options.replicationProfile }); return set;
}

export async function loadNative44SourceCaptures(set: Native44SourceCaptureSet, identity: { taskId: string; sourceUrl: string; replicationProfile?: Native44ReplicationProfile; expectedSelectionRulesHash?: string }): Promise<LoadedNative44SourceCaptures> {
  assertNative44ProfileIdentity(set.replicationProfile, identity.replicationProfile);
  const desktop = isDesktopBrowserProfile(set.replicationProfile), standard = native44ProfileViewports(set.replicationProfile);
  if (identity.expectedSelectionRulesHash !== undefined && !/^[a-f0-9]{64}$/.test(identity.expectedSelectionRulesHash)) throw Error('Invalid verified historical selection rules hash');
  if (desktop ? set.selectionRulesHash !== (identity.expectedSelectionRulesHash ?? NATIVE44_SELECTION_RULES_HASH) : set.selectionRulesHash !== undefined) throw Error('Source capture selection rules hash differs from its replication profile');
  if (set.version !== (desktop ? 2 : 1) || set.taskId !== identity.taskId || set.viewports.length !== standard.length || new Set(set.viewports.map(view => view.viewport)).size !== standard.length || new Set(set.viewports.map(view => view.snapshotId)).size !== standard.length) throw Error('Source capture set has incomplete current-task identity');
  const started = timestamp(set.collectionStartedAt, 'source collection'), base = path.dirname(path.resolve(set.sourceFacts.path)), facts = validateSourceFactsV2(await readRef(set.sourceFacts, base)), plan = await readRef<Plan>(set.componentPlan, base);
  let boundRendering: Map<string, { reference: FileRef }> | undefined;
  let boundCaptureScopeHash: string | undefined;
  assertNative44ProfileIdentity(set.replicationProfile, plan.replicationProfile); if (plan.selectionRulesHash !== set.selectionRulesHash) throw Error('Source component plan selection rules identity differs');
  if (facts.sourceUrl !== identity.sourceUrl || plan.sourceFacts.sha256 !== set.sourceFacts.sha256) throw Error('Source comparison facts/plan belong to a different source identity');
  if (desktop && (!set.collection || facts.snapshots.length !== standard.length)) throw Error('Desktop browser source requires bound user-tab collection evidence');
  if (set.collection) { const collection = await readRef<{replicationProfile?: Native44ReplicationProfile; selectionRulesHash?: string; taskId: string; sourceUrl: string; collectionStartedAt: string} & Partial<Native44BrowserObservation>>(set.collection, base); assertNative44ProfileIdentity(set.replicationProfile, collection.replicationProfile); if (collection.selectionRulesHash !== set.selectionRulesHash) throw Error('Source collection selection rules identity differs'); if (collection.taskId !== identity.taskId || collection.sourceUrl !== identity.sourceUrl || collection.collectionStartedAt !== set.collectionStartedAt) throw Error('Raw collection identity/time differs from the bound comparison source'); if (desktop) { const observation = await readObservationDirectoryV2(path.dirname(path.resolve(base, facts.observation.path)), identity.sourceUrl, { manifestName: path.basename(facts.observation.path) }); if (observation.manifestSha256 !== facts.observation.sha256) throw Error('Browser source observation manifest hash changed'); const binding = validateNative44BrowserObservation({ version: collection.version, replicationProfile: collection.replicationProfile, browserObservation: collection.browserObservation, renderEvidenceBySnapshot: collection.renderEvidenceBySnapshot, ...(collection.captureScope ? { captureScope: collection.captureScope } : {}) }, observation, identity.sourceUrl); await verifyNative44BrowserSegmentPixels(binding, path.dirname(observation.manifestPath), observation); if (binding.captureScope?.selection) boundCaptureScopeHash = native44BodyCaptureScopeHash(binding.captureScope); boundRendering = await readNative44BrowserRendering(binding, path.dirname(observation.manifestPath), observation); } }
  if (set.programBinding) { const program = await readRef<{replicationProfile?: Native44ReplicationProfile; selectionRulesHash?: string; taskId: string; sourceUrl: string; sourceFacts: FileRef; componentPlan: FileRef}>(set.programBinding, base); assertNative44ProfileIdentity(set.replicationProfile, program.replicationProfile); if (program.selectionRulesHash !== set.selectionRulesHash) throw Error('Source program selection rules identity differs'); if (program.taskId !== identity.taskId || program.sourceUrl !== identity.sourceUrl || program.sourceFacts.sha256 !== set.sourceFacts.sha256 || program.componentPlan.sha256 !== set.componentPlan.sha256) throw Error('Program binding differs from the captured comparison source'); }
  const packets = new Map<string, ObservationPacketV2[]>(), renderEvidence = new Map<string, Native44SourceRenderEvidence>(), fileCache = new Map<string, ObservationPacketV2>();
  for (const reference of set.viewports) {
    const expected = standard.find(item => item.name === reference.viewport), snapshot = facts.snapshots.find(item => item.id === reference.snapshotId);
    if (desktop && (!reference.renderEvidence || reference.renderEvidence.sha256 !== boundRendering?.get(reference.snapshotId)?.reference.sha256)) throw Error('Desktop source snapshot requires its explicit actual render evidence binding');
    if (!expected || !snapshot || snapshot.viewport.width !== expected.width || desktop && snapshot.viewport.height !== expected.height) throw Error('Source snapshot is not the actual required comparison viewport');
    const png = await readFile(path.resolve(base, snapshot.screenshot.path)); if (digest(png) !== snapshot.screenshot.sha256) throw Error('Source screenshot bytes changed');
    const dimensions = await sharp(png).metadata(); if (dimensions.width !== snapshot.screenshot.width || dimensions.height !== snapshot.screenshot.height) throw Error('Source screenshot dimensions differ from captured evidence');
    const rows: ObservationPacketV2[] = [];
    for (const packetRef of snapshot.evidence) {
      const key = `${packetRef.path}:${packetRef.sha256}`;
      let packet = fileCache.get(key); if (!packet) { packet = validateObservationPacketV2(await readRef(packetRef, base)); fileCache.set(key, packet); }
      if (packet.snapshot.id !== snapshot.id || packet.snapshot.url !== identity.sourceUrl || packet.snapshot.screenshot.sha256 !== snapshot.screenshot.sha256 || packet.snapshot.viewport.width !== snapshot.viewport.width || packet.snapshot.viewport.height !== snapshot.viewport.height || packet.snapshot.viewport.clientWidth !== snapshot.viewport.clientWidth || packet.snapshot.viewport.devicePixelRatio !== snapshot.viewport.devicePixelRatio) throw Error('Source packet does not belong to this exact snapshot or source URL');
      if (timestamp(packet.snapshot.capturedAt, 'source capture') < started) throw Error('A previous-task source capture cannot substitute for a new observation');
      if (packet.snapshot.screenshot.height < packet.snapshot.pageHeight - 1) throw Error('Source screenshot does not cover the complete observed page');
      rows.push(packet);
    }
    packets.set(snapshot.id, rows);
    if (reference.renderEvidence) {
      const observed = await readRef<Native44SourceRenderEvidence>(reference.renderEvidence, base);
      if (desktop && observed.fontsReady !== true) throw Error('Desktop source font readiness is not verified before writing');
      if (desktop && observed.originalEvidence) {
        const original = await readRef<Native44SourceRenderEvidence>(observed.originalEvidence, path.dirname(path.resolve(base, reference.renderEvidence.path)));
        if (original.snapshotId !== observed.snapshotId || original.sourceUrl !== observed.sourceUrl || original.screenshotHash !== observed.screenshotHash || JSON.stringify(original.media) !== JSON.stringify(observed.media) || JSON.stringify(original.states) !== JSON.stringify(observed.states)) throw Error('Derived source rendering differs from its original browser facts');
        const keys = ['width','height','clientWidth','devicePixelRatio'] as const;
        if (keys.some(key => original.viewport[key] !== observed.viewport[key]) && (!observed.viewportProjection || !boundCaptureScopeHash || observed.viewportProjection.captureScopeHash !== boundCaptureScopeHash || keys.some(key => original.viewport[key] !== observed.captureViewport?.[key]))) throw Error('Derived source rendering changed its viewport without a verified equivalent capture');
      }
      if (observed.viewportProjection && (!boundCaptureScopeHash || observed.viewportProjection.kind !== 'verified-selected-body-equivalent-viewport' || observed.viewportProjection.captureScopeHash !== boundCaptureScopeHash || !observed.originalEvidence || !observed.captureViewport)) throw Error('Source rendering viewport projection lacks its bound equivalence proof');
      if (observed.version !== 1 || observed.taskId !== identity.taskId || observed.snapshotId !== snapshot.id || observed.sourceUrl !== identity.sourceUrl || observed.screenshotHash !== snapshot.screenshot.sha256 || timestamp(observed.capturedAt, 'source rendering') < started || !['width', 'height', 'clientWidth', 'devicePixelRatio'].every(key => observed.viewport[key as keyof typeof observed.viewport] === snapshot.viewport[key as keyof typeof observed.viewport])) throw Error('Source rendering evidence is not bound to the actual current-task screenshot/viewport');
      if (!Array.isArray(observed.media) || !Array.isArray(observed.states)) throw Error('Source rendering evidence is missing typed media/state arrays');
      for (const media of observed.media) if (!snapshot.nodes[media.nodeId] || !['image', 'background', 'svg', 'icon'].includes(media.kind) || typeof media.url !== 'string' || !(typeof media.decoded === 'boolean' || media.decoded === null && observed.observationMode === 'readonlyDOM' && media.kind !== 'image') || !(typeof media.drawable === 'boolean' || media.drawable === null && observed.observationMode === 'readonlyDOM' && ['background', 'icon'].includes(media.kind)) || !Number.isFinite(media.naturalWidth) || !Number.isFinite(media.naturalHeight) || media.naturalWidth < 0 || media.naturalHeight < 0 || media.currentSrc !== undefined && typeof media.currentSrc !== 'string') throw Error('Source rendering media is not an actual typed node observation');
      for (const state of observed.states) if (!snapshot.nodes[state.nodeId] || state.carouselIndex !== undefined && (!Number.isInteger(state.carouselIndex) || state.carouselIndex < 0)) throw Error('Source rendering state is not an actual logical node observation');
      if (observed.visualStateObservations !== undefined && !Array.isArray(observed.visualStateObservations)) throw Error('Screenshot visual state observations require a typed array');
      const visualKeys = new Set<string>();
      for (const frame of observed.visualStateObservations ?? []) {
        const owners = rows.flatMap(packet => Object.values(packet.interactions)).filter(interaction => interaction.kind === 'carousel' && interaction.nodeId === frame.nodeId && interaction.trackNodeId && (!frame.trackNodeId || frame.trackNodeId === interaction.trackNodeId));
        const matching = [...new Map(owners.map(interaction => [interaction.trackNodeId, interaction])).values()];
        const owner = matching.length === 1 ? matching[0] : undefined, count = owner?.itemNodeIds?.length ?? 0, key = `${frame.nodeId}:${owner?.trackNodeId}`;
        if (frame.method !== 'codex-screenshot-review' || frame.screenshotHash !== snapshot.screenshot.sha256 || timestamp(frame.observedAt, 'screenshot visual state') < started || !frame.notes?.trim() || !Number.isInteger(frame.index) || frame.index < 0 || !owner || count < 1 || frame.index >= count || !observed.states.some(state => state.nodeId === frame.nodeId && state.carouselIndex !== undefined) || visualKeys.has(key)) throw Error('Screenshot visual state is not bound to one actual source owner/track and logical item set');
        if (frame.counterText !== undefined) { const counter = frame.counterText.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/); if (!counter || Number(counter[1]) - 1 !== frame.index || Number(counter[2]) !== count) throw Error('Screenshot counter does not match its observed visual index or original item count'); }
        visualKeys.add(key);
      }
      // Never trust a supplied decoder result. Only actual current-task exported
      // bytes can complement the browser's observed background paintability.
      observed.verifiedAssetDecodes = [];
      for (const asset of observed.hostDecodedAssets ?? []) {
        if (asset.taskId !== identity.taskId || asset.snapshotId !== snapshot.id || asset.screenshotHash !== snapshot.screenshot.sha256 || asset.provenance !== 'current-browser-page-asset' || timestamp(asset.exportedAt, 'source asset export') < started || !observed.media.some(media => media.url === asset.url && ['background', 'icon'].includes(media.kind)) || !/^[a-f0-9]{64}$/.test(asset.asset?.sha256 ?? '')) throw Error('Exported source asset is not bound to the current browser observation');
        const bytes = await readFile(path.resolve(base, asset.asset.path)); if (digest(bytes) !== asset.asset.sha256) throw Error('Exported source asset bytes changed');
        if (bytes.length > 64 * 1024 * 1024) throw Error('Exported source asset exceeds the verified decoding limit');
        const image = sharp(bytes, { limitInputPixels: 100_000_000 }), metadata = await image.metadata(), decoded = await image.raw().toBuffer({ resolveWithObject: true });
        if (!metadata.format || decoded.info.width <= 0 || decoded.info.height <= 0 || !decoded.data.length) throw Error('Exported source asset did not decode into actual pixels');
        observed.verifiedAssetDecodes.push({ url: asset.url, sha256: asset.asset.sha256, decoder: 'sharp', format: metadata.format, width: decoded.info.width, height: decoded.info.height });
      }
      renderEvidence.set(snapshot.id, observed);
    }
  }
  const loaded = { set, facts, plan, packets, renderEvidence };
  if (desktop) for (const view of standard) { const rendered = await readNative44SourceCapture(loaded, view, plan.components.map(component => ({ key: component.id }))); if (rendered.gaps.some(gap => gap.blocking) || rendered.modules.some(module => module.media?.some(media => media.drawable !== true))) throw Error(`Desktop source rendering is incomplete or unverified before writing: ${view.name}`); }
  return loaded;
}

/** Explicit job references supply collection provenance. No date, sibling
 * directory, component name or older observation is guessed as a substitute. */
export async function prepareNative44JobSourceCaptures(input: { root: string; jobDir: string; filename: string; programHash: string; program: { replicationProfile?: Native44ReplicationProfile; selectionRulesHash?: string; taskId: string; sourceUrl: string; sourceFacts: FileRef; componentPlan: FileRef } }): Promise<Native44SourceCaptureSet> {
  const job = JSON.parse(await readFile(path.join(input.jobDir, 'job.json'), 'utf8')) as { replicationProfile?: Native44ReplicationProfile; selectionRulesHash?: string; jobDir: string; programPath: string; sourceFactsPath: string; sourceCollection?: FileRef; sourceRenderEvidenceBySnapshot?: Record<string, FileRef> };
  assertNative44ProfileIdentity(job.replicationProfile, input.program.replicationProfile);
  if (job.selectionRulesHash !== input.program.selectionRulesHash || isDesktopBrowserProfile(job.replicationProfile) && job.selectionRulesHash !== NATIVE44_SELECTION_RULES_HASH) throw Error('Job/program selection rules identity differs');
  if (!job.sourceCollection || path.resolve(job.jobDir) !== path.resolve(input.jobDir) || path.resolve(job.programPath) !== path.resolve(input.filename) || path.resolve(job.sourceFactsPath) !== path.resolve(input.jobDir, input.program.sourceFacts.path)) throw Error('Native44 source collection requires an explicit matching job/program/source-facts binding');
  const contained = (reference: FileRef): FileRef => { const filename = path.resolve(input.jobDir, reference.path), relative = path.relative(input.root, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Native44 source collection reference escaped the project'); return { path: filename, sha256: reference.sha256 }; };
  const collection = contained(job.sourceCollection), record = await readRef<{ taskId: string; sourceUrl: string; collectionStartedAt: string }>(collection, input.jobDir);
  if (record.taskId !== input.program.taskId || record.sourceUrl !== input.program.sourceUrl) throw Error('Raw source collection belongs to another task or source URL');
  if (digest(await readFile(input.filename)) !== input.programHash) throw Error('Program changed before source collection binding');
  const set = await prepareNative44SourceCaptures({ replicationProfile: input.program.replicationProfile, collection, taskId: input.program.taskId, sourceUrl: input.program.sourceUrl, collectionStartedAt: record.collectionStartedAt, sourceFacts: contained(input.program.sourceFacts), componentPlan: contained(input.program.componentPlan), renderEvidenceBySnapshot: Object.fromEntries(Object.entries(job.sourceRenderEvidenceBySnapshot ?? {}).map(([snapshotId, reference]) => [snapshotId, contained(reference)])) });
  return { ...set, collection, programBinding: { path: input.filename, sha256: input.programHash } };
}

export async function readNative44SourceCapture(loaded: LoadedNative44SourceCaptures, viewport: { name: string; width: number; height: number }, modules: Array<{ key: string }>, outputPNG?: string): Promise<{ screenshot: string; sha256: string; modules: Native44MeasuredModule[]; clientWidth: number; devicePixelRatio: number; gaps: Native44CompareGap[]; snapshotId: string; stateEvidence: Native44SourceStateEvidence[] }> {
  const reference = loaded.set.viewports.find(item => item.viewport === viewport.name), snapshot = loaded.facts.snapshots.find(item => item.id === reference?.snapshotId);
  if (!snapshot || snapshot.viewport.width !== viewport.width || snapshot.viewport.height !== viewport.height) throw Error('Requested target viewport differs from the actual source capture');
  const packets = loaded.packets.get(snapshot.id)!, observed = loaded.renderEvidence.get(snapshot.id), gaps: Native44CompareGap[] = [], result: Native44MeasuredModule[] = [], stateEvidence: Native44SourceStateEvidence[] = [];
  if (!observed?.fontsReady) gaps.push({ category: 'evidence', viewport: viewport.name, detail: 'Source font readiness was not observed for the bound screenshot', blocking: true });
  const nodes = Object.assign({}, ...packets.map(packet => packet.nodes)) as ObservationPacketV2['nodes'];
  const layouts = Object.assign({}, ...packets.map(packet => packet.layouts)) as ObservationPacketV2['layouts'];
  const styles = Object.assign({}, ...packets.map(packet => packet.styles)) as ObservationPacketV2['styles'];
  const texts = Object.values(Object.assign({}, ...packets.map(packet => packet.texts))) as Array<ObservationPacketV2['texts'][string]>;
  const usages = Object.values(Object.assign({}, ...packets.map(packet => packet.usages))) as Array<ObservationPacketV2['usages'][string]>;
  const resources = Object.assign({}, ...packets.map(packet => packet.resources)) as ObservationPacketV2['resources'];
  const interactions = Object.values(Object.assign({}, ...packets.map(packet => packet.interactions))) as Array<ObservationPacketV2['interactions'][string]>;
  const actuallyVisible = (nodeId: string): boolean => {
    const node = nodes[nodeId], rect = node && layouts[node.layoutId]?.rect;
    if (!node?.visible || !rect || rect.width <= 0 || rect.height <= 0) return false;
    const seen = new Set<string>(); let owner: typeof node | undefined = node;
    while (owner && !seen.has(owner.id)) {
      seen.add(owner.id); const css = styles[owner.styleId];
      if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0) return false;
      owner = owner.parentId ? nodes[owner.parentId] : undefined;
    }
    return true;
  };
  for (const module of modules) {
    const planned = loaded.plan.components.find(item => item.id === module.key), variant = planned?.variants.find(item => item.snapshotId === snapshot.id);
    if (!variant?.nodeIds.length || variant.nodeIds.some(nodeId => !nodes[nodeId])) { result.push({ key: module.key, count: 0, visible: false }); continue; }
    const within = (nodeId: string): boolean => { const seen = new Set<string>(); let current: string | null = nodeId; while (current && !seen.has(current)) { if (variant.nodeIds.includes(current)) return true; seen.add(current); current = nodes[current]?.parentId ?? null; } return false; };
    const owners = variant.nodeIds.map(nodeId => nodes[nodeId]), rectangles = owners.map(node => layouts[node.layoutId].rect), left = Math.min(...rectangles.map(rect => rect.x)), top = Math.min(...rectangles.map(rect => rect.y)), right = Math.max(...rectangles.map(rect => rect.x + rect.width)), bottom = Math.max(...rectangles.map(rect => rect.y + rect.height));
    const visible = owners.some(owner => owner.visible), css = Object.fromEntries(Object.entries(styles[owners[0].styleId]).filter(([property, value]) => owners.every(owner => styles[owner.styleId][property] === value)));
    const background = (start: string): string | null => {
      const seen = new Set<string>(); let cursor: string | null = start;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor); const node: ObservationPacketV2['nodes'][string] | undefined = nodes[cursor], solid = node && opaqueSolidBackground(styles[node.styleId]);
        if (solid !== undefined) return solid;
        cursor = node?.parentId ?? null;
      }
      return null;
    };
    const control = (start: string) => {
      const seen = new Set<string>(); let cursor: string | null = start;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor); const node: ObservationPacketV2['nodes'][string] | undefined = nodes[cursor]; if (!node) break;
        if (['a', 'button'].includes(node.tag.toLowerCase()) || ['tab', 'button', 'link'].includes(node.attributes.role ?? '')) {
          const style = styles[node.styleId], rect = layouts[node.layoutId]?.rect;
          if (!rect) return undefined;
          return { width: rect.width, height: rect.height, background: style['background-color'] ?? '', color: style.color ?? '', borderBottomWidth: style['border-bottom-width'] ?? style['border-width'] ?? '0px', beforeContent: style['before:content'] ?? 'none', afterContent: style['after:content'] ?? 'none' };
        }
        cursor = node.parentId;
      }
      return undefined;
    };
    const visualTexts = texts.filter(text => within(text.nodeId) && actuallyVisible(text.nodeId) && text.text.trim().length >= 3 && text.text.trim().length <= 240).flatMap(text => {
      const node = nodes[text.nodeId], style = styles[node.styleId];
      const rect = layouts[node.layoutId].rect, lineHeight = Number.parseFloat(style['line-height'] ?? ''), lineCount = Number.isFinite(lineHeight) && lineHeight > 0 ? Math.max(1, Math.round(rect.height / lineHeight)) : undefined;
      return [{ text: text.text, color: style.color ?? '', fontSize: style['font-size'] ?? '', lineHeight: style['line-height'] ?? '', x: rect.x - left, width: rect.width, height: rect.height, ...(lineCount ? { lineCount } : {}), whiteSpace: style['white-space'] ?? '', ...(control(text.nodeId) ? { control: control(text.nodeId) } : {}) }];
    }).slice(0, 160);
    const progress = Object.values(nodes).filter(node => within(node.id) && /(?:^|\s)(?:splide-carousel-progress|swiper-pagination-progressbar|wd-[\w-]*progress)(?:\s|$)/.test(node.attributes.class ?? '') && !/progress(?:-bar|bar-fill)/.test((node.attributes.class ?? '').replace(/(?:^|\s)splide-carousel-progress(?:\s|$)/, ''))).map(node => {
      const rect = layouts[node.layoutId]?.rect; if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      const fill = node.childIds.map(id => nodes[id]).find(child => child && /(?:progress-bar|progressbar-fill)/.test(child.attributes.class ?? ''));
      const fillRect = fill && layouts[fill.layoutId]?.rect;
      return { x: rect.x - left, width: rect.width, height: rect.height, background: styles[node.styleId]['background-color'] ?? '', fillFraction: fillRect ? fillRect.width / rect.width : null };
    }).filter((row): row is NonNullable<typeof row> => row !== null);
    const arrows = Object.values(nodes).filter(node => within(node.id) && ['button', 'a'].includes(node.tag.toLowerCase())).flatMap(node => {
      const name = `${node.attributes.class ?? ''} ${node.attributes['aria-label'] ?? ''}`;
      const side = /(?:^|[\s_-])prev(?:ious)?(?:[\s_-]|$)/i.test(name) ? 'prev' as const : /(?:^|[\s_-])next(?:[\s_-]|$)/i.test(name) ? 'next' as const : null;
      if (!side || !/(?:arrow|swiper-button|slider-button|carousel-button|splide)/i.test(name)) return [];
      const style = styles[node.styleId], rect = layouts[node.layoutId]?.rect, icon = node.childIds.map(id => nodes[id]).find(child => child && ['svg', 'i'].includes(child.tag.toLowerCase()));
      if (!rect) return [];
      const iconStyle = icon && styles[icon.styleId], iconRect = icon && layouts[icon.layoutId]?.rect;
      const pseudo = !iconStyle && (style['before:content'] && !['none', 'normal'].includes(style['before:content']) ? 'before' : style['after:content'] && !['none', 'normal'].includes(style['after:content']) ? 'after' : null);
      const size = (value: string | undefined, fallback: number) => /^\d+(?:\.\d+)?px$/.test(value ?? '') ? Number.parseFloat(value!) : fallback;
      return [{ side, x: rect.x - left, width: size(style.width, rect.width), height: size(style.height, rect.height), background: style['background-color'] ?? '', color: style.color ?? '', borderRadius: style['border-radius'] ?? '', iconWidth: iconStyle ? size(iconStyle.width, iconRect?.width ?? 0) : pseudo ? size(style[`${pseudo}:width`], size(style[`${pseudo}:font-size`], 0)) : null, iconHeight: iconStyle ? size(iconStyle.height, iconRect?.height ?? 0) : pseudo ? size(style[`${pseudo}:height`], size(style[`${pseudo}:font-size`], 0)) : null }];
    });
    const paintLayers = Object.values(nodes).filter(node => within(node.id) && actuallyVisible(node.id)).flatMap(node => {
      const rect = layouts[node.layoutId]?.rect, style = styles[node.styleId];
      if (!rect || !visiblePaint(style)) return [];
      return [{ x: rect.x - left, y: rect.y - top, width: rect.width, height: rect.height,
        background: style['background-color'] ?? '', backgroundImage: visualBackgroundImageKind(style['background-image'] ?? ''),
        borderWidth: style['border-width'] ?? '0px', borderColor: style['border-color'] ?? '', borderRadius: style['border-radius'] ?? '0px',
        boxShadow: style['box-shadow'] ?? 'none', opacity: style.opacity ?? '1' }];
    });
    const mediaGeometry = Object.values(nodes).filter(node => within(node.id) && ['img', 'svg'].includes(node.tag.toLowerCase()) && actuallyVisible(node.id)).slice(0, 100).map(node => {
      const rect = layouts[node.layoutId].rect;
      return { x: rect.x - left, y: rect.y - top, width: rect.width, height: rect.height };
    });
    if (visible !== variant.visible) gaps.push({ category: 'structure', moduleKey: module.key, viewport: viewport.name, detail: 'Planned source variant visibility differs from the actual source node observation', blocking: true });
    const paintedPositions = new Set<string>();
    const media = usages.filter(usage => usage.visible && nodes[usage.nodeId]?.visible && within(usage.nodeId)).flatMap(usage => {
      const url = resources[usage.resourceId].url, kind = usage.kind === 'background' ? 'background' : usage.kind === 'svg' ? 'svg' : usage.kind === 'icon' ? 'icon' : 'image';
      const actualUses = observed?.media.filter(item => item.nodeId === usage.nodeId && item.kind === kind) ?? [];
      const proof = actualUses.find(item => (item.currentSrc || item.url) === url);
      // Alternative src/srcset resources remain immutable source facts. They
      // are not separate painted images when actual currentSrc proves another
      // choice at this viewport. Each physical node still has its own use.
      if (kind === 'image' && actualUses.length && !proof) return [];
      if (kind === 'image' && !actualUses.length && usage.attribute === 'srcset') return [];
      if (proof?.painted === false) return [];
      const position = `${usage.nodeId}:${kind}:${url}`; if (paintedPositions.has(position)) return []; paintedPositions.add(position);
      const hostPixels = observed?.verifiedAssetDecodes?.find(asset => asset.url === url);
      const svgGeometry = kind === 'svg' && proof?.decoded === null && proof.drawable === true && proof.painted === true && ['browser-svg-graphics-bbox+bound-screenshot', 'browser-svg-client-rect+bound-screenshot'].includes(proof.proof ?? '') && proof.naturalWidth > 0 && proof.naturalHeight > 0;
      const hostBackground = ['background', 'icon'].includes(kind) && proof?.painted === true && hostPixels && hostPixels.width > 0 && hostPixels.height > 0;
      return [{ url, kind, drawable: proof ? svgGeometry || Boolean(hostBackground) || (proof.decoded === null || proof.drawable === null ? null : proof.decoded && proof.drawable && proof.naturalWidth > 0 && proof.naturalHeight > 0) : null }];
    });
    for (const nodeId of new Set(usages.filter(usage => usage.visible && nodes[usage.nodeId]?.visible && within(usage.nodeId) && ['img', 'picture'].includes(usage.kind)).map(usage => usage.nodeId))) {
      const actual = observed?.media.filter(item => item.nodeId === nodeId && item.kind === 'image' && item.painted !== false) ?? [], recorded = usages.filter(usage => usage.nodeId === nodeId && ['img', 'picture'].includes(usage.kind)).map(usage => resources[usage.resourceId].url);
      if (actual.some(item => !recorded.includes(item.currentSrc || item.url))) gaps.push({ category: 'evidence', moduleKey: module.key, viewport: viewport.name, detail: 'Source currentSrc changed between its DOM and render observations; the source screenshot state is not coherent', blocking: true });
    }
    // Responsive alternatives retain all raw observations. A broad owner can
    // remain visible while its carousel track is hidden. Also a component may
    // explicitly bind that track while its runtime state lives on an ancestor.
    type EffectiveState = Native44SourceRenderEvidence['states'][number] & { visualFrame?: Native44VisualStateObservation; trackNodeId?: string };
    const states = observed?.states.flatMap<EffectiveState>(state => {
      const ownedCarousels = state.carouselIndex === undefined ? [] : interactions.filter(interaction => interaction.kind === 'carousel' && interaction.nodeId === state.nodeId && interaction.trackNodeId);
      if (ownedCarousels.length) {
        const visibleTracks = ownedCarousels.filter(interaction => actuallyVisible(interaction.trackNodeId!) && (within(state.nodeId) || within(interaction.trackNodeId!)));
        if (visibleTracks.length !== 1) return [];
        const trackNodeId = visibleTracks[0].trackNodeId!, frame = observed.visualStateObservations?.find(frame => frame.nodeId === state.nodeId && (!frame.trackNodeId || frame.trackNodeId === trackNodeId));
        return [{ ...state, ...(frame ? { carouselIndex: frame.index, visualFrame: frame, trackNodeId } : {}) }];
      }
      return within(state.nodeId) && actuallyVisible(state.nodeId) ? [state] : [];
    }) ?? [];
    const exactStates = states.filter(state => variant.nodeIds.includes(state.nodeId));
    const state = exactStates.length === 1 ? exactStates[0] : states.length === 1 ? states[0] : undefined;
    if (state?.visualFrame) { const frame = state.visualFrame; stateEvidence.push({ moduleKey: module.key, nodeId: state.nodeId, trackNodeId: state.trackNodeId!, method: frame.method, screenshotHash: frame.screenshotHash, observedAt: frame.observedAt, rawDOMIndex: observed!.states.find(raw => raw.nodeId === state.nodeId)!.carouselIndex!, screenshotIndex: frame.index, notes: frame.notes, ...(frame.counterText ? { counterText: frame.counterText } : {}) }); }
    result.push({ key: module.key, count: 1, visible, box: { x: left, y: top, width: right - left, height: bottom - top }, css, media, visual: { solidBackground: background(owners[0].id), texts: visualTexts, progress, arrows, mediaGeometry, paintLayers }, ...(state ? { state: { carouselIndex: state.carouselIndex, expanded: state.expanded, hover: state.hover } } : {}) });
  }
  const extension = path.extname(snapshot.screenshot.path).toLowerCase(), originalFile = path.resolve(path.dirname(loaded.set.sourceFacts.path), snapshot.screenshot.path), outputFile = outputPNG ? ['.jpg', '.jpeg', '.webp', '.png'].includes(extension) ? outputPNG.slice(0, outputPNG.length - path.extname(outputPNG).length) + extension : outputPNG : originalFile;
  if (outputPNG) await copyFile(originalFile, outputFile);
  if (digest(await readFile(outputFile)) !== snapshot.screenshot.sha256) throw Error('Copied source screenshot does not match its source observation');
  return { screenshot: outputFile, sha256: snapshot.screenshot.sha256, modules: result, clientWidth: snapshot.viewport.clientWidth, devicePixelRatio: snapshot.viewport.devicePixelRatio, gaps, snapshotId: snapshot.id, stateEvidence };
}

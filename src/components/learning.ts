import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../native44/catalog.js';
import { observationCountsV2, validateObservationPacketV2, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { sourceObserverProvenanceAllowed } from '../replica-v2/observers.js';
import { componentCanonical, componentHash, componentPath, readComponentBytes, readComponentRef, writeComponentJson, assertGenericLearningData, assertComponentDiskSpace } from './io.js';
import { learningRecordSchema, readCurrentRelease, readLearningReleases } from './registry.js';
import type { ComponentFileRef, LearningQualificationSummary, LearningRecord, LearningRelease } from './types.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const refSchema = z.object({ path: z.string().min(1), sha256: digest }).strict();
const widget = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
const evidenceKind = z.enum(['source-contract', 'registered-schema', 'dom-instance', 'save-replay', 'render-replay', 'interaction-replay']);
const manifestSchema = z.object({
  version: z.literal(1), kind: z.literal('component-learning-evidence'), widgetType: widget, provider: z.string().min(1).max(120),
  evidence: z.array(refSchema.extend({ kind: evidenceKind, scope: z.enum(['source-contract', 'target-registration-observation', 'dom-instance-observation', 'local-save-replay', 'local-render-replay', 'local-interaction-replay']) })).min(1),
  conclusions: z.array(z.object({ responsibility: z.string().min(1).max(160), statement: z.string().min(1).max(3000), evidenceIndexes: z.array(z.number().int().nonnegative()).min(1) }).strict()).min(1),
}).strict();
const scopes = { 'source-contract': 'source-contract', 'registered-schema': 'target-registration-observation', 'dom-instance': 'dom-instance-observation', 'save-replay': 'local-save-replay', 'render-replay': 'local-render-replay', 'interaction-replay': 'local-interaction-replay' } as const;
const sourceContractSchema = z.object({ version: z.literal(1), kind: z.literal('component-source-contract'), widgetType: widget, provider: z.string().min(1), source: refSchema, controls: z.array(z.object({ id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: z.string().regex(/^[a-z][a-z0-9_-]*$/) }).strict()).min(1) }).strict();
const controlSchema = z.object({ type: z.string().min(1) }).passthrough();
const registeredSchema = z.object({ type: widget, class: z.string().min(1), controls: z.record(z.string(), controlSchema) }).passthrough();
const replaySchema = z.object({ version: z.literal(1), kind: z.literal('component-save-replay'), widgetType: widget, elementId: z.string().min(1), intended: refSchema, readback: refSchema }).strict();
const renderSchema = z.object({ version: z.literal(1), kind: z.literal('component-render-replay'), widgetType: widget, nodeId: z.string().min(1), packet: refSchema, screenshot: refSchema }).strict();
const interactionSchema = z.object({ version: z.literal(1), kind: z.literal('component-interaction-replay'), widgetType: widget, interactionId: z.string().min(1), before: refSchema, after: refSchema, beforeScreenshot: refSchema, afterScreenshot: refSchema }).strict();
const conclusionSchema = z.object({ version: z.literal(1), kind: z.literal('page-learning-conclusions'), conclusions: z.array(z.object({ responsibility: z.string().min(1).max(160), statement: z.string().min(1).max(3000), snapshotId: z.string().min(1), ownerNodeIds: z.array(z.string().min(1)).min(1) }).strict()).min(1) }).strict();
interface EvidenceBlob { bytes: Buffer; kind: string; scope: string; extension: 'json' | 'php' | 'txt' | 'png' | 'jpg' | 'webp' }
const blankQualification = (): LearningQualificationSummary => ({ source: 'unverified', save: 'unverified', render: 'unverified', interaction: 'unverified', resources: 'task-local-only', registration: 'task-local-only' });

function assertEvidenceTextNoSecrets(value: string): void {
  if (/(?:\$|\b|["'])(?:wp_app_password|applicationPassword|password|consumer_secret|api[_-]?key|access[_-]?token|authorization|cookie)\b["']?\s*(?:=|=>|:)\s*["'][^"'\r\n]+["']/i.test(value) || /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=_-]{8,}/i.test(value) || /(?:^|\n)\s*(?:Authorization|Cookie|Set-Cookie)\s*[:=]\s*\S+/i.test(value)) throw Error('learning_text_evidence_contains_secret');
}

function assertEvidenceNoSecrets(value: unknown, location = '$'): void {
  if (typeof value === 'string') {
    if (value.includes('[MaxDepth]') || /(?:[?&](?:_wpnonce|nonce|token|access_token|auth|key)=)|(?:Basic|Bearer)\s+[A-Za-z0-9+/=_-]{8,}/i.test(value)) throw Error(`learning_evidence_contains_secret_or_truncation: ${location}`);
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error(`learning_evidence_non_finite: ${location}`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(cookies?|set-cookie|authorization|storageState|localStorage|sessionStorage|password|applicationPassword|consumer_secret|accessToken|apiKey|nonce|token|data-nonce|data-token)$/i.test(key) && child != null && child !== '') throw Error(`learning_evidence_contains_secret: ${location}.${key}`);
    assertEvidenceNoSecrets(child, `${location}.${key}`);
  }
}
function allowedEvidencePath(root: string, name: string): string {
  const absolute = componentPath(root, name), relative = path.relative(path.resolve(root), absolute).replaceAll('\\', '/');
  if (!/^(?:src|tests|data\/native44|learning|references|reports|\.cache)\//.test(relative) || /(?:^|\/)(?:\.env[^/]*|credentials?[^/]*|secrets?[^/]*|cookies?[^/]*|storageState[^/]*)$/i.test(relative)) throw Error(`learning_evidence_path_not_allowed: ${name}`);
  return relative;
}
function parseJson(bytes: Buffer): unknown { const value: unknown = JSON.parse(bytes.toString('utf8')); assertEvidenceNoSecrets(value); return value; }
function sourceType(type: string): string { return ({ text: 'TEXT', textarea: 'TEXTAREA', wysiwyg: 'WYSIWYG', url: 'URL', media: 'MEDIA', select: 'SELECT', select2: 'SELECT2', switcher: 'SWITCHER', number: 'NUMBER', slider: 'SLIDER', repeater: 'REPEATER', color: 'COLOR', icons: 'ICONS', dimensions: 'DIMENSIONS', choose: 'CHOOSE' } as Record<string, string>)[type] ?? type.toUpperCase().replaceAll('-', '_'); }
function phpControlArray(code: string, id: string): string | undefined {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:add_control|add_responsive_control)\\s*\\(\\s*['\"]${escaped}['\"]\\s*,\\s*\\[`).exec(code);
  if (!match) return;
  const start = match.index + match[0].length - 1; let depth = 0, quote = '', escapedChar = false;
  for (let index = start; index < code.length; index++) {
    const char = code[index];
    if (quote) { if (escapedChar) escapedChar = false; else if (char === '\\') escapedChar = true; else if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') depth++; else if (char === ']' && --depth === 0) return code.slice(start, index + 1);
  }
}
function assertWidgetInPacket(packet: ObservationPacketV2, type: string, nodeId?: string): void {
  const nodes = nodeId ? [packet.nodes[nodeId]] : Object.values(packet.nodes);
  if (!nodes.some(node => node && node.visible && (node.attributes['data-widget_type'] === `${type}.default` || node.attributes['data-widget_type'] === type))) throw Error(`learning_dom_widget_identity_unproven: ${type}`);
}
function assertWidgetOwnsNode(packet: ObservationPacketV2, type: string, nodeId: string): void {
  let node = packet.nodes[nodeId];
  while (node) {
    if (node.visible && [type, `${type}.default`].includes(node.attributes['data-widget_type'])) return;
    node = node.parentId ? packet.nodes[node.parentId] : undefined as any;
  }
  throw Error(`learning_interaction_widget_owner_unproven: ${type}`);
}
function elementInDocument(value: unknown, id: string): { id: string; widgetType: string; settings: Record<string, unknown> } | undefined {
  const nodes = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as any).elements) ? (value as any).elements : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || !node.settings || typeof node.settings !== 'object') throw Error('learning_save_document_invalid');
    if (node.id === id) return node;
    const child = elementInDocument(node.elements ?? [], id); if (child) return child;
  }
  return undefined;
}
async function validateImage(bytes: Buffer, width?: number, height?: number): Promise<void> {
  const metadata = await sharp(bytes, { limitInputPixels: 120_000_000 }).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || width !== undefined && width !== metadata.width || height !== undefined && height !== metadata.height) throw Error('learning_screenshot_invalid');
}

/** Every evidence read is explicit, hash checked, constrained to the project,
 * and retained as evidence rather than copied into runtime recipe defaults. */
export async function studyComponentEvidence(root: string, widgetType: string, evidencePath: string): Promise<{ provider: string; evidence: EvidenceBlob[]; conclusions: LearningRecord['conclusions']; qualification: LearningQualificationSummary }> {
  const input = manifestSchema.parse(parseJson(await readComponentBytes(root, allowedEvidencePath(root, evidencePath))));
  if (input.widgetType !== widgetType) throw Error('learning_component_identity_mismatch');
  assertGenericLearningData({ provider: input.provider, conclusions: input.conclusions });
  if (input.conclusions.some(item => item.evidenceIndexes.some(index => !input.evidence[index]))) throw Error('learning_conclusion_evidence_missing');
  const evidence: EvidenceBlob[] = [], qualification = blankQualification();
  const read = async (ref: ComponentFileRef, kind: string, scope: string): Promise<Buffer> => {
    const name = allowedEvidencePath(root, ref.path), bytes = await readComponentRef(root, { ...ref, path: name });
    if (!bytes.length || bytes.length > 30_000_000) throw Error('learning_evidence_size_invalid');
    const extension = path.extname(name).slice(1).toLowerCase();
    if (!['json', 'php', 'txt', 'png', 'jpg', 'webp'].includes(extension)) throw Error('learning_evidence_extension_invalid');
    if (extension === 'json') parseJson(bytes);
    if (['json', 'php', 'txt'].includes(extension)) assertEvidenceTextNoSecrets(bytes.toString('utf8'));
    evidence.push({ bytes, kind, scope, extension: extension as EvidenceBlob['extension'] });
    return bytes;
  };
  const originalToExpanded: number[] = [];
  for (const item of input.evidence) {
    if (item.scope !== scopes[item.kind]) throw Error(`learning_evidence_scope_mismatch: ${item.kind}`);
    originalToExpanded.push(evidence.length);
    const value = parseJson(await read(item, item.kind, item.scope));
    if (item.kind === 'source-contract') {
      const contract = sourceContractSchema.parse(value);
      if (contract.widgetType !== widgetType || contract.provider !== input.provider || new Set(contract.controls.map(control => control.id)).size !== contract.controls.length) throw Error('learning_source_contract_identity_mismatch');
      const code = (await read(contract.source, 'source-code', 'source-contract')).toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|#).*$/gm, '');
      const escaped = widgetType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`function\\s+get_name\\s*\\(\\s*\\)\\s*(?::[^{}]+)?\\s*\\{\\s*return\\s*['\"]${escaped}['\"]\\s*;`).test(code)) throw Error('learning_source_widget_identity_unproven');
      for (const control of contract.controls) {
        const controlArray = phpControlArray(code, control.id);
        if (!controlArray || !new RegExp(`['\"]type['\"]\\s*=>\\s*(?:\\\\?[A-Za-z_\\\\]+::)?${sourceType(control.type)}\\b`).test(controlArray)) throw Error(`learning_source_control_unproven: ${control.id}`);
      }
      qualification.source = 'source-studied';
    } else if (item.kind === 'registered-schema') {
      const registered = registeredSchema.parse(value);
      if (registered.type !== widgetType || !Object.keys(registered.controls).length || Object.entries(registered.controls).some(([key, control]) => !key || !control.type)) throw Error('learning_registered_schema_invalid');
      // Registration is an observation of that target, never a global fact.
    } else if (item.kind === 'dom-instance') {
      const packet = validateObservationPacketV2(value); assertWidgetInPacket(packet, widgetType);
    } else if (item.kind === 'save-replay') {
      const replay = replaySchema.parse(value); if (replay.widgetType !== widgetType) throw Error('learning_save_widget_mismatch');
      const intended = elementInDocument(parseJson(await read(replay.intended, 'intended-document', 'local-save-replay')), replay.elementId);
      const readback = elementInDocument(parseJson(await read(replay.readback, 'readback-document', 'local-save-replay')), replay.elementId);
      if (!intended || !readback || intended.widgetType !== widgetType || readback.widgetType !== widgetType || componentCanonical(intended.settings) !== componentCanonical(readback.settings)) throw Error('learning_save_readback_mismatch');
      qualification.save = 'local-replay-verified';
    } else if (item.kind === 'render-replay') {
      const render = renderSchema.parse(value); if (render.widgetType !== widgetType) throw Error('learning_render_widget_mismatch');
      const packet = validateObservationPacketV2(parseJson(await read(render.packet, 'render-packet', 'local-render-replay'))); assertWidgetInPacket(packet, widgetType, render.nodeId);
      if (render.screenshot.sha256 !== packet.snapshot.screenshot.sha256) throw Error('learning_render_screenshot_mismatch');
      const node = packet.nodes[render.nodeId], layout = packet.layouts[node.layoutId];
      if (layout.rect.width <= 0 || layout.rect.height <= 0 || layout.rect.x >= packet.snapshot.screenshot.width || layout.rect.y >= packet.snapshot.screenshot.height || layout.rect.x + layout.rect.width <= 0 || layout.rect.y + layout.rect.height <= 0 || packet.styles[node.styleId].display === 'none' || packet.styles[node.styleId].visibility === 'hidden' || packet.styles[node.styleId].opacity === '0') throw Error('learning_render_node_not_painted');
      await validateImage(await read(render.screenshot, 'render-screenshot', 'local-render-replay'), packet.snapshot.screenshot.width, packet.snapshot.screenshot.height);
      qualification.render = 'local-replay-verified';
    } else {
      const replay = interactionSchema.parse(value); if (replay.widgetType !== widgetType) throw Error('learning_interaction_widget_mismatch');
      const before = validateObservationPacketV2(parseJson(await read(replay.before, 'before-packet', 'local-interaction-replay'))), after = validateObservationPacketV2(parseJson(await read(replay.after, 'after-packet', 'local-interaction-replay')));
      assertWidgetInPacket(before, widgetType); assertWidgetInPacket(after, widgetType);
      const first = before.interactions[replay.interactionId], second = after.interactions[replay.interactionId];
      if (!first || !second || first.nodeId !== second.nodeId || first.kind !== second.kind || first.status !== 'observed' || second.status !== 'observed' || componentCanonical(first.details) === componentCanonical(second.details) || replay.beforeScreenshot.sha256 !== before.snapshot.screenshot.sha256 || replay.afterScreenshot.sha256 !== after.snapshot.screenshot.sha256) throw Error('learning_interaction_change_unproven');
      if (!before.nodes[first.nodeId] || !after.nodes[second.nodeId] || !first.controlNodeIds?.length || !second.controlNodeIds?.length) throw Error('learning_interaction_owner_or_controls_missing');
      assertWidgetOwnsNode(before, widgetType, first.nodeId); assertWidgetOwnsNode(after, widgetType, second.nodeId);
      if (before.snapshot.url !== after.snapshot.url || componentCanonical(before.snapshot.viewport) !== componentCanonical(after.snapshot.viewport) || first.trackNodeId !== second.trackNodeId || componentCanonical(first.itemNodeIds ?? []) !== componentCanonical(second.itemNodeIds ?? []) || componentCanonical(first.controlNodeIds) !== componentCanonical(second.controlNodeIds) || replay.beforeScreenshot.sha256 === replay.afterScreenshot.sha256) throw Error('learning_interaction_context_or_pixels_unchanged');
      const ownedIds = [first.nodeId, first.trackNodeId, ...(first.itemNodeIds ?? []), ...first.controlNodeIds].filter((id): id is string => Boolean(id));
      const actualState = (packet: ObservationPacketV2) => ownedIds.map(id => ({ id, attributes: packet.nodes[id]?.attributes, layout: packet.nodes[id] && packet.layouts[packet.nodes[id].layoutId], visible: packet.nodes[id]?.visible }));
      if (componentCanonical(actualState(before)) === componentCanonical(actualState(after))) throw Error('learning_interaction_dom_state_unchanged');
      await validateImage(await read(replay.beforeScreenshot, 'before-screenshot', 'local-interaction-replay'), before.snapshot.screenshot.width, before.snapshot.screenshot.height);
      await validateImage(await read(replay.afterScreenshot, 'after-screenshot', 'local-interaction-replay'), after.snapshot.screenshot.width, after.snapshot.screenshot.height);
      qualification.interaction = 'local-replay-verified';
    }
  }
  return { provider: input.provider, evidence, qualification, conclusions: input.conclusions.map(item => ({ ...item, evidenceIndexes: item.evidenceIndexes.map(index => originalToExpanded[index]) })) };
}

/** Page appearance proves layout/content relationships only. Component identity
 * is deliberately not inferred from CSS classes, URLs or visual resemblance. */
export async function studyPageObservation(root: string, sourceUrl: string, observed: string): Promise<{ evidence: EvidenceBlob[]; conclusions: LearningRecord['conclusions']; qualification: LearningQualificationSummary }> {
  const url = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('learning_source_url_invalid');
  const directory = allowedEvidencePath(root, path.join(observed, 'observation-manifest.json'));
  const base = path.dirname(directory), bytes = await readComponentBytes(root, directory), raw = parseJson(bytes) as any;
  if (raw.version !== 2 || raw.kind !== 'observation-manifest' || raw.sourceUrl !== sourceUrl || !(raw.provenance?.observer === 'cua_repl' ? raw.provenance?.method === 'user-opened-browser' && sourceObserverProvenanceAllowed(raw.provenance.method, 'cua_repl', raw.provenance?.browser) : raw.provenance?.observer === 'claude_browser' && sourceObserverProvenanceAllowed(raw.provenance?.method, 'claude_browser', raw.provenance?.browser)) || !Array.isArray(raw.packets) || !raw.packets.length || !Array.isArray(raw.screenshots)) throw Error('learning_browser_observation_invalid');
  const evidence: EvidenceBlob[] = [{ bytes, extension: 'json', kind: 'observation-manifest', scope: 'user-browser-page-pattern' }], packets: ObservationPacketV2[] = [];
  for (const item of raw.packets) {
    const ref = refSchema.parse({ path: item.path, sha256: item.sha256 });
    const packetPath = componentPath(componentPath(root, base), ref.path), packetBytes = await readComponentRef(root, { path: path.relative(root, packetPath), sha256: ref.sha256 });
    const packet = validateObservationPacketV2(parseJson(packetBytes));
    if (packet.snapshot.url !== sourceUrl || packet.snapshot.id !== item.snapshotId || componentCanonical(observationCountsV2(packet)) !== componentCanonical(item.counts) || !Array.isArray(item.regionIds) || componentCanonical(packet.regions.map(region => region.id).sort()) !== componentCanonical([...item.regionIds].sort()) || !Array.isArray(item.dependencies) || item.dependencies.some((dependency: string) => !raw.packets.some((candidate: any) => candidate.path === dependency))) throw Error('learning_observation_packet_identity_mismatch');
    if (packet.snapshot.viewport.width < 1025) throw Error('learning_page_desktop_observation_required');
    const screenshot = raw.screenshots.find((row: any) => row.snapshotId === packet.snapshot.id);
    if (!screenshot || screenshot.path !== packet.snapshot.screenshot.path || screenshot.sha256 !== packet.snapshot.screenshot.sha256) throw Error('learning_observation_screenshot_binding_missing');
    const imageBytes = await readComponentRef(root, { path: path.relative(root, componentPath(componentPath(root, base), screenshot.path)), sha256: screenshot.sha256 });
    await validateImage(imageBytes, packet.snapshot.screenshot.width, packet.snapshot.screenshot.height);
    evidence.push({ bytes: packetBytes, extension: 'json', kind: 'observation-packet', scope: 'user-browser-page-pattern' }, { bytes: imageBytes, extension: 'png', kind: 'source-screenshot', scope: 'user-browser-page-pattern' });
    packets.push(packet);
  }
  const conclusionPath = path.join(base, 'learning-conclusions.json');
  const conclusions = conclusionSchema.parse(parseJson(await readComponentBytes(root, conclusionPath)));
  assertGenericLearningData(conclusions);
  const result = conclusions.conclusions.map(item => {
    const matching = packets.filter(packet => packet.snapshot.id === item.snapshotId);
    if (!matching.length || item.ownerNodeIds.some(id => !matching.some(packet => packet.nodes[id]))) throw Error('learning_page_conclusion_owner_missing');
    return { responsibility: item.responsibility, statement: item.statement, evidenceIndexes: matching.map(packet => 1 + packets.indexOf(packet) * 2) };
  });
  return { evidence, conclusions: result, qualification: blankQualification() };
}

async function publishLearning(root: string, input: {
  kind: LearningRecord['kind']; widgetType?: string; provider?: string; evidence: EvidenceBlob[];
  conclusions: LearningRecord['conclusions']; qualification: LearningQualificationSummary;
}): Promise<{ record: LearningRecord; recordRef: ComponentFileRef; release: LearningRelease; releaseRef: ComponentFileRef }> {
  for (const blob of input.evidence) if (['json', 'php', 'txt'].includes(blob.extension)) assertEvidenceTextNoSecrets(blob.bytes.toString('utf8'));
  await assertComponentDiskSpace(root);
  const current = await readCurrentRelease(root), learningId = `learn-${randomUUID()}`;
  const lockPath = componentPath(root, 'learning/.publish.lock'); await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, 'wx').catch(() => { throw Error('learning_publish_concurrent_or_interrupted: preserve the existing lock and inspect before retry'); });
  try {
    const prior = await readLearningReleases(root, current.knowledge.fingerprint, { verifyEvidence: false });
    const evidence: LearningRecord['evidence'] = [];
    for (const blob of input.evidence) {
      await assertComponentDiskSpace(root);
      const digest = componentHash(blob.bytes), name = `learning/${learningId}/evidence/${digest}.${blob.extension}`;
      const target = componentPath(root, name); await mkdir(path.dirname(target), { recursive: true });
      if (!evidence.some(ref => ref.path === name)) {
        const file = await open(target, 'wx'); try { await file.writeFile(blob.bytes); await file.sync(); } finally { await file.close(); }
      }
      evidence.push({ path: name, sha256: digest, kind: blob.kind, scope: blob.scope });
    }
    const record = learningRecordSchema.parse({
      version: 1, kind: input.kind, learningId, createdAt: new Date().toISOString(), ...(input.widgetType ? { widgetType: input.widgetType, provider: input.provider } : {}),
      mode: input.kind === 'page-learning-record' ? 'page-pattern' : NATIVE44_ALL_TYPES.includes(input.widgetType as any) ? 'existing-component-recipe' : 'new-component-candidate',
      evidence, conclusions: input.conclusions, conclusionStatus: 'candidate-interpretation', qualification: input.qualification,
      constraints: ['Knowledge-only publication; does not alter the enabled component set or writer contracts.', 'Local replay is not live target qualification.', 'Current target registration and resource availability remain task-local.', 'No target resources, form actions or website defaults are reusable recipe values.'],
      baseKnowledgeFingerprint: current.knowledge.fingerprint,
    }) as LearningRecord;
    const recordRef = await writeComponentJson(root, `learning/${learningId}/record.json`, record, true);
    const identity = { version: 1 as const, kind: 'component-learning-release' as const, ...(prior.length ? { previous: prior[prior.length - 1].ref } : {}), records: [recordRef], baseKnowledgeFingerprint: current.knowledge.fingerprint, enabledSetHash: NATIVE44_CATALOG_HASH, activation: 'knowledge-only' as const };
    const release: LearningRelease = { ...identity, releaseId: componentHash(componentCanonical(identity)) };
    const releaseRef = await writeComponentJson(root, `learning/releases/${release.releaseId}.json`, release, true);
    await writeComponentJson(root, 'data/system/knowledge-current.json', { version: 1, release: releaseRef });
    return { record, recordRef, release, releaseRef };
  } finally { await lock.close(); await unlink(lockPath); }
}

export async function learnComponent(root: string, widgetType: string, evidencePath: string): Promise<Awaited<ReturnType<typeof publishLearning>>> {
  const candidate = await studyComponentEvidence(root, widget.parse(widgetType), evidencePath);
  return publishLearning(root, { kind: 'component-learning-record', widgetType, ...candidate });
}
export async function learnPage(root: string, sourceUrl: string, observed: string): Promise<Awaited<ReturnType<typeof publishLearning>>> {
  return publishLearning(root, { kind: 'page-learning-record', ...await studyPageObservation(root, sourceUrl, observed) });
}

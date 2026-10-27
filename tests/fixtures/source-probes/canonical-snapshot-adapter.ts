/** Task-local representation adapter. It never replaces an expected hash with a
 * known value: every fingerprint below is computed from the actual JSON tree. */
import path from 'node:path';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import { loadConfig, redactor } from '../../../src/core/config.js';
import { previewCookies } from '../../../src/wordpress/preview-session.js';
import { canonicalV2, documentHashV2, ensureDiskSpaceV2, hashV2, isHashV2 } from '../../../src/replica-v2/journal.js';
import { WordPressClient } from '../../../src/wordpress/client.js';
import type { DraftSnapshot, PublishedSnapshot } from '../../../src/wordpress/types.js';
import { assertAllowedWidget, NATIVE44_ALL_TYPES } from '../../../src/native44/catalog.js';
import { assertNative44Environment, checkNative44Environment } from '../../../src/native44/environment.js';
import { fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44CompareDependencies, type Native44CompareManifest } from '../../../src/native44/compare.js';
import { native44CompareBrowserOptions, native44ReviewStatusProblem, type Native44CurrentCheckpointReader } from '../../../src/native44/compare-cli.js';
import { bindNative44CurrentCompareManifest, readNative44CurrentCompareInput, sameNative44CurrentFingerprint } from '../../../src/native44/current-capture-binding.js';
import { readNative44CurrentState } from '../../../src/native44/current-state.js';
import { readNative44Publication } from '../../../src/native44/publication.js';
import { loadNative44SourceCaptures } from '../../../src/native44/source-captures.js';
import { readNative44ReleaseLock } from '../../../src/native44/release-lock.js';
import type { Native44RevisionDependencies, Native44RevisionRemote } from '../../../src/native44/revision.js';

type Snapshot = DraftSnapshot | PublishedSnapshot;
type Entry = { path: string; value: unknown };
const fail = (reason: string): never => { throw Error(`tasklocal_canonical_snapshot_${reason}`); };
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
function safeError(error: unknown, redact: (value: unknown) => string = redactor()): { name: string; message: string } {
  const name = error instanceof Error && /^[A-Za-z\d_-]{1,80}$/.test(error.name) ? error.name : 'Error';
  const message = redact(error instanceof Error ? error.message : 'Non-Error remote failure').replace(/https?:\/\/[^\s"'<>]+/gi, '[URL REDACTED]').slice(0, 2048);
  return { name, message };
}

/** Reject values JSON.stringify would silently discard/coerce, including sparse
 * arrays and accessors. HTTP JSON snapshots need no such coercion. */
function assertStrictJSON(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value) || Object.is(value, -0)) fail('non_json_number'); return; }
  if (typeof value !== 'object') fail('non_json_value');
  const object = value as object;
  if (ancestors.has(object)) fail('cyclic_value');
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(object))) fail('non_plain_object');
  const keys = Reflect.ownKeys(object), descriptors = Object.getOwnPropertyDescriptors(object);
  if (keys.some(key => typeof key !== 'string')) fail('symbol_key');
  if (array && (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))))) fail('sparse_or_extended_array');
  ancestors.add(object);
  for (const key of keys as string[]) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('non_json_property');
    assertStrictJSON(descriptor.value, ancestors);
  }
  ancestors.delete(object);
}

/** Match the existing core fingerprint traversal exactly, including nested
 * resource objects. Array order is observed, never sorted or rewritten. */
function fingerprintEntries(snapshot: Snapshot): { resources: Entry[]; queries: Entry[]; arrays: Array<{ path: string; length: number; valueHash: string }> } {
  const resources: Entry[] = [], queries: Entry[] = [], arrays: Array<{ path: string; length: number; valueHash: string }> = [];
  const visit = (value: unknown, at = ''): void => {
    if (Array.isArray(value)) { arrays.push({ path: at, length: value.length, valueHash: hashV2(canonicalV2(value)) }); value.forEach((item, i) => visit(item, `${at}/${i}`)); return; }
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (key === 'custom_css') continue;
      const itemPath = `${at}/${key}`;
      if (/(?:image|media|attachment|background|svg|src|url)/i.test(key)) resources.push({ path: itemPath, value: item });
      if (/(?:query|product|posts_ids|include|exclude|orderby|order|offset|items_per_page)/i.test(key)) queries.push({ path: itemPath, value: item });
      visit(item, itemPath);
    }
  };
  visit({ elements: snapshot.elements, settings: snapshot.settings });
  return { resources, queries, arrays };
}

function mapping(raw: Entry[], normalized: Entry[]) {
  const tokens = (entries: Entry[]) => entries.map(entry => canonicalV2(entry));
  const rawTokens = tokens(raw), normalizedTokens = tokens(normalized);
  const rawMultiset = [...rawTokens].sort(), normalizedMultiset = [...normalizedTokens].sort();
  if (!same(rawMultiset, normalizedMultiset)) fail('path_value_multiset_changed');
  const positions = new Map<string, number[]>();
  normalizedTokens.forEach((token, index) => positions.set(token, [...(positions.get(token) ?? []), index]));
  return {
    count: raw.length, pathAndCanonicalValueMultisetsEqual: true,
    multisetHash: hashV2(canonicalV2(rawMultiset)),
    mapping: rawTokens.map((token, rawIndex) => {
      const normalizedIndex = positions.get(token)!.shift()!;
      return { rawIndex, normalizedIndex, path: raw[rawIndex].path, valueHash: hashV2(canonicalV2(raw[rawIndex].value)) };
    }),
  };
}

/** Exact shared representation used by NEW before/derived manifests and every
 * fresh target boundary. This is not the historical document store's order. */
export function normalizeCanonicalNative44Snapshot<T extends Snapshot>(raw: T) {
  assertStrictJSON(raw);
  if (!raw || !Number.isSafeInteger(raw.pageId) || raw.pageId < 1 || typeof raw.runId !== 'string' || !/^[A-Za-z\d_-]{4,100}$/.test(raw.runId) || typeof raw.title !== 'string' || !['draft', 'publish'].includes(raw.status) || !Array.isArray(raw.elements) || !raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings) || !isHashV2(raw.hash) || documentHashV2(raw.elements, raw.settings) !== raw.hash) fail('invalid_snapshot_or_document_hash');
  const serializedCanonical = canonicalV2(raw), snapshot = JSON.parse(serializedCanonical) as T;
  if (documentHashV2(snapshot.elements, snapshot.settings) !== raw.hash || canonicalV2(snapshot) !== serializedCanonical || !same(raw, snapshot)) fail('whole_snapshot_changed');
  const rawFingerprint = fingerprintNative44Snapshot(raw), canonicalFingerprint = fingerprintNative44Snapshot(snapshot);
  if (rawFingerprint.documentHash !== canonicalFingerprint.documentHash || rawFingerprint.structureHash !== canonicalFingerprint.structureHash || rawFingerprint.pageCss !== canonicalFingerprint.pageCss) fail('non_order_fingerprint_changed');
  const before = fingerprintEntries(raw), after = fingerprintEntries(snapshot);
  const resources = mapping(before.resources, after.resources), queries = mapping(before.queries, after.queries);
  if (!same([...before.arrays].sort((a, b) => a.path.localeCompare(b.path)), [...after.arrays].sort((a, b) => a.path.localeCompare(b.path)))) fail('array_content_or_order_changed');
  return {
    snapshot,
    evidence: {
      version: 1, kind: 'tasklocal-lossless-canonical-snapshot-normalization' as const,
      method: 'JSON.parse(canonicalV2(actualSnapshot)); object keys only; arrays and scalars preserved',
      pageId: raw.pageId, runId: raw.runId, status: raw.status, documentHash: raw.hash,
      completeCanonicalSnapshotHash: hashV2(serializedCanonical),
      rawJSONStringHash: hashV2(JSON.stringify(raw)), normalizedJSONStringHash: hashV2(JSON.stringify(snapshot)),
      rawFingerprint, canonicalFingerprint, resources, queries,
      arrays: { count: before.arrays.length, orderedArrayContentsUnchanged: true, pathContentHash: hashV2(canonicalV2([...before.arrays].sort((a, b) => a.path.localeCompare(b.path)))) },
      completeCanonicalEquality: true, allMetadataPreserved: true, expectedFingerprintSubstitution: false,
    },
  };
}

export interface SnapshotRepresentationTemplate { snapshot: Snapshot; label: string; reference?: { path: string; sha256: string } }

/** Only take key order from the bound template. Every value comes from the
 * actual observation, after complete canonical equality has been established. */
export function representNative44SnapshotLike<T extends Snapshot>(raw: T, template: Snapshot) {
  assertStrictJSON(raw); assertStrictJSON(template);
  const rawCanonical = normalizeCanonicalNative44Snapshot(raw), templateCanonical = normalizeCanonicalNative44Snapshot(template);
  if (!same(raw, template)) fail('template_complete_content_mismatch');
  const reorder = (actual: unknown, pattern: unknown): unknown => {
    if (Array.isArray(actual)) return actual.map((item, index) => reorder(item, (pattern as unknown[])[index]));
    if (actual && typeof actual === 'object') return Object.fromEntries(Object.keys(pattern as object).map(key => [key, reorder((actual as Record<string, unknown>)[key], (pattern as Record<string, unknown>)[key])]));
    return actual;
  };
  const snapshot = reorder(raw, template) as T;
  if (!same(raw, snapshot) || JSON.stringify(snapshot) !== JSON.stringify(template) || documentHashV2(snapshot.elements, snapshot.settings) !== raw.hash) fail('template_representation_changed_content');
  const rawFingerprint = fingerprintNative44Snapshot(raw), chosenFingerprint = fingerprintNative44Snapshot(snapshot);
  if (['documentHash', 'structureHash', 'queryHash', 'pageCss'].some(key => rawFingerprint[key as keyof typeof rawFingerprint] !== chosenFingerprint[key as keyof typeof chosenFingerprint])) fail('template_non_resource_fingerprint_changed');
  const before = fingerprintEntries(raw), after = fingerprintEntries(snapshot);
  const resources = mapping(before.resources, after.resources), queries = mapping(before.queries, after.queries);
  if (!same([...before.arrays].sort((a, b) => a.path.localeCompare(b.path)), [...after.arrays].sort((a, b) => a.path.localeCompare(b.path)))) fail('array_content_or_order_changed');
  return { snapshot, evidence: {
    version: 2, kind: 'tasklocal-lossless-bound-template-snapshot-representation' as const,
    method: 'Complete actual/template canonical equality, then template object-key order using actual values; arrays and scalars unchanged',
    pageId: raw.pageId, runId: raw.runId, status: raw.status, documentHash: raw.hash,
    completeCanonicalSnapshotHash: rawCanonical.evidence.completeCanonicalSnapshotHash,
    templateCompleteCanonicalSnapshotHash: templateCanonical.evidence.completeCanonicalSnapshotHash,
    rawJSONStringHash: hashV2(JSON.stringify(raw)), normalizedJSONStringHash: hashV2(JSON.stringify(snapshot)),
    templateJSONStringHash: hashV2(JSON.stringify(template)), rawFingerprint, chosenFingerprint,
    resources, queries, arrays: rawCanonical.evidence.arrays,
    completeCanonicalEquality: true, actualValuesOnly: true, allMetadataPreserved: true,
    unknownKeysRemoved: false, expectedFingerprintSubstitution: false, allNonResourceFingerprintsPreserved: true,
  } };
}

export type CanonicalSnapshotRecord = <T extends Snapshot>(snapshot: T, boundary: string, template?: SnapshotRepresentationTemplate) => Promise<T>;
export interface CanonicalSnapshotEvidenceRecorder { directory: string; record: CanonicalSnapshotRecord; event(name: string, value: unknown): Promise<{ path: string; sha256: string }> }
export async function createCanonicalSnapshotEvidenceRecorder(rootInput: string, manifest: Native44CompareManifest, purpose: string, templates: SnapshotRepresentationTemplate[] = []): Promise<CanonicalSnapshotEvidenceRecorder> {
  const root = await realpath(rootInput);
  if (!/^[A-Za-z\d_-]{4,100}$/.test(manifest.runId) || !/^[A-Za-z\d_.-]{1,100}$/.test(purpose) || new URL(manifest.sourceUrl).href !== 'https://furryskitchen.sg/') fail('evidence_identity');
  const runDir = await realpath(path.join(root, 'runs', manifest.runId));
  if (runDir !== path.join(root, 'runs', manifest.runId)) fail('evidence_alias');
  await ensureDiskSpaceV2(root);
  const directory = path.join(runDir, 'canonical-snapshot-observations', `${purpose}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory) fail('evidence_directory_alias');
  let sequence = 0;
  const event = async (name: string, value: unknown) => {
    if (!/^[A-Za-z\d_.-]+$/.test(name)) fail('evidence_name');
    const serialized = JSON.stringify(value, null, 2) + '\n';
    if (redactor()(serialized) !== serialized) fail('secret_in_snapshot_evidence');
    await ensureDiskSpaceV2(root);
    const filename = path.join(directory, name), data = Buffer.from(serialized);
    await writeFile(filename, data, { flag: 'wx' });
    return { path: filename, sha256: hashV2(data) };
  };
  const implementation = async (filename: string) => ({ path: filename, sha256: hashV2(await readFile(filename)) });
  const diagnostic = path.join(runDir, 'resource-order-diagnostic-20261018.json');
  let diagnosticRef: { path: string; sha256: string } | undefined;
  try { const data = await readFile(diagnostic), value = JSON.parse(data.toString('utf8')); if (value.kind !== 'native44-resource-order-diagnostic' || value.runId !== manifest.runId || value.pageId !== manifest.pageId) fail('diagnostic_identity'); diagnosticRef = { path: diagnostic, sha256: hashV2(data) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const session = await event('session.json', { version: 2, kind: 'tasklocal-canonical-snapshot-session', taskId: manifest.taskId, runId: manifest.runId, pageId: manifest.pageId, purpose, createdAt: new Date().toISOString(), manifestCanonicalHash: hashV2(canonicalV2(manifest)), expectedFingerprint: { documentHash: manifest.documentHash, structureHash: manifest.structureHash, resourceHash: manifest.resourceHash, queryHash: manifest.queryHash, pageCss: manifest.pageCss }, representationTemplates: templates.map(template => ({ label: template.label, reference: template.reference, documentHash: template.snapshot.hash, completeCanonicalSnapshotHash: hashV2(canonicalV2(template.snapshot)), representationHash: hashV2(JSON.stringify(template.snapshot)) })), diagnostic: diagnosticRef, implementations: await Promise.all([implementation(path.join(root, 'references/furryskitchen-20261017-observation/canonical-snapshot-adapter.ts')), implementation(path.join(root, 'src/native44/compare.ts')), implementation(path.join(root, 'src/replica-v2/journal.ts'))]), scope: 'Representation-only task-local adapter. Original manifests, release locks, snapshots and program bytes are preserved; all remote ownership/CAS and full actual content checks remain required.' });
  const record: CanonicalSnapshotRecord = async (raw, boundary, explicitTemplate) => {
    if (!/^[A-Za-z\d_.-]{1,100}$/.test(boundary)) fail('boundary_name');
    if (raw.pageId !== manifest.pageId || raw.runId !== manifest.runId) fail('remote_identity');
    const prefix = `${String(++sequence).padStart(4, '0')}-${boundary}`;
    const rawRef = await event(`${prefix}-raw.json`, raw);
    try {
      const template = explicitTemplate ?? templates.find(candidate => same(candidate.snapshot, raw));
      if (!template && templates.length) fail('no_complete_matching_bound_template');
      const normalized = template ? representNative44SnapshotLike(raw, template.snapshot) : normalizeCanonicalNative44Snapshot(raw);
      const chosenRef = await event(`${prefix}-${template ? 'chosen' : 'canonical'}.json`, normalized.snapshot);
      await event(`${prefix}-normalization.json`, { ...normalized.evidence, boundary, observedAt: new Date().toISOString(), session, ...(template ? { representationTemplate: { label: template.label, reference: template.reference } } : {}), rawSnapshot: rawRef, normalizedSnapshot: chosenRef });
      return normalized.snapshot;
    } catch (error) {
      await event(`${prefix}-rejected.json`, { kind: 'tasklocal-snapshot-representation-rejected', boundary, rawSnapshot: rawRef, session, reason: safeError(error), noSnapshotReturned: true });
      throw error;
    }
  };
  return { directory, record, event };
}

/** All actual operations remain delegated to the original client. Its server
 * attestation, complete-document CAS, control validation and readback stay live. */
export function wrapCanonicalNative44RevisionRemote(remote: Native44RevisionRemote, recorder: Pick<CanonicalSnapshotEvidenceRecorder, 'record' | 'event'>, options: { redactError?: (value: unknown) => string } = {}): Native44RevisionRemote {
  return {
    probeOwnedReviewStatus: (pageId, runId) => remote.probeOwnedReviewStatus(pageId, runId),
    readOwnedReviewCheckpoint: async (pageId, runId, types) => { const actual = await remote.readOwnedReviewCheckpoint(pageId, runId, types); return { ...actual, snapshot: await recorder.record(actual.snapshot, 'revision-read-owned') }; },
    saveOwnedRevision: async (before, expected, model) => {
      let stage = 'record-prepared-inputs', writerInvoked = false;
      try {
        const normalizedBefore = await recorder.record(before, 'revision-save-before', { snapshot: before, label: 'exact-writer-before-argument' });
        const normalizedExpected = await recorder.record(expected, 'revision-save-expected', { snapshot: expected, label: 'exact-writer-expected-argument' });
        if (!same(before, normalizedBefore) || !same(expected, normalizedExpected) || !sameNative44CurrentFingerprint(fingerprintNative44Snapshot(before), fingerprintNative44Snapshot(normalizedBefore)) || !sameNative44CurrentFingerprint(fingerprintNative44Snapshot(expected), fingerprintNative44Snapshot(normalizedExpected))) fail('prepared_fingerprint_not_bound_template');
        stage = 'original-writer';
        await recorder.event(`save-invocation-${randomUUID()}.json`, { kind: 'tasklocal-canonical-revision-save-invocation', pageId: before.pageId, runId: before.runId, beforeHash: before.hash, expectedHash: expected.hash, cssModelCanonicalHash: hashV2(canonicalV2(model)), recordedAt: new Date().toISOString(), ownershipAndCASDelegatedToOriginalClient: true });
        writerInvoked = true;
        const after = await remote.saveOwnedRevision(before, expected, model);
        stage = 'actual-readback-representation';
        return await recorder.record(after, 'revision-save-actual-readback', { snapshot: expected, label: 'exact-writer-expected-argument' });
      } catch (error) {
        await recorder.event(`save-error-${randomUUID()}.json`, { kind: 'tasklocal-revision-boundary-error', stage, writerInvoked, pageId: before.pageId, runId: before.runId, beforeHash: before.hash, expectedHash: expected.hash, error: safeError(error, options.redactError), recordedAt: new Date().toISOString(), successClaimed: false, retryPerformed: false });
        throw error;
      }
    },
    close: () => remote.close?.() ?? Promise.resolve(),
  };
}

/** Core already validated this precise operation before calling the factory;
 * independently bind its immutable representation files before credentials. */
export async function loadNative44RevisionRepresentationTemplates(rootInput: string, manifest: Native44CompareManifest, operationId: string): Promise<SnapshotRepresentationTemplate[]> {
  if (!/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/.test(operationId) || operationId.includes('..') || !/^[A-Za-z\d_-]{4,100}$/.test(manifest.runId)) fail('operation_template_identity');
  const root = await realpath(rootInput), folder = path.join(root, 'runs', manifest.runId, 'amendments', operationId);
  if (await realpath(folder) !== folder) fail('operation_template_alias');
  const read = async (reference: { path: string; sha256: string }, name: string) => {
    if (!reference || !isHashV2(reference.sha256) || path.resolve(root, reference.path) !== path.join(folder, name) || await realpath(reference.path) !== path.join(folder, name)) fail('operation_template_reference');
    const info = await stat(reference.path); if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('operation_template_size');
    const data = await readFile(reference.path); if (hashV2(data) !== reference.sha256) fail('operation_template_hash');
    return JSON.parse(data.toString('utf8'));
  };
  const bundlePath = path.join(folder, 'bundle.json'); if (await realpath(bundlePath) !== bundlePath) fail('operation_bundle_alias');
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  if (bundle.version !== 1 || bundle.kind !== 'native44-revision-bundle' || bundle.request?.operationId !== operationId || bundle.request?.taskId !== manifest.taskId || bundle.request?.runId !== manifest.runId || bundle.request?.pageId !== manifest.pageId) fail('operation_template_identity');
  const request = await read(bundle.files.request, 'request.json'), before = await read(bundle.files.before, 'before.json') as Snapshot, expected = await read(bundle.files.expected, 'expected.json') as Snapshot, boundManifest = await read(bundle.files.manifest, 'compare-manifest.json');
  if (!same(request, bundle.request) || !same(boundManifest, manifest) || before.hash !== request.expectedBeforeHash || [before, expected].some(snapshot => snapshot.pageId !== manifest.pageId || snapshot.runId !== manifest.runId || snapshot.status !== 'draft') || !sameNative44CurrentFingerprint(fingerprintNative44Snapshot(expected), manifest)) fail('operation_template_contract');
  representNative44SnapshotLike(before, before); representNative44SnapshotLike(expected, expected);
  return [{ snapshot: expected, label: 'exact-operation-expected', reference: bundle.files.expected }, { snapshot: before, label: 'exact-operation-before', reference: bundle.files.before }];
}

export function createCanonicalNative44RevisionDependencies(root: string, options: { operationId?: string } = {}): Native44RevisionDependencies {
  return { remote: async manifest => {
    const operationId = options.operationId;
    if (!operationId) return fail('explicit_operation_template_required');
    const templates = await loadNative44RevisionRepresentationTemplates(root, manifest, operationId);
    const recorder = await createCanonicalSnapshotEvidenceRecorder(root, manifest, 'revision', templates);
    const loaded = await loadConfig(root);
    if (new URL(manifest.targetUrl).origin !== new URL(loaded.config.targetUrl).origin) fail('revision_target_configuration_conflict');
    const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: [...NATIVE44_ALL_TYPES] });
    console.log(JSON.stringify({ stage: 'canonical-snapshot-adapter-ready', evidenceDirectory: recorder.directory, purpose: 'revision' }));
    return wrapCanonicalNative44RevisionRemote(client, recorder, { redactError: redactor(loaded.credentials) });
  } };
}

/** This is the existing read-only factory's complete guard sequence. A wrapper
 * around its return value would be too late: its first fingerprint check is
 * internal. Only actual snapshots at that boundary use the canonical adapter. */
export async function createCanonicalNative44CompareDependencies(root: string, manifest: Native44CompareManifest, options: { purpose?: string } = {}): Promise<Native44CompareDependencies & { canonicalSnapshotEvidence: string }> {
  const revision = await bindNative44CurrentCompareManifest(root, manifest);
  if (!revision) {
    validateNative44CompareManifest(manifest);
    if (manifest.releaseLock) { const lock = await readNative44ReleaseLock(root, manifest.releaseLock, { taskId: manifest.taskId }); if (lock.phase !== 'final') throw Error('Comparison needs a final program-bound release lock'); }
  }
  const preparedSource = manifest.sourceCaptures ? await loadNative44SourceCaptures(manifest.sourceCaptures, { taskId: manifest.taskId, sourceUrl: manifest.sourceUrl, replicationProfile: manifest.replicationProfile, ...(revision ? { expectedSelectionRulesHash: revision.lock.release.selectionRules.sha256 } : {}) }) : undefined;
  for (const type of manifest.widgetTypes) assertAllowedWidget(type);
  const recorder = await createCanonicalSnapshotEvidenceRecorder(root, manifest, options.purpose ?? 'compare', revision ? [{ snapshot: revision.snapshot, label: 'exact-current-snapshot', reference: revision.state.currentSnapshot }] : []);
  const loaded = await loadConfig(root);
  if (new URL(manifest.targetUrl).origin !== new URL(loaded.config.targetUrl).origin) throw Error('Comparison target must match the configured test site');
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES });
  let browser: Browser | undefined, source: BrowserContext | undefined, target: BrowserContext | undefined;
  let closed = false;
  const close = async () => { if (closed) return; closed = true; try { await browser?.close(); } finally { await client.close(); } };
  try {
    const status = await client.probeOwnedReviewStatus(manifest.pageId, manifest.runId), statusProblem = native44ReviewStatusProblem(status);
    if (statusProblem) throw Error(`${statusProblem}: not-current; pageId=${status.pageId}; postType=${status.postType ?? 'missing'}; status=${status.status ?? 'missing'}; the existing record is preserved.`);
    const preflight = await client.preflight(), parentThemeProof = await client.discoverCapabilities(['container']);
    assertNative44Environment(checkNative44Environment(preflight, parentThemeProof));
    const actualInitial = await client.readOwnedReviewCheckpoint(manifest.pageId, manifest.runId, manifest.widgetTypes), initial = await recorder.record(actualInitial.snapshot, 'compare-initial-owned');
    if (initial.status !== 'draft') throw Error('Comparison is restricted to the current run owned draft');
    if (revision && (initial.pageId !== manifest.pageId || initial.runId !== manifest.runId || documentHashV2(initial.elements, initial.settings) !== initial.hash || !sameNative44CurrentFingerprint(revision.fingerprint, fingerprintNative44Snapshot(initial)))) throw Error('native44_current_remote_not_current: owned draft differs from the complete current revision fingerprint.');
    const access = await client.getPreviewAccess(manifest.pageId);
    if (new URL(access.previewUrl).origin !== client.origin) throw Error('Owned preview escaped the configured test origin');
    const cookies = await previewCookies(access.adminAccessUrl, client.targetUrl);
    browser = await chromium.launch(native44CompareBrowserOptions(revision?.sourceViewports ?? preparedSource?.facts.snapshots.map(snapshot => snapshot.viewport)));
    target = await browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1 });
    await target.addCookies(cookies);
    const readOnly = async (route: Route) => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort('blockedbyclient');
      const url = new URL(request.url());
      if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame() && request.frame().page().context() === target && url.origin !== client.origin) return route.abort('blockedbyclient');
      return route.continue();
    };
    await target.route('**/*', readOnly);
    console.log(JSON.stringify({ stage: 'canonical-snapshot-adapter-ready', evidenceDirectory: recorder.directory, purpose: options.purpose ?? 'compare' }));
    return {
      canonicalSnapshotEvidence: recorder.directory,
      sourceCaptures: preparedSource,
      readSnapshot: async () => fingerprintNative44Snapshot(await recorder.record(await client.snapshotDraft(manifest.pageId), 'compare-fresh-snapshot')),
      openPage: async (url, role) => {
        if (role === 'source' && (preparedSource || revision)) throw Error('Validated user-browser source captures must be reused; source browser navigation is disabled');
        if (role === 'source' && !source) { source = await browser!.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1 }); await source.route('**/*', readOnly); }
        const context = role === 'source' ? source! : target!, page = await context.newPage();
        await page.goto(role === 'target' ? access.previewUrl : url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        return page;
      },
      close,
    };
  } catch (error) { await close().catch(() => undefined); throw error; }
}

/** For compare --verify-applied's existing reader injection. No new pixels or
 * acceptance assertions are introduced by this fresh owned-checkpoint adapter. */
export async function createCanonicalNative44CurrentCheckpointReader(root: string, runDir: string): Promise<Native44CurrentCheckpointReader> {
  const state = await readNative44CurrentState(root, runDir);
  if (!state) throw Error('tasklocal_canonical_snapshot_current_revision_missing');
  const input = await readNative44CurrentCompareInput(root, state);
  if (!input.manifest) throw Error('tasklocal_canonical_snapshot_current_manifest_missing');
  const templates: SnapshotRepresentationTemplate[] = [{ snapshot: input.snapshot, label: 'exact-current-draft-snapshot', reference: state.currentSnapshot }];
  const publication = await readNative44Publication(root, state);
  if (publication) {
    const content = await readFile(publication.snapshot.path); if (hashV2(content) !== publication.snapshot.sha256) fail('current_publication_template_changed');
    const published = JSON.parse(content.toString('utf8')) as PublishedSnapshot;
    if (published.status !== 'publish' || published.hash !== publication.documentHash || published.pageId !== state.pageId || published.runId !== state.runId) fail('current_publication_template_identity');
    representNative44SnapshotLike(published, published);
    templates.unshift({ snapshot: published, label: 'exact-current-published-snapshot', reference: publication.snapshot });
  }
  const recorder = await createCanonicalSnapshotEvidenceRecorder(root, input.manifest, 'verify-applied', templates);
  const loaded = await loadConfig(root);
  if (new URL(loaded.config.targetUrl).origin !== new URL(input.journal.targetUrl).origin) fail('current_target_origin_conflict');
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES });
  let closed = false;
  return {
    probeOwnedReviewStatus: (pageId, runId) => client.probeOwnedReviewStatus(pageId, runId),
    readOwnedReviewCheckpoint: async (pageId, runId, types) => { const actual = await client.readOwnedReviewCheckpoint(pageId, runId, types); return { ...actual, snapshot: await recorder.record(actual.snapshot, 'verify-owned-draft') }; },
    readOwnedPublishedCheckpoint: async (pageId, runId, types) => { const actual = await client.readOwnedPublishedCheckpoint(pageId, runId, types); return { ...actual, snapshot: await recorder.record(actual.snapshot, 'verify-owned-published') }; },
    close: async () => { if (!closed) { closed = true; await client.close(); } },
  };
}

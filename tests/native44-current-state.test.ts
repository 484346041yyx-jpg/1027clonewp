import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { readNative44CurrentState, assertNative44OriginalRunWritable, buildNative44CurrentRevisionPointer, recordNative44CurrentRevisionReview, validateNative44CurrentRevisionPointer, normalizeNative44CurrentReviewReport } from '../src/native44/current-state.js';
import { bindNative44CurrentCompareManifest, createNative44CompareDependencies, runCompareNative44Cli, verifyNative44CurrentRevision } from '../src/native44/compare-cli.js';
import { canonicalV2, documentHashV2, hashV2, writeSnapshotRefV2 } from '../src/replica-v2/journal.js';
import { emitNative44DeliverySummary } from '../src/native44/delivery-summary.js';
import { importNative44CurrentCaptureReview, prepareNative44CurrentCaptureReview } from '../src/native44/current-review.js';
import { runNative44CurrentReviewCli, native44CurrentReviewMain, parseNative44CurrentReviewArguments } from '../src/native44/current-review-cli.js';
import { canonicalNative44CSS, native44CSSHash } from '../src/native44/css-handoff.js';
import { loadContext } from '../src/context/loader.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { fingerprintNative44Snapshot, type Native44CompareManifest } from '../src/native44/compare.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';
import type { OwnedReviewStatus } from '../src/wordpress/client.js';
import { contextRecordIdentity } from '../src/context/index.js';
import { createNative44CSSModel, compileNative44CSSModel } from '../src/native44/css-model.js';
import { createNative44RequirementContract, native44RequirementsHash, native44CapabilitySettingsHash, type Native44SourceScopeEvidenceSchema } from '../src/native44/requirements.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';
import type { z } from 'zod';
import { readNative44ReleaseLock } from '../src/native44/release-lock.js';
import type { Native44SourceUnit } from '../src/native44/selection-types.js';
import { readNative44CurrentCaptureManifest } from '../src/native44/current-capture-binding.js';
const eligibleStatus = (pageId: number, runId: string): OwnedReviewStatus => ({ pageId, runId, exists: true, postType: 'page', status: 'draft', ownerMatches: true, canEdit: true, uniqueRunPage: true, documentExists: true, builtWithElementor: true });

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-current-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runId = 'run-one', taskId = 'task-one', runDir = path.join(root, 'runs', runId), folder = path.join(runDir, 'amendments', 'user-request'), reviewDir = path.join(root, 'runs', 'review-one');
  const json = async (filename: string, value: unknown) => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value)); return { path: filename, sha256: hashV2(await readFile(filename)) }; };
  const css = '.elementor-77 .card{color:red}', canonicalHash = native44CSSHash(canonicalNative44CSS(css));
  const makeSnapshot = (style: string): DraftSnapshot => { const elements = [{ id: 'abc1234', elType: 'widget' as const, widgetType: 'wd_products', settings: { post_type: 'ids', include: [1], items_per_page: 1 }, elements: [] }], settings = { custom_css: style }; return { pageId: 77, runId, title: 'Draft', status: 'draft', elements, settings, hash: documentHashV2(elements, settings) }; };
  const before = makeSnapshot(''), after = makeSnapshot(css), request = await json(path.join(folder, 'request.json'), { version: 1, pageId: 77, runId, userInstruction: 'Apply CSS and inspect.' });
  await json(path.join(folder, 'before.json'), before); await json(path.join(folder, 'expected.json'), after);
  const currentSnapshot = await json(path.join(folder, 'after.json'), after); await writeFile(path.join(folder, 'page-custom.css'), css);
  const currentCSS = { path: path.join(folder, 'page-custom.css'), sha256: hashV2(css) };
  const intent = await json(path.join(folder, 'intent.json'), { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: 77, runId, beforeHash: before.hash, expectedHash: after.hash, payloadSha256: after.hash, requestSha256: request.sha256, cssSha256: currentCSS.sha256 });
  const receipt = await json(path.join(folder, 'receipt.json'), { version: 1, status: 'confirmed', pageId: 77, runId, beforeHash: before.hash, afterHash: after.hash, cssApplied: true });
  const captures = [];
  for (const viewport of ['desktop-wide', 'desktop-narrow']) { const refs = []; for (const role of ['source', 'target']) { const filename = path.join(reviewDir, `${viewport}-${role}.png`); await mkdir(reviewDir, { recursive: true }); const bytes = Buffer.from(`fixture pixels ${viewport} ${role}`); await writeFile(filename, bytes); refs.push({ path: filename, sha256: hashV2(bytes) }); } captures.push({ viewport, sourceScreenshot: refs[0], targetScreenshot: refs[1], interactions: [{ viewport, status: 'passed', problems: [] }], queries: [{ viewport, status: 'passed', problems: [] }] }); }
  const observedAt = new Date().toISOString();
  const report = { version: 1, kind: 'explicit-user-component-and-css-review', pageId: 77, runId, documentHash: after.hash, documentUnchanged: true, css: { applied: true, expectedHash: canonicalHash, actualHash: canonicalHash }, nativeProductSlots: 1, metrics: { documentWrites: 0, editorSessions: 0, viewports: 2 }, captures, observedAt };
  const verification = await json(path.join(reviewDir, 'report.json'), report);
  const reviews = captures.map(capture => ({ viewport: capture.viewport, sourceScreenshotHash: capture.sourceScreenshot.sha256, targetScreenshotHash: capture.targetScreenshot.sha256, documentHash: after.hash, verdict: 'reviewed', observedAt }));
  const visualReview = await json(path.join(reviewDir, 'visual-reviews.json'), reviews);
  const taskDir = path.join(root, 'references', taskId), oldRulesHash = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
  const realCatalog = await readFile(path.resolve(import.meta.dirname, '../config/native44-component-set.json')); await mkdir(path.join(root, 'config'), { recursive: true }); await writeFile(path.join(root, 'config/native44-component-set.json'), realCatalog);
  const componentCatalog = { path: path.join(root, 'config/native44-component-set.json'), sha256: NATIVE44_CATALOG_HASH }, knowledgeRef = await json(path.join(root, 'data/native44/index.json'), { version: 1 });
  const knowledge = { ...knowledgeRef, fingerprint }, sourceFacts = await json(path.join(taskDir, 'source-facts.json'), { sourceUrl: 'https://source.test/', snapshots: [{ viewport: { width: 1920, height: 1080, clientWidth: 1905, scrollbarWidth: 15 } }, { viewport: { width: 1440, height: 1000, clientWidth: 1425, scrollbarWidth: 15 } }] }), componentPlan = await json(path.join(taskDir, 'component-plan.json'), {}), assetsManifest = await json(path.join(taskDir, 'asset-manifest.json'), {});
  const program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, replicationProfile: 'desktop-browser-v1', selectionRulesHash: oldRulesHash, sourceUrl: 'https://source.test/', componentCatalog, knowledge, sourceFacts, componentPlan, assetsManifest, blocks: [] };
  const programRef = await json(path.join(taskDir, 'program.json'), program);
  const oldCode = { path: path.join(root, 'src/native44/old-code.ts'), sha256: 'd'.repeat(64) };
  await mkdir(path.dirname(oldCode.path), { recursive: true }); await writeFile(oldCode.path, 'Current source code has changed since this already saved revision.');
  const release = { version: 1, executorId: 'native44', componentSet: { id: 'native44-v1', catalog: componentCatalog, types: [...NATIVE44_ALL_TYPES] }, knowledge: { id: 'knowledge-v1', index: knowledgeRef, fingerprint }, selectionRules: { id: 'desktop-browser-v1', sha256: oldRulesHash, files: [oldCode] }, adapters: { id: 'native44-desktop-v1', sha256: 'c'.repeat(64), files: [oldCode] } };
  const releaseLock = await json(path.join(taskDir, 'release-lock.json'), { version: 1, kind: 'native44-release-lock', phase: 'final', taskId, replicationProfile: 'desktop-browser-v1', createdAt: observedAt, release, program: programRef, inputs: { componentCatalog, knowledge, sourceFacts, componentPlan, assetsManifest } });
  const journal = { version: 2, workflow: 'block-replication', taskId, runId, runDir, executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: oldRulesHash, pageId: 77, targetUrl: 'https://target.test/', programHash: programRef.sha256, releaseLock, documentHash: before.hash, status: 'awaiting-comparison', mutations: [{ status: 'confirmed', pageId: 77, runId, expectedAfterHash: before.hash, observedHash: before.hash }] };
  await json(path.join(runDir, 'journal.json'), journal);
  const pointer = { version: 1, kind: 'completed-explicit-user-draft-amendment', pageId: 77, runId, taskId, status: 'completed', unpublished: true, documentHash: after.hash, cssApplied: true, requestedScope: 'Native product components preserved; concrete products replaceable.', counts: { containers: 0, widgets: 1, html: 0, productWidgets: 1 }, amendments: [{ intent, receipt, beforeHash: before.hash, afterHash: after.hash }], verification, visualReview, currentSnapshot, currentCSS, completedAt: observedAt };
  const pointerFile = path.join(runDir, 'current-user-amendment.json'); await json(pointerFile, pointer);
  const manifest = { version: 1, strategy: 'native44-css-handoff', taskId, runId, pageId: 77, releaseLock, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/', replicationProfile: 'desktop-browser-v1', selectionRulesHash: oldRulesHash, ...fingerprintNative44Snapshot(after), canvasCss: '', widgetTypes: ['wd_products'], modules: [{ key: 'products', className: 'cwp-products', sourceSelector: '.products', targetSelector: '.elementor-77 .cwp-products', required: true }], cssRules: [], viewports: [{ name: 'desktop-wide', width: 1920, height: 1080 }, { name: 'desktop-narrow', width: 1440, height: 1000 }], sourceCaptures: { version: 2, taskId, replicationProfile: 'desktop-browser-v1', selectionRulesHash: oldRulesHash, collectionStartedAt: observedAt, sourceFacts, componentPlan, viewports: [{ viewport: 'desktop-wide', snapshotId: 'wide' }, { viewport: 'desktop-narrow', snapshotId: 'narrow' }] } } as Native44CompareManifest;
  return { root, runId, runDir, taskId, folder, json, pointer, pointerFile, report, reviews, journal, before, after, reviewDir, manifest };
}

async function successor(f: Awaited<ReturnType<typeof fixture>>) {
  const runId = 'replacement-run', pageId = 88, runDir = path.join(f.root, 'runs', runId), folder = path.join(runDir, 'amendments', 'copy-and-css'), reviewDir = path.join(f.root, 'runs', 'replacement-review');
  const userInstruction = 'Create a new unpublished copy and preserve the published source page.';
  const before: DraftSnapshot = { ...f.before, pageId, runId, elements: [], settings: { custom_css: '' } }; before.hash = documentHashV2(before.elements, before.settings);
  const css = String(f.after.settings.custom_css).replaceAll('.elementor-77', '.elementor-88'), after: DraftSnapshot = { ...f.after, pageId, runId, settings: { ...f.after.settings, custom_css: css } }; after.hash = documentHashV2(after.elements, after.settings);
  const request = await f.json(path.join(folder, 'request.json'), { version: 1, pageId, runId, userInstruction });
  await f.json(path.join(folder, 'before.json'), before); await f.json(path.join(folder, 'expected.json'), after); const currentSnapshot = await f.json(path.join(folder, 'after.json'), after);
  await writeFile(path.join(folder, 'page-custom.css'), css); const currentCSS = { path: path.join(folder, 'page-custom.css'), sha256: hashV2(css) };
  const intent = await f.json(path.join(folder, 'intent.json'), { version: 1, kind: 'explicit-user-owned-draft-amendment', pageId, runId, beforeHash: before.hash, expectedHash: after.hash, payloadSha256: after.hash, requestSha256: request.sha256, cssSha256: currentCSS.sha256 });
  const receipt = await f.json(path.join(folder, 'receipt.json'), { version: 1, status: 'confirmed', pageId, runId, beforeHash: before.hash, afterHash: after.hash, cssApplied: true });
  await mkdir(reviewDir, { recursive: true });
  const captures = [];
  for (const capture of f.report.captures) {
    const refs = [];
    for (const [role, source] of [['source', capture.sourceScreenshot], ['target', capture.targetScreenshot]] as const) { const filename = path.join(reviewDir, `${capture.viewport}-${role}.png`), bytes = await readFile(source.path); await writeFile(filename, bytes); refs.push({ path: filename, sha256: hashV2(bytes) }); }
    captures.push({ ...capture, sourceScreenshot: refs[0], targetScreenshot: refs[1] });
  }
  const cssHash = native44CSSHash(canonicalNative44CSS(css)), report = { ...f.report, pageId, runId, documentHash: after.hash, css: { applied: true, expectedHash: cssHash, actualHash: cssHash }, captures }, verification = await f.json(path.join(reviewDir, 'report.json'), report), visualReview = await f.json(path.join(reviewDir, 'visual-reviews.json'), f.reviews.map(review => ({ ...review, documentHash: after.hash })));
  const journal = { ...f.journal, runId, runDir, pageId, documentHash: before.hash, derivation: { parentRunId: f.runId, sourcePageId: 77, reason: 'Preserve the user-published page and continue on a separate draft.', userInstruction }, mutations: [{ kind: 'draft-create', status: 'confirmed', pageId, runId, expectedAfterHash: before.hash, observedHash: before.hash }] };
  const successorJournal = await f.json(path.join(runDir, 'journal.json'), journal);
  const pointer = { ...f.pointer, runId, pageId, documentHash: after.hash, amendments: [{ intent, receipt, beforeHash: before.hash, afterHash: after.hash }], currentSnapshot, currentCSS, verification, visualReview };
  await f.json(path.join(runDir, 'current-user-amendment.json'), pointer);
  const authorization = await f.json(path.join(runDir, 'derivation-request.json'), { version: 1, kind: 'explicit-user-derived-draft-request', taskId: f.taskId, runId, parentRunId: f.runId, sourcePageId: 77, userInstruction });
  const route = { version: 1, kind: 'native44-current-draft-successor', taskId: f.taskId, parentRunId: f.runId, parentPageId: 77, successorRunId: runId, successorPageId: pageId, parentState: { path: f.pointerFile, sha256: hashV2(await readFile(f.pointerFile)) }, successorJournal, authorization };
  const routeFile = path.join(f.runDir, 'current-successor.json'); await f.json(routeFile, route);
  return { runId, pageId, runDir, folder, before, after, pointer, journal, route, routeFile };
}

async function metadataNormalized(f: Awaited<ReturnType<typeof fixture>>, options: { beforeSettings?: Record<string, unknown>; expectedSettings?: Record<string, unknown>; actualSettings?: Record<string, unknown>; normalization?: Record<string, unknown> } = {}) {
  const before = { ...f.before, settings: { ...f.before.settings, post_title: f.before.title, post_status: 'draft', ...options.beforeSettings } }; before.hash = documentHashV2(before.elements, before.settings);
  const expected = { ...f.after, settings: { ...f.after.settings, ...options.expectedSettings } }; expected.hash = documentHashV2(expected.elements, expected.settings);
  const after = { ...expected, settings: { ...expected.settings, post_title: before.settings.post_title, post_status: 'draft', ...options.actualSettings } }; after.hash = documentHashV2(after.elements, after.settings);
  await f.json(path.join(f.folder, 'before.json'), before); await f.json(path.join(f.folder, 'expected.json'), expected); const currentSnapshot = await f.json(path.join(f.folder, 'after.json'), after); await f.json(path.join(f.folder, 'normalized-expected.json'), after);
  const intentValue = { ...JSON.parse(await readFile(f.pointer.amendments[0].intent.path, 'utf8')), beforeHash: before.hash, expectedHash: expected.hash, payloadSha256: expected.hash }, intent = await f.json(f.pointer.amendments[0].intent.path, intentValue);
  const receiptValue = { ...JSON.parse(await readFile(f.pointer.amendments[0].receipt.path, 'utf8')), beforeHash: before.hash, afterHash: after.hash, normalization: { kind: 'native-page-metadata-retained', inputHash: expected.hash, outputHash: after.hash, fields: ['post_title', 'post_status'], ...options.normalization } }, receipt = await f.json(f.pointer.amendments[0].receipt.path, receiptValue);
  await f.json(path.join(f.runDir, 'journal.json'), { ...f.journal, documentHash: before.hash, mutations: [{ ...f.journal.mutations[0], expectedAfterHash: before.hash, observedHash: before.hash }] });
  const verification = await f.json(f.pointer.verification.path, { ...f.report, documentHash: after.hash }), visualReview = await f.json(f.pointer.visualReview.path, f.reviews.map(review => ({ ...review, documentHash: after.hash })));
  const pointer = { ...f.pointer, documentHash: after.hash, currentSnapshot, verification, visualReview, amendments: [{ intent, receipt, beforeHash: before.hash, afterHash: after.hash }] }; await f.json(f.pointerFile, pointer);
  return { before, expected, after, intent, receipt, receiptValue, pointer };
}

async function parentOnlyContextIndex(f: Awaited<ReturnType<typeof fixture>>) {
  for (const filename of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md', '.agents/skills/reference-elementor/SKILL.md']) { await mkdir(path.dirname(path.join(f.root, filename)), { recursive: true }); await writeFile(path.join(f.root, filename), 'Project rules'); }
  const job = { version: 2, workflow: 'block-replication', taskId: f.taskId, executionStrategy: f.journal.executionStrategy, replicationProfile: f.journal.replicationProfile, selectionRulesHash: f.journal.selectionRulesHash, releaseLock: f.journal.releaseLock }, jobPath = path.join(f.root, 'references', f.taskId, 'job.json');
  await f.json(jobPath, job);
  const index = { version: 1, kind: 'clonewp-context-index', tasks: [{ taskId: f.taskId, mode: 'replica', job: { path: jobPath, identityHash: contextRecordIdentity(job) } }], runs: [{ runId: f.runId, taskId: f.taskId, mode: 'replica', recordKind: 'journal', record: { path: path.join(f.runDir, 'journal.json'), identityHash: contextRecordIdentity(f.journal) } }], issues: [] };
  const filename = path.join(f.root, 'data/system/context-index.json'); await f.json(filename, index);
  return { index, filename };
}

test('current state derives completed revision from the bound write/readback and review evidence, with no network', async t => {
  const f = await fixture(t), originalFetch = globalThis.fetch; let requests = 0;
  try {
    globalThis.fetch = (async () => { requests++; throw Error('network forbidden'); }) as typeof fetch;
    const journalBytes = await readFile(path.join(f.runDir, 'journal.json'));
    const current = await readNative44CurrentState(f.root, f.runDir, { runId: f.runId, taskId: f.taskId, pageId: 77, documentHash: f.before.hash });
    assert.equal(current?.status, 'delivered'); assert.equal(current?.documentHash, f.after.hash); assert.equal(current?.visualVerification, 'applied-verified'); assert.equal(current?.authority, 'verified-local-evidence');
    assert.ok(current.evidence.length > 12); assert.equal(requests, 0); assert.deepEqual(await readFile(path.join(f.runDir, 'journal.json')), journalBytes);
    await assert.rejects(assertNative44OriginalRunWritable(f.root, f.runDir), /native44_current_original_generation_frozen/);
    let reads = 0;
    assert.equal(await runCompareNative44Cli([f.runDir, '--verify-applied'], f.root, undefined, { probeOwnedReviewStatus: async (page, run) => eligibleStatus(page, run), readOwnedReviewCheckpoint: async (page, run, types) => { reads++; assert.equal(page, 77); assert.equal(run, f.runId); assert.deepEqual(types, ['wd_products']); return { snapshot: f.after }; } }), 0);
    assert.equal(reads, 1);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('pending applied revision cannot inherit previous completion or stale review, and still freezes original generation', async t => {
  const f = await fixture(t);
  await f.json(f.pointerFile, { ...f.pointer, status: 'applied-pending-review', verification: { path: 'nonexistent', sha256: 'b'.repeat(64) }, visualReview: undefined });
  const current = await readNative44CurrentState(f.root, f.runDir);
  assert.equal(current?.status, 'pending-css-review'); assert.equal(current?.deliveryComplete, false); assert.equal(current?.verification, undefined);
  await assert.rejects(assertNative44OriginalRunWritable(f.root, f.runDir), /native44_current_original_generation_frozen/);
});

test('saved current revision binds historical release and source scrollbar facts while old or forged manifests fail before authentication', async t => {
  const f = await fixture(t), originalFetch = globalThis.fetch; let requests = 0;
  try {
    globalThis.fetch = (async () => { requests++; throw Error('network forbidden'); }) as typeof fetch;
    const binding = await bindNative44CurrentCompareManifest(f.root, f.manifest);
    assert.equal(binding?.fingerprint.documentHash, f.after.hash); assert.deepEqual(binding?.sourceViewports.map((view: any) => view.scrollbarWidth), [15, 15]);
    const legacy = { ...f.manifest, ...fingerprintNative44Snapshot(f.before) };
    await assert.rejects(createNative44CompareDependencies(f.root, legacy), /native44_current_manifest_not_current/);
    for (const patch of [{ structureHash: 'e'.repeat(64) }, { resourceHash: 'e'.repeat(64) }, { queryHash: 'e'.repeat(64) }, { pageCss: '.other{}' }, { releaseLock: undefined }, { releaseLock: { ...f.manifest.releaseLock!, sha256: 'e'.repeat(64) } }, { widgetTypes: ['html'] }, { sourceUrl: 'https://other-source.test/' }]) await assert.rejects(createNative44CompareDependencies(f.root, { ...f.manifest, ...patch }), /native44_(current|release)_/);
    assert.equal(requests, 0);
    const programPath = path.join(f.root, 'references', f.taskId, 'program.json'); await writeFile(programPath, '{}');
    await assert.rejects(bindNative44CurrentCompareManifest(f.root, f.manifest), /native44_release_reference_changed/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('explicit v1 current capture accepts only an existing exact current manifest without migrating its frozen contract', async t => {
  const f = await fixture(t), filename = path.join(f.runDir, 'compare-manifest.json'), current = (await readNative44CurrentState(f.root, f.runDir))!;
  await assert.rejects(readNative44CurrentCaptureManifest(f.root, f.runDir, current), { code: 'ENOENT' });
  await f.json(filename, f.manifest);
  const bytes = await readFile(filename), binding = await readNative44CurrentCaptureManifest(f.root, f.runDir, current);
  assert.equal(binding.legacy, true); assert.equal(binding.manifestRef.sha256, hashV2(bytes)); assert.deepEqual(binding.manifestBytes, bytes); assert.equal(binding.binding.fingerprint.documentHash, f.after.hash);
  for (const patch of [{ ...fingerprintNative44Snapshot(f.before) }, { pageCss: '.other{}' }, { widgetTypes: ['html'] }, { sourceUrl: 'https://other-source.test/' }, { pageId: 88 }, { releaseLock: undefined }, { sourceCaptures: { ...f.manifest.sourceCaptures!, componentPlan: { ...f.manifest.sourceCaptures!.componentPlan, sha256: 'd'.repeat(64) } } }]) {
    await f.json(filename, { ...f.manifest, ...patch });
    await assert.rejects(readNative44CurrentCaptureManifest(f.root, f.runDir, current), /native44_(current|release)_/);
  }
  await writeFile(filename, bytes);
  const after = (await readNative44CurrentState(f.root, f.runDir))!; assert.equal(after.currentManifest, undefined); assert.equal(after.goalProfile, undefined); assert.equal(after.status, current.status); assert.deepEqual(await readFile(filename), bytes);
});

test('current verification requires a fresh owned complete fingerprint and does not create review or CSS files', async t => {
  const f = await fixture(t), files = [f.pointerFile, f.pointer.verification.path, f.pointer.visualReview.path, path.join(f.runDir, 'journal.json'), f.pointer.currentCSS.path], before = await Promise.all(files.map(file => readFile(file)));
  let reads = 0, closes = 0;
  const reader = (actual: DraftSnapshot) => ({ probeOwnedReviewStatus: async (page: number, run: string) => eligibleStatus(page, run), readOwnedReviewCheckpoint: async () => { reads++; return { snapshot: actual }; }, close: async () => { closes++; } });
  const verified = await verifyNative44CurrentRevision(f.root, f.runDir, reader(f.after));
  assert.equal(verified.status, 'verified'); assert.equal(verified.fullFingerprintMatches, true); assert.equal(verified.metrics.ownedCheckpointReads, 1); assert.match(verified.scope, /no new browser screenshots/);
  const changed = { ...f.after, settings: { ...f.after.settings, hide_title: 'yes' } }; changed.hash = documentHashV2(changed.elements, changed.settings);
  const stale = await verifyNative44CurrentRevision(f.root, f.runDir, reader(changed));
  assert.equal(stale.status, 'not-current'); assert.equal(stale.deliveryComplete, false); assert.equal(stale.fullFingerprintMatches, false);
  const wrongOwner = await verifyNative44CurrentRevision(f.root, f.runDir, reader({ ...f.after, runId: 'other-run' })); assert.equal(wrongOwner.status, 'not-current');
  for (const [index, file] of files.entries()) assert.deepEqual(await readFile(file), before[index]);
  await f.json(f.pointerFile, { ...f.pointer, status: 'applied-pending-review' });
  const pending = await verifyNative44CurrentRevision(f.root, f.runDir, reader(f.after)); assert.equal(pending.status, 'pending-review'); assert.equal(pending.deliveryComplete, false); assert.equal(pending.visualReview, undefined);
  assert.equal(reads, 4); assert.equal(closes, 4);
});

test('published, missing, changed owner and permission states are named not-current before any checkpoint or browser access', async t => {
  const f = await fixture(t), base = eligibleStatus(77, f.runId);
  const cases: Array<[Partial<OwnedReviewStatus>, string]> = [[{ status: 'publish' }, 'native44_current_page_published'], [{ exists: false, postType: null, status: null, ownerMatches: false, canEdit: false, uniqueRunPage: false, documentExists: false, builtWithElementor: false }, 'native44_current_page_missing'], [{ ownerMatches: false, documentExists: false, builtWithElementor: false }, 'native44_current_page_not_owned'], [{ canEdit: false, documentExists: false, builtWithElementor: false }, 'native44_current_page_not_editable'], [{ uniqueRunPage: false }, 'native44_current_run_pages_ambiguous']];
  const before = await readFile(f.pointerFile);
  for (const [patch, reason] of cases) {
    let checkpointReads = 0, closed = false;
    const result = await verifyNative44CurrentRevision(f.root, f.runDir, { probeOwnedReviewStatus: async () => ({ ...base, ...patch }), readOwnedReviewCheckpoint: async () => { checkpointReads++; throw Error('Ineligible page must never reach draft checkpoint'); }, close: async () => { closed = true; } });
    assert.equal(result.status, 'not-current'); assert.equal('reason' in result ? result.reason : undefined, reason); assert.equal(result.deliveryComplete, false); assert.equal(result.metrics.ownedCheckpointReads, 0); assert.equal(checkpointReads, 0); assert.equal(closed, true);
  }
  assert.deepEqual(await readFile(f.pointerFile), before);
});

test('authorized successor routes old resume/compare to a verified new draft while preserving parent artifacts and current program', async t => {
  const f = await fixture(t), parentBytes = await readFile(f.pointerFile), s = await successor(f);
  const state = await readNative44CurrentState(f.root, f.runDir, { taskId: f.taskId, runId: f.runId, pageId: 77 });
  assert.equal(state?.runId, s.runId); assert.equal(state?.pageId, s.pageId); assert.equal(state?.documentHash, s.after.hash); assert.deepEqual(state?.resolvedFrom, { runId: f.runId, pageId: 77 }); assert.equal(state?.successorRoutes?.length, 1);
  let actualRun = '';
  const result = await verifyNative44CurrentRevision(f.root, f.runDir, { probeOwnedReviewStatus: async (page, run) => { assert.equal(page, 88); actualRun = run; return eligibleStatus(page, run); }, readOwnedReviewCheckpoint: async () => ({ snapshot: s.after }) });
  assert.equal(result.status, 'verified'); assert.equal(actualRun, s.runId); assert.deepEqual(await readFile(f.pointerFile), parentBytes);
  for (const filename of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md', '.agents/skills/reference-elementor/SKILL.md']) { await mkdir(path.dirname(path.join(f.root, filename)), { recursive: true }); await writeFile(path.join(f.root, filename), 'Project rules'); }
  await f.json(path.join(f.root, 'references', f.taskId, 'job.json'), { version: 2, workflow: 'block-replication', taskId: f.taskId, executionStrategy: f.journal.executionStrategy, replicationProfile: f.journal.replicationProfile, selectionRulesHash: f.journal.selectionRulesHash, releaseLock: f.journal.releaseLock });
  const deps = { readCurrentRelease: async (): Promise<never> => { throw Error('No default migration'); }, loadComponentRegistry: async (): Promise<never> => { throw Error('No default migration'); } };
  for (const options of [{ intent: 'resume' as const, run: f.runId }, { intent: 'compare' as const, run: f.runId }, { intent: 'resume' as const, task: f.taskId }]) { const loaded = await loadContext({ root: f.root, ...options }, deps); assert.equal(loaded.status, 'ready', JSON.stringify(loaded.gaps)); assert.equal(loaded.task?.runId, s.runId); assert.equal(loaded.task?.state.pageId, s.pageId); assert.equal(loaded.task?.state.documentHash, s.after.hash); }
});

test('explicit derived run absent from a cached index is resolved only through its verified indexed-parent successor graph', async t => {
  const f = await fixture(t), s = await successor(f), cached = await parentOnlyContextIndex(f), indexBytes = await readFile(cached.filename), parentBytes = await readFile(path.join(f.runDir, 'journal.json')), childBytes = await readFile(path.join(s.runDir, 'journal.json'));
  const deps = { readCurrentRelease: async (): Promise<never> => { throw Error('Do not migrate frozen execution contracts'); }, loadComponentRegistry: async (): Promise<never> => { throw Error('Do not load new defaults'); } };
  for (const intent of ['resume', 'compare'] as const) {
    const loaded = await loadContext({ root: f.root, intent, run: s.runId }, deps);
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded.gaps)); assert.equal(loaded.task?.runId, s.runId); assert.equal(loaded.task?.state.pageId, s.pageId); assert.equal(loaded.task?.state.documentHash, s.after.hash); assert.equal(loaded.task?.state.status, 'delivered');
    assert.ok(loaded.records.some(file => file.path === s.routeFile)); assert.deepEqual([loaded.metrics.networkRequests, loaded.metrics.credentialLoads, loaded.metrics.browserStarts, loaded.metrics.fileWrites], [0, 0, 0, 0]);
  }
  assert.deepEqual(await readFile(cached.filename), indexBytes); assert.deepEqual(await readFile(path.join(f.runDir, 'journal.json')), parentBytes); assert.deepEqual(await readFile(path.join(s.runDir, 'journal.json')), childBytes);
});

test('a cache-missing child cannot self-authorize an unrelated, tampered or unlinked parent, or bypass explicit run identity', async t => {
  const f = await fixture(t), s = await successor(f), cached = await parentOnlyContextIndex(f), deps = { readCurrentRelease: async (): Promise<never> => { throw Error('No execution defaults'); }, loadComponentRegistry: async (): Promise<never> => { throw Error('No execution defaults'); } };
  const load = () => loadContext({ root: f.root, intent: 'compare', run: s.runId }, deps);
  await f.json(cached.filename, { ...cached.index, runs: cached.index.runs.map(run => ({ ...run, record: { ...run.record, identityHash: 'e'.repeat(64) } })) });
  assert.equal((await load()).gaps[0].code, 'context_derived_run_parent_identity_conflict');
  await f.json(cached.filename, { ...cached.index, runs: cached.index.runs.map(run => ({ ...run, taskId: 'other-task' })) });
  assert.equal((await load()).gaps[0].code, 'context_derived_run_parent_not_indexed');
  await f.json(cached.filename, cached.index); await rm(s.routeFile);
  assert.equal((await load()).gaps[0].code, 'context_derived_run_successor_unproven');
  await f.json(s.routeFile, { ...s.route, authorization: { ...s.route.authorization, sha256: 'e'.repeat(64) } });
  assert.equal((await load()).gaps[0].code, 'native44_current_hash_mismatch');
  await f.json(s.routeFile, s.route); await f.json(path.join(s.runDir, 'journal.json'), { ...s.journal, derivation: undefined });
  assert.equal((await load()).gaps[0].code, 'context_run_not_found_or_task_conflict');
  assert.equal((await loadContext({ root: f.root, intent: 'compare', run: '../replacement-run' }, deps)).gaps[0].code, 'context_selector_invalid');
});

test('successor routes reject missing proof, wrong page/task/derivation, traversal, cycles and modified child evidence', async t => {
  const f = await fixture(t), s = await successor(f);
  for (const patch of [{ taskId: 'other-task' }, { parentPageId: 78 }, { successorPageId: 89 }, { successorRunId: '../outside' }, { successorRunId: f.runId }, { authorization: { ...s.route.authorization, sha256: 'e'.repeat(64) } }, { successorJournal: { ...s.route.successorJournal, path: f.pointerFile } }, { parentState: { ...s.route.parentState, sha256: 'e'.repeat(64) } }]) { await f.json(s.routeFile, { ...s.route, ...patch }); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_/); }
  await f.json(s.routeFile, s.route);
  const changed = { ...s.journal, derivation: { ...s.journal.derivation, sourcePageId: 999 } }, successorJournal = await f.json(s.route.successorJournal.path, changed); await f.json(s.routeFile, { ...s.route, successorJournal });
  await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_successor_journal_derivation_conflict/);
  await f.json(s.route.successorJournal.path, s.journal); await f.json(s.routeFile, s.route);
  await writeFile(s.pointer.currentCSS.path, '.changed{}'); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_hash_mismatch/);
});

test('native metadata retention validates exact expected omission and retained draft metadata without rewriting intent or repeating a save', async t => {
  const f = await fixture(t), normalized = await metadataNormalized(f), intentBytes = await readFile(normalized.intent.path), expectedBytes = await readFile(path.join(f.folder, 'expected.json'));
  const current = await readNative44CurrentState(f.root, f.runDir);
  assert.equal(current?.status, 'delivered'); assert.equal(current?.documentHash, normalized.after.hash); assert.notEqual(normalized.expected.hash, normalized.after.hash);
  assert.deepEqual(await readFile(normalized.intent.path), intentBytes); assert.deepEqual(await readFile(path.join(f.folder, 'expected.json')), expectedBytes);
  const receipt = await f.json(normalized.receipt.path, { ...normalized.receiptValue, normalization: undefined }); await f.json(f.pointerFile, { ...normalized.pointer, amendments: [{ ...normalized.pointer.amendments[0], receipt }] });
  await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_chain_intent_receipt_conflict/);
});

test('native metadata normalization rejects published or wrong titles, supplied metadata, unrelated changes and broadened receipts', async t => {
  const cases = [{ beforeSettings: { post_title: 'A different title' } }, { beforeSettings: { post_status: 'publish' } }, { expectedSettings: { post_title: 'Draft' } }, { expectedSettings: { post_status: 'draft' } }, { actualSettings: { post_title: 'A different title' } }, { actualSettings: { post_status: 'publish' } }, { actualSettings: { background_color: 'red' } }, { normalization: { fields: ['post_status', 'post_title'] } }, { normalization: { inputHash: 'f'.repeat(64) } }, { normalization: { outputHash: 'f'.repeat(64) } }, { normalization: { additionalKeysAllowed: true } }];
  for (const options of cases) { const f = await fixture(t); await metadataNormalized(f, options); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_chain_metadata_normalization_(invalid|mismatch)/); }
  const f = await fixture(t), normalized = await metadataNormalized(f); await f.json(path.join(f.folder, 'normalized-expected.json'), { ...normalized.after, title: 'Forged outer snapshot title' });
  await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_chain_metadata_normalization_mismatch/);
});

test('tampered or missing bound evidence gives named failure instead of trusting completed', async t => {
  const f = await fixture(t);
  const cssPath = f.pointer.currentCSS.path, bytes = await readFile(cssPath);
  await writeFile(cssPath, '.changed{}'); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_hash_mismatch: .*page-custom.css/);
  await writeFile(cssPath, bytes); await rm(f.pointer.verification.path);
  await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_file_missing: .*report.json/);
  await assert.rejects(assertNative44OriginalRunWritable(f.root, f.runDir), /native44_current_file_missing/);
});

test('rehashed report cannot claim a different page, stylesheet, failed checks or stale pixels', async t => {
  const f = await fixture(t);
  const patches = [{ pageId: 78 }, { documentHash: 'b'.repeat(64) }, { css: { applied: true, expectedHash: 'b'.repeat(64), actualHash: 'b'.repeat(64) } }, { metrics: { documentWrites: 1, editorSessions: 0, viewports: 2 } }, { captures: [f.report.captures[0], f.report.captures[0]] }, { captures: f.report.captures.map(capture => ({ ...capture, queries: [{ viewport: capture.viewport, status: 'failed', problems: ['actual product missing'] }] })) }];
  for (const patch of patches) { const verification = await f.json(f.pointer.verification.path, { ...f.report, ...patch }); await f.json(f.pointerFile, { ...f.pointer, verification }); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_(verification|visual)/); }
  const verification = await f.json(f.pointer.verification.path, f.report); await f.json(f.pointerFile, { ...f.pointer, verification });
  await writeFile(f.report.captures[0].targetScreenshot.path, 'different actual pixels');
  await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_hash_mismatch: .*target.png/);
});

test('chain discontinuity, current pointer identity, counts and path escape fail closed even with changed index', async t => {
  const f = await fixture(t);
  for (const patch of [{ taskId: 'other-task' }, { pageId: 78 }, { runId: 'other-run' }, { counts: { ...f.pointer.counts, productWidgets: 0 } }, { amendments: [{ ...f.pointer.amendments[0], beforeHash: 'b'.repeat(64) }] }, { currentSnapshot: { path: path.join(f.root, '..', 'outside-after.json'), sha256: 'b'.repeat(64) } }]) { await f.json(f.pointerFile, { ...f.pointer, ...patch }); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_/); }
  await f.json(f.pointerFile, f.pointer); const intent = { ...JSON.parse(await readFile(f.pointer.amendments[0].intent.path, 'utf8')), runId: 'another-run' }; const ref = await f.json(f.pointer.amendments[0].intent.path, intent); await f.json(f.pointerFile, { ...f.pointer, amendments: [{ ...f.pointer.amendments[0], intent: ref }] });
  await assert.rejects(readNative44CurrentState(f.root, f.runDir), /native44_current_chain_intent_receipt_conflict/);
});

test('context resume/compare presents current CSS/hash/scope, preserves historical journal and never loads new execution defaults', async t => {
  const f = await fixture(t);
  for (const filename of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md', '.agents/skills/reference-elementor/SKILL.md']) { await mkdir(path.dirname(path.join(f.root, filename)), { recursive: true }); await writeFile(path.join(f.root, filename), 'Project rules'); }
  await f.json(path.join(f.root, 'references', f.taskId, 'job.json'), { version: 2, workflow: 'block-replication', taskId: f.taskId, executionStrategy: f.journal.executionStrategy, replicationProfile: f.journal.replicationProfile, selectionRulesHash: f.journal.selectionRulesHash });
  await f.json(path.join(f.root, 'references', f.taskId, 'task-scope.json'), { version: 1, kind: 'clonewp-task-scope', taskId: f.taskId, summary: 'OLD PRODUCTS DEFERRED TO USER', constraints: [] });
  const deps = { readCurrentRelease: async (): Promise<never> => { throw Error('current execution contracts must not be loaded'); }, loadComponentRegistry: async (): Promise<never> => { throw Error('current defaults must not be applied'); } };
  for (const intent of ['resume', 'compare'] as const) { const result = await loadContext({ root: f.root, intent, run: f.runId }, deps); assert.equal(result.status, 'ready', JSON.stringify(result.gaps)); assert.equal(result.task?.state.documentHash, f.after.hash); assert.equal(result.task?.state.status, 'delivered'); assert.equal(result.task?.state.historicalRuntimeStatus, 'awaiting-comparison'); assert.equal(result.contractSelection, 'task-amendment-read-only'); assert.doesNotMatch(JSON.stringify(result.task?.scope), /OLD PRODUCTS/); assert.match(result.nextAction, /currentSnapshot\/currentCSS/); assert.deepEqual([result.metrics.networkRequests, result.metrics.credentialLoads, result.metrics.browserStarts, result.metrics.fileWrites], [0, 0, 0, 0]); }
});

async function versionTwoFixture(t: test.TestContext, options: { criticalGap?: boolean; minorDeviation?: boolean; componentReference?: boolean; failedSearch?: boolean; scopedSearch?: boolean } = {}) {
  const f = await fixture(t), taskDir = path.join(f.root, 'references', f.taskId), observedAt = new Date().toISOString();
  f.report.observedAt = observedAt;
  for (const [index, capture] of f.report.captures.entries()) for (const key of ['sourceScreenshot', 'targetScreenshot'] as const) { const bytes = await sharp({ create: { width: index ? 1440 : 1920, height: index ? 1000 : 1080, channels: 3, background: '#ffffff' } }).png().toBuffer(); await writeFile(capture[key].path, bytes); capture[key].sha256 = hashV2(bytes); }
  for (const review of f.reviews) { const capture = f.report.captures.find(item => item.viewport === review.viewport)!; review.observedAt = observedAt; review.sourceScreenshotHash = capture.sourceScreenshot.sha256; review.targetScreenshotHash = capture.targetScreenshot.sha256; }
  const productChecks: NonNullable<Native44CompareManifest['productChecks']> = [{ componentKey: 'products', widgetType: 'wd_products', selector: '.elementor-77 .cwp-products', expectedProductIds: [1], catalog: { targetOrigin: 'https://target.test', evidence: ['actual-target-query'], products: [{ id: 1, name: 'Target product', permalink: 'https://target.test/product/1/', imageUrl: 'https://target.test/1.png', priceText: '$1.00' }] } }];
  for (const capture of f.report.captures) capture.queries = productChecks.map(check => ({ ...check, viewport: capture.viewport, status: 'passed', problems: [] }));
  const packet = await f.json(path.join(taskDir, 'reference', 'packet.json'), { observed: 'Source header content and two desktop frames.' });
  const source: any = { sourceUrl: 'https://source.test/', snapshots: [], facts: {} }, sourceUnits: Native44SourceUnit[] = [];
  const scopeBaselines: z.infer<typeof Native44SourceScopeEvidenceSchema>['baselines'] = [];
  for (const [index, capture] of f.report.captures.entries()) {
    const snapshotId = index ? 'narrow' : 'wide', nodeId = 'header', factId = `text-${snapshotId}`;
    const nodes: any = { header: { parentId: null, regionId: 'header', tag: 'div', selector: '.header', childIds: [] } };
    if (options.criticalGap) { nodes.header.childIds.push('search'); nodes.search = { parentId: 'header', regionId: 'header', tag: 'input', selector: '#search-input', childIds: [] }; }
    let baselinePacket = packet;
    if (options.scopedSearch) {
      const width = index ? 1440 : 1920, height = index ? 1000 : 1080, zero = { x: 0, y: 0, width: 0, height: 0 }, rect = { x: 0, y: 0, width, height };
      nodes.header.childIds.push('trigger'); nodes.trigger = { parentId: 'header', regionId: 'header', tag: 'div', selector: '#desktop-menu', childIds: [] };
      const layout = (id: string, bounds: typeof rect): ObservationPacketV2['layouts'][string] => ({ id, rect: bounds, contentRect: bounds, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: id === 'search' ? 'none' : 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 });
      const raw: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: snapshotId, url: source.sourceUrl, title: 'Bound desktop scope fixture', capturedAt: '2026-10-16T00:00:00.000Z', viewport: { name: index ? 'desktop-narrow' : 'desktop', width, height, clientWidth: width - 15, scrollbarWidth: 15, devicePixelRatio: 1 }, pageHeight: height, screenshot: { ...capture.sourceScreenshot, width, height } }, nodes: { header: { id: 'header', parentId: null, regionId: 'header', tag: 'div', selector: '.header', attributes: {}, childIds: ['search', 'trigger'], styleId: 'shown', layoutId: 'header', visible: true }, search: { id: 'search', parentId: 'header', regionId: 'header', tag: 'input', selector: '#search-input', attributes: { type: 'search' }, childIds: [], styleId: 'hidden', layoutId: 'search', visible: false }, trigger: { id: 'trigger', parentId: 'header', regionId: 'header', tag: 'div', selector: '#desktop-menu', attributes: {}, childIds: [], styleId: 'shown', layoutId: 'trigger', visible: true } }, regions: [{ id: 'header', nodeId: 'header', contentNodeId: 'header', role: 'header', order: 0, gapBefore: 0 }], texts: {}, styles: { shown: { display: 'block', visibility: 'visible', opacity: '1' }, hidden: { display: 'none', visibility: 'visible', opacity: '1' } }, layouts: { header: layout('header', rect), search: layout('search', zero), trigger: layout('trigger', { x: 10, y: 10, width: 40, height: 40 }) }, resources: {}, usages: {}, interactions: { trigger: { id: 'trigger', nodeId: 'trigger', regionId: 'header', kind: 'control', status: 'unobserved', details: { label: 'Expand menu' } } }, gaps: [] };
      baselinePacket = await f.json(path.join(taskDir, 'reference', `${snapshotId}.json`), raw);
      const states: z.infer<typeof Native44SourceScopeEvidenceSchema>['baselines'][number]['states'] = [];
      for (const action of ['activated', 'hovered'] as const) { const state = structuredClone(raw); state.snapshot.id += `-${action}`; state.snapshot.capturedAt = '2026-10-16T00:00:10.000Z'; state.interactions.trigger.status = 'observed'; state.interactions.trigger.details = { scopeProbeTargetSelector: '#search-input', scopeProbeAction: action, scopeProbeResult: 'still-hidden' }; states.push({ triggerNodeId: 'trigger', action, packet: await f.json(path.join(f.root, 'references', 'earlier-source-observation', `${snapshotId}-${action}.json`), state) }); }
      scopeBaselines.push({ snapshotId, nodeId: 'search', packet: baselinePacket, states });
    }
    source.snapshots.push({ id: snapshotId, viewport: { name: capture.viewport, width: index ? 1440 : 1920, height: index ? 1000 : 1080, clientWidth: index ? 1425 : 1905, scrollbarWidth: 15 }, nodes, screenshot: capture.sourceScreenshot, evidence: [baselinePacket] });
    source.facts[factId] = { id: factId, snapshotId, regionId: 'header', nodeId, kind: 'text', value: { kind: 'body', text: 'Source header' }, evidence: packet };
    sourceUnits.push({ id: `header-${snapshotId}`, snapshotId, ownerNodeId: nodeId, regionId: 'header', role: 'body', sourceFactIds: [factId], slots: [{ id: `copy-${snapshotId}`, kind: 'text', factIds: [factId], required: true }], evidence: { factIds: [factId], screenshots: [{ snapshotId, screenshot: capture.sourceScreenshot }], rationale: 'The frozen source header owns this complete body text.' } });
  }
  const sourceFacts = await f.json(path.join(taskDir, 'source-facts.json'), source), componentPlan = await f.json(path.join(taskDir, 'component-plan.json'), { sourceUnits });
  const oldLock = JSON.parse(await readFile(f.journal.releaseLock.path, 'utf8')), program = JSON.parse(await readFile(oldLock.program.path, 'utf8'));
  const productComponent = { key: 'products', kind: 'native-products' as const, widgetType: 'wd_products' as const, widgetSettings: { post_type: 'ids', include: [1], items_per_page: 1 }, query: { ids: [1], evidence: ['actual-target-query'] } };
  const programRef = await f.json(oldLock.program.path, { ...program, sourceFacts, componentPlan, blocks: [productComponent] });
  const lockRef = await f.json(f.journal.releaseLock.path, { ...oldLock, program: programRef, inputs: { ...oldLock.inputs, sourceFacts, componentPlan } });
  Object.assign(f.journal, { programHash: programRef.sha256, releaseLock: lockRef }); await f.json(path.join(f.runDir, 'journal.json'), f.journal);
  const elements = structuredClone(f.after.elements); elements[0].settings.css_classes = 'cwp-products';
  const model = createNative44CSSModel({ taskId: f.taskId, runId: f.runId, pageId: 77, replicationProfile: 'desktop-browser-v1', modules: [{ key: 'products', className: 'cwp-products' }], rules: [{ id: 'product-color', moduleKey: 'products', slot: 'content', property: 'color', responsibility: 'css', value: 'red', reason: 'Match the independently observed source content color.', evidence: ['frozen-source-packet'] }] });
  const compiled = compileNative44CSSModel(model, { elements }), settings = { custom_css: compiled.css }, after = { ...f.after, elements, settings, hash: documentHashV2(elements, settings) };
  await f.json(path.join(f.folder, 'expected.json'), after); const currentSnapshot = await f.json(path.join(f.folder, 'after.json'), after); await writeFile(f.pointer.currentCSS.path, compiled.css); const currentCSS = { path: f.pointer.currentCSS.path, sha256: hashV2(compiled.css) };
  const oldIntent = JSON.parse(await readFile(f.pointer.amendments[0].intent.path, 'utf8')); let intent = await f.json(f.pointer.amendments[0].intent.path, { ...oldIntent, expectedHash: after.hash, payloadSha256: after.hash, cssSha256: currentCSS.sha256 });
  const receipt = await f.json(f.pointer.amendments[0].receipt.path, { version: 1, status: 'confirmed', pageId: 77, runId: f.runId, beforeHash: f.before.hash, afterHash: after.hash, cssApplied: true, confirmedAt: observedAt });
  const report = { ...f.report, documentHash: after.hash, css: { applied: true, expectedHash: compiled.canonicalSha256, actualHash: compiled.canonicalSha256 } }; let verification = await f.json(f.pointer.verification.path, report); const visualReview = await f.json(f.pointer.visualReview.path, f.reviews.map(review => ({ ...review, documentHash: after.hash })));
  const contract = createNative44RequirementContract(source, sourceUnits, sourceFacts, f.taskId, options.componentReference ? { goalProfile: 'component-reference-v1' } : {});
  if (options.scopedSearch) { const evidence = await f.json(path.join(taskDir, 'source-scope.json'), { version: 1, kind: 'native44-source-scope-evidence', classification: 'outside-desktop', sourceFacts, targetSelector: '#search-input', baselines: scopeBaselines, review: { reviewer: 'codex', reviewedAt: observedAt, judgment: 'Both actual desktop baselines and every visible regional controller state keep this input in its original hidden zero-area subtree.' } }); contract.sourceScopes = contract.requirements.filter(row => row.capability === 'search-input').map(row => ({ sourceKey: row.sourceKey, classification: 'outside-desktop', evidence, reason: 'Both desktop states and all visible regional controller actions were actually captured with this hidden input.' })); }
  if (options.failedSearch) { const requirement = contract.requirements.find(item => item.capability === 'search-input')!; for (const capture of report.captures) capture.interactions.push({ requirementId: requirement.id, widgetType: 'icon-box', selector: '.elementor-77 .cwp-search', viewport: capture.viewport, status: 'blocked', problems: ['Native search integration has not been connected.'] } as any); verification = await f.json(f.pointer.verification.path, report); }
  for (const requirement of contract.requirements) if (!(options.criticalGap && requirement.capability === 'search-input')) { const proof = await f.json(path.join(f.folder, `proof-${requirement.id}.json`), { version: 1, kind: 'native44-capability-proof', capability: requirement.capability, method: 'registered-contract', components: [{ key: 'products', widgetType: 'wd_products', settingsHash: native44CapabilitySettingsHash(productComponent) }], observations: { contentPresent: true, nativeControlsEditable: true, layoutControlsAvailable: true, presentationControlsAvailable: true }, evidence: [packet] }); requirement.fulfillment = { route: 'verified-native', componentKeys: ['products'], capability: requirement.capability, proof }; }
  const requirementsRef = await f.json(path.join(f.folder, 'requirements.json'), contract), sourceUnitsRef = await f.json(path.join(f.folder, 'source-units.json'), sourceUnits), requirementsHash = native44RequirementsHash(contract);
  if (options.componentReference) { const request = await f.json(path.join(f.folder, 'request.json'), { version: 1, kind: 'native44-revision-request', taskId: f.taskId, runId: f.runId, pageId: 77, userInstruction: 'Explicitly deliver an editable component reference with named open integrations.', requirements: requirementsRef }); intent = await f.json(intent.path, { ...JSON.parse(await readFile(intent.path, 'utf8')), requestSha256: request.sha256, goalProfile: contract.goalProfile, requirementsRef }); }
  const checks = contract.requirements.flatMap(requirement => requirement.checks.map(check => ({ requirementId: requirement.id, checkId: check.id, outcome: 'pass' as 'pass' | 'fail', evidence: [verification], issue: undefined as { category: 'geometry'; message: string; delta: number; unit: string } | undefined })));
  const tolerances = [];
  if (options.minorDeviation) { const requirement = contract.requirements.find(item => item.dimension === 'layout')!, check = checks.find(item => item.requirementId === requirement.id)!; check.outcome = 'fail'; check.issue = { category: 'geometry', message: 'Fractional desktop rounding.', delta: 0.5, unit: 'px' }; tolerances.push({ checkId: check.checkId, maxDelta: 1, unit: 'px', reason: 'Accept source-evidenced fractional desktop rounding.' }); }
  const acceptancePolicyRef = await f.json(path.join(f.folder, 'acceptance-policy.json'), { version: 1, kind: 'native44-acceptance-policy', requirementsHash, tolerances, acceptedDeviations: [] });
  const acceptanceObservationRef = await f.json(path.join(f.folder, 'acceptance-observation.json'), { version: 1, kind: 'native44-acceptance-observation', requirementsHash, documentHash: after.hash, cssHash: compiled.canonicalSha256, review: { verification, visualReview }, checks });
  const manifest = { ...f.manifest, productChecks, releaseLock: lockRef, ...fingerprintNative44Snapshot(after), sourceCaptures: { ...f.manifest.sourceCaptures!, sourceFacts, componentPlan } }, manifestRef = await f.json(path.join(f.folder, 'compare-manifest.json'), manifest), cssModelRef = await f.json(path.join(f.folder, 'css-model.json'), model);
  const pointer = buildNative44CurrentRevisionPointer({ identity: { taskId: f.taskId, runId: f.runId, pageId: 77, beforeHash: f.before.hash }, step: { intent, receipt, beforeHash: f.before.hash, afterHash: after.hash }, documentHash: after.hash, currentSnapshot, currentCSS, counts: f.pointer.counts, requestedScope: 'Current review, requirements and delivery are evaluated independently.', recordedAt: observedAt, cssModelRef, manifestRef, sourceUnitsRef, requirementsRef, acceptancePolicyRef, acceptanceObservationRef, verification, visualReview });
  await f.json(f.pointerFile, pointer);
  return { f, pointer, after, model, compiled, report, manifest, contract, observedAt };
}

async function evidenceCandidate(value: Awaited<ReturnType<typeof versionTwoFixture>>) {
  const { f, pointer, contract } = value;
  const requirementsRef = await f.json(pointer.requirementsRef.path, contract), policy = JSON.parse(await readFile(pointer.acceptancePolicyRef.path, 'utf8'));
  const acceptancePolicyRef = await f.json(pointer.acceptancePolicyRef.path, { ...policy, requirementsHash: native44RequirementsHash(contract) });
  const { verification: _verification, visualReview: _visualReview, acceptanceObservationRef: _observation, ...candidate } = pointer;
  return { ...candidate, requirementsRef, acceptancePolicyRef };
}

test('v2 current reader re-verifies caption source graphs rather than trusting stored model metadata', async t => {
  const value = await versionTwoFixture(t), { f, pointer, model } = value;
  const proof = { path: path.join(f.root, 'references', f.taskId, 'unproven-caption.json'), sha256: 'a'.repeat(64) };
  for (const state of ['default', 'hover', 'focus-within'] as const) model.rules.push({ id: `caption-${state}`, moduleKey: 'products', slot: 'caption', selector: `.cwp-card${state === 'default' ? '' : `:${state}`} .elementor-image-box-content`, property: 'opacity', responsibility: 'css', value: state === 'default' ? '0' : '1', reason: 'This deliberately unproven caption graph must be independently rejected.', evidence: [proof.path], nativeStructure: { kind: 'image-box-caption-reveal', componentKey: 'card', elementId: 'card123', cardClass: 'cwp-card', state, proof, sourceEvidence: proof.path } });
  pointer.cssModelRef = await f.json(pointer.cssModelRef.path, model);
  await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, pointer), /native44_image_box_caption_frozen_source_identity_invalid/);
});

async function frozenKnowledgeEvidence(value: Awaited<ReturnType<typeof versionTwoFixture>>) {
  const { f, pointer } = value, file = await f.json(path.join(f.root, 'data/native44/components/wd_products.json'), { componentType: 'wd_products', observed: 'Frozen component declaration.' });
  const lock = JSON.parse(await readFile(f.journal.releaseLock.path, 'utf8')), program = JSON.parse(await readFile(lock.program.path, 'utf8'));
  const index = await f.json(lock.inputs.knowledge.path, { fingerprint: lock.inputs.knowledge.fingerprint, components: { wd_products: { path: 'components/wd_products.json', sha256: file.sha256 } } });
  const knowledge = { ...index, fingerprint: lock.inputs.knowledge.fingerprint }, programRef = await f.json(lock.program.path, { ...program, knowledge });
  const releaseLock = await f.json(f.journal.releaseLock.path, { ...lock, program: programRef, release: { ...lock.release, knowledge: { ...lock.release.knowledge, index } }, inputs: { ...lock.inputs, knowledge } });
  Object.assign(f.journal, { releaseLock, programHash: programRef.sha256 }); await f.json(path.join(f.runDir, 'journal.json'), f.journal);
  const manifest = JSON.parse(await readFile(pointer.manifestRef.path, 'utf8')); pointer.manifestRef = await f.json(pointer.manifestRef.path, { ...manifest, releaseLock });
  const requirement = value.contract.requirements.find(row => row.fulfillment.route !== 'gap')!, proofRef = requirement.fulfillment.route !== 'gap' ? requirement.fulfillment.proof : undefined;
  assert.ok(proofRef); const proof = JSON.parse(await readFile(proofRef.path, 'utf8'));
  const setEvidence = async (reference: { path: string; sha256: string }) => { if (requirement.fulfillment.route !== 'gap') requirement.fulfillment.proof = await f.json(proofRef.path, { ...proof, evidence: [reference] }); };
  await setEvidence(file);
  return { file, index, setEvidence };
}

test('v2 historical reader accepts only exact frozen-index component evidence while strict generator release still rejects drift', async t => {
  const value = await versionTwoFixture(t), kg = await frozenKnowledgeEvidence(value), originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Historical current-state evidence must remain local'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const candidate = await evidenceCandidate(value), state = await validateNative44CurrentRevisionPointer(value.f.root, value.f.runDir, candidate);
  assert.equal(state.documentHash, value.after.hash); assert.ok(state.evidence.some(item => item.path === kg.file.path && item.sha256 === kg.file.sha256));
  await assert.rejects(readNative44ReleaseLock(value.f.root, value.f.journal.releaseLock), /release.*changed|release.*drift/);
  const unlisted = await value.f.json(path.join(value.f.root, 'data/native44/unlisted.json'), { unrelated: true }); await kg.setEvidence(unlisted);
  await assert.rejects(validateNative44CurrentRevisionPointer(value.f.root, value.f.runDir, await evidenceCandidate(value)), /path_escape/);
  await kg.setEvidence({ ...kg.file, sha256: 'f'.repeat(64) });
  await assert.rejects(validateNative44CurrentRevisionPointer(value.f.root, value.f.runDir, await evidenceCandidate(value)), /path_escape|hash_mismatch/);
  await kg.setEvidence(kg.file); await writeFile(kg.file.path, '{"changed":true}');
  await assert.rejects(validateNative44CurrentRevisionPointer(value.f.root, value.f.runDir, await evidenceCandidate(value)), /hash_mismatch/);
  assert.equal(requests, 0);
});

test('v2 historical reader follows only bound scope state packets across source directories and retains raw hash/selector checks', async t => {
  const value = await versionTwoFixture(t, { criticalGap: true, scopedSearch: true }), { f, contract } = value;
  const candidate = await evidenceCandidate(value), state = await validateNative44CurrentRevisionPointer(f.root, f.runDir, candidate);
  const scopeRef = contract.sourceScopes![0].evidence, proof = JSON.parse(await readFile(scopeRef.path, 'utf8')) as z.infer<typeof Native44SourceScopeEvidenceSchema>, packetRef = proof.baselines[0].states[0].packet;
  assert.ok(state.evidence.some(item => item.path === packetRef.path && item.sha256 === packetRef.sha256));
  const requirement = contract.requirements.find(row => row.fulfillment.route !== 'gap')!;
  assert.notEqual(requirement.fulfillment.route, 'gap'); if (requirement.fulfillment.route === 'gap') throw Error('Expected fixture capability proof');
  const capabilityRef = requirement.fulfillment.proof, capability = JSON.parse(await readFile(capabilityRef.path, 'utf8'));
  requirement.fulfillment.proof = await f.json(capabilityRef.path, { ...capability, evidence: [packetRef] });
  await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, await evidenceCandidate(value)), /path_escape/, 'Scope-state authority must not open arbitrary capability proof reads');
  requirement.fulfillment.proof = await f.json(capabilityRef.path, capability);
  const bytes = await readFile(packetRef.path); await writeFile(packetRef.path, '{"changed":true}');
  await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, await evidenceCandidate(value)), /hash_mismatch/); await writeFile(packetRef.path, bytes);
  const wrongSelector = await f.json(scopeRef.path, { ...proof, targetSelector: '#different-source-control' }); for (const entry of contract.sourceScopes!) entry.evidence = wrongSelector;
  await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, await evidenceCandidate(value)), /source_scope_baseline_unbound/);
});

test('v2 current review with critical capability gaps remains reviewed across state/context/compare', async t => {
  const { f, pointer, after, observedAt } = await versionTwoFixture(t, { criticalGap: true });
  const current = await readNative44CurrentState(f.root, f.runDir); assert.equal(current?.axes?.review.status, 'reviewed'); assert.equal(current?.axes?.requirements.status, 'blocked'); assert.equal(current?.status, 'reviewed-with-gaps'); assert.equal(current?.deliveryComplete, false); assert.equal(current?.reviewedAt, f.report.observedAt); assert.equal(current?.observedAt, observedAt); assert.equal(current?.currentManifest?.sha256, pointer.manifestRef.sha256);
  await parentOnlyContextIndex(f); const context = await loadContext({ root: f.root, intent: 'compare', run: f.runId }); assert.equal(context.status, 'ready'); assert.match(context.nextAction, /复核已完成/); assert.match(context.nextAction, /不要重复/); assert.equal((context.task?.state.axes as any).review.status, 'reviewed');
  const reader = { probeOwnedReviewStatus: async () => eligibleStatus(77, f.runId), readOwnedReviewCheckpoint: async () => ({ snapshot: after }) };
  const compared = await verifyNative44CurrentRevision(f.root, f.runDir, reader); assert.equal(compared.status, 'reviewed-with-gaps'); assert.equal(compared.visualVerification, 'reviewed-with-gaps'); assert.equal(compared.deliveryComplete, false); assert.equal('inspectionComplete' in compared && compared.inspectionComplete, true); assert.equal(await runCompareNative44Cli([f.runDir, '--verify-applied'], f.root, undefined, reader), 0);
});
test('v2 explicit minor tolerance can deliver with deviations while stale observations do not', async t => {
  const { f, pointer, after } = await versionTwoFixture(t, { minorDeviation: true });
  const current = await validateNative44CurrentRevisionPointer(f.root, f.runDir, pointer); assert.equal(current.status, 'delivered-with-deviations'); assert.equal(current.deliveryComplete, true); assert.equal(current.axes?.requirements.status, 'satisfied-with-deviations');
  const observation = JSON.parse(await readFile(pointer.acceptanceObservationRef!.path, 'utf8')); const staleRef = await f.json(pointer.acceptanceObservationRef!.path, { ...observation, documentHash: f.before.hash });
  await f.json(f.pointerFile, { ...pointer, acceptanceObservationRef: staleRef }); const stale = await readNative44CurrentState(f.root, f.runDir); assert.equal(stale?.axes?.review.status, 'reviewed'); assert.equal(stale?.axes?.requirements.status, 'stale'); assert.equal(stale?.deliveryComplete, false); assert.equal(stale?.status, 'stale-review');
  const changed = { ...after, settings: { ...after.settings, hide_title: 'yes' } }; changed.hash = documentHashV2(changed.elements, changed.settings); const result = await verifyNative44CurrentRevision(f.root, f.runDir, { probeOwnedReviewStatus: async () => eligibleStatus(77, f.runId), readOwnedReviewCheckpoint: async () => ({ snapshot: changed }) }); assert.equal(result.status, 'not-current'); assert.equal(result.visualVerification, 'stale');
});
test('v2 validates immutable CSS model/manifest/source units and acceptance review evidence', async t => {
  const { f, pointer, model } = await versionTwoFixture(t);
  const original = await readFile(f.pointerFile);
  await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, { ...pointer, status: 'completed' } as any), /revision_asserted_status_invalid/);
  const badModel = await f.json(pointer.cssModelRef.path, { ...model, rules: model.rules.map(rule => ({ ...rule, value: 'blue' })) }); await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, { ...pointer, cssModelRef: badModel }), /css_model_snapshot_conflict/); await f.json(pointer.cssModelRef.path, model);
  const units = await f.json(pointer.sourceUnitsRef.path, []); await assert.rejects(validateNative44CurrentRevisionPointer(f.root, f.runDir, { ...pointer, sourceUnitsRef: units }), /source_units_frozen_conflict/);
  assert.deepEqual(await readFile(f.pointerFile), original);
});
test('v2 builder preserves the frozen chain and review recording never manufactures completion', async t => {
  const { f, pointer } = await versionTwoFixture(t, { criticalGap: true });
  const next = buildNative44CurrentRevisionPointer({ ...pointer, previous: pointer, step: { ...pointer.amendments[0], beforeHash: pointer.documentHash }, recordedAt: new Date().toISOString() });
  assert.deepEqual(next.amendments.slice(0, -1), pointer.amendments); assert.equal(next.amendments.length, pointer.amendments.length + 1); assert.equal('status' in next, false);
  const recorded = recordNative44CurrentRevisionReview(pointer, { verification: pointer.verification!, visualReview: pointer.visualReview!, acceptanceObservationRef: pointer.acceptanceObservationRef!, recordedAt: new Date().toISOString() }); assert.deepEqual(recorded.amendments, pointer.amendments); assert.equal((await validateNative44CurrentRevisionPointer(f.root, f.runDir, recorded)).deliveryComplete, false);
});

test('component-reference delivers a reviewed editable draft with exact named integration gaps while requirements stay incomplete', async t => {
  const { f, pointer, after } = await versionTwoFixture(t, { componentReference: true, criticalGap: true, failedSearch: true });
  const current = await readNative44CurrentState(f.root, f.runDir); assert.equal(current?.status, 'delivered-with-open-items'); assert.equal(current?.deliveryComplete, true); assert.equal(current?.requirementsComplete, false); assert.equal(current?.axes?.requirements.qualityFloor.status, 'passed'); assert.equal(current?.axes?.review.status, 'reviewed'); assert.equal(current?.axes?.review.automated, 'has-failures'); assert.equal(current?.visualVerification, 'reviewed-with-gaps');
  const { summary, summaryRef, markdownRef } = await emitNative44DeliverySummary(f.root, f.runId, { expectedState: current! }); assert.equal(summary.deliveryComplete, true); assert.equal(summary.requirementsComplete, false); assert.ok(summary.sections.unfinished.length > 0); assert.ok(summary.sections.unverified.some(item => item.region === 'live-site')); assert.equal(hashV2(await readFile(summaryRef.path)), summaryRef.sha256); assert.equal(hashV2(await readFile(markdownRef.path)), markdownRef.sha256); assert.match(await readFile(markdownRef.path, 'utf8'), /未完成 \/ 待配置/);
  await parentOnlyContextIndex(f); const context = await loadContext({ root: f.root, intent: 'resume', run: f.runId }); assert.equal(context.status, 'ready'); assert.equal(context.task?.state.requirementsComplete, false); assert.match(context.nextAction, /完整需求仍未全部完成/);
  const report = JSON.parse(await readFile(pointer.verification!.path, 'utf8')); report.captures[0].interactions[1].componentKey = 'unknown-native-owner'; delete report.captures[0].interactions[1].requirementId;
  const verification = await f.json(pointer.verification!.path, report), observation = JSON.parse(await readFile(pointer.acceptanceObservationRef!.path, 'utf8')), acceptanceObservationRef = await f.json(pointer.acceptanceObservationRef!.path, { ...observation, review: { verification, visualReview: pointer.visualReview }, checks: observation.checks.map((check: any) => ({ ...check, evidence: [verification] })) });
  const blocked = await validateNative44CurrentRevisionPointer(f.root, f.runDir, { ...pointer, verification, acceptanceObservationRef }); assert.equal(blocked.deliveryComplete, false); assert.equal(blocked.axes?.requirements.qualityFloor.status, 'blocked'); assert.equal(blocked.axes?.review.status, 'reviewed'); assert.equal(blocked.documentHash, after.hash);
});

test('delivery emission archives previous text, lists accepted minor differences and never mutates current evidence', async t => {
  const { f, pointer } = await versionTwoFixture(t, { minorDeviation: true }); const pointerBefore = await readFile(f.pointerFile), journalBefore = await readFile(path.join(f.runDir, 'journal.json'));
  const original = Buffer.from('Existing delivery notes with preserved historical details.'); await writeFile(path.join(f.runDir, 'DELIVERY.md'), original);
  const result = await emitNative44DeliverySummary(f.root, f.runId); assert.equal(result.summary.sections.minorIssues.length, 1); assert.equal(result.summary.sections.productContentReplacement.length, 0); assert.match(await readFile(result.markdownRef.path, 'utf8'), /商品内容替换\r?\n\r?\n无。/);
  assert.deepEqual(await readFile(path.join(f.runDir, 'deliveries', `previous-${hashV2(original)}`, 'DELIVERY.md')), original); assert.deepEqual(await readFile(f.pointerFile), pointerBefore); assert.deepEqual(await readFile(path.join(f.runDir, 'journal.json')), journalBefore);
  await assert.rejects(emitNative44DeliverySummary(f.root, f.runId, { expectedState: { taskId: f.taskId, runId: f.runId, pageId: 77, documentHash: '0'.repeat(64) } }), /delivery_current_identity_conflict/);
  assert.deepEqual(await readFile(pointer.currentCSS.path), await readFile(f.pointer.currentCSS.path));
});

test('a first saved run without a current pointer automatically emits an honest pending checklist', async t => {
  const f = await fixture(t); await rm(f.pointerFile); await f.json(path.join(f.runDir, 'compare-manifest.json'), { ...f.manifest, ...fingerprintNative44Snapshot(f.before) }); await writeSnapshotRefV2(f.runDir, path.join(f.runDir, 'target', 'accepted-snapshot.json'), f.before);
  const journalBefore = await readFile(path.join(f.runDir, 'journal.json')), result = await emitNative44DeliverySummary(f.root, f.runId);
  assert.equal(result.summary.deliveryComplete, false); assert.equal(result.summary.requirementsComplete, false); assert.equal(result.summary.axes.saved, 'confirmed'); assert.equal(result.summary.axes.css, 'not-applied'); assert.equal(result.summary.axes.review, 'not-run'); assert.equal(result.summary.axes.qualityFloor, 'unverified'); assert.ok(result.summary.sections.unfinished.length); assert.ok(result.summary.sections.unverified.length); assert.deepEqual(await readFile(path.join(f.runDir, 'journal.json')), journalBefore);
  await assert.rejects(readFile(f.pointerFile), { code: 'ENOENT' });
});

test('standard current comparison binds its immutable manifest and cannot disguise conflicting identities', async t => {
  const { f, after, compiled, manifest, observedAt } = await versionTwoFixture(t);
  const raw = { version: 1, executionStrategy: 'native44-css-handoff', taskId: f.taskId, runId: f.runId, pageId: 77, manifestHash: hashV2(canonicalV2(manifest)), baselineDocumentHash: after.hash, documentHash: after.hash, finalReadHash: after.hash, css: { applied: true, canonicalSha256: compiled.canonicalSha256 }, finishedAt: observedAt, metrics: { documentWrites: 0, editorSessions: 0 }, captures: f.report.captures.map((capture, index) => ({ ...manifest.viewports![index], viewport: capture.viewport, devicePixelRatio: 1, source: { screenshot: capture.sourceScreenshot.path, sha256: capture.sourceScreenshot.sha256 }, target: { screenshot: capture.targetScreenshot.path, sha256: capture.targetScreenshot.sha256, interactionChecks: capture.interactions, productChecks: capture.queries } })) };
  const envelope = normalizeNative44CurrentReviewReport(raw, manifest); assert.equal(envelope.kind, 'native44-current-review'); assert.equal(envelope.documentUnchanged, true); assert.equal('deliveryComplete' in envelope, false);
  for (const changed of [{ ...raw, pageId: 88 }, { ...raw, manifestHash: '0'.repeat(64) }, { ...raw, metrics: { ...raw.metrics, documentWrites: 1 } }]) assert.throws(() => normalizeNative44CurrentReviewReport(changed, manifest), /standard_verification_conflict/);
});

test('generic capture-current produces fresh pixels and standard report import blocks dishonest acceptance of actual failed queries', async t => {
  const { f, pointer, after, manifest } = await versionTwoFixture(t);
  const pointerBefore = await readFile(f.pointerFile), journalBefore = await readFile(path.join(f.runDir, 'journal.json')), cssBefore = await readFile(pointer.currentCSS.path);
  const source = JSON.parse(await readFile(manifest.sourceCaptures!.sourceFacts.path, 'utf8'));
  const loaded = { set: manifest.sourceCaptures!, facts: source, plan: { components: [] }, packets: new Map(source.snapshots.map((snapshot: any) => [snapshot.id, []])), renderEvidence: new Map(source.snapshots.map((snapshot: any) => [snapshot.id, { fontsReady: true, media: [], states: [] }])) } as any;
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  let reads = 0, targetOpens = 0, closes = 0, output: any; const originalLog = console.log;
  try {
    console.log = value => { output = JSON.parse(String(value)); };
    const code = await runCompareNative44Cli([f.runDir, '--capture-current'], f.root, { sourceCaptures: loaded, readSnapshot: async () => { reads++; return fingerprintNative44Snapshot(after); }, openPage: async (_url, role) => { assert.equal(role, 'target'); targetOpens++; const page = await browser.newPage({ deviceScaleFactor: 1 }); await page.setContent('<!doctype html><style>body{margin:0}.cwp-products{height:120px;color:red}</style><main class="elementor-77"><section class="cwp-products">A local fixture intentionally lacks a real product widget.</section></main>'); return page; }, close: async () => { closes++; } });
    assert.equal(code, 0);
  } finally { console.log = originalLog; }
  assert.equal(reads, 2); assert.equal(targetOpens, 1); assert.equal(closes, 1); assert.equal(output.metrics.documentWrites, 0); assert.equal(output.metrics.editorSessions, 0); assert.equal(output.metrics.sourceBrowserNavigations, 0);
  const captureSummary = JSON.parse(await readFile(output.deliverySummary.path, 'utf8')); assert.ok(captureSummary.sections.unverified.some((item: any) => item.region === 'new-desktop-capture')); assert.equal(captureSummary.deliveryComplete, (await readNative44CurrentState(f.root, f.runDir))!.deliveryComplete);
  assert.deepEqual(await readFile(f.pointerFile), pointerBefore); assert.deepEqual(await readFile(path.join(f.runDir, 'journal.json')), journalBefore); assert.deepEqual(await readFile(pointer.currentCSS.path), cssBefore);
  const reportPath = path.join(output.reviewOutputDir, 'report.json'), raw = JSON.parse(await readFile(reportPath, 'utf8')); assert.equal(raw.captures.length, 2); assert.equal(raw.comparisonReview, 'pending'); assert.equal(raw.css.status, 'current-model'); assert.equal(raw.css.applied, true);
  for (const capture of raw.captures) { const info = await sharp(await readFile(capture.target.screenshot)).metadata(); assert.equal(info.width, capture.width); assert.equal(capture.target.productChecks[0].status, 'failed'); }
  const verification = { path: reportPath, sha256: hashV2(await readFile(reportPath)) }, observedAt = new Date().toISOString();
  const visualReview = await f.json(path.join(output.reviewOutputDir, 'visual-reviews.json'), raw.captures.map((capture: any) => ({ viewport: capture.viewport, sourceScreenshotHash: capture.source.sha256, targetScreenshotHash: capture.target.sha256, documentHash: after.hash, verdict: 'failed', observedAt, notes: 'The local fixture deliberately omits native product rendering; this is actual failed evidence.' })));
  const observation = JSON.parse(await readFile(pointer.acceptanceObservationRef!.path, 'utf8')), acceptanceObservationRef = await f.json(pointer.acceptanceObservationRef!.path, { ...observation, review: { verification, visualReview } });
  const recorded = recordNative44CurrentRevisionReview(pointer, { verification, visualReview, acceptanceObservationRef, recordedAt: observedAt }), current = await validateNative44CurrentRevisionPointer(f.root, f.runDir, recorded);
  assert.equal(current.axes?.review.status, 'reviewed'); assert.equal(current.axes?.review.automated, 'has-failures'); assert.equal(current.axes?.requirements.status, 'blocked'); assert.ok(current.axes?.requirements.issues.some(issue => issue.code === 'actual-product-query-failed')); assert.equal(current.deliveryComplete, false);
});

test('v1 capture-current freezes manifest bytes in a new review, reports pending review and detects concurrent manifest changes', async t => {
  const { f, pointer, after, manifest } = await versionTwoFixture(t);
  const legacyPointer = { ...f.pointer, status: 'amendment-pending', documentHash: after.hash, amendments: pointer.amendments, currentSnapshot: pointer.currentSnapshot, currentCSS: pointer.currentCSS, verification: undefined, visualReview: undefined };
  await f.json(f.pointerFile, legacyPointer); const manifestPath = path.join(f.runDir, 'compare-manifest.json'); await f.json(manifestPath, manifest);
  const protectedFiles = [f.pointerFile, path.join(f.runDir, 'journal.json'), pointer.currentCSS.path, pointer.requirementsRef.path, manifestPath], protectedBytes = await Promise.all(protectedFiles.map(file => readFile(file)));
  const source = JSON.parse(await readFile(manifest.sourceCaptures!.sourceFacts.path, 'utf8'));
  const loaded = { set: manifest.sourceCaptures!, facts: source, plan: { components: [] }, packets: new Map(source.snapshots.map((snapshot: any) => [snapshot.id, []])), renderEvidence: new Map(source.snapshots.map((snapshot: any) => [snapshot.id, { fontsReady: true, media: [], states: [] }])) } as any;
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  let reads = 0, closes = 0, output: any; const originalLog = console.log;
  const dependencies = { sourceCaptures: loaded, readSnapshot: async () => { reads++; return fingerprintNative44Snapshot(after); }, openPage: async (_url: string, role: 'source' | 'target') => { assert.equal(role, 'target'); const page = await browser.newPage({ deviceScaleFactor: 1 }); await page.setContent('<!doctype html><style>body{margin:0}.cwp-products{height:120px;color:red}</style><main class="elementor-77"><section class="cwp-products">A native query intentionally remains missing in this fixture.</section></main>'); return page; }, close: async () => { closes++; } };
  try {
    console.log = value => { output = JSON.parse(String(value)); };
    assert.equal(await runCompareNative44Cli([f.runDir, '--capture-current'], f.root, dependencies), 0);
    assert.equal(output.legacyCapture, true); assert.equal(output.reviewStatus, 'fresh-capture-pending-review'); assert.equal(output.comparisonReview, 'pending'); assert.equal(output.deliveryComplete, false); assert.equal(reads, 2); assert.equal(closes, 1);
    const reportBytes = await readFile(output.report.path), report = JSON.parse(reportBytes.toString('utf8')); assert.equal(output.report.sha256, hashV2(reportBytes)); assert.equal(report.legacyCapture, true); assert.equal(report.deliveryComplete, false); assert.equal(report.captures.length, 2); assert.equal(report.css.applied, true); assert.equal(report.comparisonReview, 'pending'); assert.equal(report.metrics.documentWrites, 0); assert.equal(report.metrics.sourceBrowserNavigations, 0);
    assert.equal(path.dirname(report.currentManifest.path), output.reviewOutputDir); assert.deepEqual(await readFile(report.currentManifest.path), protectedBytes.at(-1)); assert.equal(report.currentManifest.sha256, hashV2(protectedBytes.at(-1)!)); assert.equal(report.captureManifestInput.path, manifestPath);
    for (const [index, file] of protectedFiles.entries()) assert.deepEqual(await readFile(file), protectedBytes[index]);
    const state = (await readNative44CurrentState(f.root, f.runDir))!; assert.equal(state.currentManifest, undefined); assert.equal(state.goalProfile, undefined); assert.equal(state.deliveryComplete, false);
    reads = 0;
    assert.equal(await runCompareNative44Cli([f.runDir, '--capture-current'], f.root, { ...dependencies, readSnapshot: async () => { if (++reads === 1) await writeFile(manifestPath, Buffer.concat([protectedBytes.at(-1)!, Buffer.from('\n')])); return fingerprintNative44Snapshot(after); } }), 1);
    assert.ok(output.gaps.some((gap: any) => gap.category === 'conflict' && /manifest changed/.test(gap.detail))); assert.equal(output.fullFingerprintUnchanged, false); assert.equal(output.deliveryComplete, false);
  } finally { console.log = originalLog; }
  for (const [index, file] of protectedFiles.entries()) if (file !== manifestPath) assert.deepEqual(await readFile(file), protectedBytes[index]);
});

async function currentCaptureImportFixture(t: test.TestContext, options: { failedQuery?: boolean; missingQuery?: boolean; blockingGap?: boolean; coreNote?: boolean; pendingVisualReview?: boolean; failedVisualReview?: boolean; missingVisualReview?: boolean; otherEvidenceGap?: boolean } = {}) {
  const { f, pointer, after, manifest, compiled, report: oldReport } = await versionTwoFixture(t);
  const legacy = { ...f.pointer, status: 'applied-pending-review', documentHash: after.hash, amendments: pointer.amendments, currentSnapshot: pointer.currentSnapshot, currentCSS: pointer.currentCSS, verification: undefined, visualReview: undefined };
  await f.json(f.pointerFile, legacy); await f.json(path.join(f.runDir, 'compare-manifest.json'), manifest);
  const directory = path.join(f.root, 'runs', 'fresh-current-review'), currentManifest = await f.json(path.join(directory, 'compare-manifest.json'), manifest), startedAt = new Date().toISOString(), captures = [];
  for (const [index, capture] of oldReport.captures.entries()) {
    const sourceBytes = await readFile(capture.sourceScreenshot.path), targetBytes = await readFile(capture.targetScreenshot.path), sourcePath = path.join(directory, `${capture.viewport}-source.png`), targetPath = path.join(directory, `${capture.viewport}-target.png`);
    await writeFile(sourcePath, sourceBytes); await writeFile(targetPath, targetBytes);
    captures.push({ ...manifest.viewports![index], viewport: capture.viewport, devicePixelRatio: 1,
      source: { screenshot: sourcePath, sha256: hashV2(sourceBytes), snapshotId: index ? 'narrow' : 'wide', modules: [] },
      target: { screenshot: targetPath, sha256: hashV2(targetBytes), clientWidth: manifest.viewports![index].width, devicePixelRatio: 1, modules: [], interactionChecks: [], productChecks: options.missingQuery && index ? [] : capture.queries.map(query => ({ ...query, ...(options.failedQuery ? { status: 'failed', problems: ['Current real product DOM did not match its frozen expected IDs.'] } : {}) })) },
    });
  }
  const finishedAt = new Date().toISOString(), raw = { version: 1, executionStrategy: 'native44-css-handoff', taskId: f.taskId, runId: f.runId, pageId: 77, currentManifest, startedAt, finishedAt, baselineDocumentHash: after.hash, documentHash: after.hash, finalReadHash: after.hash, manifestHash: hashV2(canonicalV2(manifest)), css: { applied: true, canonicalSha256: compiled.canonicalSha256 }, metrics: { documentReads: 2, documentWrites: 0, editorSessions: 0 }, captures, gaps: options.blockingGap ? [{ category: 'media', viewport: 'desktop-wide', moduleKey: 'products', detail: 'A required image is missing.', blocking: true }] : options.pendingVisualReview ? [{ category: 'evidence', detail: 'The required desktop screenshots have no complete hash-bound Codex visual review', blocking: true }] : options.otherEvidenceGap ? [{ category: 'evidence', detail: 'A required capture raster or coverage receipt remains missing.', blocking: true }] : [] };
  const verification = await f.json(path.join(directory, 'report.json'), raw), visualReview = await f.json(path.join(directory, 'visual-reviews.json'), captures.slice(0, options.missingVisualReview ? 1 : 2).map(capture => ({ viewport: capture.viewport, sourceScreenshotHash: capture.source.sha256, targetScreenshotHash: capture.target.sha256, documentHash: after.hash, verdict: options.failedVisualReview ? 'failed' : 'passed', observedAt: new Date().toISOString(), notes: 'Both real fixture screenshot rasters were inspected; concrete product content is intentionally replaceable.' })));
  const note = { region: 'header', issue: options.coreNote ? 'Required native menu does not expand.' : 'The supporting search integration is still pending.', impact: 'This current limitation is disclosed and is not presented as a completed behavior.', nextAction: 'Complete the named native component integration and rerun its current behavior check.', evidence: [verification] };
  const request = { version: 1, kind: 'native44-current-capture-review-request', taskId: f.taskId, runId: f.runId, pageId: 77, documentHash: after.hash, expectedPointerHash: hashV2(await readFile(f.pointerFile)), userInstruction: 'Review this existing unpublished draft with native components first and list every unfinished, minor and unverified item.', report: verification, visualReview, gapReviews: [], notes: { completedAndVerified: [{ ...note, region: 'products', issue: 'Both desktop native product checks passed for the current saved draft.' }], unfinished: [{ ...note, domain: options.coreNote ? 'interaction' : 'supporting-integration' }], minorIssues: [{ ...note, region: 'typography', issue: 'A subpixel text rounding difference remains.', domain: 'typography' }], unverified: [{ ...note, region: 'business', issue: 'Full business checkout was outside this read-only desktop review.', domain: 'out-of-scope' }], productContentReplacement: [{ ...note, region: 'products', issue: 'Specific target products replace the source catalog content.' }], componentExceptions: [] } };
  return { f, pointer, after, manifest, request, raw, directory, legacy };
}

test('current disclosure evidence survives report normalization; missing or partial actions cannot pass current review', async t => {
  for (const outcome of ['missing', 'partial', 'complete'] as const) {
    const value = await currentCaptureImportFixture(t), { f, request, raw, directory } = value;
    const check = { componentKey: 'shop-menu', selector: '.elementor-77 [data-id="menu123"]', widgetType: 'nested-accordion' as const, detailsSelector: 'details', triggerSelector: 'summary', panelSelector: '[role="region"]' };
    const manifest = { ...value.manifest, disclosureChecks: [check] };
    await f.json(path.join(f.runDir, 'compare-manifest.json'), manifest);
    raw.currentManifest = await f.json(path.join(directory, 'compare-manifest.json'), manifest); raw.manifestHash = hashV2(canonicalV2(manifest));
    for (const capture of raw.captures) if (outcome !== 'missing') {
      const before = { expanded: false, ariaExpanded: false, controlsId: 'shop-panel', controlsTarget: 'panel', panelVisible: false, triggerFocused: false };
      (capture.target as any).disclosureChecks = [{ ...check, viewport: capture.viewport, elementId: 'menu123', status: 'passed', problems: [], before, restored: { ...before }, actions: outcome === 'complete' ? ['click', 'Enter', 'Space'].flatMap(input => [{ input, expanded: true }, { input, expanded: false }]) : [] }];
    }
    request.report = await f.json(request.report.path, raw);
    for (const entries of Object.values(request.notes)) for (const entry of entries) entry.evidence = [request.report];
    const normalized = normalizeNative44CurrentReviewReport(raw, manifest);
    assert.equal(normalized.captures[0].disclosures?.length ?? 0, outcome === 'missing' ? 0 : 1);
    const imported = await importNative44CurrentCaptureReview(f.root, f.runId, request);
    assert.equal(imported.current.currentCaptureReview?.automated, outcome === 'complete' ? 'passed' : 'has-failures');
    assert.equal(imported.current.currentCaptureReview?.qualityFloor.status, outcome === 'complete' ? 'satisfied' : 'blocked');
  }
});

test('current tabs evidence survives normalization and cannot be replaced by a passed status without actual actions', async t => {
  for (const outcome of ['missing', 'partial', 'complete'] as const) {
    const value = await currentCaptureImportFixture(t), { f, request, raw, directory } = value;
    const check = { componentKey: 'shop-categories', selector: '.elementor-77 [data-id="tabs123"]', widgetType: 'nested-tabs' as const, tablistSelector: '[role="tablist"]', items: [{key:'dog',tabSelector:'#dog-tab',panelSelector:'#dog-panel'},{key:'cat',tabSelector:'#cat-tab',panelSelector:'#cat-panel'}] };
    const manifest = { ...value.manifest, tabsChecks: [check] };
    await f.json(path.join(f.runDir, 'compare-manifest.json'), manifest);
    raw.currentManifest = await f.json(path.join(directory, 'compare-manifest.json'), manifest); raw.manifestHash = hashV2(canonicalV2(manifest));
    for (const capture of raw.captures) if (outcome !== 'missing') {
      const before = { selectedKey: 'dog', visiblePanelKeys: ['dog'], orientation: 'horizontal', bindings: [{key:'dog',tabId:'dog-tab',panelId:'dog-panel',label:'Dog',panelRole:'tabpanel',ariaLabelledby:'dog-tab',labelledByIds:['dog-tab'],compoundARIA:false},{key:'cat',tabId:'cat-tab',panelId:'cat-panel',label:'Cat',panelRole:'tabpanel',ariaLabelledby:'cat-tab',labelledByIds:['cat-tab'],compoundARIA:false}] };
      (capture.target as any).tabsChecks = [{ ...check, viewport: capture.viewport, elementId:'tabs123', status:'passed',problems:[],screenReaderVerification:'unverified',before,restored:{...before},actions:outcome==='complete' ? [{input:'click',key:'dog'},{input:'click',key:'cat'},{input:'Home',key:'dog'},{input:'ArrowRight',key:'cat'},{input:'ArrowLeft',key:'dog'},{input:'End',key:'cat'},{input:'Enter',key:'dog'},{input:'Space',key:'cat'}].map(action=>({...action,focused:true})) : [] }];
    }
    request.report = await f.json(request.report.path, raw);
    for (const entries of Object.values(request.notes)) for (const entry of entries) entry.evidence = [request.report];
    const normalized = normalizeNative44CurrentReviewReport(raw, manifest); assert.equal(normalized.captures[0].tabs?.length ?? 0, outcome === 'missing' ? 0 : 1);
    const imported = await importNative44CurrentCaptureReview(f.root, f.runId, request);
    assert.equal(imported.current.currentCaptureReview?.automated, outcome === 'complete' ? 'passed' : 'has-failures');
    assert.equal(imported.current.currentCaptureReview?.qualityFloor.status, outcome === 'complete' ? 'satisfied' : 'blocked');
  }
});

test('v1 standard capture import binds actual pixels and emits open-item delivery without migrating its frozen contract', async t => {
  const { f, pointer, request, after } = await currentCaptureImportFixture(t), protectedFiles = [path.join(f.runDir, 'journal.json'), pointer.currentSnapshot.path, pointer.currentCSS.path, f.journal.releaseLock.path], before = await Promise.all(protectedFiles.map(file => readFile(file)));
  const originalFetch = globalThis.fetch; let requests = 0;
  try {
    globalThis.fetch = (async () => { requests++; throw Error('No remote operations are allowed during local current review import.'); }) as typeof fetch;
    const result = await importNative44CurrentCaptureReview(f.root, f.runId, request), state = result.current;
    assert.equal(result.remoteWrites, 0); assert.equal(state.axes, undefined); assert.equal(state.goalProfile, undefined); assert.equal(state.currentCaptureReview?.frozenContractPreserved, true); assert.equal(state.currentCaptureReview?.qualityFloor.status, 'satisfied'); assert.equal(state.currentCaptureReview?.draftReady, true); assert.equal(state.currentCaptureReview?.deliveryReady, true); assert.equal(state.requirementsComplete, false); assert.equal(state.deliveryComplete, false); assert.equal(state.documentHash, after.hash); assert.equal(state.status, 'delivered-with-open-items');
    assert.equal(result.delivery.summary.requirementsComplete, false); assert.equal(result.delivery.summary.draftReady, true); assert.ok(result.delivery.summary.sections.unfinished.some(item => item.issue.includes('supporting search'))); assert.ok(result.delivery.summary.sections.minorIssues.some(item => item.region === 'typography')); assert.ok(result.delivery.summary.sections.unverified.some(item => item.region === 'requirements'));
    assert.match(await readFile(result.delivery.markdownRef.path, 'utf8'), /未完成 \/ 待配置[\s\S]*小问题[\s\S]*未验证/);
    const recorded = await readFile(f.pointerFile), again = await importNative44CurrentCaptureReview(f.root, f.runId, request); assert.equal(again.idempotent, true); assert.deepEqual(await readFile(f.pointerFile), recorded); assert.equal(requests, 0);
    for (const [index, file] of protectedFiles.entries()) assert.deepEqual(await readFile(file), before[index]);
    await writeFile(path.join(f.runDir, 'current-review-request.json'), JSON.stringify(request)); const cli = await runNative44CurrentReviewCli(['--run', f.runId, '--request', path.join(f.runDir, 'current-review-request.json')], f.root); assert.equal(cli.idempotent, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('v1 current capture records failed actual queries and core notes as reviewed quality failures instead of declaring completion', async t => {
  const { f, request } = await currentCaptureImportFixture(t, { failedQuery: true, coreNote: true }), result = await importNative44CurrentCaptureReview(f.root, f.runId, request);
  assert.equal(result.current.currentCaptureReview?.review, 'reviewed'); assert.equal(result.current.currentCaptureReview?.qualityFloor.status, 'blocked'); assert.equal(result.current.draftReady, false); assert.equal(result.current.currentCaptureReview?.deliveryReady, false); assert.equal(result.current.deliveryComplete, false); assert.equal(result.current.status, 'reviewed-with-gaps');
  assert.ok(result.current.currentCaptureReview!.qualityFloor.issues.some(issue => issue.includes('product-query'))); assert.ok(result.current.currentCaptureReview!.qualityFloor.issues.some(issue => issue.includes('menu'))); assert.ok(result.delivery.summary.sections.unfinished.some(item => item.region === 'quality-floor'));
});

test('current review preparation validates complete actual evidence without saving any records or pointer', async t => {
  const { f, request } = await currentCaptureImportFixture(t, { coreNote: true }), pointerBefore = await readFile(f.pointerFile), filesBefore = await readdir(f.root, { recursive: true });
  const prepared = await prepareNative44CurrentCaptureReview(f.root, f.runId, request);
  assert.equal(prepared.status, 'prepared-current-capture-review'); assert.equal(prepared.localWrites, 0); assert.equal(prepared.remoteWrites, 0); assert.equal(prepared.reviewStatus, 'reviewed-with-gaps'); assert.equal(prepared.automated, 'passed'); assert.equal(prepared.deliveryReady, false);
  assert.ok(prepared.notes.unfinished.length); assert.ok(prepared.notes.minorIssues.length); assert.ok(prepared.notes.unverified.length);
  assert.deepEqual(await readdir(f.root, { recursive: true }), filesBefore); assert.deepEqual(await readFile(f.pointerFile), pointerBefore);
  const missing = await currentCaptureImportFixture(t, { missingQuery: true }), missingBefore = await readdir(missing.f.root, { recursive: true });
  await assert.rejects(prepareNative44CurrentCaptureReview(missing.f.root, missing.f.runId, missing.request), /verification_product_coverage_invalid/);
  await assert.rejects(importNative44CurrentCaptureReview(missing.f.root, missing.f.runId, missing.request), /verification_product_coverage_invalid/);
  assert.deepEqual(await readdir(missing.f.root, { recursive: true }), missingBefore);
});

test('current review rejects stale note owners and forged note hashes before creating immutable revision records', async t => {
  for (const failure of ['owner', 'hash'] as const) {
    const { f, request } = await currentCaptureImportFixture(t);
    request.notes.minorIssues[0].evidence = [failure === 'owner' ? await f.json(path.join(f.root, 'runs', 'old-unrelated-review', 'report.json'), { old: true }) : { ...request.report, sha256: '0'.repeat(64) }];
    const pointerBefore = await readFile(f.pointerFile), filesBefore = await readdir(f.root, { recursive: true });
    const expected = failure === 'owner' ? /capture_review_note_owner_conflict; field=notes\.minorIssues\[0\]\.evidence\[0\]/ : /reference_changed; field=notes\.minorIssues\[0\]\.evidence\[0\]/;
    await assert.rejects(prepareNative44CurrentCaptureReview(f.root, f.runId, request), expected);
    await assert.rejects(importNative44CurrentCaptureReview(f.root, f.runId, request), expected);
    assert.deepEqual(await readdir(f.root, { recursive: true }), filesBefore); assert.deepEqual(await readFile(f.pointerFile), pointerBefore);
  }
});

test('current review preparation rejects a junction on the future immutable record directory', async t => {
  const { f, request } = await currentCaptureImportFixture(t), folder = path.join(f.runDir, 'amendments', `current-review-${hashV2(canonicalV2(request)).slice(0, 24)}`), destination = path.join(f.root, 'empty-alias-destination');
  await mkdir(destination); await symlink(destination, folder, process.platform === 'win32' ? 'junction' : 'dir');
  const before = await readFile(f.pointerFile);
  await assert.rejects(prepareNative44CurrentCaptureReview(f.root, f.runId, request), /virtual.*(?:alias|conflict)|realpath_changed|review_alias/);
  assert.deepEqual(await readdir(destination), []); assert.deepEqual(await readFile(f.pointerFile), before);
});

test('current review CLI distinguishes command success from quality gaps and keeps all three lists in summary', async t => {
  const { f, request } = await currentCaptureImportFixture(t, { coreNote: true }), filename = path.join(f.runDir, 'current-review-request.json'); await f.json(filename, request);
  let stdout = '', stderr = ''; const io = { write: (value: string) => { stdout += value; }, error: (value: string) => { stderr += value; } };
  const args = ['--run', f.runId, '--request', filename, '--summary'], pointerBefore = await readFile(f.pointerFile), filesBefore = await readdir(f.root, { recursive: true });
  assert.equal(await native44CurrentReviewMain(['prepare', ...args], f.root, io), 0); const prepared = JSON.parse(stdout);
  assert.equal(prepared.status, 'prepared-current-capture-review'); assert.equal(prepared.deliveryReady, false); assert.equal(prepared.localWrites, 0); assert.equal(stderr, '');
  for (const key of ['unfinished', 'minorIssues', 'unverified']) assert.ok(prepared.sections[key].length);
  assert.deepEqual(await readdir(f.root, { recursive: true }), filesBefore); assert.deepEqual(await readFile(f.pointerFile), pointerBefore);
  stdout = ''; assert.equal(await native44CurrentReviewMain(args, f.root, io), 0); const imported = JSON.parse(stdout);
  assert.equal(imported.reviewStatus, 'reviewed-with-gaps'); assert.equal(imported.deliveryReady, false); assert.equal(imported.qualityFloor.status, 'blocked'); assert.equal(imported.current, undefined); assert.equal(stderr, '');
  for (const key of ['unfinished', 'minorIssues', 'unverified']) assert.ok(imported.sections[key].length);
  stdout = ''; assert.equal(await native44CurrentReviewMain([...args, '--dry-run'], f.root, io), 0); assert.equal(JSON.parse(stdout).idempotent, true);
  const forged = { ...request, report: { ...request.report, sha256: '0'.repeat(64) } }; await f.json(filename, forged); stdout = ''; stderr = '';
  assert.equal(await native44CurrentReviewMain(args, f.root, io), 1); assert.equal(stdout, ''); assert.match(stderr, /reference_changed; field=report|parent_pointer_changed/);
  for (const invalid of [['--run'], [...args, '--summary'], [...args, '--request', filename], ['prepare', ...args, '--dry-run']]) assert.throws(() => parseNative44CurrentReviewArguments(invalid), /invalid_arguments|Usage/);
});

test('current capture context exposes reviewed manual gaps without inventing axes or requesting duplicate screenshots', async t => {
  const { f, request } = await currentCaptureImportFixture(t, { coreNote: true }), imported = await importNative44CurrentCaptureReview(f.root, f.runId, request);
  assert.equal(imported.current.currentCaptureReview?.automated, 'passed'); assert.equal(imported.current.currentCaptureReview?.qualityFloor.status, 'blocked');
  await parentOnlyContextIndex(f);
  const context = await loadContext({ root: f.root, intent: 'compare', run: f.runId });
  assert.equal(context.status, 'ready', JSON.stringify(context.gaps)); assert.equal(context.task?.state.axes, undefined); assert.equal(context.task?.state.goalProfile, undefined); assert.equal((context.task?.state.currentCaptureReview as any)?.review, 'reviewed'); assert.equal(context.task?.state.requirementsComplete, false); assert.equal(context.task?.state.draftReady, false); assert.equal(context.task?.state.deliveryReady, false); assert.ok(context.task?.state.reviewedAt); assert.ok(context.task?.state.currentManifest);
  assert.match(context.nextAction, /复核已完成/); assert.match(context.nextAction, /不要重复采集同一修订/); assert.doesNotMatch(context.nextAction, /视觉复核待完成/);
});

test('v1 current review cannot omit query coverage, accept a forged hash or bypass pointer CAS', async t => {
  const missing = await currentCaptureImportFixture(t, { missingQuery: true }), original = await readFile(missing.f.pointerFile);
  await assert.rejects(importNative44CurrentCaptureReview(missing.f.root, missing.f.runId, missing.request), /verification_product_coverage_invalid/); assert.deepEqual(await readFile(missing.f.pointerFile), original);
  const stale = await currentCaptureImportFixture(t); await stale.f.json(stale.f.pointerFile, { ...stale.legacy, requestedScope: 'Another user changed this owned draft review scope.' });
  await assert.rejects(importNative44CurrentCaptureReview(stale.f.root, stale.f.runId, stale.request), /parent_pointer_changed/);
  const forged = await currentCaptureImportFixture(t); await writeFile(forged.request.report.path, '{}');
  await assert.rejects(importNative44CurrentCaptureReview(forged.f.root, forged.f.runId, forged.request), /reference_changed/);
});

test('current capture consumes only the exact pending visual-review placeholder after both hash-bound pixel reviews validate', async t => {
  const valid = await currentCaptureImportFixture(t, { pendingVisualReview: true }), rawBefore = await readFile(valid.request.report.path), imported = await importNative44CurrentCaptureReview(valid.f.root, valid.f.runId, valid.request);
  assert.equal(imported.current.currentCaptureReview?.qualityFloor.status, 'satisfied'); assert.equal(imported.current.currentCaptureReview?.automated, 'passed'); assert.deepEqual(await readFile(valid.request.report.path), rawBefore); assert.equal(valid.raw.gaps[0].blocking, true);
  const failed = await currentCaptureImportFixture(t, { pendingVisualReview: true, failedVisualReview: true }), rejectedVisual = await importNative44CurrentCaptureReview(failed.f.root, failed.f.runId, failed.request);
  assert.equal(rejectedVisual.current.currentCaptureReview?.qualityFloor.status, 'blocked'); assert.ok(rejectedVisual.current.currentCaptureReview!.qualityFloor.issues.some(issue => issue.includes('visual review failed')));
  const missing = await currentCaptureImportFixture(t, { pendingVisualReview: true, missingVisualReview: true }); await assert.rejects(importNative44CurrentCaptureReview(missing.f.root, missing.f.runId, missing.request), /capture_review_stale|capture_review_visual_invalid/);
  const other = await currentCaptureImportFixture(t, { otherEvidenceGap: true }), stillBlocked = await importNative44CurrentCaptureReview(other.f.root, other.f.runId, other.request);
  assert.equal(stillBlocked.current.currentCaptureReview?.qualityFloor.status, 'blocked'); assert.ok(stillBlocked.current.currentCaptureReview!.qualityFloor.issues.some(issue => issue.includes('raster or coverage receipt')));
});

test('v1 review cannot waive required media gaps or retain mutated screenshot evidence', async t => {
  const { f, request, raw } = await currentCaptureImportFixture(t, { blockingGap: true });
  const denied = { ...request, gapReviews: [{ gapHash: hashV2(canonicalV2(raw.gaps[0])), category: 'interaction', moduleKey: 'products', viewport: 'desktop-wide', basis: 'noninteractive-native-layout', reason: 'This deliberately false declaration must never waive required missing media or a native product defect.', evidence: [request.report] }] };
  await assert.rejects(importNative44CurrentCaptureReview(f.root, f.runId, denied), /capture_review_gap_not_minor_implementation/);
  const result = await importNative44CurrentCaptureReview(f.root, f.runId, request); assert.equal(result.current.currentCaptureReview?.qualityFloor.status, 'blocked');
  await writeFile(raw.captures[0].target.screenshot, 'not image pixels'); await assert.rejects(readNative44CurrentState(f.root, f.runDir), /hash_mismatch|visual_image_invalid/);
});

test('explicit v1 current review stays reviewed in fresh verification and CLI without changing historical v1 exit semantics', async t => {
  const originalLog = console.log; console.log = () => undefined;
  try {
    for (const failedQuery of [false, true]) {
      const { f, request, after } = await currentCaptureImportFixture(t, { failedQuery });
      const imported = await importNative44CurrentCaptureReview(f.root, f.runId, request);
      const reader = { probeOwnedReviewStatus: async () => eligibleStatus(77, f.runId), readOwnedReviewCheckpoint: async () => ({ snapshot: after }) };
      const inspected = await verifyNative44CurrentRevision(f.root, f.runDir, reader);
      assert.equal(inspected.status, imported.current.status); assert.notEqual(inspected.status, 'pending-review');
      assert.equal('inspectionComplete' in inspected && inspected.inspectionComplete, true); assert.equal('draftReady' in inspected && inspected.draftReady, !failedQuery); assert.equal('requirementsComplete' in inspected && inspected.requirementsComplete, false);
      assert.deepEqual('currentCaptureReview' in inspected ? inspected.currentCaptureReview : undefined, imported.current.currentCaptureReview); assert.equal(inspected.deliveryComplete, false);
      assert.equal(await runCompareNative44Cli([f.runDir, '--verify-applied'], f.root, undefined, reader), 0);
      let checkpointReads = 0;
      const published = await verifyNative44CurrentRevision(f.root, f.runDir, { probeOwnedReviewStatus: async () => ({ ...eligibleStatus(77, f.runId), status: 'publish' }), readOwnedReviewCheckpoint: async () => { checkpointReads++; return { snapshot: after }; } });
      assert.equal(published.status, 'not-current'); assert.equal('inspectionComplete' in published && published.inspectionComplete, false); assert.equal('draftReady' in published && published.draftReady, false); assert.equal(checkpointReads, 0);
      const changed = { ...after, settings: { ...after.settings, hide_title: 'yes' } }; changed.hash = documentHashV2(changed.elements, changed.settings);
      const stale = await verifyNative44CurrentRevision(f.root, f.runDir, { ...reader, readOwnedReviewCheckpoint: async () => ({ snapshot: changed }) });
      assert.equal(stale.status, 'not-current'); assert.equal('inspectionComplete' in stale && stale.inspectionComplete, false); assert.equal('draftReady' in stale && stale.draftReady, false);
    }
    const historical = await fixture(t); await historical.json(historical.pointerFile, { ...historical.pointer, status: 'amendment-pending', verification: undefined, visualReview: undefined });
    const historicalReader = { probeOwnedReviewStatus: async () => eligibleStatus(77, historical.runId), readOwnedReviewCheckpoint: async () => ({ snapshot: historical.after }) };
    const pending = await verifyNative44CurrentRevision(historical.root, historical.runDir, historicalReader); assert.equal(pending.status, 'pending-review'); assert.equal('inspectionComplete' in pending, false);
    assert.equal(await runCompareNative44Cli([historical.runDir, '--verify-applied'], historical.root, undefined, historicalReader), 1);
  } finally { console.log = originalLog; }
});

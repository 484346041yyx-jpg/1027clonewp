import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertNative44WholePageModuleCoverage, assertNative44WholePageReviewReady } from '../src/native44/review-workflow.js';
import { compareNative44Run, fingerprintNative44Snapshot, NATIVE44_COMPARE_VIEWPORTS, type Native44CompareManifest } from '../src/native44/compare.js';
import { NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW } from '../src/native44/types.js';
import type { Native44CurrentState } from '../src/native44/current-state.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';

const digest = 'a'.repeat(64);
function ready() {
  const snapshot = { pageId: 42, runId: 'review-fixture', title: 'Whole-page review fixture', status: 'draft', hash: digest, settings: { custom_css: '.elementor-42 .cwp-hero{color:black}' }, elements: [{ id: 'abcdef1', elType: 'container', settings: { css_classes: 'cwp-hero' }, elements: [] }] } satisfies DraftSnapshot;
  const manifest: Native44CompareManifest = { ...fingerprintNative44Snapshot(snapshot), version: 1, strategy: 'native44-css-handoff', taskId: 'review-fixture', runId: snapshot.runId, pageId: snapshot.pageId, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/', widgetTypes: ['container'], canvasCss: '', cssRules: [], modules: [{ key: 'hero', className: 'cwp-hero', sourceSelector: '.hero', targetSelector: '.elementor-42 .cwp-hero', required: true }], viewports: NATIVE44_COMPARE_VIEWPORTS, reviewWorkflow: NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW };
  const journal = { taskId: manifest.taskId, runId: manifest.runId, pageId: manifest.pageId, status: 'awaiting-comparison', reviewWorkflow: manifest.reviewWorkflow, mutations: [{ kind: 'document-save', checkpoint: 'complete-body', status: 'confirmed' }] };
  const current = { taskId: manifest.taskId, runId: manifest.runId, pageId: manifest.pageId, documentHash: manifest.documentHash, currentManifest: { path: 'manifest.json', sha256: digest }, cssModel: { path: 'css-model.json', sha256: digest }, axes: { write: { status: 'confirmed' }, css: { status: 'applied' } } } as Native44CurrentState;
  return { manifest, journal, current, snapshot, expectedModuleKeys: ['hero'] };
}

test('whole-page review waits for complete body plus consolidated applied CSS, never grants a verdict', () => {
  const input = ready();
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, current: undefined }), /whole_page_css_not_ready/);
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, current: { ...input.current, cssModel: undefined } }), /whole_page_css_not_ready/);
  const original = JSON.stringify(input);
  assert.equal(assertNative44WholePageReviewReady(input), undefined);
  assert.equal(JSON.stringify(input), original);
  assert.equal(input.current.deliveryComplete, undefined);
});

test('partial or unresolved body commits and missing module owners cannot enter complete review', () => {
  const input = ready();
  for (const status of ['running', 'failed', 'write-unknown', 'conflict']) assert.throws(() => assertNative44WholePageReviewReady({ ...input, journal: { ...input.journal, status } }), /body_not_confirmed/);
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, journal: { ...input.journal, mutations: [{ kind: 'document-save', checkpoint: 'hero-only', status: 'confirmed' }] } }), /body_not_confirmed/);
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, journal: { ...input.journal, mutations: [...input.journal.mutations, { status: 'write-unknown', kind: 'document-save', checkpoint: 'complete-body' }] } }), /body_not_confirmed/);
  input.snapshot.elements[0].settings.css_classes = 'unrelated';
  assert.throws(() => assertNative44WholePageReviewReady(input), /module_not_complete: hero/);
});

test('whole-page review cannot reduce frozen source module coverage or rename policy to bypass it', () => {
  const input = ready();
  assert.throws(() => assertNative44WholePageModuleCoverage(input.manifest, ['hero', 'footer']), /module_coverage_incomplete/);
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, manifest: { ...input.manifest, reviewWorkflow: undefined } }), /workflow_identity_conflict/);
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, snapshot: { ...input.snapshot, settings: { custom_css: 'unfinished' } } }), /snapshot_or_css_not_current/);
  assert.throws(() => assertNative44WholePageReviewReady({ ...input, current: { ...input.current, documentHash: 'b'.repeat(64) } }), /review_identity_conflict/);
});

test('frozen legacy tasks keep their old workflow without synthesized readiness or altered bytes', () => {
  const input = ready(), { reviewWorkflow: _policy, ...manifest } = input.manifest, { reviewWorkflow: _journalPolicy, ...journal } = input.journal;
  const bytes = JSON.stringify({ manifest, journal });
  assert.equal(assertNative44WholePageReviewReady({ manifest, journal }), undefined);
  assert.equal(JSON.stringify({ manifest, journal }), bytes);
});

test('formal comparison before full CSS stops before snapshot access, browser open or screenshot files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native44-review-workflow-')), input = ready();
  await writeFile(path.join(root, 'compare-manifest.json'), JSON.stringify(input.manifest));
  await writeFile(path.join(root, 'journal.json'), JSON.stringify(input.journal));
  const before = await readdir(root); let reads = 0, opens = 0;
  try {
    await assert.rejects(compareNative44Run(root, { readSnapshot: async () => { reads++; throw Error('must not read remote snapshot'); }, openPage: async () => { opens++; throw Error('must not open browser'); } }), /whole_page_css_not_ready/);
    assert.equal(reads, 0); assert.equal(opens, 0); assert.deepEqual(await readdir(root), before);
    assert.equal(JSON.parse(await readFile(path.join(root, 'journal.json'), 'utf8')).status, 'awaiting-comparison');
  } finally { await rm(root, { recursive: true }); }
});

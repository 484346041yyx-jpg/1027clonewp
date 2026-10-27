import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNative44Program } from '../src/native44/validate.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program } from '../src/native44/types.js';
import { DESKTOP_BROWSER_PROFILE, native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { assertNative44Resume, type Native44Journal } from '../src/native44/lifecycle.js';
import { assertCreationTaskMode, resolveCreationMode } from '../src/core/creation-mode.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const hash = 'a'.repeat(64), ref = { path: 'fixture.json', sha256: hash };
function program(): Native44Program {
  return { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: DESKTOP_BROWSER_PROFILE, selectionRulesHash: NATIVE44_SELECTION_RULES_HASH,
    taskId: 'desktop-identity', title: 'Desktop', sourceUrl: 'https://source.example/', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: hash }, targetEnvironment: NATIVE44_TARGET_ENVIRONMENT,
    sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: native44ProfileViewports(DESKTOP_BROWSER_PROFILE), blocks: [{ kind: 'composite', key: 'header', editorTitle: 'Header', children: [{ kind: 'native', key: 'title', editorTitle: 'Page title', widgetType: 'heading', widgetSettings: { title: 'Desktop' } }] }] };
}
function journal(p = program()): Native44Journal {
  return { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: p.replicationProfile, selectionRulesHash: p.selectionRulesHash, taskId: p.taskId, runId: 'identity-run', runDir: 'D:/cloneWP/.cache/identity-run', targetUrl: 'https://target.example/', programHash: hash, sourceFactsHash: hash, componentPlanHash: hash, assetsManifestHash: hash, componentCatalog: p.componentCatalog, knowledge: p.knowledge, targetEnvironment: p.targetEnvironment, status: 'running', createdAt: '', updatedAt: '', mutations: [], deliveryComplete: false, visualVerification: 'pending-comparison', metrics: {} };
}
test('new profile fixes both desktop dimensions and stages before authentication', () => {
  assert.equal(resolveCreationMode(program()), 'replica');
  for (const change of [
    (p: Native44Program) => { p.viewports.pop(); },
    (p: Native44Program) => { p.viewports.push({ name: 'mobile', width: 390, height: 844, stage: 'responsive' }); },
    (p: Native44Program) => { p.viewports[1].height = 999; },
    (p: Native44Program) => { p.viewports[1].stage = 'responsive'; },
    (p: Native44Program) => { p.viewports.reverse(); },
  ]) { const p = program(); change(p); assert.throws(() => validateNative44Program(p), /exactly|desktop viewports/); }
});
test('new selection identity and actual container semantics cannot be omitted or guessed', () => {
  const p = program(); delete p.selectionRulesHash; assert.throws(() => validateNative44Program(p), /selection rules/);
  assert.throws(() => validateNative44Program({ ...program(), replicationProfile: 'desktop-maybe' }), /Invalid/);
  const leaf = program().blocks[0]; assert.throws(() => validateNative44Program({ ...program(), blocks: [leaf.kind === 'composite' ? leaf.children[0] : leaf] }), /explicit stable/);
  const settings = program(); if (settings.blocks[0].kind === 'composite') settings.blocks[0].children[0].settings = { width: { unit: '%', size: 50 } };
  assert.throws(() => validateNative44Program(settings), /explicit composite/);
});
test('new fields do not silently upgrade a historical native44 program', () => {
  const p = program(); delete p.replicationProfile;
  assert.throws(() => validateNative44Program(p), /Historical/);
  delete p.selectionRulesHash;
  assert.throws(() => validateNative44Program(p), /editor metadata/);
  p.blocks = [{ kind: 'native', key: 'title', widgetType: 'heading', widgetSettings: { title: 'Historical' } }];
  p.viewports = [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }];
  assert.equal(validateNative44Program(p).replicationProfile, undefined);
});
test('resume binds profile and selection hash independently of a supplied program hash', () => {
  const p = program(), j = journal(p); assert.doesNotThrow(() => assertNative44Resume(j, p, hash, j.targetUrl));
  assert.throws(() => assertNative44Resume({ ...j, replicationProfile: undefined }, p, hash, j.targetUrl), /profile identity/);
  assert.throws(() => assertNative44Resume({ ...j, selectionRulesHash: 'b'.repeat(64) }, p, hash, j.targetUrl), /selection rules/);
  const old = { ...p, replicationProfile: undefined, selectionRulesHash: undefined };
  assert.throws(() => assertNative44Resume(j, old, hash, j.targetUrl), /profile identity/);
});
test('task marker cannot silently introduce or remove the desktop profile or rules', async t => {
  const workspace = path.resolve(import.meta.dirname, '..');
  const root = await mkdtemp(path.join(workspace, '.cache', 'desktop-profile-mode-'));
  t.after(async () => { const relative = path.relative(path.join(workspace, '.cache'), root); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); await rm(root, { recursive: true, force: true }); });
  const p = program(), jobDir = path.join(root, 'references', p.taskId), filename = path.join(jobDir, 'program.json');
  await mkdir(jobDir, { recursive: true }); await writeFile(filename, JSON.stringify(p));
  const job = { version: 2, workflow: p.workflow, mode: 'replica', taskId: p.taskId, url: p.sourceUrl, executionStrategy: p.executionStrategy, replicationProfile: p.replicationProfile, selectionRulesHash: p.selectionRulesHash, componentCatalog: p.componentCatalog, knowledge: p.knowledge, targetEnvironment: p.targetEnvironment };
  const writeMarker = (value: unknown) => writeFile(path.join(jobDir, 'job.json'), JSON.stringify(value));
  await writeMarker(job); await assert.doesNotReject(assertCreationTaskMode(root, filename, 'replica'));
  await writeMarker({ ...job, replicationProfile: undefined }); await assert.rejects(assertCreationTaskMode(root, filename, 'replica'), /profile identity/);
  await writeMarker({ ...job, selectionRulesHash: 'b'.repeat(64) }); await assert.rejects(assertCreationTaskMode(root, filename, 'replica'), /selection rules identity/);
});

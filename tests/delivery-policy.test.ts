import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { assertFinalDeliveryPolicyIdentity, finalDeliveryNextAction, freezeNewTaskFinalDeliveryPolicy, resolveFinalDeliveryPolicy } from '../src/core/delivery-policy.js';

test('new task freezes only configured final status and keeps construction behind current review', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-delivery-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'config'));
  const configPath = path.join(root, 'config', 'project.json');
  await writeFile(configPath, JSON.stringify({ pageStatus: 'publish', credentialsFile: 'must-not-open.json' }));
  const frozen = await freezeNewTaskFinalDeliveryPolicy(root);
  assert.equal(frozen.desiredPageStatus, 'publish');
  assert.equal(frozen.constructionPageStatus, 'draft');
  assert.equal(frozen.publicationGate, 'current-review-quality-floor');
  assert.equal(frozen.authorization, 'project-default-at-task-creation');
  const markerPath = path.join(root, 'job.json');
  await writeFile(markerPath, JSON.stringify({ finalDeliveryPolicy: frozen }));
  await writeFile(configPath, JSON.stringify({ pageStatus: 'draft' }));
  assert.equal(resolveFinalDeliveryPolicy(JSON.parse(await readFile(markerPath, 'utf8'))).desiredPageStatus, 'publish');
  assert.equal((await freezeNewTaskFinalDeliveryPolicy(root)).desiredPageStatus, 'draft');
  const action = finalDeliveryNextAction(frozen, '2026-10-17-new-run');
  assert.match(action, /npm run publication -- finalize --run "2026-10-17-new-run"/);
  assert.match(action, /未通过复核时保留草稿/);
});

test('historical task and run stay draft without inheriting current project publication default', () => {
  const task = { version: 2 }, run = { version: 2, status: 'reviewed' };
  const before = structuredClone(task);
  assert.equal(resolveFinalDeliveryPolicy(task).desiredPageStatus, 'draft');
  assert.equal(resolveFinalDeliveryPolicy(run).authorization, 'legacy-draft-preserved');
  assert.deepEqual(task, before);
  assert.doesNotThrow(() => assertFinalDeliveryPolicyIdentity(task, run));
  assert.doesNotMatch(finalDeliveryNextAction(resolveFinalDeliveryPolicy(task), 'old-run'), /publication -- finalize/);
});

test('missing project configuration safely freezes draft; malformed or expanded states do not enable publishing', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-delivery-policy-safe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const frozen = await freezeNewTaskFinalDeliveryPolicy(root);
  assert.equal(frozen.desiredPageStatus, 'draft');
  assert.equal(frozen.authorization, 'safe-default-at-task-creation');
  await mkdir(path.join(root, 'config'));
  for (const value of [{ pageStatus: 'private' }, { pageStatus: true }, {}]) {
    await writeFile(path.join(root, 'config', 'project.json'), JSON.stringify(value));
    await assert.rejects(freezeNewTaskFinalDeliveryPolicy(root));
  }
  const unsafe = { ...frozen, desiredPageStatus: 'publish' };
  assert.throws(() => resolveFinalDeliveryPolicy({ finalDeliveryPolicy: unsafe }), /frozen project publication default/);
  assert.throws(() => resolveFinalDeliveryPolicy({ finalDeliveryPolicy: { ...frozen, publicationGate: 'skip-review' } }));
});

test('resume rejects added, removed or changed frozen publication policy', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-delivery-policy-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config', 'project.json'), JSON.stringify({ pageStatus: 'publish' }));
  const policy = await freezeNewTaskFinalDeliveryPolicy(root), task = { finalDeliveryPolicy: policy };
  assert.doesNotThrow(() => assertFinalDeliveryPolicyIdentity(task, structuredClone(task)));
  assert.throws(() => assertFinalDeliveryPolicyIdentity(task, {}), /Frozen final delivery policy changed/);
  assert.throws(() => assertFinalDeliveryPolicyIdentity({}, task), /Frozen final delivery policy changed/);
  assert.throws(() => assertFinalDeliveryPolicyIdentity(task, { finalDeliveryPolicy: { ...policy, desiredPageStatus: 'draft' } }), /Frozen final delivery policy changed/);
  for (const run of ['../run', 'run\nnext', 'run $(other)', 'a"; other', '']) assert.throws(() => finalDeliveryNextAction(policy, run), /bounded run identifier/);
});

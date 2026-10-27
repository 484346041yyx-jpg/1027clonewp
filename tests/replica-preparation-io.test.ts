import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { initializePreparation, startPreparationJob, completePreparationJob, mergePreparationDirectory, preparationStatus } from '../src/replica-preparation/io.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { validatePreparationPlan, preparationHash } from '../src/replica-preparation/contract.js';

test('only a new preparation freezes the native-image default; parsing a historical contract preserves its fields and hash', async () => {
  const f = await preparationIOFixture();
  try {
    delete f.plan.nativeImagePolicy;
    const originalHash = preparationHash(f.plan), parsed = validatePreparationPlan(f.plan);
    assert.equal('nativeImagePolicy' in parsed, false); assert.equal(preparationHash(parsed), originalHash);
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    const filename = path.join(f.preparationDirectory, 'contract.json'), bytes = await readFile(filename, 'utf8');
    assert.deepEqual(JSON.parse(bytes).nativeImagePolicy, { version: 2, mode: 'native-first' });
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    assert.equal(await readFile(filename, 'utf8'), bytes);
  } finally { await f.cleanup(); }
});

test('local dispatch can start every independent group before any result, then merge out-of-order results through the existing full-body gate', async () => {
  const f = await preparationIOFixture();
  try {
    const initial = await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    assert.equal(initial.status, 'awaiting-preparation'); assert.equal(initial.remoteWrites, 0);
    assert.deepEqual(initial.jobs.map(job => job.jobId), ['header', 'body-1', 'body-2']);
    await Promise.all(initial.jobs.map(job => startPreparationJob(f.preparationDirectory, job.jobId)));
    const running = await preparationStatus(f.preparationDirectory);
    assert.ok(running.jobs.every(job => job.status === 'running'));
    assert.equal(running.timing.pureModelTime, 'not-measured');
    await assert.rejects(mergePreparationDirectory(f.preparationDirectory), /jobs_incomplete/);
    for (const job of [...initial.jobs].reverse()) {
      const filename = await f.writeResult(job.jobId), completed = await completePreparationJob(f.preparationDirectory, job.jobId, filename);
      assert.equal(completed.pureModelTime, 'not-measured'); assert.equal(completed.measurement, 'utc-wall-agent-start-to-result'); assert.ok(completed.elapsedMs >= 0);
    }
    const merged = await mergePreparationDirectory(f.preparationDirectory);
    assert.equal(merged.status, 'prepared'); assert.ok('manifest' in merged);
    const manifest = JSON.parse(await readFile(merged.manifest.path, 'utf8'));
    const program = JSON.parse(await readFile(manifest.body.program.path, 'utf8'));
    assert.deepEqual(program.blocks.map((block: { key: string }) => block.key), ['hero', 'faq']);
    assert.equal(manifest.headerProvider, 'woodmart-header-builder');
    assert.deepEqual(manifest.nativeImagePolicy, { version: 2, mode: 'native-first', directImageSlots: [] });
    const status = await preparationStatus(f.preparationDirectory);
    assert.equal(status.status, 'prepared'); assert.equal(status.timing.visualAcceptance, 'not-measured');
    assert.ok(status.jobs.every(job => job.status === 'complete')); assert.equal(status.remoteWrites, 0);
    assert.deepEqual((await mergePreparationDirectory(f.preparationDirectory)).manifest, merged.manifest);
    await assert.rejects(lstat(f.finalRunDirectory), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('result ownership and shared contract integrity fail without completing a worker', async () => {
  const f = await preparationIOFixture();
  try {
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory }); await startPreparationJob(f.preparationDirectory, 'header');
    const wrongPath = await f.put('unowned-result.json', f.results[0]);
    await assert.rejects(completePreparationJob(f.preparationDirectory, 'header', wrongPath.path), /result_path/);
    const stale = structuredClone(f.results[0]); stale.sharedHash = 'b'.repeat(64);
    await assert.rejects(completePreparationJob(f.preparationDirectory, 'header', await f.writeResult('header', stale)), /result_identity/);
    assert.equal((await preparationStatus(f.preparationDirectory)).jobs[0].status, 'running');
    await completePreparationJob(f.preparationDirectory, 'header', await f.writeResult('header'));
    await assert.rejects(completePreparationJob(f.preparationDirectory, 'header', path.join(f.preparationDirectory, 'jobs/header/result.json')), /job_not_running/);
  } finally { await f.cleanup(); }
});

test('a changed completed result is rejected at assembly rather than silently incorporated', async () => {
  const f = await preparationIOFixture();
  try {
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    for (const job of f.jobs) { await startPreparationJob(f.preparationDirectory, job.jobId); await completePreparationJob(f.preparationDirectory, job.jobId, await f.writeResult(job.jobId)); }
    const header = structuredClone(f.results[0]); header.header!.style.css = ':header{color:red}';
    await f.writeResult('header', header);
    await assert.rejects(mergePreparationDirectory(f.preparationDirectory), /file_changed/);
    assert.equal((await preparationStatus(f.preparationDirectory)).status, 'awaiting-preparation');
  } finally { await f.cleanup(); }
});

test('changed browser screenshot evidence prevents dispatch before any preparation records are created', async () => {
  const f = await preparationIOFixture();
  try {
    await writeFile(f.packets[0].snapshot.screenshot.path, 'changed bytes');
    await assert.rejects(initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory }), /file_changed/);
    await assert.rejects(lstat(f.preparationDirectory), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('frozen shared plan tampering and a different contract cannot reuse an existing preparation directory', async () => {
  const f = await preparationIOFixture();
  try {
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    const changed = structuredClone(f.plan); changed.shared.decisions[0].value = 'unrelated-font';
    await assert.rejects(initializePreparation(changed, { finalRunDirectory: f.finalRunDirectory }), /(?:contract|identity|changed)/);
    const filename = path.join(f.preparationDirectory, 'contract.json');
    await writeFile(filename, JSON.stringify(changed));
    await assert.rejects(startPreparationJob(f.preparationDirectory, 'header'), /file_changed/);
  } finally { await f.cleanup(); }
});

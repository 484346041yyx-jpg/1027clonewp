import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { recordPreparationPhase, readPreparationPhases } from '../src/replica-preparation/phase-events.js';
import { runPreparationCLI, parsePreparationArgs } from '../src/replica-preparation/cli.js';

async function fixture(work: (directory: string) => Promise<void>) {
  const directory = path.join('D:/cloneWP/references', `phase-events-test-${randomUUID()}`); await mkdir(directory);
  try { await work(directory); } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve('D:/cloneWP/references') + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
}

test('phase markers persist actual UTC boundaries with explicit nonmonotonic duration and absent future stages', async () => fixture(async directory => {
  assert.equal(await readPreparationPhases(directory), null);
  const started = await recordPreparationPhase(directory, 'source-observation', 'start');
  assert.equal(started.entry.status, 'running'); assert.equal(started.entry.elapsedMs, undefined);
  const finished = await recordPreparationPhase(directory, 'source-observation', 'succeeded', started.marker);
  assert.equal(finished.entry.status, 'succeeded'); assert.equal(finished.marker, started.marker);
  assert.equal(finished.entry.elapsedMs, Date.parse(finished.entry.finishedAt!) - Date.parse(finished.entry.startedAt));
  const document = await readPreparationPhases(directory);
  assert.equal(document!.durationSource, 'cross-command-utc-wall'); assert.equal(document!.monotonic, false);
  assert.equal(document!.entries.length, 1); assert.equal(document!.entries.some(row => row.stage === 'visual-acceptance'), false);
  assert.deepEqual(await readdir(directory), ['phase-events.json']);
}));

test('completion requires its exact unfinished stage marker; failure does not replace existing history', async () => fixture(async directory => {
  const first = await recordPreparationPhase(directory, 'shared-planning', 'start');
  const before = await readFile(first.timingFile, 'utf8');
  await assert.rejects(recordPreparationPhase(directory, 'material-preparation', 'succeeded', first.marker), /marker_conflict/);
  await assert.rejects(recordPreparationPhase(directory, 'shared-planning', 'failed'), /marker_invalid/);
  await assert.rejects(recordPreparationPhase(directory, 'shared-planning', 'start', first.marker), /marker_invalid/);
  assert.equal(await readFile(first.timingFile, 'utf8'), before);
  await recordPreparationPhase(directory, 'shared-planning', 'failed', first.marker);
  const after = await readFile(first.timingFile, 'utf8');
  await assert.rejects(recordPreparationPhase(directory, 'shared-planning', 'succeeded', first.marker), /marker_conflict/);
  assert.equal(await readFile(first.timingFile, 'utf8'), after);
  const second = await recordPreparationPhase(directory, 'material-preparation', 'start');
  await recordPreparationPhase(directory, 'material-preparation', 'cancelled', second.marker);
  assert.deepEqual((await readPreparationPhases(directory))!.entries.map(row => row.status), ['failed', 'cancelled']);
}));

test('concurrent starts serialize through a bounded short lock without losing either phase or changing frozen state', async () => fixture(async directory => {
  const state = '{"frozen":"state"}\n', manifest = '{"frozen":"manifest"}\n';
  await writeFile(path.join(directory, 'state.json'), state); await writeFile(path.join(directory, 'manifest.json'), manifest);
  const results = await Promise.all([
    recordPreparationPhase(directory, 'source-observation', 'start'),
    recordPreparationPhase(directory, 'shared-planning', 'start'),
  ]);
  assert.notEqual(results[0].marker, results[1].marker); assert.equal((await readPreparationPhases(directory))!.entries.length, 2);
  assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), state);
  assert.equal(await readFile(path.join(directory, 'manifest.json'), 'utf8'), manifest);
  assert.equal((await readdir(directory)).some(name => name.includes('.tmp') || name.includes('.lock')), false);
}));

test('unknown labels and malformed existing logs are rejected without persisting arbitrary or sensitive text', async () => fixture(async directory => {
  const secret = 'Authorization: Bearer secret https://private.example/?nonce=secret';
  await assert.rejects(recordPreparationPhase(directory, secret as never, 'start'), /stage_invalid/);
  await assert.rejects(recordPreparationPhase(directory, 'source-observation', secret as never), /event_invalid/);
  await assert.rejects(recordPreparationPhase(directory, 'source-observation', 'succeeded', secret), /marker_invalid/);
  assert.deepEqual(await readdir(directory), []);
  const filename = path.join(directory, 'phase-events.json'), invalid = JSON.stringify({ secret }); await writeFile(filename, invalid);
  await assert.rejects(recordPreparationPhase(directory, 'source-observation', 'start'), /log_invalid/);
  assert.equal(await readFile(filename, 'utf8'), invalid);
  await assert.rejects(readPreparationPhases(directory), /log_invalid/);
}));

test('only existing direct task directories are allowed; this recorder cannot create a task or modify project source', async () => {
  for (const directory of ['D:/cloneWP', 'D:/cloneWP/src/replica-preparation', 'D:/Cloneweb/references/task', 'D:/cloneWP/references/task/nested']) {
    await assert.rejects(recordPreparationPhase(directory, 'source-observation', 'start'), /directory_scope/);
  }
  const missing = path.join('D:/cloneWP/references', `phase-events-missing-${randomUUID()}`);
  await assert.rejects(recordPreparationPhase(missing, 'source-observation', 'start'), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(missing, 'phase-events.json')), { code: 'ENOENT' });
});

test('coordinator CLI records observation before dispatch and reports actual phase history locally', async () => fixture(async directory => {
  for (const args of [
    ['phase', '--directory', directory, '--stage', 'source-observation', '--event', 'succeeded'],
    ['phase', '--directory', directory, '--stage', 'unknown', '--event', 'start'],
    ['phase', '--directory', directory, '--stage', 'source-observation', '--event', 'start', '--marker', randomUUID()],
  ]) assert.throws(() => parsePreparationArgs(args), /arguments/);
  const start = await runPreparationCLI(['phase', '--directory', directory, '--stage', 'source-observation', '--event', 'start']) as { marker: string };
  await runPreparationCLI(['phase', '--directory', directory, '--stage', 'source-observation', '--event', 'succeeded', '--marker', start.marker]);
  const read = await runPreparationCLI(['phases', '--directory', directory]) as any;
  assert.equal(read.remoteWrites, 0); assert.equal(read.timing.entries.length, 1);
  assert.equal(read.timing.entries[0].status, 'succeeded'); assert.ok(read.timing.entries[0].elapsedMs >= 0);
}));

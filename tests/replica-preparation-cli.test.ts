import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parsePreparationArgs, runPreparationCLI } from '../src/replica-preparation/cli.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';

test('preparation CLI strictly separates dispatcher, worker and coordinator arguments', () => {
  assert.deepEqual(parsePreparationArgs(['compare-presentation', '--directory', 'prepared', '--evidence', 'evidence.json']), { command: 'compare-presentation', directory: 'prepared', evidence: 'evidence.json' });
  assert.throws(() => parsePreparationArgs(['compare-presentation', '--directory', 'prepared']), /replica_preparation_arguments/);
  assert.throws(() => parsePreparationArgs(['compare-presentation', '--directory', 'prepared', '--evidence', 'evidence.json', '--publish', 'yes']), /replica_preparation_arguments/);
  assert.deepEqual(parsePreparationArgs(['dispatch', '--input', 'plan.json', '--run-dir', 'run']), { command: 'dispatch', input: 'plan.json', runDirectory: 'run' });
  assert.deepEqual(parsePreparationArgs(['start', '--directory', 'prepared', '--job', 'body-2']), { command: 'start', directory: 'prepared', job: 'body-2' });
  assert.deepEqual(parsePreparationArgs(['complete', '--job', 'header', '--result', 'result.json', '--directory', 'prepared']), { command: 'complete', directory: 'prepared', job: 'header', result: 'result.json' });
  assert.deepEqual(parsePreparationArgs(['fail', '--directory', 'prepared', '--job', 'body-1']), { command: 'fail', directory: 'prepared', job: 'body-1' });
  for (const args of [[], ['unknown'], ['dispatch', '--input'], ['dispatch', '--input', '--run-dir', 'run'], ['dispatch', '--input', 'a', '--input', 'b'], ['dispatch', '--input', 'a', '--directory', 'd'], ['start', '--directory', 'd'], ['start', '--directory', 'd', '--job', 'body-3'], ['start', '--directory', 'd', '--job', 'header', '--result', 'result.json'], ['complete', '--directory', 'd', '--job', 'header'], ['fail', '--directory', 'd', '--job', 'header', '--result', 'result.json'], ['merge', '--directory', 'd', '--job', 'header'], ['status', '--directory', 'a', '--directory', 'b'], ['status', '--directory', 'a', '--site', 'target']]) assert.throws(() => parsePreparationArgs(args), /replica_preparation_arguments/);
});

test('preparation help and invalid commands stay local without opening task evidence', async () => {
  assert.equal((await runPreparationCLI([]) as { remoteWrites: number }).remoteWrites, 0);
  assert.equal((await runPreparationCLI(['--help']) as { remoteWrites: number }).remoteWrites, 0);
  await assert.rejects(runPreparationCLI(['dispatch', '--input', 'D:/cloneWP/nonexistent-plan.json', '--site', 'target']), /replica_preparation_arguments/);
});

test('CLI resolves only bound file references, starts independent workers and retains failed-stage time without calling it pure model time', async () => {
  const f = await preparationIOFixture();
  try {
    const relativize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(relativize);
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === 'path' && typeof child === 'string' && typeof record.sha256 === 'string' ? path.relative(f.directory, child) : relativize(child)]));
      }
      return value;
    };
    const input = await f.put('preparation.json', relativize(f.plan));
    const dispatched = await runPreparationCLI(['dispatch', '--input', input.path, '--run-dir', f.finalRunDirectory]) as any;
    assert.equal(dispatched.status, 'awaiting-preparation'); assert.equal(dispatched.remoteWrites, 0);
    await Promise.all(['header', 'body-1', 'body-2'].map(job => runPreparationCLI(['start', '--directory', f.preparationDirectory, '--job', job])));
    const failed = await runPreparationCLI(['fail', '--directory', f.preparationDirectory, '--job', 'body-2']) as any;
    assert.equal(failed.status, 'failed'); assert.equal(failed.measurement, 'utc-wall-agent-start-to-result'); assert.ok(failed.elapsedMs >= 0);
    const status = await runPreparationCLI(['status', '--directory', f.preparationDirectory]) as any;
    const worker = status.jobs.find((job: { jobId: string }) => job.jobId === 'body-2');
    assert.equal(worker.status, 'failed'); assert.equal(worker.elapsedMs, failed.elapsedMs);
    assert.ok(worker.startedAt); assert.ok(worker.finishedAt); assert.equal(status.timing.pureModelTime, 'not-measured');
    assert.equal(status.timing.preflight.measurement, 'monotonic-local'); assert.ok(status.timing.preflight.elapsedMs >= 0);
    assert.equal(status.jobs.filter((job: { status: string }) => job.status === 'running').length, 2);
    const state = await f.readState(); assert.equal(state.plan.path, path.join(f.preparationDirectory, 'contract.json'));
    await assert.rejects(runPreparationCLI(['complete', '--directory', f.preparationDirectory, '--job', 'body-2', '--result', await f.writeResult('body-2')]), /job_not_running/);
    await assert.rejects(runPreparationCLI(['merge', '--directory', f.preparationDirectory]), /jobs_incomplete/);
    await runPreparationCLI(['start', '--directory', f.preparationDirectory, '--job', 'body-2']);
    const retried = await runPreparationCLI(['status', '--directory', f.preparationDirectory]) as any;
    const retryWorker = retried.jobs.find((job: { jobId: string }) => job.jobId === 'body-2');
    assert.equal(retryWorker.status, 'running'); assert.equal(retryWorker.previousAttempts.length, 1);
    assert.equal(retryWorker.previousAttempts[0].elapsedMs, failed.elapsedMs); assert.equal(retryWorker.previousAttempts[0].status, 'failed');
    await runPreparationCLI(['complete', '--directory', f.preparationDirectory, '--job', 'body-2', '--result', await f.writeResult('body-2')]);
    const stateAfterRetry = await f.readState();
    assert.equal(stateAfterRetry.jobs.find((job: any) => job.job.jobId === 'header').status, 'running');
    assert.equal(stateAfterRetry.jobs.find((job: any) => job.job.jobId === 'body-2').previousAttempts.length, 1);
  } finally { await f.cleanup(); }
});

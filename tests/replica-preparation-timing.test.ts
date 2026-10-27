import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createPreparationTiming, wrapFullReplicaDependencies, type PreparationTimingDocument, type TimingClock, type TimingIO } from '../src/replica-preparation/timing.js';
import type { FullReplicaDependencies } from '../src/replica-full/types.js';

function fixture() {
  let now = 10, offset = 0;
  const clock: TimingClock = { monotonicNow: () => now, utcNow: () => new Date(Date.UTC(2026, 9, 19) + now + offset).toISOString() };
  const writes: PreparationTimingDocument[] = [];
  const io: TimingIO = { async writeAtomic(_filename, document) { writes.push(structuredClone(document)); } };
  const timing = createPreparationTiming({ runDirectory: 'D:/cloneWP/.cache/timing-fixture', command: 'prepare', id: 'fixture', clock, io });
  return { timing, writes, advance: (ms: number) => { now += ms; }, moveUTC: (ms: number) => { offset += ms; } };
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('parallel stage durations are distinct from measured command wall time and omit unobserved stages', async () => {
  const { timing, writes, advance } = fixture(), release = deferred(), headerEntered = deferred(), bodyEntered = deferred();
  const header = timing.measure('header-plan', async () => { headerEntered.resolve(); await release.promise; return 'header'; });
  const body = timing.measure('body-content-plan', async () => { bodyEntered.resolve(); await release.promise; return 'body'; });
  await Promise.all([headerEntered.promise, bodyEntered.promise]); advance(100); release.resolve();
  assert.deepEqual(await Promise.all([header, body]), ['header', 'body']); await timing.finish('succeeded');
  const result = timing.summary(); assert.equal(result.wallElapsedMs, 100);
  assert.deepEqual(result.stages.map(stage => [stage.stage, stage.elapsedMs, stage.status]), [['header-plan', 100, 'succeeded'], ['body-content-plan', 100, 'succeeded']]);
  assert.equal(result.stages.reduce((sum, row) => sum + row.elapsedMs!, 0), 200);
  assert.equal(result.durationRule, 'wall-clock-total; phase-durations-may-overlap');
  assert.ok(writes.length >= 5); assert.equal(result.stages.some(row => row.stage === 'publishPage' || row.stage === 'source-observation'), false);
});

test('elapsed duration uses a monotonic clock even if the UTC clock moves backwards', async () => {
  const { timing, advance, moveUTC } = fixture();
  await timing.measure('shared-planning', () => { advance(60); moveUTC(-60_000); }); await timing.finish('succeeded');
  const result = timing.summary(); assert.equal(result.wallElapsedMs, 60); assert.equal(result.stages[0].elapsedMs, 60);
  assert.ok(result.stages[0].finishedAt! < result.stages[0].startedAt);
});

test('exceptions and cancellation are measured without logging sensitive input, output or original error text', async () => {
  const { timing, writes, advance } = fixture();
  const secret = 'Authorization=Bearer private-secret https://private.example/?nonce=secret';
  const error = Error(secret);
  await assert.rejects(timing.measure('body-interaction-plan', () => { advance(25); throw error; }), actual => actual === error);
  const cancelled = Error(secret); cancelled.name = 'AbortError';
  await assert.rejects(timing.measure('material-preparation', () => { advance(15); throw cancelled; }), actual => actual === cancelled);
  await timing.measure('merge', () => ({ privateOutput: secret })); await timing.finish('failed');
  const result = timing.summary(); assert.deepEqual(result.stages.map(row => row.status), ['failed', 'cancelled', 'succeeded']);
  assert.equal(result.stages[0].elapsedMs, 25); assert.equal(result.stages[1].elapsedMs, 15);
  const serialized = JSON.stringify(writes); assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes('privateOutput'), false);
});

test('external markers explicitly distinguish dispatch, start and observation instead of claiming pure model time', async () => {
  const { timing, advance } = fixture();
  const dispatch = await timing.externalStart('header-plan', { source: 'agent-dispatch' }); advance(20);
  const started = await timing.externalStart('header-plan', { source: 'agent-start' }); advance(80);
  await timing.externalFinish(started, 'succeeded'); await timing.externalFinish(dispatch, 'succeeded');
  const observation = await timing.externalStart('source-observation', { source: 'external-observation' }); advance(5);
  await timing.externalFinish(observation, 'succeeded'); await timing.finish('succeeded');
  assert.deepEqual(timing.summary().stages.map(row => [row.source, row.elapsedMs]), [['agent-dispatch', 100], ['agent-start', 80], ['external-observation', 5]]);
  await assert.rejects(timing.externalFinish(dispatch, 'succeeded'), /timing_closed/);
});

test('ending a command cancels unfinished observations without claiming the external worker stopped', async () => {
  const { timing, advance } = fixture();
  await timing.externalStart('body-content-plan', { source: 'agent-dispatch' }); advance(40); await timing.finish('cancelled');
  const result = timing.summary(); assert.equal(result.stages[0].status, 'cancelled'); assert.equal(result.stages[0].elapsedMs, 40);
  assert.equal(result.stages[0].completionObserved, false); assert.equal(result.status, 'cancelled');
  await timing.finish('cancelled'); await assert.rejects(timing.finish('succeeded'), /already_finished/);
});

test('unknown stages, commands and marker sources are rejected before adding arbitrary log fields', async () => {
  const { timing, writes } = fixture();
  await assert.rejects(timing.measure('private-input' as never, () => 'unreachable'), /stage_invalid/);
  await assert.rejects(timing.externalStart('merge', { source: 'prompt-secret' as never }), /source_invalid/);
  await assert.rejects(timing.externalFinish('secret-marker', 'succeeded'), /marker_invalid/);
  assert.throws(() => createPreparationTiming({ runDirectory: 'D:/cloneWP', command: 'https://secret.example' }), /command_invalid/);
  assert.deepEqual(timing.summary().stages, []); assert.deepEqual(writes, []);
});

test('failed timing persistence prevents work and all subsequent wrapped remote writes', async () => {
  let writes = 0, remoteWrites = 0;
  const timing = createPreparationTiming({ runDirectory: 'D:/cloneWP/.cache/timing-fixture', command: 'run', io: { async writeAtomic() { if (++writes === 2) throw Error('private disk failure'); } } });
  const dependencies = {
    async createPage() { remoteWrites++; return { identity: 'created' }; },
    async provisionHeader() { remoteWrites++; return {}; },
  } as unknown as Omit<FullReplicaDependencies, 'writeState'>;
  const wrapped = wrapFullReplicaDependencies(dependencies, timing);
  await assert.rejects(wrapped.createPage({} as never, {} as never), /timing_persist_failed/);
  assert.equal(remoteWrites, 1);
  await assert.rejects(wrapped.provisionHeader({} as never, {} as never, {} as never), /timing_persist_failed/);
  await assert.rejects(timing.finish('failed'), /timing_persist_failed/); assert.equal(remoteWrites, 1);
});

test('an initial persistence failure never invokes the measured operation', async () => {
  let calls = 0;
  const timing = createPreparationTiming({ runDirectory: 'D:/cloneWP/.cache/timing-fixture', command: 'run', io: { async writeAtomic() { throw Error('secret'); } } });
  await assert.rejects(timing.measure('createPage', () => { calls++; }), /timing_persist_failed/); assert.equal(calls, 0);
});

test('dependency wrapper retains this, arguments, result identity, optional methods and serial call order', async () => {
  const { timing } = fixture(), calls: string[] = [], argument = { exact: 'input' }, output = { exact: 'output' };
  const raw = {
    marker: 'original-this',
    async prepareHeader(value: unknown) { assert.equal(this, raw); assert.equal(value, argument); calls.push('header'); return output; },
    async prepareBody(value: unknown) { assert.equal(this, raw); assert.equal(value, argument); calls.push('body'); return output; },
    async assertPreparedBody(...values: unknown[]) { assert.equal(this, raw); assert.deepEqual(values, [output, argument]); calls.push('assert'); },
  };
  const dependencies = raw as unknown as Omit<FullReplicaDependencies, 'writeState'>;
  const wrapped = wrapFullReplicaDependencies(dependencies, timing);
  assert.equal(await wrapped.prepareHeader(argument as never), output);
  assert.equal(await wrapped.prepareBody(argument as never), output);
  await wrapped.assertPreparedBody(output as never, argument as never);
  assert.deepEqual(calls, ['header', 'body', 'assert']); assert.equal(wrapped.reviseStyle, undefined);
  await timing.finish('succeeded'); assert.equal(timing.summary().stages.length, 3);
});

test('navigation return command and its exact optional dependency stage are measured through the real wrapper', async () => {
  const documents: PreparationTimingDocument[] = [], input = { exact: 'prepared' }, bound = { exact: 'bound' }, operation = { exact: 'operation' }, output = { exact: 'result' };
  const timing = createPreparationTiming({ runDirectory: 'D:/cloneWP/.cache/timing-fixture', command: 'revise-navigation-return', io: { async writeAtomic(_filename, document) { documents.push(structuredClone(document)); } } });
  let calls = 0;
  const raw = { async reviseNavigationReturn(...args: unknown[]) { assert.equal(this, raw); assert.deepEqual(args, [input, bound, operation]); calls++; return output; } };
  const wrapped = wrapFullReplicaDependencies(raw as unknown as Omit<FullReplicaDependencies, 'writeState'>, timing);
  assert.equal(await wrapped.reviseNavigationReturn!(input as never, bound as never, operation as never), output); await timing.finish('succeeded');
  assert.equal(calls, 1); assert.equal(timing.summary().command, 'revise-navigation-return'); assert.deepEqual(timing.summary().stages.map(row => [row.stage, row.status]), [['reviseNavigationReturn', 'succeeded']]);
  assert.equal(documents[0].stages[0].status, 'running'); assert.equal(documents.at(-1)?.status, 'succeeded');
  assert.throws(() => createPreparationTiming({ runDirectory: 'D:/cloneWP', command: 'revise-navigation-return-extra' }), /command_invalid/);
  await assert.rejects(createPreparationTiming({ runDirectory: 'D:/cloneWP', command: 'revise-navigation-return' }).measure('reviseNavigationReturnExtra' as never, () => {}), /stage_invalid/);
});

test('default atomic IO writes a new command file and never changes frozen state or another command measurement', async () => {
  const directory = path.join('D:/cloneWP/.cache', `preparation-timing-${randomUUID()}`); await mkdir(directory, { recursive: true });
  try {
    const state = '{"frozen":"old-state"}\n', manifest = '{"frozen":"old-manifest"}\n';
    await writeFile(path.join(directory, 'state.json'), state); await writeFile(path.join(directory, 'manifest.json'), manifest);
    const first = createPreparationTiming({ runDirectory: directory, command: 'run' });
    await first.measure('prepareHeader', () => 'result'); await first.finish('succeeded');
    const original = await readFile(first.filename, 'utf8');
    const second = createPreparationTiming({ runDirectory: directory, command: 'review' }); await second.finish('succeeded');
    assert.notEqual(first.filename, second.filename); assert.equal(await readFile(first.filename, 'utf8'), original);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), state); assert.equal(await readFile(path.join(directory, 'manifest.json'), 'utf8'), manifest);
    assert.equal((await readdir(directory)).filter(name => name.startsWith('timings-')).length, 2);
    assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);
    const collision = createPreparationTiming({ runDirectory: directory, command: 'run', id: first.summary().measurementId });
    await assert.rejects(collision.finish('succeeded'), /timing_persist_failed/); assert.equal(await readFile(first.filename, 'utf8'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

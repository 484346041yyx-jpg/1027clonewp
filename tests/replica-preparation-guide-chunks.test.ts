import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { initializePreparation, readPreparationProductionGuide, splitPreparationProductionGuide } from '../src/replica-preparation/io.js';
import { preparationJson } from '../src/replica-preparation/contract.js';
import { parsePreparationArgs, runPreparationCLI } from '../src/replica-preparation/cli.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';

const sampleGuide = (key: string) => ({
  version: 3, kind: 'source-production-guide', instructions: 'Complete source evidence is retained.',
  pageStructure: [{ snapshotId: 'wide', sections: [{ key, layoutFactIds: ['wide:layout'] }] }],
  sections: [{ key, viewports: [{ snapshotId: 'wide', requirements: [{ sourceFactId: 'wide:text', text: 'Original static text' }] }] }],
  mobile: { version: 1, kind: 'phone-production-guide', snapshots: [{ snapshotId: 'phone', unassignedFactIds: ['outside-section'] }], rendered: 'not-verified', issues: [], sections: [{ key, sourceFacts: { text: { value: 'Complete hidden content' } }, declaredOwners: [{ snapshotId: 'phone', nodeId: 'root' }] }] },
});

async function installGuide(fixture: Awaited<ReturnType<typeof preparationIOFixture>>, jobId: string, guide: unknown) {
  const state = await fixture.readState(), row = state.jobs.find((candidate: { job: { jobId: string } }) => candidate.job.jobId === jobId);
  const packet = JSON.parse(await readFile(row.packet.path, 'utf8'));
  packet.productionGuide = guide;
  row.packet = await fixture.put(path.relative(fixture.directory, row.packet.path), packet);
  await writeFile(path.join(fixture.preparationDirectory, 'state.json'), JSON.stringify(state));
  return state;
}

test('guide splitting is lossless and retains job-wide metadata rather than recomputing section coverage', () => {
  const original = sampleGuide('hero');
  original.sections.push({ ...original.sections[0], key: 'faq' });
  original.mobile.sections.push({ ...original.mobile.sections[0], key: 'faq' });
  const split = splitPreparationProductionGuide(original);
  const reconstructed = { ...split.contexts.desktop, sections: split.sections.map(section => section.desktop), mobile: { ...split.contexts.phone, sections: split.sections.map(section => section.phone) } };
  assert.deepEqual(reconstructed, original);
  assert.deepEqual(split.contexts.phone?.snapshots, original.mobile.snapshots);
  assert.throws(() => splitPreparationProductionGuide({ ...original, sections: [...original.sections, original.sections[0]] }), /production_guide_sections/);
});

test('section and device chunks obey the original JSON value limit without deleting a single source item', () => {
  const original = { version: 3, sections: [{ key: 'first', facts: Array(1_000_010).fill('source') }, { key: 'second', facts: Array(1_000_010).fill('source') }] };
  assert.throws(() => preparationJson(original), /json_limit/);
  const split = splitPreparationProductionGuide(original);
  assert.equal(split.sections.reduce((total, section) => total + (section.desktop.facts as unknown[]).length, 0), 2_000_020);
  assert.doesNotThrow(() => preparationJson(split.contexts.desktop));
  for (const section of split.sections) assert.doesNotThrow(() => preparationJson(section.desktop));
});

test('guide CLI requires an exact job, section and device and cannot accept write flags', () => {
  const args = ['read-production-guide', '--directory', 'prepared', '--job', 'body-2', '--section', 'contact', '--device', 'phone'];
  assert.deepEqual(parsePreparationArgs(args), { command: 'read-production-guide', directory: 'prepared', job: 'body-2', section: 'contact', device: 'phone' });
  assert.equal(parsePreparationArgs(args.map(value => value === 'body-2' ? 'merged' : value)).job, 'merged');
  for (const invalid of [args.slice(0, -2), [...args, '--publish', 'yes'], args.map(value => value === 'body-2' ? 'header' : value), args.map(value => value === 'phone' ? 'tablet' : value), args.map(value => value === 'contact' ? '../contact' : value)]) assert.throws(() => parsePreparationArgs(invalid), /arguments/);
});

test('historical inline guides remain readable without migrating or changing persisted bytes', async () => {
  const fixture = await preparationIOFixture();
  try {
    const initial = await initializePreparation(fixture.plan, { finalRunDirectory: fixture.finalRunDirectory });
    const row = initial.jobs.find(job => job.jobId === 'body-1')!, key = fixture.jobs.find(job => job.jobId === 'body-1')!.sectionKeys[0], original = sampleGuide(key);
    await installGuide(fixture, 'body-1', original);
    const stateBefore = await readFile(path.join(fixture.preparationDirectory, 'state.json'), 'utf8'), packetBefore = await readFile(row.packet.path, 'utf8');
    const desktop = await readPreparationProductionGuide(fixture.preparationDirectory, 'body-1', key, 'desktop');
    assert.deepEqual(desktop.guide.sections, original.sections);
    assert.equal('mobile' in desktop.guide, false);
    const phone = await runPreparationCLI(['read-production-guide', '--directory', fixture.preparationDirectory, '--job', 'body-1', '--section', key, '--device', 'phone']) as typeof desktop;
    assert.deepEqual(phone.guide, original.mobile); assert.equal(phone.remoteWrites, 0);
    assert.equal(await readFile(path.join(fixture.preparationDirectory, 'state.json'), 'utf8'), stateBefore);
    assert.equal(await readFile(row.packet.path, 'utf8'), packetBefore);
    await assert.rejects(readPreparationProductionGuide(fixture.preparationDirectory, 'body-2', key, 'desktop'), /production_guide_owner/);
  } finally { await fixture.cleanup(); }
});

test('indexed guide reads verify hashes, exact section ownership and chunk job identity', async () => {
  const fixture = await preparationIOFixture();
  try {
    await initializePreparation(fixture.plan, { finalRunDirectory: fixture.finalRunDirectory });
    const state = await fixture.readState(), key = fixture.jobs.find(job => job.jobId === 'body-1')!.sectionKeys[0], split = splitPreparationProductionGuide(sampleGuide(key));
    const identity = { taskId: state.taskId, runId: state.runId, scope: 'body-1', contractHash: state.contractHash };
    const context = await fixture.put('guide/desktop-context.json', { version: 1, kind: 'clonewp-production-guide-context', ...identity, device: 'desktop', guide: split.contexts.desktop });
    const chunkValue = { version: 1, kind: 'clonewp-production-guide-section', ...identity, device: 'desktop', sectionKey: key, guide: split.sections[0].desktop };
    const chunk = await fixture.put('guide/desktop-section.json', chunkValue);
    const index = { version: 4, kind: 'source-production-guide-index', ...identity, contexts: { desktop: context }, sections: [{ key, desktop: chunk }], readCommand: [], instructions: 'Read exact source chunks with their recorded hashes.' };
    await installGuide(fixture, 'body-1', index);
    assert.deepEqual((await readPreparationProductionGuide(fixture.preparationDirectory, 'body-1', key, 'desktop')).guide, { ...split.contexts.desktop, sections: [split.sections[0].desktop] });
    await assert.rejects(readPreparationProductionGuide(fixture.preparationDirectory, 'body-1', key, 'phone'), /production_guide_device/);
    await writeFile(chunk.path, '{}');
    await assert.rejects(readPreparationProductionGuide(fixture.preparationDirectory, 'body-1', key, 'desktop'), /file_changed/);
    index.sections[0].desktop = await fixture.put('guide/desktop-section.json', { ...chunkValue, scope: 'body-2' });
    await installGuide(fixture, 'body-1', index);
    await assert.rejects(readPreparationProductionGuide(fixture.preparationDirectory, 'body-1', key, 'desktop'), /production_guide_identity/);
    index.sections[0].desktop = await fixture.put('guide/desktop-section.json', { ...chunkValue, sectionKey: 'another' });
    await installGuide(fixture, 'body-1', index);
    await assert.rejects(readPreparationProductionGuide(fixture.preparationDirectory, 'body-1', key, 'desktop'), /production_guide_owner/);
  } finally { await fixture.cleanup(); }
});

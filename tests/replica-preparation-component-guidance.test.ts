import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createComponentGuidance, componentGuidanceApplication } from '../src/replica-preparation/component-guidance.js';
import { buildPreparationJobs, validatePreparationJobResult } from '../src/replica-preparation/contract.js';
import { initializePreparation, startPreparationJob, completePreparationJob, preparationStatus } from '../src/replica-preparation/io.js';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { BODY_FIDELITY_KINDS, type PreparationJobResult } from '../src/replica-preparation/types.js';
import { native44ProgramSchema } from '../src/native44/validate.js';
import { responsiveSourceSchema } from '../src/replica-responsive/contract.js';

const guidePath = 'D:/cloneWP/docs/knowledge/elementor-container-patterns.md';
async function guidance() {
  const bytes = await readFile(guidePath);
  return createComponentGuidance(bytes.toString('utf8'), { path: guidePath, sha256: createHash('sha256').update(bytes).digest('hex') });
}
function review(sha256: string, result: PreparationJobResult) {
  result.componentGuidanceReview = { guideSha256: sha256, decisions: result.sections!.map(section => ({
    sectionKey: section.key, componentKeys: [section.key, section.key + '_title'], principleSections: [1, 3, 4],
    compositionReason: 'The current source groups one editable heading inside the principal section container.',
    settingsReason: 'Use current observed settings and native layout ownership; no archived instance values are assigned.',
    phoneReason: 'The same content uses the declared native phone settings; inheritance and rendering still need review.',
    phoneMode: section.responsive?.mode ?? 'not-in-scope',
  })) };
  return result;
}

test('current unified knowledge reaches planning without expanding instance values or authorizing controls', async () => {
  const g = await guidance();
  assert.match(g.text, /按共同职责选择组合/);
  assert.match(g.text, /当前模式与字段生效条件分开/);
  assert.match(g.text, /手机适配先选机制/);
  assert.deepEqual(g.policy, { settingDefaults: false, instanceArchivesExpanded: false, sourceEvidence: false, grantsComponentPermission: false });
  assert.match(g.instructions, /nativeStyleSettings/);
  assert.throws(() => createComponentGuidance(g.text + 'drift', g.source), /component_guidance_source/);
});

test('knowledge review binds each decision to actual component owners and emitted phone mode without mutating settings', async () => {
  const f = await preparationIOFixture();
  try {
    const g = await guidance(), job = f.jobs.find(row => row.responsibility === 'body')!;
    const result = review(g.source.sha256, structuredClone(f.results.find(row => row.jobId === job.jobId)!));
    const section = result.sections![0];
    section.responsive = { key: section.key, mode: 'shared', reason: 'Source keeps the same heading on both phone widths.', evidence: [{ snapshotId: 'phone-a', nodeId: section.key }, { snapshotId: 'phone-b', nodeId: section.key }], settings: [{ componentKey: section.key, values: { flex_direction_mobile: 'column' } }], childOrders: [], css: '' };
    result.componentGuidanceReview!.decisions[0].phoneMode = 'shared';
    const before = structuredClone(result), application = componentGuidanceApplication(g, job, validatePreparationJobResult(result));
    assert.equal(application.renderedVerified, false);
    assert.deepEqual(application.decisions[0].actualPlan.phoneSettingFields, [{ componentKey: section.key, fields: ['flex_direction_mobile'] }]);
    assert.deepEqual(result, before);
    for (const change of [
      (r: PreparationJobResult) => { delete r.componentGuidanceReview; },
      (r: PreparationJobResult) => { r.componentGuidanceReview!.guideSha256 = '0'.repeat(64); },
      (r: PreparationJobResult) => { r.componentGuidanceReview!.decisions[0].componentKeys.push('other_section'); },
      (r: PreparationJobResult) => { r.componentGuidanceReview!.decisions[0].phoneMode = 'duplicate'; },
      (r: PreparationJobResult) => { r.componentGuidanceReview!.decisions.push(r.componentGuidanceReview!.decisions[0]); },
    ]) { const wrong = structuredClone(result); change(wrong); assert.throws(() => componentGuidanceApplication(g, job, wrong), /component_guidance_review/); }
  } finally { await f.cleanup(); }
});

/** Synthetic local dual-desktop/phone evidence, never a browser or visual qualification. */
async function modernFixture() {
  const f = await preparationIOFixture();
  for (const packet of f.packets) packet.styles.style.color = '#123456';
  const refs = await Promise.all(f.packets.map(packet => f.put(`${packet.snapshot.id}-packet.json`, packet)));
  const evidence = await f.put('source-evidence.json', { version: 1, kind: 'native44-body-source-evidence', taskId: f.plan.taskId, sourceUrl: f.plan.sourceUrl, snapshots: f.packets.map((packet, i) => ({ id: packet.snapshot.id, viewport: packet.snapshot.viewport, packets: [refs[i]] })) });
  const facts = buildSourceFactsV2({ manifestPath: evidence.path, manifestSha256: evidence.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: f.plan.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets: f.packets, packetFiles: refs.map((ref, i) => ({ ...ref, snapshotId: f.packets[i].snapshot.id })) });
  f.plan.sourceEvidence = evidence; f.plan.sourceFacts = f.plan.bodyBase.sourceFacts = await f.put('source-facts.json', facts);
  for (const row of [...f.plan.shared.decisions, ...f.plan.shared.compatibility]) row.evidence = [f.plan.sourceFacts];
  f.plan.version = 8; f.plan.bodyBase.visualAuditVersion = 3; f.plan.bodyBase.styleResolutionVersion = 2;
  for (const section of f.plan.sections) {
    section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, status: 'required', sourceFactIds: section.sourceFactIds, expected: 'Synthetic source ownership is inspected before model work.', evidence: [evidence] }));
    section.visualTargets = facts.snapshots.flatMap(snapshot => {
      const fact = Object.values(facts.facts).find(row => row.snapshotId === snapshot.id && row.nodeId === section.key && row.kind === 'layout')!;
      const evidence = { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 };
      return [{ kind: 'geometry' as const, sourceFactId: fact.id, rect: fact.value.rect as { x: number; y: number; width: number; height: number }, evidence }, { kind: 'paint' as const, sourceFactId: fact.id, property: 'color' as const, value: '#123456', evidence }];
    });
  }
  const views = [{ width: 390, height: 844 }, { width: 430, height: 932 }], phoneRefs = [];
  for (const view of views) {
    const packet = structuredClone(f.packets[0]);
    packet.snapshot.id = 'phone-' + view.width;
    packet.snapshot.viewport = { name: 'mobile', ...view, clientWidth: view.width, scrollbarWidth: 0, devicePixelRatio: 1 };
    packet.snapshot.pageHeight = view.height;
    packet.snapshot.screenshot = { ...await f.put(`phone-${view.width}.png`, await sharp({ create: { ...view, channels: 3, background: '#abc' } }).png().toBuffer()), ...view };
    packet.interactions.scroll = { id: 'scroll', nodeId: 'header', regionId: 'header', kind: 'navigation', status: 'observed', details: { scrollPolicy: 'fixed', offset: 0, headerFlow: 'reserve-space', contentTop: 100, downScrollY: 1200, upScrollY: 900, topY: 0, downY: 0, upY: 0, menuOpenY: 0 } };
    phoneRefs.push(await f.put(`phone-${view.width}.json`, packet));
  }
  f.plan.responsive = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: views, source: await f.put('phones.json', { version: 1, kind: 'clonewp-responsive-source', taskId: f.plan.taskId, sourceUrl: f.plan.sourceUrl, packets: phoneRefs }), decisions: { version: 1, layouts: [], carousels: [], header: { implementation: 'scoped-css', flow: 'reserve-space', views: views.map(view => ({ ...view, snapshotId: 'phone-' + view.width, nodeId: 'header', interactionId: 'scroll', policy: 'fixed', offset: 0 })) } } };
  return f;
}

test('new v8 dispatch snapshots the guide in body packets and rejects omitted application before completing a job', async () => {
  const f = await modernFixture();
  try {
    native44ProgramSchema.omit({ blocks: true }).parse(f.plan.bodyBase);
    responsiveSourceSchema.parse(f.plan.responsive);
    assert.ok(f.plan.sections.every(section => section.visualTargets?.filter(target => target.kind === 'geometry').every(target => target.kind !== 'geometry' || target.rect)));
    const initial = await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    assert.ok('componentGuidance' in initial);
    assert.ok('componentLearning' in initial);
    const state = await f.readState(), frozen = JSON.parse(await readFile(state.componentGuidance.path, 'utf8'));
    for (const row of state.jobs) {
      const packet = JSON.parse(await readFile(row.packet.path, 'utf8'));
      if (row.job.responsibility === 'header') assert.equal('componentGuidance' in packet, false);
      else {
        assert.equal(packet.componentGuidance.text, frozen.text);
        assert.deepEqual(packet.componentGuidance.snapshot, state.componentGuidance);
        assert.equal(packet.componentGuidance.source.sha256, (await guidance()).source.sha256);
        assert.ok(packet.nativeSettingsCapabilities);
        assert.equal(packet.componentLearning.kind, 'component-learning-hints');
        assert.equal(packet.componentLearning.modelPolicy, 'unified-components-v1');
        assert.equal(packet.componentLearning.policy.defaults, false);
        assert.equal(packet.componentLearning.sourceCount, 4);
        assert.deepEqual(packet.componentLearning.snapshot, state.componentLearning);
      }
    }
    const frozenPlan = JSON.parse(await readFile(state.plan.path,'utf8'));
    assert.deepEqual(frozenPlan.bodyBase.inquiryPolicy,{version:1,kind:'clonewp-inquiry-default',mode:'submit-save-email',testing:'user-managed',exceptions:[]});
    const job = buildPreparationJobs(frozenPlan).find(row => row.responsibility === 'body')!;
    await startPreparationJob(f.preparationDirectory, job.jobId);
    const result: PreparationJobResult = { version: 1, kind: 'clonewp-preparation-result', taskId: job.taskId, runId: job.runId, jobId: job.jobId, contractHash: job.contractHash, sharedHash: job.sharedHash, sections: f.results.find(row => row.jobId === job.jobId)!.sections };
    await assert.rejects(() => completePreparationJob(f.preparationDirectory, job.jobId, path.join(f.preparationDirectory, 'jobs', job.jobId, 'result.json')), /ENOENT/);
    await f.writeResult(job.jobId, result);
    await assert.rejects(() => completePreparationJob(f.preparationDirectory, job.jobId, path.join(f.preparationDirectory, 'jobs', job.jobId, 'result.json')), /component_guidance_review/);
    assert.equal((await preparationStatus(f.preparationDirectory)).jobs.find(row => row.jobId === job.jobId)!.status, 'running');
    await f.writeResult(job.jobId, review(frozen.source.sha256, result));
    const dynamic = structuredClone(result);
    const leaf = dynamic.sections![0].blocks[0];
    leaf.model = { data: { source: 'current-record', recordType: 'product', contextKey: 'currentProduct', field: 'price', evidenceFactIds: [job.sourceFactIds[0]] } };
    await f.writeResult(job.jobId, review(frozen.source.sha256, dynamic));
    await assert.rejects(() => completePreparationJob(f.preparationDirectory, job.jobId, path.join(f.preparationDirectory, 'jobs', job.jobId, 'result.json')), /unified_component_model_gaps/);
    assert.equal((await f.readState()).jobs.find((row: any) => row.job.jobId === job.jobId).status, 'running');
    await f.writeResult(job.jobId, review(frozen.source.sha256, result));
    await completePreparationJob(f.preparationDirectory, job.jobId, path.join(f.preparationDirectory, 'jobs', job.jobId, 'result.json'));
    const before = await f.readState();
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    assert.deepEqual(await f.readState(), before);
    await writeFile(state.componentGuidance.path, JSON.stringify({ ...frozen, text: frozen.text + 'drift' }));
    await assert.rejects(() => preparationStatus(f.preparationDirectory), /file_changed/);
    // Simulate an already-frozen v8 from before this additive packet feature.
    // Its original catalog and contract remain bound; it must not acquire a new obligation.
    const historical = await f.readState(); delete historical.componentGuidance; delete historical.componentLearning;
    for (const row of historical.jobs) {
      const packet = JSON.parse(await readFile(row.packet.path, 'utf8')); delete packet.componentGuidance; delete packet.componentLearning;
      row.packet = await f.put(path.relative(f.directory, row.packet.path), packet);
    }
    await writeFile(path.join(f.preparationDirectory, 'state.json'), JSON.stringify(historical));
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    assert.deepEqual(await f.readState(), historical);
  } finally { await f.cleanup(); }
});

test('historical preparation never acquires a current learning snapshot or application requirement', async () => {
  const f = await preparationIOFixture();
  try {
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    assert.equal('componentGuidance' in await f.readState(), false);
    assert.equal('componentLearning' in await f.readState(), false);
    const job = f.jobs.find(row => row.responsibility === 'body')!;
    await startPreparationJob(f.preparationDirectory, job.jobId);
    await completePreparationJob(f.preparationDirectory, job.jobId, await f.writeResult(job.jobId));
  } finally { await f.cleanup(); }
});

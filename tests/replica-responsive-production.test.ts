import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import { validateObservationPacketV2, observationCountsV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { createPhoneProductionGuide, projectPhoneProductionFacts, verifyPhoneSectionOwners } from '../src/replica-responsive/production.js';
import { readResponsiveSource, verifyResponsiveSections } from '../src/replica-responsive/source.js';
import { buildPreparationJobs, preparationHash, validatePreparationPlan } from '../src/replica-preparation/contract.js';
import { initializePreparation, startPreparationJob, completePreparationJob, mergePreparationDirectory, preparationStatus, comparePreparationPresentation, readPreparationNativeSettings } from '../src/replica-preparation/io.js';
import { BODY_FIDELITY_KINDS } from '../src/replica-preparation/types.js';
import type { Native44Program } from '../src/native44/types.js';
import type { ResponsivePlan, ResponsiveSource } from '../src/replica-responsive/contract.js';
import { validateHeaderModulePlan } from '../src/woodmart-header/generic/contract.js';
import { walkNative44 } from '../src/native44/types.js';
import { prepareActualBody, resolveActualBodyStyles } from '../src/replica-full/body-prepare.js';
import { responsiveOwnedHeaderDecisionSchema } from '../src/replica-responsive/decisions.js';

async function fixture() {
  const base = await preparationIOFixture();
  const packets = base.packets.map(packet => {
    const copy = structuredClone(packet);
    copy.styles.style = { color: '#123', 'font-size': '20px', 'font-weight': '400' };
    return copy;
  });
  const refs = await Promise.all(packets.map(packet => base.put(`${packet.snapshot.id}-updated.json`, packet)));
  const desktop = buildSourceFactsV2({ manifestPath: base.facts.path, manifestSha256: base.facts.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: base.plan.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets, packetFiles: refs.map((ref, index) => ({ ...ref, snapshotId: packets[index].snapshot.id })) });
  const phones: ObservationPacketV2[] = [];
  for (const view of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const packet = structuredClone(packets[0]);
    const screenshot = await base.put(`phone-${view.width}.png`, await sharp({ create: { ...view, channels: 3, background: '#abc' } }).png().toBuffer());
    packet.snapshot.id = `phone-${view.width}`;
    packet.snapshot.viewport = { ...view, name: `handset-${view.width}`, clientWidth: view.width, scrollbarWidth: 0, devicePixelRatio: 1 };
    packet.snapshot.screenshot = { ...screenshot, path: path.basename(screenshot.path), ...view };
    packet.snapshot.pageHeight = view.height;
    const owner = packet.nodes.hero;
    owner.childIds = ['photo', 'hero-text'];
    packet.nodes.photo = { ...packet.nodes['hero-text'], id: 'photo', tag: 'IMG', selector: '#photo', layoutId: 'photo', childIds: [] };
    packet.nodes.photo.styleId = 'photo';
    packet.styles.photo = { 'object-fit': 'cover', 'object-position': '50% 20%' };
    packet.layouts.photo = { ...packet.layouts[owner.layoutId], id: 'photo', rect: { x: 0, y: 100, width: 180, height: 100 }, contentRect: { x: 0, y: 100, width: 180, height: 100 } };
    const textLayout = packet.layouts[packet.nodes['hero-text'].layoutId];
    textLayout.rect = { x: view.width === 390 ? 0 : 210, y: view.width === 390 ? 220 : 100, width: 180, height: 100 };
    textLayout.contentRect = { ...textLayout.rect };
    packet.resources.photo = { id: 'photo', url: 'https://source.example/photo.jpg', kind: 'image' };
    packet.usages.photo = { id: 'photo', nodeId: 'photo', regionId: 'hero', resourceId: 'photo', kind: 'img', visible: true };
    packet.nodes.answer = { ...packet.nodes['faq-text'], id: 'answer', selector: '#answer', visible: false, childIds: [] };
    packet.nodes.faq.childIds.push('answer');
    packet.texts.answer = { id: 'answer', nodeId: 'answer', regionId: 'faq', text: 'The complete hidden answer', kind: 'body' };
    packet.interactions.faq = { id: 'faq', nodeId: 'faq', regionId: 'faq', kind: 'control', status: 'unobserved', details: { type: 'accordion' }, itemNodeIds: ['faq-text', 'answer'], controlNodeIds: ['faq-text'] };
    packet.interactions.scroll = { id: 'scroll', nodeId: 'header', regionId: 'header', kind: 'navigation', status: 'observed', details: { scrollPolicy: 'fixed', headerFlow: 'reserve-space', contentTop: 100, offset: 0, topY: 0, downY: 0, upY: 0, menuOpenY: 0, downScrollY: 1100, upScrollY: 900 } };
    phones.push(validateObservationPacketV2(packet));
  }
  const phoneRefs = await Promise.all(phones.map(packet => base.put(`${packet.snapshot.id}.json`, packet)));
  const sourceRef = await base.put('phones.json', { version: 1, kind: 'clonewp-responsive-source', taskId: base.plan.taskId, sourceUrl: base.plan.sourceUrl, packets: phoneRefs });
  const policy: ResponsiveSource = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, source: sourceRef, viewports: phones.map(packet => ({ width: packet.snapshot.viewport.width, height: packet.snapshot.viewport.height })), decisions: { version: 1, layouts: [], carousels: [], header: { implementation: 'native', flow: 'reserve-space', views: phones.map(packet => ({ snapshotId: packet.snapshot.id, nodeId: 'header', interactionId: 'scroll', width: packet.snapshot.viewport.width, height: packet.snapshot.viewport.height, policy: 'fixed', offset: 0 })) } } };
  const read = async (ref: { path: string; sha256: string }, root = base.directory) => {
    const filename = path.resolve(root, ref.path), bytes = await readFile(filename);
    return { filename, bytes };
  };
  const verified = await readResponsiveSource(policy, base.plan, read);
  const source = projectPhoneProductionFacts(desktop, packets, refs.map((ref, index) => ({ ...ref, snapshotId: packets[index].snapshot.id })), verified);
  const sections = base.plan.sections.map(section => ({ ...section, phoneSourceOwners: phones.map(packet => ({ snapshotId: packet.snapshot.id, nodeId: section.key })) }));
  const program = { ...base.plan.bodyBase, blocks: base.results.flatMap(result => result.sections?.flatMap(section => section.blocks) ?? []) } as Native44Program;
  const responsive: ResponsivePlan = { ...policy, sections: sections.map(section => ({ key: section.key, mode: 'shared', reason: 'Actual phone source owns this complete functional region.', evidence: section.phoneSourceOwners, settings: [{ componentKey: section.key, values: { flex_direction_mobile: 'column' } }], childOrders: [], css: '', contentBindings: phones.map(packet => ({ snapshotId: packet.snapshot.id, nodeId: `${section.key}-text`, componentKey: `${section.key}_title` })) })) };
  return { ...base, packets, refs, desktop, phones, source, policy, sections, program, responsive, read };
}

test('verified phone packets reach planning with their actual widths, images, hidden content and state owners', async () => {
  const f = await fixture(); try {
    const original = preparationHash(f.plan);
    const guide = createPhoneProductionGuide(f.source, f.sections, f.policy, undefined, f.phones);
    const hero = guide.sections[0], faq = guide.sections[1];
    assert.equal(hero.viewports.length, 2);
    assert.deepEqual(hero.viewports.map(view => view.viewport.width), [390, 430]);
    assert.deepEqual(hero.relationships.viewports.map(view => view.groups.find(group => group.nodeId === 'hero')?.arrangement), ['column', 'row']);
    assert.equal(hero.sourceFacts['phone-390:media:photo'].value.resource && (hero.sourceFacts['phone-390:media:photo'].value.resource as { url: string }).url, 'https://source.example/photo.jpg');
    assert.equal(faq.sourceFacts['phone-390:text:answer'].value.text, 'The complete hidden answer');
    assert.equal(faq.relationships.viewports[0].states[0].status, 'unobserved');
    assert.equal(guide.rendered, 'not-verified');
    assert.equal(hero.sourceNodeDetails.find(node => node.nodeId === 'photo')?.paint['object-fit'], 'cover');
    assert.equal(guide.snapshots.every(snapshot => path.isAbsolute(snapshot.screenshot.path)), true);
    assert.equal(preparationHash(f.plan), original);
    assert.doesNotThrow(() => preparationHash(guide));
  } finally { await f.cleanup(); }
});

test('authoring guide applies existing mobile patches locally, retains tablet and desktop, and reports unmapped phone content', async () => {
  const f = await fixture(); try {
    const original = preparationHash(f.program);
    const guide = createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: f.responsive, program: f.program, css: '' });
    assert.equal(guide.sections[0].relationships.nativeTree[0].settings.flex_direction_mobile, 'column');
    assert.equal(guide.sections[0].contentCoverage.find(row => row.sourceFactId === 'phone-390:text:hero')?.assignment, 'assigned-not-render-verified');
    assert.equal(guide.sections[0].contentCoverage.find(row => row.sourceFactId === 'phone-390:media:photo')?.assignment, 'unmapped');
    assert.equal(guide.sections[0].diagnostics.some(row => row.snapshotId === 'phone-430' && row.code === 'section-relationship-unmapped'), true);
    if (f.program.blocks[0].kind === 'composite') f.program.blocks[0].children.push({ kind: 'native', key: 'hero_photo', widgetType: 'wd_image_or_svg', widgetSettings: {} });
    f.responsive.sections[0].contentBindings!.push(...f.phones.map(packet => ({ snapshotId: packet.snapshot.id, nodeId: 'photo', componentKey: 'hero_photo' })));
    const mapped = createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: f.responsive, program: f.program, css: '' });
    assert.equal(mapped.sections[0].diagnostics.some(row => row.snapshotId === 'phone-430' && row.code === 'section-arrangement-needs-decision'), true);
    assert.equal(mapped.sections[0].diagnostics.some(row => row.snapshotId === 'phone-390' && row.code === 'section-arrangement-needs-decision'), false);
    assert.equal(preparationHash({ ...f.program, blocks: f.program.blocks.map(block => block.kind === 'composite' ? { ...block, children: block.children.filter(child => child.key !== 'hero_photo') } : block) }), original);
    assert.equal('flex_direction_mobile' in (f.program.blocks[0].settings ?? {}), false);
  } finally { await f.cleanup(); }
});

test('ownership is explicit, nonblocking when absent, and rejects unknown, header and overlapping sections', async () => {
  const f = await fixture(); try {
    const absent = f.sections.map(section => ({ ...section, phoneSourceOwners: undefined }));
    assert.equal(createPhoneProductionGuide(f.source, absent, f.policy).issues.filter(issue => issue.code === 'phone-section-owner-unresolved').length, 4);
    f.source.snapshots.find(snapshot => snapshot.id === 'phone-390')!.nodes['hero-text'].tag = 'header';
    assert.doesNotThrow(() => verifyPhoneSectionOwners(f.source, f.sections, f.policy));
    for (const nodeId of ['unknown', 'header']) {
      const sections = structuredClone(f.sections); sections[0].phoneSourceOwners[0].nodeId = nodeId;
      assert.throws(() => verifyPhoneSectionOwners(f.source, sections, f.policy), /production_(section_owner|body_contains_header)/);
    }
    const overlap = structuredClone(f.sections); overlap[1].phoneSourceOwners[0].nodeId = 'hero-text';
    assert.throws(() => verifyPhoneSectionOwners(f.source, overlap, f.policy), /production_section_overlap/);
  } finally { await f.cleanup(); }
});

test('source content bindings cannot cross sections or target another component', async () => {
  const f = await fixture(); try {
    f.responsive.sections[0].contentBindings![0].nodeId = 'faq-text';
    await assert.rejects(() => verifyResponsiveSections(f.responsive, f.plan, f.read), /production_content_binding_scope/);
    assert.throws(() => createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: f.responsive, program: f.program, css: '' }), /production_content_binding_scope/);
    f.responsive.sections[0].contentBindings![0].nodeId = 'hero-text';
    f.responsive.sections[0].contentBindings![0].componentKey = 'faq_title';
    assert.throws(() => createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: f.responsive, program: f.program, css: '' }), /production_content_binding_scope/);
  } finally { await f.cleanup(); }
});

test('a static phone duplicate uses its real remapped container without changing source text', async () => {
  const f = await fixture(); try {
    f.responsive.sections[0].mode = 'duplicate';
    const guide = createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: f.responsive, program: f.program, css: '' });
    assert.equal(guide.sections[0].targetRootComponentKey, 'hero_phone');
    assert.equal(guide.sections[0].relationships.rootComponentKey, 'hero_phone');
    assert.equal(guide.sections[0].viewports[0].requirements.find(row => row.sourceFactId === 'phone-390:text:hero')?.targets[0].key, 'hero_title_phone');
    assert.equal(f.program.blocks[0].key, 'hero');
  } finally { await f.cleanup(); }
});

test('assigning all phone content to an outer wrapper does not prove leaf implementation', async () => {
  const f = await fixture(); try {
    f.responsive.sections[0].contentBindings = f.sections[0].phoneSourceOwners.map(owner => ({ ...owner, componentKey: 'hero' }));
    const guide = createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: f.responsive, program: f.program, css: '' });
    assert.equal(guide.sections[0].contentCoverage.every(row => row.assignment === 'unmapped'), true);
    const changed = structuredClone(f.responsive);
    changed.sections[0].evidence[1].nodeId = 'hero-text';
    assert.equal(createPhoneProductionGuide(f.source, f.sections, f.policy, { plan: changed, program: f.program, css: '' }).issues.some(issue => issue.code === 'phone-authored-owner-differs' && issue.snapshotId === 'phone-430'), true);
  } finally { await f.cleanup(); }
});

for (const version of [6, 7, 8] as const) test(`preparation v${version} dispatch and merge persist phone relationships and executable style decisions`, async () => {
  const f = await fixture(); try {
    f.plan.targetOrigin = 'https://8.8.4.4';
    f.plan.headerBase!.targetOrigin = f.plan.targetOrigin;
    const desktopEvidence = await f.put('desktop-evidence.json', { version: 1, kind: 'native44-body-source-evidence', taskId: f.plan.taskId, sourceUrl: f.plan.sourceUrl, snapshots: f.packets.map((packet, index) => ({ id: packet.snapshot.id, viewport: packet.snapshot.viewport, packets: [f.refs[index]] })) });
    const desktop = buildSourceFactsV2({ manifestPath: desktopEvidence.path, manifestSha256: desktopEvidence.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: f.plan.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets: f.packets, packetFiles: f.refs.map((ref, index) => ({ ...ref, snapshotId: f.packets[index].snapshot.id })) });
    const sourceFacts = await f.put('desktop-facts.json', desktop);
    f.plan.sourceEvidence = desktopEvidence; f.plan.sourceFacts = sourceFacts; f.plan.bodyBase.sourceFacts = sourceFacts;
    f.plan.version = version; f.plan.bodyBase.visualAuditVersion = 3; f.plan.responsive = f.policy;
    f.plan.headerBase!.layout.mobile = { version: 2, tablet: 'desktop', mobileMaxWidth: 768, css: '', scroll: responsiveOwnedHeaderDecisionSchema.parse(f.policy.decisions!.header), rows: [{ slot: 'general-header', params: {}, columns: { left: [{ key: 'phone-logo', type: 'logo', params: { image: { $media: 'logo' } } }], center: [], right: [{ key: 'phone-nav', type: 'mainmenu', menuKey: 'main', params: { style: 'icon', full_screen: true } }] } }] };
    f.plan.sections = f.sections.map(section => ({ ...section,
      fidelity: BODY_FIDELITY_KINDS.map(kind => ({ kind, status: 'required', sourceFactIds: section.sourceFactIds, expected: `Actual source ${kind} is retained for this section.`, evidence: [desktopEvidence] })),
      visualTargets: desktop.snapshots.flatMap(snapshot => { const fact = section.sourceFactIds.map(id => desktop.facts[id]).find(fact => fact.snapshotId === snapshot.id && fact.kind === 'layout')!, evidence = { path: snapshot.screenshot.path, sha256: snapshot.screenshot.sha256 }; return [{ kind: 'geometry' as const, sourceFactId: fact.id, rect: fact.value.rect as { x: number; y: number; width: number; height: number }, evidence }, { kind: 'paint' as const, sourceFactId: fact.id, property: 'color' as const, value: '#123', evidence }]; }),
    }));
    validateHeaderModulePlan(f.plan.headerBase);
    if (version === 8) {
      const { version: _version, ...unversioned } = f.plan;
      assert.equal(validatePreparationPlan(unversioned).version, 8);
    }
    await initializePreparation(f.plan, { finalRunDirectory: f.finalRunDirectory });
    const frozenPlan = JSON.parse(await readFile((await f.readState()).plan.path, 'utf8'));
    const jobs = buildPreparationJobs(frozenPlan);
    for (const job of jobs) {
      await startPreparationJob(f.preparationDirectory, job.jobId);
      const filename = path.join(f.preparationDirectory, 'jobs', job.jobId, 'packet.json');
      const packet = JSON.parse(await readFile(filename, 'utf8'));
      if (job.responsibility === 'body') assert.equal(packet.productionGuide.mobile.snapshots.length, 2);
      if (version === 7 && job.responsibility === 'body') assert.equal(packet.styleAuthoringContract.version, 1);
      if (version === 8 && job.responsibility === 'body') {
        assert.equal(packet.styleAuthoringContract.version, 2);
        assert.equal(packet.nativeSettingsCapabilities.widgetTypes.length, 44);
        assert.deepEqual(packet.productionGuide.nativeSettingsCapabilities, packet.nativeSettingsCapabilities.catalog);
        const capabilities = JSON.parse(await readFile(packet.nativeSettingsCapabilities.catalog.path, 'utf8'));
        assert.equal(capabilities.coverage.complete44, true);
        assert.ok(capabilities.variableConsumers.length > 0);
        for (const widgetType of ['heading', 'container']) {
          assert.ok(capabilities.wrapperClassesByType[widgetType].length > 0);
          assert.ok(capabilities.wrapperClassesByType[widgetType].every((proof: { packageSha256: string; sourceSha256: string }) => /^[a-f0-9]{64}$/.test(proof.packageSha256) && /^[a-f0-9]{64}$/.test(proof.sourceSha256)));
        }
        const type = await readPreparationNativeSettings(f.preparationDirectory, 'heading');
        assert.equal(type.remoteWrites, 0);
        assert.equal(type.component.componentType, 'heading');
        assert.ok(type.controls.some(control => control.controlId === 'title_color' && control.nativeStyleEligible));
        assert.deepEqual(type.wrapperClasses, capabilities.wrapperClassesByType.heading);
      }
      const result = structuredClone(f.results.find(row => row.jobId === job.jobId)!);
      if (job.responsibility === 'body') result.sections = structuredClone(f.results.flatMap(row => row.sections ?? []).filter(section => job.sectionKeys.includes(section.key)));
      result.contractHash = job.contractHash; result.sharedHash = job.sharedHash;
      if (result.header) {
        result.header = structuredClone(packet.headerBase);
        if (version === 8) assert.deepEqual(result.header!.menuBindingPolicy,{version:1,editorReview:'desktop-and-mobile-reopen'});
        else assert.equal(result.header!.menuBindingPolicy,undefined);
      }
      for (const section of result.sections ?? []) { section.responsive = f.responsive.sections.find(row => row.key === section.key); section.fidelity = BODY_FIDELITY_KINDS.map(kind => ({ kind, componentKeys: [section.key], mechanism: 'native', implementation: 'Complete source fields are assigned to the owned native subtree.' })); }
      if (version >= 7) for (const section of result.sections ?? []) {
        const leaf = walkNative44(section.blocks).find(node => node.key === `${section.key}_title`)!;
        const fact = Object.values(desktop.facts).find(row => row.kind === 'text' && row.nodeId === `${section.key}-text`)!;
        leaf.styleBindings = [{ sourceFactId: fact.id, selector: ' .elementor-heading-title', minWidth: 769, maxWidth: 10000, properties: ['color'] }];
        const phoneFact = Object.values(f.source.facts).find(row => row.snapshotId === 'phone-390' && row.kind === 'text' && row.nodeId === `${section.key}-text`)!;
        section.responsive!.styleBindings = [{ componentKey: leaf.key, binding: { sourceFactId: phoneFact.id, selector: ' .elementor-heading-title', minWidth: 1, maxWidth: 768, properties: ['color'] } }];
        if (version === 8) {
          leaf.nativeStyleSettings = [
            { controlId: 'title_color', value: '#123', minWidth: 769, maxWidth: 10000, sourceFactIds: [fact.id], reason: 'The source heading color is assigned to its native title control.' },
            { controlId: 'typography_typography', value: 'custom', minWidth: 769, maxWidth: 10000, sourceFactIds: [fact.id], reason: 'The source typography requires the component native typography group.' },
          ];
          section.responsive!.nativeStyleSettings = [{ componentKey: leaf.key, setting: { controlId: 'typography_font_size_mobile', value: { size: 20, unit: 'px' }, minWidth: 1, maxWidth: 768, sourceFactIds: [phoneFact.id], reason: 'Phone text uses the observed font size through its real responsive control.' } }];
        }
      }
      if (version === 8 && job.responsibility === 'body') result.componentGuidanceReview = {
        guideSha256: packet.componentGuidance.source.sha256,
        decisions: result.sections!.map(section => ({
          sectionKey: section.key, principleSections: [1, 3, 4], componentKeys: [section.key, `${section.key}_title`],
          compositionReason: 'The current source groups its editable heading and content inside one principal section.',
          settingsReason: 'Current source color and typography use native controls with their real group prerequisites.',
          phoneReason: 'The same content uses source-bound phone container direction and native typography overrides.',
          phoneMode: section.responsive!.mode,
        })),
      };
      await completePreparationJob(f.preparationDirectory, job.jobId, await f.writeResult(job.jobId, result));
    }
    const merged = await mergePreparationDirectory(f.preparationDirectory);
    assert.ok(merged.productionGuide);
    const guide = JSON.parse(await readFile(merged.productionGuide!.path, 'utf8'));
    assert.equal(guide.mobile.sections[0].relationships.nativeTree[0].settings.flex_direction_mobile, 'column');
    assert.equal(guide.mobile.sections[0].sourceFacts['phone-390:media:photo'].value.visible, true);
    assert.equal(guide.mobile.sections[0].sourceNodeDetails.find((node: { nodeId: string }) => node.nodeId === 'photo').paint['object-position'], '50% 20%');
    assert.equal(guide.mobile.rendered, 'not-verified');
    const stored = JSON.parse(await readFile(merged.manifest.path, 'utf8'));
    if (version === 7) {
      const stylePlan = JSON.parse(await readFile(path.join(path.dirname(stored.body.program.path), 'style-production-plan.json'), 'utf8'));
      assert.equal(stylePlan.requirements.length > 0, true);
      assert.equal(stylePlan.components.some((node: any) => node.effects.length > 0), true);
      assert.equal(stylePlan.phoneBindings.length > 0, true);
      assert.equal(stylePlan.targetRegistrationVerified, false);
      const prepared = await prepareActualBody(stored), resolved = resolveActualBodyStyles(prepared, {});
      assert.equal(resolved.program.styleResolutionVersion, 1);
      assert.ok(resolved.receipts.some(row => row.action === 'scoped-css' && row.minWidth === 1 && row.maxWidth === 768));
      assert.ok(resolved.receipts.some(row => row.action === 'scoped-css' && row.minWidth === 769));
      assert.equal(resolved.renderedVerified, false);
    }
    if (version === 8) {
      const application = JSON.parse(await readFile(guide.componentGuidance.application.path, 'utf8'));
      assert.deepEqual(application.snapshot, guide.componentGuidance.snapshot);
      const decisions = application.applications.flatMap((row: any) => row.decisions);
      assert.equal(decisions.length, f.plan.sections.length);
      assert.ok(decisions.every((row: any) => row.phoneMode === 'shared'));
      assert.ok(decisions.some((row: any) => row.actualPlan.components.some((node: any) => node.nativeSettingControls.includes('title_color'))));
      assert.ok(decisions.some((row: any) => row.actualPlan.phoneNativeSettingControls.some((setting: any) => setting.controlId === 'typography_font_size_mobile')));
      const stylePlan = JSON.parse(await readFile(path.join(path.dirname(stored.body.program.path), 'style-production-plan.json'), 'utf8'));
      assert.equal(stylePlan.version, 2);
      assert.ok(stylePlan.requirements.some((row: any) => row.snapshotId === 'phone-390'));
      assert.ok(stylePlan.nativeSettingPlans.some((row: any) => row.controlId === 'title_color'));
      assert.ok(stylePlan.nativeSettingPlans.some((row: any) => row.controlId === 'typography_font_size_mobile'));
      assert.equal(new Set(stylePlan.components.map((row: any) => row.widgetType)).size, Object.keys(stylePlan.effectCatalog).length);
      const rawProgram = JSON.parse(await readFile(stored.body.program.path, 'utf8'));
      assert.equal(rawProgram.componentModelPolicy, 'unified-components-v1');
      assert.deepEqual(rawProgram.componentLearning, guide.componentModel.learning);
      const frozenLearning = await readFile(rawProgram.componentLearning.path);
      await writeFile(rawProgram.componentLearning.path, Buffer.concat([frozenLearning, Buffer.from(' ')]));
      await assert.rejects(() => prepareActualBody(stored), /input_hash_changed/);
      await writeFile(rawProgram.componentLearning.path, frozenLearning);
      const model = JSON.parse(await readFile(guide.componentModel.report.path, 'utf8'));
      assert.equal(model.execution, 'existing-native44-compiler');
      assert.equal(model.executable, true);
      assert.equal(model.renderedVerified, false);
      assert.ok(model.components.some((node: any) => node.settings.nativeControls.includes('title_color')));
      assert.ok(model.components.some((node: any) => node.phone?.nativeControls.includes('typography_font_size_mobile')));
      assert.deepEqual((await preparationStatus(f.preparationDirectory)).componentModel, guide.componentModel.report);
      assert.equal(rawProgram.styleResolutionVersion, 2);
      assert.deepEqual(rawProgram.styleCapabilities, guide.nativeSettingsCapabilities);
      assert.equal(stylePlan.renderedVerified, false);
      const prepared = await prepareActualBody(stored);
      const resolved = resolveActualBodyStyles(prepared, { heading: { type: 'heading', class: 'Heading', controls: {
        title: { type: 'textarea' },
        title_color: { type: 'color', selectors: { '{{WRAPPER}} .elementor-heading-title': 'color: {{VALUE}};' } },
        typography_typography: { type: 'popover_toggle', return_value: 'custom' },
        typography_font_size_mobile: { type: 'slider', responsive: true, size_units: ['px'], selectors: { '{{WRAPPER}} .elementor-heading-title': 'font-size: {{SIZE}}{{UNIT}};' } },
      } } });
      assert.ok(resolved.receipts.some(row => row.action === 'native-setting' && row.controlId === 'title_color'), JSON.stringify(resolved.receipts));
      assert.ok(walkNative44(resolved.program.blocks).some(node => node.kind === 'native' && node.widgetType === 'heading' && node.widgetSettings.title_color === '#123'));
      assert.ok(resolved.receipts.some(row => row.action === 'native-setting' && row.controlId === 'typography_font_size_mobile'));
      assert.equal(resolved.renderedVerified, false);
    }
    assert.equal(stored.responsive.sections[0].contentBindings.length, 2);
    assert.deepEqual((await preparationStatus(f.preparationDirectory)).productionGuide, merged.productionGuide);
    assert.equal(guide.version, 3);
    assert.ok(guide.mobile.sections[0].viewports[0].requirements[0].presentation.spacing);
    const targets = f.packets.map(packet => ({ ...packet, snapshot: { ...packet.snapshot, url: f.plan.targetOrigin + '/' }, texts: Object.fromEntries(Object.entries(packet.texts).map(([id, text]) => [id, { ...text, text: text.text + ' synthetic public page description' }])) }));
    const targetRefs = await Promise.all(targets.map(packet => f.put(`target-${packet.snapshot.id}.json`, packet)));
    const observation = await f.put('target-observation.json', { version: 2, kind: 'observation-manifest', sourceUrl: f.plan.targetOrigin + '/', provenance: { method: 'public-capture', observer: 'playwright', browser: 'chromium' }, packets: targetRefs.map((ref, index) => ({ ...ref, snapshotId: targets[index].snapshot.id, regionIds: targets[index].regions.map(region => region.id), counts: observationCountsV2(targets[index]), dependencies: [] })), screenshots: targets.map(packet => ({ path: packet.snapshot.screenshot.path, sha256: packet.snapshot.screenshot.sha256, snapshotId: packet.snapshot.id })) });
    const evidence = await f.put('presentation-review.json', { version: 1, kind: 'production-presentation-review', taskId: f.plan.taskId, runId: f.plan.runId, targetObservation: observation, bindings: [] });
    const beforeReview = await f.readState();
    const review = await comparePreparationPresentation(f.preparationDirectory, evidence.path);
    assert.equal(review.status, 'open-items');
    assert.equal(review.remoteWrites, 0);
    assert.equal(review.deliveryComplete, false);
    assert.ok(review.findings.some(row => row.sourceFactId.startsWith('phone-390:') && row.field === 'unmapped-target'));
    assert.deepEqual(await f.readState(), beforeReview);
    const changed = await f.put('presentation-wrong-hash.json', { version: 1, kind: 'production-presentation-review', taskId: f.plan.taskId, runId: f.plan.runId, targetObservation: { ...observation, sha256: '0'.repeat(64) }, bindings: [] });
    await assert.rejects(() => comparePreparationPresentation(f.preparationDirectory, changed.path), /file_changed/);
    if (version === 8) {
      await writeFile(guide.nativeSettingsCapabilities.path, '{}');
      await assert.rejects(() => readPreparationNativeSettings(f.preparationDirectory, 'heading'), /file_changed/);
    }
  } finally { await f.cleanup(); }
});

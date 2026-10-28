import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { assertCreationTaskMode } from '../core/creation-mode.js';
import { resolveFinalDeliveryPolicy } from '../core/delivery-policy.js';
import { validateSourceFactsV2, verifySourceFactsEvidenceV2 } from '../replica-v2/source.js';
import { validateComponentPlanV2 } from '../replica-v2/component-plan.js';
import { canonicalV2, hashV2 } from '../replica-v2/journal.js';
import { assertSafeSVGBytesV2, validateAssetBytesV2 } from '../assets/validation.js';
import { loadNative44Knowledge, native44KnowledgeIdentity } from './knowledge.js';
import { referencedNative44Assets, usedNative44WidgetTypes } from './compiler.js';
import { NATIVE44_NATIVE_EDITOR_NAMING, NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW, NATIVE44_ARTICLE_LIST_POLICY, walkNative44 } from './types.js';
import { validateNative44Program } from './validate.js';
import type { Native44Asset } from './media.js';
import { assertNative44SourceBindings } from './source-bindings.js';
import { isDesktopBrowserProfile } from './profile.js';
import { validateDesktopComponentPlan, validateNative44Selection, native44RegisteredSchemaHashMatches } from './selection.js';
import { readNative44JobReleaseLock } from './release-lock.js';
import { assertNative44CatalogOmissionScope } from './selection-rules.js';
import { NATIVE44_REQUIREMENT_PROFILE, Native44RequirementProfileSchema, validateNative44Requirements, assertNative44CapabilityProof, verifyNative44SourceScopes, type Native44GoalProfile } from './requirements.js';
import { assertComponentModelSource } from './component-model.js';

const within = (root: string, filename: string) => { const relative = path.relative(root, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('native44 input escaped the project'); };
async function readRef(root: string, jobDir: string, ref: { path: string; sha256: string }): Promise<Buffer> {
  const filename = await realpath(path.resolve(jobDir, ref.path)); within(root, filename);
  const bytes = await readFile(filename); if (hashV2(bytes) !== ref.sha256) throw Error(`native44 immutable input hash mismatch: ${path.basename(filename)}`); return bytes;
}
/** All local evidence, resource bytes and renderer decisions precede authentication. */
export async function prepareLocalTask(filename: string, projectRoot: string, options: { allowRequirementGaps?: true; reviewDraft?: true } = {}) {
  const validationStarted = performance.now();
  const root = await realpath(projectRoot), actual = await realpath(path.resolve(root, filename)); within(root, actual);
  const bytes = await readFile(actual), program = validateNative44Program(JSON.parse(bytes.toString('utf8'))), jobDir = path.dirname(actual);
  if (path.dirname(jobDir).toLowerCase() !== path.join(root, 'references').toLowerCase()) throw Error('New native44 programs require an isolated references/<taskId> job');
  // Freeze new defaults in the task marker, never infer them for older jobs.
  // Reject omissions and unknown policies before expensive evidence or auth.
  try {
    const markerPath = await realpath(path.join(jobDir, 'job.json')); within(jobDir, markerPath);
    const info = await stat(markerPath); if (!info.isFile() || info.size > 1_048_576) throw Error('Task marker must be a bounded regular JSON file');
    const marker = JSON.parse((await readFile(markerPath, 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>;
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw Error('Invalid creation task marker');
    for (const [key, policy] of [['editorNaming', NATIVE44_NATIVE_EDITOR_NAMING], ['reviewWorkflow', NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW], ['articleListPolicy', NATIVE44_ARTICLE_LIST_POLICY]] as const) {
      if (marker[key] !== undefined && marker[key] !== policy || marker[key] !== program[key]) throw Error(`native44_${key}_policy_conflict: task marker and program must retain the same explicit policy`);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // Only newly prepared jobs carry this marker. Existing frozen jobs are not
  // changed merely because the current executable learned a stricter contract.
  let requirementProfile: typeof NATIVE44_REQUIREMENT_PROFILE | undefined;
  let goalProfile: Native44GoalProfile | undefined;
  try {
    const markerPath = await realpath(path.join(jobDir, 'requirement-profile.json')); within(jobDir, markerPath);
    const marker = Native44RequirementProfileSchema.parse(JSON.parse(await readFile(markerPath, 'utf8')));
    requirementProfile = marker.profile; if (marker.version === 2) goalProfile = marker.goalProfile;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (requirementProfile && program.requirementProfile !== requirementProfile) throw Error('native44_requirement_contract_required: newly prepared job requires source-requirements-v1 before authentication');
  if (goalProfile && program.goalProfile !== goalProfile) throw Error('native44_goal_profile_required: newly prepared job requires component-reference-v1 before authentication');
  const identity = await native44KnowledgeIdentity(root);
  for (const key of ['componentCatalog', 'knowledge', 'targetEnvironment'] as const) if (canonicalV2(program[key]) !== canonicalV2(identity[key])) throw Error(`native44 program ${key} differs from the current frozen knowledge identity`);
  await readRef(root, jobDir, program.componentCatalog); await readRef(root, jobDir, program.knowledge);
  if (program.componentLearning) await readRef(root, jobDir, program.componentLearning);
  const factsBytes = await readRef(jobDir, jobDir, program.sourceFacts), planBytes = await readRef(jobDir, jobDir, program.componentPlan), manifestBytes = await readRef(jobDir, jobDir, program.assetsManifest);
  const sourceFacts = validateSourceFactsV2(JSON.parse(factsBytes.toString('utf8')));
  assertComponentModelSource(program, sourceFacts);
  if (sourceFacts.sourceUrl !== program.sourceUrl) throw Error('native44 source URL differs from evidence');
  for (const ref of [sourceFacts.observation, ...sourceFacts.snapshots.flatMap(snapshot => [snapshot.screenshot, ...snapshot.evidence]), ...(sourceFacts.sceneInventories ?? [])]) await readRef(jobDir, jobDir, ref);
  const sceneInventories = await verifySourceFactsEvidenceV2(sourceFacts);
  const componentPlan = isDesktopBrowserProfile(program.replicationProfile)
    ? validateDesktopComponentPlan(JSON.parse(planBytes.toString('utf8')), sourceFacts, { sceneInventories })
    : validateComponentPlanV2(JSON.parse(planBytes.toString('utf8')), sourceFacts, { stage: 'final', sceneInventories });
  if (componentPlan.sourceFacts.sha256 !== program.sourceFacts.sha256) throw Error('native44 plan identifies different source facts');
  if (!!program.requirementProfile !== !!componentPlan.requirementContract) throw Error('native44_requirement_profile_conflict: program and plan must explicitly opt into the same source requirements contract');
  if (componentPlan.requirementContract && componentPlan.requirementContract.taskId !== program.taskId) throw Error('native44 requirements belong to another task');
  if (program.goalProfile !== componentPlan.requirementContract?.goalProfile) throw Error('native44_goal_profile_conflict: program and requirement contract must explicitly agree');
  const sourceScopes = componentPlan.requirementContract?.sourceScopes ? await verifyNative44SourceScopes(componentPlan.requirementContract, sourceFacts, reference => readRef(root, jobDir, reference)) : undefined;
  const requirementValidation = componentPlan.requirementContract ? validateNative44Requirements(componentPlan.requirementContract, { source: sourceFacts, sourceUnits: componentPlan.sourceUnits!, components: program.blocks, sourceFactsHash: program.sourceFacts.sha256, sourceScopes }) : undefined;
  if (requirementValidation) {
    for (const requirement of requirementValidation.contract.requirements) {
      if (requirement.fulfillment.route === 'gap') continue;
      const proof = assertNative44CapabilityProof(requirement, JSON.parse((await readRef(root, jobDir, requirement.fulfillment.proof)).toString('utf8')), program.blocks);
      for (const ref of [...proof.evidence, ...(requirement.fulfillment.route === 'explicit-adaptation' ? requirement.fulfillment.sourceEvidence : [])]) await readRef(root, jobDir, ref);
    }
    if (!options.allowRequirementGaps && !options.reviewDraft && !requirementValidation.coverage.draftReady) throw Error(`native44_required_capability_gaps: ${requirementValidation.coverage.gaps.filter(gap => gap.blockingForDraft).map(gap => `${gap.gapId} (${gap.sourceKey})`).join(', ')}`);
  }
  for (const item of componentPlan.catalogDeferrals ?? []) {
    const scope = JSON.parse((await readRef(jobDir, jobDir, item.scope)).toString('utf8'));
    assertNative44CatalogOmissionScope(scope, program.taskId, item);
  }
  const all = walkNative44(program.blocks), components = new Map(all.map(component => [component.key, component]));
  const roots = componentPlan.components.filter(component => component.parentId === null);
  if (roots.length !== program.blocks.length || roots.some((component, index) => component.id !== program.blocks[index].key) || components.size !== componentPlan.components.length) throw Error('native44 ordered component tree differs from the authored plan');
  if (isDesktopBrowserProfile(program.replicationProfile)) {
    const parents = new Map<string, string | null>();
    const visit = (nodes: typeof program.blocks, parent: string | null): void => {
      for (const node of nodes) {
        parents.set(node.key, parent);
        const children = node.kind === 'composite' || node.kind === 'native' ? node.children ?? [] : node.kind === 'native-carousel' ? node.slides ?? [] : [];
        const planned = componentPlan.components.filter(component => component.parentId === node.key).map(component => component.id);
        if (canonicalV2(children.map(child => child.key)) !== canonicalV2(planned)) throw Error(`Desktop component child order differs from the authored plan: ${node.key}`);
        visit(children, node.key);
      }
    };
    visit(program.blocks, null);
    if (componentPlan.components.some(component => parents.get(component.id) !== component.parentId)) throw Error('Desktop component parent ownership differs from the authored plan');
  }
  for (const planned of componentPlan.components) {
    const node = components.get(planned.id), renderer = node?.kind === 'html-static' ? 'html' : node?.kind === 'native-carousel' ? 'carousel' : node?.kind === 'native-products' || node?.kind === 'native-related-products' ? 'products' : node?.kind === 'native-posts' || node?.kind === 'native-categories' ? 'native' : node?.kind;
    if (!node || renderer !== planned.renderer) throw Error(`native44 renderer differs from plan: ${planned.id}`);
    if (node.sourceFactIds?.some(id => !sourceFacts.facts[id])) throw Error(`native44 unknown source fact ${node.key}`);
    if (node.kind === 'html-static') for (const candidate of node.exception.candidates) for (const ref of candidate.evidence) await readRef(root, jobDir, ref);
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { assets: Native44Asset[] };
  assertNative44SourceBindings(program, componentPlan, sourceFacts);
  if (!Array.isArray(manifest.assets) || new Set(manifest.assets.map(asset => asset.key)).size !== manifest.assets.length) throw Error('native44 asset manifest has missing/duplicate identities');
  for (const requirement of componentPlan.requirements.filter(item => item.disposition === 'preserve' && item.verification.kind === 'media')) {
    const expected = requirement.verification.expected, key = typeof expected === 'string' ? expected : expected && typeof expected === 'object' && !Array.isArray(expected) ? (expected as {assetKey?: string; url?: string}).assetKey ?? (expected as {url?: string}).url : undefined;
    const asset = manifest.assets.find(asset => asset.key === key || asset.sourceUrl === key);
    if (!asset) throw Error(`Preserved media has no actual manifest asset ${requirement.id}`);
    for (const id of requirement.factIds) { const fact = sourceFacts.facts[id]; if (fact?.kind === 'media') { const url = (fact.value.resource as {url?: string})?.url; if (url !== asset.sourceUrl && url !== (asset as Native44Asset & {observedResourceUrl?: string}).observedResourceUrl) throw Error(`Preserved media source differs from the actual usage ${requirement.id}`); } }
  }
  for (const key of referencedNative44Assets(program)) {
    const asset = manifest.assets.find(asset => asset.key === key); if (!asset) throw Error(`native44 missing asset ${key}`);
    const local = await realpath(path.resolve(jobDir, asset.localPath)); within(jobDir, local);
    const assetBytes = await readFile(local); if (hashV2(assetBytes) !== asset.sha256) throw Error(`native44 asset bytes changed ${key}`); await validateAssetBytesV2(assetBytes, asset.mediaType);
    if (asset.originalSha256) {
      const originalPath = (asset as Native44Asset & {originalSourcePath?: string}).originalSourcePath;
      let original: Buffer;
      if (originalPath) original = await readRef(jobDir, jobDir, { path: originalPath, sha256: asset.originalSha256 });
      else if (asset.sourceUrl.startsWith('data:image/')) { const comma = asset.sourceUrl.indexOf(','); original = /;base64$/i.test(asset.sourceUrl.slice(0, comma)) ? Buffer.from(asset.sourceUrl.slice(comma + 1), 'base64') : Buffer.from(decodeURIComponent(asset.sourceUrl.slice(comma + 1))); if (hashV2(original) !== asset.originalSha256) throw Error(`Inline original asset bytes changed ${key}`); }
      else throw Error(`Converted asset lacks original source byte evidence ${key}`);
      assertSafeSVGBytesV2(original);
    }
  }
  const knowledgeStarted = performance.now();
  const knowledge = await loadNative44Knowledge(usedNative44WidgetTypes(program), path.join(root, 'data', 'native44'), program.componentExtension);
  const knowledgeMs = Math.round(performance.now() - knowledgeStarted);
  validateNative44Selection(program, componentPlan, sourceFacts, { knowledge });
  if (isDesktopBrowserProfile(program.replicationProfile)) {
    const checkedFiles = new Map<string, Buffer>();
    const checkedRegisteredContracts = new Set<string>();
    const evidenceBytes = async (ref: {path: string; sha256: string}) => {
      const cacheKey = `${ref.path}:${ref.sha256}`;
      if (!checkedFiles.has(cacheKey)) checkedFiles.set(cacheKey, await readRef(root, jobDir, ref));
      return checkedFiles.get(cacheKey)!;
    };
    for (const decision of componentPlan.selectionDecisions!) {
      for (const ref of [...decision.candidates.flatMap(candidate => candidate.evidence), ...(decision.compositionReason?.evidence ?? [])]) await evidenceBytes(ref);
      for (const contract of decision.contractRefs) {
        const bytes = await evidenceBytes(contract.evidence);
        if (contract.scope === 'local-source') {
          const extra=knowledge.extension?.index.components[contract.widgetType];
          const local = extra??knowledge.index.components[contract.widgetType];
          if (!local || contract.evidence.sha256 !== local.sha256 || contract.schemaSha256 !== local.sha256 || (await realpath(path.resolve(jobDir, contract.evidence.path))).toLowerCase() !== (await realpath(extra?path.resolve(root,extra.path):path.join(root, 'data', 'native44', local.path))).toLowerCase()) throw Error(`Selection researched file differs from the frozen component contract: ${contract.widgetType}`);
        } else {
          const contractKey = `${contract.evidence.path}:${contract.evidence.sha256}:${contract.widgetType}:${contract.schemaSha256}`;
          if (checkedRegisteredContracts.has(contractKey)) continue;
          const value = JSON.parse(bytes.toString('utf8'));
          // A registry report must actually contain the declared registration;
          // it cannot fall back to a forged top-level raw-schema lookalike.
          const schema = value && typeof value === 'object' && Object.hasOwn(value, 'legacySchemas') ? value.legacySchemas?.[contract.widgetType] : value;
          if (!schema || schema.type !== contract.widgetType || typeof schema.class !== 'string' || !schema.class || !schema.controls || typeof schema.controls !== 'object' || Array.isArray(schema.controls) || !native44RegisteredSchemaHashMatches(schema, contract.schemaSha256)) throw Error(`Selection registered schema file is not its declared contract: ${contract.widgetType}`);
          checkedRegisteredContracts.add(contractKey);
        }
      }
    }
  }
  await assertCreationTaskMode(root, actual, 'replica');
  const jobMarkerPath = await realpath(path.join(jobDir, 'job.json')); within(jobDir, jobMarkerPath);
  const jobMarker = JSON.parse((await readFile(jobMarkerPath, 'utf8')).replace(/^\uFEFF/, '')) as { finalDeliveryPolicy?: unknown };
  const finalDeliveryPolicy = jobMarker.finalDeliveryPolicy === undefined ? undefined : resolveFinalDeliveryPolicy(jobMarker);
  const releaseLock = await readNative44JobReleaseLock(root, jobDir, { filename: actual, sha256: hashV2(bytes), program });
  // This opt-in only defers behavior proofs until the complete owned page exists.
  // It does not relax source coverage, source bytes, selection or static bindings.
  if (options.reviewDraft) {
    if (!isDesktopBrowserProfile(program.replicationProfile) || goalProfile !== 'component-reference-v1' || program.goalProfile !== goalProfile || !requirementValidation || !releaseLock) throw Error('native44_review_draft_requires_new_full_component_reference_task');
    if (all.some(component => component.kind === 'html-static') || !componentPlan.sourceUnits?.length || componentPlan.selectionReview?.status !== 'approved') throw Error('native44_review_draft_requires_complete_native_plan');
    const staticGaps = requirementValidation.contract.requirements.filter(requirement => requirement.dimension !== 'behavior' && requirement.fulfillment.route === 'gap');
    if (staticGaps.length) throw Error(`native44_review_draft_static_gaps: ${staticGaps.map(requirement => requirement.id).join(', ')}`);
  }
  const reviewDraftIntent = options.reviewDraft && requirementValidation ? {
    version: 1 as const, kind: 'native44-full-review-draft-intent' as const, taskId: program.taskId,
    executionStrategy: program.executionStrategy, replicationProfile: program.replicationProfile!, goalProfile: program.goalProfile!, selectionRulesHash: program.selectionRulesHash!,
    inputs: { program: { path: actual, sha256: hashV2(bytes) }, sourceFacts: { ...program.sourceFacts, sha256: hashV2(factsBytes) }, componentPlan: { ...program.componentPlan, sha256: hashV2(planBytes) }, assetsManifest: { ...program.assetsManifest, sha256: hashV2(manifestBytes) }, releaseLock: releaseLock! },
    components: all.map(component => ({ key: component.key, kind: component.kind, ...('widgetType' in component ? { widgetType: component.widgetType } : {}) })),
    sourceUnits: componentPlan.sourceUnits!.map(unit => ({ id: unit.id, snapshotId: unit.snapshotId, ownerNodeId: unit.ownerNodeId, regionId: unit.regionId, sourceFactIds: unit.sourceFactIds, componentKeys: componentPlan.selectionDecisions!.find(decision => decision.unitId === unit.id)!.componentKeys })),
    requirementsHash: requirementValidation.coverage.requirementsHash,
    unverifiedRequirements: requirementValidation.contract.requirements.filter(requirement => requirement.fulfillment.route === 'gap'),
    sourceGaps: sourceFacts.gaps,
    reviewDraftOnly: true as const, requirementsComplete: false as const, deliveryComplete: false as const,
    nextStage: 'current-page-visual-and-interaction-review' as const,
  } : undefined;
  return { root, jobDir, filename: actual, bytes, factsBytes, planBytes, manifestBytes, program, sourceFacts, componentPlan, manifest, knowledge, ...(finalDeliveryPolicy ? { finalDeliveryPolicy } : {}), ...(requirementValidation ? { requirementCoverage: requirementValidation.coverage } : {}), ...(reviewDraftIntent ? { reviewDraftIntent } : {}), ...(releaseLock ? { releaseLock } : {}), programHash: hashV2(bytes), sourceFactsHash: hashV2(factsBytes), componentPlanHash: hashV2(planBytes), assetsManifestHash: hashV2(manifestBytes), inputMetrics: { knowledgeMs, localValidationMs: Math.round(performance.now() - validationStarted) } };
}
/** Compatibility export for callers and historical test harnesses. */
export const validateLocalNative44Input = prepareLocalTask;
export type ValidatedTaskInput = Awaited<ReturnType<typeof prepareLocalTask>>;

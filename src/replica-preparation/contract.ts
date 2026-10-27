import { createHash } from 'node:crypto';
import { z } from 'zod';
import { taskReviewSkipPolicySchema, assertTaskReviewSkipScope } from '../replica-full/review-skip-policy.js';
import { native44ProgramSchema } from '../native44/validate.js';
import { NATIVE44_ARTICLE_LIST_POLICY } from '../native44/types.js';
import { NATIVE44_COMPONENT_REFERENCE_GOAL, NATIVE44_REQUIREMENT_PROFILE } from '../native44/requirements.js';
import { headerTargetOrigin, canonicalHeaderJson } from '../woodmart-header/contract.js';
import { validateHeaderModulePlan } from '../woodmart-header/generic/contract.js';
import { navigationFormSpecSchema, parseNavigationForms } from '../replica-full/navigation-form/index.js';
import { nativeImagePolicySchema } from '../replica-full/native-image-policy.js';
import { reusedHeaderResourceSchema } from '../replica-full/contract.js';
import { assertPageScope, pageScopeSchema, sourcePartitionSchema } from '../replica-full/page-scope.js';
import { BODY_FIDELITY_KINDS, PREPARATION_COMPATIBILITY_KEYS, PREPARATION_DECISION_KEYS, type PreparationJob, type PreparationJobResult, type PreparationPlan } from './types.js';
import { componentGuidanceReviewSchema } from './component-guidance.js';

import { responsiveSourceSchema, responsiveSectionSchema } from '../replica-responsive/contract.js';
import { assertReadonlyHeaderDecisionScope } from '../replica-responsive/decisions.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const id = z.string().min(1).max(240);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = z.array(id).max(100000);
const ref = z.object({ path: z.string().min(1).max(4096), sha256: hash }).strict();
const css = z.string().max(1_048_576).refine(value => !/[<\u0000]/.test(value));
const fidelityCheck = z.object({ kind: z.enum(BODY_FIDELITY_KINDS), status: z.enum(['required', 'not-applicable']), sourceFactIds: ids.min(1), expected: z.string().trim().min(10).max(2000), evidence: z.array(ref).min(1).max(20) }).strict();
const fidelityResult = z.object({ kind: z.enum(BODY_FIDELITY_KINDS), componentKeys: z.array(key).min(1).max(1000), mechanism: z.enum(['native', 'scoped-css', 'task-local-html']), implementation: z.string().trim().min(10).max(2000) }).strict();
const visualRect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict();
const visualTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text-wrap'), sourceFactId: id, lineCount: z.number().int().positive(), widthPx: z.number().finite().nonnegative(), evidence: ref }).strict(),
  z.object({ kind: z.literal('item-count'), sourceFactIds: ids.min(1), count: z.number().int().positive(), evidence: ref }).strict(),
  z.object({ kind: z.literal('geometry'), sourceFactId: id, rect: visualRect, evidence: ref }).strict(),
  z.object({ kind: z.literal('paint'), sourceFactId: id, property: z.enum(['background-color', 'color', 'border-color', 'border-width', 'border-style', 'font-size', 'font-weight', 'border-radius']), value: z.string().trim().min(1).max(500), evidence: ref }).strict(),
]);
const section = z.object({ key, sourceUnitIds: ids.min(1), sourceFactIds: ids.min(1), family: z.enum(['content', 'interaction']), dependsOn: z.array(key).max(2000), estimatedEffort: z.number().finite().positive().max(1000000), fidelity: z.array(fidelityCheck).length(BODY_FIDELITY_KINDS.length).optional(), visualTargets: z.array(visualTarget).min(1).max(2000).optional(), phoneSourceOwners: z.array(z.object({ snapshotId: id, nodeId: id }).strict()).min(1).max(100).optional() }).strict();
const planSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).default(8), kind: z.literal('clonewp-replica-preparation'), taskId: key, runId: key,
  title: z.string().trim().min(1).max(200), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/), sourceUrl: z.url(), targetOrigin: z.url(),
  sourceEvidence: ref, sourceFacts: ref, sourceUnits: ref, headerAssets: ref.optional(), bodyAssets: ref,
  bodyBase: native44ProgramSchema.omit({ blocks: true }), headerBase: z.unknown().optional(), reusedHeader: reusedHeaderResourceSchema.optional(), pageScope: pageScopeSchema.optional(),
  sourcePartition: sourcePartitionSchema,
  shared: z.object({ decisions: z.array(z.object({ key, value: z.unknown(), evidence: z.array(ref).min(1).max(100) }).strict()).min(1).max(100), compatibility: z.array(z.object({ key: z.enum(PREPARATION_COMPATIBILITY_KEYS), status: z.enum(['verified', 'not-applicable', 'unresolved']), reason: z.string().trim().min(10).max(2000), evidence: z.array(ref).min(1).max(100) }).strict()).length(PREPARATION_COMPATIBILITY_KEYS.length), css }).strict(),
  sections: z.array(section).min(1).max(2000),
  navigationForms: z.array(navigationFormSpecSchema).min(1).max(4).optional(),
  reviewSkipPolicy: taskReviewSkipPolicySchema.optional(),
  nativeImagePolicy: nativeImagePolicySchema.optional(),
  responsive: responsiveSourceSchema.optional(),
}).strict();
const resultSchema = z.object({ version: z.literal(1), kind: z.literal('clonewp-preparation-result'), taskId: key, runId: key, jobId: z.enum(['header', 'body-1', 'body-2']), contractHash: hash, sharedHash: hash, header: z.unknown().optional(), componentGuidanceReview: componentGuidanceReviewSchema.optional(), sections: z.array(z.object({ key, blocks: z.array(z.unknown()).min(1).max(1000), css, responsive: responsiveSectionSchema.optional(), fidelity: z.array(fidelityResult).optional() }).strict()).min(1).max(2000).optional() }).strict();
export function preparationFail(code: string): never { throw Error(`replica_preparation_${code}`); }
/** Strict bounded canonical JSON, large enough for independent body fragments. */
export function preparationJson(input: unknown): string {
  let count = 0; const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (++count > 2_000_000 || depth > 80) preparationFail('json_limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') { if (!Number.isFinite(value)) preparationFail('json_invalid'); return JSON.stringify(value); }
    if (!value || typeof value !== 'object' || ancestors.has(value) || Object.getOwnPropertySymbols(value).length) preparationFail('json_invalid');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) preparationFail('json_invalid');
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.keys(value); ancestors.add(value);
    if (Array.isArray(value) && (keys.length !== value.length || keys.some((item, i) => item !== String(i))) || !Array.isArray(value) && Object.getOwnPropertyNames(value).length !== keys.length) preparationFail('json_invalid');
    const entries = (Array.isArray(value) ? keys : keys.sort()).map(item => {
      const descriptor = descriptors[item]; if (!descriptor || !('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(item)) preparationFail('json_invalid');
      return (Array.isArray(value) ? '' : JSON.stringify(item) + ':') + visit(descriptor.value, depth + 1);
    });
    ancestors.delete(value); return Array.isArray(value) ? '[' + entries.join(',') + ']' : '{' + entries.join(',') + '}';
  };
  const result = visit(input, 0); if (Buffer.byteLength(result) > 64 * 1024 * 1024) preparationFail('json_limit'); return result;
}
export const preparationHash = (input: unknown): string => createHash('sha256').update(preparationJson(input)).digest('hex');
const clone = <T>(input: T): T => JSON.parse(preparationJson(input)) as T;
const unique = (input: string[], code: string) => { if (new Set(input).size !== input.length) preparationFail(code); };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item));

export function validatePreparationPlan(input: unknown): PreparationPlan {
  try {
    const value = planSchema.parse(clone(input));
    assertTaskReviewSkipScope(value);
    if (value.version === 1 ? value.responsive !== undefined : !value.responsive || value.responsive.version !== (value.version >= 3 ? 2 : 1)) preparationFail('responsive_version_contract');
    if (value.version >= 4 && value.bodyBase.visualAuditVersion !== 3) preparationFail('phone_visual_audit_required');
    if (value.version >= 4 && value.responsive?.decisions?.carousels.some(row => row.presentation !== 'grid') && !value.responsive.carouselMotionSource) preparationFail('phone_carousel_motion_source_required');
    const source = new URL(value.sourceUrl); if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || /(?:token|nonce|password|secret|authorization|signature)=/i.test(source.search)) preparationFail('source_url');
    const targetOrigin = headerTargetOrigin(value.targetOrigin), headerBase = value.headerBase === undefined ? undefined : validateHeaderModulePlan(value.headerBase);
    if (value.reusedHeader ? value.version !== 8 || headerBase || value.headerAssets || value.reusedHeader.mobileMaxWidth !== value.responsive?.mobileMaxWidth : !headerBase || !value.headerAssets) preparationFail('header_provider_contract');
    if (value.responsive?.decisions) try { assertReadonlyHeaderDecisionScope(value.responsive.decisions.header, value); } catch { preparationFail('readonly_header_scope'); }
    if (headerBase && (headerBase.targetOrigin !== targetOrigin || headerBase.owner.runId !== value.runId) || value.bodyBase.taskId !== value.taskId || value.bodyBase.sourceUrl !== value.sourceUrl || preparationHash(value.bodyBase.sourceFacts) !== preparationHash(value.sourceFacts) || preparationHash(value.bodyBase.assetsManifest) !== preparationHash(value.bodyAssets)) preparationFail('identity');
    if (value.reusedHeader) for (const address of [value.reusedHeader.editUrl, ...value.reusedHeader.menus.map(row => row.editUrl), ...value.reusedHeader.blocks.map(row => row.editUrl)]) if (new URL(address).origin !== targetOrigin) preparationFail('reused_header_resource_origin');
    if (value.bodyBase.replicationProfile !== 'desktop-browser-v1' || value.bodyBase.editorNaming !== 'native-translated-v1' || value.bodyBase.reviewWorkflow !== 'whole-page-after-css-v1' || value.bodyBase.goalProfile !== NATIVE44_COMPONENT_REFERENCE_GOAL || value.bodyBase.requirementProfile !== NATIVE44_REQUIREMENT_PROFILE || value.bodyBase.articleListPolicy !== NATIVE44_ARTICLE_LIST_POLICY) preparationFail('quality_policy');
    assertPageScope(value, 8);
    if (value.pageScope === 'body-only' && !value.reusedHeader?.footerHash || value.pageScope === undefined && value.reusedHeader?.footerHash) preparationFail('footer_scope_contract');
    const partition = value.sourcePartition;
    for (const list of [partition.allUnits, partition.headerUnits, partition.bodyUnits, partition.footerUnits ?? [], partition.unselectedBodyUnits ?? []]) unique(list, 'unit_duplicate');
    if (partition.headerUnits.some(item => partition.bodyUnits.includes(item)) || !sameSet(partition.allUnits, [...partition.headerUnits, ...partition.bodyUnits, ...(partition.footerUnits ?? []), ...(partition.unselectedBodyUnits ?? [])])) preparationFail('unit_partition');
    unique(value.shared.decisions.map(item => item.key), 'decision_duplicate');
    if (PREPARATION_DECISION_KEYS.some(item => !value.shared.decisions.some(decision => decision.key === item))) preparationFail('decisions_incomplete');
    unique(value.shared.compatibility.map(item => item.key), 'compatibility_duplicate');
    if (PREPARATION_COMPATIBILITY_KEYS.some(item => !value.shared.compatibility.some(row => row.key === item)) || value.shared.compatibility.some(item => item.status === 'unresolved')) preparationFail('compatibility_unresolved');
    if (value.responsive?.decisions && [...value.responsive.decisions.layouts, ...value.responsive.decisions.carousels].some(d => !value.sections.some(s => s.key === d.sectionKey))) preparationFail('responsive_decision_section_owner');
    unique(value.sections.map(item => item.key), 'section_duplicate');
    const owned = value.sections.flatMap(item => item.sourceUnitIds), facts = value.sections.flatMap(item => item.sourceFactIds);
    unique(owned, 'section_unit_duplicate'); unique(facts, 'section_fact_duplicate');
    if (!sameSet(owned, partition.bodyUnits)) preparationFail('section_partition');
    if (value.navigationForms) {
      value.navigationForms = parseNavigationForms(value.navigationForms, value.sourceUrl);
      for (const form of value.navigationForms) {
        const owners = value.sections.filter(section => form.sourceUnitIds.every(id => section.sourceUnitIds.includes(id)) && form.sourceFactIds.every(id => section.sourceFactIds.includes(id)));
        if (owners.length !== 1 || form.slotComponentKey !== owners[0].key && !form.slotComponentKey.startsWith(owners[0].key + '_')) preparationFail('navigation_form_scope');
      }
    }
    for (const item of value.sections) {
      if (item.phoneSourceOwners && (value.version < 6 || !value.responsive)) preparationFail('phone_source_owners_version');
      unique(item.dependsOn, 'dependency_duplicate');
      if (item.dependsOn.some(dependency => dependency === item.key || !value.sections.some(section => section.key === dependency))) preparationFail('dependency_unknown');
      if (value.version >= 5) {
        if (!item.fidelity || new Set(item.fidelity.map(check => check.kind)).size !== BODY_FIDELITY_KINDS.length || !sameSet(item.fidelity.map(check => check.kind), [...BODY_FIDELITY_KINDS]) || !item.fidelity.some(check => check.status === 'required')) preparationFail('body_fidelity_incomplete');
        for (const check of item.fidelity) {
          unique(check.sourceFactIds, 'body_fidelity_fact_duplicate');
          if (check.sourceFactIds.some(factId => !item.sourceFactIds.includes(factId))) preparationFail('body_fidelity_fact_scope');
        }
      } else if (item.fidelity) preparationFail('body_fidelity_version');
      if (value.version >= 6) {
        if (!item.visualTargets || !item.visualTargets.some(target => target.kind === 'geometry') || !item.visualTargets.some(target => target.kind === 'paint')) preparationFail('body_visual_targets_incomplete');
        for (const target of item.visualTargets) {
          const factIds = target.kind === 'item-count' ? target.sourceFactIds : [target.sourceFactId];
          unique(factIds, 'body_visual_target_fact_duplicate');
          if (factIds.some(factId => !item.sourceFactIds.includes(factId))) preparationFail('body_visual_target_fact_scope');
        }
      } else if (item.visualTargets) preparationFail('body_visual_targets_version');
    }
    return { ...value, targetOrigin, ...(headerBase ? { headerBase } : {}) } as PreparationPlan;
  } catch (error) { if (error instanceof Error && error.message.startsWith('replica_preparation_')) throw error; return preparationFail('plan_invalid'); }
}
export function preparationSharedHash(input: PreparationPlan): string {
  const plan = validatePreparationPlan(input); return preparationHash({ taskId: plan.taskId, runId: plan.runId, sourceUrl: plan.sourceUrl, targetOrigin: plan.targetOrigin, sourceEvidence: plan.sourceEvidence, sourceFacts: plan.sourceFacts, sourceUnits: plan.sourceUnits, shared: plan.shared, bodyBase: plan.bodyBase, ...(plan.headerBase ? { headerBase: plan.headerBase } : {}), ...(plan.reusedHeader ? { reusedHeader: plan.reusedHeader } : {}), ...(plan.pageScope ? { pageScope: plan.pageScope } : {}), sourcePartition: plan.sourcePartition, sections: plan.sections, ...(plan.navigationForms ? { navigationForms: plan.navigationForms } : {}), ...(plan.reviewSkipPolicy ? { reviewSkipPolicy: plan.reviewSkipPolicy } : {}), ...(plan.nativeImagePolicy ? { nativeImagePolicy: plan.nativeImagePolicy } : {}), ...(plan.responsive ? { responsive: plan.responsive } : {}) });
}
/** Keep related dependencies together, then balance independent preparation work. */
export function buildPreparationJobs(input: PreparationPlan): PreparationJob[] {
  const plan = validatePreparationPlan(input), contractHash = preparationHash(plan), sharedHash = preparationSharedHash(plan), components: number[][] = [], seen = new Set<number>();
  for (let index = 0; index < plan.sections.length; index++) {
    if (seen.has(index)) continue;
    const queue = [index], group: number[] = []; seen.add(index);
    while (queue.length) {
      const current = queue.shift()!; group.push(current);
      for (let candidate = 0; candidate < plan.sections.length; candidate++) if (!seen.has(candidate) && (plan.sections[current].dependsOn.includes(plan.sections[candidate].key) || plan.sections[candidate].dependsOn.includes(plan.sections[current].key))) { seen.add(candidate); queue.push(candidate); }
    }
    components.push(group.sort((a, b) => a - b));
  }
  const base = { version: 1 as const, kind: 'clonewp-preparation-job' as const, taskId: plan.taskId, runId: plan.runId, contractHash, sharedHash };
  const result: PreparationJob[] = plan.reusedHeader ? [] : [{ ...base, jobId: 'header', responsibility: 'header', sectionKeys: [], sourceUnitIds: [...plan.sourcePartition.headerUnits], sourceFactIds: [], estimatedEffort: 1 }];
  const groups = Array.from({ length: Math.min(2, components.length) }, () => ({ indexes: [] as number[], effort: 0 }));
  const effort = (indexes: number[]) => indexes.reduce((sum, index) => sum + plan.sections[index].estimatedEffort, 0);
  components.sort((a, b) => effort(b) - effort(a) || a[0] - b[0]);
  for (const component of components) { const target = groups.reduce((best, row) => row.effort < best.effort ? row : best); target.indexes.push(...component); target.effort += effort(component); }
  groups.sort((a, b) => Math.min(...a.indexes) - Math.min(...b.indexes));
  groups.forEach((group, index) => { const sections = group.indexes.sort((a, b) => a - b).map(item => plan.sections[item]); result.push({ ...base, jobId: index === 0 ? 'body-1' : 'body-2', responsibility: 'body', sectionKeys: sections.map(item => item.key), sourceUnitIds: sections.flatMap(item => item.sourceUnitIds), sourceFactIds: sections.flatMap(item => item.sourceFactIds), estimatedEffort: group.effort }); });
  return result;
}
export function validatePreparationJobResult(input: unknown): PreparationJobResult {
  try {
    const result = resultSchema.parse(clone(input));
    if (result.jobId === 'header' ? !result.header || Object.hasOwn(result, 'sections') : Object.hasOwn(result, 'header') || !result.sections?.length) preparationFail('result_responsibility');
    if (result.header) result.header = validateHeaderModulePlan(result.header);
    if (result.sections) unique(result.sections.map(item => item.key), 'result_section_duplicate');
    return result as PreparationJobResult;
  } catch (error) { if (error instanceof Error && error.message.startsWith('replica_preparation_')) throw error; return preparationFail('result_invalid'); }
}
/** Header identity can be allocated before workers without freezing its layout. */
export function preparationHeaderIdentity(input: PreparationPlan['headerBase']): string {
  const plan = validateHeaderModulePlan(input);
  return canonicalHeaderJson({ moduleKey: plan.moduleKey, targetOrigin: plan.targetOrigin, owner: plan.owner, name: plan.name, menus: plan.menus.map(menu => ({ key: menu.key, name: menu.name })) });
}

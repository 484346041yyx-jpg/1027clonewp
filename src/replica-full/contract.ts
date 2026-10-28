import { z } from 'zod';
import { taskReviewSkipPolicySchema, assertTaskReviewSkipScope } from './review-skip-policy.js';
import { canonicalHeaderJson, headerTargetOrigin } from '../woodmart-header/contract.js';
import { canonicalFullReplicaJson, fullReplicaJsonHash } from './json.js';
import { validateHeaderModulePlan } from '../woodmart-header/generic/contract.js';
import { validateReplicaHeaderChoice } from '../woodmart-header/generic/routing.js';
import type { FullReplicaManifest, FullReplicaPreparedBody, FullReplicaBoundCheckpoint, FullReplicaReview } from './types.js';
import { navigationFormSpecSchema, parseNavigationForms } from './navigation-form/index.js';
import { nativeImagePolicySchema, nativeImageCheckSchema } from './native-image-policy.js';
import { responsiveBodyPlanSchema, requiredReplicaViewports } from '../replica-responsive/contract.js';
import { CURRENT_REPLICA_WORKFLOW_VERSION } from '../replica-responsive/defaults.js';
import { editorCompletionPolicySchema } from '../editor-completion/contract.js';
import { assertReadonlyHeaderDecisionScope } from '../replica-responsive/decisions.js';
import { assertPageScope, pageScopeSchema, sourcePartitionSchema } from './page-scope.js';
import { currentProductSelectionSchema } from '../native44/current-product.js';
import { assertProductExtensionReference } from '../native44/product-extension.js';

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const FullReplicaFileRefSchema = z.object({ path: z.string().min(1).max(4096), sha256: sha }).strict();
export const configuratorSpecSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-bottle-configurator'), widgetType: z.literal('clonewp_bottle_configurator'),
  sourceUrl: z.string().url(), sourceUnitIds: z.array(z.string().min(1).max(240)).min(1).max(100), sourceFactIds: z.array(z.string().min(1).max(240)).min(1).max(2000),
  slotComponentKey: key, formComponentKey: key, widgetKey: key,
  catalogTemplate: FullReplicaFileRefSchema, imageManifest: FullReplicaFileRefSchema,
  mediaKeys: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,119}$/)).min(1).max(200),
  sourceEvidence: z.array(FullReplicaFileRefSchema).min(1).max(30),
  packageManifest: FullReplicaFileRefSchema, registrationEvidence: FullReplicaFileRefSchema,
  packageFiles: z.object({ php: sha, js: sha, css: sha }).strict(),
}).strict();
const unit = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/);
const partition = sourcePartitionSchema;
const resourceURL = z.url().refine(value => { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !/(?:token|nonce|password|authorization|secret|signature|session)=/i.test(url.search); });
const resource = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(200), editUrl: resourceURL }).strict();
export const reusedHeaderResourceSchema = z.object({ headerId: z.string().regex(/^header_[1-9]\d{0,17}$/), name: z.string().trim().min(1).max(200), editUrl: resourceURL, sharedHash: sha, headerHash: sha, menuHash: sha, styleHash: sha, menus: z.array(resource.extend({ key })).max(100), blocks: z.array(resource).max(100), mobileMaxWidth: z.number().int().min(320).max(1024), hasSubmenus: z.boolean(), footerHash: sha.optional() }).strict();
const manifestSchema = z.object({
  componentExtension: FullReplicaFileRefSchema.optional(),currentRecord: currentProductSelectionSchema.optional(),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(CURRENT_REPLICA_WORKFLOW_VERSION), kind: z.literal('clonewp-full-replica'), taskId: key, runId: key,
  title: z.string().trim().min(1).max(200), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/),
  sourceUrl: z.string().url(), targetOrigin: z.string().url(),
  headerProvider: z.enum(['woodmart-header-builder', 'component', 'reused-woodmart-header']).default('woodmart-header-builder'),
  reusedHeader: reusedHeaderResourceSchema.optional(),
  pageScope: pageScopeSchema.optional(),
  deliveryPolicy: z.literal('publish-after-review').default('publish-after-review'),
  reviewSkipPolicy: taskReviewSkipPolicySchema.optional(),
  nativeImagePolicy: nativeImagePolicySchema.optional(),
  editorCompletionPolicy: editorCompletionPolicySchema.optional(),
  responsive: responsiveBodyPlanSchema.optional(),
  sourceEvidence: FullReplicaFileRefSchema,
  sourcePartition: partition,
  header: z.object({ plan: z.unknown(), bundleDirectory: z.string().min(1).max(4096), assets: FullReplicaFileRefSchema }).strict().optional(),
  body: z.object({ program: FullReplicaFileRefSchema, css: FullReplicaFileRefSchema, sourceUnits: FullReplicaFileRefSchema, navigationForms: z.array(navigationFormSpecSchema).min(1).max(4).optional(), configurator: configuratorSpecSchema.optional() }).strict(),
}).strict();
function fail(code: string): never { throw Error(`replica_full_${code}`); }
export function fullReplicaHash(value: unknown): string { return fullReplicaJsonHash(value); }
export function validateFullReplicaManifest(input: unknown): FullReplicaManifest {
  const raw=(input&&typeof input==='object'?input:{}) as Partial<FullReplicaManifest>;
  if(raw.componentExtension)assertProductExtensionReference(raw.componentExtension);
  if(raw.currentRecord&&!raw.componentExtension)throw Error('replica_full_current_record_extension_required');
  const parsed = manifestSchema.parse(JSON.parse(canonicalFullReplicaJson(input)));
  if (parsed.version === 1 ? parsed.responsive !== undefined : !parsed.responsive || parsed.responsive.version !== (parsed.version >= 3 ? 2 : 1)) fail('responsive_version_contract');
  assertTaskReviewSkipScope(parsed);
  const source = new URL(parsed.sourceUrl);
  if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || /(?:token|nonce|password|authorization|secret)=/i.test(source.search)) fail('source_url_invalid');
  parsed.targetOrigin = headerTargetOrigin(parsed.targetOrigin);
  if (parsed.body.navigationForms) {
    parsed.body.navigationForms = parseNavigationForms(parsed.body.navigationForms, parsed.sourceUrl);
    if (parsed.headerProvider === 'component' || parsed.body.navigationForms.some(form => form.sourceUnitIds.some(id => !parsed.sourcePartition.bodyUnits.includes(id)))) fail('navigation_form_scope');
  }
  if (parsed.body.configurator) {
    const c = parsed.body.configurator;
    if (parsed.version !== 4 || parsed.pageScope !== 'body-only' || c.sourceUrl !== parsed.sourceUrl ||
      new Set(c.sourceUnitIds).size !== c.sourceUnitIds.length || c.sourceUnitIds.some(id => !parsed.sourcePartition.bodyUnits.includes(id)) ||
      new Set(c.sourceFactIds).size !== c.sourceFactIds.length || new Set(c.mediaKeys).size !== c.mediaKeys.length ||
      new Set([c.slotComponentKey,c.formComponentKey,c.widgetKey]).size !== 3 || parsed.body.navigationForms?.some(f => f.slotComponentKey === c.slotComponentKey)) fail('configurator_scope');
  }
  assertPageScope(parsed, 4);
  if (parsed.pageScope === 'body-only' && !parsed.reusedHeader?.footerHash || parsed.pageScope === undefined && parsed.reusedHeader?.footerHash) fail('footer_scope_contract');
  validateReplicaHeaderChoice({ version: 1, kind: 'clonewp-replica-header-choice', provider: parsed.headerProvider === 'reused-woodmart-header' ? 'woodmart-header-builder' : parsed.headerProvider, sourcePartition: parsed.pageScope === 'body-only' ? { allUnits: [...parsed.sourcePartition.headerUnits, ...parsed.sourcePartition.bodyUnits], headerUnits: parsed.sourcePartition.headerUnits, bodyUnits: parsed.sourcePartition.bodyUnits } : parsed.sourcePartition });
  if (parsed.headerProvider === 'reused-woodmart-header') {
    if (parsed.version !== 4 || parsed.header || !parsed.reusedHeader || parsed.reusedHeader.mobileMaxWidth !== parsed.responsive?.mobileMaxWidth) fail('reused_header_contract');
    const reused = parsed.reusedHeader;
    for (const url of [reused.editUrl, ...reused.menus.map(row => row.editUrl), ...reused.blocks.map(row => row.editUrl)]) {
      const actual = new URL(url); if (actual.origin !== parsed.targetOrigin || actual.username || actual.password || /(?:token|nonce|password|authorization|secret)=/i.test(actual.search)) fail('reused_header_resource_origin');
    }
    if (new Set(reused.menus.map(row => row.id)).size !== reused.menus.length || new Set(reused.menus.map(row => row.key)).size !== reused.menus.length || new Set(reused.blocks.map(row => row.id)).size !== reused.blocks.length) fail('reused_header_resource_duplicate');
    if (parsed.responsive?.decisions) assertReadonlyHeaderDecisionScope(parsed.responsive.decisions.header, parsed);
    return parsed as FullReplicaManifest;
  }
  if (parsed.responsive?.decisions) assertReadonlyHeaderDecisionScope(parsed.responsive.decisions.header, parsed);
  if (parsed.reusedHeader) fail('reused_header_provider_required');
  if (parsed.headerProvider === 'woodmart-header-builder' && !parsed.header) fail('header_plan_required');
  const header = parsed.header ? { ...parsed.header, plan: validateHeaderModulePlan(parsed.header.plan) } : undefined;
  if (parsed.responsive && (!header?.plan.layout.mobile || header.plan.layout.mobile.mobileMaxWidth !== parsed.responsive.mobileMaxWidth)) fail('responsive_header_required');
  if (parsed.responsive?.decisions && (header?.plan.layout.mobile?.version !== 2 || canonicalHeaderJson(header.plan.layout.mobile.scroll) !== canonicalHeaderJson(parsed.responsive.decisions.header))) fail('responsive_header_decision_changed');
  if (header && (header.plan.targetOrigin !== parsed.targetOrigin || header.plan.owner.runId !== parsed.runId)) fail('header_identity_conflict');
  return { ...parsed, ...(header ? { header } : {}) } as FullReplicaManifest;
}
function exactUnits(actual: string[], expected: string[], code: string): void {
  if (!Array.isArray(actual) || new Set(actual).size !== actual.length || actual.length !== expected.length || expected.some(id => !actual.includes(id))) fail(code);
}
/** Derived by the body adapter from the actual program and selection mappings. */
export function assertFullReplicaBodyScope(body: FullReplicaPreparedBody, manifest: FullReplicaManifest): void {
  if (!body || !/^[a-f0-9]{64}$/.test(body.programHash) || body.programHash !== manifest.body.program.sha256) fail('body_program_identity');
  if (body.cssInputHash !== manifest.body.css.sha256 || body.sourceUnitsHash !== manifest.body.sourceUnits.sha256 || body.sourceEvidenceHash !== manifest.sourceEvidence.sha256) fail('body_input_identity');
  exactUnits(body.sourceUnitIds, manifest.sourcePartition.bodyUnits, 'body_source_scope');
  exactUnits(body.componentSourceUnitIds, manifest.sourcePartition.bodyUnits, 'body_component_scope');
  if (body.sourceUnitIds.some(id => manifest.sourcePartition.headerUnits.includes(id)) || body.componentSourceUnitIds.some(id => manifest.sourcePartition.headerUnits.includes(id)) || body.embeddedHeaderCount !== 0) fail('embedded_header_rejected');
}
export function fullReplicaFingerprint(bound: Pick<FullReplicaBoundCheckpoint, 'pageId' | 'runId' | 'headerId' | 'bodyHash' | 'cssHash' | 'documentHash' | 'headerHash' | 'menuHash' | 'styleHash'>): string {
  return fullReplicaHash({ pageId: bound.pageId, runId: bound.runId, headerId: bound.headerId, bodyHash: bound.bodyHash, cssHash: bound.cssHash, documentHash: bound.documentHash, headerHash: bound.headerHash, menuHash: bound.menuHash, styleHash: bound.styleHash });
}
const reviewSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-full-replica-review'), taskId: key, runId: key,
  pageId: z.number().int().positive(), fingerprint: sha, decision: z.enum(['approved', 'changes-required']), observedAt: z.string().refine(value => Number.isFinite(Date.parse(value))), reviewerEvidence: FullReplicaFileRefSchema,
  viewports: z.array(z.object({ width: z.number().int().positive(), height: z.number().int().positive(), screenshot: FullReplicaFileRefSchema, visual: z.enum(['passed', 'failed']), interactions: z.enum(['passed', 'failed']), headerCount: z.number().int().min(0), bodyHeaderCount: z.number().int().min(0) }).strict()).min(2).max(4),
  nativeImageChecks: z.array(nativeImageCheckSchema).max(2000).optional(),
}).strict();
/** Structure/current identity only; verifyReview must verify real evidence/fresh state. */
export function validateFullReplicaReview(input: unknown, manifest: FullReplicaManifest, bound: FullReplicaBoundCheckpoint): FullReplicaReview {
  const review = reviewSchema.parse(JSON.parse(canonicalFullReplicaJson(input)));
  if (review.taskId !== manifest.taskId || review.runId !== manifest.runId || review.pageId !== bound.pageId || review.fingerprint !== fullReplicaFingerprint(bound)) fail('review_stale_or_wrong_page');
  const required = requiredReplicaViewports(manifest.responsive).map(v => `${v.width}x${v.height}`);
  if (review.viewports.length !== required.length || new Set(review.viewports.map(item => `${item.width}x${item.height}`)).size !== required.length || required.some(size => !review.viewports.some(item => `${item.width}x${item.height}` === size))) fail('review_viewports_incomplete');
  if (review.decision === 'approved' && review.viewports.some(item => item.visual !== 'passed' || item.interactions !== 'passed' || item.headerCount !== 1 || item.bodyHeaderCount !== 0)) fail('review_quality_floor');
  return review;
}

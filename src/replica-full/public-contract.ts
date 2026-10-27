import { z } from 'zod';
import { validateNative44Program } from '../native44/validate.js';
import { validateHeaderModulePlan } from '../woodmart-header/generic/contract.js';
import { responsiveBodyPlanSchema } from '../replica-responsive/contract.js';

const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
export const publicReplicaScopeSchema = z.enum(['header-only', 'footer-only', 'header-footer']);
export const publicReplicaSchema = z.object({
  version: z.literal(5), kind: z.literal('clonewp-full-replica'),
  taskId: key, runId: key, pageScope: publicReplicaScopeSchema,
  title: z.string().trim().min(1).max(200), sourceUrl: z.url(), targetOrigin: z.url(),
  sourceEvidence: ref,
  preview: z.object({ title: z.string().trim().min(1).max(200), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/) }).strict(),
  deliveryPolicy: z.literal('draft-for-user-review'),
  header: z.object({ plan: z.unknown(), bundleDirectory: z.string().min(1), mediaIds: z.record(z.string(),z.number().int().positive()).optional() }).strict().optional(),
  footer: z.object({ program: ref, css: ref, responsive: responsiveBodyPlanSchema, assets: ref }).strict().optional(),
}).strict();
export type PublicReplicaManifest = z.infer<typeof publicReplicaSchema>;
export function isPublicReplica(input: unknown): boolean { return !!input && typeof input === 'object' && (input as any).version === 5 && (input as any).kind === 'clonewp-full-replica'; }
export function validatePublicReplicaManifest(input: unknown): PublicReplicaManifest {
  const value = publicReplicaSchema.parse(input);
  const source = new URL(value.sourceUrl), target = new URL(value.targetOrigin);
  if (source.protocol !== 'https:' || source.username || source.password || source.hash || source.search || target.protocol !== 'https:' || target.origin !== value.targetOrigin || target.username || target.password) throw Error('replica_full_public_origin');
  if ((value.pageScope !== 'footer-only') !== !!value.header || (value.pageScope !== 'header-only') !== !!value.footer) throw Error('replica_full_public_scope');
  if (value.header) {
    const plan = validateHeaderModulePlan(value.header.plan);
    if (plan.targetOrigin !== value.targetOrigin || plan.owner.runId !== value.runId || plan.owner.ownerId !== value.taskId) throw Error('replica_full_public_header_identity');
    value.header.plan = plan;
  }
  return value;
}
export function validatePublicFooterProgram(input: unknown, manifest: PublicReplicaManifest) {
  const program = validateNative44Program(input);
  if (program.taskId !== manifest.taskId || program.sourceUrl !== manifest.sourceUrl || program.currentRecord || program.componentExtension) throw Error('replica_full_public_program_identity');
  return program;
}

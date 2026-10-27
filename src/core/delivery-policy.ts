import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { projectSchema } from './config.js';

export const FinalDeliveryPolicySchema = z.object({
  version: z.literal(1),
  kind: z.literal('clonewp-final-delivery-policy'),
  desiredPageStatus: z.enum(['draft', 'publish']),
  constructionPageStatus: z.literal('draft'),
  publicationGate: z.literal('current-review-quality-floor'),
  authorization: z.enum(['project-default-at-task-creation', 'safe-default-at-task-creation', 'legacy-draft-preserved']),
}).strict().superRefine((policy, context) => {
  if (policy.authorization !== 'project-default-at-task-creation' && policy.desiredPageStatus !== 'draft') context.addIssue({ code: 'custom', message: 'Only a frozen project publication default may request publishing' });
});
export type FinalDeliveryPolicy = z.infer<typeof FinalDeliveryPolicySchema>;

const policy = (desiredPageStatus: FinalDeliveryPolicy['desiredPageStatus'], authorization: FinalDeliveryPolicy['authorization']): FinalDeliveryPolicy => ({ version: 1, kind: 'clonewp-final-delivery-policy', desiredPageStatus, constructionPageStatus: 'draft', publicationGate: 'current-review-quality-floor', authorization });

/** Called only by new-task intake, before writing its first task marker. No credentials are read. */
export async function freezeNewTaskFinalDeliveryPolicy(root: string): Promise<FinalDeliveryPolicy> {
  let bytes: string;
  try { bytes = await readFile(path.join(root, 'config', 'project.json'), 'utf8'); }
  catch (error) {
    // Standalone source-intake libraries can run without a configured target.
    // Such a task freezes the safe draft outcome; later configuration cannot upgrade it.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return policy('draft', 'safe-default-at-task-creation');
    throw error;
  }
  const config = JSON.parse(bytes.replace(/^\uFEFF/, ''));
  const desiredPageStatus = projectSchema.shape.pageStatus.parse(config.pageStatus);
  return policy(desiredPageStatus, 'project-default-at-task-creation');
}

/** Historical tasks/runs never inherit today's project default. Invalid frozen fields fail closed. */
export function resolveFinalDeliveryPolicy(record: unknown): FinalDeliveryPolicy {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('Final delivery policy requires a task or run record');
  const frozen = (record as { finalDeliveryPolicy?: unknown }).finalDeliveryPolicy;
  return frozen === undefined ? policy('draft', 'legacy-draft-preserved') : FinalDeliveryPolicySchema.parse(frozen);
}

export function assertFinalDeliveryPolicyIdentity(task: unknown, run: unknown): void {
  const expected = resolveFinalDeliveryPolicy(task), actual = resolveFinalDeliveryPolicy(run);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Error('Frozen final delivery policy changed; preserve the existing owned page');
}

/** This is a next step, never evidence that a review passed or permission to bypass its quality gate. */
export function finalDeliveryNextAction(policy: FinalDeliveryPolicy, run: string): string {
  const checked = FinalDeliveryPolicySchema.parse(policy);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,239}$/.test(run)) throw Error('Final delivery requires a bounded run identifier');
  return checked.desiredPageStatus === 'publish'
    ? `完成当前页面视觉、交互和质量底线复核后，执行 npm run publication -- finalize --run ${JSON.stringify(run)}；该任务已冻结直接发布偏好，无需再次询问。未通过复核时保留草稿并列出缺口。`
    : '完成当前页面视觉、交互和质量底线复核后保留未发布草稿；此任务没有冻结直接发布授权，不继承后续项目默认。';
}

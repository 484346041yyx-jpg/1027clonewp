import { z } from 'zod';

/** Named experiments, each explicitly authorized for its own task. Never a project default. */
const sharedPolicyFields = {
  version: z.literal(1), kind: z.literal('clonewp-task-review-skip'),
  scope: z.tuple([z.literal('visual'), z.literal('interaction'), z.literal('editor-completion')]),
};
const authorizationFields = { source: z.literal('current-user-explicit-instruction'), reason: z.literal('暴露第二步实施问题') };
export const taskReviewSkipPolicySchema = z.union([
  z.object({ ...sharedPolicyFields,
    taskId: z.literal('huaqi-about-20261023-body'), runId: z.literal('huaqi-about-20261023-body'),
    authorization: z.object({ ...authorizationFields, instruction: z.literal('执行第 1、2 步，随后发布；允许，仅这次任务跳过') }).strict(),
  }).strict(),
  z.object({ ...sharedPolicyFields,
    taskId: z.literal('huaqi-perfume-20261024-body'), runId: z.literal('huaqi-perfume-20261024-body'),
    authorization: z.object({ ...authorizationFields, instruction: z.literal('第二步后直接发布，第三步不考虑，因为我要暴露问题') }).strict(),
  }).strict(),
  z.object({ ...sharedPolicyFields,
    taskId: z.literal('huaqi-cosmetic-20261024-body'), runId: z.literal('huaqi-cosmetic-20261024-body'),
    authorization: z.object({ ...authorizationFields, instruction: z.literal('完成第一、二步后直接发布，跳过第三步检查') }).strict(),
  }).strict(),
]);
export type TaskReviewSkipPolicy = z.infer<typeof taskReviewSkipPolicySchema>;
export function assertTaskReviewSkipScope(record: { taskId: string; runId: string; sourceUrl: string; targetOrigin: string; reusedHeader?: { headerId: string }; reviewSkipPolicy?: TaskReviewSkipPolicy }): void {
  if (!record.reviewSkipPolicy) return;
  const policy = taskReviewSkipPolicySchema.parse(record.reviewSkipPolicy);
  const sourceUrl = {
    'huaqi-about-20261023-body': 'https://www.huaqipackage.com/about-huaqi',
    'huaqi-perfume-20261024-body': 'https://www.huaqipackage.com/custom-perfume-bottle',
    'huaqi-cosmetic-20261024-body': 'https://www.huaqipackage.com/custom-cosmetic--skincare-packing',
  }[policy.taskId];
  if (record.taskId !== policy.taskId || record.runId !== policy.runId || record.sourceUrl !== sourceUrl || record.targetOrigin !== 'https://vapeversse.com' || record.reusedHeader?.headerId !== 'header_39589520821341414') throw Error('replica_full_review_skip_scope_conflict');
}

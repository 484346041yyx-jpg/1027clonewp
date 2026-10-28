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
  z.object({ ...sharedPolicyFields,
    taskId: z.literal('huaqi-product-layout-jiangubottle-20261028'), runId: z.literal('huaqi-product-layout-jiangubottle-20261028'),
    authorization: z.object({ source: z.literal('current-user-explicit-instruction'), instruction: z.literal('全部发布，我自己看效果；然后启动'), reason: z.literal('用户自行查看正式站效果') }).strict(),
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
    'huaqi-product-layout-jiangubottle-20261028': 'https://www.huaqipackage.com/special-shaped-empty-glass-perfume-bottle-with-metal-cap',
  }[policy.taskId];
  const target = policy.taskId === 'huaqi-product-layout-jiangubottle-20261028' ? 'https://jiangubottle.com' : 'https://vapeversse.com';
  const header = policy.taskId === 'huaqi-product-layout-jiangubottle-20261028' ? 'header_196552' : 'header_39589520821341414';
  if (record.taskId !== policy.taskId || record.runId !== policy.runId || record.sourceUrl !== sourceUrl || record.targetOrigin !== target || record.reusedHeader?.headerId !== header) throw Error('replica_full_review_skip_scope_conflict');
}

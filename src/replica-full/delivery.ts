import { validateFullReplicaManifest, validateFullReplicaReview } from './contract.js';
import { replicaURLNotice } from '../core/replica-url.js';
import type { FullReplicaManifest, FullReplicaRunState } from './types.js';

const label = (value: string): string => value.replace(/[\\`*_{}\[\]()#+.!|<>]/g, '\\$&');
export function fullReplicaDelivery(input: FullReplicaRunState, manifestInput: FullReplicaManifest, editorCompletion?: { required: boolean; complete: boolean; status: string }) {
  const manifest = validateFullReplicaManifest(manifestInput), header = input.checkpoints.header;
  const page = input.checkpoints.body ?? input.checkpoints.page;
  const review = input.review && input.checkpoints.bound ? validateFullReplicaReview(input.review, manifest, input.checkpoints.bound) : null;
  const skipped = !!manifest.reviewSkipPolicy;
  const urlNotice = input.checkpoints.published ? replicaURLNotice(manifest.sourceUrl, input.checkpoints.published.publicUrl, manifest.sourcePartition.selection?.targetSlug) : null;
  const editor = skipped ? { required: false, complete: false, status: 'skipped-by-current-user-for-this-task' } : editorCompletion ?? { required: !!manifest.editorCompletionPolicy, complete: !manifest.editorCompletionPolicy, status: manifest.editorCompletionPolicy ? 'awaiting-editor-alignment-and-reopen' : 'historical-contract' };
  const complete = input.status === 'published' && Boolean(input.checkpoints.published) && (skipped || review?.decision === 'approved') && !input.pending && (skipped || editor.complete);
  const resources = [
    ...(page ? [{ kind: 'page', name: manifest.title, id: String(page.pageId), editUrl: page.editUrl }] : []),
    ...(header ? [{ kind: 'header', name: header.name, id: header.headerId, editUrl: header.editUrl }, ...header.menus.map(menu => ({ kind: 'menu', name: menu.name, id: String(menu.id), editUrl: menu.editUrl })), { kind: 'style', name: header.styleBlock.name, id: String(header.styleBlock.id), editUrl: header.styleBlock.editUrl }] : []),
    ...(header?.menuContent?.map(content => ({ kind: 'menu-content', name: content.name, id: String(content.id), editUrl: content.editUrl })) ?? []),
    ...(manifest.reusedHeader ? [{ kind: 'reused-header', name: manifest.reusedHeader.name, id: manifest.reusedHeader.headerId, editUrl: manifest.reusedHeader.editUrl }, ...manifest.reusedHeader.menus.map(menu => ({ kind: 'reused-menu', name: menu.name, id: String(menu.id), editUrl: menu.editUrl })), ...manifest.reusedHeader.blocks.map(block => ({ kind: 'reused-block', name: block.name, id: String(block.id), editUrl: block.editUrl }))] : []),
  ];
  const markdown = [
    `状态：${input.status}${complete ? skipped ? '，已按本次授权跳过第三步并确认发布读回；未验证视觉、交互及编辑器效果' : '，当前整页复核与发布读回已确认' : '，尚未完成整页交付'}。`,
    ...(input.checkpoints.published ? [`公开页面：[${label(manifest.title)}](${input.checkpoints.published.publicUrl})`] : []),
    ...(urlNotice ? [`地址例外：来源路径 ${label(urlNotice.requestedPath)} 经 WordPress 原生规范化或重名处理后为 [${label(urlNotice.actualPath)}](${urlNotice.actualUrl})；页面间链接须使用此实际地址。`] : []),
    '', ...resources.map(resource => `- ${resource.kind}：[${label(resource.name)}](${resource.editUrl})（${label(resource.id)}）`),
    ...(!skipped && manifest.responsive ? ['', `验证范围：桌面 1920×1080、1440×1000；手机 ${manifest.responsive.viewports.map(v => `${v.width}×${v.height}`).join('、')}；平板沿用桌面，仅核对断点。`, manifest.reusedHeader ? '复用指定页眉及其现有菜单；只读核对桌面与手机显示，不修改共享资源。' : '同一个 WoodMart 页眉包含独立手机布局，菜单使用上述任务自有菜单。'] : []),
    '', manifest.reusedHeader ? '上述复用页眉、菜单和内容块为只读共享资源；本任务只创建与修改新正文页面。' : '页眉布局、菜单和样式可分别修改；原组件实现与旧页面保持。',
    ...(editor.required ? [`编辑器与自动保存：${editor.status}${editor.complete ? '，已确认正常可编辑重开版本' : '；交付未完成，自动继续当前任务页的对齐及重开验证'}。`] : []),
  ].join('\n');
  return { version: 1, kind: 'clonewp-full-replica-delivery', taskId: input.taskId, runId: input.runId, status: input.status, complete, bodyStyleAmendment: input.bodyStyleAmendment ?? null, editorCompletion: editor, ...(!skipped && !editor.complete ? { nextAction: 'editor:complete prepare -> align/reconcile -> normal editor reopen -> recover --stdin if loading -> verify' } : {}), resources, publicUrl: input.checkpoints.published?.publicUrl ?? null, reviewStatus: skipped ? 'skipped-by-current-user-for-this-task' : review?.decision ?? 'pending', ...(skipped ? { reviewSkipPolicy: manifest.reviewSkipPolicy, unverifiedCapabilities: ['visual', 'interaction', 'editor-completion'] } : {}), reviewFingerprint: review?.fingerprint ?? null, lastError: input.lastError ?? null, markdown };
}

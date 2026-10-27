import type { FullReplicaRunState } from './types.js';
import { preparationJobStale, preparationStaleMinutes } from '../replica-preparation/lease.js';

/** A run that has not moved for this long is reported as stalled; the label is
 * derived on read and never rewrites the stored state. */
export const USER_PROGRESS_STALL_MS = 30 * 60_000;

export const USER_PROGRESS_STAGES = ['取证', '排版', '写入', '校对', '上线'] as const;

export interface PreparationProgressRow { jobId: string; status: string; startedAt?: string; leaseUntil?: string }
export interface PreparationProgress { merged: boolean; jobs: PreparationProgressRow[] }

export type UserStageState = 'done' | 'active' | 'blocked' | 'pending';
export interface UserProgressStage { key: string; label: string; status: UserStageState; detail: string }
export interface UserProgress {
  version: 1; step: number; total: 5; headline: string; waitingOn: string;
  needsYou: { action: string; reason: string } | null;
  stages: UserProgressStage[];
  stalled: boolean; stalledMinutes: number | null; stalledJobs: string[];
}

const stage = (key: string, label: string, status: UserStageState, detail: string): UserProgressStage => ({ key, label, status, detail });

/** Five user-facing stages over four internal state machines. Read-only: it
 * never decides completion, only reports where the task actually stands. */
export function fullReplicaUserProgress(state: FullReplicaRunState, preparation?: PreparationProgress | null, now = Date.now()): UserProgress {
  const checkpoints = state.checkpoints, published = !!checkpoints.published, bound = !!checkpoints.bound;
  const startedWriting = !!(checkpoints.header || checkpoints.page || checkpoints.body || bound);
  const decision = state.review?.decision ?? null, pending = !!state.pending, merged = preparation?.merged === true;
  const rows = preparation?.jobs ?? [];
  const stalledJobs = rows.filter(row => preparationJobStale(row, now)).map(row => row.jobId);
  const activeJob = rows.find(row => row.status === 'running' && !stalledJobs.includes(row.jobId));
  const quietMs = now - Date.parse(state.updatedAt);
  const quietMinutes = Number.isFinite(quietMs) ? Math.floor(Math.max(0, quietMs) / 60_000) : null;
  const staleJobMinutes = rows.map(row => preparationStaleMinutes(row, now)).filter((value): value is number => value !== null);
  const stalled = state.status !== 'published' && ((quietMinutes !== null && quietMinutes * 60_000 >= USER_PROGRESS_STALL_MS) || stalledJobs.length > 0);

  const capture = stage('capture', USER_PROGRESS_STAGES[0], 'done', '来源已采集（两桌面 + 两手机）');
  const layout = stage('layout', USER_PROGRESS_STAGES[1],
    startedWriting || merged ? 'done' : stalledJobs.length ? 'blocked' : 'active',
    merged ? '方案已合并为完整 manifest' : stalledJobs.length ? `准备代理无响应：${stalledJobs.join('、')}（已静默 ${staleJobMinutes[0] ?? 0} 分钟）` : activeJob ? `准备代理正在处理 ${activeJob.jobId}` : rows.length ? '等待准备代理开始' : '等待方案准备');
  const write = stage('write', USER_PROGRESS_STAGES[2],
    published ? 'done' : pending ? 'blocked' : bound ? 'done' : startedWriting ? 'active' : 'pending',
    published ? '正文、页眉、菜单已写入' : pending ? '写入结果未知，需要只读对账' : bound ? '正文已写入并绑定页眉' : startedWriting ? stalled ? '写入已中断，等待续跑' : '正在写入 WordPress' : '尚未开始写入');
  const review = stage('review', USER_PROGRESS_STAGES[3],
    published ? 'done' : pending ? 'pending' : bound ? decision === 'changes-required' ? 'blocked' : decision === 'approved' ? 'done' : 'active' : 'pending',
    published ? '整页视觉与交互已复核' : pending ? '等待写入对账完成' : decision === 'changes-required' ? '复核发现差异，等待判断' : decision === 'approved' ? '复核已通过' : bound ? stalled ? '复核已中断，等待续跑' : '正在核对两桌面截图与交互' : '等待写入完成');
  const publish = stage('publish', USER_PROGRESS_STAGES[4],
    published ? 'done' : decision === 'approved' ? 'active' : 'pending',
    published ? `已发布：${checkpoints.published!.publicUrl}` : decision === 'approved' ? '等待发布' : '等待复核通过');

  const stages = [capture, layout, write, review, publish];
  const current = pending ? write : decision === 'changes-required' ? review : [...stages].reverse().find(item => item.status !== 'done' && item.status !== 'pending') ?? stages[stages.length - 1];
  const step = published ? 5 : decision === 'approved' ? 5 : pending ? 3 : bound ? 4 : startedWriting ? 3 : 2;

  const needsYou = pending
    ? { action: '确认页面当前状态（只读对账）', reason: '上一次写入结果未知；系统不会自动重试，也不会覆盖你的修改' }
    : decision === 'changes-required' ? { action: '决定是否接受当前差异', reason: '复核发现差异，需要你判断这一版能否上线' }
    : decision === 'approved' && !published ? { action: '确认发布', reason: '复核已通过，等待发布授权' }
    : stalled ? { action: '确认任务是否还在运行', reason: `任务已静默 ${quietMinutes ?? 0} 分钟，可安全续跑` }
    : null;

  return {
    version: 1, step, total: 5,
    headline: `第 ${step} 步 / 共 5 步：${USER_PROGRESS_STAGES[step - 1]}`,
    waitingOn: stalled && !stalledJobs.length && quietMinutes !== null ? `${current.detail}（已静默 ${quietMinutes} 分钟）` : current.detail,
    needsYou, stages,
    stalled, stalledMinutes: !stalled ? null : stalledJobs.length ? Math.max(...staleJobMinutes, 0) : quietMinutes, stalledJobs,
  };
}

import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { readCurrentRelease, loadComponentRegistry } from '../components/registry.js';
import { componentCapabilitySummary } from '../components/capabilities.js';
import { withComponentReadMetrics } from '../components/io.js';
import { ContextReader, contextContained, contextId, contextSafeText, UNIFIED_ELEMENTOR_GUIDE } from './files.js';
import { contextRecordIdentity, contextRecordMode, scanContextIndex, selectContextRecords, validateContextIndex } from './index.js';
import { CONTEXT_INTENTS, type ContextContractIndex, type ContextIndex, type ContextIntent, type ContextLoadOptions, type ContextLoadResult } from './contracts.js';
import type { SystemRelease } from '../system/contracts.js';
import type { ComponentFileRef, ComponentRegistry } from '../components/types.js';
import { readNative44CurrentState, type Native44CurrentState } from '../native44/current-state.js';
import { readNative44Publication } from '../native44/publication.js';
import { resolveFinalDeliveryPolicy, finalDeliveryNextAction } from '../core/delivery-policy.js';
import { fullReplicaContext } from './full-replica.js';
import { headerModuleContext } from './header-module.js';

export interface ContextServices {
  readCurrentRelease(root: string, options?: { learningRelease?: ComponentFileRef | null }): Promise<SystemRelease>;
  loadComponentRegistry(root: string, usedTypes: readonly string[], options?: { learningRelease?: ComponentFileRef | null }): Promise<ComponentRegistry>;
}
const services: ContextServices = { readCurrentRelease, loadComponentRegistry };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const statuses = new Set(['pending', 'running', 'failed', 'completed', 'needs-review', 'interrupted', 'stale', 'awaiting-review', 'stage-passed', 'write-unknown', 'conflict', 'draft-saved', 'awaiting-comparison', 'delivered', 'restore-pending']);
const cssStatuses = new Set(['pending-comparison', 'pending-css-application', 'applied-verified']);
function safeIdentity(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['version', 'workflow', 'mode', 'executionStrategy', 'replicationProfile']) if (typeof data[key] === 'number' || typeof data[key] === 'string' && /^[a-zA-Z\d_-]{1,80}$/.test(data[key])) result[key] = data[key];
  for (const key of ['programHash', 'programSha256', 'sourceFactsHash', 'componentPlanHash', 'assetsManifestHash', 'selectionRulesHash', 'documentHash', 'finalHash']) if (typeof data[key] === 'string' && /^[a-f\d]{64}$/.test(data[key])) result[key] = data[key];
  for (const key of ['componentCatalog', 'knowledge']) { const ref = data[key] as Record<string, unknown> | undefined; if (ref && typeof ref === 'object' && typeof ref.sha256 === 'string' && /^[a-f\d]{64}$/.test(ref.sha256)) { result[key] = { sha256: ref.sha256, ...(typeof ref.fingerprint === 'string' && /^[a-f\d]{64}$/.test(ref.fingerprint) ? { fingerprint: ref.fingerprint } : {}) }; } }
  return result;
}
function stateFromRecord(data: Record<string, unknown>): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  if (typeof data.status === 'string' && statuses.has(data.status)) state.status = data.status;
  for (const key of ['deliveryComplete', 'completed', 'restored']) if (typeof data[key] === 'boolean') state[key] = data[key];
  if (typeof data.visualVerification === 'string' && cssStatuses.has(data.visualVerification)) state.visualVerification = data.visualVerification;
  if (Number.isSafeInteger(data.pageId) && Number(data.pageId) > 0) state.pageId = data.pageId;
  if (data.stage === 'desktop' || data.stage === 'responsive' || data.stage === 'final') state.stage = data.stage;
  if (Array.isArray(data.mutations)) { const counts: Record<string, number> = {}; for (const item of data.mutations) if (item && typeof item === 'object' && statuses.has(item.status) || item && typeof item === 'object' && ['intent', 'confirmed', 'retryable'].includes(item.status)) counts[item.status] = (counts[item.status] ?? 0) + 1; state.mutations = counts; }
  if (data.metrics && typeof data.metrics === 'object') { const metrics = data.metrics as Record<string, unknown>; state.metrics = Object.fromEntries(['bodyCommits', 'bodyWriteAttempts', 'editorSessions', 'documentRestores', 'uploadedBytes', 'mediaUploads', 'requestCount'].filter(key => typeof metrics[key] === 'number' && Number.isFinite(metrics[key])).map(key => [key, metrics[key]])); }
  return state;
}
function safeErrorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return /^(?:context|component|native44)_[a-z_]+(?::|$)/.test(text) ? text.split(':')[0] : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'context_file_missing' : 'context_load_failed';
}
function nextFor(intent: ContextIntent, state?: Record<string, unknown>): string {
  if (state?.publication) return '当前任务页面已发布；原草稿、CSS 与视觉复核证据保持原样。读取 DELIVERY.md 的未完成、小问题、未验证与已接受省略项；可运行 compare:replica -- <当前run目录> --verify-applied 只读核对公开状态。已发布页不继续自动修订，也不因功能清单未全部完成而重复生成。';
  const currentCapture = state?.currentCaptureReview as Native44CurrentState['currentCaptureReview'];
  if (currentCapture?.review === 'reviewed') return currentCapture.qualityFloor.status === 'blocked'
    ? '当前修订的双桌面视觉与实际组件检查复核已完成；质量底线仍有具名缺口，见 currentCaptureReview 及 delivery-summary.json / DELIVERY.md。先修对应组件或功能，再复核受影响范围；不要重复采集同一修订，也不能把未完成能力称为通过。原冻结合同、正文与 CSS 保留。'
    : '当前修订的双桌面视觉与实际组件检查复核已完成，达到本轮草稿质量底线；完整冻结合同能力覆盖仍未宣称完成。读取 delivery-summary.json / DELIVERY.md 的未完成、小问题与未验证项；不要重复同一修订截图，只有文档、CSS 或相关运行时变化后再复核。';
  const axes = state?.axes as Native44CurrentState['axes'];
  if (axes) {
    if (axes.delivery.status === 'delivered-with-open-items' && axes.delivery.complete) return '当前可用、可编辑草稿已完成实际复核并达到交付质量底线，完整需求仍未全部完成。读取 delivery-summary.json / DELIVERY.md 的具名待配置、未完成、小问题及未验证项；保留现有复核，不把这些缺口说成已实现，也不重复同一修订截图。';
    if (axes.delivery.complete) return '当前修订已完成实际双桌面复核及验收；保留已接受差异说明。仅需按后续请求只读核对远端当前所有权与文档，不重新生成旧正文或重复截图。';
    if (axes.review.status === 'stale' || axes.requirements.status === 'stale') return axes.review.status === 'reviewed' ? '当前修订视觉复核已完成，但需求验收证据过期；补齐具名验收记录，保留已有当前截图，不重复视觉采集或沿用旧完成状态。' : '已有复核或验收证据与当前修订不一致；按具名过期项补充当前证据，保留历史记录，禁止沿用旧完成状态。';
    if (axes.review.status === 'reviewed') return axes.requirements.status === 'blocked' ? '当前修订的双桌面视觉复核已完成；处理 requirements 中具名未满足项或明确的验收决定。能力缺口不等于未截图，不要重复同一修订的视觉采集。' : '当前修订的双桌面视觉复核已完成；补齐当前 requirement 检查或验收观察，无须重复已有截图，不能自行宣称全部要求通过。';
    return '当前修订与 CSS 已保存，尚无当前修订的完整双桌面视觉复核。采集并绑定当前报告及验收观察；旧正文生成已冻结。';
  }
  if (state?.authority === 'verified-local-evidence') return state.deliveryComplete ? '当前修订已有双桌面视觉、组件与 CSS 复核证据；原 journal/program 仅为历史。运行 compare:replica -- <当前run目录> --verify-applied 可读取当前 owned draft，与 currentSnapshot/currentCSS 及已绑定复核核对；新像素判断仍须重新截图，禁止旧正文生成。' : '当前修订已保存，视觉复核待完成；compare:replica -- <当前run目录> --verify-applied 可只读核对 currentSnapshot/currentCSS，但不得继承旧截图完成状态。绑定当前修订重新截图及复核，更新报告后再标完成；原正文生成已冻结。';
  if (state?.status === 'write-unknown') return '只读核对实际文档与写前意图；确认 before/after 后再决定恢复，不盲重试。';
  if (state?.status === 'conflict' || state?.status === 'restore-pending') return '保留当前文档并解决具名冲突或恢复缺口；不得继续自动写入。';
  if (state?.deliveryComplete || state?.status === 'delivered') return '保留手工修改；仅按当前用户要求执行只读比较或 CSS 应用后复核。';
  return ({ replica: '从用户已打开的确切浏览器标签取得两个桌面观察；新任务不继承旧任务。', learn: '从用户已打开标签取得有范围的学习证据，整理通用结论；不自动启用新组件。', compare: '读取选定 run 的冻结比较合同，保持目标写入为零。', resume: '读取选定任务原有合同，并只读核对当前文档与所有权后续跑。', maintain: '依据当前请求检查通用工具和相关专项测试；本地能力摘要不等于站点验证。' })[intent];
}
async function validateFrozenRef(reader: ContextReader, ref: unknown, historicalReadOnly = false): Promise<Record<string, unknown>> {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw Error('context_release_ref_invalid');
  const { path: filename, sha256 } = ref as Record<string, unknown>;
  if (typeof filename !== 'string' || typeof sha256 !== 'string' || !/^[a-f\d]{64}$/.test(sha256)) throw Error('context_release_ref_invalid');
  const record = await reader.json(filename); if (record.sha256 !== sha256) throw Error('context_release_hash_mismatch');
  if (record.data.kind !== 'native44-release-lock' || record.data.version !== 1 || !['draft', 'final'].includes(String(record.data.phase)) || record.data.replicationProfile !== 'desktop-browser-v1' || typeof record.data.createdAt !== 'string' || !Number.isFinite(Date.parse(record.data.createdAt)) || typeof record.data.taskId !== 'string' || !/^[a-zA-Z\d][a-zA-Z\d_-]{0,159}$/.test(record.data.taskId) || Object.keys(record.data).some(key => !['version', 'kind', 'phase', 'taskId', 'replicationProfile', 'createdAt', 'release', 'program', 'inputs'].includes(key))) throw Error('context_release_identity_invalid');
  if (record.data.phase === 'draft' && (record.data.program !== undefined || record.data.inputs !== undefined)) throw Error('context_release_identity_invalid');
  const release = safeReleaseMetadata(reader, record.data.release);
  for (const reference of historicalReadOnly ? [] : [release.componentSet.catalog, release.knowledge.index, ...release.selectionRules.files, ...release.adapters.files]) {
    if ((await reader.read(reference.path, 16 * 1024 * 1024)).sha256 !== reference.sha256) throw Error('context_release_contract_hash_mismatch');
  }
  if (record.data.phase === 'final') {
    const program = record.data.program as { path?: unknown; sha256?: unknown } | undefined;
    if (!program || typeof program.path !== 'string' || typeof program.sha256 !== 'string' || (await reader.read(program.path, 8 * 1024 * 1024)).sha256 !== program.sha256) throw Error('context_release_program_hash_mismatch');
    const inputs = record.data.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || Object.keys(inputs).sort().join(',') !== 'assetsManifest,componentCatalog,componentPlan,knowledge,sourceFacts') throw Error('context_release_inputs_invalid');
    for (const [kind, value] of Object.entries(inputs)) { const ref = value as { path?: unknown; sha256?: unknown }; const limit = kind === 'sourceFacts' ? 64 * 1024 * 1024 : 16 * 1024 * 1024; if (!ref || typeof ref.path !== 'string' || typeof ref.sha256 !== 'string' || (await reader.read(ref.path, limit)).sha256 !== ref.sha256) throw Error('context_release_input_hash_mismatch'); }
  }
  return record.data;
}
function safeReleaseMetadata(reader: ContextReader, value: unknown): SystemRelease {
  const release = value as SystemRelease;
  const ref = (value: unknown): { path: string; sha256: string } => { const item = value as { path: unknown; sha256: unknown }; if (!item || typeof item.path !== 'string' || /[?\n\r]|^[a-z]+:\/\//i.test(item.path) || typeof item.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(item.sha256)) throw Error('context_release_metadata_invalid'); contextContained(reader.root, path.resolve(reader.root, item.path)); return { path: item.path, sha256: item.sha256 }; };
  const identifier = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-zA-Z\d_-]{1,160}$/.test(value)) throw Error('context_release_metadata_invalid'); return value; };
  if (!release || release.version !== 1 || release.executorId !== 'native44' || !Array.isArray(release.componentSet?.types) || !Array.isArray(release.selectionRules?.files) || !Array.isArray(release.adapters?.files)) throw Error('context_release_metadata_invalid');
  const hash = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-f\d]{64}$/.test(value)) throw Error('context_release_metadata_invalid'); return value; };
  return { version: 1, executorId: 'native44',...(release.componentExtension?{componentExtension:ref(release.componentExtension)}:{}), componentSet: { id: identifier(release.componentSet.id), catalog: ref(release.componentSet.catalog), types: release.componentSet.types.map(identifier) }, knowledge: { id: identifier(release.knowledge.id), index: ref(release.knowledge.index), fingerprint: hash(release.knowledge.fingerprint), ...(release.knowledge.learningRelease ? { learningRelease: ref(release.knowledge.learningRelease) } : {}) }, selectionRules: { id: identifier(release.selectionRules.id), sha256: hash(release.selectionRules.sha256), files: release.selectionRules.files.map(ref) }, adapters: { id: identifier(release.adapters.id), sha256: hash(release.adapters.sha256), files: release.adapters.files.map(ref) } };
}

/** A cache miss is not permission to enumerate or guess another run. Resolve
 * only the explicitly named derived journal through an indexed parent and its
 * fully verified successor graph, then add a transient identity-only entry. */
async function resolveMissingDerivedRun(reader: ContextReader, index: ContextIndex, options: ContextLoadOptions): Promise<{ index: ContextIndex; proof: Native44CurrentState } | undefined> {
  if (!contextId(options.run) || index.runs.some(run => run.runId === options.run)) return undefined;
  let child: Awaited<ReturnType<ContextReader['json']>>;
  try { child = await reader.json(`runs/${options.run}/journal.json`); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const data = child.data, derivation = data.derivation as Record<string, unknown> | undefined;
  if (!derivation || typeof derivation !== 'object' || Array.isArray(derivation)) return undefined;
  if (data.runId !== options.run || !contextId(data.taskId) || data.executionStrategy !== 'native44-css-handoff' || contextRecordMode(data) !== 'replica' || !contextId(derivation.parentRunId)) throw Error('context_derived_run_identity_invalid');
  if (options.task && options.task !== data.taskId) throw Error('context_run_not_found_or_task_conflict');
  const parent = index.runs.find(run => run.runId === derivation.parentRunId);
  if (!parent || parent.mode !== 'replica' || parent.recordKind !== 'journal' || parent.taskId !== data.taskId) throw Error('context_derived_run_parent_not_indexed');
  const parentFile = await reader.json(parent.record.path), parentPath = `runs/${parent.runId}/journal.json`;
  if (path.relative(reader.root, parentFile.path).split(path.sep).join('/') !== parentPath || contextRecordIdentity(parentFile.data) !== parent.record.identityHash || parentFile.data.runId !== parent.runId || parentFile.data.taskId !== data.taskId || contextRecordMode(parentFile.data) !== 'replica') throw Error('context_derived_run_parent_identity_conflict');
  const proof = await readNative44CurrentState(reader.root, path.join(reader.root, 'runs', parent.runId), { runId: parent.runId, taskId: data.taskId, ...(Number.isSafeInteger(parentFile.data.pageId) ? { pageId: Number(parentFile.data.pageId) } : {}) });
  const route = proof?.successorRoutes?.find(item => item.parentRunId === parent.runId && item.successorRunId === options.run && item.successorPageId === data.pageId);
  if (!proof || proof.taskId !== data.taskId || !route) throw Error('context_derived_run_successor_unproven');
  return { index: { ...index, runs: [...index.runs, { runId: options.run, taskId: data.taskId, mode: 'replica', recordKind: 'journal', record: { path: child.path, identityHash: contextRecordIdentity(data) } }] }, proof };
}
/** Local context only. There is intentionally no config/client/browser/write dependency. */
export async function loadContext(options: ContextLoadOptions, dependencies: ContextServices = services): Promise<ContextLoadResult> {
  const started = performance.now(); let reader: ContextReader | undefined, libraryFilesRead = 0, libraryBytesRead = 0;
  let automaticComponents: string[] = [], frozenRelease: SystemRelease | undefined, indexedContracts: ContextContractIndex | undefined, taskUsesNative44: boolean | undefined, legacyNative44Task = false;
  let currentRevision: Native44CurrentState | undefined;
  const result: ContextLoadResult = { status: 'blocked', exitCode: 1, intent: options.intent, documents: [], records: [], components: [], gaps: [], nextAction: '', metrics: { elapsedMs: 0, filesRead: 0, bytesRead: 0, networkRequests: 0, credentialLoads: 0, browserStarts: 0, fileWrites: 0 } };
  try {
    if (!CONTEXT_INTENTS.includes(options.intent)) throw Error('context_intent_invalid');
    if (options.components && (new Set(options.components).size !== options.components.length || options.components.some(type => !/^[a-zA-Z][a-zA-Z\d_-]{0,100}$/.test(type)))) throw Error('context_components_invalid');
    reader = new ContextReader(await realpath(options.root));
    const full = await fullReplicaContext(reader.root, options, bytes => { libraryFilesRead++; libraryBytesRead += bytes; })
      ?? await headerModuleContext(reader.root, options, bytes => { libraryFilesRead++; libraryBytesRead += bytes; });
    if (full) {
      Object.assign(result, full);
      for (const name of ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md', '.agents/skills/reference-elementor/SKILL.md']) {
        const file = await reader.read(name, 262144); result.documents.push({ path: file.path, sha256: file.sha256, bytes: file.bytes.length, reason: '完整复刻续跑的项目权威文档。', content: contextSafeText(file.bytes.toString('utf8')) });
      }
      return result;
    }
    const freshBuild = !options.task && !options.run && options.intent === 'replica';
    const documents = ['AGENTS.md', 'SYSTEM.md', 'COMPONENTS.md', '.agents/skills/clonewp/SKILL.md'];
    if (freshBuild) documents.push(UNIFIED_ELEMENTOR_GUIDE);
    let selectedMode: 'replica' | undefined;
    if (options.task || options.run || options.intent === 'resume' || options.intent === 'compare') {
      let index;
      try { index = validateContextIndex((await reader.json('data/system/context-index.json')).data); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; index = await scanContextIndex(reader.root, reader); }
      let selected: ReturnType<typeof selectContextRecords>;
      try { selected = selectContextRecords(index, options); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'context_run_not_found_or_task_conflict') throw error;
        const resolved = await resolveMissingDerivedRun(reader, index, options); if (!resolved) throw error;
        index = resolved.index; result.records.push(...resolved.proof.evidence);
        libraryFilesRead += resolved.proof.evidence.length; libraryBytesRead += resolved.proof.evidence.reduce((total, file) => total + file.bytes, 0);
        selected = selectContextRecords(index, options);
      }
      // Resolve explicit, verified successor routes rather than choosing by
      // recency when the same task has both historical and replacement runs.
      if (selected.candidates && selected.candidates.length > 1 && selected.candidates.every(candidate => candidate.runId && candidate.taskId === selected.candidates![0].taskId)) {
        const resolved: Array<Native44CurrentState | undefined> = [];
        for (const candidate of selected.candidates) {
          const state = await readNative44CurrentState(reader.root, path.join(reader.root, 'runs', candidate.runId!), { taskId: candidate.taskId, runId: candidate.runId }); resolved.push(state);
          if (state) { libraryFilesRead += state.evidence.length; libraryBytesRead += state.evidence.reduce((total, item) => total + item.bytes, 0); }
        }
        const target = resolved[0];
        if (target && resolved.every(state => state?.taskId === target.taskId && state.runId === target.runId && state.pageId === target.pageId && state.documentHash === target.documentHash)) selected = selectContextRecords(index, { task: target.taskId, run: target.runId });
      }
      if (selected.candidates) { result.status = 'needs-task-selection'; result.exitCode = 2; result.candidates = selected.candidates; result.nextAction = selected.candidates.length ? '请明确任务 ID 或 run ID；不按最近时间选择。' : '没有可识别任务；请提供任务或 run ID。'; }
      else {
        let job: Record<string, unknown> | undefined, runtime: Record<string, unknown> | undefined, scope: NonNullable<ContextLoadResult['task']>['scope'], frozenProgramRef: { path: string; sha256: string } | undefined;
        for (const [kind, reference] of [['job', selected.task?.job], ['runtime', selected.run?.record]] as const) if (reference) {
          const file = await reader.json(reference.path);
          const relative = path.relative(reader.root, file.path).split(path.sep).join('/');
          if (kind === 'job' && (!/^references\/[^/]+\/job\.json$/.test(relative) || ![file.data.taskId, file.data.jobId].includes(path.basename(path.dirname(file.path)))) || kind === 'runtime' && relative !== `runs/${selected.run!.runId}/${selected.run!.recordKind}.json`) throw Error('context_index_record_path_conflict');
          if (contextRecordIdentity(file.data) !== reference.identityHash) throw Error('context_index_stale_identity');
          if (contextRecordMode(file.data) !== (selected.task?.mode ?? selected.run?.mode)) throw Error('context_record_mode_conflict');
          if (kind === 'job') { if ((file.data.taskId ?? file.data.jobId) !== selected.task!.taskId) throw Error('context_index_stale_task'); job = file.data; }
          else { if (file.data.runId !== selected.run!.runId || file.data.taskId !== undefined && file.data.taskId !== selected.task?.taskId && file.data.taskId !== selected.run?.taskId) throw Error('context_index_stale_run'); runtime = file.data; }
          result.records.push({ path: file.path, sha256: file.sha256, bytes: file.bytes.length, reason: kind === 'job' ? '真实任务身份；不输出自由文本或网站会话。' : '现场读取 journal/result 状态；索引不保存可变状态。' });
        }
        if (runtime && job && runtime.taskId === undefined && job.runId !== runtime.runId && !(typeof runtime.inputDesignPath === 'string' && path.dirname(path.resolve(reader.root, runtime.inputDesignPath)) === path.dirname(selected.task!.job.path))) throw Error('context_index_run_task_unproven');
        if (runtime && job) for (const key of ['executionStrategy', 'replicationProfile', 'selectionRulesHash']) if ((runtime[key] !== undefined || job[key] !== undefined) && runtime[key] !== job[key]) throw Error('context_job_run_contract_conflict');
        if (selected.task) {
          try {
            const file = await reader.json(path.join(path.dirname(selected.task.job.path), 'task-scope.json')), value = file.data;
            const v2 = value.version === 2;
            if (value.version !== 1 && value.version !== 2 || value.kind !== 'clonewp-task-scope' || value.taskId !== selected.task.taskId || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 3000 || !Array.isArray(value.constraints) || value.constraints.length > 100 || value.constraints.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000) || Object.keys(value).sort().join(',') !== (v2 ? 'catalogAreaOmissions,constraints,kind,summary,taskId,version' : 'constraints,kind,summary,taskId,version')) throw Error('context_task_scope_invalid');
            if (v2 && (!Array.isArray(value.catalogAreaOmissions) || value.catalogAreaOmissions.length > 1000 || value.catalogAreaOmissions.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'action,componentId,groupId,snapshotId,userInstruction' || ['snapshotId', 'groupId', 'componentId'].some(key => typeof item[key] !== 'string' || !/^[a-zA-Z\d][a-zA-Z\d_.-]{0,159}$/.test(item[key])) || !['leave-product-area-empty', 'remove-product-area'].includes(item.action) || typeof item.userInstruction !== 'string' || !item.userInstruction.trim() || item.userInstruction.length > 4096))) throw Error('context_task_scope_invalid');
            scope = { summary: contextSafeText(value.summary), constraints: value.constraints.map(contextSafeText), authority: 'descriptive-not-authorization' };
            result.records.push({ path: file.path, sha256: file.sha256, bytes: file.bytes.length, reason: '本任务范围说明；不授予操作权限，不替代 journal 或当前用户要求。' });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        const selectedRecordMode = selected.task?.mode ?? selected.run?.mode;
        if (selectedRecordMode !== 'replica') throw Error('context_retired_workflow');
        selectedMode = selectedRecordMode;
        taskUsesNative44 = (job?.executionStrategy ?? runtime?.executionStrategy) === 'native44-css-handoff';
        legacyNative44Task = taskUsesNative44 && !job?.releaseLock && !runtime?.releaseLock;
        if (taskUsesNative44 && selected.run) {
          currentRevision = await readNative44CurrentState(reader.root, path.join(reader.root, 'runs', selected.run.runId), { taskId: selected.task?.taskId ?? selected.run.taskId, runId: selected.run.runId, ...(runtime?.pageId ? { pageId: Number(runtime.pageId) } : {}), ...(typeof runtime?.documentHash === 'string' ? { documentHash: runtime.documentHash } : {}) });
          if (currentRevision) {
            result.records.push(...currentRevision.evidence);
            libraryFilesRead += currentRevision.evidence.length; libraryBytesRead += currentRevision.evidence.reduce((total, item) => total + item.bytes, 0);
            scope = { summary: contextSafeText(currentRevision.requestedScope), constraints: ['Current revision is read-only; original scope, program and journal are historical evidence.'], authority: 'descriptive-not-authorization' };
          }
        }
        if (taskUsesNative44 && !currentRevision && !legacyNative44Task && index.contracts) {
          for (const ref of [index.contracts.componentSet.ref, index.contracts.knowledge.ref, ...index.contracts.selectionRules.files, ...index.contracts.adapters.files]) if ((await reader.read(ref.path, 16 * 1024 * 1024)).sha256 !== ref.sha256) throw Error('context_index_contract_stale');
          indexedContracts = index.contracts;
        }
        if (selected.run && !selected.task) result.gaps.push({ code: 'context_orphan_run_task_link_unverified', path: selected.run.runId });
        const state: Record<string, unknown> = currentRevision ? { status: currentRevision.status, deliveryComplete: currentRevision.deliveryComplete, completed: currentRevision.deliveryComplete, visualVerification: currentRevision.visualVerification, pageId: currentRevision.pageId, documentHash: currentRevision.documentHash, originalDocumentHash: currentRevision.originalDocumentHash, authority: currentRevision.authority, unpublished: true, currentSnapshot: currentRevision.currentSnapshot, currentCSS: currentRevision.currentCSS, ...(currentRevision.currentManifest ? { currentManifest: currentRevision.currentManifest } : {}), ...(currentRevision.axes ? { axes: currentRevision.axes, goalProfile: currentRevision.goalProfile, requirementsComplete: currentRevision.requirementsComplete, draftReady: currentRevision.draftReady, observedAt: currentRevision.observedAt, reviewedAt: currentRevision.reviewedAt, currentManifest: currentRevision.currentManifest, cssModel: currentRevision.cssModel } : {}), ...(currentRevision.currentCaptureReview ? { currentCaptureReview: currentRevision.currentCaptureReview, requirementsComplete: currentRevision.requirementsComplete, draftReady: currentRevision.draftReady, deliveryReady: currentRevision.currentCaptureReview.deliveryReady, observedAt: currentRevision.observedAt, reviewedAt: currentRevision.reviewedAt } : {}), ...(currentRevision.verification ? { verification: currentRevision.verification, visualReview: currentRevision.visualReview } : {}), ...(currentRevision.resolvedFrom ? { resolvedFrom: currentRevision.resolvedFrom, successorRoutes: currentRevision.successorRoutes } : {}), counts: currentRevision.counts, historicalRuntimeStatus: runtime?.status } : stateFromRecord(runtime ?? job ?? {}), frozenIdentity = { ...safeIdentity(job ?? {}), ...safeIdentity(runtime ?? {}) };
        if (job?.releaseLock || runtime?.releaseLock) {
          if (job?.releaseLock && runtime?.releaseLock && canonical(job.releaseLock) !== canonical(runtime.releaseLock)) throw Error('context_release_ref_conflict');
          const lock = await validateFrozenRef(reader, job?.releaseLock ?? runtime?.releaseLock, !!currentRevision);
          if (lock.taskId !== (selected.task?.taskId ?? selected.run?.taskId)) throw Error('context_release_task_conflict');
          // The release service performs the executable-contract checks on resume.
          // Context exposes immutable identity metadata and cannot authorize writes.
          frozenRelease = safeReleaseMetadata(reader, lock.release); frozenIdentity.release = frozenRelease; frozenIdentity.releasePhase = lock.phase;
          if (lock.phase === 'final') frozenProgramRef = lock.program as { path: string; sha256: string };
          if (lock.replicationProfile !== 'desktop-browser-v1' || job?.replicationProfile !== undefined && job.replicationProfile !== lock.replicationProfile || runtime?.replicationProfile !== undefined && runtime.replicationProfile !== lock.replicationProfile) throw Error('context_release_profile_conflict');
          if (job?.selectionRulesHash !== undefined && job.selectionRulesHash !== frozenRelease.selectionRules.sha256 || runtime?.selectionRulesHash !== undefined && runtime.selectionRulesHash !== frozenRelease.selectionRules.sha256) throw Error('context_release_selection_rules_conflict');
        }
        const selectedProgramPath = typeof job?.programPath === 'string' ? job.programPath : frozenProgramRef?.path;
        if (selectedProgramPath) {
          const file = await reader.read(selectedProgramPath, 8 * 1024 * 1024), program = JSON.parse(file.bytes.toString('utf8')) as Record<string, unknown>;
          if (!program || typeof program !== 'object' || Array.isArray(program) || contextRecordMode(program) !== selectedMode) throw Error('context_selected_program_mode_conflict');
          if (frozenProgramRef && (await realpath(path.resolve(reader.root, frozenProgramRef.path)) !== file.path || frozenProgramRef.sha256 !== file.sha256)) throw Error('context_selected_program_release_conflict');
          if (taskUsesNative44 && program.taskId !== (selected.task?.taskId ?? selected.run?.taskId)) throw Error('context_selected_program_task_conflict');
          for (const key of ['executionStrategy', 'replicationProfile', 'selectionRulesHash']) if (program[key] !== (job?.[key] ?? runtime?.[key])) throw Error('context_selected_program_contract_conflict');
          if (taskUsesNative44 && job?.url !== undefined && program.sourceUrl !== job.url) throw Error('context_selected_program_source_conflict');
          if (runtime?.programHash !== undefined && runtime.programHash !== file.sha256 || runtime?.programSha256 !== undefined && runtime.programSha256 !== file.sha256) throw Error('context_selected_program_hash_mismatch');
          const found = new Set<string>();
          const visit = (value: unknown): void => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(visit); return; } const node = value as Record<string, unknown>; if (typeof node.widgetType === 'string' && /^[a-zA-Z][a-zA-Z\d_-]{0,100}$/.test(node.widgetType)) found.add(node.widgetType); for (const key of ['blocks', 'children', 'slides']) if (node[key]) visit(node[key]); };
          visit(program); automaticComponents = [...found];
          result.records.push({ path: file.path, sha256: file.sha256, bytes: file.bytes.length, reason: '读取所选任务的实际组件身份；不输出页面内容或业务字段。' });
        }
        result.task = { taskId: currentRevision?.taskId ?? selected.task?.taskId ?? selected.run?.taskId, runId: currentRevision?.runId ?? selected.run?.runId, mode: selectedMode!, state, frozenIdentity, ...(scope ? { scope } : {}) };
        const runHasDeliveryPolicy = runtime?.finalDeliveryPolicy !== undefined, taskHasDeliveryPolicy = job?.finalDeliveryPolicy !== undefined;
        if (runHasDeliveryPolicy && taskHasDeliveryPolicy && canonical(resolveFinalDeliveryPolicy(runtime)) !== canonical(resolveFinalDeliveryPolicy(job))) throw Error('context_final_delivery_policy_conflict');
        const finalDeliveryPolicy = resolveFinalDeliveryPolicy(runHasDeliveryPolicy ? runtime : taskHasDeliveryPolicy ? job : runtime ?? job ?? {}); state.finalDeliveryPolicy = finalDeliveryPolicy;
        if (currentRevision) {
          const publication = await readNative44Publication(reader.root, currentRevision);
          if (publication) { state.publication = publication; state.status = publication.status; state.unpublished = false; state.documentHash = publication.documentHash; state.historicalReviewedDocumentHash = currentRevision.documentHash; }
        }
        result.nextAction = nextFor(options.intent, state);
        if (!state.publication && finalDeliveryPolicy.desiredPageStatus === 'publish') result.nextAction += !result.task.runId
          ? ' 此新任务已冻结最终直接发布偏好；先构建本任务草稿并完成当前视觉、交互和质量底线复核，再按生成的 run 执行 publication finalize，无需再次询问。'
          : runHasDeliveryPolicy ? ` ${finalDeliveryNextAction(finalDeliveryPolicy, result.task.runId)}`
            : ' 任务记录有直接发布偏好，但当前旧 run 未冻结发布策略；此偏好不能自动补入旧 run，需当前明确发布指令的独立 publication prepare/apply 事务。';
      }
    }
    if (selectedMode === 'replica' || ['replica', 'compare'].includes(options.intent)) documents.push('.agents/skills/reference-elementor/SKILL.md');
    for (const name of [...new Set(documents)]) { const file = await reader.read(name, 262_144); result.documents.push({ path: file.path, sha256: file.sha256, bytes: file.bytes.length, reason: name === 'AGENTS.md' ? '项目自动入口和长期保护规则。' : '当前意图的项目内权威文档。', content: contextSafeText(file.bytes.toString('utf8')) }); }
    if (currentRevision) result.contractSelection = 'task-amendment-read-only';
    if (!currentRevision && !(selectedMode === 'replica' && taskUsesNative44 === false)) {
      const requestedComponents = options.components ?? automaticComponents;
      const releaseOptions = frozenRelease ? { learningRelease: frozenRelease.knowledge.learningRelease ?? null } : legacyNative44Task ? { learningRelease: null } : undefined;
      const library = await withComponentReadMetrics(async () => ({ release: await dependencies.readCurrentRelease(reader!.root, releaseOptions), registry: await dependencies.loadComponentRegistry(reader!.root, requestedComponents, releaseOptions) }), metrics => { libraryFilesRead += metrics.filesRead; libraryBytesRead += metrics.bytesRead; });
      result.contractSelection = frozenRelease ? 'task-frozen' : legacyNative44Task ? 'legacy-task-base-only' : 'current-default';
      result.currentRelease = safeReleaseMetadata(reader, library.value.release);
      if (indexedContracts) { const release = result.currentRelease as SystemRelease; const currentContracts: ContextContractIndex = { componentSet: { id: release.componentSet.id, ref: release.componentSet.catalog }, knowledge: { id: release.knowledge.id, fingerprint: release.knowledge.fingerprint, ref: release.knowledge.index }, selectionRules: release.selectionRules, adapters: release.adapters }; if (canonical(indexedContracts) !== canonical(currentContracts)) throw Error('context_index_contract_identity_stale'); }
      if (frozenRelease && canonical(frozenRelease) !== canonical(result.currentRelease)) throw Error('context_locked_contract_drift');
      const registry = library.value.registry;
      // Fresh planning reads the unified guide. Historical candidates remain available
      // for learning/maintenance and for tasks whose release already froze them.
      if (!freshBuild && registry.pagePatterns) result.pagePatterns = { release: registry.knowledge.learningRelease ?? null, scope: 'candidate-page-patterns-not-execution-permission', total: registry.pagePatterns.total, entries: registry.pagePatterns.entries.map(entry => ({ learningId: entry.learningId, recordRef: entry.recordRef, conclusionStatus: entry.conclusionStatus, conclusionCount: entry.conclusionCount, conclusions: entry.conclusions.map(item => ({ responsibility: contextSafeText(item.responsibility), statement: contextSafeText(item.statement), statementTruncated: item.statementTruncated, evidenceIndexes: [...item.evidenceIndexes] })), evidenceCount: entry.evidenceCount, evidence: entry.evidence.map(item => ({ path: item.path, sha256: item.sha256, kind: contextSafeText(item.kind), scope: contextSafeText(item.scope) })) })), additionalRecordRefs: registry.pagePatterns.additionalRecordRefs };
      result.components = registry.entries.map(entry => ({ widgetType: entry.widgetType, activation: entry.activation, provider: contextSafeText(entry.provider), contentModel: contextSafeText(entry.contentModel), suitableFor: entry.suitableFor.map(contextSafeText), restrictions: entry.restrictions.map(contextSafeText), dependencies: entry.resourceDependencies.map(contextSafeText), contractRefs: entry.contractRefs, recipeRefs: entry.recipeRefs, qualifications: Object.fromEntries(Object.entries(entry.qualifications).map(([key, value]) => [key, { status: value.status, scope: contextSafeText(value.scope), evidence: value.evidence, limitations: value.limitations.map(contextSafeText) }])) }));
      result.capabilities = componentCapabilitySummary(registry.adapters);
      for (const type of requestedComponents) { const adapterGap = registry.adapters.flatMap(item => item.unavailableDependencies[type] ?? []); if (adapterGap.length) result.gaps.push({ code: 'context_component_resource_adapter_unverified', path: type }); }
    }
    if (result.status !== 'needs-task-selection') { result.status = 'ready'; result.exitCode = 0; result.nextAction ||= nextFor(options.intent); }
  } catch (error) { result.status = 'blocked'; result.exitCode = 1; const detail = error instanceof Error ? /^native44_current_[a-z_]+: ([a-zA-Z\d_./\\-]+)$/.exec(error.message)?.[1] : undefined; result.gaps.push({ code: safeErrorCode(error), ...(detail ? { path: detail } : {}) }); result.nextAction = '修复具名本地引用、版本或任务选择问题后重新读取；不自动更换任务或合同。'; }
  finally { result.metrics.elapsedMs = Math.round(performance.now() - started); result.metrics.filesRead = (reader?.filesRead ?? 0) + libraryFilesRead; result.metrics.bytesRead = (reader?.bytesRead ?? 0) + libraryBytesRead; }
  return result;
}

import path from 'node:path';
import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import { validateFullReplicaManifest, fullReplicaHash } from '../replica-full/contract.js';
import { isPublicReplica, validatePublicReplicaManifest } from '../replica-full/public-contract.js';
import { contextContained, contextHash, contextId } from './files.js';
import type { ContextLoadOptions, ContextLoadResult } from './contracts.js';

/** Full runs have their own state/manifest contract; never synthesize legacy jobs. */
export async function fullReplicaContext(root: string, options: ContextLoadOptions, onRead?: (bytes: number) => void): Promise<Partial<ContextLoadResult> | undefined> {
  if ((!options.run && !options.task) || !['resume', 'compare'].includes(options.intent)) return;
  if (options.run && !contextId(options.run) || options.task && !contextId(options.task)) throw Error('context_selector_invalid');
  let directories; try { directories = await readdir(path.join(root, 'runs'), { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  if (directories.length > 10000) throw Error('context_index_directory_limit');
  const records: ContextLoadResult['records'] = [];
  const read = async (filename: string, reason: string, record = true, json = true) => {
    const resolved = path.resolve(root, filename); contextContained(root, resolved);
    let current = root; for (const segment of path.relative(root, resolved).split(path.sep)) { current = path.join(current, segment); if ((await lstat(current)).isSymbolicLink()) throw Error('context_full_reparse_path'); }
    const actual = await realpath(resolved); contextContained(root, actual);
    const info = await lstat(actual); if (!info.isFile() || info.size > 32 * 1024 * 1024) throw Error('context_file_too_large');
    const bytes = await readFile(actual); onRead?.(bytes.length);
    const item = { path: actual, sha256: contextHash(bytes), bytes: bytes.length, reason };
    if (record) records.push(item); return { ...item, data: json ? JSON.parse(bytes.toString('utf8')) : undefined };
  };
  const candidates: Array<{ directory: string; state: any }> = [];
  for (const entry of directories) {
    if (!entry.isDirectory() || !contextId(entry.name)) continue;
    let file; try { file = await read(`runs/${entry.name}/state.json`, '完整复刻状态', false); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    const s = file.data;
    if (['clonewp-full-replica-run','clonewp-public-replica-run'].includes(s.kind) && (!options.run || s.runId === options.run || entry.name === options.run) && (!options.task || s.taskId === options.task)) candidates.push({ directory: entry.name, state: s });
  }
  if (!candidates.length) return;
  if (candidates.length > 1) return { status: 'needs-task-selection', exitCode: 2, candidates: candidates.map(c => ({ taskId: c.state.taskId, runId: c.directory, mode: 'replica' })), nextAction: '存在多个匹配的完整复刻记录，请指定精确 run 目录名。' };
  const { directory, state } = candidates[0];
  await read(`runs/${directory}/state.json`, '本任务完整复刻检查点；未知写入必须先对账。');
  const file = await read(`runs/${directory}/manifest.json`, '本任务冻结完整复刻合同，不套用旧组件任务默认。');
  if(isPublicReplica(file.data)){
    const manifest=validatePublicReplicaManifest(file.data);
    if(state.kind!=='clonewp-public-replica-run'||state.version!==1||state.taskId!==manifest.taskId||state.runId!==manifest.runId||state.manifestHash!==fullReplicaHash(manifest))throw Error('context_full_manifest_identity_conflict');
    for(const ref of [manifest.sourceEvidence,manifest.footer?.program,manifest.footer?.assets,manifest.footer?.responsive.source].filter(Boolean)){const actual=await read(ref!.path,'公共资源任务冻结输入。');if(actual.sha256!==ref!.sha256)throw Error('context_full_input_changed');}
    if(manifest.footer){const css=await read(manifest.footer.css.path,'冻结页脚 CSS。',true,false);if(css.sha256!==manifest.footer.css.sha256)throw Error('context_full_input_changed');}
    const pending=!!state.pending||!!state.headerPending;
    return {status:'ready',exitCode:0,records,contractSelection:'task-frozen',task:{taskId:manifest.taskId,runId:manifest.runId,mode:'replica',state:{status:state.status,pending,pageId:state.snapshot?.snapshot?.preview?.id,runDirectory:path.join(root,'runs',directory),deliveryPolicy:manifest.deliveryPolicy,pageScope:manifest.pageScope},frozenIdentity:{version:manifest.version,manifestHash:state.manifestHash,sourceUrl:manifest.sourceUrl}},nextAction:pending?'使用精确 run 只读 reconcile，不重试未知写入。':'按冻结公共资源范围继续；草稿交付待用户检查，不改全站绑定。'};
  }
  const manifest = validateFullReplicaManifest(file.data);
  if (state.version !== 1 || state.taskId !== manifest.taskId || state.runId !== manifest.runId || state.manifestHash !== fullReplicaHash(manifest)) throw Error('context_full_manifest_identity_conflict');
  for (const ref of [manifest.sourceEvidence, manifest.header?.assets, manifest.body.program, manifest.body.sourceUnits, manifest.responsive?.source].filter(Boolean)) {
    const actual = await read(ref!.path, '冻结合同引用的本地输入；仅记录哈希。'); if (actual.sha256 !== ref!.sha256) throw Error('context_full_input_changed');
  }
  // CSS is opaque bytes, not JSON; the executor verifies it with all remaining program references.
  const css = await read(manifest.body.css.path, '冻结正文 CSS。', true, false); if (css.sha256 !== manifest.body.css.sha256) throw Error('context_full_input_changed');
  return { status: 'ready', exitCode: 0, records, contractSelection: 'task-frozen', task: { taskId: manifest.taskId, runId: manifest.runId, mode: 'replica', state: { status: state.status, pending: !!state.pending, pageId: state.checkpoints?.page?.pageId, runDirectory: path.join(root, 'runs', directory), deliveryPolicy: manifest.deliveryPolicy }, frozenIdentity: { version: manifest.version, manifestHash: state.manifestHash, sourceUrl: manifest.sourceUrl } }, nextAction: state.pending ? '使用精确 run 目录只读 reconcile；不得盲重试。' : '按本任务冻结的完整复刻合同继续，当前页面视觉和交互仍须实际验收。' };
}

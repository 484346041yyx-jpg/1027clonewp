import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadHeaderBundle } from '../woodmart-header/generic/bundle.js';
import { modulePlanHash } from '../woodmart-header/generic/contract.js';
import { contextId } from './files.js';
import type { ContextLoadOptions, ContextLoadResult } from './contracts.js';

export async function headerModuleContext(root: string, options: ContextLoadOptions, onRead?: (bytes: number) => void): Promise<Partial<ContextLoadResult> | undefined> {
  if (!options.run || !['resume', 'compare'].includes(options.intent)) return;
  if (!contextId(options.run)) throw Error('context_selector_invalid');
  const directory = path.join(root, 'references', options.run, 'bundle');
  try { if (!(await lstat(directory)).isDirectory()) throw Error('context_header_bundle_invalid'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const bundle = await loadHeaderBundle(directory);
  if (bundle.plan.owner.runId !== options.run || options.task && options.task !== options.run) throw Error('context_header_identity_conflict');
  const pages = Object.values((bundle.state.confirmed?.snapshot as { module?: { pages?: Record<string, { pageId: number; status: string }> } } | undefined)?.module?.pages ?? {});
  if (pages.length > 1) throw Error('context_header_page_ambiguous');
  const records: ContextLoadResult['records'] = [];
  for (const name of ['identity.json', 'state.json', 'header.json', 'menus.json', 'header.css', 'fonts.json', 'media.json', 'dropdowns.json']) {
    const filename = path.join(directory, name);
    let bytes: Buffer;
    try { bytes = await readFile(filename); } catch (error) { if (name === 'dropdowns.json' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    onRead?.(bytes.length);
    records.push({ path: filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, reason: '独立页眉任务的当前受保护本地资源。' });
  }
  return { status: 'ready', exitCode: 0, records, contractSelection: 'task-frozen', task: {
    taskId: options.run, runId: options.run, mode: 'replica',
    state: { status: pages[0]?.status ?? 'uncreated', pending: !!bundle.state.pending, pageId: pages[0]?.pageId, bundleDirectory: directory },
    frozenIdentity: { moduleKey: bundle.plan.moduleKey, headerId: bundle.state.identity.headerId, planHash: modulePlanHash(bundle.plan), targetOrigin: bundle.plan.targetOrigin },
  }, nextAction: bundle.state.pending ? '先对账独立页眉任务的未知写入；不得盲目重试。' : '继续精确独立页眉任务；远端状态仍须读回，页面视觉与交互仍须实际验收。' };
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { localPath, readLocal, hash } from './files.js';
import { resourceKeys } from './resources.js';

/** These keys identify resources, never permission to mutate them. Existing ownership/CAS stays mandatory. */
export function remoteResource(origin: string, type: string, id: string | number): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^[a-z-]+$/.test(type) || !/^[A-Za-z0-9_.-]+$/.test(String(id))) throw Error('workspace_resource_identity');
  return resourceKeys([`remote:${url.host.replace(':', '-')}/${type}/${id}`])[0];
}
export async function runResources(root: string, runId: string, pageId?: number): Promise<string[]> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(runId) || runId.includes('..')) throw Error('workspace_resource_run');
  const relative = `runs/${runId}`, directory = await localPath(root, relative);
  let manifest: any;
  for (const file of ['manifest.json', 'journal.json']) {
    try { manifest = JSON.parse((await readLocal(root,`${relative}/${file}`)).toString()); break; }
    catch (error) { if (error instanceof SyntaxError || error instanceof Error && error.message==='workspace_file_limit') return ['task:unscoped']; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const origin = manifest?.targetOrigin ?? manifest?.targetUrl;
  // No guessing that a page on one site is the same record on another site.
  if (!origin) return ['task:unscoped'];
  const keys = [`local:${relative}`];
  let state: any;
  try { state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const cp = state?.checkpoints;
  const id = pageId ?? cp?.published?.pageId ?? cp?.bound?.pageId ?? cp?.body?.pageId ?? cp?.page?.pageId ?? state?.pageId;
  if (id) keys.push(remoteResource(origin, 'post', id));
  else keys.push(remoteResource(origin, 'create', `page-${hash(String(manifest.slug ?? runId))}`));
  // Reused public resources are read-only and do not acquire a write lock.
  const ownedHeader = cp?.header ?? state?.header;
  if (manifest.headerProvider !== 'reused-woodmart-header' && ownedHeader?.headerId) {
    keys.push(remoteResource(origin, 'header', ownedHeader.headerId));
    for (const menu of ownedHeader.menus ?? []) if (menu.id) keys.push(remoteResource(origin, 'menu', menu.id));
    for (const block of [ownedHeader.styleBlock, ...(ownedHeader.menuContent ?? [])]) if (block?.id) keys.push(remoteResource(origin, 'post', block.id));
  }
  for (const doc of [state?.snapshot?.snapshot?.preview,state?.snapshot?.snapshot?.footer]) if(doc?.id) keys.push(remoteResource(origin,'post',doc.id));
  return resourceKeys(keys);
}

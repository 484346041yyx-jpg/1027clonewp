import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, open, statfs, stat } from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ComponentFileRef } from './types.js';

export const componentHash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const readMetrics = new AsyncLocalStorage<{ filesRead: number; bytesRead: number; cache: Map<string, Promise<Buffer>> }>();
export async function withComponentReadMetrics<T>(operation: () => Promise<T>, onComplete?: (metrics: { filesRead: number; bytesRead: number }) => void): Promise<{ value: T; filesRead: number; bytesRead: number }> {
  const metrics = { filesRead: 0, bytesRead: 0, cache: new Map<string, Promise<Buffer>>() };
  try { const value = await readMetrics.run(metrics, operation); return { value, filesRead: metrics.filesRead, bytesRead: metrics.bytesRead }; }
  finally { onComplete?.({ filesRead: metrics.filesRead, bytesRead: metrics.bytesRead }); }
}
export function componentCanonical(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
}
export function componentPath(root: string, name: string): string {
  const resolved = path.resolve(root, name), relative = path.relative(path.resolve(root), resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error(`component_path_escape: ${name}`);
  return resolved;
}
export async function readComponentBytes(root: string, name: string, limit = 32 * 1024 * 1024): Promise<Buffer> {
  const candidate = componentPath(root, name), [actualRoot, actual] = await Promise.all([realpath(root), realpath(candidate)]);
  componentPath(actualRoot, actual);
  const info = await stat(actual);
  if (!info.isFile() || info.size > limit) throw Error(`component_file_too_large_or_invalid: ${name}`);
  const metrics = readMetrics.getStore();
  if (!metrics) { const bytes = await readFile(actual); if (bytes.length > limit) throw Error(`component_file_too_large_or_invalid: ${name}`); return bytes; }
  let pending = metrics.cache.get(actual);
  if (!pending) {
    pending = readFile(actual).then(bytes => { metrics.filesRead++; metrics.bytesRead += bytes.length; return bytes; }).catch(error => { metrics.cache.delete(actual); throw error; });
    metrics.cache.set(actual, pending);
  }
  const bytes = await pending;
  if (bytes.length > limit) throw Error(`component_file_too_large_or_invalid: ${name}`);
  return Buffer.from(bytes);
}
export async function readComponentRef(root: string, ref: ComponentFileRef): Promise<Buffer> {
  if (!ref || typeof ref.path !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('component_file_ref_invalid');
  const bytes = await readComponentBytes(root, ref.path);
  if (componentHash(bytes) !== ref.sha256) throw Error(`component_evidence_hash_mismatch: ${ref.path}`);
  return bytes;
}
export async function componentFileRef(root: string, name: string): Promise<ComponentFileRef> {
  return { path: path.relative(path.resolve(root), componentPath(root, name)).replaceAll('\\', '/'), sha256: componentHash(await readComponentBytes(root, name)) };
}
export async function writeComponentJson(root: string, name: string, value: unknown, immutable = false): Promise<ComponentFileRef> {
  await assertComponentDiskSpace(root);
  const target = componentPath(root, name), bytes = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(target), { recursive: true });
  componentPath(await realpath(root), await realpath(path.dirname(target)));
  if (immutable) {
    const file = await open(target, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  } else {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const file = await open(temp, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temp, target);
  }
  // A caller that performs an explicit local publication in this scope must
  // observe subsequent reads from disk, not the pre-publication bytes.
  readMetrics.getStore()?.cache.clear();
  return { path: name.replaceAll('\\', '/'), sha256: componentHash(bytes) };
}
export async function assertComponentDiskSpace(root: string): Promise<void> {
  const free = await statfs(root);
  if (Number(free.bavail) * Number(free.bsize) < 512 * 1024 * 1024) throw Error('component_write_requires_512_mib_free');
}

/** Learning data is untrusted. Raw target content, sessions and defaults never
 * become reusable recipes. Evidence files remain separate from this output. */
export function assertGenericLearningData(value: unknown, location = '$'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error(`learning_non_finite: ${location}`);
  if (typeof value === 'string' && (/\[MaxDepth\]/.test(value) || /(?:https?:\/\/|mailto:|tel:|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:product|attachment|media|sidebar|form|menu)[ _-]?ids?\s*[:=]\s*\[?\d)/i.test(value))) throw Error(`learning_non_generic_value: ${location}`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:cookies?|authorization|set-cookie|localStorage|sessionStorage|storageState|accessToken|password|consumer_secret|api[_-]?key|webhook|email_to|form_actions|product_?ids?|media_?ids?|attachment_?ids?|sidebar_name|defaults?|defaultValue)$/i.test(key)) throw Error(`learning_forbidden_default_or_secret: ${location}.${key}`);
    assertGenericLearningData(child, `${location}.${key}`);
  }
}

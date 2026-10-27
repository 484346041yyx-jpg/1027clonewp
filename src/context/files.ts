import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE44_ADAPTER_SOURCE_PATHS } from '../components/capabilities.js';

export const contextHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const UNIFIED_ELEMENTOR_GUIDE = 'docs/knowledge/elementor-container-patterns.md';
export const contextId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z\d][a-zA-Z\d_.-]{0,159}$/.test(value) && !value.includes('..');
export function contextContained(root: string, filename: string): void {
  const relative = path.relative(root, filename);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('context_path_escape');
}
/** Explicit file families, never config, credentials, raw browser dumps or reports. */
export function contextAllowed(relative: string): boolean {
  const name = relative.split(path.sep).join('/');
  return /^(?:AGENTS|SYSTEM|COMPONENTS)\.md$/.test(name)
    || name === UNIFIED_ELEMENTOR_GUIDE
    || /^\.agents\/skills\/(?:clonewp|reference-elementor)\/(?:SKILL\.md|references\/[a-zA-Z\d_-]+\.md)$/.test(name)
    || /^data\/system\/[a-zA-Z\d_.-]+\.json$/.test(name)
    || /^data\/(?:native44|component-registry|knowledge-releases)\/[a-zA-Z\d_./-]+\.json$/.test(name)
    || /^learning\/releases\/[a-f\d]{64}\.json$/.test(name)
    || /^learning\/[a-zA-Z\d][a-zA-Z\d_-]{0,100}\/record\.json$/.test(name)
    || /^learning\/[a-zA-Z\d][a-zA-Z\d_-]{0,100}\/evidence\/[a-f\d]{64}\.(?:json|php|txt|png|jpg|webp)$/.test(name)
    || /^config\/native44-component-set\.json$/.test(name)
    || [...NATIVE44_ADAPTER_SOURCE_PATHS, 'src/native44/selection-rules.ts', 'src/native44/selection.ts', 'src/native44/page-context.ts'].includes(name)
    || /^(?:references|original)\/[a-zA-Z\d_.-]+\/(?:job|program|design|task-scope|release-lock|release-draft|source-facts|component-plan|assets-manifest|asset-manifest)\.json$/.test(name)
    || /^runs\/[a-zA-Z\d_.-]+\/(?:journal|result|compare-manifest|release-lock)\.json$/.test(name);
}
export class ContextReader {
  filesRead = 0; bytesRead = 0;
  private cache = new Map<string, { path: string; bytes: Buffer; sha256: string }>();
  constructor(readonly root: string) {}
  async verifyPath(filename: string): Promise<void> { const resolved = path.resolve(this.root, filename); contextContained(this.root, resolved); contextContained(this.root, await realpath(resolved)); }
  async read(filename: string, limit = 2_097_152) {
    const resolved = path.resolve(this.root, filename); contextContained(this.root, resolved);
    if (!contextAllowed(path.relative(this.root, resolved))) throw Error('context_path_not_allowed');
    const actual = await realpath(resolved); contextContained(this.root, actual);
    if (!contextAllowed(path.relative(this.root, actual))) throw Error('context_realpath_not_allowed');
    const cached = this.cache.get(actual); if (cached) { if (cached.bytes.length > limit) throw Error('context_file_too_large'); return cached; }
    const info = await stat(actual); if (!info.isFile() || info.size > limit) throw Error('context_file_too_large');
    const bytes = await readFile(actual); if (bytes.length > limit) throw Error('context_file_too_large');
    const item = { path: actual, bytes, sha256: contextHash(bytes) }; this.cache.set(actual, item); this.filesRead++; this.bytesRead += bytes.length; return item;
  }
  async json(filename: string) { const item = await this.read(filename); const data: unknown = JSON.parse(item.bytes.toString('utf8').replace(/^\uFEFF/, '')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('context_record_invalid'); return { ...item, data: data as Record<string, unknown> }; }
}
/** Documentation may contain links; credentials and session-bearing URLs never leave this reader. */
export function contextSafeText(value: string): string {
  return value.replace(/https?:\/\/[^\s)<>"']+/gi, raw => { try { const url = new URL(raw); if (url.username || url.password || /(?:token|nonce|auth|key|signature|password|preview|session|code)=/i.test(url.search) || /wp-admin|elementor-preview/i.test(raw)) return '[session-url-redacted]'; return raw; } catch { return '[invalid-url-redacted]'; } })
    .replace(/\b((?:Bearer|Basic)\s+)[a-zA-Z\d._~+\/-]+=*/gi, '$1[redacted]')
    .replace(/(["']?(?:password|wp_app_password|authorization|cookie|api[_-]?key|access[_-]?token)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[redacted]');
}

import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export interface VerifiedEvidenceRef { path: string; sha256: string }
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const scope = new AsyncLocalStorage<VerifiedEvidenceReader>();

/** One command's immutable, digest-bound evidence. Never a browser/server cache.
 * A fresh barrier rechecks every dependency before credentials or remote writes.
 * Returned bytes/JSON are copies; callers cannot mutate another read's evidence. */
export class VerifiedEvidenceReader {
  readonly metrics = { fileReads: 0, bytesRead: 0, hashChecks: 0, byteCacheHits: 0, jsonParses: 0, jsonCacheHits: 0, freshBarriers: 0, verificationCacheHits: 0, coalescedReads: 0, derivations: 0, derivationCacheHits: 0 };
  private cache = new Map<string, { bytes: Buffer; json?: unknown }>();
  private dependencies = new Map<string, { ref: VerifiedEvidenceRef; bytes: number; max: number }>();
  private pending = new Map<string, Promise<Buffer>>();
  private derived = new Map<string, Promise<unknown>>();
  private size = 0;
  private invalidated = false;
  constructor(readonly root: string, private readonly maxCacheBytes = 128 * 1024 * 1024) {}
  private filename(ref: VerifiedEvidenceRef): string {
    if (this.invalidated) throw Error('verified_evidence_reader_invalidated');
    if (!ref || typeof ref.path !== 'string' || !/^[a-f\d]{64}$/.test(ref.sha256) || /[?\r\n]|^[a-z]+:\/\//i.test(ref.path)) throw Error('verified_evidence_reference_invalid');
    const filename = path.resolve(this.root, ref.path), relative = path.relative(this.root, filename);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('verified_evidence_path_escape');
    return filename;
  }
  private async fresh(ref: VerifiedEvidenceRef, max: number) {
    const filename = this.filename(ref), actual = await realpath(filename);
    if (actual !== filename) throw Error('verified_evidence_reference_alias');
    const info = await stat(actual);
    if (!info.isFile() || info.size > max) throw Error('verified_evidence_artifact_too_large');
    const bytes = await readFile(actual); this.metrics.fileReads++; this.metrics.bytesRead += bytes.length; this.metrics.hashChecks++;
    if (bytes.length > max || digest(bytes) !== ref.sha256) throw Error('verified_evidence_artifact_hash_mismatch');
    return bytes;
  }
  private async load(ref: VerifiedEvidenceRef, max: number, retain: boolean): Promise<Buffer> {
    const filename = this.filename(ref), key = `${filename}\0${ref.sha256}`;
    const pendingKey = `${key}\0${max}`;
    let operation = this.pending.get(pendingKey);
    if (operation) this.metrics.coalescedReads++;
    else {
      operation = this.fresh(ref, max);
      this.pending.set(pendingKey, operation);
    }
    let bytes: Buffer;
    try { bytes = await operation; } finally { if (this.pending.get(pendingKey) === operation) this.pending.delete(pendingKey); }
    if (bytes.length > max) throw Error('verified_evidence_artifact_too_large');
    const previous = this.dependencies.get(key);
    this.dependencies.set(key, { ref: { path: filename, sha256: ref.sha256 }, bytes: bytes.length, max: Math.min(max, previous?.max ?? max) });
    if (retain && !this.cache.has(key) && bytes.length <= this.maxCacheBytes) {
      // LRU keeps later snapshots useful even when a command visits many images.
      while (this.cache.size && (this.size + bytes.length > this.maxCacheBytes || this.cache.size >= 2048)) {
        const oldest = this.cache.keys().next().value!; this.size -= this.cache.get(oldest)!.bytes.length; this.cache.delete(oldest);
      }
      this.cache.set(key, { bytes }); this.size += bytes.length;
    }
    return bytes;
  }
  /** Hash-bound validation without retaining or copying pixels/large packets.
   * The dependency ledger is separate from the bounded byte cache. */
  async verify(ref: VerifiedEvidenceRef, max = 32 * 1024 * 1024): Promise<{ bytes: number }> {
    const filename = this.filename(ref), key = `${filename}\0${ref.sha256}`, previous = this.dependencies.get(key);
    if (previous) {
      if (previous.bytes > max) throw Error('verified_evidence_artifact_too_large');
      previous.max = Math.min(previous.max, max); this.metrics.verificationCacheHits++; return { bytes: previous.bytes };
    }
    return { bytes: (await this.load(ref, max, false)).length };
  }
  async read(ref: VerifiedEvidenceRef, max = 32 * 1024 * 1024): Promise<Buffer> {
    const filename = this.filename(ref), key = `${filename}\0${ref.sha256}`, cached = this.cache.get(key);
    if (cached) {
      if (cached.bytes.length > max) throw Error('verified_evidence_artifact_too_large');
      const dependency = this.dependencies.get(key)!; dependency.max = Math.min(dependency.max, max);
      this.cache.delete(key); this.cache.set(key, cached);
      this.metrics.byteCacheHits++; return Buffer.from(cached.bytes);
    }
    const bytes = await this.load(ref, max, true);
    return Buffer.from(bytes);
  }
  async json(ref: VerifiedEvidenceRef, validate?: (value: unknown) => void): Promise<any> {
    const filename = this.filename(ref), key = `${filename}\0${ref.sha256}`;
    const existing = this.cache.get(key);
    if (existing && Object.hasOwn(existing, 'json')) {
      await this.verify(ref); this.metrics.jsonCacheHits++;
      const result = structuredClone(existing.json); validate?.(result); return result;
    }
    const bytes = await this.read(ref), cached = this.cache.get(key);
    let parsed: unknown;
    if (cached && Object.hasOwn(cached, 'json')) { parsed = cached.json; this.metrics.jsonCacheHits++; }
    else { try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw Error('verified_evidence_json_invalid'); } this.metrics.jsonParses++; if (cached) cached.json = parsed; }
    const result = structuredClone(parsed); validate?.(result); return result;
  }
  /** One command only, complete caller-supplied input identity + validator
   * version. No disk or cross-command authority; results are immutable copies. */
  async derive<T>(validator: string, inputIdentity: string, operation: () => Promise<T>): Promise<T> {
    if (this.invalidated) throw Error('verified_evidence_reader_invalidated');
    const key = `${validator}\0${inputIdentity}`;
    let value = this.derived.get(key) as Promise<T> | undefined;
    if (value) this.metrics.derivationCacheHits++;
    else {
      this.metrics.derivations++; value = operation(); this.derived.set(key, value);
      try { await value; } catch (error) { this.derived.delete(key); throw error; }
      if (this.derived.size > 256) this.derived.delete(this.derived.keys().next().value!);
    }
    return structuredClone(await value);
  }
  async revalidateAll(): Promise<void> {
    this.metrics.freshBarriers++;
    try { for (const dependency of this.dependencies.values()) await this.fresh(dependency.ref, dependency.max); }
    catch (error) { this.invalidated = true; this.cache.clear(); this.derived.clear(); this.size = 0; throw error; }
  }
}

export function activeVerifiedEvidenceReader(root: string) { const reader = scope.getStore(); return reader?.root === root ? reader : undefined; }
export async function withVerifiedEvidenceReader<T>(root: string, operation: (reader: VerifiedEvidenceReader) => Promise<T>): Promise<T> {
  const active = activeVerifiedEvidenceReader(root); if (active) return operation(active);
  const reader = new VerifiedEvidenceReader(root);
  return scope.run(reader, () => operation(reader));
}

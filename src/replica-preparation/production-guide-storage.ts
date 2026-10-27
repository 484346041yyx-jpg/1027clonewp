import { createHash } from 'node:crypto';
import { preparationJson } from './contract.js';

export const PRODUCTION_GUIDE_STORAGE_BYTES = 32 * 1024 * 1024;
const STORAGE_KIND = 'clonewp-production-guide-native-settings-dictionary';
const REFERENCE_KIND = 'clonewp-production-guide-owner-settings-reference';
const MAX_VALUES = 2_000_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (reason: string): never => { throw Error(`replica_preparation_production_guide_storage_${reason}`); };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join(',') === expected.sort().join(',');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function countValues(value: unknown): number {
  let count = 0; const pending = [value];
  while (pending.length) {
    const next = pending.pop(); if (++count > MAX_VALUES) throw Error('replica_preparation_json_limit');
    if (Array.isArray(next)) for (const child of next) pending.push(child);
    else if (record(next)) for (const child of Object.values(next)) pending.push(child);
  }
  return count;
}
/** Only these generated source-presentation owners are encoded. No source facts are removed. */
function owners(chunk: unknown): Array<Record<string, any>> {
  if (!record(chunk) || !record(chunk.guide)) return [];
  const out: Array<Record<string, any>> = [];
  for (const view of Array.isArray(chunk.guide.viewports) ? chunk.guide.viewports : []) {
    for (const requirement of Array.isArray(view?.requirements) ? view.requirements : []) {
      if (requirement?.presentation?.owners === undefined) continue;
      if (!Array.isArray(requirement.presentation.owners)) fail('owners');
      for (const owner of requirement.presentation.owners) {
        if (!record(owner) || !exactKeys(owner, ['componentKey', 'responsibility', 'nativeSettings']) || typeof owner.componentKey !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(owner.componentKey) || owner.responsibility !== 'assigned-not-render-verified' || !record(owner.nativeSettings)) fail('owner_identity');
        out.push(owner);
      }
    }
  }
  return out;
}
export function productionGuideChunkFitsStorage(input: unknown): boolean {
  try { return Buffer.byteLength(preparationJson(input)) <= PRODUCTION_GUIDE_STORAGE_BYTES; }
  catch (error) { if (error instanceof Error && error.message === 'replica_preparation_json_limit') return false; throw error; }
}
/** Old inline/chunk bytes stay unchanged. Only a chunk exceeding the existing byte budget is encoded. */
export function encodeProductionGuideChunk(input: unknown): unknown {
  const original = preparationJson(input); // Preserve the existing 2M-value/depth limits before encoding.
  if (Buffer.byteLength(original) <= PRODUCTION_GUIDE_STORAGE_BYTES) return input;
  const chunk = JSON.parse(original), dictionary = new Map<string, Record<string, unknown>>();
  for (const owner of owners(chunk)) {
    const canonical = preparationJson(owner.nativeSettings), settingsHash = sha(canonical);
    dictionary.set(settingsHash, owner.nativeSettings);
    owner.nativeSettings = { version: 1, kind: REFERENCE_KIND, componentKey: owner.componentKey, sha256: settingsHash };
  }
  if (!dictionary.size) fail('chunk_limit');
  const encoded = { version: 1, kind: STORAGE_KIND, encoding: 'presentation-owner-native-settings-v1', originalSha256: sha(original), chunk, dictionary: [...dictionary].map(([sha256, nativeSettings]) => ({ sha256, nativeSettings })) };
  if (!productionGuideChunkFitsStorage(encoded)) fail('chunk_limit');
  return encoded;
}
/** Called only after the ordinary file-reference hash/32MiB guards. Restores the exact existing API value. */
export function decodeProductionGuideChunk(input: unknown): unknown {
  if (!record(input) || input.kind !== STORAGE_KIND) return input;
  if (!productionGuideChunkFitsStorage(input)) fail('chunk_limit');
  const stored = JSON.parse(preparationJson(input));
  if (!exactKeys(stored, ['version', 'kind', 'encoding', 'originalSha256', 'chunk', 'dictionary']) || stored.version !== 1 || stored.encoding !== 'presentation-owner-native-settings-v1' || !validHash(stored.originalSha256) || !record(stored.chunk) || !Array.isArray(stored.dictionary)) fail('envelope');
  const dictionary = new Map<string, { settings: Record<string, unknown>; values: number }>();
  for (const entry of stored.dictionary) {
    if (!record(entry) || !exactKeys(entry, ['sha256', 'nativeSettings']) || !validHash(entry.sha256) || !record(entry.nativeSettings) || dictionary.has(entry.sha256) || sha(preparationJson(entry.nativeSettings)) !== entry.sha256) fail('dictionary_hash');
    dictionary.set(entry.sha256, { settings: entry.nativeSettings, values: countValues(entry.nativeSettings) });
  }
  const rows = owners(stored.chunk), used = new Set<string>(); let expandedValues = countValues(stored.chunk);
  for (const owner of rows) {
    const ref = owner.nativeSettings;
    if (!exactKeys(ref, ['version', 'kind', 'componentKey', 'sha256']) || ref.version !== 1 || ref.kind !== REFERENCE_KIND || ref.componentKey !== owner.componentKey || !validHash(ref.sha256) || !dictionary.has(ref.sha256)) fail('owner_reference');
    used.add(ref.sha256); expandedValues += dictionary.get(ref.sha256)!.values - countValues(ref);
    if (expandedValues > MAX_VALUES) throw Error('replica_preparation_json_limit');
  }
  if (!rows.length || used.size !== dictionary.size) fail('dictionary_unused');
  // Check expansion size before materializing repeated settings; never bypass the JSON value guard.
  for (const owner of rows) owner.nativeSettings = JSON.parse(preparationJson(dictionary.get(owner.nativeSettings.sha256)!.settings));
  if (sha(preparationJson(stored.chunk)) !== stored.originalSha256) fail('original_hash');
  return stored.chunk;
}

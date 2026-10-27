import { createHash } from 'node:crypto';

export const FULL_REPLICA_JSON_LIMITS = Object.freeze({ values: 2_000_000, bytes: 32 * 1024 * 1024, depth: 64 });

function fail(code: string): never { throw Error(`replica_full_json_${code}`); }

export function canonicalFullReplicaJson(input: unknown): string {
  const ancestors = new Set<object>();
  let values = 0;
  const visit = (entry: unknown, depth: number): string => {
    if (++values > FULL_REPLICA_JSON_LIMITS.values || depth > FULL_REPLICA_JSON_LIMITS.depth) fail('limit');
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'string') return JSON.stringify(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) fail('invalid'); return JSON.stringify(entry); }
    if (!entry || typeof entry !== 'object' || ancestors.has(entry) || Object.getOwnPropertySymbols(entry).length) fail('invalid');
    const array = Array.isArray(entry), prototype = Object.getPrototypeOf(entry);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail('invalid');
    const descriptors = Object.getOwnPropertyDescriptors(entry), keys = Object.keys(entry), ownNames = Object.getOwnPropertyNames(entry);
    if (array ? keys.length !== entry.length || ownNames.length !== keys.length + 1 || keys.some((key, index) => key !== String(index)) : ownNames.length !== keys.length) fail('invalid');
    ancestors.add(entry);
    const items = (array ? keys : keys.sort()).map(key => {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('invalid');
      return (array ? '' : JSON.stringify(key) + ':') + visit(descriptor.value, depth + 1);
    });
    ancestors.delete(entry);
    return array ? '[' + items.join(',') + ']' : '{' + items.join(',') + '}';
  };
  const result = visit(input, 0);
  if (Buffer.byteLength(result, 'utf8') > FULL_REPLICA_JSON_LIMITS.bytes) fail('limit');
  return result;
}

export const fullReplicaJsonHash = (input: unknown): string => createHash('sha256').update(canonicalFullReplicaJson(input)).digest('hex');

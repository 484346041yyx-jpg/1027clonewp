import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { WordPressError } from './errors.js';

const marker = '__clonewpCapabilityPayload';
const encoding = 'gzip-base64-v1';
export const MAX_CAPABILITY_PAYLOAD_BYTES = 64 * 1024 * 1024;

/** Only wraps the read-only capability result; its schemas and checkpoint stay intact. */
export const capabilityPayloadReturnPHP = `
if (function_exists('gzencode')) {
  $capabilityJSON=json_encode($out,JSON_THROW_ON_ERROR);
  if (strlen($capabilityJSON)>=262144) {
    $capabilityCompressed=gzencode($capabilityJSON,6);
    if ($capabilityCompressed!==false && strlen($capabilityCompressed)<strlen($capabilityJSON)) {
      return ['${marker}'=>'${encoding}','rawBytes'=>strlen($capabilityJSON),'sha256'=>hash('sha256',$capabilityJSON),'data'=>base64_encode($capabilityCompressed)];
    }
  }
}
return $out;
`;

/** Reject partial/corrupt results instead of treating them as an incomplete registry. */
export function decodeCapabilityPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, marker)) return value;
  const fail = (): never => { throw new WordPressError('invalid_capability_payload', 'The capability response failed its encoding, size or integrity check.'); };
  const envelope = value as Record<string, unknown>;
  if (envelope[marker] !== encoding || Object.keys(envelope).length !== 4
    || !Number.isSafeInteger(envelope.rawBytes) || (envelope.rawBytes as number) < 1
    || (envelope.rawBytes as number) > MAX_CAPABILITY_PAYLOAD_BYTES
    || typeof envelope.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.sha256)
    || typeof envelope.data !== 'string' || !envelope.data.length
    || envelope.data.length > Math.ceil(MAX_CAPABILITY_PAYLOAD_BYTES / 3) * 4
    || envelope.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data)) return fail();
  try {
    const compressed = Buffer.from(envelope.data, 'base64');
    if (compressed.toString('base64') !== envelope.data) return fail();
    const raw = gunzipSync(compressed, { maxOutputLength: envelope.rawBytes as number });
    if (raw.length !== envelope.rawBytes || createHash('sha256').update(raw).digest('hex') !== envelope.sha256) return fail();
    return JSON.parse(raw.toString('utf8'));
  } catch { return fail(); }
}

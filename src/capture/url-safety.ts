import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsafeUrlError'; }
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) {
    const p = normalized.split('.').map(Number);
    const [a, b, c] = p;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(normalized) === 6) {
    // IPv4-mapped and compatible literals must never bypass IPv4 checks.
    if (normalized.includes('.')) return isPublicAddress(normalized.slice(normalized.lastIndexOf(':') + 1));
    if (normalized.startsWith('::ffff:')) {
      const tail = normalized.slice(7).split(':');
      if (tail.length !== 2) return false;
      const n = (parseInt(tail[0], 16) * 65536) + parseInt(tail[1], 16);
      return isPublicAddress(`${Math.floor(n / 16777216)}.${Math.floor(n / 65536) % 256}.${Math.floor(n / 256) % 256}.${n % 256}`);
    }
    if (normalized.startsWith('::') || /^(fc|fd|fe[89ab]|ff)/.test(normalized) || normalized.startsWith('2001:db8:')) return false;
    // Only globally routed unicast space is supported.
    const first = parseInt(normalized.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff;
  }
  return false;
}

export interface SafeUrl { url: URL; addresses: { address: string; family: 4 | 6 }[] }
export async function assertPublicUrl(input: string, options: { allowLocalForTests?: boolean } = {}): Promise<SafeUrl> {
  let url: URL;
  try { url = new URL(input); } catch { throw new UnsafeUrlError('Source/resource URL is not an absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('Only HTTP(S) source/resource URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in source/resource URLs are forbidden');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === 'metadata.google.internal') {
    throw new UnsafeUrlError('Internal source/resource hostnames are forbidden');
  }
  const loopbackTestHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (hostname === 'localhost' && !(options.allowLocalForTests && loopbackTestHost)) throw new UnsafeUrlError('Loopback source/resource URLs are forbidden');
  let addresses: { address: string; family: 4 | 6 }[];
  if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  else {
    try { addresses = (await lookup(hostname, { all: true, verbatim: true })).map(a => ({ address: a.address, family: a.family as 4 | 6 })); }
    catch { throw new UnsafeUrlError('Source/resource hostname could not be resolved'); }
  }
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address) && !(options.allowLocalForTests && loopbackTestHost && ['127.0.0.1', '::1'].includes(a.address)))) {
    throw new UnsafeUrlError('Source/resource resolves to a private, reserved, or internal network address');
  }
  url.hash = '';
  return { url, addresses };
}

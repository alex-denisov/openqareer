/**
 * B621: сетевой доступ резолвера — обычный гостевой GET без входа и cookie.
 * Сайт компании: redirect вручную (не больше 5), каждый шаг — только http(s)
 * на порты 80/443 и публичный адрес (адреса сайта берутся из реестра, поэтому
 * внутренние сети хоста недоступны), тайм-аут, потолок размера ответа.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FetchPage, PageResponse } from './linkedinOrgResolver';

const HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

const TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 2_000_000;
const MAX_REDIRECTS = 5;

export class BlockedAddress extends Error {
  constructor(readonly url: string) {
    super('blocked-address');
    this.name = 'BlockedAddress';
  }
}

/** Петля, частные, link-local, CGNAT, multicast и неуказанные адреса. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(v6);
}

export type HostResolver = (host: string) => Promise<readonly string[]>;

const dnsResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

export async function assertPublicUrl(raw: string, resolve: HostResolver): Promise<URL> {
  const url = new URL(raw);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!/^https?:$/.test(url.protocol) || !['80', '443'].includes(port))
    throw new BlockedAddress(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new BlockedAddress(raw);
  return url;
}

export function createGuestFetch(
  customFetch: typeof fetch = fetch,
  resolve: HostResolver = dnsResolver,
): FetchPage {
  return async (start): Promise<PageResponse> => {
    let current = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicUrl(current, resolve);
      const response = await customFetch(current, {
        headers: HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current).toString();
        continue;
      }
      const body = (await response.text()).slice(0, MAX_BODY_CHARS);
      return { status: response.status, body, finalUrl: current };
    }
    return { status: 310, body: '', finalUrl: current };
  };
}

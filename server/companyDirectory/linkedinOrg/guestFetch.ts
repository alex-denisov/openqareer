/**
 * B621: сетевой доступ резолвера — обычный гостевой GET без входа и cookie.
 * Сайт компании: redirect вручную (не больше 5), каждый шаг — только http(s)
 * на порты 80/443 и публичный адрес (адреса сайта берутся из реестра, поэтому
 * внутренние сети хоста недоступны), тайм-аут, потолок размера ответа.
 * Остаточный риск DNS rebinding между проверкой и соединением принят:
 * адреса задаёт реестр, а не пользователь.
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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

function blockList(
  family: 'ipv4' | 'ipv6',
  subnets: readonly (readonly [string, number])[],
): BlockList {
  const list = new BlockList();
  for (const [net, prefix] of subnets) list.addSubnet(net, prefix, family);
  return list;
}

// Два списка: BlockList сверяет IPv4 и с ::ffff:0:0/96, поэтому IPv4 — только по первому.
const BLOCKED_V4 = blockList('ipv4', [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]);
// Встроенные IPv4 (::ffff:, ::/96, NAT64, 6to4) закрыты целиком: сайту они не нужны.
const BLOCKED_V6 = blockList('ipv6', [
  ['::', 96],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]);

/** Петля, частные, link-local, CGNAT, multicast, неуказанные и встроенные IPv4. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 4 ? BLOCKED_V4.check(address, 'ipv4') : BLOCKED_V6.check(address, 'ipv6');
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

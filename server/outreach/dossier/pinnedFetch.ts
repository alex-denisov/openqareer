import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

type Resolve = (host: string) => Promise<readonly string[]>;
type LookupCallback = (error: Error | null, address: unknown, family?: number) => void;

type IsPrivate = (address: string) => boolean;

/** ::ffff:7f00:1 → 127.0.0.1; иначе null. */
function mappedV4(v6: string): string | null {
  const tail = v6.slice('::ffff:'.length);
  if (isIP(tail) === 4) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(tail);
  if (!hex) return null;
  const [high, low] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Частный, служебный или неразборчивый адрес; всё, что не адрес, считается частным. */
export function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 0) return true;
  if (kind === 6) {
    const v6 = address.toLowerCase();
    if (v6.startsWith('::ffff:')) {
      const v4 = mappedV4(v6);
      return v4 === null || privateAddress(v4);
    }
    return v6 === '::1' || v6 === '::' || /^f[cd]/u.test(v6) || /^fe[89ab]/u.test(v6);
  }
  const [a = 0, b = 0] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function defaultResolve(host: string): Promise<readonly string[]> {
  return (await dnsLookup(host, { all: true })).map((entry) => entry.address);
}

/**
 * Разрешение имени для соединения: имя разрешается один раз, проверяется,
 * и сокет открывается к этому же адресу — повторный ответ DNS не используется (DNS rebinding).
 */
export function pinnedLookup(resolve: Resolve, isPrivate: IsPrivate = privateAddress) {
  return (host: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(host).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(isPrivate)) {
          callback(new Error(`private or empty address for ${host}`), null);
          return;
        }
        const address = addresses[0]!;
        const family = isIP(address) === 6 ? 6 : 4;
        if (options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
    );
  };
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input);
}

/**
 * fetch, который соединяется только с проверенным публичным адресом.
 * IP-литерал не проходит через lookup, поэтому проверяется здесь; редиректы
 * не выполняются сами — вызывающий проверяет каждый Location заново.
 */
export function createPinnedFetch(
  resolve: Resolve = defaultResolve,
  isPrivate: IsPrivate = privateAddress,
): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(resolve, isPrivate) as never } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const host = requestUrl(input).hostname.replace(/^\[|\]$/gu, '');
    if (isIP(host) !== 0 && isPrivate(host)) throw new Error(`private address ${host}`);
    return fetch(input, { ...init, redirect: 'manual', dispatcher } as RequestInit);
  }) as typeof fetch;
}

export const pinnedFetch = createPinnedFetch();

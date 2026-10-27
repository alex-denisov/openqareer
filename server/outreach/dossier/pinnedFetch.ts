import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

type Resolve = (host: string) => Promise<readonly string[]>;
type LookupCallback = (error: Error | null, address: unknown, family?: number) => void;

export function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    if (v6.startsWith('::ffff:')) return privateAddress(v6.slice(7));
    return v6 === '::1' || v6 === '::' || /^f[cd]/u.test(v6) || /^fe[89ab]/u.test(v6);
  }
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function defaultResolve(host: string): Promise<readonly string[]> {
  return (await dnsLookup(host, { all: true })).map((entry) => entry.address);
}

/**
 * Разрешение имени для соединения: имя разрешается один раз, проверяется,
 * и сокет открывается к этому же адресу — повторный ответ DNS не используется (DNS rebinding).
 */
export function pinnedLookup(resolve: Resolve) {
  return (host: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(host).then((addresses) => {
      if (addresses.length === 0 || addresses.some(privateAddress)) {
        callback(new Error(`private or empty address for ${host}`), null);
        return;
      }
      const address = addresses[0]!;
      const family = isIP(address) === 6 ? 6 : 4;
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    }, (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null));
  };
}

/** fetch, который соединяется только с проверенным публичным адресом. */
export function createPinnedFetch(resolve: Resolve = defaultResolve): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(resolve) as never } });
  return ((input: string | URL | Request, init?: RequestInit) =>
    fetch(input, { ...init, dispatcher } as RequestInit)) as typeof fetch;
}

export const pinnedFetch = createPinnedFetch();

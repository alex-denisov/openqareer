import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Защита от SSRF для запросов по адресам с чужих страниц (B627, B643):
 * общие для поиска сайтов компаний и рендера страниц карьеры.
 */

/** Candidate URLs: public DNS names on default ports only, no IP literals or local names. */
export function isPublicHost(url: URL): boolean {
  if (!/^https?:$/.test(url.protocol) || url.port !== '' || url.username || url.password)
    return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('['))
    return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

const PRIVATE_V4 =
  /^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./;
/** Every resolved address must be public; DNS errors reject. */
export async function resolvesPublic(host: string, resolve = lookup): Promise<boolean> {
  try {
    const addresses = await resolve(host, { all: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => {
        const v4 = address.replace(/^::ffff:/i, '');
        if (isIP(v4) === 4) return !PRIVATE_V4.test(v4);
        return !/^(::1?$|f[cd]|fe[89ab])/i.test(address);
      })
    );
  } catch {
    return false;
  }
}

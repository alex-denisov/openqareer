import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

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

const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
/**
 * IPv6: петля, частные, локальные, групповые и документационные сети, а также все
 * обёртки над IPv4 (::ffff:0:0/96, ::/96, NAT64, 6to4, Teredo) — их не разворачиваем,
 * а закрываем целиком, кроме записи «::ffff:a.b.c.d», которую проверяем как IPv4.
 */
const BLOCKED_V6: readonly (readonly [string, number])[] = [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
];
// Отдельные списки: BlockList сверяет IPv4 и с правилом ::ffff:0:0/96.
const BLOCKED_IPV4 = new BlockList();
const BLOCKED_IPV6 = new BlockList();
for (const [network, prefix] of BLOCKED_V4) BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of BLOCKED_V6) BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');

/** Public unicast address: not loopback, private, link-local, CGNAT, multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  const v4 = address.replace(/^::ffff:/i, '');
  if (isIP(v4) === 4) return !BLOCKED_IPV4.check(v4, 'ipv4');
  return isIP(address) === 6 && !BLOCKED_IPV6.check(address, 'ipv6');
}

/** Every resolved address must be public; DNS errors reject. */
export async function resolvesPublic(host: string, resolve = lookup): Promise<boolean> {
  try {
    const addresses = await resolve(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
  } catch {
    return false;
  }
}

import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './publicHost';

const host = (url: string) => new URL(url).hostname.replace(/^\[|\]$/g, '');

describe('isPublicAddress: только публичные адреса (SSRF)', () => {
  it('пропускает обычные публичные IPv4 и IPv6', () => {
    for (const address of ['8.8.8.8', '151.101.1.69', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it('закрывает частные, служебные и широковещательные IPv4', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255', '240.0.0.1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('закрывает IPv6-обёртки вокруг закрытых IPv4 в том виде, как их отдаёт URL', () => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::127.0.0.1]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[ff02::1]/',
    ]) {
      expect(isPublicAddress(host(url)), url).toBe(false);
    }
  });
});

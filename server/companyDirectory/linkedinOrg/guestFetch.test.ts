import { describe, expect, it } from 'vitest';
import { BlockedAddress, createGuestFetch, isPrivateAddress } from './guestFetch';

const publicDns = async () => ['93.184.216.34'];

function fakeFetch(map: Record<string, Response>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return map[url] ?? new Response('', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

describe('guestFetch address guard', () => {
  it('classifies private and public addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it('follows public redirects and rejects a hop into a private network', async () => {
    const { impl, calls } = fakeFetch({
      'https://a.example/': new Response('', {
        status: 301,
        headers: { location: 'https://b.example/x' },
      }),
      'https://b.example/x': new Response('<a href="https://www.linkedin.com/company/x/">', {
        status: 200,
      }),
      'https://c.example/': new Response('', {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest' },
      }),
    });
    const get = createGuestFetch(impl, publicDns);
    expect(await get('https://a.example/', 'site')).toMatchObject({
      status: 200,
      finalUrl: 'https://b.example/x',
    });
    await expect(get('https://c.example/', 'site')).rejects.toBeInstanceOf(BlockedAddress);
    expect(calls).not.toContain('http://169.254.169.254/latest');
  });

  it('rejects hosts that resolve to loopback and non-web ports', async () => {
    const { impl } = fakeFetch({});
    await expect(
      createGuestFetch(impl, async () => ['127.0.0.1'])('https://intranet.example/', 'site'),
    ).rejects.toBeInstanceOf(BlockedAddress);
    await expect(
      createGuestFetch(impl, publicDns)('https://a.example:8080/', 'site'),
    ).rejects.toBeInstanceOf(BlockedAddress);
  });
});

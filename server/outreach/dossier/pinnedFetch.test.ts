import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { pinnedLookup, createPinnedFetch, privateAddress } from './pinnedFetch';

function lookupOnce(lookup: ReturnType<typeof pinnedLookup>, host: string) {
  return new Promise<{ error: Error | null; address: unknown }>((resolve) => {
    lookup(host, { all: true }, (error, address) => resolve({ error, address }));
  });
}

describe('pinnedLookup', () => {
  it('connects to the address it checked, not to a second answer', async () => {
    const answers = [['93.184.216.34'], ['127.0.0.1']];
    const lookup = pinnedLookup(async () => answers.shift() ?? []);
    const first = await lookupOnce(lookup, 'example.com');
    expect(first.error).toBeNull();
    expect(first.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(answers).toEqual([['127.0.0.1']]);
  });

  it('refuses a name that resolves to a private address', async () => {
    const lookup = pinnedLookup(async () => ['93.184.216.34', '10.0.0.5']);
    const result = await lookupOnce(lookup, 'rebind.example');
    expect(result.error?.message).toMatch(/private/u);
  });

  it('refuses a real connection to loopback through a public-looking name', async () => {
    const server = createServer((_req, res) => res.end('secret'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const fetcher = createPinnedFetch(async () => ['127.0.0.1']);
    await expect(fetcher(`http://rebind.example:${port}/`)).rejects.toThrow();
    server.close();
  });
});

describe('privateAddress', () => {
  it('reads IPv4-mapped IPv6 in hex form', () => {
    expect(privateAddress('::ffff:7f00:1')).toBe(true);
    expect(privateAddress('::ffff:a00:5')).toBe(true);
    expect(privateAddress('::ffff:5db8:d822')).toBe(false);
  });

  it('fails closed on anything that is not an address', () => {
    expect(privateAddress('not-an-ip')).toBe(true);
  });
});

describe('createPinnedFetch', () => {
  it('refuses a private IP literal, which never reaches the DNS lookup', async () => {
    const server = createServer((_req, res) => res.end('secret'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const fetcher = createPinnedFetch(async () => ['93.184.216.34']);
    await expect(fetcher(`http://127.0.0.1:${port}/`)).rejects.toThrow(/private/u);
    await expect(fetcher(`http://[::ffff:7f00:1]:${port}/`)).rejects.toThrow(/private/u);
    server.close();
  });

  it('does not follow redirects on its own', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const fetcher = createPinnedFetch(async () => ['93.184.216.34']);
    const lookupFree = createPinnedFetch(
      async () => ['93.184.216.34'],
      () => false,
    );
    const response = await lookupFree(`http://127.0.0.1:${port}/`, { redirect: 'follow' });
    expect(response.status).toBe(302);
    await expect(fetcher(`http://127.0.0.1:${port}/`)).rejects.toThrow(/private/u);
    server.close();
  });
});

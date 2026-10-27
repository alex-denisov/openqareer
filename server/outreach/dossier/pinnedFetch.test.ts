import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { pinnedLookup, createPinnedFetch } from './pinnedFetch';

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

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createPinnedFetch, type ResolveAll } from './pinnedFetch';

let server: Server | undefined;
let hits = 0;

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  hits = 0;
  server = createServer((req, res) => {
    hits += 1;
    handler?.(req, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const to127: ResolveAll = async () => [{ address: '127.0.0.1', family: 4 }];

describe('createPinnedFetch (B643, DNS rebinding)', () => {
  it('lookup вернул 127.0.0.1 — соединение отклонено, сервер запроса не видит', async () => {
    const port = await listen((_req, res) => res.end('secret'));
    const fetchPinned = createPinnedFetch({ resolve: to127 });
    await expect(
      fetchPinned({ url: `http://acme.test:${port}/`, method: 'GET', headers: {} }),
    ).rejects.toThrow(/private_address/);
    expect(hits).toBe(0);
  });

  it('частный адрес среди нескольких ответов DNS тоже отклоняется', async () => {
    const port = await listen((_req, res) => res.end('secret'));
    const mixed: ResolveAll = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const fetchPinned = createPinnedFetch({ resolve: mixed });
    await expect(
      fetchPinned({ url: `http://acme.test:${port}/`, method: 'GET', headers: {} }),
    ).rejects.toThrow(/private_address/);
    expect(hits).toBe(0);
  });

  it('проверенный адрес: статус, заголовки и тело без следования редиректу', async () => {
    const port = await listen((req, res) => {
      res.writeHead(302, { location: '/jobs', 'x-host': req.headers.host ?? '' });
      res.end('moved');
    });
    const fetchPinned = createPinnedFetch({ resolve: to127, isPublicAddress: () => true });
    const response = await fetchPinned({
      url: `http://acme.test:${port}/careers`,
      method: 'GET',
      headers: { 'accept-encoding': 'gzip', host: 'evil.test' },
    });
    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/jobs');
    expect(response.headers['x-host']).toBe(`acme.test:${port}`);
    expect(response.body.toString()).toBe('moved');
    expect(hits).toBe(1);
  });

  it('тело больше предела обрывается', async () => {
    const port = await listen((_req, res) => res.end('x'.repeat(2_000)));
    const fetchPinned = createPinnedFetch({
      resolve: to127,
      isPublicAddress: () => true,
      maxBodyBytes: 1_000,
    });
    await expect(
      fetchPinned({ url: `http://acme.test:${port}/`, method: 'GET', headers: {} }),
    ).rejects.toThrow(/body_too_large/);
  });
});

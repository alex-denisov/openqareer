import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createPinnedFetch, createPinnedSession, type ResolveAll } from './pinnedFetch';

let server: Server | undefined;
let hits = 0;
let connections = 0;

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  hits = 0;
  connections = 0;
  server = createServer((req, res) => {
    hits += 1;
    handler?.(req, res);
  });
  server.on('connection', () => {
    connections += 1;
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
  it('IP-литерал частного адреса отклоняется без соединения (Node не зовёт lookup для IP)', async () => {
    const port = await listen((_req, res) => res.end('secret'));
    const fetchPinned = createPinnedFetch();
    for (const host of ['127.0.0.1', '[::1]', '10.0.0.1', '169.254.169.254']) {
      const url = host === '127.0.0.1' || host === '[::1]' ? `http://${host}:${port}/` : `http://${host}/`;
      await expect(fetchPinned({ url, method: 'GET', headers: {} }), host).rejects.toThrow(/private_address/);
    }
    expect(hits).toBe(0);
  });

  it('сессия тоже отклоняет IP-литерал частного адреса', async () => {
    const port = await listen((_req, res) => res.end('secret'));
    const session = createPinnedSession();
    await expect(
      session.fetch({ url: `http://127.0.0.1:${port}/`, method: 'GET', headers: {} }),
    ).rejects.toThrow(/private_address/);
    session.close();
    expect(hits).toBe(0);
  });

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

  it('сессия рендера держит соединение: два запроса — один сокет', async () => {
    const port = await listen((_req, res) => res.end('ok'));
    const session = createPinnedSession({ resolve: to127, isPublicAddress: () => true });
    const request = { url: `http://acme.test:${port}/a`, method: 'GET', headers: {} };
    await session.fetch(request);
    await session.fetch({ ...request, url: `http://acme.test:${port}/b` });
    session.close();
    expect(hits).toBe(2);
    expect(connections).toBe(1);
  });

  it('сессия тоже отклоняет частный адрес при соединении', async () => {
    const port = await listen((_req, res) => res.end('secret'));
    const session = createPinnedSession({ resolve: to127 });
    await expect(
      session.fetch({ url: `http://acme.test:${port}/`, method: 'GET', headers: {} }),
    ).rejects.toThrow(/private_address/);
    session.close();
    expect(hits).toBe(0);
  });

  it('close() обрывает незавершённые запросы рендера', async () => {
    const port = await listen(() => undefined);
    const session = createPinnedSession({ resolve: to127, isPublicAddress: () => true });
    const pending = session.fetch({
      url: `http://acme.test:${port}/slow`,
      method: 'GET',
      headers: {},
    });
    await new Promise((r) => setTimeout(r, 50));
    session.close();
    await expect(pending).rejects.toThrow();
  });
});

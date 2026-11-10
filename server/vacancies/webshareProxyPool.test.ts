import { describe, expect, it, vi } from 'vitest';
import {
  createWebsharePool,
  isLinkedinUrl,
  parseWebshareList,
  readStaticProxyList,
  readWebshareCredentials,
  type WebshareProxy,
} from './webshareProxyPool';

const P = (host: string): WebshareProxy => ({ host, port: 8000, username: 'u', password: 'p' });

function setup(statusByHost: Record<string, number[]>, list = [P('a'), P('b'), P('c')]) {
  let t = 1_000_000;
  const used: string[] = [];
  const direct = vi.fn(async () => new Response('direct', { status: 200 }));
  const pool = createWebsharePool({
    credentials: { apiKey: 'k' },
    now: () => t,
    loadList: async () => list,
    direct: direct as unknown as typeof fetch,
    fetchVia: async (proxy) => {
      used.push(proxy.host);
      const queue = statusByHost[proxy.host] ?? [];
      const status = queue.length > 0 ? queue.shift()! : 200;
      return new Response(status === 200 ? 'ok' : '', { status });
    },
  });
  return { pool, used, direct, advance: (ms: number) => (t += ms) };
}

describe('webshareProxyPool', () => {
  it('reads credentials only with an API key', () => {
    expect(readWebshareCredentials({})).toBeUndefined();
    expect(readWebshareCredentials({ WEBSHARE_API_KEY: ' k ', WEBSHARE_LOGIN: 'l' })).toEqual({
      apiKey: 'k',
      login: 'l',
    });
  });

  it('parses valid proxies and falls back to env login', () => {
    const list = parseWebshareList(
      {
        results: [
          { proxy_address: '1.1.1.1', port: 6000, username: 'x', password: 'y', valid: true },
          { proxy_address: '2.2.2.2', port: 6001, valid: true },
          { proxy_address: '3.3.3.3', port: 6002, username: 'x', password: 'y', valid: false },
          { proxy_address: '', port: 1 },
        ],
      },
      { login: 'L', password: 'W' },
    );
    expect(list).toEqual([
      { host: '1.1.1.1', port: 6000, username: 'x', password: 'y' },
      { host: '2.2.2.2', port: 6001, username: 'L', password: 'W' },
    ]);
    expect(() => parseWebshareList({})).toThrow('webshare-list-malformed');
  });

  it('matches only linkedin hosts', () => {
    expect(isLinkedinUrl('https://www.linkedin.com/jobs')).toBe(true);
    expect(isLinkedinUrl('https://evil-linkedin.com/')).toBe(false);
    expect(isLinkedinUrl('https://example.com/')).toBe(false);
  });

  it('rotates linkedin requests and sends other hosts directly', async () => {
    const { pool, used, direct } = setup({});
    await pool.fetch('https://www.linkedin.com/1');
    await pool.fetch('https://www.linkedin.com/2');
    await pool.fetch('https://www.linkedin.com/3');
    await pool.fetch('https://example.com/');
    expect(used).toEqual(['a', 'b', 'c']);
    expect(direct).toHaveBeenCalledTimes(1);
    expect(pool.parallelism()).toBe(3);
  });

  it('pauses a proxy on 429 and retries through the next one', async () => {
    const { pool, used, advance } = setup({ a: [429] });
    const res = await pool.fetch('https://www.linkedin.com/x');
    expect(res.status).toBe(200);
    expect(used).toHaveLength(2);
    expect(used[1]).not.toBe('a');
    expect(pool.stats()).toMatchObject({ proxies: 3, active: 2, paused: 1, limitedLastHour: 1 });
    advance(31 * 60_000);
    expect(pool.stats().active).toBe(3);
  });

  it('returns 429 when every proxy is limited', async () => {
    const { pool } = setup({ a: [429], b: [429], c: [429] });
    const res = await pool.fetch('https://www.linkedin.com/x');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const again = await pool.fetch('https://www.linkedin.com/y');
    expect(again.status).toBe(429);
    expect(pool.parallelism()).toBe(1);
  });

  it('goes direct when the list is empty or fails to load', async () => {
    const { pool, direct } = setup({}, []);
    await pool.fetch('https://www.linkedin.com/x');
    expect(direct).toHaveBeenCalledTimes(1);
    const failing = createWebsharePool({
      credentials: { apiKey: 'k' },
      loadList: async () => {
        throw new Error('webshare-list-status-401');
      },
      direct: direct as unknown as typeof fetch,
    });
    await failing.fetch('https://www.linkedin.com/x');
    expect(failing.stats().listError).toBe('webshare-list-status-401');
  });

  it('reads a static paid proxy list from env', () => {
    expect(readStaticProxyList({})).toEqual([]);
    expect(
      readStaticProxyList({
        OPENQAREER_LINKEDIN_GUEST_PROXY_URLS:
          'http://u%40x:p@1.2.3.4:80, bad, socks5://a:b@h:1,http://h:0',
      }),
    ).toEqual([{ host: '1.2.3.4', port: 80, username: 'u@x', password: 'p' }]);
  });
});

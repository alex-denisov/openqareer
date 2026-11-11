import { describe, expect, it } from 'vitest';
import { politeFetch } from './hostLimiter';

describe('B643-9 polite fetch', () => {
  it('spaces requests to one host and lets other hosts through at once', async () => {
    const waits: [string, number][] = [];
    const hosts: string[] = [];
    let current = '';
    const base = (async (input: string | URL | Request) => {
      hosts.push(new URL(String(input)).host);
      return new Response('ok');
    }) as typeof fetch;
    const fetchImpl = politeFetch(base, { gapMs: 1000, now: () => 0, sleep: async (ms) => { waits.push([current, ms]); } });
    for (const url of ['https://a.com/1', 'https://a.com/2', 'https://b.com/1', 'https://a.com/3']) {
      current = new URL(url).host;
      await fetchImpl(url);
    }
    expect(hosts).toEqual(['a.com', 'a.com', 'b.com', 'a.com']);
    expect(waits).toEqual([['a.com', 1000], ['a.com', 2000]]);
  });
});

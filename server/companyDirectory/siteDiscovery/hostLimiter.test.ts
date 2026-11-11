import { describe, expect, it } from 'vitest';
import { politeFetch } from './hostLimiter';

describe('B643-9 polite fetch', () => {
  it('spaces requests to one host and lets other hosts through at once', async () => {
    const starts: [string, number][] = [];
    const t0 = Date.now();
    const base = (async (input: string | URL | Request) => {
      starts.push([new URL(String(input)).host, Date.now() - t0]);
      return new Response('ok');
    }) as typeof fetch;
    const fetchImpl = politeFetch(base, { gapMs: 80 });
    await Promise.all([fetchImpl('https://a.com/1'), fetchImpl('https://a.com/2'), fetchImpl('https://b.com/1')]);
    const a = starts.filter(([h]) => h === 'a.com').map(([, t]) => t);
    expect(a[1]! - a[0]!).toBeGreaterThanOrEqual(70);
    expect(starts.find(([h]) => h === 'b.com')![1]).toBeLessThan(40);
  });
});

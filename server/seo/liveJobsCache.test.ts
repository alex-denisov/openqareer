import { describe, expect, it, vi } from 'vitest';
import { LiveJobsCache, liveJobsXmlChunked } from './liveJobsCache';
import { liveJobsXml } from './liveSitemap';
import { renderUrlset } from './sitemapXml';

const urls = Array.from({ length: 1_000 }, (_, index) => ({ path: `/vacancies/job/a-at-x-k${index}`, lastmod: '2026-11-10' }));
const xml = renderUrlset(urls);
const live = (key: string) => (Number(key.slice(1)) % 3 === 0 ? undefined : `/vacancies/job/a-at-x-${key}`);

describe('B776: live job sitemap off the event loop', () => {
  it('chunked filter gives the same file and lets other work run between chunks', async () => {
    let calls = 0;
    const seen: number[] = [];
    const tick = () => { seen.push(calls); if (calls < 1_000) setImmediate(tick); };
    setImmediate(tick);
    const out = await liveJobsXmlChunked(xml, (key) => { calls += 1; return live(key); }, 100);
    expect(out).toBe(liveJobsXml(xml, live));
    expect(seen.some((count) => count > 0 && count < 1_000)).toBe(true);
  });

  it('cache: fresh copy without a rebuild; old copy served at once and rebuilt once behind', async () => {
    let now = 0;
    const cache = new LiveJobsCache(60_000, () => now);
    const resolve = vi.fn(live);
    const first = await cache.read('jobs-1.xml', xml, resolve);
    expect(resolve).toHaveBeenCalledTimes(1_000);
    expect(await cache.read('jobs-1.xml', xml, resolve)).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(1_000);

    now = 60_000;
    const stale = cache.read('jobs-1.xml', xml, resolve);
    const again = cache.read('jobs-1.xml', xml, resolve);
    expect(await stale).toBe(first);
    expect(await again).toBe(first);
    await cache.idle();
    expect(resolve).toHaveBeenCalledTimes(2_000);
  });

  it('cache: a new build of the file is not answered from the old one', async () => {
    const cache = new LiveJobsCache(60_000, () => 0);
    await cache.read('jobs-1.xml', xml, live);
    const next = renderUrlset(urls.slice(0, 2));
    expect(await cache.read('jobs-1.xml', next, live)).toBe(liveJobsXml(next, live));
  });
});

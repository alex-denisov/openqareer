import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  healthMessage,
  runSitemapHealth,
  runSitemapHealthJob,
  sitemapHealthDue,
} from './sitemapHealth';

const ORIGIN = 'https://openqareer.com';

function page(url: string): string {
  return `<html><head><link rel="canonical" href="${url}"></head><body></body></html>`;
}

function site(urls: string[], broken: Record<string, number> = {}, flaky: string[] = []) {
  const seen = new Map<string, number>();
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    seen.set(url, (seen.get(url) ?? 0) + 1);
    if (url === `${ORIGIN}/robots.txt`) return new Response('User-agent: *\nDisallow: /api/\n');
    if (url === `${ORIGIN}/sitemap.xml`) {
      return new Response(
        `<sitemapindex><sitemap><loc>${ORIGIN}/sitemaps/jobs-1.xml</loc></sitemap></sitemapindex>`,
      );
    }
    if (url === `${ORIGIN}/sitemaps/jobs-1.xml`) {
      return new Response(
        `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`,
      );
    }
    if (flaky.includes(url) && seen.get(url) === 1) return new Response('', { status: 410 });
    const status = broken[url];
    if (status) return new Response('', { status });
    return new Response(page(url));
  };
  return { fetcher: fetcher as typeof fetch, seen };
}

const urls = Array.from({ length: 30 }, (_, i) => `${ORIGIN}/vacancies/job/a-${i}`);
const logs: Array<{ details: Record<string, unknown>; message: string }> = [];
const log = {
  info: (details: Record<string, unknown>, message: string) => logs.push({ details, message }),
  error: (details: Record<string, unknown>, message: string) => logs.push({ details, message }),
};

describe('daily sitemap check', () => {
  it('walks a sample, rechecks failures once and reports only stable ones', async () => {
    const bad = urls[3]!;
    const { fetcher } = site(urls, { [bad]: 404 }, [urls[5]!]);
    const result = await runSitemapHealth({
      origin: ORIGIN,
      fetcher,
      sampleSize: 30,
      random: () => 0.5,
      pause: async () => undefined,
    });
    expect(result.total).toBe(30);
    expect(result.checked).toBe(30);
    expect(result.violations).toEqual([{ url: bad, problems: ['status 404'] }]);
  });

  it('samples at most the requested number of addresses', async () => {
    const { fetcher, seen } = site(urls);
    const result = await runSitemapHealth({
      origin: ORIGIN,
      fetcher,
      sampleSize: 10,
      random: Math.random,
      pause: async () => undefined,
    });
    expect(result.checked).toBe(10);
    expect([...seen.keys()].filter((u) => u.includes('/job/'))).toHaveLength(10);
    expect(result.violations).toEqual([]);
  });

  it('writes plain Russian for the owner', () => {
    expect(healthMessage({ total: 115_000, checked: 2_000, violations: [] })).toBe(
      'Проверка карты сайта: открыли 2 000 случайных страниц из 115 000, все открываются ' +
        'и доступны поиску.',
    );
    const text = healthMessage({
      total: 100,
      checked: 50,
      violations: [
        { url: `${ORIGIN}/a`, problems: ['status 404'] },
        { url: `${ORIGIN}/b`, problems: ['meta robots noindex'] },
      ],
    });
    expect(text).toContain('2 из 50');
    expect(text).toContain('не открывается: 1');
    expect(text).toContain('закрыта от поиска: 1');
    expect(text).toContain(`${ORIGIN}/a`);
    expect(text).not.toMatch(/noindex|canonical|status|robots/u);
  });

  it('runs once a UTC day', () => {
    const db = new DatabaseSync(':memory:');
    const now = new Date('2026-11-11T10:00:00Z');
    expect(sitemapHealthDue(db, now)).toBe(true);
    db.prepare(
      'INSERT INTO sitemap_health_runs (day, checked, violations, finished_at) VALUES (?, 1, 0, ?)',
    ).run('2026-11-11', now.toISOString());
    expect(sitemapHealthDue(db, now)).toBe(false);
    expect(sitemapHealthDue(db, new Date('2026-11-12T00:10:00Z'))).toBe(true);
  });

  it('writes one journal entry and one owner message per day', async () => {
    const db = new DatabaseSync(':memory:');
    const sent: string[] = [];
    const deps = {
      database: db,
      log,
      telegram: {},
      now: () => new Date('2026-11-11T10:00:00Z'),
      check: async () => ({ total: 10, checked: 10, violations: [] }),
      notify: async (_config: unknown, text: string) => {
        sent.push(text);
        return { status: 'disabled' as const };
      },
    };
    await runSitemapHealthJob(deps);
    await runSitemapHealthJob(deps);
    expect(logs.filter((entry) => entry.message === 'sitemap-health')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { createFeedClient, resetFeedHostBackoff } from './feedClient';
import {
  FREEHIRE_FEED_SOURCES,
  fetchFreehireFeed,
  freehireDetailTextSource,
} from './freehireFeeds';
import { DEFAULT_VACANCY_SOURCES } from '../defaultVacancySources';
import { detailTextSourceFor } from '../detailTextSources';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

type Route = (url: string) => Response | Promise<Response>;

function clientFor(route: Route, calls: string[] = [], sleeps: number[] = []) {
  return createFeedClient({
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return route(url);
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
}

beforeEach(() => resetFeedHostBackoff());

describe('freehire feeds registry (B641)', () => {
  it('registers every feed as an enabled json_api source in the defaults', () => {
    const ids = new Set(DEFAULT_VACANCY_SOURCES.map((s) => s.id));
    for (const source of FREEHIRE_FEED_SOURCES) {
      expect(ids.has(source.id)).toBe(true);
      expect(source.type).toBe('json_api');
      expect(source.id.startsWith('src-fh-')).toBe(true);
    }
    expect(FREEHIRE_FEED_SOURCES.length).toBe(13);
  });

  it('routes card text through detailTextSources', () => {
    expect(detailTextSourceFor('src-fh-ozon')).toBe(freehireDetailTextSource('src-fh-ozon'));
    expect(detailTextSourceFor('src-fh-sber')).toBeUndefined();
  });
});

describe('feed client', () => {
  it('retries a 5xx and then succeeds', async () => {
    let n = 0;
    const client = clientFor(() => (n++ === 0 ? json({}, 502) : json({ ok: true })));
    await expect(client.getJson('https://a.example/x')).resolves.toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it('does not retry a 404', async () => {
    let n = 0;
    const client = clientFor(() => {
      n += 1;
      return json({}, 404);
    });
    await expect(client.getJson('https://a.example/x')).rejects.toThrow('404');
    expect(n).toBe(1);
  });

  it('pauses the whole host for Retry-After after a 429', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const client = clientFor(
      () => (n++ === 0 ? json({}, 429, { 'Retry-After': '7' }) : json({ ok: 1 })),
      [],
      sleeps,
    );
    await client.getJson('https://a.example/x');
    expect(sleeps.some((ms) => ms >= 6_000 && ms <= 7_000)).toBe(true);
  });
});

describe('Russian company feeds', () => {
  it('Sber steps by received rows when the site caps the page size', async () => {
    const calls: string[] = [];
    const client = clientFor((url) => {
      const skip = Number(new URL(url).searchParams.get('skip'));
      const vacancies = Array.from({ length: Math.min(2, 3 - skip) }, (_, i) => ({
        requisitionId: `r${skip + i}`,
        internalId: skip + i,
        title: `T${skip + i}`,
        city: 'Москва',
        publicationDate: '2026-11-09T10:00:00Z',
        duties: '<p>Задачи</p>',
      }));
      return json({ data: { vacancies, total: 3 } });
    }, calls);
    const reading = await fetchFreehireFeed('src-fh-sber', 'Сбер', client);
    expect(reading.vacancies.map((v) => v.title)).toEqual(['T0', 'T1', 'T2']);
    expect(calls.map((u) => new URL(u).searchParams.get('skip'))).toEqual(['0', '2']);
    expect(reading.partial).toBe(false);
    expect(reading.vacancies[0]?.url).toBe('https://rabota.sber.ru/search/0');
    expect(reading.vacancies[0]?.description).toContain('Задачи');
  });

  it('Yandex drops redirects and follows the cursor once', async () => {
    const client = clientFor((url) =>
      url.includes('cursor=')
        ? json({ results: [{ id: 2, title: 'B', publication_slug_url: 'b-2', vacancy: {} }] })
        : json({
            next: '/jobs/api/jobs/publications/?cursor=c1',
            results: [
              { id: 1, title: 'A', publication_slug_url: 'a-1', vacancy: { cities: [{ name: 'Москва' }] } },
              { id: 9, title: 'Redirect', redirect_url: 'https://x', vacancy: {} },
            ],
          }),
    );
    const reading = await fetchFreehireFeed('src-fh-yandex', 'Яндекс', client);
    expect(reading.vacancies.map((v) => v.title)).toEqual(['A', 'B']);
    expect(reading.vacancies[0]?.company).toBe('Яндекс');
  });

  it('Ozon keeps external vacancies only and links by hhId', async () => {
    const client = clientFor(() =>
      json({
        meta: { totalPages: 1 },
        items: [
          { hhId: 11, title: 'Ext', vacancyType: 'external_vacancy', city: 'Москва', workFormat: ['Удалённо'] },
          { hhId: 12, title: 'Int', vacancyType: 'internal_vacancy' },
        ],
      }),
    );
    const reading = await fetchFreehireFeed('src-fh-ozon', 'Ozon', client);
    expect(reading.vacancies).toHaveLength(1);
    expect(reading.vacancies[0]?.url).toBe('https://career.ozon.ru/vacancy/11/');
    expect(reading.vacancies[0]?.isRemote).toBe(true);
  });

  it('a failure on a later page keeps what was read as a partial reading', async () => {
    let n = 0;
    const client = clientFor(() =>
      n++ === 0
        ? json({ meta: { totalPages: 3 }, items: [{ hhId: 1, title: 'A', vacancyType: 'external_vacancy' }] })
        : json({}, 404),
    );
    const reading = await fetchFreehireFeed('src-fh-ozon', 'Ozon', client);
    expect(reading).toMatchObject({ partial: true });
    expect(reading.vacancies).toHaveLength(1);
  });

  it('a failure on the first page is a source failure', async () => {
    const client = clientFor(() => json({}, 403));
    await expect(fetchFreehireFeed('src-fh-rwb', 'RWB', client)).rejects.toThrow('403');
  });
});

describe('card text', () => {
  const cases: [string, string, string][] = [
    ['src-fh-yandex', 'https://yandex.ru/jobs/vacancies/inzhener-49593', 'https://yandex.ru/jobs/api/publications/49593'],
    ['src-fh-ozon', 'https://career.ozon.ru/vacancy/136849808/', 'https://job-api.ozon.ru/vacancy/136849808'],
    ['src-fh-lamoda', 'https://job.lamoda.ru/vacancies/sofino/operator--3454', 'https://job.lamoda.ru/api/hr/vacancies/3454'],
    ['src-fh-rwb', 'https://career.rwb.ru/vacancies/41150', 'https://career.rwb.ru/crm-api/api/v1/pub/vacancies/41150'],
    ['src-fh-dodo', 'https://dodoteam.ru/vacancy/8068', 'https://job-site-backend.dodo-ai-platform.io/api/v1/pages/vacancy/8068'],
  ];
  it.each(cases)('%s maps the public link to its card API', (sourceId, url, api) => {
    expect(freehireDetailTextSource(sourceId)?.detailUrl(sourceId, { url })).toBe(api);
  });

  it('refuses a link on another host', () => {
    const source = freehireDetailTextSource('src-fh-ozon');
    expect(source?.detailUrl('src-fh-ozon', { url: 'https://evil.example/vacancy/1/' })).toBeUndefined();
  });

  it('reads Ozon card text from HTML', () => {
    const source = freehireDetailTextSource('src-fh-ozon');
    expect(source?.readText({ descr: '<p>Ищем <b>аналитика</b></p>' })).toBe('Ищем аналитика');
  });
});

import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { RobotsPolicyLoader } from './robotsPolicyLoader';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B204 — площадка называет своё правило в `robots.txt`, и продукт обязан его
 * прочитать сам, а не полагаться на запись в реестре, сделанную когда-то руками.
 */
function source(id: string, targetUrl: string): VacancySourceConfig {
  return {
    id,
    name: id,
    type: 'json_api',
    enabled: true,
    targetUrl,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

describe('движок уважает robots.txt площадки', () => {
  it('запрет словами останавливает опрос, и площадка об этом сказана', async () => {
    let fetched = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [source('ats-smartrecruiters-x', 'https://api.smartrecruiters.com/v1/companies/X/postings')],
      fetcher: async () => {
        fetched += 1;
        return [];
      },
      robots: new RobotsPolicyLoader({
        fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /\n' }),
      }),
    });

    const outcome = await engine.syncSource('ats-smartrecruiters-x');

    expect(fetched).toBe(0);
    // Запрет площадки — не поломка продукта: он назван словами, а не красным
    // отказом, который читается как «сломалось у нас».
    expect(outcome.status).toBe('disabled');
    expect(outcome.message).toContain('robots');
  });

  it('разрешение словами опрос не трогает', async () => {
    let fetched = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [source('ats-lever-ledger', 'https://api.lever.co/v0/postings/ledger?mode=json')],
      fetcher: async () => {
        fetched += 1;
        return [];
      },
      robots: new RobotsPolicyLoader({
        fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nAllow: /\nCrawl-delay: 1\n' }),
      }),
    });

    const outcome = await engine.syncSource('ats-lever-ledger');

    expect(fetched).toBe(1);
    expect(outcome.status).toBe('healthy');
  });

  it('без загрузчика движок работает как раньше', async () => {
    let fetched = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [source('src-test', 'https://example.com/api')],
      fetcher: async () => {
        fetched += 1;
        return [];
      },
    });

    expect((await engine.syncSource('src-test')).status).toBe('healthy');
    expect(fetched).toBe(1);
  });
});

/**
 * B217 — владелец разрешил Remotive вопреки `Disallow: /api/*`: API площадки
 * задокументирован для того же использования. Исключение живёт в реестре
 * явным полем с датой и основанием, а не в памяти агента; без него запрет
 * robots действует как прежде.
 */
describe('явное разрешение владельца поверх robots.txt (B217)', () => {
  it('источник с robotsOverride опрашивается, без него — нет', async () => {
    const calls: string[] = [];
    const robots = new RobotsPolicyLoader({
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /api/\n' }),
    });
    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          ...source('remotive', 'https://remotive.com/api/remote-jobs'),
          robotsOverride: {
            grantedBy: 'owner',
            grantedOn: '2026-09-14',
            basis: 'API задокументирован площадкой для распространения вакансий со ссылкой на источник',
          },
        },
        source('other', 'https://remotive.com/api/other'),
      ],
      fetcher: async (config) => {
        calls.push(config.id);
        return [];
      },
      robots,
    });

    await engine.syncSource('remotive');
    await engine.syncSource('other');

    expect(calls).toEqual(['remotive']);
  });
});

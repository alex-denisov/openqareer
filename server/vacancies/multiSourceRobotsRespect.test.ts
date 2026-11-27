import { describe, expect, it } from 'vitest';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { RobotsPolicyLoader } from './robotsPolicyLoader';
import { emptySourceObservations } from './sourceHealthVerdict';
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

describe('движок читает robots.txt для вежливости без блокировки источников', () => {
  it('Disallow в robots.txt не останавливает и не отключает опрос площадки', async () => {
    let fetched = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [
        source('ats-smartrecruiters-x', 'https://api.smartrecruiters.com/v1/companies/X/postings'),
      ],
      fetcher: async () => {
        fetched += 1;
        return [];
      },
      robots: new RobotsPolicyLoader({
        fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /\nCrawl-delay: 4\n' }),
      }),
    });

    const outcome = await engine.syncSource('ats-smartrecruiters-x');

    expect(fetched).toBe(1);
    expect(outcome.status).toBe('healthy');
    expect(engine.getSource('ats-smartrecruiters-x')?.enabled).toBe(true);
    expect(engine.getScheduler().getScheduleInfo('ats-smartrecruiters-x').crawlDelaySeconds).toBe(4);
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
        fetchRobots: async () => ({
          status: 200,
          body: 'User-agent: *\nAllow: /\nCrawl-delay: 1\n',
        }),
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

describe('robotsOverride и снятие прежней блокировки (B217)', () => {
  it('опрашивает как источники с robotsOverride, так и без него', async () => {
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
            basis:
              'API задокументирован площадкой для распространения вакансий со ссылкой на источник',
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

    expect(calls).toEqual(['remotive', 'other']);
  });
});

describe('Phase 1 F6 — revival of legacy disabled sources & 429 hold', () => {
  it('keeps sources enabled across restart and revives previously disabled states as paused retryable errors', async () => {
    const pool = new MemoryVacancyPoolStore();
    const id = 'ats-smartrecruiters-blocked';
    pool.saveSourceState({
      sourceId: id,
      lastSyncAt: '2026-11-20T00:00:00.000Z',
      lastStatus: 'disabled',
      lastErrorMessage: 'robots_txt_disallows_this_address',
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
      observations: {
        ...emptySourceObservations(),
        schedule: {
          sourceId: id,
          consecutiveFailures: 0,
          lastAttemptAtMs: null,
          lastSuccessAtMs: null,
          lastStatusCode: null,
          retryAfterUntilMs: null,
          hourlyRequestTimestamps: [],
          consecutiveUnchangedCount: 0,
          crawlDelaySeconds: null,
          robotsVerdict: 'disallowed',
        },
      },
    });

    const restarted = new MultiSourceVacancyEngine({
      sources: [source(id, 'https://api.smartrecruiters.com/v1/companies/Blocked/postings')],
      pool,
    });
    const restored = restarted.getSource(id)!;
    expect(restored.enabled).toBe(true);
    expect(restored.lastStatus).toBe('error');
    expect(restarted.getScheduler().getScheduleInfo(id).robotsVerdict).toBe('allowed');
    expect(restarted.getScheduler().getScheduleInfo(id).isDue).toBe(true);
  });

  it('holds and backs off without calling fetcher or setting error when /robots.txt returns 429', async () => {
    let fetched = 0;
    const id = 'ats-join-429-robots';
    const robots = new RobotsPolicyLoader({
      fetchRobots: async () => ({ status: 429, body: null, retryAfterHeader: '120' }),
    });
    const engine = new MultiSourceVacancyEngine({
      sources: [source(id, 'https://join.com/api/public/companies/167291/jobs')],
      fetcher: async () => {
        fetched += 1;
        return [];
      },
      robots,
    });

    const outcome = await engine.syncSource(id, undefined, 10_000);
    expect(fetched).toBe(0);
    expect(outcome.status).toBe('held');
    expect(engine.getSource(id)?.lastStatus).toBeUndefined();
  });
});

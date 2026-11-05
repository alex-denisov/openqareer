import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function source(id: string): VacancySourceConfig {
  return {
    id,
    name: id,
    type: 'rss',
    enabled: true,
    targetUrl: `https://example.test/${id}`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function vacancy(id: string, publishedMs: number): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: 'Инженер',
    company: 'GitLab',
    description: 'Описание',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'rss',
      sourceId: 'src-a',
      sourceUrl: `https://example.test/${id}`,
      observedAt: new Date(publishedMs).toISOString(),
    },
    publishedAt: new Date(publishedMs).toISOString(),
    status: 'active',
  };
}

const livenessOf = (engine: MultiSourceVacancyEngine, id: string, nowMs: number) =>
  engine.getSourceHealth(id, nowMs)?.liveness;

describe('еженедельная перепроверка приостановленных площадок', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('снимает приостановку за отсутствие свежих вакансий, когда они появились', async () => {
    let calls = 0;
    let fresh = false;
    const engine = new MultiSourceVacancyEngine({
      sources: [source('src-a')],
      fetcher: async (_source, _query) => {
        calls += 1;
        return [vacancy(`a${calls}`, fresh ? NOW + 8 * DAY_MS : NOW - 200 * DAY_MS)];
      },
    });
    await engine.syncSource('src-a', undefined, NOW);
    expect(livenessOf(engine, 'src-a', NOW)?.pausedBecause).toBe('no_fresh_vacancies');

    await engine.syncDue(NOW + 6 * DAY_MS);
    expect(calls).toBe(1);

    fresh = true;
    vi.setSystemTime(NOW + 8 * DAY_MS);
    await engine.syncDue(NOW + 8 * DAY_MS);
    expect(calls).toBe(2);
    expect(livenessOf(engine, 'src-a', NOW + 8 * DAY_MS)?.verdict).toBe('alive');
    expect(livenessOf(engine, 'src-a', NOW + 8 * DAY_MS)?.pausedBecause).toBeNull();
  });

  it('снимает приостановку за ссылки только когда ссылки открылись, а снятые не публикует', async () => {
    let status = 404;
    const pool = new MemoryVacancyPoolStore();
    const engine = new MultiSourceVacancyEngine({
      sources: [source('src-a')],
      pool,
      fetcher: async (_source, _query) =>
        Array.from({ length: 30 }, (_, index) => vacancy(`a${index}`, Date.now())),
      linkProbe: async () => ({ status }),
    });
    await engine.syncSource('src-a', undefined, NOW);
    await engine.probeSourceLinks('src-a', NOW);
    const paused = NOW + 8 * DAY_MS;
    expect(livenessOf(engine, 'src-a', NOW)?.pausedBecause).toBe('links_not_opening');

    vi.setSystemTime(paused);
    await engine.syncDue(paused);
    expect(livenessOf(engine, 'src-a', paused)?.pausedBecause).toBe('links_not_opening');
    expect(pool.countSourceSlice('src-a').active).toBe(0);

    status = 200;
    const reopened = paused + 8 * DAY_MS;
    vi.setSystemTime(reopened);
    await engine.syncDue(reopened);
    expect(livenessOf(engine, 'src-a', reopened)?.pausedBecause).toBeNull();
  });

  it('перепроверяет за такт одну площадку, самую давнюю, и не занимает очередь живых', async () => {
    const seen: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [source('src-a'), source('src-b'), source('src-live')],
      fetcher: async (config, _query) => {
        seen.push(config.id);
        return [
          vacancy(
            `${config.id}-${seen.length}`,
            config.id === 'src-live' ? NOW + 8 * DAY_MS : NOW - 200 * DAY_MS,
          ),
        ];
      },
    });
    await engine.syncSource('src-a', undefined, NOW);
    await engine.syncSource('src-b', undefined, NOW + 1000);
    seen.length = 0;

    vi.setSystemTime(NOW + 8 * DAY_MS);
    await engine.syncDue(NOW + 8 * DAY_MS);

    expect(seen.sort()).toEqual(['src-a', 'src-live']);
  });
});

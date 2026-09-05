import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { StoredSourceState, VacancyPoolStore } from './vacancyPoolStore';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B200 срез 1 — движок копит наблюдения опроса и отдаёт здоровье площадки, а
 * мёртвую площадку плановый опрос больше не выбирает.
 */

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function source(overrides: Partial<VacancySourceConfig> = {}): VacancySourceConfig {
  return {
    id: 'src-test',
    name: 'Тестовый источник',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://example.test/feed',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
    ...overrides,
  };
}

function vacancy(id: string, publishedAt: string, company = 'GitLab'): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: 'Инженер',
    company,
    description: 'Описание',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'rss',
      sourceId: 'src-test',
      sourceUrl: `https://example.test/${id}`,
      observedAt: daysAgo(0),
    },
    publishedAt,
    status: 'active',
  };
}

describe('B200 · здоровье площадок в движке', () => {
  it('считает живость по улову, а не по факту успешного ответа', async () => {
    // Улов есть, но весь он старше полугода: фильтр свежести движка выбросит
    // его целиком, и без переписи улова площадка выглядела бы «просто пустой».
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a', daysAgo(200)), vacancy('b', daysAgo(300))],
    });

    await engine.syncSource('src-test', undefined, NOW);
    const report = engine.getSourceHealthReport(NOW);
    const health = report.find((item) => item.sourceId === 'src-test');

    expect(health?.liveness.verdict).toBe('dead');
    expect(health?.liveness.fresherThan180Days).toEqual({ counted: 0, of: 2 });
  });

  it('не выбирает мёртвую площадку плановым опросом', async () => {
    let calls = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => {
        calls += 1;
        return [vacancy('a', daysAgo(200))];
      },
    });

    await engine.syncSource('src-test', undefined, NOW);
    expect(calls).toBe(1);

    // Интервал давно прошёл, но площадка мертва — тянуть с неё нечего.
    const outcomes = await engine.syncDue(NOW + 10 * 60 * 60 * 1000);

    expect(calls).toBe(1);
    expect(outcomes).toEqual([]);
  });

  it('называет доверие низким, когда работодателя нет у большинства карточек', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () =>
        Array.from({ length: 96 }, (_, index) =>
          vacancy(`v${index}`, daysAgo(1), index < 10 ? 'GitLab' : 'Tech Company'),
        ),
    });

    await engine.syncSource('src-test', undefined, NOW);
    const health = engine.getSourceHealthReport(NOW)[0];

    expect(health.liveness.verdict).toBe('alive');
    expect(health.trust.verdict).toBe('low');
    expect(health.trust.completeness.withEmployer).toEqual({ counted: 10, of: 96 });
  });

  it('площадка без установленного права не выдаётся за доверенную', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a', daysAgo(1))],
    });

    await engine.syncSource('src-test', undefined, NOW);
    const health = engine.getSourceHealthReport(NOW)[0];

    expect(health.trust.lawfulness.addressStatus).toBe('not_established');
    expect(health.trust.verdict).toBe('low');
  });

  it('ошибка опроса не удлиняет серию пустых уловов', async () => {
    let shouldFail = false;
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => {
        if (shouldFail) throw new Error('boom');
        return [vacancy('a', daysAgo(1))];
      },
    });

    await engine.syncSource('src-test', undefined, NOW);
    shouldFail = true;
    await engine.syncSource('src-test', undefined, NOW + 60_000);

    const health = engine.getSourceHealthReport(NOW + 60_000)[0];
    expect(health.liveness.verdict).toBe('unreachable');
    expect(health.liveness.consecutiveEmptyReadings).toBe(0);
  });

  it('переносит наблюдения через перезапуск процесса', async () => {
    const states = new Map<string, StoredSourceState>();
    const pool: VacancyPoolStore = {
      loadVacancies: () => [],
      loadSourceStates: () => Array.from(states.values()),
      replaceSourceSlice: () => undefined,
      saveSourceState: (state) => {
        states.set(state.sourceId, state);
      },
      prune: () => undefined,
    };

    const first = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a', daysAgo(200))],
      pool,
    });
    await first.syncSource('src-test', undefined, NOW);
    expect(first.getSourceHealthReport(NOW)[0].liveness.verdict).toBe('dead');

    // Новый процесс — то же наблюдение: живость не считается заново с нуля,
    // иначе каждый деплой воскрешал бы мёртвую площадку.
    const second = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a', daysAgo(200))],
      pool,
    });
    second.restore(NOW);

    expect(second.getSourceHealthReport(NOW)[0].liveness.verdict).toBe('dead');
  });
});

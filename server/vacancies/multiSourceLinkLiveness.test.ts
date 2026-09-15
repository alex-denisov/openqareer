import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import type { VacancyPoolStore } from './vacancyPoolStore';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B200 срез 2 — движок обходит ссылки улова, хоронит снятые объявления и
 * записывает обход в наблюдения площадки.
 */

const NOW = Date.parse('2026-09-07T09:00:00.000Z');
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

function vacancy(id: string, sourceId = 'src-test'): UnifiedVacancy {
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
      sourceId,
      sourceUrl: `https://example.test/${id}`,
      observedAt: daysAgo(0),
    },
    publishedAt: daysAgo(1),
    status: 'active',
  };
}

function recordingPool(): { pool: VacancyPoolStore; buried: Array<[readonly string[], string]> } {
  const buried: Array<[readonly string[], string]> = [];
  class RecordingPool extends MemoryVacancyPoolStore {
    override markExpired(ids: readonly string[], atIso: string): number {
      buried.push([ids, atIso]);
      return super.markExpired(ids, atIso);
    }
  }
  return { buried, pool: new RecordingPool() };
}

describe('B200 · обход ссылок площадки в движке', () => {
  it('перестаёт отдавать объявление, чей адрес ответил 404, и хоронит его в пуле', async () => {
    const { pool, buried } = recordingPool();
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a'), vacancy('b')],
      pool,
      linkProbe: async (url) => (url.endsWith('/b') ? { status: 404 } : { status: 200 }),
    });
    await engine.syncSource('src-test', undefined, NOW);
    expect(
      engine
        .getVacancies()
        .items.map((v) => v.id)
        .sort(),
    ).toEqual(['a', 'b']);

    const census = await engine.probeSourceLinks('src-test', NOW);

    expect(census).toMatchObject({ open: 1, gone: 1, checked: 2, sampledFrom: 2 });
    expect(engine.getVacancies().items.map((v) => v.id)).toEqual(['a']);
    expect(buried).toEqual([[['b'], new Date(NOW).toISOString()]]);
  });

  it('кладёт обход в здоровье площадки со своим знаменателем', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a'), vacancy('b')],
      linkProbe: async () => ({ status: 200 }),
    });
    await engine.syncSource('src-test', undefined, NOW);
    await engine.probeSourceLinks('src-test', NOW);

    const health = engine.getSourceHealthReport(NOW)[0]!;
    expect(health.liveness.linkCheck).toMatchObject({
      checkedAt: new Date(NOW).toISOString(),
      open: 2,
      checked: 2,
      sampledFrom: 2,
    });
  });

  it('без пробы в сеть не ходит и наблюдений не выдумывает', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source()],
      fetcher: async () => [vacancy('a')],
    });
    await engine.syncSource('src-test', undefined, NOW);

    expect(await engine.probeSourceLinks('src-test', NOW)).toBeUndefined();
    expect(engine.getSourceHealthReport(NOW)[0]!.liveness.linkCheck.checkedAt).toBeNull();
  });

  it('берёт очередной обход у площадки, которую проверяли дольше всех', async () => {
    const probed: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [source(), source({ id: 'src-two', name: 'Вторая' })],
      fetcher: async (config) => [vacancy(`${config.id}-a`, config.id)],
      linkProbe: async (url) => {
        probed.push(url);
        return { status: 200 };
      },
    });
    await engine.syncSource('src-test', undefined, NOW);
    await engine.syncSource('src-two', undefined, NOW);

    await engine.probeDueLinks(NOW);
    await engine.probeDueLinks(NOW + 60_000);

    expect(probed).toEqual(['https://example.test/src-test-a', 'https://example.test/src-two-a']);
  });

  it('не обходит ссылки выключенной площадки', async () => {
    let calls = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [source({ enabled: false })],
      fetcher: async () => [vacancy('a')],
      linkProbe: async () => {
        calls += 1;
        return { status: 200 };
      },
    });
    await engine.syncSource('src-test', undefined, NOW);
    engine.toggleSource('src-test', false);

    await engine.probeDueLinks(NOW);

    expect(calls).toBe(0);
  });
});

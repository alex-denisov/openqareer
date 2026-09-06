import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * Прод 2026-09-06: половина досок в каждой волне падала по таймауту, хотя сеть
 * ни при чём — 12 одновременных ответов приходят на прод-VM за секунду. Считал
 * не канал, а процесс: каждый успешный опрос пересобирал кластеры всего пула
 * заново, и двенадцать пересборок подряд не давали дочитать ответы остальным.
 * Волна пересобирает пул один раз.
 */
function source(index: number): VacancySourceConfig {
  return {
    id: `ats-greenhouse-b${index}`,
    name: `Board ${index}`,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://boards-api.greenhouse.io/v1/boards/b${index}/jobs`,
    refreshIntervalMinutes: 720,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function vacancy(sourceId: string, index: number): UnifiedVacancy {
  return {
    id: `${sourceId}:${index}`,
    fingerprint: `${sourceId}:${index}`,
    title: index === 1 ? 'Frontend Engineer' : 'Data Scientist',
    company: `Company ${sourceId}`,
    description: 'React, TypeScript',
    requiredSkills: ['React'],
    url: `https://boards.greenhouse.io/${sourceId}/${index}`,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: `https://boards.greenhouse.io/${sourceId}/${index}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

describe('пересборка кластеров стоит один раз за волну', () => {
  it('плановая волна пересобирает пул однажды, а не на каждую площадку', async () => {
    const sources = Array.from({ length: 6 }, (_, index) => source(index));
    const engine = new MultiSourceVacancyEngine({
      sources,
      fetcher: async (s) => [vacancy(s.id, 1), vacancy(s.id, 2)],
    });

    const before = engine.clusterRebuildCount;
    const outcomes = await engine.syncDue();

    expect(outcomes).toHaveLength(6);
    expect(engine.clusterRebuildCount - before).toBe(1);
    // Пул после волны собран целиком: экономия не стоила свежести.
    expect(engine.getActiveClusters()).toHaveLength(12);
  });

  it('одиночный опрос по-прежнему оставляет пул пересобранным', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source(0)],
      fetcher: async (s) => [vacancy(s.id, 1)],
    });

    await engine.syncSource('ats-greenhouse-b0');

    expect(engine.getActiveClusters()).toHaveLength(1);
  });
});

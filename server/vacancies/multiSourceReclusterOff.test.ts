import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B230: на проде полная пересборка кластеров запрещена — 560К записей не
 * помещаются в кучу ни одного из двух процессов. Режим `off` пишет пул и
 * состояние площадок, но никогда не запускает `clusterVacancies` по всему
 * пулу: ни синхронно, ни в фоне.
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
    title: 'Frontend Engineer',
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

describe('recluster mode off (B230)', () => {
  it('a wave fills the pool but never rebuilds clusters', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source(0), source(1)],
      fetcher: async (s) => [vacancy(s.id, 1), vacancy(s.id, 2)],
      recluster: { mode: 'off' },
    });

    const outcomes = await engine.syncDue();

    expect(outcomes.map((o) => o.status)).toEqual(['healthy', 'healthy']);
    expect(engine.poolSize).toBe(4);
    expect(engine.clusterRebuildCount).toBe(0);
    expect(engine.backgroundRecluster).toBeUndefined();
    expect(engine.reclusterStats.inFlight).toBe(false);
  });

  it('explicit recluster calls are refused', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [source(0)],
      fetcher: async (s) => [vacancy(s.id, 1)],
      recluster: { mode: 'off' },
    });
    await engine.syncDue();

    expect(() => engine.recluster()).toThrow(/recluster.*off/i);
    await expect(engine.reclusterAsync()).rejects.toThrow(/recluster.*off/i);
    expect(engine.clusterRebuildCount).toBe(0);
  });
});

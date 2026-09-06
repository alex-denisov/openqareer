import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine, SYNC_BATCH_LIMIT } from './multiSourceVacancyEngine';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * Прод 2026-09-06: кнопка «синхронизировать все» подняла 195 включённых
 * источников одним залпом, и 92 доски работодателей отдали
 * `The operation was aborted due to timeout` — не потому, что они молчали, а
 * потому что продукт сам забил себе канал. Ручной опрос обязан идти волнами
 * той же ширины, что и плановый.
 */
function source(index: number): VacancySourceConfig {
  return {
    id: `ats-greenhouse-board${index}`,
    name: `Board ${index}`,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://boards-api.greenhouse.io/v1/boards/board${index}/jobs?content=true`,
    refreshIntervalMinutes: 720,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

describe('ручной опрос всех площадок идёт волнами', () => {
  it('никогда не держит больше предела одновременных запросов', async () => {
    const total = SYNC_BATCH_LIMIT * 3 + 4;
    let inFlight = 0;
    let peak = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: Array.from({ length: total }, (_, index) => source(index)),
      fetcher: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return [];
      },
    });

    const outcomes = await engine.syncAll();

    // Опрошены все до одной — волны не теряют источники.
    expect(outcomes).toHaveLength(total);
    expect(peak).toBeLessThanOrEqual(SYNC_BATCH_LIMIT);
  });
});

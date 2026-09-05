import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine, SYNC_BATCH_LIMIT } from './multiSourceVacancyEngine';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B202 — досок работодателей сотни, и все они «пора опросить» в первую же
 * минуту после запуска. Опросить их одним залпом — это сотни одновременных
 * запросов к чужим серверам и мегабайты в память процесса. Плановый опрос берёт
 * ограниченную партию, начиная с самых давно не опрошенных.
 */
function board(index: number): VacancySourceConfig {
  return {
    id: `ats-greenhouse-board${index}`,
    name: `Board ${index}`,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://boards-api.greenhouse.io/v1/boards/board${index}/jobs`,
    refreshIntervalMinutes: 720,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

describe('плановый опрос берёт партию, а не всё сразу', () => {
  it('за один такт опрашивает не больше предела и добирает остальное следующим', async () => {
    const asked: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: Array.from({ length: SYNC_BATCH_LIMIT + 5 }, (_, index) => board(index)),
      fetcher: async (source) => {
        asked.push(source.id);
        return [];
      },
    });

    const first = await engine.syncDue();
    expect(first).toHaveLength(SYNC_BATCH_LIMIT);
    expect(asked).toHaveLength(SYNC_BATCH_LIMIT);

    const second = await engine.syncDue();
    expect(second).toHaveLength(5);
    // Ни одна доска не опрошена дважды, пока есть неопрошенные.
    expect(new Set(asked).size).toBe(SYNC_BATCH_LIMIT + 5);
  });

  it('первой идёт площадка, которую дольше всех не опрашивали', async () => {
    const asked: string[] = [];
    const sources = [board(1), board(2), board(3)];
    const engine = new MultiSourceVacancyEngine({
      sources,
      fetcher: async (source) => {
        asked.push(source.id);
        return [];
      },
    });

    await engine.syncSource('ats-greenhouse-board2');
    await engine.syncSource('ats-greenhouse-board3');
    asked.length = 0;

    await engine.syncDue();
    expect(asked[0]).toBe('ats-greenhouse-board1');
  });
});

import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';

describe('MultiSourceVacancyEngine · дочитывание окнами заданного размера (B759)', () => {
  it('передаёт размер окна в хранилище и делает паузу между окнами', async () => {
    const pool = new MemoryVacancyPoolStore();
    const windows: Array<number | undefined> = [];
    let left = 3;
    Object.assign(pool, {
      backfillWindowStep: (windowRows?: number) => {
        windows.push(windowRows);
        left -= 1;
        return { done: left === 0 };
      },
    });
    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'board',
          name: 'Board',
          type: 'remotive',
          enabled: true,
          targetUrl: 'https://example.com',
          refreshIntervalMinutes: 60,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      pool,
    } as ConstructorParameters<typeof MultiSourceVacancyEngine>[0]);
    const startedAt = performance.now();
    const { backfillWindows } = await engine.maintainStoreAsync(Date.now(), () => false, {
      pauseMs: 20,
      windowRows: 2_000,
    });
    expect(backfillWindows).toBe(3);
    expect(windows).toEqual([2_000, 2_000, 2_000]);
    // Две паузы между тремя окнами.
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(35);
  });
});

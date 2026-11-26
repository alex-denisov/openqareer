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

describe('MultiSourceVacancyEngine · продолжение прохода с сохранённого шага (B759)', () => {
  function engineOver(pool: MemoryVacancyPoolStore) {
    return new MultiSourceVacancyEngine({
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
  }

  function recordingPool(windows: number) {
    const pool = new MemoryVacancyPoolStore();
    const calls: string[] = [];
    let left = windows;
    Object.assign(pool, {
      pruneAsync: async () => {
        calls.push('pool');
      },
      pruneClustersBeforeAsync: async () => {
        calls.push('clusters');
        return 0;
      },
      backfillWindowStep: (_rows?: number, from?: number) => {
        calls.push(`backfill:${from ?? 0}`);
        left -= 1;
        const cursor = (from ?? 0) + 100;
        return { done: left === 0, cursor: left === 0 ? 0 : cursor };
      },
    });
    return { pool, calls };
  }

  it('с шага дочитывания: чистки пропущены, окно — с сохранённой позиции', async () => {
    const { pool, calls } = recordingPool(2);
    const progress: unknown[] = [];
    await engineOver(pool).maintainStoreAsync(Date.now(), () => false, {
      from: { step: 'backfill', backfillCursor: 500 },
      onProgress: (next) => progress.push(next),
    });
    expect(calls).toEqual(['backfill:500', 'backfill:600']);
    expect(progress).toEqual([{ step: 'backfill', backfillCursor: 600 }]);
  });

  it('с начала: каждый законченный шаг отмечается до следующего', async () => {
    const { pool, calls } = recordingPool(1);
    const progress: unknown[] = [];
    await engineOver(pool).maintainStoreAsync(Date.now(), () => false, {
      onProgress: (next) => progress.push(next),
    });
    expect(calls).toEqual(['pool', 'clusters', 'backfill:0']);
    expect(progress).toEqual([
      { step: 'clusters', backfillCursor: 0 },
      { step: 'backfill', backfillCursor: 0 },
    ]);
  });

  it('с шага кластеров: чистка пула пропущена', async () => {
    const { pool, calls } = recordingPool(1);
    await engineOver(pool).maintainStoreAsync(Date.now(), () => false, {
      from: { step: 'clusters', backfillCursor: 0 },
    });
    expect(calls).toEqual(['clusters', 'backfill:0']);
  });
});

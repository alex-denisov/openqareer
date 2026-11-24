import { describe, expect, it } from 'vitest';
import { runStorePassSteps, type StorePassProgress } from './storePassSteps';
import type { VacancyPoolStore } from './vacancyPoolStore';

/** Как node:sqlite после истечения busy_timeout. */
function busyError(): Error {
  return Object.assign(new Error('database is locked'), {
    code: 'ERR_SQLITE_ERROR',
    errcode: 5,
    errstr: 'database is locked',
  });
}

/** Пул из трёх окон дочитывания; `failures` — сколько раз подряд окно с этим курсором занято. */
function poolWith(failures: Map<number, number>) {
  const calls: number[] = [];
  const pool = {
    prune: () => undefined,
    backfillWindowStep: (_rows: number | undefined, cursor = 0) => {
      calls.push(cursor);
      const left = failures.get(cursor) ?? 0;
      if (left > 0) {
        failures.set(cursor, left - 1);
        throw busyError();
      }
      return cursor >= 3_000 ? { done: true } : { done: false, cursor: cursor + 1_000 };
    },
  } as unknown as VacancyPoolStore;
  return { pool, calls };
}

function run(pool: VacancyPoolStore, progress: StorePassProgress[], busyDelaysMs = [0, 0, 0]) {
  return runStorePassSteps({
    pool,
    knownSourceIds: [],
    oldestPublishedAt: '2026-01-01',
    shouldStop: () => false,
    pruneClustersSync: () => undefined,
    options: {
      from: { step: 'backfill', backfillCursor: 1_000 },
      onProgress: (next) => progress.push(next),
      busyDelaysMs,
    },
  });
}

describe('runStorePassSteps: занятая база не роняет проход (B759, прод 23.11 05:42Z)', () => {
  it('окно с «database is locked» повторяется с того же курсора, и проход доходит до конца', async () => {
    const { pool, calls } = poolWith(new Map([[2_000, 2]]));
    const progress: StorePassProgress[] = [];
    await expect(run(pool, progress)).resolves.toEqual({ backfillWindows: 3 });
    expect(calls).toEqual([1_000, 2_000, 2_000, 2_000, 3_000]);
    expect(progress.map((step) => step.backfillCursor)).toEqual([2_000, 3_000]);
  });

  it('занятость дольше всех повторов — ошибка, а курсор остаётся на последнем окне', async () => {
    const { pool } = poolWith(new Map([[2_000, 9]]));
    const progress: StorePassProgress[] = [];
    await expect(run(pool, progress)).rejects.toThrow('database is locked');
    expect(progress.at(-1)).toEqual({ step: 'backfill', backfillCursor: 2_000 });
  });

  it('другая ошибка не повторяется', async () => {
    let calls = 0;
    const pool = {
      prune: () => undefined,
      backfillWindowStep: () => {
        calls += 1;
        throw new Error('disk I/O error');
      },
    } as unknown as VacancyPoolStore;
    await expect(run(pool, [])).rejects.toThrow('disk I/O error');
    expect(calls).toBe(1);
  });
});

describe('runStorePassSteps: занятая база во время чистки (B759)', () => {
  it('чистка пула с «database is locked» повторяется и проход идёт дальше', async () => {
    let busyLeft = 1;
    let prunes = 0;
    const pool = {
      prune: () => {
        prunes += 1;
        if (busyLeft-- > 0) throw busyError();
      },
    } as unknown as VacancyPoolStore;
    const progress: StorePassProgress[] = [];
    await runStorePassSteps({
      pool,
      knownSourceIds: [],
      oldestPublishedAt: '2026-01-01',
      shouldStop: () => false,
      pruneClustersSync: () => undefined,
      options: { onProgress: (next) => progress.push(next), busyDelaysMs: [0] },
    });
    expect(prunes).toBe(2);
    expect(progress.map((step) => step.step)).toEqual(['clusters', 'backfill']);
  });
});

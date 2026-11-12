import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLandingStats } from './landingStatsJob';
import { scheduleLandingStatsJob } from './landingStatsSchedule';

vi.mock('./landingStatsJob', () => ({
  computeLandingStats: vi.fn(() => ({ activeCount: 1, vacancies: [] })),
  writeLandingStats: vi.fn(),
  readLandingStats: vi.fn(),
}));
vi.mock('../vacancies/catalogSources', () => ({
  computeCatalogSources: vi.fn(() => []),
  writeCatalogSources: vi.fn(),
  readCatalogSources: vi.fn(),
  setCatalogSources: vi.fn(),
}));
vi.mock('../vacancies/catalogSalaryStatsStore', () => ({
  computeCatalogSalaryStats: vi.fn(() => []),
  writeCatalogSalaryStats: vi.fn(),
}));
vi.mock('../vacancies/catalogChipStore', () => ({
  computeCatalogChips: vi.fn(() => []),
  writeCatalogChips: vi.fn(() => ({ rows: 0 })),
}));

const MINUTE = 60_000;
const silentLog = () => ({ info: vi.fn(), error: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T20:00:00Z'));
  vi.mocked(computeLandingStats).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('счёт лендинга и фишек по сохранённому сроку', () => {
  it('перезапуск до срока счёт не повторяет, а в срок он идёт', async () => {
    const database = new DatabaseSync(':memory:');
    const stopFirst = scheduleLandingStatsJob(database, silentLog());
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(computeLandingStats).toHaveBeenCalledOnce();
    stopFirst();

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    const stopSecond = scheduleLandingStatsJob(database, silentLog());
    await vi.advanceTimersByTimeAsync(20 * MINUTE - 1);
    expect(computeLandingStats).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(computeLandingStats).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it('сбой счёта пишется в журнал, и новый старт повторяет его', async () => {
    vi.mocked(computeLandingStats).mockImplementationOnce(() => {
      throw new Error('locked');
    });
    const database = new DatabaseSync(':memory:');
    const log = silentLog();
    const stopFirst = scheduleLandingStatsJob(database, log);
    await vi.advanceTimersByTimeAsync(MINUTE);
    stopFirst();
    expect(log.error).toHaveBeenCalledOnce();

    const stopSecond = scheduleLandingStatsJob(database, silentLog());
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(computeLandingStats).toHaveBeenCalledTimes(2);
    stopSecond();
  });
});

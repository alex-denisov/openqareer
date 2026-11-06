import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schedulePersistedJob } from './persistedJobSchedule';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const options = { job: 'heavy', firstRunMs: 3 * MINUTE, intervalMs: 6 * HOUR };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const start = (database: DatabaseSync, run: () => boolean) =>
  schedulePersistedJob(database, { error: vi.fn() }, { ...options, run });

describe('тяжёлый шаг по сохранённому сроку', () => {
  it('без записи о запуске идёт вскоре после старта', () => {
    const run = vi.fn(() => true);
    const stop = start(new DatabaseSync(':memory:'), run);
    vi.advanceTimersByTime(3 * MINUTE - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledOnce();
    stop();
  });

  it('перезапуск со свежими данными шаг не повторяет', () => {
    const database = new DatabaseSync(':memory:');
    const run = vi.fn(() => true);
    const stopFirst = start(database, run);
    vi.advanceTimersByTime(3 * MINUTE);
    stopFirst();

    vi.advanceTimersByTime(HOUR);
    const stopSecond = start(database, run);
    vi.advanceTimersByTime(5 * HOUR - 1);
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it('частые перезапуски не откладывают срок', () => {
    const database = new DatabaseSync(':memory:');
    const run = vi.fn(() => true);
    start(database, run)();
    const stopFirst = start(database, run);
    vi.advanceTimersByTime(3 * MINUTE);
    stopFirst();
    for (let restart = 0; restart < 12; restart += 1) {
      const stop = start(database, run);
      vi.advanceTimersByTime(30 * MINUTE);
      stop();
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('просроченный шаг ждёт паузу после старта, а не идёт сразу', () => {
    const database = new DatabaseSync(':memory:');
    const run = vi.fn(() => true);
    const stopFirst = start(database, run);
    vi.advanceTimersByTime(3 * MINUTE);
    stopFirst();
    vi.advanceTimersByTime(7 * HOUR);

    const stopSecond = start(database, run);
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(3 * MINUTE);
    expect(run).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it('неудачный запуск срок не сдвигает: новый старт повторит шаг', () => {
    const database = new DatabaseSync(':memory:');
    const run = vi.fn(() => false);
    const stopFirst = start(database, run);
    vi.advanceTimersByTime(3 * MINUTE);
    stopFirst();

    const stopSecond = start(database, run);
    vi.advanceTimersByTime(3 * MINUTE);
    expect(run).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it('без перезапусков идёт раз в интервал', () => {
    const run = vi.fn(() => true);
    const stop = start(new DatabaseSync(':memory:'), run);
    vi.advanceTimersByTime(3 * MINUTE + 12 * HOUR);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it('разные шаги считают срок отдельно', () => {
    const database = new DatabaseSync(':memory:');
    const first = vi.fn(() => true);
    const stopFirst = start(database, first);
    vi.advanceTimersByTime(3 * MINUTE);
    stopFirst();

    const other = vi.fn(() => true);
    const stopOther = schedulePersistedJob(
      database,
      { error: vi.fn() },
      { ...options, job: 'other', run: other },
    );
    vi.advanceTimersByTime(3 * MINUTE);
    expect(other).toHaveBeenCalledOnce();
    stopOther();
  });

  it('сбой чтения срока не роняет старт: шаг идёт и ошибка в журнале', () => {
    const database = new DatabaseSync(':memory:');
    database.close();
    const run = vi.fn(() => true);
    const log = { error: vi.fn() };
    const stop = schedulePersistedJob(database, log, { ...options, run });
    vi.advanceTimersByTime(3 * MINUTE);
    expect(run).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalled();
    stop();
  });

  it('срок асинхронного шага пишется только после его успеха', async () => {
    const database = new DatabaseSync(':memory:');
    const log = { error: vi.fn() };
    let finishRun: (ok: boolean) => void = () => undefined;
    const stop = schedulePersistedJob(database, log, {
      job: 'async-job',
      firstRunMs: 1000,
      intervalMs: 60_000,
      run: () => new Promise<boolean>((done) => (finishRun = done)),
    });
    const stored = () =>
      database.prepare("SELECT 1 FROM maintenance_job_runs WHERE job = 'async-job'").get();
    vi.advanceTimersByTime(1000);
    expect(stored()).toBeUndefined();
    finishRun(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toBeDefined();
    stop();
  });
});

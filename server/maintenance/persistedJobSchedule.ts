import type { DatabaseSync } from 'node:sqlite';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS maintenance_job_runs (
  job TEXT PRIMARY KEY,
  finished_ms INTEGER NOT NULL
)`;

export interface PersistedJobLog {
  error(details: Record<string, unknown>, message: string): void;
}

export interface PersistedJobOptions {
  readonly job: string;
  /** Пауза после старта, даже если срок прошёл: старт и так нагружает процесс. */
  readonly firstRunMs: number;
  readonly intervalMs: number;
  /**
   * B761: шаг идёт раз в сутки в это время UTC (минуты от полуночи), а не по `intervalMs`
   * от старта. Перезапуск в течение `DAILY_CATCH_UP_MS` после пропущенного слота догоняет
   * проход, позже — ждёт следующего слота.
   */
  readonly dailyAtUtcMinute?: number;
  /** B803: сколько после слота догонять прерванный проход; по умолчанию час. */
  readonly dailyCatchUpMs?: number;
  /** Истина: шаг удался, срок считается от этого запуска. */
  readonly run: () => boolean | Promise<boolean>;
}

const DAY_MS = 24 * 60 * 60_000;
const DAILY_CATCH_UP_MS = 60 * 60_000;

/** Последний слот дня не позже `nowMs`. */
function slotAtOrBefore(nowMs: number, atUtcMinute: number): number {
  const slot = Math.floor(nowMs / DAY_MS) * DAY_MS + atUtcMinute * 60_000;
  return slot <= nowMs ? slot : slot - DAY_MS;
}

function dailyFirstDelayMs(
  finished: number | undefined,
  nowMs: number,
  firstRunMs: number,
  atUtcMinute: number,
  catchUpMs: number,
): number {
  const slot = slotAtOrBefore(nowMs, atUtcMinute);
  const missed = finished === undefined || finished < slot;
  if (missed && nowMs - slot < catchUpMs) return firstRunMs;
  return slot + DAY_MS - nowMs;
}

function lastFinishedMs(database: DatabaseSync, job: string): number | undefined {
  database.exec(TABLE_SQL);
  const row = database
    .prepare('SELECT finished_ms FROM maintenance_job_runs WHERE job = ?')
    .get(job) as { finished_ms: number } | undefined;
  return row?.finished_ms;
}

function recordFinished(database: DatabaseSync, job: string, finishedMs: number): void {
  database
    .prepare(
      `INSERT INTO maintenance_job_runs (job, finished_ms) VALUES (?, ?)
       ON CONFLICT(job) DO UPDATE SET finished_ms = excluded.finished_ms`,
    )
    .run(job, finishedMs);
}

function reportFailure(log: PersistedJobLog, job: string, error: unknown): void {
  log.error(
    { job, errorName: error instanceof Error ? error.name : 'UnknownError' },
    'maintenance-job-state-failed',
  );
}

/**
 * Тяжёлый шаг обслуживания со сроком в базе, а не в таймере процесса. Прод
 * 05.11: зарплатные шаги держат очередь событий 300 с одним куском, а шли через
 * минуты после каждого старта: 59 раз за 26 часов при интервале 6 часов.
 */
export function schedulePersistedJob(
  database: DatabaseSync,
  log: PersistedJobLog,
  options: PersistedJobOptions,
): () => void {
  const { job, firstRunMs, intervalMs, dailyAtUtcMinute, run } = options;
  const { dailyCatchUpMs: catchUpMs = DAILY_CATCH_UP_MS } = options;
  const reportStateFailure = (error: unknown) => reportFailure(log, job, error);

  const firstDelayMs = (): number => {
    try {
      const finished = lastFinishedMs(database, job);
      if (dailyAtUtcMinute !== undefined) {
        return dailyFirstDelayMs(finished, Date.now(), firstRunMs, dailyAtUtcMinute, catchUpMs);
      }
      if (finished === undefined) return firstRunMs;
      return Math.max(firstRunMs, finished + intervalMs - Date.now());
    } catch (error: unknown) {
      reportStateFailure(error);
      return firstRunMs;
    }
  };

  let timer: ReturnType<typeof setTimeout>;
  const plan = (delayMs: number) => {
    timer = setTimeout(tick, delayMs);
    timer.unref();
  };
  const finish = (succeeded: boolean) => {
    if (succeeded) recordFinished(database, job, Date.now());
  };
  const nextDelayMs = (): number => {
    if (dailyAtUtcMinute === undefined) return intervalMs;
    const now = Date.now();
    return slotAtOrBefore(now, dailyAtUtcMinute) + DAY_MS - now;
  };
  const tick = () => {
    plan(nextDelayMs());
    try {
      const outcome = run();
      if (typeof outcome === 'boolean') finish(outcome);
      else void outcome.then(finish).catch(reportStateFailure);
    } catch (error: unknown) {
      reportStateFailure(error);
    }
  };

  plan(firstDelayMs());
  return () => clearTimeout(timer);
}

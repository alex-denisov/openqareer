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
  /** Истина: шаг удался, срок считается от этого запуска. */
  readonly run: () => boolean;
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
  const { job, firstRunMs, intervalMs, run } = options;
  const reportStateFailure = (error: unknown) =>
    log.error(
      { job, errorName: error instanceof Error ? error.name : 'UnknownError' },
      'maintenance-job-state-failed',
    );

  const firstDelayMs = (): number => {
    try {
      const finished = lastFinishedMs(database, job);
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
  const tick = () => {
    plan(intervalMs);
    if (!run()) return;
    try {
      recordFinished(database, job, Date.now());
    } catch (error: unknown) {
      reportStateFailure(error);
    }
  };

  plan(firstDelayMs());
  return () => clearTimeout(timer);
}

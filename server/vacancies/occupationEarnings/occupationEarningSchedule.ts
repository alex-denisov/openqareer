/** B803: раз в неделю открытые данные ILOSTAT и Всемирного банка; только процесс обслуживания. */
import type { DatabaseSync } from 'node:sqlite';
import { schedulePersistedJob } from '../../maintenance/persistedJobSchedule';
import { writeOpenStatistics } from './occupationEarningStore';
import { ILOSTAT_URL, WDI_URL, parseIlostat, parseWdi } from './openStatistics';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const FIRST_RUN_MS = 10 * 60_000;
const INTERVAL_MS = 7 * 24 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 120_000;

async function read(fetchImpl: Fetch, url: string): Promise<Response> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`open statistics HTTP ${response.status}`);
  return response;
}

/** Неудача оставляет прежние таблицы. */
export async function refreshOpenStatistics(
  database: DatabaseSync,
  log: Log,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  try {
    const earnings = parseIlostat(await (await read(fetchImpl, ILOSTAT_URL)).text());
    const incomes = parseWdi(await (await read(fetchImpl, WDI_URL)).json());
    log.info({ ...writeOpenStatistics(database, earnings, incomes) }, 'open-statistics-written');
    return true;
  } catch (error: unknown) {
    log.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        detail: error instanceof Error ? error.message.slice(0, 200) : undefined,
      },
      'open-statistics-failed',
    );
    return false;
  }
}

export function scheduleOpenStatisticsJob(database: DatabaseSync, log: Log): () => void {
  return schedulePersistedJob(database, log, {
    job: 'open-statistics',
    firstRunMs: FIRST_RUN_MS,
    intervalMs: INTERVAL_MS,
    run: () => refreshOpenStatistics(database, log),
  });
}

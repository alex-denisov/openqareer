/** B803: раз в неделю открытые данные ILOSTAT и Всемирного банка; только процесс обслуживания. */
import type { DatabaseSync } from 'node:sqlite';
import { readBoundedText } from '../../connectors/readBoundedJson';
import { schedulePersistedJob } from '../../maintenance/persistedJobSchedule';
import { openStatisticsLoadedAt, writeOpenStatistics } from './occupationEarningStore';
import { ILOSTAT_URL, WDI_URL, parseIlostat, parseWdi } from './openStatistics';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const FIRST_RUN_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Раз в сутки проверка срока: после сбоя повтор через сутки, а не через неделю. */
const CHECK_MS = DAY_MS;
const FRESH_MS = 7 * DAY_MS;
/** ILOSTAT 25.11 — 1,7 МБ, WDI меньше: ответ больше предела не тот. */
const MAX_BYTES = 16 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;

async function read(fetchImpl: Fetch, url: string): Promise<string> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`open statistics HTTP ${response.status}`);
  return readBoundedText(response, MAX_BYTES);
}

/** Неудача оставляет прежние таблицы. */
export async function refreshOpenStatistics(
  database: DatabaseSync,
  log: Log,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  try {
    const earnings = parseIlostat(await read(fetchImpl, ILOSTAT_URL));
    const incomes = parseWdi(JSON.parse(await read(fetchImpl, WDI_URL)));
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

export async function refreshWhenDue(
  database: DatabaseSync,
  log: Log,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  const loadedAt = openStatisticsLoadedAt(database);
  // Час запаса: суточный такт не должен сдвигать неделю на восьмой день.
  const due = loadedAt === undefined || Date.now() - loadedAt >= FRESH_MS - DAY_MS / 24;
  return due ? refreshOpenStatistics(database, log, fetchImpl) : true;
}

export function scheduleOpenStatisticsJob(database: DatabaseSync, log: Log): () => void {
  return schedulePersistedJob(database, log, {
    job: 'open-statistics',
    firstRunMs: FIRST_RUN_MS,
    intervalMs: CHECK_MS,
    run: () => refreshWhenDue(database, log),
  });
}

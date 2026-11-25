/**
 * B803: постоянная работа хранилища зарплат: рост цен и пересборка раз в неделю, покрытие и свежесть
 * раз в сутки в журнал. В журнале только счётчики.
 */
import type { DatabaseSync } from 'node:sqlite';
import { readBoundedText } from '../../connectors/readBoundedJson';
import { readCurrencyRates } from '../../currency/cbrRates';
import { schedulePersistedJob } from '../../maintenance/persistedJobSchedule';
import { parsePrices, PRICES_URL, writePrices } from '../salaryBenchmarks/priceIndex';
import { rebuildSalaryBenchmarks } from '../salaryBenchmarks/sqliteSalaryBenchmarkStore';
import { createSalaryEstimator, type EstimateCluster } from './salaryEstimateReader';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 120_000;
const MAX_BYTES = 16 * 1024 * 1024;
const SAMPLE = 500;
const PAUSE_EVERY = 10;
const PAUSE_MS = 50;

const details = (error: unknown) => ({
  errorName: error instanceof Error ? error.name : 'UnknownError',
  detail: error instanceof Error ? error.message.slice(0, 200) : undefined,
});

export async function refreshPrices(
  database: DatabaseSync,
  log: Log,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(PRICES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`prices HTTP ${response.status}`);
    writePrices(database, parsePrices(JSON.parse(await readBoundedText(response, MAX_BYTES))));
    log.info({ rows: rebuildSalaryBenchmarks(database) }, 'salary-benchmarks-rebuilt');
    return true;
  } catch (error: unknown) {
    log.error(details(error), 'salary-prices-failed');
    return false;
  }
}

function freshness(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT s.name, s.enabled, max(l.slice_date) AS sliceDate, count(l.id) AS slices
        FROM salary_sources s LEFT JOIN salary_slices l ON l.source = s.name GROUP BY s.name`,
    )
    .all();
}

const hasSalary = (salary: { from?: number | null; to?: number | null } | null | undefined) =>
  Boolean(salary && (salary.from || salary.to));

/** Доля вакансий без зарплаты, у которых есть оценка: ровная выборка пула с паузами. */
export async function measureCoverage(
  database: DatabaseSync,
  sample = SAMPLE,
): Promise<{ readonly checked: number; readonly covered: number; readonly steps: object }> {
  const { last } = database
    .prepare('SELECT coalesce(max(rowid), 0) AS last FROM vacancy_clusters')
    .get() as { last: number };
  const read = database.prepare(
    'SELECT cluster_json AS json FROM vacancy_clusters WHERE rowid = ?',
  );
  const estimator = createSalaryEstimator(database);
  const rates = readCurrencyRates(database);
  const steps: Record<string, number> = {};
  let checked = 0;
  const step = Math.max(1, Math.floor(last / sample));
  for (let id = 1, seen = 0; id <= last; id += step, seen += 1) {
    if (seen % PAUSE_EVERY === 0) await new Promise((done) => setTimeout(done, PAUSE_MS));
    const row = read.get(id) as { json: string } | undefined;
    if (!row) continue;
    const cluster = JSON.parse(row.json) as EstimateCluster & {
      salary?: { from?: number; to?: number };
    };
    if (hasSalary(cluster.salary)) continue;
    checked += 1;
    const name = estimator(cluster, () => undefined, rates, new Date())?.step;
    if (name) steps[name] = (steps[name] ?? 0) + 1;
  }
  const covered = Object.values(steps).reduce((sum, count) => sum + count, 0);
  return { checked, covered, steps };
}

async function report(database: DatabaseSync, log: Log): Promise<boolean> {
  try {
    const coverage = await measureCoverage(database);
    log.info({ ...coverage, sources: freshness(database) }, 'salary-coverage');
    return true;
  } catch (error: unknown) {
    log.error(details(error), 'salary-coverage-failed');
    return false;
  }
}

export function scheduleSalaryUpkeep(database: DatabaseSync, log: Log): () => void {
  const stops = [
    schedulePersistedJob(database, log, {
      job: 'salary-prices',
      firstRunMs: 40 * 60_000,
      intervalMs: 7 * DAY_MS,
      run: () => refreshPrices(database, log),
    }),
    schedulePersistedJob(database, log, {
      job: 'salary-coverage',
      firstRunMs: 2 * HOUR_MS,
      intervalMs: DAY_MS,
      run: () => report(database, log),
    }),
  ];
  return () => stops.forEach((stop) => stop());
}

/**
 * Timer of the Russian card summaries in the maintenance process
 * (`catalogRuSummaryJob.ts`). Off when the bulk channel is off; the own day
 * cap comes from `OPENQAREER_CATALOG_SUMMARY_DAY_USD` / `_DAY_CALLS`.
 */
import type { DatabaseSync } from 'node:sqlite';
import { readBulkLlmConfig } from '../providers/bulkLlmConfig';
import { createBulkLlmRuntime } from '../providers/bulkLlmRuntime';
import {
  CatalogRuSummaryJob,
  DEFAULT_CATALOG_RU_SUMMARY_LIMITS,
  sqliteCatalogRuSummarySpend,
  type CatalogRuSummaryReport,
} from './catalogRuSummaryJob';
import { CatalogRuSummaryStore } from './catalogRuSummaryStore';
import { CATALOG_RU_SUMMARY_VERSION } from './catalogRuSummary';

interface SummaryLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** ~4 300 calls a day at most; the day caps stop it well before that. */
const TICK_MS = 20_000;
const FIRST_TICK_MS = 120_000;

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function worthLogging(report: CatalogRuSummaryReport): boolean {
  return report.written + report.failed + report.thin > 0;
}

function limitsFrom(
  env: NodeJS.ProcessEnv,
  config: { readonly dayUsd: number; readonly monthUsd: number },
) {
  const defaults = DEFAULT_CATALOG_RU_SUMMARY_LIMITS;
  return {
    dayUsd: positive(env.OPENQAREER_CATALOG_SUMMARY_DAY_USD, defaults.dayUsd),
    dayCalls: positive(env.OPENQAREER_CATALOG_SUMMARY_DAY_CALLS, defaults.dayCalls),
    channelDayUsd: config.dayUsd,
    channelMonthUsd: config.monthUsd,
    channelShare: defaults.channelShare,
  };
}

/** One tick and its journal lines; a pause is logged once when it starts, not every 20 s. */
function ticker(job: CatalogRuSummaryJob, store: CatalogRuSummaryStore, log: SummaryLog) {
  let lastSkip: string | undefined;
  return async () => {
    try {
      const report = await job.step();
      if (worthLogging(report)) log.info({ ...report }, 'catalog-ru-summary-tick');
      if (report.skipped && report.skipped !== 'idle' && report.skipped !== lastSkip) {
        log.info(
          { skipped: report.skipped, ready: store.countReady(CATALOG_RU_SUMMARY_VERSION) },
          'catalog-ru-summary-paused',
        );
      }
      lastSkip = report.skipped;
    } catch (error: unknown) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'catalog-ru-summary-failed',
      );
    }
  };
}

export function scheduleCatalogRuSummaryJob(
  database: DatabaseSync,
  databasePath: string,
  log: SummaryLog,
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  const config = readBulkLlmConfig(env);
  if (!config || env.OPENQAREER_CATALOG_SUMMARY_ENABLED === 'false') {
    log.info({ bulk: Boolean(config) }, 'catalog-ru-summary-off');
    return () => undefined;
  }
  const runtime = createBulkLlmRuntime({ databasePath, env });
  const client = runtime.client;
  if (!client) return () => runtime.close();
  const store = new CatalogRuSummaryStore(database);
  store.ensureTable();
  const job = new CatalogRuSummaryJob({
    store,
    client,
    spend: sqliteCatalogRuSummarySpend(database),
    limits: limitsFrom(env, config),
  });
  const tick = ticker(job, store, log);
  const first = setTimeout(() => void tick(), FIRST_TICK_MS);
  const every = setInterval(() => void tick(), TICK_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
    runtime.close();
  };
}

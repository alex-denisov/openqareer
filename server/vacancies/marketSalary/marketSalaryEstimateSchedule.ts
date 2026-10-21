/**
 * B546: maintenance-process timer for market salary estimates. The pass reads
 * every salaried live vacancy, so it never runs on the web server.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  computeMarketSalaryEstimates,
  writeMarketSalaryEstimates,
} from './marketSalaryEstimateJob';

interface EstimateLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const FIRST_RUN_MS = 3 * 60_000;
const INTERVAL_MS = 6 * 60 * 60_000;

export function scheduleMarketSalaryEstimateJob(
  database: DatabaseSync,
  log: EstimateLog,
): () => void {
  const run = () => {
    const started = Date.now();
    try {
      const estimates = computeMarketSalaryEstimates(database);
      writeMarketSalaryEstimates(database, estimates, new Date());
      log.info(
        { ms: Date.now() - started, keys: estimates.size },
        'market-salary-estimates-written',
      );
    } catch (error: unknown) {
      log.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          ms: Date.now() - started,
        },
        'market-salary-estimates-failed',
      );
    }
  };
  const first = setTimeout(run, FIRST_RUN_MS);
  const every = setInterval(run, INTERVAL_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

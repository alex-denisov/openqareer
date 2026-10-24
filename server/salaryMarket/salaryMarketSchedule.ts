import type { DatabaseSync } from 'node:sqlite';
import { computeSalaryMarketSnapshots, writeSalaryMarketSnapshots } from './salaryMarketSnapshot';

interface SnapshotLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** Run only inside maintenance. Refresh daily so the rolling 90-day window stays current. */
export function scheduleSalaryMarketSnapshots(
  database: DatabaseSync,
  log: SnapshotLog,
): () => void {
  const run = () => {
    try {
      const snapshots = computeSalaryMarketSnapshots(database, new Date());
      writeSalaryMarketSnapshots(database, snapshots);
      log.info({ roles: snapshots.length }, 'salary-market-snapshots-written');
    } catch (error: unknown) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'salary-market-snapshots-failed',
      );
    }
  };
  const first = setTimeout(run, 4 * 60_000);
  const every = setInterval(run, 24 * 60 * 60_000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

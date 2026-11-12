import type { DatabaseSync } from 'node:sqlite';
import { schedulePersistedJob } from '../maintenance/persistedJobSchedule';
import { heavyRead } from '../maintenance/heavyReads/runHeavyRead';
import { writeSalaryMarketSnapshots } from './salaryMarketSnapshot';

interface SnapshotLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** Run only inside maintenance. Refresh daily so the rolling 90-day window stays current. */
export function scheduleSalaryMarketSnapshots(
  database: DatabaseSync,
  log: SnapshotLog,
): () => void {
  // B649-3: 789 s on the loop (12.11); the read now runs in its own thread.
  const run = async (): Promise<boolean> => {
    try {
      const snapshots = await heavyRead(database, 'salarySnapshots', { nowMs: Date.now() }, log);
      writeSalaryMarketSnapshots(database, snapshots);
      log.info({ roles: snapshots.length }, 'salary-market-snapshots-written');
      return true;
    } catch (error: unknown) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'salary-market-snapshots-failed',
      );
      return false;
    }
  };
  return schedulePersistedJob(database, log, {
    job: 'salary-market-snapshots',
    firstRunMs: 4 * 60_000,
    intervalMs: 24 * 60 * 60_000,
    run,
  });
}

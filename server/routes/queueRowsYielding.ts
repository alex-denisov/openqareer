import { isSqliteBusy, retryOnSqliteBusy } from '../data/sqliteBusyRetry';
import { mapYielding } from '../vacancies/mapYielding';

/** Off-loop waits for a taken write lock: together longer than the lock of a starting slot (B770). */
const QUEUE_BUSY_RETRY_MS: readonly number[] = [250, 1_000, 3_000, 5_000, 10_000];

/**
 * B702: rows go to the fit queue in slices; from the first row that finds the write lock taken, the
 * rest go one by one, each waiting off the event loop.
 */
export async function queueRowsYielding<T>(
  rows: readonly T[],
  queue: (row: T) => unknown,
  slicing: { readonly sliceMs?: number; readonly now?: () => number } = {},
): Promise<void> {
  const waiting: T[] = [];
  await mapYielding(
    rows,
    (row) => {
      if (waiting.length > 0) {
        waiting.push(row);
        return;
      }
      try {
        queue(row);
      } catch (error) {
        if (!isSqliteBusy(error)) throw error;
        waiting.push(row);
      }
    },
    slicing,
  );
  for (const row of waiting) {
    await retryOnSqliteBusy(() => queue(row), { delaysMs: QUEUE_BUSY_RETRY_MS });
  }
}

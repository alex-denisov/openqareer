import type { PoolWriteEvent } from '../vacancies/sqliteVacancyPoolStore';
import type { MaintenanceLog } from './maintenanceWorker';

/** Контракт B230: транзакция записи пула не держит write-lock дольше секунды. */
export const SLOW_POOL_WRITE_MS = 1_000;

/**
 * Журнал записи пула (PRB-043 срез 2): итог каждой замены среза — строкой
 * `pool-slice-written` с числом транзакций и самой долгой из них, а
 * транзакция дольше секунды — отдельным предупреждением. По этим строкам на
 * проде видно, держит ли обслуживатель контракт, а не по жалобам на вход.
 */
export function logPoolWrites(log: MaintenanceLog): (event: PoolWriteEvent) => void {
  return (event) => {
    if (event.kind === 'slice') {
      log.info(
        {
          operation: event.operation,
          sourceId: event.sourceId,
          upserted: event.upserted,
          removed: event.removed,
          transactions: event.transactions,
          maxTransactionMs: Math.round(event.maxTransactionMs),
          totalMs: Math.round(event.totalMs),
        },
        'pool-slice-written',
      );
      return;
    }
    if (event.durationMs > SLOW_POOL_WRITE_MS) {
      log.warn(
        {
          operation: event.operation,
          sourceId: event.sourceId,
          rows: event.rows,
          durationMs: Math.round(event.durationMs),
        },
        'pool-write-slow',
      );
    }
  };
}

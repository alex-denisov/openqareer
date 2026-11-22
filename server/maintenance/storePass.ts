import { PrunePassStopped } from '../vacancies/poolPruneBatches';
import type { StorePassMark } from './storePassMark';

/** Не чаще: частые рестарты не повторяют полную чистку пула (B759). */
export const STORE_PASS_MIN_GAP_MS = 6 * 60 * 60 * 1_000;
/** Через сколько после старта чистка начинается: первая волна идёт без неё. */
export const STORE_PASS_DELAY_MS = 5 * 60 * 1_000;
/** Пауза между транзакциями чистки: диск и блокировка записи свободны между ними. */
export const STORE_PASS_PAUSE_MS = 250;

export interface StorePassDeps {
  readonly maintainStoreAsync: (
    nowMs?: number,
    shouldStop?: () => boolean,
    options?: { pauseMs?: number },
  ) => Promise<{ backfillWindows: number }>;
  readonly mark?: StorePassMark;
  readonly stopped: () => boolean;
  readonly now: () => number;
  readonly log: {
    info(payload: Record<string, unknown>, message: string): void;
    error(payload: Record<string, unknown>, message: string): void;
  };
}

/**
 * Чистка пула и кластеров с дочитыванием (B649-2) — в фоне после старта
 * (B759): старт её больше не ждёт, между транзакциями пауза, остановка
 * процесса прерывает проход, а отметка не даёт повторять его на каждом рестарте.
 */
export async function runStorePass(deps: StorePassDeps): Promise<void> {
  if (deps.stopped()) return;
  const last = deps.mark?.lastFinishedMs() ?? null;
  const startedAt = deps.now();
  if (last !== null && startedAt - last < STORE_PASS_MIN_GAP_MS) {
    deps.log.info({ lastFinishedMs: last }, 'maintenance-store-pass-skipped');
    return;
  }
  try {
    const { backfillWindows } = await deps.maintainStoreAsync(startedAt, deps.stopped, {
      pauseMs: STORE_PASS_PAUSE_MS,
    });
    if (deps.stopped()) {
      deps.log.info({ ms: deps.now() - startedAt }, 'maintenance-store-pass-stopped');
      return;
    }
    deps.mark?.markFinished(deps.now());
    deps.log.info({ backfillWindows, ms: deps.now() - startedAt }, 'maintenance-store-pass');
  } catch (error) {
    if (error instanceof PrunePassStopped || deps.stopped()) {
      deps.log.info({ ms: deps.now() - startedAt }, 'maintenance-store-pass-stopped');
      return;
    }
    // Чистка не условие работы: сбой виден в журнале, волны идут дальше.
    deps.log.error(
      { errorName: (error as Error).name, message: (error as Error).message },
      'maintenance-store-pass-failed',
    );
  }
}

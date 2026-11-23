import { PrunePassStopped } from '../vacancies/poolPruneBatches';
import type { StorePassMark } from './storePassMark';
import type { StorePassOptions } from '../vacancies/storePassSteps';

/** Не чаще: частые рестарты не повторяют полную чистку пула (B759). */
export const STORE_PASS_MIN_GAP_MS = 6 * 60 * 60 * 1_000;
/** Через сколько после старта чистка начинается: первая волна идёт без неё. */
export const STORE_PASS_DELAY_MS = 5 * 60 * 1_000;
/**
 * Пауза между транзакциями и окнами чистки: диск и блокировка записи свободны
 * между ними. Замер 22.11: при 250 мс stalls цикла были в 1,5–2 раза выше обычного.
 */
export const STORE_PASS_PAUSE_MS = 1_000;
/** Строк индекса пула на окно дочитывания: 5 000 по умолчанию — короче шаг. */
export const STORE_PASS_WINDOW_ROWS = 2_000;

/**
 * Когда следующий проход: через 6 ч от отметки. Нет отметки или она старше срока
 * (проход сорвался) — снова через 6 ч, а не сразу: сбой не повторяется каждую минуту.
 */
export function nextStorePassDelayMs(lastFinishedMs: number | null, nowMs: number): number {
  if (lastFinishedMs === null) return STORE_PASS_MIN_GAP_MS;
  const due = lastFinishedMs + STORE_PASS_MIN_GAP_MS - nowMs;
  return due > 0 ? due : STORE_PASS_MIN_GAP_MS;
}

export interface StorePassDeps {
  readonly maintainStoreAsync: (
    nowMs?: number,
    shouldStop?: () => boolean,
    options?: StorePassOptions,
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
  // Незаконченный проход продолжается с сохранённого шага, срок отметки ему не помеха.
  const from = deps.mark?.progress() ?? null;
  if (!from && last !== null && startedAt - last < STORE_PASS_MIN_GAP_MS) {
    deps.log.info({ lastFinishedMs: last }, 'maintenance-store-pass-skipped');
    return;
  }
  if (from) deps.log.info({ ...from }, 'maintenance-store-pass-resumed');
  let reached = from;
  try {
    const { backfillWindows } = await deps.maintainStoreAsync(startedAt, deps.stopped, {
      pauseMs: STORE_PASS_PAUSE_MS,
      windowRows: STORE_PASS_WINDOW_ROWS,
      ...(from ? { from } : {}),
      onProgress: (progress) => {
        reached = progress;
        deps.mark?.saveProgress(progress);
      },
    });
    if (deps.stopped()) {
      deps.log.info({ ms: deps.now() - startedAt, ...reached }, 'maintenance-store-pass-stopped');
      return;
    }
    deps.mark?.markFinished(deps.now());
    deps.log.info({ backfillWindows, ms: deps.now() - startedAt }, 'maintenance-store-pass');
  } catch (error) {
    if (error instanceof PrunePassStopped || deps.stopped()) {
      deps.log.info({ ms: deps.now() - startedAt, ...reached }, 'maintenance-store-pass-stopped');
      return;
    }
    // Чистка не условие работы: сбой виден в журнале, волны идут дальше.
    deps.log.error(
      { errorName: (error as Error).name, message: (error as Error).message },
      'maintenance-store-pass-failed',
    );
  }
}

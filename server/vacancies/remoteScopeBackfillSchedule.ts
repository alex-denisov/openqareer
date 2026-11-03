/**
 * 03.11: таймер прохода области удалёнки в процессе обслуживания. Пачка за
 * пачкой с паузой, чтобы опрос источников и веб-сервер писали между ними;
 * после последней пачки таймер больше не ставится.
 *
 * Приёмка 03.11: пачка в 200 строк шла раз в 137 с — таймер ждал в одной
 * очереди событий за проходом разбора названий (шаги по ~5 с). Сама пачка
 * считается ~0,1 с, поэтому пачка крупнее: каждый дождавшийся таймер
 * продвигает проход в 5 раз дальше, а под блокировкой записи всё равно
 * только изменившиеся строки.
 */
import type { DatabaseSync } from 'node:sqlite';
import { runRemoteScopeBackfillBatch } from './remoteScopeBackfill';

interface BackfillLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const FIRST_RUN_MS = 2 * 60_000;
const PAUSE_MS = 500;
const RETRY_MS = 60_000;
const BATCH_ROWS = 1_000;
const LOG_EVERY_BATCHES = 20;

export function scheduleRemoteScopeBackfill(database: DatabaseSync, log: BackfillLog): () => void {
  let timer: NodeJS.Timeout | undefined;
  let batches = 0;
  let updated = 0;
  const next = (delay: number) => {
    timer = setTimeout(run, delay);
    timer.unref();
  };
  const run = () => {
    try {
      const result = runRemoteScopeBackfillBatch(database, BATCH_ROWS);
      batches += 1;
      updated += result.updated;
      if (result.completed) {
        log.info({ batches, updated }, 'remote-scope-backfill-completed');
        return;
      }
      if (batches % LOG_EVERY_BATCHES === 0)
        log.info({ batches, updated }, 'remote-scope-backfill-progress');
      next(PAUSE_MS);
    } catch (error: unknown) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError', batches },
        'remote-scope-backfill-failed',
      );
      next(RETRY_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => clearTimeout(timer);
}

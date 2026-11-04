import type { DatabaseSync } from 'node:sqlite';
import { maskFailureText } from '../../providers/failureReason';

const MAX_REASON = 200;

/** Причина сбоя для журнала и `last_failure`: имя ошибки и маскированное сообщение, без секретов. */
export function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : 'NonError';
  const raw = error instanceof Error ? error.message : String(error);
  return maskFailureText(`${name}: ${raw}`, MAX_REASON);
}

/** Добавляет nullable `last_failure`; ADD COLUMN без значения по умолчанию таблицу не переписывает. Повтор безопасен. */
export function ensureLastFailureColumn(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(title_parse_model_queue)').all() as {
    name: string;
  }[];
  if (columns.some((column) => column.name === 'last_failure')) return;
  database.exec('ALTER TABLE title_parse_model_queue ADD COLUMN last_failure TEXT');
}

export interface UnfreezeReport {
  readonly unfrozen: number;
  readonly batches: number;
}

/**
 * Разовая разморозка: только замороженные названия, у которых есть живые вакансии
 * (`vacancy_pool_index.is_active = 1 AND expired = 0`). Устаревшие остаются замороженными.
 * Идемпотентна: размороженная строка больше не подходит под `frozen = 1`.
 * Небольшие батчи с уступкой циклу событий — блокировка записи не держится долго.
 */
export async function unfreezeLiveTitles(
  database: DatabaseSync,
  options: { batchSize?: number } = {},
): Promise<UnfreezeReport> {
  const batchSize = options.batchSize ?? 100;
  ensureLastFailureColumn(database);
  const pick = database.prepare(
    `SELECT q.title_key AS titleKey FROM title_parse_model_queue q
     WHERE q.frozen = 1 AND EXISTS (
       SELECT 1 FROM vacancy_semantic s JOIN vacancy_pool_index i ON i.id = s.id
       WHERE s.title_key = q.title_key AND i.is_active = 1 AND i.expired = 0
     ) LIMIT ?`,
  );
  const reset = database.prepare(
    'UPDATE title_parse_model_queue SET frozen = 0, failures = 0, last_failure = NULL WHERE title_key = ? AND frozen = 1',
  );
  let unfrozen = 0;
  let batches = 0;
  for (;;) {
    const rows = pick.all(batchSize) as { titleKey: string }[];
    if (rows.length === 0) break;
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) unfrozen += Number(reset.run(row.titleKey).changes);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    batches += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { unfrozen, batches };
}

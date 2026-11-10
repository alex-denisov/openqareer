import { confirmsLiveness, NOT_SEEN_PRUNE_DAYS } from './poolLiveness';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

/** Одна порция за проход: остальное снимет следующий запуск, как и до разбивки. */
const PRUNE_PORTION_ROWS = 1000;

export interface PruneLimits {
  /** Строк на транзакцию. */
  readonly chunkRows: number;
  /** Работы на транзакцию: дольше неё другой процесс ждёт запись. */
  readonly budgetMs: number;
}

export interface PruneReport {
  readonly scope: 'pool' | 'clusters';
  readonly removed: number;
  readonly transactions: number;
  readonly maxTransactionMs: number;
  /** Поиск строк: идёт без блокировки записи и в удержание не входит. */
  readonly readMs: number;
  readonly totalMs: number;
}

type RowKey = string | number;

interface PrunePass {
  find(sql: string, ...params: SQLInputValue[]): RowKey[];
  remove(sql: string, keys: readonly RowKey[], ...params: SQLInputValue[]): number;
  report(): PruneReport;
}

/** Удаляет, пока есть строки и не вышло время; возвращает, сколько держал запись. */
function removeInOneTransaction(
  database: DatabaseSync,
  budgetMs: number,
  removeNext: () => boolean,
): number {
  database.exec('BEGIN IMMEDIATE');
  const lockedAt = performance.now();
  try {
    while (removeNext() && performance.now() - lockedAt < budgetMs);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return performance.now() - lockedAt;
}

/**
 * PRB-041 (прод 04.11): поиск строк шёл внутри транзакции, и обслуживатель на
 * старте держал запись 6,9 с, а HTTP всё это время ждал. Теперь поиск идёт до
 * транзакции, а удаление короткими транзакциями. Между поиском и удалением
 * другой писатель мог изменить строку, поэтому условие проверяется ещё раз там,
 * где ошибка стоила бы живых данных.
 */
function startPass(
  database: DatabaseSync,
  limits: PruneLimits,
  scope: PruneReport['scope'],
): PrunePass {
  const startedAt = performance.now();
  let removed = 0;
  let transactions = 0;
  let maxTransactionMs = 0;
  let readMs = 0;
  return {
    find(sql, ...params) {
      const readAt = performance.now();
      const rows = database.prepare(sql).all(...params) as Array<{ key: RowKey }>;
      readMs += performance.now() - readAt;
      return rows.map((row) => row.key);
    },
    remove(sql, keys, ...params) {
      const statement = database.prepare(sql);
      let changed = 0;
      let next = 0;
      while (next < keys.length) {
        const end = Math.min(next + limits.chunkRows, keys.length);
        const done = removeInOneTransaction(database, limits.budgetMs, () => {
          changed += Number(statement.run(keys[next]!, ...params).changes);
          next += 1;
          return next < end;
        });
        transactions += 1;
        maxTransactionMs = Math.max(maxTransactionMs, done);
      }
      removed += changed;
      return changed;
    },
    report: () => ({
      scope,
      removed,
      transactions,
      maxTransactionMs,
      readMs,
      totalMs: performance.now() - startedAt,
    }),
  };
}

function pruneStaleVacancies(pass: PrunePass, oldestPublishedAt: string): void {
  const oldestMs = Date.parse(oldestPublishedAt);
  if (!Number.isFinite(oldestMs)) return;
  const stale = pass.find(
    `SELECT i.id AS key
       FROM vacancy_pool_index i INDEXED BY vacancy_pool_index_fresh
      WHERE i.expired = 0
        AND i.published_ms IS NOT NULL
        AND i.published_ms < ?
      LIMIT ${PRUNE_PORTION_ROWS}`,
    oldestMs,
  );
  pass.remove(
    `DELETE FROM vacancy_pool WHERE id = ?
       AND EXISTS (
         SELECT 1 FROM vacancy_pool_index i
          WHERE i.id = vacancy_pool.id AND i.expired = 0 AND i.published_ms < ?
       )`,
    stale,
    oldestMs,
  );
}

/**
 * B642: запись доски работодателя живёт, пока её видно; невиденная
 * `NOT_SEEN_PRUNE_DAYS` дней (источник перестал читаться) снимается.
 */
function pruneNotSeenVacancies(pass: PrunePass, knownSourceIds: readonly string[]): void {
  const confirming = knownSourceIds.filter(confirmsLiveness);
  if (confirming.length === 0) return;
  const cutoffMs = Date.now() - NOT_SEEN_PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const placeholders = confirming.map(() => '?').join(', ');
  const stale = pass.find(
    `SELECT i.id AS key
       FROM vacancy_pool_index i INDEXED BY vacancy_pool_index_source
      WHERE i.expired = 0 AND i.source_id IN (${placeholders}) AND i.observed_ms < ?
      LIMIT ${PRUNE_PORTION_ROWS}`,
    ...confirming,
    cutoffMs,
  );
  pass.remove(
    `DELETE FROM vacancy_pool WHERE id = ?
       AND EXISTS (
         SELECT 1 FROM vacancy_pool_index i
          WHERE i.id = vacancy_pool.id AND i.expired = 0 AND i.observed_ms < ?
       )`,
    stale,
    cutoffMs,
  );
}

function pruneOrphanIndexes(pass: PrunePass): void {
  // Индекс следует за таблицей: строка без записи — это не запись.
  const orphanIndex = pass.find(
    `SELECT i.rowid AS key FROM vacancy_pool_index i
       LEFT JOIN vacancy_pool p ON p.id = i.id
      WHERE p.id IS NULL LIMIT ${PRUNE_PORTION_ROWS}`,
  );
  pass.remove(
    `DELETE FROM vacancy_pool_index WHERE rowid = ?
       AND NOT EXISTS (SELECT 1 FROM vacancy_pool p WHERE p.id = vacancy_pool_index.id)`,
    orphanIndex,
  );
  const orphanInput = pass.find(
    `SELECT c.rowid AS key FROM vacancy_cluster_input c
       LEFT JOIN vacancy_pool_index i ON i.id = c.id
      WHERE i.id IS NULL LIMIT ${PRUNE_PORTION_ROWS}`,
  );
  pass.remove(
    `DELETE FROM vacancy_cluster_input WHERE rowid = ?
       AND NOT EXISTS (SELECT 1 FROM vacancy_pool_index i WHERE i.id = vacancy_cluster_input.id)`,
    orphanInput,
  );
  // B643: связь записи агрегатора с компанией живёт, пока жива запись.
  const orphanCompany = pass.find(
    `SELECT c.rowid AS key FROM vacancy_company c
       LEFT JOIN vacancy_pool_index i ON i.id = c.vacancy_id
      WHERE i.id IS NULL LIMIT ${PRUNE_PORTION_ROWS}`,
  );
  pass.remove(
    `DELETE FROM vacancy_company WHERE rowid = ?
       AND NOT EXISTS (SELECT 1 FROM vacancy_pool_index i WHERE i.id = vacancy_company.vacancy_id)`,
    orphanCompany,
  );
}

export function prunePoolInBatches(
  database: DatabaseSync,
  knownSourceIds: readonly string[],
  oldestPublishedAt: string,
  limits: PruneLimits,
): PruneReport {
  const pass = startPass(database, limits, 'pool');
  const placeholders = knownSourceIds.map(() => '?').join(', ');
  pruneStaleVacancies(pass, oldestPublishedAt);
  pruneNotSeenVacancies(pass, knownSourceIds);
  const unknown = pass.find(
    `SELECT rowid AS key FROM vacancy_pool
      WHERE source_id NOT IN (${placeholders}) LIMIT ${PRUNE_PORTION_ROWS}`,
    ...knownSourceIds,
  );
  pass.remove(
    `DELETE FROM vacancy_pool WHERE rowid = ? AND source_id NOT IN (${placeholders})`,
    unknown,
    ...knownSourceIds,
  );
  pruneOrphanIndexes(pass);
  const lostStates = pass.find(
    `SELECT source_id AS key FROM vacancy_source_state WHERE source_id NOT IN (${placeholders})`,
    ...knownSourceIds,
  );
  pass.remove(
    `DELETE FROM vacancy_source_state WHERE source_id = ? AND source_id NOT IN (${placeholders})`,
    lostStates,
    ...knownSourceIds,
  );
  return pass.report();
}

export function pruneClustersInBatches(
  database: DatabaseSync,
  cutoffMs: number,
  limits: PruneLimits,
): { readonly clusters: number; readonly report: PruneReport } {
  const pass = startPass(database, limits, 'clusters');
  const stale = pass.find(
    `SELECT rowid AS key FROM vacancy_clusters WHERE updated_at < ? LIMIT ${PRUNE_PORTION_ROWS}`,
    cutoffMs,
  );
  const clusters = pass.remove(
    'DELETE FROM vacancy_clusters WHERE rowid = ? AND updated_at < ?',
    stale,
    cutoffMs,
  );
  // Ключи без кластера — не соседи; чистятся той же порцией (B230).
  const lostKeys = pass.find(
    `SELECT k.cluster_id AS key FROM vacancy_cluster_keys k
       LEFT JOIN vacancy_clusters c ON c.id = k.cluster_id
      WHERE c.id IS NULL LIMIT ${PRUNE_PORTION_ROWS}`,
  );
  pass.remove(
    `DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?1
       AND NOT EXISTS (SELECT 1 FROM vacancy_clusters c WHERE c.id = ?1)`,
    Array.from(new Set(lostKeys)),
  );
  return { clusters, report: pass.report() };
}

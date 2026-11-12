import { confirmsLiveness, NOT_SEEN_PRUNE_DAYS } from './poolLiveness';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

/** Одна порция за проход: остальное снимет следующий запуск, как и до разбивки. */
const PRUNE_PORTION_ROWS = 1000;

export interface PruneLimits {
  /** Строк на транзакцию. */
  readonly chunkRows: number;
  /** Работы на транзакцию: дольше неё другой процесс ждёт запись. */
  readonly budgetMs: number;
  /** Строк кластеров на одно чтение без индекса (B649-3); по умолчанию CLUSTER_SCAN_WINDOW_ROWS. */
  readonly scanWindowRows?: number;
}

/**
 * B649-3: у vacancy_clusters нет индекса по updated_at, и один поиск старых
 * кластеров шёл по 630 000 толстых строк 26 с. Окно по rowid ~0,4 с на проде.
 */
const CLUSTER_SCAN_WINDOW_ROWS = 10_000;

export interface PruneReport {
  readonly scope: 'pool' | 'clusters';
  readonly removed: number;
  readonly transactions: number;
  readonly maxTransactionMs: number;
  /** Поиск строк: идёт без блокировки записи и в удержание не входит. */
  readonly readMs: number;
  readonly totalMs: number;
  /** Чистка неизвестных источников пропущена: реестр неполон. */
  readonly unknownSkipped?: { readonly known: number; readonly stateSources: number };
}

type RowKey = string | number;

/** Шаги чистки: каждый `yield` — граница, на которой можно отпустить цикл событий. */
type PruneSteps<T = void> = Generator<void, T, void>;

/**
 * Список источников идёт одним параметром-JSON: с 12.11 их больше предела
 * SQLite в 32 766 переменных, и `IN (?, ?, …)` ронял старт обслуживания.
 */
const SOURCE_SET = '(SELECT value FROM json_each(?))';

interface PrunePass {
  find(sql: string, ...params: SQLInputValue[]): RowKey[];
  /** Уступает после каждой транзакции: между ними цикл событий свободен (B649-2). */
  remove(sql: string, keys: readonly RowKey[], ...params: SQLInputValue[]): PruneSteps<number>;
  report(): PruneReport;
  skipUnknown(known: number, stateSources: number): void;
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
  let unknownSkipped: PruneReport['unknownSkipped'];
  return {
    skipUnknown(known, stateSources) {
      unknownSkipped = { known, stateSources };
    },
    find(sql, ...params) {
      const readAt = performance.now();
      const rows = database.prepare(sql).all(...params) as Array<{ key: RowKey }>;
      readMs += performance.now() - readAt;
      return rows.map((row) => row.key);
    },
    *remove(sql, keys, ...params) {
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
        yield;
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
      ...(unknownSkipped ? { unknownSkipped } : {}),
    }),
  };
}

function* pruneStaleVacancies(pass: PrunePass, oldestPublishedAt: string): PruneSteps {
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
  yield;
  yield* pass.remove(
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
 * B643-6: «не видели» значит «снято», только если доску после этого прочли
 * целиком. Частичное чтение, пауза квоты или предохранитель полного чтения не
 * дают — такая запись держится до 30 дней от последнего показа.
 */
const NOT_SEEN_UNREAD_PRUNE_DAYS = 30;
const FULL_READ_AFTER_SEEN = `EXISTS (SELECT 1 FROM company_placement p
  WHERE p.source_id = i.source_id AND p.last_full_read_at > i.observed_ms)`;

/**
 * B642: запись доски работодателя живёт, пока её видно; невиденная
 * `NOT_SEEN_PRUNE_DAYS` дней (источник перестал читаться) снимается.
 */
function* pruneNotSeenVacancies(pass: PrunePass, knownSourceIds: readonly string[]): PruneSteps {
  const confirming = knownSourceIds.filter(confirmsLiveness);
  if (confirming.length === 0) return;
  const cutoffMs = Date.now() - NOT_SEEN_PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const unreadCutoffMs = Date.now() - NOT_SEEN_UNREAD_PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const stale = pass.find(
    `SELECT i.id AS key
       FROM vacancy_pool_index i INDEXED BY vacancy_pool_index_source
      WHERE i.expired = 0 AND i.source_id IN ${SOURCE_SET} AND i.observed_ms < ?
        AND (i.observed_ms < ? OR ${FULL_READ_AFTER_SEEN})
      LIMIT ${PRUNE_PORTION_ROWS}`,
    JSON.stringify(confirming),
    cutoffMs,
    unreadCutoffMs,
  );
  yield;
  yield* pass.remove(
    `DELETE FROM vacancy_pool WHERE id = ?
       AND EXISTS (
         SELECT 1 FROM vacancy_pool_index i
          WHERE i.id = vacancy_pool.id AND i.expired = 0 AND i.observed_ms < ?
            AND (i.observed_ms < ? OR ${FULL_READ_AFTER_SEEN})
       )`,
    stale,
    cutoffMs,
    unreadCutoffMs,
  );
}

function* pruneOrphanIndexes(pass: PrunePass): PruneSteps {
  // Индекс следует за таблицей: строка без записи — это не запись.
  const orphanIndex = pass.find(
    `SELECT i.rowid AS key FROM vacancy_pool_index i
       LEFT JOIN vacancy_pool p ON p.id = i.id
      WHERE p.id IS NULL LIMIT ${PRUNE_PORTION_ROWS}`,
  );
  yield;
  yield* pass.remove(
    `DELETE FROM vacancy_pool_index WHERE rowid = ?
       AND NOT EXISTS (SELECT 1 FROM vacancy_pool p WHERE p.id = vacancy_pool_index.id)`,
    orphanIndex,
  );
  const orphanInput = pass.find(
    `SELECT c.rowid AS key FROM vacancy_cluster_input c
       LEFT JOIN vacancy_pool_index i ON i.id = c.id
      WHERE i.id IS NULL LIMIT ${PRUNE_PORTION_ROWS}`,
  );
  yield;
  yield* pass.remove(
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
  yield;
  yield* pass.remove(
    `DELETE FROM vacancy_company WHERE rowid = ?
       AND NOT EXISTS (SELECT 1 FROM vacancy_pool_index i WHERE i.id = vacancy_company.vacancy_id)`,
    orphanCompany,
  );
}

/** Доля источников, которой реестру позволено не хватать до полного. */
const UNKNOWN_PRUNE_TOLERANCE = 0.02;

/**
 * Удалять «чужие» источники можно, только если реестр полон: источники
 * справочника регистрируются после старта, и неполный список стёр бы живые
 * доски необратимо. Мерило полноты — источники, которые пул уже знает.
 */
function registryLooksComplete(database: DatabaseSync, known: number): number | null {
  const row = database
    .prepare('SELECT count(DISTINCT source_id) AS n FROM vacancy_source_state')
    .get() as { n: number };
  const stateSources = Number(row.n);
  if (known === 0) return stateSources;
  return known >= stateSources * (1 - UNKNOWN_PRUNE_TOLERANCE) ? null : stateSources;
}

function* pruneUnknownSources(pass: PrunePass, known: string): PruneSteps {
  const unknown = pass.find(
    `SELECT rowid AS key FROM vacancy_pool
      WHERE source_id NOT IN ${SOURCE_SET} LIMIT ${PRUNE_PORTION_ROWS}`,
    known,
  );
  yield;
  yield* pass.remove(
    `DELETE FROM vacancy_pool WHERE rowid = ? AND source_id NOT IN ${SOURCE_SET}`,
    unknown,
    known,
  );
  const lostStates = pass.find(
    `SELECT source_id AS key FROM vacancy_source_state WHERE source_id NOT IN ${SOURCE_SET}`,
    known,
  );
  yield;
  yield* pass.remove(
    `DELETE FROM vacancy_source_state WHERE source_id = ? AND source_id NOT IN ${SOURCE_SET}`,
    lostStates,
    known,
  );
}

function* poolPruneSteps(
  database: DatabaseSync,
  knownSourceIds: readonly string[],
  oldestPublishedAt: string,
  limits: PruneLimits,
): PruneSteps<PruneReport> {
  const pass = startPass(database, limits, 'pool');
  yield* pruneStaleVacancies(pass, oldestPublishedAt);
  yield* pruneNotSeenVacancies(pass, knownSourceIds);
  const incomplete = registryLooksComplete(database, knownSourceIds.length);
  if (incomplete === null) yield* pruneUnknownSources(pass, JSON.stringify(knownSourceIds));
  else pass.skipUnknown(knownSourceIds.length, incomplete);
  yield* pruneOrphanIndexes(pass);
  return pass.report();
}

function drain<T>(steps: PruneSteps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Отпускает цикл событий на каждой границе шага: для чистки после готовности. */
async function drainYielding<T>(steps: PruneSteps<T>): Promise<T> {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function prunePoolInBatches(
  database: DatabaseSync,
  knownSourceIds: readonly string[],
  oldestPublishedAt: string,
  limits: PruneLimits,
): PruneReport {
  return drain(poolPruneSteps(database, knownSourceIds, oldestPublishedAt, limits));
}

export function prunePoolInBatchesAsync(
  database: DatabaseSync,
  knownSourceIds: readonly string[],
  oldestPublishedAt: string,
  limits: PruneLimits,
): Promise<PruneReport> {
  return drainYielding(poolPruneSteps(database, knownSourceIds, oldestPublishedAt, limits));
}

interface ClusterPruneResult {
  readonly clusters: number;
  readonly report: PruneReport;
}

export function pruneClustersInBatches(
  database: DatabaseSync,
  cutoffMs: number,
  limits: PruneLimits,
): ClusterPruneResult {
  return drain(clusterPruneSteps(database, cutoffMs, limits));
}

export function pruneClustersInBatchesAsync(
  database: DatabaseSync,
  cutoffMs: number,
  limits: PruneLimits,
): Promise<ClusterPruneResult> {
  return drainYielding(clusterPruneSteps(database, cutoffMs, limits));
}

/** Старые кластеры окнами по rowid с уступкой между окнами; не больше одной порции. */
function* findStaleClusters(
  pass: PrunePass,
  database: DatabaseSync,
  cutoffMs: number,
  limits: PruneLimits,
): PruneSteps<RowKey[]> {
  const window = Math.max(1, limits.scanWindowRows ?? CLUSTER_SCAN_WINDOW_ROWS);
  const top = database.prepare('SELECT max(rowid) AS top FROM vacancy_clusters').get() as {
    top: number | null;
  };
  const stale: RowKey[] = [];
  for (let from = 0; top.top !== null && from < top.top && stale.length < PRUNE_PORTION_ROWS; ) {
    const to = from + window;
    stale.push(
      ...pass.find(
        `SELECT rowid AS key FROM vacancy_clusters
          WHERE rowid > ? AND rowid <= ? AND updated_at < ?`,
        from,
        to,
        cutoffMs,
      ),
    );
    from = to;
    yield;
  }
  return stale.slice(0, PRUNE_PORTION_ROWS);
}

function* clusterPruneSteps(
  database: DatabaseSync,
  cutoffMs: number,
  limits: PruneLimits,
): PruneSteps<ClusterPruneResult> {
  const pass = startPass(database, limits, 'clusters');
  const stale = yield* findStaleClusters(pass, database, cutoffMs, limits);
  const clusters = yield* pass.remove(
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
  yield;
  yield* pass.remove(
    `DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?1
       AND NOT EXISTS (SELECT 1 FROM vacancy_clusters c WHERE c.id = ?1)`,
    Array.from(new Set(lostKeys)),
  );
  return { clusters, report: pass.report() };
}

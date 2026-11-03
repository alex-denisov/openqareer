/**
 * 03.11: область удалёнки для проекций, записанных до неё.
 *
 * Новая запись получает `remoteScope` в `clusterProjectionOf`; старые
 * удалённые строки (~145 000 на проде) дописывает этот проход в процессе
 * обслуживания. Без `ALTER TABLE` и без долгой транзакции: схема не меняется,
 * таблица состояния создаётся мгновенно, проекции считаются до транзакции,
 * а под блокировкой записи идут только изменившиеся строки: миллисекунды,
 * выкат и веб-сервер её не ждут (`schema-migration-eats-health-window`).
 */
import type { DatabaseSync } from 'node:sqlite';
import { clusterProjectionOf } from './vacancyPoolQuery';
import { parseVacancy } from './sqliteVacancyPoolStore';

/**
 * Новая версия правил разбора — новый ключ: проход начнётся сначала.
 * v2 (03.11): «Global» и «Anywhere» целиком — область из любой страны.
 */
export const REMOTE_SCOPE_BACKFILL_KEY = 'remote-scope-v2';

const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS remote_scope_backfill_state (
  key TEXT PRIMARY KEY,
  cursor_rowid INTEGER NOT NULL,
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT`;

interface CandidateRow {
  readonly rowid: number;
  readonly id: string;
  readonly projection: string | null;
}

export interface RemoteScopeBatchResult {
  readonly scanned: number;
  readonly updated: number;
  readonly completed: boolean;
}

function readState(database: DatabaseSync, key: string): { cursor: number; completed: boolean } {
  database.exec(STATE_TABLE_SQL);
  const row = database
    .prepare('SELECT cursor_rowid, completed FROM remote_scope_backfill_state WHERE key = ?')
    .get(key) as { cursor_rowid: number; completed: number } | undefined;
  return { cursor: row?.cursor_rowid ?? 0, completed: row?.completed === 1 };
}

function writeState(database: DatabaseSync, key: string, cursor: number, completed: boolean): void {
  database
    .prepare(
      `INSERT INTO remote_scope_backfill_state (key, cursor_rowid, completed, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET cursor_rowid = excluded.cursor_rowid,
         completed = excluded.completed, updated_at = excluded.updated_at`,
    )
    .run(key, cursor, completed ? 1 : 0, Math.floor(Date.now() / 1000));
}

function readCandidates(database: DatabaseSync, cursor: number, limit: number): CandidateRow[] {
  return database
    .prepare(
      `SELECT i.rowid AS rowid, i.id AS id, c.cluster_json AS projection
       FROM vacancy_pool_index i
       LEFT JOIN vacancy_cluster_input c ON c.id = i.id
       WHERE i.rowid > ? AND i.is_remote = 1 AND i.expired = 0
       ORDER BY i.rowid LIMIT ?`,
    )
    .all(cursor, limit) as unknown as CandidateRow[];
}

function storedScope(projection: string | null): string | undefined {
  if (!projection?.includes('"remoteScope"')) return undefined;
  return (JSON.parse(projection) as { remoteScope?: string }).remoteScope;
}

interface Rewrite {
  readonly id: string;
  readonly payload: string;
  readonly projection: string;
}

/**
 * Считает проекции вне транзакции и оставляет только строки, где область по
 * новым правилам другая: повторный проход после смены правил пишет мало.
 */
function changedProjections(database: DatabaseSync, rows: readonly CandidateRow[]): Rewrite[] {
  const payloadOf = database.prepare('SELECT payload FROM vacancy_pool WHERE id = ?');
  return rows.flatMap((row) => {
    const stored = payloadOf.get(row.id) as { payload: string } | undefined;
    const vacancy = stored ? parseVacancy(stored.payload) : undefined;
    if (!stored || !vacancy) return [];
    const projection = clusterProjectionOf({ ...vacancy, id: row.id });
    if (row.projection && storedScope(row.projection) === projection.remoteScope) return [];
    return [{ id: row.id, payload: stored.payload, projection: JSON.stringify(projection) }];
  });
}

/** Под блокировкой записи — только запись; строку, которую успели переписать, не трогает. */
function writeProjections(database: DatabaseSync, rewrites: readonly Rewrite[]): number {
  const payloadOf = database.prepare('SELECT payload FROM vacancy_pool WHERE id = ?');
  const upsert = database.prepare(
    `INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET cluster_json = excluded.cluster_json`,
  );
  let updated = 0;
  for (const rewrite of rewrites) {
    const current = payloadOf.get(rewrite.id) as { payload: string } | undefined;
    if (current?.payload !== rewrite.payload) continue;
    upsert.run(rewrite.id, rewrite.projection);
    updated += 1;
  }
  return updated;
}

/** Одна пачка: читает удалённые строки после курсора и дописывает область. */
export function runRemoteScopeBackfillBatch(
  database: DatabaseSync,
  limit: number,
  key = REMOTE_SCOPE_BACKFILL_KEY,
): RemoteScopeBatchResult {
  const state = readState(database, key);
  if (state.completed) return { scanned: 0, updated: 0, completed: true };
  const rows = readCandidates(database, state.cursor, limit);
  if (rows.length === 0) {
    writeState(database, key, state.cursor, true);
    return { scanned: 0, updated: 0, completed: true };
  }
  const rewrites = changedProjections(database, rows);
  database.exec('BEGIN IMMEDIATE');
  try {
    const updated = writeProjections(database, rewrites);
    writeState(database, key, rows[rows.length - 1]!.rowid, false);
    database.exec('COMMIT');
    return { scanned: rows.length, updated, completed: false };
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

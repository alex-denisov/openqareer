import type { DatabaseSync } from 'node:sqlite';

/**
 * B797 — сверка живости верха подборок. Прочитанный текст hh больше не запрашивался, поэтому
 * архивная вакансия оставалась в подборке до конца окна в 30 дней (аудит 25.11: 33 из 113).
 * Список подборки пишет сюда свой верх, воркер обслуживания перечитывает карточки понемногу.
 */
export const SELECTION_LIVENESS_TABLE = `
CREATE TABLE IF NOT EXISTS selection_liveness (
  vacancy_id TEXT PRIMARY KEY,
  rank INTEGER NOT NULL,
  requested_ms INTEGER NOT NULL,
  checked_ms INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS selection_liveness_tried (
  vacancy_id TEXT PRIMARY KEY,
  tried_ms INTEGER NOT NULL
) STRICT;
`;

const HH_ID_PREFIX = 'src-hh-search:';
const HOUR_MS = 60 * 60 * 1_000;
/** Верх одной подборки. */
export const SELECTION_LIVENESS_TOP = 200;
/** Записей в одном запросе: строки верха и остальные записи их склеек. */
const LIVENESS_REQUEST_MAX = SELECTION_LIVENESS_TOP * 5;
/** Строка, записанная недавно, повторно не пишется: чтение списка почти всегда обходится чтением. */
export const LIVENESS_REQUEST_FRESH_MS = 3 * 24 * HOUR_MS;
/** Подборка, которую не открывали дольше, больше не сверяется. */
export const LIVENESS_REQUEST_TTL_MS = 14 * 24 * HOUR_MS;
/** Одна вакансия перечитывается не чаще. */
export const LIVENESS_RECHECK_MS = 24 * HOUR_MS;
/** Площадка не ответила о вакансии: она не сверена, следующая попытка такта — через час. */
export const LIVENESS_RETRY_MS = HOUR_MS;
/**
 * Карточек hh и столько же с других площадок за такт (раз в минуту) через общий темп загрузчика hh: верх подборки — за 8 минут
 * (по 5 за такт — 40 минут, прод 25.11). Суточный расход держит `LIVENESS_RECHECK_MS`.
 */
export const LIVENESS_PER_TICK = 25;

export function requestSelectionLiveness(
  database: DatabaseSync,
  ids: readonly string[],
  nowMs: number,
): void {
  const top = [...new Set(ids)].slice(0, LIVENESS_REQUEST_MAX);
  if (top.length === 0) return;
  const fresh = new Set(
    (
      database
        .prepare(
          `SELECT vacancy_id AS id FROM selection_liveness
            WHERE requested_ms >= ? AND vacancy_id IN (SELECT value FROM json_each(?))`,
        )
        .all(nowMs - LIVENESS_REQUEST_FRESH_MS, JSON.stringify(top)) as Array<{ id: string }>
    ).map((row) => row.id),
  );
  const rows = top.map((id, rank) => ({ id, rank })).filter((row) => !fresh.has(row.id));
  if (rows.length === 0) return;
  database
    .prepare(
      `INSERT INTO selection_liveness (vacancy_id, rank, requested_ms)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.rank'), ?2 FROM json_each(?1)
        WHERE true
       ON CONFLICT(vacancy_id) DO UPDATE SET rank = min(rank, excluded.rank),
         requested_ms = excluded.requested_ms`,
    )
    .run(JSON.stringify(rows), nowMs);
}

/**
 * Сверенные и снятые с площадки: индекс уже без них, а снимок подборки — ещё нет. `CROSS JOIN`
 * закрепляет обход от короткой очереди: сам планировщик обходил весь пул (прод 25.11: 119 с против 11 мс).
 */
export function closedSelection(database: DatabaseSync): ReadonlySet<string> {
  const rows = database
    .prepare(
      `SELECT q.vacancy_id AS id FROM selection_liveness q
         CROSS JOIN vacancy_pool_index i ON i.id = q.vacancy_id AND i.expired = 1`,
    )
    .all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** Сверена за последние сутки. */
export function recentlyChecked(database: DatabaseSync, id: string, nowMs: number): boolean {
  const row = database
    .prepare('SELECT 1 FROM selection_liveness WHERE vacancy_id = ? AND checked_ms >= ?')
    .get(id, nowMs - LIVENESS_RECHECK_MS);
  return row !== undefined;
}

/**
 * Сначала ни разу не сверенные по месту в подборке, потом самые давние сверки и попытки. У hh и остальных
 * площадок свои `limit` строк: отказ hh не занимает весь такт его же строками.
 */
export function dueSelectionLiveness(
  database: DatabaseSync,
  limit: number,
  nowMs: number,
): string[] {
  const read = database.prepare(
    `SELECT q.vacancy_id AS id FROM selection_liveness q
       CROSS JOIN vacancy_pool_index i ON i.id = q.vacancy_id AND i.expired = 0
       LEFT JOIN selection_liveness_tried t ON t.vacancy_id = q.vacancy_id
      WHERE q.requested_ms >= ? AND q.checked_ms < ?
        AND coalesce(t.tried_ms, 0) < ?
        AND (q.vacancy_id LIKE 'src-hh-search:%') = ?
      ORDER BY max(q.checked_ms, coalesce(t.tried_ms, 0)), q.rank LIMIT ?`,
  );
  return [1, 0].flatMap((hh) =>
    (
      read.all(
        nowMs - LIVENESS_REQUEST_TTL_MS,
        nowMs - LIVENESS_RECHECK_MS,
        nowMs - LIVENESS_RETRY_MS,
        hh,
        limit,
      ) as Array<{
        id: string;
      }>
    ).map((row) => row.id),
  );
}

/** Запоминает попытку; записи, выпавшие из очереди по сроку, из таблицы уходят. */
export function markSelectionLivenessTried(
  database: DatabaseSync,
  id: string,
  nowMs: number,
): void {
  database
    .prepare(
      `INSERT INTO selection_liveness_tried (vacancy_id, tried_ms) VALUES (?, ?)
       ON CONFLICT(vacancy_id) DO UPDATE SET tried_ms = excluded.tried_ms`,
    )
    .run(id, nowMs);
  database
    .prepare('DELETE FROM selection_liveness_tried WHERE tried_ms < ?')
    .run(nowMs - LIVENESS_REQUEST_TTL_MS);
}

export function markSelectionLivenessChecked(
  database: DatabaseSync,
  id: string,
  nowMs: number,
): void {
  database
    .prepare(
      `INSERT INTO selection_liveness (vacancy_id, rank, requested_ms, checked_ms)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(vacancy_id) DO UPDATE SET checked_ms = excluded.checked_ms`,
    )
    .run(id, SELECTION_LIVENESS_TOP, nowMs);
  database.prepare('DELETE FROM selection_liveness_tried WHERE vacancy_id = ?').run(id);
}

export interface SelectionLivenessReport {
  readonly checked: number;
  readonly gone: number;
  readonly open: number;
  readonly unknown: number;
  /** hh отказал: остальные его строки этого такта не читаются и повторятся, другие площадки идут. */
  readonly blocked?: true;
}

export interface SelectionLivenessSteps {
  due(limit: number): readonly string[];
  check(id: string): Promise<'open' | 'gone' | 'unknown' | 'blocked'>;
  retire(id: string): void;
  markChecked(id: string): void;
  /** Ответа о вакансии нет: запомнить попытку, не отмечая сверенной. */
  markTried(id: string): void;
  stopped(): boolean;
}

export async function runSelectionLiveness(
  steps: SelectionLivenessSteps,
): Promise<SelectionLivenessReport> {
  const counts = { gone: 0, open: 0, unknown: 0 };
  let blocked = false;
  const report = () => ({ checked: counts.gone + counts.open + counts.unknown, ...counts });
  for (const id of steps.due(LIVENESS_PER_TICK)) {
    if (steps.stopped()) break;
    if (blocked && id.startsWith(HH_ID_PREFIX)) continue;
    const verdict = await steps.check(id);
    if (verdict === 'blocked') {
      blocked = true;
      continue;
    }
    if (verdict === 'gone') steps.retire(id);
    counts[verdict] += 1;
    if (verdict === 'unknown') steps.markTried(id);
    else steps.markChecked(id);
  }
  return blocked ? { ...report(), blocked } : report();
}

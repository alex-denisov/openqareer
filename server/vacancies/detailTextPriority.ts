import type { DatabaseSync } from 'node:sqlite';
import { isDetailTextSource } from './detailTextSources';
import { HH_TEXT_PRIORITY_MAX_IDS } from './hhTextPriorityTable';

/**
 * B791 25.11: записи подборок и открытые карточки — первыми в очереди дочитки площадок без
 * текста в списке. На проде у LinkedIn текст есть у 10,4 из 30,6 тыс. записей, новых за сутки
 * прочитано 45 из 397: обход шёл от новых к старым и до показанных кандидату не доходил.
 * Темп площадки и пауза после 429 не меняются — меняется только порядок.
 */
export const DETAIL_TEXT_PRIORITY_TABLE = `
CREATE TABLE IF NOT EXISTS detail_text_priority (
  vacancy_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  requested_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS detail_text_priority_order
  ON detail_text_priority (source_id, rank, requested_ms DESC);
`;

const LINKEDIN_SOURCES: ReadonlySet<string> = new Set([
  'src-linkedin-guest',
  'src-linkedin-crawler',
]);

export function sourceIdOf(vacancyId: string): string {
  return vacancyId.split(':', 1)[0] ?? '';
}

export function hasDetailText(vacancyId: string): boolean {
  return vacancyId.includes(':') && isDetailTextSource(sourceIdOf(vacancyId));
}

/** В списке LinkedIn вместо описания склейка «название — компания — город». */
export function hasStandInDescription(vacancyId: string): boolean {
  return LINKEDIN_SOURCES.has(sourceIdOf(vacancyId));
}

export function requestDetailTextPriority(
  database: DatabaseSync,
  vacancyIds: readonly string[],
  baseRank: number,
  nowMs: number,
): void {
  const insert = database.prepare(
    `INSERT INTO detail_text_priority (vacancy_id, source_id, rank, requested_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(vacancy_id) DO UPDATE SET rank = min(rank, excluded.rank),
       requested_ms = excluded.requested_ms`,
  );
  vacancyIds
    .filter(hasDetailText)
    .slice(0, HH_TEXT_PRIORITY_MAX_IDS)
    .forEach((id, index) => insert.run(id, sourceIdOf(id), baseRank + index, nowMs));
}

/** Голова очереди площадки; дочитанные, снятые и удалённые из пула уходят из неё тут же. */
export function peekDetailTextPriority(
  database: DatabaseSync,
  sourceId: string,
  limit: number,
  excludeIds: readonly string[],
): string[] {
  const rows = database
    .prepare(
      `SELECT q.vacancy_id AS id,
              CASE WHEN p.id IS NOT NULL AND p.expired_at IS NULL
                AND length(trim(coalesce(json_extract(p.payload, '$.fullDescription'), ''))) = 0
              THEN 1 ELSE 0 END AS need
         FROM detail_text_priority q
         LEFT JOIN vacancy_pool p ON p.id = q.vacancy_id AND p.source_id = q.source_id
        WHERE q.source_id = ?
        ORDER BY q.rank ASC, q.requested_ms DESC
        LIMIT ?`,
    )
    .all(sourceId, limit * 4 + excludeIds.length) as Array<{ id: string; need: number }>;
  const remove = database.prepare('DELETE FROM detail_text_priority WHERE vacancy_id = ?');
  rows.filter((row) => row.need !== 1).forEach((row) => remove.run(row.id));
  const excluded = new Set(excludeIds);
  return rows
    .filter((row) => row.need === 1 && !excluded.has(row.id))
    .slice(0, limit)
    .map((row) => row.id);
}

import type { SQLInputValue } from 'node:sqlite';
import { HH_SEARCH_SOURCE_ID } from './hhSearchState';
import { candidateRoleFunctionCodes } from './titleParse/candidateRoleFunctions';
import { rulesParse } from './titleParse/rulesParse';
import { normalizeQuery, type FreshnessWindow } from './vacancyPoolQuery';

export interface StoredHhSampleQuery {
  readonly sql: string;
  readonly params: SQLInputValue[];
}

const PAYLOAD_OF_SELECTED = `SELECT p.payload AS payload FROM selected s
    JOIN vacancy_pool p ON p.id = s.id
    ORDER BY s.published_ms DESC, s.id ASC`;

/** Уровень роли ±1, как у сверки уровня в подборе (levelMatcher). */
const LEVEL_SPREAD = 1;

/**
 * Роль → свежие записи обхода hh той же функции и близкого уровня. Подстрока
 * роли тут не годится: кандидат выбирает «VP of Technology», а hh пишет
 * «Технический директор» — на проде 29.10 подстрока давала 0 из ~700 тыс.
 * Одна ветка на код функции, как в смысловом подборе: каждая идёт по
 * `vacancy_semantic_match` под свой LIMIT (3–13 мс на проде).
 */
export function storedHhSampleByRole(
  role: string,
  window: FreshnessWindow,
  limit: number,
): StoredHhSampleQuery | null {
  const codes = candidateRoleFunctionCodes([role]);
  if (codes.length === 0) return null;
  const level = rulesParse(role).levelRank;
  const levelFilter = level === null ? '' : 'AND s.level_rank BETWEEN ? AND ?';
  const levelParams = level === null ? [] : [level - LEVEL_SPREAD, level + LEVEL_SPREAD];
  const branch = `SELECT * FROM (
      SELECT s.id AS id, s.published_ms AS published_ms
      FROM vacancy_semantic s INDEXED BY vacancy_semantic_match
      JOIN vacancy_pool_index i ON i.id = s.id
      WHERE s.function_code = ? AND s.published_ms BETWEEN ? AND ? ${levelFilter}
        AND i.source_id = ? AND i.expired = 0 AND i.is_active = 1
      ORDER BY s.published_ms DESC LIMIT ?
    )`;
  return {
    sql: `WITH selected AS MATERIALIZED (
        SELECT id, max(published_ms) AS published_ms
        FROM (${codes.map(() => branch).join(' UNION ALL ')})
        GROUP BY id ORDER BY published_ms DESC, id ASC LIMIT ?
      ) ${PAYLOAD_OF_SELECTED}`,
    params: [
      ...codes.flatMap((code) => [
        code,
        window.fromMs,
        window.toMs,
        ...levelParams,
        HH_SEARCH_SOURCE_ID,
        limit,
      ]),
      limit,
    ],
  };
}

/**
 * Точные совпадения — подстрока роли в тексте записи. Самый точный срез, но
 * без совпадений обходит окно целиком (до ~3 с на проде), поэтому читается
 * только дочерним процессом, вне HTTP-обработчика.
 */
export function storedHhSampleByText(
  text: string,
  window: FreshnessWindow,
  limit: number,
): StoredHhSampleQuery | null {
  const needle = normalizeQuery(text);
  if (needle === undefined) return null;
  return {
    sql: `WITH selected AS MATERIALIZED (
        SELECT i.id, i.published_ms FROM vacancy_pool_index i
          INDEXED BY vacancy_pool_index_source_fresh
        WHERE i.source_id = ? AND i.expired = 0 AND i.published_ms BETWEEN ? AND ?
          AND instr(i.search_text, ?) > 0
        ORDER BY i.published_ms DESC LIMIT ?
      ) ${PAYLOAD_OF_SELECTED}`,
    params: [HH_SEARCH_SOURCE_ID, window.fromMs, window.toMs, needle, limit],
  };
}

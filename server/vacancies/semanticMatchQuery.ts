import type { SQLInputValue } from 'node:sqlite';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import type { FreshnessWindow } from './vacancyPoolQuery';

/**
 * Смысловой подбор (B267 S3, план §5): равенство по индексу
 * `vacancy_semantic_match` вместо LIKE по описанию, без второй фазы
 * добивки — пусто значит пусто. `functionCodes` не бывает пустым: вызывающая
 * сторона откатывается на legacy раньше, чем построить этот запрос.
 */
export interface SemanticMatchQueryInput {
  readonly functionCodes: readonly FunctionCode[];
  /** `null` — кандидат без известного уровня, окно уровня не сужает подбор. */
  readonly levelRank: number | null;
  readonly window: FreshnessWindow;
  readonly preferRemote: boolean;
  readonly limit: number;
}

const ALIVE = 'i.expired = 0';
const REMOTE_ORDER = '(CASE WHEN i.is_remote = 1 THEN 1 ELSE 0 END)';

export function buildSemanticMatchQuery(
  input: SemanticMatchQueryInput,
): { sql: string; params: SQLInputValue[] } {
  const functionPlaceholders = input.functionCodes.map(() => '?').join(',');
  const levelFilter =
    input.levelRank === null ? '' : 'AND (s.level_rank IS NULL OR s.level_rank BETWEEN ? AND ?)';
  const order = `${input.preferRemote ? 'r DESC, ' : ''}p DESC`;
  const sql = `WITH selected AS MATERIALIZED (
      SELECT s.id, max(s.published_ms) AS p, max(${REMOTE_ORDER}) AS r
      FROM vacancy_semantic s INDEXED BY vacancy_semantic_match
      JOIN vacancy_pool_index i ON i.id = s.id
      WHERE s.function_code IN (${functionPlaceholders})
        ${levelFilter}
        AND s.published_ms BETWEEN ? AND ? AND ${ALIVE} AND i.is_active = 1
      GROUP BY s.id
      ORDER BY ${order}
      LIMIT ?
    ) SELECT c.cluster_json AS payload FROM selected sel
      JOIN vacancy_cluster_input c ON c.id = sel.id
      ORDER BY ${input.preferRemote ? 'sel.r DESC, ' : ''}sel.p DESC, sel.id ASC`;
  const params: SQLInputValue[] = [
    ...input.functionCodes,
    ...(input.levelRank === null ? [] : [input.levelRank - 1, input.levelRank + 1]),
    input.window.fromMs,
    input.window.toMs,
    input.limit,
  ];
  return { sql, params };
}

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

/**
 * Одна ветка на код функции (план §5 п.3): у массовой функции (`eng` ≈ 30 %
 * пула) `IN (...)` + `GROUP BY` по всем кодам сразу сортировал сотни тысяч
 * совпавших строк одним temp b-tree (замер до правки — 957–1542 мс на 750
 * тыс. строк). Каждая ветка использует `vacancy_semantic_match` напрямую под
 * свой `ORDER BY published_ms DESC LIMIT`, без полной сортировки функции;
 * слияние веток идёт уже по ограниченному числу строк (после правки — 3–9 мс
 * на том же наборе, см. `semanticMatchQuery.bench.test.ts`).
 */
function buildFunctionBranch(levelFilter: string): string {
  return `SELECT * FROM (
    SELECT s.id AS id, s.published_ms AS p, i.is_remote AS remote
    FROM vacancy_semantic s INDEXED BY vacancy_semantic_match
    JOIN vacancy_pool_index i ON i.id = s.id
    WHERE s.function_code = ? ${levelFilter}
      AND s.published_ms BETWEEN ? AND ? AND ${ALIVE} AND i.is_active = 1
    ORDER BY s.published_ms DESC
    LIMIT ?
  )`;
}

export function buildSemanticMatchQuery(
  input: SemanticMatchQueryInput,
): { sql: string; params: SQLInputValue[] } {
  const levelFilter =
    input.levelRank === null ? '' : 'AND (s.level_rank IS NULL OR s.level_rank BETWEEN ? AND ?)';
  const branch = buildFunctionBranch(levelFilter);
  const branches = input.functionCodes.map(() => branch).join('\nUNION ALL\n');
  const remoteOrder = '(CASE WHEN remote = 1 THEN 1 ELSE 0 END)';
  const order = `${input.preferRemote ? 'r DESC, ' : ''}p DESC`;
  const sql = `WITH candidates AS (${branches}),
    selected AS (
      SELECT id, max(p) AS p, max(${remoteOrder}) AS r
      FROM candidates
      GROUP BY id
      ORDER BY ${order}
      LIMIT ?
    ) SELECT c.cluster_json AS payload FROM selected sel
      JOIN vacancy_cluster_input c ON c.id = sel.id
      ORDER BY ${input.preferRemote ? 'sel.r DESC, ' : ''}sel.p DESC, sel.id ASC`;
  const params: SQLInputValue[] = [];
  for (const code of input.functionCodes) {
    params.push(code);
    if (input.levelRank !== null) params.push(input.levelRank - 1, input.levelRank + 1);
    params.push(input.window.fromMs, input.window.toMs, input.limit);
  }
  params.push(input.limit);
  return { sql, params };
}

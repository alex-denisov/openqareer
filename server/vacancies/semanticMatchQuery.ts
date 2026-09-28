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
const PRODUCT_ADJACENT_CAMPAIGN_FUNCTIONS: readonly FunctionCode[] = [
  'eng',
  'eng-mgmt',
  'it-ops',
  'ops',
];

/**
 * Одна ветка на код функции (план §5 п.3): у массовой функции (`eng` ≈ 30 %
 * пула) `IN (...)` + `GROUP BY` по всем кодам сразу сортировал сотни тысяч
 * совпавших строк одним temp b-tree (замер до правки — 957–1542 мс на 750
 * тыс. строк). Каждая ветка использует `vacancy_semantic_match` напрямую под
 * свой `ORDER BY published_ms DESC LIMIT`, без полной сортировки функции;
 * слияние веток идёт уже по ограниченному числу строк (после правки — 3–9 мс
 * на том же наборе, см. `semanticMatchQuery.bench.test.ts`). Для кампаний
 * Eng/Ops продуктовые роли читаются отдельной помеченной веткой и попадают в
 * пул только после записей целевых семейств.
 */
function buildFunctionBranch(
  levelFilter: string,
  excludedFunctionFilter: string,
  isTargetFunction: boolean,
): string {
  return `SELECT * FROM (
    SELECT s.id AS id, s.published_ms AS p, i.is_remote AS remote,
      ${isTargetFunction ? 1 : 0} AS target
    FROM vacancy_semantic s INDEXED BY vacancy_semantic_match
    JOIN vacancy_pool_index i ON i.id = s.id
    WHERE s.function_code = ? ${levelFilter} ${excludedFunctionFilter}
      AND s.published_ms BETWEEN ? AND ? AND ${ALIVE} AND i.is_active = 1
    ORDER BY s.published_ms DESC
    LIMIT ?
  )`;
}

function buildExcludedTitleFilter(excludedFunctions: readonly ('sales' | 'marketing')[]): string {
  if (excludedFunctions.length === 0) return '';
  const normalizedTitle = `lower(replace(replace(replace(replace(replace(s.title_key,
    '&', ' '), '-', ' '), '/', ' '), ',', ' '), ':', ' '))`;
  return excludedFunctions
    .map((code) => `AND instr(' ' || ${normalizedTitle} || ' ', ' ${code} ') = 0`)
    .join('\n      ');
}

function queryFunctionCodesFor(targetCodes: readonly FunctionCode[]): FunctionCode[] {
  const includeProductAdjacents = targetCodes.some((code) =>
    PRODUCT_ADJACENT_CAMPAIGN_FUNCTIONS.includes(code),
  );
  const adjacentFunctions: readonly FunctionCode[] =
    includeProductAdjacents && !targetCodes.includes('product') ? ['product'] : [];
  return Array.from(new Set([...targetCodes, ...adjacentFunctions]));
}

function excludedFunctionCodesFor(targetCodes: readonly FunctionCode[]) {
  return (['sales', 'marketing', 'finance', 'project-mgmt', 'education'] as const).filter(
    (code) => !targetCodes.includes(code),
  );
}

function buildExcludedFunctionFilter(excludedFunctions: readonly string[]): string {
  if (excludedFunctions.length === 0) return '';
  const excludedCommercialFunctions = excludedFunctions.filter(
    (code): code is 'sales' | 'marketing' => code === 'sales' || code === 'marketing',
  );
  return `AND NOT EXISTS (
        SELECT 1 FROM vacancy_semantic excluded
        WHERE excluded.id = s.id AND excluded.function_code IN (${excludedFunctions
          .map(() => '?')
          .join(', ')})
      ) ${buildExcludedTitleFilter(excludedCommercialFunctions)}`;
}

export function buildSemanticMatchQuery(
  input: SemanticMatchQueryInput,
): { sql: string; params: SQLInputValue[] } {
  // У источника уровень часто отсутствует даже у релевантной руководящей
  // роли. Неизвестный уровень остаётся видимым и ранжируется объяснением, а
  // не исчезает до того, как кандидат сможет его прочитать.
  const levelFilter =
    input.levelRank === null ? '' : 'AND (s.level_rank BETWEEN ? AND ? OR s.level_rank IS NULL)';
  const excludedFunctions = excludedFunctionCodesFor(input.functionCodes);
  const excludedFunctionFilter = buildExcludedFunctionFilter(excludedFunctions);
  const queryFunctionCodes = queryFunctionCodesFor(input.functionCodes);
  const branches = queryFunctionCodes
    .map((code) =>
      buildFunctionBranch(
        levelFilter,
        excludedFunctionFilter,
        input.functionCodes.includes(code),
      ),
    )
    .join('\nUNION ALL\n');
  const remoteOrder = '(CASE WHEN remote = 1 THEN 1 ELSE 0 END)';
  const remoteSelectionOrder = input.preferRemote ? 'r DESC, ' : '';
  const sql = `WITH candidates AS (${branches}),
    selected AS (
      SELECT id, max(p) AS p, max(${remoteOrder}) AS r, max(target) AS t
      FROM candidates
      GROUP BY id
      ORDER BY t DESC, ${remoteSelectionOrder}p DESC
      LIMIT ?
    ) SELECT c.cluster_json AS payload FROM selected sel
      JOIN vacancy_cluster_input c ON c.id = sel.id
      ORDER BY sel.t DESC, ${input.preferRemote ? 'sel.r DESC, ' : ''}sel.p DESC, sel.id ASC`;
  const params: SQLInputValue[] = [];
  for (const code of queryFunctionCodes) {
    params.push(code);
    if (input.levelRank !== null) params.push(input.levelRank - 1, input.levelRank + 1);
    params.push(...excludedFunctions);
    params.push(input.window.fromMs, input.window.toMs, input.limit);
  }
  params.push(input.limit);
  return { sql, params };
}

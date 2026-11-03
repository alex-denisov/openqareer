import type { SQLInputValue } from 'node:sqlite';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import type { FreshnessWindow } from './vacancyPoolQuery';
import type { MatchGeography } from './matchGeography';

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
  /** Нижняя граница окна уровня; без неё — ступень ниже `levelRank`. */
  readonly levelFloorRank?: number | null;
  /** Города и удалёнка кампании: предел чтения не тратится на чужие города. */
  readonly geography?: MatchGeography;
  readonly window: FreshnessWindow;
  readonly preferRemote: boolean;
  readonly limit: number;
}

const ALIVE = 'i.expired = 0';

/**
 * Свежесть — по дате пула: дата смыслового индекса могла остаться от первой
 * публикации (аудит 01.11). Индекс читается с запасом в 30 дней — так ветка
 * остаётся диапазоном по `vacancy_semantic_match`; на проде 0.9 с вместо 0.5.
 */
const STALE_SEMANTIC_DATE_SLACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Одна ветка на код функции (план §5 п.3): у массовой функции (`eng` ≈ 30 %
 * пула) `IN (...)` + `GROUP BY` по всем кодам сразу сортировал сотни тысяч
 * совпавших строк одним temp b-tree (замер до правки — 957–1542 мс на 750
 * тыс. строк). Каждая ветка использует `vacancy_semantic_match` напрямую под
 * свой `ORDER BY published_ms DESC LIMIT`, без полной сортировки функции;
 * слияние веток идёт уже по ограниченному числу строк (после правки — 3–9 мс
 * на том же наборе, см. `semanticMatchQuery.bench.test.ts`). Смежной
 * продуктовой ветки нет (CPO 26.10): продуктовая роль попадает в подбор, только
 * если `product` есть среди функций ролей кандидата.
 */
function buildFunctionBranch(
  levelFilter: string,
  excludedFunctionFilter: string,
  geographyFilter: string,
  isTargetFunction: boolean,
): string {
  return `SELECT * FROM (
    SELECT s.id AS id, s.published_ms AS p, i.is_remote AS remote,
      ${isTargetFunction ? 1 : 0} AS target
    FROM vacancy_semantic s INDEXED BY vacancy_semantic_match
    JOIN vacancy_pool_index i ON i.id = s.id
    WHERE s.function_code = ? ${levelFilter} ${excludedFunctionFilter} ${geographyFilter}
      AND s.published_ms BETWEEN ? AND ? AND i.published_ms BETWEEN ? AND ?
      AND ${ALIVE} AND i.is_active = 1
    ORDER BY s.published_ms DESC
    LIMIT ?
  )`;
}

/**
 * Аудит 01.11: 3 000 самых новых строк по всей географии вытесняли Москву —
 * из 487 руководящих вакансий города в подборку попадали 29. Место читается
 * из проекции сведения той же строки; `lower()` SQLite знает только латиницу,
 * поэтому кириллица сравнивается в написаниях, которые дал вызывающий.
 *
 * 03.11: страна разворачивается в сотни написаний городов («ОАЭ» — 322), и
 * отдельный `instr` на каждое заново читал место строки — 81 с на проде при
 * тайм-ауте чтения 12 с. Место читается один раз на строку (`LIMIT 1` не даёт
 * подзапросу раствориться), написания идут одним JSON-параметром — 1 с.
 */
function buildGeographyFilter(geography: MatchGeography | undefined): {
  sql: string;
  params: string[];
} {
  if (!geography || geography.cityNames.length === 0) return { sql: '', params: [] };
  const places = `EXISTS (SELECT 1 FROM (
          SELECT coalesce(json_extract(c.cluster_json, '$.location'), '') AS location
          FROM vacancy_cluster_input c WHERE c.id = s.id LIMIT 1
        ) place, json_each(?) name WHERE instr(place.location, name.value) > 0)`;
  const remote = geography.remote ? ['i.is_remote = 1'] : [];
  return {
    sql: `AND (${[...remote, places].join(' OR ')})`,
    params: [JSON.stringify(cityNameVariants(geography.cityNames))],
  };
}

function cityNameVariants(names: readonly string[]): string[] {
  const variants = names.flatMap((name) => {
    const lower = name.toLocaleLowerCase('ru-RU');
    const capital = lower.charAt(0).toLocaleUpperCase('ru-RU') + lower.slice(1);
    return [name, lower, capital, lower.toLocaleUpperCase('ru-RU')];
  });
  return Array.from(new Set(variants.filter((name) => name.trim().length > 0)));
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
  return Array.from(new Set(targetCodes));
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

export function buildSemanticMatchQuery(input: SemanticMatchQueryInput): {
  sql: string;
  params: SQLInputValue[];
} {
  // У источника уровень часто отсутствует даже у релевантной руководящей
  // роли. Неизвестный уровень остаётся видимым и ранжируется объяснением, а
  // не исчезает до того, как кандидат сможет его прочитать.
  const levelFilter =
    input.levelRank === null ? '' : 'AND (s.level_rank BETWEEN ? AND ? OR s.level_rank IS NULL)';
  const levelFloor = Math.min(
    input.levelFloorRank ?? input.levelRank ?? 0,
    (input.levelRank ?? 0) - 1,
  );
  const excludedFunctions = excludedFunctionCodesFor(input.functionCodes);
  const excludedFunctionFilter = buildExcludedFunctionFilter(excludedFunctions);
  const geography = buildGeographyFilter(input.geography);
  const queryFunctionCodes = queryFunctionCodesFor(input.functionCodes);
  const branches = queryFunctionCodes
    .map((code) =>
      buildFunctionBranch(
        levelFilter,
        excludedFunctionFilter,
        geography.sql,
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
    if (input.levelRank !== null) params.push(levelFloor, input.levelRank + 1);
    params.push(...excludedFunctions);
    params.push(...geography.params);
    params.push(input.window.fromMs - STALE_SEMANTIC_DATE_SLACK_MS, input.window.toMs);
    params.push(input.window.fromMs, input.window.toMs, input.limit);
  }
  params.push(input.limit);
  return { sql, params };
}

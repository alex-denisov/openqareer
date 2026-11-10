/**
 * B641 (решение CPO 10.11): доски iCIMS, Jobvite и Oracle — сотни тысяч вакансий
 * вне интересов кандидатов. Фоновая обработка моделью (RU-сводки карточек,
 * модельный разбор названий, связь ролей) их не берёт; процент и требования
 * считаются только по запросу кандидата, как и для всех источников.
 *
 * Id вакансии в пуле начинается с id источника (`src-fh-icims-…:123`), поэтому
 * фильтр не требует соединения с `vacancy_pool`.
 */
export const BULK_MODEL_EXCLUDED_SOURCE_PREFIXES = [
  'src-fh-icims-',
  'src-fh-jobvite-',
  'src-fh-oracle-',
] as const;

/** Условие «вакансия не из исключённых источников» по колонке с id вакансии. */
export function notExcludedVacancyIdSql(column: string): string {
  return BULK_MODEL_EXCLUDED_SOURCE_PREFIXES.map(
    (prefix) => `${column} NOT GLOB '${prefix}*'`,
  ).join(' AND ');
}

const EXCLUDED_URL_GLOBS = [
  'https://careers-*.icims.com/*',
  'https://jobs.jobvite.com/*',
  'https://*.oraclecloud.com/*',
] as const;

/** То же по публичной ссылке карточки каталога (`catalog_entries.source_url`). */
export function notExcludedSourceUrlSql(column: string): string {
  return EXCLUDED_URL_GLOBS.map((glob) => `${column} NOT GLOB '${glob}'`).join(' AND ');
}

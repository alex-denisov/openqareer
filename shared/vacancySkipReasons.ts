/**
 * Единый словарь причин «Пропустить» (B248).
 *
 * Карточка вакансии, канбан «Отклики» и рубрика ранжирования топ-20 (B247)
 * обязаны использовать один и тот же список — иначе ручная оценка и фильтр
 * подбора никогда не сойдутся. Это серверная копия
 * `docs/v1-release/tasks/work/B248/assets/reasons.js`: восемь терминов
 * набраны здесь один раз, дословно.
 */
export const VACANCY_SKIP_REASONS = [
  { id: 'role-family', label: 'не та семья ролей' },
  { id: 'level', label: 'не тот уровень (слишком junior / слишком старший)' },
  { id: 'geo-format', label: 'география или формат не подходят' },
  { id: 'comp-below', label: 'вилка ниже ожиданий' },
  { id: 'company', label: 'компания или индустрия не интересны' },
  { id: 'duplicate', label: 'уже откликался / дубликат' },
  { id: 'unverified', label: 'требование не подтверждено фактами' },
  { id: 'stale', label: 'вакансия выглядит устаревшей или подозрительной' },
] as const;

export type VacancySkipReasonId = (typeof VACANCY_SKIP_REASONS)[number]['id'];

const REASON_IDS = new Set<string>(VACANCY_SKIP_REASONS.map((reason) => reason.id));

export function isVacancySkipReasonId(value: string): value is VacancySkipReasonId {
  return REASON_IDS.has(value);
}

/**
 * Причины, из-за которых вакансия навсегда лишняя для этого кандидата:
 * подбор исключает такую запись целиком, а не просто откладывает её вниз
 * списка (B248).
 */
export const EXCLUDING_SKIP_REASONS: ReadonlySet<VacancySkipReasonId> = new Set([
  'role-family',
  'geo-format',
  'company',
  'duplicate',
]);

/**
 * Причины, которые снижают приоритет записи, но не выкидывают её: кандидат
 * мог ошибиться в оценке уровня или вилки, и запись остаётся на экране —
 * последней.
 */
export const DOWNGRADING_SKIP_REASONS: ReadonlySet<VacancySkipReasonId> = new Set([
  'level',
  'comp-below',
  'unverified',
  'stale',
]);

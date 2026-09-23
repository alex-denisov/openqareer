/**
 * B248 — единый словарь «Пропустить / не подходит».
 *
 * Дословная копия восьми причин из
 * `docs/v1-release/tasks/work/B248/assets/reasons.js`: карточка вакансии,
 * канбан и рубрика релевантности (B247) обязаны считать одними и теми же
 * терминами, иначе ручная разметка и автоматический фильтр расходятся.
 */
export interface SkipReason {
  readonly id: string;
  readonly label: string;
}

export const SKIP_REASONS: readonly SkipReason[] = [
  { id: 'role-family', label: 'не та семья ролей' },
  { id: 'level', label: 'не тот уровень (слишком junior / слишком старший)' },
  { id: 'geo-format', label: 'география или формат не подходят' },
  { id: 'comp-below', label: 'вилка ниже ожиданий' },
  { id: 'company', label: 'компания или индустрия не интересны' },
  { id: 'duplicate', label: 'уже откликался / дубликат' },
  { id: 'unverified', label: 'требование не подтверждено фактами' },
  { id: 'stale', label: 'вакансия выглядит устаревшей или подозрительной' },
];

export type SkipReasonId = (typeof SKIP_REASONS)[number]['id'];

export function isKnownSkipReasonId(value: string): value is SkipReasonId {
  return SKIP_REASONS.some((reason) => reason.id === value);
}

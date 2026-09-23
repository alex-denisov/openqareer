/**
 * B248 — единый словарь «Пропустить / не подходит».
 *
 * Дословная копия восьми причин из
 * `docs/v1-release/tasks/work/B248/assets/reasons.js`: карточка вакансии,
 * канбан и рубрика релевантности (B247) обязаны считать одними и теми же
 * терминами, иначе ручная разметка и автоматический фильтр расходятся.
 *
 * Канонический словарь причин пропуска (решение CPO по B251/S1, слияние с
 * параллельной веткой подбора): `vacancy_skips` и `applications.stage =
 * 'saved'` — эта модель, `shared/vacancySkipReasons.ts` и `vacancy_decisions`
 * из другой ветки объявлены дублями и в неё не переносятся.
 *
 * `matchingImpact` — то немногое, что причина обязана сказать подбору,
 * не читая пул: `lower_similar` понижает вес похожих вакансий (B247, фоном,
 * не в этом срезе), `none` — причина не о вкусе кандидата, а о качестве
 * данных или уже случившемся действии, и подбору отвечать нечем.
 */
export type SkipReasonMatchingImpact = 'lower_similar' | 'none';

export interface SkipReason {
  readonly id: string;
  readonly label: string;
  readonly matchingImpact: SkipReasonMatchingImpact;
}

export const SKIP_REASONS: readonly SkipReason[] = [
  { id: 'role-family', label: 'не та семья ролей', matchingImpact: 'lower_similar' },
  {
    id: 'level',
    label: 'не тот уровень (слишком junior / слишком старший)',
    matchingImpact: 'lower_similar',
  },
  { id: 'geo-format', label: 'география или формат не подходят', matchingImpact: 'lower_similar' },
  { id: 'comp-below', label: 'вилка ниже ожиданий', matchingImpact: 'lower_similar' },
  { id: 'company', label: 'компания или индустрия не интересны', matchingImpact: 'lower_similar' },
  { id: 'duplicate', label: 'уже откликался / дубликат', matchingImpact: 'none' },
  { id: 'unverified', label: 'требование не подтверждено фактами', matchingImpact: 'none' },
  {
    id: 'stale',
    label: 'вакансия выглядит устаревшей или подозрительной',
    matchingImpact: 'none',
  },
];

export type SkipReasonId = (typeof SKIP_REASONS)[number]['id'];

export function isKnownSkipReasonId(value: string): value is SkipReasonId {
  return SKIP_REASONS.some((reason) => reason.id === value);
}

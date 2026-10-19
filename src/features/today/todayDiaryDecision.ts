import type { CareerDiaryOverview, CareerDiaryWeeklyReview } from '../../../shared/careerDiary';
import { pluralRu } from '../../../shared/pluralRu';
import { currentCareerDiaryWeek } from '../diary/careerDiaryWeek';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

/** Подпись макета 1 под решением из дневника. */
export const TODAY_DIARY_FOOTNOTE =
  'Работающим кандидатам «Сегодня» ставит дневник первым: поиск вакансий остаётся рядом, но не в центре.';

const ASK = 'нужен ваш вывод на следующую неделю. Займёт около 5 минут.';

/**
 * Макет 1 «Вы работаете»: у кандидата есть основное место работы, а разбора
 * текущей недели ещё нет — решение дня ведёт в карьерный дневник.
 */
export function todayDiaryDecision(
  overview: CareerDiaryOverview | null,
  latestReview: CareerDiaryWeeklyReview | null,
): ReasonedCareerAction | null {
  const workplace = overview?.primaryWorkplace;
  if (!overview || !workplace || workplace.status !== 'active') return null;
  const week = currentCareerDiaryWeek(overview.asOf, workplace.startDate);
  if (latestReview?.weekStart === week.weekStart) return null;
  const atRisk = overview.summary.goalsAtRisk;
  return {
    revision: 'career-action-policy-v1-2026-08-07',
    type: 'review',
    destination: 'coach',
    headline: week.number ? `Разбор недели ${week.number}` : 'Разбор недели',
    label: 'Открыть карьерный дневник',
    rationale: TODAY_DIARY_FOOTNOTE,
    expectedChange:
      atRisk > 0
        ? `${pluralRu(atRisk, ['цель', 'цели', 'целей'])} под риском; ${ASK}`
        : ASK.charAt(0).toUpperCase() + ASK.slice(1),
    findingIds: [],
    roleIds: [],
    marketIds: [],
    alternatives: [],
    approvalBoundary: 'Разбор пишете вы; дневник ничего не отправляет.',
  };
}

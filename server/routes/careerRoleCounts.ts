import type { ProposedRole } from '../../shared/roleProposals';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { confirmChosenTitle } from '../vacancies/roleHypotheses';

/** Окно подписи «по подборке за 30 дней» в «Карьере» (макет s09) и фильтра «Дата: 30 дней». */
export const CAREER_ROLE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Та же дата и та же граница, что у фильтра «Дата» в «Подборке»: первый источник или первое
 * появление, от начала сегодняшнего дня (UTC) назад на `days` дней.
 */
export function observedWithinDays(item: MatchedVacancyItem, days: number, now: Date): boolean {
  const at = Date.parse(item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt);
  if (Number.isNaN(at)) return false;
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return at >= start.getTime() - days * DAY_MS;
}

/**
 * Число и данные роли «Карьеры» (B726) — по тем же строкам, что откроет «Вакансии по роли»:
 * список «Подборки» после её фильтров и ворот уровня, тот же признак роли, что у фильтра
 * «Роли», за 30 дней. Иначе кандидат видит 174 в «Карьере» и 267 после перехода.
 */
export function countRolesLikeTheList(
  roles: readonly ProposedRole[],
  listed: readonly MatchedVacancyItem[],
  options: { readonly skills: readonly string[]; readonly now: Date },
): ProposedRole[] {
  const recent = listed.filter((item) =>
    observedWithinDays(item, CAREER_ROLE_WINDOW_DAYS, options.now),
  );
  return roles.map((role) => ({
    ...role,
    confirmation: confirmChosenTitle({
      matched: recent,
      title: role.title,
      candidateSkills: options.skills,
    }),
  }));
}

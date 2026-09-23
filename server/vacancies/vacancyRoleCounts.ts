import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { titleMatchesRole } from '../../shared/vacancyRoleTitleMatch';

/**
 * Вакансий на роль кампании — вход порога значимости (`annotateRoleHypotheses`,
 * B247, срез 2). Совпадение общее с фильтром «роль» экрана «Вакансии»
 * (`shared/vacancyRoleTitleMatch.ts`), иначе баннер и список считали бы по
 * двум разным правилам. Каждая роль считается независимо — одна и та же
 * вакансия может закрыть счёт сразу нескольким ролям кампании.
 */
export function countMatchedVacanciesByRole(
  matched: readonly MatchedVacancyItem[],
  roles: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const role of roles) {
    counts[role] = matched.filter((item) =>
      titleMatchesRole(item.cluster.canonicalTitle, role),
    ).length;
  }
  return counts;
}

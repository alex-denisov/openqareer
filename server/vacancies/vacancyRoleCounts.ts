import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { sameCareerRole } from './careerRoleKey';
import { filterInSteps, runSteps, type Steps } from './yieldingSteps';

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
  return runSteps(matchedRoleCountSteps(matched, roles));
}

export function* matchedRoleCountSteps(
  matched: readonly MatchedVacancyItem[],
  roles: readonly string[],
): Steps<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const role of roles) {
    const rows = yield* filterInSteps(matched, (item) =>
      sameCareerRole(item.cluster.canonicalTitle, role),
    );
    counts[role] = rows.length;
  }
  return counts;
}

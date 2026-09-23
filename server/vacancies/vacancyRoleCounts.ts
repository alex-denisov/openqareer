import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { normalizeTextForComparison } from './vacancyFingerprint';

/**
 * Вакансий на роль кампании — вход порога значимости (`annotateRoleHypotheses`,
 * B247, срез 2). Считает то же совпадение, что и `evaluateRole` в
 * `vacancyMatcher`: заголовок вакансии содержит роль или наоборот, либо
 * пересекается минимум двумя словами. Каждая роль считается независимо —
 * одна и та же вакансия может закрыть счёт сразу нескольким ролям кампании.
 */
export function countMatchedVacanciesByRole(
  matched: readonly MatchedVacancyItem[],
  roles: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const role of roles) {
    const roleNorm = normalizeTextForComparison(role);
    if (!roleNorm) {
      counts[role] = 0;
      continue;
    }
    counts[role] = matched.filter((item) => {
      const titleNorm = normalizeTextForComparison(item.cluster.canonicalTitle);
      if (titleNorm.includes(roleNorm) || roleNorm.includes(titleNorm)) return true;
      const overlap = roleNorm.split(' ').filter((word) => titleNorm.includes(word)).length;
      return overlap >= 2;
    }).length;
  }
  return counts;
}

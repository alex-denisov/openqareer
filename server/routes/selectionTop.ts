import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { SELECTION_LIVENESS_TOP } from '../vacancies/selectionLiveness';

/** B797: записи верха подборки для сверки живости. */
export function topSelectionIds(items: readonly MatchedVacancyItem[]): string[] {
  return items
    .slice(0, SELECTION_LIVENESS_TOP)
    .map((item) => item.cluster.id.replace(/^cluster-/u, ''));
}

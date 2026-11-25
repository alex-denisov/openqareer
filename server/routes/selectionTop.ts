import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { SELECTION_LIVENESS_TOP } from '../vacancies/selectionLiveness';
import { sourceMemberKey } from '../vacancies/vacancyDeduplicator';

/** B797: все записи верха подборки для сверки живости; сначала сами строки, потом их склейки. */
export function topSelectionIds(items: readonly MatchedVacancyItem[]): string[] {
  const top = items.slice(0, SELECTION_LIVENESS_TOP).map(({ cluster }) => cluster);
  const rows = top.map((cluster) => cluster.id.replace(/^cluster-/u, ''));
  const glued = top.flatMap((cluster) =>
    cluster.sources.length > 1
      ? cluster.sources.flatMap((source) => sourceMemberKey(source) ?? [])
      : [],
  );
  return [...new Set([...rows, ...glued])];
}

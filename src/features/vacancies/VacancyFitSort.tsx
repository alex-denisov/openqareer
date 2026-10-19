import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { fitHasNumber } from './VacancyFitSummary';
export type VacancyFitSort = 'fit' | 'freshness';
export function sortVacancyFitItems(
  items: readonly MatchedVacancyItem[],
  sort: VacancyFitSort = 'fit',
): MatchedVacancyItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (sort === 'freshness') {
        const left = Date.parse(a.item.cluster.firstObservedAt);
        const right = Date.parse(b.item.cluster.firstObservedAt);
        return (
          (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0) ||
          a.index - b.index
        );
      }
      const left = fitHasNumber(a.item.explanation.fitView)
        ? a.item.explanation.fitView!.result!.coveragePercent!
        : -1;
      const right = fitHasNumber(b.item.explanation.fitView)
        ? b.item.explanation.fitView!.result!.coveragePercent!
        : -1;
      const leftRequired = a.item.explanation.fitView?.result?.requiredCoverage.percent;
      const rightRequired = b.item.explanation.fitView?.result?.requiredCoverage.percent;
      if (
        left >= 0 &&
        right >= 0 &&
        typeof leftRequired === 'number' &&
        typeof rightRequired === 'number' &&
        leftRequired !== rightRequired
      )
        return rightRequired - leftRequired;
      return right - left || a.index - b.index;
    })
    .map((row) => row.item);
}
export function VacancyFitSortControl({
  value = 'fit',
  onChange,
}: {
  readonly value?: VacancyFitSort;
  readonly onChange: (sort: VacancyFitSort) => void;
}) {
  return (
    <label className="vacancy-fit-sort">
      Порядок вакансий
      <select value={value} onChange={(event) => onChange(event.target.value as VacancyFitSort)}>
        <option value="fit">По соответствию профилю</option>
        <option value="freshness">Сначала новые</option>
      </select>
    </label>
  );
}

import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { compareFitPercent } from '../../../shared/vacancyFitPercent';
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
      return (
        compareFitPercent(a.item.explanation.fitView, b.item.explanation.fitView) ||
        a.index - b.index
      );
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
      <span>Порядок</span>
      <select
        aria-label="Порядок вакансий"
        value={value}
        onChange={(event) => onChange(event.target.value as VacancyFitSort)}
      >
        <option value="fit">По совпадению с профилем</option>
        <option value="freshness">Сначала новые</option>
      </select>
    </label>
  );
}

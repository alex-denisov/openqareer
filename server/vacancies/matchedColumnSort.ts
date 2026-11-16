import type { B640SortDirection, B640SortKey } from '../../shared/b640Vacancies';
import { detectVacancyWorkFormat, workFormatLabel } from '../../shared/vacancyWorkFormat';
import { vacancyRemoteLabel } from '../../src/features/vacancies/vacancyRemoteLabel';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/** Ключи, которые порядок подборки (`fit`, `money`) считает сам; остальные сортируются по столбцу. */
export type ColumnSortKey = Exclude<B640SortKey, 'fit' | 'money'>;

const collator = new Intl.Collator('ru');

function workFormatOf(item: MatchedVacancyItem) {
  const { cluster } = item;
  return (
    cluster.workFormat ??
    detectVacancyWorkFormat({
      location: cluster.canonicalLocation,
      summary: cluster.descriptionSummary,
      isRemote: cluster.isRemote,
    })
  );
}

function formatOf(item: MatchedVacancyItem): string {
  return workFormatLabel(workFormatOf(item)) ?? '';
}

/** Как строка «Гео» интерфейса: метка удалёнки, иначе место, иначе «Удалённо» или пусто. */
function locationOf(item: MatchedVacancyItem): string {
  const { cluster } = item;
  if (cluster.isRemote && workFormatOf(item) === 'remote') {
    const label = vacancyRemoteLabel(cluster);
    return label === 'Удалённо из любой страны'
      ? 'Удалённо · везде'
      : label.replace(/^Удалённо[,:]\s*/u, 'Удалённо · ');
  }
  const place = cluster.canonicalLocation?.trim() ?? '';
  if (place) return place;
  return cluster.isRemote ? 'Удалённо' : '';
}

function dateOf(item: MatchedVacancyItem): number | undefined {
  const { cluster } = item;
  const time = Date.parse(cluster.sources[0]?.observedAt ?? cluster.firstObservedAt);
  return Number.isNaN(time) ? undefined : time;
}

type Key = string | number | undefined;

function keyOf(item: MatchedVacancyItem, by: ColumnSortKey): Key {
  const { cluster } = item;
  if (by === 'role') return cluster.canonicalTitle.trim();
  if (by === 'company') return cluster.canonicalCompany.trim();
  if (by === 'location') return locationOf(item);
  if (by === 'format') return formatOf(item);
  return dateOf(item);
}

function compareKeys(left: Key, right: Key, direction: B640SortDirection): number {
  const leftEmpty = left === undefined || left === '';
  const rightEmpty = right === undefined || right === '';
  if (leftEmpty || rightEmpty) return Number(leftEmpty) - Number(rightEmpty);
  const order =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : collator.compare(String(left), String(right));
  return direction === 'asc' ? order : -order;
}

/**
 * B674: порядок по столбцу. Пустые значения — в конце в обе стороны, равные
 * ключи сохраняют прежний порядок строк (устойчиво, индекс — последний ключ).
 */
export function sortMatchedByColumn(
  items: readonly MatchedVacancyItem[],
  by: ColumnSortKey,
  direction: B640SortDirection,
): MatchedVacancyItem[] {
  return items
    .map((item, index) => ({ item, index, key: keyOf(item, by) }))
    .sort((a, b) => compareKeys(a.key, b.key, direction) || a.index - b.index)
    .map(({ item }) => item);
}

import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { pluralRu } from '../../../shared/pluralRu';

type VacancyCluster = MatchedVacancyItem['cluster'];
type VacancyExplanation = MatchedVacancyItem['explanation'];

export interface VacancyFilters {
  /** Возраст в днях; `undefined` — не ограничивать. */
  readonly freshness?: number;
  readonly source?: string;
  readonly remoteOnly?: boolean;
  readonly query?: string;
}

export interface VacancyAge {
  /** `null`, если сбор не оставил даты: возраст не выдумывается. */
  readonly days: number | null;
  readonly label: string;
}

/**
 * Возраст записи — узел 15 пути пилота.
 *
 * Кластер знает только, когда его впервые увидел сбор, поэтому продукт говорит
 * «в базе N дней». Написать «опубликована N дней назад» было бы подменой: даты
 * публикации в кластере нет, и у части источников её нет вовсе.
 */
export function vacancyAge(cluster: VacancyCluster, now: string): VacancyAge {
  const firstSeen = Date.parse(cluster.firstObservedAt ?? '');
  if (Number.isNaN(firstSeen)) {
    return { days: null, label: 'дата сбора неизвестна' };
  }

  const days = Math.max(
    0,
    Math.floor((Date.parse(now) - firstSeen) / 86_400_000),
  );
  return {
    days,
    label:
      days === 0
        ? 'в базе сегодня'
        : `в базе ${pluralRu(days, ['день', 'дня', 'дней'])}`,
  };
}

export interface VacancyCoverage {
  readonly covered: number;
  readonly total: number;
}

/**
 * Покрытие требований — счёт, а не процент: процент без источника, выборки и
 * даты продукту запрещён. Нечего сравнивать — покрытия нет, а не ноль.
 */
export function vacancyCoverage(
  explanation: VacancyExplanation,
): VacancyCoverage | undefined {
  const covered = explanation.matchingPoints.length;
  const total = covered + explanation.missingPoints.length;
  return total === 0 ? undefined : { covered, total };
}

export function filterVacancies(
  items: readonly MatchedVacancyItem[],
  filters: VacancyFilters,
  now: string,
): MatchedVacancyItem[] {
  const query = filters.query?.trim().toLocaleLowerCase('ru-RU');

  return items.filter(({ cluster }) => {
    if (filters.remoteOnly && !cluster.isRemote) return false;
    if (filters.source && !clusterSources(cluster).includes(filters.source)) {
      return false;
    }
    if (filters.freshness !== undefined) {
      const { days } = vacancyAge(cluster, now);
      // Запись без даты сбора не выдаётся за свежую.
      if (days === null || days > filters.freshness) return false;
    }
    if (query) {
      const haystack =
        `${cluster.canonicalTitle} ${cluster.canonicalCompany}`.toLocaleLowerCase(
          'ru-RU',
        );
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** Сколько записей пришло из каждого источника — чтобы фильтр не врал о размере. */
export function vacancySourceNames(
  items: readonly MatchedVacancyItem[],
): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { cluster } of items) {
    for (const source of new Set(clusterSources(cluster))) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source));
}

function clusterSources(cluster: VacancyCluster): string[] {
  return cluster.sources.map((source) => source.sourceType);
}

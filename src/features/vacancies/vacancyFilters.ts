import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { pluralRu } from '../../../shared/pluralRu';
import { filterVacanciesByFacets, type VacancyFacetFilters } from './vacancyFacets';

type VacancyCluster = MatchedVacancyItem['cluster'];
type VacancyExplanation = MatchedVacancyItem['explanation'];

export interface VacancyFilters extends VacancyFacetFilters {
  /** Возраст в днях; `undefined` — не ограничивать. */
  readonly freshness?: number;
  readonly source?: string;
  readonly remoteOnly?: boolean;
  readonly query?: string;
  /** Подстрока названия роли; работодатель не участвует (B234). */
  readonly role?: string;
  /** Страна работодателя из обогащения (`companyFeatures.country`). */
  readonly country?: string;
}

export interface VacancyAge {
  /** `null`, если сбор не оставил даты: возраст не выдумывается. */
  readonly days: number | null;
  readonly label: string;
}

/**
 * Объяснение «В базе» — один раз, подсказкой к заголовку колонки и легенде
 * фильтра, а не абзацем под чипами: владелец прочёл абзац и не понял, о чём
 * он (приёмка B236, 2026-09-21). Число в ячейке — дни с первого сбора записи.
 */
export const IN_BASE_HINT =
  'Сколько дней вакансия у нас: считаем от дня, когда она появилась в нашем сборе. Дату публикации площадки отдают не всегда.';

/** Объяснение колонки «Требования» — тоже один раз, в подсказке заголовка. */
export const REQUIREMENTS_HINT =
  'Сколько требований из текста вакансии нашлось в вашем профиле: «6 из 7» — совпало шесть из семи.';

/**
 * Возраст записи — узел 15 пути пилота.
 *
 * Кластер знает только, когда его впервые увидел сбор, поэтому колонка
 * называется «в базе», а значение — «N дней». Написать «опубликована N дней
 * назад» было бы подменой: даты публикации в кластере нет, и у части
 * источников её нет вовсе. «Возраст» как заголовок владелец не понял
 * (2026-09-20).
 */
export function vacancyAge(cluster: VacancyCluster, now: string): VacancyAge {
  const firstSeen = Date.parse(cluster.firstObservedAt ?? '');
  if (Number.isNaN(firstSeen)) {
    return { days: null, label: 'дата неизвестна' };
  }

  const days = Math.max(0, Math.floor((Date.parse(now) - firstSeen) / 86_400_000));
  return {
    days,
    label: days === 0 ? 'сегодня' : pluralRu(days, ['день', 'дня', 'дней']),
  };
}

export interface VacancyCoverage {
  readonly covered: number;
  readonly total: number;
}

/**
 * Покрытие требований — счёт, а не процент: процент без источника, выборки и
 * даты продукту запрещён. Нечего сравнивать — покрытия нет, а не ноль.
 *
 * Знаменатель берётся из требований вакансии, а не из `matchingPoints`: туда
 * попадают ещё и совпадение роли с форматом работы, и «7 из 11» получалось при
 * пяти требованиях в вакансии (PRB-016).
 */
export function vacancyCoverage(explanation: VacancyExplanation): VacancyCoverage | undefined {
  const requirements = explanation.requirements;
  if (!requirements || requirements.total === 0) return undefined;
  return { covered: requirements.matched, total: requirements.total };
}

export function filterVacancies(
  items: readonly MatchedVacancyItem[],
  filters: VacancyFilters,
  now: string,
): MatchedVacancyItem[] {
  const facetFiltered = filterVacanciesByFacets(items, filters);
  const query = filters.query?.trim().toLocaleLowerCase('ru-RU');
  const role = filters.role?.trim().toLocaleLowerCase('ru-RU');

  return facetFiltered.filter(({ cluster }) => {
    if (filters.remoteOnly && !cluster.isRemote) return false;
    if (filters.country && cluster.companyFeatures?.country !== filters.country) return false;
    if (role && !cluster.canonicalTitle.toLocaleLowerCase('ru-RU').includes(role)) return false;
    if (filters.source && !clusterSources(cluster).includes(filters.source)) {
      return false;
    }
    if (filters.freshness !== undefined) {
      const { days } = vacancyAge(cluster, now);
      // Запись без даты сбора не выдаётся за свежую.
      if (days === null || days > filters.freshness) return false;
    }
    if (query) {
      const haystack = `${cluster.canonicalTitle} ${cluster.canonicalCompany}`.toLocaleLowerCase(
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

/** Названия площадок кластера без повторов — по ним и фильтр, и подпись. */
function clusterSources(cluster: VacancyCluster): string[] {
  return vacancySourceLabels(cluster.sources);
}

/** Страны работодателей со счётом записей — для фильтра «страна» (B234). */
export function vacancyCountries(
  items: readonly MatchedVacancyItem[],
): Array<{ country: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { cluster } of items) {
    const country = cluster.companyFeatures?.country?.trim();
    if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, 'ru-RU'));
}

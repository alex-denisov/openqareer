import type { MatchedVacancyItem } from '../coach/cabinetTypes';

/**
 * Наблюдения рынка для карты ролей берутся из собранного пула вакансий.
 *
 * `buildCanonicalRoleMarketMap` передавал в карту `observations: []`, поэтому
 * любая выборка честно объявлялась недостаточной, а карта ролей ничего не
 * могла сказать о рынке (B104). Пул продукта — единственный источник, у
 * которого есть и дата наблюдения, и источник записи, поэтому карта строится
 * по нему, а не по знанию модели.
 */
export interface PoolMarketObservation {
  readonly id: string;
  readonly roleTitle: string;
  readonly observedAt: string;
  readonly sourceLabel: string;
  readonly requirements: string[];
}

export type PoolMarketGeography = 'russia' | 'worldwide-remote';

/** Те же названия площадок, что кандидат читает в таблице пула. */
const SOURCE_LABELS: Record<string, string> = {
  hh: 'hh.ru',
  trudvsem: 'ТрудВсем',
  remotive: 'Remotive',
  telegram: 'Telegram-каналы',
};

/** Площадки, чья выборка по построению относится к российскому рынку. */
const RUSSIAN_SOURCES = new Set(['hh', 'trudvsem']);

export function poolMarketObservations(
  pool: readonly MatchedVacancyItem[],
): Record<PoolMarketGeography, PoolMarketObservation[]> {
  const grouped: Record<PoolMarketGeography, PoolMarketObservation[]> = {
    russia: [],
    'worldwide-remote': [],
  };

  for (const item of pool) {
    const geography = clusterGeography(item);
    // География, которой продукт не знает, не приписывается ни одному рынку:
    // запись без известной географии исказила бы обе выборки сразу.
    if (!geography) continue;
    grouped[geography].push({
      id: item.cluster.id,
      roleTitle: item.cluster.canonicalTitle,
      observedAt: item.cluster.firstObservedAt,
      sourceLabel: sourceLabel(item),
      requirements: item.cluster.skills.filter((skill) => skill.trim().length > 0),
    });
  }

  return grouped;
}

function clusterGeography(item: MatchedVacancyItem): PoolMarketGeography | undefined {
  if (item.cluster.isRemote) return 'worldwide-remote';
  return item.cluster.sources.some((source) => RUSSIAN_SOURCES.has(source.sourceType))
    ? 'russia'
    : undefined;
}

function sourceLabel(item: MatchedVacancyItem): string {
  const first = item.cluster.sources[0]?.sourceType ?? '';
  return SOURCE_LABELS[first] ?? first;
}

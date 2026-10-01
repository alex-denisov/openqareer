import type { MatchedVacancyFacets, MatchedVacancyFacetLevel } from '../../shared/matchedVacancyFacets';
import { titleMatchesRole } from '../../shared/vacancyRoleTitleMatch';
import { inferSeniorityLevel, levelFromRank } from './levelMatcher';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { regionOfVacancy } from './vacancyGeography';

export function matchedVacancyRegion(item: MatchedVacancyItem) {
  return regionOfVacancy({ location: item.cluster.canonicalLocation,
    country: item.cluster.companyFeatures?.country });
}

export type MatchedVacancyLevelReader = (item: MatchedVacancyItem) => number | null | undefined;

export function matchedVacancyLevel(
  item: MatchedVacancyItem,
  readLevel?: MatchedVacancyLevelReader,
): MatchedVacancyFacetLevel {
  const stored = readLevel?.(item);
  return (stored === undefined ? inferSeniorityLevel(item.cluster.canonicalTitle) : levelFromRank(stored)) ?? 'unknown';
}

function counted<T>(values: readonly T[]): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

/** Каждый кластер считается один раз на источник, даже при нескольких ссылках. */
function sourceFacets(items: readonly MatchedVacancyItem[]): MatchedVacancyFacets['sources'] {
  const sources = items.flatMap((item) => [...new Map(item.cluster.sources
    .map((source) => [source.sourceId, source])).values()]);
  const names = new Map(sources.map((source) => [source.sourceId, source.sourceName ?? source.sourceId]));
  return counted(sources.map((source) => source.sourceId))
    .map(({ value: sourceId, count }) => ({ sourceId, name: names.get(sourceId)!, count }));
}

/** Сводка строится по полному совпавшему списку до пользовательских фильтров. */
export function buildMatchedVacancyFacets(
  items: readonly MatchedVacancyItem[],
  targetRoles: readonly string[] = [],
  readLevel?: MatchedVacancyLevelReader,
): MatchedVacancyFacets {
  return {
    total: items.length,
    regions: counted(items.flatMap((item) => matchedVacancyRegion(item) ?? []))
      .map(({ value: id, count }) => ({ id, count })),
    remote: items.filter((item) => item.cluster.isRemote).length,
    levels: counted(items.map((item) => matchedVacancyLevel(item, readLevel))).map(({ value: level, count }) => ({ level, count })),
    roles: targetRoles.map((role) => ({ role, count: items.filter((item) =>
      item.explanation.roleMatch !== 'none' && titleMatchesRole(item.cluster.canonicalTitle, role)).length }))
      .filter(({ count }) => count > 0).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    sources: sourceFacets(items),
  };
}

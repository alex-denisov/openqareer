import {
  MATCHED_VACANCY_SOURCE_GROUPS,
  type MatchedVacancyFacets,
  type MatchedVacancyFacetLevel,
  type MatchedVacancyPlaceFacet,
  type MatchedVacancySourceGroup,
  type MatchedVacancySourceGroupId,
} from '../../shared/matchedVacancyFacets';
import { sameCareerRole } from './careerRoleKey';
import { inferSeniorityLevel, levelFromRank } from './levelMatcher';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { VacancySourceConfig, VacancySourceType } from '../domain/unifiedVacancy';
import { ATS_BOARD_SOURCES } from './atsBoardSources';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { vacancySourceRegistryView } from './vacancySourceRegistry';
import { regionOfVacancy } from './vacancyGeography';

export function matchedVacancyRegion(item: MatchedVacancyItem) {
  return regionOfVacancy({
    location: item.cluster.canonicalLocation,
    country: item.cluster.companyFeatures?.country,
  });
}

export type MatchedVacancyLevelReader = (item: MatchedVacancyItem) => number | null | undefined;

export function matchedVacancyLevel(
  item: MatchedVacancyItem,
  readLevel?: MatchedVacancyLevelReader,
): MatchedVacancyFacetLevel {
  const stored = readLevel?.(item);
  return (
    (stored === undefined
      ? inferSeniorityLevel(item.cluster.canonicalTitle)
      : levelFromRank(stored)) ?? 'unknown'
  );
}

function counted<T>(values: readonly T[]): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

/** Каждый кластер считается один раз на источник, даже при нескольких ссылках. */
function sourceFacets(
  items: readonly MatchedVacancyItem[],
  registry: readonly MatchedVacancySourceDefinition[],
): MatchedVacancyFacets['sources'] {
  const sources = items.flatMap((item) => [
    ...new Map(item.cluster.sources.map((source) => [source.sourceId, source])).values(),
  ]);
  const names = new Map(
    sources.map((source) => [source.sourceId, source.sourceName ?? source.sourceId]),
  );
  const byId = new Map(registry.map((source) => [source.id, source]));
  return counted(sources.map((source) => source.sourceId)).map(({ value: sourceId, count }) => {
    const name = byId.get(sourceId)?.name ?? names.get(sourceId)!;
    const groupId = sourceGroupId(byId.get(sourceId) ?? { id: sourceId, name });
    return { sourceId, name, count, ...(groupId ? { groupId } : {}) };
  });
}

/** B446-r: одно место — одна запись с числом, а не строка на вакансию. */
function placeFacets(items: readonly MatchedVacancyItem[]): MatchedVacancyPlaceFacet[] {
  const places = new Map<string, MatchedVacancyPlaceFacet>();
  for (const item of items) {
    const location = item.cluster.canonicalLocation?.trim() || undefined;
    const country = item.cluster.companyFeatures?.country?.trim() || undefined;
    const isRemote = Boolean(item.cluster.isRemote);
    const key = JSON.stringify([location, country, isRemote]);
    const known = places.get(key);
    if (known) {
      places.set(key, { ...known, count: known.count + 1 });
      continue;
    }
    const region = matchedVacancyRegion(item);
    places.set(key, {
      ...(location ? { location } : {}),
      ...(country ? { country } : {}),
      ...(isRemote ? { isRemote } : {}),
      ...(region ? { region } : {}),
      count: 1,
    });
  }
  return [...places.values()];
}

/** Сводка строится по полному совпавшему списку до пользовательских фильтров. */
export interface MatchedVacancySourceDefinition {
  readonly id: string;
  readonly name: string;
  readonly type?: VacancySourceType;
  readonly targetUrl?: string;
  readonly attributionUrl?: string;
  readonly market?: string;
  readonly category?: string;
}

const atsSourceIds = new Set(ATS_BOARD_SOURCES.map(({ id }) => id));
const groupByRegistryCategory = new Map<string, MatchedVacancySourceGroupId>([
  ['Агрегаторы и API', 'aggregators'],
  ['Международные площадки', 'platforms'],
  ['Telegram каналы', 'channels'],
]);

export function matchedVacancySourceRegistry(
  runtimeSources: readonly VacancySourceConfig[] = [],
): MatchedVacancySourceDefinition[] {
  const registryView = vacancySourceRegistryView([]).map(
    ({ id, name, market, category, attributionUrl }) => ({
      id,
      name,
      market,
      category,
      attributionUrl,
    }),
  );
  const sources = [
    ...registryView,
    ...DEFAULT_VACANCY_SOURCES,
    ...ATS_BOARD_SOURCES,
    ...runtimeSources,
  ];
  const byId = new Map<string, MatchedVacancySourceDefinition>();
  for (const source of sources) {
    byId.set(source.id, { ...byId.get(source.id), ...source });
  }
  return Array.from(byId.values());
}

function sourceGroupId(source: MatchedVacancySourceDefinition): MatchedVacancySourceGroupId | null {
  if (atsSourceIds.has(source.id) || source.type === 'career_site') return 'ats';
  const registryGroup = source.category ? groupByRegistryCategory.get(source.category) : undefined;
  if (registryGroup) return registryGroup;
  if (source.type === 'telegram') return 'channels';
  if (
    ['hh', 'hh_search', 'remotive', 'browser_session', 'direct', 'linkedin_crawler'].includes(
      source.type ?? '',
    )
  )
    return 'platforms';
  if (source.type === 'json_api' || source.type === 'rss') return 'aggregators';
  return null;
}

function sourceGroupsFor(
  items: readonly MatchedVacancyItem[],
  registry: readonly MatchedVacancySourceDefinition[],
): MatchedVacancySourceGroup[] {
  const sourceById = new Map(registry.map((source) => [source.id, source]));
  const counts = new Map(MATCHED_VACANCY_SOURCE_GROUPS.map(({ id }) => [id, 0]));
  for (const item of items) {
    const itemGroups = new Set<MatchedVacancySourceGroupId>();
    for (const source of item.cluster.sources) {
      const groupId = sourceGroupId(
        sourceById.get(source.sourceId) ?? {
          id: source.sourceId,
          name: source.sourceName ?? source.sourceId,
        },
      );
      if (groupId) itemGroups.add(groupId);
    }
    for (const groupId of itemGroups) counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return MATCHED_VACANCY_SOURCE_GROUPS.map(({ id, name }) => ({
    id,
    name,
    count: counts.get(id) ?? 0,
  }));
}

export function buildMatchedVacancyFacets(
  items: readonly MatchedVacancyItem[],
  targetRoles: readonly string[] = [],
  readLevel?: MatchedVacancyLevelReader,
  registry: readonly MatchedVacancySourceDefinition[] = [],
): MatchedVacancyFacets {
  return {
    total: items.length,
    regions: counted(items.flatMap((item) => matchedVacancyRegion(item) ?? [])).map(
      ({ value: id, count }) => ({ id, count }),
    ),
    remote: items.filter((item) => item.cluster.isRemote).length,
    levels: counted(items.map((item) => matchedVacancyLevel(item, readLevel))).map(
      ({ value: level, count }) => ({ level, count }),
    ),
    roles: targetRoles
      .map((role) => ({
        role,
        count: items.filter(
          (item) =>
            item.explanation.roleMatch !== 'none' &&
            sameCareerRole(item.cluster.canonicalTitle, role),
        ).length,
      }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    sources: sourceFacets(items, registry),
    sourceGroups: sourceGroupsFor(items, registry),
    places: placeFacets(items),
  };
}

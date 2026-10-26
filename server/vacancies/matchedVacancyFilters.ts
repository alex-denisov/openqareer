import { z } from 'zod';
import { CANDIDATE_REGIONS } from '../../src/features/workspace/candidateRegions';
import { MATCHED_VACANCY_FACET_LEVELS } from '../../shared/matchedVacancyFacets';
import { matchesLocationSelection } from '../../shared/locationTree';
import { sameCareerRole } from './careerRoleKey';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import {
  matchedVacancyLevel,
  matchedVacancyRegion,
  type MatchedVacancyLevelReader,
} from './matchedVacancyFacets';

const repeated = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(schema),
  );
export const matchedVacanciesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  region: repeated(z.enum(CANDIDATE_REGIONS)),
  level: repeated(z.enum(MATCHED_VACANCY_FACET_LEVELS)),
  source: repeated(z.string().min(1)),
  role: repeated(z.string().min(1)),
  remote: z.literal('1').optional(),
  /** B446-r: ключи дерева «Локаций» — фильтр на сервере, чтобы число выдачи было одно. */
  place: repeated(z.string().min(1).max(200)),
  placeRemote: z.literal('1').optional(),
  sort: z.enum(['fit', 'freshness']).optional(),
});
export type MatchedVacancyFilters = z.infer<typeof matchedVacanciesQuerySchema>;

function matchesPlaceFilter(item: MatchedVacancyItem, filters: MatchedVacancyFilters): boolean {
  const places = filters.place ?? [];
  if (!places.length && !filters.placeRemote) return true;
  if (filters.placeRemote && item.cluster.isRemote) return true;
  return (
    places.length > 0 &&
    matchesLocationSelection(
      {
        location: item.cluster.canonicalLocation?.trim() ?? '',
        country: item.cluster.companyFeatures?.country,
      },
      places,
    )
  );
}

/** Перечисленные значения одной группы объединяются, разные группы пересекаются. */
export function filterMatchedVacancies(
  items: readonly MatchedVacancyItem[],
  filters: MatchedVacancyFilters,
  targetRoles: readonly string[],
  readLevel?: MatchedVacancyLevelReader,
  knownSourceIds: readonly string[] = [],
): MatchedVacancyItem[] {
  const sourceIds = new Set([
    ...knownSourceIds,
    ...items.flatMap((item) => item.cluster.sources.map((source) => source.sourceId)),
  ]);
  z.array(z.string().refine((source) => sourceIds.has(source), 'Неизвестный источник')).parse(
    filters.source,
  );
  z.array(z.string().refine((role) => targetRoles.includes(role), 'Неизвестная роль')).parse(
    filters.role,
  );
  return items.filter(
    (item) =>
      (!filters.region.length ||
        filters.region.some((region) => region === matchedVacancyRegion(item))) &&
      (!filters.level.length || filters.level.includes(matchedVacancyLevel(item, readLevel))) &&
      (!filters.remote || item.cluster.isRemote) &&
      matchesPlaceFilter(item, filters) &&
      (!filters.source.length ||
        item.cluster.sources.some((source) => filters.source.includes(source.sourceId))) &&
      (!filters.role.length ||
        filters.role.some(
          (role) =>
            item.explanation.roleMatch !== 'none' &&
            sameCareerRole(item.cluster.canonicalTitle, role),
        )),
  );
}

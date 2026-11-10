import type { VacancySort } from '../../../shared/vacancySort';
import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import type { VacanciesScreenState } from './VacanciesScreenFilters';
import { SECTION_CACHE_KEYS, readSectionCache, writeSectionCache } from '../shell/sectionCache';

/**
 * The cabinet-wide (unfiltered) selection as last shown (B589). A repeat visit
 * renders it at once and the pool reader refreshes it without blanking the
 * list; a filtered selection is never kept, every mount starts unfiltered.
 */
export interface CachedMatchedPool {
  readonly facets?: MatchedVacancyFacets;
  readonly initialFilters?: VacanciesScreenState;
  readonly sort?: VacancySort;
  readonly matched: MatchedVacancyItem[];
  readonly total: number;
  readonly poolTotal: number;
  readonly complete: boolean;
  readonly campaign?: CampaignMetaView;
  readonly candidateLevel?: string | null;
}

export function readCachedMatchedPool(): CachedMatchedPool | undefined {
  return readSectionCache<CachedMatchedPool>(SECTION_CACHE_KEYS.matchedPool);
}

export function writeCachedMatchedPool(pool: CachedMatchedPool): void {
  writeSectionCache<CachedMatchedPool>(SECTION_CACHE_KEYS.matchedPool, pool);
}

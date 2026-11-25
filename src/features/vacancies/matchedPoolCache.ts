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

/**
 * `whole` — только подборка, прочитанная до конца; `latest` — последнее показанное, в том числе
 * одна страница S07 или карточки. B770: одна страница в общей записи показала бы в «Сохранённых»
 * неполный список как готовый.
 */
export type CachedPoolKind = 'whole' | 'latest';

export function readCachedMatchedPool(
  kind: CachedPoolKind = 'whole',
): CachedMatchedPool | undefined {
  return readSectionCache<CachedMatchedPool>(
    kind === 'whole' ? SECTION_CACHE_KEYS.matchedPool : SECTION_CACHE_KEYS.matchedPoolLatest,
  );
}

export function writeCachedMatchedPool(pool: CachedMatchedPool): void {
  writeSectionCache<CachedMatchedPool>(SECTION_CACHE_KEYS.matchedPoolLatest, pool);
  if (pool.complete) writeSectionCache<CachedMatchedPool>(SECTION_CACHE_KEYS.matchedPool, pool);
}

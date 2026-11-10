import type {
  ApplicationListPageMeta,
  ApplicationListQuery,
  ApplicationView,
} from './applicationsApi';
import { SECTION_CACHE_KEYS, readSectionCache, writeSectionCache } from '../shell/sectionCache';

/** The tracker's first read on every mount: active stages, newest first. */
export const DEFAULT_APPLICATIONS_QUERY: ApplicationListQuery = {
  stage: ['saved', 'applied', 'responded', 'interview', 'offer'],
  limit: 20,
  offset: 0,
};

/** The period of a whole-pool reading; since B632 «Отклики» read the pool undated. */
export interface ApplicationsPoolRange {
  readonly from?: string;
  readonly to?: string;
}

export interface CachedApplicationsPage {
  readonly items: readonly ApplicationView[];
  readonly meta?: ApplicationListPageMeta;
  /** Set when the list on screen was the whole pool for this period. */
  readonly pool?: ApplicationsPoolRange;
}

/** The same key the responses workspace gives a pool reading. */
export function applicationsPoolKey(range: ApplicationsPoolRange): string {
  return JSON.stringify([range.from ?? '', range.to ?? '']);
}

/**
 * B589: «Отклики» show the last list at once on a repeat visit. Kept: the
 * default first page, or the whole pool «Отклики» read for a period without
 * other filters. A stage, channel or sort selection is the candidate's view of
 * the moment and every mount starts without it.
 */
export function readCachedApplications(): CachedApplicationsPage | undefined {
  const cached = readSectionCache<CachedApplicationsPage>(SECTION_CACHE_KEYS.applications);
  // A dated pool (kept before B632) is not what «Отклики» open with.
  if (cached?.pool && !isDefaultPoolRange(cached.pool)) return undefined;
  return cached;
}

/** «Отклики» read the whole pool undated (B632); only that pool is worth restoring. */
function isDefaultPoolRange(range: ApplicationsPoolRange): boolean {
  return !range.from && !range.to;
}

export function cacheApplicationsRead(
  query: ApplicationListQuery,
  poolLoaded: boolean,
  page: Omit<CachedApplicationsPage, 'pool'>,
): void {
  if (poolLoaded) {
    if (!isPlainPoolQuery(query) || !isDefaultPoolRange(query)) return;
    writeSectionCache<CachedApplicationsPage>(SECTION_CACHE_KEYS.applications, {
      ...page,
      pool: { from: query.from, to: query.to },
    });
    return;
  }
  if (!isDefaultQuery(query)) return;
  writeSectionCache<CachedApplicationsPage>(SECTION_CACHE_KEYS.applications, page);
}

function isPlainPoolQuery(query: ApplicationListQuery): boolean {
  return !query.stage?.length && !query.channel?.length && !query.sort && !query.direction;
}

function isDefaultQuery(query: ApplicationListQuery): boolean {
  return (
    sameList(query.stage, DEFAULT_APPLICATIONS_QUERY.stage) &&
    !query.channel?.length &&
    !query.from &&
    !query.to &&
    !query.sort &&
    !query.direction &&
    (query.offset ?? 0) === 0
  );
}

function sameList(left?: readonly string[], right?: readonly string[]): boolean {
  if (!left || !right) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

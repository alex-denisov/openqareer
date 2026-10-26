import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import {
  locationPathKeys,
  matchesLocationSelection,
  parseVacancyLocation,
} from '../../shared/locationTree';
import type { CandidateDecisionProfile } from '../../shared/workPreferences';
import { regionOfVacancy } from './vacancyGeography';
import '../../shared/geo/serverGeoDirectory';

/**
 * География подбора из условий «Карьеры» (CPO 26.10): города и форматы, а не
 * регионы мастера. Места — ключи дерева «Локаций», так фильтр и подборка
 * читают один и тот же выбор.
 */
export interface CareerGeography {
  /** Как кандидат написал: «Москва», «Удалённо из РФ». */
  readonly labels: readonly string[];
  /** Ключи дерева «Локаций» («Россия › … › Москва») или текст, если место не распознано. */
  readonly places: readonly string[];
  /** Удалённые вакансии входят в географию. */
  readonly remote: boolean;
  readonly regions: readonly CandidateRegion[];
}

const REMOTE_ENTRY = /удал[её]н|remote/iu;
const HOME_COUNTRY_MARK = /(^|[^\p{L}])(рф|росси)/iu;
const REMOTE_FORMATS = new Set(['remote_home', 'remote_abroad']);

function placeKey(entry: string): string {
  const path = parseVacancyLocation({ location: entry });
  return path ? (locationPathKeys(path).at(-1) ?? entry) : entry;
}

/** `null` — условия не называют мест: подбор идёт по регионам мастера. */
export function careerGeographyOf(
  profile: Partial<CandidateDecisionProfile> | null | undefined,
): CareerGeography | null {
  const labels = (profile?.searchLocations ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (labels.length === 0) return null;
  const remoteEntries = labels.filter((entry) => REMOTE_ENTRY.test(entry));
  const placeEntries = labels.filter((entry) => !REMOTE_ENTRY.test(entry));
  const remote =
    remoteEntries.length > 0 ||
    (profile?.workFormats ?? []).some((format) => REMOTE_FORMATS.has(format));
  const regions = new Set<CandidateRegion>();
  for (const entry of placeEntries) {
    const region = regionOfVacancy({
      location: entry,
      country: parseVacancyLocation({ location: entry })?.country,
    });
    if (region) regions.add(region);
  }
  if (remoteEntries.some((entry) => HOME_COUNTRY_MARK.test(entry))) regions.add('ru');
  return {
    labels,
    places: Array.from(new Set(placeEntries.map(placeKey))),
    remote,
    regions: [...regions],
  };
}

interface GeographyItem {
  readonly cluster: {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly companyFeatures?: { readonly country?: string };
  };
}

export function withinCareerGeography(item: GeographyItem, geography: CareerGeography): boolean {
  if (geography.remote && item.cluster.isRemote) return true;
  if (geography.places.length === 0) return false;
  return matchesLocationSelection(
    {
      location: item.cluster.canonicalLocation?.trim() ?? '',
      country: item.cluster.companyFeatures?.country,
    },
    geography.places,
  );
}

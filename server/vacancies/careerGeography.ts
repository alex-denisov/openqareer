import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import {
  locationPathKeys,
  matchesLocationSelection,
  parseVacancyLocation,
} from '../../shared/locationTree';
import { isMoscowAreaSelection, MOSCOW_AREA_LABEL } from '../../shared/geo/moscowArea';
import type { CandidateDecisionProfile } from '../../shared/workPreferences';
import { parseRemoteScope, remoteScopeAllows } from '../../shared/remoteScope';
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
  /**
   * Откуда кандидат работает удалённо («Удалённо из РФ» — `ru`). Пусто —
   * страна не названа, подходит удалёнка с любой областью (03.11).
   */
  readonly remoteRegions: readonly CandidateRegion[];
  readonly regions: readonly CandidateRegion[];
}

const REMOTE_ENTRY = /удал[её]н|remote/iu;
const HOME_COUNTRY_MARK = /(^|[^\p{L}])(рф|росси)/iu;
const REMOTE_FORMATS = new Set(['remote_home', 'remote_abroad']);

function placeKey(entry: string): string {
  if (isMoscowAreaSelection(entry)) return MOSCOW_AREA_LABEL;
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
    if (isMoscowAreaSelection(entry)) regions.add('ru');
    const region = regionOfVacancy({
      location: entry,
      country: parseVacancyLocation({ location: entry })?.country,
    });
    if (region) regions.add(region);
  }
  const remoteRegions = remoteEntries.some((entry) => HOME_COUNTRY_MARK.test(entry))
    ? (['ru'] as const)
    : [];
  for (const region of remoteRegions) regions.add(region);
  return {
    labels,
    places: Array.from(new Set(placeEntries.map(placeKey))),
    remote,
    remoteRegions,
    regions: [...regions],
  };
}

interface GeographyItem {
  readonly cluster: {
    readonly canonicalLocation?: string;
    readonly isRemote?: boolean;
    readonly remoteScope?: string;
    readonly companyFeatures?: { readonly country?: string };
  };
}

/** «Удалённо из РФ» не берёт удалёнку «только США»; область не посчитана — берёт. */
function remoteWithinReach(item: GeographyItem, geography: CareerGeography): boolean {
  if (!geography.remote || !item.cluster.isRemote) return false;
  return remoteScopeAllows(parseRemoteScope(item.cluster.remoteScope), geography.remoteRegions);
}

export function withinCareerGeography(item: GeographyItem, geography: CareerGeography): boolean {
  if (remoteWithinReach(item, geography)) return true;
  if (geography.places.length === 0) return false;
  return matchesLocationSelection(
    {
      location: item.cluster.canonicalLocation?.trim() ?? '',
      country: item.cluster.companyFeatures?.country,
    },
    geography.places,
  );
}

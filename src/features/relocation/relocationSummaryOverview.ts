import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { CountryFitStatus } from '../../../shared/countryFit/types';
import { listRelocationCountries } from './relocationCountryData';
import {
  sortRelocationCountries,
  summarizeRelocationCountry,
  type RelocationCountrySummary,
} from './relocationCountrySummary';

export interface RelocationSummaryOverview {
  readonly counts: Readonly<Record<CountryFitStatus, number>>;
  readonly unknown: readonly RelocationCountrySummary[];
  readonly key: readonly RelocationCountrySummary[];
}

const KEY_COUNTRIES = 3;

/** Real numbers for «Что получилось»: counts by status, countries to clarify, key countries. */
export function buildRelocationSummaryOverview(
  profile: RelocationQuestionnaire,
): RelocationSummaryOverview {
  const summaries = sortRelocationCountries(listRelocationCountries(), profile).map((country) =>
    summarizeRelocationCountry(country, profile),
  );
  const counts: Record<CountryFitStatus, number> = {
    available: 0,
    high_barriers: 0,
    legally_unavailable: 0,
    unknown: 0,
  };
  for (const summary of summaries) counts[summary.status] += 1;
  const home = new Set(profile.citizenshipDocuments.citizenshipCountryCodes);
  // Countries of the candidate's own documents lead: they are what the questionnaire changed.
  const documented = new Set(
    profile.citizenshipDocuments.documents.map(({ countryCode }) => countryCode),
  );
  const byDocuments = [...summaries].sort(
    (left, right) =>
      Number(documented.has(right.countryCode)) - Number(documented.has(left.countryCode)),
  );
  return {
    counts,
    unknown: summaries.filter(({ status }) => status === 'unknown'),
    key: byDocuments
      .filter(({ status, countryCode }) => status !== 'unknown' && !home.has(countryCode))
      .slice(0, KEY_COUNTRIES),
  };
}

function countryWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'стран';
  if (ones === 1) return 'страна';
  if (ones >= 2 && ones <= 4) return 'страны';
  return 'стран';
}

/** One sentence of counts; a status with no countries is not mentioned. */
export function relocationCountsSentence(counts: RelocationSummaryOverview['counts']): string {
  const parts = [
    counts.available
      ? `доступно без ограничений ${counts.available} ${countryWord(counts.available)}`
      : '',
    counts.high_barriers ? `с высокими барьерами ${counts.high_barriers}` : '',
    counts.legally_unavailable ? `юридически недоступно ${counts.legally_unavailable}` : '',
    counts.unknown ? `нужно уточнить ${counts.unknown}` : '',
  ].filter(Boolean);
  if (!parts.length) return 'Стран в расчёте нет.';
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** «что не хватает» for one country: its leading reason without the trailing period. */
export function relocationMissingNote(summary: RelocationCountrySummary): string {
  const reason = summary.reason.replace(/\.$/u, '');
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

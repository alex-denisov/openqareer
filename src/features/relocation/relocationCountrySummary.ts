import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type {
  CountryFitStatus,
  MobilityScenarioEvaluation,
  MobilityScenarioId,
} from '../../../shared/countryFit/types';
import { relocationStatusLabel } from './relocationStatus';
import { leadingScenario } from './relocationLeadingScenario';
import { countryFitForQuestionnaire, type RelocationCountry } from './relocationCountryData';

export interface RelocationCountrySummary {
  readonly countryCode: string;
  readonly name: string;
  readonly status: CountryFitStatus;
  readonly statusLabel: string;
  readonly scenarioLabel: string;
  readonly reason: string;
  readonly source: { readonly title: string; readonly retrievedAt: string } | null;
  readonly scenarios: readonly MobilityScenarioEvaluation[];
}

/** Scenario names of mockup 15; the catalog's own label is the fallback. */
export const RELOCATION_SCENARIO_LABELS: Readonly<Partial<Record<MobilityScenarioId, string>>> = {
  domestic_market: 'Домашний рынок',
  employer_sponsorship: 'Переезд с визой',
  job_seeker_visa: 'Виза для поиска работы',
  digital_nomad: 'Digital Nomad',
  simple_mobility: 'Без визы, ЕАЭС',
};

export { relocationStatusLabel } from './relocationStatus';

export function summarizeRelocationCountry(
  country: RelocationCountry,
  profile: RelocationQuestionnaire | null,
): RelocationCountrySummary {
  const fit = countryFitForQuestionnaire(country.countryCode, profile);
  const lead = leadingScenario(fit.scenarios);
  const source = lead?.sources[0] ?? fit.scenarios.flatMap(({ sources }) => sources)[0];
  return {
    countryCode: country.countryCode,
    name: country.name,
    status: fit.status,
    statusLabel: relocationStatusLabel(fit.status),
    scenarioLabel: lead
      ? (RELOCATION_SCENARIO_LABELS[lead.id] ?? lead.label)
      : 'Сценарий не определён',
    reason:
      lead?.reasons[0] ??
      (lead?.status === 'available'
        ? (lead.paths.find(({ status }) => status === 'available')?.label ??
          'Правило выполнено по фактам вашей анкеты.')
        : 'В правилах нет пояснения для вашего профиля.'),
    source: source ? { title: source.title, retrievedAt: source.retrievedAt } : null,
    scenarios: fit.scenarios,
  };
}

export interface RelocationTabCounts {
  readonly countries: number;
  readonly comparison: number;
}

/** Tab counters come from the candidate's list and selection, never from the mockup. */
export function relocationTabCounts(
  countries: readonly RelocationCountry[],
  selectedCountryCodes: readonly string[],
): RelocationTabCounts {
  return { countries: countries.length, comparison: selectedCountryCodes.length };
}

/** Preview of the list plus every country the candidate added by search. */
export function visibleRelocationCountries(
  countries: readonly RelocationCountry[],
  previewCount: number,
  pinnedCountryCodes: readonly string[],
): readonly RelocationCountry[] {
  const preview = countries.slice(0, previewCount);
  const pinned = countries.filter(
    ({ countryCode }) =>
      pinnedCountryCodes.includes(countryCode) &&
      !preview.some((item) => item.countryCode === countryCode),
  );
  return [...preview, ...pinned];
}

const STATUS_ORDER: Readonly<Record<CountryFitStatus, number>> = {
  available: 0,
  high_barriers: 1,
  legally_unavailable: 2,
  unknown: 3,
};

/** Mockup 15 order: open countries first, then barriers, closed, and unknown last; by name inside. */
export function sortRelocationCountries(
  countries: readonly RelocationCountry[],
  profile: RelocationQuestionnaire | null,
): readonly RelocationCountry[] {
  const rank = new Map(
    countries.map((country) => [
      country.countryCode,
      // The home market (a citizenship country) leads, as in the mockup.
      profile?.citizenshipDocuments.citizenshipCountryCodes.includes(country.countryCode)
        ? -2
        : documentOpens(country.countryCode, profile)
          ? -1
          : STATUS_ORDER[countryFitForQuestionnaire(country.countryCode, profile).status],
    ]),
  );
  return [...countries].sort(
    (left, right) =>
      (rank.get(left.countryCode) ?? 9) - (rank.get(right.countryCode) ?? 9) ||
      left.name.localeCompare(right.name, 'ru'),
  );
}

/** A country opened by the candidate's own permit follows the home market (B468-r3). */
function documentOpens(countryCode: string, profile: RelocationQuestionnaire | null): boolean {
  return Boolean(
    profile?.citizenshipDocuments.documents.some(
      (document) => document.countryCode === countryCode,
    ) && countryFitForQuestionnaire(countryCode, profile).status === 'available',
  );
}

import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type {
  CountryFitStatus,
  MobilityScenarioEvaluation,
  MobilityScenarioId,
  ScenarioAvailability,
} from '../../../shared/countryFit/types';
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

const SCENARIO_RANK: Readonly<Record<ScenarioAvailability, number>> = {
  available: 0,
  barriers: 1,
  unknown: 2,
  unavailable: 3,
};

/** Scenario names of mockup 15; the catalog's own label is the fallback. */
export const RELOCATION_SCENARIO_LABELS: Readonly<Partial<Record<MobilityScenarioId, string>>> = {
  domestic_market: 'Домашний рынок',
  employer_sponsorship: 'Переезд с визой',
  job_seeker_visa: 'Виза для поиска работы',
  digital_nomad: 'Digital Nomad',
  simple_mobility: 'Без визы, ЕАЭС',
};

/** Status words of mockup 15; a status never appears without the catalog rule behind it. */
export function relocationStatusLabel(status: CountryFitStatus | ScenarioAvailability): string {
  if (status === 'available') return 'Доступно без ограничений';
  if (status === 'barriers') return 'Есть условия';
  if (status === 'high_barriers') return 'Высокие барьеры';
  if (status === 'unavailable' || status === 'legally_unavailable') return 'Юридически недоступно';
  return 'Нужно уточнить';
}

/**
 * The scenario that leads a country card: an open one first, then a route
 * backed by an official source, then whatever the rules say.
 */
function leadingScenario(scenarios: readonly MobilityScenarioEvaluation[]) {
  const rank = (scenario: MobilityScenarioEvaluation) =>
    scenario.status === 'available' ? 0 : scenario.sources.length ? 1 : 2 + SCENARIO_RANK[scenario.status];
  return [...scenarios].sort((left, right) => rank(left) - rank(right))[0];
}

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
    scenarioLabel: lead ? (RELOCATION_SCENARIO_LABELS[lead.id] ?? lead.label) : 'Сценарий не определён',
    reason: lead?.reasons[0] ?? 'В правилах нет пояснения для вашего профиля.',
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
    ({ countryCode }) => pinnedCountryCodes.includes(countryCode) && !preview.some((item) => item.countryCode === countryCode),
  );
  return [...preview, ...pinned];
}

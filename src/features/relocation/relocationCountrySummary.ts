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

/** Routes that exist only by citizenship or residence: when not open, they are not a way in. */
const BIRTHRIGHT_SCENARIOS: ReadonlySet<MobilityScenarioId> = new Set([
  'domestic_market',
  'simple_mobility',
]);

/**
 * The scenario that leads a country card: the most open route the candidate
 * can take, and among equal routes the one backed by an official source. A
 * citizenship-only route that is not open (Spain is not EAEU for a Russian)
 * never leads while another route exists.
 */
function leadingScenario(scenarios: readonly MobilityScenarioEvaluation[]) {
  const rank = (scenario: MobilityScenarioEvaluation) => {
    const closed = scenario.status !== 'available' && BIRTHRIGHT_SCENARIOS.has(scenario.id);
    const base = closed ? SCENARIO_RANK.unavailable : SCENARIO_RANK[scenario.status];
    return base * 2 + (scenario.sources.length ? 0 : 1);
  };
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

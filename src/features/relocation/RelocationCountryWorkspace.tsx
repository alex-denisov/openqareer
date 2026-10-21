import { useMemo, useState } from 'react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { MobilityScenarioId } from '../../../shared/countryFit/types';
import { countryFitForQuestionnaire, listRelocationCountries } from './relocationCountryData';
import { RelocationCountryWorkspaceView } from './RelocationCountryWorkspaceParts';
import { sortRelocationCountries, visibleRelocationCountries } from './relocationCountrySummary';

type ScenarioFilter = 'all' | MobilityScenarioId;

const COUNTRY_PREVIEW_COUNT = 7;

export interface RelocationCountryWorkspaceProps {
  readonly profile: RelocationQuestionnaire | null;
  readonly selectedCountryCodes: readonly string[];
  readonly onSelectedCountryCodesChange: (codes: readonly string[]) => void;
  readonly pinnedCountryCodes?: readonly string[];
  readonly onCompare: () => void;
  readonly onAddCountry: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
  readonly onOpenProfile: () => void;
  readonly onOpenVacancies?: () => void;
}

export function RelocationCountryWorkspace(props: RelocationCountryWorkspaceProps) {
  const state = useCountryWorkspace(props.profile, props.selectedCountryCodes, props.onSelectedCountryCodesChange, props.pinnedCountryCodes ?? []);
  return (
    <RelocationCountryWorkspaceView
      {...state}
      onCompare={props.onCompare}
      onAddCountry={props.onAddCountry}
      onCalculateEconomy={props.onCalculateEconomy}
      onOpenProfile={props.onOpenProfile}
      onOpenVacancies={props.onOpenVacancies}
    />
  );
}

function useCountryWorkspace(
  profile: RelocationQuestionnaire | null,
  selectedCountryCodes: readonly string[],
  onSelectedCountryCodesChange: (codes: readonly string[]) => void,
  pinnedCountryCodes: readonly string[],
) {
  const [scenario, setScenario] = useState<ScenarioFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const [detailsCountry, setDetailsCountry] = useState<string>();
  const countries = useMemo(() => listRelocationCountries(), []);
  const filteredCountries = sortRelocationCountries(
    filterCountries(countries, profile, scenario),
    profile,
  );
  const visibleCountries = showAll
    ? filteredCountries
    : visibleRelocationCountries(filteredCountries, COUNTRY_PREVIEW_COUNT, pinnedCountryCodes);
  const details = countries.find(({ countryCode }) => countryCode === detailsCountry);
  const detailsFit = details ? countryFitForQuestionnaire(details.countryCode, profile) : undefined;
  return {
    profile,
    countries: visibleCountries,
    totalCountries: filteredCountries.length,
    scenario,
    showAll,
    details,
    detailsScenarios: detailsFit?.scenarios,
    detailsCountryCode: detailsCountry,
    selectedCountryCodes,
    onScenarioChange: setScenario,
    onShowAll: () => setShowAll(true),
    onCloseDetails: () => setDetailsCountry(undefined),
    onOpenDetails: setDetailsCountry,
    onToggleCompare: (countryCode: string) => onSelectedCountryCodesChange(toggleSelectedCountry(selectedCountryCodes, countryCode)),
  };
}

function filterCountries(
  countries: ReturnType<typeof listRelocationCountries>,
  profile: RelocationQuestionnaire | null,
  scenario: ScenarioFilter,
) {
  return countries.filter((country) => {
    // A scenario filter keeps only routes the rules actually settle for this profile.
    return scenario === 'all' || countryFitForQuestionnaire(country.countryCode, profile)
      .scenarios.some(({ id, status }) => id === scenario && status !== 'unknown');
  });
}

function toggleSelectedCountry(selected: readonly string[], countryCode: string): readonly string[] {
  if (selected.includes(countryCode)) return selected.filter((code) => code !== countryCode);
  return [...selected, countryCode].slice(0, 3);
}

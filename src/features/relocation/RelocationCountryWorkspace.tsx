import { useMemo, useState } from 'react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { MobilityScenarioId } from '../../../shared/countryFit/types';
import { countryFitForQuestionnaire, listRelocationCountries } from './relocationCountryData';
import { RelocationCountryWorkspaceView } from './RelocationCountryWorkspaceParts';

type ScenarioFilter = 'all' | MobilityScenarioId;

const COUNTRY_PREVIEW_COUNT = 7;

export interface RelocationCountryWorkspaceProps {
  readonly profile: RelocationQuestionnaire | null;
  readonly selectedCountryCodes: readonly string[];
  readonly onSelectedCountryCodesChange: (codes: readonly string[]) => void;
  readonly onCompare: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
  readonly onOpenProfile: () => void;
  readonly onOpenVacancies?: () => void;
}

export function RelocationCountryWorkspace(props: RelocationCountryWorkspaceProps) {
  const state = useCountryWorkspace(props.profile, props.selectedCountryCodes, props.onSelectedCountryCodesChange);
  return (
    <RelocationCountryWorkspaceView
      {...state}
      onCompare={props.onCompare}
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
) {
  const [scenario, setScenario] = useState<ScenarioFilter>('all');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsCountry, setDetailsCountry] = useState<string>();
  const countries = useMemo(() => listRelocationCountries(), []);
  const filteredCountries = filterCountries(countries, profile, scenario, query);
  const visibleCountries = showAll ? filteredCountries : filteredCountries.slice(0, COUNTRY_PREVIEW_COUNT);
  const details = countries.find(({ countryCode }) => countryCode === detailsCountry);
  const detailsFit = details ? countryFitForQuestionnaire(details.countryCode, profile) : undefined;
  const reset = () => { setScenario('all'); setQuery(''); setSearchOpen(false); setShowAll(false); };
  return {
    profile,
    countries: visibleCountries,
    totalCountries: filteredCountries.length,
    scenario,
    query,
    showAll,
    searchOpen,
    details,
    detailsScenarios: detailsFit?.scenarios,
    detailsCountryCode: detailsCountry,
    selectedCountryCodes,
    onScenarioChange: setScenario,
    onQueryChange: (value: string) => { setQuery(value); setShowAll(true); },
    onToggleSearch: () => setSearchOpen((current) => !current),
    onShowAll: () => setShowAll(true),
    onReset: reset,
    onCloseDetails: () => setDetailsCountry(undefined),
    onOpenDetails: setDetailsCountry,
    onToggleCompare: (countryCode: string) => onSelectedCountryCodesChange(toggleSelectedCountry(selectedCountryCodes, countryCode)),
  };
}

function filterCountries(
  countries: ReturnType<typeof listRelocationCountries>,
  profile: RelocationQuestionnaire | null,
  scenario: ScenarioFilter,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  return countries.filter((country) => {
    if (normalizedQuery && !country.name.toLocaleLowerCase('ru').includes(normalizedQuery)) return false;
    return scenario === 'all' || countryFitForQuestionnaire(country.countryCode, profile)
      .scenarios.some(({ id }) => id === scenario);
  });
}

function toggleSelectedCountry(selected: readonly string[], countryCode: string): readonly string[] {
  if (selected.includes(countryCode)) return selected.filter((code) => code !== countryCode);
  return [...selected, countryCode].slice(0, 3);
}

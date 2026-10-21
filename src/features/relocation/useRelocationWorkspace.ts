import { useMemo, useState } from 'react';
import type {
  RelocationAlert,
  RelocationQuestionnaire,
  RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireResponse } from './relocationApi';
import { buildCountryComparisonCountry, listRelocationCountries } from './relocationCountryData';
import { relocationTabCounts, summarizeRelocationCountry } from './relocationCountrySummary';
import type { RelocationProfileData } from './useRelocationSnapshot';
import { useSavedCountrySelection } from './useSavedCountrySelection';

export type RelocationTab = 'countries' | 'comparison' | 'economy' | 'profile';

/** What fills the screen under the header: tabs, the questionnaire or the country search. */
export type RelocationMode =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'questionnaire'; readonly step: RelocationStepId }
  | { readonly kind: 'add' };

export const RELOCATION_TAB_DESCRIPTIONS: Readonly<Record<RelocationTab, string>> = {
  countries:
    'Какие страны реально доступны вам по жизненным сценариям, без юридических тупиков. Подборка вакансий учитывает только отмеченные страны.',
  comparison:
    'Три страны рядом по объективным параметрам. Баллов и общего места нет: вес параметров вы определяете сами.',
  economy: 'Остаток после налогов по проверенной шкале страны. Нет шкалы — нет расчёта.',
  profile:
    'Все ваши данные для релокации в одном месте. Видите только вы. Изменение пересчитывает статусы стран.',
};

export interface RelocationWorkspaceInput {
  readonly snapshot: RelocationQuestionnaireResponse & { readonly profile: RelocationProfileData };
  readonly startInQuestionnaire: boolean;
  readonly onProfileUpdated?: (
    profile: RelocationQuestionnaire,
    alerts: readonly RelocationAlert[],
  ) => void;
}

export function useRelocationWorkspace({
  snapshot,
  startInQuestionnaire,
  onProfileUpdated,
}: RelocationWorkspaceInput) {
  const { tab, setTab, mode, setMode } = useWorkspaceView(snapshot.profile, startInQuestionnaire);
  const selection = useSavedCountrySelection(snapshot.profile, onProfileUpdated);
  const selectedCountryCodes = selection.selected;
  const [pinnedCountryCodes, setPinnedCountryCodes] = useState<readonly string[]>([]);
  const [economyCountryCode, setEconomyCountryCode] = useState('');
  const [grossAnnualIncome, setGrossAnnualIncome] = useState<number>();
  const countries = useMemo(() => listRelocationCountries(), []);
  const counts = relocationTabCounts(countries, selectedCountryCodes);
  const comparisonCountries = useComparisonCountries(
    snapshot.profile,
    selectedCountryCodes,
    economyCountryCode,
    grossAnnualIncome,
  );
  const comparisonMeanings = useComparisonMeanings(
    countries,
    selectedCountryCodes,
    snapshot.profile,
  );
  const showTab = (next: RelocationTab) => {
    setMode({ kind: 'tabs' });
    setTab(next);
  };
  return {
    tab,
    mode,
    counts,
    selectedCountryCodes,
    pinnedCountryCodes,
    economyCountryCode,
    grossAnnualIncome,
    comparisonCountries,
    comparisonMeanings,
    showTab,
    setSelectedCountryCodes: selection.change,
    selectionSave: selection.save,
    setEconomyCountryCode,
    setGrossAnnualIncome,
    openQuestionnaire: (step: RelocationStepId) => setMode({ kind: 'questionnaire', step }),
    openAddCountry: () => setMode({ kind: 'add' }),
    closeMode: () => setMode({ kind: 'tabs' }),
    pinCountry: (countryCode: string) =>
      setPinnedCountryCodes((current) => pin(current, countryCode)),
    calculateEconomy: (countryCode: string) => {
      setEconomyCountryCode(countryCode);
      showTab('economy');
    },
  };
}

export type RelocationWorkspaceState = ReturnType<typeof useRelocationWorkspace>;

function useWorkspaceView(profile: RelocationProfileData, startInQuestionnaire: boolean) {
  const [tab, setTab] = useState<RelocationTab>('countries');
  const [mode, setMode] = useState<RelocationMode>(() =>
    startInQuestionnaire
      ? { kind: 'questionnaire', step: firstOpenStep(profile) }
      : { kind: 'tabs' },
  );
  return { tab, setTab, mode, setMode };
}

function firstOpenStep(profile: RelocationProfileData): RelocationStepId {
  return profile.currentStep === 'summary' ? 'citizenship_documents' : profile.currentStep;
}

function useComparisonCountries(
  profile: RelocationProfileData,
  selectedCountryCodes: readonly string[],
  economyCountryCode: string,
  grossAnnualIncome: number | undefined,
) {
  return useMemo(
    () =>
      selectedCountryCodes.map((countryCode) =>
        buildCountryComparisonCountry(
          countryCode,
          profile,
          countryCode === economyCountryCode ? grossAnnualIncome : undefined,
        ),
      ),
    [economyCountryCode, grossAnnualIncome, selectedCountryCodes, profile],
  );
}

function pin(current: readonly string[], countryCode: string): readonly string[] {
  return current.includes(countryCode) ? current : [...current, countryCode];
}

function useComparisonMeanings(
  countries: ReturnType<typeof listRelocationCountries>,
  selectedCountryCodes: readonly string[],
  profile: RelocationProfileData,
) {
  return useMemo(
    () =>
      selectedCountryCodes
        .flatMap((code) => countries.filter(({ countryCode }) => countryCode === code))
        .map((country) => {
          const summary = summarizeRelocationCountry(country, profile);
          return {
            countryCode: country.countryCode,
            name: summary.name,
            text: `${summary.statusLabel}: ${summary.reason.charAt(0).toLowerCase()}${summary.reason.slice(1)}`,
          };
        }),
    [countries, selectedCountryCodes, profile],
  );
}

import { useMemo, useState } from 'react';
import type { RelocationStepId } from '../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireResponse } from './relocationApi';
import { buildCountryComparisonCountry, listRelocationCountries } from './relocationCountryData';
import { relocationTabCounts } from './relocationCountrySummary';
import type { RelocationProfileData } from './useRelocationSnapshot';

export type RelocationTab = 'countries' | 'comparison' | 'economy' | 'profile';

/** What fills the screen under the header: tabs, the questionnaire or the country search. */
export type RelocationMode =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'questionnaire'; readonly step: RelocationStepId }
  | { readonly kind: 'add' };

export const RELOCATION_TAB_DESCRIPTIONS: Readonly<Record<RelocationTab, string>> = {
  countries: 'Какие страны реально доступны вам по жизненным сценариям, без юридических тупиков.',
  comparison: 'Выбранные страны рядом по одним и тем же показателям, с источником и датой.',
  economy: 'Остаток после налогов по проверенной шкале страны. Нет шкалы — нет расчёта.',
  profile: 'Все ваши данные для релокации в одном месте. Видите только вы. Изменение пересчитывает статусы стран.',
};

export interface RelocationWorkspaceInput {
  readonly snapshot: RelocationQuestionnaireResponse & { readonly profile: RelocationProfileData };
  readonly startInQuestionnaire: boolean;
}

export function useRelocationWorkspace({ snapshot, startInQuestionnaire }: RelocationWorkspaceInput) {
  const [tab, setTab] = useState<RelocationTab>('countries');
  const [mode, setMode] = useState<RelocationMode>(() => startInQuestionnaire
    ? { kind: 'questionnaire', step: firstOpenStep(snapshot.profile) }
    : { kind: 'tabs' });
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<readonly string[]>([]);
  const [pinnedCountryCodes, setPinnedCountryCodes] = useState<readonly string[]>([]);
  const [economyCountryCode, setEconomyCountryCode] = useState('');
  const [grossAnnualIncome, setGrossAnnualIncome] = useState<number>();
  const countries = useMemo(() => listRelocationCountries(), []);
  const counts = relocationTabCounts(countries, selectedCountryCodes);
  const comparisonCountries = useMemo(
    () => selectedCountryCodes.map((countryCode) => buildCountryComparisonCountry(
      countryCode,
      snapshot.profile,
      countryCode === economyCountryCode ? grossAnnualIncome : undefined,
    )),
    [economyCountryCode, grossAnnualIncome, selectedCountryCodes, snapshot.profile],
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
    showTab,
    setSelectedCountryCodes,
    setEconomyCountryCode,
    setGrossAnnualIncome,
    openQuestionnaire: (step: RelocationStepId) => setMode({ kind: 'questionnaire', step }),
    openAddCountry: () => setMode({ kind: 'add' }),
    closeMode: () => setMode({ kind: 'tabs' }),
    pinCountry: (countryCode: string) => setPinnedCountryCodes((current) => (
      current.includes(countryCode) ? current : [...current, countryCode]
    )),
    calculateEconomy: (countryCode: string) => {
      setEconomyCountryCode(countryCode);
      showTab('economy');
    },
  };
}

export type RelocationWorkspaceState = ReturnType<typeof useRelocationWorkspace>;

function firstOpenStep(profile: RelocationProfileData): RelocationStepId {
  return profile.currentStep === 'summary' ? 'citizenship_documents' : profile.currentStep;
}

import { useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { MobilePush } from './RelocationMobilePush';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import { RelocationAddCountry } from './RelocationAddCountry';
import { RelocationMobileCountryList } from './RelocationMobileCountryList';
import { RelocationMobileCountry } from './RelocationMobileCountry';
import { RelocationEconomy } from './RelocationEconomy';
import { RelocationProfile } from './RelocationProfile';
import { RelocationQuestionnaire } from './RelocationQuestionnaire';
import type { RelocationWorkspaceProps } from './RelocationScreen';
import type { RelocationTab, RelocationWorkspaceState } from './useRelocationWorkspace';

type MobileProps = RelocationWorkspaceProps & { readonly workspace: RelocationWorkspaceState };

const MOBILE_TABS: readonly { readonly id: RelocationTab; readonly label: string }[] = [
  { id: 'countries', label: 'Страны' },
  { id: 'comparison', label: 'Сравнение' },
  { id: 'economy', label: 'Экономика' },
  { id: 'profile', label: 'Данные' },
];

/** Mockup 15 at 390: grouped lists, push screens for a country, the questionnaire and search. */
export function RelocationMobileWorkspace(props: MobileProps) {
  const { workspace } = props;
  const [countryCode, setCountryCode] = useState<string>();
  if (workspace.mode.kind !== 'tabs') return <MobileModeScreen {...props} />;
  if (countryCode) {
    return (
      <MobileCountryScreen
        {...props}
        countryCode={countryCode}
        onClose={() => setCountryCode(undefined)}
      />
    );
  }
  return (
    <MobilePush title="Страны и релокация" backLabel="Назад к ролям" onBack={props.onNavigateBack}>
      <MobileTabs workspace={workspace} />
      <MobileTabContent {...props} onOpenCountry={setCountryCode} />
    </MobilePush>
  );
}

function MobileTabs({ workspace }: { readonly workspace: RelocationWorkspaceState }) {
  return (
    <div className="career-relocation-segments" role="tablist" aria-label="Разделы релокации">
      {MOBILE_TABS.map(({ id, label }) => (
        <button
          key={id}
          id={`career-relocation-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={workspace.tab === id}
          onClick={() => workspace.showTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MobileTabContent(
  props: MobileProps & { readonly onOpenCountry: (countryCode: string) => void },
) {
  const { workspace } = props;
  const { snapshot } = props.input;
  if (workspace.tab === 'countries') {
    return (
      <RelocationMobileCountryList
        profile={snapshot.profile}
        workspace={workspace}
        onOpenCountry={props.onOpenCountry}
      />
    );
  }
  if (workspace.tab === 'comparison') return <MobileComparison {...props} />;
  if (workspace.tab === 'economy') {
    return (
      <RelocationEconomy
        profile={snapshot.profile}
        selectedCountryCodes={workspace.selectedCountryCodes}
        selectedCountryCode={workspace.economyCountryCode}
        grossAnnualIncome={workspace.grossAnnualIncome}
        onCountryCodeChange={workspace.setEconomyCountryCode}
        onGrossAnnualIncomeChange={workspace.setGrossAnnualIncome}
        onShowComparison={() => workspace.showTab('comparison')}
      />
    );
  }
  return (
    <RelocationProfile
      mobile
      profile={snapshot.profile}
      consent={snapshot.consent}
      alerts={snapshot.alerts}
      onProfileUpdated={props.onProfileUpdated}
      onConsentRevoked={props.onConsentRevoked}
      onShowCountries={() => workspace.showTab('countries')}
    />
  );
}

function toggle(selected: readonly string[], countryCode: string): readonly string[] {
  if (selected.includes(countryCode)) return selected.filter((code) => code !== countryCode);
  return [...selected, countryCode].slice(0, 3);
}

function MobileModeScreen(props: MobileProps) {
  const { workspace } = props;
  const profile = props.input.snapshot.profile;
  if (workspace.mode.kind === 'questionnaire') {
    return (
      <div className="career-relocation career-relocation-mobile">
        <RelocationQuestionnaire
          mobile
          profile={profile}
          initialStep={workspace.mode.step}
          onClose={() => workspace.showTab('profile')}
          onShowCountries={() => workspace.showTab('countries')}
          onProfileUpdated={props.onProfileUpdated}
        />
      </div>
    );
  }
  return (
    <MobilePush title="Добавить страну" onBack={workspace.closeMode}>
      <RelocationAddCountry
        profile={profile}
        pinnedCountryCodes={workspace.pinnedCountryCodes}
        onAdd={workspace.pinCountry}
        onDone={workspace.closeMode}
      />
    </MobilePush>
  );
}

function MobileCountryScreen({
  workspace,
  input,
  countryCode,
  onClose,
  onOpenVacancies,
}: MobileProps & { readonly countryCode: string; readonly onClose: () => void }) {
  const profile = input.snapshot.profile;
  return (
    <RelocationMobileCountry
      countryCode={countryCode}
      profile={profile}
      selected={workspace.selectedCountryCodes.includes(countryCode)}
      compareDisabled={
        !workspace.selectedCountryCodes.includes(countryCode) &&
        workspace.selectedCountryCodes.length >= 3
      }
      onBack={() => onClose()}
      onToggleCompare={() =>
        workspace.setSelectedCountryCodes(toggle(workspace.selectedCountryCodes, countryCode))
      }
      onCompare={() => {
        onClose();
        workspace.showTab('comparison');
      }}
      onCalculateEconomy={() => {
        onClose();
        workspace.calculateEconomy(countryCode);
      }}
      onOpenVacancies={onOpenVacancies}
    />
  );
}

function MobileComparison({ workspace, onOpenExpert }: MobileProps) {
  const props = { onOpenExpert };
  return (
    <div className="career-relocation-mobile-section">
      <CountryComparisonPanel countries={workspace.comparisonCountries} />
      {props.onOpenExpert ? (
        <button
          className="career-btn career-btn-secondary"
          type="button"
          onClick={props.onOpenExpert}
        >
          Обсудить с консультантом
        </button>
      ) : null}
      <button
        className="career-btn career-btn-primary"
        type="button"
        onClick={() => workspace.showTab('economy')}
      >
        <ArrowRight aria-hidden="true" size={17} />
        Посчитать экономику
      </button>
    </div>
  );
}

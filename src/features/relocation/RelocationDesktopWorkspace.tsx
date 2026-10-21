import type { KeyboardEvent } from 'react';
import { ArrowRight, ChatCircle } from '@phosphor-icons/react';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import { RelocationAddCountry } from './RelocationAddCountry';
import { RelocationCountryWorkspace } from './RelocationCountryWorkspace';
import { RelocationEconomy } from './RelocationEconomy';
import { RelocationHeaderCard } from './RelocationHeaderCard';
import { RelocationProfile } from './RelocationProfile';
import { RelocationQuestionnaire } from './RelocationQuestionnaire';
import type { RelocationWorkspaceProps } from './RelocationScreen';
import {
  RELOCATION_TAB_DESCRIPTIONS,
  type RelocationTab,
  type RelocationWorkspaceState,
} from './useRelocationWorkspace';

type DesktopProps = RelocationWorkspaceProps & { readonly workspace: RelocationWorkspaceState };

export function RelocationDesktopWorkspace(props: DesktopProps) {
  const { workspace } = props;
  const profile = props.input.snapshot.profile;
  if (workspace.mode.kind === 'questionnaire') {
    return (
      <RelocationQuestionnaire
        profile={profile}
        initialStep={workspace.mode.step}
        onClose={() => workspace.showTab('profile')}
        onShowCountries={() => workspace.showTab('countries')}
        onProfileUpdated={props.onProfileUpdated}
      />
    );
  }
  return (
    <div className="career-relocation" role="region" aria-labelledby="career-relocation-title">
      <RelocationHeaderCard
        title="Страны и релокация"
        status="on"
        description={RELOCATION_TAB_DESCRIPTIONS[workspace.tab]}
        backLabel="Назад к ролям"
        onBack={props.onNavigateBack}
      >
        <RelocationTabs workspace={workspace} />
      </RelocationHeaderCard>
      <section
        id="career-relocation-panel"
        className="career-relocation-panel"
        role="tabpanel"
        aria-labelledby={`career-relocation-tab-${workspace.tab}`}
      >
        {workspace.mode.kind === 'add' ? (
          <RelocationAddCountry
            profile={profile}
            pinnedCountryCodes={workspace.pinnedCountryCodes}
            onAdd={workspace.pinCountry}
            onDone={workspace.closeMode}
          />
        ) : (
          <DesktopTabContent {...props} />
        )}
      </section>
    </div>
  );
}

function DesktopTabContent({
  workspace,
  input,
  onOpenExpert,
  onOpenVacancies,
  onProfileUpdated,
  onConsentRevoked,
}: DesktopProps) {
  const { snapshot } = input;
  if (workspace.tab === 'countries') {
    return (
      <RelocationCountryWorkspace
        profile={snapshot.profile}
        selectedCountryCodes={workspace.selectedCountryCodes}
        pinnedCountryCodes={workspace.pinnedCountryCodes}
        onSelectedCountryCodesChange={workspace.setSelectedCountryCodes}
        onCompare={() => workspace.showTab('comparison')}
        onAddCountry={workspace.openAddCountry}
        onCalculateEconomy={workspace.calculateEconomy}
        onOpenProfile={() => workspace.openQuestionnaire('citizenship_documents')}
        onOpenVacancies={onOpenVacancies}
      />
    );
  }
  if (workspace.tab === 'comparison')
    return <DesktopComparison workspace={workspace} onOpenExpert={onOpenExpert} />;
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
      profile={snapshot.profile}
      consent={snapshot.consent}
      alerts={snapshot.alerts}
      onProfileUpdated={onProfileUpdated}
      onConsentRevoked={onConsentRevoked}
      onShowCountries={() => workspace.showTab('countries')}
    />
  );
}

function DesktopComparison({
  workspace,
  onOpenExpert,
}: {
  readonly workspace: RelocationWorkspaceState;
  readonly onOpenExpert?: () => void;
}) {
  return (
    <div className="career-relocation-card career-relocation-comparison-view">
      <CountryComparisonPanel countries={workspace.comparisonCountries} />
      <div className="career-relocation-footer-actions">
        <button
          className="career-btn career-btn-primary"
          type="button"
          onClick={() => workspace.showTab('economy')}
        >
          <ArrowRight aria-hidden="true" size={17} />
          Посчитать экономику
        </button>
        <button
          className="career-btn career-btn-secondary"
          type="button"
          onClick={() => workspace.showTab('countries')}
        >
          Изменить страны
        </button>
        {onOpenExpert ? (
          <button className="career-relocation-text-action" type="button" onClick={onOpenExpert}>
            <ChatCircle aria-hidden="true" size={17} />
            Обсудить с консультантом
          </button>
        ) : null}
      </div>
    </div>
  );
}

const TABS: readonly { readonly id: RelocationTab; readonly label: string }[] = [
  { id: 'countries', label: 'Страны' },
  { id: 'comparison', label: 'Сравнение' },
  { id: 'economy', label: 'Экономика' },
  { id: 'profile', label: 'Мои данные' },
];

export function relocationTabCount(
  tab: RelocationTab,
  counts: RelocationWorkspaceState['counts'],
): number | undefined {
  if (tab === 'countries') return counts.countries;
  if (tab === 'comparison') return counts.comparison;
  return undefined;
}

function RelocationTabs({ workspace }: { readonly workspace: RelocationWorkspaceState }) {
  const active = workspace.mode.kind === 'tabs' ? workspace.tab : undefined;
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = TABS.findIndex(({ id }) => id === workspace.tab);
    const nextIndex = nextTabIndex(event.key, currentIndex);
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    workspace.showTab(nextTab.id);
    document.getElementById(`career-relocation-tab-${nextTab.id}`)?.focus();
  }
  return (
    <div className="career-relocation-tabs" role="tablist" aria-label="Разделы релокации">
      {TABS.map(({ id, label }) => {
        const count = relocationTabCount(id, workspace.counts);
        return (
          <button
            id={`career-relocation-tab-${id}`}
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            aria-controls="career-relocation-panel"
            tabIndex={workspace.tab === id ? 0 : -1}
            onClick={() => workspace.showTab(id)}
            onKeyDown={handleKeyDown}
          >
            {label}
            {count === undefined ? null : (
              <span className="career-relocation-tab-count"> {count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function nextTabIndex(key: string, currentIndex: number): number {
  if (key === 'ArrowRight') return (currentIndex + 1) % TABS.length;
  if (key === 'ArrowLeft') return (currentIndex - 1 + TABS.length) % TABS.length;
  if (key === 'Home') return 0;
  if (key === 'End') return TABS.length - 1;
  return currentIndex;
}

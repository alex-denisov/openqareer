import { useMemo, useState } from 'react';
import { ArrowRight, CaretRight, Plus, SlidersHorizontal } from '@phosphor-icons/react';
import { MobilePush } from './RelocationMobilePush';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import { RelocationAddCountry } from './RelocationAddCountry';
import { RelocationMobileCountry } from './RelocationMobileCountry';
import { RelocationEconomy } from './RelocationEconomy';
import { RelocationProfile } from './RelocationProfile';
import { RelocationQuestionnaire } from './RelocationQuestionnaire';
import type { RelocationWorkspaceProps } from './RelocationScreen';
import { countryFitForQuestionnaire, listRelocationCountries } from './relocationCountryData';
import { summarizeRelocationCountry, visibleRelocationCountries } from './relocationCountrySummary';
import { RelocationScenarioSheet, type RelocationScenarioFilter } from './RelocationScenarioSheet';
import type { RelocationTab, RelocationWorkspaceState } from './useRelocationWorkspace';

type MobileProps = RelocationWorkspaceProps & { readonly workspace: RelocationWorkspaceState };

const PREVIEW_COUNT = 7;
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
  const profile = props.input.snapshot.profile;
  if (workspace.mode.kind === 'questionnaire') {
    return (
      <MobilePush title="Анкета" onBack={() => workspace.showTab('profile')}>
        <RelocationQuestionnaire
          mobile
          profile={profile}
          initialStep={workspace.mode.step}
          onClose={() => workspace.showTab('profile')}
          onShowCountries={() => workspace.showTab('countries')}
          onProfileUpdated={props.onProfileUpdated}
        />
      </MobilePush>
    );
  }
  if (workspace.mode.kind === 'add') {
    return (
      <MobilePush title="Добавить страну" onBack={workspace.closeMode}>
        <RelocationAddCountry profile={profile} pinnedCountryCodes={workspace.pinnedCountryCodes} onAdd={workspace.pinCountry} onDone={workspace.closeMode} />
      </MobilePush>
    );
  }
  if (countryCode) {
    return (
      <RelocationMobileCountry
        countryCode={countryCode}
        profile={profile}
        selected={workspace.selectedCountryCodes.includes(countryCode)}
        compareDisabled={!workspace.selectedCountryCodes.includes(countryCode) && workspace.selectedCountryCodes.length >= 3}
        onBack={() => setCountryCode(undefined)}
        onToggleCompare={() => workspace.setSelectedCountryCodes(toggle(workspace.selectedCountryCodes, countryCode))}
        onCompare={() => { setCountryCode(undefined); workspace.showTab('comparison'); }}
        onCalculateEconomy={() => { setCountryCode(undefined); workspace.calculateEconomy(countryCode); }}
        onOpenVacancies={props.onOpenVacancies}
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
        <button key={id} id={`career-relocation-tab-${id}`} type="button" role="tab" aria-selected={workspace.tab === id} onClick={() => workspace.showTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function MobileTabContent(props: MobileProps & { readonly onOpenCountry: (countryCode: string) => void }) {
  const { workspace } = props;
  const { snapshot } = props.input;
  if (workspace.tab === 'countries') return <MobileCountryList {...props} />;
  if (workspace.tab === 'comparison') {
    return (
      <div className="career-relocation-mobile-section">
        <CountryComparisonPanel countries={workspace.comparisonCountries} />
        {props.onOpenExpert ? <button className="career-btn career-btn-secondary" type="button" onClick={props.onOpenExpert}>Обсудить с консультантом</button> : null}
        <button className="career-btn career-btn-primary" type="button" onClick={() => workspace.showTab('economy')}>
          <ArrowRight aria-hidden="true" size={17} />Посчитать экономику
        </button>
      </div>
    );
  }
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
      onProfileUpdated={props.onProfileUpdated}
      onConsentRevoked={props.onConsentRevoked}
      onShowCountries={() => workspace.showTab('countries')}
    />
  );
}

function MobileCountryList({ workspace, input, onOpenCountry }: MobileProps & { readonly onOpenCountry: (countryCode: string) => void }) {
  const profile = input.snapshot.profile;
  const [scenario, setScenario] = useState<RelocationScenarioFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const countries = useMemo(() => listRelocationCountries(), []);
  const filtered = countries.filter((country) => scenario === 'all' || countryFitForQuestionnaire(country.countryCode, profile)
    .scenarios.some(({ id, status }) => id === scenario && status !== 'unknown'));
  const visible = showAll ? filtered : visibleRelocationCountries(filtered, PREVIEW_COUNT, workspace.pinnedCountryCodes);
  return (
    <div className="career-relocation-mobile-section">
      <button className="career-relocation-text-action" type="button" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
        <SlidersHorizontal aria-hidden="true" size={17} />Сценарий{scenario === 'all' ? '' : ': выбран'}
      </button>
      {visible.length ? (
        <ul className="career-relocation-group-list">
          {visible.map((country) => {
            const summary = summarizeRelocationCountry(country, profile);
            return (
              <li key={country.countryCode}>
                <button type="button" onClick={() => onOpenCountry(country.countryCode)}>
                  <span><strong>{summary.name}</strong><span>{summary.scenarioLabel}</span></span>
                  <span className={`career-relocation-mobile-status is-${summary.status}`}>{summary.statusLabel}</span>
                  <CaretRight aria-hidden="true" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="career-relocation-empty" role="status">Стран с таким сценарием нет.</p>}
      <ul className="career-relocation-group-list">
        <li><button type="button" onClick={workspace.openAddCountry}><span><Plus aria-hidden="true" size={16} /> Добавить страну</span><CaretRight aria-hidden="true" size={16} /></button></li>
        {!showAll && filtered.length > visible.length ? (
          <li><button type="button" onClick={() => setShowAll(true)}><span>Показать все {filtered.length}</span><CaretRight aria-hidden="true" size={16} /></button></li>
        ) : null}
      </ul>
      <p className="career-relocation-muted">Для сравнения выбрано {workspace.selectedCountryCodes.length} из 3: откройте страну и нажмите «В сравнение».</p>
      <button className="career-btn career-btn-primary" type="button" disabled={workspace.selectedCountryCodes.length < 2} onClick={() => workspace.showTab('comparison')}>
        <ArrowRight aria-hidden="true" size={17} />Сравнить страны
      </button>
      {sheetOpen ? <RelocationScenarioSheet value={scenario} onChange={setScenario} onClose={() => setSheetOpen(false)} /> : null}
    </div>
  );
}

function toggle(selected: readonly string[], countryCode: string): readonly string[] {
  if (selected.includes(countryCode)) return selected.filter((code) => code !== countryCode);
  return [...selected, countryCode].slice(0, 3);
}

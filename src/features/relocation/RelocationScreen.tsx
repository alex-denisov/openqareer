import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { ArrowRight, CaretLeft, LockKey, WarningCircle } from '@phosphor-icons/react';
import { apiErrorMessage } from '../coach/apiClient';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { buildCountryComparisonCountry, listRelocationCountries } from './relocationCountryData';
import { getRelocationQuestionnaire, type RelocationQuestionnaireResponse } from './relocationApi';
import { RelocationCountryWorkspace } from './RelocationCountryWorkspace';
import { RelocationEconomy } from './RelocationEconomy';
import { RelocationProfile } from './RelocationProfile';
import './RelocationScreen.css';
import './RelocationForms.css';

type RelocationTab = 'countries' | 'comparison' | 'economy' | 'profile';

const TABS: readonly { readonly id: RelocationTab; readonly label: string }[] = [
  { id: 'countries', label: 'Страны' },
  { id: 'comparison', label: 'Сравнение' },
  { id: 'economy', label: 'Экономика' },
  { id: 'profile', label: 'Мои данные' },
];

export interface RelocationScreenProps {
  readonly onNavigateBack: () => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenVacancies?: () => void;
}

export function RelocationScreen({
  onNavigateBack,
  onOpenExpert,
  onOpenVacancies,
}: RelocationScreenProps) {
  const state = useRelocationSnapshot();
  if (state.loading) return <ScreenState busy message="Загружаем сведения о странах и согласии…" />;
  if (state.error) return <ScreenState message={state.error} onRetry={() => void state.reload()} />;
  if (!state.snapshot?.consent.granted) {
    return (
      <ConsentGate
        consentStatus={state.snapshot?.consent.status === 'revoked' ? 'revoked' : 'not_granted'}
        consentTextStatus={state.snapshot?.consentTextStatus ?? 'pending_dpo_review'}
        onNavigateBack={onNavigateBack}
      />
    );
  }
  const snapshot = { ...state.snapshot, profile: state.snapshot.profile ?? emptyRelocationQuestionnaire() };
  return (
    <RelocationWorkspace
      snapshot={snapshot}
      onNavigateBack={onNavigateBack}
      onOpenExpert={onOpenExpert}
      onOpenVacancies={onOpenVacancies}
      onProfileUpdated={state.updateProfile}
      onConsentRevoked={state.updateConsent}
    />
  );
}

function useRelocationSnapshot() {
  const [snapshot, setSnapshot] = useState<RelocationQuestionnaireResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    try {
      setSnapshot(await getRelocationQuestionnaire(signal));
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось загрузить данные о релокации. Повторите запрос.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const updateProfile = useCallback((
    profile: NonNullable<RelocationQuestionnaireResponse['profile']>,
    alerts: RelocationQuestionnaireResponse['alerts'] = [],
  ) => {
    setSnapshot((current) => current ? { ...current, profile, alerts } : current);
  }, []);
  const updateConsent = useCallback((consent: RelocationQuestionnaireResponse['consent']) => {
    setSnapshot((current) => current ? { ...current, consent, profile: null } : current);
  }, []);
  return { snapshot, error, loading, reload, updateProfile, updateConsent };
}

function RelocationWorkspace({
  snapshot,
  onNavigateBack,
  onOpenExpert,
  onOpenVacancies,
  onProfileUpdated,
  onConsentRevoked,
}: RelocationScreenProps & {
  readonly snapshot: RelocationQuestionnaireResponse & { readonly profile: NonNullable<RelocationQuestionnaireResponse['profile']> };
  readonly onProfileUpdated: (profile: NonNullable<RelocationQuestionnaireResponse['profile']>, alerts?: RelocationQuestionnaireResponse['alerts']) => void;
  readonly onConsentRevoked: (consent: RelocationQuestionnaireResponse['consent']) => void;
}) {
  const [tab, setTab] = useState<RelocationTab>('countries');
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<readonly string[]>([]);
  const [economyCountryCode, setEconomyCountryCode] = useState('');
  const [grossAnnualIncome, setGrossAnnualIncome] = useState<number>();
  const countryCount = useMemo(() => listRelocationCountries().length, []);
  const comparisonCountries = useMemo(
    () => selectedCountryCodes.map((countryCode) => buildCountryComparisonCountry(
      countryCode,
      snapshot.profile,
      countryCode === economyCountryCode ? grossAnnualIncome : undefined,
    )),
    [economyCountryCode, grossAnnualIncome, selectedCountryCodes, snapshot.profile],
  );

  return (
    <main className="career-relocation" aria-labelledby="career-relocation-title">
      <RelocationHeader onNavigateBack={onNavigateBack} />
      <RelocationTabs activeTab={tab} onChange={setTab} countryCount={countryCount} selectedCount={selectedCountryCodes.length} />
      <RelocationTabPanel
        tab={tab}
        snapshot={snapshot}
        comparisonCountries={comparisonCountries}
        selectedCountryCodes={selectedCountryCodes}
        grossAnnualIncome={grossAnnualIncome}
        economyCountryCode={economyCountryCode}
        onSelectedCountryCodesChange={setSelectedCountryCodes}
        onGrossAnnualIncomeChange={setGrossAnnualIncome}
        onEconomyCountryCodeChange={setEconomyCountryCode}
        onTabChange={setTab}
        onOpenExpert={onOpenExpert}
        onOpenVacancies={onOpenVacancies}
        onProfileUpdated={onProfileUpdated}
        onConsentRevoked={onConsentRevoked}
      />
    </main>
  );
}

function RelocationHeader({ onNavigateBack }: { readonly onNavigateBack: () => void }) {
  return (
    <header className="career-relocation-header">
      <button className="career-relocation-back" type="button" aria-label="Назад" onClick={onNavigateBack}>
        <CaretLeft aria-hidden="true" size={20} />
      </button>
      <div className="career-relocation-title-row">
        <h1 id="career-relocation-title">Страны и релокация</h1>
        <span className="career-relocation-status is-enabled">Включено</span>
      </div>
      <p>Правила и расчёты опираются на ваши данные и проверяемые источники.</p>
    </header>
  );
}

interface RelocationTabPanelProps {
  readonly tab: RelocationTab;
  readonly snapshot: RelocationQuestionnaireResponse & { readonly profile: NonNullable<RelocationQuestionnaireResponse['profile']> };
  readonly comparisonCountries: ReturnType<typeof buildCountryComparisonCountry>[];
  readonly selectedCountryCodes: readonly string[];
  readonly grossAnnualIncome: number | undefined;
  readonly economyCountryCode: string;
  readonly onSelectedCountryCodesChange: (codes: readonly string[]) => void;
  readonly onGrossAnnualIncomeChange: (amount: number | undefined) => void;
  readonly onEconomyCountryCodeChange: (countryCode: string) => void;
  readonly onTabChange: (tab: RelocationTab) => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenVacancies?: () => void;
  readonly onProfileUpdated: (profile: NonNullable<RelocationQuestionnaireResponse['profile']>, alerts?: RelocationQuestionnaireResponse['alerts']) => void;
  readonly onConsentRevoked: (consent: RelocationQuestionnaireResponse['consent']) => void;
}

function RelocationTabPanel(props: RelocationTabPanelProps) {
  const { tab } = props;
  return (
    <section
      id="career-relocation-panel"
      className="career-relocation-panel"
      role="tabpanel"
      aria-labelledby={`career-relocation-tab-${tab}`}
      tabIndex={0}
    >
      <RelocationTabContent {...props} />
    </section>
  );
}

function RelocationTabContent({
  tab,
  snapshot,
  comparisonCountries,
  selectedCountryCodes,
  grossAnnualIncome,
  economyCountryCode,
  onSelectedCountryCodesChange,
  onGrossAnnualIncomeChange,
  onEconomyCountryCodeChange,
  onTabChange,
  onOpenExpert,
  onOpenVacancies,
  onProfileUpdated,
  onConsentRevoked,
}: RelocationTabPanelProps) {
  if (tab === 'countries') return <CountriesTab profile={snapshot.profile} selectedCountryCodes={selectedCountryCodes} onSelectedCountryCodesChange={onSelectedCountryCodesChange} onCompare={() => onTabChange('comparison')} onCalculateEconomy={(countryCode) => { onEconomyCountryCodeChange(countryCode); onTabChange('economy'); }} onOpenProfile={() => onTabChange('profile')} onOpenVacancies={onOpenVacancies} />;
  if (tab === 'comparison') return <ComparisonTab countries={comparisonCountries} onChangeCountries={() => onTabChange('countries')} onOpenExpert={onOpenExpert} />;
  if (tab === 'economy') return <RelocationEconomy profile={snapshot.profile} selectedCountryCodes={selectedCountryCodes} selectedCountryCode={economyCountryCode} grossAnnualIncome={grossAnnualIncome} onCountryCodeChange={onEconomyCountryCodeChange} onGrossAnnualIncomeChange={onGrossAnnualIncomeChange} onShowComparison={() => onTabChange('comparison')} />;
  return <RelocationProfile profile={snapshot.profile} consent={snapshot.consent} alerts={snapshot.alerts} onProfileUpdated={onProfileUpdated} onConsentRevoked={onConsentRevoked} onShowCountries={() => onTabChange('countries')} />;
}

function CountriesTab({
  profile,
  selectedCountryCodes,
  onSelectedCountryCodesChange,
  onCompare,
  onCalculateEconomy,
  onOpenProfile,
  onOpenVacancies,
}: {
  readonly profile: NonNullable<RelocationQuestionnaireResponse['profile']>;
  readonly selectedCountryCodes: readonly string[];
  readonly onSelectedCountryCodesChange: (codes: readonly string[]) => void;
  readonly onCompare: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
  readonly onOpenProfile: () => void;
  readonly onOpenVacancies?: () => void;
}) {
  return <RelocationCountryWorkspace profile={profile} selectedCountryCodes={selectedCountryCodes} onSelectedCountryCodesChange={onSelectedCountryCodesChange} onCompare={onCompare} onCalculateEconomy={onCalculateEconomy} onOpenProfile={onOpenProfile} onOpenVacancies={onOpenVacancies} />;
}

function ComparisonTab({
  countries,
  onChangeCountries,
  onOpenExpert,
}: {
  readonly countries: ReturnType<typeof buildCountryComparisonCountry>[];
  readonly onChangeCountries: () => void;
  readonly onOpenExpert?: () => void;
}) {
  return (
    <div className="career-relocation-comparison-view">
      <CountryComparisonPanel countries={countries} />
      <button className="career-btn career-btn-secondary" type="button" onClick={onChangeCountries}>Изменить страны</button>
      {onOpenExpert ? (
        <button className="career-btn career-btn-secondary" type="button" onClick={onOpenExpert}>
          Обсудить с консультантом
        </button>
      ) : null}
    </div>
  );
}

function RelocationTabs({
  activeTab,
  onChange,
  countryCount,
  selectedCount,
}: {
  readonly activeTab: RelocationTab;
  readonly onChange: (tab: RelocationTab) => void;
  readonly countryCount: number;
  readonly selectedCount: number;
}) {
  const tabs = TABS.map((tab) => ({
    ...tab,
    label: tab.id === 'countries'
      ? `Страны ${countryCount}`
      : tab.id === 'comparison' ? `Сравнение ${selectedCount}` : tab.label,
  }));
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.findIndex(({ id }) => id === activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab.id);
    document.getElementById(`career-relocation-tab-${nextTab.id}`)?.focus();
  }

  return (
    <div className="career-relocation-tabs" role="tablist" aria-label="Разделы релокации">
      {tabs.map(({ id, label }) => (
        <button
          id={`career-relocation-tab-${id}`}
          key={id}
          type="button"
          role="tab"
          aria-selected={activeTab === id}
          aria-controls="career-relocation-panel"
          tabIndex={activeTab === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={handleKeyDown}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ConsentGate({
  consentStatus,
  consentTextStatus,
  onNavigateBack,
}: {
  readonly consentStatus: 'not_granted' | 'revoked';
  readonly consentTextStatus: 'pending_dpo_review';
  readonly onNavigateBack: () => void;
}) {
  const revoked = consentStatus === 'revoked';
  return (
    <main className="career-relocation career-relocation-off" aria-labelledby="career-relocation-title">
      <header className="career-relocation-header">
        <button className="career-relocation-back" type="button" aria-label="Назад" onClick={onNavigateBack}>
          <CaretLeft aria-hidden="true" size={20} />
        </button>
        <div className="career-relocation-title-row">
          <h1 id="career-relocation-title">Страны и релокация</h1>
          <span className="career-relocation-status">Не включено</span>
        </div>
        <p>Сейчас подборка идёт только по России.</p>
      </header>
      <section className="career-relocation-consent" aria-labelledby="career-relocation-consent-title">
        <h2 id="career-relocation-consent-title">{revoked ? 'Согласие отозвано' : 'Что появится после включения'}</h2>
        <ConsentGateDetails revoked={revoked} />
        <RelocationPrivacyNote />
        {!revoked ? <ConsentPendingControl consentTextStatus={consentTextStatus} /> : null}
      </section>
    </main>
  );
}

function ConsentGateDetails({ revoked }: { readonly revoked: boolean }) {
  if (revoked) return <p role="status">Согласие отозвано. Данные анкеты удалены.</p>;
  return (
    <ul>
      <li><strong>Доступность стран</strong><span>По гражданству, документам и подтверждённым фактам профиля.</span></li>
      <li><strong>Вакансии с релокацией</strong><span>Из вашего подбора, с указанием источника и периода.</span></li>
      <li><strong>Сравнение и экономика</strong><span>Только по сопоставимым показателям с доступными данными.</span></li>
    </ul>
  );
}

function RelocationPrivacyNote() {
  return (
    <p className="career-relocation-privacy-note">
      <LockKey aria-hidden="true" size={17} />
      <span>Гражданство, документы, образование и семья видны только вам. Их хранение требует отдельного согласия.</span>
    </p>
  );
}

function ConsentPendingControl({ consentTextStatus }: { readonly consentTextStatus: 'pending_dpo_review' }) {
  const message = consentTextStatus === 'pending_dpo_review'
    ? 'Заполнение станет доступно после утверждения текста согласия.'
    : '';
  return (
    <fieldset className="career-relocation-consent-control" disabled>
      <label>
        <input type="checkbox" checked={false} readOnly />
        <span>Текст согласия ожидает проверки и пока не может быть принят.</span>
      </label>
      <button className="career-btn career-btn-primary" type="button" disabled>
        <ArrowRight aria-hidden="true" size={17} />
        Заполнить анкету
      </button>
      <p>{message}</p>
    </fieldset>
  );
}

function ScreenState({
  busy,
  message,
  onRetry,
}: {
  readonly busy?: boolean;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  const Tag = busy ? 'div' : 'section';
  return (
    <Tag className="career-relocation-state" aria-busy={busy} role={busy ? 'status' : 'alert'}>
      <p>{busy ? null : <WarningCircle aria-hidden="true" size={18} />}{message}</p>
      {onRetry ? (
        <button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>
          Повторить загрузку
        </button>
      ) : null}
    </Tag>
  );
}

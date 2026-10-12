import { ArrowRight, Briefcase, Plus, X } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { MobilityScenarioEvaluation, MobilityScenarioId } from '../../../shared/countryFit/types';
import type { RelocationCountry } from './relocationCountryData';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import { buildCountryComparisonCountry, countryFitForQuestionnaire } from './relocationCountryData';

type ScenarioFilter = 'all' | MobilityScenarioId;

const SCENARIOS: readonly { readonly id: ScenarioFilter; readonly label: string }[] = [
  { id: 'all', label: 'Все сценарии' },
  { id: 'domestic_market', label: 'Домашний рынок' },
  { id: 'employer_sponsorship', label: 'Переезд с визой' },
  { id: 'digital_nomad', label: 'Digital Nomad' },
  { id: 'simple_mobility', label: 'Без визы, ЕАЭС' },
];

export interface RelocationCountryWorkspaceViewProps {
  readonly profile: RelocationQuestionnaire | null;
  readonly countries: readonly RelocationCountry[];
  readonly totalCountries: number;
  readonly scenario: ScenarioFilter;
  readonly query: string;
  readonly showAll: boolean;
  readonly searchOpen: boolean;
  readonly details?: RelocationCountry;
  readonly detailsScenarios?: readonly MobilityScenarioEvaluation[];
  readonly detailsCountryCode?: string;
  readonly selectedCountryCodes: readonly string[];
  readonly onScenarioChange: (scenario: ScenarioFilter) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onToggleSearch: () => void;
  readonly onShowAll: () => void;
  readonly onReset: () => void;
  readonly onCloseDetails: () => void;
  readonly onOpenDetails: (countryCode: string) => void;
  readonly onToggleCompare: (countryCode: string) => void;
  readonly onCompare: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
  readonly onOpenProfile: () => void;
  readonly onOpenVacancies?: () => void;
}

export function RelocationCountryWorkspaceView(props: RelocationCountryWorkspaceViewProps) {
  return (
    <section className="career-relocation-countries" aria-labelledby="career-relocation-countries-title">
      <CountryWorkspaceHeader
        scenario={props.scenario}
        onScenarioChange={props.onScenarioChange}
        searchOpen={props.searchOpen}
        query={props.query}
        onQueryChange={props.onQueryChange}
        onToggleSearch={props.onToggleSearch}
      />
      {!props.profile?.citizenshipDocuments.citizenshipCountryCodes.length ? <MissingCitizenshipNotice onOpenProfile={props.onOpenProfile} /> : null}
      {props.scenario !== 'all' || props.query ? <ResetFilters onReset={props.onReset} /> : null}
      <p className="career-relocation-count" aria-live="polite">
        {props.totalCountries} стран в каталоге с правилами или возможностью уточнить статус.
      </p>
      <CountryList countries={props.countries} profile={props.profile} selectedCountryCodes={props.selectedCountryCodes} detailsCountryCode={props.detailsCountryCode} onOpenDetails={props.onOpenDetails} onToggleCompare={props.onToggleCompare} onOpenVacancies={props.onOpenVacancies} />
      {props.details && props.detailsScenarios ? (
        <CountryDetails country={props.details} profile={props.profile} scenarios={props.detailsScenarios} onClose={props.onCloseDetails} onCalculateEconomy={props.onCalculateEconomy} />
      ) : null}
      <CountryWorkspaceFooter
        total={props.totalCountries}
        visible={props.countries.length}
        showAll={props.showAll}
        selectedCount={props.selectedCountryCodes.length}
        onShowAll={props.onShowAll}
        onCompare={props.onCompare}
      />
    </section>
  );
}

function MissingCitizenshipNotice({ onOpenProfile }: { readonly onOpenProfile: () => void }) {
  return (
    <div className="career-relocation-empty" role="note">
      <strong>Нет данных о гражданстве</strong>
      <span>Пока гражданство не указано, статусы стран остаются неизвестными. Укажите его, чтобы проверить правила.</span>
      <button className="career-btn career-btn-secondary" type="button" onClick={onOpenProfile}>Указать в профиле</button>
    </div>
  );
}

function CountryWorkspaceHeader({
  scenario,
  onScenarioChange,
  searchOpen,
  query,
  onQueryChange,
  onToggleSearch,
}: {
  readonly scenario: ScenarioFilter;
  readonly onScenarioChange: (scenario: ScenarioFilter) => void;
  readonly searchOpen: boolean;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onToggleSearch: () => void;
}) {
  return (
    <>
      <header className="career-relocation-section-heading">
        <div>
          <h2 id="career-relocation-countries-title">Страны под ваш профиль</h2>
          <p>Статус зависит от известных фактов. Неизвестные условия остаются неизвестными.</p>
        </div>
        <label className="career-relocation-scenario-filter">
          <span>Сценарий</span>
          <select value={scenario} onChange={(event) => onScenarioChange(event.target.value as ScenarioFilter)}>
            {SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </header>
      <button className="career-relocation-text-action" type="button" aria-expanded={searchOpen} onClick={onToggleSearch}>
        <Plus aria-hidden="true" size={17} />
        {searchOpen ? 'Скрыть поиск страны' : 'Добавить страну'}
      </button>
      {searchOpen ? <CountrySearch query={query} onQueryChange={onQueryChange} /> : null}
    </>
  );
}

function CountrySearch({ query, onQueryChange }: { readonly query: string; readonly onQueryChange: (query: string) => void }) {
  return (
    <label className="career-relocation-search">
      <span>Поиск страны</span>
      <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Например, Германия" />
    </label>
  );
}

function ResetFilters({ onReset }: { readonly onReset: () => void }) {
  return (
    <button className="career-relocation-text-action" type="button" onClick={onReset}>
      <X aria-hidden="true" size={16} />Сбросить сценарий и поиск
    </button>
  );
}

function CountryList({
  countries,
  profile,
  selectedCountryCodes,
  detailsCountryCode,
  onOpenDetails,
  onToggleCompare,
  onOpenVacancies,
}: {
  readonly countries: readonly RelocationCountry[];
  readonly profile: RelocationQuestionnaire | null;
  readonly selectedCountryCodes: readonly string[];
  readonly detailsCountryCode?: string;
  readonly onOpenDetails: (countryCode: string) => void;
  readonly onToggleCompare: (countryCode: string) => void;
  readonly onOpenVacancies?: () => void;
}) {
  if (!countries.length) {
    return <div className="career-relocation-empty" role="status"><strong>По этому запросу стран нет</strong><span>Измените название или сбросьте фильтр сценария.</span></div>;
  }
  return (
    <ul className="career-relocation-country-list">
      {countries.map((country) => (
        <CountryRow
          key={country.countryCode}
          country={country}
          profile={profile}
          selected={selectedCountryCodes.includes(country.countryCode)}
          expanded={detailsCountryCode === country.countryCode}
          compareDisabled={!selectedCountryCodes.includes(country.countryCode) && selectedCountryCodes.length >= 3}
          onOpenDetails={() => onOpenDetails(country.countryCode)}
          onToggleCompare={() => onToggleCompare(country.countryCode)}
          onOpenVacancies={onOpenVacancies}
        />
      ))}
    </ul>
  );
}

function CountryRow({
  country,
  profile,
  selected,
  expanded,
  compareDisabled,
  onOpenDetails,
  onToggleCompare,
  onOpenVacancies,
}: {
  readonly country: RelocationCountry;
  readonly profile: RelocationQuestionnaire | null;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly compareDisabled: boolean;
  readonly onOpenDetails: () => void;
  readonly onToggleCompare: () => void;
  readonly onOpenVacancies?: () => void;
}) {
  const fit = countryFitForQuestionnaire(country.countryCode, profile);
  return (
    <li className="career-relocation-country-row">
      <div className="career-relocation-country-main">
        <button
          className="career-relocation-country-name"
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? `career-relocation-country-details-${country.countryCode}` : undefined}
          onClick={onOpenDetails}
        >
          <strong>{country.name}</strong>
          <span>Доступность по анкете</span>
        </button>
        <span className={`career-relocation-country-status is-${fit.status}`}>{statusLabel(fit.status)}</span>
      </div>
      <div className="career-relocation-country-actions">
        <button className="career-btn career-btn-secondary" type="button" aria-pressed={selected} disabled={compareDisabled} onClick={onToggleCompare}>
          {selected ? 'Убрать из сравнения' : 'В сравнение'}
        </button>
        <VacancyButton onOpenVacancies={onOpenVacancies} />
      </div>
    </li>
  );
}

function VacancyButton({ onOpenVacancies }: { readonly onOpenVacancies?: () => void }) {
  if (!onOpenVacancies) return null;
  return (
    <button className="career-btn career-btn-secondary" type="button" onClick={onOpenVacancies}>
      <Briefcase aria-hidden="true" size={17} />Вакансии
    </button>
  );
}

function CountryDetails({
  country,
  profile,
  scenarios,
  onClose,
  onCalculateEconomy,
}: {
  readonly country: RelocationCountry;
  readonly profile: RelocationQuestionnaire | null;
  readonly scenarios: readonly MobilityScenarioEvaluation[];
  readonly onClose: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
}) {
  const detailsId = `career-relocation-country-details-${country.countryCode}`;
  const sources = uniqueSources(scenarios);
  const comparisonCountry = buildCountryComparisonCountry(country.countryCode, profile);
  return (
    <section id={detailsId} className="career-relocation-country-details" aria-labelledby={`${detailsId}-title`}>
      <header>
        <div><h3 id={`${detailsId}-title`}>{country.name}</h3><p>Данные получены {sources[0]?.retrievedAt ?? 'неизвестно'}.</p></div>
        <div className="career-relocation-country-actions">
          <button className="career-btn career-btn-secondary" type="button" onClick={() => onCalculateEconomy(country.countryCode)}>Посчитать экономику</button>
          <button className="career-relocation-text-action" type="button" onClick={onClose}>Свернуть</button>
        </div>
      </header>
      <ScenarioDetails scenarios={scenarios} />
      <CountryComparisonPanel countries={[comparisonCountry]} title="Доступные сведения по стране" showParetoSummary={false} />
      <p className="career-relocation-disclaimer">Справочная информация из открытых источников. Это не юридическая консультация. Перед решением проверьте правила на официальном портале.</p>
    </section>
  );
}

function ScenarioDetails({ scenarios }: { readonly scenarios: readonly MobilityScenarioEvaluation[] }) {
  return (
    <ul className="career-relocation-scenario-list">
      {scenarios.map((scenario) => <ScenarioDetail key={scenario.id} scenario={scenario} />)}
    </ul>
  );
}

function ScenarioDetail({ scenario }: { readonly scenario: MobilityScenarioEvaluation }) {
  const thresholds = uniqueThresholds(scenario.thresholds);
  return (
    <li>
      <div>
        <strong>{scenario.label}</strong>
        <span>{statusLabel(scenario.status)}</span>
        {scenario.reasons.length ? <p>{scenario.reasons.join(' ')}</p> : null}
        {thresholds.map((threshold) => <ThresholdLine key={`${threshold.requirement}-${threshold.amount}-${threshold.period}-${threshold.currency ?? ''}`} threshold={threshold} />)}
      </div>
      {scenario.sources.map((source) => (
        <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
          {source.title}, {source.dataYear}, получено {source.retrievedAt}
        </a>
      ))}
    </li>
  );
}

function uniqueThresholds(thresholds: MobilityScenarioEvaluation['thresholds']) {
  const seen = new Set<string>();
  return thresholds.filter((threshold) => {
    const key = `${threshold.requirement}:${threshold.amount}:${threshold.currency ?? ''}:${threshold.period}:${threshold.source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ThresholdLine({ threshold }: { readonly threshold: MobilityScenarioEvaluation['thresholds'][number] }) {
  return (
    <p>
      {threshold.label}: {new Intl.NumberFormat('ru-RU').format(threshold.amount)}{threshold.currency ? ` ${threshold.currency}` : ''}.
      Шкала {threshold.source.dataYear}, данные получены {threshold.source.retrievedAt}.
    </p>
  );
}

function CountryWorkspaceFooter({
  total,
  visible,
  showAll,
  selectedCount,
  onShowAll,
  onCompare,
}: {
  readonly total: number;
  readonly visible: number;
  readonly showAll: boolean;
  readonly selectedCount: number;
  readonly onShowAll: () => void;
  readonly onCompare: () => void;
}) {
  return (
    <footer className="career-relocation-list-footer">
      <div>
        {!showAll && total > visible ? (
          <button className="career-relocation-text-action" type="button" onClick={onShowAll}>
            <Plus aria-hidden="true" size={17} />Показать все {total}
          </button>
        ) : null}
        <span aria-live="polite">Для сравнения выбрано: {selectedCount} из 3.</span>
      </div>
      <button className="career-btn career-btn-primary" type="button" disabled={selectedCount < 2} onClick={onCompare}>
        <ArrowRight aria-hidden="true" size={17} />Сравнить страны
      </button>
    </footer>
  );
}

function statusLabel(status: string): string {
  if (status === 'available') return 'Доступно по подтверждённым данным';
  if (status === 'barriers' || status === 'high_barriers') return 'Есть условия';
  if (status === 'unavailable' || status === 'legally_unavailable') return 'Недоступно по правилу';
  return 'Нужно уточнить';
}

function uniqueSources(scenarios: readonly MobilityScenarioEvaluation[]) {
  const seen = new Set<string>();
  return scenarios.flatMap(({ sources }) => sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }));
}

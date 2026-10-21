import { useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  CheckCircle,
  Clock,
  Info,
  Plus,
  Prohibit,
  X,
} from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type {
  MobilityScenarioEvaluation,
  MobilityScenarioId,
} from '../../../shared/countryFit/types';
import type { RelocationCountry } from './relocationCountryData';
import { CountryComparisonPanel } from './CountryComparisonPanel';
import { buildCountryComparisonCountry } from './relocationCountryData';
import {
  relocationStatusLabel,
  summarizeRelocationCountry,
  type RelocationCountrySummary,
} from './relocationCountrySummary';

type ScenarioFilter = 'all' | MobilityScenarioId;

const SCENARIOS: readonly { readonly id: ScenarioFilter; readonly label: string }[] = [
  { id: 'all', label: 'Все' },
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
  readonly showAll: boolean;
  readonly details?: RelocationCountry;
  readonly detailsScenarios?: readonly MobilityScenarioEvaluation[];
  readonly detailsCountryCode?: string;
  readonly selectedCountryCodes: readonly string[];
  readonly onScenarioChange: (scenario: ScenarioFilter) => void;
  readonly onShowAll: () => void;
  readonly onCloseDetails: () => void;
  readonly onOpenDetails: (countryCode: string) => void;
  readonly onToggleCompare: (countryCode: string) => void;
  readonly onCompare: () => void;
  readonly onAddCountry: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
  readonly onOpenProfile: () => void;
  readonly onOpenVacancies?: () => void;
}

export function RelocationCountryWorkspaceView(props: RelocationCountryWorkspaceViewProps) {
  return (
    <section
      className="career-relocation-countries career-relocation-card"
      aria-labelledby="career-relocation-countries-title"
    >
      <CountryWorkspaceHeader />
      <ScenarioChips scenario={props.scenario} onScenarioChange={props.onScenarioChange} />
      {!props.profile?.citizenshipDocuments.citizenshipCountryCodes.length ? (
        <MissingCitizenshipNotice onOpenProfile={props.onOpenProfile} />
      ) : null}
      <CountryList
        countries={props.countries}
        profile={props.profile}
        selectedCountryCodes={props.selectedCountryCodes}
        detailsCountryCode={props.detailsCountryCode}
        onOpenDetails={props.onOpenDetails}
        onToggleCompare={props.onToggleCompare}
        onOpenVacancies={props.onOpenVacancies}
      />
      {props.details && props.detailsScenarios ? (
        <CountryDetails
          country={props.details}
          profile={props.profile}
          scenarios={props.detailsScenarios}
          onClose={props.onCloseDetails}
          onCalculateEconomy={props.onCalculateEconomy}
        />
      ) : null}
      <p className="career-relocation-note">
        <Info aria-hidden="true" size={17} />
        <span>
          Справочная информация по открытым источникам, не юридическая консультация. Пороги и
          правила меняются: перед решением проверьте на официальном портале страны.
        </span>
      </p>
      <CountryWorkspaceFooter
        total={props.totalCountries}
        visible={props.countries.length}
        showAll={props.showAll}
        selectedCount={props.selectedCountryCodes.length}
        onShowAll={props.onShowAll}
        onCompare={props.onCompare}
        onAddCountry={props.onAddCountry}
      />
    </section>
  );
}

function MissingCitizenshipNotice({ onOpenProfile }: { readonly onOpenProfile: () => void }) {
  return (
    <div className="career-relocation-empty" role="note">
      <strong>Нет данных о гражданстве</strong>
      <span>
        Пока гражданство не указано, статусы стран остаются неизвестными. Укажите его, чтобы
        проверить правила.
      </span>
      <button className="career-btn career-btn-secondary" type="button" onClick={onOpenProfile}>
        Указать в анкете
      </button>
    </div>
  );
}

function CountryWorkspaceHeader() {
  const [explained, setExplained] = useState(false);
  return (
    <header className="career-relocation-section-heading">
      <div className="career-relocation-section-title">
        <h3 id="career-relocation-countries-title">Страны под ваш профиль</h3>
        <button
          className="career-relocation-icon-button"
          type="button"
          aria-label="Пояснение"
          aria-expanded={explained}
          onClick={() => setExplained((current) => !current)}
        >
          <Info aria-hidden="true" size={17} />
        </button>
      </div>
      {explained ? (
        <p>
          Статус страны считается по правилам из открытых источников и фактам вашей анкеты.
          Неизвестные условия остаются неизвестными, а не угаданными.
        </p>
      ) : null}
    </header>
  );
}

function ScenarioChips({
  scenario,
  onScenarioChange,
}: {
  readonly scenario: ScenarioFilter;
  readonly onScenarioChange: (scenario: ScenarioFilter) => void;
}) {
  return (
    <div className="career-relocation-chips" role="group" aria-label="Сценарий переезда">
      {SCENARIOS.map((item) => (
        <button
          key={item.id}
          className="career-relocation-filter-chip"
          type="button"
          aria-pressed={scenario === item.id}
          onClick={() => onScenarioChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
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
    return (
      <div className="career-relocation-empty" role="status">
        <strong>Стран с таким сценарием нет</strong>
        <span>Выберите другой сценарий или «Все».</span>
      </div>
    );
  }
  return (
    <ul className="career-relocation-country-grid">
      {countries.map((country) => (
        <CountryCard
          key={country.countryCode}
          summary={summarizeRelocationCountry(country, profile)}
          selected={selectedCountryCodes.includes(country.countryCode)}
          expanded={detailsCountryCode === country.countryCode}
          compareDisabled={
            !selectedCountryCodes.includes(country.countryCode) && selectedCountryCodes.length >= 3
          }
          onOpenDetails={() => onOpenDetails(country.countryCode)}
          onToggleCompare={() => onToggleCompare(country.countryCode)}
          onOpenVacancies={onOpenVacancies}
        />
      ))}
    </ul>
  );
}

function CountryCard({
  summary,
  selected,
  expanded,
  compareDisabled,
  onOpenDetails,
  onToggleCompare,
  onOpenVacancies,
}: {
  readonly summary: RelocationCountrySummary;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly compareDisabled: boolean;
  readonly onOpenDetails: () => void;
  readonly onToggleCompare: () => void;
  readonly onOpenVacancies?: () => void;
}) {
  return (
    <li className="career-relocation-country-card">
      <div className="career-relocation-country-main">
        <button
          className="career-relocation-country-name"
          type="button"
          aria-expanded={expanded}
          aria-controls={
            expanded ? `career-relocation-country-details-${summary.countryCode}` : undefined
          }
          onClick={onOpenDetails}
        >
          <strong>{summary.name}</strong>
        </button>
        <RelocationStatusBadge status={summary.status} label={summary.statusLabel} />
      </div>
      <span className="career-relocation-country-scenario">{summary.scenarioLabel}</span>
      <p>{summary.reason}</p>
      <CountryCardMeta summary={summary} />
      <CountryCardActions
        selected={selected}
        compareDisabled={compareDisabled}
        onToggleCompare={onToggleCompare}
        onOpenVacancies={onOpenVacancies}
      />
    </li>
  );
}

function CountryCardMeta({ summary }: { readonly summary: RelocationCountrySummary }) {
  return (
    <div className="career-relocation-country-meta">
      <span className="career-relocation-country-vacancies">Вакансий с релокацией: нет данных</span>
      <span title={summary.source?.title}>
        <Clock aria-hidden="true" size={14} />
        {summary.source
          ? `каталог правил, ${shortDay(summary.source.retrievedAt)}`
          : 'источник правила не указан'}
      </span>
    </div>
  );
}

function CountryCardActions({
  selected,
  compareDisabled,
  onToggleCompare,
  onOpenVacancies,
}: {
  readonly selected: boolean;
  readonly compareDisabled: boolean;
  readonly onToggleCompare: () => void;
  readonly onOpenVacancies?: () => void;
}) {
  return (
    <div className="career-relocation-country-actions">
      <VacancyButton onOpenVacancies={onOpenVacancies} />
      <button
        className="career-relocation-text-action"
        type="button"
        aria-pressed={selected}
        disabled={compareDisabled}
        onClick={onToggleCompare}
      >
        {selected ? (
          <>
            <X aria-hidden="true" size={16} />
            Убрать из сравнения
          </>
        ) : (
          <>
            <Plus aria-hidden="true" size={16} />В сравнение
          </>
        )}
      </button>
    </div>
  );
}

/** «2026-10-10» → «10.10», as the mockup dates sources; anything else stays as is. */
function shortDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  return match ? `${match[3]}.${match[2]}` : value;
}

export function RelocationStatusBadge({
  status,
  label,
}: {
  readonly status: string;
  readonly label: string;
}) {
  const Icon =
    status === 'available'
      ? CheckCircle
      : status === 'legally_unavailable' || status === 'unavailable'
        ? Prohibit
        : Info;
  return (
    <span className={`career-relocation-country-status is-${status}`}>
      <Icon aria-hidden="true" size={14} />
      {label}
    </span>
  );
}

function VacancyButton({ onOpenVacancies }: { readonly onOpenVacancies?: () => void }) {
  if (!onOpenVacancies) return null;
  return (
    <button className="career-btn career-btn-secondary" type="button" onClick={onOpenVacancies}>
      <Briefcase aria-hidden="true" size={17} />
      Вакансии
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
    <section
      id={detailsId}
      className="career-relocation-country-details"
      aria-labelledby={`${detailsId}-title`}
    >
      <CountryDetailsHeader
        detailsId={detailsId}
        country={country}
        retrievedAt={sources[0]?.retrievedAt}
        onClose={onClose}
        onCalculateEconomy={onCalculateEconomy}
      />
      <ScenarioDetails scenarios={scenarios} />
      <CountryComparisonPanel
        countries={[comparisonCountry]}
        title="Доступные сведения по стране"
        showParetoSummary={false}
      />
      <p className="career-relocation-disclaimer">
        Справочная информация из открытых источников. Это не юридическая консультация. Перед
        решением проверьте правила на официальном портале.
      </p>
    </section>
  );
}

function CountryDetailsHeader({
  detailsId,
  country,
  retrievedAt,
  onClose,
  onCalculateEconomy,
}: {
  readonly detailsId: string;
  readonly country: RelocationCountry;
  readonly retrievedAt?: string;
  readonly onClose: () => void;
  readonly onCalculateEconomy: (countryCode: string) => void;
}) {
  return (
    <header>
      <div>
        <h3 id={`${detailsId}-title`}>{country.name}</h3>
        <p>Данные получены {retrievedAt ?? 'неизвестно'}.</p>
      </div>
      <div className="career-relocation-country-actions">
        <button
          className="career-btn career-btn-secondary"
          type="button"
          onClick={() => onCalculateEconomy(country.countryCode)}
        >
          Посчитать экономику
        </button>
        <button className="career-relocation-text-action" type="button" onClick={onClose}>
          Свернуть
        </button>
      </div>
    </header>
  );
}

function ScenarioDetails({
  scenarios,
}: {
  readonly scenarios: readonly MobilityScenarioEvaluation[];
}) {
  return (
    <ul className="career-relocation-scenario-list">
      {scenarios.map((scenario) => (
        <ScenarioDetail key={scenario.id} scenario={scenario} />
      ))}
    </ul>
  );
}

function ScenarioDetail({ scenario }: { readonly scenario: MobilityScenarioEvaluation }) {
  const thresholds = uniqueThresholds(scenario.thresholds);
  return (
    <li>
      <div>
        <strong>{scenario.label}</strong>
        <span>{relocationStatusLabel(scenario.status)}</span>
        {scenario.reasons.length ? <p>{scenario.reasons.join(' ')}</p> : null}
        {thresholds.map((threshold) => (
          <ThresholdLine
            key={`${threshold.requirement}-${threshold.amount}-${threshold.period}-${threshold.currency ?? ''}`}
            threshold={threshold}
          />
        ))}
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

function ThresholdLine({
  threshold,
}: {
  readonly threshold: MobilityScenarioEvaluation['thresholds'][number];
}) {
  return (
    <p>
      {threshold.label}: {new Intl.NumberFormat('ru-RU').format(threshold.amount)}
      {threshold.currency ? ` ${threshold.currency}` : ''}. Шкала {threshold.source.dataYear},
      данные получены {threshold.source.retrievedAt}.
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
  onAddCountry,
}: {
  readonly total: number;
  readonly visible: number;
  readonly showAll: boolean;
  readonly selectedCount: number;
  readonly onShowAll: () => void;
  readonly onCompare: () => void;
  readonly onAddCountry: () => void;
}) {
  return (
    <footer className="career-relocation-list-footer">
      <p className="career-relocation-count" aria-live="polite">
        {visible < total
          ? `Показаны страны: ${visible} из ${total}, сначала доступные, затем с условиями и барьерами. `
          : `Показаны все страны: ${total}. `}
        Для сравнения выбрано {selectedCount} из 3. Нужной страны нет в списке? Добавьте её сами.
      </p>
      <div className="career-relocation-footer-actions">
        <button
          className="career-btn career-btn-primary"
          type="button"
          disabled={selectedCount < 2}
          onClick={onCompare}
        >
          <ArrowRight aria-hidden="true" size={17} />
          Сравнить страны
        </button>
        {!showAll && total > visible ? (
          <button className="career-relocation-text-action" type="button" onClick={onShowAll}>
            Показать все {total}
          </button>
        ) : null}
        <button className="career-relocation-text-action" type="button" onClick={onAddCountry}>
          <Plus aria-hidden="true" size={17} />
          Добавить страну
        </button>
      </div>
    </footer>
  );
}

function uniqueSources(scenarios: readonly MobilityScenarioEvaluation[]) {
  const seen = new Set<string>();
  return scenarios.flatMap(({ sources }) =>
    sources.filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    }),
  );
}

import { ArrowRight, Briefcase, Calculator, Plus, X } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';
import {
  relocationStatusLabel,
  RELOCATION_SCENARIO_LABELS,
  summarizeRelocationCountry,
  type RelocationCountrySummary,
} from './relocationCountrySummary';
import { RelocationStatusBadge } from './RelocationCountryWorkspaceParts';
import { MobilePush } from './RelocationMobilePush';

export interface RelocationMobileCountryProps {
  readonly countryCode: string;
  readonly profile: RelocationQuestionnaire | null;
  readonly selected: boolean;
  readonly compareDisabled: boolean;
  readonly onBack: () => void;
  readonly onToggleCompare: () => void;
  readonly onCompare: () => void;
  readonly onCalculateEconomy: () => void;
  readonly onOpenVacancies?: () => void;
}

/** Mockup 15 `mv=c4`: one country as a push screen — status, why, sources, next steps. */
export function RelocationMobileCountry(props: RelocationMobileCountryProps) {
  const country = listRelocationCountries().find(
    ({ countryCode }) => countryCode === props.countryCode,
  );
  if (!country) {
    return (
      <MobilePush title="Страна" onBack={props.onBack}>
        <p role="status">Этой страны нет в каталоге правил.</p>
      </MobilePush>
    );
  }
  const summary = summarizeRelocationCountry(country, props.profile);
  return (
    <MobilePush title={country.name} onBack={props.onBack}>
      <section
        className="career-relocation-mobile-section"
        aria-labelledby="career-relocation-country-title"
      >
        <div className="career-relocation-country-main">
          <h3 id="career-relocation-country-title">{country.name}</h3>
          <RelocationStatusBadge status={summary.status} label={summary.statusLabel} />
        </div>
        <p className="career-relocation-muted">{summary.scenarioLabel}</p>
        <h4>Почему так</h4>
        <ScenarioReasons scenarios={summary.scenarios} />
        <p className="career-relocation-muted">
          Справочная информация по открытым источникам, не юридическая консультация.
        </p>
        <CountryActions {...props} />
      </section>
    </MobilePush>
  );
}

function ScenarioReasons({
  scenarios,
}: {
  readonly scenarios: RelocationCountrySummary['scenarios'];
}) {
  return (
    <ul className="career-relocation-group-list">
      {scenarios.map((scenario) => (
        <li key={scenario.id}>
          <span className="career-relocation-group-row">
            <strong>
              {RELOCATION_SCENARIO_LABELS[scenario.id] ?? scenario.label}:{' '}
              {relocationStatusLabel(scenario.status).toLocaleLowerCase('ru')}
            </strong>
            {scenario.reasons[0] ? <span>{scenario.reasons[0]}</span> : null}
            {scenario.sources[0] ? (
              <a href={scenario.sources[0].url} target="_blank" rel="noopener noreferrer">
                {scenario.sources[0].title}, получено {scenario.sources[0].retrievedAt}
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CountryActions(props: RelocationMobileCountryProps) {
  return (
    <>
      {props.onOpenVacancies ? (
        <button
          className="career-btn career-btn-secondary"
          type="button"
          onClick={props.onOpenVacancies}
        >
          <Briefcase aria-hidden="true" size={17} />
          Вакансии
        </button>
      ) : null}
      <button
        className="career-btn career-btn-secondary"
        type="button"
        aria-pressed={props.selected}
        disabled={props.compareDisabled}
        onClick={props.onToggleCompare}
      >
        {props.selected ? (
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
      <button
        className="career-btn career-btn-secondary"
        type="button"
        onClick={props.onCalculateEconomy}
      >
        <Calculator aria-hidden="true" size={17} />
        Посчитать экономику
      </button>
      <button className="career-btn career-btn-primary" type="button" onClick={props.onCompare}>
        <ArrowRight aria-hidden="true" size={17} />
        Сравнить с другими странами
      </button>
    </>
  );
}

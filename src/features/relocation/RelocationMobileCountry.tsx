import { Briefcase, CaretRight, CheckCircle, Info, Prohibit, Scales } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';
import {
  summarizeRelocationCountry,
  type RelocationCountrySummary,
} from './relocationCountrySummary';
import { MobilePush } from './RelocationMobilePush';
import { relocationShortDay } from './relocationDates';

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

/** «2026-10-10» → «10.10», as the mockup dates sources. */
function StatusLine({ summary }: { readonly summary: RelocationCountrySummary }) {
  const Icon =
    summary.status === 'available'
      ? CheckCircle
      : summary.status === 'legally_unavailable'
        ? Prohibit
        : Info;
  return (
    <p className={`career-relocation-push-status is-${summary.status}`}>
      <Icon aria-hidden="true" size={16} />
      {summary.statusLabel}
    </p>
  );
}

function Row({
  icon,
  title,
  sub,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly sub?: string;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="vacancy-push-row" onClick={onClick}>
      <span className="vacancy-push-ico">{icon}</span>
      <span className="vacancy-push-main">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <CaretRight className="vacancy-push-chev" aria-hidden="true" />
    </button>
  );
}

function WhySection({ summary }: { readonly summary: RelocationCountrySummary }) {
  return (
    <section className="vacancy-push-group">
      <h3 className="vacancy-push-cap">Почему так</h3>
      <p className="career-relocation-push-why">
        <Info aria-hidden="true" size={18} />
        <span>{summary.reason}</span>
      </p>
      <p className="vacancy-push-foot">
        Правила въезда и работы по открытым источникам
        {summary.source
          ? `, каталог правил, ${relocationShortDay(summary.source.retrievedAt)}`
          : ''}
        . Не юридическая консультация.
      </p>
    </section>
  );
}

/** Mockup 15 `mv=c4`: one country as a push screen — status, why, source, two next steps. */
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
  const compare = () => {
    if (!props.selected && !props.compareDisabled) props.onToggleCompare();
    props.onCompare();
  };
  return (
    <MobilePush title={country.name} onBack={props.onBack}>
      <div className="vacancy-push-hero">
        <h2>{country.name}</h2>
        <p>{summary.scenarioLabel}</p>
      </div>
      <StatusLine summary={summary} />
      <WhySection summary={summary} />
      <div className="vacancy-push-list">
        {props.onOpenVacancies ? (
          <Row
            icon={<Briefcase aria-hidden="true" />}
            title="Вакансии с релокацией"
            sub="по вашим ролям; число по стране пока не считается"
            onClick={props.onOpenVacancies}
          />
        ) : null}
        <Row
          icon={<Scales aria-hidden="true" />}
          title="Сравнить с другими странами"
          onClick={compare}
        />
      </div>
    </MobilePush>
  );
}

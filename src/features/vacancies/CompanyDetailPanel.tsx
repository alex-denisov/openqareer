import { useState } from 'react';
import { ArrowLeft, ArrowRight, Target } from '@phosphor-icons/react';
import type {
  CandidateCompanyDetails,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanyRecruiter,
} from '../../../shared/candidateCompany';
import { pluralRu } from '../../../shared/pluralRu';
import { dativeNameRu } from '../today/dativeNameRu';
import { CompanyPeopleSection } from './CompaniesAndPeoplePeople';
import { useCompanyPeople, type CompanyPeopleState } from './CompanyConnectionCircles';
import { RecruiterMessagePanel } from './RecruiterMessagePanel';
import type { VacancyLetterTarget } from './VacancyLetterScreen';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import { companySourceSummary, formatObservedDate } from './companiesAndPeopleUtils';

const TOP_VACANCIES = 3;

interface CompanyDetailPanelProps {
  readonly company: CandidateCompanyOpportunity;
  readonly detail: CandidateCompanyDetails | null;
  readonly linkedin: CandidateCompanyPage['linkedin'];
  readonly searchConsentGranted: boolean;
  readonly consentRequired: boolean;
  readonly detailLoading: boolean;
  readonly detailError: string | null;
  readonly actionError: string | null;
  readonly busyWant: boolean;
  readonly busySearch: boolean;
  readonly onBack: () => void;
  readonly onOpenConnections?: () => void;
  readonly onOpenCompanyVacancies?: (companyName: string) => void;
  readonly onToggleWant: () => void;
  readonly onSearch: () => void;
  readonly onAllowAndSearch: () => void;
  readonly onOpenLetter?: (vacancy: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
}

export function CompanyAvatar({ name }: { readonly name: string }) {
  return (
    <span className="companies-people-avatar" aria-hidden="true">
      {name.trim().charAt(0).toLocaleUpperCase('ru-RU') || '·'}
    </span>
  );
}

function companyMeta(company: CandidateCompanyOpportunity): string {
  return [company.location, company.industry, companySourceSummary(company.sources)]
    .filter(Boolean)
    .join(' · ');
}

function WantControls({
  company,
  busy,
  onToggle,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly busy: boolean;
  readonly onToggle: () => void;
}) {
  if (!company.want) {
    return (
      <button
        type="button"
        className="companies-people-want-button"
        disabled={busy}
        onClick={onToggle}
      >
        <Target aria-hidden="true" /> Хочу в эту компанию
      </button>
    );
  }
  return (
    <div className="companies-people-want-state">
      <span className="companies-people-want-chip">
        <Target aria-hidden="true" /> Хочу в эту компанию
      </span>
      <button
        type="button"
        className="companies-people-text-button"
        disabled={busy}
        onClick={onToggle}
      >
        Убрать
      </button>
    </div>
  );
}

function CompanyDetailHeader({
  company,
  busyWant,
  onBack,
  onToggleWant,
}: Pick<CompanyDetailPanelProps, 'company' | 'busyWant' | 'onBack' | 'onToggleWant'>) {
  return (
    <>
      <button type="button" className="companies-people-mobile-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> Назад к компаниям
      </button>
      <header className="companies-people-detail-heading">
        <CompanyAvatar name={company.name} />
        <div className="companies-people-detail-title">
          <h2>{company.name}</h2>
          <p>{companyMeta(company) || 'Источник данных неизвестен'}</p>
        </div>
        <WantControls company={company} busy={busyWant} onToggle={onToggleWant} />
      </header>
    </>
  );
}

/** Saved step first; otherwise one derived from a real path or vacancy; otherwise honest «не задан». */
export function companyNextStepText(
  company: CandidateCompanyOpportunity,
  people: CompanyPeopleState,
): string {
  if (company.nextStep) {
    const due = company.nextStep.dueAt ? `, до ${formatObservedDate(company.nextStep.dueAt)}` : '';
    return `Следующий шаг: ${company.nextStep.text}${due}`;
  }
  const vacancy = company.vacancies[0];
  const person = people.people[0];
  if (vacancy && person) {
    return `Следующий шаг: откликнуться на ${vacancy.title}, написать ${dativeNameRu(person.fullName)} (круг ${person.circle})`;
  }
  if (vacancy) return `Следующий шаг: откликнуться на ${vacancy.title}`;
  return 'Следующий шаг не задан';
}

function CompanyNextStep({
  company,
  people,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly people: CompanyPeopleState;
}) {
  if (people.loading && !company.nextStep) return null;
  return (
    <p className="companies-people-next-step">
      <ArrowRight aria-hidden="true" /> {companyNextStepText(company, people)}
    </p>
  );
}

function CompanyVacancyCard({
  vacancy,
}: {
  readonly vacancy: CandidateCompanyDetails['vacancies'][number];
}) {
  const content = (
    <>
      <strong>{vacancy.title}</strong>
      <span>
        {vacancy.location ?? 'Место неизвестно'} · {vacancy.sourceName},{' '}
        {formatObservedDate(vacancy.sourceDate)}
      </span>
    </>
  );
  return vacancy.href ? (
    <a className="companies-people-vacancy" href={vacancy.href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="companies-people-vacancy">{content}</div>
  );
}

function CompanyVacancySection(props: CompanyDetailPanelProps) {
  const { company, detail } = props;
  const vacancies = (
    detail?.company.key === company.key ? detail.vacancies : company.vacancies
  ).slice(0, TOP_VACANCIES);
  if (company.vacancyCount === 0) return null;
  return (
    <section className="companies-people-section" aria-labelledby="company-vacancies-title">
      <div className="companies-people-section-heading">
        <h3 id="company-vacancies-title">Вакансии</h3>
        <span className="companies-people-count-badge">{company.vacancyCount}</span>
      </div>
      {props.detailError ? (
        <p className="companies-people-error" role="alert">
          {props.detailError}
        </p>
      ) : null}
      {props.detailLoading && vacancies.length === 0 ? (
        <p className="companies-people-status" role="status">
          Загружаем вакансии компании…
        </p>
      ) : (
        <div className="companies-people-vacancy-list">
          {vacancies.map((vacancy) => (
            <CompanyVacancyCard key={vacancy.id} vacancy={vacancy} />
          ))}
        </div>
      )}
      {company.vacancyCount > vacancies.length && props.onOpenCompanyVacancies ? (
        <button
          type="button"
          className="companies-people-link"
          onClick={() => props.onOpenCompanyVacancies?.(company.name)}
        >
          Все {pluralRu(company.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])} компании в
          подборке
        </button>
      ) : null}
    </section>
  );
}

export function CompanyDetailPanel(props: CompanyDetailPanelProps) {
  const people = useCompanyPeople(props.company);
  const [messageTo, setMessageTo] = useState<CandidateCompanyRecruiter | null>(null);
  return (
    <article className="companies-people-detail" aria-label={`Компания ${props.company.name}`}>
      <CompanyDetailHeader
        company={props.company}
        busyWant={props.busyWant}
        onBack={props.onBack}
        onToggleWant={props.onToggleWant}
      />
      {props.actionError ? (
        <p className="companies-people-error" role="alert">
          {props.actionError}
        </p>
      ) : null}
      <CompanyNextStep company={props.company} people={people} />
      <CompanyVacancySection {...props} />
      <CompanyPeopleSection
        company={props.company}
        people={people}
        linkedin={props.linkedin}
        consentGranted={props.searchConsentGranted}
        consentRequired={props.consentRequired}
        busySearch={props.busySearch}
        searchError={props.actionError}
        onSearch={props.onSearch}
        onAllowAndSearch={props.onAllowAndSearch}
        onOpenConnections={props.onOpenConnections}
        onOpenLetter={props.onOpenLetter}
        onWriteRecruiter={setMessageTo}
      />
      {messageTo ? (
        <div className="companies-people-message">
          <RecruiterMessagePanel contact={messageTo} onClose={() => setMessageTo(null)} />
        </div>
      ) : null}
    </article>
  );
}

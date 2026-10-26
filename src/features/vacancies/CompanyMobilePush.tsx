import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { PushConsultantButton } from '../shell/PushConsultantButton';
import {
  ArrowRight,
  Briefcase,
  CaretLeft,
  CaretRight,
  CheckCircle,
  EnvelopeSimple,
  Info,
  ListChecks,
  MagnifyingGlass,
  Question,
  SignIn,
  Target,
  UsersThree,
} from '@phosphor-icons/react';
import type {
  CandidateCompanyDetails,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanyRecruiter,
} from '../../../shared/candidateCompany';
import { pluralRu } from '../../../shared/pluralRu';
import { SEARCH_CONSENT_TEXT } from '../../../shared/searchConsent';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { dativeNameRu } from '../today/dativeNameRu';
import { toLetterTarget, type CompanyPeopleState } from './CompanyConnectionCircles';
import { RecruiterMessagePanel } from './RecruiterMessagePanel';
import type { VacancyLetterTarget } from './VacancyLetterScreen';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import {
  companyNextStepText,
  companyLocationLabel,
  companySourceSummary,
  formatObservedDate,
} from './companiesAndPeopleUtils';
import './vacancy-push.css';

const TOP_VACANCIES = 3;

type OpenLetter = (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;

export interface CompanyMobilePushProps {
  readonly company: CandidateCompanyOpportunity;
  readonly detail: CandidateCompanyDetails | null;
  readonly people: CompanyPeopleState;
  readonly linkedin: CandidateCompanyPage['linkedin'];
  readonly searchConsentGranted: boolean;
  readonly busyWant: boolean;
  readonly busySearch: boolean;
  readonly actionError: string | null;
  readonly onBack: () => void;
  readonly onToggleWant: () => void;
  readonly onSearch: () => void;
  readonly onAllowAndSearch: () => void;
  readonly onOpenLetter?: OpenLetter;
  readonly onOpenCompanyVacancies?: (companyName: string) => void;
  readonly onOpenConnections?: () => void;
}

interface Cta {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

function Row({
  icon,
  title,
  sub,
  aside,
  onClick,
  ...data
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly sub?: string;
  readonly aside?: ReactNode;
  readonly onClick?: () => void;
  readonly [key: `data-${string}`]: string;
}) {
  const body = (
    <>
      {icon ? <span className="vacancy-push-ico">{icon}</span> : null}
      <span className="vacancy-push-main">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      {aside ? <span className="company-push-aside">{aside}</span> : null}
    </>
  );
  if (!onClick)
    return (
      <div className="vacancy-push-row" {...data}>
        {body}
      </div>
    );
  return (
    <button type="button" className="vacancy-push-row" onClick={onClick} {...data}>
      {body}
      <CaretRight className="vacancy-push-chev" aria-hidden="true" />
    </button>
  );
}

function companyMeta(company: CandidateCompanyOpportunity): string {
  return [
    company.location && companyLocationLabel(company.location),
    company.industry,
    companySourceSummary(company.sources),
  ]
    .filter(Boolean)
    .join(' · ');
}

function WantBlock({ props }: { readonly props: CompanyMobilePushProps }) {
  const { company } = props;
  if (!company.want) {
    return (
      <button
        type="button"
        className="vacancy-push-primary company-push-want"
        disabled={props.busyWant}
        onClick={props.onToggleWant}
      >
        <Target aria-hidden="true" /> Хочу в эту компанию
      </button>
    );
  }
  return (
    <div className="vacancy-push-list">
      <div className="vacancy-push-row">
        <span className="vacancy-push-ico">
          <Target aria-hidden="true" />
        </span>
        <span className="vacancy-push-main">
          <b>Хочу в эту компанию</b>
        </span>
        <button
          type="button"
          className="company-push-remove"
          disabled={props.busyWant}
          onClick={props.onToggleWant}
        >
          Убрать
        </button>
      </div>
    </div>
  );
}

function VacancyGroup({ props }: { readonly props: CompanyMobilePushProps }) {
  const { company, detail } = props;
  if (company.vacancyCount === 0) return null;
  const vacancies = (
    detail?.company.key === company.key ? detail.vacancies : company.vacancies
  ).slice(0, TOP_VACANCIES);
  return (
    <section className="vacancy-push-group">
      <h3 className="vacancy-push-cap">Вакансии · {company.vacancyCount}</h3>
      <div className="vacancy-push-list">
        {vacancies.map((vacancy) => (
          <Row
            key={vacancy.id}
            data-company-vacancy={vacancy.id}
            icon={<Briefcase aria-hidden="true" />}
            title={vacancy.title}
            sub={`${vacancy.location ?? 'Место неизвестно'} · ${vacancy.sourceName}, ${formatObservedDate(vacancy.sourceDate)}`}
            onClick={vacancy.href ? () => void openExternalLink(vacancy.href) : undefined}
          />
        ))}
        {props.onOpenCompanyVacancies && !company.outsideSelection ? (
          <Row
            icon={<ListChecks aria-hidden="true" />}
            title={`Все ${pluralRu(company.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])} компании`}
            onClick={() => props.onOpenCompanyVacancies?.(company.name)}
          />
        ) : null}
      </div>
    </section>
  );
}

function Note({ icon, children }: { readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <p className="company-push-note">
      {icon}
      <span>{children}</span>
    </p>
  );
}

function vacancyOf(company: CandidateCompanyOpportunity, vacancyId: string | null) {
  return company.vacancies.find((item) => item.id === vacancyId) ?? company.vacancies[0] ?? null;
}

function letter(
  props: CompanyMobilePushProps,
  vacancyId: string | null,
  circle: ConnectionCircleNumber,
) {
  const vacancy = vacancyOf(props.company, vacancyId);
  if (!vacancy || !props.onOpenLetter) return undefined;
  return () => props.onOpenLetter?.(toLetterTarget(props.company.name, vacancy), circle);
}

function importNote(people: CompanyPeopleState): string {
  const total = people.importedCount === null ? '' : `из ${people.importedCount} импортированных`;
  const date = people.importedAt ? ` (${formatObservedDate(people.importedAt)})` : '';
  return `Контактов в вашей сети нет: ${total || 'в импорте'}${date} никто не работает в этой компании.`;
}

function searching(props: CompanyMobilePushProps): boolean {
  return props.busySearch || ['queued', 'running'].includes(props.company.recruiterSearchStatus);
}

function searchText(props: CompanyMobilePushProps): string {
  if (!props.searchConsentGranted) return SEARCH_CONSENT_TEXT;
  if (['ready', 'failed'].includes(props.company.recruiterSearchStatus))
    return 'В объявлениях и публичных профилях рекрутера не нашли. Поиск можно повторить.';
  return 'Рекрутер не найден. В объявлениях и публичных профилях имени нет, но это не значит, что его нет: поищем среди сотрудников с ролью HR и Talent.';
}

function recruiterSearchCta(props: CompanyMobilePushProps): Cta | null {
  const { company } = props;
  if (company.vacancyCount === 0) return null;
  if (searching(props)) {
    return {
      icon: <MagnifyingGlass aria-hidden="true" />,
      label: 'Ищем рекрутера…',
      onClick: () => undefined,
      disabled: true,
    };
  }
  if (!props.searchConsentGranted) {
    return {
      icon: <MagnifyingGlass aria-hidden="true" />,
      label: 'Разрешить и найти',
      onClick: props.onAllowAndSearch,
    };
  }
  const retry = ['ready', 'failed'].includes(company.recruiterSearchStatus);
  return {
    icon: <MagnifyingGlass aria-hidden="true" />,
    label: retry ? 'Повторить поиск' : 'Найти рекрутера',
    onClick: props.onSearch,
  };
}

interface PeopleView {
  readonly body: ReactNode;
  readonly cta: Cta | null;
}

function networkPeople(props: CompanyMobilePushProps): PeopleView {
  const list = props.people.people;
  const first = list.find((person) => person.circle === 1) ?? list[0]!;
  const open = letter(props, first.vacancyId, first.circle);
  const sources = [...new Set(list.map((person) => person.source))].join('; ');
  return {
    body: (
      <section className="vacancy-push-group">
        <h3 className="vacancy-push-cap">Люди</h3>
        <div className="vacancy-push-list">
          {list.map((person) => (
            <Row
              key={person.id}
              title={person.fullName}
              sub={[person.roleTitle, person.relation].filter(Boolean).join(' · ')}
              aside={`Круг ${person.circle}`}
              onClick={letter(props, person.vacancyId, person.circle)}
            />
          ))}
        </div>
        <p className="vacancy-push-foot">Источник: {sources}.</p>
      </section>
    ),
    cta: open
      ? {
          icon:
            first.circle === 1 ? (
              <EnvelopeSimple aria-hidden="true" />
            ) : (
              <UsersThree aria-hidden="true" />
            ),
          label:
            first.circle === 1
              ? `Написать ${dativeNameRu(first.fullName)}`
              : 'Попросить представить',
          onClick: open,
        }
      : null,
  };
}

function foundRecruiters(props: CompanyMobilePushProps): PeopleView {
  const list = props.company.recruiters;
  const first = list[0]!;
  const hypotheses = list.filter((person) => person.isHypothesis).length;
  const open = letter(props, first.vacancyId, 3);
  return {
    body: (
      <>
        {props.linkedin.contactsImported ? (
          <Note icon={<UsersThree aria-hidden="true" />}>{importNote(props.people)}</Note>
        ) : null}
        {hypotheses > 0 ? (
          <Note icon={<CheckCircle aria-hidden="true" />}>
            Найдено вероятных рекрутеров: {hypotheses}. Это предположение по должности и компании:
            проверьте профиль перед письмом.
          </Note>
        ) : null}
        <section className="vacancy-push-group">
          <h3 className="vacancy-push-cap">
            {hypotheses > 0 ? 'Вероятные рекрутеры' : 'Рекрутеры'}
          </h3>
          <div className="vacancy-push-list">
            {list.map((person) => (
              <Row
                key={person.id}
                title={person.fullName}
                sub={person.roleTitle}
                aside="Круг 3"
                onClick={letter(props, person.vacancyId, 3)}
              />
            ))}
          </div>
          <p className="vacancy-push-foot">
            Источник: {first.sourceLabel}, {formatObservedDate(first.sourceDate)}.
          </p>
        </section>
      </>
    ),
    cta: open
      ? {
          icon: <EnvelopeSimple aria-hidden="true" />,
          label: `Холодный отклик ${dativeNameRu(first.fullName)}`,
          onClick: open,
        }
      : null,
  };
}

function connectCta(props: CompanyMobilePushProps): Cta | null {
  if (!props.onOpenConnections) return null;
  return {
    icon: <SignIn aria-hidden="true" />,
    label: 'Подключить LinkedIn',
    onClick: props.onOpenConnections,
  };
}

function withoutLinkedIn(
  props: CompanyMobilePushProps,
  onWrite: (recruiter: CandidateCompanyRecruiter) => void,
): PeopleView {
  const recruiter = props.company.recruiters[0];
  const fromVacancy = recruiter?.source === 'vacancy';
  return {
    body: (
      <>
        <Note icon={<Info aria-hidden="true" />}>
          Контакты в вашей сети неизвестны: LinkedIn не подключён.
          {recruiter && fromVacancy ? ` Рекрутер ${recruiter.fullName} взят из объявления.` : ''}
        </Note>
        {recruiter ? (
          <div className="vacancy-push-list">
            <Row
              icon={<EnvelopeSimple aria-hidden="true" />}
              title="Написать рекрутеру"
              sub={recruiter.fullName}
              onClick={() => onWrite(recruiter)}
            />
          </div>
        ) : (
          <>
            {props.onOpenConnections ? (
              <div className="vacancy-push-list">
                <Row
                  icon={<SignIn aria-hidden="true" />}
                  title="Подключить LinkedIn"
                  onClick={props.onOpenConnections}
                />
              </div>
            ) : null}
            <RecruiterSearchSection props={props} />
          </>
        )}
      </>
    ),
    cta: recruiter ? connectCta(props) : recruiterSearchCta(props),
  };
}

function RecruiterSearchSection({ props }: { readonly props: CompanyMobilePushProps }) {
  if (props.company.vacancyCount === 0) return null;
  return (
    <section className="vacancy-push-group">
      <h3 className="vacancy-push-cap">Рекрутер</h3>
      {searching(props) ? (
        <p className="vacancy-push-foot" role="status" aria-busy="true">
          Ищем рекрутера по вакансиям компании и публичным профилям.
        </p>
      ) : (
        <Note icon={<Question aria-hidden="true" />}>{searchText(props)}</Note>
      )}
    </section>
  );
}

function noContacts(props: CompanyMobilePushProps): PeopleView {
  const imported = props.linkedin.contactsImported;
  return {
    body: (
      <>
        <Note icon={<UsersThree aria-hidden="true" />}>
          {imported
            ? importNote(props.people)
            : 'Контакты в вашей сети неизвестны: список связей LinkedIn не импортирован.'}
        </Note>
        <RecruiterSearchSection props={props} />
      </>
    ),
    cta: recruiterSearchCta(props),
  };
}

function peopleView(
  props: CompanyMobilePushProps,
  onWrite: (recruiter: CandidateCompanyRecruiter) => void,
): PeopleView {
  const { people, linkedin, company } = props;
  if (people.loading) {
    return {
      body: (
        <p className="vacancy-push-foot" role="status">
          Загружаем людей компании…
        </p>
      ),
      cta: null,
    };
  }
  if (people.error) {
    return {
      body: (
        <p className="vacancy-push-foot" role="alert">
          {people.error}{' '}
          <button type="button" className="vacancy-push-text" onClick={people.retry}>
            Повторить
          </button>
        </p>
      ),
      cta: null,
    };
  }
  if (people.people.length > 0) return networkPeople(props);
  if (linkedin.status === 'disconnected' && !linkedin.contactsImported)
    return withoutLinkedIn(props, onWrite);
  if (company.recruiters.length > 0) return foundRecruiters(props);
  return noContacts(props);
}

function useTopFocus() {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);
  return backRef;
}

function useEscape(onBack: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);
}

function PushBar({
  backRef,
  onBack,
}: {
  readonly backRef: RefObject<HTMLButtonElement>;
  readonly onBack: () => void;
}) {
  return (
    <header className="vacancy-push-bar">
      <button
        ref={backRef}
        type="button"
        className="vacancy-push-back"
        aria-label="Назад"
        onClick={onBack}
      >
        <CaretLeft size={20} aria-hidden="true" />
      </button>
      <h1 id="company-push-title">Компания</h1>
      <PushConsultantButton />
    </header>
  );
}

function PushCta({ cta }: { readonly cta: Cta | null }) {
  if (!cta) return null;
  return (
    <div className="vacancy-push-cta">
      <button
        type="button"
        className="vacancy-push-primary"
        disabled={cta.disabled}
        onClick={cta.onClick}
      >
        {cta.icon} {cta.label}
      </button>
    </div>
  );
}

/** 390 px (B439-r1, mockup 13 `?mv=main|none|found|noli`): a company opens as
 *  a push screen with grouped lists and one primary action at the bottom. */
export function CompanyMobilePush(props: CompanyMobilePushProps) {
  const [messageTo, setMessageTo] = useState<CandidateCompanyRecruiter | null>(null);
  const backRef = useTopFocus();
  useEscape(props.onBack);
  const { company, people } = props;
  const view = peopleView(props, setMessageTo);
  const nextStep = people.loading ? '' : companyNextStepText(company, people);
  return (
    <>
      <div className="vacancy-push-backdrop" aria-hidden="true" />
      <div className="vacancy-push company-push" role="dialog" aria-labelledby="company-push-title">
        <PushBar backRef={backRef} onBack={props.onBack} />
        <div className="vacancy-push-body">
          <div className="vacancy-push-hero">
            <h2>{company.name}</h2>
            {companyMeta(company) ? <p>{companyMeta(company)}</p> : null}
          </div>
          <WantBlock props={props} />
          {props.actionError ? (
            <p className="vacancy-push-foot" role="alert">
              {props.actionError}
            </p>
          ) : null}
          {nextStep ? <Note icon={<ArrowRight aria-hidden="true" />}>{nextStep}</Note> : null}
          <VacancyGroup props={props} />
          <section className="company-push-people" aria-label="Люди">
            {view.body}
          </section>
          {messageTo ? (
            <RecruiterMessagePanel contact={messageTo} onClose={() => setMessageTo(null)} />
          ) : null}
        </div>
        <PushCta cta={view.cta} />
      </div>
    </>
  );
}

import { useState } from 'react';
import {
  CheckCircle,
  CircleNotch,
  EnvelopeSimple,
  Info,
  LinkSimple,
  MagnifyingGlass,
  SignIn,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanyRecruiter,
} from '../../../shared/candidateCompany';
import { pluralRu } from '../../../shared/pluralRu';
import { RecruiterChannelList } from './RecruiterChannelList';
import { SEARCH_CONSENT_TEXT } from '../../../shared/searchConsent';
import {
  CompanyPeopleCards,
  toLetterTarget,
  type CompanyPeopleState,
} from './CompanyConnectionCircles';
import { formatObservedDate, companyInitial } from './companiesAndPeopleUtils';
import type { VacancyLetterTarget } from './VacancyLetterScreen';
import type { ConnectionCircleNumber } from './vacancyLetterApi';

type OpenLetter = (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;

export interface CompanyPeopleSectionProps {
  readonly company: CandidateCompanyOpportunity;
  readonly people: CompanyPeopleState;
  readonly linkedin: CandidateCompanyPage['linkedin'];
  readonly consentGranted: boolean;
  readonly consentRequired: boolean;
  readonly busySearch: boolean;
  readonly searchError: string | null;
  readonly onSearch: () => void;
  readonly onAllowAndSearch: () => void;
  readonly onOpenConnections?: () => void;
  readonly onOpenLetter?: OpenLetter;
  readonly onWriteRecruiter: (recruiter: CandidateCompanyRecruiter) => void;
}

const PEOPLE_HINT =
  'Люди компании из вашей сети: круг 1 — вы знакомы, круг 2 — вас может представить общий контакт, круг 3 — холодный отклик. Шанс ответа не показываем: откликов пока мало.';

function PeopleHeading() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="companies-people-section-heading">
        <h3 id="company-people-title">Люди</h3>
        <button
          type="button"
          className="companies-people-icon-button"
          aria-label="Пояснение"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Info aria-hidden="true" />
        </button>
      </div>
      {open ? <p className="companies-people-hint">{PEOPLE_HINT}</p> : null}
    </>
  );
}

function companyRecruiterVacancy(company: CandidateCompanyOpportunity, vacancyId: string) {
  return company.vacancies.find((item) => item.id === vacancyId) ?? company.vacancies[0];
}

function RecruiterCard({
  company,
  person,
  onOpenLetter,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly person: CandidateCompanyRecruiter;
  readonly onOpenLetter?: OpenLetter;
}) {
  const vacancy = companyRecruiterVacancy(company, person.vacancyId);
  return (
    <article className="companies-people-person" aria-label={person.fullName}>
      <span className="companies-people-avatar is-small" aria-hidden="true">
        {companyInitial(person.fullName)}
      </span>
      <div className="companies-people-person-body">
        <strong>{person.fullName}</strong>
        {person.source === 'public-profile' ? (
          <span>
            Должность в профиле: {person.roleTitle}, {company.name}
          </span>
        ) : (
          <span className="companies-people-person-role">{person.roleTitle}</span>
        )}
        <small>
          <LinkSimple aria-hidden="true" /> {person.sourceLabel},{' '}
          {formatObservedDate(person.sourceDate)}
        </small>
        <RecruiterChannelList channels={person.channels ?? []} />
        <div className="companies-people-actions">
          <span className="companies-people-circle-badge">Круг 3</span>
          {vacancy && onOpenLetter ? (
            <button
              type="button"
              className="companies-people-action"
              onClick={() => onOpenLetter(toLetterTarget(company.name, vacancy), 3)}
            >
              <EnvelopeSimple aria-hidden="true" /> Холодный отклик
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function recruiterOrigin(recruiters: readonly CandidateCompanyRecruiter[]): string {
  if (recruiters.some((person) => person.source !== 'public-profile')) {
    return 'в объявлениях и публичных профилях';
  }
  return recruiters.every((person) => /LinkedIn/u.test(person.sourceLabel))
    ? 'по публичным профилям LinkedIn'
    : 'по публичным профилям';
}

function RecruiterCards({
  company,
  onOpenLetter,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly onOpenLetter?: OpenLetter;
}) {
  const hypotheses = company.recruiters.filter((person) => person.isHypothesis);
  return (
    <>
      {hypotheses.length > 0 ? (
        <p className="companies-people-data-note" role="note">
          <CheckCircle aria-hidden="true" />
          <span>
            Найдено{' '}
            {pluralRu(hypotheses.length, [
              'вероятный рекрутер',
              'вероятных рекрутера',
              'вероятных рекрутеров',
            ])}{' '}
            {recruiterOrigin(hypotheses)}. Это предположение по должности и компании, не
            подтверждение: проверьте профиль перед письмом.
          </span>
        </p>
      ) : null}
      <div className="companies-people-person-list">
        {company.recruiters.map((person) => {
          return (
            <RecruiterCard
              key={person.id}
              company={company}
              person={person}
              onOpenLetter={onOpenLetter}
            />
          );
        })}
      </div>
    </>
  );
}

function RecruiterSearch(props: CompanyPeopleSectionProps) {
  const { company } = props;
  if (props.busySearch || ['queued', 'running'].includes(company.recruiterSearchStatus)) {
    return (
      <p className="companies-people-status" role="status" aria-busy="true">
        <CircleNotch className="career-spin" aria-hidden="true" /> Ищем рекрутера по вакансиям
        компании и публичным профилям.
      </p>
    );
  }
  if (company.vacancyCount === 0) {
    return (
      <p className="companies-people-empty">
        Нет вакансий компании в текущей подборке, поэтому искать рекрутера пока не по чему.
      </p>
    );
  }
  const needsConsent = props.consentRequired || !props.consentGranted;
  const retry = ['ready', 'failed'].includes(company.recruiterSearchStatus);
  return (
    <div className="companies-people-search-box">
      <div>
        <strong>Рекрутер компании не найден</strong>
        <p>
          {props.searchError ??
            (needsConsent
              ? SEARCH_CONSENT_TEXT
              : retry
                ? 'В объявлениях и публичных профилях рекрутера не нашли. Поиск можно повторить.'
                : 'В объявлениях имени нет. Это не значит, что рекрутера нет: поищем среди сотрудников с ролью HR и Talent.')}
        </p>
      </div>
      <button
        type="button"
        className="companies-people-action is-primary"
        disabled={props.busySearch}
        onClick={needsConsent ? props.onAllowAndSearch : props.onSearch}
      >
        <MagnifyingGlass aria-hidden="true" />{' '}
        {needsConsent ? 'Разрешить и найти' : retry ? 'Повторить поиск' : 'Найти рекрутера'}
      </button>
    </div>
  );
}

function NoLinkedInPeople(props: CompanyPeopleSectionProps) {
  const recruiter = props.company.recruiters[0];
  const fromVacancy = recruiter?.source === 'vacancy';
  return (
    <>
      <p className="companies-people-data-note" role="note">
        <Info aria-hidden="true" />
        <span>
          Контакты в вашей сети неизвестны: LinkedIn не подключён.
          {recruiter && fromVacancy ? ` Рекрутер ${recruiter.fullName} взят из объявления.` : ''}
        </span>
      </p>
      <div className="companies-people-actions">
        {props.onOpenConnections ? (
          <button
            type="button"
            className="companies-people-action is-primary"
            onClick={props.onOpenConnections}
          >
            <SignIn aria-hidden="true" /> Подключить LinkedIn
          </button>
        ) : null}
        {recruiter ? (
          <button
            type="button"
            className="companies-people-action"
            onClick={() => props.onWriteRecruiter(recruiter)}
          >
            <EnvelopeSimple aria-hidden="true" /> Написать рекрутеру
          </button>
        ) : null}
      </div>
      {!recruiter ? <RecruiterSearch {...props} /> : null}
    </>
  );
}

function NetworkNote({ props }: { readonly props: CompanyPeopleSectionProps }) {
  const { people, linkedin } = props;
  if (!linkedin.contactsImported) {
    return (
      <p className="companies-people-data-note" role="note">
        <Info aria-hidden="true" />
        <span>Контакты в вашей сети неизвестны: список связей LinkedIn не импортирован.</span>
      </p>
    );
  }
  const total = people.importedCount === null ? '' : ` из ${people.importedCount} импортированных`;
  const date = people.importedAt ? ` (${formatObservedDate(people.importedAt)})` : '';
  return (
    <p className="companies-people-plain-note">
      <UsersThree aria-hidden="true" /> Контактов в вашей сети нет: {total.trim() || 'в импорте'}
      {date} никто не работает в этой компании.
    </p>
  );
}

function PeopleContent(props: CompanyPeopleSectionProps) {
  const { people, company, linkedin } = props;
  if (people.loading) {
    return (
      <p className="companies-people-status" role="status" aria-busy="true">
        <CircleNotch className="career-spin" aria-hidden="true" /> Загружаем людей компании…
      </p>
    );
  }
  if (people.error) {
    return (
      <p className="companies-people-error" role="alert">
        <WarningCircle aria-hidden="true" /> {people.error}{' '}
        <button type="button" className="companies-people-action" onClick={people.retry}>
          Повторить
        </button>
      </p>
    );
  }
  if (people.people.length > 0) {
    return (
      <CompanyPeopleCards
        company={company}
        people={people.people}
        onOpenLetter={props.onOpenLetter}
      />
    );
  }
  if (linkedin.status === 'disconnected' && !linkedin.contactsImported) {
    return <NoLinkedInPeople {...props} />;
  }
  return (
    <>
      <NetworkNote props={props} />
      {company.recruiters.length > 0 ? (
        <RecruiterCards company={company} onOpenLetter={props.onOpenLetter} />
      ) : (
        <RecruiterSearch {...props} />
      )}
    </>
  );
}

function latestDate(values: readonly (string | null | undefined)[]): string | null {
  const latest = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

function PeopleFooter(props: CompanyPeopleSectionProps) {
  const imported = props.linkedin.contactsImported;
  const date = latestDate([
    ...props.company.sources.map((source) => source.observedAt),
    ...props.company.recruiters.map((person) => person.sourceDate),
    imported ? props.people.importedAt : null,
  ]);
  return (
    <p className="companies-people-footer">
      Данные: объявления, публичные профили{imported ? ' и ваш импорт контактов' : ''}
      {date ? ` · ${formatObservedDate(date)}` : ''}
    </p>
  );
}

export function CompanyPeopleSection(props: CompanyPeopleSectionProps) {
  return (
    <section className="companies-people-section" aria-labelledby="company-people-title">
      <PeopleHeading />
      <PeopleContent {...props} />
      <PeopleFooter {...props} />
    </section>
  );
}

import { useEffect, useState } from 'react';
import { EnvelopeSimple, LinkSimple, UsersThree } from '@phosphor-icons/react';
import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
import {
  groupCompanyPeople,
  type CompanyPeople,
  type CompanyPerson,
  companyInitial,
} from './companiesAndPeopleUtils';
import {
  getVacancyConnectionCircles,
  type ConnectionCircleNumber,
  type VacancyConnectionCircles as VacancyCircles,
} from './vacancyLetterApi';
import type { VacancyLetterTarget } from './VacancyLetterScreen';

type CompanyVacancy = CandidateCompanyOpportunity['vacancies'][number];

export interface CompanyPeopleState extends CompanyPeople {
  readonly importedAt: string | null;
  readonly importedCount: number | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

export function toLetterTarget(companyName: string, vacancy: CompanyVacancy): VacancyLetterTarget {
  return {
    id: vacancy.id,
    canonicalTitle: vacancy.title,
    canonicalCompany: companyName,
    canonicalLocation: vacancy.location,
    isRemote: null,
    sources: [{ sourceName: vacancy.sourceName }],
    descriptionSummary: '',
    primaryUrl: vacancy.href,
  };
}

/** B448 paths for the company's top three vacancies, grouped into people (B439). */
export function useCompanyPeople(company: CandidateCompanyOpportunity): CompanyPeopleState {
  const vacancyKey = company.vacancies
    .slice(0, 3)
    .map(({ id }) => id)
    .join('\u0000');
  const [responses, setResponses] = useState<readonly VacancyCircles[]>([]);
  const [loading, setLoading] = useState(vacancyKey.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const ids = vacancyKey ? vacancyKey.split('\u0000') : [];
    let active = true;
    setResponses([]);
    setError(null);
    setLoading(ids.length > 0);
    if (ids.length === 0) return undefined;
    void Promise.all(ids.map(getVacancyConnectionCircles))
      .then((result) => {
        if (active) setResponses(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить связи.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [company.key, retryKey, vacancyKey]);

  const imported = responses.find((item) => item.linkedinImport.state === 'imported');
  return {
    ...groupCompanyPeople(responses),
    importedAt: imported?.linkedinImport.importedAt ?? null,
    importedCount: imported?.linkedinImport.importedCount ?? null,
    loading,
    error,
    retry: () => setRetryKey((current) => current + 1),
  };
}

function PersonCard({
  person,
  company,
  onOpenLetter,
}: {
  readonly person: CompanyPerson;
  readonly company: CandidateCompanyOpportunity;
  readonly onOpenLetter?: (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
}) {
  const vacancy = company.vacancies.find((item) => item.id === person.vacancyId);
  const Icon = person.circle === 1 ? EnvelopeSimple : UsersThree;
  return (
    <article className="companies-people-person" aria-label={person.fullName}>
      <span className="companies-people-avatar is-small" aria-hidden="true">
        {companyInitial(person.fullName)}
      </span>
      <div className="companies-people-person-body">
        <strong>{person.fullName}</strong>
        <span className="companies-people-person-role">
          {person.roleTitle ?? 'Роль не указана'}
        </span>
        <span>{person.relation}</span>
        <small>
          <LinkSimple aria-hidden="true" /> {person.source}
        </small>
        <div className="companies-people-actions">
          <span className="companies-people-circle-badge">Круг {person.circle}</span>
          {vacancy && onOpenLetter ? (
            <button
              type="button"
              className="companies-people-action"
              onClick={() => onOpenLetter(toLetterTarget(company.name, vacancy), person.circle)}
            >
              <Icon aria-hidden="true" /> {person.action}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function CompanyPeopleCards({
  company,
  people,
  onOpenLetter,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly people: readonly CompanyPerson[];
  readonly onOpenLetter?: (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
}) {
  return (
    <div className="companies-people-person-list">
      {people.map((person) => (
        <PersonCard key={person.id} person={person} company={company} onOpenLetter={onOpenLetter} />
      ))}
    </div>
  );
}

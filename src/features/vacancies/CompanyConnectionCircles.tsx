import { useEffect, useState } from 'react';
import { CircleNotch, Info, WarningCircle } from '@phosphor-icons/react';
import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
import { formatObservedDate } from './companiesAndPeopleUtils';
import {
  getVacancyConnectionCircles,
  type ConnectionCircleNumber,
  type ConnectionCirclePath,
  type ConnectionCircleResult,
  type VacancyConnectionCircles as VacancyCircles,
} from './vacancyLetterApi';
import type { VacancyLetterTarget } from './VacancyLetterScreen';

interface CompanyConnectionPath {
  readonly vacancyId: string;
  readonly data: VacancyCircles;
  readonly circle: ConnectionCircleResult;
  readonly path: ConnectionCirclePath;
}

function actionLabel(nextStep: ConnectionCirclePath['nextStep']): string {
  if (nextStep === 'write_known_contact') return 'Написать знакомому';
  if (nextStep === 'ask_for_introduction') return 'Попросить представить';
  return 'Холодный отклик';
}

function strengthLabel(strength: ConnectionCirclePath['strength']): string {
  if (strength === 'direct') return 'Связь прямая';
  if (strength === 'strong') return 'Связь подтверждена';
  if (strength === 'weak') return 'Слабая связь';
  return 'Сила связи неизвестна';
}

function sourceLabel(source: ConnectionCirclePath['source']): string {
  if (source === 'linkedin_import') return 'Импорт контактов';
  if (source === 'work_history') return 'История работы';
  if (source === 'manual') return 'Добавлено вручную';
  return 'Холодный отклик';
}

function toLetterTarget(
  companyName: string,
  vacancy: CandidateCompanyOpportunity['vacancies'][number],
): VacancyLetterTarget {
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

function useCompanyConnectionCircles(company: CandidateCompanyOpportunity) {
  const vacancyIds = company.vacancies.slice(0, 3).map(({ id }) => id);
  const vacancyKey = vacancyIds.join('\u0000');
  const [responses, setResponses] = useState<readonly VacancyCircles[]>([]);
  const [loading, setLoading] = useState(vacancyIds.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const ids = vacancyKey ? vacancyKey.split('\u0000') : [];
    let active = true;
    if (ids.length === 0) {
      setResponses([]);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError(null);
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

  return { responses, loading, error, retry: () => setRetryKey((current) => current + 1) };
}

function collectPaths(responses: readonly VacancyCircles[]): CompanyConnectionPath[] {
  const unique = new Map<string, CompanyConnectionPath>();
  for (const data of responses) {
    for (const circle of data.circles) {
      for (const path of circle.paths) {
        const key = `${path.circle}:${path.recipient.id || path.id}`;
        if (!unique.has(key)) unique.set(key, { vacancyId: data.vacancyId, data, circle, path });
      }
    }
  }
  return [...unique.values()];
}

function CirclePathCard({
  item,
  vacancy,
  companyName,
  onOpenLetter,
}: {
  readonly item: CompanyConnectionPath;
  readonly vacancy: CandidateCompanyOpportunity['vacancies'][number];
  readonly companyName: string;
  readonly onOpenLetter?: (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
}) {
  const { path, circle, data } = item;
  const contactChain = path.path.map((contact) => contact.fullName).filter(Boolean);
  return (
    <article className="companies-people-circle-path">
      <div>
        <strong>{path.recipient.fullName}</strong>
        <span>
          {path.recipient.roleTitle ?? 'Роль не указана'} · Круг {path.circle}
        </span>
      </div>
      {contactChain.length ? <p>Путь через: {contactChain.join(' → ')}</p> : null}
      <p>{path.evidence.join(' · ') || circle.message}</p>
      <small>
        {strengthLabel(path.strength)} · {sourceLabel(path.source)}
        {data.linkedinImport.importedAt
          ? `, ${formatObservedDate(data.linkedinImport.importedAt)}`
          : ''}
      </small>
      {onOpenLetter ? (
        <button
          type="button"
          className="companies-people-action"
          onClick={() => onOpenLetter(toLetterTarget(companyName, vacancy), path.circle)}
        >
          {actionLabel(path.nextStep)}
        </button>
      ) : (
        <p className="companies-people-data-note">Переход к письму недоступен из этого раздела.</p>
      )}
    </article>
  );
}

function CirclePathList({
  company,
  paths,
  onOpenLetter,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly paths: readonly CompanyConnectionPath[];
  readonly onOpenLetter?: (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
}) {
  const vacancyById = new Map(company.vacancies.map((vacancy) => [vacancy.id, vacancy]));
  return (
    <div className="companies-people-circle-paths">
      {paths.map((item) => {
        const vacancy = vacancyById.get(item.vacancyId);
        return vacancy ? (
          <CirclePathCard
            key={`${item.vacancyId}:${item.path.id}`}
            item={item}
            vacancy={vacancy}
            companyName={company.name}
            onOpenLetter={onOpenLetter}
          />
        ) : null;
      })}
    </div>
  );
}

function NoCompanyConnections({ unknown }: { readonly unknown: boolean }) {
  return (
    <p className="companies-people-data-note" role="status">
      <Info aria-hidden="true" />{' '}
      {unknown
        ? 'Связи неизвестны: импорт контактов не подтверждён.'
        : 'В импортированных контактах связи с людьми этой компании не найдены.'}
    </p>
  );
}

function CompanyConnectionCircleContent({
  company,
  onOpenLetter,
  responses,
  loading,
  error,
  retry,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly onOpenLetter?: (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
  readonly responses: readonly VacancyCircles[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}) {
  const paths = collectPaths(responses);
  const noKnownPaths = responses.length > 0 && paths.length === 0;
  const connectionsUnknown = responses.some((item) => item.linkedinImport.state === 'unknown');

  if (loading) {
    return (
      <p className="companies-people-status" role="status" aria-busy="true">
        <CircleNotch className="career-spin" aria-hidden="true" /> Загружаем пути связи…
      </p>
    );
  }
  if (error) {
    return (
      <p className="companies-people-error" role="alert">
        <WarningCircle aria-hidden="true" /> {error}{' '}
        <button type="button" className="companies-people-action" onClick={retry}>
          Повторить
        </button>
      </p>
    );
  }
  if (company.vacancies.length === 0) {
    return <p className="companies-people-empty">Нет вакансий, чтобы построить пути к людям.</p>;
  }
  return noKnownPaths ? (
    <NoCompanyConnections unknown={connectionsUnknown} />
  ) : (
    <CirclePathList company={company} paths={paths} onOpenLetter={onOpenLetter} />
  );
}

export function CompanyConnectionCircles({
  company,
  onOpenLetter,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly onOpenLetter?: (target: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
}) {
  const state = useCompanyConnectionCircles(company);
  const connectionDataUnknown =
    !state.loading &&
    !state.error &&
    state.responses.length > 0 &&
    collectPaths(state.responses).length === 0 &&
    state.responses.every((item) => item.linkedinImport.state === 'unknown');
  if (company.vacancies.length === 0 || connectionDataUnknown) return null;
  return (
    <section className="companies-people-circles" aria-label="Связи с людьми компании">
      <h4>Пути к людям компании</h4>
      <CompanyConnectionCircleContent company={company} onOpenLetter={onOpenLetter} {...state} />
    </section>
  );
}

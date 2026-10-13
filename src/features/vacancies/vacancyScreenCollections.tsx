import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ApplicationView } from '../applications/applicationsApi';
import {
  createApplication,
  listApplications,
  patchApplication,
  restoreApplicationFromArchive,
} from '../applications/applicationsApi';
import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import {
  getCandidateCompanyPage,
  removeCandidateCompanyWant,
  setCandidateCompanyWant,
} from './candidateCompaniesApi';

export interface VacancyCollectionInput {
  readonly matched: readonly MatchedVacancyItem[];
  readonly savedVacancies?: readonly ApplicationView[];
  readonly companiesCount?: number;
}

export interface VacancyCollectionsState {
  readonly applications: readonly ApplicationView[];
  readonly savedApplications: readonly ApplicationView[];
  readonly savedLoading: boolean;
  readonly savedError?: string;
  readonly companiesCount?: number;
  readonly companiesLoading: boolean;
  readonly companyByName: ReadonlyMap<string, CandidateCompanyOpportunity | null>;
  readonly savedBusyIds: ReadonlySet<string>;
  readonly companyBusyNames: ReadonlySet<string>;
  readonly actionError?: string;
  readonly retry: () => void;
  readonly toggleSaved: (cluster: MatchedVacancyItem['cluster']) => Promise<void>;
  readonly removeSaved: (application: ApplicationView) => Promise<void>;
  readonly toggleCompanyWant: (companyName?: string) => Promise<void>;
}

export function companyLookupKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[\p{P}\p{S}\s]/gu, '');
}

function vacancySavedSnapshot(cluster: MatchedVacancyItem['cluster']): VacancyApplicationSnapshot {
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    url: cluster.primaryUrl,
    source: cluster.sources[0]?.sourceId ?? '',
  };
}

function findCompanyByName(
  items: readonly CandidateCompanyOpportunity[],
  companyName: string,
): CandidateCompanyOpportunity | null {
  const key = companyLookupKey(companyName);
  return items.find((item) => companyLookupKey(item.name) === key) ?? null;
}

function replaceApplicationRecord(
  applications: readonly ApplicationView[],
  updated: ApplicationView,
): readonly ApplicationView[] {
  return applications.some((item) => item.id === updated.id)
    ? applications.map((item) => item.id === updated.id ? updated : item)
    : [...applications, updated];
}

async function loadCompanyMatches(
  names: readonly string[],
  firstPage: readonly CandidateCompanyOpportunity[],
): Promise<ReadonlyMap<string, CandidateCompanyOpportunity | null>> {
  const entries = await Promise.all(names.map(async (name) => {
    const existing = findCompanyByName(firstPage, name);
    if (existing) return [companyLookupKey(name), existing] as const;
    try {
      const page = await getCandidateCompanyPage({ search: name });
      return [companyLookupKey(name), findCompanyByName(page.items, name)] as const;
    } catch {
      return [companyLookupKey(name), null] as const;
    }
  }));
  return new Map(entries);
}

async function persistSavedVacancy(
  cluster: MatchedVacancyItem['cluster'],
  applications: readonly ApplicationView[],
): Promise<ApplicationView> {
  const existing = applications.find((item) => item.clusterId === cluster.id);
  if (existing?.stage === 'saved') {
    return patchApplication(existing.id, { expectedVersion: existing.version, stage: 'archived' });
  }
  if (existing?.stage === 'archived' && existing.archivePreviousStage === 'saved') {
    return restoreApplicationFromArchive(existing.id, existing.version);
  }
  if (existing) throw new Error('Вакансия уже связана с карточкой отклика.');
  return createApplication({
    clusterId: cluster.id,
    manualVacancy: vacancySavedSnapshot(cluster),
    stage: 'saved',
  });
}

async function persistRemoveSavedVacancy(application: ApplicationView): Promise<ApplicationView> {
  return patchApplication(application.id, {
    expectedVersion: application.version,
    stage: 'archived',
  });
}

async function resolveCompanyRecord(
  companyName: string,
  companyByName: ReadonlyMap<string, CandidateCompanyOpportunity | null>,
): Promise<CandidateCompanyOpportunity> {
  const known = companyByName.get(companyLookupKey(companyName));
  if (known) return known;
  const page = await getCandidateCompanyPage({ search: companyName });
  const found = findCompanyByName(page.items, companyName);
  if (!found) throw new Error('Компанию пока нельзя добавить в список «Хочу».');
  return found;
}

async function persistCompanyWant(
  company: CandidateCompanyOpportunity,
): Promise<CandidateCompanyOpportunity> {
  if (company.want) await removeCandidateCompanyWant(company.key);
  else await setCandidateCompanyWant(company.key);
  return { ...company, want: !company.want };
}

function readableCollectionError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function uniqueVisibleCompanyNames(items: readonly MatchedVacancyItem[]): string[] {
  return [...new Set(items.slice(0, 20)
    .map((item) => item.cluster.canonicalCompany?.trim())
    .filter((name): name is string => Boolean(name)))];
}

function useSavedApplications(
  initial: readonly ApplicationView[] | undefined,
  reloadToken: number,
) {
  const [items, setItems] = useState<readonly ApplicationView[]>(initial ?? []);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (initial) {
      setItems(initial);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void listApplications().then((next) => {
      if (active) { setItems(next); setError(undefined); setLoading(false); }
    }).catch((reason: unknown) => {
      if (active) { setError(readableCollectionError(reason, 'Не удалось загрузить сохранённые вакансии.')); setLoading(false); }
    });
    return () => { active = false; };
  }, [initial, reloadToken]);
  return { items, setItems, loading: initial === undefined && loading, error };
}

function useCompanyRecords(input: VacancyCollectionInput, reloadToken: number) {
  const [count, setCount] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [companyByName, setCompanyByName] = useState<
    ReadonlyMap<string, CandidateCompanyOpportunity | null>
  >(new Map());
  useEffect(() => {
    let active = true;
    setLoading(true);
    const names = uniqueVisibleCompanyNames(input.matched);
    void getCandidateCompanyPage({ offset: 0 }).then(async (page) => {
      const matches = await loadCompanyMatches(names, page.items);
      if (active) { setCount(page.total); setCompanyByName(matches); }
    }).catch(() => {
      if (active) setCount(undefined);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [input.matched, reloadToken]);
  return { count, loading, companyByName, setCompanyByName };
}

function useSavedVacancyActions(
  applications: readonly ApplicationView[],
  setApplications: Dispatch<SetStateAction<readonly ApplicationView[]>>,
  setActionError: (error?: string) => void,
) {
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = async (cluster: MatchedVacancyItem['cluster']) => {
    const key = cluster.id;
    setBusyIds((ids) => new Set(ids).add(key));
    setActionError(undefined);
    try {
      const updated = await persistSavedVacancy(cluster, applications);
      setApplications((items) => replaceApplicationRecord(items, updated));
    } catch (reason) {
      setActionError(readableCollectionError(reason, 'Не удалось изменить сохранённые вакансии.'));
    } finally {
      setBusyIds((ids) => new Set([...ids].filter((id) => id !== key)));
    }
  };
  const remove = async (application: ApplicationView) => {
    const key = application.clusterId ?? application.id;
    setBusyIds((ids) => new Set(ids).add(key));
    setActionError(undefined);
    try {
      const updated = await persistRemoveSavedVacancy(application);
      setApplications((items) => replaceApplicationRecord(items, updated));
    } catch (reason) {
      setActionError(readableCollectionError(reason, 'Не удалось убрать вакансию из сохранённых.'));
    } finally {
      setBusyIds((ids) => new Set([...ids].filter((id) => id !== key)));
    }
  };
  return { busyIds, toggle, remove };
}

function useCompanyWantAction(
  companyByName: ReadonlyMap<string, CandidateCompanyOpportunity | null>,
  setCompanyByName: Dispatch<SetStateAction<ReadonlyMap<string, CandidateCompanyOpportunity | null>>>,
  setActionError: (error?: string) => void,
) {
  const [busyNames, setBusyNames] = useState<ReadonlySet<string>>(new Set());
  const toggle = async (companyName?: string) => {
    if (!companyName?.trim()) { setActionError('Название компании не указано.'); return; }
    const key = companyLookupKey(companyName);
    setBusyNames((names) => new Set(names).add(key));
    setActionError(undefined);
    try {
      const record = await resolveCompanyRecord(companyName, companyByName);
      const updated = await persistCompanyWant(record);
      setCompanyByName((records) => new Map(records).set(key, updated));
    } catch (reason) {
      setActionError(readableCollectionError(reason, 'Не удалось изменить список «Хочу».'));
    } finally {
      setBusyNames((names) => new Set([...names].filter((name) => name !== key)));
    }
  };
  return { busyNames, toggle };
}

export function useVacancyCollections(input: VacancyCollectionInput): VacancyCollectionsState {
  const [reloadToken, setReloadToken] = useState(0);
  const [actionError, setActionError] = useState<string>();
  const saved = useSavedApplications(input.savedVacancies, reloadToken);
  const companies = useCompanyRecords(input, reloadToken);
  const saveAction = useSavedVacancyActions(saved.items, saved.setItems, setActionError);
  const companyAction = useCompanyWantAction(companies.companyByName, companies.setCompanyByName, setActionError);
  const applications = input.savedVacancies ?? saved.items;
  return {
    applications,
    savedApplications: applications.filter((application) => application.stage === 'saved'),
    savedLoading: saved.loading,
    savedError: saved.error,
    companiesCount: input.companiesCount ?? companies.count,
    companiesLoading: companies.loading,
    companyByName: companies.companyByName,
    savedBusyIds: saveAction.busyIds,
    companyBusyNames: companyAction.busyNames,
    actionError,
    retry: () => setReloadToken((token) => token + 1),
    toggleSaved: saveAction.toggle,
    removeSaved: saveAction.remove,
    toggleCompanyWant: companyAction.toggle,
  };
}

function savedVacancyHref(application: ApplicationView): string | undefined {
  const value = application.vacancy?.url;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function SavedVacancyRow({
  application,
  busy,
  onRemove,
}: {
  readonly application: ApplicationView;
  readonly busy: boolean;
  readonly onRemove: (application: ApplicationView) => void;
}) {
  const vacancy = application.vacancy;
  const href = savedVacancyHref(application);
  return (
    <li className="vac-list-item">
      <article className="vac-saved-card">
        <h3>{vacancy?.title ?? 'Название вакансии не сохранено'}</h3>
        <p>{vacancy?.company || 'Компания не указана'}</p>
        <div className="career-vacancy-actions">
          {href ? <a className="career-vacancy-action" href={href} target="_blank" rel="noreferrer">На площадке</a> : <span>Ссылка на площадку не сохранена.</span>}
          <button
            type="button"
            className="career-vacancy-action"
            disabled={busy}
            onClick={() => onRemove(application)}
          >
            {busy ? 'Убираем…' : 'Убрать из сохранённых'}
          </button>
        </div>
      </article>
    </li>
  );
}

function SavedVacanciesSearch({
  count,
  query,
  onChange,
}: {
  readonly count: number;
  readonly query: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="career-field">
      <span>Компания или роль среди {count} сохранённых</span>
      <input
        type="search"
        aria-label={`Компания или роль среди ${count} сохранённых`}
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

export function SavedVacanciesPanel({ collections }: { readonly collections: VacancyCollectionsState }) {
  const [query, setQuery] = useState('');
  const saved = collections.savedApplications;
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const visible = saved.filter((application) => {
    const text = `${application.vacancy?.title ?? ''} ${application.vacancy?.company ?? ''}`;
    return text.toLocaleLowerCase('ru-RU').includes(normalizedQuery);
  });
  return (
    <section className="vacancies-saved-panel" aria-label="Сохранённые вакансии">
      <header className="vacancies-saved-header">
        <h2>Сохранённые вакансии · {saved.length}</h2>
        <SavedVacanciesSearch count={saved.length} query={query} onChange={setQuery} />
      </header>
      {collections.actionError ? <p role="alert">{collections.actionError}</p> : null}
      {collections.savedError ? (
        <div role="alert">
          <p>{collections.savedError}</p>
          <button type="button" className="career-vacancy-action" onClick={collections.retry}>Повторить</button>
        </div>
      ) : null}
      {collections.savedLoading ? <p aria-live="polite">Загружаем сохранённые вакансии…</p> : null}
      {!collections.savedLoading && !saved.length ? <p>Сохранённых вакансий пока нет.</p> : null}
      {!collections.savedLoading && saved.length > 0 && !visible.length ? <p>По этому запросу сохранённых вакансий нет.</p> : null}
      <ul className="vac-list">
        {visible.map((application) => (
          <SavedVacancyRow
            key={application.id}
            application={application}
            busy={collections.savedBusyIds.has(application.clusterId ?? application.id)}
            onRemove={(value) => void collections.removeSaved(value)}
          />
        ))}
      </ul>
    </section>
  );
}

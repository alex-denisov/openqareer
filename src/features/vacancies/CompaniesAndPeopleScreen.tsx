import { useCallback, useEffect, useRef, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import type {
  CandidateCompanyDetails,
  CandidateCompanyFilter,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanySort,
} from '../../../shared/candidateCompany';
import { pluralRu } from '../../../shared/pluralRu';
import { CoachApiError } from '../coach/apiClient';
import { grantSearchConsent } from './recruiterContactsApi';
import {
  getCandidateCompanyDetails,
  getCandidateCompanyPage,
  removeCandidateCompanyWant,
  searchCandidateCompanyRecruiter,
  setCandidateCompanyWant,
} from './candidateCompaniesApi';
import './companies-and-people.css';
import { CompanyDetailPanel } from './CompanyDetailPanel';
import type { VacancyLetterTarget } from './VacancyLetterScreen';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import {
  CompanyFilterSheet,
  CompanyList,
  CompanyLoadingState,
  CompanyToolbar,
} from './CompaniesAndPeopleControls';
import { isContactImportStale, readableError } from './companiesAndPeopleUtils';

const COMPANY_ORDER_NOTE: Record<CandidateCompanySort, string> = {
  default: 'Порядок: «Хочу», затем по числу вакансий, контактов в сети и алфавиту.',
  contacts: 'Порядок: по числу контактов в сети, затем по алфавиту.',
  alphabetical: 'Порядок: по алфавиту.',
};

interface CompaniesAndPeopleScreenProps {
  readonly onOpenConnections?: () => void;
  readonly onOpenCareer?: () => void;
  readonly onOpenLetter?: (vacancy: VacancyLetterTarget, circle: ConnectionCircleNumber) => void;
  /** «Все N вакансий компании в подборке»: the selection filtered by this company. */
  readonly onOpenCompanyVacancies?: (companyName: string) => void;
  readonly initialSearch?: string;
}

interface CompanyListState {
  readonly page: CandidateCompanyPage | null;
  readonly items: readonly CandidateCompanyOpportunity[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly reload: () => void;
  readonly loadMore: () => Promise<void>;
}

interface CompanyDetailState {
  readonly detail: CandidateCompanyDetails | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly reload: () => void;
  readonly loadMore: () => Promise<void>;
}

function mergeCompanyDetail(
  current: CandidateCompanyDetails | null,
  next: CandidateCompanyDetails,
  companyKey: string,
): CandidateCompanyDetails {
  return current && current.company.key === companyKey
    ? { ...next, vacancies: [...current.vacancies, ...next.vacancies] }
    : next;
}

function useCompanyList(
  search: string,
  sort: CandidateCompanySort,
  filter: CandidateCompanyFilter,
): CompanyListState {
  const [page, setPage] = useState<CandidateCompanyPage | null>(null);
  const [items, setItems] = useState<readonly CandidateCompanyOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getCandidateCompanyPage({ offset: 0, sort, filter, search })
      .then((next) => {
        if (!active) return;
        setPage(next);
        setItems(next.items);
      })
      .catch((reason: unknown) => {
        if (active) setError(readableError(reason, 'Не удалось загрузить компании.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, revision, search, sort]);

  const loadMore = async () => {
    if (!page || items.length >= page.total || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await getCandidateCompanyPage({ offset: items.length, sort, filter, search });
      setItems((current) => [...current, ...next.items]);
      setPage(next);
    } catch (reason) {
      setError(readableError(reason, 'Не удалось показать следующую часть списка.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return { page, items, loading, loadingMore, error, reload, loadMore };
}

function useCompanyDetail(companyKey: string | null): CompanyDetailState {
  const [detail, setDetail] = useState<CandidateCompanyDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    if (!companyKey) {
      setDetail(null);
      setError(null);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError(null);
    void getCandidateCompanyDetails(companyKey)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(readableError(reason, 'Не удалось открыть компанию.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companyKey, revision]);

  const loadMore = async () => {
    if (!companyKey || !detail?.nextOffset || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await getCandidateCompanyDetails(companyKey, detail.nextOffset);
      setDetail((current) => mergeCompanyDetail(current, next, companyKey));
    } catch (reason) {
      setError(readableError(reason, 'Не удалось показать все вакансии.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return { detail, loading, loadingMore, error, reload, loadMore };
}

interface CompanyFiltersState {
  readonly sort: CandidateCompanySort;
  readonly filter: CandidateCompanyFilter;
  readonly searchInput: string;
  readonly search: string;
  readonly setSort: (sort: CandidateCompanySort) => void;
  readonly setFilter: (filter: CandidateCompanyFilter) => void;
  readonly setSearchInput: (search: string) => void;
}

function useCompanyFilters(initialSearch?: string): CompanyFiltersState {
  const [sort, setSort] = useState<CandidateCompanySort>('default');
  const [filter, setFilter] = useState<CandidateCompanyFilter>('all');
  const [searchInput, setSearchInput] = useState(initialSearch ?? '');
  const [search, setSearch] = useState(initialSearch?.trim() ?? '');
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 200);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  useEffect(() => {
    if (!initialSearch?.trim()) return;
    setSearchInput(initialSearch);
    setSearch(initialSearch.trim());
  }, [initialSearch]);
  return { sort, filter, searchInput, search, setSort, setFilter, setSearchInput };
}

function useCompanySelection(
  items: readonly CandidateCompanyOpportunity[],
  preferredName?: string,
) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The company named by «Путь к компании» opens once: «Назад» must not reopen it.
  const usedPreferred = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!items.length) {
      if (selectedKey) setSelectedKey(null);
      return;
    }
    if (selectedKey && items.some((company) => company.key === selectedKey)) return;
    if (preferredName?.trim() && usedPreferred.current !== preferredName) {
      const preferred = items.find((company) =>
        company.name.toLocaleLowerCase('ru-RU').includes(preferredName.toLocaleLowerCase('ru-RU')),
      );
      if (preferred) {
        usedPreferred.current = preferredName;
        setSelectedKey(preferred.key);
        return;
      }
    }
    if (window.innerWidth >= 761) setSelectedKey(items[0]!.key);
    else if (selectedKey) setSelectedKey(null);
  }, [items, preferredName, selectedKey]);
  return { selectedKey, setSelectedKey };
}

function useCompanyWantAction(refresh: () => void) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (company: CandidateCompanyOpportunity) => {
    setBusyKey(company.key);
    setError(null);
    try {
      if (company.want) await removeCandidateCompanyWant(company.key);
      else await setCandidateCompanyWant(company.key);
      refresh();
    } catch (reason) {
      setError(readableError(reason, 'Не удалось изменить список «Хочу».'));
    } finally {
      setBusyKey(null);
    }
  };
  return { busyKey, error, toggle };
}

async function queueCompanyRecruiterSearch(
  companyKey: string,
  onConsentRequired: () => void,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    await searchCandidateCompanyRecruiter(companyKey);
    return true;
  } catch (reason) {
    if (reason instanceof CoachApiError && reason.code === 'search_consent_required') {
      onConsentRequired();
    } else {
      onError(readableError(reason, 'Не удалось запустить поиск рекрутёра.'));
    }
    return false;
  }
}

function useCompanyRecruiterSearch(refresh: () => void) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentRequiredKey, setConsentRequiredKey] = useState<string | null>(null);
  const [consentOverride, setConsentOverride] = useState<boolean | null>(null);
  const search = async (companyKey: string) => {
    setBusyKey(companyKey);
    setError(null);
    setConsentRequiredKey(null);
    try {
      if (
        await queueCompanyRecruiterSearch(
          companyKey,
          () => setConsentRequiredKey(companyKey),
          setError,
        )
      )
        refresh();
    } finally {
      setBusyKey(null);
    }
  };
  const allowAndSearch = async (companyKey: string) => {
    setBusyKey(companyKey);
    setError(null);
    try {
      await grantSearchConsent();
      setConsentOverride(true);
      if (
        await queueCompanyRecruiterSearch(
          companyKey,
          () => setConsentRequiredKey(companyKey),
          setError,
        )
      ) {
        setConsentRequiredKey(null);
        refresh();
      }
    } catch (reason) {
      setError(readableError(reason, 'Не удалось сохранить согласие или запустить поиск.'));
    } finally {
      setBusyKey(null);
    }
  };
  return { busyKey, error, consentRequiredKey, consentOverride, search, allowAndSearch };
}

interface CompaniesAndPeopleModel {
  readonly filters: CompanyFiltersState;
  readonly page: CompanyListState;
  readonly detail: CompanyDetailState;
  readonly selectedKey: string | null;
  readonly setSelectedKey: (key: string | null) => void;
  readonly selected: CandidateCompanyOpportunity | null;
  readonly linkedin: CandidateCompanyPage['linkedin'];
  readonly consentGranted: boolean;
  readonly consentRequiredKey: string | null;
  readonly filterSheetOpen: boolean;
  readonly setFilterSheetOpen: (open: boolean) => void;
  readonly wantAction: ReturnType<typeof useCompanyWantAction>;
  readonly recruiterSearch: ReturnType<typeof useCompanyRecruiterSearch>;
  readonly actionError: string | null;
  readonly refresh: () => void;
  readonly onOpenCompanyVacancies?: (companyName: string) => void;
}

function useCompaniesAndPeopleModel(
  initialSearch?: string,
  onOpenCompanyVacancies?: (companyName: string) => void,
): CompaniesAndPeopleModel {
  const filters = useCompanyFilters(initialSearch);
  const page = useCompanyList(filters.search, filters.sort, filters.filter);
  const selection = useCompanySelection(page.items, initialSearch);
  const detail = useCompanyDetail(selection.selectedKey);
  const reloadPage = page.reload;
  const reloadDetail = detail.reload;
  const refresh = useCallback(() => {
    reloadPage();
    reloadDetail();
  }, [reloadDetail, reloadPage]);
  const wantAction = useCompanyWantAction(refresh);
  const recruiterSearch = useCompanyRecruiterSearch(refresh);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const detailedCompany =
    detail.detail?.company.key === selection.selectedKey ? detail.detail.company : null;
  return {
    filters,
    page,
    detail,
    selectedKey: selection.selectedKey,
    setSelectedKey: selection.setSelectedKey,
    selected:
      detailedCompany ??
      page.items.find((company) => company.key === selection.selectedKey) ??
      null,
    linkedin: page.page?.linkedin ?? {
      status: 'disconnected',
      importedAt: null,
      contactsImported: false,
    },
    consentGranted: recruiterSearch.consentOverride ?? page.page?.searchConsentGranted ?? false,
    consentRequiredKey: recruiterSearch.consentRequiredKey,
    filterSheetOpen,
    setFilterSheetOpen,
    wantAction,
    recruiterSearch,
    actionError: wantAction.error ?? recruiterSearch.error,
    refresh,
    onOpenCompanyVacancies,
  };
}

function SelectedCompanyDetail({
  model,
  selected,
  onOpenConnections,
  onOpenLetter,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly selected: CandidateCompanyOpportunity;
  readonly onOpenConnections?: () => void;
  readonly onOpenLetter?: CompaniesAndPeopleScreenProps['onOpenLetter'];
}) {
  const {
    detail,
    linkedin,
    consentGranted,
    consentRequiredKey,
    wantAction,
    recruiterSearch,
    actionError,
    setSelectedKey,
  } = model;
  return (
    <CompanyDetailPanel
      company={selected}
      detail={detail.detail}
      linkedin={linkedin}
      searchConsentGranted={consentGranted}
      consentRequired={consentRequiredKey === selected.key}
      detailLoading={detail.loading}
      detailError={detail.error}
      actionError={actionError}
      busyWant={wantAction.busyKey === selected.key}
      busySearch={recruiterSearch.busyKey === selected.key}
      onBack={() => setSelectedKey(null)}
      onOpenConnections={onOpenConnections}
      onOpenLetter={onOpenLetter}
      onOpenCompanyVacancies={model.onOpenCompanyVacancies}
      onToggleWant={() => void wantAction.toggle(selected)}
      onSearch={() => void recruiterSearch.search(selected.key)}
      onAllowAndSearch={() => void recruiterSearch.allowAndSearch(selected.key)}
    />
  );
}

function CompanyResults({
  model,
  onOpenConnections,
  onOpenLetter,
  onOpenCareer,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly onOpenConnections?: () => void;
  readonly onOpenLetter?: CompaniesAndPeopleScreenProps['onOpenLetter'];
  readonly onOpenCareer?: () => void;
}) {
  const { page, selected } = model;
  if (page.loading && page.items.length === 0) return <CompanyLoadingState />;
  if (page.error) return null;
  return (
    <div className={`companies-people-layout${selected ? ' is-detail' : ''}`}>
      <CompanyListColumn model={model} onOpenCareer={onOpenCareer} />
      {selected ? (
        <SelectedCompanyDetail
          model={model}
          selected={selected}
          onOpenConnections={onOpenConnections}
          onOpenLetter={onOpenLetter}
        />
      ) : null}
    </div>
  );
}

function CompanyListColumn({
  model,
  onOpenCareer,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly onOpenCareer?: () => void;
}) {
  const { page, selectedKey, filters } = model;
  return (
    <div>
      <CompanyList
        companies={page.items}
        selectedKey={selectedKey}
        filter={filters.filter}
        allCount={page.page?.filterCounts.all ?? 0}
        search={filters.search}
        onSelect={model.setSelectedKey}
        onOpenCareer={onOpenCareer}
        onWantsChanged={page.reload}
      />
      {page.page && page.items.length > 0 ? (
        <p className="companies-people-list-footer">
          Показано {page.items.length} из {page.page.total}. {COMPANY_ORDER_NOTE[filters.sort]}
        </p>
      ) : null}
      {page.items.length < (page.page?.total ?? 0) ? (
        <button
          type="button"
          className="companies-people-load-more"
          disabled={page.loadingMore}
          onClick={() => void page.loadMore()}
        >
          {page.loadingMore ? 'Загружаем…' : 'Показать ещё 20'}
        </button>
      ) : null}
    </div>
  );
}

function CompaniesAndPeopleView({
  model,
  onOpenConnections,
  onOpenLetter,
  onOpenCareer,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly onOpenConnections?: () => void;
  readonly onOpenLetter?: CompaniesAndPeopleScreenProps['onOpenLetter'];
  readonly onOpenCareer?: () => void;
}) {
  const { filters, page, setFilterSheetOpen } = model;
  const counts = visibleCompanyFilterCounts(page);
  return (
    <section className="companies-and-people" aria-label="Компании и люди">
      <CompanyToolbarView
        filters={filters}
        counts={counts}
        onOpenFilters={() => setFilterSheetOpen(true)}
      />
      <CompanyDirectorySummary page={page} />
      <CompanyActionErrors model={model} />
      <CompanyResults
        model={model}
        onOpenConnections={onOpenConnections}
        onOpenLetter={onOpenLetter}
        onOpenCareer={onOpenCareer}
      />
      <CompanyFilterSheetView model={model} counts={counts} />
    </section>
  );
}

function visibleCompanyFilterCounts(page: CompanyListState): CandidateCompanyPage['filterCounts'] {
  const counts = page.page?.filterCounts ?? { all: 0, want: 0, contacts: null, recruiter: 0 };
  const linkedin = page.page?.linkedin;
  return linkedin?.contactsImported && isContactImportStale(linkedin.importedAt)
    ? { ...counts, contacts: null }
    : counts;
}

function CompanyToolbarView({
  filters,
  counts,
  onOpenFilters,
}: {
  readonly filters: CompanyFiltersState;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onOpenFilters: () => void;
}) {
  return (
    <CompanyToolbar
      search={filters.searchInput}
      total={counts.all}
      sort={filters.sort}
      filter={filters.filter}
      filterCounts={counts}
      onSearch={filters.setSearchInput}
      onSort={filters.setSort}
      onFilter={filters.setFilter}
      onOpenFilters={onOpenFilters}
    />
  );
}

function CompanyDirectorySummary({ page }: { readonly page: CompanyListState }) {
  return (
    <p className="companies-people-count" aria-live="polite">
      {page.page
        ? `${pluralRu(page.page.total, ['компания', 'компании', 'компаний'])} в подборке`
        : 'Загружаем компании…'}
    </p>
  );
}

function CompanyActionErrors({ model }: { readonly model: CompaniesAndPeopleModel }) {
  return (
    <>
      <CompanyPageError error={model.page.error} onRetry={model.page.reload} />
      {model.actionError ? (
        <p className="companies-people-error" role="alert">
          {model.actionError}
        </p>
      ) : null}
    </>
  );
}

function CompanyFilterSheetView({
  model,
  counts,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly counts: CandidateCompanyPage['filterCounts'];
}) {
  const { filters, filterSheetOpen, setFilterSheetOpen } = model;
  return (
    <CompanyFilterSheet
      open={filterSheetOpen}
      filter={filters.filter}
      sort={filters.sort}
      counts={counts}
      onClose={() => setFilterSheetOpen(false)}
      onApply={(filter, sort) => {
        filters.setFilter(filter);
        filters.setSort(sort);
      }}
    />
  );
}

function CompanyPageError({
  error,
  onRetry,
}: {
  readonly error: string | null;
  readonly onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div className="companies-people-error" role="alert">
      <Warning aria-hidden="true" /> {error}
      <button type="button" className="companies-people-action" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function CompaniesAndPeopleScreen({
  onOpenConnections,
  onOpenLetter,
  onOpenCareer,
  onOpenCompanyVacancies,
  initialSearch,
}: CompaniesAndPeopleScreenProps) {
  const model = useCompaniesAndPeopleModel(initialSearch, onOpenCompanyVacancies);
  return (
    <CompaniesAndPeopleView
      model={model}
      onOpenConnections={onOpenConnections}
      onOpenLetter={onOpenLetter}
      onOpenCareer={onOpenCareer}
    />
  );
}

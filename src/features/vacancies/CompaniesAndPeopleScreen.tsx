import { useCallback, useEffect, useState } from 'react';
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
  saveCandidateCompanyNextStep,
  searchCandidateCompanyRecruiter,
  setCandidateCompanyWant,
} from './candidateCompaniesApi';
import './companies-and-people.css';
import { CompanyDetailPanel } from './CompanyDetailPanel';
import {
  CompanyFilterSheet,
  CompanyList,
  CompanyLoadingState,
  CompanyToolbar,
} from './CompaniesAndPeopleControls';
import { readableError } from './companiesAndPeopleUtils';

interface CompaniesAndPeopleScreenProps {
  readonly onOpenConnections?: () => void;
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

function useCompanyFilters(): CompanyFiltersState {
  const [sort, setSort] = useState<CandidateCompanySort>('default');
  const [filter, setFilter] = useState<CandidateCompanyFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 200);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  return { sort, filter, searchInput, search, setSort, setFilter, setSearchInput };
}

function useCompanySelection(items: readonly CandidateCompanyOpportunity[]) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!items.length) {
      if (selectedKey) setSelectedKey(null);
      return;
    }
    if (selectedKey && items.some((company) => company.key === selectedKey)) return;
    if (window.innerWidth >= 761) setSelectedKey(items[0]!.key);
    else if (selectedKey) setSelectedKey(null);
  }, [items, selectedKey]);
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

function useCompanyNextStepAction(refresh: () => void) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const save = async (companyKey: string, text: string, dueAt: string | null) => {
    setBusyKey(companyKey);
    try {
      await saveCandidateCompanyNextStep(companyKey, text, dueAt);
      refresh();
    } catch (reason) {
      throw new Error(readableError(reason, 'Не удалось сохранить следующий шаг.'));
    } finally {
      setBusyKey(null);
    }
  };
  return { busyKey, save };
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
  readonly nextStepAction: ReturnType<typeof useCompanyNextStepAction>;
  readonly recruiterSearch: ReturnType<typeof useCompanyRecruiterSearch>;
  readonly actionError: string | null;
  readonly refresh: () => void;
}

function useCompaniesAndPeopleModel(): CompaniesAndPeopleModel {
  const filters = useCompanyFilters();
  const page = useCompanyList(filters.search, filters.sort, filters.filter);
  const selection = useCompanySelection(page.items);
  const detail = useCompanyDetail(selection.selectedKey);
  const reloadPage = page.reload;
  const reloadDetail = detail.reload;
  const refresh = useCallback(() => {
    reloadPage();
    reloadDetail();
  }, [reloadDetail, reloadPage]);
  const wantAction = useCompanyWantAction(refresh);
  const nextStepAction = useCompanyNextStepAction(refresh);
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
    nextStepAction,
    recruiterSearch,
    actionError: wantAction.error ?? recruiterSearch.error,
    refresh,
  };
}

function SelectedCompanyDetail({
  model,
  selected,
  onOpenConnections,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly selected: CandidateCompanyOpportunity;
  readonly onOpenConnections?: () => void;
}) {
  const {
    detail,
    linkedin,
    consentGranted,
    consentRequiredKey,
    wantAction,
    nextStepAction,
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
      detailLoadingMore={detail.loadingMore}
      detailError={detail.error}
      actionError={actionError}
      busyWant={wantAction.busyKey === selected.key}
      busySearch={recruiterSearch.busyKey === selected.key}
      busyNextStep={nextStepAction.busyKey === selected.key}
      onBack={() => setSelectedKey(null)}
      onOpenConnections={onOpenConnections}
      onLoadMoreVacancies={() => void detail.loadMore()}
      onToggleWant={() => void wantAction.toggle(selected)}
      onSaveNextStep={(text, dueAt) => nextStepAction.save(selected.key, text, dueAt)}
      onSearch={() => void recruiterSearch.search(selected.key)}
      onAllowAndSearch={() => void recruiterSearch.allowAndSearch(selected.key)}
    />
  );
}

function CompanyResults({
  model,
  onOpenConnections,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly onOpenConnections?: () => void;
}) {
  const { page, selected, selectedKey, setSelectedKey, wantAction } = model;
  return (
    <>
      {page.loading && page.items.length === 0 ? <CompanyLoadingState /> : null}
      {!page.loading && !page.error ? (
        <div className={`companies-people-layout${selected ? ' is-detail' : ''}`}>
          <div>
            <CompanyList
              companies={page.items}
              selectedKey={selectedKey}
              busyKey={wantAction.busyKey}
              onSelect={setSelectedKey}
              onToggleWant={(company) => void wantAction.toggle(company)}
            />
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
          {selected ? (
            <SelectedCompanyDetail
              model={model}
              selected={selected}
              onOpenConnections={onOpenConnections}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CompaniesAndPeopleView({
  model,
  onOpenConnections,
}: {
  readonly model: CompaniesAndPeopleModel;
  readonly onOpenConnections?: () => void;
}) {
  const { filters, page, filterSheetOpen, setFilterSheetOpen } = model;
  const counts = page.page?.filterCounts ?? { all: 0, want: 0, contacts: null, recruiter: 0 };
  return (
    <section className="companies-and-people" aria-label="Компании и люди">
      <CompanyToolbar
        search={filters.searchInput}
        sort={filters.sort}
        filter={filters.filter}
        filterCounts={counts}
        onSearch={filters.setSearchInput}
        onSort={filters.setSort}
        onFilter={filters.setFilter}
        onOpenFilters={() => setFilterSheetOpen(true)}
      />
      <p className="companies-people-count" aria-live="polite">
        {page.page
          ? `${pluralRu(page.page.total, ['компания', 'компании', 'компаний'])} в текущей подборке`
          : 'Загружаем компании…'}
      </p>
      <CompanyPageError error={page.error} onRetry={page.reload} />
      {model.actionError ? (
        <p className="companies-people-error" role="alert">
          {model.actionError}
        </p>
      ) : null}
      <CompanyResults model={model} onOpenConnections={onOpenConnections} />
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
    </section>
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

export function CompaniesAndPeopleScreen({ onOpenConnections }: CompaniesAndPeopleScreenProps) {
  const model = useCompaniesAndPeopleModel();
  return <CompaniesAndPeopleView model={model} onOpenConnections={onOpenConnections} />;
}

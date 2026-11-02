import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantPage,
  CandidateCompanyWantSelectionItem,
  CandidateCompanyWantStage,
} from '../../../shared/candidateCompany';
import {
  executeCompanyWantBulk,
  previewCompanyWantBulk,
  type CompanyWantBulkAction,
  type CompanyWantBulkItem,
} from './applicationsApi';
import {
  DEFAULT_COMPANY_WANT_QUERY,
  getCompanyWantPage,
  getCompanyWantSelection,
  searchCompanyWantPaths,
  type CompanyWantQuery,
} from './companyWantsApi';
import { downloadCompanyWantsCsv, toSelectionItem } from './companyWantsModel';

type Selection = readonly CandidateCompanyWantSelectionItem[];

export interface PendingRemoval {
  readonly items: Selection;
}

export interface CompanyWantsController {
  readonly query: CompanyWantQuery;
  readonly setQuery: (patch: Partial<CompanyWantQuery>) => void;
  readonly draftSearch: string;
  readonly setDraftSearch: (value: string) => void;
  readonly page?: CandidateCompanyWantPage;
  readonly items: readonly CandidateCompanyOpportunity[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string;
  readonly message: string;
  readonly retry: () => void;
  readonly loadMore: () => void;
  readonly selected: Selection;
  readonly isSelected: (key: string) => boolean;
  readonly toggleOne: (company: CandidateCompanyOpportunity) => void;
  readonly togglePage: () => void;
  readonly selectAllByFilter: () => void;
  readonly clearSelection: () => void;
  readonly findPaths: (items: Selection) => void;
  readonly changeStage: (items: Selection, stage: CandidateCompanyWantStage) => void;
  readonly changeNextStep: (items: Selection, text: string) => void;
  readonly exportItems: (items: Selection) => void;
  readonly requestRemoval: (items: Selection) => void;
  readonly pendingRemoval: PendingRemoval | null;
  readonly confirmRemoval: () => void;
  readonly cancelRemoval: () => void;
  readonly addCompanies: (names: readonly string[]) => Promise<boolean>;
}

const SEARCH_DEBOUNCE_MS = 300;

function bulkItems(
  items: Selection,
  extra: Partial<CompanyWantBulkItem> = {},
): CompanyWantBulkItem[] {
  return items.map((item) => ({ companyName: item.name, ...extra }));
}

/** Preview gives the exact count the server will change; execute confirms that count. */
async function runBulk(action: CompanyWantBulkAction, companies: CompanyWantBulkItem[]) {
  const preview = await previewCompanyWantBulk(action, companies);
  if (preview.affectedCount === 0) return 0;
  const result = await executeCompanyWantBulk(action, companies, preview.affectedCount);
  return result.changedCount;
}

function useCompanyWantPage(query: CompanyWantQuery) {
  const [page, setPage] = useState<CandidateCompanyWantPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(
    async (offset: number) => {
      const id = ++request.current;
      setLoading(true);
      setError('');
      try {
        const next = await getCompanyWantPage(query, offset);
        if (id !== request.current) return;
        setPage((current) =>
          offset > 0 && current ? { ...next, items: [...current.items, ...next.items] } : next,
        );
      } catch {
        if (id === request.current)
          setError('Не удалось загрузить список компаний. Повторите запрос.');
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    void load(0);
  }, [load]);
  return { page, loading, error, setError, load };
}

function useDebouncedSearch(setQuery: (patch: Partial<CompanyWantQuery>) => void) {
  const [draftSearch, setDraftSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery({ search: draftSearch.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftSearch, setQuery]);
  return { draftSearch, setDraftSearch };
}

function useSelection(items: readonly CandidateCompanyOpportunity[]) {
  const [selected, setSelected] = useState<Selection>([]);
  const isSelected = useCallback(
    (key: string) => selected.some((item) => item.key === key),
    [selected],
  );
  const toggleOne = useCallback((company: CandidateCompanyOpportunity) => {
    setSelected((current) =>
      current.some((item) => item.key === company.key)
        ? current.filter((item) => item.key !== company.key)
        : [...current, toSelectionItem(company)],
    );
  }, []);
  const togglePage = useCallback(() => {
    setSelected((current) => {
      const pageKeys = new Set(items.map((company) => company.key));
      const allOnPage =
        items.length > 0 &&
        items.every((company) => current.some((item) => item.key === company.key));
      if (allOnPage) return current.filter((item) => !pageKeys.has(item.key));
      const missing = items.filter((company) => !current.some((item) => item.key === company.key));
      return [...current, ...missing.map(toSelectionItem)];
    });
  }, [items]);
  return { selected, setSelected, isSelected, toggleOne, togglePage };
}

export function useCompanyWants(): CompanyWantsController {
  const [query, setQueryState] = useState<CompanyWantQuery>(DEFAULT_COMPANY_WANT_QUERY);
  const setQuery = useCallback((patch: Partial<CompanyWantQuery>) => {
    setQueryState((current) => {
      const next = { ...current, ...patch };
      return Object.keys(patch).every(
        (key) => current[key as keyof CompanyWantQuery] === next[key as keyof CompanyWantQuery],
      )
        ? current
        : next;
    });
  }, []);
  const search = useDebouncedSearch(setQuery);
  const { page, loading, error, setError, load } = useCompanyWantPage(query);
  const items = page?.items ?? [];
  const selection = useSelection(items);
  const actions = useCompanyWantActions(query, selection.setSelected, setError, () => load(0));
  return {
    query,
    setQuery,
    ...search,
    page,
    items,
    loading,
    error,
    retry: () => void load(0),
    loadMore: () => void load(items.length),
    selected: selection.selected,
    isSelected: selection.isSelected,
    toggleOne: selection.toggleOne,
    togglePage: selection.togglePage,
    clearSelection: () => selection.setSelected([]),
    ...actions,
  };
}

function useCompanyWantActions(
  query: CompanyWantQuery,
  setSelected: (items: Selection) => void,
  setError: (message: string) => void,
  reload: () => Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const run = useCallback(
    async (task: () => Promise<string>, failure: string, clear = true) => {
      setBusy(true);
      setError('');
      setMessage('');
      try {
        setMessage(await task());
        if (clear) setSelected([]);
        await reload();
        return true;
      } catch {
        setError(failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload, setError, setSelected],
  );
  return {
    busy,
    message,
    pendingRemoval,
    selectAllByFilter: () => void selectByFilter(query, setSelected, setMessage, setError, setBusy),
    exportItems: (items: Selection) => void exportCsv(items, setMessage, setError),
    requestRemoval: (items: Selection) => setPendingRemoval(items.length ? { items } : null),
    cancelRemoval: () => setPendingRemoval(null),
    confirmRemoval: () => {
      const items = pendingRemoval?.items ?? [];
      setPendingRemoval(null);
      void run(
        async () => `Убрано из «Хочу»: ${await runBulk('remove', bulkItems(items))}.`,
        'Состав списка изменился. Обновите данные и повторите.',
      );
    },
    ...bulkHandlers(run),
  };
}

type RunTask = (task: () => Promise<string>, failure: string, clear?: boolean) => Promise<boolean>;

function bulkHandlers(run: RunTask) {
  return {
    findPaths: (items: Selection) =>
      void run(async () => {
        const result = await searchCompanyWantPaths(items.map((item) => item.key));
        return pathsMessage(result.queuedCount, result.skippedCount);
      }, 'Поиск путей не запущен. Проверьте режим «Вы в поиске» и повторите.'),
    changeStage: (items: Selection, stage: CandidateCompanyWantStage) =>
      void run(
        async () => `Статус изменён: ${await runBulk('set_stage', bulkItems(items, { stage }))}.`,
        'Не удалось сменить статус. Обновите список и повторите.',
      ),
    changeNextStep: (items: Selection, text: string) =>
      void run(async () => {
        const changed = await runBulk('set_next_step', bulkItems(items, { nextStep: text.trim() }));
        return `Следующий шаг сохранён: ${changed}.`;
      }, 'Не удалось сохранить следующий шаг. Повторите запрос.'),
    addCompanies: (names: readonly string[]) =>
      run(
        async () => {
          const added = await runBulk(
            'add',
            names.map((companyName) => ({ companyName })),
          );
          return `Добавлено компаний: ${added}.`;
        },
        'Не удалось добавить компании. Повторите запрос.',
        false,
      ),
  };
}

async function exportCsv(
  items: Selection,
  setMessage: (message: string) => void,
  setError: (message: string) => void,
) {
  try {
    await downloadCompanyWantsCsv(items);
    setMessage(`Выгружено компаний: ${items.length}.`);
  } catch {
    setError('Не удалось сохранить файл. Повторите экспорт.');
  }
}

function pathsMessage(queued: number, skipped: number): string {
  const base = `Поиск пути запущен для ${queued}`;
  return skipped > 0 ? `${base}. Без вакансий в подборке, пропущено: ${skipped}.` : `${base}.`;
}

async function selectByFilter(
  query: CompanyWantQuery,
  setSelected: (items: Selection) => void,
  setMessage: (message: string) => void,
  setError: (message: string) => void,
  setBusy: (busy: boolean) => void,
) {
  setBusy(true);
  setError('');
  try {
    const result = await getCompanyWantSelection(query);
    setSelected(result.items);
    setMessage(
      result.total > result.items.length
        ? `Выбраны первые ${result.items.length} из ${result.total}: за раз обрабатывается до ${result.items.length}.`
        : '',
    );
  } catch {
    setError('Не удалось выбрать компании по фильтру. Повторите запрос.');
  } finally {
    setBusy(false);
  }
}

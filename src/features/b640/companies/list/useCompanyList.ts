import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type {
  CandidateCompanyFilter,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanySort,
} from '../../../../../shared/candidateCompany';
import { getCandidateCompanyPage } from '../../../vacancies/candidateCompaniesApi';
import { appendPage, withWant, withWantCount } from './listModel';

const SEARCH_DELAY_MS = 300;

export type ListLoad = 'loading' | 'ready' | 'error';

export interface CompanyListQuery {
  readonly search: string;
  readonly sort: CandidateCompanySort;
  readonly filter: CandidateCompanyFilter;
}

export interface CompanyList {
  readonly load: ListLoad;
  readonly items: readonly CandidateCompanyOpportunity[];
  readonly total: number;
  readonly counts: CandidateCompanyPage['filterCounts'] | undefined;
  readonly query: CompanyListQuery;
  readonly moreBusy: boolean;
  readonly moreFailed: boolean;
  readonly setSearch: (search: string) => void;
  readonly setSort: (sort: CandidateCompanySort) => void;
  readonly setFilter: (filter: CandidateCompanyFilter) => void;
  readonly retry: () => void;
  readonly loadMore: () => Promise<void>;
  readonly markWant: (key: string, want: boolean) => void;
}

interface Loaded {
  readonly items: readonly CandidateCompanyOpportunity[];
  readonly total: number;
  readonly counts: CandidateCompanyPage['filterCounts'] | undefined;
}

const EMPTY: Loaded = { items: [], total: 0, counts: undefined };

/** Запрос, который уходит на сервер: поиск — с задержкой ввода, остальное — сразу. */
function useAskedQuery(query: CompanyListQuery): CompanyListQuery {
  const [asked, setAsked] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query), query.search === asked.search ? 0 : SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, asked.search]);
  return asked;
}

interface FirstPage {
  readonly loaded: Loaded;
  readonly setLoaded: Dispatch<SetStateAction<Loaded>>;
  readonly load: ListLoad;
  readonly generation: MutableRefObject<number>;
  readonly retry: () => void;
}

/** Первая порция под текущий запрос; ответ устаревшего запроса не применяется. */
function useFirstPage(asked: CompanyListQuery): FirstPage {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [load, setLoad] = useState<ListLoad>('loading');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoad('loading');
    getCandidateCompanyPage({ offset: 0, ...asked })
      .then((page) => {
        if (current !== generation.current) return;
        setLoaded({ items: page.items, total: page.total, counts: page.filterCounts });
        setLoad('ready');
      })
      .catch(() => {
        if (current === generation.current) setLoad('error');
      });
  }, [asked, attempt]);
  return { loaded, setLoaded, load, generation, retry: () => setAttempt((value) => value + 1) };
}

/** Компании подборки порциями по 20: поиск, сортировка и быстрый фильтр читаются сервером. */
export function useCompanyList(): CompanyList {
  const [query, setQuery] = useState<CompanyListQuery>({ search: '', sort: 'default', filter: 'all' });
  const asked = useAskedQuery(query);
  const first = useFirstPage(asked);
  const { loaded, setLoaded, generation } = first;
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  const loadMore = useCallback(async () => {
    const current = generation.current;
    setMoreBusy(true);
    setMoreFailed(false);
    try {
      const page = await getCandidateCompanyPage({ offset: loaded.items.length, ...asked });
      if (current !== generation.current) return;
      setLoaded((before) => ({ ...before, items: appendPage(before.items, page.items), total: page.total }));
    } catch {
      setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }, [asked, generation, loaded.items.length, setLoaded]);

  const markWant = useCallback(
    (key: string, want: boolean) => setLoaded((before) => markedWant(before, key, want)),
    [setLoaded],
  );

  return {
    load: first.load,
    items: loaded.items,
    total: loaded.total,
    counts: loaded.counts,
    query,
    moreBusy,
    moreFailed,
    setSearch: (search) => setQuery((before) => ({ ...before, search })),
    setSort: (sort) => setQuery((before) => ({ ...before, sort })),
    setFilter: (filter) => setQuery((before) => ({ ...before, filter })),
    retry: first.retry,
    loadMore,
    markWant,
  };
}

function markedWant(before: Loaded, key: string, want: boolean): Loaded {
  return {
    ...before,
    items: withWant(before.items, key, want),
    counts: before.counts ? withWantCount(before.counts, want ? 1 : -1) : before.counts,
  };
}

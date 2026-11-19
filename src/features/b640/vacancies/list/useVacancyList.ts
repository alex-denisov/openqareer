import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchedPool } from '../../../vacancies/useMatchedPool';
import { useMatchedPool } from '../../../vacancies/useMatchedPool';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { linkedRole } from '../../career/careerPaths';
import { useShell } from '../../shell/ShellContext';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { MoneyCurrency } from '../format';
import type { VacancyLinks } from '../vacancyLinks';
import {
  EMPTY_FILTERS,
  applyFilters,
  blockersOf,
  type Blocker,
  type FilterKind,
  type ListFilters,
} from './filterModel';
import { defaultRoles } from './defaultRoles';
import { buildOptions, listCount, type FilterOptions } from './filterOptions';
import {
  useServerSortedList,
  type ServerListStatus,
  type ServerSortedList,
} from './useServerSortedList';
import { usePreferredMoneyCurrency } from '../../account/usePreferredMoneyCurrency';
import {
  PAGE_SIZE,
  DEFAULT_LIST_SORT,
  nextSort,
  serverSortApplies,
  serverFoot,
  sortItems,
  visibleSlice,
  type SortKey,
  type SortState,
} from './sortModel';

export interface VacancyList {
  readonly pool: MatchedPool;
  readonly links: VacancyLinks;
  readonly rates?: CurrencyRates;
  readonly filters: ListFilters;
  readonly setFilters: (filters: ListFilters) => void;
  readonly resetFilters: () => void;
  readonly currency: MoneyCurrency;
  readonly setCurrency: (currency: MoneyCurrency) => void;
  readonly sort: SortState;
  readonly toggleSort: (key: SortKey) => void;
  readonly openKind: FilterKind | null;
  readonly setOpenKind: (kind: FilterKind | null) => void;
  readonly sheetOpen: boolean;
  readonly setSheetOpen: (open: boolean) => void;
  readonly options: FilterOptions;
  /** Подходящие вакансии без скрытых, в порядке сортировки. */
  readonly all: readonly MatchedVacancyItem[];
  readonly visible: readonly MatchedVacancyItem[];
  readonly count: number;
  readonly blockers: readonly Blocker[];
  readonly showMore: () => void;
  /** Подвал «Показать ещё»: всего и показано (в серверном режиме — прочитано с сервера). */
  readonly more: { readonly total: number | null; readonly shown: number };
  /** `false`: число в шапке было бы меньше реального (серверный режим с клиентскими фильтрами). */
  readonly countKnown: boolean;
  /** Подборка прочитана не целиком и выбран столбец: строки и порядок отдаёт сервер. */
  readonly server: {
    readonly active: boolean;
    readonly status: ServerListStatus;
    readonly retry: () => void;
  };
  readonly noRole: boolean;
}

/**
 * Роли читает сервер; пока выбор ролей не менялся, повторного чтения нет.
 * Роль из адреса (B726, «Вакансии по роли» из «Карьеры») ставится только на этот заход,
 * сохранённый выбор не заменяет.
 */
function useServerRoles(
  pool: MatchedPool,
  roles: readonly string[],
  seed: (roles: readonly string[]) => void,
): void {
  const linked = linkedRole(useShell().search);
  const sent = useRef('');
  const seeded = useRef(false);
  const initial = pool.initialFilters;
  const campaign = pool.campaign;
  useEffect(() => {
    if (seeded.current) return;
    // «Вакансии по роли» из «Карьеры» (B726): подборка открывается с этой ролью в фильтре.
    if (linked) {
      seeded.current = true;
      seed([linked]);
      return;
    }
    if (!initial && !campaign) return;
    seeded.current = true;
    // Сервер уже отдал подборку с сохранёнными ролями; роли «Карьеры» подборку ещё не сузили.
    sent.current = (initial?.roles ?? []).join('\n');
    const start = defaultRoles(initial?.roles, campaign?.roles);
    if (start.length > 0) seed(start);
  }, [initial, campaign, seed, linked]);
  const key = roles.join('\n');
  useEffect(() => {
    if (key === sent.current) return;
    // Кандидат выбрал роли сам — сохранённый выбор сервера их уже не заменит.
    seeded.current = true;
    sent.current = key;
    pool.setFilters?.({ roles: [...roles], regions: [], remoteOnly: false });
  }, [key]);
}

interface RowsInput {
  readonly pool: MatchedPool;
  readonly hidden: ReadonlySet<string>;
  readonly filters: ListFilters;
  readonly currency: MoneyCurrency;
  readonly rates?: CurrencyRates;
  readonly now: Date;
  readonly sortState: SortState | null;
  readonly serverMode: boolean;
  readonly server: ServerSortedList;
  readonly shown: number;
}

type DerivedRows = Pick<
  VacancyList,
  'options' | 'all' | 'visible' | 'count' | 'blockers' | 'more' | 'countKnown'
>;

type FilterContext = Parameters<typeof applyFilters>[2];

function useBlockers(
  empty: boolean,
  base: readonly MatchedVacancyItem[],
  filters: ListFilters,
  context: FilterContext,
): readonly Blocker[] {
  const { currency, rates, now } = context;
  return useMemo(() => (empty ? blockersOf(base, filters, context) : []), [empty, base, filters, currency, rates, now]);
}

/** Выбраны фильтры, которые считает клиент (локации, формат, деньги, дата, релокация): сервер их не знает. */
export function isNarrowed(filters: ListFilters): boolean {
  const { locations, formats, reloc, moneyFrom, date } = filters;
  return locations.length > 0 || formats.length > 0 || reloc || moneyFrom !== null || date !== 'any';
}

/** Строки списка: источник (пул или порции сервера), фильтры, сортировка, число и подвал. */
function useListRows(input: RowsInput): DerivedRows {
  const { pool, hidden, filters, currency, rates, now, sortState, serverMode, server, shown } =
    input;
  const poolBase = useMemo(() => pool.matched.filter((item) => !hidden.has(item.cluster.id)), [pool.matched, hidden]);
  const base = useMemo(
    () => (serverMode ? server.rows.filter((item) => !hidden.has(item.cluster.id)) : poolBase),
    [serverMode, server.rows, poolBase, hidden],
  );
  const all = useMemo(
    () =>
      sortItems(
        applyFilters(base, filters, { currency, rates, now }),
        serverMode ? null : sortState,
        rates,
      ),
    [base, filters, currency, rates, now, sortState, serverMode],
  );
  const options = useMemo(
    () => buildOptions(poolBase, pool.facets, now, pool.complete),
    [poolBase, pool.facets, now, pool.complete],
  );
  const narrowed = isNarrowed(filters);
  // Серверный итог уже без скрытых в этой сессии (их вычел список порций), пул — нет.
  const known = serverMode && server.total > 0 ? server.total : pool.total - hidden.size;
  const counted = listCount({ narrowed, complete: pool.complete, serverMode, known, filtered: all.length });
  const { count } = counted;
  const visible = serverMode ? all : visibleSlice(all, shown);
  const foot = serverFoot({
    narrowed,
    hasMore: server.hasMore,
    serverTotal: server.total,
    loaded: base.length,
  });
  const more = serverMode ? { total: foot.total, shown: foot.shown } : { total: count, shown: visible.length };
  const blockers = useBlockers(all.length === 0 && !pool.loading, base, filters, { currency, rates, now });
  return {
    options,
    all,
    visible,
    count,
    blockers,
    more,
    countKnown: counted.countKnown && (!serverMode || foot.countKnown),
  };
}

/** B593: список открывается в валюте из «Приложения»; кандидат может сменить её фильтром. */
function usePreferredListCurrency() {
  const state = useState<MoneyCurrency>('RUB');
  const preferred = usePreferredMoneyCurrency();
  const setCurrency = state[1];
  useEffect(() => {
    if (preferred) setCurrency(preferred);
  }, [preferred, setCurrency]);
  return state;
}

/**
 * B645 s07: первая страница пула и число от сервера; дальше и в другом порядке строки дают
 * порции сервера по 20 «Показать ещё» (useServerSortedList), всю подборку не читаем.
 */
const S07_POOL = { pageLimit: 1 } as const;

export function useVacancyList(links: VacancyLinks, hidden: ReadonlySet<string>): VacancyList {
  const pool = useMatchedPool(undefined, S07_POOL);
  const rates = useCurrencyRates();
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [currency, setCurrency] = usePreferredListCurrency();
  const [sortState, setSortState] = useState<SortState>(DEFAULT_LIST_SORT);
  const [openKind, setOpenKind] = useState<FilterKind | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useMemo(() => new Date(), [pool.matched]);
  useServerRoles(pool, filters.roles, (roles) => setFilters((current) => ({ ...current, roles })));
  useEffect(() => setShown(PAGE_SIZE), [filters, sortState]);

  const serverMode = serverSortApplies(pool);
  const server = useServerSortedList(serverMode, sortState, filters.roles, hidden);
  // Порядок по умолчанию на время первой порции сервера показываем из пула, чтобы таблица не мигала пустой.
  const waitingFirst = server.status === 'loading' && server.rows.length === 0 && sortState === DEFAULT_LIST_SORT;
  const derived = useListRows({
    pool,
    hidden,
    filters,
    currency,
    rates,
    now,
    sortState,
    serverMode: serverMode && !waitingFirst,
    server,
    shown,
  });
  return {
    pool,
    links,
    rates,
    filters,
    setFilters,
    resetFilters: () => setFilters(EMPTY_FILTERS),
    currency,
    setCurrency,
    sort: sortState,
    toggleSort: (key) => setSortState((current) => nextSort(current, key)),
    openKind,
    setOpenKind,
    sheetOpen,
    setSheetOpen,
    ...derived,
    showMore: serverMode ? server.loadMore : () => setShown((value) => value + PAGE_SIZE),
    server: { active: serverMode, status: server.status, retry: server.retry },
    noRole: pool.campaign !== undefined && pool.campaign.roles.value.length === 0,
  };
}

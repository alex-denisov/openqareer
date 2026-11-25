import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchedPool, MatchedPoolOptions } from '../../../vacancies/useMatchedPool';
import { useMatchedPool } from '../../../vacancies/useMatchedPool';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { linkedDate, linkedRole } from '../../career/careerPaths';
import { useShell } from '../../shell/ShellContext';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { MoneyCurrency } from '../format';
import type { VacancyLinks } from '../vacancyLinks';
import {
  DATE_OPTIONS,
  EMPTY_FILTERS,
  applyFilters,
  blockersOf,
  serverMoney,
  type Blocker,
  type DateId,
  type FilterKind,
  type ListFilters,
} from './filterModel';
import { defaultRoles } from './defaultRoles';
import { buildOptions, countPending, listCount, serverCountState, type FilterOptions } from './filterOptions';
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
  /** Список выбрал роли — или выбирать их нечего (ролей нет, чтение сорвалось). */
  readonly rolesReady: boolean;
}

/**
 * Роли читает сервер; пока выбор ролей не менялся, повторного чтения нет. Отдаёт, выбраны ли роли.
 * Роль и «Дата» из адреса (B726, «Вакансии по роли» из «Карьеры») ставятся только на этот
 * заход, сохранённый выбор не заменяют.
 */
function useServerRoles(
  pool: MatchedPool,
  roles: readonly string[],
  seed: (roles: readonly string[], date?: DateId) => void,
  /** Роли, с которыми пул уже читается с первого запроса (B768). */
  readingRoles: string,
): boolean {
  const [settled, setSettled] = useState(false);
  const { search } = useShell();
  const linked = linkedRole(search);
  const linkedPeriod = linkedDate(search);
  const sent = useRef(readingRoles);
  const seeded = useRef(false);
  const seedKey = useRef<string | null>(null);
  const initial = pool.initialFilters;
  const campaign = pool.campaign;
  useEffect(() => {
    if (seeded.current) return;
    // «Вакансии по роли» из «Карьеры» (B726): подборка открывается с этой ролью в фильтре.
    if (linked) {
      seeded.current = true;
      setSettled(true);
      seed([linked], linkedPeriod ?? undefined);
      return;
    }
    // Из кэша роли не ставим: их могли сменить после прошлого чтения (B792).
    if (pool.reading === true || (!initial && !campaign)) return;
    seeded.current = true;
    setSettled(true);
    // Сервер уже отдал подборку с сохранёнными ролями; роли «Карьеры» подборку ещё не сузили.
    sent.current = (initial?.roles ?? []).join('\n');
    const start = defaultRoles(initial?.roles, campaign?.roles);
    if (start.length > 0) {
      seedKey.current = start.join('\n');
      seed(start);
    }
  }, [initial, campaign, pool.reading, seed, linked, linkedPeriod]);
  const key = roles.join('\n');
  useEffect(() => {
    if (key === sent.current) return;
    // Кандидат выбрал роли сам — сохранённый выбор сервера их уже не заменит.
    seeded.current = true;
    sent.current = key;
    // B792: роли ставит сам экран — прочитанные строки остаются до сужения, список не пустеет.
    const own = seedKey.current === key;
    seedKey.current = null;
    setSettled(true);
    pool.setFilters?.({ roles: [...roles], regions: [], remoteOnly: false }, own);
  }, [key]);
  // Чтение закончилось без ролей (сбой): ждать выбора больше нечего.
  return settled || (pool.reading !== true && !initial && !campaign);
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
  readonly rolesReady: boolean;
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

/** «Дата» в днях для сервера (B726); «Любая» — `null`. */
export function serverDays(filters: ListFilters): number | null {
  return DATE_OPTIONS.find((option) => option.id === filters.date)?.days ?? null;
}

/** Выбраны фильтры, которые считает клиент (локации, формат, деньги, дата, релокация): сервер их не знает. */
export function isNarrowed(filters: ListFilters): boolean {
  const { locations, formats, reloc, moneyFrom, date } = filters;
  return locations.length > 0 || formats.length > 0 || reloc || moneyFrom !== null || date !== 'any';
}

/** Число в шапке и можно ли его уже показать. */
function countOf({
  input,
  serverMode,
  waitingFirst,
  filtered,
}: {
  readonly input: RowsInput;
  readonly serverMode: boolean;
  readonly waitingFirst: boolean;
  readonly filtered: number;
}) {
  const { pool, hidden, filters, server, rolesReady } = input;
  // B726, B765: «Дату» и «Зарплату от» в серверном порядке режет и считает сервер — число известно сразу.
  const narrowed = isNarrowed(serverMode ? { ...filters, date: 'any', moneyFrom: null } : filters);
  // Серверный итог уже без скрытых в этой сессии (их вычел список порций), пул — нет.
  const { serverKnows, serverPending } = serverCountState({
    serverMode,
    dated: serverDays(filters) !== null || filters.moneyFrom !== null,
    total: server.total,
    loadingFirst: server.rows.length === 0 && server.status === 'loading',
  });
  const pending = countPending({
    rolesReady,
    waitingFirst,
    serverMode,
    serverKnows,
    reading: pool.reading === true,
  });
  const known = serverKnows ? server.total : pool.total - hidden.size;
  const counted = listCount({ narrowed, complete: pool.complete, serverMode, known, filtered });
  return {
    count: counted.count,
    countKnown: !pending && !serverPending && counted.countKnown,
    narrowed,
    pending,
  };
}

/** Строки списка: источник (пул или порции сервера), фильтры, сортировка, число и подвал. */
function useListRows(input: RowsInput): DerivedRows {
  const { pool, hidden, filters, currency, rates, now, sortState, server, shown } = input;
  // Порядок по умолчанию на время первой порции сервера показываем из пула, чтобы таблица не мигала пустой.
  const waitingFirst =
    input.serverMode &&
    server.status === 'loading' &&
    server.rows.length === 0 &&
    sortState === DEFAULT_LIST_SORT;
  const serverMode = input.serverMode && !waitingFirst;
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
  const { count, countKnown, narrowed, pending } = countOf({ input, serverMode, waitingFirst, filtered: all.length });
  const visible = serverMode ? all : visibleSlice(all, shown);
  const foot = serverFoot({
    narrowed,
    hasMore: server.hasMore,
    serverTotal: server.total,
    loaded: base.length,
  });
  const read = serverMode ? { total: foot.total, shown: foot.shown } : { total: count, shown: visible.length };
  const more = pending && visible.length > 0 ? { ...read, total: null } : read;
  const blockers = useBlockers(all.length === 0 && !pool.loading, base, filters, { currency, rates, now });
  return {
    options,
    all,
    visible,
    count,
    blockers,
    more,
    countKnown: countKnown && (!serverMode || foot.countKnown),
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
const S07_POOL: MatchedPoolOptions = { pageLimit: 1 };

/**
 * B768: роль и «Дата» из адреса — фильтры с первого кадра, и пул читается сразу с ролью.
 * Прежде список читал всю подборку и параллельно её же с ролью: на проде ~5 с каждый.
 */
function linkedStart(search: string): {
  readonly filters: ListFilters;
  readonly pool: MatchedPoolOptions;
  readonly roles: string;
} {
  const role = linkedRole(search);
  if (!role) return { filters: EMPTY_FILTERS, pool: S07_POOL, roles: '' };
  const date = linkedDate(search);
  return {
    filters: { ...EMPTY_FILTERS, roles: [role], ...(date ? { date } : {}) },
    pool: { ...S07_POOL, initialFilters: { roles: [role], regions: [], remoteOnly: false } },
    roles: role,
  };
}

/** Роли и «Дата», которыми сервер или адрес открывают список. */
function seedWith(setFilters: (update: (current: ListFilters) => ListFilters) => void) {
  return (roles: readonly string[], date?: DateId) =>
    setFilters((current) => ({ ...current, roles, ...(date ? { date } : {}) }));
}

export function useVacancyList(links: VacancyLinks, hidden: ReadonlySet<string>): VacancyList {
  const { search } = useShell();
  const [start] = useState(() => linkedStart(search));
  const pool = useMatchedPool(undefined, start.pool);
  const rates = useCurrencyRates();
  const [filters, setFilters] = useState<ListFilters>(start.filters);
  const [currency, setCurrency] = usePreferredListCurrency();
  const [sortState, setSortState] = useState<SortState>(DEFAULT_LIST_SORT);
  const [openKind, setOpenKind] = useState<FilterKind | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useMemo(() => new Date(), [pool.matched]);
  const rolesReady = useServerRoles(pool, filters.roles, seedWith(setFilters), start.roles);
  useEffect(() => setShown(PAGE_SIZE), [filters, sortState]);

  const serverMode = serverSortApplies(pool);
  const server = useServerSortedList(serverMode, sortState, filters.roles, hidden, serverDays(filters), serverMoney(filters, currency));
  const derived = useListRows({
    pool,
    hidden,
    filters,
    currency,
    rates,
    now,
    sortState,
    serverMode,
    rolesReady,
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
    rolesReady,
    noRole: pool.campaign !== undefined && pool.campaign.roles.value.length === 0,
  };
}

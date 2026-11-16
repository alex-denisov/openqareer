import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchedPool } from '../../../vacancies/useMatchedPool';
import { useMatchedPool } from '../../../vacancies/useMatchedPool';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { MoneyCurrency } from '../format';
import type { VacancyLinks } from '../vacancyLinks';
import { EMPTY_FILTERS, applyFilters, blockersOf, type Blocker, type FilterKind, type ListFilters } from './filterModel';
import { buildOptions, type FilterOptions } from './filterOptions';
import { PAGE_SIZE, SERVER_SORT, nextSort, sortItems, visibleSlice, type SortKey, type SortState } from './sortModel';

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
  readonly noRole: boolean;
}

/** Роли читает сервер; пока выбор ролей не менялся, повторного чтения нет. */
function useServerRoles(pool: MatchedPool, roles: readonly string[], seed: (roles: readonly string[]) => void): void {
  const sent = useRef('');
  const seeded = useRef(false);
  const initial = pool.initialFilters;
  useEffect(() => {
    if (seeded.current || !initial) return;
    seeded.current = true;
    sent.current = initial.roles.join('\n');
    if (initial.roles.length > 0) seed(initial.roles);
  }, [initial, seed]);
  const key = roles.join('\n');
  useEffect(() => {
    if (key === sent.current) return;
    // Кандидат выбрал роли сам — сохранённый выбор сервера их уже не заменит.
    seeded.current = true;
    sent.current = key;
    pool.setFilters?.({ roles: [...roles], regions: [], remoteOnly: false });
  }, [key]);
}

export function useVacancyList(links: VacancyLinks, hidden: ReadonlySet<string>): VacancyList {
  const pool = useMatchedPool();
  const rates = useCurrencyRates();
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [currency, setCurrency] = useState<MoneyCurrency>('RUB');
  const [sortState, setSortState] = useState<SortState | null>(null);
  const [openKind, setOpenKind] = useState<FilterKind | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useMemo(() => new Date(), [pool.matched]);
  useServerRoles(pool, filters.roles, (roles) => setFilters((current) => ({ ...current, roles })));
  useEffect(() => setShown(PAGE_SIZE), [filters, sortState]);

  const base = useMemo(() => pool.matched.filter((item) => !hidden.has(item.cluster.id)), [pool.matched, hidden]);
  const context = { currency, rates, now };
  const all = useMemo(
    () => sortItems(applyFilters(base, filters, { currency, rates, now }), sortState, rates),
    [base, filters, currency, rates, now, sortState],
  );
  const options = useMemo(() => buildOptions(base, pool.facets, now), [base, pool.facets, now]);
  const narrowed = filters.locations.length > 0 || filters.formats.length > 0 || filters.reloc || filters.moneyFrom !== null || filters.date !== 'any';
  const count = narrowed || pool.complete ? all.length : Math.max(pool.total - hidden.size, all.length);
  const blockers = useMemo(
    () => (all.length === 0 && !pool.loading ? blockersOf(base, filters, context) : []),
    [all.length, pool.loading, base, filters, currency, rates, now],
  );
  return {
    pool, links, rates, filters, setFilters, resetFilters: () => setFilters(EMPTY_FILTERS),
    currency, setCurrency, sort: sortState ?? SERVER_SORT,
    toggleSort: (key) => setSortState((current) => nextSort(current ?? SERVER_SORT, key)),
    openKind, setOpenKind, sheetOpen, setSheetOpen, options, all,
    visible: visibleSlice(all, shown), count, blockers,
    showMore: () => setShown((value) => value + PAGE_SIZE),
    noRole: pool.campaign !== undefined && pool.campaign.roles.value.length === 0,
  };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { B640Contact, B640ContactFacets, B640ContactSort, B640ContactState } from '../../../../../shared/b640Contacts';
import { EMPTY_FILTERS, activeCount, type ContactFilters } from './contactsFilters';
import { useContactsPage, type ContactsLoad } from './useContactsPage';

export type { ContactsLoad };
export const SEARCH_DELAY_MS = 300;

export interface Criteria {
  readonly search: string;
  readonly filters: ContactFilters;
  readonly sort: B640ContactSort;
}

export interface ContactsState {
  readonly load: ContactsLoad;
  /** Данные уже приходили: панель управления остаётся на экране при новом запросе и ошибке. */
  readonly everLoaded: boolean;
  readonly items: readonly B640Contact[];
  readonly total: number;
  readonly facets: B640ContactFacets | null;
  readonly importedAt: string | null;
  readonly criteria: Criteria;
  readonly searchText: string;
  readonly filtered: boolean;
  readonly setSearchText: (value: string) => void;
  readonly setFilters: (filters: ContactFilters) => void;
  readonly setSort: (sort: B640ContactSort) => void;
  readonly resetAll: () => void;
  readonly retry: () => void;
  readonly loadMore: () => Promise<void>;
  readonly patchStatus: (id: string, from: B640ContactState, to: B640ContactState, at: string | null) => void;
}

/** Дебаунс строки поиска: в запрос уходит значение через 300 мс после последней буквы. */
function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

/** Контакты порциями по 20 с сервера B697: поиск, фильтры, сортировка. */
export function useContacts(): ContactsState {
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<B640ContactSort>('selection');
  const criteria = useMemo<Criteria>(() => ({ search, filters, sort }), [search, filters, sort]);
  const data = useContactsPage(criteria);
  const resetAll = useCallback(() => {
    setSearchText('');
    setFilters(EMPTY_FILTERS);
  }, []);
  return {
    ...data,
    criteria,
    searchText,
    filtered: Boolean(search.trim()) || activeCount(filters) > 0,
    setSearchText,
    setFilters,
    setSort,
    resetAll,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { B640Contact, B640ContactFacets, B640ContactList, B640ContactState } from '../../../../../shared/b640Contacts';
import { listB640Contacts } from './contactsApi';
import { moveStatusFacets } from './contactsFilters';
import { appendContacts } from './contactsModel';
import type { Criteria } from './useContacts';

export type ContactsLoad = 'loading' | 'ready' | 'error';

/** Первая порция по критериям, «Показать ещё» и локальная правка статуса; устаревший ответ отбрасывается. */
export function useContactsPage(criteria: Criteria) {
  const [load, setLoad] = useState<ContactsLoad>('loading');
  const [everLoaded, setEverLoaded] = useState(false);
  const [page, setPage] = useState<B640ContactList | null>(null);
  const [facets, setFacets] = useState<B640ContactFacets | null>(null);
  const [items, setItems] = useState<readonly B640Contact[]>([]);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setLoad('loading');
    listB640Contacts({ ...criteria, offset: 0 })
      .then((first) => {
        if (current !== generation.current) return;
        setPage(first);
        setFacets(first.facets);
        setItems(first.items);
        setEverLoaded(true);
        setLoad('ready');
      })
      .catch(() => {
        if (current === generation.current) setLoad('error');
      });
  }, [criteria, attempt]);

  const nextOffset = page?.nextOffset ?? null;
  const loadMore = useCallback(async () => {
    if (nextOffset === null) return;
    const current = generation.current;
    const next = await listB640Contacts({ ...criteria, offset: nextOffset });
    if (current !== generation.current) return;
    setPage(next);
    setItems((before) => appendContacts(before, next.items));
  }, [criteria, nextOffset]);

  const patchStatus = useCallback((id: string, from: B640ContactState, to: B640ContactState, at: string | null) => {
    setFacets((old) => (old ? moveStatusFacets(old, from, to) : old));
    setItems((before) => before.map((contact) => (contact.id === id ? { ...contact, status: { state: to, at } } : contact)));
  }, []);

  return {
    load, everLoaded, items, facets, loadMore, patchStatus,
    total: page?.total ?? 0,
    importedAt: page?.linkedinImport.importedAt ?? null,
    retry: () => setAttempt((value) => value + 1),
  };
}

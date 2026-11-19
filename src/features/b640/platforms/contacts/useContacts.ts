import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listCandidateConnectionContacts,
  type CandidateConnectionContact,
  type CandidateConnectionContactsPage,
} from '../../../outreach/connectionContactsApi';
import { appendContacts } from './contactsModel';

export type ContactsLoad = 'loading' | 'ready' | 'error';

export interface ContactsState {
  readonly load: ContactsLoad;
  readonly items: readonly CandidateConnectionContact[];
  readonly total: number;
  readonly importedAt: string | null;
  readonly retry: () => void;
  readonly loadMore: () => Promise<void>;
}

/** Контакты порциями с сервера; экран показывает их по 20. */
export function useContacts(): ContactsState {
  const [load, setLoad] = useState<ContactsLoad>('loading');
  const [page, setPage] = useState<CandidateConnectionContactsPage | null>(null);
  const [items, setItems] = useState<readonly CandidateConnectionContact[]>([]);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setLoad('loading');
    listCandidateConnectionContacts(0)
      .then((first) => {
        if (current !== generation.current) return;
        setPage(first);
        setItems(first.items);
        setLoad('ready');
      })
      .catch(() => {
        if (current === generation.current) setLoad('error');
      });
  }, [attempt]);

  const nextOffset = page?.nextOffset ?? null;
  const loadMore = useCallback(async () => {
    if (nextOffset === null) return;
    const current = generation.current;
    const next = await listCandidateConnectionContacts(nextOffset);
    if (current !== generation.current) return;
    setPage(next);
    setItems((before) => appendContacts(before, next.items));
  }, [nextOffset]);

  return {
    load,
    items,
    total: page?.total ?? 0,
    importedAt: page?.linkedinImport.importedAt ?? null,
    retry: () => setAttempt((value) => value + 1),
    loadMore,
  };
}

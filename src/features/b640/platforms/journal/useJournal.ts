import { useCallback, useEffect, useState } from 'react';
import type { LinkedinJournalPage } from '../../../../../shared/b640LinkedinJournal';
import { getLinkedinJournal } from './journalApi';

export type JournalState =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly page: LinkedinJournalPage };

export interface Journal {
  readonly data: JournalState;
  readonly retry: () => void;
  /** Дочитывает следующие события; сбой пробрасывается «Показать ещё». */
  readonly loadMore: () => Promise<void>;
}

/** Журнал LinkedIn по 20 событий (B696). */
export function useJournal(): Journal {
  const [data, setData] = useState<JournalState>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setData({ state: 'loading' });
    getLinkedinJournal(0).then(
      (page) => live && setData({ state: 'ready', page }),
      () => live && setData({ state: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const loadMore = useCallback(async () => {
    if (data.state !== 'ready') return;
    const next = await getLinkedinJournal(data.page.events.length);
    setData({ state: 'ready', page: { ...next, events: [...data.page.events, ...next.events] } });
  }, [data]);
  return { data, retry, loadMore };
}

import { useCallback, useEffect, useState } from 'react';
import { listCandidateAutomationJournal, type AutomationJournalPage } from '../../../automation/automationApi';
import { JOURNAL_PERIOD_DAYS } from './journalModel';

const PAGE = 20;

export type JournalState =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly page: AutomationJournalPage };

export interface Journal {
  readonly data: JournalState;
  readonly retry: () => void;
  /** Дочитывает следующие записи; сбой пробрасывается «Показать ещё». */
  readonly loadMore: () => Promise<void>;
}

function read(offset: number): Promise<AutomationJournalPage> {
  return listCandidateAutomationJournal({ periodDays: JOURNAL_PERIOD_DAYS, limit: PAGE, offset });
}

/** Журнал действий автоотклика за 30 дней по 20 записей. */
export function useJournal(): Journal {
  const [data, setData] = useState<JournalState>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setData({ state: 'loading' });
    read(0).then(
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
    const next = await read(data.page.entries.length);
    setData({ state: 'ready', page: { ...next, entries: [...data.page.entries, ...next.entries] } });
  }, [data]);
  return { data, retry, loadMore };
}

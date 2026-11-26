import { useCallback, useEffect, useState } from 'react';
import { fetchConversationPage, type ConsultantConversationSummary } from './consultantApi';

export interface HistoryState {
  readonly items: readonly ConsultantConversationSummary[];
  readonly nextCursor: string | null;
  readonly status: 'loading' | 'ready' | 'more' | 'failed';
}

export interface History extends HistoryState {
  readonly loadMore: () => void;
  /** Повтор после сбоя: та же порция, что не пришла. */
  readonly retry: () => void;
}

const INITIAL: HistoryState = { items: [], nextCursor: null, status: 'loading' };

/** Прошлые разговоры порциями: первая читается сразу, следующие — по «Показать ещё». */
export function useHistory(): History {
  const [state, setState] = useState<HistoryState>(INITIAL);

  const load = useCallback(async (cursor: string | null) => {
    try {
      const page = await fetchConversationPage(cursor ?? undefined);
      setState((current) => ({
        items: cursor ? [...current.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        status: 'ready',
      }));
    } catch {
      setState((current) => ({ ...current, status: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const loadMore = useCallback(() => {
    setState((current) => ({ ...current, status: 'more' }));
    void load(state.nextCursor);
  }, [load, state.nextCursor]);
  const retry = useCallback(() => {
    const cursor = state.items.length > 0 ? state.nextCursor : null;
    setState((current) => ({ ...current, status: cursor ? 'more' : 'loading' }));
    void load(cursor);
  }, [load, state.items.length, state.nextCursor]);

  return { ...state, loadMore, retry };
}

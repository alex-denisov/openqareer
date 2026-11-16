import { useCallback, useEffect, useRef, useState } from 'react';
import { getHiddenVacancies, type HiddenRow } from '../b640Api';
import { mergeHidden } from './hiddenModel';

export interface HiddenVacancies {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly rows: readonly HiddenRow[];
  /** Сколько строк с сервера ещё не прочитано. */
  readonly left: number;
  readonly total: number;
  readonly loadMore: () => void;
  readonly retry: () => void;
  /** Вакансия возвращена в подборку: строка уходит, смещения следующей порции сдвигаются. */
  readonly remove: (id: string) => void;
}

interface State {
  readonly rows: readonly HiddenRow[];
  readonly total: number;
  readonly nextOffset: number | null;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly pending: number;
}

const FIRST: State = { rows: [], total: 0, nextOffset: null, status: 'loading', pending: 0 };

/** Скрытые вакансии по 20: читаются, когда чип «Показать скрытые» включён; свежие из сессии идут первыми. */
export function useHiddenVacancies(enabled: boolean, session: readonly HiddenRow[]): HiddenVacancies {
  const [state, setState] = useState<State | null>(null);
  const seq = useRef(0);

  const fetchFrom = useCallback((offset: number, base: State) => {
    const id = ++seq.current;
    const controller = new AbortController();
    setState({ ...base, status: 'loading', pending: offset });
    getHiddenVacancies(offset, controller.signal)
      .then((page) => {
        if (seq.current !== id) return;
        setState({ rows: [...base.rows, ...page.rows], total: page.total, nextOffset: page.nextOffset, status: 'ready', pending: offset });
      })
      .catch(() => {
        if (seq.current === id) setState((current) => (current ? { ...current, status: 'failed' } : current));
      });
    return controller;
  }, []);

  useEffect(() => {
    if (!enabled) {
      seq.current += 1;
      setState(null);
      return undefined;
    }
    const controller = fetchFrom(0, FIRST);
    return () => controller.abort();
  }, [enabled, fetchFrom]);

  const remove = useCallback((id: string) => {
    setState((current) => {
      if (!current || !current.rows.some((row) => row.cluster.id === id)) return current;
      const shift = (value: number | null) => (value === null ? null : Math.max(0, value - 1));
      return {
        ...current,
        rows: current.rows.filter((row) => row.cluster.id !== id),
        total: Math.max(0, current.total - 1),
        nextOffset: shift(current.nextOffset),
      };
    });
  }, []);

  const view = enabled ? (state ?? FIRST) : null;
  return {
    status: view ? view.status : 'idle',
    rows: view ? mergeHidden(session, view.rows) : [],
    left: view ? Math.max(0, view.total - view.rows.length) : 0,
    total: view?.total ?? 0,
    loadMore: () => {
      if (view && view.status === 'ready' && view.nextOffset !== null) fetchFrom(view.nextOffset, view);
    },
    retry: () => {
      if (view && view.status === 'failed') fetchFrom(view.pending, view);
    },
    remove,
  };
}

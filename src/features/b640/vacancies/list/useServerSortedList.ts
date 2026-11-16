import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { getSortedMatchedPage } from '../b640Api';
import type { SortState } from './sortModel';

export type ServerListStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface ServerSortedList {
  readonly status: ServerListStatus;
  readonly rows: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

interface State {
  readonly key: string;
  readonly rows: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly nextOffset: number | null;
  readonly status: 'loading' | 'ready' | 'failed';
  /** Смещение порции, которую читаем или читали последней: «Повторить» берёт её же. */
  readonly pending: number;
}

/**
 * Подборка прочитана не целиком: порядок столбца знает только сервер. Читает порциями по 20,
 * смена столбца, направления или ролей начинает с первой порции.
 */
export function useServerSortedList(active: boolean, sort: SortState, roles: readonly string[]): ServerSortedList {
  const key = `${sort.key}:${sort.dir}:${roles.join('\n')}`;
  const [state, setState] = useState<State | null>(null);
  const seq = useRef(0);

  const fetchFrom = useCallback(
    (offset: number, base: State) => {
      const id = ++seq.current;
      const controller = new AbortController();
      setState({ ...base, key, status: 'loading', pending: offset });
      getSortedMatchedPage(sort, roles, offset, controller.signal)
        .then((page) => {
          if (seq.current !== id) return;
          setState({ key, rows: [...base.rows, ...page.rows], total: page.total, nextOffset: page.nextOffset, status: 'ready', pending: offset });
        })
        .catch(() => {
          if (seq.current === id) setState((current) => (current ? { ...current, status: 'failed' } : current));
        });
      return controller;
    },
    // sort и roles закрыты над key.
    [key],
  );

  useEffect(() => {
    if (!active) {
      seq.current += 1;
      setState(null);
      return undefined;
    }
    const controller = fetchFrom(0, { key, rows: [], total: 0, nextOffset: null, status: 'loading', pending: 0 });
    return () => controller.abort();
  }, [active, key, fetchFrom]);

  const fresh = active && state !== null && state.key === key ? state : null;
  const status: ServerListStatus = !active ? 'idle' : (fresh?.status ?? 'loading');
  const loadMore = () => {
    if (fresh && fresh.status === 'ready' && fresh.nextOffset !== null) fetchFrom(fresh.nextOffset, fresh);
  };
  const retry = () => {
    if (fresh && fresh.status === 'failed') fetchFrom(fresh.pending, fresh);
  };
  return { status, rows: fresh?.rows ?? [], total: fresh?.total ?? 0, hasMore: fresh?.nextOffset != null, loadMore, retry };
}

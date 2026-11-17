import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
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

function withoutRow(current: State | null, id: string): State | null {
  if (!current || !current.rows.some((row) => row.cluster.id === id)) return current;
  return {
    ...current,
    rows: current.rows.filter((row) => row.cluster.id !== id),
    total: Math.max(0, current.total - 1),
    nextOffset: current.nextOffset === null ? null : Math.max(0, current.nextOffset - 1),
  };
}

/** Порция после скрытия ещё одной вакансии сдвинута: повтор уже прочитанной строки не добавляем. */
function appendUnique(
  rows: readonly HiddenRow[],
  next: readonly HiddenRow[],
): readonly HiddenRow[] {
  const seen = new Set(rows.map((row) => row.cluster.id));
  return [...rows, ...next.filter((row) => !seen.has(row.cluster.id))];
}

const FIRST: State = { rows: [], total: 0, nextOffset: null, status: 'loading', pending: 0 };

/** Скрытые вакансии по 20: читаются, когда чип «Показать скрытые» включён; свежие из сессии идут первыми. */
/** Читает одну порцию; ответ устаревшего чтения отбрасывается. */
function readHiddenPortion(
  offset: number,
  base: State,
  seq: MutableRefObject<number>,
  setState: Dispatch<SetStateAction<State | null>>,
): AbortController {
  const id = ++seq.current;
  const controller = new AbortController();
  setState({ ...base, status: 'loading', pending: offset });
  getHiddenVacancies(offset, controller.signal)
    .then((page) => {
      if (seq.current !== id) return;
      const rows = appendUnique(base.rows, page.rows);
      setState({
        rows,
        total: page.total,
        nextOffset: page.nextOffset,
        status: 'ready',
        pending: offset,
      });
    })
    .catch(() => {
      if (seq.current === id)
        setState((current) => (current ? { ...current, status: 'failed' } : current));
    });
  return controller;
}

export function useHiddenVacancies(
  enabled: boolean,
  session: readonly HiddenRow[],
): HiddenVacancies {
  const [state, setState] = useState<State | null>(null);
  const seq = useRef(0);

  const fetchFrom = useCallback(
    (offset: number, base: State) => readHiddenPortion(offset, base, seq, setState),
    [],
  );

  useEffect(() => {
    if (!enabled) {
      seq.current += 1;
      setState(null);
      return undefined;
    }
    const controller = fetchFrom(0, FIRST);
    return () => controller.abort();
  }, [enabled, fetchFrom]);

  const remove = useCallback((id: string) => setState((current) => withoutRow(current, id)), []);

  const view = enabled ? (state ?? FIRST) : null;
  const rows = view ? mergeHidden(session, view.rows) : [];
  return {
    status: view ? view.status : 'idle',
    rows,
    left: view ? Math.max(0, view.total - rows.length) : 0,
    total: view?.total ?? 0,
    loadMore: () => {
      if (view && view.status === 'ready' && view.nextOffset !== null)
        fetchFrom(view.nextOffset, view);
    },
    retry: () => {
      if (view && view.status === 'failed') fetchFrom(view.pending, view);
    },
    remove,
  };
}

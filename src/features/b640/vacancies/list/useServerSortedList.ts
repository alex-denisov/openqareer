import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
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

interface ReadArgs {
  readonly key: string;
  readonly sort: SortState;
  readonly roles: readonly string[];
  readonly days: number | null;
  readonly offset: number;
  readonly base: State;
  readonly seq: MutableRefObject<number>;
  readonly setState: Dispatch<SetStateAction<State | null>>;
}

/** Читает одну порцию; ответ устаревшего чтения (другой столбец, роли, перезапуск) отбрасывается. */
function readPortion({
  key,
  sort,
  roles,
  days,
  offset,
  base,
  seq,
  setState,
}: ReadArgs): AbortController {
  const id = ++seq.current;
  const controller = new AbortController();
  setState({ ...base, key, status: 'loading', pending: offset });
  getSortedMatchedPage(sort, roles, offset, controller.signal, days)
    .then((page) => {
      if (seq.current !== id) return;
      const rows = [...base.rows, ...page.rows];
      setState({
        key,
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

/**
 * Подборка прочитана не целиком: порядок столбца знает только сервер. Читает порциями по 20,
 * смена столбца, направления или ролей начинает с первой порции.
 */
export function useServerSortedList(
  active: boolean,
  sort: SortState,
  roles: readonly string[],
  hidden: ReadonlySet<string>,
  /** Фильтр «Дата» в днях (B726): его режет и считает сервер; `null` — без даты. */
  days: number | null = null,
): ServerSortedList {
  const [reload, setReload] = useState(0);
  const key = `${sort.key}:${sort.dir}:${roles.join('\n')}:${days ?? ''}:${reload}`;
  const [state, setState] = useState<State | null>(null);
  const seq = useRef(0);

  const fetchFrom = useCallback(
    (offset: number, base: State) =>
      readPortion({ key, sort, roles, days, offset, base, seq, setState }),
    // sort, roles и days закрыты над key.
    [key],
  );

  useEffect(() => {
    if (!active) {
      seq.current += 1;
      setState(null);
      return undefined;
    }
    const controller = fetchFrom(0, {
      key,
      rows: [],
      total: 0,
      nextOffset: null,
      status: 'loading',
      pending: 0,
    });
    return () => controller.abort();
  }, [active, key, fetchFrom]);

  useHiddenShift(hidden, setState, () => setReload((value) => value + 1));
  const fresh = active && state !== null && state.key === key ? state : null;
  return {
    status: !active ? 'idle' : (fresh?.status ?? 'loading'),
    rows: fresh?.rows ?? [],
    total: fresh?.total ?? 0,
    hasMore: fresh?.nextOffset != null,
    loadMore: () => {
      if (fresh && fresh.status === 'ready' && fresh.nextOffset !== null)
        fetchFrom(fresh.nextOffset, fresh);
    },
    retry: () => {
      if (fresh && fresh.status === 'failed') fetchFrom(fresh.pending, fresh);
    },
  };
}

/**
 * Скрытая вакансия выпадает из выдачи сервера, и следующая порция сдвигается на строку назад.
 * Возврат в подборку (в том числе «Отменить») меняет выдачу в середине: читаем с первой порции.
 */
function useHiddenShift(
  hidden: ReadonlySet<string>,
  setState: Dispatch<SetStateAction<State | null>>,
  restart: () => void,
): void {
  const previous = useRef<ReadonlySet<string>>(hidden);
  useEffect(() => {
    const before = previous.current;
    previous.current = hidden;
    if ([...before].some((id) => !hidden.has(id))) {
      restart();
      return;
    }
    const added = [...hidden].filter((id) => !before.has(id));
    if (added.length === 0) return;
    setState((current) => {
      const hit = current
        ? added.filter((id) => current.rows.some((row) => row.cluster.id === id)).length
        : 0;
      if (!current || hit === 0) return current;
      return {
        ...current,
        total: Math.max(0, current.total - hit),
        nextOffset: current.nextOffset === null ? null : Math.max(0, current.nextOffset - hit),
      };
    });
  }, [hidden]);
}

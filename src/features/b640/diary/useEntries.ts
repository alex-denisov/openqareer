import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CareerDiaryEntry,
  CareerDiaryEntryKind,
  CareerDiaryWeekSummary,
} from '../../../../shared/careerDiaryEntries';
import { listEntries } from './diaryApi';

export interface Feed {
  readonly items: readonly CareerDiaryEntry[];
  readonly summaries: readonly CareerDiaryWeekSummary[];
  readonly nextCursor: string | null;
}

export type FeedState =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | {
      readonly state: 'ready';
      readonly feed: Feed;
      readonly moreFailed: boolean;
      readonly loadingMore: boolean;
    };

function byDateDesc(a: CareerDiaryEntry, b: CareerDiaryEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

function mergeSummaries(
  current: readonly CareerDiaryWeekSummary[],
  next: readonly CareerDiaryWeekSummary[],
): readonly CareerDiaryWeekSummary[] {
  const known = new Set(next.map((summary) => summary.weekStart));
  return [...current.filter((summary) => !known.has(summary.weekStart)), ...next];
}

type Ready = Extract<FeedState, { readonly state: 'ready' }>;
type SetFeed = (change: (previous: FeedState) => FeedState) => void;

function ready(feed: Feed): Ready {
  return { state: 'ready', feed, moreFailed: false, loadingMore: false };
}

/** Порция «Показать ещё» дописывается в конец без повторов. */
function appendPage(current: Feed, page: Feed): Feed {
  const known = new Set(current.items.map((item) => item.id));
  return {
    items: [...current.items, ...page.items.filter((item) => !known.has(item.id))],
    summaries: mergeSummaries(current.summaries, page.summaries),
    nextCursor: page.nextCursor,
  };
}

function withFeed(state: FeedState, change: (feed: Feed) => Feed): FeedState {
  return state.state === 'ready' ? { ...state, feed: change(state.feed) } : state;
}

/** Новая или изменённая запись встаёт на своё место по дате; не своего вида — уходит. */
export function putEntry(
  feed: Feed,
  entry: CareerDiaryEntry,
  kind: CareerDiaryEntryKind | null,
): Feed {
  const rest = feed.items.filter((item) => item.id !== entry.id);
  const fits = kind === null || entry.kind === kind;
  return { ...feed, items: fits ? [...rest, entry].sort(byDateDesc) : rest };
}

interface Filter {
  readonly kind: CareerDiaryEntryKind | null;
  readonly goalId?: string;
}

function query({ kind, goalId }: Filter) {
  return { ...(kind ? { kind } : {}), ...(goalId ? { goalId } : {}) };
}

function useFirstPage(
  kind: CareerDiaryEntryKind | null,
  goalId: string | undefined,
  attempt: number,
  setState: (state: FeedState) => void,
) {
  useEffect(() => {
    let active = true;
    setState({ state: 'loading' });
    listEntries(query({ kind, goalId })).then(
      (page) => active && setState(ready(page)),
      () => active && setState({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [kind, goalId, attempt, setState]);
}

function nextPage(filter: Filter, cursor: string, setState: SetFeed): void {
  listEntries(query(filter), cursor).then(
    (page) =>
      setState((current) =>
        current.state === 'ready' ? ready(appendPage(current.feed, page)) : current,
      ),
    () =>
      setState((current) =>
        current.state === 'ready' ? { ...current, moreFailed: true, loadingMore: false } : current,
      ),
  );
}

export interface EntriesApi {
  readonly state: FeedState;
  readonly retry: () => void;
  readonly loadMore: () => void;
  readonly put: (entry: CareerDiaryEntry) => void;
  readonly remove: (entryId: string) => void;
}

/** Лента записей: фильтр по виду и, в карточке цели, по цели. */
export function useEntries(kind: CareerDiaryEntryKind | null, goalId?: string): EntriesApi {
  const [state, setState] = useState<FeedState>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useFirstPage(kind, goalId, attempt, setState);
  const latest = useRef(state);
  latest.current = state;

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const loadMore = useCallback(() => {
    const previous = latest.current;
    if (previous.state !== 'ready' || !previous.feed.nextCursor || previous.loadingMore) return;
    setState({ ...previous, loadingMore: true, moreFailed: false });
    nextPage({ kind, goalId }, previous.feed.nextCursor, setState);
  }, [kind, goalId]);
  const put = useCallback(
    (entry: CareerDiaryEntry) =>
      setState((previous) => withFeed(previous, (feed) => putEntry(feed, entry, kind))),
    [kind],
  );
  const remove = useCallback(
    (entryId: string) =>
      setState((previous) =>
        withFeed(previous, (feed) => ({
          ...feed,
          items: feed.items.filter((item) => item.id !== entryId),
        })),
      ),
    [],
  );
  return { state, retry, loadMore, put, remove };
}

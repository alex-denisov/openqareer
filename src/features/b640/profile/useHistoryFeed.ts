import { useRef, useState } from 'react';
import {
  getProfileHistory,
  type ProfileHistoryItem,
  type ProfileHistorySource,
  type ProfileHistorySources,
} from '../../resume/profileHistoryApi';

type Source = ProfileHistorySource | undefined;

export interface FeedState {
  readonly entries: readonly ProfileHistoryItem[];
  readonly total: number;
  /** Последняя прочитанная страница; −1 — первая порция отбора не пришла. */
  readonly page: number;
  readonly sources?: ProfileHistorySources;
}

function appended(before: readonly ProfileHistoryItem[], next: readonly ProfileHistoryItem[]) {
  const known = new Set(before.map((entry) => entry.id));
  return [...before, ...next.filter((entry) => !known.has(entry.id))];
}

/** Порции правок, отбор по источнику и отметка отменённых; ответ на прежний отбор отбрасывается. */
export function useHistoryFeed(first: FeedState) {
  const [feed, setFeed] = useState<FeedState>(first);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<Source>(undefined);
  const wanted = useRef<Source>(undefined);

  async function load(page: number, next: Source, before: readonly ProfileHistoryItem[]) {
    setBusy(true);
    setFailed(false);
    try {
      const fresh = await getProfileHistory(page, undefined, next);
      if (wanted.current === next) setFeed({ ...fresh, entries: appended(before, fresh.entries) });
    } catch {
      if (wanted.current !== next) return;
      setFailed(true);
      if (page === 0) setFeed((current) => ({ ...current, entries: [], page: -1 }));
    } finally {
      if (wanted.current === next) setBusy(false);
    }
  }

  function choose(next: Source): void {
    wanted.current = next;
    setSource(next);
    void load(0, next, []);
  }

  function more(): void {
    if (!busy) void load(feed.page + 1, source, feed.entries);
  }

  /**
   * После отмены в истории появляется новая запись: перечитываем начало списка.
   * Если чтение не удалось, отмечаем правку отменённой на месте.
   */
  async function markReverted(id: string): Promise<void> {
    try {
      const fresh = await getProfileHistory(0, undefined, source);
      if (wanted.current === source) setFeed(fresh);
    } catch {
      setFeed((current) => ({
        ...current,
        entries: current.entries.map((entry) =>
          entry.id === id ? { ...entry, revertedAt: entry.createdAt } : entry,
        ),
      }));
    }
  }

  return { feed, busy, failed, source, choose, more, markReverted };
}

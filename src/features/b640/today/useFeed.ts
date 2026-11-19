import { useCallback, useEffect, useState } from 'react';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '../../notifications/notificationsApi';
import {
  listB640Notifications,
  type B640Notification,
  type B640NotificationPage,
  type NotificationFilter,
} from './b640NotificationsApi';

const EMPTY: B640NotificationPage = { items: [], pinned: [], unreadCount: 0, nextCursor: null };
const LOAD_ERROR = 'Не удалось загрузить уведомления.';

type Status = 'loading' | 'ready' | 'error';

const markItem = (item: B640Notification, id: string, readAt: string): B640Notification =>
  item.id === id && item.readAt === null ? { ...item, readAt } : item;

type SetPage = (update: (current: B640NotificationPage) => B640NotificationPage) => void;

function useReadMarks(setPage: SetPage, setActionError: (text: string | null) => void) {
  const markRead = useCallback(
    async (item: B640Notification) => {
      if (item.readAt !== null) return;
      try {
        const { readAt } = await markNotificationRead(item.id);
        setPage((current) => ({
          ...current,
          unreadCount: Math.max(0, current.unreadCount - 1),
          items: current.items.map((row) => markItem(row, item.id, readAt)),
          pinned: current.pinned.filter((row) => row.id !== item.id),
        }));
      } catch {
        setActionError('Не удалось отметить уведомление прочитанным.');
      }
    },
    [setPage, setActionError],
  );

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setPage((current) => ({
        ...current,
        unreadCount: 0,
        pinned: [],
        items: [...current.pinned, ...current.items].map((row) =>
          row.readAt === null ? { ...row, readAt, important: false } : row,
        ),
      }));
    } catch {
      setActionError('Не удалось отметить всё прочитанным.');
    }
  }, [setPage, setActionError]);

  return { markRead, markAllRead };
}

/** Лента N01b: категория, порции по 20, отметки прочтения прежними маршрутами. */
export function useFeed() {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [page, setPage] = useState<B640NotificationPage>(EMPTY);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    listB640Notifications({ category: filter, signal: controller.signal })
      .then((next) => {
        setPage(next);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [filter, attempt]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor) return;
    setLoadingMore(true);
    setActionError(null);
    try {
      const next = await listB640Notifications({ category: filter, cursor: page.nextCursor });
      setPage((current) => ({ ...next, items: [...current.items, ...next.items] }));
    } catch {
      setActionError(LOAD_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }, [filter, page.nextCursor]);

  const marks = useReadMarks(setPage, setActionError);

  return {
    filter,
    setFilter,
    ...page,
    status,
    loadingMore,
    actionError,
    retry: () => setAttempt((value) => value + 1),
    loadMore,
    markRead: marks.markRead,
    markAllRead: marks.markAllRead,
  };
}

export type Feed = ReturnType<typeof useFeed>;
export { LOAD_ERROR };

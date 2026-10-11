import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type CandidateNotification,
} from './notificationsApi';

export type NotificationsLoadState = 'loading' | 'ready' | 'error';

interface PageState {
  readonly status: NotificationsLoadState;
  readonly items: readonly CandidateNotification[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly moreError: string | null;
}

interface PageControls extends PageState {
  readonly retry: () => void;
  readonly loadMore: () => Promise<boolean>;
  readonly setPage: Dispatch<SetStateAction<PageState>>;
}

interface NotificationActions {
  readonly actionError: string | null;
  readonly clearActionError: () => void;
  readonly markRead: (item: CandidateNotification) => Promise<boolean>;
  readonly markAllRead: () => Promise<boolean>;
}

const INITIAL_PAGE: PageState = {
  status: 'loading',
  items: [],
  unreadCount: 0,
  nextCursor: null,
  loadingMore: false,
  error: null,
  moreError: null,
};

async function fetchFirstPage(
  signal: AbortSignal,
  setPage: Dispatch<SetStateAction<PageState>>,
): Promise<void> {
  try {
    const page = await listNotifications({ limit: 20, signal });
    if (signal.aborted) return;
    setPage({ ...INITIAL_PAGE, status: 'ready', ...page });
  } catch (reason) {
    if (signal.aborted) return;
    setPage({ ...INITIAL_PAGE, status: 'error', error: apiErrorMessage(reason, 'Не удалось загрузить уведомления.') });
  }
}

async function fetchNextPage(
  cursor: string | null,
  alreadyLoading: boolean,
  setPage: Dispatch<SetStateAction<PageState>>,
): Promise<boolean> {
  if (!cursor || alreadyLoading) return false;
  setPage((current) => ({ ...current, loadingMore: true, moreError: null }));
  try {
    const page = await listNotifications({ limit: 20, cursor });
    setPage((current) => ({
      ...current,
      items: appendUniqueNotifications(current.items, page.items),
      unreadCount: page.unreadCount,
      nextCursor: page.nextCursor,
      loadingMore: false,
      moreError: null,
    }));
    return true;
  } catch (reason) {
    setPage((current) => ({
      ...current,
      loadingMore: false,
      moreError: apiErrorMessage(reason, 'Не удалось загрузить ещё уведомления.'),
    }));
    return false;
  }
}

function useNotificationPage(onUnreadCountChange?: (count: number) => void): PageControls {
  const [page, setPage] = useState<PageState>(INITIAL_PAGE);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPage((current) => ({ ...current, status: 'loading', error: null }));
    void fetchFirstPage(controller.signal, setPage);
    return () => controller.abort();
  }, [reloadToken]);
  useEffect(() => onUnreadCountChange?.(page.unreadCount), [onUnreadCountChange, page.unreadCount]);
  const retry = useCallback(() => setReloadToken((token) => token + 1), []);
  const loadMore = useCallback(
    () => fetchNextPage(page.nextCursor, page.loadingMore, setPage),
    [page.loadingMore, page.nextCursor],
  );
  return { ...page, retry, loadMore, setPage };
}

function useNotificationActions(setPage: PageControls['setPage']): NotificationActions {
  const [actionError, setActionError] = useState<string | null>(null);
  const clearActionError = useCallback(() => setActionError(null), []);
  const markRead = useCallback(async (item: CandidateNotification): Promise<boolean> => {
    if (item.readAt) return true;
    setActionError(null);
    try {
      const updated = await markNotificationRead(item.id);
      setPage((current) => ({
        ...current,
        items: current.items.map((entry) => entry.id === item.id ? { ...entry, readAt: updated.readAt } : entry),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }));
      return true;
    } catch (reason) {
      setActionError(apiErrorMessage(reason, 'Не удалось отметить уведомление прочитанным.'));
      return false;
    }
  }, [setPage]);
  const markAllRead = useCallback(async (): Promise<boolean> => {
    setActionError(null);
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setPage((current) => ({
        ...current,
        items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
        unreadCount: 0,
      }));
      return true;
    } catch (reason) {
      setActionError(apiErrorMessage(reason, 'Не удалось прочитать все уведомления.'));
      return false;
    }
  }, [setPage]);
  return { actionError, clearActionError, markRead, markAllRead };
}

export function useNotifications(onUnreadCountChange?: (count: number) => void) {
  const page = useNotificationPage(onUnreadCountChange);
  const actions = useNotificationActions(page.setPage);
  return { ...page, ...actions };
}

function appendUniqueNotifications(
  current: readonly CandidateNotification[],
  next: readonly CandidateNotification[],
): CandidateNotification[] {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !ids.has(item.id))];
}

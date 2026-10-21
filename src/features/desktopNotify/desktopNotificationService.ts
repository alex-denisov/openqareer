import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { listNotifications, type CandidateNotification } from '../notifications/notificationsApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  planDesktopNotificationBatch,
  type DesktopNotificationCheckpoint,
  type DesktopNotificationNotice,
  type DesktopNotificationTarget,
} from './desktopNotificationPolicy';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_POLL = 20;
const MAX_SEEN_IDS = 512;

type PermissionStatus = 'unknown' | 'unverified' | 'denied' | 'unavailable';

interface StoredDesktopNotificationState extends DesktopNotificationCheckpoint {
  readonly permissionStatus: PermissionStatus;
}

interface NotificationActionPayload {
  readonly actionId?: string;
  readonly notification?: {
    readonly extra?: Readonly<Record<string, unknown>>;
  };
}

interface NotificationPageBatch {
  readonly items: readonly CandidateNotification[];
  readonly complete: boolean;
}

let state: StoredDesktopNotificationState | null = null;
let started = false;
let pollInProgress = false;

export function startDesktopNotificationService(): void {
  if (!isTauriEnvironment() || started) return;
  started = true;
  void initializeDesktopNotificationService();
}

async function initializeDesktopNotificationService(): Promise<void> {
  try {
    await addPluginListener<NotificationActionPayload>(
      'notification',
      'actionPerformed',
      (payload) => {
        void handleNotificationAction(payload);
      },
    );
    await listen('desktop-notify-toggle-request', () => {
      void toggleNotifications();
    });
    state = await invoke<StoredDesktopNotificationState>('get_desktop_notification_state');
    await updateMenuState(state);
    window.addEventListener('online', handleOnline);
    window.setInterval(handleOnline, POLL_INTERVAL_MS);
    if (state.enabled && state.permissionStatus === 'unverified') await pollForNotifications();
  } catch {
    await markUnavailable();
  }
}

async function toggleNotifications(): Promise<void> {
  if (!state) return;
  if (state.enabled) {
    await persistState({ ...state, enabled: false });
    return;
  }
  if (state.permissionStatus === 'denied' || state.permissionStatus === 'unavailable') {
    await updateMenuState(state);
    return;
  }

  const permission =
    state.permissionStatus === 'unverified' ? 'unverified' : await requestPermission();
  if (permission !== 'unverified') {
    await persistState({ ...state, enabled: false, permissionStatus: permission });
    return;
  }
  const now = new Date().toISOString();
  await persistState({
    ...state,
    enabled: true,
    permissionStatus: permission,
    enabledAt: now,
    lastPollAt: now,
  });
  await pollForNotifications();
}

async function requestPermission(): Promise<PermissionStatus> {
  if (typeof window.Notification?.requestPermission !== 'function') return 'unavailable';
  try {
    const result = await window.Notification.requestPermission();
    return result === 'granted' ? 'unverified' : result === 'denied' ? 'denied' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function handleOnline(): void {
  if (navigator.onLine) void pollForNotifications();
}

async function pollForNotifications(): Promise<void> {
  if (
    !state?.enabled ||
    state.permissionStatus !== 'unverified' ||
    pollInProgress ||
    !navigator.onLine
  )
    return;
  pollInProgress = true;
  try {
    const now = new Date().toISOString();
    const batch = await readNotificationPages(state);
    const plan = planDesktopNotificationBatch(batch.items, state, true, now);
    for (const notice of plan.notices) {
      if (!(await showNotification(notice))) return;
      await persistState({ ...state, seenIds: mergeSeenIds(state.seenIds, notice.ids) });
    }
    if (batch.complete) await persistState({ ...state, lastPollAt: now });
  } catch {
    // Keep the old checkpoint so the next online event or interval retries.
  } finally {
    pollInProgress = false;
  }
}

async function readNotificationPages(
  checkpoint: DesktopNotificationCheckpoint,
): Promise<NotificationPageBatch> {
  const boundary = Date.parse(
    checkpoint.lastPollAt ?? checkpoint.enabledAt ?? new Date().toISOString(),
  );
  const items: CandidateNotification[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_POLL; pageNumber += 1) {
    const page = await listNotifications({ limit: PAGE_SIZE, cursor });
    items.push(...page.items);
    if (page.items.some((item) => Date.parse(item.createdAt) < boundary) || !page.nextCursor) {
      return { items, complete: true };
    }
    cursor = page.nextCursor;
  }
  return { items, complete: false };
}

async function showNotification(notice: DesktopNotificationNotice): Promise<boolean> {
  try {
    await invoke('plugin:notification|notify', {
      options: {
        title: notice.title,
        body: notice.body,
        extra: { target: notice.target },
      },
    });
    return true;
  } catch (error) {
    const permissionStatus = isPermissionFailure(error) ? 'denied' : 'unavailable';
    await markUnavailable(permissionStatus);
    return false;
  }
}

async function handleNotificationAction(payload: NotificationActionPayload): Promise<void> {
  if (payload.actionId !== 'tap') return;
  const target = safeNotificationTarget(payload.notification?.extra?.target);
  if (!target) return;
  await invoke('focus_main_window');
  const url = new URL(window.location.href);
  url.searchParams.set('view', target);
  url.searchParams.delete('notificationSource');
  window.location.assign(url.href);
}

function safeNotificationTarget(value: unknown): DesktopNotificationTarget | null {
  return value === 'opportunities' || value === 'responses' || value === 'notifications'
    ? value
    : null;
}

function mergeSeenIds(current: readonly string[], incoming: readonly string[]): readonly string[] {
  return [...new Set([...current, ...incoming])].slice(-MAX_SEEN_IDS);
}

async function persistState(next: StoredDesktopNotificationState): Promise<void> {
  await invoke('save_desktop_notification_state', { state: next });
  state = next;
  await updateMenuState(next);
}

async function updateMenuState(next: StoredDesktopNotificationState): Promise<void> {
  await invoke('update_desktop_notification_menu_state', {
    enabled: next.enabled,
    permissionStatus: next.permissionStatus,
  });
}

async function markUnavailable(permissionStatus: PermissionStatus = 'unavailable'): Promise<void> {
  if (!state) return;
  try {
    await persistState({ ...state, enabled: false, permissionStatus });
  } catch {
    state = { ...state, enabled: false, permissionStatus };
  }
}

function isPermissionFailure(error: unknown): boolean {
  return /permission|denied/i.test(error instanceof Error ? error.message : String(error));
}

startDesktopNotificationService();

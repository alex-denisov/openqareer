import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { listNotifications, type CandidateNotification } from '../notifications/notificationsApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  planDesktopNotificationBatch,
  type DesktopNotificationCheckpoint,
  type DesktopNotificationNotice,
  type DesktopNotificationTarget,
} from './desktopNotificationPolicy';

import { OPEN_VIEW_EVENT } from './openViewEvent';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_POLL = 20;
const MAX_SEEN_IDS = 512;

type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'unavailable';

interface StoredDesktopNotificationState extends DesktopNotificationCheckpoint {
  readonly permissionStatus: PermissionStatus;
  readonly permissionReason: string | null;
}

interface NotificationPageBatch {
  readonly items: readonly CandidateNotification[];
  readonly complete: boolean;
}

let state: StoredDesktopNotificationState | null = null;
let started = false;
let initialization: Promise<void> | null = null;
let pollInProgress = false;
let toggleInProgress = false;
let pluginPermissionMismatchLogged = false;

export function startDesktopNotificationService(): void {
  if (!isTauriEnvironment() || started) return;
  started = true;
  initialization = initializeDesktopNotificationService();
}

async function initializeDesktopNotificationService(): Promise<void> {
  try {
    await listen('desktop-notify-toggle-request', () => {
      void runToggleSafely();
    });
  } catch (error) {
    await setUnavailable('не удалось подключить пункт меню', error, 'register_menu_toggle');
    return;
  }

  try {
    await listen<string>('desktop-notify-open', ({ payload }) => {
      void runNotificationActionSafely(payload);
    });
  } catch (error) {
    await reportFailure('register_notification_open_listener', error);
  }

  try {
    const stored = await invoke<StoredDesktopNotificationState>('get_desktop_notification_state');
    state = stateWithPermission(stored, await readPermission());
    await persistState(state);
  } catch (error) {
    await setUnavailable('не удалось проверить разрешение', error, 'initialize');
  }

  window.addEventListener('online', handleOnline);
  window.setInterval(handleOnline, POLL_INTERVAL_MS);
  if (state?.enabled && state.permissionStatus === 'granted') void pollForNotifications();
}

async function runToggleSafely(): Promise<void> {
  if (toggleInProgress) return;
  toggleInProgress = true;
  try {
    await initialization;
    await toggleNotifications();
  } catch (error) {
    await setUnavailable('не удалось изменить настройку', error, 'toggle_notifications');
  } finally {
    toggleInProgress = false;
  }
}

async function toggleNotifications(): Promise<void> {
  if (!state) throw new Error('notification state is unavailable');
  const permission = await readPermission();
  if (permission === false) {
    await persistState({
      ...state,
      enabled: false,
      permissionStatus: 'denied',
      permissionReason: null,
    });
    return;
  }
  if (state.enabled) {
    const permissionStatus = permission ? 'granted' : 'unknown';
    await persistState({ ...state, enabled: false, permissionStatus, permissionReason: null });
    return;
  }
  if (permission === null && !(await requestPermission())) return;

  const now = new Date().toISOString();
  await persistState({
    ...state,
    enabled: true,
    permissionStatus: 'granted',
    permissionReason: null,
    enabledAt: now,
    lastPollAt: now,
  });
  if (await showEnableConfirmation()) await pollForNotifications();
}

async function readPermission(): Promise<boolean | null> {
  const status = await invoke<PermissionStatus>('get_desktop_notification_permission_state');
  const permission = permissionGrant(status);
  try {
    const pluginPermission = await invoke<boolean | null>(
      'plugin:notification|is_permission_granted',
    );
    if (pluginPermission !== permission && !pluginPermissionMismatchLogged) {
      pluginPermissionMismatchLogged = true;
      await reportFailure(
        'plugin_permission_state_mismatch',
        new Error(`Tauri plugin reported ${pluginPermission}; macOS reported ${permission}`),
      );
    }
  } catch (error) {
    await reportFailure('plugin_permission_state_query', error);
  }
  return permission;
}

async function requestPermission(): Promise<boolean> {
  try {
    await invoke<string>('plugin:notification|request_permission');
  } catch (error) {
    await reportFailure('plugin_request_permission', error);
  }
  const result = await invoke<PermissionStatus>('request_desktop_notification_permission');
  const permission = permissionGrant(result);
  if (permission === false) {
    if (!state) throw new Error('notification state is unavailable');
    await persistState({
      ...state,
      enabled: false,
      permissionStatus: 'denied',
      permissionReason: null,
    });
    return false;
  }
  if (permission !== true) throw new Error(`notification permission is unresolved: ${result}`);
  return true;
}

function permissionGrant(status: PermissionStatus): boolean | null {
  if (status === 'granted') return true;
  if (status === 'denied') return false;
  if (status === 'unknown') return null;
  throw new Error(`notification permission is unavailable: ${status}`);
}

async function showEnableConfirmation(): Promise<boolean> {
  try {
    await invoke('show_desktop_notification', {
      title: 'OpenQareer',
      body: 'Уведомления openqareer включены',
      target: 'notifications',
    });
    return true;
  } catch (error) {
    if (isPermissionFailure(error)) {
      await setPermissionDenied(error, 'send_enable_confirmation');
    } else {
      await setUnavailable(
        `не удалось показать тестовое уведомление: ${errorMessage(error)}`,
        error,
        'send_enable_confirmation',
      );
    }
    return false;
  }
}

function stateWithPermission(
  stored: StoredDesktopNotificationState,
  permission: boolean | null,
): StoredDesktopNotificationState {
  if (permission === false) {
    return { ...stored, enabled: false, permissionStatus: 'denied', permissionReason: null };
  }
  if (permission === true)
    return { ...stored, permissionStatus: 'granted', permissionReason: null };
  return { ...stored, enabled: false, permissionStatus: 'unknown', permissionReason: null };
}

function handleOnline(): void {
  if (navigator.onLine) void pollForNotifications();
}

async function pollForNotifications(): Promise<void> {
  if (
    !state?.enabled ||
    state.permissionStatus !== 'granted' ||
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
  } catch (error) {
    await reportFailure('poll_notifications', error);
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
    await invoke('show_desktop_notification', {
      title: notice.title,
      body: notice.body,
      target: notice.target,
    });
    return true;
  } catch (error) {
    if (isPermissionFailure(error)) {
      await setPermissionDenied(error, 'show_notification');
    } else {
      await setUnavailable(
        `не удалось показать уведомление: ${errorMessage(error)}`,
        error,
        'show_notification',
      );
    }
    return false;
  }
}

async function runNotificationActionSafely(value: unknown): Promise<void> {
  try {
    await handleNotificationAction(value);
  } catch (error) {
    await reportFailure('open_notification_action', error);
  }
}

async function handleNotificationAction(value: unknown): Promise<void> {
  const target = safeNotificationTarget(value);
  if (!target) return;
  // Переход внутри приложения, без перезагрузки: оболочка слушает это событие.
  window.dispatchEvent(new CustomEvent(OPEN_VIEW_EVENT, { detail: { view: target } }));
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
    reason: next.permissionReason,
  });
}

async function setPermissionDenied(error: unknown, context: string): Promise<void> {
  await reportFailure(context, error);
  if (!state) return;
  await persistState({
    ...state,
    enabled: false,
    permissionStatus: 'denied',
    permissionReason: null,
  });
}

async function setUnavailable(reason: string, error: unknown, context: string): Promise<void> {
  await reportFailure(context, error);
  const next = {
    ...(state ?? emptyState()),
    enabled: false,
    permissionStatus: 'unavailable' as const,
    permissionReason: reason,
  };
  state = next;
  try {
    await invoke('save_desktop_notification_state', { state: next });
  } catch (saveError) {
    await reportFailure('save_unavailable_state', saveError);
  }
  try {
    await updateMenuState(next);
  } catch (menuError) {
    await reportFailure('update_unavailable_menu', menuError);
  }
}

function emptyState(): StoredDesktopNotificationState {
  return {
    enabled: false,
    enabledAt: null,
    lastPollAt: null,
    seenIds: [],
    permissionStatus: 'unavailable',
    permissionReason: 'сбой службы уведомлений',
  };
}

async function reportFailure(context: string, error: unknown): Promise<void> {
  const reason = errorMessage(error);
  try {
    await invoke('log_desktop_notification_failure', { context, reason });
  } catch (logError) {
    const message = `[desktop-notify] ${context}: ${reason}; журнал недоступен: ${errorMessage(logError)}`;
    const reportError = (globalThis as typeof globalThis & { reportError?: (error: Error) => void })
      .reportError;
    if (reportError) {
      reportError(new Error(message));
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new ErrorEvent('error', { message, error: logError }));
    }
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 180) || 'unknown error';
}

function isPermissionFailure(error: unknown): boolean {
  return /permission|denied/i.test(error instanceof Error ? error.message : String(error));
}

startDesktopNotificationService();

export type NotificationPreferenceKey =
  | 'ev-reply'
  | 'ev-reminder'
  | 'ev-approval'
  | 'ev-delivery-error'
  | 'ev-target-company'
  | 'ev-weekly-digest';

export interface NotificationChannelPreference {
  readonly key: NotificationPreferenceKey;
  readonly app: boolean;
  readonly email: boolean;
  readonly telegram: boolean;
}

export interface NotificationChannelStatus {
  readonly emailAvailable: boolean;
  readonly telegram: {
    readonly available: boolean;
    readonly connected: boolean;
    readonly linkedAt: string | null;
    readonly botUsername: 'openqareer_bot';
  };
  readonly mandatory: {
    readonly security: {
      readonly app: true;
      readonly email: true;
      readonly telegram: false;
      readonly locked: true;
      readonly sourceAvailable: boolean;
    };
    readonly payments: {
      readonly app: true;
      readonly email: true;
      readonly telegram: false;
      readonly locked: true;
      readonly sourceAvailable: boolean;
    };
  };
}

interface ApiResult<T> {
  readonly data?: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok || result.data === undefined) {
    throw new Error(result.error?.code ?? `http_${response.status}`);
  }
  return result.data;
}

export async function getNotificationPreferences(): Promise<NotificationChannelPreference[]> {
  const result = await request<{ events: NotificationChannelPreference[] }>(
    '/api/v1/candidate/notifications/preferences',
  );
  return result.events;
}

export function getNotificationChannelStatus(): Promise<NotificationChannelStatus> {
  return request('/api/v1/candidate/notifications/channels');
}

export async function updateNotificationPreference(
  key: NotificationPreferenceKey,
  preference: Omit<NotificationChannelPreference, 'key'>,
): Promise<NotificationChannelPreference> {
  return request(`/api/v1/candidate/notifications/preferences/${key}`, {
    method: 'PUT',
    body: JSON.stringify(preference),
  });
}

export function startTelegramLink(): Promise<{
  readonly startUrl: string;
  readonly expiresAt: string;
}> {
  return request('/api/v1/candidate/notifications/telegram/link', { method: 'POST', body: '{}' });
}

export function disconnectTelegram(): Promise<{
  readonly connected: false;
  readonly disconnected: boolean;
}> {
  return request('/api/v1/candidate/notifications/telegram/connection', { method: 'DELETE' });
}

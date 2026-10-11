import { apiFetch, readData } from '../coach/apiClient';

export type NotificationEventKind =
  | 'email_approval'
  | 'post_approval'
  | 'interview_reminder'
  | 'new_vacancies_by_role'
  | 'employer_opened_letter'
  | 'consultant_edits'
  | 'footprint_findings'
  | 'import_completed'
  | 'employer_reply'
  | 'delivery_error';

export interface CandidateNotification {
  readonly id: string;
  readonly kind: NotificationEventKind;
  readonly title: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly action: { readonly label: string; readonly href: string };
}

export interface CandidateNotificationPage {
  readonly items: readonly CandidateNotification[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
}

const NOTIFICATIONS_API = '/api/v1/candidate/notifications';

export async function listNotifications(options: {
  readonly limit: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}): Promise<CandidateNotificationPage> {
  const query = new URLSearchParams({ limit: String(options.limit) });
  if (options.cursor) query.set('cursor', options.cursor);
  const response = await apiFetch(`${NOTIFICATIONS_API}?${query}`, { signal: options.signal });
  return readData<CandidateNotificationPage>(response);
}

export async function markNotificationRead(notificationId: string): Promise<{ readonly id: string; readonly readAt: string }> {
  const response = await apiFetch(`${NOTIFICATIONS_API}/${encodeURIComponent(notificationId)}/read`, { method: 'PUT' });
  return readData<{ readonly id: string; readonly readAt: string }>(response);
}

export async function markAllNotificationsRead(): Promise<{ readonly updated: number }> {
  const response = await apiFetch(`${NOTIFICATIONS_API}/read-all`, { method: 'PUT' });
  return readData<{ readonly updated: number }>(response);
}

import { apiFetch, readData } from '../../coach/apiClient';
import type { NotificationEventKind } from '../../notifications/notificationsApi';

/** B671: виды ленты нового кабинета — прежние и выведенные из стадии отклика. */
export type B640NotificationKind =
  | NotificationEventKind
  | 'interview_invitation'
  | 'offer'
  | 'questionnaire'
  | 'platform_login_required';

export type NotificationCategory = 'invitations' | 'responses' | 'vacancies' | 'other';
export type NotificationFilter = 'all' | Exclude<NotificationCategory, 'other'>;

export interface B640Notification {
  readonly id: string;
  readonly kind: B640NotificationKind;
  readonly category: NotificationCategory;
  readonly important: boolean;
  readonly title: string;
  readonly company: string | null;
  readonly role: string | null;
  /** Время самого события (интервью), если известно. */
  readonly eventAt: string | null;
  /** Подпись подборки «выше 450 тыс. ₽»; есть только при пороге зарплаты кандидата. */
  readonly note?: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Непрочитанные повторы того же дня, свёрнутые в эту строку: читаются вместе с ней. */
  readonly mergedUnreadIds?: readonly string[];
}

export interface B640NotificationPage {
  readonly items: readonly B640Notification[];
  /** Важные непрочитанные: закреплены сверху, в `items` их нет. */
  readonly pinned: readonly B640Notification[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
}

export async function listB640Notifications(options: {
  readonly category: NotificationFilter;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}): Promise<B640NotificationPage> {
  const query = new URLSearchParams({
    category: options.category,
    limit: String(options.limit ?? 20),
  });
  if (options.cursor) query.set('cursor', options.cursor);
  return readData<B640NotificationPage>(
    await apiFetch(`/api/v1/candidate/b640/notifications?${query.toString()}`, {
      signal: options.signal,
    }),
  );
}

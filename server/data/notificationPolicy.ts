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

export type NotificationPreferenceKey =
  | 'ev-reply'
  | 'ev-reminder'
  | 'ev-approval'
  | 'ev-delivery-error'
  | 'ev-target-company'
  | 'ev-weekly-digest';

export interface NotificationPreference {
  readonly key: NotificationPreferenceKey;
  readonly app: boolean;
  readonly email: boolean;
}

export interface NotificationEventInput {
  readonly idempotencyKey: string;
  readonly kind: NotificationEventKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly createdAt?: string;
}

export interface NotificationItem {
  readonly id: string;
  readonly kind: NotificationEventKind;
  readonly title: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly action: { readonly label: string; readonly href: string };
}

export interface NotificationPage {
  readonly items: readonly NotificationItem[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: readonly NotificationPreference[] = [
  { key: 'ev-reply', app: true, email: true },
  { key: 'ev-reminder', app: true, email: false },
  { key: 'ev-approval', app: true, email: false },
  { key: 'ev-delivery-error', app: true, email: true },
  { key: 'ev-target-company', app: true, email: false },
  { key: 'ev-weekly-digest', app: true, email: true },
];

const EVENT_PRESENTATION: Record<NotificationEventKind, { title: string; action: string; view: string }> = {
  email_approval: { title: 'Письмо ждёт одобрения', action: 'Открыть письмо', view: 'profile' },
  post_approval: { title: 'Пост ждёт одобрения', action: 'Открыть пост', view: 'profile' },
  interview_reminder: { title: 'Скоро интервью', action: 'Напомнить за день', view: 'responses' },
  new_vacancies_by_role: { title: 'Новые вакансии по вашей роли', action: 'Смотреть вакансии', view: 'opportunities' },
  employer_opened_letter: { title: 'Работодатель открыл письмо', action: 'Открыть отклик', view: 'responses' },
  consultant_edits: { title: 'Консультант предложил правки', action: 'Посмотреть правки', view: 'profile' },
  footprint_findings: { title: 'Есть находки для проверки', action: 'Подтвердить находки', view: 'profile' },
  import_completed: { title: 'Импорт профиля завершён', action: 'Открыть профиль', view: 'profile' },
  employer_reply: { title: 'Есть ответ работодателя', action: 'Напомнить рекрутеру', view: 'responses' },
  delivery_error: { title: 'Отклик не доставлен', action: 'Открыть отклик', view: 'responses' },
};

const EVENT_PREFERENCE: Record<NotificationEventKind, NotificationPreferenceKey | null> = {
  email_approval: 'ev-approval',
  post_approval: 'ev-approval',
  interview_reminder: 'ev-reminder',
  new_vacancies_by_role: null,
  employer_opened_letter: null,
  consultant_edits: null,
  footprint_findings: null,
  import_completed: null,
  employer_reply: 'ev-reply',
  delivery_error: 'ev-delivery-error',
};

export function notificationPreferenceKey(kind: NotificationEventKind): NotificationPreferenceKey | null {
  return EVENT_PREFERENCE[kind];
}

export function presentNotification(
  input: { readonly id: string; readonly kind: NotificationEventKind; readonly createdAt: string; readonly readAt: string | null; readonly sourceId: string },
): NotificationItem {
  const presentation = EVENT_PRESENTATION[input.kind];
  const href = new URLSearchParams({ view: presentation.view, notificationSource: input.sourceId });
  return {
    id: input.id,
    kind: input.kind,
    title: presentation.title,
    createdAt: input.createdAt,
    readAt: input.readAt,
    action: { label: presentation.action, href: `/app?${href.toString()}` },
  };
}

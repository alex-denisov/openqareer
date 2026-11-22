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
  | 'delivery_error'
  /** B695: наступило время поста из очереди LinkedIn. */
  | 'post_reminder';

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
  readonly telegram: boolean;
}

export interface NotificationPreferenceChannels {
  readonly app: boolean;
  readonly email: boolean;
  readonly telegram?: boolean;
}

export interface NotificationEventInput {
  readonly idempotencyKey: string;
  readonly kind: NotificationEventKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly createdAt?: string;
  /** B671: ответ работодателя — приглашение или оффер; доставка идёт по ключу «Приглашения», если он сохранён. */
  readonly invitation?: boolean;
  /** B731: когда отправить по каналам (напоминание за сутки); прошедшее время — не отправлять. */
  readonly deliverAt?: string;
}

export interface NotificationItem {
  readonly id: string;
  readonly kind: NotificationEventKind;
  readonly title: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly action: { readonly label: string; readonly href: string };
  /** B690: только у уведомлений о входе в площадку; у остальных поля нет. */
  readonly source?: typeof HH_SESSION_SOURCE;
}

export interface NotificationPage {
  readonly items: readonly NotificationItem[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: readonly NotificationPreference[] = [
  { key: 'ev-reply', app: true, email: true, telegram: true },
  { key: 'ev-reminder', app: true, email: false, telegram: true },
  { key: 'ev-approval', app: true, email: false, telegram: false },
  { key: 'ev-delivery-error', app: true, email: true, telegram: true },
  { key: 'ev-target-company', app: true, email: false, telegram: false },
  { key: 'ev-weekly-digest', app: true, email: true, telegram: false },
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
  post_reminder: { title: 'Пора опубликовать пост', action: 'Открыть пост', view: 'profile' },
};

const EVENT_PREFERENCE: Record<NotificationEventKind, NotificationPreferenceKey | null> = {
  email_approval: 'ev-approval',
  post_approval: 'ev-approval',
  interview_reminder: 'ev-reminder',
  new_vacancies_by_role: 'ev-target-company',
  employer_opened_letter: 'ev-reply',
  consultant_edits: 'ev-weekly-digest',
  footprint_findings: 'ev-weekly-digest',
  import_completed: 'ev-weekly-digest',
  employer_reply: 'ev-reply',
  delivery_error: 'ev-delivery-error',
  post_reminder: 'ev-reminder',
};

export function notificationPreferenceKey(kind: NotificationEventKind): NotificationPreferenceKey | null {
  return EVENT_PREFERENCE[kind];
}

/** B690: источник уведомления «вход в hh.ru истёк»; вид — `delivery_error`, подача — своя. */
export const HH_SESSION_SOURCE = 'hh_session';

/** B695: напоминание о посте ведёт в очередь постов нового кабинета (a03b). */
export const LINKEDIN_POSTS_PATH = '/app/profile/linkedin/posts';

export function presentNotification(
  input: {
    readonly id: string;
    readonly kind: NotificationEventKind;
    readonly createdAt: string;
    readonly readAt: string | null;
    readonly sourceId: string;
    readonly sourceType?: string;
  },
): NotificationItem {
  const base = { id: input.id, kind: input.kind, createdAt: input.createdAt, readAt: input.readAt };
  if (input.sourceType === HH_SESSION_SOURCE) {
    return {
      ...base,
      title: 'Вход в hh.ru истёк',
      action: { label: 'Войти снова', href: '/app/account/connections' },
      source: HH_SESSION_SOURCE,
    };
  }
  const presentation = EVENT_PRESENTATION[input.kind];
  if (input.kind === 'post_reminder') {
    return { ...base, title: presentation.title, action: { label: presentation.action, href: LINKEDIN_POSTS_PATH } };
  }
  const href = new URLSearchParams({ view: presentation.view, notificationSource: input.sourceId });
  return { ...base, title: presentation.title, action: { label: presentation.action, href: `/app?${href.toString()}` } };
}

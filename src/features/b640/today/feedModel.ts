import type { IconName } from '../kit';
import { buildNodePath } from '../routes';
import type {
  B640Notification,
  B640NotificationKind,
  NotificationFilter,
} from './b640NotificationsApi';
import { COMMENT_ACTION, notificationWhen, type NotificationAction } from './notificationsModel';

/** Фильтры ленты N01b по категории события. */
export const FEED_FILTERS: readonly {
  readonly value: NotificationFilter;
  readonly label: string;
}[] = [
  { value: 'all', label: 'Все' },
  { value: 'invitations', label: 'Приглашения' },
  { value: 'responses', label: 'Отклики' },
  { value: 'vacancies', label: 'Вакансии' },
];

/** Подпись и раздел по виду; `response` — открыть сам отклик. */
const KIND_ACTION: Record<
  B640NotificationKind,
  NotificationAction | { readonly label: string; readonly response: true }
> = {
  interview_invitation: { label: 'Ответить', response: true },
  offer: { label: 'Ответить', response: true },
  questionnaire: { label: 'Заполнить', response: true },
  platform_login_required: { label: 'Подключить', path: buildNodePath('n03') },
  email_approval: { label: 'Проверить письмо', path: buildNodePath('o01') },
  post_approval: { label: 'Открыть пост', path: buildNodePath('a03b') },
  interview_reminder: { label: 'Подготовиться', path: '/app/responses/next/interview' },
  new_vacancies_by_role: { label: 'Смотреть вакансии', path: buildNodePath('s07') },
  employer_opened_letter: { label: 'Открыть отклик', response: true },
  consultant_edits: { label: 'Посмотреть правки', path: buildNodePath('p06') },
  footprint_findings: { label: 'Посмотреть находку', path: buildNodePath('p02') },
  import_completed: { label: 'Открыть профиль', path: buildNodePath('s01') },
  employer_reply: { label: 'Открыть отклик', response: true },
  delivery_error: { label: 'Открыть отклик', response: true },
  post_reminder: { label: 'Открыть пост', path: buildNodePath('a03b') },
};

const HH_LOGIN_ACTION: NotificationAction = { label: 'Подключить', path: buildNodePath('n03') };

function isHhLogin(item: B640Notification): boolean {
  return item.kind === 'delivery_error' && item.sourceType === 'hh_session';
}

/** Одно действие события: отклик по его id, иначе раздел кабинета. */
export function feedAction(item: B640Notification): NotificationAction {
  if (item.sourceType === 'linkedin_queue_comment') return COMMENT_ACTION;
  // B704: вход в hh.ru истёк — вход заново в «Подключениях», отклика у события нет.
  if (isHhLogin(item)) return HH_LOGIN_ACTION;
  const action = KIND_ACTION[item.kind];
  if (!('response' in action)) return action;
  return item.sourceType === 'application'
    ? { label: action.label, path: buildNodePath('o01c', { responseId: item.sourceId }) }
    : { label: action.label, path: buildNodePath('o01') };
}

function eventLabel(eventAt: string, timeZone?: string): string | null {
  const date = new Date(eventAt);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone }).format(
    date,
  );
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
  return `${day}, ${time}`;
}

/** «Роль · 12 ноября, 15:00 · 10:05»: что известно о событии и когда пришло уведомление. */
export function feedSubtitle(item: B640Notification, now: Date, timeZone: string): string {
  return [
    item.role,
    item.eventAt ? eventLabel(item.eventAt, timeZone) : null,
    // B671: время события — само время записи (подборка): дату второй раз не пишем.
    item.eventAt === item.createdAt
      ? null
      : notificationWhen(item.createdAt, now, timeZone) || null,
    item.note ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Действие в блоке «Важно»: по макету n01b у кнопки есть иконка. */
export interface PinnedAction extends NotificationAction {
  readonly icon?: IconName;
}

/**
 * n01b «Важно»: сбой доставки — «Отклик не дошёл · компания · роль» и «Повторить» к письму
 * отклика (там «Отправить ещё раз»); вход на площадку — «Подключить» с иконкой обновления.
 */
export function pinnedTitle(item: B640Notification, timeZone?: string): string {
  const title =
    item.kind === 'delivery_error' && item.sourceType === 'application'
      ? ['Отклик не дошёл', item.company].filter(Boolean).join(' · ')
      : item.title;
  // B671: у напоминания об интервью важно и когда оно.
  const when =
    item.kind === 'interview_reminder' && item.eventAt ? eventLabel(item.eventAt, timeZone) : null;
  return [title, item.role, when].filter(Boolean).join(' · ');
}

export function pinnedAction(item: B640Notification): PinnedAction {
  if (item.kind === 'delivery_error' && item.sourceType === 'application') {
    return {
      label: 'Повторить',
      path: buildNodePath('o02', { responseId: item.sourceId }),
      icon: 'repeat',
    };
  }
  const action = feedAction(item);
  return item.kind === 'platform_login_required' || isHhLogin(item) ? { ...action, icon: 'refresh' } : action;
}

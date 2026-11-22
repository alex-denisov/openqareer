import { pluralRu } from '../../../../shared/pluralRu';
import type {
  CandidateNotification,
  NotificationEventKind,
} from '../../notifications/notificationsApi';
import { notificationSourceId } from '../../notifications/notificationPresentation';
import { buildNodePath } from '../routes';

export interface NotificationAction {
  readonly label: string;
  readonly path: string;
}

/** Подпись кнопки и раздел нового кабинета по виду события. */
const KIND_ACTION: Record<NotificationEventKind, NotificationAction> = {
  email_approval: { label: 'Проверить письмо', path: buildNodePath('o01') },
  post_approval: { label: 'Открыть пост', path: buildNodePath('a03b') },
  interview_reminder: { label: 'Подготовиться', path: '/app/responses/next/interview' },
  new_vacancies_by_role: { label: 'Смотреть вакансии', path: buildNodePath('s07') },
  employer_opened_letter: { label: 'Открыть отклик', path: buildNodePath('o01') },
  consultant_edits: { label: 'Посмотреть правки', path: buildNodePath('p06') },
  footprint_findings: { label: 'Посмотреть находку', path: buildNodePath('p02') },
  import_completed: { label: 'Открыть профиль', path: buildNodePath('s01') },
  employer_reply: { label: 'Открыть отклик', path: buildNodePath('o01') },
  delivery_error: { label: 'Открыть отклик', path: buildNodePath('o01') },
  post_reminder: { label: 'Открыть пост', path: buildNodePath('a03b') },
};

const HH_LOGIN_ACTION: NotificationAction = { label: 'Войти снова', path: buildNodePath('n03') };

/** Куда ведёт кнопка события. Ответ работодателя знает свой отклик, истёкший вход hh.ru — «Подключения». */
export function notificationAction(item: CandidateNotification): NotificationAction {
  if (item.source === 'hh_session') return HH_LOGIN_ACTION;
  const base = KIND_ACTION[item.kind];
  const sourceId = item.kind === 'employer_reply' ? notificationSourceId(item) : null;
  return sourceId ? { ...base, path: buildNodePath('o01c', { responseId: sourceId }) } : base;
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

function isSameDay(createdAt: string, now: Date, timeZone: string): boolean {
  const date = new Date(createdAt);
  return !Number.isNaN(date.getTime()) && dayKey(date, timeZone) === dayKey(now, timeZone);
}

export interface NotificationGroups<T> {
  readonly today: readonly T[];
  readonly earlier: readonly T[];
}

export function groupNotifications<T extends { readonly createdAt: string }>(
  items: readonly T[],
  now: Date,
  timeZone: string,
): NotificationGroups<T> {
  return {
    today: items.filter((item) => isSameDay(item.createdAt, now, timeZone)),
    earlier: items.filter((item) => !isSameDay(item.createdAt, now, timeZone)),
  };
}

/** «10:30» у сегодняшнего события, «10 ноября» у прежнего. */
export function notificationWhen(createdAt: string, now: Date, timeZone: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const options: Intl.DateTimeFormatOptions = isSameDay(createdAt, now, timeZone)
    ? { hour: '2-digit', minute: '2-digit', timeZone }
    : { day: 'numeric', month: 'long', timeZone };
  return new Intl.DateTimeFormat('ru-RU', options).format(date);
}

export function unreadHeading(unreadCount: number): string {
  return unreadCount > 0 ? pluralRu(unreadCount, ['новое', 'новых', 'новых']) : 'Новых нет';
}

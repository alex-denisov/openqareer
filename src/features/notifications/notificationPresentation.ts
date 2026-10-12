import type { ShellSection } from '../shell/shellNavigation';
import type { CandidateNotification, NotificationEventKind } from './notificationsApi';

const BODY: Record<NotificationEventKind, string> = {
  email_approval: 'Черновик письма ждёт вашей проверки. Без одобрения он не будет отправлен.',
  post_approval: 'Черновик поста ждёт вашей проверки. Сам он не будет опубликован.',
  interview_reminder: 'В отклике назначено интервью. Проверьте детали и при необходимости задайте напоминание.',
  new_vacancies_by_role: 'В подборке появились вакансии по выбранной роли.',
  employer_opened_letter: 'Система зафиксировала открытие письма работодателем.',
  consultant_edits: 'Правки консультанта не изменят профиль, пока вы их не подтвердите.',
  footprint_findings: 'Находки цифрового следа видите только вы. Без подтверждения они не попадут в профиль.',
  import_completed: 'Импорт завершён. Проверьте сведения в профиле перед использованием.',
  employer_reply: 'В отклике зафиксирован ответ работодателя.',
  delivery_error: 'Доставка отклика не подтверждена. Проверьте карточку отклика.',
};

const SOURCE: Record<NotificationEventKind, string> = {
  email_approval: 'Черновик письма',
  post_approval: 'Черновик поста',
  interview_reminder: 'Расписание интервью',
  new_vacancies_by_role: 'Подборка вакансий',
  employer_opened_letter: 'Событие письма',
  consultant_edits: 'Беседа с консультантом',
  footprint_findings: 'Проверка цифрового следа',
  import_completed: 'Импорт профиля',
  employer_reply: 'Трекер откликов',
  delivery_error: 'Трекер откликов',
};

export function notificationDescription(kind: NotificationEventKind): string {
  return BODY[kind];
}

export function notificationSource(kind: NotificationEventKind): string {
  return SOURCE[kind];
}

export function notificationPrimaryLabel(item: CandidateNotification): string {
  if (item.kind === 'interview_reminder') return 'Подготовиться';
  if (item.kind === 'employer_reply') return 'Открыть отклик';
  return item.action.label;
}

export function notificationSecondaryLabel(item: CandidateNotification): string | null {
  if (item.kind === 'interview_reminder' && notificationSourceId(item)) return item.action.label;
  if (item.kind === 'employer_reply' && notificationSourceId(item)) return item.action.label;
  return null;
}

export function notificationTargetView(item: CandidateNotification): ShellSection {
  const view = new URL(item.action.href, 'https://openqareer.invalid').searchParams.get('view');
  if (view === 'profile' || view === 'responses' || view === 'opportunities') return view;
  return 'today';
}

export function notificationSourceId(item: CandidateNotification): string | null {
  return new URL(item.action.href, 'https://openqareer.invalid').searchParams.get('notificationSource');
}

export function isNotificationToday(createdAt: string, now = new Date()): boolean {
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

export function notificationDateLabel(createdAt: string, now = new Date()): string {
  if (isNotificationToday(createdAt, now)) return 'сегодня';
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date)
    : 'дата неизвестна';
}

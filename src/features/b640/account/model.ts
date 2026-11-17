import type { AccountSnapshot } from '../../coach/cabinetTypes';
import type { CandidateConnection } from '../../coach/coachApi';
import type {
  NotificationChannelPreference,
  NotificationPreferenceKey,
} from '../../account/notificationPreferencesApi';

export type AccountSession = AccountSnapshot['sessions'][number];

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

export function securitySummary(devices: number): string {
  return `Пароль, ${devices} ${plural(devices, 'устройство', 'устройства', 'устройств')}`;
}

export function devicesTitle(devices: number): string {
  return `Устройства · ${devices}`;
}

export const PLATFORM_NAME: Readonly<Record<CandidateConnection['platform'], string>> = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
};

/** «hh.ru и LinkedIn подключены» в списке разделов. */
export function connectionsSummary(connections: readonly CandidateConnection[]): string {
  const names = connections
    .filter((item) => item.status === 'connected')
    .map((item) => PLATFORM_NAME[item.platform]);
  if (names.length === 0) return 'Площадки не подключены';
  return names.length === 1 ? `${names[0]} подключён` : `${names.join(' и ')} подключены`;
}

export function connectionLine(connection: CandidateConnection): string {
  if (connection.status === 'connected') return 'подключено';
  return connection.status === 'imported' ? 'данные загружены, вход не выполнен' : 'не подключено';
}

export interface ConnectedInput {
  readonly emailVerified: boolean;
  readonly connections: readonly CandidateConnection[];
  /** Подключён ли Telegram; `null` — канала нет, в счёт он не идёт. */
  readonly telegram: boolean | null;
}

/** «Подключено 3 из 4»: почта, площадки и Telegram. */
export function connectedCount(input: ConnectedInput): { connected: number; total: number } {
  const platforms = input.connections.filter((item) => item.status === 'connected').length;
  return {
    connected: Number(input.emailVerified) + platforms + Number(input.telegram === true),
    total: 3 + Number(input.telegram !== null),
  };
}

const HOUR_MINUTE = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const DAY_MS = 86_400_000;

/** «сегодня, 09:12», «вчера, 22:40» или «3 ноября»; `null` — дата не разобрана. */
function whenLabel(iso: string, now: Date): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `сегодня, ${HOUR_MINUTE.format(date)}`;
  if (date.getTime() >= startOfToday - DAY_MS) return `вчера, ${HOUR_MINUTE.format(date)}`;
  return DAY_MONTH.format(date);
}

export function updatedLine(iso: string, now: Date = new Date()): string | null {
  const when = whenLabel(iso, now);
  return when ? `Обновлено ${when}` : null;
}

export function deviceLine(session: AccountSession, now: Date = new Date()): string {
  if (session.current) return 'сейчас · эта сессия';
  return whenLabel(session.lastSeenAt, now) ?? 'давно';
}

export function deviceName(session: AccountSession): string {
  return session.current ? 'Это устройство' : 'Другое устройство';
}

export interface NotificationRow {
  readonly key: NotificationPreferenceKey;
  readonly label: string;
}

/** События, которые умеет присылать сервер, в порядке макета N2. */
export const NOTIFICATION_ROWS: readonly NotificationRow[] = [
  { key: 'ev-reply', label: 'Ответы' },
  { key: 'ev-reminder', label: 'Напоминания' },
  { key: 'ev-approval', label: 'Письмо на одобрение' },
  { key: 'ev-delivery-error', label: 'Сбой отклика' },
  { key: 'ev-target-company', label: 'Вакансии нужных компаний' },
  { key: 'ev-weekly-digest', label: 'Итоги недели' },
];

export const CHANNEL_LABEL = { app: 'Приложение', email: 'Почта', telegram: 'Telegram' } as const;
export type NotificationChannel = keyof typeof CHANNEL_LABEL;

const CHANNEL_PLACE: Readonly<Record<NotificationChannel, string>> = {
  app: 'в приложении',
  email: 'на почту',
  telegram: 'в Telegram',
};

/** «В приложении и на почту» в списке разделов. */
export function notificationsSummary(preferences: readonly NotificationChannelPreference[]): string {
  const places = (Object.keys(CHANNEL_PLACE) as NotificationChannel[])
    .filter((channel) => preferences.some((item) => item[channel]))
    .map((channel) => CHANNEL_PLACE[channel]);
  if (places.length === 0) return 'Выключены';
  const text = places.length === 1 ? places[0] : `${places.slice(0, -1).join(', ')} и ${places.at(-1)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function consentsSummary(granted: number): string {
  const word = plural(granted, 'согласие', 'согласия', 'согласий');
  return granted > 0 ? `${granted} ${word}, выгрузка, удаление` : 'Выгрузка, удаление';
}

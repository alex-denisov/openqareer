import { isValidTimezone } from '../../shared/timezoneUtils';
import { startOfDayIn } from '../routes/careerRoleCounts';

/** n02 «Как часто»: как почта и Telegram присылают уведомления. В приложении — всегда сразу. */
export type DeliveryFrequency = 'immediate' | 'daily' | 'weekly';

export const DELIVERY_FREQUENCIES: readonly DeliveryFrequency[] = ['immediate', 'daily', 'weekly'];

/** Пояс по умолчанию, пока кандидат не сохранил настройку со своего устройства. */
export const DEFAULT_DELIVERY_TIME_ZONE = 'Europe/Moscow';

const DAY_MS = 86_400_000;
/** Сводка уходит утром: 09:00 по поясу кандидата; недельная — в понедельник. */
const DIGEST_HOUR_MS = 9 * 60 * 60 * 1_000;

function weekdayIn(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(at));
}

/**
 * Момент сводки, в которую попадает уведомление, записанное в `createdAt`: первые 09:00
 * (для недели — понедельника) строго после записи. `null` — «Сразу», без ожидания.
 */
export function digestSlotAfter(
  createdAt: string,
  frequency: DeliveryFrequency,
  timeZone: string,
): string | null {
  if (frequency === 'immediate') return null;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return null;
  const zone = isValidTimezone(timeZone) ? timeZone : DEFAULT_DELIVERY_TIME_ZONE;
  const today = startOfDayIn(new Date(at), zone);
  for (let day = 0; day <= 8; day += 1) {
    // Полдень дня `day` надёжно лежит в нужных сутках даже при переводе часов.
    const dayStart = startOfDayIn(new Date(today + day * DAY_MS + DAY_MS / 2), zone);
    const slot = dayStart + DIGEST_HOUR_MS;
    if (slot <= at) continue;
    if (frequency === 'weekly' && weekdayIn(dayStart + DAY_MS / 2, zone) !== 'Mon') continue;
    return new Date(slot).toISOString();
  }
  return null;
}

/** Строка уведомления в письме и Telegram: компания — только если кандидат её не скрыл. */
export function notificationLine(title: string, company: string | null, hideCompany: boolean): string {
  const name = company?.trim();
  return name && !hideCompany ? `${title} · ${name}` : title;
}

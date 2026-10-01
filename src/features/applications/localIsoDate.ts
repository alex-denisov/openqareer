import { formatLocalDate } from '../../../shared/timezoneUtils';

/**
 * Сегодняшняя дата в поясе кандидата, а не в UTC (B341): в 01:00 МСК
 * `toISOString()` давал вчерашнее число в поле даты этапа.
 */
export function localIsoDate(
  now: Date = new Date(),
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return formatLocalDate(now, timezone);
}

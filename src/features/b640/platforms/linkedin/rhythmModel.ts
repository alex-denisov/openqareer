import {
  LINKEDIN_RHYTHM_DAYS,
  type LinkedinCommentRhythm,
  type LinkedinQueueItem,
  type LinkedinRhythmDay,
} from '../../../../../shared/b640LinkedinQueue';

const DAY_MS = 86_400_000;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;
/** getUTCDay() воскресенье = 0. */
const DAY_BY_INDEX: readonly LinkedinRhythmDay[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

export const DAY_LABELS: Readonly<Record<LinkedinRhythmDay, string>> = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Вс',
};

/** Дни в порядке недели, без повторов. */
export const orderedDays = (days: readonly LinkedinRhythmDay[]): LinkedinRhythmDay[] =>
  LINKEDIN_RHYTHM_DAYS.filter((day) => days.includes(day));

function localDate(at: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

function parts(iso: string, timezone: string) {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    formatted.find((part) => part.type === type)?.value ?? '';
  return {
    weekday: pick('weekday'),
    date: `${pick('day')} ${pick('month')}`,
    time: `${pick('hour')}:${pick('minute')}`,
  };
}

/** Сколько дней от сегодня до дня `iso` в поясе ритма: 0 — сегодня, 1 — завтра. */
function daysAhead(iso: string, timezone: string, now: number): number {
  const day = (at: number) => Date.parse(`${localDate(at, timezone)}T00:00:00Z`);
  return Math.round((day(Date.parse(iso)) - day(now)) / DAY_MS);
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Строка очереди a05b: «Сегодня, 14:20», «Завтра, 10:00», «Пн, 16 ноября, 10:00». */
export function queueWhen(iso: string, timezone: string, now: number): string {
  const { weekday, date, time } = parts(iso, timezone);
  const ahead = daysAhead(iso, timezone, now);
  if (ahead === 0) return `Сегодня, ${time}`;
  if (ahead === 1) return `Завтра, ${time}`;
  return `${capital(weekday)}, ${date}, ${time}`;
}

/** «Следующий — сегодня в 14:20». */
export function nextText(iso: string, timezone: string, now: number): string {
  const { weekday, date, time } = parts(iso, timezone);
  const ahead = daysAhead(iso, timezone, now);
  if (ahead === 0) return `сегодня в ${time}`;
  if (ahead === 1) return `завтра в ${time}`;
  return `${weekday}, ${date}, в ${time}`;
}

export interface TodayLeft {
  readonly left: number;
  readonly total: number;
}

/** a05: «Сегодня осталось X из Y»; `null`, если сегодня не день ритма комментариев. */
export function commentsToday(
  rhythm: LinkedinCommentRhythm,
  timezone: string,
  items: readonly LinkedinQueueItem[],
  now: number,
): TodayLeft | null {
  const today = localDate(now, timezone);
  const weekday = DAY_BY_INDEX[new Date(`${today}T00:00:00Z`).getUTCDay()];
  if (!rhythm.days.includes(weekday)) return null;
  const used = items.filter(
    (item) =>
      item.kind === 'comment' &&
      item.state !== 'removed' &&
      localDate(Date.parse(item.scheduledAt), timezone) === today,
  ).length;
  return { left: Math.max(0, rhythm.perDay - used), total: rhythm.perDay };
}

/** Ошибка окна «с … до …» или `null`. */
export function windowError(from: string, to: string): string | null {
  if (!CLOCK.test(from) || !CLOCK.test(to)) return 'Время — в виде 09:00';
  return from < to ? null : '«С» должно быть раньше «до»';
}

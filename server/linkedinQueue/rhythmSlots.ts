import { formatLocalDate } from '../../shared/timezoneUtils';
import type { LinkedinCommentRhythm, LinkedinRhythm, LinkedinRhythmDay } from '../../shared/b640LinkedinQueue';

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 120;
/** getUTCDay() воскресенье = 0. */
const DAY_BY_INDEX: readonly LinkedinRhythmDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function offsetMs(timezone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(at / 1000) * 1000;
}

/** Местные дата (YYYY-MM-DD) и время (HH:MM) в поясе → момент UTC; учитывает переход на летнее время. */
export function localToUtc(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(timezone, guess);
  return guess - offsetMs(timezone, first);
}

/** Понедельник недели для гражданской даты: ключ недели. */
export function weekKey(civilDate: string): string {
  const base = Date.parse(`${civilDate}T00:00:00Z`);
  const back = (new Date(base).getUTCDay() + 6) % 7;
  return new Date(base - back * DAY_MS).toISOString().slice(0, 10);
}

export function weekKeyOfInstant(iso: string, timezone: string): string {
  return weekKey(formatLocalDate(new Date(iso), timezone));
}

export interface SlotInput {
  readonly rhythm: LinkedinRhythm;
  readonly now: number;
  /** Занятые моменты (ISO) очереди — слот не повторяется. */
  readonly takenAt: readonly string[];
  /** Сколько постов уже стоит в каждой неделе (ключ — понедельник). */
  readonly postsByWeek: ReadonlyMap<string, number>;
  readonly respectWeeklyCap: boolean;
}

/** Ближайший свободный слот ритма после `now`; `null`, если за горизонт слота нет. */
export function nextFreeSlot(input: SlotInput): string | null {
  const { rhythm, now } = input;
  const taken = new Set(input.takenAt.map((iso) => new Date(iso).getTime()));
  const start = Date.parse(`${formatLocalDate(new Date(now), rhythm.timezone)}T00:00:00Z`);
  const planned = new Map(input.postsByWeek);
  for (let step = 0; step < HORIZON_DAYS; step += 1) {
    const civil = new Date(start + step * DAY_MS);
    if (!rhythm.days.includes(DAY_BY_INDEX[civil.getUTCDay()])) continue;
    const date = civil.toISOString().slice(0, 10);
    const moment = localToUtc(date, rhythm.time, rhythm.timezone);
    if (moment <= now || taken.has(moment)) continue;
    const key = weekKey(date);
    if (input.respectWeeklyCap && (planned.get(key) ?? 0) >= rhythm.postsPerWeek) continue;
    return new Date(moment).toISOString();
  }
  return null;
}

const minutesOf = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};
const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** a05e: `perDay` слотов дня делят окно поровну: 2 в 10:00–18:00 → 10:00 и 14:00. */
export function commentDayTimes(rhythm: LinkedinCommentRhythm): string[] {
  const from = minutesOf(rhythm.from);
  const step = (minutesOf(rhythm.to) - from) / rhythm.perDay;
  return Array.from({ length: rhythm.perDay }, (_, index) => clockOf(from + Math.round(index * step)));
}

export interface CommentSlotInput {
  readonly rhythm: LinkedinCommentRhythm;
  readonly timezone: string;
  readonly now: number;
  /** Занятые моменты (ISO) очереди: слот не повторяется. */
  readonly takenAt: readonly string[];
}

/** Ближайший свободный слот ритма комментариев после `now`; `null` за горизонтом. */
export function nextCommentSlot(input: CommentSlotInput): string | null {
  const { rhythm, timezone, now } = input;
  const taken = new Set(input.takenAt.map((iso) => new Date(iso).getTime()));
  const times = commentDayTimes(rhythm);
  const start = Date.parse(`${formatLocalDate(new Date(now), timezone)}T00:00:00Z`);
  for (let step = 0; step < HORIZON_DAYS; step += 1) {
    const civil = new Date(start + step * DAY_MS);
    if (!rhythm.days.includes(DAY_BY_INDEX[civil.getUTCDay()])) continue;
    const date = civil.toISOString().slice(0, 10);
    for (const time of times) {
      const moment = localToUtc(date, time, timezone);
      if (moment > now && !taken.has(moment)) return new Date(moment).toISOString();
    }
  }
  return null;
}

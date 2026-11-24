import {
  HH_RAISE_CAPTCHA_PAUSE_HOURS,
  HH_RAISE_EVERY_HOURS,
  type HhRaiseOutcome,
} from '../../shared/b640HhRaise';
import type { HhRaiseSchedulePatch, HhRaiseScheduleRow } from './sqliteHhRaiseRepository';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Случайный сдвиг, чтобы поднятия не шли ровным ритмом; hh разрешает раз в 4 часа, сдвиг только вперёд. */
export const HH_RAISE_JITTER_MINUTES = 25;

export function nextAllowedAt(from: Date, random: () => number = Math.random): string {
  const jitter = Math.floor(random() * HH_RAISE_JITTER_MINUTES) * MINUTE_MS;
  return new Date(from.getTime() + HH_RAISE_EVERY_HOURS * HOUR_MS + jitter).toISOString();
}

const DAY_MS = 24 * HOUR_MS;
/** Москва без перехода на летнее время. */
const MOSCOW_OFFSET_MS = 3 * HOUR_MS;
/** Запас после времени с кнопки hh.ru. */
const CLOCK_MARGIN_MS = 2 * MINUTE_MS;

/** Ближайшее будущее «ЧЧ:ММ» по Москве с запасом, не дальше суток. */
export function nextAtMoscowClock(clock: string, now: Date): string {
  const [hours, minutes] = clock.split(':').map(Number);
  const midnight = Math.floor((now.getTime() + MOSCOW_OFFSET_MS) / DAY_MS) * DAY_MS - MOSCOW_OFFSET_MS;
  const at = midnight + hours * HOUR_MS + minutes * MINUTE_MS + CLOCK_MARGIN_MS;
  const fromNow = (at - now.getTime() + DAY_MS) % DAY_MS;
  return new Date(now.getTime() + (fromNow || DAY_MS)).toISOString();
}

/** Что менять в расписании после исхода поднятия; сам hh здесь не вызывается. */
export function applyOutcome(
  outcome: HhRaiseOutcome,
  now: Date,
  random: () => number = Math.random,
  availableAt?: string,
): HhRaiseSchedulePatch {
  const at = now.toISOString();
  const result = (status: 'ok' | 'error', reason: string | null) => ({ lastResult: status, lastReason: reason, lastResultAt: at });
  switch (outcome) {
    case 'ok':
      return { ...result('ok', null), lastRaisedAt: at, nextRaiseAt: nextAllowedAt(now, random), pausedUntil: null, pauseReason: null };
    case 'too_early':
      // hh сказал «ещё рано»: не сбой. Следующее — по времени с кнопки, без него от этого момента.
      return {
        ...result('ok', 'too_early'),
        nextRaiseAt: availableAt ? nextAtMoscowClock(availableAt, now) : nextAllowedAt(now, random),
      };
    case 'captcha': {
      const until = new Date(now.getTime() + HH_RAISE_CAPTCHA_PAUSE_HOURS * HOUR_MS).toISOString();
      return { ...result('error', 'captcha'), pausedUntil: until, pauseReason: 'captcha', nextRaiseAt: until };
    }
    case 'logged_out':
      return { ...result('error', 'logged_out'), pauseReason: 'logged_out', pausedUntil: null, nextRaiseAt: null };
    case 'foreign_page':
      return { ...result('error', 'foreign_page'), nextRaiseAt: nextAllowedAt(now, random) };
    default:
      return { ...result('error', 'error'), nextRaiseAt: nextAllowedAt(now, random) };
  }
}

/** Повтор после ошибки: можно ли ставить сейчас (прошло 4 часа с последнего успешного поднятия). */
export function canRaiseAt(lastRaisedAt: string | null, now: Date): boolean {
  return !lastRaisedAt || Date.parse(lastRaisedAt) + HH_RAISE_EVERY_HOURS * HOUR_MS <= now.getTime();
}

/** Первое поднятие нового расписания: скоро, но со сдвигом, а не в одну секунду для всех. */
export function firstRaiseAt(now: Date, random: () => number = Math.random): string {
  return new Date(now.getTime() + Math.floor(random() * HH_RAISE_JITTER_MINUTES) * MINUTE_MS).toISOString();
}

/** Ровно через интервал hh после последнего поднятия — раньше площадка не примет. */
export function raiseAvailableAt(lastRaisedAt: string): string {
  return new Date(Date.parse(lastRaisedAt) + HH_RAISE_EVERY_HOURS * HOUR_MS).toISOString();
}

/**
 * Что менять в расписании выбранного резюме. Капча относится к входу кандидата, поэтому её пауза
 * переходит от прежнего резюме; выход из hh.ru следующая попытка увидит сама. Поднятое раньше ждёт своих 4 часов.
 */
export function choicePatch(
  former: HhRaiseScheduleRow | null,
  chosen: HhRaiseScheduleRow | null,
  enabled: boolean,
  now: Date,
  random: () => number = Math.random,
): HhRaiseSchedulePatch {
  const planned = chosen?.nextRaiseAt ?? firstRaiseAt(now, random);
  const allowed = chosen?.lastRaisedAt ? raiseAvailableAt(chosen.lastRaisedAt) : planned;
  const captcha = former?.pauseReason === 'captcha';
  return {
    enabled,
    nextRaiseAt: planned > allowed ? planned : allowed,
    pauseReason: captcha ? 'captcha' : null,
    pausedUntil: captcha ? former.pausedUntil : null,
  };
}

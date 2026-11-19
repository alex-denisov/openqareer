import {
  HH_RAISE_CAPTCHA_PAUSE_HOURS,
  HH_RAISE_EVERY_HOURS,
  type HhRaiseOutcome,
} from '../../shared/b640HhRaise';
import type { HhRaiseSchedulePatch } from './sqliteHhRaiseRepository';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Случайный сдвиг, чтобы поднятия не шли ровным ритмом; hh разрешает раз в 4 часа, сдвиг только вперёд. */
export const HH_RAISE_JITTER_MINUTES = 25;

export function nextAllowedAt(from: Date, random: () => number = Math.random): string {
  const jitter = Math.floor(random() * HH_RAISE_JITTER_MINUTES) * MINUTE_MS;
  return new Date(from.getTime() + HH_RAISE_EVERY_HOURS * HOUR_MS + jitter).toISOString();
}

/** Что менять в расписании после исхода поднятия; сам hh здесь не вызывается. */
export function applyOutcome(
  outcome: HhRaiseOutcome,
  now: Date,
  random: () => number = Math.random,
): HhRaiseSchedulePatch {
  const at = now.toISOString();
  const result = (status: 'ok' | 'error', reason: string | null) => ({ lastResult: status, lastReason: reason, lastResultAt: at });
  switch (outcome) {
    case 'ok':
      return { ...result('ok', null), lastRaisedAt: at, nextRaiseAt: nextAllowedAt(now, random), pausedUntil: null, pauseReason: null };
    case 'too_early':
      // hh сказал «ещё рано»: следующий допустимый час, от этого момента.
      return { ...result('error', 'too_early'), nextRaiseAt: nextAllowedAt(now, random) };
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

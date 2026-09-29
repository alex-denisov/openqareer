export type CadenceMode = 'warmup' | 'active_search' | 'scout_pool';
export type CadencePageKind = 'skim' | 'read' | 'deep';

export interface ActivityWindow {
  readonly id: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly skipped: boolean;
}

export interface DayPlan {
  readonly accountId: string;
  readonly dateString: string;
  readonly dayOfWeek: number;
  readonly isWeekend: boolean;
  readonly dayStartMinutes: number;
  readonly dayEndMinutes: number;
  readonly isRestDay: boolean;
  readonly dailyPageBudget: number;
  readonly windows: readonly ActivityWindow[];
}

export type CadenceDecisionStatus =
  | 'run'
  | 'outside_window'
  | 'window_skipped'
  | 'rest_day'
  | 'daily_limit';

export interface CadenceDecision {
  readonly status: CadenceDecisionStatus;
  readonly nextWindowStart?: Date;
  readonly activeWindow?: ActivityWindow;
}

export function createDeterministicPrng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let s = h >>> 0;
  return function mulberry32() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pageDelayMs(pageKind: CadencePageKind, random: () => number = Math.random): number {
  const ranges: Record<CadencePageKind, [number, number]> = {
    skim: [3000, 8000],
    read: [9000, 18000],
    deep: [19000, 30000],
  };
  const [min, max] = ranges[pageKind];
  const sample = Math.min(1, Math.max(0, random()));
  return min + Math.round(sample * (max - min));
}

export function sessionShape(
  kind?: 'micro' | 'deep',
  random: () => number = Math.random,
): { durationMinutes: number; pageCount: number; isMicro: boolean } {
  const isMicro = kind ? kind === 'micro' : random() < 0.4;
  const sample = Math.min(1, Math.max(0, random()));
  if (isMicro) {
    return {
      durationMinutes: 3 + Math.round(sample * 4),
      pageCount: 4 + Math.round(sample * 6),
      isMicro: true,
    };
  }
  return {
    durationMinutes: 15 + Math.round(sample * 25),
    pageCount: 30 + Math.round(sample * 50),
    isMicro: false,
  };
}

function parseLocalDate(localDate: string | Date, timezone: string): { dateStr: string; year: number; month: number; day: number; dayOfWeek: number } {
  if (typeof localDate === 'string') {
    const [year, month, day] = localDate.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { dateStr: localDate, year, month, day, dayOfWeek };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(localDate);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { dateStr, year, month, day, dayOfWeek };
}

function isAccountRestDay(accountId: string, epochDay: number): boolean {
  const accPrng = createDeterministicPrng(`rest-anchor:${accountId}`);
  let currentRestDay = Math.floor(accPrng() * 6);
  if (epochDay < currentRestDay) return false;
  let cycle = 0;
  while (currentRestDay < epochDay + 15) {
    if (currentRestDay === epochDay) return true;
    const cyclePrng = createDeterministicPrng(`rest-cycle:${accountId}:${cycle}`);
    const weights = [7, 8, 9, 10, 11, 12].map((gap) => {
      const candidateDay = currentRestDay + gap;
      const dow = (candidateDay + 4) % 7;
      return dow === 0 || dow === 6 ? 3 : 1;
    });
    const totalW = weights.reduce((a, b) => a + b, 0);
    let r = cyclePrng() * totalW;
    let chosenGap = 9;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosenGap = 7 + i;
        break;
      }
    }
    currentRestDay += chosenGap;
    cycle++;
  }
  return false;
}

function buildWindows(
  isWeekend: boolean,
  startJit: number,
  endJit: number,
  isRestDay: boolean,
  prng: () => number,
): { dayStartMinutes: number; dayEndMinutes: number; windows: ActivityWindow[] } {
  let dayStartMinutes: number;
  let dayEndMinutes: number;
  let raw: Array<{ id: string; start: number; end: number }>;
  if (isWeekend) {
    dayStartMinutes = 11 * 60 + startJit;
    dayEndMinutes = 20 * 60 + endJit;
    raw = [
      { id: 'weekend_brunch', start: Math.max(dayStartMinutes, 11 * 60 + 30), end: 13 * 60 + 30 },
      { id: 'weekend_afternoon', start: 15 * 60, end: 17 * 60 },
      { id: 'weekend_evening', start: 18 * 60, end: Math.min(dayEndMinutes, 20 * 60) },
    ];
  } else {
    dayStartMinutes = 7 * 60 + startJit;
    dayEndMinutes = Math.min(24 * 60, 24 * 60 - (15 + Math.floor(prng() * 31)));
    raw = [
      { id: 'morning_commute', start: Math.max(dayStartMinutes, 7 * 60), end: 9 * 60 },
      { id: 'coffee_break', start: 11 * 60, end: 11 * 60 + 30 },
      { id: 'lunch_break', start: 13 * 60, end: 15 * 60 },
      { id: 'evening_commute', start: 17 * 60 + 30, end: 19 * 60 },
      { id: 'night_skimming', start: 21 * 60, end: dayEndMinutes },
    ];
  }
  const windows: ActivityWindow[] = raw.map((rw) => ({
    id: rw.id,
    startMinutes: rw.start,
    endMinutes: rw.end,
    skipped: isRestDay ? true : prng() < 0.25,
  }));
  if (!isRestDay && windows.every((w) => w.skipped)) {
    const longest = windows.reduce((a, b) => (b.endMinutes - b.startMinutes > a.endMinutes - a.startMinutes ? b : a));
    (longest as { skipped: boolean }).skipped = false;
  }
  return { dayStartMinutes, dayEndMinutes, windows };
}

function calculateDailyBudget(mode: CadenceMode, isRestDay: boolean, prng: () => number): number {
  if (isRestDay) return prng() < 0.4 ? 0 : 4 + Math.floor(prng() * 5);
  const budgetRanges: Record<CadenceMode, [number, number]> = {
    warmup: [50, 180],
    active_search: [150, 350],
    scout_pool: [200, 500],
  };
  const [minB, maxB] = budgetRanges[mode];
  let b = minB + Math.floor(prng() * (maxB - minB + 1));
  if (b % 10 === 0) b = b + 3 <= maxB ? b + 3 : b - 3;
  return b;
}

export function planDay(
  accountId: string,
  localDate: string | Date,
  mode: CadenceMode,
  timezone = 'UTC',
): DayPlan {
  const { dateStr, year, month, day, dayOfWeek } = parseLocalDate(localDate, timezone);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const prng = createDeterministicPrng(`${accountId}:${dateStr}`);
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const isRestDay = isAccountRestDay(accountId, epochDay);
  const startJitter = (prng() < 0.5 ? -1 : 1) * (15 + Math.floor(prng() * 31));
  const endJitter = (prng() < 0.5 ? -1 : 1) * (15 + Math.floor(prng() * 31));
  const { dayStartMinutes, dayEndMinutes, windows } = buildWindows(isWeekend, startJitter, endJitter, isRestDay, prng);
  const dailyPageBudget = calculateDailyBudget(mode, isRestDay, prng);

  return {
    accountId,
    dateString: dateStr,
    dayOfWeek,
    isWeekend,
    dayStartMinutes,
    dayEndMinutes,
    isRestDay,
    dailyPageBudget,
    windows,
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const val = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const match = /^GMT(?:(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2}))?$/u.exec(val);
  if (!match) return 0;
  const minutes = Number(match.groups?.hour ?? 0) * 60 + Number(match.groups?.minute ?? 0);
  return (match.groups?.sign === '-' ? -minutes : minutes) * 60_000;
}

function localMinutesToUtcDate(dateStr: string, minutes: number, timezone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  const guess = new Date(Date.UTC(y, m - 1, d, hour, min, 0));
  const offset = getTimezoneOffsetMs(guess, timezone);
  return new Date(guess.getTime() - offset);
}

function getLocalMinutesOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function decide(
  plan: DayPlan,
  now: Date,
  pagesToday: number,
  timezone = 'UTC',
): CadenceDecision {
  if (plan.isRestDay) {
    return { status: 'rest_day' };
  }
  if (pagesToday >= plan.dailyPageBudget) {
    return { status: 'daily_limit' };
  }

  const localMins = getLocalMinutesOfDay(now, timezone);

  const nextTodayWin = plan.windows.find((w) => w.startMinutes > localMins && !w.skipped);
  let nextWindowStart: Date | undefined;
  if (nextTodayWin) {
    nextWindowStart = localMinutesToUtcDate(plan.dateString, nextTodayWin.startMinutes, timezone);
  } else {
    const [y, m, d] = plan.dateString.split('-').map(Number);
    const tmr = new Date(Date.UTC(y, m - 1, d + 1));
    const tmrStr = tmr.toISOString().slice(0, 10);
    const tmrPlan = planDay(plan.accountId, tmrStr, 'warmup', timezone);
    const tmrWin = tmrPlan.windows.find((w) => !w.skipped);
    if (tmrWin) {
      nextWindowStart = localMinutesToUtcDate(tmrStr, tmrWin.startMinutes, timezone);
    }
  }

  if (localMins < plan.dayStartMinutes || localMins >= plan.dayEndMinutes) {
    return { status: 'outside_window', nextWindowStart };
  }

  const activeWin = plan.windows.find((w) => localMins >= w.startMinutes && localMins < w.endMinutes);
  if (!activeWin) {
    return { status: 'outside_window', nextWindowStart };
  }
  if (activeWin.skipped) {
    return { status: 'window_skipped', nextWindowStart };
  }

  return { status: 'run', activeWindow: activeWin };
}

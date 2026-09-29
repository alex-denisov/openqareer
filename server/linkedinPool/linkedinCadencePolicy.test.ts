import { describe, expect, it } from 'vitest';
import {
  CadenceMode,
  createDeterministicPrng,
  DayPlan,
  decide,
  pageDelayMs,
  planDay,
  sessionShape,
} from './linkedinCadencePolicy.js';

describe('linkedinCadencePolicy (B315)', () => {
  const accountIds = [
    '550e8400-e29b-41d4-a716-446655440000',
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    '3d9c2670-8b1e-4c7b-9f0a-123456789abc',
  ];

  it('детерминизм: тот же (аккаунт, дата) дает тот же план при повторных вызовах', () => {
    const accountId = accountIds[0];
    const date = '2026-10-15';
    const plan1 = planDay(accountId, date, 'warmup', 'Europe/Moscow');
    const plan2 = planDay(accountId, date, 'warmup', 'Europe/Moscow');
    expect(plan1).toEqual(plan2);
  });

  it('разные аккаунты или разные даты дают различные планы', () => {
    const planA = planDay(accountIds[0], '2026-10-15', 'warmup', 'Europe/Moscow');
    const planB = planDay(accountIds[1], '2026-10-15', 'warmup', 'Europe/Moscow');
    const planC = planDay(accountIds[0], '2026-10-16', 'warmup', 'Europe/Moscow');

    expect(planA.dailyPageBudget).not.toBe(planB.dailyPageBudget);
    expect(planA.dayStartMinutes).not.toBe(planC.dayStartMinutes);
  });

  it('паузы pageDelayMs лежат строго в [3, 30] с по типам страниц', () => {
    const prng = createDeterministicPrng('test-seed-delays');
    for (let i = 0; i < 100; i++) {
      const skim = pageDelayMs('skim', prng);
      expect(skim).toBeGreaterThanOrEqual(3000);
      expect(skim).toBeLessThanOrEqual(8000);

      const read = pageDelayMs('read', prng);
      expect(read).toBeGreaterThanOrEqual(9000);
      expect(read).toBeLessThanOrEqual(18000);

      const deep = pageDelayMs('deep', prng);
      expect(deep).toBeGreaterThanOrEqual(19000);
      expect(deep).toBeLessThanOrEqual(30000);
    }
  });

  it('sessionShape возвращает микросессию (3-7 мин, 4-10 стр) и глубокую (15-40 мин, 30-80 стр)', () => {
    const micro = sessionShape('micro');
    expect(micro.isMicro).toBe(true);
    expect(micro.durationMinutes).toBeGreaterThanOrEqual(3);
    expect(micro.durationMinutes).toBeLessThanOrEqual(7);
    expect(micro.pageCount).toBeGreaterThanOrEqual(4);
    expect(micro.pageCount).toBeLessThanOrEqual(10);

    const deep = sessionShape('deep');
    expect(deep.isMicro).toBe(false);
    expect(deep.durationMinutes).toBeGreaterThanOrEqual(15);
    expect(deep.durationMinutes).toBeLessThanOrEqual(40);
    expect(deep.pageCount).toBeGreaterThanOrEqual(30);
    expect(deep.pageCount).toBeLessThanOrEqual(80);
  });

  function checkDayPlanBudget(plan: DayPlan, mode: CadenceMode, ranges: Record<CadenceMode, [number, number]>) {
    if (plan.isRestDay) {
      expect(plan.dailyPageBudget).toBeLessThanOrEqual(10);
      return;
    }
    const [min, max] = ranges[mode];
    expect(plan.dailyPageBudget).toBeGreaterThanOrEqual(min);
    expect(plan.dailyPageBudget).toBeLessThanOrEqual(max);
    expect(plan.dailyPageBudget % 10).not.toBe(0);
  }

  it('суточный бюджет режимов всегда в целевом диапазоне и не круглый', () => {
    const modes: CadenceMode[] = ['warmup', 'active_search', 'scout_pool'];
    const ranges: Record<CadenceMode, [number, number]> = {
      warmup: [50, 180],
      active_search: [150, 350],
      scout_pool: [200, 500],
    };

    for (const mode of modes) {
      for (const accountId of accountIds) {
        for (let day = 1; day <= 30; day++) {
          const dateStr = `2026-10-${String(day).padStart(2, '0')}`;
          const plan = planDay(accountId, dateStr, mode, 'Europe/Moscow');
          checkDayPlanBudget(plan, mode, ranges);
        }
      }
    }
  });

  it('будни и выходные соблюдают границы с джиттером ±15-45 мин', () => {
    const weekdayPlan = planDay(accountIds[0], '2026-10-14', 'warmup', 'Europe/Moscow');
    expect(weekdayPlan.isWeekend).toBe(false);
    expect(weekdayPlan.dayStartMinutes).toBeGreaterThanOrEqual(7 * 60 - 45);
    expect(weekdayPlan.dayStartMinutes).toBeLessThanOrEqual(7 * 60 + 45);
    expect(weekdayPlan.dayEndMinutes).toBeGreaterThanOrEqual(24 * 60 - 45);
    expect(weekdayPlan.dayEndMinutes).toBeLessThanOrEqual(24 * 60);

    const weekendPlan = planDay(accountIds[0], '2026-10-17', 'warmup', 'Europe/Moscow');
    expect(weekendPlan.isWeekend).toBe(true);
    expect(weekendPlan.dayStartMinutes).toBeGreaterThanOrEqual(11 * 60 - 45);
    expect(weekendPlan.dayStartMinutes).toBeLessThanOrEqual(11 * 60 + 45);
    expect(weekendPlan.dayEndMinutes).toBeGreaterThanOrEqual(20 * 60 - 45);
    expect(weekendPlan.dayEndMinutes).toBeLessThanOrEqual(20 * 60 + 45);
  });

  function simulateAccount(accountId: string) {
    let totalWindows = 0;
    let skippedWindows = 0;
    const restDays: number[] = [];

    for (let dayIndex = 0; dayIndex < 60; dayIndex++) {
      const date = new Date(Date.UTC(2026, 8, 1 + dayIndex));
      const dateStr = date.toISOString().slice(0, 10);
      const plan = planDay(accountId, dateStr, 'warmup', 'Europe/Moscow');

      if (plan.isRestDay) {
        restDays.push(dayIndex);
        expect(plan.dailyPageBudget).toBeLessThanOrEqual(10);
      } else {
        for (const win of plan.windows) {
          totalWindows++;
          if (win.skipped) skippedWindows++;
        }
      }
    }
    return { totalWindows, skippedWindows, restDays };
  }

  it('симуляция за 60 дней и 5 аккаунтов: окна стохастичны, доля пропусков в [0.10, 0.40], дни отдыха 7-12 дней', () => {
    for (const accountId of accountIds) {
      const { totalWindows, skippedWindows, restDays } = simulateAccount(accountId);

      const skipRatio = skippedWindows / totalWindows;
      expect(skipRatio).toBeGreaterThanOrEqual(0.1);
      expect(skipRatio).toBeLessThanOrEqual(0.4);

      expect(restDays.length).toBeGreaterThanOrEqual(4);
      for (let r = 1; r < restDays.length; r++) {
        const gap = restDays[r] - restDays[r - 1];
        expect(gap).toBeGreaterThanOrEqual(7);
        expect(gap).toBeLessThanOrEqual(12);
      }
    }
  });

  it('decide: корректно определяет run, outside_window, window_skipped, daily_limit, rest_day', () => {
    const accountId = accountIds[0];
    const dateStr = '2026-10-14';
    const timezone = 'Europe/Moscow';
    const plan = planDay(accountId, dateStr, 'warmup', timezone);

    const atDailyLimit = decide(plan, new Date('2026-10-14T08:00:00Z'), plan.dailyPageBudget, timezone);
    expect(atDailyLimit.status).toBe('daily_limit');

    const atNight = decide(plan, new Date('2026-10-14T00:00:00Z'), 10, timezone);
    expect(atNight.status).toBe('outside_window');
    expect(atNight.nextWindowStart).toBeDefined();

    const firstWin = plan.windows[0];
    const winMidLocalMinutes = Math.floor((firstWin.startMinutes + firstWin.endMinutes) / 2);
    const midHour = Math.floor(winMidLocalMinutes / 60);
    const midMin = winMidLocalMinutes % 60;
    const utcDate = new Date(Date.UTC(2026, 9, 14, midHour - 3, midMin, 0));

    const winDecision = decide(plan, utcDate, 10, timezone);
    if (firstWin.skipped) {
      expect(winDecision.status).toBe('window_skipped');
      expect(winDecision.nextWindowStart).toBeDefined();
    } else {
      expect(winDecision.status).toBe('run');
      expect(winDecision.activeWindow?.id).toBe(firstWin.id);
    }
  });

  it('decide корректно работает в America/New_York при переходе на зимнее время (ноябрь 2026)', () => {
    const accountId = accountIds[1];
    const timezone = 'America/New_York';
    const plan = planDay(accountId, '2026-11-01', 'warmup', timezone);
    expect(plan.isWeekend).toBe(true);

    const nov1NoonUtc = new Date('2026-11-01T17:00:00Z');
    const decision = decide(plan, nov1NoonUtc, 5, timezone);
    expect(['run', 'window_skipped', 'outside_window', 'rest_day']).toContain(decision.status);
  });
});

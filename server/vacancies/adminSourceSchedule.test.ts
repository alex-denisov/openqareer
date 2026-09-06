import { describe, expect, it } from 'vitest';
import { toAdminSourceSchedule } from './adminSourceSchedule';
import type { SourceScheduleInfo } from './politeScheduler';

function info(overrides: Partial<SourceScheduleInfo> = {}): SourceScheduleInfo {
  return {
    sourceId: 'src-a',
    consecutiveFailures: 0,
    consecutiveUnchangedCount: 0,
    adaptedIntervalMinutes: 120,
    crawlDelaySeconds: null,
    robotsVerdict: 'allowed',
    retryAfterRemainingSec: null,
    backoffRemainingSec: null,
    hourlyRequestsCount: 3,
    maxRequestsPerHour: 30,
    isDue: true,
    scheduleReason: 'интервал вышел',
    nextAvailableAtMs: null,
    ...overrides,
  };
}

/**
 * B204 сделал расписание, но администратор его не видел: маршрут отдавал
 * только живость и доверие. Не видно — значит нечем объяснить, почему площадку
 * не опрашивают (названо в B204, сделано 2026-09-07).
 */
describe('расписание площадки в суперадминке (B204)', () => {
  it('называет, когда площадка будет опрошена, словами и числом', () => {
    const due = toAdminSourceSchedule(info());
    expect(due).toMatchObject({ due: true, reason: 'интервал вышел', intervalMin: 120 });
    expect(due.nextInMin).toBe(0);

    const waiting = toAdminSourceSchedule(
      info({ isDue: false, backoffRemainingSec: 900, scheduleReason: 'отступ после отказа' }),
    );
    expect(waiting).toMatchObject({ due: false, nextInMin: 15, reason: 'отступ после отказа' });
  });

  it('округляет ожидание вверх: «через 0 минут» у неготовой площадки — ложь', () => {
    const almost = toAdminSourceSchedule(info({ isDue: false, backoffRemainingSec: 5 }));
    expect(almost.nextInMin).toBe(1);
  });

  it('берёт большее из отступа и паузы Retry-After', () => {
    const both = toAdminSourceSchedule(
      info({ isDue: false, backoffRemainingSec: 300, retryAfterRemainingSec: 1800 }),
    );
    expect(both.nextInMin).toBe(30);
  });

  it('передаёт правило площадки и её часовой расход', () => {
    const value = toAdminSourceSchedule(
      info({ crawlDelaySeconds: 10, robotsVerdict: 'disallowed', hourlyRequestsCount: 29 }),
    );
    expect(value).toMatchObject({
      crawlDelaySec: 10,
      robots: 'disallowed',
      hourly: 29,
      hourlyMax: 30,
    });
  });

  it('называет подряд идущие отказы, потому что ими объясняется отступ', () => {
    expect(toAdminSourceSchedule(info({ consecutiveFailures: 4 })).failures).toBe(4);
  });

  it('остаётся компактным: расписание не должно снова порвать бюджет ответа', () => {
    const bytes = Buffer.byteLength(JSON.stringify(toAdminSourceSchedule(info())), 'utf8');
    expect(bytes).toBeLessThan(200);
  });
});

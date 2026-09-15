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
    scheduleReason: 'interval_elapsed',
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
  /**
   * Найдено на живом проде 2026-09-07: Хабр ждал интервала 4699 с, а сводка
   * печатала «через 1 мин». Ожидание по интервалу не лежит ни в отступе, ни в
   * паузе `Retry-After` — оно только в `nextAvailableAtMs`.
   */
  it('берёт ожидание из времени следующей готовности, а не только из отступа', () => {
    const now = 1_757_000_000_000;
    const waiting = toAdminSourceSchedule(
      info({
        isDue: false,
        nextAvailableAtMs: now + 4_699_000,
        scheduleReason: 'interval_not_elapsed (4699s remaining, adapted: 90m)',
      }),
      now,
    );
    expect(waiting.nextInMin).toBe(79);
  });

  it('переводит причину планировщика на человеческий язык', () => {
    expect(toAdminSourceSchedule(info({ scheduleReason: 'robots_disallowed' })).reason).toBe(
      'площадка запретила обход в robots.txt',
    );
    expect(
      toAdminSourceSchedule(
        info({ scheduleReason: 'interval_not_elapsed (4699s remaining, adapted: 90m)' }),
      ).reason,
    ).toBe('интервал ещё не вышел');
    expect(toAdminSourceSchedule(info({ scheduleReason: 'ok' })).reason).toBe('готова к опросу');
    expect(toAdminSourceSchedule(info({ scheduleReason: 'fresh_source' })).reason).toBe(
      'площадку ещё ни разу не опрашивали',
    );
    expect(
      toAdminSourceSchedule(info({ scheduleReason: 'hourly_budget_exhausted (30/30 req/h)' }))
        .reason,
    ).toBe('часовой бюджет запросов исчерпан');
    expect(
      toAdminSourceSchedule(
        info({ scheduleReason: 'exponential_backoff_active (900s remaining, failures: 3)' }),
      ).reason,
    ).toBe('отступ после отказов площадки');
    expect(
      toAdminSourceSchedule(info({ scheduleReason: 'retry_after_active (600s remaining)' })).reason,
    ).toBe('площадка попросила подождать (Retry-After)');
    expect(
      toAdminSourceSchedule(info({ scheduleReason: 'crawl_delay_active (10s remaining)' })).reason,
    ).toBe('пауза между запросами по robots.txt');
  });

  /**
   * Незнакомый код планировщика не печатается сырым: «json_api» вместо имени
   * площадки уже был отдельным дефектом (PRB-017).
   */
  it('не печатает незнакомый машинный код читателю', () => {
    expect(toAdminSourceSchedule(info({ scheduleReason: 'some_new_code (17s)' })).reason).toBe(
      'решение планировщика',
    );
  });

  it('называет, когда площадка будет опрошена, словами и числом', () => {
    const due = toAdminSourceSchedule(info({ scheduleReason: 'interval_elapsed' }));
    expect(due).toMatchObject({ due: true, reason: 'интервал вышел', intervalMin: 120 });
    expect(due.nextInMin).toBe(0);

    const waiting = toAdminSourceSchedule(
      info({
        isDue: false,
        backoffRemainingSec: 900,
        scheduleReason: 'exponential_backoff_active (900s remaining, failures: 3)',
      }),
    );
    expect(waiting).toMatchObject({
      due: false,
      nextInMin: 15,
      reason: 'отступ после отказов площадки',
    });
  });

  /**
   * Найдено на живом проде 2026-09-07, второй заход: ТрудВсем запрещён в
   * `robots.txt` и не станет готовым никогда, а сводка обещала «через 1 мин».
   * Времени следующей готовности у такой площадки просто нет — и говорить надо
   * это, а не выдумывать минуту.
   */
  it('не называет срок, когда его нет', () => {
    const forbidden = toAdminSourceSchedule(
      info({ isDue: false, nextAvailableAtMs: null, scheduleReason: 'robots_disallowed' }),
    );
    expect(forbidden.nextInMin).toBeNull();
    expect(forbidden.reason).toBe('площадка запретила обход в robots.txt');
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

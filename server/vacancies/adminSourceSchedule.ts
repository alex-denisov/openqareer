/**
 * Расписание площадки для суперадминки (B204, показ — 2026-09-07).
 *
 * B204 сделал вежливое расписание, но администратор его не видел: маршрут
 * `GET /api/v1/admin/vacancy-sources` отдавал только живость и доверие.
 * Невидимое расписание нечем объяснить — «почему эту площадку не опрашивают»
 * оставалось вопросом без ответа.
 *
 * Сводка намеренно короткая. Тот же маршрут уже рвался на 20 220 байтах
 * (INC-032), и полный `SourceScheduleInfo` на каждую из 195 площадок вернул бы
 * ту же беду; здесь только то, по чему администратор принимает решение.
 */
import type { RobotsVerdictStatus } from './robotsParser';
import type { SourceScheduleInfo } from './politeScheduler';

export interface AdminSourceSchedule {
  /** Готова ли площадка к опросу прямо сейчас. */
  readonly due: boolean;
  /** Через сколько минут её можно опросить. `0` — можно сейчас. */
  readonly nextInMin: number;
  /** Действующий интервал опроса с учётом адаптации. */
  readonly intervalMin: number;
  /** Правило самой площадки из `robots.txt`, если она его назвала. */
  readonly crawlDelaySec: number | null;
  readonly robots: RobotsVerdictStatus;
  /** Расход часового бюджета запросов. */
  readonly hourly: number;
  readonly hourlyMax: number;
  /** Подряд идущие отказы — ими объясняется отступ. */
  readonly failures: number;
  /** Почему решение именно такое, словами. */
  readonly reason: string;
}

export function toAdminSourceSchedule(info: SourceScheduleInfo): AdminSourceSchedule {
  const waitSec = Math.max(info.backoffRemainingSec ?? 0, info.retryAfterRemainingSec ?? 0);
  // Округление вверх: «через 0 минут» у площадки, которая ещё не готова, —
  // ложь, по которой администратор пойдёт искать несуществующую поломку.
  const nextInMin = info.isDue ? 0 : Math.max(1, Math.ceil(waitSec / 60));

  return {
    due: info.isDue,
    nextInMin,
    intervalMin: info.adaptedIntervalMinutes,
    crawlDelaySec: info.crawlDelaySeconds,
    robots: info.robotsVerdict,
    hourly: info.hourlyRequestsCount,
    hourlyMax: info.maxRequestsPerHour,
    failures: info.consecutiveFailures,
    reason: info.scheduleReason,
  };
}

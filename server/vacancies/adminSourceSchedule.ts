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
  /**
   * Через сколько минут её можно опросить. `0` — можно сейчас, `null` — срока
   * нет: площадка запрещена в `robots.txt` и готовой не станет. Выдуманная
   * минута отправила бы администратора ждать того, чего не будет.
   */
  readonly nextInMin: number | null;
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

/**
 * Причина решения планировщика человеческими словами.
 *
 * Планировщик пишет коды для журнала, и печатать их администратору нельзя:
 * «json_api» вместо имени площадки уже был отдельным дефектом (PRB-017).
 * Незнакомый код не показывается сырым — читателю он ничего не объясняет.
 */
const SCHEDULE_REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^ok$/u, 'готова к опросу'],
  [/^interval_elapsed$/u, 'интервал вышел'],
  [/^interval_not_elapsed/u, 'интервал ещё не вышел'],
  [/^fresh_source$/u, 'площадку ещё ни разу не опрашивали'],
  [/^backoff_elapsed_ready_to_retry$/u, 'отступ кончился, можно пробовать снова'],
  [/^robots_disallowed$/u, 'площадка запретила обход в robots.txt'],
  [/^retry_after_active/u, 'площадка попросила подождать (Retry-After)'],
  [/^exponential_backoff_active/u, 'отступ после отказов площадки'],
  [/^hourly_budget_exhausted/u, 'часовой бюджет запросов исчерпан'],
  [/^crawl_delay_active/u, 'пауза между запросами по robots.txt'],
];

function humanReason(raw: string): string {
  for (const [pattern, text] of SCHEDULE_REASONS) {
    if (pattern.test(raw)) return text;
  }
  return 'решение планировщика';
}

export function toAdminSourceSchedule(
  info: SourceScheduleInfo,
  nowMs: number = Date.now(),
): AdminSourceSchedule {
  // Ожидание по интервалу не лежит ни в отступе, ни в паузе `Retry-After` —
  // только в `nextAvailableAtMs`. Без него сводка печатала «через 1 мин»
  // площадке, которой ждать 78 минут (найдено на живом проде 2026-09-07).
  const untilNextSec = info.nextAvailableAtMs ? (info.nextAvailableAtMs - nowMs) / 1000 : 0;
  const waitSec = Math.max(
    info.backoffRemainingSec ?? 0,
    info.retryAfterRemainingSec ?? 0,
    untilNextSec,
  );
  // Округление вверх: «через 0 минут» у площадки, которая ещё не готова, —
  // ложь, по которой администратор пойдёт искать несуществующую поломку.
  // Ноль ожидания у неготовой площадки означает, что срока нет вовсе
  // (запрет в `robots.txt`), и тогда честный ответ — `null`.
  const nextInMin = info.isDue ? 0 : waitSec > 0 ? Math.max(1, Math.ceil(waitSec / 60)) : null;

  return {
    due: info.isDue,
    nextInMin,
    intervalMin: info.adaptedIntervalMinutes,
    crawlDelaySec: info.crawlDelaySeconds,
    robots: info.robotsVerdict,
    hourly: info.hourlyRequestsCount,
    hourlyMax: info.maxRequestsPerHour,
    failures: info.consecutiveFailures,
    reason: humanReason(info.scheduleReason),
  };
}

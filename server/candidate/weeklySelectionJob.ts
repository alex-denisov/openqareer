import type { NotificationEventInput } from '../data/notificationPolicy';

/**
 * B779: «Подборку в своей роли — раз в неделю». Раз в неделю кандидатам, которые включили её на
 * s02, уходит одно уведомление о новых вакансиях в их ролях — в колокольчик и в «Сегодня»;
 * письмо — только если кандидат включил почту для «Новые вакансии по вашей роли».
 * Неделя начинается в понедельник в 09:00 по Москве; повтор в ту же неделю — та же запись.
 */

const WEEK_MS = 7 * 24 * 60 * 60_000;
/** Понедельник 09:00 по Москве (UTC+3) — это 06:00 UTC. */
const WEEK_START_OFFSET_MS = 6 * 60 * 60_000;

/** ISO-неделя, сдвинутая к понедельнику 09:00 по Москве: «2026-W48». */
export function selectionWeek(now: Date): string {
  const shifted = new Date(now.getTime() - WEEK_START_OFFSET_MS);
  const day = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  const weekday = day.getUTCDay() || 7;
  // Четверг той же недели определяет её год (ISO 8601).
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface WeeklySelectionJobDeps {
  /** Кандидаты, которым подборка включена. */
  readonly candidates: () => readonly string[];
  /** Новые с `since` вакансии в ролях кандидата (id кластеров). */
  readonly freshVacancies: (candidateId: string, since: Date) => Promise<readonly string[]>;
  readonly record: (candidateId: string, input: NotificationEventInput) => void;
  readonly logError: (candidateId: string, error: unknown) => void;
}

export interface WeeklySelectionRun {
  readonly sent: number;
  readonly empty: number;
  readonly failed: number;
}

/** Один проход: подборка тем, у кого за неделю есть новое; пустую не шлём. */
export async function runWeeklySelection(
  deps: WeeklySelectionJobDeps,
  now: Date,
): Promise<WeeklySelectionRun> {
  const week = selectionWeek(now);
  const since = new Date(now.getTime() - WEEK_MS);
  let sent = 0;
  let empty = 0;
  let failed = 0;
  for (const candidateId of deps.candidates()) {
    try {
      const fresh = await deps.freshVacancies(candidateId, since);
      if (fresh.length === 0) {
        empty += 1;
        continue;
      }
      deps.record(candidateId, {
        kind: 'new_vacancies_by_role',
        sourceType: 'weekly_selection',
        sourceId: week,
        idempotencyKey: `weekly-selection:${week}`,
        createdAt: now.toISOString(),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      deps.logError(candidateId, error);
    }
  }
  return { sent, empty, failed };
}

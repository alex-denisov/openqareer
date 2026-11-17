/** B683: записи дневника и итог недели для кабинета B640. */
export const DIARY_ENTRY_KINDS = ['result', 'problem', 'meeting', 'note'] as const;
export type CareerDiaryEntryKind = (typeof DIARY_ENTRY_KINDS)[number];

export const DIARY_ENTRY_TEXT_MAX = 2000;
export const DIARY_WEEK_TEXT_MAX = 4000;
export const DIARY_WEEK_ITEMS_MAX = 20;
export const DIARY_ENTRIES_PAGE = 20;

export interface CareerDiaryEntry {
  readonly id: string;
  /** День события, `ГГГГ-ММ-ДД`. */
  readonly date: string;
  /** Понедельник недели записи: по нему лента собирается в недели. */
  readonly weekStart: string;
  readonly kind: CareerDiaryEntryKind;
  readonly text: string;
  /** Цель дневника, к которой относится запись. */
  readonly goalId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CareerDiaryEntryInput {
  readonly date: string;
  readonly kind: CareerDiaryEntryKind;
  readonly text: string;
  readonly goalId?: string | null;
}

export type CareerDiaryEntryPatch = Partial<CareerDiaryEntryInput>;

export interface CareerDiaryPlanItem {
  readonly text: string;
  readonly goalId: string | null;
  /** Обещание выполнено: невыполненное переносится в план следующей недели. */
  readonly done: boolean;
}

/** Откуда пункт в предложенном плане: обещание прошлой недели или цель. */
export type CareerDiaryPlanSource = 'carried' | 'goal_at_risk' | 'goal_unmeasured' | 'goal';

export interface CareerDiaryPlanSuggestion {
  readonly text: string;
  readonly goalId: string | null;
  readonly source: CareerDiaryPlanSource;
}

export interface CareerDiaryWeekSummaryInput {
  /** Записи недели, которые кандидат оставил в «Что получилось». */
  readonly achievedEntryIds: readonly string[];
  /** Что кандидат дописал в «Что получилось» сам. */
  readonly achievedNotes: readonly string[];
  readonly blockers: string;
  readonly plan: readonly CareerDiaryPlanItem[];
}

export interface CareerDiaryWeekSummary extends CareerDiaryWeekSummaryInput {
  readonly weekStart: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Черновик итога недели: записи недели, сохранённый итог и предложенный план. */
export interface CareerDiaryWeekDraft {
  readonly weekStart: string;
  readonly entries: readonly CareerDiaryEntry[];
  /** Записи для «Что получилось» по умолчанию: результаты и встречи недели. */
  readonly achievedEntryIds: readonly string[];
  /** «Что мешает» по умолчанию: проблемы недели, по строке на запись. */
  readonly blockers: string;
  readonly plan: readonly CareerDiaryPlanSuggestion[];
  /** Сохранённый итог этой недели; `null` — итог ещё не подводили. */
  readonly saved: CareerDiaryWeekSummary | null;
}

export interface CareerDiaryEntryFeed {
  readonly items: readonly CareerDiaryEntry[];
  readonly nextCursor: string | null;
  /** Сохранённые итоги недель, записи которых попали в порцию. */
  readonly summaries: readonly CareerDiaryWeekSummary[];
}

const DAY_MS = 86_400_000;

function utcDay(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === date ? time : null;
}

/** Настоящая календарная дата `ГГГГ-ММ-ДД` (31 февраля — нет). */
export function isDiaryDate(date: string): boolean {
  return utcDay(date) !== null;
}

/** Понедельник недели, в которую попадает день; `null` — дата не разобрана. */
export function diaryWeekStart(date: string): string | null {
  const time = utcDay(date);
  if (time === null) return null;
  const weekday = new Date(time).getUTCDay() || 7;
  return new Date(time - (weekday - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Сдвиг даты на целое число дней. */
export function shiftDiaryDate(date: string, days: number): string | null {
  const time = utcDay(date);
  return time === null ? null : new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

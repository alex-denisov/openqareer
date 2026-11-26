import {
  diaryWeekStart,
  shiftDiaryDate,
  type CareerDiaryEntry,
  type CareerDiaryEntryKind,
  type CareerDiaryWeekSummary,
} from '../../../../shared/careerDiaryEntries';

/** Модель экранов «Записи» и «Итог недели» (d00, d00d). */

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
const MONTHS_LONG = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export interface KindView {
  readonly kind: CareerDiaryEntryKind;
  /** Фильтр над лентой: «Результат». */
  readonly chip: string;
  /** Метка у записи: «результат». */
  readonly tag: string;
  /** Класс метки из макета: `tag ok`. */
  readonly tagClass: string;
}

export const KINDS: readonly KindView[] = [
  { kind: 'result', chip: 'Результат', tag: 'результат', tagClass: 'tag ok' },
  { kind: 'problem', chip: 'Проблема', tag: 'проблема', tagClass: 'tag part' },
  { kind: 'meeting', chip: 'Встреча', tag: 'встреча', tagClass: 'tag ' },
  { kind: 'note', chip: 'Заметка', tag: 'заметка', tagClass: 'tag miss' },
];

export function kindView(kind: CareerDiaryEntryKind): KindView {
  return KINDS.find((view) => view.kind === kind) ?? KINDS[3];
}

function parts(date: string): { day: number; month: number; year: number; weekday: number } {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  const value = new Date(time);
  return {
    day: value.getUTCDate(),
    month: value.getUTCMonth(),
    year: value.getUTCFullYear(),
    weekday: value.getUTCDay(),
  };
}

/** «3 янв». */
export function shortDate(date: string): string {
  const { day, month } = parts(date);
  return `${day} ${MONTHS_SHORT[month]}`;
}

/** «30 декабря». */
export function longDate(date: string): string {
  const { day, month } = parts(date);
  return `${day} ${MONTHS_LONG[month]}`;
}

/** «Чт, 14 янв». */
export function weekdayDate(date: string): string {
  return `${WEEKDAYS[parts(date).weekday]}, ${shortDate(date)}`;
}

/** Последний день недели (воскресенье) по понедельнику. */
export function weekEnd(weekStart: string): string {
  return shiftDiaryDate(weekStart, 6) ?? weekStart;
}

/** «21–27 дек» или «28 дек — 3 янв». */
export function weekRange(weekStart: string): string {
  const start = parts(weekStart);
  const end = parts(weekEnd(weekStart));
  if (start.month === end.month) return `${start.day}–${end.day} ${MONTHS_SHORT[end.month]}`;
  return `${shortDate(weekStart)} — ${shortDate(weekEnd(weekStart))}`;
}

/** «28 декабря — 3 января» для подзаголовка итога. */
export function weekRangeLong(weekStart: string): string {
  const start = parts(weekStart);
  const end = parts(weekEnd(weekStart));
  if (start.month === end.month) return `${start.day}–${end.day} ${MONTHS_LONG[end.month]}`;
  return `${start.day} ${MONTHS_LONG[start.month]} — ${end.day} ${MONTHS_LONG[end.month]}`;
}

/** Сегодня по часам кандидата, `ГГГГ-ММ-ДД`. */
export function today(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Номер недели дневника: первая — неделя, с которой кандидат начал вести дневник
 * (`origin`), считая от понедельника. Неделя до начала — `null`.
 */
export function weekNumber(weekStart: string, origin: string | null): number | null {
  const first = origin ? diaryWeekStart(origin) : null;
  if (!first) return null;
  const diff = Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`);
  const number = Math.round(diff / (7 * 86_400_000)) + 1;
  return number >= 1 ? number : null;
}

export interface WeekGroup {
  readonly weekStart: string;
  readonly entries: readonly CareerDiaryEntry[];
  readonly summary: CareerDiaryWeekSummary | null;
}

/** Лента по неделям, новые сверху; порядок записей внутри недели сохраняется. */
export function groupByWeek(
  entries: readonly CareerDiaryEntry[],
  summaries: readonly CareerDiaryWeekSummary[],
  currentWeek: string,
): readonly WeekGroup[] {
  const starts = new Set(entries.map((entry) => entry.weekStart));
  starts.add(currentWeek);
  return [...starts]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((weekStart) => ({
      weekStart,
      entries: entries.filter((entry) => entry.weekStart === weekStart),
      summary: summaries.find((summary) => summary.weekStart === weekStart) ?? null,
    }))
    .filter((group) => group.entries.length > 0 || group.weekStart === currentWeek);
}

/** Первая строка свёрнутого итога недели. */
export function summaryHeadline(
  summary: CareerDiaryWeekSummary,
  entries: readonly CareerDiaryEntry[],
): string {
  const first =
    entries.find((entry) => summary.achievedEntryIds.includes(entry.id))?.text ??
    summary.achievedNotes[0] ??
    '';
  return first ? `Итог недели: ${first}` : 'Итог недели подведён';
}

/** Текст раскрытого итога: что получилось и что мешает. */
export function summaryBody(
  summary: CareerDiaryWeekSummary,
  entries: readonly CareerDiaryEntry[],
): string {
  const achieved = [
    ...entries
      .filter((entry) => summary.achievedEntryIds.includes(entry.id))
      .map((entry) => entry.text),
    ...summary.achievedNotes,
  ];
  const lines: string[] = [];
  if (achieved.length > 1) lines.push(`Получилось: ${achieved.slice(1).join(' ')}`);
  if (summary.blockers.trim()) lines.push(`Мешает: ${summary.blockers.trim()}`);
  return lines.join(' ');
}

/** Ближайший срок активной цели не раньше сегодняшнего дня. */
export function nearestDue<T extends { readonly title: string; readonly dueDate: string }>(
  goals: readonly T[],
  day: string,
): T | null {
  return (
    [...goals]
      .filter((goal) => goal.dueDate >= day)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0] ?? null
  );
}

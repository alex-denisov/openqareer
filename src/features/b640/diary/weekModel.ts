import type { CareerDiaryGoalSummary, CareerDiaryValue } from '../../../../shared/careerDiary';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import {
  diaryWeekStart,
  type CareerDiaryPlanItem,
  type CareerDiaryWeekDraft,
  type CareerDiaryWeekSummaryInput,
} from '../../../../shared/careerDiaryEntries';
import { labelWithUnit } from './goalsModel';
import { weekEnd } from './model';

/** Модель экрана «Итог недели» (d00d): форма из черновика сервера и обратно. */

export interface MeterField {
  readonly goalId: string;
  readonly label: string;
  /** «было 7»: последний замер до недели или исходное значение. */
  readonly placeholder: string;
  /** Замер этой недели, если уже есть. */
  readonly value: string;
}

export interface PlanRow extends CareerDiaryPlanItem {
  readonly key: string;
  readonly goalTitle: string | null;
  readonly kept: boolean;
}

export interface WeekForm {
  readonly achievedIds: readonly string[];
  /** Записи, убранные из итога крестиком. */
  readonly hiddenIds: readonly string[];
  readonly notes: readonly string[];
  readonly blockers: string;
  readonly plan: readonly PlanRow[];
  readonly meters: Readonly<Record<string, string>>;
}

/** Неделя из адреса `?week=`: понедельник настоящей даты, иначе текущая неделя. */
export function weekFromSearch(search: string, fallback: string): string {
  const value = new URLSearchParams(search).get('week') ?? '';
  const start = diaryWeekStart(value);
  return start && start === value ? value : fallback;
}

function numeric(value: CareerDiaryValue | null | undefined): string {
  return typeof value === 'number' ? String(value) : '';
}

function meterOf(
  goal: CareerDiaryGoalSummary,
  label: string,
  weekStart: string,
): MeterField | null {
  if (typeof goal.targetValue !== 'number') return null;
  const latest = goal.latestMeasurement;
  const day = latest?.measuredAt.slice(0, 10) ?? null;
  const inWeek = day !== null && day >= weekStart && day <= weekEnd(weekStart);
  const before = inWeek ? null : latest;
  const was = numeric(before?.value) || numeric(goal.baselineValue);
  return {
    goalId: goal.id,
    label: labelWithUnit(label, goal.unit),
    placeholder: was ? `было ${was}` : '',
    value: inWeek ? numeric(latest?.value) : '',
  };
}

/** Числовые показатели активных целей: у цели с показателями — каждый показатель. */
export function meterFields(
  cards: readonly CareerDiaryGoalCard[],
  weekStart: string,
): readonly MeterField[] {
  return cards.flatMap((card) =>
    (card.indicators.length > 0 ? card.indicators : [card])
      .map((goal) => meterOf(goal, goal.title, weekStart))
      .filter((field): field is MeterField => field !== null),
  );
}

function titleOf(cards: readonly CareerDiaryGoalCard[], goalId: string | null): string | null {
  if (!goalId) return null;
  for (const card of cards) {
    if (card.id === goalId) return card.title;
    const indicator = card.indicators.find((item) => item.id === goalId);
    if (indicator) return card.indicators.length > 1 ? indicator.title : card.title;
  }
  return null;
}

/** Начальное состояние формы: сохранённый итог или предложение сервера. */
export function initialForm(
  draft: CareerDiaryWeekDraft,
  cards: readonly CareerDiaryGoalCard[],
): WeekForm {
  const saved = draft.saved;
  // B683: сохранённый пустой план — плана нет; тогда показывается предложение сервера.
  const plan: readonly PlanRow[] = saved?.plan.length
    ? saved.plan.map((item, index) => ({
        ...item,
        key: `s${index}`,
        goalTitle: titleOf(cards, item.goalId),
        kept: true,
      }))
    : draft.plan.map((item, index) => ({
        text: item.text,
        goalId: item.goalId,
        done: false,
        key: `p${index}`,
        goalTitle: titleOf(cards, item.goalId),
        kept: true,
      }));
  const meters = Object.fromEntries(
    meterFields(cards, draft.weekStart).map((field) => [field.goalId, field.value]),
  );
  return {
    achievedIds: saved ? saved.achievedEntryIds : draft.achievedEntryIds,
    hiddenIds: [],
    notes: saved ? saved.achievedNotes : [],
    blockers: saved ? saved.blockers : draft.blockers,
    plan,
    meters,
  };
}

/** Что уходит на сервер: отмеченные записи, свои строки, «что мешает» и оставленный план. */
export function summaryInput(form: WeekForm): CareerDiaryWeekSummaryInput {
  return {
    achievedEntryIds: form.achievedIds.filter((id) => !form.hiddenIds.includes(id)),
    achievedNotes: form.notes.map((note) => note.trim()).filter(Boolean),
    blockers: form.blockers.trim(),
    plan: form.plan
      .filter((row) => row.kept)
      .map(({ text, goalId, done }) => ({ text, goalId, done })),
  };
}

/** Замеры, которые кандидат ввёл или поменял: число с запятой или точкой. */
export function changedMeters(
  form: WeekForm,
  initial: WeekForm,
): readonly { readonly goalId: string; readonly value: number }[] {
  return Object.entries(form.meters)
    .filter(([goalId, value]) => value.trim() !== '' && value !== initial.meters[goalId])
    .map(([goalId, value]) => ({ goalId, value: Number(value.trim().replace(',', '.')) }))
    .filter((meter) => Number.isFinite(meter.value));
}

/** ⓘ «Откуда план»: перенос невыполненного обещания и цели. */
export function planSourceText(draft: CareerDiaryWeekDraft): string {
  const carried = draft.plan.some((item) => item.source === 'carried');
  const parts = ['Предложено по вашим целям: сначала отстающие и те, где давно не было замера.'];
  if (carried) parts.push('Невыполненное обещание прошлой недели перенесено в план.');
  return parts.join(' ');
}

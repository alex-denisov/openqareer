import type { CareerDiaryGoalSummary } from '../../shared/careerDiary';
import {
  shiftDiaryDate,
  type CareerDiaryEntry,
  type CareerDiaryPlanSource,
  type CareerDiaryPlanSuggestion,
  type CareerDiaryWeekSummary,
} from '../../shared/careerDiaryEntries';

/** B683: черновик итога недели считается правилами, без модели. */
const PLAN_LIMIT = 7;

const GOAL_STEP: Readonly<Record<Exclude<CareerDiaryPlanSource, 'carried'>, string>> = {
  goal_at_risk: 'Разобрать, что мешает',
  goal_unmeasured: 'Внести замер',
  goal: 'Сделать следующий шаг',
};
const SOURCE_ORDER: readonly CareerDiaryPlanSource[] = [
  'carried',
  'goal_at_risk',
  'goal_unmeasured',
  'goal',
];

/** «Что получилось» по умолчанию: результаты и встречи недели. */
export function defaultAchieved(entries: readonly CareerDiaryEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === 'result' || entry.kind === 'meeting')
    .map((entry) => entry.id);
}

/** «Что мешает» по умолчанию: проблемы недели, по строке на запись. */
export function defaultBlockers(entries: readonly CareerDiaryEntry[]): string {
  return entries
    .filter((entry) => entry.kind === 'problem')
    .map((entry) => entry.text)
    .join('\n');
}

export interface WeekPlanInput {
  readonly goals: readonly CareerDiaryGoalSummary[];
  /** Сохранённый итог предыдущей недели. */
  readonly previous: CareerDiaryWeekSummary | null;
  readonly weekStart: string;
}

function goalSource(
  goal: CareerDiaryGoalSummary,
  weekStart: string,
): Exclude<CareerDiaryPlanSource, 'carried'> {
  if (goal.risk.status === 'at_risk') return 'goal_at_risk';
  const measuredAt = goal.latestMeasurement?.measuredAt ?? '';
  return measuredAt < weekStart ? 'goal_unmeasured' : 'goal';
}

/**
 * План на неделю: сначала невыполненные обещания прошлой недели, затем цели, идущие
 * в эту неделю, — отстающие, без замера за неделю, остальные. Достигнутые цели и цели,
 * у которых уже есть перенесённое обещание, не предлагаются.
 */
export function suggestWeekPlan(input: WeekPlanInput): CareerDiaryPlanSuggestion[] {
  const weekEnd = shiftDiaryDate(input.weekStart, 6) ?? input.weekStart;
  const carried: CareerDiaryPlanSuggestion[] = (input.previous?.plan ?? [])
    .filter((item) => !item.done)
    .map((item) => ({ text: item.text, goalId: item.goalId, source: 'carried' }));
  const taken = new Set(carried.map((item) => item.goalId));
  const byGoals: CareerDiaryPlanSuggestion[] = input.goals
    .filter((goal) => goal.risk.status !== 'achieved' && !taken.has(goal.id))
    .filter((goal) => goal.startDate <= weekEnd && goal.dueDate >= input.weekStart)
    .map((goal) => {
      const source = goalSource(goal, input.weekStart);
      return { text: GOAL_STEP[source], goalId: goal.id, source };
    });
  return [...carried, ...byGoals]
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        SOURCE_ORDER.indexOf(a.item.source) - SOURCE_ORDER.indexOf(b.item.source) ||
        a.index - b.index,
    )
    .slice(0, PLAN_LIMIT)
    .map(({ item }) => item);
}

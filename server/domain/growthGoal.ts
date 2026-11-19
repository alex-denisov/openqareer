/**
 * B670: цель роста у нынешнего места работы («Работаю») и шаги к ней. Шаги и
 * доводы берутся из того, что кандидат уже ведёт: плана 30-60-90 и дневника;
 * у каждого шага назван источник.
 */

export const GROWTH_GOALS = ['promotion', 'raise', 'other_role', 'stay'] as const;
export type GrowthGoalKind = (typeof GROWTH_GOALS)[number];

export interface GrowthPlan {
  readonly status: 'active' | 'closed';
  readonly closedAt: string | null;
  readonly tasks: readonly { readonly completed: boolean }[];
}

export interface GrowthDiaryGoal {
  readonly id: string;
  readonly title: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly parentGoalId: string | null;
}

export interface GrowthEntry {
  readonly id: string;
  readonly date: string;
  readonly weekStart: string;
  readonly kind: 'result' | 'problem' | 'meeting' | 'note';
  readonly text: string;
}

export interface GrowthStep {
  readonly title: string;
  readonly sub: string;
  /** done — есть, now — в работе, next — дальше. */
  readonly state: 'done' | 'now' | 'next';
  readonly source: string;
}

export interface GrowthArgument {
  readonly id: string;
  readonly text: string;
  readonly date: string;
  readonly weekStart: string;
  readonly source: string;
}

const MAX_GOAL_STEPS = 4;
const MAX_ARGUMENTS = 5;
const PLAN_SOURCE = 'из плана 30-60-90';

/** «1 марта» из `ГГГГ-ММ-ДД` или ISO-времени. */
export function dayMonth(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function tasksWord(total: number): string {
  const mod10 = total % 10;
  const mod100 = total % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задачи';
  return 'задач';
}

function planStep(plan: GrowthPlan): GrowthStep {
  if (plan.status === 'closed' && plan.closedAt)
    return {
      title: 'План 90 дней закрыт',
      sub: dayMonth(plan.closedAt),
      state: 'done',
      source: PLAN_SOURCE,
    };
  const done = plan.tasks.filter((task) => task.completed).length;
  const total = plan.tasks.length;
  return {
    title: 'План 90 дней',
    sub: `выполнено ${done} из ${total} ${tasksWord(total)}`,
    state: 'now',
    source: PLAN_SOURCE,
  };
}

function goalStep(goal: GrowthDiaryGoal, today: string): GrowthStep {
  const overdue = goal.dueDate < today;
  return {
    title: goal.title,
    sub: overdue ? `срок прошёл ${dayMonth(goal.dueDate)}` : `до ${dayMonth(goal.dueDate)}`,
    state: overdue ? 'next' : 'now',
    source: `цель в дневнике от ${dayMonth(goal.startDate)}`,
  };
}

/** Шаги к цели: план 30-60-90, затем верхние цели дневника — сначала идущие, потом просроченные. */
export function growthSteps(
  plan: GrowthPlan | null,
  goals: readonly GrowthDiaryGoal[],
  today: string,
): readonly GrowthStep[] {
  const top = goals
    .filter((goal) => goal.parentGoalId === null)
    .map((goal) => goalStep(goal, today))
    .sort((a, b) => Number(a.state === 'next') - Number(b.state === 'next'))
    .slice(0, MAX_GOAL_STEPS);
  return [...(plan ? [planStep(plan)] : []), ...top];
}

/** Доводы к разговору: последние записи-результаты дневника со ссылкой на запись. */
export function growthArguments(entries: readonly GrowthEntry[]): readonly GrowthArgument[] {
  return entries
    .filter((entry) => entry.kind === 'result')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ARGUMENTS)
    .map((entry) => ({
      id: entry.id,
      text: entry.text,
      date: entry.date,
      weekStart: entry.weekStart,
      source: `Дневник, ${dayMonth(entry.date)}`,
    }));
}

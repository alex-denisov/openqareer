import {
  ADAPTATION_STAGES,
  ADAPTATION_STEPS,
  type CareerDiaryAdaptationDetails,
  type CareerDiaryAdaptationGroup,
  type CareerDiaryAdaptationStageId,
  type CareerDiaryAdaptationStepId,
  type CareerDiaryAdaptationTask,
  type CareerDiaryAdaptationView,
  type CareerDiaryProgress,
} from '../../shared/careerDiaryCards';
import type { CareerDiaryAdaptationPlanInput } from './careerDiaryAdaptation';

/** Задача прежнего плана адаптации (`workplace.planning.adaptationPlan.tasks`). */
export type PlanTask = CareerDiaryAdaptationPlanInput['tasks'][number];

const DAY_MS = 86_400_000;
/** С какого дня на новом месте идёт этап 30-60-90. */
const STAGE_FIRST_DAY: Readonly<Record<CareerDiaryAdaptationStageId, number>> = {
  prep: Number.NEGATIVE_INFINITY,
  days_1_30: 1,
  days_31_60: 31,
  days_61_90: 61,
};

/** Шаг задачи прежнего плана, у которой шаг не назван: по этапу и виду задачи. */
function defaultStep(task: PlanTask): CareerDiaryAdaptationStepId | null {
  if (task.stage === 'prep') return 'before_start';
  if (task.stage !== 'days_1_30') return null;
  if (task.category === 'people') return 'first_two_weeks';
  return task.category === 'alignment' ? 'first_meeting' : null;
}

function dayNumber(startDate: string, asOf: string): number {
  const days = Math.round((Date.parse(asOf) - Date.parse(startDate)) / DAY_MS);
  return days >= 0 ? days + 1 : days;
}

function progress(total: number, done: number, started: boolean): CareerDiaryProgress {
  if (total === 0) return 'ahead';
  if (done === total) return 'done';
  return started ? 'active' : 'ahead';
}

function counted(tasks: readonly CareerDiaryAdaptationTask[], started: boolean) {
  const tasksDone = tasks.filter((task) => task.completed).length;
  return { tasksTotal: tasks.length, tasksDone, status: progress(tasks.length, tasksDone, started) };
}

/** Группы шага в порядке появления задач; задачи без группы идут одной группой без имени. */
function groupsOf(tasks: readonly CareerDiaryAdaptationTask[]): CareerDiaryAdaptationGroup[] {
  const names = [...new Set(tasks.map((task) => task.group))];
  return names.map((name) => ({ name, tasks: tasks.filter((task) => task.group === name) }));
}

export interface AdaptationViewInput {
  readonly workplace: { readonly id: string; readonly startDate: string };
  /** Задачи плана; `null` — плана нет. */
  readonly tasks: readonly PlanTask[] | null;
  readonly details: CareerDiaryAdaptationDetails;
  /** Сегодняшний день, `ГГГГ-ММ-ДД`. */
  readonly asOf: string;
}

/**
 * План адаптации для экрана d01: этапы 30-60-90 и шесть шагов со сводкой. Прежний план
 * не меняется — шаг, группа и цель задачи лежат в деталях; задача без деталей встаёт
 * в шаг по этапу и виду.
 */
export function buildAdaptationView(input: AdaptationViewInput): CareerDiaryAdaptationView {
  const { workplace, details, asOf } = input;
  const day = dayNumber(workplace.startDate, asOf);
  const tasks: CareerDiaryAdaptationTask[] = (input.tasks ?? []).map((task) => {
    const own = Object.hasOwn(details.tasks, task.id) ? details.tasks[task.id] : undefined;
    const { category: _category, ...rest } = task;
    return {
      ...rest,
      step: own?.step === undefined ? defaultStep(task) : own.step,
      group: own?.group ?? null,
      goalId: own?.goalId ?? null,
    };
  });
  return {
    workplaceId: workplace.id,
    hasPlan: input.tasks !== null,
    startDate: workplace.startDate,
    dayNumber: day,
    stages: ADAPTATION_STAGES.map((stage) => {
      const own = tasks.filter((task) => task.stage === stage);
      const goal = details.stages[stage] ?? { title: null, goalId: null };
      return { stage, ...goal, tasks: own, ...counted(own, day >= STAGE_FIRST_DAY[stage]) };
    }),
    steps: ADAPTATION_STEPS.map((id) => {
      const own = tasks.filter((task) => task.step === id);
      return { id, groups: groupsOf(own), ...counted(own, own.some((task) => task.completed)) };
    }),
    probation: details.probation,
    firstMeeting: details.firstMeeting,
    relocated: details.relocated,
  };
}

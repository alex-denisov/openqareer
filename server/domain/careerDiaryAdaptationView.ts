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

/**
 * Дни шага на новом месте (день выхода — 1), как в плане d01: «До выхода» и «Первые две недели»
 * совпадают с `STEP_SPAN` экрана; карта людей ведётся весь срок адаптации.
 */
const STEP_DAYS: Readonly<Record<CareerDiaryAdaptationStepId, readonly [number, number]>> = {
  before_start: [Number.NEGATIVE_INFINITY, 0],
  first_two_weeks: [1, 13],
  first_meeting: [1, 7],
  people_map: [1, 90],
  day_30_check: [28, 30],
  settling: [1, 30],
};

/**
 * B685: состояние шага по его дням и задачам (решения оркестратора 23.11): все задачи шага
 * закрыты — «пройдено», даже раньше его дней; иначе до дней шага — «впереди», в его дни —
 * «идёт»; после них — «идёт» с открытой задачей и «пройдено» без задач.
 */
function stepProgress(
  id: CareerDiaryAdaptationStepId,
  day: number,
  tasks: readonly CareerDiaryAdaptationTask[],
): CareerDiaryProgress {
  const open = tasks.some((task) => !task.completed);
  if (tasks.length > 0 && !open) return 'done';
  const [from, to] = STEP_DAYS[id];
  if (day < from) return 'ahead';
  if (day <= to) return 'active';
  return open ? 'active' : 'done';
}

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
      const summary = counted(own, own.some((task) => task.completed));
      return { id, groups: groupsOf(own), ...summary, status: stepProgress(id, day, own) };
    }),
    probation: details.probation,
    firstMeeting: details.firstMeeting,
    relocated: details.relocated,
  };
}

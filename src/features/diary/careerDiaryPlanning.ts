import type {
  CareerDiaryGoalPatch,
  CareerDiaryGoalSummary,
  CareerDiaryWorkplace,
  CareerDiaryWorkplacePatch,
} from '../../../shared/careerDiary';
import {
  createDefaultExecutiveOnboarding,
  type OnboardingTask,
} from '../onboarding/executiveOnboarding';

export type CareerDiaryAdaptationStage =
  | 'prep'
  | 'days_1_30'
  | 'days_31_60'
  | 'days_61_90';

export type CareerDiaryAdaptationPhase = CareerDiaryAdaptationStage | 'offer_accepted' | 'past_90' | 'archived';

export interface CareerDiaryAdaptationTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly stage: CareerDiaryAdaptationStage;
  readonly category: OnboardingTask['category'];
  readonly dueDate: string;
  readonly completed: boolean;
  readonly source: 'template' | 'candidate';
}

export interface CareerDiaryAdaptationPlan {
  readonly id: string;
  readonly workplaceId: string;
  readonly startDate: string;
  readonly createdAt: string;
  readonly status: 'active' | 'closed';
  readonly closedAt: string | null;
  readonly tasks: readonly CareerDiaryAdaptationTask[];
}

export interface CareerDiaryQuarterDecision {
  readonly quarterId: string;
  readonly decision: 'keep' | 'move';
  readonly decidedAt: string;
}

export type CareerDiaryGoalWithQuarterDecision = CareerDiaryGoalSummary & {
  readonly quarterDecision?: CareerDiaryQuarterDecision;
};

export type CareerDiaryGoalPatchWithQuarterDecision = CareerDiaryGoalPatch & {
  readonly quarterDecision?: CareerDiaryQuarterDecision;
};

export interface CareerDiaryWorkplacePlanning {
  readonly adaptationPlan: CareerDiaryAdaptationPlan | null;
}

export type CareerDiaryWorkplaceWithPlanning = CareerDiaryWorkplace & {
  readonly planning?: CareerDiaryWorkplacePlanning;
};

export type CareerDiaryWorkplacePatchWithPlanning = CareerDiaryWorkplacePatch & {
  readonly planning?: CareerDiaryWorkplacePlanning;
};

export interface CareerDiaryQuarterWindow {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly nextId: string;
  readonly nextStartDate: string;
  readonly nextEndDate: string;
}

export interface CareerDiaryQuarterGoalProgress<TGoal extends CareerDiaryGoalSummary = CareerDiaryGoalSummary> {
  readonly goal: TGoal;
  readonly status: 'complete' | 'in_progress' | 'unknown';
  readonly progressPercent: number | null;
  readonly measuredInQuarter: boolean;
}

export interface CareerDiaryQuarterSummary<TGoal extends CareerDiaryGoalSummary = CareerDiaryGoalSummary> {
  readonly quarter: CareerDiaryQuarterWindow;
  readonly goals: readonly CareerDiaryQuarterGoalProgress<TGoal>[];
  readonly goalCount: number;
  readonly achievedCount: number;
  readonly measuredCount: number;
  readonly unknownCount: number;
  readonly freshMeasurementCount: number;
  readonly progressPercent: number | null;
}

const QUARTER_MONTHS = 3;
const FRESH_MEASUREMENT_DAYS = 14;
const MAX_ADAPTATION_DAYS = 90;

export function careerDiaryQuarter(asOf: string): CareerDiaryQuarterWindow {
  const date = parseUtcDate(asOf);
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / QUARTER_MONTHS);
  const month = quarter * QUARTER_MONTHS;
  const nextQuarterMonth = month + QUARTER_MONTHS;
  const nextYear = year + Math.floor(nextQuarterMonth / 12);
  const normalizedNextMonth = nextQuarterMonth % 12;
  const quarterNumber = quarter + 1;
  const nextQuarterNumber = normalizedNextMonth / QUARTER_MONTHS + 1;
  return {
    id: `Q${quarterNumber} ${year}`,
    startDate: utcDate(year, month, 1),
    endDate: utcDate(year, month + QUARTER_MONTHS, 0),
    nextId: `Q${nextQuarterNumber} ${nextYear}`,
    nextStartDate: utcDate(nextYear, normalizedNextMonth, 1),
    nextEndDate: utcDate(nextYear, normalizedNextMonth + QUARTER_MONTHS, 0),
  };
}

export function summarizeCareerDiaryQuarter<TGoal extends CareerDiaryGoalSummary>(
  goals: readonly TGoal[],
  asOf: string,
): CareerDiaryQuarterSummary<TGoal> {
  const quarter = careerDiaryQuarter(asOf);
  const quarterGoals = goals.filter(
    (goal) => goal.dueDate >= quarter.startDate && goal.dueDate <= quarter.endDate,
  );
  const goalProgress = quarterGoals.map((goal) => summarizeGoal(goal, quarter, asOf));
  const measurable = goalProgress.filter(
    (item): item is CareerDiaryQuarterGoalProgress<TGoal> & { progressPercent: number } =>
      item.progressPercent !== null,
  );
  return {
    quarter,
    goals: goalProgress,
    goalCount: goalProgress.length,
    achievedCount: goalProgress.filter((item) => item.status === 'complete').length,
    measuredCount: goalProgress.filter((item) => item.measuredInQuarter).length,
    unknownCount: goalProgress.filter((item) => item.status === 'unknown').length,
    freshMeasurementCount: goalProgress.filter(
      ({ goal }) => isFreshMeasurement(goal.latestMeasurement?.measuredAt ?? null, asOf),
    ).length,
    progressPercent: measurable.length
      ? Math.round(measurable.reduce((sum, item) => sum + item.progressPercent, 0) / measurable.length)
      : null,
  };
}

export function careerDiaryAdaptationPhase(
  workplace: Pick<CareerDiaryWorkplace, 'startDate' | 'status'>,
  asOf: string,
): CareerDiaryAdaptationPhase {
  if (workplace.status === 'archived') return 'archived';
  if (workplace.startDate > asOf) return 'offer_accepted';
  const elapsed = daysBetween(workplace.startDate, asOf);
  if (elapsed <= 30) return 'days_1_30';
  if (elapsed <= 60) return 'days_31_60';
  if (elapsed <= MAX_ADAPTATION_DAYS) return 'days_61_90';
  return 'past_90';
}

export function canLaunchCareerDiaryAdaptationPlan(
  workplace: Pick<CareerDiaryWorkplace, 'startDate' | 'status'>,
  asOf: string,
): boolean {
  const phase = careerDiaryAdaptationPhase(workplace, asOf);
  return phase !== 'archived' && phase !== 'past_90';
}

export function createCareerDiaryAdaptationPlan(
  workplace: CareerDiaryWorkplace,
  createdAt: string,
  idFactory: () => string = () => crypto.randomUUID(),
): CareerDiaryAdaptationPlan {
  const templates = createDefaultExecutiveOnboarding(workplace.company, workplace.title).tasks;
  return {
    id: idFactory(),
    workplaceId: workplace.id,
    startDate: workplace.startDate,
    createdAt,
    status: 'active',
    closedAt: null,
    tasks: templates.map((task) => {
      const stage = stageForOnboardingTask(task.stage);
      return {
        id: idFactory(),
        title: task.title,
        description: task.description,
        stage,
        category: task.category,
        dueDate: stageDueDate(workplace.startDate, stage),
        completed: false,
        source: 'template',
      };
    }),
  };
}

export function adaptationPlanProgress(
  plan: CareerDiaryAdaptationPlan,
  stage?: CareerDiaryAdaptationStage,
): { readonly completed: number; readonly total: number } {
  const tasks = stage ? plan.tasks.filter((task) => task.stage === stage) : plan.tasks;
  return {
    completed: tasks.filter((task) => task.completed).length,
    total: tasks.length,
  };
}

export interface CareerDiaryNewAdaptationTask {
  readonly title: string;
  readonly description?: string;
  readonly stage: CareerDiaryAdaptationStage;
  readonly category?: OnboardingTask['category'];
  readonly dueDate: string;
}

export function addCareerDiaryAdaptationTask(
  plan: CareerDiaryAdaptationPlan,
  input: CareerDiaryNewAdaptationTask,
  idFactory: () => string = () => crypto.randomUUID(),
): CareerDiaryAdaptationPlan {
  const title = input.title.trim();
  const description = input.description?.trim() ?? '';
  if (plan.status !== 'active') throw new Error('Закрытый план доступен только для чтения.');
  if (!title || title.length > 200 || description.length > 1000) {
    throw new Error('Проверьте название и описание задачи.');
  }
  parseUtcDate(input.dueDate);
  return {
    ...plan,
    tasks: [
      ...plan.tasks,
      {
        id: idFactory(),
        title,
        description,
        stage: input.stage,
        category: input.category ?? 'alignment',
        dueDate: input.dueDate,
        completed: false,
        source: 'candidate',
      },
    ],
  };
}

export function setCareerDiaryAdaptationTaskCompleted(
  plan: CareerDiaryAdaptationPlan,
  taskId: string,
  completed: boolean,
): CareerDiaryAdaptationPlan {
  if (plan.status !== 'active') return plan;
  let found = false;
  const tasks = plan.tasks.map((task) => {
    if (task.id !== taskId) return task;
    found = true;
    return { ...task, completed };
  });
  return found ? { ...plan, tasks } : plan;
}

export function closeCareerDiaryAdaptationPlan(
  plan: CareerDiaryAdaptationPlan,
  closedAt: string,
): CareerDiaryAdaptationPlan {
  if (plan.status === 'closed') return plan;
  if (!Number.isFinite(new Date(closedAt).getTime())) {
    throw new RangeError('Ожидалась дата закрытия плана.');
  }
  return { ...plan, status: 'closed', closedAt };
}

function summarizeGoal<TGoal extends CareerDiaryGoalSummary>(
  goal: TGoal,
  quarter: CareerDiaryQuarterWindow,
  asOf: string,
): CareerDiaryQuarterGoalProgress<TGoal> {
  const measurement = goal.latestMeasurement;
  const measuredInQuarter = Boolean(
    measurement && measurement.measuredAt >= quarter.startDate && measurement.measuredAt <= asOf,
  );
  if (!measurement || !measuredInQuarter) {
    return { goal, status: 'unknown', progressPercent: null, measuredInQuarter };
  }
  if (typeof goal.targetValue !== 'number') {
    const progressPercent = measurement.value === goal.targetValue ? 100 : 0;
    return {
      goal,
      status: progressPercent === 100 ? 'complete' : 'in_progress',
      progressPercent,
      measuredInQuarter,
    };
  }
  if (typeof measurement.value !== 'number' || goal.baselineValue === null) {
    return { goal, status: 'unknown', progressPercent: null, measuredInQuarter };
  }
  const distance = goal.targetValue - goal.baselineValue;
  if (distance === 0) return { goal, status: 'unknown', progressPercent: null, measuredInQuarter };
  const fraction = (measurement.value - goal.baselineValue) / distance;
  const progressPercent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const complete = distance > 0
    ? measurement.value >= goal.targetValue
    : measurement.value <= goal.targetValue;
  return {
    goal,
    status: complete ? 'complete' : 'in_progress',
    progressPercent,
    measuredInQuarter,
  };
}

function stageForOnboardingTask(stage: OnboardingTask['stage']): CareerDiaryAdaptationStage {
  switch (stage) {
    case 'prep':
      return 'prep';
    case 'days-30':
      return 'days_1_30';
    case 'days-60':
      return 'days_31_60';
    case 'days-90':
      return 'days_61_90';
  }
}

function stageDueDate(startDate: string, stage: CareerDiaryAdaptationStage): string {
  const daysFromStart: Record<CareerDiaryAdaptationStage, number> = {
    prep: 0,
    days_1_30: 30,
    days_31_60: 60,
    days_61_90: 90,
  };
  return addUtcDays(startDate, daysFromStart[stage]);
}

function isFreshMeasurement(measuredAt: string | null, asOf: string): boolean {
  if (!measuredAt || measuredAt > asOf) return false;
  const age = daysBetween(measuredAt, asOf);
  return age <= FRESH_MEASUREMENT_DAYS;
}

function daysBetween(start: string, end: string): number {
  return Math.floor((parseUtcDate(end).getTime() - parseUtcDate(start).getTime()) / 86_400_000);
}

function addUtcDays(date: string, days: number): string {
  const result = parseUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function parseUtcDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError('Ожидалась дата в формате ГГГГ-ММ-ДД.');
  return parsed;
}

function utcDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

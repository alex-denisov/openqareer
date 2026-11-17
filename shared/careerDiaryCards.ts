import type { CareerDiaryGoalSummary } from './careerDiary';

/** B684: поля цели и плана адаптации для экранов дневника B640. */
export const GOAL_SETTERS = ['self', 'manager', 'team'] as const;
/** Кто поставил цель: «Вы», «Руководитель», «Команда». */
export type CareerDiaryGoalSetter = (typeof GOAL_SETTERS)[number];

export const GOAL_INDICATORS_MAX = 3;
export const DIARY_NOTE_MAX = 500;

export interface CareerDiaryGoalArchive {
  readonly archivedAt: string;
  /** Причина одной строкой: «Отменена директором: банк меняет платформу сборки». */
  readonly reason: string;
}

export interface CareerDiaryGoalDetails {
  readonly setBy: CareerDiaryGoalSetter;
  /** День, когда о цели договорились. */
  readonly agreedOn: string | null;
  /** Вес цели в оценке, 0–100. */
  readonly weight: number | null;
  readonly archive: CareerDiaryGoalArchive | null;
}

/** Цель одним ответом: сама цель, её поля из макета и показатели внутри. */
export interface CareerDiaryGoalCard extends CareerDiaryGoalSummary {
  readonly details: CareerDiaryGoalDetails;
  /** Показатели цели; пусто — цель ведёт одно своё значение (так устроены прежние цели). */
  readonly indicators: readonly CareerDiaryGoalSummary[];
}

export interface CareerDiaryGoalCards {
  readonly items: readonly CareerDiaryGoalCard[];
  readonly archived: readonly CareerDiaryGoalCard[];
}

export interface CareerDiaryIndicatorInput {
  readonly title: string;
  readonly unit: string;
  readonly baselineValue: number | null;
  readonly targetValue: number | boolean | string;
}

export interface CareerDiaryGoalCardInput {
  readonly title: string;
  readonly type?: CareerDiaryGoalSummary['type'];
  readonly horizon: CareerDiaryGoalSummary['horizon'];
  readonly startDate: string;
  readonly dueDate: string;
  readonly setBy: CareerDiaryGoalSetter;
  readonly agreedOn?: string | null;
  readonly weight?: number | null;
  readonly indicators: readonly CareerDiaryIndicatorInput[];
}

export const ADAPTATION_STEPS = [
  'before_start',
  'first_two_weeks',
  'first_meeting',
  'people_map',
  'day_30_check',
  'settling',
] as const;
/** Шесть шагов адаптации из макета d01. */
export type CareerDiaryAdaptationStepId = (typeof ADAPTATION_STEPS)[number];

export const ADAPTATION_STAGES = ['prep', 'days_1_30', 'days_31_60', 'days_61_90'] as const;
export type CareerDiaryAdaptationStageId = (typeof ADAPTATION_STAGES)[number];

export type CareerDiaryProgress = 'done' | 'active' | 'ahead';

/** Что добавлено к задаче плана: шаг, группа внутри шага, цель. */
export interface CareerDiaryTaskDetails {
  readonly step: CareerDiaryAdaptationStepId | null;
  readonly group: string | null;
  readonly goalId: string | null;
}

export interface CareerDiaryFirstMeeting {
  readonly heldOn: string | null;
  readonly expectations: string;
  readonly successByDay90: string;
  readonly measures: string;
  readonly cadence: string;
  readonly needsApproval: string;
  readonly ownDecisions: string;
  readonly manager: string;
}

export interface CareerDiaryProbation {
  /** День решения по испытательному сроку. */
  readonly endsOn: string | null;
  readonly reviewer: string | null;
}

export interface CareerDiaryStageGoal {
  /** «Познакомиться с командой». */
  readonly title: string | null;
  readonly goalId: string | null;
}

/**
 * Детали задачи как они хранятся: названо только то, что кандидат задал сам.
 * Шаг не назван — задача встаёт в шаг по этапу и виду; `step: null` — «ни в одном шаге».
 */
export type CareerDiaryStoredTaskDetails = Partial<CareerDiaryTaskDetails>;

/** Всё, что хранится сверх прежнего плана адаптации. */
export interface CareerDiaryAdaptationDetails {
  readonly tasks: Readonly<Record<string, CareerDiaryStoredTaskDetails>>;
  readonly stages: Readonly<Partial<Record<CareerDiaryAdaptationStageId, CareerDiaryStageGoal>>>;
  readonly probation: CareerDiaryProbation;
  readonly firstMeeting: CareerDiaryFirstMeeting | null;
  /** Был ли переезд ради этой работы; `null` — кандидат не отвечал. */
  readonly relocated: boolean | null;
}

export interface CareerDiaryAdaptationTask extends CareerDiaryTaskDetails {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly stage: CareerDiaryAdaptationStageId;
  readonly dueDate: string;
  readonly completed: boolean;
  readonly source: 'template' | 'candidate';
}

interface Counted {
  readonly tasksTotal: number;
  readonly tasksDone: number;
  readonly status: CareerDiaryProgress;
}

export interface CareerDiaryAdaptationStageView extends Counted, CareerDiaryStageGoal {
  readonly stage: CareerDiaryAdaptationStageId;
  readonly tasks: readonly CareerDiaryAdaptationTask[];
}

export interface CareerDiaryAdaptationGroup {
  /** Подзаголовок группы; `null` — задачи без группы. */
  readonly name: string | null;
  readonly tasks: readonly CareerDiaryAdaptationTask[];
}

export interface CareerDiaryAdaptationStepView extends Counted {
  readonly id: CareerDiaryAdaptationStepId;
  readonly groups: readonly CareerDiaryAdaptationGroup[];
}

/** План адаптации одним ответом: этапы 30-60-90 и шесть шагов со сводкой. */
export interface CareerDiaryAdaptationView {
  readonly workplaceId: string;
  /** Плана ещё нет: шаги пустые, поля кандидата всё равно читаются. */
  readonly hasPlan: boolean;
  readonly startDate: string;
  /** Номер дня на новом месте: день выхода — 1; до выхода — число оставшихся дней со знаком минус. */
  readonly dayNumber: number;
  readonly stages: readonly CareerDiaryAdaptationStageView[];
  readonly steps: readonly CareerDiaryAdaptationStepView[];
  readonly probation: CareerDiaryProbation;
  readonly firstMeeting: CareerDiaryFirstMeeting | null;
  readonly relocated: boolean | null;
}

export const EMPTY_ADAPTATION_DETAILS: CareerDiaryAdaptationDetails = {
  tasks: {},
  stages: {},
  probation: { endsOn: null, reviewer: null },
  firstMeeting: null,
  relocated: null,
};

export const DEFAULT_GOAL_DETAILS: CareerDiaryGoalDetails = {
  setBy: 'self',
  agreedOn: null,
  weight: null,
  archive: null,
};
